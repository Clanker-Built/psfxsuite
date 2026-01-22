import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  Star,
  Filter,
  ChevronDown,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { mailApi, MailMessageSummary } from '@/lib/api';
import { useMailStore } from '@/stores/mail';

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function SearchPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { folders } = useMailStore();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [folder, setFolder] = useState(searchParams.get('folder') || 'INBOX');
  const [fromFilter, setFromFilter] = useState(searchParams.get('from') || '');
  const [toFilter, setToFilter] = useState(searchParams.get('to') || '');
  const [subjectFilter, setSubjectFilter] = useState(searchParams.get('subject') || '');
  const [sinceDate, setSinceDate] = useState(searchParams.get('since') || '');
  const [beforeDate, setBeforeDate] = useState(searchParams.get('before') || '');
  const [showFilters, setShowFilters] = useState(false);

  // Auto-show filters if any advanced filter is set
  useEffect(() => {
    if (fromFilter || toFilter || subjectFilter || sinceDate || beforeDate) {
      setShowFilters(true);
    }
  }, []);

  // Build search params
  const buildSearchParams = () => {
    const params: Record<string, string> = {};
    if (query) params.q = query;
    if (folder && folder !== 'all') params.folder = folder;
    if (fromFilter) params.from = fromFilter;
    if (toFilter) params.to = toFilter;
    if (subjectFilter) params.subject = subjectFilter;
    if (sinceDate) params.since = sinceDate;
    if (beforeDate) params.before = beforeDate;
    return params;
  };

  // Search query
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mail-search', query, folder, fromFilter, toFilter, subjectFilter, sinceDate, beforeDate],
    queryFn: () => mailApi.search(buildSearchParams()),
    enabled: Boolean(query || fromFilter || toFilter || subjectFilter),
    staleTime: 30000,
  });

  const handleSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    setSearchParams(buildSearchParams());
    refetch();
  };

  const clearFilters = () => {
    setFromFilter('');
    setToFilter('');
    setSubjectFilter('');
    setSinceDate('');
    setBeforeDate('');
  };

  const handleMessageClick = (message: MailMessageSummary) => {
    navigate(`/message/${message.uid}?folder=${encodeURIComponent(folder || 'INBOX')}`);
  };

  const messages = data?.messages || [];

  return (
    <div className="flex flex-col h-full">
      {/* Search Header */}
      <div className="border-b p-4 bg-background">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search emails..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All folders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Folders</SelectItem>
                <SelectItem value="INBOX">Inbox</SelectItem>
                <SelectItem value="Sent">Sent</SelectItem>
                <SelectItem value="Drafts">Drafts</SelectItem>
                <SelectItem value="Trash">Trash</SelectItem>
                {folders
                  .filter((f) => !['INBOX', 'Sent', 'Drafts', 'Trash', 'Flagged', 'Archive', 'Junk', 'Spam'].includes(f.name))
                  .map((f) => (
                    <SelectItem key={f.name} value={f.name}>
                      {f.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button type="submit">
              <Search className="mr-2 h-4 w-4" />
              Search
            </Button>
          </div>

          {/* Advanced Filters */}
          <Collapsible open={showFilters} onOpenChange={setShowFilters}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <Filter className="h-4 w-4" />
                Advanced Filters
                <ChevronDown className={cn("h-4 w-4 transition-transform", showFilters && "rotate-180")} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="from">From</Label>
                      <Input
                        id="from"
                        placeholder="sender@example.com"
                        value={fromFilter}
                        onChange={(e) => setFromFilter(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="to">To</Label>
                      <Input
                        id="to"
                        placeholder="recipient@example.com"
                        value={toFilter}
                        onChange={(e) => setToFilter(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="subject">Subject contains</Label>
                      <Input
                        id="subject"
                        placeholder="Keywords in subject"
                        value={subjectFilter}
                        onChange={(e) => setSubjectFilter(e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-2">
                        <Label htmlFor="since">Since</Label>
                        <Input
                          id="since"
                          type="date"
                          value={sinceDate}
                          onChange={(e) => setSinceDate(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="before">Before</Label>
                        <Input
                          id="before"
                          type="date"
                          value={beforeDate}
                          onChange={(e) => setBeforeDate(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end mt-4">
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      <X className="mr-2 h-4 w-4" />
                      Clear Filters
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </CollapsibleContent>
          </Collapsible>
        </form>
      </div>

      {/* Search Results */}
      <ScrollArea className="flex-1">
        {error ? (
          <div className="flex items-center justify-center h-64 text-destructive">
            <p>Search failed: {error instanceof Error ? error.message : 'Unknown error'}</p>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            <p>Searching...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <Search className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">
              {query || fromFilter || toFilter || subjectFilter
                ? 'No results found'
                : 'Enter a search term'}
            </p>
            <p className="text-sm">
              {query || fromFilter || toFilter || subjectFilter
                ? 'Try different keywords or filters'
                : 'Search by keyword, sender, recipient, or subject'}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            <div className="px-4 py-2 text-sm text-muted-foreground bg-muted/50">
              Found {messages.length} result{messages.length !== 1 ? 's' : ''}
            </div>
            {messages.map((message) => (
              <div
                key={message.uid}
                className={cn(
                  'flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-accent/50 transition-colors',
                  !message.read && 'bg-green-50/50 dark:bg-green-950/20'
                )}
                onClick={() => handleMessageClick(message)}
              >
                <div className="flex items-center gap-2">
                  {message.starred ? (
                    <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  ) : (
                    <Star className="h-4 w-4 text-muted-foreground/30" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm truncate', !message.read && 'font-semibold')}>
                      {message.fromName || message.from}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm truncate', !message.read && 'font-medium')}>
                      {message.subject || '(No Subject)'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatDate(message.date)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
