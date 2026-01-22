import { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  BellOff,
  RefreshCw,
  Eye,
  BookOpen,
} from 'lucide-react';
import { alertsApi, type Alert, type AlertRule } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';

function AlertCard({
  alert,
  onAcknowledge,
  onSilence,
  onViewDetails,
}: {
  alert: Alert;
  onAcknowledge: (id: number) => void;
  onSilence: (id: number, minutes: number) => void;
  onViewDetails: (alert: Alert) => void;
}) {
  const canEdit = useAuthStore((state) => state.canEdit());
  const [showSilenceDialog, setShowSilenceDialog] = useState(false);
  const [silenceMinutes, setSilenceMinutes] = useState(60);

  const severityStyles = {
    warning: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/50',
    critical: 'border-red-500 bg-red-50 dark:bg-red-950/50',
  };

  const statusIcons = {
    firing: AlertTriangle,
    acknowledged: Clock,
    resolved: CheckCircle,
    silenced: BellOff,
  };

  const StatusIcon = statusIcons[alert.status] || AlertTriangle;

  return (
    <>
      <Card className={cn('border-l-4', severityStyles[alert.severity])}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <StatusIcon
                className={cn(
                  'h-5 w-5',
                  alert.severity === 'critical'
                    ? 'text-red-600'
                    : 'text-yellow-600'
                )}
              />
              <CardTitle className="text-lg">{alert.ruleName}</CardTitle>
            </div>
            <Badge variant={alert.status === 'firing' ? 'destructive' : 'secondary'}>
              {alert.status}
            </Badge>
          </div>
          <CardDescription>
            Triggered {formatDistanceToNow(new Date(alert.triggeredAt), { addSuffix: true })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {canEdit && alert.status === 'firing' && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onAcknowledge(alert.id)}
                >
                  <CheckCircle className="h-4 w-4 mr-1" />
                  Acknowledge
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowSilenceDialog(true)}
                >
                  <BellOff className="h-4 w-4 mr-1" />
                  Silence
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onViewDetails(alert)}
            >
              <Eye className="h-4 w-4 mr-1" />
              Details
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showSilenceDialog} onOpenChange={setShowSilenceDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Silence Alert</DialogTitle>
            <DialogDescription>
              How long should this alert be silenced?
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select
              value={silenceMinutes.toString()}
              onValueChange={(v) => setSilenceMinutes(parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 minutes</SelectItem>
                <SelectItem value="30">30 minutes</SelectItem>
                <SelectItem value="60">1 hour</SelectItem>
                <SelectItem value="120">2 hours</SelectItem>
                <SelectItem value="240">4 hours</SelectItem>
                <SelectItem value="480">8 hours</SelectItem>
                <SelectItem value="1440">24 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSilenceDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                onSilence(alert.id, silenceMinutes);
                setShowSilenceDialog(false);
              }}
            >
              Silence Alert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ActiveAlerts() {
  const queryClient = useQueryClient();
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [runbookContent, setRunbookContent] = useState<{ title: string; overview: string; steps: string[] } | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['alerts'],
    queryFn: alertsApi.list,
    refetchInterval: 10000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: (id: number) => alertsApi.acknowledge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const silenceMutation = useMutation({
    mutationFn: ({ id, minutes }: { id: number; minutes: number }) =>
      alertsApi.silence(id, minutes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    },
  });

  const handleViewDetails = async (alert: Alert) => {
    setSelectedAlert(alert);
    // Fetch runbook content
    try {
      const ruleType = alert.ruleName.toLowerCase().includes('queue') ? 'queue_growth'
        : alert.ruleName.toLowerCase().includes('deferred') ? 'deferred_spike'
        : alert.ruleName.toLowerCase().includes('auth') ? 'auth_failures'
        : alert.ruleName.toLowerCase().includes('tls') ? 'tls_failures'
        : 'general';
      const response = await fetch(`/api/v1/alerts/runbook/${ruleType}`);
      if (response.ok) {
        const data = await response.json();
        setRunbookContent(data);
      }
    } catch (e) {
      // Ignore errors
    }
  };

  const activeAlerts =
    data?.alerts?.filter(
      (a) => a.status === 'firing' || a.status === 'acknowledged'
    ) ?? [];

  if (isLoading) {
    return <div className="text-muted-foreground">Loading alerts...</div>;
  }

  return (
    <>
      <div className="flex justify-end mb-4">
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {activeAlerts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle className="h-12 w-12 mx-auto mb-4 text-green-600" />
          <p className="text-lg font-medium">All clear!</p>
          <p>No active alerts at this time.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {activeAlerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onAcknowledge={(id) => acknowledgeMutation.mutate(id)}
              onSilence={(id, minutes) => silenceMutation.mutate({ id, minutes })}
              onViewDetails={handleViewDetails}
            />
          ))}
        </div>
      )}

      {/* Alert Details Dialog */}
      <Dialog open={!!selectedAlert} onOpenChange={() => setSelectedAlert(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedAlert?.ruleName}</DialogTitle>
            <DialogDescription>
              Alert Details
            </DialogDescription>
          </DialogHeader>
          {selectedAlert && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge variant={selectedAlert.status === 'firing' ? 'destructive' : 'secondary'}>
                      {selectedAlert.status}
                    </Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Severity</Label>
                  <div className="mt-1 capitalize">{selectedAlert.severity}</div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Triggered</Label>
                  <div className="mt-1">
                    {new Date(selectedAlert.triggeredAt).toLocaleString()}
                  </div>
                </div>
                {selectedAlert.acknowledgedAt && (
                  <div>
                    <Label className="text-muted-foreground">Acknowledged</Label>
                    <div className="mt-1">
                      {new Date(selectedAlert.acknowledgedAt).toLocaleString()}
                      {selectedAlert.acknowledgedBy && ` by ${selectedAlert.acknowledgedBy}`}
                    </div>
                  </div>
                )}
              </div>

              {runbookContent && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <BookOpen className="h-4 w-4" />
                      Runbook: {runbookContent.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground mb-4">
                      {runbookContent.overview}
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-sm">
                      {runbookContent.steps.map((step, i) => (
                        <li key={i}>{step}</li>
                      ))}
                    </ol>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedAlert(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AlertHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: alertsApi.list,
  });

  const allAlerts = data?.alerts ?? [];

  if (isLoading) {
    return <div className="text-muted-foreground">Loading alert history...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert History</CardTitle>
        <CardDescription>
          Complete history of all alerts
        </CardDescription>
      </CardHeader>
      <CardContent>
        {allAlerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No alert history yet.
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Alert</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Triggered</TableHead>
                  <TableHead>Resolved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allAlerts.map((alert) => (
                  <TableRow key={alert.id}>
                    <TableCell className="font-medium">
                      {alert.ruleName}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={alert.severity === 'critical' ? 'destructive' : 'secondary'}
                      >
                        {alert.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{alert.status}</TableCell>
                    <TableCell className="text-sm">
                      {new Date(alert.triggeredAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-sm">
                      {alert.resolvedAt
                        ? new Date(alert.resolvedAt).toLocaleString()
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AlertRules() {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: alertsApi.rules,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<AlertRule> }) =>
      alertsApi.updateRule(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
      setEditingRule(null);
    },
  });

  const handleToggleRule = (rule: AlertRule) => {
    updateMutation.mutate({
      id: rule.id,
      data: { enabled: !rule.enabled },
    });
  };

  const rules = data?.rules ?? [];

  if (isLoading) {
    return <div className="text-muted-foreground">Loading alert rules...</div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Alert Rules</CardTitle>
          <CardDescription>
            Configure detection rules and thresholds
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Enabled</TableHead>
                  {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{rule.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {rule.description}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {rule.type}
                    </TableCell>
                    <TableCell>{rule.thresholdValue}</TableCell>
                    <TableCell>
                      <Badge
                        variant={rule.severity === 'critical' ? 'destructive' : 'secondary'}
                      >
                        {rule.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {isAdmin ? (
                        <Switch
                          checked={rule.enabled}
                          onCheckedChange={() => handleToggleRule(rule)}
                        />
                      ) : (
                        <Badge variant={rule.enabled ? 'default' : 'secondary'}>
                          {rule.enabled ? 'Active' : 'Disabled'}
                        </Badge>
                      )}
                    </TableCell>
                    {isAdmin && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingRule(rule)}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Rule Dialog */}
      <Dialog open={!!editingRule} onOpenChange={() => setEditingRule(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Alert Rule</DialogTitle>
            <DialogDescription>
              {editingRule?.name}
            </DialogDescription>
          </DialogHeader>
          {editingRule && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Threshold Value</Label>
                <Input
                  type="number"
                  value={editingRule.thresholdValue}
                  onChange={(e) =>
                    setEditingRule({
                      ...editingRule,
                      thresholdValue: parseFloat(e.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Severity</Label>
                <Select
                  value={editingRule.severity}
                  onValueChange={(v) =>
                    setEditingRule({
                      ...editingRule,
                      severity: v as 'warning' | 'critical',
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <Label>Enabled</Label>
                <Switch
                  checked={editingRule.enabled}
                  onCheckedChange={(checked) =>
                    setEditingRule({ ...editingRule, enabled: checked })
                  }
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingRule(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (editingRule) {
                  updateMutation.mutate({
                    id: editingRule.id,
                    data: {
                      thresholdValue: editingRule.thresholdValue,
                      severity: editingRule.severity,
                      enabled: editingRule.enabled,
                    },
                  });
                }
              }}
              disabled={updateMutation.isPending}
            >
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AlertsPage() {
  const tabs = [
    { to: '/alerts', label: 'Active', end: true },
    { to: '/alerts/history', label: 'History' },
    { to: '/alerts/rules', label: 'Rules' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Alerts</h1>
        <p className="text-muted-foreground">
          Monitor and manage system alerts
        </p>
      </div>

      <nav className="flex border-b">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              cn(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <Routes>
        <Route index element={<ActiveAlerts />} />
        <Route path="history" element={<AlertHistory />} />
        <Route path="rules" element={<AlertRules />} />
      </Routes>
    </div>
  );
}
