package database

import (
	"database/sql"
	"os"
	"path/filepath"

	"github.com/rs/zerolog/log"
	_ "modernc.org/sqlite"
)

// DB wraps the SQL database connection
type DB struct {
	*sql.DB
}

// New creates a new database connection
func New(dbPath string) (*DB, error) {
	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}

	// Open database with WAL mode
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, err
	}

	// Test connection
	if err := db.Ping(); err != nil {
		return nil, err
	}

	return &DB{db}, nil
}

// Migrate runs database migrations
func (db *DB) Migrate() error {
	migrations := []string{
		migrationUsers,
		migrationSessions,
		migrationConfigVersions,
		migrationConfigSecrets,
		migrationMailLogs,
		migrationAlertRules,
		migrationAlerts,
		migrationNotificationChannels,
		migrationAuditLog,
		migrationSettings,
		migrationStagedConfig,
		migrationStagedTransportMaps,
		migrationStagedSenderRelays,
		// PSFXAdmin tables
		migrationMailDomains,
		migrationMailboxes,
		migrationMailAliases,
		migrationMailboxQuota,
		migrationAuthSources,
		// PSFXMail user data tables
		migrationMailContacts,
		migrationMailContactGroups,
		migrationMailSignatures,
	}

	for _, m := range migrations {
		if _, err := db.Exec(m); err != nil {
			return err
		}
	}

	// Initialize default data
	return db.initDefaults()
}

func (db *DB) initDefaults() error {
	// Check if admin user exists
	var count int
	err := db.QueryRow("SELECT COUNT(*) FROM users WHERE role = 'admin'").Scan(&count)
	if err != nil {
		return err
	}

	// If no admin exists, setup wizard will handle user creation
	// Just log a message to inform the operator
	if count == 0 {
		log.Info().Msg("No admin user found - setup wizard will be available at first access")
	}

	// Initialize default settings
	defaultSettings := map[string]string{
		"log_retention_days":        "7",
		"audit_retention_days":      "90",
		"session_timeout_hours":     "8",
		"alert_silence_default_min": "60",
		"log_source":                "auto",
	}

	for key, value := range defaultSettings {
		_, err := db.Exec(`
			INSERT OR IGNORE INTO settings (key, value, description)
			VALUES (?, ?, '')
		`, key, value)
		if err != nil {
			return err
		}
	}

	// Initialize default alert rules
	return db.initDefaultAlertRules()
}

func (db *DB) initDefaultAlertRules() error {
	rules := []struct {
		name              string
		description       string
		ruleType          string
		thresholdValue    float64
		thresholdDuration int
		severity          string
	}{
		{"Queue Growth Warning", "Mail queue exceeds threshold", "queue_count", 100, 300, "warning"},
		{"Queue Growth Critical", "Mail queue severely backed up", "queue_count", 500, 300, "critical"},
		{"Deferred Mail Spike", "Unusual deferred mail rate", "deferred_rate", 50, 3600, "warning"},
		{"Auth Failures", "SMTP authentication failures detected", "auth_failure_rate", 10, 3600, "warning"},
		{"TLS Failures", "TLS handshake failures detected", "tls_failure_rate", 20, 3600, "warning"},
		{"Postfix Down", "Postfix service not running", "service_check", 0, 0, "critical"},
	}

	for _, r := range rules {
		_, err := db.Exec(`
			INSERT OR IGNORE INTO alert_rules (name, description, type, threshold_value, threshold_duration_seconds, severity, enabled)
			VALUES (?, ?, ?, ?, ?, ?, TRUE)
		`, r.name, r.description, r.ruleType, r.thresholdValue, r.thresholdDuration, r.severity)
		if err != nil {
			return err
		}
	}

	return nil
}

// Migration SQL statements
const migrationUsers = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'auditor')),
    must_change_password BOOLEAN DEFAULT FALSE,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until DATETIME,
    last_login DATETIME,
    last_password_change DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const migrationSessions = `
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`

const migrationConfigVersions = `
CREATE TABLE IF NOT EXISTS config_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_number INTEGER NOT NULL UNIQUE,
    config_content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by_id INTEGER REFERENCES users(id),
    created_by_username TEXT,
    applied_at DATETIME,
    applied_by_id INTEGER REFERENCES users(id),
    status TEXT CHECK (status IN ('draft', 'applied', 'rolled_back')),
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_config_versions_status ON config_versions(status);
CREATE INDEX IF NOT EXISTS idx_config_versions_number ON config_versions(version_number);
`

const migrationConfigSecrets = `
CREATE TABLE IF NOT EXISTS config_secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    encrypted_value BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id)
);
`

const migrationMailLogs = `
CREATE TABLE IF NOT EXISTS mail_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL,
    hostname TEXT,
    process TEXT,
    pid INTEGER,
    queue_id TEXT,
    message TEXT NOT NULL,
    severity TEXT CHECK (severity IN ('info', 'warning', 'error')),
    mail_from TEXT,
    mail_to TEXT,
    status TEXT,
    relay TEXT,
    delay REAL,
    dsn TEXT,
    raw_line TEXT
);
CREATE INDEX IF NOT EXISTS idx_mail_logs_timestamp ON mail_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_mail_logs_queue_id ON mail_logs(queue_id);
CREATE INDEX IF NOT EXISTS idx_mail_logs_status ON mail_logs(status);
CREATE INDEX IF NOT EXISTS idx_mail_logs_severity ON mail_logs(severity);
`

const migrationAlertRules = `
CREATE TABLE IF NOT EXISTS alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    type TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    threshold_value REAL NOT NULL,
    threshold_duration_seconds INTEGER NOT NULL,
    severity TEXT CHECK (severity IN ('warning', 'critical')),
    runbook_content TEXT,
    runbook_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const migrationAlerts = `
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL REFERENCES alert_rules(id),
    status TEXT CHECK (status IN ('firing', 'acknowledged', 'resolved', 'silenced')),
    severity TEXT CHECK (severity IN ('warning', 'critical')),
    triggered_at DATETIME NOT NULL,
    acknowledged_at DATETIME,
    acknowledged_by TEXT,
    resolved_at DATETIME,
    silenced_until DATETIME,
    silenced_by INTEGER REFERENCES users(id),
    message TEXT,
    notes TEXT,
    context TEXT
);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_triggered ON alerts(triggered_at);
`

const migrationNotificationChannels = `
CREATE TABLE IF NOT EXISTS notification_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('email', 'webhook', 'slack')),
    config TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const migrationAuditLog = `
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER REFERENCES users(id),
    username TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    summary TEXT,
    details TEXT,
    diff TEXT,
    status TEXT CHECK (status IN ('success', 'failed')),
    error_message TEXT,
    ip_address TEXT,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
`

const migrationSettings = `
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id)
);
`

// Staged config tables for submit/apply workflow
const migrationStagedConfig = `
CREATE TABLE IF NOT EXISTS staged_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    value TEXT,
    category TEXT NOT NULL,
    staged_by_id INTEGER NOT NULL REFERENCES users(id),
    staged_by_username TEXT NOT NULL,
    staged_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_staged_config_category ON staged_config(category);
`

const migrationStagedTransportMaps = `
CREATE TABLE IF NOT EXISTS staged_transport_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    operation TEXT NOT NULL CHECK (operation IN ('add', 'update', 'delete')),
    next_hop TEXT,
    port INTEGER,
    enabled BOOLEAN,
    staged_by_id INTEGER REFERENCES users(id),
    staged_by_username TEXT,
    staged_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

const migrationStagedSenderRelays = `
CREATE TABLE IF NOT EXISTS staged_sender_relays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL UNIQUE,
    operation TEXT NOT NULL CHECK (operation IN ('add', 'update', 'delete')),
    relayhost TEXT,
    enabled BOOLEAN,
    staged_by_id INTEGER REFERENCES users(id),
    staged_by_username TEXT,
    staged_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

// PSFXAdmin tables for mail domain and mailbox management
const migrationMailDomains = `
CREATE TABLE IF NOT EXISTS mail_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL UNIQUE,
    description TEXT,
    max_mailboxes INTEGER DEFAULT 0,
    max_aliases INTEGER DEFAULT 0,
    quota_bytes INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mail_domains_domain ON mail_domains(domain);
CREATE INDEX IF NOT EXISTS idx_mail_domains_active ON mail_domains(active);
`

const migrationMailboxes = `
CREATE TABLE IF NOT EXISTS mailboxes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    local_part TEXT NOT NULL,
    domain_id INTEGER NOT NULL REFERENCES mail_domains(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    quota_bytes INTEGER DEFAULT 1073741824,
    active BOOLEAN DEFAULT TRUE,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mailboxes_email ON mailboxes(email);
CREATE INDEX IF NOT EXISTS idx_mailboxes_domain ON mailboxes(domain_id);
CREATE INDEX IF NOT EXISTS idx_mailboxes_active ON mailboxes(active);
`

const migrationMailAliases = `
CREATE TABLE IF NOT EXISTS mail_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_email TEXT NOT NULL,
    destination_email TEXT NOT NULL,
    domain_id INTEGER NOT NULL REFERENCES mail_domains(id) ON DELETE CASCADE,
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_email, destination_email)
);
CREATE INDEX IF NOT EXISTS idx_mail_aliases_source ON mail_aliases(source_email);
CREATE INDEX IF NOT EXISTS idx_mail_aliases_domain ON mail_aliases(domain_id);
`

const migrationMailboxQuota = `
CREATE TABLE IF NOT EXISTS mailbox_quota (
    mailbox_id INTEGER PRIMARY KEY REFERENCES mailboxes(id) ON DELETE CASCADE,
    bytes_used INTEGER DEFAULT 0,
    message_count INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

// Auth sources for future LDAP/SSO integration
const migrationAuthSources = `
CREATE TABLE IF NOT EXISTS auth_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL CHECK (type IN ('local', 'ldap', 'oidc')) DEFAULT 'local',
    config_json TEXT,
    priority INTEGER DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

// PSFXMail user data - contacts
const migrationMailContacts = `
CREATE TABLE IF NOT EXISTS mail_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    company TEXT,
    phone TEXT,
    notes TEXT,
    favorite BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_email, email)
);
CREATE INDEX IF NOT EXISTS idx_mail_contacts_owner ON mail_contacts(owner_email);
CREATE INDEX IF NOT EXISTS idx_mail_contacts_email ON mail_contacts(email);
CREATE INDEX IF NOT EXISTS idx_mail_contacts_favorite ON mail_contacts(owner_email, favorite);
`

// PSFXMail user data - contact groups
const migrationMailContactGroups = `
CREATE TABLE IF NOT EXISTS mail_contact_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(owner_email, name)
);
CREATE INDEX IF NOT EXISTS idx_mail_contact_groups_owner ON mail_contact_groups(owner_email);

CREATE TABLE IF NOT EXISTS mail_contact_group_members (
    group_id INTEGER NOT NULL REFERENCES mail_contact_groups(id) ON DELETE CASCADE,
    contact_id INTEGER NOT NULL REFERENCES mail_contacts(id) ON DELETE CASCADE,
    PRIMARY KEY(group_id, contact_id)
);
`

// PSFXMail user data - email signatures
const migrationMailSignatures = `
CREATE TABLE IF NOT EXISTS mail_signatures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_email TEXT NOT NULL,
    name TEXT NOT NULL,
    content_html TEXT NOT NULL,
    content_text TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mail_signatures_owner ON mail_signatures(owner_email);
CREATE INDEX IF NOT EXISTS idx_mail_signatures_default ON mail_signatures(owner_email, is_default);
`
