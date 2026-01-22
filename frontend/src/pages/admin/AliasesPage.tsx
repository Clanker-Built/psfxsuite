import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Forward, Plus, Search, MoreHorizontal, Trash2 } from 'lucide-react';
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
import { useToast } from '@/hooks/use-toast';
import { adminApi, MailAlias, MailDomain, CreateAliasRequest } from '@/lib/api';

interface AliasFormData {
  localPart: string;
  domainId: number;
  destinationEmail: string;
}

const defaultFormData: AliasFormData = {
  localPart: '',
  domainId: 0,
  destinationEmail: '',
};

export default function AliasesPage() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedAlias, setSelectedAlias] = useState<MailAlias | null>(null);
  const [formData, setFormData] = useState<AliasFormData>(defaultFormData);
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

  // Fetch aliases
  const domainIdParam = domainFilter !== 'all' ? parseInt(domainFilter) : undefined;
  const { data: aliases = [], isLoading, error } = useQuery<MailAlias[]>({
    queryKey: ['admin', 'aliases', domainIdParam],
    queryFn: () => adminApi.listAliases(domainIdParam),
  });

  // Create alias mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateAliasRequest) => adminApi.createAlias(data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'aliases'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
      setIsCreateOpen(false);
      setFormData(defaultFormData);
      toast({ title: 'Alias created', description: `${result.source} has been created` });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to create alias', description: error.message, variant: 'destructive' });
    },
  });

  // Delete alias mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminApi.deleteAlias(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'aliases'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'domains'] });
      setIsDeleteOpen(false);
      setSelectedAlias(null);
      toast({ title: 'Alias deleted', description: 'Alias has been removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete alias', description: error.message, variant: 'destructive' });
    },
  });

  const filteredAliases = aliases.filter(
    (alias) =>
      searchQuery === '' ||
      alias.sourceEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      alias.destinationEmail.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCreate = () => {
    if (!formData.localPart) {
      toast({ title: 'Source address is required', variant: 'destructive' });
      return;
    }
    if (!formData.domainId) {
      toast({ title: 'Domain is required', variant: 'destructive' });
      return;
    }
    if (!formData.destinationEmail) {
      toast({ title: 'Destination email is required', variant: 'destructive' });
      return;
    }
    createMutation.mutate({
      localPart: formData.localPart,
      domainId: formData.domainId,
      destinationEmail: formData.destinationEmail,
    });
  };

  const handleDelete = (alias: MailAlias) => {
    setSelectedAlias(alias);
    setIsDeleteOpen(true);
  };

  const confirmDelete = () => {
    if (!selectedAlias) return;
    deleteMutation.mutate(selectedAlias.id);
  };

  const openCreateDialog = () => {
    setFormData({
      ...defaultFormData,
      domainId: domainFilter !== 'all' ? parseInt(domainFilter) : 0,
    });
    setIsCreateOpen(true);
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Aliases</h1>
          <p className="text-muted-foreground">Manage email forwarding rules</p>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-destructive">
              <p>Failed to load aliases: {error.message}</p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => queryClient.invalidateQueries({ queryKey: ['admin', 'aliases'] })}
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
          <h1 className="text-3xl font-bold tracking-tight">Aliases</h1>
          <p className="text-muted-foreground">
            Manage email forwarding rules
          </p>
        </div>
        <Button onClick={openCreateDialog} disabled={domains.length === 0}>
          <Plus className="mr-2 h-4 w-4" />
          Create Alias
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Email Aliases</CardTitle>
              <CardDescription>
                {filteredAliases.length} alias{filteredAliases.length !== 1 ? 'es' : ''}
                {domainFilter !== 'all' && ` in ${domains.find(d => d.id.toString() === domainFilter)?.domain || 'selected domain'}`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search aliases..."
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
          ) : filteredAliases.length === 0 ? (
            <div className="text-center py-8">
              <Forward className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium">No aliases found</h3>
              <p className="text-muted-foreground mb-4">
                {aliases.length === 0
                  ? domains.length === 0
                    ? 'Create a domain first, then add aliases'
                    : 'Create your first alias to set up email forwarding'
                  : 'No aliases match your search criteria'}
              </p>
              {aliases.length === 0 && domains.length > 0 && (
                <Button onClick={openCreateDialog}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Alias
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead></TableHead>
                  <TableHead>Destination</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[70px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAliases.map((alias) => (
                  <TableRow key={alias.id}>
                    <TableCell className="font-medium">{alias.sourceEmail}</TableCell>
                    <TableCell>
                      <Forward className="h-4 w-4 text-muted-foreground" />
                    </TableCell>
                    <TableCell>{alias.destinationEmail}</TableCell>
                    <TableCell className="text-muted-foreground">{alias.domain}</TableCell>
                    <TableCell>
                      <Badge variant={alias.active ? 'default' : 'secondary'}>
                        {alias.active ? 'Active' : 'Inactive'}
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
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDelete(alias)}
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

      {/* Create Alias Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Alias</DialogTitle>
            <DialogDescription>
              Set up email forwarding from one address to another
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
              <Label htmlFor="source">Source Address</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="source"
                  placeholder="sales"
                  value={formData.localPart}
                  onChange={(e) => setFormData({ ...formData, localPart: e.target.value })}
                />
                {formData.domainId > 0 && (
                  <span className="text-muted-foreground">
                    @{domains.find(d => d.id === formData.domainId)?.domain}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                The local part of the email (before @domain)
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="destination">Forward To</Label>
              <Input
                id="destination"
                placeholder="user@example.com"
                type="email"
                value={formData.destinationEmail}
                onChange={(e) => setFormData({ ...formData, destinationEmail: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Can be an internal mailbox or external email address
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending || domains.length === 0}>
              {createMutation.isPending ? 'Creating...' : 'Create Alias'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Alias</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the alias from{' '}
              <strong>{selectedAlias?.sourceEmail}</strong> to{' '}
              <strong>{selectedAlias?.destinationEmail}</strong>?
              <span className="block mt-2">
                Emails sent to this address will no longer be forwarded.
              </span>
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
