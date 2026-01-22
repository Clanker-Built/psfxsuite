package postfix

import (
	"bufio"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ConfigManager handles Postfix configuration operations
type ConfigManager struct {
	configDir string
	mu        sync.RWMutex
}

// NewConfigManager creates a new config manager
func NewConfigManager(configDir string) *ConfigManager {
	return &ConfigManager{
		configDir: configDir,
	}
}

// Config represents the structured Postfix configuration
type Config struct {
	General      GeneralConfig      `json:"general"`
	Relay        RelayConfig        `json:"relay"`
	TLS          TLSConfig          `json:"tls"`
	SASL         SASLConfig         `json:"sasl"`
	Restrictions RestrictionsConfig `json:"restrictions"`
}

type GeneralConfig struct {
	Myhostname     string `json:"myhostname"`
	Mydomain       string `json:"mydomain"`
	Myorigin       string `json:"myorigin"`
	InetInterfaces string `json:"inet_interfaces"`
	InetProtocols  string `json:"inet_protocols"`
}

type RelayConfig struct {
	Relayhost    string `json:"relayhost"`
	Mynetworks   string `json:"mynetworks"`
	RelayDomains string `json:"relay_domains"`
}

type TLSConfig struct {
	SMTPTLSSecurityLevel  string `json:"smtp_tls_security_level"`
	SMTPDTLSSecurityLevel string `json:"smtpd_tls_security_level"`
	SMTPTLSCertFile       string `json:"smtp_tls_cert_file"`
	SMTPTLSKeyFile        string `json:"smtp_tls_key_file"`
	SMTPDTLSCertFile      string `json:"smtpd_tls_cert_file"`
	SMTPDTLSKeyFile       string `json:"smtpd_tls_key_file"`
	SMTPTLSCAFile         string `json:"smtp_tls_CAfile"`
	SMTPTLSLoglevel       string `json:"smtp_tls_loglevel"`
}

type SASLConfig struct {
	SMTPSASLAuthEnable         string `json:"smtp_sasl_auth_enable"`
	SMTPSASLPasswordMaps       string `json:"smtp_sasl_password_maps"`
	SMTPSASLSecurityOptions    string `json:"smtp_sasl_security_options"`
	SMTPSASLTLSSecurityOptions string `json:"smtp_sasl_tls_security_options"`
}

type RestrictionsConfig struct {
	SMTPDRelayRestrictions     string `json:"smtpd_relay_restrictions"`
	SMTPDRecipientRestrictions string `json:"smtpd_recipient_restrictions"`
	SMTPDSenderRestrictions    string `json:"smtpd_sender_restrictions"`
}

// Certificate represents TLS certificate info
type Certificate struct {
	Type      string    `json:"type"`
	CertFile  string    `json:"certFile"`
	KeyFile   string    `json:"keyFile"`
	ValidFrom time.Time `json:"validFrom,omitempty"`
	ValidTo   time.Time `json:"validTo,omitempty"`
	Subject   string    `json:"subject,omitempty"`
	Issuer    string    `json:"issuer,omitempty"`
}

// ReadConfig reads the current Postfix configuration
func (m *ConfigManager) ReadConfig() (*Config, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	mainCfPath := filepath.Join(m.configDir, "main.cf")
	params, err := m.parseMainCf(mainCfPath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse main.cf: %w", err)
	}

	config := &Config{
		General: GeneralConfig{
			Myhostname:     params["myhostname"],
			Mydomain:       params["mydomain"],
			Myorigin:       params["myorigin"],
			InetInterfaces: params["inet_interfaces"],
			InetProtocols:  params["inet_protocols"],
		},
		Relay: RelayConfig{
			Relayhost:    params["relayhost"],
			Mynetworks:   params["mynetworks"],
			RelayDomains: params["relay_domains"],
		},
		TLS: TLSConfig{
			SMTPTLSSecurityLevel:  params["smtp_tls_security_level"],
			SMTPDTLSSecurityLevel: params["smtpd_tls_security_level"],
			SMTPTLSCertFile:       params["smtp_tls_cert_file"],
			SMTPTLSKeyFile:        params["smtp_tls_key_file"],
			SMTPDTLSCertFile:      params["smtpd_tls_cert_file"],
			SMTPDTLSKeyFile:       params["smtpd_tls_key_file"],
			SMTPTLSCAFile:         params["smtp_tls_CAfile"],
			SMTPTLSLoglevel:       params["smtp_tls_loglevel"],
		},
		SASL: SASLConfig{
			SMTPSASLAuthEnable:         params["smtp_sasl_auth_enable"],
			SMTPSASLPasswordMaps:       params["smtp_sasl_password_maps"],
			SMTPSASLSecurityOptions:    params["smtp_sasl_security_options"],
			SMTPSASLTLSSecurityOptions: params["smtp_sasl_tls_security_options"],
		},
		Restrictions: RestrictionsConfig{
			SMTPDRelayRestrictions:     params["smtpd_relay_restrictions"],
			SMTPDRecipientRestrictions: params["smtpd_recipient_restrictions"],
			SMTPDSenderRestrictions:    params["smtpd_sender_restrictions"],
		},
	}

	return config, nil
}

// UpdateConfig updates specific configuration sections
func (m *ConfigManager) UpdateConfig(updates map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	mainCfPath := filepath.Join(m.configDir, "main.cf")

	// Read current config
	params, err := m.parseMainCf(mainCfPath)
	if err != nil {
		return fmt.Errorf("failed to read config: %w", err)
	}

	// Apply updates
	for key, value := range updates {
		if value != "" {
			params[key] = value
		} else {
			delete(params, key)
		}
	}

	// Write back
	return m.writeMainCf(mainCfPath, params)
}

// WriteConfig writes a complete Config struct to the filesystem
func (m *ConfigManager) WriteConfig(cfg *Config) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	mainCfPath := filepath.Join(m.configDir, "main.cf")

	// Read current config to preserve any parameters not in our struct
	params, err := m.parseMainCf(mainCfPath)
	if err != nil {
		return fmt.Errorf("failed to read config: %w", err)
	}

	// Convert Config struct to map and merge with existing params
	configMap := m.configToMap(cfg)
	for key, value := range configMap {
		if value != "" {
			params[key] = value
		} else {
			delete(params, key)
		}
	}

	// Write back
	return m.writeMainCf(mainCfPath, params)
}

// configToMap converts a Config struct to a map of parameters
func (m *ConfigManager) configToMap(cfg *Config) map[string]string {
	params := make(map[string]string)

	// General settings
	if cfg.General.Myhostname != "" {
		params["myhostname"] = cfg.General.Myhostname
	}
	if cfg.General.Mydomain != "" {
		params["mydomain"] = cfg.General.Mydomain
	}
	if cfg.General.Myorigin != "" {
		params["myorigin"] = cfg.General.Myorigin
	}
	if cfg.General.InetInterfaces != "" {
		params["inet_interfaces"] = cfg.General.InetInterfaces
	}
	if cfg.General.InetProtocols != "" {
		params["inet_protocols"] = cfg.General.InetProtocols
	}

	// Relay settings
	if cfg.Relay.Relayhost != "" {
		params["relayhost"] = cfg.Relay.Relayhost
	}
	if cfg.Relay.Mynetworks != "" {
		params["mynetworks"] = cfg.Relay.Mynetworks
	}
	if cfg.Relay.RelayDomains != "" {
		params["relay_domains"] = cfg.Relay.RelayDomains
	}

	// TLS settings
	if cfg.TLS.SMTPTLSSecurityLevel != "" {
		params["smtp_tls_security_level"] = cfg.TLS.SMTPTLSSecurityLevel
	}
	if cfg.TLS.SMTPDTLSSecurityLevel != "" {
		params["smtpd_tls_security_level"] = cfg.TLS.SMTPDTLSSecurityLevel
	}
	if cfg.TLS.SMTPTLSCertFile != "" {
		params["smtp_tls_cert_file"] = cfg.TLS.SMTPTLSCertFile
	}
	if cfg.TLS.SMTPTLSKeyFile != "" {
		params["smtp_tls_key_file"] = cfg.TLS.SMTPTLSKeyFile
	}
	if cfg.TLS.SMTPDTLSCertFile != "" {
		params["smtpd_tls_cert_file"] = cfg.TLS.SMTPDTLSCertFile
	}
	if cfg.TLS.SMTPDTLSKeyFile != "" {
		params["smtpd_tls_key_file"] = cfg.TLS.SMTPDTLSKeyFile
	}
	if cfg.TLS.SMTPTLSCAFile != "" {
		params["smtp_tls_CAfile"] = cfg.TLS.SMTPTLSCAFile
	}
	if cfg.TLS.SMTPTLSLoglevel != "" {
		params["smtp_tls_loglevel"] = cfg.TLS.SMTPTLSLoglevel
	}

	// SASL settings
	if cfg.SASL.SMTPSASLAuthEnable != "" {
		params["smtp_sasl_auth_enable"] = cfg.SASL.SMTPSASLAuthEnable
	}
	if cfg.SASL.SMTPSASLPasswordMaps != "" {
		params["smtp_sasl_password_maps"] = cfg.SASL.SMTPSASLPasswordMaps
	}
	if cfg.SASL.SMTPSASLSecurityOptions != "" {
		params["smtp_sasl_security_options"] = cfg.SASL.SMTPSASLSecurityOptions
	}
	if cfg.SASL.SMTPSASLTLSSecurityOptions != "" {
		params["smtp_sasl_tls_security_options"] = cfg.SASL.SMTPSASLTLSSecurityOptions
	}

	// Restrictions
	if cfg.Restrictions.SMTPDRelayRestrictions != "" {
		params["smtpd_relay_restrictions"] = cfg.Restrictions.SMTPDRelayRestrictions
	}
	if cfg.Restrictions.SMTPDRecipientRestrictions != "" {
		params["smtpd_recipient_restrictions"] = cfg.Restrictions.SMTPDRecipientRestrictions
	}
	if cfg.Restrictions.SMTPDSenderRestrictions != "" {
		params["smtpd_sender_restrictions"] = cfg.Restrictions.SMTPDSenderRestrictions
	}

	return params
}

// parseMainCf parses main.cf and returns key-value pairs
func (m *ConfigManager) parseMainCf(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return make(map[string]string), nil
		}
		return nil, err
	}
	defer file.Close()

	params := make(map[string]string)
	scanner := bufio.NewScanner(file)
	var currentKey, currentValue string
	continueLine := false

	for scanner.Scan() {
		line := scanner.Text()

		// Skip comments and empty lines
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Handle continuation lines
		if continueLine {
			currentValue += " " + strings.TrimSpace(line)
			if !strings.HasSuffix(trimmed, "\\") {
				params[currentKey] = strings.TrimSuffix(currentValue, "\\")
				continueLine = false
			}
			continue
		}

		// Parse key = value
		if idx := strings.Index(line, "="); idx > 0 {
			currentKey = strings.TrimSpace(line[:idx])
			currentValue = strings.TrimSpace(line[idx+1:])

			if strings.HasSuffix(currentValue, "\\") {
				currentValue = strings.TrimSuffix(currentValue, "\\")
				continueLine = true
			} else {
				params[currentKey] = currentValue
			}
		}
	}

	return params, scanner.Err()
}

// writeMainCf writes the configuration to main.cf with atomic write safety
func (m *ConfigManager) writeMainCf(path string, params map[string]string) error {
	dir := filepath.Dir(path)

	// Create timestamped backup for better recovery options
	if _, err := os.Stat(path); err == nil {
		backupPath := fmt.Sprintf("%s.bak.%d", path, time.Now().Unix())
		if err := copyFile(path, backupPath); err != nil {
			return fmt.Errorf("failed to create backup: %w", err)
		}
	}

	// Create secure temp file with random suffix in same directory (for atomic rename)
	file, err := os.CreateTemp(dir, ".main.cf.*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := file.Name()

	// Ensure cleanup on error
	success := false
	defer func() {
		if !success {
			os.Remove(tmpPath)
		}
	}()

	// Set restrictive permissions before writing content
	if err := file.Chmod(0640); err != nil {
		file.Close()
		return fmt.Errorf("failed to set file permissions: %w", err)
	}

	// Write header
	fmt.Fprintf(file, "# Postfix main.cf - Managed by PostfixRelay\n")
	fmt.Fprintf(file, "# Last modified: %s\n\n", time.Now().Format(time.RFC3339))

	// Write parameters in a sensible order
	sections := []struct {
		name   string
		keys   []string
	}{
		{"General", []string{"myhostname", "mydomain", "myorigin", "inet_interfaces", "inet_protocols"}},
		{"Network", []string{"mynetworks", "relay_domains", "relayhost"}},
		{"TLS", []string{"smtp_tls_security_level", "smtpd_tls_security_level", "smtp_tls_cert_file", "smtp_tls_key_file", "smtpd_tls_cert_file", "smtpd_tls_key_file", "smtp_tls_CAfile", "smtp_tls_loglevel"}},
		{"SASL", []string{"smtp_sasl_auth_enable", "smtp_sasl_password_maps", "smtp_sasl_security_options", "smtp_sasl_tls_security_options"}},
		{"Restrictions", []string{"smtpd_relay_restrictions", "smtpd_recipient_restrictions", "smtpd_sender_restrictions"}},
	}

	written := make(map[string]bool)
	for _, section := range sections {
		fmt.Fprintf(file, "# %s\n", section.name)
		for _, key := range section.keys {
			if value, ok := params[key]; ok && value != "" {
				// Handle multi-line values
				if strings.Contains(value, "\n") {
					lines := strings.Split(value, "\n")
					fmt.Fprintf(file, "%s = %s", key, lines[0])
					for _, line := range lines[1:] {
						fmt.Fprintf(file, ",\n    %s", strings.TrimSpace(line))
					}
					fmt.Fprintln(file)
				} else {
					fmt.Fprintf(file, "%s = %s\n", key, value)
				}
				written[key] = true
			}
		}
		fmt.Fprintln(file)
	}

	// Write remaining parameters
	fmt.Fprintln(file, "# Other")
	for key, value := range params {
		if !written[key] && value != "" {
			fmt.Fprintf(file, "%s = %s\n", key, value)
		}
	}

	// Sync to disk before close for durability
	if err := file.Sync(); err != nil {
		file.Close()
		return fmt.Errorf("failed to sync file: %w", err)
	}

	if err := file.Close(); err != nil {
		return fmt.Errorf("failed to close file: %w", err)
	}

	// Atomic rename from temp to target
	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("failed to rename temp file: %w", err)
	}

	success = true // Prevent deferred cleanup
	return nil
}

// Validate validates the current configuration
func (m *ConfigManager) Validate() (bool, []string) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var errors []string

	// Run postfix check (requires sudo)
	cmd := exec.Command("sudo", "postfix", "check")
	output, err := cmd.CombinedOutput()
	if err != nil {
		errors = append(errors, fmt.Sprintf("postfix check failed: %s", strings.TrimSpace(string(output))))
	}

	// Run postconf -n to check syntax (requires sudo)
	cmd = exec.Command("sudo", "postconf", "-c", m.configDir, "-n")
	output, err = cmd.CombinedOutput()
	if err != nil {
		errors = append(errors, fmt.Sprintf("postconf check failed: %s", strings.TrimSpace(string(output))))
	}

	return len(errors) == 0, errors
}

// Reload reloads Postfix configuration
func (m *ConfigManager) Reload() error {
	// Try local reload first (works when postfix runs in same container)
	cmd := exec.Command("sudo", "postfix", "reload")
	output, err := cmd.CombinedOutput()
	if err != nil {
		// If postfix isn't running locally, that's OK in a split-container setup
		// The postfix container has a config watcher that will auto-reload
		outputStr := strings.TrimSpace(string(output))
		if strings.Contains(outputStr, "mail system is not running") {
			// Config watcher in postfix container will handle the reload
			return nil
		}
		return fmt.Errorf("postfix reload failed: %s", outputStr)
	}
	return nil
}

// SaveCertificate saves a TLS certificate
func (m *ConfigManager) SaveCertificate(certType string, certData, keyData []byte) (*Certificate, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Determine file paths
	var certPath, keyPath string
	switch certType {
	case "smtp":
		certPath = filepath.Join(m.configDir, "certs", "smtp-client.crt")
		keyPath = filepath.Join(m.configDir, "certs", "smtp-client.key")
	case "smtpd":
		certPath = filepath.Join(m.configDir, "certs", "smtpd-server.crt")
		keyPath = filepath.Join(m.configDir, "certs", "smtpd-server.key")
	default:
		return nil, fmt.Errorf("invalid certificate type: %s", certType)
	}

	// Create certs directory
	certsDir := filepath.Dir(certPath)
	if err := os.MkdirAll(certsDir, 0700); err != nil {
		return nil, fmt.Errorf("failed to create certs directory: %w", err)
	}

	// Validate certificate
	cert, err := parseCertificate(certData)
	if err != nil {
		return nil, fmt.Errorf("invalid certificate: %w", err)
	}

	// Validate key
	if err := validatePrivateKey(keyData); err != nil {
		return nil, fmt.Errorf("invalid private key: %w", err)
	}

	// Write certificate file
	if err := os.WriteFile(certPath, certData, 0644); err != nil {
		return nil, fmt.Errorf("failed to write certificate: %w", err)
	}

	// Write key file with restricted permissions
	if err := os.WriteFile(keyPath, keyData, 0600); err != nil {
		return nil, fmt.Errorf("failed to write key: %w", err)
	}

	// Update main.cf with certificate paths
	updates := make(map[string]string)
	switch certType {
	case "smtp":
		updates["smtp_tls_cert_file"] = certPath
		updates["smtp_tls_key_file"] = keyPath
	case "smtpd":
		updates["smtpd_tls_cert_file"] = certPath
		updates["smtpd_tls_key_file"] = keyPath
	}

	// Unlock before calling UpdateConfig (which needs the lock)
	m.mu.Unlock()
	if err := m.UpdateConfig(updates); err != nil {
		m.mu.Lock()
		return nil, fmt.Errorf("failed to update config: %w", err)
	}
	m.mu.Lock()

	return &Certificate{
		Type:      certType,
		CertFile:  certPath,
		KeyFile:   keyPath,
		ValidFrom: cert.NotBefore,
		ValidTo:   cert.NotAfter,
		Subject:   cert.Subject.String(),
		Issuer:    cert.Issuer.String(),
	}, nil
}

// GetCertificates returns info about installed certificates
func (m *ConfigManager) GetCertificates() ([]Certificate, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	config, err := m.ReadConfig()
	if err != nil {
		return nil, err
	}

	var certs []Certificate

	// Check SMTP client certificate
	if config.TLS.SMTPTLSCertFile != "" {
		cert, err := m.readCertificateInfo("smtp", config.TLS.SMTPTLSCertFile, config.TLS.SMTPTLSKeyFile)
		if err == nil {
			certs = append(certs, *cert)
		}
	}

	// Check SMTPD server certificate
	if config.TLS.SMTPDTLSCertFile != "" {
		cert, err := m.readCertificateInfo("smtpd", config.TLS.SMTPDTLSCertFile, config.TLS.SMTPDTLSKeyFile)
		if err == nil {
			certs = append(certs, *cert)
		}
	}

	return certs, nil
}

func (m *ConfigManager) readCertificateInfo(certType, certPath, keyPath string) (*Certificate, error) {
	certData, err := os.ReadFile(certPath)
	if err != nil {
		return nil, err
	}

	cert, err := parseCertificate(certData)
	if err != nil {
		return nil, err
	}

	return &Certificate{
		Type:      certType,
		CertFile:  certPath,
		KeyFile:   keyPath,
		ValidFrom: cert.NotBefore,
		ValidTo:   cert.NotAfter,
		Subject:   cert.Subject.String(),
		Issuer:    cert.Issuer.String(),
	}, nil
}

func parseCertificate(data []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("failed to parse PEM block")
	}
	return x509.ParseCertificate(block.Bytes)
}

func validatePrivateKey(data []byte) error {
	block, _ := pem.Decode(data)
	if block == nil {
		return fmt.Errorf("failed to parse PEM block")
	}

	// Check if it's a valid private key type
	validTypes := []string{"RSA PRIVATE KEY", "EC PRIVATE KEY", "PRIVATE KEY"}
	valid := false
	for _, t := range validTypes {
		if block.Type == t {
			valid = true
			break
		}
	}
	if !valid {
		return fmt.Errorf("invalid key type: %s", block.Type)
	}

	return nil
}

func copyFile(src, dst string) error {
	source, err := os.Open(src)
	if err != nil {
		return err
	}
	defer source.Close()

	dest, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dest.Close()

	_, err = io.Copy(dest, source)
	return err
}

// GetQueueStatus returns the current mail queue status
func (m *ConfigManager) GetQueueStatus() (active, deferred, hold, corrupt int) {
	// Parse mailq output
	cmd := exec.Command("mailq")
	output, err := cmd.Output()
	if err != nil {
		return 0, 0, 0, 0
	}

	lines := strings.Split(string(output), "\n")

	// Count queue entries by status
	activeRegex := regexp.MustCompile(`^[A-F0-9]{10,}\*`)
	deferredRegex := regexp.MustCompile(`^[A-F0-9]{10,}[^*!]`)
	holdRegex := regexp.MustCompile(`^[A-F0-9]{10,}!`)

	for _, line := range lines {
		switch {
		case activeRegex.MatchString(line):
			active++
		case holdRegex.MatchString(line):
			hold++
		case deferredRegex.MatchString(line):
			deferred++
		}
	}

	return active, deferred, hold, corrupt
}

// IsRunning checks if Postfix is running
func (m *ConfigManager) IsRunning() bool {
	cmd := exec.Command("postfix", "status")
	err := cmd.Run()
	return err == nil
}

// GetVersion returns the Postfix version
func (m *ConfigManager) GetVersion() string {
	cmd := exec.Command("sudo", "postconf", "-d", "mail_version")
	output, err := cmd.Output()
	if err != nil {
		return "unknown"
	}

	// Parse "mail_version = X.Y.Z"
	parts := strings.Split(strings.TrimSpace(string(output)), "=")
	if len(parts) == 2 {
		return strings.TrimSpace(parts[1])
	}
	return "unknown"
}

// SaveSASLCredentials saves SMTP authentication credentials
func (m *ConfigManager) SaveSASLCredentials(relayhost, username, password string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// sasl_passwd file format: [hostname]:port username:password
	saslPasswdPath := filepath.Join(m.configDir, "sasl_passwd")

	// Read existing entries (if any)
	entries := make(map[string]string)
	if data, err := os.ReadFile(saslPasswdPath); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, " ", 2)
			if len(parts) == 2 {
				entries[parts[0]] = parts[1]
			}
		}
	}

	// Add/update the entry
	entries[relayhost] = fmt.Sprintf("%s:%s", username, password)

	// Write the file
	var content strings.Builder
	content.WriteString("# SASL password file - Managed by PostfixRelay\n")
	content.WriteString("# Format: [hostname]:port username:password\n\n")
	for host, creds := range entries {
		content.WriteString(fmt.Sprintf("%s %s\n", host, creds))
	}

	// Write with restricted permissions
	if err := os.WriteFile(saslPasswdPath, []byte(content.String()), 0600); err != nil {
		return fmt.Errorf("failed to write sasl_passwd: %w", err)
	}

	// Generate the hash database
	cmd := exec.Command("sudo", "postmap", saslPasswdPath)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to run postmap: %s", strings.TrimSpace(string(output)))
	}

	// Update main.cf to use the password map
	updates := map[string]string{
		"smtp_sasl_password_maps": "hash:" + saslPasswdPath,
	}

	// We need to release the lock before calling UpdateConfig
	m.mu.Unlock()
	err := m.UpdateConfig(updates)
	m.mu.Lock()

	return err
}

// DeleteSASLCredentials removes SMTP authentication credentials for a relay host
func (m *ConfigManager) DeleteSASLCredentials(relayhost string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	saslPasswdPath := filepath.Join(m.configDir, "sasl_passwd")

	// Read existing entries
	entries := make(map[string]string)
	if data, err := os.ReadFile(saslPasswdPath); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, " ", 2)
			if len(parts) == 2 && parts[0] != relayhost {
				entries[parts[0]] = parts[1]
			}
		}
	}

	// Write the file
	var content strings.Builder
	content.WriteString("# SASL password file - Managed by PostfixRelay\n")
	content.WriteString("# Format: [hostname]:port username:password\n\n")
	for host, creds := range entries {
		content.WriteString(fmt.Sprintf("%s %s\n", host, creds))
	}

	if err := os.WriteFile(saslPasswdPath, []byte(content.String()), 0600); err != nil {
		return fmt.Errorf("failed to write sasl_passwd: %w", err)
	}

	// Regenerate the hash database
	cmd := exec.Command("sudo", "postmap", saslPasswdPath)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to run postmap: %s", strings.TrimSpace(string(output)))
	}

	return nil
}

// TransportMap represents a domain routing entry
type TransportMap struct {
	Domain    string `json:"domain"`
	Transport string `json:"transport"` // e.g., "smtp:[relay.example.com]:587"
	NextHop   string `json:"nextHop"`   // The relay server
	Port      int    `json:"port"`
	Enabled   bool   `json:"enabled"`
}

// GetTransportMaps reads the transport maps
func (m *ConfigManager) GetTransportMaps() ([]TransportMap, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	transportPath := filepath.Join(m.configDir, "transport")
	var maps []TransportMap

	data, err := os.ReadFile(transportPath)
	if err != nil {
		if os.IsNotExist(err) {
			return maps, nil
		}
		return nil, fmt.Errorf("failed to read transport file: %w", err)
	}

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		enabled := true
		if strings.HasPrefix(line, "#") {
			enabled = false
			line = strings.TrimPrefix(line, "#")
			line = strings.TrimSpace(line)
		}

		// Parse: domain transport:nexthop
		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		domain := parts[0]
		transport := parts[1]

		// Parse transport format: smtp:[host]:port or smtp:host:port
		tm := TransportMap{
			Domain:    domain,
			Transport: transport,
			Enabled:   enabled,
		}

		// Extract nexthop and port
		if strings.HasPrefix(transport, "smtp:") {
			rest := strings.TrimPrefix(transport, "smtp:")
			rest = strings.Trim(rest, "[]")
			if idx := strings.LastIndex(rest, ":"); idx > 0 {
				tm.NextHop = rest[:idx]
				tm.Port = 25
				if portStr := rest[idx+1:]; portStr != "" {
					fmt.Sscanf(portStr, "%d", &tm.Port)
				}
			} else {
				tm.NextHop = rest
				tm.Port = 25
			}
		}

		maps = append(maps, tm)
	}

	return maps, nil
}

// SaveTransportMaps saves the transport maps
func (m *ConfigManager) SaveTransportMaps(maps []TransportMap) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	transportPath := filepath.Join(m.configDir, "transport")

	// Build content
	var content strings.Builder
	content.WriteString("# Transport maps - Managed by PostfixRelay\n")
	content.WriteString("# Format: domain transport:nexthop\n\n")

	for _, tm := range maps {
		prefix := ""
		if !tm.Enabled {
			prefix = "# "
		}

		// Build transport string
		transport := fmt.Sprintf("smtp:[%s]:%d", tm.NextHop, tm.Port)
		content.WriteString(fmt.Sprintf("%s%s\t%s\n", prefix, tm.Domain, transport))
	}

	// Write the file
	if err := os.WriteFile(transportPath, []byte(content.String()), 0644); err != nil {
		return fmt.Errorf("failed to write transport file: %w", err)
	}

	// Generate the hash database
	cmd := exec.Command("sudo", "postmap", transportPath)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to run postmap: %s", strings.TrimSpace(string(output)))
	}

	// Update main.cf to use transport maps
	updates := map[string]string{
		"transport_maps": "hash:" + transportPath,
	}

	// Release lock before calling UpdateConfig
	m.mu.Unlock()
	err := m.UpdateConfig(updates)
	m.mu.Lock()

	return err
}

// AddTransportMap adds a single transport map entry
func (m *ConfigManager) AddTransportMap(tm TransportMap) error {
	maps, err := m.GetTransportMaps()
	if err != nil {
		return err
	}

	// Check for duplicate domain
	for _, existing := range maps {
		if existing.Domain == tm.Domain {
			return fmt.Errorf("transport map for domain %s already exists", tm.Domain)
		}
	}

	maps = append(maps, tm)
	return m.SaveTransportMaps(maps)
}

// UpdateTransportMap updates an existing transport map entry
func (m *ConfigManager) UpdateTransportMap(domain string, tm TransportMap) error {
	maps, err := m.GetTransportMaps()
	if err != nil {
		return err
	}

	found := false
	for i, existing := range maps {
		if existing.Domain == domain {
			maps[i] = tm
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("transport map for domain %s not found", domain)
	}

	return m.SaveTransportMaps(maps)
}

// DeleteTransportMap removes a transport map entry
func (m *ConfigManager) DeleteTransportMap(domain string) error {
	maps, err := m.GetTransportMaps()
	if err != nil {
		return err
	}

	var newMaps []TransportMap
	found := false
	for _, existing := range maps {
		if existing.Domain == domain {
			found = true
			continue
		}
		newMaps = append(newMaps, existing)
	}

	if !found {
		return fmt.Errorf("transport map for domain %s not found", domain)
	}

	return m.SaveTransportMaps(newMaps)
}

// SenderDependentRelay represents a sender-based relay entry
type SenderDependentRelay struct {
	Sender    string `json:"sender"`    // Email address or @domain
	Relayhost string `json:"relayhost"` // [relay.example.com]:587
	Enabled   bool   `json:"enabled"`
}

// GetSenderDependentRelays reads the sender-dependent relay map
func (m *ConfigManager) GetSenderDependentRelays() ([]SenderDependentRelay, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	senderRelayPath := filepath.Join(m.configDir, "sender_relay")
	var relays []SenderDependentRelay

	data, err := os.ReadFile(senderRelayPath)
	if err != nil {
		if os.IsNotExist(err) {
			return relays, nil
		}
		return nil, fmt.Errorf("failed to read sender_relay file: %w", err)
	}

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		enabled := true
		if strings.HasPrefix(line, "#") {
			enabled = false
			line = strings.TrimPrefix(line, "#")
			line = strings.TrimSpace(line)
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		relays = append(relays, SenderDependentRelay{
			Sender:    parts[0],
			Relayhost: parts[1],
			Enabled:   enabled,
		})
	}

	return relays, nil
}

// SaveSenderDependentRelays saves the sender-dependent relay map
func (m *ConfigManager) SaveSenderDependentRelays(relays []SenderDependentRelay) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	senderRelayPath := filepath.Join(m.configDir, "sender_relay")

	var content strings.Builder
	content.WriteString("# Sender-dependent relay maps - Managed by PostfixRelay\n")
	content.WriteString("# Format: sender@domain [relay]:port\n\n")

	for _, relay := range relays {
		prefix := ""
		if !relay.Enabled {
			prefix = "# "
		}
		content.WriteString(fmt.Sprintf("%s%s\t%s\n", prefix, relay.Sender, relay.Relayhost))
	}

	if err := os.WriteFile(senderRelayPath, []byte(content.String()), 0644); err != nil {
		return fmt.Errorf("failed to write sender_relay file: %w", err)
	}

	// Generate the hash database
	cmd := exec.Command("sudo", "postmap", senderRelayPath)
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("failed to run postmap: %s", strings.TrimSpace(string(output)))
	}

	// Update main.cf
	updates := map[string]string{
		"sender_dependent_relayhost_maps": "hash:" + senderRelayPath,
	}

	m.mu.Unlock()
	err := m.UpdateConfig(updates)
	m.mu.Lock()

	return err
}

// AddSenderDependentRelay adds a sender-dependent relay entry
func (m *ConfigManager) AddSenderDependentRelay(relay SenderDependentRelay) error {
	relays, err := m.GetSenderDependentRelays()
	if err != nil {
		return err
	}

	for _, existing := range relays {
		if existing.Sender == relay.Sender {
			return fmt.Errorf("sender relay for %s already exists", relay.Sender)
		}
	}

	relays = append(relays, relay)
	return m.SaveSenderDependentRelays(relays)
}

// UpdateSenderDependentRelay updates a sender-dependent relay entry
func (m *ConfigManager) UpdateSenderDependentRelay(sender string, relay SenderDependentRelay) error {
	relays, err := m.GetSenderDependentRelays()
	if err != nil {
		return err
	}

	found := false
	for i, existing := range relays {
		if existing.Sender == sender {
			relays[i] = relay
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("sender relay for %s not found", sender)
	}

	return m.SaveSenderDependentRelays(relays)
}

// DeleteSenderDependentRelay removes a sender-dependent relay entry
func (m *ConfigManager) DeleteSenderDependentRelay(sender string) error {
	relays, err := m.GetSenderDependentRelays()
	if err != nil {
		return err
	}

	var newRelays []SenderDependentRelay
	found := false
	for _, existing := range relays {
		if existing.Sender == sender {
			found = true
			continue
		}
		newRelays = append(newRelays, existing)
	}

	if !found {
		return fmt.Errorf("sender relay for %s not found", sender)
	}

	return m.SaveSenderDependentRelays(newRelays)
}
