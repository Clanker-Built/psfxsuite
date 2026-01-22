import { NavLink, useLocation } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard,
  Settings,
  FileText,
  AlertTriangle,
  Inbox,
  ClipboardList,
  Cog,
  Wand2,
  Map,
  Users,
  Globe,
  Mail,
  Forward,
  FolderOpen,
  Send,
  PenSquare,
  Star,
  Trash2,
  Archive,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  end?: boolean;
  adminOnly?: boolean;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

// PSFXRelay navigation
const relayNavSections: NavSection[] = [
  {
    items: [
      { to: '/relay', icon: LayoutDashboard, label: 'Dashboard', end: true },
      { to: '/relay/wizard', icon: Wand2, label: 'Setup Wizard' },
    ],
  },
  {
    title: 'Configuration',
    items: [
      { to: '/relay/config', icon: Settings, label: 'Settings' },
      { to: '/relay/routing', icon: Map, label: 'Transport Maps' },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { to: '/relay/logs', icon: FileText, label: 'Mail Logs' },
      { to: '/relay/alerts', icon: AlertTriangle, label: 'Alerts' },
      { to: '/relay/queue', icon: Inbox, label: 'Queue' },
      { to: '/relay/audit', icon: ClipboardList, label: 'Audit Log' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/relay/users', icon: Users, label: 'Users', adminOnly: true },
      { to: '/settings', icon: Cog, label: 'Settings', adminOnly: true },
    ],
  },
];

// PSFXAdmin navigation
const adminNavSections: NavSection[] = [
  {
    items: [
      { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', end: true },
    ],
  },
  {
    title: 'Mail Management',
    items: [
      { to: '/admin/domains', icon: Globe, label: 'Domains' },
      { to: '/admin/mailboxes', icon: Mail, label: 'Mailboxes' },
      { to: '/admin/aliases', icon: Forward, label: 'Aliases' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/admin/users', icon: Users, label: 'Admin Users' },
      { to: '/settings', icon: Cog, label: 'Settings' },
    ],
  },
];

// PSFXMail navigation
const mailNavSections: NavSection[] = [
  {
    items: [
      { to: '/mail/compose', icon: PenSquare, label: 'Compose' },
    ],
  },
  {
    title: 'Folders',
    items: [
      { to: '/mail', icon: Inbox, label: 'Inbox', end: true },
      { to: '/mail/folder/sent', icon: Send, label: 'Sent' },
      { to: '/mail/folder/drafts', icon: FolderOpen, label: 'Drafts' },
      { to: '/mail/folder/starred', icon: Star, label: 'Starred' },
      { to: '/mail/folder/archive', icon: Archive, label: 'Archive' },
      { to: '/mail/folder/trash', icon: Trash2, label: 'Trash' },
    ],
  },
];

// Suite dashboard navigation (when at root)
const suiteNavSections: NavSection[] = [
  {
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Suite Dashboard', end: true },
    ],
  },
  {
    title: 'Modules',
    items: [
      { to: '/relay', icon: Send, label: 'PSFXRelay' },
      { to: '/admin', icon: Users, label: 'PSFXAdmin', adminOnly: true },
      { to: '/mail', icon: Mail, label: 'PSFXMail' },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/settings', icon: Cog, label: 'Settings' },
    ],
  },
];

function getCurrentModule(pathname: string): string {
  if (pathname.startsWith('/relay')) return 'relay';
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/mail')) return 'mail';
  return 'suite';
}

function getNavSections(module: string): NavSection[] {
  switch (module) {
    case 'relay':
      return relayNavSections;
    case 'admin':
      return adminNavSections;
    case 'mail':
      return mailNavSections;
    default:
      return suiteNavSections;
  }
}

export function SideNav() {
  const location = useLocation();
  const canEdit = useAuthStore((state) => state.canEdit());
  const currentModule = getCurrentModule(location.pathname);
  const navSections = getNavSections(currentModule);

  return (
    <nav className="w-64 min-h-[calc(100vh-3.5rem)] border-r bg-muted/10 p-4">
      <div className="space-y-6">
        {navSections.map((section, sectionIndex) => (
          <div key={sectionIndex}>
            {section.title && (
              <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </h3>
            )}
            <ul className="space-y-1">
              {section.items
                .filter((item) => !item.adminOnly || canEdit)
                .map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                          isActive
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        )
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
