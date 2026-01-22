package alerts

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/smtp"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// NotificationChannel defines a notification destination
type NotificationChannel struct {
	ID       int64             `json:"id"`
	Name     string            `json:"name"`
	Type     string            `json:"type"` // email, webhook, slack
	Enabled  bool              `json:"enabled"`
	Config   map[string]string `json:"config"`
}

// Notifier sends alert notifications through configured channels
type Notifier struct {
	mu       sync.RWMutex
	channels []NotificationChannel
	client   *http.Client
}

// NewNotifier creates a new notifier
func NewNotifier() *Notifier {
	return &Notifier{
		channels: []NotificationChannel{},
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// SetChannels configures the notification channels
func (n *Notifier) SetChannels(channels []NotificationChannel) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.channels = channels
}

// Notify sends an alert to all configured channels
func (n *Notifier) Notify(alert Alert) {
	n.mu.RLock()
	channels := n.channels
	n.mu.RUnlock()

	for _, ch := range channels {
		if !ch.Enabled {
			continue
		}

		go func(channel NotificationChannel) {
			var err error
			switch channel.Type {
			case "email":
				err = n.sendEmail(channel, alert)
			case "webhook":
				err = n.sendWebhook(channel, alert)
			case "slack":
				err = n.sendSlack(channel, alert)
			}
			if err != nil {
				log.Error().
					Err(err).
					Str("channel", channel.Name).
					Str("type", channel.Type).
					Msg("Failed to send notification")
			}
		}(ch)
	}
}

// sendEmail sends an alert notification via email
func (n *Notifier) sendEmail(ch NotificationChannel, alert Alert) error {
	smtpHost := ch.Config["smtp_host"]
	smtpPort := ch.Config["smtp_port"]
	from := ch.Config["from"]
	to := ch.Config["to"]
	username := ch.Config["username"]
	password := ch.Config["password"]

	if smtpHost == "" || from == "" || to == "" {
		return fmt.Errorf("missing email configuration")
	}

	if smtpPort == "" {
		smtpPort = "587"
	}

	// Build message
	subject := fmt.Sprintf("[%s] %s: %s", strings.ToUpper(string(alert.Severity)), alert.RuleName, alert.Message)
	body := fmt.Sprintf(`Alert: %s
Severity: %s
Status: %s
Triggered At: %s

Message: %s

--
PostfixRelay Alert System
`, alert.RuleName, alert.Severity, alert.Status, alert.TriggeredAt.Format(time.RFC3339), alert.Message)

	msg := []byte(fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s",
		from, to, subject, body))

	addr := fmt.Sprintf("%s:%s", smtpHost, smtpPort)

	var auth smtp.Auth
	if username != "" && password != "" {
		auth = smtp.PlainAuth("", username, password, smtpHost)
	}

	return smtp.SendMail(addr, auth, from, strings.Split(to, ","), msg)
}

// sendWebhook sends an alert notification via webhook
func (n *Notifier) sendWebhook(ch NotificationChannel, alert Alert) error {
	url := ch.Config["url"]
	if url == "" {
		return fmt.Errorf("missing webhook URL")
	}

	payload := map[string]interface{}{
		"alert": map[string]interface{}{
			"id":          alert.ID,
			"rule":        alert.RuleName,
			"severity":    alert.Severity,
			"status":      alert.Status,
			"message":     alert.Message,
			"triggeredAt": alert.TriggeredAt.Format(time.RFC3339),
			"context":     alert.Context,
		},
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}

	req.Header.Set("Content-Type", "application/json")

	// Add authorization header if configured
	if authHeader := ch.Config["authorization"]; authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}

	resp, err := n.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	return nil
}

// sendSlack sends an alert notification to Slack
func (n *Notifier) sendSlack(ch NotificationChannel, alert Alert) error {
	webhookURL := ch.Config["webhook_url"]
	if webhookURL == "" {
		return fmt.Errorf("missing Slack webhook URL")
	}

	// Build Slack message
	color := "#ffcc00" // warning
	if alert.Severity == SeverityCritical {
		color = "#ff0000" // critical
	}

	payload := map[string]interface{}{
		"attachments": []map[string]interface{}{
			{
				"color":  color,
				"title":  fmt.Sprintf("[%s] %s", strings.ToUpper(string(alert.Severity)), alert.RuleName),
				"text":   alert.Message,
				"fields": []map[string]interface{}{
					{
						"title": "Status",
						"value": string(alert.Status),
						"short": true,
					},
					{
						"title": "Triggered At",
						"value": alert.TriggeredAt.Format(time.RFC3339),
						"short": true,
					},
				},
				"footer": "PostfixRelay Alert System",
				"ts":     alert.TriggeredAt.Unix(),
			},
		},
	}

	// Add channel override if specified
	if channel := ch.Config["channel"]; channel != "" {
		payload["channel"] = channel
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	resp, err := n.client.Post(webhookURL, "application/json", bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("Slack returned status %d", resp.StatusCode)
	}

	return nil
}

// RunbookContent contains runbook information for an alert type
type RunbookContent struct {
	Title    string   `json:"title"`
	Overview string   `json:"overview"`
	Steps    []string `json:"steps"`
	Links    []string `json:"links,omitempty"`
}

// GetRunbook returns the runbook for a specific alert type
func GetRunbook(alertType string) *RunbookContent {
	runbooks := map[string]*RunbookContent{
		"queue_growth": {
			Title:    "Mail Queue Growth",
			Overview: "The mail queue has grown beyond the configured threshold, indicating potential delivery issues.",
			Steps: []string{
				"Check the queue status using 'mailq' or the Queue page",
				"Look for common recipients or domains that may be causing delays",
				"Check if the relay host is reachable and accepting connections",
				"Review the mail logs for error messages",
				"Consider flushing the queue if the issue is resolved",
				"If messages are stuck, consider putting problematic messages on hold",
			},
			Links: []string{
				"https://www.postfix.org/QSHAPE_README.html",
			},
		},
		"deferred_spike": {
			Title:    "Deferred Mail Spike",
			Overview: "A large number of messages have been deferred, indicating delivery problems.",
			Steps: []string{
				"Check relay host connectivity and DNS resolution",
				"Verify SMTP authentication credentials are still valid",
				"Check if the relay host has rate limiting in place",
				"Review TLS certificate validity",
				"Check for blacklisting of your IP or domain",
				"Consider temporarily switching to a backup relay",
			},
		},
		"auth_failures": {
			Title:    "Authentication Failures",
			Overview: "Multiple authentication failures have been detected, which could indicate credential issues or an attack.",
			Steps: []string{
				"Check if relay credentials need to be updated",
				"Verify the authentication mechanism is configured correctly",
				"Check for unauthorized connection attempts in logs",
				"Consider blocking suspicious IPs if this is an attack",
				"Verify SASL configuration in main.cf",
			},
		},
		"tls_failures": {
			Title:    "TLS Connection Failures",
			Overview: "TLS connections are failing, which could impact secure mail delivery.",
			Steps: []string{
				"Verify TLS certificates are valid and not expired",
				"Check certificate chain completeness",
				"Verify the CA bundle is up to date",
				"Check if the relay host supports your TLS version",
				"Review smtp_tls_security_level setting",
				"Test connectivity with openssl s_client",
			},
		},
		"bounce_rate": {
			Title:    "High Bounce Rate",
			Overview: "The bounce rate has exceeded the threshold, indicating possible address quality issues.",
			Steps: []string{
				"Review bounce messages for common patterns",
				"Check if sending to invalid or outdated addresses",
				"Verify DNS records (SPF, DKIM, DMARC) are correct",
				"Check if your IP or domain is blacklisted",
				"Review the sender reputation",
				"Consider implementing address verification",
			},
		},
		"connection_rate": {
			Title:    "High Connection Rate",
			Overview: "Connection rate has exceeded normal levels, which could indicate legitimate high volume or abuse.",
			Steps: []string{
				"Check if the increased traffic is expected",
				"Review connection sources in logs",
				"Verify mynetworks configuration is correct",
				"Consider implementing rate limiting",
				"Check for compromised accounts or relaying",
			},
		},
	}

	if runbook, ok := runbooks[alertType]; ok {
		return runbook
	}

	return &RunbookContent{
		Title:    "General Alert",
		Overview: "An alert has been triggered. Review the alert details and logs for more information.",
		Steps: []string{
			"Review the alert message and context",
			"Check the mail logs for related errors",
			"Verify Postfix service status",
			"Check system resources (disk, memory, CPU)",
		},
	}
}
