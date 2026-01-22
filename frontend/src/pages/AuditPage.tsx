import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, CheckCircle, XCircle } from 'lucide-react';
import { auditApi, type AuditEntry } from '@/lib/api';
import { formatDate } from '@/lib/utils';

function AuditRow({ entry }: { entry: AuditEntry }) {
  return (
    <tr className="border-b">
      <td className="py-3 px-4 text-sm text-muted-foreground whitespace-nowrap">
        {formatDate(entry.timestamp)}
      </td>
      <td className="py-3 px-4 text-sm font-medium">{entry.username}</td>
      <td className="py-3 px-4 text-sm">{entry.action}</td>
      <td className="py-3 px-4 text-sm text-muted-foreground">
        {entry.resourceType}
        {entry.resourceId && ` (${entry.resourceId})`}
      </td>
      <td className="py-3 px-4 text-sm">{entry.summary}</td>
      <td className="py-3 px-4">
        {entry.status === 'success' ? (
          <CheckCircle className="h-4 w-4 text-green-600" />
        ) : (
          <XCircle className="h-4 w-4 text-red-600" />
        )}
      </td>
    </tr>
  );
}

export function AuditPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['audit', { search }],
    queryFn: () => auditApi.query({ limit: 50 }),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Audit Log</h1>
        <p className="text-muted-foreground">
          Track all administrative actions
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search audit log..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-muted-foreground">Loading audit log...</div>
          ) : data?.entries?.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              No audit entries found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">
                      Timestamp
                    </th>
                    <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">
                      User
                    </th>
                    <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">
                      Action
                    </th>
                    <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">
                      Resource
                    </th>
                    <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">
                      Summary
                    </th>
                    <th className="py-3 px-4 text-left text-sm font-medium text-muted-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data?.entries?.map((entry) => (
                    <AuditRow key={entry.id} entry={entry} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
