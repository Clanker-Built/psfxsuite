# PostfixRelay - Implementation Plan

**Version**: 1.0.0
**Date**: 2026-01-21

---

## Overview

Implementation is divided into milestones, each delivering a usable increment. MVP delivers core functionality; v1 completes the full feature set.

---

## Milestone 0: Project Scaffold (Current)

**Goal**: Set up project structure, tooling, and development environment.

### Tasks

| ID | Task | Owner | Status |
|----|------|-------|--------|
| M0.1 | Create Go backend project structure | Backend Lead | Done |
| M0.2 | Create React/Vite frontend project | Frontend Lead | Done |
| M0.3 | Set up Docker Compose for dev | SRE/DevOps | Done |
| M0.4 | Create Postfix test container | Postfix SME | Done |
| M0.5 | Set up CI pipeline skeleton | QA Lead | Done |
| M0.6 | Configure linters and formatters | Backend/Frontend | Done |

### Deliverables
- `/backend` - Go module with chi router skeleton
- `/frontend` - Vite + React + TypeScript + shadcn/ui skeleton
- `/docker` - Docker Compose + Postfix Dockerfile
- `/.github/workflows` - CI pipeline

### Demo Steps
1. `docker-compose up -d`
2. Open http://localhost:5173 - React app loads
3. Open http://localhost:8080/healthz - Backend responds

---

## Milestone 1: Authentication & User Management

**Goal**: Implement secure authentication, session management, and RBAC.

### Tasks

| ID | Task | Owner |
|----|------|-------|
| M1.1 | Design and implement users table + migrations | Backend Lead |
| M1.2 | Implement password hashing (Argon2id) | Security Engineer |
| M1.3 | Implement session management | Backend Lead |
| M1.4 | Create login API endpoint | Backend Lead |
| M1.5 | Create logout API endpoint | Backend Lead |
| M1.6 | Implement RBAC middleware | Backend Lead |
| M1.7 | Create user management API endpoints | Backend Lead |
| M1.8 | Build login page UI | Frontend Lead |
| M1.9 | Build user management UI (admin) | Frontend Lead |
| M1.10 | Implement auth context/hooks in frontend | Frontend Lead |
| M1.11 | Add account lockout logic | Security Engineer |
| M1.12 | Write auth integration tests | QA Lead |

### Acceptance Criteria
- [ ] User can log in with valid credentials
- [ ] Invalid credentials rejected with proper message
- [ ] Account locks after 5 failed attempts
- [ ] Session expires after configured timeout
- [ ] RBAC prevents operator from accessing admin endpoints
- [ ] Admin can create/edit/delete users

### Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Session token weakness | Use crypto/rand for 256-bit tokens |
| Password hash timing attack | Constant-time comparison |

---

## Milestone 2: Dashboard & System Status

**Goal**: Build the main dashboard showing Postfix status and key metrics.

### Tasks

| ID | Task | Owner |
|----|------|-------|
| M2.1 | Implement Postfix status check (systemctl) | Backend Lead |
| M2.2 | Implement queue count retrieval (mailq) | Postfix SME |
| M2.3 | Create status API endpoint | Backend Lead |
| M2.4 | Build dashboard layout | Frontend Lead |
| M2.5 | Build status cards component | Frontend Lead |
| M2.6 | Build quick actions component | Frontend Lead |
| M2.7 | Add WebSocket for real-time status updates | Backend Lead |
| M2.8 | Write dashboard integration tests | QA Lead |

### Acceptance Criteria
- [ ] Dashboard shows Postfix running/stopped status
- [ ] Dashboard shows current queue counts (active, deferred, hold)
- [ ] Dashboard shows last config reload time and status
- [ ] Status updates in real-time without page refresh

---

## Milestone 3: Configuration Management (Core)

**Goal**: Implement config reading, editing, validation, and applying.

### Tasks

| ID | Task | Owner |
|----|------|-------|
| M3.1 | Implement config reading (postconf -n, file parse) | Postfix SME |
| M3.2 | Design config data model | Backend Lead |
| M3.3 | Implement config_versions table + migrations | Backend Lead |
| M3.4 | Implement secrets encryption/decryption | Security Engineer |
| M3.5 | Create GET /config endpoint | Backend Lead |
| M3.6 | Create PUT /config endpoint (save draft) | Backend Lead |
| M3.7 | Implement validation (app-level + postfix check) | Backend Lead |
| M3.8 | Implement atomic file write + rollback | Postfix SME |
| M3.9 | Implement postfix reload with verification | Postfix SME |
| M3.10 | Create POST /config/apply endpoint | Backend Lead |
| M3.11 | Create POST /config/rollback endpoint | Backend Lead |
| M3.12 | Build config form components | Frontend Lead |
| M3.13 | Build config tabs UI (General, Relay, TLS, Auth) | Frontend Lead |
| M3.14 | Build pending changes indicator | Frontend Lead |
| M3.15 | Build config diff viewer | Frontend Lead |
| M3.16 | Build config history page | Frontend Lead |
| M3.17 | Implement file locking (flock) | Backend Lead |
| M3.18 | Write config integration tests | QA Lead |
| M3.19 | Test invalid config scenarios | QA Lead |

### Acceptance Criteria
- [ ] Config values displayed correctly in UI
- [ ] Changes saved as draft without applying
- [ ] Validation catches invalid config before apply
- [ ] Apply writes config atomically
- [ ] Postfix reload succeeds after valid config apply
- [ ] Invalid config rejected with clear error message
- [ ] Rollback restores previous config
- [ ] Config history shows all versions with diffs
- [ ] Secrets masked in UI for non-admin
- [ ] Concurrent writes blocked by lock

### Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Config corruption on disk-full | Check disk space before write |
| Postfix reload fails | Verify status after reload, auto-rollback |
| Secret leaked in logs | Never log secret values, audit code paths |

---

## Milestone 4: Audit Logging

**Goal**: Implement comprehensive audit trail for all administrative actions.

### Tasks

| ID | Task | Owner |
|----|------|-------|
| M4.1 | Design audit_log table | Backend Lead |
| M4.2 | Implement audit logging middleware | Backend Lead |
| M4.3 | Add audit logging to all admin actions | Backend Lead |
| M4.4 | Create GET /audit endpoint with filters | Backend Lead |
| M4.5 | Build audit log viewer UI | Frontend Lead |
| M4.6 | Implement audit log retention purge | SRE/DevOps |
| M4.7 | Test audit log completeness | QA Lead |

### Acceptance Criteria
- [ ] All admin actions logged with user, timestamp, action, target
- [ ] Config changes include diff (secrets masked)
- [ ] Audit log searchable by user, action, date range
- [ ] Old audit logs purged per retention policy

---

## Milestone 5: Real-time Log Viewer

**Goal**: Implement live log streaming and historical log search.

### Tasks

| ID | Task | Owner |
|----|------|-------|
| M5.1 | Implement journald log reader | Backend Lead |
| M5.2 | Implement syslog file tail fallback | Backend Lead |
| M5.3 | Implement log parser (extract queue_id, status, etc.) | Postfix SME |
| M5.4 | Design mail_logs table | Backend Lead |
| M5.5 | Implement batch log storage | Backend Lead |
| M5.6 | Implement WebSocket log streaming | Backend Lead |
| M5.7 | Create GET /logs endpoint (historical query) | Backend Lead |
| M5.8 | Create GET /logs/stream WebSocket endpoint | Backend Lead |
| M5.9 | Build log viewer toolbar (search, filters) | Frontend Lead |
| M5.10 | Build virtual scrolling log list | Frontend Lead |
| M5.11 | Build log detail panel (queue-id correlation) | Frontend Lead |
| M5.12 | Implement pause/resume functionality | Frontend Lead |
| M5.13 | Build log export feature | Frontend Lead |
| M5.14 | Implement log retention purge | SRE/DevOps |
| M5.15 | Load test at 5000 logs/minute | QA Lead |

### Acceptance Criteria
- [ ] Live logs appear within 1 second
- [ ] UI remains responsive at 5k logs/minute
- [ ] Search filters logs correctly
- [ ] Queue-ID click shows all related log lines
- [ ] Pause stops auto-scroll, resume catches up
- [ ] Export works for CSV and JSON
- [ ] Old logs purged per retention policy

### Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Log rotation missed entries | Use inotify, reconnect on rotation |
| SQLite lock contention | WAL mode, batch inserts |
| Memory leak on long sessions | Bounded buffer, virtual scrolling |

---

## Milestone 6: Basic Alerting

**Goal**: Implement alert rules, detection, and in-UI notifications.

### Tasks

| ID | Task | Owner |
|----|------|-------|
| M6.1 | Design alert_rules and alerts tables | Backend Lead |
| M6.2 | Implement metrics collector (queue count, etc.) | Backend Lead |
| M6.3 | Implement rule evaluation engine | Backend Lead |
| M6.4 | Implement alert lifecycle management | Backend Lead |
| M6.5 | Create default alert rules | Postfix SME |
| M6.6 | Create alert API endpoints | Backend Lead |
| M6.7 | Implement WebSocket alert push | Backend Lead |
| M6.8 | Build alert badge in nav | Frontend Lead |
| M6.9 | Build alerts page (active, history) | Frontend Lead |
| M6.10 | Build alert detail panel with runbook | Frontend Lead |
| M6.11 | Implement acknowledge/silence | Backend Lead |
| M6.12 | Write alert trigger tests | QA Lead |

### Acceptance Criteria
- [ ] Queue growth alert fires when threshold exceeded
- [ ] Alert appears in UI within 1 minute of trigger
- [ ] Acknowledge suppresses repeat notifications
- [ ] Silence temporarily suppresses alert
- [ ] Alert auto-resolves when condition clears
- [ ] Runbook content displayed for each alert type

---

## Milestone 7: MVP Complete

**Goal**: Integrate all MVP features, comprehensive testing, documentation.

### Tasks

| ID | Task | Owner |
|----|------|-------|
| M7.1 | End-to-end integration testing | QA Lead |
| M7.2 | Security audit (OWASP Top 10) | Security Engineer |
| M7.3 | Performance testing | QA Lead |
| M7.4 | Write user documentation | Product/UX Lead |
| M7.5 | Write operator runbooks | SRE/DevOps |
| M7.6 | Write installation guide | SRE/DevOps |
| M7.7 | Create release package (Docker image, binary) | SRE/DevOps |
| M7.8 | Bug fixes and polish | All |

### Acceptance Criteria
- [ ] All M1-M6 acceptance criteria met
- [ ] No critical or high security issues
- [ ] Performance targets met
- [ ] Documentation complete
- [ ] Release artifacts published

---

## Post-MVP: v1 Features

### Milestone 8: Queue Management

| ID | Task |
|----|------|
| M8.1 | Implement queue listing API |
| M8.2 | Implement hold/release/delete actions |
| M8.3 | Build queue management UI |
| M8.4 | Build message detail view |

### Milestone 9: Transport Maps & Advanced Config

| ID | Task |
|----|------|
| M9.1 | Implement transport map management |
| M9.2 | Implement sender-dependent relay |
| M9.3 | Implement recipient restrictions |
| M9.4 | Build advanced config UIs |

### Milestone 10: Notification Channels

| ID | Task |
|----|------|
| M10.1 | Implement email notifications |
| M10.2 | Implement webhook notifications |
| M10.3 | Build notification channel management UI |
| M10.4 | Add notification preferences per alert rule |

### Milestone 11: Observability

| ID | Task |
|----|------|
| M11.1 | Implement /metrics endpoint (Prometheus) |
| M11.2 | Implement /healthz and /readyz |
| M11.3 | Add structured logging |
| M11.4 | Document Grafana dashboard |

---

## Task Dependencies

```
M0 (Scaffold)
 │
 ├─▶ M1 (Auth)
 │    │
 │    ├─▶ M2 (Dashboard)
 │    │
 │    ├─▶ M3 (Config)
 │    │    │
 │    │    └─▶ M4 (Audit)
 │    │
 │    ├─▶ M5 (Logs)
 │    │    │
 │    │    └─▶ M6 (Alerts)
 │    │
 │    └────────────▶ M7 (MVP Complete)
 │
 └─▶ (M8-M11 post-MVP, parallel)
```

---

## Risk Register

| ID | Risk | Probability | Impact | Mitigation | Owner |
|----|------|-------------|--------|------------|-------|
| R1 | Postfix version incompatibility | Medium | High | Test on multiple versions | Postfix SME |
| R2 | SQLite performance bottleneck | Low | Medium | Benchmark early, WAL mode | Backend Lead |
| R3 | Security vulnerability discovered | Medium | High | Regular audits, pen testing | Security Engineer |
| R4 | Log format variations | Medium | Medium | Document supported formats | Postfix SME |
| R5 | Browser compatibility issues | Low | Medium | Test on major browsers | Frontend Lead |
| R6 | Sudo misconfiguration | Low | Critical | Automated sudoers testing | Security Engineer |

---

## Definition of Done (Per Task)

- [ ] Code written and compiles/builds without errors
- [ ] Unit tests written and passing
- [ ] Integration tests written and passing (where applicable)
- [ ] No lint errors or warnings
- [ ] Security review completed (for security-sensitive code)
- [ ] API documentation updated (OpenAPI spec)
- [ ] Code reviewed and approved by peer
- [ ] Merged to main branch

## Definition of Done (Per Milestone)

- [ ] All tasks in milestone complete
- [ ] All acceptance criteria met
- [ ] End-to-end tests passing
- [ ] Performance targets verified
- [ ] Security scan clean
- [ ] Documentation updated
- [ ] Demo completed and recorded

---

**End of Implementation Plan**
