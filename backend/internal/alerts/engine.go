package alerts

import (
	"database/sql"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// AlertSeverity represents the severity level of an alert
type AlertSeverity string

const (
	SeverityWarning  AlertSeverity = "warning"
	SeverityCritical AlertSeverity = "critical"
)

// AlertStatus represents the status of an alert
type AlertStatus string

const (
	StatusFiring       AlertStatus = "firing"
	StatusAcknowledged AlertStatus = "acknowledged"
	StatusResolved     AlertStatus = "resolved"
	StatusSilenced     AlertStatus = "silenced"
)

// Alert represents an active alert
type Alert struct {
	ID             int64                  `json:"id"`
	RuleID         int64                  `json:"ruleId"`
	RuleName       string                 `json:"ruleName"`
	Status         AlertStatus            `json:"status"`
	Severity       AlertSeverity          `json:"severity"`
	TriggeredAt    time.Time              `json:"triggeredAt"`
	AcknowledgedAt *time.Time             `json:"acknowledgedAt,omitempty"`
	AcknowledgedBy *string                `json:"acknowledgedBy,omitempty"`
	ResolvedAt     *time.Time             `json:"resolvedAt,omitempty"`
	SilencedUntil  *time.Time             `json:"silencedUntil,omitempty"`
	Context        map[string]interface{} `json:"context"`
	Message        string                 `json:"message"`
}

// AlertRule defines a detection rule
type AlertRule struct {
	ID                int64         `json:"id"`
	Name              string        `json:"name"`
	Description       string        `json:"description"`
	Type              string        `json:"type"`
	Enabled           bool          `json:"enabled"`
	ThresholdValue    float64       `json:"thresholdValue"`
	ThresholdDuration int           `json:"thresholdDuration"` // seconds
	Severity          AlertSeverity `json:"severity"`
}

// Metrics holds current system metrics for alert evaluation
type Metrics struct {
	QueueActive    int
	QueueDeferred  int
	QueueHold      int
	AuthFailures   int
	TLSFailures    int
	BounceRate     float64
	ConnectionRate float64
}

// Engine manages alert detection and notification
type Engine struct {
	db       *sql.DB
	mu       sync.RWMutex
	rules    []AlertRule
	metrics  Metrics
	stopCh   chan struct{}
	notifier *Notifier
}

// NewEngine creates a new alert engine
func NewEngine(db *sql.DB) *Engine {
	return &Engine{
		db:       db,
		rules:    []AlertRule{},
		stopCh:   make(chan struct{}),
		notifier: NewNotifier(),
	}
}

// Start begins the alert detection loop
func (e *Engine) Start() {
	// Load rules from database
	e.loadRules()

	// Start detection loop
	go e.detectionLoop()

	log.Info().Msg("Alert engine started")
}

// Stop stops the alert engine
func (e *Engine) Stop() {
	close(e.stopCh)
}

// loadRules loads alert rules from the database
func (e *Engine) loadRules() {
	rows, err := e.db.Query(`
		SELECT id, name, description, type, enabled, threshold_value, threshold_duration_seconds, severity
		FROM alert_rules WHERE enabled = 1
	`)
	if err != nil {
		log.Error().Err(err).Msg("Failed to load alert rules")
		return
	}
	defer rows.Close()

	var rules []AlertRule
	for rows.Next() {
		var rule AlertRule
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Description, &rule.Type, &rule.Enabled, &rule.ThresholdValue, &rule.ThresholdDuration, &rule.Severity); err != nil {
			continue
		}
		rules = append(rules, rule)
	}

	e.mu.Lock()
	e.rules = rules
	e.mu.Unlock()

	log.Info().Int("count", len(rules)).Msg("Loaded alert rules")
}

// UpdateMetrics updates the current system metrics
func (e *Engine) UpdateMetrics(m Metrics) {
	e.mu.Lock()
	e.metrics = m
	e.mu.Unlock()
}

// detectionLoop runs the periodic alert detection
func (e *Engine) detectionLoop() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-e.stopCh:
			return
		case <-ticker.C:
			e.evaluateRules()
		}
	}
}

// evaluateRules checks all rules against current metrics
func (e *Engine) evaluateRules() {
	e.mu.RLock()
	rules := e.rules
	metrics := e.metrics
	e.mu.RUnlock()

	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}

		triggered, msg, ctx := e.evaluateRule(rule, metrics)
		if triggered {
			e.fireAlert(rule, msg, ctx)
		} else {
			e.resolveAlert(rule)
		}
	}
}

// evaluateRule evaluates a single rule
func (e *Engine) evaluateRule(rule AlertRule, m Metrics) (bool, string, map[string]interface{}) {
	ctx := make(map[string]interface{})

	switch rule.Type {
	case "queue_growth":
		total := m.QueueActive + m.QueueDeferred + m.QueueHold
		ctx["queueSize"] = total
		ctx["threshold"] = rule.ThresholdValue
		if float64(total) > rule.ThresholdValue {
			return true, "Mail queue size exceeds threshold", ctx
		}

	case "deferred_spike":
		ctx["deferredCount"] = m.QueueDeferred
		ctx["threshold"] = rule.ThresholdValue
		if float64(m.QueueDeferred) > rule.ThresholdValue {
			return true, "Deferred mail count exceeds threshold", ctx
		}

	case "auth_failures":
		ctx["failureCount"] = m.AuthFailures
		ctx["threshold"] = rule.ThresholdValue
		if float64(m.AuthFailures) > rule.ThresholdValue {
			return true, "Authentication failures exceed threshold", ctx
		}

	case "tls_failures":
		ctx["failureCount"] = m.TLSFailures
		ctx["threshold"] = rule.ThresholdValue
		if float64(m.TLSFailures) > rule.ThresholdValue {
			return true, "TLS connection failures exceed threshold", ctx
		}

	case "bounce_rate":
		ctx["bounceRate"] = m.BounceRate
		ctx["threshold"] = rule.ThresholdValue
		if m.BounceRate > rule.ThresholdValue {
			return true, "Bounce rate exceeds threshold", ctx
		}

	case "connection_rate":
		ctx["connectionRate"] = m.ConnectionRate
		ctx["threshold"] = rule.ThresholdValue
		if m.ConnectionRate > rule.ThresholdValue {
			return true, "Connection rate exceeds threshold", ctx
		}
	}

	return false, "", ctx
}

// fireAlert creates or updates an alert
func (e *Engine) fireAlert(rule AlertRule, message string, context map[string]interface{}) {
	// Check if alert already exists and is firing
	var existingID int64
	err := e.db.QueryRow(`
		SELECT id FROM alerts WHERE rule_id = ? AND status = 'firing'
	`, rule.ID).Scan(&existingID)

	if err == nil {
		// Alert already firing, don't create duplicate
		return
	}

	// Create new alert
	now := time.Now().UTC()
	result, err := e.db.Exec(`
		INSERT INTO alerts (rule_id, status, severity, triggered_at, message, context)
		VALUES (?, 'firing', ?, ?, ?, ?)
	`, rule.ID, rule.Severity, now.Format(time.RFC3339), message, "{}")
	if err != nil {
		log.Error().Err(err).Str("rule", rule.Name).Msg("Failed to create alert")
		return
	}

	alertID, _ := result.LastInsertId()
	log.Warn().
		Int64("alertId", alertID).
		Str("rule", rule.Name).
		Str("severity", string(rule.Severity)).
		Str("message", message).
		Msg("Alert fired")

	// Send notifications
	alert := Alert{
		ID:          alertID,
		RuleID:      rule.ID,
		RuleName:    rule.Name,
		Status:      StatusFiring,
		Severity:    rule.Severity,
		TriggeredAt: now,
		Message:     message,
		Context:     context,
	}
	e.notifier.Notify(alert)
}

// resolveAlert marks an alert as resolved
func (e *Engine) resolveAlert(rule AlertRule) {
	now := time.Now().UTC()
	result, err := e.db.Exec(`
		UPDATE alerts SET status = 'resolved', resolved_at = ?
		WHERE rule_id = ? AND status = 'firing'
	`, now.Format(time.RFC3339), rule.ID)
	if err != nil {
		return
	}

	affected, _ := result.RowsAffected()
	if affected > 0 {
		log.Info().Str("rule", rule.Name).Msg("Alert resolved")
	}
}

// GetActiveAlerts returns all active (firing or acknowledged) alerts
func (e *Engine) GetActiveAlerts() ([]Alert, error) {
	rows, err := e.db.Query(`
		SELECT a.id, a.rule_id, r.name, a.status, a.severity, a.triggered_at,
		       a.acknowledged_at, a.acknowledged_by, a.resolved_at, a.message
		FROM alerts a
		JOIN alert_rules r ON a.rule_id = r.id
		WHERE a.status IN ('firing', 'acknowledged')
		ORDER BY a.triggered_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []Alert
	for rows.Next() {
		var a Alert
		var triggeredAt, ackAt, resolvedAt sql.NullString
		var ackBy sql.NullString

		if err := rows.Scan(&a.ID, &a.RuleID, &a.RuleName, &a.Status, &a.Severity, &triggeredAt, &ackAt, &ackBy, &resolvedAt, &a.Message); err != nil {
			continue
		}

		if triggeredAt.Valid {
			t, _ := time.Parse(time.RFC3339, triggeredAt.String)
			a.TriggeredAt = t
		}
		if ackAt.Valid {
			t, _ := time.Parse(time.RFC3339, ackAt.String)
			a.AcknowledgedAt = &t
		}
		if ackBy.Valid {
			a.AcknowledgedBy = &ackBy.String
		}
		if resolvedAt.Valid {
			t, _ := time.Parse(time.RFC3339, resolvedAt.String)
			a.ResolvedAt = &t
		}

		alerts = append(alerts, a)
	}

	return alerts, nil
}

// GetAllAlerts returns all alerts (including resolved)
func (e *Engine) GetAllAlerts(limit int) ([]Alert, error) {
	rows, err := e.db.Query(`
		SELECT a.id, a.rule_id, r.name, a.status, a.severity, a.triggered_at,
		       a.acknowledged_at, a.acknowledged_by, a.resolved_at, a.message
		FROM alerts a
		JOIN alert_rules r ON a.rule_id = r.id
		ORDER BY a.triggered_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []Alert
	for rows.Next() {
		var a Alert
		var triggeredAt, ackAt, resolvedAt sql.NullString
		var ackBy sql.NullString

		if err := rows.Scan(&a.ID, &a.RuleID, &a.RuleName, &a.Status, &a.Severity, &triggeredAt, &ackAt, &ackBy, &resolvedAt, &a.Message); err != nil {
			continue
		}

		if triggeredAt.Valid {
			t, _ := time.Parse(time.RFC3339, triggeredAt.String)
			a.TriggeredAt = t
		}
		if ackAt.Valid {
			t, _ := time.Parse(time.RFC3339, ackAt.String)
			a.AcknowledgedAt = &t
		}
		if ackBy.Valid {
			a.AcknowledgedBy = &ackBy.String
		}
		if resolvedAt.Valid {
			t, _ := time.Parse(time.RFC3339, resolvedAt.String)
			a.ResolvedAt = &t
		}

		alerts = append(alerts, a)
	}

	return alerts, nil
}

// AcknowledgeAlert marks an alert as acknowledged
func (e *Engine) AcknowledgeAlert(alertID int64, username string, note string) error {
	now := time.Now().UTC()
	_, err := e.db.Exec(`
		UPDATE alerts SET status = 'acknowledged', acknowledged_at = ?, acknowledged_by = ?
		WHERE id = ? AND status = 'firing'
	`, now.Format(time.RFC3339), username, alertID)
	return err
}

// SilenceAlert silences an alert for a duration
func (e *Engine) SilenceAlert(alertID int64, durationMinutes int) error {
	silenceUntil := time.Now().Add(time.Duration(durationMinutes) * time.Minute).UTC()
	_, err := e.db.Exec(`
		UPDATE alerts SET status = 'silenced', silenced_until = ?
		WHERE id = ?
	`, silenceUntil.Format(time.RFC3339), alertID)
	return err
}

// GetAlert returns a single alert by ID
func (e *Engine) GetAlert(alertID int64) (*Alert, error) {
	var a Alert
	var triggeredAt, ackAt, resolvedAt sql.NullString
	var ackBy sql.NullString

	err := e.db.QueryRow(`
		SELECT a.id, a.rule_id, r.name, a.status, a.severity, a.triggered_at,
		       a.acknowledged_at, a.acknowledged_by, a.resolved_at, a.message
		FROM alerts a
		JOIN alert_rules r ON a.rule_id = r.id
		WHERE a.id = ?
	`, alertID).Scan(&a.ID, &a.RuleID, &a.RuleName, &a.Status, &a.Severity, &triggeredAt, &ackAt, &ackBy, &resolvedAt, &a.Message)
	if err != nil {
		return nil, err
	}

	if triggeredAt.Valid {
		t, _ := time.Parse(time.RFC3339, triggeredAt.String)
		a.TriggeredAt = t
	}
	if ackAt.Valid {
		t, _ := time.Parse(time.RFC3339, ackAt.String)
		a.AcknowledgedAt = &t
	}
	if ackBy.Valid {
		a.AcknowledgedBy = &ackBy.String
	}
	if resolvedAt.Valid {
		t, _ := time.Parse(time.RFC3339, resolvedAt.String)
		a.ResolvedAt = &t
	}

	return &a, nil
}

// GetRules returns all alert rules
func (e *Engine) GetRules() ([]AlertRule, error) {
	rows, err := e.db.Query(`
		SELECT id, name, description, type, enabled, threshold_value, threshold_duration_seconds, severity
		FROM alert_rules
		ORDER BY name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []AlertRule
	for rows.Next() {
		var rule AlertRule
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Description, &rule.Type, &rule.Enabled, &rule.ThresholdValue, &rule.ThresholdDuration, &rule.Severity); err != nil {
			continue
		}
		rules = append(rules, rule)
	}

	return rules, nil
}

// UpdateRule updates an alert rule
func (e *Engine) UpdateRule(ruleID int64, updates map[string]interface{}) error {
	// Build update query
	if enabled, ok := updates["enabled"].(bool); ok {
		_, err := e.db.Exec(`UPDATE alert_rules SET enabled = ? WHERE id = ?`, enabled, ruleID)
		if err != nil {
			return err
		}
	}
	if threshold, ok := updates["thresholdValue"].(float64); ok {
		_, err := e.db.Exec(`UPDATE alert_rules SET threshold_value = ? WHERE id = ?`, threshold, ruleID)
		if err != nil {
			return err
		}
	}
	if severity, ok := updates["severity"].(string); ok {
		_, err := e.db.Exec(`UPDATE alert_rules SET severity = ? WHERE id = ?`, severity, ruleID)
		if err != nil {
			return err
		}
	}

	// Reload rules
	e.loadRules()
	return nil
}
