package postfix

import (
	"bufio"
	"errors"
	"fmt"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ErrInvalidQueueID is returned when a queue ID doesn't match the expected format
var ErrInvalidQueueID = errors.New("invalid queue ID format")

// queueIDRegex validates Postfix queue ID format (10-12 hex characters)
var queueIDRegex = regexp.MustCompile(`^[A-F0-9]{10,12}$`)

// QueueMessage represents a message in the Postfix queue
type QueueMessage struct {
	QueueID     string    `json:"queueId"`
	Status      string    `json:"status"` // active, deferred, hold
	Size        int64     `json:"size"`
	ArrivalTime time.Time `json:"arrivalTime"`
	Sender      string    `json:"sender"`
	Recipients  []string  `json:"recipients"`
	Reason      string    `json:"reason,omitempty"`
}

// QueueManager handles Postfix queue operations
type QueueManager struct {
	configDir string
}

// NewQueueManager creates a new queue manager
func NewQueueManager(configDir string) *QueueManager {
	return &QueueManager{configDir: configDir}
}

// ValidateQueueID validates that a queue ID matches the expected Postfix format
// Queue IDs are 10-12 uppercase hexadecimal characters
func ValidateQueueID(queueID string) error {
	if !queueIDRegex.MatchString(queueID) {
		return fmt.Errorf("%w: %s (expected 10-12 hex characters)", ErrInvalidQueueID, queueID)
	}
	return nil
}

// ListMessages returns all messages in the queue
func (m *QueueManager) ListMessages(statusFilter string) ([]QueueMessage, error) {
	cmd := exec.Command("mailq")
	output, err := cmd.Output()
	if err != nil {
		// mailq returns exit code 1 if queue is empty
		if len(output) == 0 {
			return []QueueMessage{}, nil
		}
	}

	messages := m.parseMailq(string(output))

	// Filter by status if requested
	if statusFilter != "" {
		filtered := make([]QueueMessage, 0)
		for _, msg := range messages {
			if msg.Status == statusFilter {
				filtered = append(filtered, msg)
			}
		}
		return filtered, nil
	}

	return messages, nil
}

// GetMessage returns details for a specific queue message
func (m *QueueManager) GetMessage(queueID string) (*QueueMessage, error) {
	// Validate queue ID to prevent injection
	if err := ValidateQueueID(queueID); err != nil {
		return nil, err
	}

	messages, err := m.ListMessages("")
	if err != nil {
		return nil, err
	}

	for _, msg := range messages {
		if msg.QueueID == queueID {
			return &msg, nil
		}
	}

	return nil, fmt.Errorf("message not found: %s", queueID)
}

// safePostsuperScript is the path to the wrapper script for postsuper
const safePostsuperScript = "/opt/postfixrelay/scripts/safe-postsuper.sh"

// HoldMessage puts a message on hold
func (m *QueueManager) HoldMessage(queueID string) error {
	// Validate queue ID to prevent command injection (defense in depth)
	if err := ValidateQueueID(queueID); err != nil {
		return err
	}

	// Use wrapper script via sudo for additional security
	cmd := exec.Command("sudo", safePostsuperScript, "-h", queueID)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to hold message: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

// ReleaseMessage releases a held message
func (m *QueueManager) ReleaseMessage(queueID string) error {
	// Validate queue ID to prevent command injection (defense in depth)
	if err := ValidateQueueID(queueID); err != nil {
		return err
	}

	// Use wrapper script via sudo for additional security
	cmd := exec.Command("sudo", safePostsuperScript, "-H", queueID)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to release message: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

// DeleteMessage deletes a message from the queue
func (m *QueueManager) DeleteMessage(queueID string) error {
	// Validate queue ID to prevent command injection (defense in depth)
	if err := ValidateQueueID(queueID); err != nil {
		return err
	}

	// Use wrapper script via sudo for additional security
	cmd := exec.Command("sudo", safePostsuperScript, "-d", queueID)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to delete message: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

// FlushQueue attempts to deliver all queued messages
func (m *QueueManager) FlushQueue() error {
	cmd := exec.Command("postqueue", "-f")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to flush queue: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

// RequeueMessages requeues all messages (useful after config changes)
func (m *QueueManager) RequeueMessages() error {
	cmd := exec.Command("postsuper", "-r", "ALL")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to requeue messages: %s", strings.TrimSpace(string(output)))
	}
	return nil
}

// parseMailq parses the output of the mailq command
func (m *QueueManager) parseMailq(output string) []QueueMessage {
	var messages []QueueMessage

	// mailq format:
	// -Queue ID- --Size-- ----Arrival Time---- -Sender/Recipient-------
	// ABC123*     1234 Wed Jan 15 10:30:00  sender@example.com
	//                                          recipient@example.com
	// ABC124!     5678 Wed Jan 15 10:35:00  sender2@example.com
	// (delivery reason)
	//                                          recipient2@example.com

	// Regex to match queue entry header
	// QueueID can end with: * (active), ! (hold), or nothing (deferred)
	headerRegex := regexp.MustCompile(`^([A-F0-9]{10,12})([*!]?)\s+(\d+)\s+(.+?)\s{2,}(\S+)$`)
	reasonRegex := regexp.MustCompile(`^\s*\((.+)\)$`)
	recipientRegex := regexp.MustCompile(`^\s+(\S+@\S+)$`)

	scanner := bufio.NewScanner(strings.NewReader(output))
	var currentMsg *QueueMessage

	for scanner.Scan() {
		line := scanner.Text()

		// Skip header and footer lines
		if strings.HasPrefix(line, "-Queue ID-") ||
			strings.HasPrefix(line, "-- ") ||
			strings.Contains(line, "Mail queue is empty") ||
			line == "" {
			continue
		}

		// Check for new message header
		if matches := headerRegex.FindStringSubmatch(line); matches != nil {
			// Save previous message
			if currentMsg != nil {
				messages = append(messages, *currentMsg)
			}

			// Parse status
			status := "deferred"
			switch matches[2] {
			case "*":
				status = "active"
			case "!":
				status = "hold"
			}

			// Parse size
			size, _ := strconv.ParseInt(matches[3], 10, 64)

			// Parse arrival time
			arrivalTime, _ := time.Parse("Mon Jan _2 15:04:05", matches[4])
			if arrivalTime.Year() == 0 {
				arrivalTime = arrivalTime.AddDate(time.Now().Year(), 0, 0)
			}

			currentMsg = &QueueMessage{
				QueueID:     matches[1],
				Status:      status,
				Size:        size,
				ArrivalTime: arrivalTime,
				Sender:      matches[5],
				Recipients:  []string{},
			}
			continue
		}

		// Check for reason (in parentheses)
		if currentMsg != nil {
			if matches := reasonRegex.FindStringSubmatch(line); matches != nil {
				currentMsg.Reason = matches[1]
				continue
			}

			// Check for recipient
			if matches := recipientRegex.FindStringSubmatch(line); matches != nil {
				currentMsg.Recipients = append(currentMsg.Recipients, matches[1])
			}
		}
	}

	// Don't forget the last message
	if currentMsg != nil {
		messages = append(messages, *currentMsg)
	}

	return messages
}

// GetQueueSummary returns queue statistics
func (m *QueueManager) GetQueueSummary() (active, deferred, hold, corrupt int) {
	messages, err := m.ListMessages("")
	if err != nil {
		return 0, 0, 0, 0
	}

	for _, msg := range messages {
		switch msg.Status {
		case "active":
			active++
		case "deferred":
			deferred++
		case "hold":
			hold++
		}
	}

	return active, deferred, hold, corrupt
}
