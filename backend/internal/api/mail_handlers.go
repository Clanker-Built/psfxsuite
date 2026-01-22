package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/emersion/go-imap"
	"github.com/go-chi/chi/v5"
	"github.com/postfixrelay/postfixrelay/internal/mail"
	"github.com/rs/zerolog/log"
)

// Mail session manager (initialized in main or server setup)
var mailSessionManager *mail.SessionManager
var emailSanitizer *mail.EmailSanitizer
var smtpSender *mail.SMTPSender

// InitMailServices initializes mail-related services
func InitMailServices() {
	mailSessionManager = mail.NewSessionManager()
	emailSanitizer = mail.NewEmailSanitizer()
	smtpSender = mail.NewSMTPSender(nil) // Uses default config from environment
}

// Cookie name for mail session
const mailSessionCookie = "psfx_mail_session"

// authenticateMail handles mailbox authentication
func (s *Server) authenticateMail(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Email == "" || req.Password == "" {
		http.Error(w, "Email and password are required", http.StatusBadRequest)
		return
	}

	// Authenticate with IMAP
	session, err := mailSessionManager.Authenticate(req.Email, req.Password)
	if err != nil {
		log.Warn().Err(err).Str("email", req.Email).Msg("Mail authentication failed")
		http.Error(w, "Authentication failed", http.StatusUnauthorized)
		return
	}

	// Set session cookie
	http.SetCookie(w, &http.Cookie{
		Name:     mailSessionCookie,
		Value:    session.ID,
		Path:     "/api/v1/mail",
		HttpOnly: true,
		Secure:   r.TLS != nil,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   3600, // 1 hour
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"email":   session.Email,
	})
}

// logoutMail handles mail session logout
func (s *Server) logoutMail(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(mailSessionCookie)
	if err == nil && cookie.Value != "" {
		mailSessionManager.CloseSession(cookie.Value)
	}

	// Clear cookie
	http.SetCookie(w, &http.Cookie{
		Name:     mailSessionCookie,
		Value:    "",
		Path:     "/api/v1/mail",
		HttpOnly: true,
		MaxAge:   -1,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Logged out"})
}

// mailSessionMiddleware validates mail session
func (s *Server) mailSessionMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie(mailSessionCookie)
		if err != nil || cookie.Value == "" {
			http.Error(w, "Mail session required", http.StatusUnauthorized)
			return
		}

		session, ok := mailSessionManager.GetSession(cookie.Value)
		if !ok {
			http.Error(w, "Invalid or expired mail session", http.StatusUnauthorized)
			return
		}

		// Add session to context
		ctx := r.Context()
		ctx = setMailSession(ctx, session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// getMailFolders lists all folders
func (s *Server) getMailFolders(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	folders, err := session.ListFolders()
	if err != nil {
		log.Error().Err(err).Msg("Failed to list folders")
		http.Error(w, "Failed to list folders", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(folders)
}

// getMailMessages lists messages in a folder
func (s *Server) getMailMessages(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	folder := chi.URLParam(r, "folder")
	if folder == "" {
		folder = "INBOX"
	}

	// Parse pagination
	offset := 0
	limit := 50
	if o := r.URL.Query().Get("offset"); o != "" {
		offset, _ = strconv.Atoi(o)
	}
	if l := r.URL.Query().Get("limit"); l != "" {
		limit, _ = strconv.Atoi(l)
		if limit > 100 {
			limit = 100
		}
	}

	// Check if threading is requested
	threaded := r.URL.Query().Get("threaded") == "true"

	messages, err := session.FetchMessages(folder, offset, limit)
	if err != nil {
		log.Error().Err(err).Str("folder", folder).Msg("Failed to fetch messages")
		http.Error(w, "Failed to fetch messages", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	if threaded {
		// Group messages into conversations
		conversations := mail.GroupIntoConversations(messages)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"conversations": conversations,
			"offset":        offset,
			"limit":         limit,
			"threaded":      true,
		})
	} else {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"messages": messages,
			"offset":   offset,
			"limit":    limit,
		})
	}
}

// getMessage fetches a single message
func (s *Server) getMessage(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	folder := r.URL.Query().Get("folder")
	if folder == "" {
		folder = "INBOX"
	}

	uidStr := chi.URLParam(r, "uid")
	uid, err := strconv.ParseUint(uidStr, 10, 32)
	if err != nil {
		http.Error(w, "Invalid message UID", http.StatusBadRequest)
		return
	}

	msg, err := session.FetchMessage(folder, uint32(uid))
	if err != nil {
		log.Error().Err(err).Uint64("uid", uid).Msg("Failed to fetch message")
		http.Error(w, "Failed to fetch message", http.StatusInternalServerError)
		return
	}

	// Parse the raw body to extract text/html parts
	if msg.RawBody != "" {
		parsed, err := mail.ParseEmail(msg.RawBody)
		if err == nil {
			msg.TextBody = parsed.TextBody
			msg.HTMLBody = parsed.HTMLBody
			msg.Attachments = parsed.Attachments
		}
	}

	// Sanitize HTML if present
	if msg.HTMLBody != "" {
		msg.HTMLBody = emailSanitizer.SanitizeHTML(msg.HTMLBody)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(msg)
}

// updateMessageFlags updates message flags (read, starred, etc.)
func (s *Server) updateMessageFlags(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	uidStr := chi.URLParam(r, "uid")
	uid, err := strconv.ParseUint(uidStr, 10, 32)
	if err != nil {
		http.Error(w, "Invalid message UID", http.StatusBadRequest)
		return
	}

	var req struct {
		Folder  string `json:"folder"`
		Read    *bool  `json:"read"`
		Starred *bool  `json:"starred"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Folder == "" {
		req.Folder = "INBOX"
	}

	// Update read flag
	if req.Read != nil {
		err := session.SetFlags(req.Folder, uint32(uid), []string{imap.SeenFlag}, *req.Read)
		if err != nil {
			log.Error().Err(err).Msg("Failed to update read flag")
			http.Error(w, "Failed to update flags", http.StatusInternalServerError)
			return
		}
	}

	// Update starred flag
	if req.Starred != nil {
		err := session.SetFlags(req.Folder, uint32(uid), []string{imap.FlaggedFlag}, *req.Starred)
		if err != nil {
			log.Error().Err(err).Msg("Failed to update starred flag")
			http.Error(w, "Failed to update flags", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Flags updated"})
}

// moveMessage moves a message to another folder
func (s *Server) moveMessage(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	var req struct {
		UIDs       []uint32 `json:"uids"`
		FromFolder string   `json:"fromFolder"`
		ToFolder   string   `json:"toFolder"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.FromFolder == "" {
		req.FromFolder = "INBOX"
	}

	for _, uid := range req.UIDs {
		if err := session.MoveMessage(req.FromFolder, uid, req.ToFolder); err != nil {
			log.Error().Err(err).Uint32("uid", uid).Msg("Failed to move message")
			// Continue with other messages
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Messages moved"})
}

// deleteMailMessage deletes a message
func (s *Server) deleteMailMessage(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	folder := r.URL.Query().Get("folder")
	if folder == "" {
		folder = "INBOX"
	}

	uidStr := chi.URLParam(r, "uid")
	uid, err := strconv.ParseUint(uidStr, 10, 32)
	if err != nil {
		http.Error(w, "Invalid message UID", http.StatusBadRequest)
		return
	}

	// Move to trash instead of permanent delete
	trashFolder := "Trash"
	if folder != trashFolder {
		if err := session.MoveMessage(folder, uint32(uid), trashFolder); err != nil {
			log.Error().Err(err).Msg("Failed to move to trash")
			http.Error(w, "Failed to delete message", http.StatusInternalServerError)
			return
		}
	} else {
		// If already in trash, permanently delete
		if err := session.DeleteMessage(folder, uint32(uid)); err != nil {
			log.Error().Err(err).Msg("Failed to delete message")
			http.Error(w, "Failed to delete message", http.StatusInternalServerError)
			return
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Message deleted"})
}

// sendMessage sends a new email
func (s *Server) sendMessage(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	var req mail.ComposeMessage
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if len(req.To) == 0 {
		http.Error(w, "At least one recipient is required", http.StatusBadRequest)
		return
	}

	if req.Subject == "" {
		req.Subject = "(No Subject)"
	}

	// Send via SMTP
	result, err := smtpSender.Send(session.Email, session.Password, &req)
	if err != nil {
		log.Error().Err(err).Str("from", session.Email).Msg("Failed to send email")
		http.Error(w, "Failed to send email: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Try to save to Sent folder (non-blocking, errors are logged but don't fail the send)
	go func() {
		mimeMsg, err := buildMIMEForSent(session.Email, &req, result.MessageID)
		if err != nil {
			log.Warn().Err(err).Msg("Failed to build message for Sent folder")
			return
		}
		if err := session.AppendMessage("Sent", mimeMsg, []string{"\\Seen"}); err != nil {
			log.Warn().Err(err).Msg("Failed to save message to Sent folder")
		} else {
			log.Debug().Str("messageId", result.MessageID).Msg("Saved to Sent folder")
		}
	}()

	log.Info().
		Str("from", session.Email).
		Strs("to", req.To).
		Str("subject", req.Subject).
		Str("messageId", result.MessageID).
		Msg("Email sent successfully")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":   true,
		"messageId": result.MessageID,
	})
}

// searchMessages searches for emails
func (s *Server) searchMessages(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	// Parse query parameters
	query := &mail.SearchQuery{
		Folder:  r.URL.Query().Get("folder"),
		Text:    r.URL.Query().Get("q"),
		From:    r.URL.Query().Get("from"),
		To:      r.URL.Query().Get("to"),
		Subject: r.URL.Query().Get("subject"),
		Since:   r.URL.Query().Get("since"),
		Before:  r.URL.Query().Get("before"),
	}

	if query.Folder == "" {
		query.Folder = "INBOX"
	}

	messages, err := session.SearchMessages(query.Folder, query)
	if err != nil {
		log.Error().Err(err).Msg("Search failed")
		http.Error(w, "Search failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"messages": messages,
		"query":    query,
	})
}

// buildMIMEForSent creates a MIME message for saving to Sent folder
func buildMIMEForSent(from string, msg *mail.ComposeMessage, msgID string) ([]byte, error) {
	var buf []byte
	buf = append(buf, []byte("From: "+from+"\r\n")...)
	buf = append(buf, []byte("To: "+joinAddresses(msg.To)+"\r\n")...)
	if len(msg.Cc) > 0 {
		buf = append(buf, []byte("Cc: "+joinAddresses(msg.Cc)+"\r\n")...)
	}
	buf = append(buf, []byte("Subject: "+msg.Subject+"\r\n")...)
	buf = append(buf, []byte("Message-ID: "+msgID+"\r\n")...)
	buf = append(buf, []byte("Date: "+formatRFC822Date()+"\r\n")...)
	buf = append(buf, []byte("MIME-Version: 1.0\r\n")...)

	if msg.InReplyTo != "" {
		buf = append(buf, []byte("In-Reply-To: "+msg.InReplyTo+"\r\n")...)
	}
	if msg.References != "" {
		buf = append(buf, []byte("References: "+msg.References+"\r\n")...)
	}

	// Content
	if msg.HTMLBody != "" {
		buf = append(buf, []byte("Content-Type: text/html; charset=utf-8\r\n")...)
		buf = append(buf, []byte("\r\n")...)
		buf = append(buf, []byte(msg.HTMLBody)...)
	} else {
		buf = append(buf, []byte("Content-Type: text/plain; charset=utf-8\r\n")...)
		buf = append(buf, []byte("\r\n")...)
		buf = append(buf, []byte(msg.Body)...)
	}

	return buf, nil
}

func joinAddresses(addrs []string) string {
	result := ""
	for i, addr := range addrs {
		if i > 0 {
			result += ", "
		}
		result += addr
	}
	return result
}

func formatRFC822Date() string {
	return mail.FormatRFC822Date()
}

// Draft handlers

// DraftRequest represents a draft save request
type DraftRequest struct {
	UID       uint32   `json:"uid,omitempty"` // Existing draft UID (for updates)
	To        []string `json:"to"`
	Cc        []string `json:"cc,omitempty"`
	Bcc       []string `json:"bcc,omitempty"`
	Subject   string   `json:"subject"`
	Body      string   `json:"body"`
	HTMLBody  string   `json:"htmlBody,omitempty"`
	InReplyTo string   `json:"inReplyTo,omitempty"`
}

// saveDraft saves or updates a draft
func (s *Server) saveDraft(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	var req DraftRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Build the draft message
	draftMsg := buildDraftMessage(session.Email, &req)

	// If updating an existing draft, delete the old one first
	if req.UID > 0 {
		if err := session.DeleteMessage("Drafts", req.UID); err != nil {
			log.Warn().Err(err).Uint32("uid", req.UID).Msg("Failed to delete old draft")
			// Continue anyway - we'll save the new draft
		}
	}

	// Save the draft to Drafts folder
	if err := session.AppendMessage("Drafts", draftMsg, []string{"\\Draft"}); err != nil {
		log.Error().Err(err).Msg("Failed to save draft")
		http.Error(w, "Failed to save draft", http.StatusInternalServerError)
		return
	}

	// Get the UID of the newly saved draft
	// Note: We can't easily get the UID of the appended message without searching
	// For now, return success without the UID
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Draft saved",
	})
}

// getDraft retrieves a specific draft
func (s *Server) getDraft(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	uidStr := chi.URLParam(r, "uid")
	uid, err := strconv.ParseUint(uidStr, 10, 32)
	if err != nil {
		http.Error(w, "Invalid draft UID", http.StatusBadRequest)
		return
	}

	// Get the message from Drafts folder
	msg, err := session.FetchMessage("Drafts", uint32(uid))
	if err != nil {
		log.Error().Err(err).Uint64("uid", uid).Msg("Failed to get draft")
		http.Error(w, "Draft not found", http.StatusNotFound)
		return
	}

	// Sanitize the body content for safe display
	if msg.HTMLBody != "" {
		msg.HTMLBody = emailSanitizer.SanitizeHTML(msg.HTMLBody)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(msg)
}

// deleteDraft deletes a draft
func (s *Server) deleteDraft(w http.ResponseWriter, r *http.Request) {
	session := getMailSession(r.Context())
	if session == nil {
		http.Error(w, "Session not found", http.StatusUnauthorized)
		return
	}

	uidStr := chi.URLParam(r, "uid")
	uid, err := strconv.ParseUint(uidStr, 10, 32)
	if err != nil {
		http.Error(w, "Invalid draft UID", http.StatusBadRequest)
		return
	}

	if err := session.DeleteMessage("Drafts", uint32(uid)); err != nil {
		log.Error().Err(err).Uint64("uid", uid).Msg("Failed to delete draft")
		http.Error(w, "Failed to delete draft", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"message": "Draft deleted"})
}

// buildDraftMessage creates a MIME message for saving as draft
func buildDraftMessage(from string, req *DraftRequest) []byte {
	var buf []byte

	// Generate a temporary message ID for the draft
	msgID := "<draft-" + mail.GenerateSessionID()[:16] + "@psfxmail>"

	buf = append(buf, []byte("From: "+from+"\r\n")...)
	if len(req.To) > 0 {
		buf = append(buf, []byte("To: "+joinAddresses(req.To)+"\r\n")...)
	}
	if len(req.Cc) > 0 {
		buf = append(buf, []byte("Cc: "+joinAddresses(req.Cc)+"\r\n")...)
	}
	buf = append(buf, []byte("Subject: "+req.Subject+"\r\n")...)
	buf = append(buf, []byte("Message-ID: "+msgID+"\r\n")...)
	buf = append(buf, []byte("Date: "+formatRFC822Date()+"\r\n")...)
	buf = append(buf, []byte("MIME-Version: 1.0\r\n")...)
	buf = append(buf, []byte("X-Draft: true\r\n")...) // Mark as draft

	if req.InReplyTo != "" {
		buf = append(buf, []byte("In-Reply-To: "+req.InReplyTo+"\r\n")...)
	}

	// Content
	if req.HTMLBody != "" {
		buf = append(buf, []byte("Content-Type: text/html; charset=utf-8\r\n")...)
		buf = append(buf, []byte("\r\n")...)
		buf = append(buf, []byte(req.HTMLBody)...)
	} else {
		buf = append(buf, []byte("Content-Type: text/plain; charset=utf-8\r\n")...)
		buf = append(buf, []byte("\r\n")...)
		buf = append(buf, []byte(req.Body)...)
	}

	return buf
}

// Context helpers for mail session
type mailSessionKey struct{}

func setMailSession(ctx context.Context, session *mail.Session) context.Context {
	return context.WithValue(ctx, mailSessionKey{}, session)
}

func getMailSession(ctx context.Context) *mail.Session {
	if v := ctx.Value(mailSessionKey{}); v != nil {
		return v.(*mail.Session)
	}
	return nil
}
