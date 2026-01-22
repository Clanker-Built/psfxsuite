import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Search, Pause, Play, Download, Wifi, WifiOff, Filter } from 'lucide-react';
import { logsApi, type LogEntry } from '@/lib/api';
import { formatDate, cn } from '@/lib/utils';

function LogLine({ entry, onQueueClick }: { entry: LogEntry; onQueueClick?: (queueId: string) => void }) {
  const severityColors = {
    info: 'text-foreground',
    warning: 'text-yellow-600',
    error: 'text-red-600',
  };

  const statusColors: Record<string, string> = {
    sent: 'text-green-600',
    deferred: 'text-yellow-600',
    bounced: 'text-red-600',
    expired: 'text-red-600',
  };

  return (
    <div className="font-mono text-xs py-1.5 px-2 hover:bg-muted/50 flex gap-3 border-b border-muted/30">
      <span className="text-muted-foreground whitespace-nowrap w-36 shrink-0">
        {formatDate(entry.timestamp)}
      </span>
      <span className={cn('w-14 shrink-0 uppercase font-medium', severityColors[entry.severity])}>
        {entry.severity}
      </span>
      <span className="text-blue-600 w-28 shrink-0 truncate" title={entry.process}>
        {entry.process}
      </span>
      {entry.queueId ? (
        <span
          className="text-purple-600 w-24 shrink-0 cursor-pointer hover:underline"
          onClick={() => onQueueClick?.(entry.queueId!)}
        >
          {entry.queueId}
        </span>
      ) : (
        <span className="w-24 shrink-0" />
      )}
      {entry.status && (
        <span className={cn('w-16 shrink-0 font-medium', statusColors[entry.status] || '')}>
          {entry.status}
        </span>
      )}
      <span className="flex-1 break-all text-muted-foreground">{entry.message}</span>
    </div>
  );
}

export function LogsPage() {
  const [search, setSearch] = useState('');
  const [isPaused, setIsPaused] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [liveConnected, setLiveConnected] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Query for initial/historical logs
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['logs', { search, severity: severityFilter }],
    queryFn: () => logsApi.query({ search, limit: 200 }),
    refetchInterval: !isLive && !isPaused ? 5000 : false,
  });

  // Connect to SSE stream for live logs
  const connectLive = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const url = `/api/v1/logs/stream`;
    const eventSource = new EventSource(url);

    eventSource.addEventListener('connected', () => {
      setLiveConnected(true);
    });

    eventSource.addEventListener('log', (event) => {
      if (!isPaused) {
        const entry = JSON.parse(event.data) as LogEntry;
        setLiveLogs((prev) => {
          const newLogs = [...prev, entry];
          // Keep last 500 entries
          if (newLogs.length > 500) {
            return newLogs.slice(-500);
          }
          return newLogs;
        });
      }
    });

    eventSource.onerror = () => {
      setLiveConnected(false);
      // Attempt reconnect after 5 seconds
      setTimeout(() => {
        if (isLive) {
          connectLive();
        }
      }, 5000);
    };

    eventSourceRef.current = eventSource;
  }, [isPaused, isLive]);

  // Manage live connection
  useEffect(() => {
    if (isLive) {
      connectLive();
    } else {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setLiveConnected(false);
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [isLive, connectLive]);

  // Auto-scroll to bottom for live logs
  useEffect(() => {
    if (isLive && !isPaused && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [liveLogs, isLive, isPaused]);

  const handleQueueClick = (queueId: string) => {
    setSearch(queueId);
    setIsLive(false);
  };

  const handleExport = async () => {
    window.open('/api/v1/logs/export', '_blank');
  };

  // Get the logs to display
  const displayLogs = isLive ? liveLogs : (data?.logs || []);

  // Apply local filters
  const filteredLogs = displayLogs.filter((log) => {
    if (severityFilter !== 'all' && log.severity !== severityFilter) {
      return false;
    }
    if (search && !isLive) {
      const searchLower = search.toLowerCase();
      return (
        log.message.toLowerCase().includes(searchLower) ||
        log.queueId?.toLowerCase().includes(searchLower) ||
        log.process?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Logs</h1>
          <p className="text-muted-foreground">
            Real-time mail log viewer
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            {isLive && (
              <span className={cn(
                'flex items-center gap-1 text-sm',
                liveConnected ? 'text-green-600' : 'text-red-600'
              )}>
                {liveConnected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                {liveConnected ? 'Connected' : 'Disconnected'}
              </span>
            )}
            <Switch
              checked={isLive}
              onCheckedChange={setIsLive}
            />
            <Label>Live Mode</Label>
          </div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search logs, queue IDs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-32">
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="error">Error</SelectItem>
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsPaused(!isPaused)}
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
            </Button>

            <Button variant="outline" size="icon" onClick={handleExport} title="Export logs">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div
            ref={logContainerRef}
            className="log-viewer h-[600px] overflow-auto border rounded-md bg-muted/10"
          >
            {isLoading && !isLive ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Loading logs...
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                {isLive ? 'Waiting for log entries...' : 'No logs found'}
              </div>
            ) : (
              <div>
                {filteredLogs.map((entry, idx) => (
                  <LogLine
                    key={entry.id || idx}
                    entry={entry}
                    onQueueClick={handleQueueClick}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {isPaused ? 'Paused' : isLive ? 'Live' : 'Polling'} - Showing {filteredLogs.length} entries
            </span>
            {!isLive && (
              <Button variant="ghost" size="sm" onClick={() => refetch()}>
                Refresh
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
