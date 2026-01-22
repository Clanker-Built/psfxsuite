package api

import (
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"
	"golang.org/x/crypto/bcrypt"
)

// Domain represents a mail domain
type Domain struct {
	ID           int64     `json:"id"`
	Domain       string    `json:"domain"`
	Description  string    `json:"description"`
	MaxMailboxes int       `json:"maxMailboxes"`
	MaxAliases   int       `json:"maxAliases"`
	QuotaBytes   int64     `json:"quotaBytes"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"createdAt"`
	CreatedBy    *int64    `json:"createdBy,omitempty"`
	UpdatedAt    time.Time `json:"updatedAt"`
	// Computed fields
	MailboxCount int `json:"mailboxCount"`
	AliasCount   int `json:"aliasCount"`
}

// Mailbox represents a user mailbox
type Mailbox struct {
	ID           int64      `json:"id"`
	Email        string     `json:"email"`
	LocalPart    string     `json:"localPart"`
	DomainID     int64      `json:"domainId"`
	Domain       string     `json:"domain,omitempty"`
	DisplayName  string     `json:"displayName"`
	QuotaBytes   int64      `json:"quotaBytes"`
	Active       bool       `json:"active"`
	LastLogin    *time.Time `json:"lastLogin"`
	CreatedAt    time.Time  `json:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt"`
	// Computed fields
	UsedBytes int64 `json:"usedBytes"`
}

// Alias represents an email alias
type Alias struct {
	ID               int64     `json:"id"`
	SourceEmail      string    `json:"sourceEmail"`
	DestinationEmail string    `json:"destinationEmail"`
	DomainID         int64     `json:"domainId"`
	Domain           string    `json:"domain,omitempty"`
	Active           bool      `json:"active"`
	CreatedAt        time.Time `json:"createdAt"`
}

// Domain handlers

func (s *Server) listDomains(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`
		SELECT
			d.id, d.domain, d.description, d.max_mailboxes, d.max_aliases,
			d.quota_bytes, d.active, d.created_at, d.created_by, d.updated_at,
			(SELECT COUNT(*) FROM mailboxes WHERE domain_id = d.id) as mailbox_count,
			(SELECT COUNT(*) FROM mail_aliases WHERE domain_id = d.id) as alias_count
		FROM mail_domains d
		ORDER BY d.domain ASC
	`)
	if err != nil {
		log.Error().Err(err).Msg("Failed to query domains")
		http.Error(w, "Failed to query domains", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var domains []Domain
	for rows.Next() {
		var d Domain
		var description, createdBy *string
		err := rows.Scan(
			&d.ID, &d.Domain, &description, &d.MaxMailboxes, &d.MaxAliases,
			&d.QuotaBytes, &d.Active, &d.CreatedAt, &createdBy, &d.UpdatedAt,
			&d.MailboxCount, &d.AliasCount,
		)
		if err != nil {
			log.Error().Err(err).Msg("Failed to scan domain row")
			continue
		}
		if description != nil {
			d.Description = *description
		}
		domains = append(domains, d)
	}

	if domains == nil {
		domains = []Domain{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(domains)
}

type createDomainRequest struct {
	Domain       string `json:"domain"`
	Description  string `json:"description"`
	MaxMailboxes int    `json:"maxMailboxes"`
	MaxAliases   int    `json:"maxAliases"`
	QuotaBytes   int64  `json:"quotaBytes"`
}

func (s *Server) createDomain(w http.ResponseWriter, r *http.Request) {
	var req createDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate domain
	req.Domain = strings.ToLower(strings.TrimSpace(req.Domain))
	if req.Domain == "" {
		http.Error(w, "Domain is required", http.StatusBadRequest)
		return
	}

	user := GetUser(r.Context())

	result, err := s.db.Exec(`
		INSERT INTO mail_domains (domain, description, max_mailboxes, max_aliases, quota_bytes, created_by)
		VALUES (?, ?, ?, ?, ?, ?)
	`, req.Domain, req.Description, req.MaxMailboxes, req.MaxAliases, req.QuotaBytes, user.ID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			http.Error(w, "Domain already exists", http.StatusConflict)
			return
		}
		log.Error().Err(err).Msg("Failed to create domain")
		http.Error(w, "Failed to create domain", http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()

	// Audit log
	s.auditLog(user.ID, user.Username, "create", "mail_domain", strconv.FormatInt(id, 10), "Created mail domain: "+req.Domain, "success", "", r)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      id,
		"domain":  req.Domain,
		"message": "Domain created successfully",
	})
}

func (s *Server) getDomain(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var d Domain
	var description *string
	err := s.db.QueryRow(`
		SELECT id, domain, description, max_mailboxes, max_aliases, quota_bytes, active, created_at, updated_at
		FROM mail_domains WHERE id = ?
	`, id).Scan(&d.ID, &d.Domain, &description, &d.MaxMailboxes, &d.MaxAliases, &d.QuotaBytes, &d.Active, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusNotFound)
		return
	}

	if description != nil {
		d.Description = *description
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(d)
}

type updateDomainRequest struct {
	Description  string `json:"description"`
	MaxMailboxes int    `json:"maxMailboxes"`
	MaxAliases   int    `json:"maxAliases"`
	QuotaBytes   int64  `json:"quotaBytes"`
	Active       *bool  `json:"active"`
}

func (s *Server) updateDomain(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user := GetUser(r.Context())

	var req updateDomainRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	query := `UPDATE mail_domains SET description = ?, max_mailboxes = ?, max_aliases = ?, quota_bytes = ?, updated_at = CURRENT_TIMESTAMP`
	args := []interface{}{req.Description, req.MaxMailboxes, req.MaxAliases, req.QuotaBytes}

	if req.Active != nil {
		query += ", active = ?"
		args = append(args, *req.Active)
	}
	query += " WHERE id = ?"
	args = append(args, id)

	_, err := s.db.Exec(query, args...)
	if err != nil {
		log.Error().Err(err).Msg("Failed to update domain")
		http.Error(w, "Failed to update domain", http.StatusInternalServerError)
		return
	}

	s.auditLog(user.ID, user.Username, "update", "mail_domain", id, "Updated mail domain", "success", "", r)

	// If active status changed, sync all mail configuration
	if req.Active != nil {
		go func() {
			if err := s.dovecotSyncer.SyncAll(); err != nil {
				log.Error().Err(err).Msg("Failed to sync mail configuration after domain update")
			}
		}()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Domain updated successfully"})
}

func (s *Server) deleteDomain(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user := GetUser(r.Context())

	// Check for existing mailboxes
	var count int
	s.db.QueryRow("SELECT COUNT(*) FROM mailboxes WHERE domain_id = ?", id).Scan(&count)
	if count > 0 {
		http.Error(w, "Cannot delete domain with existing mailboxes", http.StatusConflict)
		return
	}

	_, err := s.db.Exec("DELETE FROM mail_domains WHERE id = ?", id)
	if err != nil {
		log.Error().Err(err).Msg("Failed to delete domain")
		http.Error(w, "Failed to delete domain", http.StatusInternalServerError)
		return
	}

	s.auditLog(user.ID, user.Username, "delete", "mail_domain", id, "Deleted mail domain", "success", "", r)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Domain deleted successfully"})
}

// Mailbox handlers

func (s *Server) listMailboxes(w http.ResponseWriter, r *http.Request) {
	domainID := r.URL.Query().Get("domain_id")

	query := `
		SELECT
			m.id, m.email, m.local_part, m.domain_id, d.domain, m.display_name,
			m.quota_bytes, m.active, m.last_login, m.created_at, m.updated_at,
			COALESCE(q.bytes_used, 0) as bytes_used
		FROM mailboxes m
		JOIN mail_domains d ON m.domain_id = d.id
		LEFT JOIN mailbox_quota q ON m.id = q.mailbox_id
	`
	var args []interface{}
	if domainID != "" {
		query += " WHERE m.domain_id = ?"
		args = append(args, domainID)
	}
	query += " ORDER BY m.email ASC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		log.Error().Err(err).Msg("Failed to query mailboxes")
		http.Error(w, "Failed to query mailboxes", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var mailboxes []Mailbox
	for rows.Next() {
		var m Mailbox
		var displayName *string
		var lastLogin *time.Time
		err := rows.Scan(
			&m.ID, &m.Email, &m.LocalPart, &m.DomainID, &m.Domain, &displayName,
			&m.QuotaBytes, &m.Active, &lastLogin, &m.CreatedAt, &m.UpdatedAt,
			&m.UsedBytes,
		)
		if err != nil {
			log.Error().Err(err).Msg("Failed to scan mailbox row")
			continue
		}
		if displayName != nil {
			m.DisplayName = *displayName
		}
		m.LastLogin = lastLogin
		mailboxes = append(mailboxes, m)
	}

	if mailboxes == nil {
		mailboxes = []Mailbox{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(mailboxes)
}

type createMailboxRequest struct {
	LocalPart   string `json:"localPart"`
	DomainID    int64  `json:"domainId"`
	Password    string `json:"password"`
	DisplayName string `json:"displayName"`
	QuotaBytes  int64  `json:"quotaBytes"`
}

func (s *Server) createMailbox(w http.ResponseWriter, r *http.Request) {
	user := GetUser(r.Context())
	var req createMailboxRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Get domain
	var domain string
	err := s.db.QueryRow("SELECT domain FROM mail_domains WHERE id = ?", req.DomainID).Scan(&domain)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusBadRequest)
		return
	}

	// Construct email
	req.LocalPart = strings.ToLower(strings.TrimSpace(req.LocalPart))
	email := req.LocalPart + "@" + domain

	// Hash password
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Failed to hash password", http.StatusInternalServerError)
		return
	}

	// Default quota: 1GB
	if req.QuotaBytes <= 0 {
		req.QuotaBytes = 1073741824
	}

	result, err := s.db.Exec(`
		INSERT INTO mailboxes (email, local_part, domain_id, password_hash, display_name, quota_bytes)
		VALUES (?, ?, ?, ?, ?, ?)
	`, email, req.LocalPart, req.DomainID, string(hash), req.DisplayName, req.QuotaBytes)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			http.Error(w, "Mailbox already exists", http.StatusConflict)
			return
		}
		log.Error().Err(err).Msg("Failed to create mailbox")
		http.Error(w, "Failed to create mailbox", http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()

	// Create quota entry
	s.db.Exec("INSERT INTO mailbox_quota (mailbox_id) VALUES (?)", id)

	s.auditLog(user.ID, user.Username, "create", "mailbox", strconv.FormatInt(id, 10), "Created mailbox: "+email, "success", "", r)

	// Sync Dovecot users and Postfix maps
	go func() {
		if err := s.dovecotSyncer.SyncAll(); err != nil {
			log.Error().Err(err).Msg("Failed to sync mail configuration after mailbox creation")
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      id,
		"email":   email,
		"message": "Mailbox created successfully",
	})
}

func (s *Server) getMailbox(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var m Mailbox
	var displayName *string
	var lastLogin *time.Time
	err := s.db.QueryRow(`
		SELECT m.id, m.email, m.local_part, m.domain_id, d.domain, m.display_name,
		       m.quota_bytes, m.active, m.last_login, m.created_at, m.updated_at
		FROM mailboxes m
		JOIN mail_domains d ON m.domain_id = d.id
		WHERE m.id = ?
	`, id).Scan(
		&m.ID, &m.Email, &m.LocalPart, &m.DomainID, &m.Domain, &displayName,
		&m.QuotaBytes, &m.Active, &lastLogin, &m.CreatedAt, &m.UpdatedAt,
	)
	if err != nil {
		http.Error(w, "Mailbox not found", http.StatusNotFound)
		return
	}

	if displayName != nil {
		m.DisplayName = *displayName
	}
	m.LastLogin = lastLogin

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(m)
}

func (s *Server) updateMailbox(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user := GetUser(r.Context())

	var req struct {
		DisplayName string `json:"displayName"`
		QuotaBytes  int64  `json:"quotaBytes"`
		Active      *bool  `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	query := "UPDATE mailboxes SET display_name = ?, quota_bytes = ?, updated_at = CURRENT_TIMESTAMP"
	args := []interface{}{req.DisplayName, req.QuotaBytes}
	if req.Active != nil {
		query += ", active = ?"
		args = append(args, *req.Active)
	}
	query += " WHERE id = ?"
	args = append(args, id)

	_, err := s.db.Exec(query, args...)
	if err != nil {
		log.Error().Err(err).Msg("Failed to update mailbox")
		http.Error(w, "Failed to update mailbox", http.StatusInternalServerError)
		return
	}

	s.auditLog(user.ID, user.Username, "update", "mailbox", id, "Updated mailbox", "success", "", r)

	// Sync Dovecot users (quota or active status may have changed)
	go func() {
		if err := s.dovecotSyncer.SyncDovecotUsers(); err != nil {
			log.Error().Err(err).Msg("Failed to sync Dovecot users after mailbox update")
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Mailbox updated successfully"})
}

func (s *Server) deleteMailbox(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user := GetUser(r.Context())

	var email string
	s.db.QueryRow("SELECT email FROM mailboxes WHERE id = ?", id).Scan(&email)

	_, err := s.db.Exec("DELETE FROM mailboxes WHERE id = ?", id)
	if err != nil {
		log.Error().Err(err).Msg("Failed to delete mailbox")
		http.Error(w, "Failed to delete mailbox", http.StatusInternalServerError)
		return
	}

	s.auditLog(user.ID, user.Username, "delete", "mailbox", id, "Deleted mailbox: "+email, "success", "", r)

	// Sync Dovecot users and Postfix maps
	go func() {
		if err := s.dovecotSyncer.SyncAll(); err != nil {
			log.Error().Err(err).Msg("Failed to sync mail configuration after mailbox deletion")
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Mailbox deleted successfully"})
}

func (s *Server) resetMailboxPassword(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user := GetUser(r.Context())

	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.Password) < 8 {
		http.Error(w, "Password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "Failed to hash password", http.StatusInternalServerError)
		return
	}

	_, err = s.db.Exec("UPDATE mailboxes SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", string(hash), id)
	if err != nil {
		log.Error().Err(err).Msg("Failed to reset password")
		http.Error(w, "Failed to reset password", http.StatusInternalServerError)
		return
	}

	s.auditLog(user.ID, user.Username, "password_reset", "mailbox", id, "Reset mailbox password", "success", "", r)

	// Sync Dovecot passwd file
	go func() {
		if err := s.dovecotSyncer.SyncDovecotUsers(); err != nil {
			log.Error().Err(err).Msg("Failed to sync Dovecot users after password reset")
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Password reset successfully"})
}

// Alias handlers

func (s *Server) listAliases(w http.ResponseWriter, r *http.Request) {
	domainID := r.URL.Query().Get("domain_id")

	query := `
		SELECT a.id, a.source_email, a.destination_email, a.domain_id, d.domain, a.active, a.created_at
		FROM mail_aliases a
		JOIN mail_domains d ON a.domain_id = d.id
	`
	var args []interface{}
	if domainID != "" {
		query += " WHERE a.domain_id = ?"
		args = append(args, domainID)
	}
	query += " ORDER BY a.source_email ASC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		log.Error().Err(err).Msg("Failed to query aliases")
		http.Error(w, "Failed to query aliases", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var aliases []Alias
	for rows.Next() {
		var a Alias
		err := rows.Scan(&a.ID, &a.SourceEmail, &a.DestinationEmail, &a.DomainID, &a.Domain, &a.Active, &a.CreatedAt)
		if err != nil {
			log.Error().Err(err).Msg("Failed to scan alias row")
			continue
		}
		aliases = append(aliases, a)
	}

	if aliases == nil {
		aliases = []Alias{}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(aliases)
}

type createAliasRequest struct {
	LocalPart        string `json:"localPart"`
	DomainID         int64  `json:"domainId"`
	DestinationEmail string `json:"destinationEmail"`
}

func (s *Server) createAlias(w http.ResponseWriter, r *http.Request) {
	user := GetUser(r.Context())
	var req createAliasRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Get domain
	var domain string
	err := s.db.QueryRow("SELECT domain FROM mail_domains WHERE id = ?", req.DomainID).Scan(&domain)
	if err != nil {
		http.Error(w, "Domain not found", http.StatusBadRequest)
		return
	}

	// Construct source email
	req.LocalPart = strings.ToLower(strings.TrimSpace(req.LocalPart))
	sourceEmail := req.LocalPart + "@" + domain
	req.DestinationEmail = strings.ToLower(strings.TrimSpace(req.DestinationEmail))

	result, err := s.db.Exec(`
		INSERT INTO mail_aliases (source_email, destination_email, domain_id)
		VALUES (?, ?, ?)
	`, sourceEmail, req.DestinationEmail, req.DomainID)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			http.Error(w, "Alias already exists", http.StatusConflict)
			return
		}
		log.Error().Err(err).Msg("Failed to create alias")
		http.Error(w, "Failed to create alias", http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()

	s.auditLog(user.ID, user.Username, "create", "mail_alias", strconv.FormatInt(id, 10),
		"Created alias: "+sourceEmail+" -> "+req.DestinationEmail, "success", "", r)

	// Sync Postfix virtual alias map
	go func() {
		if err := s.dovecotSyncer.SyncPostfixMaps(); err != nil {
			log.Error().Err(err).Msg("Failed to sync Postfix maps after alias creation")
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      id,
		"source":  sourceEmail,
		"message": "Alias created successfully",
	})
}

func (s *Server) deleteAlias(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user := GetUser(r.Context())

	var source, dest string
	s.db.QueryRow("SELECT source_email, destination_email FROM mail_aliases WHERE id = ?", id).Scan(&source, &dest)

	_, err := s.db.Exec("DELETE FROM mail_aliases WHERE id = ?", id)
	if err != nil {
		log.Error().Err(err).Msg("Failed to delete alias")
		http.Error(w, "Failed to delete alias", http.StatusInternalServerError)
		return
	}

	s.auditLog(user.ID, user.Username, "delete", "mail_alias", id, "Deleted alias: "+source+" -> "+dest, "success", "", r)

	// Sync Postfix virtual alias map
	go func() {
		if err := s.dovecotSyncer.SyncPostfixMaps(); err != nil {
			log.Error().Err(err).Msg("Failed to sync Postfix maps after alias deletion")
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Alias deleted successfully"})
}

// Admin stats
func (s *Server) getAdminStats(w http.ResponseWriter, r *http.Request) {
	var stats struct {
		Domains       int   `json:"domains"`
		Mailboxes     int   `json:"mailboxes"`
		Aliases       int   `json:"aliases"`
		TotalQuota    int64 `json:"totalQuota"`
		UsedQuota     int64 `json:"usedQuota"`
		ActiveDomains int   `json:"activeDomains"`
	}

	s.db.QueryRow("SELECT COUNT(*) FROM mail_domains").Scan(&stats.Domains)
	s.db.QueryRow("SELECT COUNT(*) FROM mail_domains WHERE active = TRUE").Scan(&stats.ActiveDomains)
	s.db.QueryRow("SELECT COUNT(*) FROM mailboxes").Scan(&stats.Mailboxes)
	s.db.QueryRow("SELECT COUNT(*) FROM mail_aliases").Scan(&stats.Aliases)
	s.db.QueryRow("SELECT COALESCE(SUM(quota_bytes), 0) FROM mailboxes").Scan(&stats.TotalQuota)
	s.db.QueryRow("SELECT COALESCE(SUM(bytes_used), 0) FROM mailbox_quota").Scan(&stats.UsedQuota)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}

// triggerMailSync manually triggers Dovecot/Postfix configuration sync
func (s *Server) triggerMailSync(w http.ResponseWriter, r *http.Request) {
	user := GetUser(r.Context())
	log.Info().Str("user", user.Username).Msg("Manual mail sync triggered")

	// Run sync synchronously so we can report errors
	if err := s.dovecotSyncer.SyncAll(); err != nil {
		log.Error().Err(err).Msg("Mail sync failed")
		s.auditLog(user.ID, user.Username, "sync", "mail_config", "", "Manual sync failed: "+err.Error(), "failed", "", r)
		http.Error(w, "Sync failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	s.auditLog(user.ID, user.Username, "sync", "mail_config", "", "Manual sync completed successfully", "success", "", r)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"message": "Mail configuration synced successfully",
	})
}

// getMailSyncStatus returns the current state of mail configuration files
func (s *Server) getMailSyncStatus(w http.ResponseWriter, r *http.Request) {
	// Read Dovecot users file
	dovecotUsersContent := ""
	if data, err := os.ReadFile("/etc/dovecot/users"); err == nil {
		dovecotUsersContent = string(data)
	} else {
		dovecotUsersContent = "Error reading file: " + err.Error()
	}

	// Read Postfix vmailbox file
	postfixVmailboxContent := ""
	if data, err := os.ReadFile("/etc/postfix/vmailbox"); err == nil {
		postfixVmailboxContent = string(data)
	} else {
		postfixVmailboxContent = "Error reading file: " + err.Error()
	}

	// Get mailbox count from database
	var dbMailboxCount int
	s.db.QueryRow("SELECT COUNT(*) FROM mailboxes WHERE active = TRUE").Scan(&dbMailboxCount)

	// Get domain count
	var dbDomainCount int
	s.db.QueryRow("SELECT COUNT(*) FROM mail_domains WHERE active = TRUE").Scan(&dbDomainCount)

	// List mailboxes from DB for comparison
	rows, _ := s.db.Query(`
		SELECT m.email, d.domain
		FROM mailboxes m
		JOIN mail_domains d ON m.domain_id = d.id
		WHERE m.active = TRUE AND d.active = TRUE
	`)
	var mailboxes []string
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var email, domain string
			rows.Scan(&email, &domain)
			mailboxes = append(mailboxes, email)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"dovecotUsersFile":    dovecotUsersContent,
		"postfixVmailboxFile": postfixVmailboxContent,
		"database": map[string]interface{}{
			"activeMailboxes": dbMailboxCount,
			"activeDomains":   dbDomainCount,
			"mailboxList":     mailboxes,
		},
	})
}
