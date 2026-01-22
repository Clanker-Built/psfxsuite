package mail

import (
	"bytes"
	"crypto/tls"
	"encoding/base64"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/smtp"
	"net/textproto"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// SMTPConfig holds SMTP connection settings
type SMTPConfig struct {
	Host      string // SMTP server host (e.g., "postfix" or "localhost")
	Port      string // SMTP port (e.g., "587" for submission)
	TLSConfig *tls.Config
}

// DefaultSMTPConfig returns the default SMTP configuration
func DefaultSMTPConfig() *SMTPConfig {
	host := os.Getenv("SMTP_HOST")
	if host == "" {
		host = "postfix"
	}
	port := os.Getenv("SMTP_PORT")
	if port == "" {
		port = "587"
	}

	return &SMTPConfig{
		Host: host,
		Port: port,
		TLSConfig: &tls.Config{
			InsecureSkipVerify: true, // For internal mail server
		},
	}
}

// SMTPSender handles sending emails via SMTP
type SMTPSender struct {
	config *SMTPConfig
}

// NewSMTPSender creates a new SMTP sender
func NewSMTPSender(config *SMTPConfig) *SMTPSender {
	if config == nil {
		config = DefaultSMTPConfig()
	}
	return &SMTPSender{config: config}
}

// SendResult contains the result of sending an email
type SendResult struct {
	Success   bool   `json:"success"`
	MessageID string `json:"messageId,omitempty"`
	Error     string `json:"error,omitempty"`
}

// Send sends an email using the provided credentials
func (s *SMTPSender) Send(from string, password string, msg *ComposeMessage) (*SendResult, error) {
	// Validate inputs
	if from == "" {
		return nil, fmt.Errorf("from address is required")
	}
	if len(msg.To) == 0 {
		return nil, fmt.Errorf("at least one recipient is required")
	}

	// Generate message ID
	msgID := generateMessageID(from)

	// Build MIME message
	mimeMsg, err := s.buildMIMEMessage(from, msg, msgID)
	if err != nil {
		return nil, fmt.Errorf("failed to build message: %w", err)
	}

	// Collect all recipients
	recipients := make([]string, 0, len(msg.To)+len(msg.Cc)+len(msg.Bcc))
	recipients = append(recipients, msg.To...)
	recipients = append(recipients, msg.Cc...)
	recipients = append(recipients, msg.Bcc...)

	// Connect to SMTP server
	addr := net.JoinHostPort(s.config.Host, s.config.Port)
	log.Debug().Str("addr", addr).Str("from", from).Msg("Connecting to SMTP server")

	conn, err := net.DialTimeout("tcp", addr, 30*time.Second)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to SMTP server: %w", err)
	}

	client, err := smtp.NewClient(conn, s.config.Host)
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to create SMTP client: %w", err)
	}
	defer client.Close()

	// Try STARTTLS if available
	if ok, _ := client.Extension("STARTTLS"); ok {
		if err := client.StartTLS(s.config.TLSConfig); err != nil {
			log.Warn().Err(err).Msg("STARTTLS failed, continuing without TLS")
		}
	}

	// Authenticate
	if ok, _ := client.Extension("AUTH"); ok {
		auth := smtp.PlainAuth("", from, password, s.config.Host)
		if err := client.Auth(auth); err != nil {
			return nil, fmt.Errorf("SMTP authentication failed: %w", err)
		}
	}

	// Set sender
	if err := client.Mail(from); err != nil {
		return nil, fmt.Errorf("MAIL FROM failed: %w", err)
	}

	// Set recipients
	for _, rcpt := range recipients {
		if err := client.Rcpt(rcpt); err != nil {
			log.Warn().Err(err).Str("recipient", rcpt).Msg("RCPT TO failed")
			// Continue with other recipients
		}
	}

	// Send message data
	wc, err := client.Data()
	if err != nil {
		return nil, fmt.Errorf("DATA command failed: %w", err)
	}

	if _, err := wc.Write(mimeMsg); err != nil {
		wc.Close()
		return nil, fmt.Errorf("failed to write message: %w", err)
	}

	if err := wc.Close(); err != nil {
		return nil, fmt.Errorf("failed to complete message: %w", err)
	}

	// Quit
	client.Quit()

	log.Info().
		Str("from", from).
		Strs("to", msg.To).
		Str("subject", msg.Subject).
		Str("messageId", msgID).
		Msg("Email sent successfully")

	return &SendResult{
		Success:   true,
		MessageID: msgID,
	}, nil
}

// buildMIMEMessage constructs a MIME-formatted email message
func (s *SMTPSender) buildMIMEMessage(from string, msg *ComposeMessage, msgID string) ([]byte, error) {
	var buf bytes.Buffer

	// Headers
	buf.WriteString(fmt.Sprintf("From: %s\r\n", from))
	buf.WriteString(fmt.Sprintf("To: %s\r\n", strings.Join(msg.To, ", ")))
	if len(msg.Cc) > 0 {
		buf.WriteString(fmt.Sprintf("Cc: %s\r\n", strings.Join(msg.Cc, ", ")))
	}
	// BCC is not included in headers
	buf.WriteString(fmt.Sprintf("Subject: %s\r\n", encodeHeader(msg.Subject)))
	buf.WriteString(fmt.Sprintf("Message-ID: %s\r\n", msgID))
	buf.WriteString(fmt.Sprintf("Date: %s\r\n", time.Now().Format(time.RFC1123Z)))
	buf.WriteString("MIME-Version: 1.0\r\n")

	// In-Reply-To and References for threading
	if msg.InReplyTo != "" {
		buf.WriteString(fmt.Sprintf("In-Reply-To: %s\r\n", msg.InReplyTo))
	}
	if msg.References != "" {
		buf.WriteString(fmt.Sprintf("References: %s\r\n", msg.References))
	}

	// User agent
	buf.WriteString("X-Mailer: PSFXMail/1.0\r\n")

	// Determine content type based on what we have
	hasHTML := msg.HTMLBody != ""
	hasText := msg.Body != ""
	hasAttachments := len(msg.Attachments) > 0

	if hasAttachments {
		// multipart/mixed with attachments
		return s.buildMultipartMixed(&buf, msg, hasHTML, hasText)
	} else if hasHTML && hasText {
		// multipart/alternative for HTML + plain text
		return s.buildMultipartAlternative(&buf, msg)
	} else if hasHTML {
		// HTML only
		buf.WriteString("Content-Type: text/html; charset=utf-8\r\n")
		buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		buf.WriteString("\r\n")
		qp := quotedprintable.NewWriter(&buf)
		qp.Write([]byte(msg.HTMLBody))
		qp.Close()
		return buf.Bytes(), nil
	} else {
		// Plain text only
		buf.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
		buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		buf.WriteString("\r\n")
		qp := quotedprintable.NewWriter(&buf)
		qp.Write([]byte(msg.Body))
		qp.Close()
		return buf.Bytes(), nil
	}
}

func (s *SMTPSender) buildMultipartAlternative(buf *bytes.Buffer, msg *ComposeMessage) ([]byte, error) {
	boundary := generateBoundary()
	buf.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n", boundary))
	buf.WriteString("\r\n")

	// Plain text part
	buf.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	buf.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
	buf.WriteString("\r\n")
	qp := quotedprintable.NewWriter(buf)
	qp.Write([]byte(msg.Body))
	qp.Close()
	buf.WriteString("\r\n")

	// HTML part
	buf.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	buf.WriteString("Content-Type: text/html; charset=utf-8\r\n")
	buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
	buf.WriteString("\r\n")
	qpHTML := quotedprintable.NewWriter(buf)
	qpHTML.Write([]byte(msg.HTMLBody))
	qpHTML.Close()
	buf.WriteString("\r\n")

	// End boundary
	buf.WriteString(fmt.Sprintf("--%s--\r\n", boundary))

	return buf.Bytes(), nil
}

func (s *SMTPSender) buildMultipartMixed(buf *bytes.Buffer, msg *ComposeMessage, hasHTML, hasText bool) ([]byte, error) {
	mixedBoundary := generateBoundary()
	buf.WriteString(fmt.Sprintf("Content-Type: multipart/mixed; boundary=\"%s\"\r\n", mixedBoundary))
	buf.WriteString("\r\n")

	// Body part
	buf.WriteString(fmt.Sprintf("--%s\r\n", mixedBoundary))

	if hasHTML && hasText {
		// Nested multipart/alternative
		altBoundary := generateBoundary()
		buf.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n", altBoundary))
		buf.WriteString("\r\n")

		// Plain text
		buf.WriteString(fmt.Sprintf("--%s\r\n", altBoundary))
		buf.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
		buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		buf.WriteString("\r\n")
		qp := quotedprintable.NewWriter(buf)
		qp.Write([]byte(msg.Body))
		qp.Close()
		buf.WriteString("\r\n")

		// HTML
		buf.WriteString(fmt.Sprintf("--%s\r\n", altBoundary))
		buf.WriteString("Content-Type: text/html; charset=utf-8\r\n")
		buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		buf.WriteString("\r\n")
		qpHTML := quotedprintable.NewWriter(buf)
		qpHTML.Write([]byte(msg.HTMLBody))
		qpHTML.Close()
		buf.WriteString("\r\n")

		buf.WriteString(fmt.Sprintf("--%s--\r\n", altBoundary))
	} else if hasHTML {
		buf.WriteString("Content-Type: text/html; charset=utf-8\r\n")
		buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		buf.WriteString("\r\n")
		qp := quotedprintable.NewWriter(buf)
		qp.Write([]byte(msg.HTMLBody))
		qp.Close()
	} else {
		buf.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
		buf.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
		buf.WriteString("\r\n")
		qp := quotedprintable.NewWriter(buf)
		qp.Write([]byte(msg.Body))
		qp.Close()
	}
	buf.WriteString("\r\n")

	// Attachments would be added here
	// For now, we don't support actual file attachments in this implementation
	// This would require a separate upload mechanism

	// End boundary
	buf.WriteString(fmt.Sprintf("--%s--\r\n", mixedBoundary))

	return buf.Bytes(), nil
}

// SaveToSent saves a copy of the sent message to the Sent folder via IMAP
func (s *SMTPSender) SaveToSent(session *Session, mimeMessage []byte) error {
	return session.AppendMessage("Sent", mimeMessage, []string{"\\Seen"})
}

// Helper functions

func generateMessageID(from string) string {
	domain := "localhost"
	if idx := strings.Index(from, "@"); idx != -1 {
		domain = from[idx+1:]
	}
	timestamp := time.Now().UnixNano()
	return fmt.Sprintf("<%d.%s@%s>", timestamp, GenerateSessionID()[:8], domain)
}

func generateBoundary() string {
	return fmt.Sprintf("----=_Part_%s", GenerateSessionID()[:16])
}

func encodeHeader(s string) string {
	// Check if encoding is needed
	needsEncoding := false
	for _, r := range s {
		if r > 127 {
			needsEncoding = true
			break
		}
	}
	if !needsEncoding {
		return s
	}

	return mime.QEncoding.Encode("utf-8", s)
}

// parseAddresses parses email addresses from a string (unused but kept for future)
func parseAddresses(addrs string) []string {
	var result []string
	for _, addr := range strings.Split(addrs, ",") {
		addr = strings.TrimSpace(addr)
		if addr != "" {
			result = append(result, addr)
		}
	}
	return result
}

// Unused imports prevention
var _ = multipart.Writer{}
var _ = textproto.MIMEHeader{}
var _ = io.Reader(nil)
var _ = base64.StdEncoding
