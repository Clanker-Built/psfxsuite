package api

import (
	"net"
	"regexp"
	"strings"
)

// ValidationError represents a single validation error
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Validator accumulates validation errors
type Validator struct {
	errors []ValidationError
}

// NewValidator creates a new Validator
func NewValidator() *Validator {
	return &Validator{errors: make([]ValidationError, 0)}
}

// Regular expressions for validation
var (
	// Domain name: RFC 1123
	domainRegex = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$`)

	// Email: simplified RFC 5322
	emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

	// Relayhost: [hostname]:port or hostname:port or just hostname
	relayhostRegex = regexp.MustCompile(`^\[?[a-zA-Z0-9.-]+\]?(:[0-9]{1,5})?$`)

	// Hostname: for general hostname validation
	hostnameRegex = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$`)
)

// Valid TLS security levels for Postfix
var validTLSLevels = map[string]bool{
	"":        true,
	"none":    true,
	"may":     true,
	"encrypt": true,
	"dane":    true,
	"verify":  true,
	"secure":  true,
}

// AddError adds a validation error
func (v *Validator) AddError(field, message string) {
	v.errors = append(v.errors, ValidationError{Field: field, Message: message})
}

// HasErrors returns true if there are validation errors
func (v *Validator) HasErrors() bool {
	return len(v.errors) > 0
}

// Errors returns all validation errors
func (v *Validator) Errors() []ValidationError {
	return v.errors
}

// ValidateDomain validates a domain name (RFC 1123)
func (v *Validator) ValidateDomain(field, value string) {
	if value == "" {
		return // Empty is OK, use ValidateRequired for required fields
	}

	if len(value) > 253 {
		v.AddError(field, "domain name too long (max 253 characters)")
		return
	}

	if !domainRegex.MatchString(value) {
		v.AddError(field, "invalid domain name format")
	}
}

// ValidateEmail validates an email address
func (v *Validator) ValidateEmail(field, value string) {
	if value == "" {
		return
	}

	if len(value) > 254 {
		v.AddError(field, "email address too long (max 254 characters)")
		return
	}

	if !emailRegex.MatchString(value) {
		v.AddError(field, "invalid email address format")
	}
}

// ValidateCIDR validates CIDR notation (single or newline-separated list)
func (v *Validator) ValidateCIDR(field, value string) {
	if value == "" {
		return
	}

	lines := strings.Split(value, "\n")
	for i, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Handle both CIDR (192.168.1.0/24) and single IP (192.168.1.1)
		if !strings.Contains(line, "/") {
			// Try parsing as single IP
			if net.ParseIP(line) == nil {
				v.AddError(field, "invalid IP address at line "+string(rune('1'+i))+": "+line)
			}
			continue
		}

		// Parse as CIDR
		_, _, err := net.ParseCIDR(line)
		if err != nil {
			v.AddError(field, "invalid CIDR notation at line "+string(rune('1'+i))+": "+line)
		}
	}
}

// ValidateRelayhost validates Postfix relayhost format
func (v *Validator) ValidateRelayhost(field, value string) {
	if value == "" {
		return
	}

	if len(value) > 255 {
		v.AddError(field, "relayhost too long (max 255 characters)")
		return
	}

	if !relayhostRegex.MatchString(value) {
		v.AddError(field, "invalid relayhost format (expected [hostname]:port or hostname:port)")
	}
}

// ValidateTLSLevel validates Postfix TLS security level
func (v *Validator) ValidateTLSLevel(field, value string) {
	if !validTLSLevels[value] {
		v.AddError(field, "invalid TLS security level (must be: none, may, encrypt, dane, verify, or secure)")
	}
}

// ValidateHostname validates a hostname
func (v *Validator) ValidateHostname(field, value string) {
	if value == "" {
		return
	}

	if len(value) > 253 {
		v.AddError(field, "hostname too long (max 253 characters)")
		return
	}

	if !hostnameRegex.MatchString(value) {
		v.AddError(field, "invalid hostname format")
	}
}

// ValidateRequired validates that a field is not empty
func (v *Validator) ValidateRequired(field, value string) {
	if strings.TrimSpace(value) == "" {
		v.AddError(field, "this field is required")
	}
}

// ValidateMaxLength validates maximum string length
func (v *Validator) ValidateMaxLength(field, value string, maxLen int) {
	if len(value) > maxLen {
		v.AddError(field, "value too long (max "+string(rune('0'+maxLen/100))+string(rune('0'+(maxLen%100)/10))+string(rune('0'+maxLen%10))+" characters)")
	}
}

// ValidatePort validates a port number
func (v *Validator) ValidatePort(field string, port int) {
	if port < 1 || port > 65535 {
		v.AddError(field, "port must be between 1 and 65535")
	}
}

// ValidateIPAddress validates a single IP address (IPv4 or IPv6)
func (v *Validator) ValidateIPAddress(field, value string) {
	if value == "" {
		return
	}

	if net.ParseIP(value) == nil {
		v.AddError(field, "invalid IP address")
	}
}

// ValidateCommaSeparatedEmails validates a comma-separated list of email addresses
func (v *Validator) ValidateCommaSeparatedEmails(field, value string) {
	if value == "" {
		return
	}

	emails := strings.Split(value, ",")
	for _, email := range emails {
		email = strings.TrimSpace(email)
		if email == "" {
			continue
		}
		if !emailRegex.MatchString(email) {
			v.AddError(field, "invalid email address: "+email)
			return // Only report first error
		}
	}
}

// ValidateSenderPattern validates a sender restriction pattern (email, @domain, or domain)
func (v *Validator) ValidateSenderPattern(field, value string) {
	if value == "" {
		return
	}

	// Can be: sender@domain, @domain, or just domain
	if strings.Contains(value, "@") {
		// Either email or @domain pattern
		if strings.HasPrefix(value, "@") {
			// Domain pattern like @example.com
			domain := strings.TrimPrefix(value, "@")
			if !domainRegex.MatchString(domain) {
				v.AddError(field, "invalid domain in sender pattern")
			}
		} else {
			// Full email address
			if !emailRegex.MatchString(value) {
				v.AddError(field, "invalid email address in sender pattern")
			}
		}
	} else {
		// Just a domain
		if !domainRegex.MatchString(value) {
			v.AddError(field, "invalid domain in sender pattern")
		}
	}
}
