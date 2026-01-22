import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Pencil,
  Trash2,
  Map,
  Send,
  RefreshCw,
} from 'lucide-react';
import { transportApi, senderRelayApi, TransportMap, SenderRelay } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';

type TransportFormData = {
  domain: string;
  nextHop: string;
  port: number;
};

type SenderRelayFormData = {
  sender: string;
  relayhost: string;
};

export function TransportMapsPage() {
  const queryClient = useQueryClient();
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');

  const [activeTab, setActiveTab] = useState('transport');
  const [showTransportDialog, setShowTransportDialog] = useState(false);
  const [showSenderDialog, setShowSenderDialog] = useState(false);
  const [editingTransport, setEditingTransport] = useState<TransportMap | null>(null);
  const [editingSender, setEditingSender] = useState<SenderRelay | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: 'transport' | 'sender'; id: string } | null>(null);

  // Transport maps queries
  const { data: transportData, isLoading: transportLoading, refetch: refetchTransport } = useQuery({
    queryKey: ['transport-maps'],
    queryFn: transportApi.list,
  });

  const { data: senderData, isLoading: senderLoading, refetch: refetchSender } = useQuery({
    queryKey: ['sender-relays'],
    queryFn: senderRelayApi.list,
  });

  // Transport form
  const transportForm = useForm<TransportFormData>({
    defaultValues: {
      domain: '',
      nextHop: '',
      port: 25,
    },
  });

  // Sender form
  const senderForm = useForm<SenderRelayFormData>({
    defaultValues: {
      sender: '',
      relayhost: '',
    },
  });

  // Mutations
  const createTransportMutation = useMutation({
    mutationFn: transportApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-maps'] });
      setShowTransportDialog(false);
      transportForm.reset();
    },
  });

  const updateTransportMutation = useMutation({
    mutationFn: ({ domain, data }: { domain: string; data: Partial<TransportMap> }) =>
      transportApi.update(domain, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-maps'] });
      setShowTransportDialog(false);
      setEditingTransport(null);
      transportForm.reset();
    },
  });

  const deleteTransportMutation = useMutation({
    mutationFn: transportApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transport-maps'] });
      setDeleteConfirm(null);
    },
  });

  const createSenderMutation = useMutation({
    mutationFn: senderRelayApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sender-relays'] });
      setShowSenderDialog(false);
      senderForm.reset();
    },
  });

  const updateSenderMutation = useMutation({
    mutationFn: ({ sender, data }: { sender: string; data: Partial<SenderRelay> }) =>
      senderRelayApi.update(sender, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sender-relays'] });
      setShowSenderDialog(false);
      setEditingSender(null);
      senderForm.reset();
    },
  });

  const deleteSenderMutation = useMutation({
    mutationFn: senderRelayApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sender-relays'] });
      setDeleteConfirm(null);
    },
  });

  // Handlers
  const handleEditTransport = (tm: TransportMap) => {
    setEditingTransport(tm);
    transportForm.reset({
      domain: tm.domain,
      nextHop: tm.nextHop,
      port: tm.port,
    });
    setShowTransportDialog(true);
  };

  const handleEditSender = (sr: SenderRelay) => {
    setEditingSender(sr);
    senderForm.reset({
      sender: sr.sender,
      relayhost: sr.relayhost,
    });
    setShowSenderDialog(true);
  };

  const onTransportSubmit = (data: TransportFormData) => {
    if (editingTransport) {
      updateTransportMutation.mutate({
        domain: editingTransport.domain,
        data: { ...data, enabled: editingTransport.enabled },
      });
    } else {
      createTransportMutation.mutate(data);
    }
  };

  const onSenderSubmit = (data: SenderRelayFormData) => {
    if (editingSender) {
      updateSenderMutation.mutate({
        sender: editingSender.sender,
        data: { ...data, enabled: editingSender.enabled },
      });
    } else {
      createSenderMutation.mutate(data);
    }
  };

  const handleToggleTransport = (tm: TransportMap) => {
    updateTransportMutation.mutate({
      domain: tm.domain,
      data: { ...tm, enabled: !tm.enabled },
    });
  };

  const handleToggleSender = (sr: SenderRelay) => {
    updateSenderMutation.mutate({
      sender: sr.sender,
      data: { ...sr, enabled: !sr.enabled },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Routing Maps</h1>
          <p className="text-muted-foreground">
            Configure domain-based and sender-based email routing
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            refetchTransport();
            refetchSender();
          }}
        >
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="transport" className="flex items-center gap-2">
            <Map className="h-4 w-4" />
            Transport Maps
          </TabsTrigger>
          <TabsTrigger value="sender" className="flex items-center gap-2">
            <Send className="h-4 w-4" />
            Sender Relays
          </TabsTrigger>
        </TabsList>

        <TabsContent value="transport" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Transport Maps</CardTitle>
                  <CardDescription>
                    Route mail for specific domains to different relay servers
                  </CardDescription>
                </div>
                {isAdmin && (
                  <Button onClick={() => {
                    setEditingTransport(null);
                    transportForm.reset({ domain: '', nextHop: '', port: 25 });
                    setShowTransportDialog(true);
                  }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Transport Map
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {transportLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading transport maps...
                </div>
              ) : !transportData?.transportMaps?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  No transport maps configured. All mail will use the default relay.
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>Relay Server</TableHead>
                        <TableHead>Port</TableHead>
                        <TableHead>Status</TableHead>
                        {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {transportData.transportMaps.map((tm) => (
                        <TableRow key={tm.domain}>
                          <TableCell className="font-mono">{tm.domain}</TableCell>
                          <TableCell className="font-mono">{tm.nextHop}</TableCell>
                          <TableCell>{tm.port}</TableCell>
                          <TableCell>
                            {isAdmin ? (
                              <Switch
                                checked={tm.enabled}
                                onCheckedChange={() => handleToggleTransport(tm)}
                              />
                            ) : (
                              <Badge variant={tm.enabled ? 'default' : 'secondary'}>
                                {tm.enabled ? 'Active' : 'Disabled'}
                              </Badge>
                            )}
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditTransport(tm)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setDeleteConfirm({ type: 'transport', id: tm.domain })}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sender" className="mt-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Sender-Dependent Relays</CardTitle>
                  <CardDescription>
                    Route outbound mail based on sender address to different relay servers
                  </CardDescription>
                </div>
                {isAdmin && (
                  <Button onClick={() => {
                    setEditingSender(null);
                    senderForm.reset({ sender: '', relayhost: '' });
                    setShowSenderDialog(true);
                  }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Sender Relay
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {senderLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading sender relays...
                </div>
              ) : !senderData?.senderRelays?.length ? (
                <div className="text-center py-8 text-muted-foreground">
                  No sender-dependent relays configured. All outbound mail will use the default relay.
                </div>
              ) : (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sender</TableHead>
                        <TableHead>Relay Host</TableHead>
                        <TableHead>Status</TableHead>
                        {isAdmin && <TableHead className="text-right">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {senderData.senderRelays.map((sr) => (
                        <TableRow key={sr.sender}>
                          <TableCell className="font-mono">{sr.sender}</TableCell>
                          <TableCell className="font-mono">{sr.relayhost}</TableCell>
                          <TableCell>
                            {isAdmin ? (
                              <Switch
                                checked={sr.enabled}
                                onCheckedChange={() => handleToggleSender(sr)}
                              />
                            ) : (
                              <Badge variant={sr.enabled ? 'default' : 'secondary'}>
                                {sr.enabled ? 'Active' : 'Disabled'}
                              </Badge>
                            )}
                          </TableCell>
                          {isAdmin && (
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditSender(sr)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setDeleteConfirm({ type: 'sender', id: sr.sender })}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Transport Map Dialog */}
      <Dialog open={showTransportDialog} onOpenChange={setShowTransportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTransport ? 'Edit Transport Map' : 'Add Transport Map'}
            </DialogTitle>
            <DialogDescription>
              Route mail for a specific domain to a different relay server.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={transportForm.handleSubmit(onTransportSubmit)}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  placeholder="example.com"
                  {...transportForm.register('domain', { required: true })}
                  disabled={!!editingTransport}
                />
                <p className="text-xs text-muted-foreground">
                  The domain to route (e.g., example.com or .example.com for subdomains)
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nextHop">Relay Server</Label>
                <Input
                  id="nextHop"
                  placeholder="smtp.relay.example.com"
                  {...transportForm.register('nextHop', { required: true })}
                />
                <p className="text-xs text-muted-foreground">
                  The SMTP server to relay mail for this domain
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="port">Port</Label>
                <Input
                  id="port"
                  type="number"
                  placeholder="25"
                  {...transportForm.register('port', { valueAsNumber: true })}
                />
                <p className="text-xs text-muted-foreground">
                  SMTP port (25, 465, or 587)
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowTransportDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createTransportMutation.isPending || updateTransportMutation.isPending}
              >
                {editingTransport ? 'Save Changes' : 'Add Transport Map'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Sender Relay Dialog */}
      <Dialog open={showSenderDialog} onOpenChange={setShowSenderDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingSender ? 'Edit Sender Relay' : 'Add Sender Relay'}
            </DialogTitle>
            <DialogDescription>
              Route outbound mail based on sender address.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={senderForm.handleSubmit(onSenderSubmit)}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="sender">Sender</Label>
                <Input
                  id="sender"
                  placeholder="user@example.com or @example.com"
                  {...senderForm.register('sender', { required: true })}
                  disabled={!!editingSender}
                />
                <p className="text-xs text-muted-foreground">
                  Email address or @domain for all users in a domain
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="relayhost">Relay Host</Label>
                <Input
                  id="relayhost"
                  placeholder="[smtp.relay.example.com]:587"
                  {...senderForm.register('relayhost', { required: true })}
                />
                <p className="text-xs text-muted-foreground">
                  Format: [hostname]:port (brackets are optional)
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowSenderDialog(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createSenderMutation.isPending || updateSenderMutation.isPending}
              >
                {editingSender ? 'Save Changes' : 'Add Sender Relay'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this {deleteConfirm?.type === 'transport' ? 'transport map' : 'sender relay'}?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteConfirm?.type === 'transport') {
                  deleteTransportMutation.mutate(deleteConfirm.id);
                } else if (deleteConfirm?.type === 'sender') {
                  deleteSenderMutation.mutate(deleteConfirm.id);
                }
              }}
              disabled={deleteTransportMutation.isPending || deleteSenderMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
