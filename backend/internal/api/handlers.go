package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/postfixrelay/postfixrelay/internal/alerts"
	"github.com/postfixrelay/postfixrelay/internal/logs"
	"github.com/postfixrelay/postfixrelay/internal/postfix"
	"golang.org/x/crypto/bcrypt"
)

// postfixMgr is initialized in server.go
var postfixMgr *postfix.ConfigManager

// alertEngine is the alert detection engine
var alertEngine *alerts.Engine

// Setup handlers - for initial admin user creation

// getSetupStatus returns whether initial setup is needed
func (s *Server) getSetupStatus(w http.ResponseWriter, r *http.Request) {
	var adminCount int
	err := s.db.QueryRow("SELECT COUNT(*) FROM users WHERE role = 'admin'").Scan(&adminCount)
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"setupRequired": adminCount == 0,
	})
}

// completeSetup creates the first admin user
func (s *Server) completeSetup(w http.ResponseWriter, r *http.Request) {
	// Check if setup is already complete
	var adminCount int
	err := s.db.QueryRow("SELECT COUNT(*) FROM users WHERE role = 'admin'").Scan(&adminCount)
	if err != nil {
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	if adminCount > 0 {
		http.Error(w, "setup already completed", http.StatusForbidden)
		return
	}

	// Parse request
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Validate input
	v := NewValidator()
	if req.Username == "" {
		v.AddError("username", "username is required")
	} else if len(req.Username) < 3 {
		v.AddError("username", "username must be at least 3 characters")
	}
	v.ValidateEmail("email", req.Email)
	if req.Password == "" {
		v.AddError("password", "password is required")
	} else if len(req.Password) < 12 {
		v.AddError("password", "password must be at least 12 characters")
	}

	if v.HasErrors() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"errors": v.Errors(),
		})
		return
	}

	// Hash password
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		http.Error(w, "failed to hash password", http.StatusInternalServerError)
		return
	}

	// Create admin user
	result, err := s.db.Exec(`
		INSERT INTO users (username, email, password_hash, role, must_change_password, created_at)
		VALUES (?, ?, ?, 'admin', FALSE, datetime('now'))
	`, req.Username, req.Email, string(passwordHash))
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			http.Error(w, "username or email already exists", http.StatusConflict)
			return
		}
		http.Error(w, "failed to create user", http.StatusInternalServerError)
		return
	}

	userID, _ := result.(interface{ LastInsertId() (int64, error) }).LastInsertId()

	// Log audit entry
	s.logAudit(userID, req.Username, "setup_complete", "user", fmt.Sprintf("%d", userID),
		"Initial setup completed - admin user created", "success", r.RemoteAddr)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Setup completed successfully. You can now log in.",
		"user": map[string]interface{}{
			"id":       userID,
			"username": req.Username,
			"email":    req.Email,
			"role":     "admin",
		},
	})
}

// Config handlers

func (s *Server) getConfig(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	config, err := postfixMgr.ReadConfig()
	if err != nil {
		http.Error(w, "failed to read config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"config": config,
	})
}

func (s *Server) getConfigFull(w http.ResponseWriter, r *http.Request) {
	// Returns raw config parameters (admin only)
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	config, err := postfixMgr.ReadConfig()
	if err != nil {
		http.Error(w, "failed to read config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Flatten to key-value pairs for full view
	params := []map[string]interface{}{}

	// Add general params
	addParam := func(key, value, category string) {
		if value != "" {
			params = append(params, map[string]interface{}{
				"key":      key,
				"value":    value,
				"category": category,
			})
		}
	}

	addParam("myhostname", config.General.Myhostname, "general")
	addParam("mydomain", config.General.Mydomain, "general")
	addParam("myorigin", config.General.Myorigin, "general")
	addParam("inet_interfaces", config.General.InetInterfaces, "general")
	addParam("inet_protocols", config.General.InetProtocols, "general")
	addParam("relayhost", config.Relay.Relayhost, "relay")
	addParam("mynetworks", config.Relay.Mynetworks, "relay")
	addParam("relay_domains", config.Relay.RelayDomains, "relay")
	addParam("smtp_tls_security_level", config.TLS.SMTPTLSSecurityLevel, "tls")
	addParam("smtpd_tls_security_level", config.TLS.SMTPDTLSSecurityLevel, "tls")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"parameters": params,
	})
}

func (s *Server) updateConfig(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	var req struct {
		Config struct {
			General      *postfix.GeneralConfig      `json:"general,omitempty"`
			Relay        *postfix.RelayConfig        `json:"relay,omitempty"`
			TLS          *postfix.TLSConfig          `json:"tls,omitempty"`
			SASL         *postfix.SASLConfig         `json:"sasl,omitempty"`
			Restrictions *postfix.RestrictionsConfig `json:"restrictions,omitempty"`
		} `json:"config"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	// Validate input
	v := NewValidator()

	if g := req.Config.General; g != nil {
		v.ValidateHostname("myhostname", g.Myhostname)
		v.ValidateDomain("mydomain", g.Mydomain)
		v.ValidateDomain("myorigin", g.Myorigin)
	}

	if rl := req.Config.Relay; rl != nil {
		v.ValidateRelayhost("relayhost", rl.Relayhost)
		v.ValidateCIDR("mynetworks", rl.Mynetworks)
	}

	if t := req.Config.TLS; t != nil {
		v.ValidateTLSLevel("smtp_tls_security_level", t.SMTPTLSSecurityLevel)
		v.ValidateTLSLevel("smtpd_tls_security_level", t.SMTPDTLSSecurityLevel)
	}

	if v.HasErrors() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"errors": v.Errors(),
		})
		return
	}

	// Build updates map
	updates := make(map[string]string)

	if g := req.Config.General; g != nil {
		updates["myhostname"] = g.Myhostname
		updates["mydomain"] = g.Mydomain
		updates["myorigin"] = g.Myorigin
		updates["inet_interfaces"] = g.InetInterfaces
		updates["inet_protocols"] = g.InetProtocols
	}

	if r := req.Config.Relay; r != nil {
		updates["relayhost"] = r.Relayhost
		updates["mynetworks"] = r.Mynetworks
		updates["relay_domains"] = r.RelayDomains
	}

	if t := req.Config.TLS; t != nil {
		updates["smtp_tls_security_level"] = t.SMTPTLSSecurityLevel
		updates["smtpd_tls_security_level"] = t.SMTPDTLSSecurityLevel
		updates["smtp_tls_cert_file"] = t.SMTPTLSCertFile
		updates["smtp_tls_key_file"] = t.SMTPTLSKeyFile
		updates["smtpd_tls_cert_file"] = t.SMTPDTLSCertFile
		updates["smtpd_tls_key_file"] = t.SMTPDTLSKeyFile
		updates["smtp_tls_CAfile"] = t.SMTPTLSCAFile
		updates["smtp_tls_loglevel"] = t.SMTPTLSLoglevel
	}

	if s := req.Config.SASL; s != nil {
		updates["smtp_sasl_auth_enable"] = s.SMTPSASLAuthEnable
		updates["smtp_sasl_password_maps"] = s.SMTPSASLPasswordMaps
		updates["smtp_sasl_security_options"] = s.SMTPSASLSecurityOptions
		updates["smtp_sasl_tls_security_options"] = s.SMTPSASLTLSSecurityOptions
	}

	if re := req.Config.Restrictions; re != nil {
		updates["smtpd_relay_restrictions"] = re.SMTPDRelayRestrictions
		updates["smtpd_recipient_restrictions"] = re.SMTPDRecipientRestrictions
		updates["smtpd_sender_restrictions"] = re.SMTPDSenderRestrictions
	}

	if err := postfixMgr.UpdateConfig(updates); err != nil {
		http.Error(w, "failed to update config: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit entry
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "config_update", "config", "", "Updated configuration", "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) validateConfig(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	valid, errors := postfixMgr.Validate()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid":  valid,
		"errors": errors,
	})
}

func (s *Server) applyConfig(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	user := GetUser(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Check if there are staged changes to apply
	var stagedCount int
	err := s.db.QueryRow("SELECT COUNT(*) FROM staged_config").Scan(&stagedCount)
	if err != nil {
		http.Error(w, "failed to check staged config", http.StatusInternalServerError)
		return
	}

	if stagedCount == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "No staged changes to apply",
		})
		return
	}

	// Read current config
	currentConfig, err := postfixMgr.ReadConfig()
	if err != nil {
		http.Error(w, "failed to read current config", http.StatusInternalServerError)
		return
	}

	// Get staged changes and merge them
	rows, err := s.db.Query("SELECT key, value FROM staged_config")
	if err != nil {
		http.Error(w, "failed to query staged config", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	// Build updates map from staged changes
	updates := make(map[string]interface{})
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		updates[key] = value
	}

	// Merge staged changes into current config
	if v, ok := updates["myhostname"].(string); ok && v != "" {
		currentConfig.General.Myhostname = v
	}
	if v, ok := updates["mydomain"].(string); ok && v != "" {
		currentConfig.General.Mydomain = v
	}
	if v, ok := updates["myorigin"].(string); ok && v != "" {
		currentConfig.General.Myorigin = v
	}
	if v, ok := updates["inet_interfaces"].(string); ok && v != "" {
		currentConfig.General.InetInterfaces = v
	}
	if v, ok := updates["inet_protocols"].(string); ok && v != "" {
		currentConfig.General.InetProtocols = v
	}
	if v, ok := updates["relayhost"].(string); ok {
		currentConfig.Relay.Relayhost = v
	}
	if v, ok := updates["mynetworks"].(string); ok && v != "" {
		currentConfig.Relay.Mynetworks = v
	}
	if v, ok := updates["relay_domains"].(string); ok {
		currentConfig.Relay.RelayDomains = v
	}
	if v, ok := updates["smtp_tls_security_level"].(string); ok && v != "" {
		currentConfig.TLS.SMTPTLSSecurityLevel = v
	}
	if v, ok := updates["smtpd_tls_security_level"].(string); ok && v != "" {
		currentConfig.TLS.SMTPDTLSSecurityLevel = v
	}
	if v, ok := updates["smtp_tls_cert_file"].(string); ok {
		currentConfig.TLS.SMTPTLSCertFile = v
	}
	if v, ok := updates["smtp_tls_key_file"].(string); ok {
		currentConfig.TLS.SMTPTLSKeyFile = v
	}
	if v, ok := updates["smtpd_tls_cert_file"].(string); ok {
		currentConfig.TLS.SMTPDTLSCertFile = v
	}
	if v, ok := updates["smtpd_tls_key_file"].(string); ok {
		currentConfig.TLS.SMTPDTLSKeyFile = v
	}
	if v, ok := updates["smtp_tls_CAfile"].(string); ok {
		currentConfig.TLS.SMTPTLSCAFile = v
	}
	if v, ok := updates["smtp_tls_loglevel"].(string); ok {
		currentConfig.TLS.SMTPTLSLoglevel = v
	}
	if v, ok := updates["smtp_sasl_auth_enable"].(string); ok {
		currentConfig.SASL.SMTPSASLAuthEnable = v
	}
	if v, ok := updates["smtp_sasl_password_maps"].(string); ok {
		currentConfig.SASL.SMTPSASLPasswordMaps = v
	}
	if v, ok := updates["smtp_sasl_security_options"].(string); ok {
		currentConfig.SASL.SMTPSASLSecurityOptions = v
	}
	if v, ok := updates["smtp_sasl_tls_security_options"].(string); ok {
		currentConfig.SASL.SMTPSASLTLSSecurityOptions = v
	}
	if v, ok := updates["smtpd_relay_restrictions"].(string); ok {
		currentConfig.Restrictions.SMTPDRelayRestrictions = v
	}
	if v, ok := updates["smtpd_recipient_restrictions"].(string); ok {
		currentConfig.Restrictions.SMTPDRecipientRestrictions = v
	}
	if v, ok := updates["smtpd_sender_restrictions"].(string); ok {
		currentConfig.Restrictions.SMTPDSenderRestrictions = v
	}

	// Write merged config to filesystem
	if err := postfixMgr.WriteConfig(currentConfig); err != nil {
		s.logAudit(user.ID, user.Username, "config_apply", "config", "", "Failed to write config: "+err.Error(), "failed", r.RemoteAddr)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Failed to write configuration: " + err.Error(),
		})
		return
	}

	// Validate written config
	valid, validationErrors := postfixMgr.Validate()
	if !valid {
		s.logAudit(user.ID, user.Username, "config_apply", "config", "", "Config validation failed: "+validationErrors[0], "failed", r.RemoteAddr)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Configuration validation failed: " + validationErrors[0],
		})
		return
	}

	// Reload Postfix
	if err := postfixMgr.Reload(); err != nil {
		s.logAudit(user.ID, user.Username, "config_apply", "config", "", "Failed to reload Postfix: "+err.Error(), "failed", r.RemoteAddr)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Failed to reload Postfix: " + err.Error(),
		})
		return
	}

	// Clear staged config on successful apply
	_, err = s.db.Exec("DELETE FROM staged_config")
	if err != nil {
		// Log but don't fail - config was applied successfully
		s.logAudit(user.ID, user.Username, "config_apply", "config", "", "Warning: failed to clear staged config", "success", r.RemoteAddr)
	}

	// Record config version
	s.recordConfigVersion(user.ID, user.Username)
	s.logAudit(user.ID, user.Username, "config_apply", "config", "",
		fmt.Sprintf("Applied %d staged configuration changes", stagedCount), "success", r.RemoteAddr)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"message":      "Configuration applied successfully",
		"changesCount": stagedCount,
	})
}

// Staged config handlers for submit/apply workflow

type StagedConfigEntry struct {
	ID              int64  `json:"id"`
	Key             string `json:"key"`
	Value           string `json:"value"`
	Category        string `json:"category"`
	StagedByID      int64  `json:"stagedById"`
	StagedByUsername string `json:"stagedByUsername"`
	StagedAt        string `json:"stagedAt"`
}

func (s *Server) getStagedConfig(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`
		SELECT id, key, value, category, staged_by_id, staged_by_username, staged_at
		FROM staged_config
		ORDER BY category, key
	`)
	if err != nil {
		http.Error(w, "failed to query staged config", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	staged := make([]StagedConfigEntry, 0)
	for rows.Next() {
		var entry StagedConfigEntry
		if err := rows.Scan(&entry.ID, &entry.Key, &entry.Value, &entry.Category,
			&entry.StagedByID, &entry.StagedByUsername, &entry.StagedAt); err != nil {
			continue
		}
		staged = append(staged, entry)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"staged": staged,
		"count":  len(staged),
	})
}

func (s *Server) submitConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Config struct {
			General      *postfix.GeneralConfig      `json:"general,omitempty"`
			Relay        *postfix.RelayConfig        `json:"relay,omitempty"`
			TLS          *postfix.TLSConfig          `json:"tls,omitempty"`
			SASL         *postfix.SASLConfig         `json:"sasl,omitempty"`
			Restrictions *postfix.RestrictionsConfig `json:"restrictions,omitempty"`
		} `json:"config"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	user := GetUser(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Validate input
	v := NewValidator()
	if g := req.Config.General; g != nil {
		v.ValidateHostname("myhostname", g.Myhostname)
		v.ValidateDomain("mydomain", g.Mydomain)
	}
	if rl := req.Config.Relay; rl != nil {
		v.ValidateRelayhost("relayhost", rl.Relayhost)
		v.ValidateCIDR("mynetworks", rl.Mynetworks)
	}
	if t := req.Config.TLS; t != nil {
		v.ValidateTLSLevel("smtp_tls_security_level", t.SMTPTLSSecurityLevel)
		v.ValidateTLSLevel("smtpd_tls_security_level", t.SMTPDTLSSecurityLevel)
	}

	if v.HasErrors() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"errors": v.Errors(),
		})
		return
	}

	// Stage config changes to database
	stageEntry := func(key, value, category string) error {
		_, err := s.db.Exec(`
			INSERT INTO staged_config (key, value, category, staged_by_id, staged_by_username, staged_at)
			VALUES (?, ?, ?, ?, ?, datetime('now'))
			ON CONFLICT(key) DO UPDATE SET
				value = excluded.value,
				category = excluded.category,
				staged_by_id = excluded.staged_by_id,
				staged_by_username = excluded.staged_by_username,
				staged_at = datetime('now')
		`, key, value, category, user.ID, user.Username)
		return err
	}

	if g := req.Config.General; g != nil {
		stageEntry("myhostname", g.Myhostname, "general")
		stageEntry("mydomain", g.Mydomain, "general")
		stageEntry("myorigin", g.Myorigin, "general")
		stageEntry("inet_interfaces", g.InetInterfaces, "general")
		stageEntry("inet_protocols", g.InetProtocols, "general")
	}

	if rl := req.Config.Relay; rl != nil {
		stageEntry("relayhost", rl.Relayhost, "relay")
		stageEntry("mynetworks", rl.Mynetworks, "relay")
		stageEntry("relay_domains", rl.RelayDomains, "relay")
	}

	if t := req.Config.TLS; t != nil {
		stageEntry("smtp_tls_security_level", t.SMTPTLSSecurityLevel, "tls")
		stageEntry("smtpd_tls_security_level", t.SMTPDTLSSecurityLevel, "tls")
		stageEntry("smtp_tls_cert_file", t.SMTPTLSCertFile, "tls")
		stageEntry("smtp_tls_key_file", t.SMTPTLSKeyFile, "tls")
		stageEntry("smtpd_tls_cert_file", t.SMTPDTLSCertFile, "tls")
		stageEntry("smtpd_tls_key_file", t.SMTPDTLSKeyFile, "tls")
		stageEntry("smtp_tls_CAfile", t.SMTPTLSCAFile, "tls")
		stageEntry("smtp_tls_loglevel", t.SMTPTLSLoglevel, "tls")
	}

	if sasl := req.Config.SASL; sasl != nil {
		stageEntry("smtp_sasl_auth_enable", sasl.SMTPSASLAuthEnable, "sasl")
		stageEntry("smtp_sasl_password_maps", sasl.SMTPSASLPasswordMaps, "sasl")
		stageEntry("smtp_sasl_security_options", sasl.SMTPSASLSecurityOptions, "sasl")
		stageEntry("smtp_sasl_tls_security_options", sasl.SMTPSASLTLSSecurityOptions, "sasl")
	}

	if re := req.Config.Restrictions; re != nil {
		stageEntry("smtpd_relay_restrictions", re.SMTPDRelayRestrictions, "restrictions")
		stageEntry("smtpd_recipient_restrictions", re.SMTPDRecipientRestrictions, "restrictions")
		stageEntry("smtpd_sender_restrictions", re.SMTPDSenderRestrictions, "restrictions")
	}

	s.logAudit(user.ID, user.Username, "config_submit", "config", "", "Staged configuration changes", "success", r.RemoteAddr)

	// Return current staged config
	s.getStagedConfig(w, r)
}

func (s *Server) discardStagedConfig(w http.ResponseWriter, r *http.Request) {
	user := GetUser(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Delete all staged config entries
	result, err := s.db.Exec("DELETE FROM staged_config")
	if err != nil {
		http.Error(w, "failed to discard staged config", http.StatusInternalServerError)
		return
	}

	affected, _ := result.RowsAffected()
	s.logAudit(user.ID, user.Username, "config_discard", "config", "",
		fmt.Sprintf("Discarded %d staged config entries", affected), "success", r.RemoteAddr)

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getStagedDiff(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	// Get current config
	currentConfig, err := postfixMgr.ReadConfig()
	if err != nil {
		http.Error(w, "failed to read current config", http.StatusInternalServerError)
		return
	}

	// Get staged changes
	rows, err := s.db.Query("SELECT key, value FROM staged_config")
	if err != nil {
		http.Error(w, "failed to query staged config", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	// Build current config map for comparison
	currentValues := make(map[string]string)
	currentValues["myhostname"] = currentConfig.General.Myhostname
	currentValues["mydomain"] = currentConfig.General.Mydomain
	currentValues["myorigin"] = currentConfig.General.Myorigin
	currentValues["relayhost"] = currentConfig.Relay.Relayhost
	currentValues["mynetworks"] = currentConfig.Relay.Mynetworks
	currentValues["smtp_tls_security_level"] = currentConfig.TLS.SMTPTLSSecurityLevel
	currentValues["smtpd_tls_security_level"] = currentConfig.TLS.SMTPDTLSSecurityLevel
	// Add more fields as needed...

	// Build diff
	type DiffEntry struct {
		Key      string `json:"key"`
		OldValue string `json:"oldValue"`
		NewValue string `json:"newValue"`
	}
	diff := make([]DiffEntry, 0)

	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		oldValue := currentValues[key]
		if oldValue != value {
			diff = append(diff, DiffEntry{
				Key:      key,
				OldValue: oldValue,
				NewValue: value,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"diff":        diff,
		"changeCount": len(diff),
	})
}

func (s *Server) rollbackConfig(w http.ResponseWriter, r *http.Request) {
	version := chi.URLParam(r, "version")
	versionNum, err := strconv.Atoi(version)
	if err != nil {
		http.Error(w, "invalid version number", http.StatusBadRequest)
		return
	}

	user := GetUser(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	// Get config content from version
	var configContent string
	var versionStatus string
	err = s.db.QueryRow(`
		SELECT config_content, status FROM config_versions WHERE version_number = ?
	`, versionNum).Scan(&configContent, &versionStatus)
	if err != nil {
		http.Error(w, "version not found", http.StatusNotFound)
		return
	}

	// Parse config content as JSON
	var savedConfig postfix.Config
	if err := json.Unmarshal([]byte(configContent), &savedConfig); err != nil {
		s.logAudit(user.ID, user.Username, "config_rollback", "config", version,
			"Failed to parse config: "+err.Error(), "failed", r.RemoteAddr)
		http.Error(w, "invalid config format in version", http.StatusInternalServerError)
		return
	}

	// Initialize postfix manager if needed
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	// Write the config to filesystem
	if err := postfixMgr.WriteConfig(&savedConfig); err != nil {
		s.logAudit(user.ID, user.Username, "config_rollback", "config", version,
			"Failed to write config: "+err.Error(), "failed", r.RemoteAddr)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Failed to write configuration: " + err.Error(),
		})
		return
	}

	// Validate the config
	valid, validationErrors := postfixMgr.Validate()
	if !valid {
		s.logAudit(user.ID, user.Username, "config_rollback", "config", version,
			"Config validation failed: "+validationErrors[0], "failed", r.RemoteAddr)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Configuration validation failed: " + validationErrors[0],
		})
		return
	}

	// Reload Postfix
	if err := postfixMgr.Reload(); err != nil {
		s.logAudit(user.ID, user.Username, "config_rollback", "config", version,
			"Failed to reload Postfix: "+err.Error(), "failed", r.RemoteAddr)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "Failed to reload Postfix: " + err.Error(),
		})
		return
	}

	// Update version statuses in a transaction
	tx, err := s.db.Begin()
	if err != nil {
		s.logAudit(user.ID, user.Username, "config_rollback", "config", version,
			"Failed to start transaction", "failed", r.RemoteAddr)
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	// Mark current applied version as rolled back
	_, err = tx.Exec(`
		UPDATE config_versions SET status = 'rolled_back'
		WHERE status = 'applied'
	`)
	if err != nil {
		tx.Rollback()
		http.Error(w, "failed to update version status", http.StatusInternalServerError)
		return
	}

	// Mark the target version as applied
	_, err = tx.Exec(`
		UPDATE config_versions
		SET status = 'applied', applied_at = datetime('now'), applied_by_id = ?
		WHERE version_number = ?
	`, user.ID, versionNum)
	if err != nil {
		tx.Rollback()
		http.Error(w, "failed to update version status", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(); err != nil {
		http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
		return
	}

	// Clear any staged config
	_, _ = s.db.Exec("DELETE FROM staged_config")

	s.logAudit(user.ID, user.Username, "config_rollback", "config", version,
		fmt.Sprintf("Rolled back to version %d", versionNum), "success", r.RemoteAddr)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": fmt.Sprintf("Successfully rolled back to version %d", versionNum),
	})
}

func (s *Server) getConfigHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`
		SELECT id, version_number, created_at, created_by_username, applied_at, status, notes
		FROM config_versions
		ORDER BY version_number DESC
		LIMIT 50
	`)
	if err != nil {
		http.Error(w, "failed to get history", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var versions []map[string]interface{}
	for rows.Next() {
		var id, versionNum int64
		var createdAt, createdBy, status string
		var appliedAt, notes *string

		if err := rows.Scan(&id, &versionNum, &createdAt, &createdBy, &appliedAt, &status, &notes); err != nil {
			continue
		}

		v := map[string]interface{}{
			"id":            id,
			"versionNumber": versionNum,
			"createdAt":     createdAt,
			"createdBy":     createdBy,
			"status":        status,
		}
		if appliedAt != nil {
			v["appliedAt"] = *appliedAt
		}
		if notes != nil {
			v["notes"] = *notes
		}
		versions = append(versions, v)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"versions": versions,
	})
}

func (s *Server) getConfigVersion(w http.ResponseWriter, r *http.Request) {
	version := chi.URLParam(r, "version")

	var configContent, createdAt, createdBy, status string
	err := s.db.QueryRow(`
		SELECT config_content, created_at, created_by_username, status
		FROM config_versions WHERE version_number = ?
	`, version).Scan(&configContent, &createdAt, &createdBy, &status)

	if err != nil {
		http.Error(w, "version not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"versionNumber": version,
		"configContent": configContent,
		"createdAt":     createdAt,
		"createdBy":     createdBy,
		"status":        status,
	})
}

// Certificate handlers

func (s *Server) getCertificates(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	certs, err := postfixMgr.GetCertificates()
	if err != nil {
		http.Error(w, "failed to get certificates: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"certificates": certs,
	})
}

func (s *Server) uploadCertificate(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	// Parse multipart form (max 10MB)
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "failed to parse form: "+err.Error(), http.StatusBadRequest)
		return
	}

	certType := r.FormValue("type")
	if certType != "smtp" && certType != "smtpd" {
		http.Error(w, "invalid certificate type", http.StatusBadRequest)
		return
	}

	// Read certificate file
	certFile, _, err := r.FormFile("cert")
	if err != nil {
		http.Error(w, "missing certificate file", http.StatusBadRequest)
		return
	}
	defer certFile.Close()
	certData, err := io.ReadAll(certFile)
	if err != nil {
		http.Error(w, "failed to read certificate", http.StatusBadRequest)
		return
	}

	// Read key file
	keyFile, _, err := r.FormFile("key")
	if err != nil {
		http.Error(w, "missing key file", http.StatusBadRequest)
		return
	}
	defer keyFile.Close()
	keyData, err := io.ReadAll(keyFile)
	if err != nil {
		http.Error(w, "failed to read key", http.StatusBadRequest)
		return
	}

	// Save certificate
	cert, err := postfixMgr.SaveCertificate(certType, certData, keyData)
	if err != nil {
		http.Error(w, "failed to save certificate: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "cert_upload", "certificate", certType, "Uploaded "+certType+" certificate", "success", r.RemoteAddr)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":     true,
		"certificate": cert,
	})
}

func (s *Server) deleteCertificate(w http.ResponseWriter, r *http.Request) {
	certType := chi.URLParam(r, "type")
	if certType != "smtp" && certType != "smtpd" {
		http.Error(w, "invalid certificate type", http.StatusBadRequest)
		return
	}

	user := GetUser(r.Context())
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	// Get current config to find certificate paths
	cfg, err := postfixMgr.ReadConfig()
	if err != nil {
		http.Error(w, "failed to read config", http.StatusInternalServerError)
		return
	}

	var certFile, keyFile string
	if certType == "smtp" {
		certFile = cfg.TLS.SMTPTLSCertFile
		keyFile = cfg.TLS.SMTPTLSKeyFile
	} else {
		certFile = cfg.TLS.SMTPDTLSCertFile
		keyFile = cfg.TLS.SMTPDTLSKeyFile
	}

	// Delete certificate files if they exist
	var deleteErrors []string
	if certFile != "" {
		if err := os.Remove(certFile); err != nil && !os.IsNotExist(err) {
			deleteErrors = append(deleteErrors, fmt.Sprintf("cert: %v", err))
		}
	}
	if keyFile != "" {
		if err := os.Remove(keyFile); err != nil && !os.IsNotExist(err) {
			deleteErrors = append(deleteErrors, fmt.Sprintf("key: %v", err))
		}
	}

	if len(deleteErrors) > 0 {
		s.logAudit(user.ID, user.Username, "certificate_delete", "certificate", certType,
			fmt.Sprintf("Partial deletion errors: %s", strings.Join(deleteErrors, ", ")), "failed", r.RemoteAddr)
		http.Error(w, "failed to delete some files: "+strings.Join(deleteErrors, ", "), http.StatusInternalServerError)
		return
	}

	// Clear config references
	if certType == "smtp" {
		cfg.TLS.SMTPTLSCertFile = ""
		cfg.TLS.SMTPTLSKeyFile = ""
	} else {
		cfg.TLS.SMTPDTLSCertFile = ""
		cfg.TLS.SMTPDTLSKeyFile = ""
	}

	// Write updated config
	if err := postfixMgr.WriteConfig(cfg); err != nil {
		s.logAudit(user.ID, user.Username, "certificate_delete", "certificate", certType,
			"Failed to update config after deletion: "+err.Error(), "failed", r.RemoteAddr)
		http.Error(w, "failed to update config", http.StatusInternalServerError)
		return
	}

	s.logAudit(user.ID, user.Username, "certificate_delete", "certificate", certType,
		fmt.Sprintf("Deleted %s certificate", certType), "success", r.RemoteAddr)

	w.WriteHeader(http.StatusNoContent)
}

// Credentials handler for saving relay credentials
func (s *Server) saveCredentials(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	var req struct {
		Relayhost string `json:"relayhost"`
		Username  string `json:"username"`
		Password  string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Relayhost == "" || req.Username == "" || req.Password == "" {
		http.Error(w, "missing required fields", http.StatusBadRequest)
		return
	}

	// Save credentials via postfix manager
	if err := postfixMgr.SaveSASLCredentials(req.Relayhost, req.Username, req.Password); err != nil {
		http.Error(w, "failed to save credentials: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "credentials_update", "sasl", req.Relayhost, "Updated SASL credentials for "+req.Relayhost, "success", r.RemoteAddr)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
	})
}

// Log handlers

var logReader *logs.Reader

func (s *Server) initLogReader() {
	if logReader == nil {
		logPath := "/var/log/mail.log"
		if s.cfg.LogPath != "" {
			logPath = s.cfg.LogPath
		}
		logReader = logs.NewReader(logPath)
		logReader.Start()
	}
}

func (s *Server) getLogs(w http.ResponseWriter, r *http.Request) {
	s.initLogReader()

	// Parse query parameters
	limit := 100
	if l := r.URL.Query().Get("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}
	if limit > 1000 {
		limit = 1000
	}

	entries, err := logReader.ReadRecent(limit)
	if err != nil {
		// Return empty if file not accessible
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"logs":  []interface{}{},
			"total": 0,
		})
		return
	}

	// Apply search filter if provided
	search := r.URL.Query().Get("search")
	if search != "" {
		filtered := make([]logs.Entry, 0)
		for _, e := range entries {
			if strings.Contains(strings.ToLower(e.Message), strings.ToLower(search)) ||
				strings.Contains(e.QueueID, search) {
				filtered = append(filtered, e)
			}
		}
		entries = filtered
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"logs":  entries,
		"total": len(entries),
	})
}

func (s *Server) streamLogs(w http.ResponseWriter, r *http.Request) {
	s.initLogReader()

	// Check if it's a WebSocket upgrade request
	if r.Header.Get("Upgrade") == "websocket" {
		s.handleWebSocketLogs(w, r)
		return
	}

	// Fall back to SSE for non-WebSocket clients
	s.handleSSELogs(w, r)
}

func (s *Server) handleSSELogs(w http.ResponseWriter, r *http.Request) {
	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", http.StatusInternalServerError)
		return
	}

	// Subscribe to log entries
	ch := logReader.Subscribe()
	defer logReader.Unsubscribe(ch)

	// Send initial connection event
	fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"connected\"}\n\n")
	flusher.Flush()

	// Stream entries
	for {
		select {
		case <-r.Context().Done():
			return
		case entry, ok := <-ch:
			if !ok {
				return
			}
			data, _ := json.Marshal(entry)
			fmt.Fprintf(w, "event: log\ndata: %s\n\n", data)
			flusher.Flush()
		}
	}
}

func (s *Server) handleWebSocketLogs(w http.ResponseWriter, r *http.Request) {
	// WebSocket upgrade handled by gorilla/websocket
	// For now, fall back to SSE
	s.handleSSELogs(w, r)
}

func (s *Server) getLogsByQueueId(w http.ResponseWriter, r *http.Request) {
	s.initLogReader()
	queueId := chi.URLParam(r, "queueId")

	entries, err := logReader.ReadRecent(1000)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"logs": []interface{}{},
		})
		return
	}

	// Filter by queue ID
	filtered := make([]logs.Entry, 0)
	for _, e := range entries {
		if e.QueueID == queueId {
			filtered = append(filtered, e)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"logs": filtered,
	})
}

func (s *Server) exportLogs(w http.ResponseWriter, r *http.Request) {
	s.initLogReader()

	entries, err := logReader.ReadRecent(10000)
	if err != nil {
		http.Error(w, "failed to read logs", http.StatusInternalServerError)
		return
	}

	// Export as CSV
	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", "attachment; filename=mail-logs.csv")

	fmt.Fprintln(w, "timestamp,hostname,process,pid,queue_id,from,to,status,relay,message")
	for _, e := range entries {
		fmt.Fprintf(w, "%s,%s,%s,%d,%s,%s,%s,%s,%s,\"%s\"\n",
			e.Timestamp.Format(time.RFC3339),
			e.Hostname,
			e.Process,
			e.PID,
			e.QueueID,
			e.MailFrom,
			e.MailTo,
			e.Status,
			e.Relay,
			strings.ReplaceAll(e.Message, "\"", "\"\""),
		)
	}
}

// Alert handlers

func (s *Server) initAlertEngine() {
	if alertEngine == nil {
		alertEngine = alerts.NewEngine(s.db.DB)
		alertEngine.Start()
	}
}

func (s *Server) getAlerts(w http.ResponseWriter, r *http.Request) {
	s.initAlertEngine()

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		fmt.Sscanf(l, "%d", &limit)
	}

	var alertsData []map[string]interface{}
	rows, err := s.db.Query(`
		SELECT a.id, a.rule_id, r.name, a.status, a.severity, a.triggered_at,
		       a.acknowledged_at, a.acknowledged_by, a.resolved_at, a.message
		FROM alerts a
		JOIN alert_rules r ON a.rule_id = r.id
		ORDER BY a.triggered_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, ruleID int64
		var ruleName, status, severity string
		var triggeredAt string
		var ackAt, ackBy, resolvedAt, message *string

		if err := rows.Scan(&id, &ruleID, &ruleName, &status, &severity, &triggeredAt, &ackAt, &ackBy, &resolvedAt, &message); err != nil {
			continue
		}

		alert := map[string]interface{}{
			"id":          id,
			"ruleId":      ruleID,
			"ruleName":    ruleName,
			"status":      status,
			"severity":    severity,
			"triggeredAt": triggeredAt,
		}
		if ackAt != nil {
			alert["acknowledgedAt"] = *ackAt
		}
		if ackBy != nil {
			alert["acknowledgedBy"] = *ackBy
		}
		if resolvedAt != nil {
			alert["resolvedAt"] = *resolvedAt
		}
		if message != nil {
			alert["message"] = *message
		}
		alertsData = append(alertsData, alert)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"alerts": alertsData,
	})
}

func (s *Server) getAlert(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var alertID, ruleID int64
	var ruleName, status, severity, triggeredAt string
	var ackAt, ackBy, resolvedAt, message *string

	err := s.db.QueryRow(`
		SELECT a.id, a.rule_id, r.name, a.status, a.severity, a.triggered_at,
		       a.acknowledged_at, a.acknowledged_by, a.resolved_at, a.message
		FROM alerts a
		JOIN alert_rules r ON a.rule_id = r.id
		WHERE a.id = ?
	`, id).Scan(&alertID, &ruleID, &ruleName, &status, &severity, &triggeredAt, &ackAt, &ackBy, &resolvedAt, &message)

	if err != nil {
		http.Error(w, "alert not found", http.StatusNotFound)
		return
	}

	alert := map[string]interface{}{
		"id":          alertID,
		"ruleId":      ruleID,
		"ruleName":    ruleName,
		"status":      status,
		"severity":    severity,
		"triggeredAt": triggeredAt,
	}
	if ackAt != nil {
		alert["acknowledgedAt"] = *ackAt
	}
	if ackBy != nil {
		alert["acknowledgedBy"] = *ackBy
	}
	if resolvedAt != nil {
		alert["resolvedAt"] = *resolvedAt
	}
	if message != nil {
		alert["message"] = *message
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(alert)
}

func (s *Server) acknowledgeAlert(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		Note string `json:"note"`
	}
	json.NewDecoder(r.Body).Decode(&req)

	u := GetUser(r.Context())
	username := "unknown"
	if u != nil {
		username = u.Username
	}

	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.Exec(`
		UPDATE alerts SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?, notes = ?
		WHERE id = ? AND status = 'firing'
	`, now, username, req.Note, id)

	if err != nil {
		http.Error(w, "failed to acknowledge alert", http.StatusInternalServerError)
		return
	}

	// Log audit
	if u != nil {
		s.logAudit(u.ID, u.Username, "alert_acknowledge", "alert", id, "Acknowledged alert "+id, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) silenceAlert(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		DurationMinutes int `json:"durationMinutes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.DurationMinutes <= 0 {
		req.DurationMinutes = 60 // default 1 hour
	}

	silenceUntil := time.Now().Add(time.Duration(req.DurationMinutes) * time.Minute).UTC()
	_, err := s.db.Exec(`
		UPDATE alerts SET status = 'silenced', silenced_until = ?
		WHERE id = ?
	`, silenceUntil.Format(time.RFC3339), id)

	if err != nil {
		http.Error(w, "failed to silence alert", http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "alert_silence", "alert", id, fmt.Sprintf("Silenced alert %s for %d minutes", id, req.DurationMinutes), "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getAlertRules(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`
		SELECT id, name, description, type, enabled, threshold_value, threshold_duration_seconds, severity
		FROM alert_rules
		ORDER BY name
	`)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var rules []map[string]interface{}
	for rows.Next() {
		var id int64
		var name, description, ruleType, severity string
		var enabled bool
		var thresholdValue float64
		var thresholdDuration int

		if err := rows.Scan(&id, &name, &description, &ruleType, &enabled, &thresholdValue, &thresholdDuration, &severity); err != nil {
			continue
		}

		rules = append(rules, map[string]interface{}{
			"id":                id,
			"name":              name,
			"description":       description,
			"type":              ruleType,
			"enabled":           enabled,
			"thresholdValue":    thresholdValue,
			"thresholdDuration": thresholdDuration,
			"severity":          severity,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"rules": rules,
	})
}

func (s *Server) updateAlertRule(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		Enabled        *bool    `json:"enabled,omitempty"`
		ThresholdValue *float64 `json:"thresholdValue,omitempty"`
		Severity       *string  `json:"severity,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Build and execute updates
	if req.Enabled != nil {
		s.db.Exec(`UPDATE alert_rules SET enabled = ? WHERE id = ?`, *req.Enabled, id)
	}
	if req.ThresholdValue != nil {
		s.db.Exec(`UPDATE alert_rules SET threshold_value = ? WHERE id = ?`, *req.ThresholdValue, id)
	}
	if req.Severity != nil {
		s.db.Exec(`UPDATE alert_rules SET severity = ? WHERE id = ?`, *req.Severity, id)
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "alert_rule_update", "alert_rule", id, "Updated alert rule "+id, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getRunbook(w http.ResponseWriter, r *http.Request) {
	alertType := chi.URLParam(r, "type")

	// Runbook content for each alert type
	runbooks := map[string]map[string]interface{}{
		"queue_growth": {
			"title":    "Mail Queue Growth",
			"overview": "The mail queue has grown beyond the configured threshold, indicating potential delivery issues.",
			"steps": []string{
				"Check the queue status using 'mailq' or the Queue page",
				"Look for common recipients or domains that may be causing delays",
				"Check if the relay host is reachable and accepting connections",
				"Review the mail logs for error messages",
				"Consider flushing the queue if the issue is resolved",
				"If messages are stuck, consider putting problematic messages on hold",
			},
		},
		"deferred_spike": {
			"title":    "Deferred Mail Spike",
			"overview": "A large number of messages have been deferred, indicating delivery problems.",
			"steps": []string{
				"Check relay host connectivity and DNS resolution",
				"Verify SMTP authentication credentials are still valid",
				"Check if the relay host has rate limiting in place",
				"Review TLS certificate validity",
				"Check for blacklisting of your IP or domain",
			},
		},
		"auth_failures": {
			"title":    "Authentication Failures",
			"overview": "Multiple authentication failures have been detected.",
			"steps": []string{
				"Check if relay credentials need to be updated",
				"Verify the authentication mechanism is configured correctly",
				"Check for unauthorized connection attempts in logs",
				"Consider blocking suspicious IPs if this is an attack",
			},
		},
		"tls_failures": {
			"title":    "TLS Connection Failures",
			"overview": "TLS connections are failing, which could impact secure mail delivery.",
			"steps": []string{
				"Verify TLS certificates are valid and not expired",
				"Check certificate chain completeness",
				"Verify the CA bundle is up to date",
				"Check if the relay host supports your TLS version",
			},
		},
	}

	content, ok := runbooks[alertType]
	if !ok {
		content = map[string]interface{}{
			"title":    "General Alert",
			"overview": "An alert has been triggered. Review the alert details and logs.",
			"steps": []string{
				"Review the alert message and context",
				"Check the mail logs for related errors",
				"Verify Postfix service status",
			},
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(content)
}

// Queue handlers

var queueMgr *postfix.QueueManager

func (s *Server) initQueueManager() {
	if queueMgr == nil {
		queueMgr = postfix.NewQueueManager(s.cfg.PostfixConfigDir)
	}
}

func (s *Server) getQueueSummary(w http.ResponseWriter, r *http.Request) {
	s.initQueueManager()
	active, deferred, hold, corrupt := queueMgr.GetQueueSummary()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"active":   active,
		"deferred": deferred,
		"hold":     hold,
		"corrupt":  corrupt,
	})
}

func (s *Server) getQueueMessages(w http.ResponseWriter, r *http.Request) {
	s.initQueueManager()

	status := r.URL.Query().Get("status")
	messages, err := queueMgr.ListMessages(status)
	if err != nil {
		http.Error(w, "failed to list messages: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"messages": messages,
	})
}

func (s *Server) getQueueMessage(w http.ResponseWriter, r *http.Request) {
	s.initQueueManager()
	queueId := chi.URLParam(r, "queueId")

	msg, err := queueMgr.GetMessage(queueId)
	if err != nil {
		if errors.Is(err, postfix.ErrInvalidQueueID) {
			http.Error(w, "invalid queue ID format", http.StatusBadRequest)
			return
		}
		http.Error(w, "message not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(msg)
}

func (s *Server) holdMessage(w http.ResponseWriter, r *http.Request) {
	s.initQueueManager()
	queueId := chi.URLParam(r, "queueId")

	if err := queueMgr.HoldMessage(queueId); err != nil {
		if errors.Is(err, postfix.ErrInvalidQueueID) {
			http.Error(w, "invalid queue ID format", http.StatusBadRequest)
			return
		}
		http.Error(w, "failed to hold message: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "queue_hold", "message", queueId, "Held message "+queueId, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) releaseMessage(w http.ResponseWriter, r *http.Request) {
	s.initQueueManager()
	queueId := chi.URLParam(r, "queueId")

	if err := queueMgr.ReleaseMessage(queueId); err != nil {
		if errors.Is(err, postfix.ErrInvalidQueueID) {
			http.Error(w, "invalid queue ID format", http.StatusBadRequest)
			return
		}
		http.Error(w, "failed to release message: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "queue_release", "message", queueId, "Released message "+queueId, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteMessage(w http.ResponseWriter, r *http.Request) {
	s.initQueueManager()
	queueId := chi.URLParam(r, "queueId")

	if err := queueMgr.DeleteMessage(queueId); err != nil {
		if errors.Is(err, postfix.ErrInvalidQueueID) {
			http.Error(w, "invalid queue ID format", http.StatusBadRequest)
			return
		}
		http.Error(w, "failed to delete message: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "queue_delete", "message", queueId, "Deleted message "+queueId, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) flushQueue(w http.ResponseWriter, r *http.Request) {
	s.initQueueManager()

	if err := queueMgr.FlushQueue(); err != nil {
		http.Error(w, "failed to flush queue: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "queue_flush", "queue", "", "Flushed mail queue", "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

// Audit handlers

func (s *Server) getAuditLog(w http.ResponseWriter, r *http.Request) {
	// Get query parameters
	limit := 50 // Default limit

	rows, err := s.db.Query(`
		SELECT id, timestamp, user_id, username, action, resource_type, resource_id, summary, status, ip_address
		FROM audit_log
		ORDER BY timestamp DESC
		LIMIT ?
	`, limit)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var entries []map[string]interface{}
	for rows.Next() {
		var id, userID int64
		var timestamp, username, action, resourceType, resourceID, summary, status, ipAddress string

		if err := rows.Scan(&id, &timestamp, &userID, &username, &action, &resourceType, &resourceID, &summary, &status, &ipAddress); err != nil {
			continue
		}

		entries = append(entries, map[string]interface{}{
			"id":           id,
			"timestamp":    timestamp,
			"userId":       userID,
			"username":     username,
			"action":       action,
			"resourceType": resourceType,
			"resourceId":   resourceID,
			"summary":      summary,
			"status":       status,
			"ipAddress":    ipAddress,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"entries": entries,
		"total":   len(entries),
	})
}

// User management handlers

func (s *Server) getUsers(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`
		SELECT id, username, email, role, last_login, created_at
		FROM users
		ORDER BY username
	`)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var users []map[string]interface{}
	for rows.Next() {
		var id int64
		var username, email, role string
		var lastLogin, createdAt *string

		if err := rows.Scan(&id, &username, &email, &role, &lastLogin, &createdAt); err != nil {
			continue
		}

		user := map[string]interface{}{
			"id":        id,
			"username":  username,
			"email":     email,
			"role":      role,
			"createdAt": createdAt,
		}
		if lastLogin != nil {
			user["lastLogin"] = *lastLogin
		}

		users = append(users, user)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"users": users,
	})
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Validate
	if req.Username == "" || req.Email == "" || req.Password == "" || req.Role == "" {
		http.Error(w, "missing required fields", http.StatusBadRequest)
		return
	}

	if req.Role != "admin" && req.Role != "operator" && req.Role != "auditor" {
		http.Error(w, "invalid role", http.StatusBadRequest)
		return
	}

	// Hash password
	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		http.Error(w, "failed to hash password", http.StatusInternalServerError)
		return
	}

	// Insert user
	result, err := s.db.Exec(`
		INSERT INTO users (username, email, password_hash, role, must_change_password)
		VALUES (?, ?, ?, ?, FALSE)
	`, req.Username, req.Email, hashedPassword, req.Role)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint") {
			http.Error(w, "username or email already exists", http.StatusConflict)
			return
		}
		http.Error(w, "failed to create user", http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "user_create", "user", fmt.Sprintf("%d", id), "Created user "+req.Username, "success", r.RemoteAddr)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":       id,
		"username": req.Username,
		"email":    req.Email,
		"role":     req.Role,
	})
}

func (s *Server) getUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var user struct {
		ID        int64
		Username  string
		Email     string
		Role      string
		LastLogin *string
		CreatedAt string
	}

	err := s.db.QueryRow(`
		SELECT id, username, email, role, last_login, created_at
		FROM users WHERE id = ?
	`, id).Scan(&user.ID, &user.Username, &user.Email, &user.Role, &user.LastLogin, &user.CreatedAt)

	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	resp := map[string]interface{}{
		"id":        user.ID,
		"username":  user.Username,
		"email":     user.Email,
		"role":      user.Role,
		"createdAt": user.CreatedAt,
	}
	if user.LastLogin != nil {
		resp["lastLogin"] = *user.LastLogin
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) updateUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		Email string  `json:"email,omitempty"`
		Role  *string `json:"role,omitempty"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Build update query
	if req.Email != "" {
		_, err := s.db.Exec(`UPDATE users SET email = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, req.Email, id)
		if err != nil {
			http.Error(w, "failed to update user", http.StatusInternalServerError)
			return
		}
	}

	if req.Role != nil {
		if *req.Role != "admin" && *req.Role != "operator" && *req.Role != "auditor" {
			http.Error(w, "invalid role", http.StatusBadRequest)
			return
		}
		_, err := s.db.Exec(`UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, *req.Role, id)
		if err != nil {
			http.Error(w, "failed to update user", http.StatusInternalServerError)
			return
		}
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "user_update", "user", id, "Updated user "+id, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	// Don't allow deleting yourself
	if u := GetUser(r.Context()); u != nil && fmt.Sprintf("%d", u.ID) == id {
		http.Error(w, "cannot delete your own account", http.StatusBadRequest)
		return
	}

	// Check if this is the last admin
	var adminCount int
	s.db.QueryRow(`SELECT COUNT(*) FROM users WHERE role = 'admin'`).Scan(&adminCount)

	var userRole string
	s.db.QueryRow(`SELECT role FROM users WHERE id = ?`, id).Scan(&userRole)

	if userRole == "admin" && adminCount <= 1 {
		http.Error(w, "cannot delete the last admin user", http.StatusBadRequest)
		return
	}

	_, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	if err != nil {
		http.Error(w, "failed to delete user", http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "user_delete", "user", id, "Deleted user "+id, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) resetPassword(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		Password string `json:"password"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Password == "" {
		// Generate random password if not provided
		req.Password = generateRandomPassword()
	}

	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		http.Error(w, "failed to hash password", http.StatusInternalServerError)
		return
	}

	_, err = s.db.Exec(`
		UPDATE users SET password_hash = ?, must_change_password = TRUE, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, hashedPassword, id)
	if err != nil {
		http.Error(w, "failed to reset password", http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "password_reset", "user", id, "Reset password for user "+id, "success", r.RemoteAddr)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"temporaryPassword": req.Password,
	})
}

// Helper function to hash passwords
func hashPassword(password string) (string, error) {
	// Use bcrypt for password hashing
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	return string(bytes), err
}

// Helper function to generate random password
func generateRandomPassword() string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%"
	b := make([]byte, 16)
	for i := range b {
		b[i] = chars[time.Now().UnixNano()%int64(len(chars))]
		time.Sleep(time.Nanosecond)
	}
	return string(b)
}

// Settings handlers

func (s *Server) getNotificationChannels(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`
		SELECT id, name, type, config, enabled
		FROM notification_channels
		ORDER BY name
	`)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	var channels []map[string]interface{}
	for rows.Next() {
		var id int64
		var name, channelType, configJSON string
		var enabled bool

		if err := rows.Scan(&id, &name, &channelType, &configJSON, &enabled); err != nil {
			continue
		}

		var config map[string]string
		json.Unmarshal([]byte(configJSON), &config)

		channels = append(channels, map[string]interface{}{
			"id":      id,
			"name":    name,
			"type":    channelType,
			"config":  config,
			"enabled": enabled,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"channels": channels,
	})
}

func (s *Server) createNotificationChannel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string            `json:"name"`
		Type    string            `json:"type"`
		Config  map[string]string `json:"config"`
		Enabled bool              `json:"enabled"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.Type == "" {
		http.Error(w, "name and type are required", http.StatusBadRequest)
		return
	}

	configJSON, _ := json.Marshal(req.Config)

	result, err := s.db.Exec(`
		INSERT INTO notification_channels (name, type, config, enabled)
		VALUES (?, ?, ?, ?)
	`, req.Name, req.Type, string(configJSON), req.Enabled)
	if err != nil {
		http.Error(w, "failed to create channel", http.StatusInternalServerError)
		return
	}

	id, _ := result.LastInsertId()

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "channel_create", "notification", fmt.Sprintf("%d", id), "Created notification channel "+req.Name, "success", r.RemoteAddr)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":      id,
		"name":    req.Name,
		"type":    req.Type,
		"config":  req.Config,
		"enabled": req.Enabled,
	})
}

func (s *Server) updateNotificationChannel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req struct {
		Name    string            `json:"name"`
		Type    string            `json:"type"`
		Config  map[string]string `json:"config"`
		Enabled bool              `json:"enabled"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	configJSON, _ := json.Marshal(req.Config)

	_, err := s.db.Exec(`
		UPDATE notification_channels SET name = ?, type = ?, config = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, req.Name, req.Type, string(configJSON), req.Enabled, id)
	if err != nil {
		http.Error(w, "failed to update channel", http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "channel_update", "notification", id, "Updated notification channel "+req.Name, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteNotificationChannel(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	_, err := s.db.Exec(`DELETE FROM notification_channels WHERE id = ?`, id)
	if err != nil {
		http.Error(w, "failed to delete channel", http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "channel_delete", "notification", id, "Deleted notification channel "+id, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) testNotificationChannel(w http.ResponseWriter, r *http.Request) {
	// For now, just return success - actual notification sending would be implemented
	// in a production system
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) getSystemSettings(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT key, value FROM settings`)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	settings := make(map[string]string)
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			continue
		}
		settings[key] = value
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"settings": settings,
	})
}

func (s *Server) updateSystemSettings(w http.ResponseWriter, r *http.Request) {
	var settings map[string]string

	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	for key, value := range settings {
		_, err := s.db.Exec(`
			INSERT OR REPLACE INTO settings (key, value, updated_at)
			VALUES (?, ?, CURRENT_TIMESTAMP)
		`, key, value)
		if err != nil {
			http.Error(w, "failed to update settings", http.StatusInternalServerError)
			return
		}
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "settings_update", "settings", "", "Updated system settings", "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

// Helper functions

func (s *Server) logAudit(userID int64, username, action, resourceType, resourceID, summary, status, ipAddress string) {
	_, err := s.db.Exec(`
		INSERT INTO audit_log (timestamp, user_id, username, action, resource_type, resource_id, summary, status, ip_address)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, time.Now().UTC().Format(time.RFC3339), userID, username, action, resourceType, resourceID, summary, status, ipAddress)
	if err != nil {
		// Log error but don't fail the request
	}
}

func (s *Server) recordConfigVersion(userID int64, username string) {
	// Get next version number
	var maxVersion int64
	s.db.QueryRow(`SELECT COALESCE(MAX(version_number), 0) FROM config_versions`).Scan(&maxVersion)
	nextVersion := maxVersion + 1

	// Read current config content
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}
	config, _ := postfixMgr.ReadConfig()
	configJSON, _ := json.Marshal(config)

	// Insert version record
	_, err := s.db.Exec(`
		INSERT INTO config_versions (version_number, created_at, created_by_id, created_by_username, config_content, status, applied_at)
		VALUES (?, ?, ?, ?, ?, 'applied', ?)
	`, nextVersion, time.Now().UTC().Format(time.RFC3339), userID, username, string(configJSON), time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		// Log error but don't fail
	}
}

// Transport maps handlers

func (s *Server) getTransportMaps(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	maps, err := postfixMgr.GetTransportMaps()
	if err != nil {
		http.Error(w, "failed to get transport maps: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"transportMaps": maps,
	})
}

func (s *Server) createTransportMap(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	var req postfix.TransportMap
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	// Validate input
	v := NewValidator()
	v.ValidateRequired("domain", req.Domain)
	v.ValidateRequired("nextHop", req.NextHop)
	v.ValidateDomain("domain", req.Domain)
	v.ValidateHostname("nextHop", req.NextHop)
	if req.Port != 0 {
		v.ValidatePort("port", req.Port)
	}

	if v.HasErrors() {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"errors": v.Errors(),
		})
		return
	}

	if req.Port == 0 {
		req.Port = 25
	}
	req.Enabled = true

	if err := postfixMgr.AddTransportMap(req); err != nil {
		http.Error(w, "failed to create transport map: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "transport_create", "transport_map", req.Domain, "Created transport map for "+req.Domain, "success", r.RemoteAddr)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(req)
}

func (s *Server) updateTransportMap(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	domain := chi.URLParam(r, "domain")

	var req postfix.TransportMap
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Domain == "" {
		req.Domain = domain
	}

	if err := postfixMgr.UpdateTransportMap(domain, req); err != nil {
		http.Error(w, "failed to update transport map: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "transport_update", "transport_map", domain, "Updated transport map for "+domain, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteTransportMap(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	domain := chi.URLParam(r, "domain")

	if err := postfixMgr.DeleteTransportMap(domain); err != nil {
		http.Error(w, "failed to delete transport map: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "transport_delete", "transport_map", domain, "Deleted transport map for "+domain, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

// Sender-dependent relay handlers

func (s *Server) getSenderRelays(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	relays, err := postfixMgr.GetSenderDependentRelays()
	if err != nil {
		http.Error(w, "failed to get sender relays: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"senderRelays": relays,
	})
}

func (s *Server) createSenderRelay(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	var req postfix.SenderDependentRelay
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Sender == "" || req.Relayhost == "" {
		http.Error(w, "sender and relayhost are required", http.StatusBadRequest)
		return
	}

	req.Enabled = true

	if err := postfixMgr.AddSenderDependentRelay(req); err != nil {
		http.Error(w, "failed to create sender relay: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "sender_relay_create", "sender_relay", req.Sender, "Created sender relay for "+req.Sender, "success", r.RemoteAddr)
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(req)
}

func (s *Server) updateSenderRelay(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	sender := chi.URLParam(r, "sender")

	var req postfix.SenderDependentRelay
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	if req.Sender == "" {
		req.Sender = sender
	}

	if err := postfixMgr.UpdateSenderDependentRelay(sender, req); err != nil {
		http.Error(w, "failed to update sender relay: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "sender_relay_update", "sender_relay", sender, "Updated sender relay for "+sender, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) deleteSenderRelay(w http.ResponseWriter, r *http.Request) {
	if postfixMgr == nil {
		postfixMgr = postfix.NewConfigManager(s.cfg.PostfixConfigDir)
	}

	sender := chi.URLParam(r, "sender")

	if err := postfixMgr.DeleteSenderDependentRelay(sender); err != nil {
		http.Error(w, "failed to delete sender relay: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Log audit
	if u := GetUser(r.Context()); u != nil {
		s.logAudit(u.ID, u.Username, "sender_relay_delete", "sender_relay", sender, "Deleted sender relay for "+sender, "success", r.RemoteAddr)
	}

	w.WriteHeader(http.StatusNoContent)
}
