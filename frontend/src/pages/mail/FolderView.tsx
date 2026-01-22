import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Mail,
  Send,
  FileText,
  Star,
  StarOff,
  Archive,
  Trash2,
  RefreshCw,
  Search,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useMailStore } from '@/stores/mail';

interface FolderConfig {
  name: string;
  imapName: string;
  icon: React.ReactNode;
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptyDescription: string;
}

const folderConfigs: Record<string, FolderConfig> = {
  Sent: {
    name: 'Sent',
    imapName: 'Sent',
    icon: <Send className="h-4 w-4" />,
    emptyIcon: <Send className="h-16 w-16" />,
    emptyTitle: 'No sent messages',
    emptyDescription: 'Messages you send will appear here.',
  },
  Drafts: {
    name: 'Drafts',
    imapName: 'Drafts',
    icon: <FileText className="h-4 w-4" />,
    emptyIcon: <FileText className="h-16 w-16" />,
    emptyTitle: 'No drafts',
    emptyDescription: 'Unsent messages will be saved here.',
  },
  Flagged: {
    name: 'Starred',
    imapName: 'Flagged',
    icon: <Star className="h-4 w-4" />,
    emptyIcon: <Star className="h-16 w-16" />,
    emptyTitle: 'No starred messages',
    emptyDescription: 'Star important messages to find them later.',
  },
  Archive: {
    name: 'Archive',
    imapName: 'Archive',
    icon: <Archive className="h-4 w-4" />,
    emptyIcon: <Archive className="h-16 w-16" />,
    emptyTitle: 'No archived messages',
    emptyDescription: 'Archived messages will appear here.',
  },
  Trash: {
    name: 'Trash',
    imapName: 'Trash',
    icon: <Trash2 className="h-4 w-4" />,
    emptyIcon: <Trash2 className="h-16 w-16" />,
    emptyTitle: 'Trash is empty',
    emptyDescription: 'Deleted messages will appear here for 30 days.',
  },
};

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

export default function FolderView() {
  const { folder } = useParams<{ folder: string }>();
  const navigate = useNavigate();
  const {
    messages,
    isLoading,
    loadMessages,
    markStarred,
    deleteMessage,
    moveMessage,
    selectFolder,
  } = useMailStore();
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  const config = folder ? folderConfigs[folder] : null;

  // Load messages when folder changes
  useEffect(() => {
    if (folder) {
      const imapFolder = config?.imapName || folder;
      selectFolder(imapFolder);
      loadMessages(imapFolder);
    }
  }, [folder, config, selectFolder, loadMessages]);

  if (!config && !folder) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Mail className="h-16 w-16 text-muted-foreground mb-4 opacity-50" />
        <h2 className="text-xl font-semibold mb-2">Folder not found</h2>
        <p className="text-muted-foreground">
          The folder you're looking for doesn't exist.
        </p>
      </div>
    );
  }

  const displayName = config?.name || folder || 'Unknown';
  const emptyIcon = config?.emptyIcon || <Mail className="h-16 w-16" />;
  const emptyTitle = config?.emptyTitle || 'No messages';
  const emptyDescription = config?.emptyDescription || 'This folder is empty.';

  const toggleSelect = (uid: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(uid)) {
      newSelected.delete(uid);
    } else {
      newSelected.add(uid);
    }
    setSelectedIds(newSelected);
  };

  const selectAll = () => {
    if (selectedIds.size === messages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(messages.map((m) => m.uid)));
    }
  };

  const handleRefresh = () => {
    if (folder) {
      loadMessages(config?.imapName || folder);
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

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={selectedIds.size === messages.length && messages.length > 0}
            onCheckedChange={selectAll}
          />
          <Button variant="ghost" size="icon" onClick={handleRefresh} disabled={isLoading}>
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </Button>
          <span className="text-sm font-medium">{displayName}</span>
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
        </div>
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={`Search ${displayName.toLowerCase()}...`}
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-auto">
        {isLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <div className="text-muted-foreground mb-4 opacity-50">{emptyIcon}</div>
            <h2 className="text-xl font-semibold mb-2">{emptyTitle}</h2>
            <p className="text-muted-foreground max-w-md">{emptyDescription}</p>
          </div>
        ) : (
          <div className="divide-y">
            {messages.map((message) => (
              <div
                key={message.uid}
                onClick={() => navigate(`/mail/message/${message.uid}`)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 hover:bg-muted/50 cursor-pointer transition-colors',
                  !message.read && 'bg-accent/30',
                  selectedIds.has(message.uid) && 'bg-accent'
                )}
              >
                <Checkbox
                  checked={selectedIds.has(message.uid)}
                  onCheckedChange={() => toggleSelect(message.uid)}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                />
                <button
                  className="text-muted-foreground hover:text-yellow-500 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    markStarred(message.uid, !message.starred);
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
                    <DropdownMenuItem onClick={() => moveMessage(message.uid, 'INBOX')}>
                      Move to Inbox
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => moveMessage(message.uid, 'Archive')}>
                      Archive
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => deleteMessage(message.uid)}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
