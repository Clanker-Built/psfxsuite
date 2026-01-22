package mail

import "time"

// Folder represents an IMAP mailbox folder
type Folder struct {
	Name       string   `json:"name"`
	Delimiter  string   `json:"delimiter"`
	Attributes []string `json:"attributes,omitempty"`
	SpecialUse string   `json:"specialUse,omitempty"`
	Total      int      `json:"total"`
	Unseen     int      `json:"unseen"`
}

// FolderStatus contains status information about a folder
type FolderStatus struct {
	Name     string `json:"name"`
	Total    int    `json:"total"`
	Recent   int    `json:"recent"`
	Unseen   int    `json:"unseen"`
	UIDNext  uint32 `json:"uidNext"`
	UIDValid uint32 `json:"uidValid"`
}

// MessageSummary represents a brief view of a message for listing
type MessageSummary struct {
	UID            uint32    `json:"uid"`
	SeqNum         uint32    `json:"seqNum"`
	Subject        string    `json:"subject"`
	From           string    `json:"from"`
	FromName       string    `json:"fromName"`
	To             []string  `json:"to"`
	Date           time.Time `json:"date"`
	Size           int64     `json:"size"`
	Read           bool      `json:"read"`
	Starred        bool      `json:"starred"`
	Flags          []string  `json:"flags"`
	MessageID      string    `json:"messageId"`
	InReplyTo      string    `json:"inReplyTo,omitempty"`
	References     string    `json:"references,omitempty"`
	ConversationID string    `json:"conversationId,omitempty"`
}

// Conversation represents a group of related messages (email thread)
type Conversation struct {
	ID           string           `json:"id"`
	Subject      string           `json:"subject"`
	Participants []string         `json:"participants"`
	MessageCount int              `json:"messageCount"`
	UnreadCount  int              `json:"unreadCount"`
	Starred      bool             `json:"starred"`
	LastDate     time.Time        `json:"lastDate"`
	Messages     []MessageSummary `json:"messages"`
	Snippet      string           `json:"snippet,omitempty"`
}

// Address represents an email address with optional name
type Address struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// Message represents a full email message
type Message struct {
	UID         uint32      `json:"uid"`
	MessageID   string      `json:"messageId"`
	InReplyTo   string      `json:"inReplyTo,omitempty"`
	Subject     string      `json:"subject"`
	From        Address     `json:"from"`
	To          []Address   `json:"to"`
	Cc          []Address   `json:"cc,omitempty"`
	Bcc         []Address   `json:"bcc,omitempty"`
	ReplyTo     []Address   `json:"replyTo,omitempty"`
	Date        time.Time   `json:"date"`
	Read        bool        `json:"read"`
	Starred     bool        `json:"starred"`
	Flags       []string    `json:"flags"`
	TextBody    string      `json:"textBody,omitempty"`
	HTMLBody    string      `json:"htmlBody,omitempty"`
	RawBody     string      `json:"-"`
	Attachments []Attachment `json:"attachments,omitempty"`
}

// Attachment represents an email attachment
type Attachment struct {
	ID          string `json:"id"`
	Filename    string `json:"filename"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
	ContentID   string `json:"contentId,omitempty"`
	Inline      bool   `json:"inline"`
}

// ComposeMessage represents a message being composed/sent
type ComposeMessage struct {
	To          []string `json:"to"`
	Cc          []string `json:"cc,omitempty"`
	Bcc         []string `json:"bcc,omitempty"`
	Subject     string   `json:"subject"`
	Body        string   `json:"body"`
	HTMLBody    string   `json:"htmlBody,omitempty"`
	InReplyTo   string   `json:"inReplyTo,omitempty"`
	References  string   `json:"references,omitempty"`
	Attachments []string `json:"attachments,omitempty"` // Attachment IDs
}

// SearchQuery represents email search parameters
type SearchQuery struct {
	Folder   string `json:"folder"`
	Text     string `json:"text,omitempty"`
	From     string `json:"from,omitempty"`
	To       string `json:"to,omitempty"`
	Subject  string `json:"subject,omitempty"`
	Since    string `json:"since,omitempty"`
	Before   string `json:"before,omitempty"`
	HasFlags []string `json:"hasFlags,omitempty"`
}

// FormatRFC822Date returns the current time in RFC822 format for email headers
func FormatRFC822Date() string {
	return time.Now().Format(time.RFC1123Z)
}
