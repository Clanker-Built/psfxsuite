package config

import (
	"fmt"
	"os"

	"github.com/rs/zerolog/log"
)

// Config holds application configuration
type Config struct {
	// Server settings
	ListenAddr string

	// Database
	DBPath string

	// Security
	AppSecret       string
	DBEncryptionKey string

	// Postfix paths
	PostfixConfigDir string
	PostfixBinary    string

	// Log settings
	LogSource string // "auto", "journald", or file path
	LogPath   string // Path to mail log file

	// Retention
	LogRetentionDays   int
	AuditRetentionDays int

	// Session
	SessionTimeoutHours int
}

// Load reads configuration from environment variables
func Load() (*Config, error) {
	// Get required security secrets - fail startup if not set or too weak
	appSecret, err := getEnvRequiredMinLength("APP_SECRET", 32)
	if err != nil {
		return nil, fmt.Errorf("security configuration error: %w", err)
	}

	dbEncryptionKey, err := getEnvRequiredMinLength("DB_ENCRYPTION_KEY", 32)
	if err != nil {
		return nil, fmt.Errorf("security configuration error: %w", err)
	}

	cfg := &Config{
		ListenAddr:          getEnv("LISTEN_ADDR", ":8080"),
		DBPath:              getEnv("DB_PATH", "./data/postfixrelay.db"),
		AppSecret:           appSecret,
		DBEncryptionKey:     dbEncryptionKey,
		PostfixConfigDir:    getEnv("POSTFIX_CONFIG_DIR", "/etc/postfix"),
		PostfixBinary:       getEnv("POSTFIX_BINARY", "/usr/sbin/postfix"),
		LogSource:           getEnv("LOG_SOURCE", "auto"),
		LogPath:             getEnv("LOG_PATH", "/var/log/mail.log"),
		LogRetentionDays:    getEnvInt("LOG_RETENTION_DAYS", 7),
		AuditRetentionDays:  getEnvInt("AUDIT_RETENTION_DAYS", 90),
		SessionTimeoutHours: getEnvInt("SESSION_TIMEOUT_HOURS", 8),
	}

	log.Info().Msg("Configuration loaded successfully")
	return cfg, nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvRequiredMinLength returns an error if the environment variable is not set
// or if its value is shorter than the minimum required length
func getEnvRequiredMinLength(key string, minLength int) (string, error) {
	value := os.Getenv(key)
	if value == "" {
		return "", fmt.Errorf("%s environment variable is required but not set", key)
	}
	if len(value) < minLength {
		return "", fmt.Errorf("%s must be at least %d characters (got %d)", key, minLength, len(value))
	}
	return value, nil
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		var i int
		if _, err := os.Stderr.WriteString(""); err == nil {
			// Simple string to int conversion
			for _, c := range value {
				if c >= '0' && c <= '9' {
					i = i*10 + int(c-'0')
				} else {
					return defaultValue
				}
			}
			return i
		}
	}
	return defaultValue
}
