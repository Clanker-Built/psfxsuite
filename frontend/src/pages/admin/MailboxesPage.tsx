import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Mail, Plus, Search, MoreHorizontal, Edit, Trash2, Key, Power, PowerOff, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { adminApi, Mailbox, MailDomain, CreateMailboxRequest } from '@/lib/api';

function formatBytes(bytes: number): string {
  if (bytes === 0) return 'Unlimited';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

interface MailboxFormData {
  localPart: string;
  domainId: number;
  password: string;
  displayName: string;
  quotaBytes: number;
}

const defaultFormData: MailboxFormData = {
  localPart: '',
  domainId: 0,
  password: '',
  displayName: '',
  quotaBytes: 0,
};

export default function MailboxesPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [selectedMailbox, setSelectedMailbox] = useState<Mailbox | null>(null);
  const [formData, setFormData] = useState<MailboxFormData>(defaultFormData);
  const [searchQuery, setSearchQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('all');

  // Set domain filter from URL params
  useEffect(() => {
    const domainParam = searchParams.get('domain');
    if (domainParam) {
      setDomainFilter(domainParam);
    }
  }, [searchParams]);

  // Fetch domains
  const { data: domains = [] } = useQuery<MailDomain[]>({
    queryKey: ['admin', 'domains'],
    queryFn: () => adminApi.listDomains(),
  });

  // Fetch mailboxes
  const domainIdParam = domainFilter !== 'all' ? parseInt(domainFilter) : undefined;
  const { data: mailboxes = [], isLoading, error } = useQuery<Mailbox[]>({
    queryKey: ['admin', 'mailboxes', domainIdParam],
    queryFn: () => adminApi.listMailboxes(domainIdParam),
  });

  // Create mailbox mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateMailboxRequest) => adminApi.createMailbox(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
      setIsCreateOpen(false);
      setFormData(defaultFormData);
      toast({ title: 'Mailbox created', description: `${result.email} has been created` });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to create mailbox', description: error.message, variant: 'destructive' });
    },
  });

  // Update mailbox mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { displayName?: string; quotaBytes?: number; active?: boolean } }) =>
      adminApi.updateMailbox(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });
      setIsEditOpen(false);
      setSelectedMailbox(null);
      toast({ title: 'Mailbox updated', description: 'Mailbox settings have been saved' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update mailbox', description: error.message, variant: 'destructive' });
    },
  });

  // Delete mailbox mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminApi.deleteMailbox(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
      setIsDeleteOpen(false);
      setSelectedMailbox(null);
      toast({ title: 'Mailbox deleted', description: 'Mailbox has been removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete mailbox', description: error.message, variant: 'destructive' });
    },
  });

  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      adminApi.resetMailboxPassword(id, password),
    onSuccess: () => {
      setIsPasswordOpen(false);
      setSelectedMailbox(null);
      setNewPassword('');
      toast({ title: 'Password reset', description: 'Mailbox password has been changed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to reset password', description: error.message, variant: 'destructive' });
    },
  });

  // Toggle active status mutation
  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      adminApi.updateMailbox(id, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update mailbox', description: error.message, variant: 'destructive' });
    },
  });

  const filteredMailboxes = mailboxes.filter((mailbox) => {
    const matchesSearch =
      searchQuery === '' ||
      mailbox.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (mailbox.displayName || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSearch;
  });

  const handleCreate = () => {
    if (!formData.localPart) {
      toast({ title: 'Username is required', variant: 'destructive' });
      return;
    }
    if (!formData.domainId) {
      toast({ title: 'Domain is required', variant: 'destructive' });
      return;
    }
    if (!formData.password) {
      toast({ title: 'Password is required', variant: 'destructive' });
      return;
    }
    createMutation.mutate({
      localPart: formData.localPart,
      domainId: formData.domainId,
      password: formData.password,
      displayName: formData.displayName || undefined,
      quotaBytes: formData.quotaBytes || undefined,
    });
  };

  const handleEdit = (mailbox: Mailbox) => {
    setSelectedMailbox(mailbox);
    setFormData({
      localPart: mailbox.localPart,
      domainId: mailbox.domainId,
      password: '',
      displayName: mailbox.displayName || '',
      quotaBytes: mailbox.quotaBytes,
    });
    setIsEditOpen(true);
  };

  const handleUpdate = () => {
    if (!selectedMailbox) return;
    updateMutation.mutate({
      id: selectedMailbox.id,
      data: {
        displayName: formData.displayName || undefined,
        quotaBytes: formData.quotaBytes || undefined,
      },
    });
  };

  const handleDelete = (mailbox: Mailbox) => {
    setSelectedMailbox(mailbox);
    setIsDeleteOpen(true);
  };

  const confirmDelete = () => {
    if (!selectedMailbox) return;
    deleteMutation.mutate(selectedMailbox.id);
  };

  const handleResetPassword = (mailbox: Mailbox) => {
    setSelectedMailbox(mailbox);
    setNewPassword('');
    setShowPassword(false);
    setIsPasswordOpen(true);
  };

  const confirmResetPassword = () => {
    if (!selectedMailbox || !newPassword) {
      toast({ title: 'Password is required', variant: 'destructive' });
      return;
    }
    resetPasswordMutation.mutate({ id: selectedMailbox.id, password: newPassword });
  };

  const openCreateDialog = () => {
    setFormData({
      ...defaultFormData,
      domainId: domainFilter !== 'all' ? parseInt(domainFilter) : 0,
    });
    setShowPassword(false);
    setIsCreateOpen(true);
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Mailboxes</h1>
          <p className="text-muted-foreground">Manage user mailboxes and storage quotas</p>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-destructive">
              <p>Failed to load mailboxes: {error.message}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['admin', 'mailboxes'] })}
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
          <h1 className="text-3xl font-bold tracking-tight">Mailboxes</h1>
          <p className="text-muted-foreground">
            Manage user mailboxes and storage quotas
          </p>
        </div>
        <Button onClick={openCreateDialog} disabled={domains.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Create Mailbox
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>User Mailboxes</CardTitle>
              <CardDescription>
                {filteredMailboxes.length} mailbox{filteredMailboxes.length !== 1 ? 'es' : ''}
                {domainFilter !== 'all' && ` in ${domains.find(d => d.id.toString() === domainFilter)?.domain || 'selected domain'}`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search mailboxes..."
                  className="pl-8 w-[250px]"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={domainFilter} onValueChange={setDomainFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All domains" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All domains</SelectItem>
                  {domains.map((domain) => (
                    <SelectItem key={domain.id} value={domain.id.toString()}>
                      {domain.domain}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : filteredMailboxes.length === 0 ? (
            <div className="text-center py-8">
              <Mail className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium">No mailboxes found</h3>
              <p className="text-muted-foreground mb-4">
                {mailboxes.length === 0
                  ? domains.length === 0
                    ? 'Create a domain first, then add mailboxes'
                    : 'Create your first mailbox to get started'
                  : 'No mailboxes match your search criteria'}
              </p>
              {mailboxes.length === 0 && domains.length > 0 && (
                <Button onClick={openCreateDialog}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Mailbox
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Quota</TableHead>
                  <TableHead>Last Login</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[70px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMailboxes.map((mailbox) => (
                  <TableRow key={mailbox.id}>
                    <TableCell className="font-medium">{mailbox.email}</TableCell>
                    <TableCell>{mailbox.displayName || '-'}</TableCell>
                    <TableCell>
                      <div className="w-32">
                        {mailbox.quotaBytes > 0 ? (
                          <>
                            <div className="flex justify-between text-xs mb-1">
                              <span>{formatBytes(mailbox.usedBytes)}</span>
                              <span className="text-muted-foreground">
                                {formatBytes(mailbox.quotaBytes)}
                              </span>
                            </div>
                            <Progress
                              value={(mailbox.usedBytes / mailbox.quotaBytes) * 100}
                              className="h-1"
                            />
                          </>
                        ) : (
                          <span className="text-muted-foreground text-sm">Unlimited</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelativeTime(mailbox.lastLogin)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={mailbox.active ? 'default' : 'secondary'}>
                        {mailbox.active ? 'Active' : 'Inactive'}
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
                          <DropdownMenuItem onClick={() => handleEdit(mailbox)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleResetPassword(mailbox)}>
                            <Key className="mr-2 h-4 w-4" />
                            Reset Password
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => toggleActiveMutation.mutate({ id: mailbox.id, active: !mailbox.active })}
                          >
                            {mailbox.active ? (
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
                            onClick={() => handleDelete(mailbox)}
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

      {/* Create Mailbox Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Mailbox</DialogTitle>
            <DialogDescription>
              Add a new user mailbox
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Domain</Label>
              <Select
                value={formData.domainId ? formData.domainId.toString() : ''}
                onValueChange={(v) => setFormData({ ...formData, domainId: parseInt(v) })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select domain" />
                </SelectTrigger>
                <SelectContent>
                  {domains.length === 0 ? (
                    <SelectItem value="" disabled>
                      No domains available
                    </SelectItem>
                  ) : (
                    domains.map((domain) => (
                      <SelectItem key={domain.id} value={domain.id.toString()}>
                        {domain.domain}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="username"
                  placeholder="john.doe"
                  value={formData.localPart}
                  onChange={(e) => setFormData({ ...formData, localPart: e.target.value })}
                />
                {formData.domainId > 0 && (
                  <span className="text-muted-foreground">
                    @{domains.find(d => d.id === formData.domainId)?.domain}
                  </span>
                )}
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                placeholder="John Doe"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="quota">Quota (bytes, 0 = unlimited)</Label>
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
            <Button onClick={handleCreate} disabled={createMutation.isPending || domains.length === 0}>
              {createMutation.isPending ? 'Creating...' : 'Create Mailbox'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Mailbox Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Mailbox</DialogTitle>
            <DialogDescription>
              Update settings for {selectedMailbox?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-displayName">Display Name</Label>
              <Input
                id="edit-displayName"
                placeholder="John Doe"
                value={formData.displayName}
                onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-quota">Quota (bytes, 0 = unlimited)</Label>
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

      {/* Reset Password Dialog */}
      <Dialog open={isPasswordOpen} onOpenChange={setIsPasswordOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>
              Set a new password for {selectedMailbox?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="newPassword">New Password</Label>
              <div className="relative">
                <Input
                  id="newPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPasswordOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmResetPassword} disabled={resetPasswordMutation.isPending}>
              {resetPasswordMutation.isPending ? 'Resetting...' : 'Reset Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Mailbox</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{selectedMailbox?.email}</strong>?
              <span className="block mt-2 text-destructive">
                All emails in this mailbox will be permanently deleted.
              </span>
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
