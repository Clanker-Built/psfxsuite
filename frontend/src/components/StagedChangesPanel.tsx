import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import {
  RefreshCw,
  Play,
  Trash2,
  FileText,
  AlertTriangle,
  ArrowRight,
  User,
  Clock,
} from 'lucide-react';
import {
  configApi,
  type StagedConfigEntry,
  type StagedDiffEntry,
} from '@/lib/api';

interface StagedChangesPanelProps {
  onApplySuccess?: () => void;
}

export function StagedChangesPanel({ onApplySuccess }: StagedChangesPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stagedData, isLoading: loadingStaged } = useQuery({
    queryKey: ['staged-config'],
    queryFn: configApi.getStaged,
    refetchInterval: 10000, // Refresh every 10s to see collaborators' changes
  });

  const { data: diffData, isLoading: loadingDiff } = useQuery({
    queryKey: ['staged-diff'],
    queryFn: configApi.getStagedDiff,
    enabled: (stagedData?.count ?? 0) > 0,
  });

  const applyMutation = useMutation({
    mutationFn: configApi.apply,
    onSuccess: (data) => {
      if (data.success) {
        queryClient.invalidateQueries({ queryKey: ['staged-config'] });
        queryClient.invalidateQueries({ queryKey: ['staged-diff'] });
        queryClient.invalidateQueries({ queryKey: ['config'] });
        queryClient.invalidateQueries({ queryKey: ['config-history'] });
        queryClient.invalidateQueries({ queryKey: ['status'] });
        toast({
          title: 'Configuration Applied',
          description: `${data.changesCount || 0} changes applied. Postfix has been reloaded.`,
        });
        onApplySuccess?.();
      } else {
        toast({
          title: 'Apply Failed',
          description: data.message || 'Failed to apply configuration.',
          variant: 'destructive',
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: 'Apply Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const discardMutation = useMutation({
    mutationFn: configApi.discardStaged,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staged-config'] });
      queryClient.invalidateQueries({ queryKey: ['staged-diff'] });
      toast({
        title: 'Changes Discarded',
        description: 'All staged changes have been discarded.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const stagedCount = stagedData?.count ?? 0;
  const staged = stagedData?.staged ?? [];
  const diff = diffData?.diff ?? [];

  // Group staged entries by category
  const groupedStaged = staged.reduce((acc, entry) => {
    if (!acc[entry.category]) {
      acc[entry.category] = [];
    }
    acc[entry.category].push(entry);
    return acc;
  }, {} as Record<string, StagedConfigEntry[]>);

  // Get unique contributors
  const contributors = [...new Set(staged.map((s) => s.stagedByUsername))];

  if (loadingStaged) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <RefreshCw className="h-5 w-5 animate-spin mx-auto mb-2" />
          Loading staged changes...
        </CardContent>
      </Card>
    );
  }

  if (stagedCount === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Staged Changes
          </CardTitle>
          <CardDescription>
            No changes staged for review. Edit configuration settings to stage changes.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Staged Changes
              <Badge variant="secondary">{stagedCount}</Badge>
            </CardTitle>
            <CardDescription>
              Review changes before applying to Postfix
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => discardMutation.mutate()}
              disabled={discardMutation.isPending}
            >
              {discardMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              Discard All
            </Button>
            <Button
              size="sm"
              onClick={() => applyMutation.mutate()}
              disabled={applyMutation.isPending}
            >
              {applyMutation.isPending ? (
                <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              Apply Changes
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Contributors */}
        {contributors.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <User className="h-4 w-4" />
            <span>Contributors: {contributors.join(', ')}</span>
          </div>
        )}

        {/* Warning if there are actual changes */}
        {diff.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Review Before Applying</AlertTitle>
            <AlertDescription>
              These changes will be written to Postfix configuration and the service will be reloaded.
            </AlertDescription>
          </Alert>
        )}

        {/* Diff View */}
        {loadingDiff ? (
          <div className="text-center text-muted-foreground py-4">
            <RefreshCw className="h-4 w-4 animate-spin mx-auto mb-2" />
            Loading diff...
          </div>
        ) : diff.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Changes to be applied:</h4>
            <div className="border rounded-lg divide-y">
              {diff.map((entry: StagedDiffEntry) => (
                <DiffEntry key={entry.key} entry={entry} />
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No actual changes from current configuration.
          </p>
        )}

        {/* Detailed staged entries by category */}
        <div className="space-y-4 pt-4 border-t">
          <h4 className="text-sm font-medium">Staged entries by category:</h4>
          {Object.entries(groupedStaged).map(([category, entries]) => (
            <div key={category} className="space-y-2">
              <h5 className="text-sm font-medium capitalize text-muted-foreground">
                {category}
              </h5>
              <div className="pl-4 space-y-1">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between text-sm py-1"
                  >
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-1.5 py-0.5 rounded text-xs">
                        {entry.key}
                      </code>
                      <span className="text-muted-foreground truncate max-w-[200px]">
                        = {entry.value || '(empty)'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span title={entry.stagedAt}>
                        {entry.stagedByUsername}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DiffEntry({ entry }: { entry: StagedDiffEntry }) {
  return (
    <div className="p-3 space-y-1">
      <div className="flex items-center gap-2">
        <code className="text-sm font-medium">{entry.key}</code>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span className="bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 px-2 py-0.5 rounded font-mono text-xs line-through">
          {entry.oldValue || '(not set)'}
        </span>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200 px-2 py-0.5 rounded font-mono text-xs">
          {entry.newValue || '(empty)'}
        </span>
      </div>
    </div>
  );
}

// Badge component for showing staged count in nav
export function StagedChangesBadge() {
  const { data } = useQuery({
    queryKey: ['staged-config'],
    queryFn: configApi.getStaged,
    refetchInterval: 30000,
  });

  const count = data?.count ?? 0;

  if (count === 0) return null;

  return (
    <Badge variant="secondary" className="ml-2">
      {count}
    </Badge>
  );
}
