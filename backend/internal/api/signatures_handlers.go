package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// Signature represents an email signature
type Signature struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	ContentHTML string    `json:"contentHtml"`
	ContentText string    `json:"contentText"`
	IsDefault   bool      `json:"isDefault"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// SignatureRequest represents a create/update signature request
type SignatureRequest struct {
	Name        string `json:"name"`
	ContentHTML string `json:"contentHtml"`
	ContentText string `json:"contentText"`
	IsDefault   bool   `json:"isDefault"`
}

// listSignatures returns all signatures for the logged-in mail user
func (s *Server) listSignatures(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	rows, err := s.db.Query(`
		SELECT id, name, content_html, content_text, is_default, created_at, updated_at
		FROM mail_signatures
		WHERE owner_email = ?
		ORDER BY is_default DESC, name ASC
	`, session.Email)

	if err != nil {
		log.Error().Err(err).Msg("Failed to query signatures")
		http.Error(w, "Failed to load signatures", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	signatures := make([]Signature, 0)
	for rows.Next() {
		var sig Signature
		if err := rows.Scan(&sig.ID, &sig.Name, &sig.ContentHTML, &sig.ContentText, &sig.IsDefault, &sig.CreatedAt, &sig.UpdatedAt); err != nil {
			log.Error().Err(err).Msg("Failed to scan signature")
			continue
		}
		signatures = append(signatures, sig)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(signatures)
}

// createSignature creates a new signature
func (s *Server) createSignature(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	var req SignatureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Name is required", http.StatusBadRequest)
		return
	}

	// If this signature is set as default, unset other defaults first
	if req.IsDefault {
		_, err := s.db.Exec(`
			UPDATE mail_signatures SET is_default = FALSE WHERE owner_email = ?
		`, session.Email)
		if err != nil {
			log.Error().Err(err).Msg("Failed to unset default signature")
		}
	}

	result, err := s.db.Exec(`
		INSERT INTO mail_signatures (owner_email, name, content_html, content_text, is_default)
		VALUES (?, ?, ?, ?, ?)
	`, session.Email, req.Name, req.ContentHTML, req.ContentText, req.IsDefault)

	if err != nil {
		log.Error().Err(err).Msg("Failed to create signature")
		http.Error(w, "Failed to create signature", http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      id,
		"message": "Signature created",
	})
}

// getSignature retrieves a single signature
func (s *Server) getSignature(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid signature ID", http.StatusBadRequest)
		return
	}

	var sig Signature
	err = s.db.QueryRow(`
		SELECT id, name, content_html, content_text, is_default, created_at, updated_at
		FROM mail_signatures
		WHERE id = ? AND owner_email = ?
	`, id, session.Email).Scan(&sig.ID, &sig.Name, &sig.ContentHTML, &sig.ContentText, &sig.IsDefault, &sig.CreatedAt, &sig.UpdatedAt)

	if err == sql.ErrNoRows {
		http.Error(w, "Signature not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Error().Err(err).Msg("Failed to query signature")
		http.Error(w, "Failed to load signature", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sig)
}

// updateSignature updates an existing signature
func (s *Server) updateSignature(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid signature ID", http.StatusBadRequest)
		return
	}

	var req SignatureRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// If this signature is set as default, unset other defaults first
	if req.IsDefault {
		_, err := s.db.Exec(`
			UPDATE mail_signatures SET is_default = FALSE WHERE owner_email = ? AND id != ?
		`, session.Email, id)
		if err != nil {
			log.Error().Err(err).Msg("Failed to unset default signature")
		}
	}

	result, err := s.db.Exec(`
		UPDATE mail_signatures
		SET name = ?, content_html = ?, content_text = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND owner_email = ?
	`, req.Name, req.ContentHTML, req.ContentText, req.IsDefault, id, session.Email)

	if err != nil {
		log.Error().Err(err).Msg("Failed to update signature")
		http.Error(w, "Failed to update signature", http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Signature not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Signature updated"})
}

// deleteSignature deletes a signature
func (s *Server) deleteSignature(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid signature ID", http.StatusBadRequest)
		return
	}

	result, err := s.db.Exec(`
		DELETE FROM mail_signatures WHERE id = ? AND owner_email = ?
	`, id, session.Email)

	if err != nil {
		log.Error().Err(err).Msg("Failed to delete signature")
		http.Error(w, "Failed to delete signature", http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Signature not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Signature deleted"})
}

// setDefaultSignature sets a signature as the default
func (s *Server) setDefaultSignature(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid signature ID", http.StatusBadRequest)
		return
	}

	// Start a transaction
	tx, err := s.db.Begin()
	if err != nil {
		log.Error().Err(err).Msg("Failed to begin transaction")
		http.Error(w, "Failed to set default", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback()

	// Unset all defaults for this user
	_, err = tx.Exec(`
		UPDATE mail_signatures SET is_default = FALSE WHERE owner_email = ?
	`, session.Email)
	if err != nil {
		log.Error().Err(err).Msg("Failed to unset defaults")
		http.Error(w, "Failed to set default", http.StatusInternalServerError)
		return
	}

	// Set the new default
	result, err := tx.Exec(`
		UPDATE mail_signatures SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND owner_email = ?
	`, id, session.Email)
	if err != nil {
		log.Error().Err(err).Msg("Failed to set default")
		http.Error(w, "Failed to set default", http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Signature not found", http.StatusNotFound)
		return
	}

	if err := tx.Commit(); err != nil {
		log.Error().Err(err).Msg("Failed to commit transaction")
		http.Error(w, "Failed to set default", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Default signature updated"})
}

// getDefaultSignature returns the default signature for the user
func (s *Server) getDefaultSignature(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	var sig Signature
	err := s.db.QueryRow(`
		SELECT id, name, content_html, content_text, is_default, created_at, updated_at
		FROM mail_signatures
		WHERE owner_email = ? AND is_default = TRUE
		LIMIT 1
	`, session.Email).Scan(&sig.ID, &sig.Name, &sig.ContentHTML, &sig.ContentText, &sig.IsDefault, &sig.CreatedAt, &sig.UpdatedAt)

	if err == sql.ErrNoRows {
		// No default signature, return empty response
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(nil)
		return
	}
	if err != nil {
		log.Error().Err(err).Msg("Failed to query default signature")
		http.Error(w, "Failed to load signature", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sig)
}
