import { Link, useLocation } from 'react-router-dom';
import { Send, Users, Mail, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

interface Module {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  color: string;
  adminOnly?: boolean;
}

const modules: Module[] = [
  {
    id: 'relay',
    name: 'PSFXRelay',
    description: 'Outbound relay management',
    icon: <Send className="h-6 w-6" />,
    path: '/relay',
    color: 'bg-blue-500',
  },
  {
    id: 'admin',
    name: 'PSFXAdmin',
    description: 'Mailbox & user administration',
    icon: <Users className="h-6 w-6" />,
    path: '/admin',
    color: 'bg-purple-500',
    adminOnly: true,
  },
  {
    id: 'mail',
    name: 'PSFXMail',
    description: 'Webmail client',
    icon: <Mail className="h-6 w-6" />,
    path: '/mail',
    color: 'bg-green-500',
  },
];

function getCurrentModule(pathname: string): Module | undefined {
  return modules.find((m) => pathname.startsWith(m.path));
}

export function ModuleSwitcher() {
  const location = useLocation();
  const currentModule = getCurrentModule(location.pathname);
  const canEdit = useAuthStore((state) => state.canEdit());

  const availableModules = modules.filter((m) => !m.adminOnly || canEdit);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="mr-2">
          <LayoutGrid className="h-5 w-5" />
          <span className="sr-only">Switch module</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>PSFX Suite</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="grid gap-1 p-1">
          {availableModules.map((module) => (
            <DropdownMenuItem key={module.id} asChild className="p-0">
              <Link
                to={module.path}
                className={cn(
                  'flex items-center gap-3 rounded-lg p-3 transition-colors',
                  currentModule?.id === module.id
                    ? 'bg-accent'
                    : 'hover:bg-accent/50'
                )}
              >
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg text-white',
                    module.color
                  )}
                >
                  {module.icon}
                </div>
                <div className="flex-1">
                  <div className="font-medium">{module.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {module.description}
                  </div>
                </div>
              </Link>
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/" className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4" />
            Suite Dashboard
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ModuleIndicator() {
  const location = useLocation();
  const currentModule = getCurrentModule(location.pathname);

  if (!currentModule) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-accent/50">
      <div
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded text-white text-xs',
          currentModule.color
        )}
      >
        {currentModule.icon}
      </div>
      <span className="text-sm font-medium">{currentModule.name}</span>
    </div>
  );
}
