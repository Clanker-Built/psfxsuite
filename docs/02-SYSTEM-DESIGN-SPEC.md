# PostfixRelay - System Design Specification

**Version**: 1.0.0
**Date**: 2026-01-21
**Status**: Approved for Implementation

---

## 1. Executive Summary

PostfixRelay is a web application for managing Postfix as an internal SMTP relay server. It provides a modern UI for configuration management, real-time log monitoring, alerting, and operational tasks. Unlike PostfixAdmin, PostfixRelay focuses exclusively on relay functionality, not mailbox hosting.

### Key Decisions

| Aspect | Decision |
|--------|----------|
| Backend | Go (single binary) |
| Frontend | React + TypeScript + Vite + shadcn/ui |
| Database | SQLite with WAL mode |
| API | REST + WebSocket for streaming |
| Deployment | Docker (dev), Native packages (prod) |
| Auth | Local accounts (LDAP/OIDC deferred) |

---

## 2. Architecture

### 2.1 System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Client (Browser)                                 │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    React SPA (TypeScript)                          │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐  │  │
│  │  │Dashboard│ │ Config  │ │  Logs   │ │ Alerts  │ │   Queue     │  │  │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └──────┬──────┘  │  │
│  │       │           │           │           │             │         │  │
│  │  ┌────┴───────────┴───────────┴───────────┴─────────────┴──────┐  │  │
│  │  │              Zustand Store + React Query                    │  │  │
│  │  └─────────────────────────────┬───────────────────────────────┘  │  │
│  └────────────────────────────────┼──────────────────────────────────┘  │
└───────────────────────────────────┼──────────────────────────────────────┘
                                    │
                          HTTPS (443) / WSS
                                    │
┌───────────────────────────────────┼──────────────────────────────────────┐
│                      Postfix Host │                                      │
│  ┌────────────────────────────────┴───────────────────────────────────┐  │
│  │                  PostfixRelay Backend (Go)                         │  │
│  │                                                                    │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │  │
│  │  │   Router   │  │    Auth    │  │   RBAC     │  │   Session   │  │  │
│  │  │   (chi)    │  │ Middleware │  │ Middleware │  │   Store     │  │  │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └──────┬──────┘  │  │
│  │        │               │               │                │         │  │
│  │  ┌─────┴───────────────┴───────────────┴────────────────┴──────┐  │  │
│  │  │                      API Handlers                           │  │  │
│  │  │  /api/v1/auth  /config  /logs  /alerts  /queue  /audit     │  │  │
│  │  └─────┬───────────────┬───────────────┬───────────────────────┘  │  │
│  │        │               │               │                          │  │
│  │  ┌─────┴──────┐  ┌─────┴──────┐  ┌─────┴──────┐  ┌────────────┐  │  │
│  │  │  Config    │  │    Log     │  │   Alert    │  │  Metrics   │  │  │
│  │  │  Engine    │  │  Streamer  │  │   Engine   │  │ Collector  │  │  │
│  │  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  │  │
│  │        │               │               │               │         │  │
│  │  ┌─────┴───────────────┴───────────────┴───────────────┴──────┐  │  │
│  │  │                   SQLite Database                          │  │  │
│  │  │   users | sessions | config_versions | logs | alerts |     │  │  │
│  │  │   audit | settings                                         │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│        │                   │                    │                        │
│        │ sudo postfix      │ journalctl -f      │ File R/W               │
│        │ sudo postconf     │ (or file tail)     │                        │
│        ▼                   ▼                    ▼                        │
│  ┌───────────┐      ┌────────────┐       ┌──────────────┐               │
│  │  Postfix  │      │  journald  │       │ /etc/postfix │               │
│  │  Service  │      │  /syslog   │       │   configs    │               │
│  └───────────┘      └────────────┘       └──────────────┘               │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow Diagrams

#### Configuration Change Flow

```
┌─────────┐    ┌─────────┐    ┌───────────┐    ┌──────────┐    ┌─────────┐
│  User   │───▶│   UI    │───▶│  Backend  │───▶│ Validate │───▶│ Apply   │
│ (Admin) │    │  Form   │    │   API     │    │ (postfix │    │ (atomic │
└─────────┘    └─────────┘    └───────────┘    │  check)  │    │  write) │
                                               └────┬─────┘    └────┬────┘
                                                    │               │
                                         ┌──────────┘               │
                                         │ Fail                     │ Success
                                         ▼                          ▼
                                    ┌─────────┐              ┌─────────────┐
                                    │ Return  │              │   postfix   │
                                    │ Error   │              │   reload    │
                                    └─────────┘              └──────┬──────┘
                                                                    │
                                                                    ▼
                                                            ┌───────────────┐
                                                            │ Verify status │
                                                            │ Store version │
                                                            │ Audit log     │
                                                            └───────────────┘
```

#### Log Streaming Flow

```
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│ journalctl │────▶│    Log     │────▶│   Parse    │────▶│   Store    │
│  -f        │     │  Reader    │     │  Extract   │     │  SQLite    │
│            │     │ (goroutine)│     │  queue_id  │     │  (batch)   │
└────────────┘     └─────┬──────┘     └────────────┘     └────────────┘
                         │
                         │ Fan out
                         ▼
              ┌──────────────────────┐
              │   WebSocket Hub      │
              │  ┌────┐ ┌────┐ ┌───┐ │
              │  │ C1 │ │ C2 │ │C3 │ │  (Connected clients)
              │  └────┘ └────┘ └───┘ │
              └──────────────────────┘
```

#### Alert Processing Flow

```
┌────────────┐     ┌────────────┐     ┌────────────┐     ┌────────────┐
│  Metrics   │────▶│    Rule    │────▶│  Alert     │────▶│  Notify    │
│  Collector │     │  Engine    │     │  Manager   │     │  Channels  │
│ (periodic) │     │ (evaluate) │     │ (dedupe)   │     │ (async)    │
└────────────┘     └────────────┘     └────────────┘     └────────────┘
                                             │
      ┌──────────────────────────────────────┘
      │
      ▼
┌───────────────────────────────────────────────────────────┐
│ Notifications                                              │
│   ├─▶ UI (WebSocket push)                                 │
│   ├─▶ Email (SMTP)                                        │
│   └─▶ Webhook (HTTP POST)                                 │
└───────────────────────────────────────────────────────────┘
```

---

## 3. API Specification

### 3.1 Authentication Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/v1/auth/login` | Login with credentials | None |
| POST | `/api/v1/auth/logout` | Logout, invalidate session | Required |
| GET | `/api/v1/auth/me` | Get current user info | Required |
| PUT | `/api/v1/auth/password` | Change own password | Required |

### 3.2 Configuration Endpoints

| Method | Path | Description | Auth | Role |
|--------|------|-------------|------|------|
| GET | `/api/v1/config` | Get current config (secrets masked) | Required | All |
| GET | `/api/v1/config/full` | Get current config (secrets visible) | Required | Admin |
| PUT | `/api/v1/config` | Update config (validates, does not apply) | Required | Admin |
| POST | `/api/v1/config/validate` | Validate proposed config | Required | Admin |
| POST | `/api/v1/config/apply` | Apply pending config changes | Required | Admin |
| POST | `/api/v1/config/rollback/{version}` | Rollback to specific version | Required | Admin |
| GET | `/api/v1/config/history` | List config versions | Required | All |
| GET | `/api/v1/config/history/{version}` | Get specific version | Required | All |
| GET | `/api/v1/config/diff/{v1}/{v2}` | Diff two versions | Required | All |

### 3.3 Log Endpoints

| Method | Path | Description | Auth | Role |
|--------|------|-------------|------|------|
| GET | `/api/v1/logs` | Query historical logs | Required | All |
| GET | `/api/v1/logs/stream` | WebSocket log stream | Required | All |
| GET | `/api/v1/logs/queue/{queue_id}` | Get all logs for queue ID | Required | All |
| GET | `/api/v1/logs/export` | Export logs (CSV/JSON) | Required | All |

**Query Parameters for `/api/v1/logs`:**
- `start` - Start timestamp (ISO 8601)
- `end` - End timestamp (ISO 8601)
- `severity` - Filter by severity (info, warning, error)
- `search` - Full-text search in message
- `queue_id` - Filter by queue ID
- `limit` - Max results (default 100, max 1000)
- `offset` - Pagination offset

### 3.4 Alert Endpoints

| Method | Path | Description | Auth | Role |
|--------|------|-------------|------|------|
| GET | `/api/v1/alerts` | List alerts (active + recent) | Required | All |
| GET | `/api/v1/alerts/{id}` | Get alert details | Required | All |
| POST | `/api/v1/alerts/{id}/acknowledge` | Acknowledge alert | Required | Admin, Operator |
| POST | `/api/v1/alerts/{id}/silence` | Silence alert for duration | Required | Admin, Operator |
| GET | `/api/v1/alerts/rules` | List alert rules | Required | All |
| PUT | `/api/v1/alerts/rules/{id}` | Update alert rule | Required | Admin |
| GET | `/api/v1/alerts/runbook/{type}` | Get runbook for alert type | Required | All |

### 3.5 Queue Endpoints

| Method | Path | Description | Auth | Role |
|--------|------|-------------|------|------|
| GET | `/api/v1/queue` | Get queue summary | Required | All |
| GET | `/api/v1/queue/messages` | List queue messages | Required | All |
| GET | `/api/v1/queue/messages/{queue_id}` | Get message details | Required | All |
| POST | `/api/v1/queue/messages/{queue_id}/hold` | Put message on hold | Required | Admin, Operator |
| POST | `/api/v1/queue/messages/{queue_id}/release` | Release held message | Required | Admin, Operator |
| DELETE | `/api/v1/queue/messages/{queue_id}` | Delete message | Required | Admin |
| POST | `/api/v1/queue/flush` | Flush queue (retry deferred) | Required | Admin, Operator |

### 3.6 Audit Endpoints

| Method | Path | Description | Auth | Role |
|--------|------|-------------|------|------|
| GET | `/api/v1/audit` | Query audit log | Required | All |

**Query Parameters:**
- `start`, `end` - Time range
- `user_id` - Filter by user
- `action` - Filter by action type
- `limit`, `offset` - Pagination

### 3.7 User Management Endpoints

| Method | Path | Description | Auth | Role |
|--------|------|-------------|------|------|
| GET | `/api/v1/users` | List users | Required | Admin |
| POST | `/api/v1/users` | Create user | Required | Admin |
| GET | `/api/v1/users/{id}` | Get user | Required | Admin |
| PUT | `/api/v1/users/{id}` | Update user | Required | Admin |
| DELETE | `/api/v1/users/{id}` | Delete user | Required | Admin |
| POST | `/api/v1/users/{id}/reset-password` | Force password reset | Required | Admin |

### 3.8 System Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/v1/status` | System status (Postfix, queue, etc.) | Required |
| GET | `/healthz` | Liveness probe | None |
| GET | `/readyz` | Readiness probe | None |
| GET | `/metrics` | Prometheus metrics | Optional (configurable) |

---

## 4. Database Schema

### 4.1 Schema Diagram

```sql
-- Users and Authentication
CREATE TABLE users (
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

CREATE TABLE password_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX idx_sessions_token ON sessions(token_hash);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Configuration Management
CREATE TABLE config_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_number INTEGER NOT NULL,
    content TEXT NOT NULL,  -- Full main.cf content
    parameters TEXT NOT NULL,  -- JSON of key-value pairs
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id),
    applied_at DATETIME,
    applied_by INTEGER REFERENCES users(id),
    status TEXT CHECK (status IN ('draft', 'applied', 'rolled_back')),
    notes TEXT
);

CREATE INDEX idx_config_versions_status ON config_versions(status);

CREATE TABLE config_secrets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,  -- e.g., 'sasl_passwd.relay.example.com'
    encrypted_value BLOB NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id)
);

-- Log Storage (parsed logs)
CREATE TABLE mail_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL,
    hostname TEXT,
    process TEXT,  -- smtp, qmgr, cleanup, bounce, etc.
    pid INTEGER,
    queue_id TEXT,
    message TEXT NOT NULL,
    severity TEXT CHECK (severity IN ('info', 'warning', 'error')),
    -- Parsed fields (nullable)
    mail_from TEXT,
    mail_to TEXT,
    status TEXT,  -- sent, deferred, bounced, etc.
    relay TEXT,
    delay REAL,
    dsn TEXT,
    raw_line TEXT
);

CREATE INDEX idx_mail_logs_timestamp ON mail_logs(timestamp);
CREATE INDEX idx_mail_logs_queue_id ON mail_logs(queue_id);
CREATE INDEX idx_mail_logs_status ON mail_logs(status);
CREATE INDEX idx_mail_logs_severity ON mail_logs(severity);

-- Alerts
CREATE TABLE alert_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    type TEXT NOT NULL,  -- queue_growth, deferred_spike, auth_failure, etc.
    enabled BOOLEAN DEFAULT TRUE,
    threshold_value REAL NOT NULL,
    threshold_duration_seconds INTEGER NOT NULL,
    severity TEXT CHECK (severity IN ('warning', 'critical')),
    runbook_content TEXT,
    runbook_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER NOT NULL REFERENCES alert_rules(id),
    status TEXT CHECK (status IN ('firing', 'acknowledged', 'resolved', 'silenced')),
    triggered_at DATETIME NOT NULL,
    acknowledged_at DATETIME,
    acknowledged_by INTEGER REFERENCES users(id),
    resolved_at DATETIME,
    silenced_until DATETIME,
    silenced_by INTEGER REFERENCES users(id),
    notes TEXT,
    context TEXT  -- JSON with alert-specific data
);

CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_triggered ON alerts(triggered_at);

CREATE TABLE alert_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_id INTEGER NOT NULL REFERENCES alerts(id),
    channel TEXT NOT NULL,  -- ui, email, webhook
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT CHECK (status IN ('pending', 'sent', 'failed')),
    error_message TEXT
);

-- Notification Channels Configuration
CREATE TABLE notification_channels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('email', 'webhook', 'slack')),
    config TEXT NOT NULL,  -- JSON: {smtp_host, to_addresses} or {url, headers}
    enabled BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit Log
CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER REFERENCES users(id),
    username TEXT,  -- Denormalized for when user deleted
    action TEXT NOT NULL,
    resource_type TEXT,  -- config, user, alert, queue, etc.
    resource_id TEXT,
    summary TEXT,
    details TEXT,  -- JSON with full details
    diff TEXT,  -- For config changes
    status TEXT CHECK (status IN ('success', 'failed')),
    error_message TEXT,
    ip_address TEXT,
    user_agent TEXT
);

CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_action ON audit_log(action);

-- Application Settings
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by INTEGER REFERENCES users(id)
);

-- Initialize default settings
INSERT INTO settings (key, value, description) VALUES
    ('log_retention_days', '7', 'Days to retain parsed mail logs'),
    ('audit_retention_days', '90', 'Days to retain audit logs'),
    ('session_timeout_hours', '8', 'Session timeout in hours'),
    ('alert_silence_default_hours', '1', 'Default silence duration for alerts'),
    ('log_source', 'auto', 'Log source: auto, journald, or file path');
```

### 4.2 Encryption

Secrets stored in `config_secrets.encrypted_value` are encrypted using:
- Algorithm: AES-256-GCM
- Key derivation: HKDF from `DB_ENCRYPTION_KEY` environment variable
- Each value has unique nonce prepended to ciphertext

---

## 5. Configuration Management Plan

### 5.1 Managed Parameters

PostfixRelay manages a subset of Postfix parameters organized into categories:

**General**
- `myhostname`
- `mydomain`
- `myorigin`
- `inet_interfaces`
- `inet_protocols`

**Relay Settings**
- `relayhost`
- `mynetworks`
- `relay_domains`
- `smtpd_relay_restrictions`

**TLS (Inbound)**
- `smtpd_tls_security_level`
- `smtpd_tls_cert_file`
- `smtpd_tls_key_file`
- `smtpd_tls_protocols`
- `smtpd_tls_ciphers`

**TLS (Outbound)**
- `smtp_tls_security_level`
- `smtp_tls_CAfile`
- `smtp_tls_protocols`
- `smtp_tls_ciphers`

**Authentication (Outbound SASL)**
- `smtp_sasl_auth_enable`
- `smtp_sasl_password_maps`
- `smtp_sasl_security_options`

**Rate Limits**
- `smtpd_client_connection_rate_limit`
- `smtpd_client_message_rate_limit`
- `default_destination_rate_delay`

**Queue**
- `maximal_queue_lifetime`
- `bounce_queue_lifetime`
- `queue_run_delay`

### 5.2 Configuration Workflow

```
1. READ
   └─▶ postconf -n > current values
   └─▶ Parse main.cf for comments/structure

2. EDIT (in UI)
   └─▶ User modifies values in forms
   └─▶ Generate new config in memory

3. VALIDATE
   └─▶ App-level: format, required fields, valid combinations
   └─▶ Write to /etc/postfix/.main.cf.pending
   └─▶ postfix check -c /etc/postfix (validates pending)
   └─▶ If fail: delete pending, return errors

4. APPLY
   └─▶ Acquire flock on /etc/postfix/.postfixrelay.lock
   └─▶ cp main.cf main.cf.backup.$(timestamp)
   └─▶ Store version in config_versions table
   └─▶ mv .main.cf.pending main.cf (atomic)
   └─▶ postmap for any map files (sasl_passwd, transport)
   └─▶ postfix reload
   └─▶ Verify: systemctl is-active postfix
   └─▶ Release lock
   └─▶ Write audit log

5. ROLLBACK (if needed)
   └─▶ Retrieve version from config_versions
   └─▶ Write to .main.cf.rollback, validate
   └─▶ Atomic replace
   └─▶ postfix reload
   └─▶ Write audit log
```

### 5.3 File Permissions

| File | Owner | Permissions |
|------|-------|-------------|
| `/etc/postfix/main.cf` | root:root | 644 |
| `/etc/postfix/sasl_passwd` | root:root | 600 |
| `/etc/postfix/sasl_passwd.db` | root:root | 600 |
| `/etc/postfix/.postfixrelay.lock` | postfixrelay:postfixrelay | 600 |
| `/etc/postfix/main.cf.backup.*` | root:root | 644 |

---

## 6. Security Specification

### 6.1 Threat Model

| ID | Threat | Impact | Likelihood | Mitigation |
|----|--------|--------|------------|------------|
| T1 | Brute force login | Account takeover | Medium | Lockout after 5 failures, rate limiting |
| T2 | Session hijacking | Unauthorized access | Medium | Secure cookies, HTTPS, session binding |
| T3 | Config injection | Mail server compromise | High | Strict validation, postfix check, RBAC |
| T4 | Privilege escalation | Root access | High | Constrained sudo, least privilege |
| T5 | XSS | Session theft, UI manipulation | Medium | CSP, output encoding, sanitization |
| T6 | CSRF | Unauthorized actions | Medium | CSRF tokens, SameSite cookies |
| T7 | SQL injection | Data breach | High | Parameterized queries only |
| T8 | Log injection | Log forgery | Low | Parse only, never execute log content |
| T9 | DoS | Service unavailable | Medium | Rate limiting, resource limits |
| T10 | Secret exposure | Credential leak | High | Encryption at rest, masked in UI |

### 6.2 Sudoers Configuration

```sudoers
# /etc/sudoers.d/postfixrelay
# PostfixRelay backend user privileges

postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postfix check
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postfix reload
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postfix status
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postconf -n
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postconf -P
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postmap /etc/postfix/*
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postqueue -p
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postqueue -f
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postsuper -h ALL
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postsuper -h *
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postsuper -H ALL
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postsuper -H *
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postsuper -d ALL
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postsuper -d *
postfixrelay ALL=(root) NOPASSWD: /bin/journalctl -u postfix *
postfixrelay ALL=(root) NOPASSWD: /bin/cat /etc/postfix/main.cf
postfixrelay ALL=(root) NOPASSWD: /bin/cat /etc/postfix/master.cf
postfixrelay ALL=(root) NOPASSWD: /bin/mv /etc/postfix/.main.cf.pending /etc/postfix/main.cf
postfixrelay ALL=(root) NOPASSWD: /bin/cp /etc/postfix/main.cf /etc/postfix/main.cf.backup.*
```

### 6.3 API Security Headers

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss:
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains (if HTTPS)
Referrer-Policy: strict-origin-when-cross-origin
```

---

## 7. Alert Rules Catalog

### 7.1 Default Rules

| Rule | Type | Default Threshold | Severity | Description |
|------|------|-------------------|----------|-------------|
| Queue Growth | `queue_count` | >100 for 5m | Warning | Mail queue exceeds threshold |
| Queue Critical | `queue_count` | >500 for 5m | Critical | Mail queue severely backed up |
| Deferred Spike | `deferred_rate` | >50/hour | Warning | Unusual deferred mail rate |
| Auth Failures | `auth_failure_rate` | >10/hour | Warning | SMTP authentication failures |
| TLS Failures | `tls_failure_rate` | >20/hour | Warning | TLS handshake failures |
| Upstream Down | `relay_check` | 3 failures | Critical | Cannot connect to relayhost |
| Config Error | `postfix_check` | Any error | Critical | Postfix config validation failed |
| High Bounce | `bounce_rate` | >10% over 1h | Warning | High percentage of bounces |
| Disk Low | `disk_usage` | <10% free | Warning | Mail spool disk running low |
| Postfix Down | `service_check` | Not active | Critical | Postfix service not running |
| Log Lag | `log_ingestion_lag` | >60s | Warning | Log processing delayed |

### 7.2 Alert Lifecycle States

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    ▼                                     │
┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
│   NEW     │──▶│  FIRING   │──▶│   ACK'd   │──▶│ RESOLVED  │
│           │   │           │   │           │   │           │
└───────────┘   └─────┬─────┘   └───────────┘   └───────────┘
                      │
                      ▼
                ┌───────────┐
                │ SILENCED  │ (temporary suppress)
                └───────────┘
```

---

## 8. UI Screen Inventory

### 8.1 Screen List

| Screen | Route | Description | Roles |
|--------|-------|-------------|-------|
| Login | `/login` | Authentication | Public |
| Dashboard | `/` | Overview, status, quick actions | All |
| Config - General | `/config/general` | Basic Postfix settings | Admin |
| Config - Relay | `/config/relay` | Relay host and networks | Admin |
| Config - TLS | `/config/tls` | TLS settings | Admin |
| Config - Auth | `/config/auth` | SASL authentication | Admin |
| Config - Restrictions | `/config/restrictions` | Relay restrictions | Admin |
| Config - History | `/config/history` | Version history | All |
| Logs | `/logs` | Real-time log viewer | All |
| Alerts - Active | `/alerts` | Active alerts | All |
| Alerts - History | `/alerts/history` | Alert history | All |
| Alerts - Rules | `/alerts/rules` | Manage alert rules | Admin |
| Queue | `/queue` | Queue inspection | All |
| Audit | `/audit` | Audit log viewer | All |
| Settings - Users | `/settings/users` | User management | Admin |
| Settings - Notifications | `/settings/notifications` | Notification channels | Admin |
| Settings - System | `/settings/system` | System settings | Admin |
| Profile | `/profile` | User profile, change password | All |

### 8.2 Component Hierarchy

```
App
├── AuthProvider
│   └── Router
│       ├── PublicRoutes
│       │   └── LoginPage
│       └── ProtectedRoutes
│           ├── Layout
│           │   ├── TopNav
│           │   │   ├── Logo
│           │   │   ├── AlertBadge
│           │   │   └── UserMenu
│           │   └── SideNav
│           │       └── NavItems
│           └── Outlet
│               ├── DashboardPage
│               │   ├── StatusCards
│               │   ├── RecentAlertsPanel
│               │   ├── QueueChart
│               │   └── QuickActions
│               ├── ConfigPages
│               │   ├── ConfigTabs
│               │   ├── ConfigForm
│               │   ├── PendingChangesBanner
│               │   └── ConfigActions
│               ├── LogsPage
│               │   ├── LogToolbar
│               │   ├── VirtualLogList
│               │   └── LogDetailPanel
│               ├── AlertsPage
│               │   ├── AlertTabs
│               │   ├── AlertList
│               │   └── AlertDetailPanel
│               ├── QueuePage
│               │   ├── QueueSummary
│               │   ├── QueueTable
│               │   └── MessageDetailPanel
│               ├── AuditPage
│               │   ├── AuditFilters
│               │   └── AuditTable
│               └── SettingsPages
│                   ├── UserManagement
│                   ├── NotificationSettings
│                   └── SystemSettings
```

---

## 9. Acceptance Criteria

### 9.1 Core Acceptance Tests

| ID | Scenario | Expected Result |
|----|----------|-----------------|
| AC1 | Apply valid config | Config applied, Postfix reloaded, audit logged |
| AC2 | Apply invalid config | Apply fails with error, no change, Postfix running |
| AC3 | Rollback config | Previous config restored, Postfix reloaded |
| AC4 | Concurrent config writes | Second write blocked until first completes |
| AC5 | Log viewer responsiveness | New lines within 1s, responsive at 5k lines/min |
| AC6 | Alert on queue growth | Alert fires within 1 minute of threshold breach |
| AC7 | Acknowledge alert | No repeat notification for silence window |
| AC8 | Audit trail completeness | All admin actions logged with who/what/when |
| AC9 | RBAC enforcement | Operator cannot change config, auditor cannot acknowledge |
| AC10 | Secret masking | SASL passwords never shown to non-admin, never in audit diff |

### 9.2 Performance Criteria

| Metric | Target |
|--------|--------|
| Log ingestion rate | 5000 lines/minute sustained |
| Log viewer latency (p95) | <500ms |
| API response time (p95) | <200ms |
| WebSocket message latency | <100ms |
| Concurrent WebSocket connections | 50 |
| Database query time (p95) | <50ms |
| Memory usage (idle) | <100MB |
| Memory usage (under load) | <500MB |

### 9.3 Security Criteria

| Test | Expected Result |
|------|-----------------|
| SQL injection attempts | All blocked, logged |
| XSS payload in inputs | Sanitized, not executed |
| CSRF without token | Rejected with 403 |
| Access without auth | Rejected with 401 |
| Operator access admin endpoints | Rejected with 403 |
| Sudo command outside allowed list | Denied by sudoers |

---

## 10. Deployment Specification

### 10.1 Docker Compose (Development)

```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - APP_SECRET=${APP_SECRET:-dev-secret-change-in-prod}
      - DB_ENCRYPTION_KEY=${DB_ENCRYPTION_KEY:-dev-key-change-in-prod}
      - DB_PATH=/data/postfixrelay.db
      - LOG_LEVEL=debug
    volumes:
      - ./data:/data
      - postfix-config:/etc/postfix
      - postfix-spool:/var/spool/postfix
    depends_on:
      - postfix
    networks:
      - postfixrelay

  postfix:
    build:
      context: ./docker/postfix
      dockerfile: Dockerfile
    ports:
      - "25:25"
      - "587:587"
    volumes:
      - postfix-config:/etc/postfix
      - postfix-spool:/var/spool/postfix
    networks:
      - postfixrelay

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.dev
    ports:
      - "5173:5173"
    volumes:
      - ./frontend:/app
      - /app/node_modules
    environment:
      - VITE_API_URL=http://localhost:8080
    networks:
      - postfixrelay

volumes:
  postfix-config:
  postfix-spool:

networks:
  postfixrelay:
    driver: bridge
```

### 10.2 Production Deployment

**Systemd Service File:**
```ini
[Unit]
Description=PostfixRelay Admin Server
After=network.target postfix.service

[Service]
Type=simple
User=postfixrelay
Group=postfixrelay
ExecStart=/usr/local/bin/postfixrelay serve
Restart=always
RestartSec=5
Environment=APP_SECRET_FILE=/etc/postfixrelay/app.secret
Environment=DB_ENCRYPTION_KEY_FILE=/etc/postfixrelay/db.key
Environment=DB_PATH=/var/lib/postfixrelay/postfixrelay.db
Environment=LOG_LEVEL=info

[Install]
WantedBy=multi-user.target
```

---

## 11. Glossary

| Term | Definition |
|------|------------|
| Queue ID | Postfix's unique identifier for a mail message (e.g., ABC123DEF) |
| Relayhost | Upstream SMTP server that Postfix forwards mail to |
| mynetworks | IP ranges allowed to relay mail through this server |
| SASL | Simple Authentication and Security Layer (auth to upstream) |
| DSN | Delivery Status Notification (bounce message) |
| WAL | Write-Ahead Logging (SQLite durability mode) |

---

**End of System Design Specification**
