import { useState, useEffect } from 'react';
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
  Plus,
  Pencil,
  Trash2,
  Mail,
  Webhook,
  MessageSquare,
  TestTube,
  Save,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';

interface NotificationChannel {
  id: number;
  name: string;
  type: 'email' | 'webhook' | 'slack';
  config: Record<string, string>;
  enabled: boolean;
}

interface SystemSettings {
  log_retention_days: string;
  audit_retention_days: string;
  session_timeout_hours: string;
  alert_silence_default_min: string;
  log_source: string;
}

// Notification Channels Settings
function NotificationSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingChannel, setEditingChannel] = useState<NotificationChannel | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<NotificationChannel | null>(null);
  const [channelType, setChannelType] = useState<'email' | 'webhook' | 'slack'>('email');

  const { data, isLoading } = useQuery({
    queryKey: ['notification-channels'],
    queryFn: () => api.get<{ channels: NotificationChannel[] }>('/settings/notifications'),
  });

  const createMutation = useMutation({
    mutationFn: (channel: Omit<NotificationChannel, 'id'>) =>
      api.post('/settings/notifications', channel),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-channels'] });
      setShowAddDialog(false);
      toast({ title: 'Channel created', description: 'Notification channel has been created.' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: NotificationChannel) =>
      api.put(`/settings/notifications/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-channels'] });
      setEditingChannel(null);
      toast({ title: 'Channel updated', description: 'Notification channel has been updated.' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.delete(`/settings/notifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-channels'] });
      setDeleteConfirm(null);
      toast({ title: 'Channel deleted', description: 'Notification channel has been deleted.' });
    },
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => api.post(`/settings/notifications/${id}/test`),
    onSuccess: () => {
      toast({ title: 'Test sent', description: 'A test notification has been sent.' });
    },
    onError: () => {
      toast({ title: 'Test failed', description: 'Failed to send test notification.', variant: 'destructive' });
    },
  });

  const channels = data?.channels ?? [];

  const typeIcons = {
    email: Mail,
    webhook: Webhook,
    slack: MessageSquare,
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Notification Channels</CardTitle>
              <CardDescription>
                Configure where alerts are sent
              </CardDescription>
            </div>
            <Button onClick={() => setShowAddDialog(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Channel
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground">Loading channels...</div>
          ) : channels.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No notification channels configured. Add one to receive alerts.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {channels.map((channel) => {
                    const Icon = typeIcons[channel.type];
                    return (
                      <TableRow key={channel.id}>
                        <TableCell className="font-medium">
                          {channel.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="flex items-center gap-1 w-fit">
                            <Icon className="h-3 w-3" />
                            {channel.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={channel.enabled ? 'default' : 'secondary'}>
                            {channel.enabled ? 'Active' : 'Disabled'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => testMutation.mutate(channel.id)}
                              disabled={testMutation.isPending}
                            >
                              <TestTube className="h-4 w-4 mr-1" />
                              Test
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditingChannel(channel)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setDeleteConfirm(channel)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Channel Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Notification Channel</DialogTitle>
            <DialogDescription>
              Configure a new notification destination
            </DialogDescription>
          </DialogHeader>
          <ChannelForm
            type={channelType}
            onTypeChange={setChannelType}
            onSubmit={(data) => createMutation.mutate(data)}
            isSubmitting={createMutation.isPending}
            onCancel={() => setShowAddDialog(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Edit Channel Dialog */}
      <Dialog open={!!editingChannel} onOpenChange={() => setEditingChannel(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Notification Channel</DialogTitle>
            <DialogDescription>
              Update channel configuration
            </DialogDescription>
          </DialogHeader>
          {editingChannel && (
            <ChannelForm
              type={editingChannel.type}
              initialData={editingChannel}
              onTypeChange={() => {}}
              onSubmit={(data) => updateMutation.mutate({ ...data, id: editingChannel.id })}
              isSubmitting={updateMutation.isPending}
              onCancel={() => setEditingChannel(null)}
              hideTypeSelector
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Channel</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteConfirm?.name}"?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Channel Form Component
function ChannelForm({
  type,
  initialData,
  onTypeChange,
  onSubmit,
  isSubmitting,
  onCancel,
  hideTypeSelector,
}: {
  type: 'email' | 'webhook' | 'slack';
  initialData?: NotificationChannel;
  onTypeChange: (type: 'email' | 'webhook' | 'slack') => void;
  onSubmit: (data: Omit<NotificationChannel, 'id'>) => void;
  isSubmitting: boolean;
  onCancel: () => void;
  hideTypeSelector?: boolean;
}) {
  const [name, setName] = useState(initialData?.name ?? '');
  const [enabled, setEnabled] = useState(initialData?.enabled ?? true);
  const [config, setConfig] = useState<Record<string, string>>(initialData?.config ?? {});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ name, type, config, enabled });
  };

  const updateConfig = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="space-y-4 py-4">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Notification Channel"
            required
          />
        </div>

        {!hideTypeSelector && (
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => onTypeChange(v as any)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="webhook">Webhook</SelectItem>
                <SelectItem value="slack">Slack</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {type === 'email' && (
          <>
            <div className="space-y-2">
              <Label>SMTP Host</Label>
              <Input
                value={config.smtp_host ?? ''}
                onChange={(e) => updateConfig('smtp_host', e.target.value)}
                placeholder="smtp.example.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>SMTP Port</Label>
                <Input
                  value={config.smtp_port ?? '587'}
                  onChange={(e) => updateConfig('smtp_port', e.target.value)}
                  placeholder="587"
                />
              </div>
              <div className="space-y-2">
                <Label>From Address</Label>
                <Input
                  value={config.from ?? ''}
                  onChange={(e) => updateConfig('from', e.target.value)}
                  placeholder="alerts@example.com"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>To Address(es)</Label>
              <Input
                value={config.to ?? ''}
                onChange={(e) => updateConfig('to', e.target.value)}
                placeholder="admin@example.com"
              />
              <p className="text-xs text-muted-foreground">
                Separate multiple addresses with commas
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Username (optional)</Label>
                <Input
                  value={config.username ?? ''}
                  onChange={(e) => updateConfig('username', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Password (optional)</Label>
                <Input
                  type="password"
                  value={config.password ?? ''}
                  onChange={(e) => updateConfig('password', e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        {type === 'webhook' && (
          <>
            <div className="space-y-2">
              <Label>Webhook URL</Label>
              <Input
                value={config.url ?? ''}
                onChange={(e) => updateConfig('url', e.target.value)}
                placeholder="https://example.com/webhook"
              />
            </div>
            <div className="space-y-2">
              <Label>Authorization Header (optional)</Label>
              <Input
                value={config.authorization ?? ''}
                onChange={(e) => updateConfig('authorization', e.target.value)}
                placeholder="Bearer token..."
              />
            </div>
          </>
        )}

        {type === 'slack' && (
          <>
            <div className="space-y-2">
              <Label>Slack Webhook URL</Label>
              <Input
                value={config.webhook_url ?? ''}
                onChange={(e) => updateConfig('webhook_url', e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
              />
            </div>
            <div className="space-y-2">
              <Label>Channel Override (optional)</Label>
              <Input
                value={config.channel ?? ''}
                onChange={(e) => updateConfig('channel', e.target.value)}
                placeholder="#alerts"
              />
            </div>
          </>
        )}

        <div className="flex items-center justify-between">
          <Label>Enabled</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save Channel'}
        </Button>
      </DialogFooter>
    </form>
  );
}

// System Settings
function SystemSettings() {
  const { toast } = useToast();
  const [settings, setSettings] = useState<SystemSettings>({
    log_retention_days: '7',
    audit_retention_days: '90',
    session_timeout_hours: '8',
    alert_silence_default_min: '60',
    log_source: 'auto',
  });

  const { data } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => api.get<{ settings: SystemSettings }>('/settings/system'),
  });

  useEffect(() => {
    if (data?.settings) {
      setSettings(data.settings);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (settings: SystemSettings) => api.put('/settings/system', settings),
    onSuccess: () => {
      toast({ title: 'Settings saved', description: 'System settings have been updated.' });
    },
  });

  const handleSave = () => {
    saveMutation.mutate(settings);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Data Retention</CardTitle>
          <CardDescription>
            Configure how long data is kept
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Log Retention (days)</Label>
              <Input
                type="number"
                value={settings.log_retention_days}
                onChange={(e) => setSettings({ ...settings, log_retention_days: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Mail logs older than this will be purged
              </p>
            </div>
            <div className="space-y-2">
              <Label>Audit Log Retention (days)</Label>
              <Input
                type="number"
                value={settings.audit_retention_days}
                onChange={(e) => setSettings({ ...settings, audit_retention_days: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Audit entries older than this will be purged
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session Settings</CardTitle>
          <CardDescription>
            Configure user session behavior
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Session Timeout (hours)</Label>
            <Input
              type="number"
              value={settings.session_timeout_hours}
              onChange={(e) => setSettings({ ...settings, session_timeout_hours: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Users will be logged out after this period of inactivity
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alert Settings</CardTitle>
          <CardDescription>
            Configure alert behavior defaults
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Default Silence Duration (minutes)</Label>
            <Input
              type="number"
              value={settings.alert_silence_default_min}
              onChange={(e) => setSettings({ ...settings, alert_silence_default_min: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Default duration when silencing an alert
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Log Source</CardTitle>
          <CardDescription>
            Configure where mail logs are read from
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Log Source</Label>
            <Select
              value={settings.log_source}
              onValueChange={(v) => setSettings({ ...settings, log_source: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect</SelectItem>
                <SelectItem value="syslog">Syslog (/var/log/mail.log)</SelectItem>
                <SelectItem value="journald">Journald (systemd)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Where to read Postfix mail logs from
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
        </Button>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const tabs = [
    { to: '/settings', label: 'Notifications', end: true },
    { to: '/settings/system', label: 'System' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure application settings
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
        <Route index element={<NotificationSettings />} />
        <Route path="system" element={<SystemSettings />} />
      </Routes>
    </div>
  );
}
