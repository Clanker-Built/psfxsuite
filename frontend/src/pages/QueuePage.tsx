import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  Mail,
  Clock,
  Pause,
  AlertTriangle,
  Play,
  Trash2,
  Search,
  Send,
  Eye,
} from 'lucide-react';
import { queueApi, QueueMessage, logsApi } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { formatDistanceToNow } from 'date-fns';

function QueueSummaryCard({
  title,
  count,
  icon: Icon,
  variant = 'default',
  onClick,
  active,
}: {
  title: string;
  count: number;
  icon: React.ElementType;
  variant?: 'default' | 'warning' | 'error';
  onClick?: () => void;
  active?: boolean;
}) {
  const variantStyles = {
    default: '',
    warning: 'text-yellow-600',
    error: 'text-red-600',
  };

  return (
    <Card
      className={`cursor-pointer transition-colors ${active ? 'ring-2 ring-primary' : ''}`}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${variantStyles[variant]}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${variantStyles[variant]}`}>
          {count}
        </div>
      </CardContent>
    </Card>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    active: 'default',
    deferred: 'secondary',
    hold: 'outline',
  };

  return (
    <Badge variant={variants[status] || 'default'}>
      {status}
    </Badge>
  );
}

export function QueuePage() {
  const queryClient = useQueryClient();
  const canEdit = useAuthStore((state) => state.canEdit());
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMessage, setSelectedMessage] = useState<QueueMessage | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [messageToDelete, setMessageToDelete] = useState<string | null>(null);

  const { data: summary, refetch: refetchSummary } = useQuery({
    queryKey: ['queue-summary'],
    queryFn: queueApi.summary,
    refetchInterval: 5000,
  });

  const { data: messagesData, isLoading, refetch: refetchMessages } = useQuery({
    queryKey: ['queue-messages', statusFilter],
    queryFn: () => queueApi.list(statusFilter || undefined),
    refetchInterval: 10000,
  });

  const { data: messageLogs } = useQuery({
    queryKey: ['queue-message-logs', selectedMessage?.queueId],
    queryFn: () => logsApi.getByQueueId(selectedMessage!.queueId),
    enabled: !!selectedMessage,
  });

  const flushMutation = useMutation({
    mutationFn: queueApi.flush,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-summary'] });
      queryClient.invalidateQueries({ queryKey: ['queue-messages'] });
    },
  });

  const holdMutation = useMutation({
    mutationFn: queueApi.hold,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-summary'] });
      queryClient.invalidateQueries({ queryKey: ['queue-messages'] });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: queueApi.release,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-summary'] });
      queryClient.invalidateQueries({ queryKey: ['queue-messages'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: queueApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue-summary'] });
      queryClient.invalidateQueries({ queryKey: ['queue-messages'] });
      setShowDeleteDialog(false);
      setMessageToDelete(null);
    },
  });

  const handleRefresh = () => {
    refetchSummary();
    refetchMessages();
  };

  const handleFilterClick = (filter: string) => {
    setStatusFilter(statusFilter === filter ? '' : filter);
  };

  const filteredMessages = messagesData?.messages?.filter((msg) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      msg.queueId.toLowerCase().includes(query) ||
      msg.sender.toLowerCase().includes(query) ||
      msg.recipients.some((r) => r.toLowerCase().includes(query)) ||
      msg.reason?.toLowerCase().includes(query)
    );
  }) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Mail Queue</h1>
          <p className="text-muted-foreground">
            Inspect and manage the Postfix mail queue
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {canEdit && (
            <Button
              onClick={() => flushMutation.mutate()}
              disabled={flushMutation.isPending}
            >
              <Send className="h-4 w-4 mr-2" />
              {flushMutation.isPending ? 'Flushing...' : 'Flush Queue'}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <QueueSummaryCard
          title="Active"
          count={summary?.active ?? 0}
          icon={Mail}
          onClick={() => handleFilterClick('active')}
          active={statusFilter === 'active'}
        />
        <QueueSummaryCard
          title="Deferred"
          count={summary?.deferred ?? 0}
          icon={Clock}
          variant={(summary?.deferred ?? 0) > 50 ? 'warning' : 'default'}
          onClick={() => handleFilterClick('deferred')}
          active={statusFilter === 'deferred'}
        />
        <QueueSummaryCard
          title="On Hold"
          count={summary?.hold ?? 0}
          icon={Pause}
          onClick={() => handleFilterClick('hold')}
          active={statusFilter === 'hold'}
        />
        <QueueSummaryCard
          title="Corrupt"
          count={summary?.corrupt ?? 0}
          icon={AlertTriangle}
          variant={(summary?.corrupt ?? 0) > 0 ? 'error' : 'default'}
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Queue Messages</CardTitle>
              <CardDescription>
                {filteredMessages.length} message{filteredMessages.length !== 1 ? 's' : ''} in queue
                {statusFilter && ` (filtered by ${statusFilter})`}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search..."
                  className="pl-8 w-64"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="deferred">Deferred</SelectItem>
                  <SelectItem value="hold">Hold</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading queue messages...
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchQuery || statusFilter
                ? 'No messages match your filters'
                : 'Queue is empty'}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Queue ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Sender</TableHead>
                    <TableHead>Recipients</TableHead>
                    <TableHead>Size</TableHead>
                    <TableHead>Arrived</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMessages.map((msg) => (
                    <TableRow key={msg.queueId}>
                      <TableCell className="font-mono text-xs">
                        {msg.queueId}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={msg.status} />
                      </TableCell>
                      <TableCell className="max-w-40 truncate" title={msg.sender}>
                        {msg.sender}
                      </TableCell>
                      <TableCell className="max-w-40">
                        <div className="truncate" title={msg.recipients.join(', ')}>
                          {msg.recipients[0]}
                          {msg.recipients.length > 1 && (
                            <span className="text-muted-foreground">
                              {' '}+{msg.recipients.length - 1}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{formatSize(msg.size)}</TableCell>
                      <TableCell className="text-xs">
                        {formatDistanceToNow(new Date(msg.arrivalTime), {
                          addSuffix: true,
                        })}
                      </TableCell>
                      <TableCell className="max-w-48 truncate text-xs text-muted-foreground" title={msg.reason}>
                        {msg.reason || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSelectedMessage(msg)}
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {canEdit && msg.status !== 'hold' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => holdMutation.mutate(msg.queueId)}
                              disabled={holdMutation.isPending}
                              title="Put on hold"
                            >
                              <Pause className="h-4 w-4" />
                            </Button>
                          )}
                          {canEdit && msg.status === 'hold' && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => releaseMutation.mutate(msg.queueId)}
                              disabled={releaseMutation.isPending}
                              title="Release from hold"
                            >
                              <Play className="h-4 w-4" />
                            </Button>
                          )}
                          {isAdmin && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setMessageToDelete(msg.queueId);
                                setShowDeleteDialog(true);
                              }}
                              title="Delete message"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Message Details Dialog */}
      <Dialog open={!!selectedMessage} onOpenChange={() => setSelectedMessage(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Message Details</DialogTitle>
            <DialogDescription>
              Queue ID: {selectedMessage?.queueId}
            </DialogDescription>
          </DialogHeader>
          {selectedMessage && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Status
                  </label>
                  <div className="mt-1">
                    <StatusBadge status={selectedMessage.status} />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Size
                  </label>
                  <div className="mt-1">{formatSize(selectedMessage.size)}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Arrival Time
                  </label>
                  <div className="mt-1">
                    {new Date(selectedMessage.arrivalTime).toLocaleString()}
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Sender
                  </label>
                  <div className="mt-1 font-mono text-sm break-all">
                    {selectedMessage.sender}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  Recipients
                </label>
                <div className="mt-1 space-y-1">
                  {selectedMessage.recipients.map((r, i) => (
                    <div key={i} className="font-mono text-sm">
                      {r}
                    </div>
                  ))}
                </div>
              </div>
              {selectedMessage.reason && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Deferral Reason
                  </label>
                  <div className="mt-1 p-2 bg-muted rounded text-sm">
                    {selectedMessage.reason}
                  </div>
                </div>
              )}
              {messageLogs?.logs && messageLogs.logs.length > 0 && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Related Log Entries
                  </label>
                  <div className="mt-1 max-h-48 overflow-y-auto border rounded p-2 space-y-1">
                    {messageLogs.logs.map((log, i) => (
                      <div key={i} className="text-xs font-mono">
                        <span className="text-muted-foreground">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>{' '}
                        {log.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {canEdit && selectedMessage && (
              <>
                {selectedMessage.status !== 'hold' ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      holdMutation.mutate(selectedMessage.queueId);
                      setSelectedMessage(null);
                    }}
                  >
                    <Pause className="h-4 w-4 mr-2" />
                    Put on Hold
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={() => {
                      releaseMutation.mutate(selectedMessage.queueId);
                      setSelectedMessage(null);
                    }}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    Release
                  </Button>
                )}
                {isAdmin && (
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setMessageToDelete(selectedMessage.queueId);
                      setShowDeleteDialog(true);
                      setSelectedMessage(null);
                    }}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </Button>
                )}
              </>
            )}
            <Button variant="outline" onClick={() => setSelectedMessage(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Message</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete message {messageToDelete}? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setMessageToDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => messageToDelete && deleteMutation.mutate(messageToDelete)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
