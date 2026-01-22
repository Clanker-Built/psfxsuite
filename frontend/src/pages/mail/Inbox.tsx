import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail,
  Star,
  StarOff,
  Trash2,
  Archive,
  MoreHorizontal,
  RefreshCw,
  Search,
  LogIn,
  MessagesSquare,
  Layers,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useMailStore } from '@/stores/mail';
import { useToast } from '@/hooks/use-toast';
import { MailConversation, MailMessageSummary } from '@/lib/api';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (days < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

// Mail Login Component
function MailLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, error, clearError } = useMailStore();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    const success = await login(email, password);
    if (!success) {
      toast({
        title: 'Login Failed',
        description: error || 'Invalid email or password',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500 text-white">
              <Mail className="h-6 w-6" />
            </div>
          </div>
          <CardTitle>PSFXMail</CardTitle>
          <CardDescription>
            Sign in to access your mailbox
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              <LogIn className="mr-2 h-4 w-4" />
              {isLoading ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function MailInbox() {
  const {
    isAuthenticated,
    messages,
    conversations,
    viewMode,
    currentFolder,
    isLoading,
    expandedConversationId,
    loadMessages,
    loadConversations,
    setViewMode,
    expandConversation,
    markStarred,
    deleteMessage,
    moveMessage,
  } = useMailStore();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  // Load messages/conversations when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      if (viewMode === 'conversations') {
        loadConversations();
      } else {
        loadMessages();
      }
    }
  }, [isAuthenticated, currentFolder, viewMode, loadMessages, loadConversations]);

  // Show login if not authenticated
  if (!isAuthenticated) {
    return <MailLogin />;
  }

  const toggleSelect = (uid: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(uid)) {
      newSelected.delete(uid);
    } else {
      newSelected.add(uid);
    }
    setSelectedIds(newSelected);
  };

  const allMessagesList = viewMode === 'conversations'
    ? conversations.flatMap(c => c.messages)
    : messages;

  const selectAll = () => {
    if (selectedIds.size === allMessagesList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allMessagesList.map((m) => m.uid)));
    }
  };

  const handleRefresh = () => {
    if (viewMode === 'conversations') {
      loadConversations();
    } else {
      loadMessages();
    }
  };

  const handleArchive = () => {
    selectedIds.forEach((uid) => moveMessage(uid, 'Archive'));
    setSelectedIds(new Set());
  };

  const handleDelete = () => {
    selectedIds.forEach((uid) => deleteMessage(uid));
    setSelectedIds(new Set());
  };

  const toggleViewMode = () => {
    setViewMode(viewMode === 'conversations' ? 'messages' : 'conversations');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selectedIds.size === allMessagesList.length && allMessagesList.length > 0}
            onCheckedChange={selectAll}
          />
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
          </Button>
          {selectedIds.size > 0 && (
            <>
              <Button variant="ghost" size="icon" onClick={handleArchive}>
                <Archive className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={handleDelete}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
          <div className="h-4 w-px bg-border mx-1" />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === 'conversations' ? 'secondary' : 'ghost'}
                  size="icon"
                  onClick={toggleViewMode}
                >
                  {viewMode === 'conversations' ? (
                    <MessagesSquare className="h-4 w-4" />
                  ) : (
                    <Layers className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {viewMode === 'conversations' ? 'Conversation view' : 'Message view'}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search mail..."
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-auto">
        {isLoading && allMessagesList.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : allMessagesList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Mail className="h-16 w-16 text-muted-foreground mb-4 opacity-50" />
            <h2 className="text-xl font-semibold mb-2">Your inbox is empty</h2>
            <p className="text-muted-foreground max-w-md">
              When you receive messages, they will appear here.
            </p>
          </div>
        ) : viewMode === 'conversations' ? (
          <div className="divide-y">
            {conversations.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                isExpanded={expandedConversationId === conversation.id}
                onToggleExpand={() =>
                  expandConversation(expandedConversationId === conversation.id ? null : conversation.id)
                }
                onMessageClick={(uid) => navigate(`/mail/message/${uid}`)}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                onStar={(uid, starred) => markStarred(uid, starred)}
                onArchive={(uid) => moveMessage(uid, 'Archive')}
                onDelete={(uid) => deleteMessage(uid)}
              />
            ))}
          </div>
        ) : (
          <div className="divide-y">
            {messages.map((message) => (
              <MessageRow
                key={message.uid}
                message={message}
                isSelected={selectedIds.has(message.uid)}
                onToggleSelect={() => toggleSelect(message.uid)}
                onClick={() => navigate(`/mail/message/${message.uid}`)}
                onStar={() => markStarred(message.uid, !message.starred)}
                onArchive={() => moveMessage(message.uid, 'Archive')}
                onDelete={() => deleteMessage(message.uid)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Message row component
function MessageRow({
  message,
  isSelected,
  onToggleSelect,
  onClick,
  onStar,
  onArchive,
  onDelete,
}: {
  message: MailMessageSummary;
  isSelected: boolean;
  onToggleSelect: () => void;
  onClick: () => void;
  onStar: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors',
        !message.read && 'bg-accent/30',
        isSelected && 'bg-accent'
      )}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggleSelect}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      />
      <button
        className="text-muted-foreground hover:text-yellow-500 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onStar();
        }}
      >
        {message.starred ? (
          <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
        ) : (
          <StarOff className="h-4 w-4" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('truncate', !message.read && 'font-semibold')}>
            {message.fromName || message.from}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('truncate', !message.read && 'font-medium')}>
            {message.subject || '(no subject)'}
          </span>
        </div>
      </div>
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        {formatDate(message.date)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onArchive}>Archive</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// Conversation row component
function ConversationRow({
  conversation,
  isExpanded,
  onToggleExpand,
  onMessageClick,
  selectedIds,
  onToggleSelect,
  onStar,
  onArchive,
  onDelete,
}: {
  conversation: MailConversation;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onMessageClick: (uid: number) => void;
  selectedIds: Set<number>;
  onToggleSelect: (uid: number) => void;
  onStar: (uid: number, starred: boolean) => void;
  onArchive: (uid: number) => void;
  onDelete: (uid: number) => void;
}) {
  const hasUnread = conversation.unreadCount > 0;
  const latestMessage = conversation.messages[conversation.messages.length - 1];

  // For single message conversations, behave like a regular message row
  if (conversation.messageCount === 1) {
    return (
      <MessageRow
        message={latestMessage}
        isSelected={selectedIds.has(latestMessage.uid)}
        onToggleSelect={() => onToggleSelect(latestMessage.uid)}
        onClick={() => onMessageClick(latestMessage.uid)}
        onStar={() => onStar(latestMessage.uid, !latestMessage.starred)}
        onArchive={() => onArchive(latestMessage.uid)}
        onDelete={() => onDelete(latestMessage.uid)}
      />
    );
  }

  return (
    <div>
      {/* Conversation header */}
      <div
        onClick={onToggleExpand}
        className={cn(
          'flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors',
          hasUnread && 'bg-accent/30'
        )}
      >
        <button
          className="text-muted-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <button
          className="text-muted-foreground hover:text-yellow-500 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            // Star the latest message
            onStar(latestMessage.uid, !conversation.starred);
          }}
        >
          {conversation.starred ? (
            <Star className="h-4 w-4 fill-yellow-500 text-yellow-500" />
          ) : (
            <StarOff className="h-4 w-4" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={cn('truncate', hasUnread && 'font-semibold')}>
              {conversation.participants.slice(0, 3).join(', ')}
              {conversation.participants.length > 3 && ` +${conversation.participants.length - 3}`}
            </span>
            <Badge variant="secondary" className="text-xs">
              {conversation.messageCount}
            </Badge>
            {hasUnread && (
              <Badge variant="default" className="text-xs">
                {conversation.unreadCount} new
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={cn('truncate text-sm', hasUnread && 'font-medium')}>
              {conversation.subject || '(no subject)'}
            </span>
          </div>
        </div>
        <span className="text-sm text-muted-foreground whitespace-nowrap">
          {formatDate(conversation.lastDate)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => conversation.messages.forEach((m) => onArchive(m.uid))}
            >
              Archive All
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => conversation.messages.forEach((m) => onDelete(m.uid))}
            >
              Delete All
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Expanded messages */}
      {isExpanded && (
        <div className="border-l-2 border-muted ml-6">
          {conversation.messages.map((message) => (
            <div
              key={message.uid}
              onClick={() => onMessageClick(message.uid)}
              className={cn(
                'flex items-center gap-3 px-4 py-2 hover:bg-muted/50 cursor-pointer transition-colors text-sm',
                !message.read && 'bg-accent/20',
                selectedIds.has(message.uid) && 'bg-accent'
              )}
            >
              <Checkbox
                checked={selectedIds.has(message.uid)}
                onCheckedChange={() => onToggleSelect(message.uid)}
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={cn('truncate', !message.read && 'font-medium')}>
                    {message.fromName || message.from}
                  </span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(message.date)}
                  </span>
                </div>
              </div>
              <button
                className="text-muted-foreground hover:text-yellow-500 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onStar(message.uid, !message.starred);
                }}
              >
                {message.starred ? (
                  <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
                ) : (
                  <StarOff className="h-3 w-3" />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
