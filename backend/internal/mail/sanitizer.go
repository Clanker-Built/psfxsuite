package mail

import (
	"bytes"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

// EmailSanitizer handles HTML sanitization for email content
type EmailSanitizer struct {
	policy *bluemonday.Policy
}

// NewEmailSanitizer creates a sanitizer with safe policies for email
func NewEmailSanitizer() *EmailSanitizer {
	p := bluemonday.NewPolicy()

	// Allow common text formatting
	p.AllowElements("p", "br", "hr", "span", "div")
	p.AllowElements("b", "strong", "i", "em", "u", "s", "strike", "sub", "sup")
	p.AllowElements("h1", "h2", "h3", "h4", "h5", "h6")

	// Allow lists
	p.AllowElements("ul", "ol", "li", "dl", "dt", "dd")

	// Allow tables (common in emails)
	p.AllowElements("table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col")
	p.AllowAttrs("colspan", "rowspan", "align", "valign", "width", "height").OnElements("td", "th")
	p.AllowAttrs("width", "border", "cellpadding", "cellspacing", "align").OnElements("table")

	// Allow links (but transform to safe)
	p.AllowElements("a")
	p.AllowAttrs("href", "title").OnElements("a")
	p.RequireNoReferrerOnLinks(true)
	p.AddTargetBlankToFullyQualifiedLinks(true)

	// Allow images but only data: and cid: URIs (no external images by default)
	p.AllowElements("img")
	p.AllowAttrs("src", "alt", "title", "width", "height").OnElements("img")
	p.AllowURLSchemes("data", "cid")

	// Allow basic styling via style attribute (limited)
	p.AllowAttrs("style").Globally()
	p.AllowStyles(
		"color", "background-color", "background",
		"font-family", "font-size", "font-weight", "font-style",
		"text-align", "text-decoration",
		"margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
		"padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
		"border", "border-width", "border-style", "border-color",
		"width", "height", "max-width", "max-height",
		"display", "vertical-align",
	).Globally()

	// Allow class attribute for styling
	p.AllowAttrs("class", "id").Globally()

	// Allow blockquote (common in replies)
	p.AllowElements("blockquote", "pre", "code")

	return &EmailSanitizer{policy: p}
}

// SanitizeHTML sanitizes HTML content for safe display
func (s *EmailSanitizer) SanitizeHTML(html string) string {
	return s.policy.Sanitize(html)
}

// ParseEmail parses a raw email message and extracts parts
func ParseEmail(rawMessage string) (*Message, error) {
	msg, err := mail.ReadMessage(strings.NewReader(rawMessage))
	if err != nil {
		return nil, err
	}

	message := &Message{}

	// Parse headers
	message.Subject = decodeHeader(msg.Header.Get("Subject"))
	message.MessageID = msg.Header.Get("Message-ID")
	message.InReplyTo = msg.Header.Get("In-Reply-To")

	// Parse date
	if dateStr := msg.Header.Get("Date"); dateStr != "" {
		if t, err := mail.ParseDate(dateStr); err == nil {
			message.Date = t
		}
	}

	// Parse addresses
	if from, err := msg.Header.AddressList("From"); err == nil && len(from) > 0 {
		message.From = Address{
			Name:  from[0].Name,
			Email: from[0].Address,
		}
	}

	if to, err := msg.Header.AddressList("To"); err == nil {
		for _, addr := range to {
			message.To = append(message.To, Address{
				Name:  addr.Name,
				Email: addr.Address,
			})
		}
	}

	if cc, err := msg.Header.AddressList("Cc"); err == nil {
		for _, addr := range cc {
			message.Cc = append(message.Cc, Address{
				Name:  addr.Name,
				Email: addr.Address,
			})
		}
	}

	// Parse body
	contentType := msg.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "text/plain"
	}

	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil {
		// Fallback to plain text
		body, _ := io.ReadAll(msg.Body)
		message.TextBody = string(body)
		return message, nil
	}

	if strings.HasPrefix(mediaType, "multipart/") {
		// Handle multipart message
		parseMultipart(msg.Body, params["boundary"], message)
	} else {
		// Single part message
		body, _ := io.ReadAll(msg.Body)
		decoded := decodeBody(body, msg.Header.Get("Content-Transfer-Encoding"))

		if strings.HasPrefix(mediaType, "text/html") {
			message.HTMLBody = string(decoded)
		} else {
			message.TextBody = string(decoded)
		}
	}

	return message, nil
}

func parseMultipart(body io.Reader, boundary string, message *Message) {
	reader := multipart.NewReader(body, boundary)

	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			break
		}

		contentType := part.Header.Get("Content-Type")
		mediaType, params, _ := mime.ParseMediaType(contentType)

		if strings.HasPrefix(mediaType, "multipart/") {
			// Nested multipart
			parseMultipart(part, params["boundary"], message)
			continue
		}

		// Read part content
		content, err := io.ReadAll(part)
		if err != nil {
			continue
		}

		decoded := decodeBody(content, part.Header.Get("Content-Transfer-Encoding"))

		// Check if attachment
		disposition := part.Header.Get("Content-Disposition")
		if strings.HasPrefix(disposition, "attachment") || part.FileName() != "" {
			filename := part.FileName()
			if filename == "" {
				filename = "attachment"
			}

			attachment := Attachment{
				ID:          generateAttachmentID(),
				Filename:    filename,
				ContentType: mediaType,
				Size:        int64(len(decoded)),
				ContentID:   strings.Trim(part.Header.Get("Content-ID"), "<>"),
				Inline:      strings.HasPrefix(disposition, "inline"),
			}
			message.Attachments = append(message.Attachments, attachment)
			continue
		}

		// Text or HTML part
		if strings.HasPrefix(mediaType, "text/html") {
			message.HTMLBody = string(decoded)
		} else if strings.HasPrefix(mediaType, "text/plain") {
			message.TextBody = string(decoded)
		}
	}
}

func decodeBody(content []byte, encoding string) []byte {
	switch strings.ToLower(encoding) {
	case "quoted-printable":
		decoded, err := io.ReadAll(quotedprintable.NewReader(bytes.NewReader(content)))
		if err != nil {
			return content
		}
		return decoded
	case "base64":
		// Standard library handles this, but we need to strip whitespace
		cleaned := regexp.MustCompile(`\s`).ReplaceAll(content, nil)
		decoded := make([]byte, len(cleaned))
		n, err := base64Decode(decoded, cleaned)
		if err != nil {
			return content
		}
		return decoded[:n]
	default:
		return content
	}
}

// Simple base64 decoder that handles line breaks
func base64Decode(dst, src []byte) (int, error) {
	const encodeStd = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	var decodeMap [256]byte
	for i := 0; i < len(decodeMap); i++ {
		decodeMap[i] = 0xFF
	}
	for i := 0; i < len(encodeStd); i++ {
		decodeMap[encodeStd[i]] = byte(i)
	}

	n := 0
	end := false
	for i := 0; i < len(src) && !end; i += 4 {
		var dbuf [4]byte
		dlen := 4

		for j := 0; j < 4; j++ {
			if i+j >= len(src) {
				dlen = j
				break
			}
			in := src[i+j]
			if in == '=' {
				if j == 2 && i+3 < len(src) && src[i+3] != '=' {
					return n, nil
				}
				if j < 2 {
					return n, nil
				}
				dlen = j
				end = true
				break
			}
			dbuf[j] = decodeMap[in]
			if dbuf[j] == 0xFF {
				return n, nil
			}
		}

		switch dlen {
		case 4:
			dst[n+2] = dbuf[2]<<6 | dbuf[3]
			fallthrough
		case 3:
			dst[n+1] = dbuf[1]<<4 | dbuf[2]>>2
			fallthrough
		case 2:
			dst[n] = dbuf[0]<<2 | dbuf[1]>>4
		}
		n += dlen - 1
	}
	return n, nil
}

func decodeHeader(s string) string {
	dec := new(mime.WordDecoder)
	decoded, err := dec.DecodeHeader(s)
	if err != nil {
		return s
	}
	return decoded
}

func generateAttachmentID() string {
	return randomString(12)
}
