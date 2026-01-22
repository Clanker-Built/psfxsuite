import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Globe, Plus, MoreHorizontal, Edit, Trash2, Mail, Power, PowerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { adminApi, MailDomain, CreateDomainRequest } from '@/lib/api';

interface DomainFormData {
  domain: string;
  description: string;
  maxMailboxes: number;
  maxAliases: number;
  quotaBytes: number;
}

const defaultFormData: DomainFormData = {
  domain: '',
  description: '',
  maxMailboxes: 0,
  maxAliases: 0,
  quotaBytes: 0,
};

export default function DomainsPage() {
  const navigate = useNavigate();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<MailDomain | null>(null);
  const [formData, setFormData] = useState<DomainFormData>(defaultFormData);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch domains from API
  const { data: domains = [], isLoading, error } = useQuery<MailDomain[]>({
    queryKey: ['admin', 'domains'],
    queryFn: () => adminApi.listDomains(),
  });

  // Create domain mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateDomainRequest) => adminApi.createDomain(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
      setIsCreateOpen(false);
      setFormData(defaultFormData);
      toast({ title: 'Domain created', description: `${result.domain} has been created successfully` });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to create domain', description: error.message, variant: 'destructive' });
    },
  });

  // Update domain mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateDomainRequest> }) =>
      adminApi.updateDomain(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
      setIsEditOpen(false);
      setSelectedDomain(null);
      setFormData(defaultFormData);
      toast({ title: 'Domain updated', description: 'Domain settings have been saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update domain', description: error.message, variant: 'destructive' });
    },
  });

  // Delete domain mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminApi.deleteDomain(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
      setIsDeleteOpen(false);
      setSelectedDomain(null);
      toast({ title: 'Domain deleted', description: 'Domain has been removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete domain', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle active status mutation
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      adminApi.updateDomain(id, { active } as unknown as Partial<CreateDomainRequest>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update domain', description: error.message, variant: 'destructive' });
    },
  });

  const handleCreate = () => {
    if (!formData.domain) {
      toast({ title: 'Domain name is required', variant: 'destructive' });
      return;
    }
    createMutation.mutate({
      domain: formData.domain,
      description: formData.description || undefined,
      maxMailboxes: formData.maxMailboxes || undefined,
      maxAliases: formData.maxAliases || undefined,
      quotaBytes: formData.quotaBytes || undefined,
    });
  };

  const handleEdit = (domain: MailDomain) => {
    setSelectedDomain(domain);
    setFormData({
      domain: domain.domain,
      description: domain.description || '',
      maxMailboxes: domain.maxMailboxes,
      maxAliases: domain.maxAliases,
      quotaBytes: domain.quotaBytes,
    });
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedDomain) return;
    updateMutation.mutate({
      id: selectedDomain.id,
      data: {
        description: formData.description || undefined,
        maxMailboxes: formData.maxMailboxes || undefined,
        maxAliases: formData.maxAliases || undefined,
        quotaBytes: formData.quotaBytes || undefined,
      },
    });
  };

  const handleDelete = (domain: MailDomain) => {
    setSelectedDomain(domain);
    setIsDeleteOpen(true);
  };

  const confirmDelete = () => {
    if (!selectedDomain) return;
    deleteMutation.mutate(selectedDomain.id);
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return 'Unlimited';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Domains</h1>
          <p className="text-muted-foreground">Manage mail domains for your server</p>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-destructive">
              <p>Failed to load domains: {error.message}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] })}
              >
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Domains</h1>
          <p className="text-muted-foreground">
            Manage mail domains for your server
          </p>
        </div>
        <Button onClick={() => { setFormData(defaultFormData); setIsCreateOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" />
          Add Domain
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Mail Domains</CardTitle>
          <CardDescription>
            Domains configured to receive and send email
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : domains.length === 0 ? (
            <div className="text-center py-8">
              <Globe className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium">No domains configured</h3>
              <p className="text-muted-foreground mb-4">
                Add your first domain to start managing mailboxes
              </p>
              <Button onClick={() => { setFormData(defaultFormData); setIsCreateOpen(true); }}>
                <Plus className="mr-2 h-4 w-4" />
                Add Domain
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Mailboxes</TableHead>
                  <TableHead>Aliases</TableHead>
                  <TableHead>Quota</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[70px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains.map((domain) => (
                  <TableRow key={domain.id}>
                    <TableCell className="font-medium">{domain.domain}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {domain.description || '-'}
                    </TableCell>
                    <TableCell>
                      {domain.mailboxCount}
                      {domain.maxMailboxes > 0 && ` / ${domain.maxMailboxes}`}
                    </TableCell>
                    <TableCell>
                      {domain.aliasCount}
                      {domain.maxAliases > 0 && ` / ${domain.maxAliases}`}
                    </TableCell>
                    <TableCell>{formatBytes(domain.quotaBytes)}</TableCell>
                    <TableCell>
                      <Badge variant={domain.active ? 'default' : 'secondary'}>
                        {domain.active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/admin/mailboxes?domain=${domain.id}`)}>
                            <Mail className="mr-2 h-4 w-4" />
                            View Mailboxes
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleEdit(domain)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => toggleActiveMutation.mutate({ id: domain.id, active: !domain.active })}
                          >
                            {domain.active ? (
                              <>
                                <PowerOff className="mr-2 h-4 w-4" />
                                Disable
                              </>
                            ) : (
                              <>
                                <Power className="mr-2 h-4 w-4" />
                                Enable
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDelete(domain)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Domain Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Domain</DialogTitle>
            <DialogDescription>
              Add a new mail domain to your server
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="domain">Domain Name</Label>
              <Input
                id="domain"
                placeholder="example.com"
                value={formData.domain}
                onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                placeholder="Company email domain"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="maxMailboxes">Max Mailboxes (0 = unlimited)</Label>
                <Input
                  id="maxMailboxes"
                  type="number"
                  min="0"
                  value={formData.maxMailboxes}
                  onChange={(e) => setFormData({ ...formData, maxMailboxes: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="maxAliases">Max Aliases (0 = unlimited)</Label>
                <Input
                  id="maxAliases"
                  type="number"
                  min="0"
                  value={formData.maxAliases}
                  onChange={(e) => setFormData({ ...formData, maxAliases: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quota">Default Mailbox Quota (bytes, 0 = unlimited)</Label>
              <Input
                id="quota"
                type="number"
                min="0"
                value={formData.quotaBytes}
                onChange={(e) => setFormData({ ...formData, quotaBytes: parseInt(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">
                e.g., 1073741824 = 1 GB, 5368709120 = 5 GB
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Domain'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Domain Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Domain</DialogTitle>
            <DialogDescription>
              Update settings for {selectedDomain?.domain}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Input
                id="edit-description"
                placeholder="Company email domain"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-maxMailboxes">Max Mailboxes (0 = unlimited)</Label>
                <Input
                  id="edit-maxMailboxes"
                  type="number"
                  min="0"
                  value={formData.maxMailboxes}
                  onChange={(e) => setFormData({ ...formData, maxMailboxes: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-maxAliases">Max Aliases (0 = unlimited)</Label>
                <Input
                  id="edit-maxAliases"
                  type="number"
                  min="0"
                  value={formData.maxAliases}
                  onChange={(e) => setFormData({ ...formData, maxAliases: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-quota">Default Mailbox Quota (bytes)</Label>
              <Input
                id="edit-quota"
                type="number"
                min="0"
                value={formData.quotaBytes}
                onChange={(e) => setFormData({ ...formData, quotaBytes: parseInt(e.target.value) || 0 })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Domain</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selectedDomain?.domain}</strong>?
              {selectedDomain && (selectedDomain.mailboxCount > 0 || selectedDomain.aliasCount > 0) && (
                <span className="block mt-2 text-destructive">
                  This domain has {selectedDomain.mailboxCount} mailbox(es) and {selectedDomain.aliasCount} alias(es)
                  that will also be deleted.
                </span>
              )}
              <span className="block mt-2">This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
