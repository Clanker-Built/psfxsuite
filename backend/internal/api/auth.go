package api

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"time"

	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
)

// Session cookie name
const sessionCookieName = "session"

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type loginResponse struct {
	User userResponse `json:"user"`
	// Token is no longer returned in body - sent as httpOnly cookie
}

type userResponse struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
	Role     string `json:"role"`
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Look up user
	var user struct {
		ID                  int64
		Username            string
		Email               string
		Role                string
		PasswordHash        string
		FailedLoginAttempts int
		LockedUntil         *time.Time
	}

	err := s.db.QueryRow(`
		SELECT id, username, email, role, password_hash, failed_login_attempts, locked_until
		FROM users WHERE username = ?
	`, req.Username).Scan(
		&user.ID, &user.Username, &user.Email, &user.Role,
		&user.PasswordHash, &user.FailedLoginAttempts, &user.LockedUntil,
	)

	if err != nil {
		log.Debug().Err(err).Str("username", req.Username).Msg("login failed: user not found")
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	// Check if account is locked
	if user.LockedUntil != nil && user.LockedUntil.After(time.Now()) {
		http.Error(w, "account locked", http.StatusUnauthorized)
		return
	}

	// Verify password
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		// Increment failed attempts
		_, _ = s.db.Exec(`
			UPDATE users SET failed_login_attempts = failed_login_attempts + 1,
			locked_until = CASE WHEN failed_login_attempts >= 4 THEN datetime('now', '+15 minutes') ELSE NULL END
			WHERE id = ?
		`, user.ID)

		log.Debug().Str("username", req.Username).Msg("login failed: invalid password")
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	// Generate session token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		log.Error().Err(err).Msg("failed to generate session token")
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	token := hex.EncodeToString(tokenBytes)

	// Hash token for storage
	hash := sha256.Sum256([]byte(token))
	tokenHash := hex.EncodeToString(hash[:])

	// Calculate expiry
	expiresAt := time.Now().Add(time.Duration(s.cfg.SessionTimeoutHours) * time.Hour)

	// Delete existing sessions for user
	_, _ = s.db.Exec("DELETE FROM sessions WHERE user_id = ?", user.ID)

	// Create new session
	_, err = s.db.Exec(`
		INSERT INTO sessions (token_hash, user_id, expires_at, ip_address, user_agent)
		VALUES (?, ?, ?, ?, ?)
	`, tokenHash, user.ID, expiresAt, r.RemoteAddr, r.UserAgent())

	if err != nil {
		log.Error().Err(err).Msg("failed to create session")
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Reset failed login attempts and update last login
	_, _ = s.db.Exec(`
		UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login = datetime('now')
		WHERE id = ?
	`, user.ID)

	// Log successful login
	s.auditLog(user.ID, user.Username, "login", "user", "", "User logged in", "success", "", r)

	// Set httpOnly session cookie
	isSecure := os.Getenv("ENV") == "production"
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(s.cfg.SessionTimeoutHours * 3600),
	})

	// Return user info only (token is in cookie)
	resp := loginResponse{
		User: userResponse{
			ID:       user.ID,
			Username: user.Username,
			Email:    user.Email,
			Role:     user.Role,
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	user := GetUser(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Delete all sessions for user
	_, _ = s.db.Exec("DELETE FROM sessions WHERE user_id = ?", user.ID)

	// Clear the session cookie
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   os.Getenv("ENV") == "production",
		SameSite: http.SameSiteStrictMode,
		MaxAge:   -1, // Delete cookie immediately
	})

	s.auditLog(user.ID, user.Username, "logout", "user", "", "User logged out", "success", "", r)

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	user := GetUser(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	resp := userResponse{
		ID:       user.ID,
		Username: user.Username,
		Email:    user.Email,
		Role:     user.Role,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) changePassword(w http.ResponseWriter, r *http.Request) {
	user := GetUser(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Validate new password length
	if len(req.NewPassword) < 12 {
		http.Error(w, "password must be at least 12 characters", http.StatusBadRequest)
		return
	}

	// Verify current password
	var currentHash string
	err := s.db.QueryRow("SELECT password_hash FROM users WHERE id = ?", user.ID).Scan(&currentHash)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(currentHash), []byte(req.CurrentPassword)); err != nil {
		http.Error(w, "invalid current password", http.StatusUnauthorized)
		return
	}

	// Hash new password
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Update password
	_, err = s.db.Exec(`
		UPDATE users SET password_hash = ?, must_change_password = FALSE, last_password_change = datetime('now')
		WHERE id = ?
	`, string(newHash), user.ID)

	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	s.auditLog(user.ID, user.Username, "change_password", "user", "", "Password changed", "success", "", r)

	w.WriteHeader(http.StatusNoContent)
}

// Helper to write audit log entries
func (s *Server) auditLog(userID int64, username, action, resourceType, resourceID, summary, status, errorMsg string, r *http.Request) {
	_, err := s.db.Exec(`
		INSERT INTO audit_log (user_id, username, action, resource_type, resource_id, summary, status, error_message, ip_address, user_agent)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, userID, username, action, resourceType, resourceID, summary, status, errorMsg, r.RemoteAddr, r.UserAgent())

	if err != nil {
		log.Error().Err(err).Msg("failed to write audit log")
	}
}
