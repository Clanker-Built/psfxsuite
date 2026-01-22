import { useEffect, useState, useRef } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  Search,
  Settings,
  Users,
  Menu,
  X,
  Mail,
  Keyboard,
} from 'lucide-react';
import { useMailShortcuts } from '@/hooks/useMailShortcuts';
import { KeyboardShortcutsHelp } from '@/components/mail/KeyboardShortcutsHelp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useMailStore } from '@/stores/mail';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface FolderItem {
  name: string;
  path: string;
  icon: React.ReactNode;
  folderName: string;
}

const systemFolders: FolderItem[] = [
  { name: 'Inbox', path: '/inbox', icon: <Inbox className="h-4 w-4" />, folderName: 'INBOX' },
  { name: 'Sent', path: '/folder/Sent', icon: <Send className="h-4 w-4" />, folderName: 'Sent' },
  { name: 'Drafts', path: '/folder/Drafts', icon: <FileText className="h-4 w-4" />, folderName: 'Drafts' },
  { name: 'Starred', path: '/folder/Flagged', icon: <Star className="h-4 w-4" />, folderName: 'Flagged' },
  { name: 'Archive', path: '/folder/Archive', icon: <Archive className="h-4 w-4" />, folderName: 'Archive' },
  { name: 'Trash', path: '/folder/Trash', icon: <Trash2 className="h-4 w-4" />, folderName: 'Trash' },
];

export function MailAppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const {
    email,
    folders,
    loadFolders,
    logout,
    selectFolder,
  } = useMailStore();

  // Keyboard shortcuts
  useMailShortcuts({
    handlers: {
      onCompose: () => navigate('/compose'),
      onFocusSearch: () => searchInputRef.current?.focus(),
      onShowHelp: () => setShowShortcutsHelp(true),
      onEscape: () => {
        searchInputRef.current?.blur();
        setShowShortcutsHelp(false);
      },
    },
  });

  // Load folders on mount
  useEffect(() => {
    if (folders.length === 0) {
      loadFolders();
    }
  }, [folders.length, loadFolders]);

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleCompose = () => {
    navigate('/compose');
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleFolderClick = (folderName: string) => {
    selectFolder(folderName);
  };

  const getUnreadCount = (folderName: string): number | undefined => {
    const folder = folders.find((f) => f.name === folderName);
    return folder?.unseen;
  };

  const getInitials = (email: string | null): string => {
    if (!email) return '?';
    const parts = email.split('@')[0].split('.');
    if (parts.length > 1) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return email.slice(0, 2).toUpperCase();
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col border-r bg-muted/30 transition-all duration-300',
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden'
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center border-b px-4">
          <Link to="/inbox" className="flex items-center gap-2 font-semibold">
            <Mail className="h-5 w-5 text-green-600" />
            <span className="text-lg">PSFXMail</span>
          </Link>
        </div>

        {/* Compose button */}
        <div className="p-3">
          <Button onClick={handleCompose} className="w-full gap-2 bg-green-600 hover:bg-green-700">
            <PenSquare className="h-4 w-4" />
            Compose
          </Button>
        </div>

        {/* Folders list */}
        <ScrollArea className="flex-1 px-2">
          <div className="space-y-1 py-2">
            {systemFolders.map((folder) => {
              const isActive =
                location.pathname === folder.path ||
                (folder.path === '/inbox' && location.pathname === '/inbox');
              const unreadCount = getUnreadCount(folder.folderName);

              return (
                <Link
                  key={folder.name}
                  to={folder.path}
                  onClick={() => handleFolderClick(folder.folderName)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    isActive && 'bg-accent text-accent-foreground font-medium'
                  )}
                >
                  {folder.icon}
                  <span className="flex-1">{folder.name}</span>
                  {unreadCount !== undefined && unreadCount > 0 && (
                    <span className="text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded-full px-2 py-0.5">
                      {unreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          {/* Custom IMAP folders */}
          {folders.filter((f) =>
            !['INBOX', 'Sent', 'Drafts', 'Flagged', 'Archive', 'Trash', 'Junk', 'Spam'].includes(f.name)
          ).length > 0 && (
            <>
              <div className="mt-4 mb-2 px-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Folders
              </div>
              <div className="space-y-1">
                {folders
                  .filter((f) =>
                    !['INBOX', 'Sent', 'Drafts', 'Flagged', 'Archive', 'Trash', 'Junk', 'Spam'].includes(f.name)
                  )
                  .map((folder) => {
                    const path = `/folder/${encodeURIComponent(folder.name)}`;
                    const isActive = location.pathname === path;

                    return (
                      <Link
                        key={folder.name}
                        to={path}
                        onClick={() => selectFolder(folder.name)}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                          'hover:bg-accent hover:text-accent-foreground',
                          isActive && 'bg-accent text-accent-foreground font-medium'
                        )}
                      >
                        <ChevronRight className="h-4 w-4" />
                        <span className="flex-1 truncate">{folder.name}</span>
                        {folder.unseen !== undefined && folder.unseen > 0 && (
                          <span className="text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded-full px-2 py-0.5">
                            {folder.unseen}
                          </span>
                        )}
                      </Link>
                    );
                  })}
              </div>
            </>
          )}

          {/* Bottom links */}
          <div className="mt-4 pt-4 border-t space-y-1">
            <Link
              to="/contacts"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                location.pathname === '/contacts' && 'bg-accent text-accent-foreground font-medium'
              )}
            >
              <Users className="h-4 w-4" />
              Contacts
            </Link>
            <Link
              to="/settings"
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                'hover:bg-accent hover:text-accent-foreground',
                location.pathname === '/settings' && 'bg-accent text-accent-foreground font-medium'
              )}
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </div>
        </ScrollArea>

        {/* User section */}
        <div className="border-t p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2 h-auto py-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-green-100 text-green-700 text-xs">
                    {getInitials(email)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left truncate">
                  <div className="text-sm font-medium truncate">{email}</div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowShortcutsHelp(true)}>
                <Keyboard className="mr-2 h-4 w-4" />
                Keyboard shortcuts
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center gap-4 border-b bg-background px-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>

          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1 max-w-xl">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="search"
                placeholder="Search emails... (Press /)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-muted/50"
              />
            </div>
          </form>

          {/* Right side actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/settings')}
              title="Settings"
            >
              <Settings className="h-5 w-5" />
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>

      {/* Keyboard shortcuts help dialog */}
      <KeyboardShortcutsHelp
        open={showShortcutsHelp}
        onOpenChange={setShowShortcutsHelp}
      />
    </div>
  );
}
