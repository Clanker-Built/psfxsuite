package mail

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/textproto"
	"os"
	"sync"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/rs/zerolog/log"
)

// Session represents an authenticated mail session with IMAP connection
type Session struct {
	ID        string
	Email     string
	Password  string // Stored in memory for SMTP sending during session
	client    *client.Client
	mu        sync.Mutex
	lastUsed  time.Time
	CreatedAt time.Time
}

// SessionManager manages mail sessions for webmail users
type SessionManager struct {
	sessions map[string]*Session
	mu       sync.RWMutex
	imapHost string
	imapPort string
}

// NewSessionManager creates a new session manager
func NewSessionManager() *SessionManager {
	host := os.Getenv("DOVECOT_HOST")
	if host == "" {
		host = "dovecot"
	}
	port := os.Getenv("DOVECOT_IMAP_PORT")
	if port == "" {
		port = "143"
	}

	sm := &SessionManager{
		sessions: make(map[string]*Session),
		imapHost: host,
		imapPort: port,
	}

	// Start cleanup goroutine
	go sm.cleanupLoop()

	return sm
}

// Authenticate creates a new mail session by authenticating with IMAP
func (sm *SessionManager) Authenticate(email, password string) (*Session, error) {
	// Connect to IMAP server
	addr := net.JoinHostPort(sm.imapHost, sm.imapPort)
	log.Debug().Str("addr", addr).Str("email", email).Msg("Connecting to IMAP server")

	c, err := client.Dial(addr)
	if err != nil {
		// Try with TLS on port 993 if plain fails
		tlsAddr := net.JoinHostPort(sm.imapHost, "993")
		c, err = client.DialTLS(tlsAddr, &tls.Config{
			InsecureSkipVerify: true, // For development - configure properly in production
		})
		if err != nil {
			log.Error().Err(err).Str("addr", addr).Msg("Failed to connect to IMAP server")
			return nil, fmt.Errorf("failed to connect to mail server: %w", err)
		}
	}

	// Login
	if err := c.Login(email, password); err != nil {
		c.Logout()
		log.Warn().Err(err).Str("email", email).Msg("IMAP authentication failed")
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	// Generate session ID
	sessionID := GenerateSessionID()

	session := &Session{
		ID:        sessionID,
		Email:     email,
		Password:  password, // Store for SMTP sending
		client:    c,
		lastUsed:  time.Now(),
		CreatedAt: time.Now(),
	}

	sm.mu.Lock()
	sm.sessions[sessionID] = session
	sm.mu.Unlock()

	log.Info().Str("email", email).Str("sessionId", sessionID).Msg("Mail session created")

	return session, nil
}

// GetSession retrieves a session by ID
func (sm *SessionManager) GetSession(sessionID string) (*Session, bool) {
	sm.mu.RLock()
	session, ok := sm.sessions[sessionID]
	sm.mu.RUnlock()

	if ok {
		session.mu.Lock()
		session.lastUsed = time.Now()
		session.mu.Unlock()
	}

	return session, ok
}

// CloseSession closes and removes a session
func (sm *SessionManager) CloseSession(sessionID string) {
	sm.mu.Lock()
	session, ok := sm.sessions[sessionID]
	if ok {
		delete(sm.sessions, sessionID)
	}
	sm.mu.Unlock()

	if ok && session.client != nil {
		session.client.Logout()
	}

	log.Debug().Str("sessionId", sessionID).Msg("Mail session closed")
}

// cleanupLoop periodically removes stale sessions
func (sm *SessionManager) cleanupLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		sm.cleanupStaleSessions()
	}
}

func (sm *SessionManager) cleanupStaleSessions() {
	threshold := time.Now().Add(-30 * time.Minute)

	sm.mu.Lock()
	defer sm.mu.Unlock()

	for id, session := range sm.sessions {
		session.mu.Lock()
		stale := session.lastUsed.Before(threshold)
		session.mu.Unlock()

		if stale {
			if session.client != nil {
				session.client.Logout()
			}
			delete(sm.sessions, id)
			log.Debug().Str("sessionId", id).Msg("Cleaned up stale mail session")
		}
	}
}

// GenerateSessionID creates a random session ID
func GenerateSessionID() string {
	return fmt.Sprintf("mail_%d_%s", time.Now().UnixNano(), randomString(16))
}

func randomString(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[time.Now().UnixNano()%int64(len(letters))]
		time.Sleep(time.Nanosecond)
	}
	return string(b)
}

// Session methods

// ListFolders returns all mailbox folders
func (s *Session) ListFolders() ([]Folder, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	mailboxes := make(chan *imap.MailboxInfo, 50)
	done := make(chan error, 1)

	go func() {
		done <- s.client.List("", "*", mailboxes)
	}()

	var folders []Folder
	for m := range mailboxes {
		folder := Folder{
			Name:       m.Name,
			Delimiter:  string(m.Delimiter),
			Attributes: m.Attributes,
		}

		// Determine special use
		for _, attr := range m.Attributes {
			switch attr {
			case "\\Sent":
				folder.SpecialUse = "sent"
			case "\\Drafts":
				folder.SpecialUse = "drafts"
			case "\\Trash":
				folder.SpecialUse = "trash"
			case "\\Junk", "\\Spam":
				folder.SpecialUse = "junk"
			case "\\Archive":
				folder.SpecialUse = "archive"
			case "\\Flagged":
				folder.SpecialUse = "starred"
			}
		}

		folders = append(folders, folder)
	}

	if err := <-done; err != nil {
		return nil, fmt.Errorf("failed to list folders: %w", err)
	}

	// Get message counts for each folder
	for i := range folders {
		status, err := s.client.Select(folders[i].Name, true)
		if err == nil {
			folders[i].Total = int(status.Messages)
			folders[i].Unseen = int(status.Unseen)
		}
	}

	return folders, nil
}

// SelectFolder selects a mailbox folder
func (s *Session) SelectFolder(name string) (*FolderStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	mbox, err := s.client.Select(name, false)
	if err != nil {
		return nil, fmt.Errorf("failed to select folder: %w", err)
	}

	return &FolderStatus{
		Name:     name,
		Total:    int(mbox.Messages),
		Recent:   int(mbox.Recent),
		Unseen:   int(mbox.Unseen),
		UIDNext:  mbox.UidNext,
		UIDValid: mbox.UidValidity,
	}, nil
}

// FetchMessages fetches messages from the current folder
func (s *Session) FetchMessages(folder string, offset, limit int) ([]MessageSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Select folder
	mbox, err := s.client.Select(folder, true)
	if err != nil {
		return nil, fmt.Errorf("failed to select folder: %w", err)
	}

	if mbox.Messages == 0 {
		return []MessageSummary{}, nil
	}

	// Calculate sequence range (newest first)
	from := int(mbox.Messages) - offset - limit + 1
	to := int(mbox.Messages) - offset
	if from < 1 {
		from = 1
	}
	if to < 1 {
		return []MessageSummary{}, nil
	}

	seqSet := new(imap.SeqSet)
	seqSet.AddRange(uint32(from), uint32(to))

	// Fetch envelope and flags
	items := []imap.FetchItem{imap.FetchEnvelope, imap.FetchFlags, imap.FetchUid, imap.FetchRFC822Size}

	messages := make(chan *imap.Message, limit)
	done := make(chan error, 1)

	go func() {
		done <- s.client.Fetch(seqSet, items, messages)
	}()

	var summaries []MessageSummary
	for msg := range messages {
		summary := MessageSummary{
			UID:     msg.Uid,
			SeqNum:  msg.SeqNum,
			Size:    int64(msg.Size),
			Flags:   msg.Flags,
			Read:    hasFlag(msg.Flags, imap.SeenFlag),
			Starred: hasFlag(msg.Flags, imap.FlaggedFlag),
		}

		if msg.Envelope != nil {
			summary.Subject = msg.Envelope.Subject
			summary.Date = msg.Envelope.Date
			summary.MessageID = msg.Envelope.MessageId
			summary.InReplyTo = msg.Envelope.InReplyTo

			if len(msg.Envelope.From) > 0 {
				summary.From = addressToString(msg.Envelope.From[0])
				summary.FromName = msg.Envelope.From[0].PersonalName
			}

			for _, to := range msg.Envelope.To {
				summary.To = append(summary.To, addressToString(to))
			}
		}

		summaries = append(summaries, summary)
	}

	if err := <-done; err != nil {
		return nil, fmt.Errorf("failed to fetch messages: %w", err)
	}

	// Reverse to get newest first
	for i, j := 0, len(summaries)-1; i < j; i, j = i+1, j-1 {
		summaries[i], summaries[j] = summaries[j], summaries[i]
	}

	return summaries, nil
}

// FetchMessage fetches a complete message by UID
func (s *Session) FetchMessage(folder string, uid uint32) (*Message, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Select folder
	_, err := s.client.Select(folder, true)
	if err != nil {
		return nil, fmt.Errorf("failed to select folder: %w", err)
	}

	seqSet := new(imap.SeqSet)
	seqSet.AddNum(uid)

	// Fetch full message
	section := &imap.BodySectionName{}
	items := []imap.FetchItem{section.FetchItem(), imap.FetchEnvelope, imap.FetchFlags, imap.FetchUid}

	messages := make(chan *imap.Message, 1)
	done := make(chan error, 1)

	go func() {
		done <- s.client.UidFetch(seqSet, items, messages)
	}()

	msg := <-messages
	if err := <-done; err != nil {
		return nil, fmt.Errorf("failed to fetch message: %w", err)
	}

	if msg == nil {
		return nil, fmt.Errorf("message not found")
	}

	message := &Message{
		UID:     msg.Uid,
		Flags:   msg.Flags,
		Read:    hasFlag(msg.Flags, imap.SeenFlag),
		Starred: hasFlag(msg.Flags, imap.FlaggedFlag),
	}

	if msg.Envelope != nil {
		message.Subject = msg.Envelope.Subject
		message.Date = msg.Envelope.Date
		message.MessageID = msg.Envelope.MessageId
		message.InReplyTo = msg.Envelope.InReplyTo

		if len(msg.Envelope.From) > 0 {
			message.From = Address{
				Name:  msg.Envelope.From[0].PersonalName,
				Email: addressToString(msg.Envelope.From[0]),
			}
		}

		for _, addr := range msg.Envelope.To {
			message.To = append(message.To, Address{
				Name:  addr.PersonalName,
				Email: addressToString(addr),
			})
		}

		for _, addr := range msg.Envelope.Cc {
			message.Cc = append(message.Cc, Address{
				Name:  addr.PersonalName,
				Email: addressToString(addr),
			})
		}
	}

	// Get body
	for _, literal := range msg.Body {
		if literal != nil {
			buf := make([]byte, literal.Len())
			literal.Read(buf)
			message.RawBody = string(buf)
			break
		}
	}

	return message, nil
}

// SetFlags sets flags on a message
func (s *Session) SetFlags(folder string, uid uint32, flags []string, add bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.client.Select(folder, false)
	if err != nil {
		return fmt.Errorf("failed to select folder: %w", err)
	}

	seqSet := new(imap.SeqSet)
	seqSet.AddNum(uid)

	var flagsOp imap.FlagsOp = imap.AddFlags
	if !add {
		flagsOp = imap.RemoveFlags
	}

	item := imap.FormatFlagsOp(flagsOp, false)
	return s.client.UidStore(seqSet, item, flags, nil)
}

// MoveMessage moves a message to another folder
func (s *Session) MoveMessage(fromFolder string, uid uint32, toFolder string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.client.Select(fromFolder, false)
	if err != nil {
		return fmt.Errorf("failed to select folder: %w", err)
	}

	seqSet := new(imap.SeqSet)
	seqSet.AddNum(uid)

	// Copy then delete
	if err := s.client.UidCopy(seqSet, toFolder); err != nil {
		return fmt.Errorf("failed to copy message: %w", err)
	}

	// Mark as deleted
	if err := s.client.UidStore(seqSet, imap.AddFlags, []interface{}{imap.DeletedFlag}, nil); err != nil {
		return fmt.Errorf("failed to mark deleted: %w", err)
	}

	// Expunge
	return s.client.Expunge(nil)
}

// DeleteMessage permanently deletes a message
func (s *Session) DeleteMessage(folder string, uid uint32) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	_, err := s.client.Select(folder, false)
	if err != nil {
		return fmt.Errorf("failed to select folder: %w", err)
	}

	seqSet := new(imap.SeqSet)
	seqSet.AddNum(uid)

	if err := s.client.UidStore(seqSet, imap.AddFlags, []interface{}{imap.DeletedFlag}, nil); err != nil {
		return fmt.Errorf("failed to mark deleted: %w", err)
	}

	return s.client.Expunge(nil)
}

// AppendMessage appends a message to a folder (used to save sent messages)
func (s *Session) AppendMessage(folder string, message []byte, flags []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.client.Append(folder, flags, time.Now(), &imapLiteral{data: message})
}

// SearchMessages searches for messages matching the query
func (s *Session) SearchMessages(folder string, query *SearchQuery) ([]MessageSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Select folder
	_, err := s.client.Select(folder, true)
	if err != nil {
		return nil, fmt.Errorf("failed to select folder: %w", err)
	}

	// Build IMAP search criteria
	criteria := imap.NewSearchCriteria()

	if query.Text != "" {
		// Search in subject, from, and body
		criteria.Or = [][2]*imap.SearchCriteria{
			{
				{Header: textproto.MIMEHeader{"Subject": {query.Text}}},
				{Body: []string{query.Text}},
			},
		}
	}

	if query.From != "" {
		criteria.Header.Set("From", query.From)
	}

	if query.To != "" {
		criteria.Header.Set("To", query.To)
	}

	if query.Subject != "" {
		criteria.Header.Set("Subject", query.Subject)
	}

	if query.Since != "" {
		if t, err := time.Parse("2006-01-02", query.Since); err == nil {
			criteria.Since = t
		}
	}

	if query.Before != "" {
		if t, err := time.Parse("2006-01-02", query.Before); err == nil {
			criteria.Before = t
		}
	}

	// Execute search
	uids, err := s.client.UidSearch(criteria)
	if err != nil {
		return nil, fmt.Errorf("search failed: %w", err)
	}

	if len(uids) == 0 {
		return []MessageSummary{}, nil
	}

	// Limit results
	if len(uids) > 100 {
		uids = uids[len(uids)-100:]
	}

	// Fetch matching messages
	seqSet := new(imap.SeqSet)
	for _, uid := range uids {
		seqSet.AddNum(uid)
	}

	items := []imap.FetchItem{imap.FetchEnvelope, imap.FetchFlags, imap.FetchUid, imap.FetchRFC822Size}

	messages := make(chan *imap.Message, len(uids))
	done := make(chan error, 1)

	go func() {
		done <- s.client.UidFetch(seqSet, items, messages)
	}()

	var summaries []MessageSummary
	for msg := range messages {
		summary := MessageSummary{
			UID:     msg.Uid,
			SeqNum:  msg.SeqNum,
			Size:    int64(msg.Size),
			Flags:   msg.Flags,
			Read:    hasFlag(msg.Flags, imap.SeenFlag),
			Starred: hasFlag(msg.Flags, imap.FlaggedFlag),
		}

		if msg.Envelope != nil {
			summary.Subject = msg.Envelope.Subject
			summary.Date = msg.Envelope.Date
			summary.MessageID = msg.Envelope.MessageId
			summary.InReplyTo = msg.Envelope.InReplyTo

			if len(msg.Envelope.From) > 0 {
				summary.From = addressToString(msg.Envelope.From[0])
				summary.FromName = msg.Envelope.From[0].PersonalName
			}

			for _, to := range msg.Envelope.To {
				summary.To = append(summary.To, addressToString(to))
			}
		}

		summaries = append(summaries, summary)
	}

	if err := <-done; err != nil {
		return nil, fmt.Errorf("failed to fetch search results: %w", err)
	}

	// Sort by date descending (newest first)
	for i, j := 0, len(summaries)-1; i < j; i, j = i+1, j-1 {
		summaries[i], summaries[j] = summaries[j], summaries[i]
	}

	return summaries, nil
}

// imapLiteral implements imap.Literal for appending messages
type imapLiteral struct {
	data []byte
	pos  int
}

func (l *imapLiteral) Read(p []byte) (n int, err error) {
	if l.pos >= len(l.data) {
		return 0, fmt.Errorf("EOF")
	}
	n = copy(p, l.data[l.pos:])
	l.pos += n
	return n, nil
}

func (l *imapLiteral) Len() int {
	return len(l.data)
}

// Helper functions

func hasFlag(flags []string, flag string) bool {
	for _, f := range flags {
		if f == flag {
			return true
		}
	}
	return false
}

func addressToString(addr *imap.Address) string {
	if addr == nil {
		return ""
	}
	return fmt.Sprintf("%s@%s", addr.MailboxName, addr.HostName)
}

// GroupIntoConversations groups messages into conversation threads
func GroupIntoConversations(messages []MessageSummary) []Conversation {
	if len(messages) == 0 {
		return []Conversation{}
	}

	// Build a map of message-id to message
	msgByID := make(map[string]*MessageSummary)
	for i := range messages {
		if messages[i].MessageID != "" {
			msgByID[messages[i].MessageID] = &messages[i]
		}
	}

	// Find the root of each conversation using Union-Find approach
	parent := make(map[string]string) // message-id -> root message-id

	var findRoot func(id string) string
	findRoot = func(id string) string {
		if p, ok := parent[id]; ok && p != id {
			root := findRoot(p)
			parent[id] = root // Path compression
			return root
		}
		if _, ok := parent[id]; !ok {
			parent[id] = id
		}
		return parent[id]
	}

	union := func(a, b string) {
		rootA := findRoot(a)
		rootB := findRoot(b)
		if rootA != rootB {
			// Prefer the older message as root (by checking if it exists)
			// If both exist, pick the one with earlier date
			msgA, existsA := msgByID[rootA]
			msgB, existsB := msgByID[rootB]
			if existsA && existsB {
				if msgA.Date.Before(msgB.Date) {
					parent[rootB] = rootA
				} else {
					parent[rootA] = rootB
				}
			} else if existsA {
				parent[rootB] = rootA
			} else {
				parent[rootA] = rootB
			}
		}
	}

	// Link messages by In-Reply-To header
	for i := range messages {
		msg := &messages[i]
		if msg.MessageID == "" {
			continue
		}

		// Initialize in parent map
		findRoot(msg.MessageID)

		// Link to the message this replies to
		if msg.InReplyTo != "" {
			union(msg.MessageID, msg.InReplyTo)
		}
	}

	// Group messages by their conversation root
	conversationMsgs := make(map[string][]MessageSummary)
	for i := range messages {
		msg := messages[i]
		var convID string
		if msg.MessageID != "" {
			convID = findRoot(msg.MessageID)
		} else {
			// For messages without Message-ID, use UID as standalone conv
			convID = fmt.Sprintf("standalone_%d", msg.UID)
		}
		msg.ConversationID = convID
		conversationMsgs[convID] = append(conversationMsgs[convID], msg)
	}

	// Build Conversation objects
	var conversations []Conversation
	for convID, msgs := range conversationMsgs {
		// Sort messages by date ascending (oldest first within conversation)
		sortMessagesByDate(msgs)

		// Collect unique participants
		participantSet := make(map[string]bool)
		unreadCount := 0
		starred := false
		var lastDate time.Time

		for _, msg := range msgs {
			participantSet[msg.From] = true
			if !msg.Read {
				unreadCount++
			}
			if msg.Starred {
				starred = true
			}
			if msg.Date.After(lastDate) {
				lastDate = msg.Date
			}
		}

		participants := make([]string, 0, len(participantSet))
		for p := range participantSet {
			participants = append(participants, p)
		}

		// Use the original subject (from first message, strip Re:/Fwd:)
		subject := msgs[0].Subject

		conv := Conversation{
			ID:           convID,
			Subject:      subject,
			Participants: participants,
			MessageCount: len(msgs),
			UnreadCount:  unreadCount,
			Starred:      starred,
			LastDate:     lastDate,
			Messages:     msgs,
		}

		conversations = append(conversations, conv)
	}

	// Sort conversations by last message date (newest first)
	sortConversationsByDate(conversations)

	return conversations
}

// sortMessagesByDate sorts messages by date ascending
func sortMessagesByDate(msgs []MessageSummary) {
	for i := 0; i < len(msgs)-1; i++ {
		for j := i + 1; j < len(msgs); j++ {
			if msgs[j].Date.Before(msgs[i].Date) {
				msgs[i], msgs[j] = msgs[j], msgs[i]
			}
		}
	}
}

// sortConversationsByDate sorts conversations by last date descending
func sortConversationsByDate(convs []Conversation) {
	for i := 0; i < len(convs)-1; i++ {
		for j := i + 1; j < len(convs); j++ {
			if convs[j].LastDate.After(convs[i].LastDate) {
				convs[i], convs[j] = convs[j], convs[i]
			}
		}
	}
}
