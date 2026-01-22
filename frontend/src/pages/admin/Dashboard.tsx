import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Globe, Mail, Forward, HardDrive, TrendingUp, RefreshCw, AlertCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { adminApi, AdminStats, Mailbox } from '@/lib/api';

interface StatCardProps {
  title: string;
  value: string | number;
  description: string;
  icon: React.ReactNode;
  trend?: { value: number; label: string };
  loading?: boolean;
}

function StatCard({ title, value, description, icon, trend, loading }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="h-8 w-8 text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-7 w-16 bg-muted animate-pulse rounded" />
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        <p className="text-xs text-muted-foreground">{description}</p>
        {trend && (
          <div className="flex items-center mt-2 text-xs text-green-600">
            <TrendingUp className="h-3 w-3 mr-1" />
            {trend.value}% {trend.label}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatBytesUnit(bytes: number): string {
  if (bytes === 0) return '0 GB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

export default function AdminDashboard() {
  // Fetch stats from API
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useQuery<AdminStats>({
    queryKey: ['admin', 'stats'],
    queryFn: () => adminApi.getStats(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch recent mailboxes
  const { data: mailboxes = [], isLoading: mailboxesLoading } = useQuery<Mailbox[]>({
    queryKey: ['admin', 'mailboxes', 'recent'],
    queryFn: () => adminApi.listMailboxes(),
  });

  // Get the 5 most recently created mailboxes
  const recentMailboxes = [...mailboxes]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const storageUsedPercent = stats && stats.totalQuota > 0
    ? (stats.usedQuota / stats.totalQuota) * 100
    : 0;

  if (statsError) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">PSFXAdmin</h1>
          <p className="text-muted-foreground">
            Manage domains, mailboxes, and aliases
          </p>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="text-center">
              <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
              <p className="text-destructive mb-4">Failed to load dashboard stats</p>
              <Button onClick={() => refetchStats()} variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" />
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">PSFXAdmin</h1>
          <p className="text-muted-foreground">
            Manage domains, mailboxes, and aliases
          </p>
        </div>
        <Button onClick={() => refetchStats()} variant="outline" size="sm">
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Domains"
          value={stats?.domains ?? 0}
          description={`${stats?.activeDomains ?? 0} active`}
          icon={<Globe className="h-4 w-4" />}
          loading={statsLoading}
        />
        <StatCard
          title="Mailboxes"
          value={stats?.mailboxes ?? 0}
          description="Total user mailboxes"
          icon={<Mail className="h-4 w-4" />}
          loading={statsLoading}
        />
        <StatCard
          title="Aliases"
          value={stats?.aliases ?? 0}
          description="Email forwarding rules"
          icon={<Forward className="h-4 w-4" />}
          loading={statsLoading}
        />
        <StatCard
          title="Storage"
          value={statsLoading ? '...' : formatBytesUnit(stats?.usedQuota ?? 0)}
          description={`of ${formatBytesUnit(stats?.totalQuota ?? 0)} allocated`}
          icon={<HardDrive className="h-4 w-4" />}
          loading={statsLoading}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Storage Usage</CardTitle>
            <CardDescription>
              Overall mailbox storage consumption
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {statsLoading ? (
              <div className="space-y-2">
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                <div className="h-2 w-full bg-muted animate-pulse rounded" />
              </div>
            ) : stats && stats.totalQuota > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Used Storage</span>
                  <span className="text-muted-foreground">
                    {formatBytesUnit(stats.usedQuota)} / {formatBytesUnit(stats.totalQuota)}
                  </span>
                </div>
                <Progress value={storageUsedPercent} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {storageUsedPercent.toFixed(1)}% of allocated storage used
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Used Storage</span>
                  <span className="text-muted-foreground">No quota set</span>
                </div>
                <Progress value={0} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {stats?.mailboxes === 0
                    ? 'No mailboxes configured yet. Create domains and mailboxes to see storage usage.'
                    : 'Mailboxes have unlimited storage (no quota configured).'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common administration tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2">
              <Link
                to="/admin/domains"
                className="flex items-center gap-2 rounded-lg border p-3 hover:bg-accent transition-colors"
              >
                <Globe className="h-5 w-5 text-purple-500" />
                <div>
                  <div className="font-medium">Add Domain</div>
                  <div className="text-xs text-muted-foreground">
                    Configure a new mail domain
                  </div>
                </div>
              </Link>
              <Link
                to="/admin/mailboxes"
                className="flex items-center gap-2 rounded-lg border p-3 hover:bg-accent transition-colors"
              >
                <Mail className="h-5 w-5 text-purple-500" />
                <div>
                  <div className="font-medium">Create Mailbox</div>
                  <div className="text-xs text-muted-foreground">
                    Add a new user mailbox
                  </div>
                </div>
              </Link>
              <Link
                to="/admin/aliases"
                className="flex items-center gap-2 rounded-lg border p-3 hover:bg-accent transition-colors"
              >
                <Forward className="h-5 w-5 text-purple-500" />
                <div>
                  <div className="font-medium">Add Alias</div>
                  <div className="text-xs text-muted-foreground">
                    Set up email forwarding
                  </div>
                </div>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Mailboxes</CardTitle>
          <CardDescription>
            Recently created mailboxes
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mailboxesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-muted animate-pulse rounded-full" />
                  <div className="space-y-1">
                    <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                    <div className="h-3 w-24 bg-muted animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : recentMailboxes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No mailboxes yet</p>
              <p className="text-sm">
                Create your first domain and mailbox to get started
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentMailboxes.map((mailbox) => (
                <div key={mailbox.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-900 flex items-center justify-center">
                      <span className="text-sm font-medium text-purple-700 dark:text-purple-300">
                        {mailbox.email.slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <div className="font-medium">{mailbox.email}</div>
                      <div className="text-xs text-muted-foreground">
                        {mailbox.displayName || 'No display name'}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(mailbox.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
