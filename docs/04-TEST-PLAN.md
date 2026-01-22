# PostfixRelay - Test Plan

**Version**: 1.0.0
**Date**: 2026-01-21

---

## 1. Overview

This document defines the testing strategy, test cases, and quality gates for PostfixRelay.

---

## 2. Test Layers

### 2.1 Unit Tests

**Scope**: Individual functions and modules
**Coverage Target**: 80% line coverage

#### Backend (Go)
- Config parsing and validation
- Password hashing and verification
- Session token generation
- Log parsing
- Alert rule evaluation
- Database operations (using in-memory SQLite)

#### Frontend (TypeScript)
- Utility functions
- Store actions
- Component rendering (snapshot tests)
- Form validation

### 2.2 Integration Tests

**Scope**: API endpoints with database
**Coverage Target**: 70% of API endpoints

- Authentication flow (login, logout, session management)
- RBAC enforcement (role-based access)
- Config CRUD operations
- Audit logging
- Alert rule management

### 2.3 End-to-End Tests

**Scope**: Full user flows through UI
**Coverage Target**: 100% of critical paths

- Login → Dashboard → Logout
- Config edit → Validate → Apply → Verify
- Log viewer → Search → Filter
- Alert acknowledgement flow
- User management (admin only)

### 2.4 Performance Tests

**Scope**: System under load
**Tools**: k6, custom benchmarks

- Log ingestion: 5000 lines/minute sustained
- WebSocket latency: p95 < 500ms
- API response time: p95 < 200ms
- Memory usage: < 500MB under load

---

## 3. Test Categories

### 3.1 Authentication Tests

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| AUTH-001 | Login with valid credentials | Success, token returned |
| AUTH-002 | Login with invalid password | 401 Unauthorized |
| AUTH-003 | Login with unknown username | 401 Unauthorized |
| AUTH-004 | Login with locked account | 401 Unauthorized |
| AUTH-005 | Account locks after 5 failures | Locked for 15 minutes |
| AUTH-006 | Session expires after timeout | 401 on subsequent requests |
| AUTH-007 | Logout invalidates session | Token no longer valid |
| AUTH-008 | Password change succeeds | New password works |
| AUTH-009 | Password change with wrong current | 401 Unauthorized |
| AUTH-010 | Password too short | 400 Bad Request |

### 3.2 RBAC Tests

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| RBAC-001 | Admin accesses admin endpoint | Success |
| RBAC-002 | Operator accesses admin endpoint | 403 Forbidden |
| RBAC-003 | Auditor accesses admin endpoint | 403 Forbidden |
| RBAC-004 | Operator acknowledges alert | Success |
| RBAC-005 | Auditor acknowledges alert | 403 Forbidden |
| RBAC-006 | All roles can view logs | Success |
| RBAC-007 | All roles can view config (masked) | Success, secrets masked |
| RBAC-008 | Admin can view full config | Success, secrets visible |

### 3.3 Configuration Tests

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| CFG-001 | Get current config | Returns parameters |
| CFG-002 | Update with valid values | Draft saved |
| CFG-003 | Validate valid config | Valid: true |
| CFG-004 | Validate invalid config | Valid: false, errors listed |
| CFG-005 | Apply valid config | Success, Postfix reloaded |
| CFG-006 | Apply invalid config | Rejected, no change |
| CFG-007 | Rollback to previous version | Previous config restored |
| CFG-008 | Config history lists versions | All versions returned |
| CFG-009 | Concurrent writes blocked | Second write waits/fails |
| CFG-010 | Secrets encrypted at rest | DB value is encrypted |

### 3.4 Log Tests

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| LOG-001 | Query logs by time range | Filtered results |
| LOG-002 | Query logs by severity | Filtered results |
| LOG-003 | Search logs by keyword | Matching logs |
| LOG-004 | Get logs by queue-id | All related logs |
| LOG-005 | WebSocket stream connects | Stream established |
| LOG-006 | Stream receives new logs | Within 1 second |
| LOG-007 | Stream handles backpressure | No memory leak |
| LOG-008 | Export logs as CSV | Valid CSV file |
| LOG-009 | Export logs as JSON | Valid JSON file |
| LOG-010 | Old logs purged | Logs beyond retention deleted |

### 3.5 Alert Tests

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| ALT-001 | Queue growth triggers alert | Alert fires |
| ALT-002 | Alert displayed in UI | Within 1 minute |
| ALT-003 | Acknowledge alert | Status updated |
| ALT-004 | Acknowledged alert no repeat notify | No duplicate |
| ALT-005 | Silence alert | Suppressed for duration |
| ALT-006 | Auto-resolve when condition clears | Status resolved |
| ALT-007 | Alert rule disabled | No new alerts |
| ALT-008 | Alert rule threshold changed | New threshold applies |

### 3.6 Security Tests

| ID | Test Case | Expected Result |
|----|-----------|-----------------|
| SEC-001 | SQL injection attempt | Blocked, logged |
| SEC-002 | XSS payload in input | Sanitized |
| SEC-003 | CSRF without token | Rejected |
| SEC-004 | Request without auth | 401 |
| SEC-005 | Rate limit exceeded | 429 Too Many Requests |
| SEC-006 | Invalid session token | 401 |
| SEC-007 | Expired session | 401 |
| SEC-008 | Sudo command outside list | Denied |

---

## 4. Test Environments

### 4.1 Local Development

```bash
docker-compose up -d
# Frontend: http://localhost:5173
# Backend: http://localhost:8080
# Postfix: localhost:25
```

### 4.2 CI Environment

- GitHub Actions runner
- Docker Compose for services
- Isolated per-run databases

### 4.3 Staging Environment

- Mirrors production topology
- Real TLS certificates
- Connected to test upstream relay

---

## 5. CI Pipeline

### 5.1 Pipeline Stages

```yaml
stages:
  - lint
  - test
  - build
  - integration
  - e2e
  - security
  - accessibility
```

### 5.2 Quality Gates

| Gate | Condition | Action |
|------|-----------|--------|
| Lint | Any error/warning | Block merge |
| Unit Tests | Any failure | Block merge |
| Coverage | < 80% on changed files | Block merge |
| Integration | Any failure | Block merge |
| E2E | Any failure | Block merge |
| Security | High/Critical vulns | Block merge |
| Accessibility | Any violation | Block merge |

---

## 6. Test Data

### 6.1 User Accounts (Dev/Test)

| Username | Password | Role |
|----------|----------|------|
| admin | admin | admin |
| operator | operator123 | operator |
| auditor | auditor123 | auditor |

### 6.2 Sample Log Data

Test log generator creates realistic Postfix log entries with:
- Various queue-ids
- Success/deferred/bounced statuses
- Different relay hosts
- Configurable rate (lines/minute)

---

## 7. Definition of Done

A feature is complete when:

- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] E2E test for user-facing flows
- [ ] No lint errors
- [ ] No security scan issues
- [ ] Accessibility passing
- [ ] Documentation updated
- [ ] Code reviewed and approved

---

## 8. Bug Severity Levels

| Level | Description | Response Time |
|-------|-------------|---------------|
| Critical | System unusable, data loss risk | Immediate |
| High | Major feature broken | Same day |
| Medium | Feature degraded, workaround exists | Next sprint |
| Low | Minor issue, cosmetic | Backlog |

---

**End of Test Plan**
