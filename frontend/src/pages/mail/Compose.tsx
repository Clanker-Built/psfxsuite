import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Send, Paperclip, X, Save, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { mailApi } from '@/lib/api';
import { useMailStore } from '@/stores/mail';
import { RichTextEditor } from '@/components/mail/RichTextEditor';
import { ContactAutocomplete } from '@/components/mail/ContactAutocomplete';

interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  file?: File;
}

interface ComposeState {
  mode?: 'reply' | 'replyAll' | 'forward';
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  inReplyTo?: string;
  draftUid?: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function MailCompose() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { isAuthenticated } = useMailStore();

  const composeState = location.state as ComposeState | undefined;

  const [searchParams] = useSearchParams();

  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');  // HTML body from TipTap
  const [plainBody, setPlainBody] = useState('');  // Plain text version
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [sending, setSending] = useState(false);
  const [inReplyTo, setInReplyTo] = useState<string | undefined>();

  // Draft state
  const [draftUid, setDraftUid] = useState<number | undefined>();
  const [draftStatus, setDraftStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasContentRef = useRef(false);

  // Initialize from state (reply/forward) or draft
  useEffect(() => {
    const draftParam = searchParams.get('draft');
    if (draftParam) {
      // Load existing draft
      const draftUidNum = parseInt(draftParam, 10);
      if (!isNaN(draftUidNum)) {
        loadDraft(draftUidNum);
      }
    } else if (composeState) {
      if (composeState.to) setTo(composeState.to);
      if (composeState.cc) {
        setCc(composeState.cc);
        setShowCc(true);
      }
      if (composeState.subject) setSubject(composeState.subject);
      if (composeState.body) setBody(composeState.body);
      if (composeState.inReplyTo) setInReplyTo(composeState.inReplyTo);
      if (composeState.draftUid) setDraftUid(composeState.draftUid);
    }
  }, [composeState, searchParams]);

  // Load draft from server
  const loadDraft = async (uid: number) => {
    try {
      const draft = await mailApi.getDraft(uid);
      setDraftUid(uid);
      setTo(draft.to.map(a => a.email || a.name).join(', '));
      if (draft.cc && draft.cc.length > 0) {
        setCc(draft.cc.map(a => a.email || a.name).join(', '));
        setShowCc(true);
      }
      setSubject(draft.subject);
      setBody(draft.htmlBody || draft.textBody || '');
      if (draft.inReplyTo) setInReplyTo(draft.inReplyTo);
      setDraftStatus('saved');
      setLastSaved(new Date());
    } catch (error) {
      toast({
        title: 'Failed to load draft',
        description: error instanceof Error ? error.message : 'Could not load the draft',
        variant: 'destructive',
      });
    }
  };

  // Save draft to server
  const saveDraft = useCallback(async () => {
    // Only save if there's content
    if (!to.trim() && !subject.trim() && !body.trim()) {
      return;
    }

    setDraftStatus('saving');
    try {
      const toAddrs = to.split(',').map((s) => s.trim()).filter(Boolean);
      const ccAddrs = cc ? cc.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      const bccAddrs = bcc ? bcc.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

      await mailApi.saveDraft({
        uid: draftUid,
        to: toAddrs,
        cc: ccAddrs,
        bcc: bccAddrs,
        subject,
        body: plainBody,
        htmlBody: body,
        inReplyTo,
      });

      setDraftStatus('saved');
      setLastSaved(new Date());
    } catch (error) {
      setDraftStatus('error');
      console.error('Failed to save draft:', error);
    }
  }, [to, cc, bcc, subject, body, plainBody, draftUid, inReplyTo]);

  // Auto-save with debounce (30 seconds)
  useEffect(() => {
    // Track if there's any content
    hasContentRef.current = !!(to.trim() || subject.trim() || body.trim());

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Don't auto-save if no content
    if (!hasContentRef.current) {
      return;
    }

    // Set new timeout for auto-save
    saveTimeoutRef.current = setTimeout(() => {
      saveDraft();
    }, 30000); // 30 seconds

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [to, cc, bcc, subject, body, saveDraft]);

  // Save draft on unmount/navigation
  useEffect(() => {
    return () => {
      if (hasContentRef.current && saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Note: saveDraft() here won't work reliably due to async nature
        // We rely on periodic saves or manual save
      }
    };
  }, []);

  // Redirect to mail login if not authenticated
  if (!isAuthenticated) {
    navigate('/');
    return null;
  }

  const getTitle = () => {
    switch (composeState?.mode) {
      case 'reply':
        return 'Reply';
      case 'replyAll':
        return 'Reply All';
      case 'forward':
        return 'Forward';
      default:
        return 'New Message';
    }
  };

  const handleSend = async () => {
    if (!to.trim()) {
      toast({
        title: 'Recipient required',
        description: 'Please enter at least one recipient',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      // Parse recipients (comma-separated)
      const toAddrs = to.split(',').map((s) => s.trim()).filter(Boolean);
      const ccAddrs = cc ? cc.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
      const bccAddrs = bcc ? bcc.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

      const result = await mailApi.send({
        to: toAddrs,
        cc: ccAddrs,
        bcc: bccAddrs,
        subject,
        body: plainBody,  // Plain text version for non-HTML clients
        htmlBody: body,   // HTML version from rich text editor
        inReplyTo,
      });

      // Delete draft if it exists
      if (draftUid) {
        try {
          await mailApi.deleteDraft(draftUid);
        } catch {
          // Ignore draft deletion errors
        }
      }

      toast({
        title: 'Message sent',
        description: result.messageId ? `Sent (${result.messageId})` : 'Your message has been sent successfully',
      });
      navigate('/inbox');
    } catch (error) {
      toast({
        title: 'Failed to send',
        description: error instanceof Error ? error.message : 'There was an error sending your message',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const newAttachments: Attachment[] = Array.from(files).map((file) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        size: file.size,
        type: file.type,
      }));
      setAttachments([...attachments, ...newAttachments]);
    }
    e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(attachments.filter((a) => a.id !== id));
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>{getTitle()}</CardTitle>
            {/* Draft status indicator */}
            {draftStatus === 'saving' && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Save className="h-3 w-3 animate-pulse" />
                Saving...
              </span>
            )}
            {draftStatus === 'saved' && lastSaved && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Check className="h-3 w-3 text-green-500" />
                Saved {lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {draftStatus === 'error' && (
              <span className="text-xs text-destructive">Save failed</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={saveDraft}
              disabled={draftStatus === 'saving' || sending}
              title="Save draft"
            >
              <Save className="h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => navigate('/inbox')}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sending}>
              <Send className="mr-2 h-4 w-4" />
              {sending ? 'Sending...' : 'Send'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Recipients */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="to" className="w-12 text-right">
                To
              </Label>
              <ContactAutocomplete
                id="to"
                placeholder="recipient@example.com"
                value={to}
                onChange={setTo}
                className="flex-1"
              />
              <div className="flex gap-1">
                {!showCc && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCc(true)}
                  >
                    Cc
                  </Button>
                )}
                {!showBcc && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowBcc(true)}
                  >
                    Bcc
                  </Button>
                )}
              </div>
            </div>

            {showCc && (
              <div className="flex items-center gap-2">
                <Label htmlFor="cc" className="w-12 text-right">
                  Cc
                </Label>
                <ContactAutocomplete
                  id="cc"
                  placeholder="cc@example.com"
                  value={cc}
                  onChange={setCc}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowCc(false);
                    setCc('');
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

            {showBcc && (
              <div className="flex items-center gap-2">
                <Label htmlFor="bcc" className="w-12 text-right">
                  Bcc
                </Label>
                <ContactAutocomplete
                  id="bcc"
                  placeholder="bcc@example.com"
                  value={bcc}
                  onChange={setBcc}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setShowBcc(false);
                    setBcc('');
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Subject */}
          <div className="flex items-center gap-2">
            <Label htmlFor="subject" className="w-12 text-right">
              Subject
            </Label>
            <Input
              id="subject"
              placeholder="Email subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="flex-1"
            />
          </div>

          {/* Attachment button */}
          <div className="flex items-center justify-end border-t py-2">
            <label>
              <Button variant="ghost" size="sm" asChild>
                <span>
                  <Paperclip className="mr-2 h-4 w-4" />
                  Attach file
                </span>
              </Button>
              <input
                type="file"
                multiple
                className="hidden"
                onChange={handleFileSelect}
              />
            </label>
          </div>

          {/* Body - Rich Text Editor */}
          <TooltipProvider>
            <RichTextEditor
              content={body}
              onChange={(html, text) => {
                setBody(html);
                setPlainBody(text);
              }}
              placeholder="Write your message..."
              className="min-h-[300px]"
            />
          </TooltipProvider>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="space-y-2">
              <Label>Attachments</Label>
              <div className="flex flex-wrap gap-2">
                {attachments.map((attachment) => (
                  <Badge
                    key={attachment.id}
                    variant="secondary"
                    className="flex items-center gap-1 pr-1"
                  >
                    <Paperclip className="h-3 w-3" />
                    {attachment.name}
                    <span className="text-muted-foreground">
                      ({formatFileSize(attachment.size)})
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-4 w-4 ml-1"
                      onClick={() => removeAttachment(attachment.id)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
