package api

import (
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

type statusResponse struct {
	Postfix    postfixStatus    `json:"postfix"`
	Queue      queueStatus      `json:"queue"`
	LastReload lastReloadStatus `json:"lastReload"`
	ConfigStatus string         `json:"configStatus"`
}

type postfixStatus struct {
	Running bool   `json:"running"`
	Version string `json:"version"`
}

type queueStatus struct {
	Active   int `json:"active"`
	Deferred int `json:"deferred"`
	Hold     int `json:"hold"`
	Corrupt  int `json:"corrupt"`
}

type lastReloadStatus struct {
	Timestamp string `json:"timestamp"`
	Success   bool   `json:"success"`
}

func (s *Server) getStatus(w http.ResponseWriter, r *http.Request) {
	resp := statusResponse{
		Postfix:      s.getPostfixStatus(),
		Queue:        s.getQueueStatus(),
		LastReload:   s.getLastReloadStatus(),
		ConfigStatus: "ok",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) getPostfixStatus() postfixStatus {
	status := postfixStatus{
		Running: false,
		Version: "unknown",
	}

	// First try local postfix status (same-container setup)
	cmd := exec.Command("sudo", "postfix", "status")
	if err := cmd.Run(); err == nil {
		status.Running = true
	} else {
		// Try connecting to postfix container via SMTP (split-container setup)
		// Check POSTFIX_HOST env var, default to "postfix" (docker service name)
		postfixHost := os.Getenv("POSTFIX_HOST")
		if postfixHost == "" {
			postfixHost = "postfix"
		}

		// Try port 25 first, then 587
		for _, port := range []string{"25", "587"} {
			conn, err := net.DialTimeout("tcp", postfixHost+":"+port, 2*time.Second)
			if err == nil {
				conn.Close()
				status.Running = true
				break
			}
		}
	}

	// Get postfix version from local postconf
	cmd = exec.Command("sudo", "postconf", "-d", "mail_version")
	output, err := cmd.Output()
	if err == nil {
		parts := strings.SplitN(string(output), "=", 2)
		if len(parts) == 2 {
			status.Version = strings.TrimSpace(parts[1])
		}
	}

	return status
}

func (s *Server) getQueueStatus() queueStatus {
	status := queueStatus{}

	// Run mailq and parse output
	cmd := exec.Command("sudo", "postqueue", "-p")
	output, err := cmd.Output()
	if err != nil {
		log.Debug().Err(err).Msg("failed to get queue status")
		return status
	}

	lines := strings.Split(string(output), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}

		// Count by status markers
		if strings.HasPrefix(line, "*") {
			status.Active++
		} else if strings.Contains(line, "(deferred") {
			status.Deferred++
		} else if strings.HasPrefix(line, "!") {
			status.Hold++
		}
	}

	return status
}

func (s *Server) getLastReloadStatus() lastReloadStatus {
	var timestamp time.Time
	var success bool

	err := s.db.QueryRow(`
		SELECT applied_at, status = 'applied'
		FROM config_versions
		WHERE applied_at IS NOT NULL
		ORDER BY applied_at DESC
		LIMIT 1
	`).Scan(&timestamp, &success)

	if err != nil {
		return lastReloadStatus{
			Timestamp: "",
			Success:   true, // Assume OK if no history
		}
	}

	return lastReloadStatus{
		Timestamp: timestamp.Format(time.RFC3339),
		Success:   success,
	}
}
