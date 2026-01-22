import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  AlertTriangle,
  Mail,
  Clock,
  Pause,
} from 'lucide-react';
import { statusApi, type SystemStatus } from '@/lib/api';
import { formatRelativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

function StatusCard({
  title,
  value,
  description,
  icon: Icon,
  variant = 'default',
}: {
  title: string;
  value: string | number;
  description?: string;
  icon: React.ElementType;
  variant?: 'default' | 'success' | 'warning' | 'error';
}) {
  const variantStyles = {
    default: 'text-foreground',
    success: 'text-green-600',
    warning: 'text-yellow-600',
    error: 'text-red-600',
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={cn('h-4 w-4', variantStyles[variant])} />
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold', variantStyles[variant])}>
          {value}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { data: status, isLoading, refetch } = useQuery<SystemStatus>({
    queryKey: ['status'],
    queryFn: statusApi.get,
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const postfixStatus = status?.postfix?.running ?? false;
  const queueTotal =
    (status?.queue?.active ?? 0) +
    (status?.queue?.deferred ?? 0) +
    (status?.queue?.hold ?? 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Postfix relay server status overview
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatusCard
          title="Postfix Status"
          value={postfixStatus ? 'Running' : 'Stopped'}
          description={status?.postfix?.version}
          icon={postfixStatus ? CheckCircle : XCircle}
          variant={postfixStatus ? 'success' : 'error'}
        />
        <StatusCard
          title="Queue Total"
          value={queueTotal}
          description="Messages in queue"
          icon={Mail}
          variant={queueTotal > 100 ? 'warning' : 'default'}
        />
        <StatusCard
          title="Deferred"
          value={status?.queue?.deferred ?? 0}
          description="Waiting for retry"
          icon={Clock}
          variant={
            (status?.queue?.deferred ?? 0) > 50 ? 'warning' : 'default'
          }
        />
        <StatusCard
          title="On Hold"
          value={status?.queue?.hold ?? 0}
          description="Manually held"
          icon={Pause}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Last Config Reload</CardTitle>
            <CardDescription>
              {status?.lastReload?.timestamp
                ? formatRelativeTime(status.lastReload.timestamp)
                : 'Never'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {status?.lastReload?.success ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="text-green-600">Successful</span>
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-red-600" />
                  <span className="text-red-600">Failed</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Configuration Status</CardTitle>
            <CardDescription>Current configuration state</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {status?.configStatus === 'ok' && (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <span className="text-green-600">Valid</span>
                </>
              )}
              {status?.configStatus === 'error' && (
                <>
                  <XCircle className="h-5 w-5 text-red-600" />
                  <span className="text-red-600">Error</span>
                </>
              )}
              {status?.configStatus === 'pending' && (
                <>
                  <AlertTriangle className="h-5 w-5 text-yellow-600" />
                  <span className="text-yellow-600">Pending Changes</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
