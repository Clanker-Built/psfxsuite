import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  Plus,
  Pencil,
  Trash2,
  Check,
  FileSignature,
  Bell,
  Palette,
  Keyboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RichTextEditor } from '@/components/mail/RichTextEditor';
import { mailApi, MailSignature } from '@/lib/api';

export default function MailSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedSignature, setSelectedSignature] = useState<MailSignature | null>(null);
  const [signatureForm, setSignatureForm] = useState({
    name: '',
    contentHtml: '',
    contentText: '',
  });

  // Settings state
  const [settings, setSettings] = useState({
    notifications: {
      desktop: true,
      sound: false,
      newMail: true,
    },
    display: {
      darkMode: false,
      compactView: false,
      showPreview: true,
    },
    compose: {
      defaultSignature: null as number | null,
      sendOnCtrlEnter: true,
      saveAsDraft: true,
    },
  });

  // Load signatures
  const { data: signatures = [], isLoading: signaturesLoading } = useQuery({
    queryKey: ['mail', 'signatures'],
    queryFn: mailApi.listSignatures,
  });

  // Create signature mutation
  const createMutation = useMutation({
    mutationFn: mailApi.createSignature,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail', 'signatures'] });
      toast({ title: 'Signature created', description: `"${signatureForm.name}" has been created` });
      setSignatureDialogOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to create signature', description: error.message, variant: 'destructive' });
    },
  });

  // Update signature mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: typeof signatureForm }) =>
      mailApi.updateSignature(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail', 'signatures'] });
      toast({ title: 'Signature updated', description: `"${signatureForm.name}" has been updated` });
      setSignatureDialogOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update signature', description: error.message, variant: 'destructive' });
    },
  });

  // Delete signature mutation
  const deleteMutation = useMutation({
    mutationFn: mailApi.deleteSignature,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail', 'signatures'] });
      toast({ title: 'Signature deleted', description: 'Signature has been removed' });
      setDeleteDialogOpen(false);
      setSelectedSignature(null);
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to delete signature', description: error.message, variant: 'destructive' });
    },
  });

  // Set default signature mutation
  const setDefaultMutation = useMutation({
    mutationFn: mailApi.setDefaultSignature,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mail', 'signatures'] });
      toast({ title: 'Default signature updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to set default', description: error.message, variant: 'destructive' });
    },
  });

  const resetForm = () => {
    setSignatureForm({ name: '', contentHtml: '', contentText: '' });
    setSelectedSignature(null);
  };

  const openCreateSignatureDialog = () => {
    resetForm();
    setSignatureDialogOpen(true);
  };

  const openEditSignatureDialog = (signature: MailSignature) => {
    setSelectedSignature(signature);
    setSignatureForm({
      name: signature.name,
      contentHtml: signature.contentHtml,
      contentText: signature.contentText,
    });
    setSignatureDialogOpen(true);
  };

  const openDeleteDialog = (signature: MailSignature) => {
    setSelectedSignature(signature);
    setDeleteDialogOpen(true);
  };

  const handleSaveSignature = () => {
    if (!signatureForm.name.trim()) {
      toast({ title: 'Name required', description: 'Please enter a signature name', variant: 'destructive' });
      return;
    }

    if (selectedSignature) {
      updateMutation.mutate({ id: selectedSignature.id, data: signatureForm });
    } else {
      createMutation.mutate(signatureForm);
    }
  };

  const handleDeleteSignature = () => {
    if (selectedSignature) {
      deleteMutation.mutate(selectedSignature.id);
    }
  };

  const handleSetDefaultSignature = (signature: MailSignature) => {
    setDefaultMutation.mutate(signature.id);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b p-4 bg-background">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          <h1 className="text-xl font-semibold">Mail Settings</h1>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 max-w-4xl mx-auto">
          <Tabs defaultValue="signatures" className="space-y-6">
            <TabsList>
              <TabsTrigger value="signatures" className="gap-2">
                <FileSignature className="h-4 w-4" />
                Signatures
              </TabsTrigger>
              <TabsTrigger value="notifications" className="gap-2">
                <Bell className="h-4 w-4" />
                Notifications
              </TabsTrigger>
              <TabsTrigger value="display" className="gap-2">
                <Palette className="h-4 w-4" />
                Display
              </TabsTrigger>
              <TabsTrigger value="shortcuts" className="gap-2">
                <Keyboard className="h-4 w-4" />
                Shortcuts
              </TabsTrigger>
            </TabsList>

            {/* Signatures Tab */}
            <TabsContent value="signatures" className="space-y-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>Email Signatures</CardTitle>
                      <CardDescription>
                        Create and manage your email signatures
                      </CardDescription>
                    </div>
                    <Button onClick={openCreateSignatureDialog}>
                      <Plus className="mr-2 h-4 w-4" />
                      New Signature
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {signaturesLoading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Loading signatures...
                    </div>
                  ) : signatures.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <FileSignature className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p className="text-lg font-medium">No signatures yet</p>
                      <p className="text-sm">Create a signature to automatically add to your emails</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {signatures.map((signature) => (
                        <div
                          key={signature.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{signature.name}</span>
                                {signature.isDefault && (
                                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                                    Default
                                  </span>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground truncate max-w-md">
                                {signature.contentText
                                  ? `${signature.contentText.slice(0, 100)}${signature.contentText.length > 100 ? '...' : ''}`
                                  : 'No preview available'}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {!signature.isDefault && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleSetDefaultSignature(signature)}
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEditSignatureDialog(signature)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDeleteDialog(signature)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Notifications Tab */}
            <TabsContent value="notifications" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Notification Preferences</CardTitle>
                  <CardDescription>
                    Configure how you receive notifications
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Desktop Notifications</Label>
                      <p className="text-sm text-muted-foreground">
                        Show desktop notifications for new emails
                      </p>
                    </div>
                    <Switch
                      checked={settings.notifications.desktop}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, desktop: checked },
                        })
                      }
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Sound Notifications</Label>
                      <p className="text-sm text-muted-foreground">
                        Play a sound when new emails arrive
                      </p>
                    </div>
                    <Switch
                      checked={settings.notifications.sound}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, sound: checked },
                        })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Display Tab */}
            <TabsContent value="display" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Display Settings</CardTitle>
                  <CardDescription>
                    Customize the appearance of your mailbox
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Compact View</Label>
                      <p className="text-sm text-muted-foreground">
                        Show more messages in the list
                      </p>
                    </div>
                    <Switch
                      checked={settings.display.compactView}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          display: { ...settings.display, compactView: checked },
                        })
                      }
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Show Preview</Label>
                      <p className="text-sm text-muted-foreground">
                        Show message preview in the list
                      </p>
                    </div>
                    <Switch
                      checked={settings.display.showPreview}
                      onCheckedChange={(checked) =>
                        setSettings({
                          ...settings,
                          display: { ...settings.display, showPreview: checked },
                        })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Shortcuts Tab */}
            <TabsContent value="shortcuts" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Keyboard Shortcuts</CardTitle>
                  <CardDescription>
                    Quick actions for power users
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[
                      { key: 'c', action: 'Compose new email' },
                      { key: 'r', action: 'Reply' },
                      { key: 'a', action: 'Reply all' },
                      { key: 'f', action: 'Forward' },
                      { key: 'e', action: 'Archive' },
                      { key: '#', action: 'Delete' },
                      { key: 's', action: 'Star/Unstar' },
                      { key: 'u', action: 'Mark as unread' },
                      { key: 'j / k', action: 'Next/Previous message' },
                      { key: 'Enter', action: 'Open message' },
                      { key: 'Ctrl+Enter', action: 'Send message' },
                      { key: '/', action: 'Focus search' },
                      { key: '?', action: 'Show shortcuts help' },
                      { key: 'Esc', action: 'Close/Cancel' },
                    ].map((shortcut) => (
                      <div
                        key={shortcut.key}
                        className="flex items-center justify-between py-2"
                      >
                        <span className="text-sm text-muted-foreground">
                          {shortcut.action}
                        </span>
                        <kbd className="px-2 py-1 bg-muted rounded text-sm font-mono">
                          {shortcut.key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>

      {/* Signature Dialog */}
      <Dialog open={signatureDialogOpen} onOpenChange={setSignatureDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedSignature ? 'Edit Signature' : 'Create Signature'}
            </DialogTitle>
            <DialogDescription>
              {selectedSignature
                ? 'Update your email signature'
                : 'Create a new signature to add to your emails'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signatureName">Signature Name</Label>
              <Input
                id="signatureName"
                placeholder="Work signature"
                value={signatureForm.name}
                onChange={(e) =>
                  setSignatureForm({ ...signatureForm, name: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Signature Content</Label>
              <TooltipProvider>
                <RichTextEditor
                  content={signatureForm.contentHtml}
                  onChange={(html, text) =>
                    setSignatureForm({
                      ...signatureForm,
                      contentHtml: html,
                      contentText: text,
                    })
                  }
                  placeholder="Enter your signature..."
                  className="min-h-[200px]"
                />
              </TooltipProvider>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignatureDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveSignature}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {createMutation.isPending || updateMutation.isPending
                ? 'Saving...'
                : selectedSignature
                ? 'Save Changes'
                : 'Create Signature'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Signature</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedSignature?.name}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSignature}
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
