package api

import (
	"crypto/sha256"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/gorilla/csrf"
	"github.com/postfixrelay/postfixrelay/internal/config"
	"github.com/postfixrelay/postfixrelay/internal/database"
	"github.com/postfixrelay/postfixrelay/internal/dovecot"
	"github.com/rs/zerolog/log"
	"golang.org/x/time/rate"
)

// Server holds the API server dependencies
type Server struct {
	cfg          *config.Config
	db           *database.DB
	dovecotSyncer *dovecot.Syncer
}

// NewServer creates a new API server
func NewServer(cfg *config.Config, db *database.DB) *Server {
	// Initialize Dovecot syncer with config from environment
	dovecotCfg := dovecot.DefaultConfig()
	if path := os.Getenv("DOVECOT_PASSWD_FILE"); path != "" {
		dovecotCfg.DovecotPasswdFile = path
	}
	if path := os.Getenv("POSTFIX_VMAILBOX_FILE"); path != "" {
		dovecotCfg.PostfixVirtualMailbox = path
	}
	if path := os.Getenv("POSTFIX_VIRTUAL_FILE"); path != "" {
		dovecotCfg.PostfixVirtualAlias = path
	}
	if path := os.Getenv("MAIL_DIR"); path != "" {
		dovecotCfg.MailDir = path
	}

	return &Server{
		cfg:           cfg,
		db:            db,
		dovecotSyncer: dovecot.NewSyncer(db.DB, dovecotCfg),
	}
}

// Router creates and configures the HTTP router
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()

	// Middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(s.loggerMiddleware)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))
	r.Use(s.rateLimitMiddleware)        // Global rate limiting
	r.Use(s.securityHeadersMiddleware)  // Security headers

	// CORS - configure from environment in production
	allowedOrigins := s.getAllowedOrigins()
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   allowedOrigins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link", "X-CSRF-Token"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// CSRF Protection - derive key from AppSecret
	csrfKey := s.deriveCSRFKey()
	isSecure := os.Getenv("ENV") == "production"
	csrfMiddleware := csrf.Protect(
		csrfKey,
		csrf.Secure(isSecure),
		csrf.HttpOnly(true),
		csrf.SameSite(csrf.SameSiteStrictMode),
		csrf.Path("/"),
		csrf.ErrorHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			log.Warn().
				Str("path", r.URL.Path).
				Str("method", r.Method).
				Str("ip", r.RemoteAddr).
				Msg("CSRF token validation failed")
			http.Error(w, "CSRF token invalid or missing", http.StatusForbidden)
		})),
	)

	// Apply CSRF to all routes except exempted ones
	r.Use(s.csrfExemptMiddleware(csrfMiddleware))

	// Health endpoints (no auth)
	r.Get("/healthz", s.healthz)
	r.Get("/readyz", s.readyz)

	// API routes
	r.Route("/api/v1", func(r chi.Router) {
		// CSRF token endpoint (no auth required, but CSRF protected)
		r.Get("/csrf-token", s.getCSRFToken)

		// Setup routes (no auth required, only work when no admin exists)
		r.Get("/setup/status", s.getSetupStatus)
		r.Post("/setup/complete", s.completeSetup)

		// Auth routes (no auth required)
		r.Post("/auth/login", s.login)

		// Protected routes
		r.Group(func(r chi.Router) {
			r.Use(s.authMiddleware)

			// Auth
			r.Post("/auth/logout", s.logout)
			r.Get("/auth/me", s.me)
			r.Put("/auth/password", s.changePassword)

			// Status
			r.Get("/status", s.getStatus)

			// Config
			r.Route("/config", func(r chi.Router) {
				r.Get("/", s.getConfig)
				r.Get("/full", s.adminOnly(s.getConfigFull))
				// Legacy direct update (deprecated - use submit/apply workflow)
				r.Put("/", s.adminOnly(s.updateConfig))
				// New submit/apply workflow
				r.Get("/staged", s.getStagedConfig)
				r.Post("/submit", s.adminOnly(s.submitConfig))
				r.Delete("/staged", s.adminOnly(s.discardStagedConfig))
				r.Get("/staged/diff", s.getStagedDiff)
				// Validation and apply
				r.Post("/validate", s.adminOnly(s.validateConfig))
				r.Post("/apply", s.adminOnly(s.applyConfig))
				r.Post("/rollback/{version}", s.adminOnly(s.rollbackConfig))
				r.Get("/history", s.getConfigHistory)
				r.Get("/history/{version}", s.getConfigVersion)
				// Certificate management
				r.Get("/certificates", s.getCertificates)
				r.Post("/certificates", s.adminOnly(s.uploadCertificate))
				r.Delete("/certificates/{type}", s.adminOnly(s.deleteCertificate))
				// Credentials management
				r.Post("/credentials", s.adminOnly(s.saveCredentials))
			})

			// Logs
			r.Route("/logs", func(r chi.Router) {
				r.Get("/", s.getLogs)
				r.Get("/stream", s.streamLogs) // WebSocket
				r.Get("/queue/{queueId}", s.getLogsByQueueId)
				r.Get("/export", s.exportLogs)
			})

			// Alerts
			r.Route("/alerts", func(r chi.Router) {
				r.Get("/", s.getAlerts)
				r.Get("/{id}", s.getAlert)
				r.Post("/{id}/acknowledge", s.operatorOnly(s.acknowledgeAlert))
				r.Post("/{id}/silence", s.operatorOnly(s.silenceAlert))
				r.Get("/rules", s.getAlertRules)
				r.Put("/rules/{id}", s.adminOnly(s.updateAlertRule))
				r.Get("/runbook/{type}", s.getRunbook)
			})

			// Queue
			r.Route("/queue", func(r chi.Router) {
				r.Get("/", s.getQueueSummary)
				r.Get("/messages", s.getQueueMessages)
				r.Get("/messages/{queueId}", s.getQueueMessage)
				r.Post("/messages/{queueId}/hold", s.operatorOnly(s.holdMessage))
				r.Post("/messages/{queueId}/release", s.operatorOnly(s.releaseMessage))
				r.Delete("/messages/{queueId}", s.adminOnly(s.deleteMessage))
				r.Post("/flush", s.operatorOnly(s.flushQueue))
			})

			// Transport maps (domain routing)
			r.Route("/transport", func(r chi.Router) {
				r.Get("/", s.getTransportMaps)
				r.Post("/", s.adminOnly(s.createTransportMap))
				r.Put("/{domain}", s.adminOnly(s.updateTransportMap))
				r.Delete("/{domain}", s.adminOnly(s.deleteTransportMap))
			})

			// Sender-dependent relays
			r.Route("/sender-relays", func(r chi.Router) {
				r.Get("/", s.getSenderRelays)
				r.Post("/", s.adminOnly(s.createSenderRelay))
				r.Put("/{sender}", s.adminOnly(s.updateSenderRelay))
				r.Delete("/{sender}", s.adminOnly(s.deleteSenderRelay))
			})

			// Audit
			r.Get("/audit", s.getAuditLog)

			// Users (admin only)
			r.Route("/users", func(r chi.Router) {
				r.Use(s.adminOnlyMiddleware)
				r.Get("/", s.getUsers)
				r.Post("/", s.createUser)
				r.Get("/{id}", s.getUser)
				r.Put("/{id}", s.updateUser)
				r.Delete("/{id}", s.deleteUser)
				r.Post("/{id}/reset-password", s.resetPassword)
			})

			// Settings (admin only)
			r.Route("/settings", func(r chi.Router) {
				r.Use(s.adminOnlyMiddleware)
				// Notification channels
				r.Route("/notifications", func(r chi.Router) {
					r.Get("/", s.getNotificationChannels)
					r.Post("/", s.createNotificationChannel)
					r.Put("/{id}", s.updateNotificationChannel)
					r.Delete("/{id}", s.deleteNotificationChannel)
					r.Post("/{id}/test", s.testNotificationChannel)
				})
				// System settings
				r.Get("/system", s.getSystemSettings)
				r.Put("/system", s.updateSystemSettings)
			})

			// PSFXAdmin - Mail domain and mailbox management (admin only)
			r.Route("/admin", func(r chi.Router) {
				r.Use(s.adminOnlyMiddleware)

				// Stats overview
				r.Get("/stats", s.getAdminStats)

				// Domains
				r.Route("/domains", func(r chi.Router) {
					r.Get("/", s.listDomains)
					r.Post("/", s.createDomain)
					r.Get("/{id}", s.getDomain)
					r.Put("/{id}", s.updateDomain)
					r.Delete("/{id}", s.deleteDomain)
				})

				// Mailboxes
				r.Route("/mailboxes", func(r chi.Router) {
					r.Get("/", s.listMailboxes)
					r.Post("/", s.createMailbox)
					r.Get("/{id}", s.getMailbox)
					r.Put("/{id}", s.updateMailbox)
					r.Delete("/{id}", s.deleteMailbox)
					r.Post("/{id}/password", s.resetMailboxPassword)
				})

				// Aliases
				r.Route("/aliases", func(r chi.Router) {
					r.Get("/", s.listAliases)
					r.Post("/", s.createAlias)
					r.Delete("/{id}", s.deleteAlias)
				})

				// Mail server sync (for debugging)
				r.Post("/sync", s.triggerMailSync)
				r.Get("/sync/status", s.getMailSyncStatus)
			})
		})

		// PSFXMail - Webmail API (separate auth from admin)
		r.Route("/mail", func(r chi.Router) {
			// Mail authentication (no admin auth required)
			r.Post("/auth", s.authenticateMail)
			r.Post("/logout", s.logoutMail)

			// Protected mail routes (require mail session)
			r.Group(func(r chi.Router) {
				r.Use(s.mailSessionMiddleware)

				// Folders
				r.Get("/folders", s.getMailFolders)

				// Messages
				r.Get("/folders/{folder}/messages", s.getMailMessages)
				r.Get("/messages/{uid}", s.getMessage)
				r.Put("/messages/{uid}/flags", s.updateMessageFlags)
				r.Delete("/messages/{uid}", s.deleteMailMessage)
				r.Post("/messages/move", s.moveMessage)

				// Compose/Send
				r.Post("/send", s.sendMessage)

				// Search
				r.Get("/search", s.searchMessages)

				// Drafts
				r.Post("/drafts", s.saveDraft)
				r.Get("/drafts/{uid}", s.getDraft)
				r.Delete("/drafts/{uid}", s.deleteDraft)

				// Contacts
				r.Get("/contacts", s.listContacts)
				r.Post("/contacts", s.createContact)
				r.Get("/contacts/search", s.searchContacts)
				r.Get("/contacts/{id}", s.getContact)
				r.Put("/contacts/{id}", s.updateContact)
				r.Delete("/contacts/{id}", s.deleteContact)
				r.Put("/contacts/{id}/favorite", s.toggleContactFavorite)

				// Signatures
				r.Get("/signatures", s.listSignatures)
				r.Post("/signatures", s.createSignature)
				r.Get("/signatures/default", s.getDefaultSignature)
				r.Get("/signatures/{id}", s.getSignature)
				r.Put("/signatures/{id}", s.updateSignature)
				r.Delete("/signatures/{id}", s.deleteSignature)
				r.Put("/signatures/{id}/default", s.setDefaultSignature)
			})
		})
	})

	// Serve static files (frontend) in production
	r.Handle("/*", http.FileServer(http.Dir("./static")))

	return r
}

// Logger middleware
func (s *Server) loggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		defer func() {
			log.Debug().
				Str("method", r.Method).
				Str("path", r.URL.Path).
				Int("status", ww.Status()).
				Dur("duration", time.Since(start)).
				Msg("request")
		}()

		next.ServeHTTP(ww, r)
	})
}

// Health check handlers
func (s *Server) healthz(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ok"))
}

func (s *Server) readyz(w http.ResponseWriter, r *http.Request) {
	// Check database connection
	if err := s.db.Ping(); err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("ready"))
}

// deriveCSRFKey derives a 32-byte CSRF key from the AppSecret
func (s *Server) deriveCSRFKey() []byte {
	hash := sha256.Sum256([]byte(s.cfg.AppSecret + "-csrf"))
	return hash[:]
}

// csrfExemptMiddleware wraps CSRF middleware and exempts certain paths
func (s *Server) csrfExemptMiddleware(csrfHandler func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		csrfProtected := csrfHandler(next)

		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Exempt health checks
			if r.URL.Path == "/healthz" || r.URL.Path == "/readyz" {
				next.ServeHTTP(w, r)
				return
			}

			// Exempt WebSocket upgrade requests (log streaming)
			if strings.Contains(strings.ToLower(r.Header.Get("Connection")), "upgrade") &&
				strings.ToLower(r.Header.Get("Upgrade")) == "websocket" {
				next.ServeHTTP(w, r)
				return
			}

			// Exempt static file requests
			if !strings.HasPrefix(r.URL.Path, "/api/") {
				next.ServeHTTP(w, r)
				return
			}

			// Apply CSRF protection to all other requests
			csrfProtected.ServeHTTP(w, r)
		})
	}
}

// getAllowedOrigins returns CORS allowed origins from environment or defaults
func (s *Server) getAllowedOrigins() []string {
	origins := os.Getenv("CORS_ALLOWED_ORIGINS")
	if origins != "" {
		return strings.Split(origins, ",")
	}

	// Default to localhost for development
	if os.Getenv("ENV") != "production" {
		return []string{"http://localhost:5173", "http://localhost:8080"}
	}

	// In production without CORS_ALLOWED_ORIGINS, log warning
	log.Warn().Msg("CORS_ALLOWED_ORIGINS not set in production - using restrictive default")
	return []string{}
}

// Rate limiter implementation
type ipRateLimiter struct {
	mu       sync.Mutex
	limiters map[string]*rate.Limiter
	rate     rate.Limit
	burst    int
}

func newIPRateLimiter(r rate.Limit, b int) *ipRateLimiter {
	return &ipRateLimiter{
		limiters: make(map[string]*rate.Limiter),
		rate:     r,
		burst:    b,
	}
}

func (l *ipRateLimiter) getLimiter(ip string) *rate.Limiter {
	l.mu.Lock()
	defer l.mu.Unlock()

	limiter, exists := l.limiters[ip]
	if !exists {
		limiter = rate.NewLimiter(l.rate, l.burst)
		l.limiters[ip] = limiter
	}

	return limiter
}

// Cleanup old limiters periodically (called from a goroutine)
func (l *ipRateLimiter) cleanup() {
	l.mu.Lock()
	defer l.mu.Unlock()
	// Simple cleanup: clear all limiters every hour
	// This prevents memory growth from many unique IPs
	l.limiters = make(map[string]*rate.Limiter)
}

// Global rate limiter: 10 req/s, burst 30
var globalLimiter = newIPRateLimiter(10, 30)

// Login rate limiter: 1 req/s, burst 5 (stricter for auth endpoints)
var loginLimiter = newIPRateLimiter(1, 5)

func init() {
	// Start cleanup goroutine
	go func() {
		for {
			time.Sleep(time.Hour)
			globalLimiter.cleanup()
			loginLimiter.cleanup()
		}
	}()
}

// rateLimitMiddleware applies global rate limiting
func (s *Server) rateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		// Extract IP without port if present
		if idx := strings.LastIndex(ip, ":"); idx != -1 {
			ip = ip[:idx]
		}

		limiter := globalLimiter.getLimiter(ip)
		if !limiter.Allow() {
			log.Warn().
				Str("ip", ip).
				Str("path", r.URL.Path).
				Msg("Rate limit exceeded")
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// loginRateLimitMiddleware applies stricter rate limiting for auth endpoints
func (s *Server) loginRateLimitMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := r.RemoteAddr
		if idx := strings.LastIndex(ip, ":"); idx != -1 {
			ip = ip[:idx]
		}

		limiter := loginLimiter.getLimiter(ip)
		if !limiter.Allow() {
			log.Warn().
				Str("ip", ip).
				Str("path", r.URL.Path).
				Msg("Login rate limit exceeded")
			http.Error(w, "too many login attempts, please try again later", http.StatusTooManyRequests)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// securityHeadersMiddleware adds security headers to all responses
func (s *Server) securityHeadersMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Prevent clickjacking
		w.Header().Set("X-Frame-Options", "DENY")

		// Prevent MIME type sniffing
		w.Header().Set("X-Content-Type-Options", "nosniff")

		// XSS protection (legacy, but still useful for older browsers)
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		// Referrer policy
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")

		// Content Security Policy
		// Allow self for scripts/styles, inline for React, and connect to same origin for API
		w.Header().Set("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self' 'unsafe-inline' 'unsafe-eval'; "+
				"style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data: blob:; "+
				"font-src 'self' data:; "+
				"connect-src 'self' ws: wss:; "+
				"frame-ancestors 'none'; "+
				"form-action 'self'")

		// Permissions policy (previously Feature-Policy)
		w.Header().Set("Permissions-Policy",
			"accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()")

		// HSTS - only in production with HTTPS
		if os.Getenv("ENV") == "production" {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}

		next.ServeHTTP(w, r)
	})
}

// getCSRFToken returns the CSRF token for the current request
func (s *Server) getCSRFToken(w http.ResponseWriter, r *http.Request) {
	token := csrf.Token(r)
	w.Header().Set("X-CSRF-Token", token)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"csrfToken": token,
	})
}
