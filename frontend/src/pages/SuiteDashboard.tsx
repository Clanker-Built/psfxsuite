import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Send,
  Users,
  Mail,
  ArrowRight,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { statusApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { useAlertsStore } from '@/stores/alerts';

interface ModuleCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  href: string;
  stats?: { label: string; value: string | number }[];
  badge?: { label: string; variant: 'default' | 'destructive' };
}

function ModuleCard({ title, description, icon, color, href, stats, badge }: ModuleCardProps) {
  return (
    <Card className="group hover:shadow-lg transition-shadow">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg text-white ${color}`}>
              {icon}
            </div>
            <span>{title}</span>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {badge && (
          <span
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              badge.variant === 'destructive'
                ? 'bg-destructive/10 text-destructive'
                : 'bg-primary/10 text-primary'
            }`}
          >
            {badge.label}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {stats && stats.length > 0 && (
          <div className="grid grid-cols-2 gap-4 mb-4">
            {stats.map((stat, i) => (
              <div key={i}>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        )}
        <Link to={href}>
          <Button className="w-full group-hover:bg-primary/90" variant="default">
            Open {title}
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export default function SuiteDashboard() {
  const canEdit = useAuthStore((state) => state.canEdit());
  const firingCount = useAlertsStore((state) => state.firingCount);

  const { data: status } = useQuery({
    queryKey: ['status'],
    queryFn: statusApi.get,
    refetchInterval: 30000,
  });

  const relayStats = [
    {
      label: 'Queue',
      value: status
        ? (status.queue.active || 0) + (status.queue.deferred || 0)
        : '-',
    },
    {
      label: 'Status',
      value: status?.postfix.running ? 'Running' : 'Stopped',
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">PSFX Suite</h1>
        <p className="text-muted-foreground">
          Your complete email management platform
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <ModuleCard
          title="PSFXRelay"
          description="Outbound relay management, queue monitoring, and delivery tracking"
          icon={<Send className="h-6 w-6" />}
          color="bg-blue-500"
          href="/relay"
          stats={relayStats}
          badge={firingCount > 0 ? { label: `${firingCount} alerts`, variant: 'destructive' } : undefined}
        />

        {canEdit && (
          <ModuleCard
            title="PSFXAdmin"
            description="Domain, mailbox, and alias management for your mail server"
            icon={<Users className="h-6 w-6" />}
            color="bg-purple-500"
            href="/admin"
            stats={[
              { label: 'Domains', value: '-' },
              { label: 'Mailboxes', value: '-' },
            ]}
          />
        )}

        <ModuleCard
          title="PSFXMail"
          description="Full-featured webmail client with a modern interface"
          icon={<Mail className="h-6 w-6" />}
          color="bg-green-500"
          href="/mail"
          stats={[
            { label: 'Unread', value: '-' },
            { label: 'Inbox', value: '-' },
          ]}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-2 w-2 rounded-full ${
                      status?.postfix.running ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <span>Postfix MTA</span>
                </div>
                <span className="text-sm text-muted-foreground">
                  {status?.postfix.running ? 'Online' : 'Offline'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span>Dovecot IMAP</span>
                </div>
                <span className="text-sm text-muted-foreground">Online</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span>Backend API</span>
                </div>
                <span className="text-sm text-muted-foreground">Online</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="text-sm text-muted-foreground text-center py-4">
                No recent activity to display
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
