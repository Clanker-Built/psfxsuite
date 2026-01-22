# PostfixRelay - Debate Transcript

**Date**: 2026-01-21
**Participants**: Product/UX Lead, Security Engineer, Backend Lead, SRE/DevOps, Postfix SME, QA Lead, Architect

---

## Debate A: Product Scope & Workflows

### Topic: What "internal relay configuration" includes vs. excludes

**Product/UX Lead**: The scope must be strictly "relay" - we're not building PostfixAdmin. Users need to configure Postfix to accept mail from internal systems and relay it outbound. No mailboxes, no virtual domains for local delivery, no webmail.

**Backend Lead**: Agreed. The core scope should be:
- **IN SCOPE**: relayhost configuration, mynetworks, SASL auth to upstream, TLS settings, transport maps, sender restrictions, queue management, log monitoring
- **OUT OF SCOPE**: virtual mailboxes, aliases that deliver locally, dovecot integration, spam filtering (content), DKIM signing (initially)

**Postfix SME**: I disagree slightly - DKIM signing is increasingly required for relay servers. Even internal relays often forward to services like O365/Google that reject unsigned mail. We should include it in v1.

**Security Engineer**: DKIM means key management. That adds significant complexity and attack surface. I propose we defer to v1.1 but design the config model to accommodate it.

**Architect**: Let's resolve this. DKIM signing is important but not MVP. We'll:
1. Design the config schema to support DKIM parameters
2. Implement actual DKIM support in v1.1
3. MVP focuses on getting relay fundamentals perfect

**Decision**: DKIM deferred to v1.1, schema designed to accommodate it.

### Topic: User Personas

**Product/UX Lead**: I propose three personas:
1. **Admin**: Full control - configure relay, manage users, apply config changes
2. **Operator**: Day-to-day ops - view logs, acknowledge alerts, inspect queues, but cannot change relay configuration
3. **Auditor**: Read-only - view logs, view config (masked secrets), view audit trail, cannot perform any actions

**Security Engineer**: Auditors seeing masked secrets is fine, but we need to ensure they cannot see actual SASL passwords in any view - not in config diffs, not in audit logs.

**SRE/DevOps**: Operators need to be able to do safe operations like flushing the queue for a specific domain or putting mail on hold. These are operational, not configuration.

**QA Lead**: What about a "break-glass" scenario? If the only admin is unavailable, can an operator escalate?

**Architect**: Good point. We won't build escalation in MVP, but we'll:
1. Support multiple admin accounts from day 1
2. Document that organizations should have 2+ admins
3. Consider escalation workflow in v1.1

**Decision**: Three roles (Admin, Operator, Auditor) with clear permission boundaries.

### Topic: Must-Have Workflows

**Product/UX Lead**: Key workflows:
1. **Initial Setup Wizard**: First-run experience to configure basic relay
2. **Add Upstream Relay**: Configure relayhost with SASL credentials
3. **Enable TLS**: Configure TLS for inbound and outbound
4. **Diagnose Delivery**: Search logs by recipient/queue-id, trace a message
5. **Respond to Alert**: View alert, see context, acknowledge, link to runbook

**Postfix SME**: For "Diagnose Delivery," we need queue-id correlation. A single message can generate multiple log lines across smtp, qmgr, cleanup, bounce. The UI must correlate these.

**Backend Lead**: That means parsing and indexing log lines with queue-id extraction. We need to decide if we're storing parsed logs or parsing on-the-fly.

**SRE/DevOps**: Storing parsed logs gives better search but requires retention management. On-the-fly parsing is simpler but slower for historical queries.

**Architect**: We'll do hybrid:
1. Parse incoming logs in real-time, extract queue-id and key fields
2. Store parsed metadata in SQLite with configurable retention (default 7 days)
3. Raw logs stay in system log (journald/syslog) - we don't duplicate storage

**Decision**: Hybrid approach - parsed metadata indexed, raw logs in system log.

### Prioritized Feature List

| Priority | Feature | Persona |
|----------|---------|---------|
| **MVP** | Login + session management | All |
| **MVP** | Dashboard (status, queue summary) | All |
| **MVP** | Relay configuration (relayhost, mynetworks, TLS) | Admin |
| **MVP** | SASL upstream credentials | Admin |
| **MVP** | Config validation + apply + rollback | Admin |
| **MVP** | Real-time log viewer | Operator, Admin |
| **MVP** | Basic alerts (queue growth, auth failures) | Operator, Admin |
| **MVP** | Audit log | Auditor, Admin |
| **v1** | Transport maps (domain routing) | Admin |
| **v1** | Sender restrictions/sender-dependent relay | Admin |
| **v1** | Queue inspection (hold, release, delete) | Operator |
| **v1** | Alert notifications (email, webhook) | Admin |
| **v1** | Runbook links per alert | Admin |
| **Later** | DKIM signing configuration | Admin |
| **Later** | Multi-instance Postfix support | Admin |
| **Later** | LDAP/OIDC authentication | Admin |

### User Journey Maps

#### Journey 1: Setup Relay (Admin)
```
Login → First-Run Wizard Detected →
  Step 1: Define mynetworks (which IPs can relay) →
  Step 2: Configure relayhost (upstream SMTP) →
  Step 3: Add SASL credentials if required →
  Step 4: Configure TLS (inbound/outbound) →
  Step 5: Review & Apply →
  Validation runs → Success → Dashboard
```

#### Journey 2: Diagnose Delivery Failure (Operator)
```
Alert: "High deferred mail count" →
  Click alert → See deferred queue summary →
  Filter by status=deferred → See recipient domains →
  Click domain → See queue-ids →
  Click queue-id → See full message trace (all log lines) →
  Identify cause (e.g., upstream timeout) →
  Acknowledge alert → Link to incident ticket
```

#### Journey 3: Emergency Config Rollback (Admin)
```
Alert: "Postfix reload failed" →
  Dashboard shows "Config Error" status →
  Click "Config History" → See recent changes →
  Click previous working config → "Rollback to this version" →
  Confirm → Validation runs → Apply → Success
```

**What Could Go Wrong**:
- Wizard assumes fresh Postfix install; existing configs might conflict
- Queue-id correlation fails if log format differs (custom log_format)
- Rollback might not fix all issues if external factors changed

**Mitigation**:
- Wizard detects existing config, offers to import or warn
- Support standard Postfix log formats; document custom format limitations
- Rollback includes "pre-flight check" before applying

---

## Debate B: Architecture & Deployment Model

### Option 1: Single Binary Backend + Static Frontend

**Backend Lead**: A single Go or Node.js binary serving the API + static React build. Simple deployment, single process to manage.

**Pros**:
- Simple deployment and operations
- Single port to expose
- No inter-service communication complexity

**Cons**:
- Monolithic; harder to scale components independently
- If backend crashes, frontend unavailable

### Option 2: Separate Frontend/Backend with Reverse Proxy

**SRE/DevOps**: Nginx serving static frontend, proxying /api to backend. More flexible, standard pattern.

**Pros**:
- Can scale/update frontend and backend independently
- Nginx handles TLS termination, caching, compression efficiently

**Cons**:
- More moving parts
- Additional configuration (nginx.conf)

### Option 3: Microservices (API, Config Engine, Log Streamer, Alerter)

**Backend Lead**: I advise against this for v1. We don't have the scale requirements.

**Security Engineer**: More services = more attack surface. I oppose microservices for this use case.

**Architect Decision**: **Option 1 (Single Binary) for MVP**, with clean internal module separation that allows future extraction. In production, users can put nginx/caddy in front if they need advanced TLS or load balancing.

### Topic: Agent/Daemon Placement

**Option A**: Backend runs on Postfix host (same machine)

**Postfix SME**: This is simplest. Direct access to /etc/postfix, /var/log/mail.log, postfix commands.

**Security Engineer**: But then a vulnerability in our app could compromise the mail server directly.

**Option B**: Backend on separate host, agent on Postfix host

**SRE/DevOps**: Agent handles config writes and log streaming, backend handles UI/API/auth. More secure isolation.

**Backend Lead**: But now we have distributed system complexity - agent-backend communication, agent auth, agent updates.

**Option C**: Backend on Postfix host, no separate agent

**Architect**: For MVP (single Postfix instance), Option A is pragmatic. The backend runs on the Postfix host with appropriate privilege separation (see Security section). For future multi-instance support, we'd add an agent model.

**Decision**: **Option A for MVP** - backend on Postfix host. Design APIs so agent model can be added later.

### Topic: Docker vs Native Packages

**SRE/DevOps**: Docker provides consistent environment, easy testing, simple upgrades. But Postfix itself often runs natively.

**Postfix SME**: Running Postfix in Docker is possible but adds complexity (mail queue persistence, hostname handling). Many orgs run Postfix natively.

**QA Lead**: We need to test against real Postfix. Docker-compose with Postfix container is great for dev/CI.

**Architect Decision**:
- **Dev/Test**: Docker-compose with Postfix container (we control the environment)
- **Production**: Support both:
  - Docker image (PostfixRelay backend only, connects to native Postfix)
  - Native packages (deb/rpm) for traditional deployment
- Postfix itself runs however the org prefers (usually native)

**Decision**: Docker for dev/test; production supports Docker backend or native packages, connecting to native Postfix.

### Reference Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Postfix Host                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  PostfixRelay Backend                    │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────────┐  │   │
│  │  │  API    │ │ Config  │ │  Log    │ │    Alert     │  │   │
│  │  │ Server  │ │ Engine  │ │ Streamer│ │   Engine     │  │   │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └──────┬───────┘  │   │
│  │       │           │           │             │          │   │
│  │  ┌────┴───────────┴───────────┴─────────────┴───────┐  │   │
│  │  │              SQLite Database                      │  │   │
│  │  │  (users, sessions, config history, parsed logs,  │  │   │
│  │  │   alerts, audit trail)                           │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │              │              │                          │
│       │ sudo         │ journalctl   │ File watch               │
│       │ postfix      │ -f           │                          │
│       ▼              ▼              ▼                          │
│  ┌─────────┐   ┌───────────┐  ┌──────────────┐                │
│  │ Postfix │   │ journald/ │  │ /etc/postfix │                │
│  │ Service │   │ syslog    │  │  config dir  │                │
│  └─────────┘   └───────────┘  └──────────────┘                │
└─────────────────────────────────────────────────────────────────┘
         │
         │ SMTP (25/587)
         ▼
  ┌──────────────┐
  │   Upstream   │
  │  Relay/MX    │
  └──────────────┘

Browser ──HTTPS:443──▶ PostfixRelay Backend (serves React SPA + API)
```

### Data Flow Diagram

```
[User Action in UI]
        │
        ▼
[React Frontend] ──HTTP/WS──▶ [API Server]
        │                           │
        │                           ├──▶ [Auth Middleware] ──▶ [Session Store]
        │                           │
        │                           ├──▶ [Config Engine]
        │                           │         │
        │                           │         ├─ Read current config
        │                           │         ├─ Validate proposed changes
        │                           │         ├─ Write to temp file
        │                           │         ├─ Run postfix check
        │                           │         ├─ Atomic move to /etc/postfix
        │                           │         ├─ postfix reload (via sudo)
        │                           │         └─ Store version in DB
        │                           │
        │                           ├──▶ [Log Streamer]
        │                           │         │
        │                           │         ├─ journalctl -f -u postfix
        │                           │         ├─ Parse log lines
        │                           │         ├─ Extract queue-id, status
        │                           │         ├─ Store metadata in DB
        │                           │         └─ Push to WebSocket clients
        │                           │
        │                           └──▶ [Alert Engine]
        │                                     │
        │                                     ├─ Evaluate rules against metrics
        │                                     ├─ Create/update alerts
        │                                     └─ Send notifications
        │
        ▼
[UI Updates via WebSocket]
```

**What Could Go Wrong**:
- Single process crash takes down everything
- SQLite write contention under heavy log ingestion
- sudo privilege escalation if backend is compromised

**Mitigation**:
- Implement graceful shutdown and automatic restart (systemd)
- Use SQLite WAL mode, batch log inserts
- Constrain sudo to specific commands only (see Security section)

**How We'll Validate**:
- Load test: 5000 logs/minute, measure DB write latency
- Chaos test: kill process, verify restart and state recovery
- Security audit: verify sudo constraints work as documented

---

## Debate C: Configuration Strategy

### Topic: How to Apply Config Changes

**Option 1**: Direct edit of main.cf, master.cf

**Postfix SME**: Postfix reads main.cf on `postfix reload`. Direct editing works but risks corruption if writes fail mid-file.

**Security Engineer**: Direct editing also means our app needs write access to sensitive config files. Any bug could destroy the config.

**Option 2**: Managed include files

**Postfix SME**: We can use `postconf -e` to set parameters, or create a `postfixrelay.cf` and add `alternate_config_directories` or use parameter overrides.

**Backend Lead**: Actually, Postfix doesn't support include files in the traditional sense. We'd need to manage the entire file or use `postconf` commands.

**Postfix SME**: Correct. `postconf -e param=value` modifies main.cf directly but atomically for single parameters. For complex changes, we'd need to rewrite the file.

**Option 3**: Template generation + atomic write + validation + rollback

**Architect**: This is the safest approach:
1. Read current config
2. Generate new config in memory/temp file
3. Validate with `postfix check`
4. Atomic rename to replace config
5. `postfix reload`
6. Store previous version for rollback

**Backend Lead**: For atomic writes, we write to a temp file in the same directory (/etc/postfix/.main.cf.tmp), then `rename()` which is atomic on POSIX.

**Decision**: **Option 3** - Template generation with atomic write and validation.

### Configuration Management Plan

```
1. Read Phase
   ├─ postconf -n  (current non-default settings)
   ├─ Parse main.cf (preserve comments, structure where possible)
   └─ Load current values into UI

2. Edit Phase (in UI)
   ├─ User modifies parameters via structured forms
   ├─ Client-side validation (format, required fields)
   └─ Generate preview diff

3. Validation Phase
   ├─ Write proposed config to /etc/postfix/.main.cf.pending
   ├─ Run: postfix check -c /etc/postfix (with pending file)
   ├─ If validation fails: return errors, delete pending file
   └─ Compile map files if needed (postmap)

4. Apply Phase
   ├─ Backup current: cp main.cf main.cf.$(timestamp)
   ├─ Store in DB: config version with full content and metadata
   ├─ Atomic move: mv .main.cf.pending main.cf
   ├─ Run: postfix reload
   ├─ Verify: postfix status (confirm running)
   └─ If reload fails: automatic rollback to previous

5. Rollback Phase (if needed or manual)
   ├─ Retrieve previous version from DB or backup file
   ├─ Write to .main.cf.rollback, validate
   ├─ Atomic replace
   └─ postfix reload
```

### Locking Strategy

**Backend Lead**: Concurrent config writes must be prevented.

**Option A**: File-based lock (flock)

**Option B**: Database lock (row-level in SQLite)

**Option C**: In-memory mutex in application

**SRE/DevOps**: If we're single-process, in-memory mutex works. But if someone runs two backend instances...

**Architect**: We're single-instance for MVP. Use in-memory mutex backed by a file lock for safety:
1. Acquire flock on /etc/postfix/.postfixrelay.lock
2. Perform all config operations
3. Release lock

**Decision**: flock-based locking on dedicated lock file.

### Validation Strategy

**Postfix SME**: Validation commands:
- `postfix check` - validates main.cf syntax and some semantics
- `postconf -n` - shows current active config (for verification)
- `postmap -q test@domain hash:/etc/postfix/transport` - validates map files

**QA Lead**: We should also validate at the application level:
- IP address format for mynetworks
- Hostname format for relayhost
- TLS parameters are valid combinations
- Credential format (username/password not empty)

**Decision**: Two-layer validation:
1. App-level: format and semantic validation
2. Postfix-level: `postfix check` after writing

### Secrets Handling

**Security Engineer**: SASL passwords for upstream relay must be protected.

**Postfix SME**: Postfix stores SASL credentials in `/etc/postfix/sasl_passwd`, then compiled to `sasl_passwd.db`. The plaintext file can be removed after compilation, but we need it for management.

**Security Engineer Options**:
1. Store encrypted in our DB, decrypt only when writing sasl_passwd
2. Store in system keyring, retrieve at write time
3. Store in sasl_passwd with strict file permissions (600, root-owned)

**Backend Lead**: System keyring varies by distro. Option 1 (encrypted DB) is most portable.

**Architect Decision**:
- Store SASL passwords encrypted (AES-256-GCM) in SQLite
- Encryption key derived from app secret (environment variable or file)
- When applying config, decrypt and write to sasl_passwd with mode 600
- Immediately run `postmap sasl_passwd` to compile
- sasl_passwd file owned by root, mode 600

**Decision**: Encrypted storage in DB, file written with strict perms at apply time.

### Audit Trail

**Security Engineer**: Every config change must be logged:
- Who (user ID, username)
- When (timestamp, UTC)
- What (parameter changed, old value, new value)
- Outcome (success/failure, error message)

**Backend Lead**: We'll store:
```sql
CREATE TABLE config_audit (
  id INTEGER PRIMARY KEY,
  timestamp DATETIME NOT NULL,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL,  -- 'update', 'rollback', 'apply'
  config_version_id INTEGER,
  summary TEXT,  -- human-readable summary
  diff TEXT,  -- unified diff format
  status TEXT,  -- 'success', 'failed'
  error_message TEXT
);
```

**Security Engineer**: Secrets must not appear in diff. Mask them.

**Decision**: Comprehensive audit trail with masked secrets in diffs.

**What Could Go Wrong**:
- Validation passes but reload still fails (e.g., port already bound)
- Rollback fails (disk full, permissions)
- Race condition if two admins edit simultaneously

**Mitigation**:
- Post-reload health check, alert if Postfix stops
- Pre-check disk space before operations
- flock prevents races; UI shows "config locked by [user]"

**How We'll Validate**:
- Test: corrupt config intentionally, verify apply fails cleanly
- Test: simulate disk full during write, verify rollback works
- Test: two concurrent apply requests, verify one blocked

---

## Debate D: Log Monitoring (Real-time)

### Topic: Log Source

**Option 1**: Tail /var/log/mail.log (traditional syslog)

**Postfix SME**: Traditional path. File-based, works everywhere.

**SRE/DevOps**: But file path varies: /var/log/mail.log (Debian), /var/log/maillog (RHEL), or custom path.

**Option 2**: journalctl -u postfix (systemd journal)

**Backend Lead**: Modern systems use journald. `journalctl -u postfix -f --output=json` gives structured output.

**SRE/DevOps**: But some distros still use rsyslog even with systemd.

**Option 3**: Support both with auto-detection

**Architect**: This is the right approach:
1. Detect if journald is available and has postfix logs
2. If yes, use `journalctl -u postfix -f`
3. If no, fall back to file tail (/var/log/mail.log or configured path)

**Decision**: Auto-detect journald vs syslog file; configurable fallback path.

### Topic: Streaming Protocol

**Option A**: WebSockets

**Backend Lead**: Full-duplex, can send commands (pause, resume, filter). Well-supported in browsers.

**Frontend Lead**: React + WebSocket is straightforward. Libraries like socket.io or native WebSocket.

**Option B**: Server-Sent Events (SSE)

**Backend Lead**: Simpler than WebSocket (HTTP-based), but only server→client. Sufficient for log streaming.

**Security Engineer**: SSE works through most proxies. WebSocket can have issues with some corporate proxies.

**Architect**: Both are viable. WebSocket gives us bidirectional capability for future features (remote commands). SSE is simpler if we only need push.

**Backend Lead**: For MVP, we need: stream logs, pause/resume, apply filters. Pause/resume can be client-side (just stop rendering). Filters can be query params on connection.

**Decision**: **WebSocket** for flexibility, with graceful fallback handling.

### Topic: Indexing/Search

**Option A**: In-memory ring buffer (recent N lines only)

**Backend Lead**: Fast, no persistence complexity. But lose history on restart.

**Option B**: SQLite with parsed log entries

**SRE/DevOps**: Persistent, searchable, but write amplification.

**Option C**: Elasticsearch/OpenSearch

**Backend Lead**: Overkill for single-instance relay. Adds significant operational complexity.

**Architect**: SQLite is appropriate for our scale. We'll:
1. Parse logs into structured records (timestamp, queue_id, component, message, severity)
2. Insert into SQLite with indexes on queue_id, timestamp
3. Configurable retention (default 7 days, auto-purge old records)
4. For real-time view, also maintain in-memory ring buffer (last 1000 lines)

**Decision**: SQLite for persistence with in-memory buffer for real-time view.

### Log Parsing Strategy

**Postfix SME**: Standard Postfix log line format:
```
Jan 21 10:30:45 mailhost postfix/smtp[12345]: ABC123: to=<user@example.com>, relay=mail.example.com[1.2.3.4]:25, delay=0.5, status=sent
```

Components:
- Timestamp
- Hostname
- Process (postfix/smtp, postfix/qmgr, postfix/cleanup, postfix/bounce)
- PID
- Queue ID (ABC123)
- Message (key=value pairs)

**Backend Lead**: Regex to extract:
```
^(\w+\s+\d+\s+[\d:]+)\s+(\S+)\s+postfix/(\w+)\[(\d+)\]:\s+([A-Z0-9]+):\s+(.*)$
```

For queue_id, extract from position 5. Parse message for key-value pairs.

**QA Lead**: What about multi-line messages or non-standard formats?

**Postfix SME**: Postfix logs are single-line. Custom syslog templates could vary format, but that's edge case.

**Decision**: Parse standard format; document that custom syslog templates may not parse correctly.

### Real-time UX Requirements

**Product/UX Lead**: Log viewer features:
- Live tail (auto-scroll with new entries)
- Pause button (stop auto-scroll, buffer incoming)
- Resume (catch up to live)
- Search box (filter visible logs)
- Severity filter (error, warning, info)
- Time range filter (last 15min, 1h, 24h, custom)
- Queue-ID click → show all related log lines
- Export visible logs (CSV, JSON)

**Frontend Lead**: For performance with high log volume:
- Virtual scrolling (only render visible rows)
- Debounce search input
- Limit rendered rows (show newest N, "load more" for older)

**Decision**: Implement all listed features with virtual scrolling for performance.

### Backpressure Strategy

**Backend Lead**: If logs come faster than we can process:
1. In-memory buffer has max size (e.g., 10,000 lines)
2. If buffer full, drop oldest entries (not newest)
3. Log a warning if we're dropping entries
4. SQLite writes batched (every 100 entries or 1 second)

**SRE/DevOps**: We should expose metrics: log ingestion rate, buffer utilization, dropped entries.

**Decision**: Bounded buffer, batch writes, metrics for monitoring.

### Retention Policy

**SRE/DevOps**: Default retention: 7 days of parsed logs in SQLite. Configurable by admin. Purge job runs daily.

**Security Engineer**: Audit logs (our app's actions) should have longer retention, configurable separately.

**Decision**:
- Parsed mail logs: 7 days default, configurable
- Audit logs: 90 days default, configurable
- Purge runs daily via background job

**What Could Go Wrong**:
- Log rotation causes missed entries (file moves under us)
- journalctl spawns per-connection, resource exhaustion
- SQLite locks during heavy write

**Mitigation**:
- Use inotify for file-based tailing; reconnect on rotation
- Single journalctl process, fan out to WebSocket clients
- SQLite WAL mode, batch inserts

**How We'll Validate**:
- Test: generate 5000 logs/minute, verify UI remains responsive
- Test: rotate log file, verify no gaps in stream
- Test: disk full, verify graceful degradation

---

## Debate E: Alerting & Detection

### Topic: Rule Engine Style

**Option A**: Simple thresholds (value > X for Y minutes)

**Backend Lead**: Easy to implement, easy to understand. Covers most cases.

**Option B**: Pluggable detectors (rate of change, anomaly detection)

**SRE/DevOps**: More powerful but more complex. Anomaly detection needs baseline period.

**Architect**: MVP uses simple thresholds. Design the rule interface to allow more sophisticated detectors later.

**Decision**: Simple thresholds for MVP, extensible interface for future.

### Alert Events Catalog

**Postfix SME & SRE/DevOps** collaborate on this list:

| Event | Detection Method | Default Threshold | Severity |
|-------|------------------|-------------------|----------|
| Queue growth | `mailq | wc -l` | >100 messages for 5 min | Warning |
| Queue growth (critical) | Same | >500 messages for 5 min | Critical |
| Deferred mail spike | Count status=deferred in logs | >50/hour | Warning |
| Auth failures | Count "authentication failed" in logs | >10/hour | Warning |
| TLS failures | Count "TLS handshake failed" in logs | >20/hour | Warning |
| Upstream unreachable | Connection timeout to relayhost | 3 consecutive failures | Critical |
| Config error | postfix check exit code | Non-zero | Critical |
| High bounce rate | Count bounces / total sent | >10% over 1 hour | Warning |
| Disk space low | df /var/spool/postfix | <10% free | Warning |
| Postfix not running | systemctl is-active postfix | Not active | Critical |
| Log ingestion lag | Time since last parsed log | >60 seconds | Warning |

**Security Engineer**: Auth failures could indicate brute force. Should we add rate limiting at the Postfix level?

**Postfix SME**: Postfix has `smtpd_client_connection_rate_limit`. Our app should monitor and alert, but rate limiting is a Postfix config the admin can set.

**Decision**: All events in the table are MVP alerts. Rate limiting configuration is available but not enforced by default.

### Notification Channels

**Product/UX Lead**: Notifications needed:
1. **UI**: Always - badge, toast, alert panel
2. **Email**: Admin configures SMTP (can use the relay itself!)
3. **Webhook**: Generic HTTP POST for integration
4. **Slack**: Webhook URL for Slack
5. **PagerDuty**: Integration key for PD

**Backend Lead**: Email and Webhook cover MVP. Slack is a webhook. PagerDuty can wait for v1.

**Decision**: MVP: UI + Email + Webhook. v1 adds native Slack and PagerDuty integrations.

### Alert Lifecycle

**SRE/DevOps**: Alert states:
1. **Firing**: Condition met, alert active
2. **Acknowledged**: Operator saw it, working on it
3. **Resolved**: Condition no longer met (auto or manual)
4. **Silenced**: Temporarily suppressed

**Product/UX Lead**: Acknowledgement should:
- Record who acknowledged
- Suppress repeat notifications for configurable window (default 1 hour)
- Require note/reason

**Decision**: Implement full lifecycle with acknowledgement and silence windows.

### Runbook Links

**SRE/DevOps**: Each alert type should link to a runbook with:
- What this alert means
- Possible causes
- Diagnostic steps
- Remediation steps

**Product/UX Lead**: Initially, we provide default runbook content (stored in app). Admins can customize or link to external URLs.

**Decision**: Built-in runbook content for each alert type, customizable.

**What Could Go Wrong**:
- Alert storms (one issue triggers many alerts)
- Notification failures (email fails, webhook timeout)
- False positives annoy users, alert fatigue

**Mitigation**:
- Alert grouping: similar alerts within 5 min grouped
- Notification retry with exponential backoff
- Threshold tuning guidance; silence feature for known issues

**How We'll Validate**:
- Test: spike deferred mail, verify alert fires within 1 minute
- Test: acknowledge alert, verify no repeat notification for window
- Test: webhook endpoint down, verify retry and eventual alerting on retry failure

---

## Debate F: Security Model

### Topic: Authentication Method

**Option A**: Local accounts (username/password in DB)

**Security Engineer**: Simplest. Passwords hashed with Argon2id. Good for small teams.

**Option B**: LDAP/AD integration

**Backend Lead**: Adds complexity but important for enterprise. Requires LDAP library, connection pooling.

**Option C**: OIDC/SAML (Google, Okta, etc.)

**Security Engineer**: Modern, delegates auth to IdP. But requires external configuration.

**Architect**: MVP with local accounts. Design auth module to support LDAP and OIDC in v1.1.

**Decision**: Local accounts for MVP; pluggable auth for future providers.

### Password Requirements

**Security Engineer**:
- Minimum 12 characters
- Argon2id hashing (memory=64MB, iterations=3, parallelism=4)
- Enforce password change every 90 days (configurable, can disable)
- Lock account after 5 failed attempts for 15 minutes
- No password reuse (last 5)

**Product/UX Lead**: Password change on first login for admin-created accounts.

**Decision**: Implemented as specified.

### RBAC Permissions Matrix

| Action | Admin | Operator | Auditor |
|--------|-------|----------|---------|
| View dashboard | Yes | Yes | Yes |
| View logs | Yes | Yes | Yes |
| Search logs | Yes | Yes | Yes |
| View config (secrets masked) | Yes | Yes | Yes |
| View config (secrets visible) | Yes | No | No |
| Edit config | Yes | No | No |
| Apply config | Yes | No | No |
| Rollback config | Yes | No | No |
| View alerts | Yes | Yes | Yes |
| Acknowledge alerts | Yes | Yes | No |
| Silence alerts | Yes | Yes | No |
| Configure alert rules | Yes | No | No |
| Manage queue (hold/release) | Yes | Yes | No |
| Delete from queue | Yes | No | No |
| View audit log | Yes | Yes | Yes |
| Manage users | Yes | No | No |
| System settings | Yes | No | No |

**Decision**: Permissions as defined in matrix.

### Session Management

**Security Engineer**:
- Session token: 256-bit random, stored hashed in DB
- Session lifetime: 8 hours (configurable)
- Sliding expiration: activity extends session
- Single session per user (new login invalidates old)
- Secure cookie flags: HttpOnly, Secure (if HTTPS), SameSite=Strict

**Decision**: Implemented as specified.

### API Security

**Security Engineer**:
- CSRF protection: token-based (stored in session, sent in header)
- CORS: Allow only configured origins (default: same-origin)
- Rate limiting: 100 requests/minute per user, 1000/minute total
- Input validation: All inputs validated, sanitized
- SQL injection: Parameterized queries only
- XSS: Content-Type headers, CSP header, output encoding

**Backend Lead**: Rate limiting per endpoint? Some endpoints (log stream) are high-frequency.

**Security Engineer**: WebSocket connections exempt from per-request limit. API endpoints get standard limit.

**Decision**: Comprehensive API security as listed.

### Threat Model

| Threat | Attack Vector | Mitigation | Risk Level |
|--------|---------------|------------|------------|
| Credential theft | Brute force login | Account lockout, rate limiting, strong passwords | Medium |
| Session hijacking | Cookie theft | Secure cookies, session binding to IP (optional) | Medium |
| Privilege escalation | Exploit bug to bypass RBAC | Defense in depth, server-side permission checks | Medium |
| Config injection | Malicious input in config values | Strict validation, postfix check | High |
| Log injection | Attacker sends crafted email headers | Log parsing, no execution of log content | Low |
| CSRF | Forged requests from other sites | CSRF tokens, SameSite cookies | Medium |
| XSS | Injected script in UI | CSP, output encoding, sanitization | Medium |
| Local privilege escalation | Compromise app, escalate to root | Constrained sudo, least privilege | High |
| Denial of service | Flood API | Rate limiting, resource limits | Medium |
| Data exfiltration | Attacker reads secrets from DB | Encryption at rest, strict file perms | Medium |

**Security Engineer**: The highest risks are config injection and local privilege escalation. These need extra attention.

### Sudo Configuration

**Security Engineer**: The backend needs elevated privileges for:
1. Read Postfix logs (journalctl or log file)
2. Read/write Postfix config
3. Reload Postfix
4. Query queue (mailq)

**SRE/DevOps**: Create a dedicated user `postfixrelay` with minimal sudo:

```sudoers
# /etc/sudoers.d/postfixrelay
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postfix check
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postfix reload
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postconf -n
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postmap *
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postqueue -p
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postsuper -h *
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postsuper -H *
postfixrelay ALL=(root) NOPASSWD: /usr/sbin/postsuper -d *
postfixrelay ALL=(root) NOPASSWD: /bin/journalctl -u postfix *
```

**Security Engineer**: The `postsuper` wildcards are dangerous. `-d *` can delete any queue message. Should constrain further.

**Postfix SME**: We can't easily constrain queue-id patterns. Mitigation: RBAC ensures only Admin can delete, Operator can hold/release.

**Decision**: Constrained sudo as shown; RBAC provides additional layer.

### Secret Storage

**Security Engineer**: App secrets to protect:
1. Session encryption key
2. Database encryption key (for SASL passwords)
3. SMTP credentials (for sending alert emails)
4. Webhook secrets

**Options**:
- Environment variables (simple, container-friendly)
- File with strict permissions
- System keyring (varies by OS)

**Architect**: Environment variables for primary secrets (APP_SECRET, DB_ENCRYPTION_KEY). Documented requirement: these must not be logged or exposed.

**Decision**: Primary secrets from environment; strict documentation on protecting them.

**What Could Go Wrong**:
- Environment variable leaked in error message or log
- Sudo misconfiguration allows unintended commands
- Session fixation if token not regenerated on login

**Mitigation**:
- Never log environment variables; sanitize error messages
- Test sudoers file with specific deny cases
- Regenerate session token on successful login

**How We'll Validate**:
- Pentest: attempt all OWASP Top 10 attacks
- Test: attempt sudo commands outside allowed list, verify denied
- Audit: review all places secrets could be logged

---

## Debate G: Backend Tech Stack

### Option 1: Node.js with Fastify

**Backend Lead**: JavaScript/TypeScript. Excellent async performance. Fastify is fast and low-overhead. Large ecosystem.

**Pros**:
- Same language as frontend (TypeScript everywhere)
- Great async model for WebSocket streams
- Rich ecosystem (auth libraries, etc.)

**Cons**:
- Not compiled; larger attack surface
- Runtime errors possible despite TypeScript

### Option 2: Go

**Backend Lead**: Compiled, single binary. Excellent concurrency with goroutines. Strong stdlib.

**Pros**:
- Single binary deployment
- Very fast, low memory
- Strong typing, compile-time checks
- Built-in WebSocket support

**Cons**:
- Different language than frontend
- Less mature ORM ecosystem (though we're using SQLite)

### Option 3: Python with FastAPI

**Backend Lead**: Modern async Python. Good for rapid development.

**Pros**:
- Clean, readable code
- FastAPI auto-generates OpenAPI docs
- Good async support

**Cons**:
- Slower than Go/Node.js for compute
- Dependency management (venv/pip) can be messy
- GIL limits true parallelism

### Debate

**Security Engineer**: Go produces a single binary with no external dependencies. Smaller attack surface. I favor Go.

**SRE/DevOps**: Go's single binary simplifies deployment. No runtime to install. I agree with Go.

**Backend Lead**: I'm comfortable with both Node.js and Go. For long-running streams, both handle well. Go's compiler catches more errors.

**Frontend Lead**: TypeScript backend would allow code sharing (types, validation schemas). But it's not a dealbreaker.

**QA Lead**: Testing in Go is straightforward. No mocking framework magic needed.

**Architect**: The team consensus leans Go. Benefits:
- Single binary deployment
- Strong typing
- Excellent concurrency model for log streaming
- Smaller attack surface

**Decision**: **Go** for the backend.

### Go Framework & Libraries

**Backend Lead**: Proposed stack:
- **HTTP Router**: chi (lightweight, middleware-friendly) or Echo
- **WebSocket**: gorilla/websocket
- **SQLite**: modernc.org/sqlite (pure Go, no CGO) or mattn/go-sqlite3 (CGO)
- **Auth**: Roll our own (bcrypt/argon2 + session management)
- **Config**: Viper
- **Logging**: zerolog (structured, fast)

**SRE/DevOps**: Pure Go SQLite (no CGO) simplifies cross-compilation and deployment. Slight performance hit but acceptable for our scale.

**Decision**: chi router, gorilla/websocket, modernc.org/sqlite, zerolog.

### Database: SQLite vs PostgreSQL

**Backend Lead**: SQLite pros:
- Zero configuration
- Single file (easy backup)
- Sufficient for single-instance deployment

**SRE/DevOps**: PostgreSQL pros:
- Better concurrent write handling
- Better for future multi-instance

**Architect**: Our workload is mostly reads (log viewing) with batched writes (log ingestion). SQLite with WAL mode handles this well. We're not building multi-tenant SaaS.

**Decision**: **SQLite** for MVP. Schema designed to allow Postgres migration if needed later.

### API Style

**Backend Lead**: REST is appropriate. We're not Facebook with deeply nested data.

Endpoints structured as:
- `/api/v1/auth/*` - Authentication
- `/api/v1/config/*` - Configuration management
- `/api/v1/logs/*` - Log retrieval (REST) + `/api/v1/logs/stream` (WebSocket)
- `/api/v1/alerts/*` - Alert management
- `/api/v1/queue/*` - Queue inspection
- `/api/v1/audit/*` - Audit log
- `/api/v1/users/*` - User management

**Decision**: REST with WebSocket for log streaming. OpenAPI spec generated.

### Versioning Strategy

**Backend Lead**: API versioned in URL path (`/api/v1/`). Breaking changes require v2. Non-breaking additions don't bump version.

**Decision**: URL-based versioning, semantic versioning for releases.

**What Could Go Wrong**:
- SQLite performance degrades with millions of log rows
- CGO-free SQLite has subtle differences
- Go error handling verbose, easy to miss checks

**Mitigation**:
- Retention policy limits log rows; benchmark at 10M rows
- Test with pure Go SQLite early
- Use errcheck linter; never ignore errors

**How We'll Validate**:
- Benchmark: 10M log rows, measure query time
- Test: concurrent writes (50 goroutines), verify no corruption
- Lint: errcheck in CI fails build on unchecked errors

---

## Debate H: Frontend UX & Design System

### Component Library Options

**Option A**: MUI (Material UI)

**Frontend Lead**: Comprehensive, well-documented. Material design is recognizable.

**Cons**: Large bundle size, opinionated Material aesthetic.

**Option B**: Chakra UI

**Frontend Lead**: Good accessibility defaults, themeable. Lighter than MUI.

**Cons**: Smaller ecosystem than MUI.

**Option C**: Tailwind + Headless UI

**Frontend Lead**: Utility-first CSS, maximum flexibility. Headless UI for accessible primitives.

**Cons**: More work to build components; less consistency out of box.

**Option D**: shadcn/ui

**Frontend Lead**: Copy-paste components built on Radix UI + Tailwind. Not a dependency - you own the code.

**Pros**: Full control, good defaults, accessible, modern aesthetic

**Cons**: More manual setup initially

### Debate

**Product/UX Lead**: We want a clean, professional look. Not consumer-app flashy. Admin dashboard aesthetic.

**Security Engineer**: Any library needs security review. Popular libraries with good maintenance are safer.

**Frontend Lead**: shadcn/ui appeals to me - we own the code, can customize deeply, based on well-maintained Radix primitives. Tailwind is widely used.

**QA Lead**: Testing is easier when we own the component code. Can assert on implementation details if needed.

**Architect**: The trend is toward shadcn/ui for serious applications. Let's use it.

**Decision**: **shadcn/ui** (Radix UI + Tailwind CSS)

### State Management

**Frontend Lead**: Options:
- React Context + useReducer (simple, built-in)
- Zustand (minimal, pragmatic)
- Redux Toolkit (comprehensive, more boilerplate)

For our app scale, Zustand is right-sized. We don't have complex state cascades.

**Decision**: **Zustand** for global state; React Query for server state.

### Real-time Views

**Frontend Lead**: Log viewer requirements:
- Virtual scrolling: react-window or @tanstack/react-virtual
- Theme support: Tailwind dark mode (class-based)
- WebSocket integration: native WebSocket + Zustand store

**Decision**: @tanstack/react-virtual for virtualization; Tailwind dark mode.

### UI Wireframe Descriptions

#### Screen: Login
- Centered card with logo
- Email/username field, password field
- "Sign in" button
- Error message area
- "Forgot password" link (if local accounts)

#### Screen: Dashboard
- Top nav: Logo, user menu (profile, logout)
- Side nav: Dashboard, Config, Logs, Alerts, Queue, Audit, Settings
- Main content:
  - Status cards: Postfix status (running/stopped), Queue count, Last reload, Config status
  - Recent alerts panel (last 5)
  - Queue summary chart (last 24h)
  - Quick actions: Reload config, View logs

#### Screen: Configuration
- Tabs: General, Relay, TLS, Authentication, Restrictions, Advanced
- Form fields for each setting with labels, help text
- "Pending changes" indicator
- Actions: Preview diff, Validate, Apply, Discard

#### Screen: Log Viewer
- Top bar: Search input, severity filter, time range selector, pause/play toggle
- Main area: Virtual scrolling log list
  - Each line: timestamp, severity icon, process, message
  - Click line → expand to show full detail + queue trace
- Right panel (collapsible): Queue-ID context viewer

#### Screen: Alerts
- Tab: Active (firing + acknowledged), History
- Alert cards showing: severity icon, title, since time, acknowledge button
- Click alert → side panel with details, runbook, related logs

#### Screen: Queue
- Summary cards: Active, Deferred, Hold, Corrupt
- Table: queue-id, sender, recipient, status, time in queue
- Actions: Hold, Release, Delete (with confirmation)
- Search/filter by sender, recipient, domain

#### Screen: Audit Log
- Table: timestamp, user, action, target, status
- Filters: user, action type, date range
- Click row → expand for full diff/details

#### Screen: Settings (Admin only)
- Tabs: Users, Alerts, Notifications, System
- User management: list, add, edit, delete
- Alert rule configuration
- Notification channel setup (email, webhook)
- System settings (retention, paths)

### Accessibility Requirements

**Product/UX Lead**: WCAG 2.1 AA compliance:
- Keyboard navigation: all interactive elements focusable, logical tab order
- Color contrast: 4.5:1 for normal text, 3:1 for large text
- ARIA labels on icons, buttons, form fields
- Screen reader support: announcements for alerts, status changes
- Focus visible: clear focus indicators
- Skip links: skip to main content

**Decision**: Accessibility is mandatory, tested in CI with axe-core.

**What Could Go Wrong**:
- Virtual scrolling breaks accessibility (wrong ARIA roles)
- Dark mode contrast issues
- Complex forms confuse screen readers

**Mitigation**:
- Use aria-rowcount, aria-rowindex for virtual lists
- Test both themes for contrast
- Form labels, fieldsets, error descriptions all properly associated

**How We'll Validate**:
- Automated: axe-core in Jest/Playwright
- Manual: keyboard-only navigation test
- Manual: VoiceOver/NVDA testing on key flows

---

## Debate I: Testing & Quality Bar

### Test Layers

**QA Lead**: Proposed test strategy:

| Layer | Scope | Tools | Coverage Target |
|-------|-------|-------|-----------------|
| Unit | Functions, utilities | Go: testing, testify; TS: Vitest | 80% |
| Integration | API endpoints, DB | Go: httptest, testcontainers | 70% |
| E2E | Full user flows | Playwright | Key flows 100% |
| Performance | Log ingestion, API latency | k6, custom benchmarks | Pass defined thresholds |

### Postfix Test Harness

**QA Lead**: We need a real Postfix to test against. Docker container with:
- Postfix installed
- Our app's config writes work
- Can send/receive test mail (local delivery or relay to mock SMTP)

**SRE/DevOps**: I'll create a Dockerfile based on alpine/Postfix. We can run it in CI.

**Postfix SME**: Test scenarios:
- Apply valid config → Postfix reloads successfully
- Apply invalid config → Postfix check fails, no reload, no corruption
- Rollback → previous config restored
- Log generation → app parses correctly

**Decision**: Dockerized Postfix in CI; test scenarios as listed.

### Load Testing for Log Streams

**QA Lead**: Use k6 or custom Go load generator:
- Target: 5000 logs/minute sustained
- Metrics: WebSocket latency (p50, p95, p99), UI responsiveness, memory usage
- Pass criteria: p95 latency <500ms, no memory leak over 1 hour

**Decision**: k6 for load testing; thresholds as defined.

### CI Pipeline Gates

**Backend Lead & QA Lead** collaborate:

```
Pipeline Stages:
1. Lint & Format
   - Go: golangci-lint (includes errcheck, staticcheck)
   - TS: ESLint, Prettier
   - Fail on any issue

2. Unit Tests
   - Go: go test ./... -race
   - TS: vitest run
   - Fail if coverage < 80% on changed files

3. Build
   - Go: go build
   - TS: vite build
   - Fail on any error

4. Integration Tests
   - Spin up Postfix container
   - Run API tests against real backend
   - Fail on any assertion failure

5. E2E Tests
   - Spin up full stack (Docker Compose)
   - Run Playwright tests
   - Fail on any test failure

6. Security Scan
   - Go: gosec
   - TS: npm audit
   - Fail on high/critical vulnerabilities

7. Accessibility
   - Run axe-core on built frontend
   - Fail on any violation
```

### Definition of Done

**QA Lead**: A feature is done when:
- [ ] Code written and self-reviewed
- [ ] Unit tests pass (coverage target met)
- [ ] Integration tests pass
- [ ] E2E test added for user-facing flows
- [ ] No lint errors or warnings
- [ ] No security scan issues
- [ ] Accessibility passes
- [ ] API documented (OpenAPI updated)
- [ ] Runbook updated if applicable
- [ ] Peer review approved

**Decision**: DoD as listed; enforced via PR checklist.

**What Could Go Wrong**:
- Flaky E2E tests slow down CI
- Postfix container behavior differs from production
- Coverage gaming (testing trivial code to hit numbers)

**Mitigation**:
- Retry flaky tests once; track flakiness, fix promptly
- Document supported Postfix versions; test on multiple in matrix
- Review coverage reports; coverage on meaningful code only

**How We'll Validate**:
- Monitor CI pass rate; target >95% green builds
- Audit coverage reports quarterly
- Track bug escape rate (bugs found in prod that tests missed)

---

## Debate J: Observability & Ops

### Application Metrics

**SRE/DevOps**: Prometheus-format metrics exposed at `/metrics`:

```
# Postfix metrics (polled periodically)
postfixrelay_queue_active_count
postfixrelay_queue_deferred_count
postfixrelay_queue_hold_count
postfixrelay_queue_size_bytes
postfixrelay_postfix_up (1 = running, 0 = stopped)
postfixrelay_last_reload_timestamp_seconds
postfixrelay_last_reload_success (1 = success, 0 = failed)

# Log ingestion metrics
postfixrelay_logs_ingested_total
postfixrelay_logs_parse_errors_total
postfixrelay_logs_buffer_size
postfixrelay_logs_dropped_total

# API metrics
postfixrelay_http_requests_total{method, path, status}
postfixrelay_http_request_duration_seconds{method, path}

# WebSocket metrics
postfixrelay_websocket_connections_current
postfixrelay_websocket_messages_sent_total

# Alert metrics
postfixrelay_alerts_firing_count
postfixrelay_alerts_acknowledged_count
postfixrelay_notifications_sent_total{channel}
postfixrelay_notifications_failed_total{channel}

# Auth metrics
postfixrelay_auth_success_total
postfixrelay_auth_failures_total
postfixrelay_sessions_active_count
```

**Decision**: All metrics listed above exposed at `/metrics`.

### Health Checks

**SRE/DevOps**: Endpoints for orchestration:

**`GET /healthz`** - Liveness probe
- Returns 200 if process is running and can serve requests
- Does not check dependencies

**`GET /readyz`** - Readiness probe
- Returns 200 if:
  - SQLite database accessible
  - Postfix is running (can check status)
  - Log ingestion is working
- Returns 503 with JSON body explaining what's not ready

**Decision**: Liveness and readiness probes as specified.

### Application Logging

**Backend Lead**: Our own application logs (not Postfix logs):
- Structured JSON logging (zerolog)
- Fields: timestamp, level, message, request_id, user_id (if applicable), error (if applicable)
- Levels: DEBUG, INFO, WARN, ERROR
- Output: stdout (12-factor app style)

**Decision**: Structured JSON logs to stdout.

### Distributed Tracing

**SRE/DevOps**: For MVP, we're single-process, so distributed tracing isn't critical. We'll add request IDs to logs for correlation.

**Decision**: Request ID in all logs; defer OpenTelemetry tracing to v1.1.

### Backup & Recovery

**SRE/DevOps**: What needs backup:
- SQLite database (users, sessions, config history, parsed logs, alerts)
- Postfix config directory (/etc/postfix)

Backup strategy:
- Daily SQLite backup (sqlite3 .backup command)
- Config backed up before every change (in DB)
- Document restore procedure

**Decision**: Document backup/restore; provide backup script.

### Upgrade Path

**SRE/DevOps**: Upgrade procedure:
1. Stop service
2. Backup database
3. Replace binary
4. Run migrations (embedded in binary, auto-run on startup)
5. Start service
6. Verify health

**Decision**: Migrations embedded; auto-run on startup with version check.

**What Could Go Wrong**:
- Metrics endpoint exposed without auth
- Migration fails, app won't start
- Log ingestion fails silently

**Mitigation**:
- Metrics endpoint has separate auth option (basic auth or token)
- Migration failure logged clearly; manual rollback documented
- Log ingestion health reflected in readiness probe

**How We'll Validate**:
- Test: Prometheus can scrape metrics endpoint
- Test: simulate failed migration, verify clear error message
- Test: stop journalctl, verify readiness probe fails

---

# End of Debate Transcript

**Architect Summary**: All sections debated with multiple perspectives. Decisions documented with rationales and validation criteria. Ready to proceed to System Design Spec.
