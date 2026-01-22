package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
	"time"
)

type contextKey string

const (
	contextKeyUser contextKey = "user"
)

// Permission constants for RBAC
type Permission string

const (
	// View permissions (read-only)
	PermViewStatus   Permission = "view:status"
	PermViewConfig   Permission = "view:config"
	PermViewLogs     Permission = "view:logs"
	PermViewAlerts   Permission = "view:alerts"
	PermViewQueue    Permission = "view:queue"
	PermViewAudit    Permission = "view:audit"
	PermViewUsers    Permission = "view:users"
	PermViewSettings Permission = "view:settings"

	// Edit/Write permissions
	PermEditConfig        Permission = "edit:config"
	PermApplyConfig       Permission = "apply:config"
	PermManageQueue       Permission = "manage:queue"
	PermAcknowledgeAlerts Permission = "acknowledge:alerts"
	PermEditAlertRules    Permission = "edit:alert_rules"
	PermManageUsers       Permission = "manage:users"
	PermManageSettings    Permission = "manage:settings"
	PermManageCerts       Permission = "manage:certs"
	PermManageTransport   Permission = "manage:transport"
)

// rolePermissions defines what each role can do
var rolePermissions = map[string][]Permission{
	"admin": {
		// Admins can do everything
		PermViewStatus, PermViewConfig, PermViewLogs, PermViewAlerts, PermViewQueue, PermViewAudit, PermViewUsers, PermViewSettings,
		PermEditConfig, PermApplyConfig, PermManageQueue, PermAcknowledgeAlerts, PermEditAlertRules,
		PermManageUsers, PermManageSettings, PermManageCerts, PermManageTransport,
	},
	"operator": {
		// Operators can view everything and manage queue/alerts, but cannot change config or users
		PermViewStatus, PermViewConfig, PermViewLogs, PermViewAlerts, PermViewQueue, PermViewAudit,
		PermManageQueue, PermAcknowledgeAlerts,
	},
	"auditor": {
		// Auditors can only view (read-only access)
		PermViewStatus, PermViewConfig, PermViewLogs, PermViewAlerts, PermViewQueue, PermViewAudit,
	},
}

// HasPermission checks if a role has a specific permission
func HasPermission(role string, perm Permission) bool {
	perms, ok := rolePermissions[role]
	if !ok {
		return false
	}
	for _, p := range perms {
		if p == perm {
			return true
		}
	}
	return false
}

// requirePermission creates a middleware that checks for a specific permission
func (s *Server) requirePermission(perm Permission) func(http.HandlerFunc) http.HandlerFunc {
	return func(h http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			user := GetUser(r.Context())
			if user == nil {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
			if !HasPermission(user.Role, perm) {
				http.Error(w, "forbidden: insufficient permissions", http.StatusForbidden)
				return
			}
			h(w, r)
		}
	}
}

// User represents an authenticated user in context
type User struct {
	ID       int64
	Username string
	Email    string
	Role     string
}

// GetUser retrieves the authenticated user from context
func GetUser(ctx context.Context) *User {
	if user, ok := ctx.Value(contextKeyUser).(*User); ok {
		return user
	}
	return nil
}

// authMiddleware validates the session token and adds user to context
func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var token string

		// Try to get token from httpOnly cookie first
		if cookie, err := r.Cookie(sessionCookieName); err == nil && cookie.Value != "" {
			token = cookie.Value
		} else {
			// Fall back to Authorization header for API clients
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}

			token = strings.TrimPrefix(authHeader, "Bearer ")
			if token == authHeader {
				http.Error(w, "invalid authorization header", http.StatusUnauthorized)
				return
			}
		}

		// Hash the token for lookup
		hash := sha256.Sum256([]byte(token))
		tokenHash := hex.EncodeToString(hash[:])

		// Look up session
		var user User
		var expiresAt time.Time
		err := s.db.QueryRow(`
			SELECT u.id, u.username, u.email, u.role, s.expires_at
			FROM sessions s
			JOIN users u ON s.user_id = u.id
			WHERE s.token_hash = ? AND s.expires_at > datetime('now')
		`, tokenHash).Scan(&user.ID, &user.Username, &user.Email, &user.Role, &expiresAt)

		if err != nil {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		// Update last activity
		_, _ = s.db.Exec(`
			UPDATE sessions SET last_activity = datetime('now') WHERE token_hash = ?
		`, tokenHash)

		// Add user to context
		ctx := context.WithValue(r.Context(), contextKeyUser, &user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// adminOnlyMiddleware restricts access to admin users
func (s *Server) adminOnlyMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUser(r.Context())
		if user == nil || user.Role != "admin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// adminOnly wraps a handler to require admin role
func (s *Server) adminOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := GetUser(r.Context())
		if user == nil || user.Role != "admin" {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		h(w, r)
	}
}

// operatorOnly wraps a handler to require operator or admin role
func (s *Server) operatorOnly(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := GetUser(r.Context())
		if user == nil || (user.Role != "admin" && user.Role != "operator") {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		h(w, r)
	}
}
