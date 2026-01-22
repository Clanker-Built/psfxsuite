import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Inbox,
  Send,
  FileText,
  Star,
  Archive,
  Trash2,
  PenSquare,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useMailStore } from '@/stores/mail';

interface FolderItem {
  name: string;
  path: string;
  icon: React.ReactNode;
  count?: number;
}

const systemFolders: FolderItem[] = [
  { name: 'Inbox', path: '/mail', icon: <Inbox className="h-4 w-4" /> },
  { name: 'Sent', path: '/mail/folder/Sent', icon: <Send className="h-4 w-4" /> },
  { name: 'Drafts', path: '/mail/folder/Drafts', icon: <FileText className="h-4 w-4" /> },
  { name: 'Starred', path: '/mail/folder/Flagged', icon: <Star className="h-4 w-4" /> },
  { name: 'Archive', path: '/mail/folder/Archive', icon: <Archive className="h-4 w-4" /> },
  { name: 'Trash', path: '/mail/folder/Trash', icon: <Trash2 className="h-4 w-4" /> },
];

interface MailLayoutProps {
  children: React.ReactNode;
}

export function MailLayout({ children }: MailLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    isAuthenticated,
    email,
    folders,
    loadFolders,
    logout,
    selectFolder,
  } = useMailStore();

  // Load folders when authenticated
  useEffect(() => {
    if (isAuthenticated && folders.length === 0) {
      loadFolders();
    }
  }, [isAuthenticated, folders.length, loadFolders]);

  const handleLogout = async () => {
    await logout();
    navigate('/mail');
  };

  const handleCompose = () => {
    navigate('/mail/compose');
  };

  const handleFolderClick = (folderName: string) => {
    selectFolder(folderName === 'Inbox' ? 'INBOX' : folderName);
  };

  // Get unread count for a folder (from loaded folders)
  const getUnreadCount = (name: string): number | undefined => {
    const folderName = name === 'Inbox' ? 'INBOX' : name;
    const folder = folders.find((f) => f.name === folderName);
    return folder?.unseen;
  };

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-[calc(100vh-8rem)]">
      {/* Folder sidebar */}
      <div className="w-64 border-r flex flex-col">
        {/* Compose button */}
        <div className="p-4">
          <Button onClick={handleCompose} className="w-full gap-2">
            <PenSquare className="h-4 w-4" />
            Compose
          </Button>
        </div>

        {/* Folders list */}
        <ScrollArea className="flex-1">
          <div className="px-2 pb-4">
            <div className="space-y-1">
              {systemFolders.map((folder) => {
                const isActive =
                  location.pathname === folder.path ||
                  (folder.path === '/mail' && location.pathname === '/mail');
                const unreadCount = getUnreadCount(folder.name);

                return (
                  <Link
                    key={folder.name}
                    to={folder.path}
                    onClick={() => handleFolderClick(folder.name)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                      'hover:bg-accent hover:text-accent-foreground',
                      isActive && 'bg-accent text-accent-foreground'
                    )}
                  >
                    {folder.icon}
                    <span className="flex-1">{folder.name}</span>
                    {unreadCount !== undefined && unreadCount > 0 && (
                      <span className="text-xs font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                        {unreadCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>

            {/* Custom folders from IMAP */}
            {folders.filter((f) => !['INBOX', 'Sent', 'Drafts', 'Flagged', 'Archive', 'Trash', 'Junk', 'Spam'].includes(f.name)).length > 0 && (
              <>
                <div className="mt-4 mb-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Folders
                </div>
                <div className="space-y-1">
                  {folders
                    .filter((f) => !['INBOX', 'Sent', 'Drafts', 'Flagged', 'Archive', 'Trash', 'Junk', 'Spam'].includes(f.name))
                    .map((folder) => {
                      const path = `/mail/folder/${encodeURIComponent(folder.name)}`;
                      const isActive = location.pathname === path;

                      return (
                        <Link
                          key={folder.name}
                          to={path}
                          onClick={() => selectFolder(folder.name)}
                          className={cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                            'hover:bg-accent hover:text-accent-foreground',
                            isActive && 'bg-accent text-accent-foreground'
                          )}
                        >
                          <ChevronRight className="h-4 w-4" />
                          <span className="flex-1 truncate">{folder.name}</span>
                          {folder.unseen !== undefined && folder.unseen > 0 && (
                            <span className="text-xs font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
                              {folder.unseen}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        {/* User info and logout */}
        <div className="border-t p-4">
          <div className="flex items-center justify-between">
            <div className="truncate text-sm text-muted-foreground" title={email || ''}>
              {email}
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleLogout}
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}
