import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Reply,
  ReplyAll,
  Forward,
  Star,
  StarOff,
  Trash2,
  Archive,
  MoreHorizontal,
  Paperclip,
  Download,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useMailStore } from '@/stores/mail';
import { useToast } from '@/hooks/use-toast';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function MessageView() {
  const { uid } = useParams<{ uid: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    currentMessage,
    currentFolder,
    isLoading,
    loadMessage,
    markStarred,
    deleteMessage,
    moveMessage,
  } = useMailStore();
  const [showImages, setShowImages] = useState(false);

  useEffect(() => {
    if (uid) {
      loadMessage(parseInt(uid, 10));
    }
  }, [uid, loadMessage]);

  const handleBack = () => {
    navigate('/mail');
  };

  // Helper to format address for display
  const formatAddress = (addr: { name: string; email: string } | undefined): string => {
    if (!addr) return '';
    return addr.name ? `${addr.name} <${addr.email}>` : addr.email;
  };

  const formatAddressList = (addrs: { name: string; email: string }[] | undefined): string => {
    if (!addrs || addrs.length === 0) return '';
    return addrs.map(formatAddress).join(', ');
  };

  const handleReply = () => {
    if (currentMessage) {
      navigate('/mail/compose', {
        state: {
          mode: 'reply',
          to: formatAddress(currentMessage.from),
          subject: `Re: ${currentMessage.subject}`,
          inReplyTo: currentMessage.messageId,
        },
      });
    }
  };

  const handleReplyAll = () => {
    if (currentMessage) {
      const allRecipients = [
        ...(currentMessage.to || []),
        ...(currentMessage.cc || []),
      ].filter((addr) => addr.email !== currentMessage.from?.email);

      navigate('/mail/compose', {
        state: {
          mode: 'replyAll',
          to: formatAddress(currentMessage.from),
          cc: formatAddressList(allRecipients),
          subject: `Re: ${currentMessage.subject}`,
          inReplyTo: currentMessage.messageId,
        },
      });
    }
  };

  const handleForward = () => {
    if (currentMessage) {
      navigate('/mail/compose', {
        state: {
          mode: 'forward',
          subject: `Fwd: ${currentMessage.subject}`,
          body: `\n\n---------- Forwarded message ----------\nFrom: ${formatAddress(currentMessage.from)}\nDate: ${formatDate(currentMessage.date)}\nSubject: ${currentMessage.subject}\n\n${currentMessage.textBody || ''}`,
        },
      });
    }
  };

  const handleStar = () => {
    if (currentMessage) {
      markStarred(currentMessage.uid, !currentMessage.starred);
    }
  };

  const handleArchive = async () => {
    if (currentMessage) {
      await moveMessage(currentMessage.uid, 'Archive');
      toast({
        title: 'Message archived',
        description: 'The message has been moved to Archive',
      });
      navigate('/mail');
    }
  };

  const handleDelete = async () => {
    if (currentMessage) {
      await deleteMessage(currentMessage.uid);
      toast({
        title: 'Message deleted',
        description: 'The message has been moved to Trash',
      });
      navigate('/mail');
    }
  };

  const handleDownloadAttachment = (attachmentId: string, filename: string) => {
    if (currentMessage) {
      const url = `/api/v1/mail/messages/${currentMessage.uid}/attachments/${attachmentId}?folder=${encodeURIComponent(currentFolder)}`;
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
    }
  };

  if (isLoading && !currentMessage) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!currentMessage) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <h2 className="text-xl font-semibold mb-2">Message not found</h2>
        <p className="text-muted-foreground mb-4">
          The message you're looking for doesn't exist or has been deleted.
        </p>
        <Button onClick={handleBack}>Back to Inbox</Button>
      </div>
    );
  }

  // Check if HTML body contains external images
  const hasExternalImages = currentMessage.htmlBody?.includes('<img') &&
    (currentMessage.htmlBody?.includes('http://') || currentMessage.htmlBody?.includes('https://'));

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleBack}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Back to inbox</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Separator orientation="vertical" className="h-6" />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleReply}>
                  <Reply className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reply</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleReplyAll}>
                  <ReplyAll className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Reply all</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleForward}>
                  <Forward className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Forward</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Separator orientation="vertical" className="h-6" />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleArchive}>
                  <Archive className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Archive</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleDelete}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleStar}
            className={cn(currentMessage.starred && 'text-yellow-500')}
          >
            {currentMessage.starred ? (
              <Star className="h-4 w-4 fill-yellow-500" />
            ) : (
              <StarOff className="h-4 w-4" />
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => moveMessage(currentMessage.uid, 'INBOX')}>
                Move to Inbox
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => moveMessage(currentMessage.uid, 'Archive')}>
                Move to Archive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>Mark as unread</DropdownMenuItem>
              <DropdownMenuItem>View source</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Message content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Subject */}
          <h1 className="text-2xl font-semibold mb-4">
            {currentMessage.subject || '(no subject)'}
          </h1>

          {/* Sender info */}
          <div className="flex items-start justify-between mb-6">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                {(currentMessage.from?.name || currentMessage.from?.email || '?')[0].toUpperCase()}
              </div>
              <div>
                <div className="font-medium">
                  {currentMessage.from?.name || currentMessage.from?.email}
                </div>
                {currentMessage.from?.name && (
                  <div className="text-sm text-muted-foreground">
                    {currentMessage.from.email}
                  </div>
                )}
                <div className="text-sm text-muted-foreground mt-1">
                  to {formatAddressList(currentMessage.to) || 'me'}
                  {currentMessage.cc && currentMessage.cc.length > 0 && (
                    <span className="ml-1">
                      , cc: {formatAddressList(currentMessage.cc)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              {formatDate(currentMessage.date)}
            </div>
          </div>

          {/* External images warning */}
          {hasExternalImages && !showImages && (
            <div className="bg-muted/50 rounded-lg p-4 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">
                  External images are hidden for your privacy
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowImages(true)}
              >
                Show images
              </Button>
            </div>
          )}

          {/* Attachments */}
          {currentMessage.attachments && currentMessage.attachments.length > 0 && (
            <div className="bg-muted/30 rounded-lg p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {currentMessage.attachments.length} attachment
                  {currentMessage.attachments.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {currentMessage.attachments.map((attachment) => (
                  <Button
                    key={attachment.id}
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() =>
                      handleDownloadAttachment(attachment.id, attachment.filename)
                    }
                  >
                    <Download className="h-3 w-3" />
                    {attachment.filename}
                    <Badge variant="secondary" className="ml-1">
                      {formatFileSize(attachment.size)}
                    </Badge>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Message body */}
          <div className="prose prose-sm dark:prose-invert max-w-none">
            {currentMessage.htmlBody ? (
              <div
                className={cn(
                  'email-body',
                  !showImages && '[&_img[src^="http"]]:hidden'
                )}
                dangerouslySetInnerHTML={{
                  __html: currentMessage.htmlBody,
                }}
              />
            ) : (
              <pre className="whitespace-pre-wrap font-sans">
                {currentMessage.textBody || '(empty message)'}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
