package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
)

// Contact represents a mail contact
type Contact struct {
	ID        int64     `json:"id"`
	Email     string    `json:"email"`
	Name      string    `json:"name,omitempty"`
	Company   string    `json:"company,omitempty"`
	Phone     string    `json:"phone,omitempty"`
	Notes     string    `json:"notes,omitempty"`
	Favorite  bool      `json:"favorite"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// ContactRequest represents a create/update contact request
type ContactRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Company  string `json:"company"`
	Phone    string `json:"phone"`
	Notes    string `json:"notes"`
	Favorite bool   `json:"favorite"`
}

// listContacts returns all contacts for the logged-in mail user
func (s *Server) listContacts(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	query := `
		SELECT id, email, name, company, phone, notes, favorite, created_at, updated_at
		FROM mail_contacts
		WHERE owner_email = ?
		ORDER BY favorite DESC, name ASC, email ASC
	`

	rows, err := s.db.Query(query, session.Email)
	if err != nil {
		log.Error().Err(err).Msg("Failed to query contacts")
		http.Error(w, "Failed to load contacts", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	contacts := make([]Contact, 0)
	for rows.Next() {
		var c Contact
		var name, company, phone, notes sql.NullString
		if err := rows.Scan(&c.ID, &c.Email, &name, &company, &phone, &notes, &c.Favorite, &c.CreatedAt, &c.UpdatedAt); err != nil {
			log.Error().Err(err).Msg("Failed to scan contact")
			continue
		}
		c.Name = name.String
		c.Company = company.String
		c.Phone = phone.String
		c.Notes = notes.String
		contacts = append(contacts, c)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(contacts)
}

// createContact creates a new contact
func (s *Server) createContact(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	var req ContactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Email == "" {
		http.Error(w, "Email is required", http.StatusBadRequest)
		return
	}

	result, err := s.db.Exec(`
		INSERT INTO mail_contacts (owner_email, email, name, company, phone, notes, favorite)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, session.Email, req.Email, req.Name, req.Company, req.Phone, req.Notes, req.Favorite)

	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			http.Error(w, "Contact with this email already exists", http.StatusConflict)
			return
		}
		log.Error().Err(err).Msg("Failed to create contact")
		http.Error(w, "Failed to create contact", http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      id,
		"message": "Contact created",
	})
}

// getContact retrieves a single contact
func (s *Server) getContact(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid contact ID", http.StatusBadRequest)
		return
	}

	var c Contact
	var name, company, phone, notes sql.NullString
	err = s.db.QueryRow(`
		SELECT id, email, name, company, phone, notes, favorite, created_at, updated_at
		FROM mail_contacts
		WHERE id = ? AND owner_email = ?
	`, id, session.Email).Scan(&c.ID, &c.Email, &name, &company, &phone, &notes, &c.Favorite, &c.CreatedAt, &c.UpdatedAt)

	if err == sql.ErrNoRows {
		http.Error(w, "Contact not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Error().Err(err).Msg("Failed to query contact")
		http.Error(w, "Failed to load contact", http.StatusInternalServerError)
		return
	}

	c.Name = name.String
	c.Company = company.String
	c.Phone = phone.String
	c.Notes = notes.String

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(c)
}

// updateContact updates an existing contact
func (s *Server) updateContact(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid contact ID", http.StatusBadRequest)
		return
	}

	var req ContactRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	result, err := s.db.Exec(`
		UPDATE mail_contacts
		SET email = ?, name = ?, company = ?, phone = ?, notes = ?, favorite = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND owner_email = ?
	`, req.Email, req.Name, req.Company, req.Phone, req.Notes, req.Favorite, id, session.Email)

	if err != nil {
		log.Error().Err(err).Msg("Failed to update contact")
		http.Error(w, "Failed to update contact", http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Contact not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Contact updated"})
}

// deleteContact deletes a contact
func (s *Server) deleteContact(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid contact ID", http.StatusBadRequest)
		return
	}

	result, err := s.db.Exec(`
		DELETE FROM mail_contacts WHERE id = ? AND owner_email = ?
	`, id, session.Email)

	if err != nil {
		log.Error().Err(err).Msg("Failed to delete contact")
		http.Error(w, "Failed to delete contact", http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Contact not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Contact deleted"})
}

// searchContacts searches contacts for autocomplete
func (s *Server) searchContacts(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	q := r.URL.Query().Get("q")
	if q == "" || len(q) < 2 {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]Contact{})
		return
	}

	searchPattern := "%" + q + "%"

	rows, err := s.db.Query(`
		SELECT id, email, name, company, phone, notes, favorite, created_at, updated_at
		FROM mail_contacts
		WHERE owner_email = ? AND (email LIKE ? OR name LIKE ? OR company LIKE ?)
		ORDER BY favorite DESC, name ASC
		LIMIT 10
	`, session.Email, searchPattern, searchPattern, searchPattern)

	if err != nil {
		log.Error().Err(err).Msg("Failed to search contacts")
		http.Error(w, "Search failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	contacts := make([]Contact, 0)
	for rows.Next() {
		var c Contact
		var name, company, phone, notes sql.NullString
		if err := rows.Scan(&c.ID, &c.Email, &name, &company, &phone, &notes, &c.Favorite, &c.CreatedAt, &c.UpdatedAt); err != nil {
			log.Error().Err(err).Msg("Failed to scan contact")
			continue
		}
		c.Name = name.String
		c.Company = company.String
		c.Phone = phone.String
		c.Notes = notes.String
		contacts = append(contacts, c)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(contacts)
}

// toggleContactFavorite toggles the favorite status of a contact
func (s *Server) toggleContactFavorite(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		http.Error(w, "Invalid contact ID", http.StatusBadRequest)
		return
	}

	result, err := s.db.Exec(`
		UPDATE mail_contacts
		SET favorite = NOT favorite, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND owner_email = ?
	`, id, session.Email)

	if err != nil {
		log.Error().Err(err).Msg("Failed to toggle favorite")
		http.Error(w, "Failed to toggle favorite", http.StatusInternalServerError)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		http.Error(w, "Contact not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Favorite toggled"})
}
