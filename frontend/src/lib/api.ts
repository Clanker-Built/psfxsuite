import { useAuthStore } from '@/stores/auth';

const API_BASE = '/api/v1';

// Note: useAuthStore is still imported for the logout functionality in error handling

// CSRF token management
let csrfToken: string | null = null;

class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// Fetch CSRF token from server - should be called on app initialization
export async function initCSRF(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE}/csrf-token`, {
      method: 'GET',
      credentials: 'include',
    });
    if (response.ok) {
      // Get token from header or body
      const headerToken = response.headers.get('X-CSRF-Token');
      if (headerToken) {
        csrfToken = headerToken;
      } else {
        const data = await response.json();
        csrfToken = data.csrfToken;
      }
    }
  } catch (error) {
    console.error('Failed to fetch CSRF token:', error);
  }
}

// Get current CSRF token
export function getCSRFToken(): string | null {
  return csrfToken;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  // Token is now stored in httpOnly cookie, not in client state
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Include CSRF token for state-changing requests
  const method = options.method || 'GET';
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase()) && csrfToken) {
    (headers as Record<string, string>)['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include', // Include httpOnly cookies for auth
  });

  if (response.status === 401) {
    // Check if this is a mail endpoint
    if (endpoint.startsWith('/mail/')) {
      // Don't redirect - let the mail components handle the auth state
      // The mail store will handle re-authentication
      throw new ApiError(401, 'Mail session expired');
    } else {
      // Admin route - redirect to admin login
      useAuthStore.getState().logout();
      window.location.href = '/admin/login';
      throw new ApiError(401, 'Unauthorized');
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new ApiError(response.status, error.message || 'Request failed');
  }

  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

export const api = {
  get: <T>(endpoint: string) => request<T>(endpoint),

  post: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  put: <T>(endpoint: string, data?: unknown) =>
    request<T>(endpoint, {
      method: 'PUT',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string) =>
    request<T>(endpoint, { method: 'DELETE' }),
};

// Auth API
export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  user: {
    id: number;
    username: string;
    email: string;
    role: 'admin' | 'operator' | 'auditor';
  };
  // Token is now stored in httpOnly cookie, not returned in response
}

export const authApi = {
  login: (data: LoginRequest) => api.post<LoginResponse>('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get<LoginResponse['user']>('/auth/me'),
};

// Setup API - for initial admin user creation
export interface SetupStatusResponse {
  setupRequired: boolean;
}

export interface SetupRequest {
  username: string;
  email: string;
  password: string;
}

export interface SetupResponse {
  success: boolean;
  message: string;
  user?: {
    id: number;
    username: string;
    email: string;
    role: string;
  };
}

export const setupApi = {
  getStatus: () => api.get<SetupStatusResponse>('/setup/status'),
  complete: (data: SetupRequest) => api.post<SetupResponse>('/setup/complete', data),
};

// Status API
export interface SystemStatus {
  postfix: {
    running: boolean;
    version: string;
  };
  queue: {
    active: number;
    deferred: number;
    hold: number;
    corrupt: number;
  };
  lastReload: {
    timestamp: string;
    success: boolean;
  };
  configStatus: 'ok' | 'error' | 'pending';
}

export const statusApi = {
  get: () => api.get<SystemStatus>('/status'),
};

// Config API
export interface ConfigValue {
  key: string;
  value: string;
  description?: string;
  category: string;
}

export interface PostfixConfig {
  general: {
    myhostname: string;
    mydomain: string;
    myorigin: string;
    inet_interfaces: string;
    inet_protocols: string;
  };
  relay: {
    relayhost: string;
    mynetworks: string;
    relay_domains: string;
  };
  tls: {
    smtp_tls_security_level: string;
    smtpd_tls_security_level: string;
    smtp_tls_cert_file: string;
    smtp_tls_key_file: string;
    smtpd_tls_cert_file: string;
    smtpd_tls_key_file: string;
    smtp_tls_CAfile: string;
    smtp_tls_loglevel: string;
  };
  sasl: {
    smtp_sasl_auth_enable: string;
    smtp_sasl_password_maps: string;
    smtp_sasl_security_options: string;
    smtp_sasl_tls_security_options: string;
  };
  restrictions: {
    smtpd_relay_restrictions: string;
    smtpd_recipient_restrictions: string;
    smtpd_sender_restrictions: string;
  };
}

export interface ConfigVersion {
  id: number;
  versionNumber: number;
  createdAt: string;
  createdBy: string;
  appliedAt?: string;
  status: 'draft' | 'applied' | 'rolled_back';
  notes?: string;
}

export interface TLSCertificate {
  type: 'smtp' | 'smtpd';
  certFile: string;
  keyFile: string;
  validFrom?: string;
  validTo?: string;
  subject?: string;
  issuer?: string;
}

// Staged config types for submit/apply workflow
export interface StagedConfigEntry {
  id: number;
  key: string;
  value: string;
  category: string;
  stagedById: number;
  stagedByUsername: string;
  stagedAt: string;
}

export interface StagedConfigResponse {
  staged: StagedConfigEntry[];
  count: number;
}

export interface StagedDiffEntry {
  key: string;
  oldValue: string;
  newValue: string;
}

export interface StagedDiffResponse {
  diff: StagedDiffEntry[];
  changeCount: number;
}

export interface ApplyResponse {
  success: boolean;
  message: string;
  changesCount?: number;
}

export const configApi = {
  get: () => api.get<{ config: PostfixConfig }>('/config'),
  getFull: () => api.get<{ parameters: ConfigValue[] }>('/config/full'),
  // Legacy direct update (deprecated - use submit/apply workflow)
  update: (config: Partial<PostfixConfig>) =>
    api.put<void>('/config', { config }),
  validate: () => api.post<{ valid: boolean; errors?: string[] }>('/config/validate'),
  apply: () => api.post<ApplyResponse>('/config/apply'),
  rollback: (version: number) => api.post<void>(`/config/rollback/${version}`),
  history: () => api.get<{ versions: ConfigVersion[] }>('/config/history'),

  // Submit/Apply workflow (staged changes)
  getStaged: () => api.get<StagedConfigResponse>('/config/staged'),
  submit: (config: Partial<PostfixConfig>) =>
    api.post<StagedConfigResponse>('/config/submit', { config }),
  discardStaged: () => api.delete<void>('/config/staged'),
  getStagedDiff: () => api.get<StagedDiffResponse>('/config/staged/diff'),

  // TLS certificate management
  getCertificates: () => api.get<{ certificates: TLSCertificate[] }>('/config/certificates'),
  uploadCertificate: async (type: 'smtp' | 'smtpd', certFile: File, keyFile: File) => {
    const formData = new FormData();
    formData.append('type', type);
    formData.append('cert', certFile);
    formData.append('key', keyFile);

    // Auth is now via httpOnly cookie, only need CSRF token
    const headers: Record<string, string> = {};
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }

    const response = await fetch(`${API_BASE}/config/certificates`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include', // Include httpOnly cookies for auth
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Upload failed' }));
      throw new ApiError(response.status, error.message);
    }

    return response.json();
  },
  deleteCertificate: (type: 'smtp' | 'smtpd') =>
    api.delete<void>(`/config/certificates/${type}`),

  // SASL credentials management
  saveCredentials: (data: { relayhost: string; username: string; password: string }) =>
    api.post<void>('/config/credentials', data),
};

// Logs API
export interface LogEntry {
  id: number;
  timestamp: string;
  hostname: string;
  process: string;
  pid: number;
  queueId?: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
  mailFrom?: string;
  mailTo?: string;
  status?: string;
  relay?: string;
}

export interface LogQuery {
  start?: string;
  end?: string;
  severity?: string;
  search?: string;
  queueId?: string;
  limit?: number;
  offset?: number;
}

export const logsApi = {
  query: (params: LogQuery) => {
    const query = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return api.get<{ logs: LogEntry[]; total: number }>(`/logs?${query}`);
  },
  getByQueueId: (queueId: string) =>
    api.get<{ logs: LogEntry[] }>(`/logs/queue/${queueId}`),
};

// Alerts API
export interface AlertRule {
  id: number;
  name: string;
  description: string;
  type: string;
  enabled: boolean;
  thresholdValue: number;
  thresholdDuration: number;
  severity: 'warning' | 'critical';
}

export interface Alert {
  id: number;
  ruleId: number;
  ruleName: string;
  status: 'firing' | 'acknowledged' | 'resolved' | 'silenced';
  severity: 'warning' | 'critical';
  triggeredAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  context: Record<string, unknown>;
}

export const alertsApi = {
  list: () => api.get<{ alerts: Alert[] }>('/alerts'),
  acknowledge: (id: number, note?: string) =>
    api.post<void>(`/alerts/${id}/acknowledge`, { note }),
  silence: (id: number, durationMinutes: number) =>
    api.post<void>(`/alerts/${id}/silence`, { durationMinutes }),
  rules: () => api.get<{ rules: AlertRule[] }>('/alerts/rules'),
  updateRule: (id: number, rule: Partial<AlertRule>) =>
    api.put<void>(`/alerts/rules/${id}`, rule),
};

// Queue API
export interface QueueMessage {
  queueId: string;
  sender: string;
  recipients: string[];
  status: 'active' | 'deferred' | 'hold';
  size: number;
  arrivalTime: string;
  reason?: string;
}

export const queueApi = {
  summary: () => api.get<SystemStatus['queue']>('/queue'),
  list: (status?: string) => {
    const query = status ? `?status=${status}` : '';
    return api.get<{ messages: QueueMessage[] }>(`/queue/messages${query}`);
  },
  hold: (queueId: string) => api.post<void>(`/queue/messages/${queueId}/hold`),
  release: (queueId: string) =>
    api.post<void>(`/queue/messages/${queueId}/release`),
  delete: (queueId: string) => api.delete<void>(`/queue/messages/${queueId}`),
  flush: () => api.post<void>('/queue/flush'),
};

// Audit API
export interface AuditEntry {
  id: number;
  timestamp: string;
  userId: number;
  username: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  summary: string;
  status: 'success' | 'failed';
  ipAddress: string;
}

export interface AuditQuery {
  start?: string;
  end?: string;
  userId?: number;
  action?: string;
  limit?: number;
  offset?: number;
}

export const auditApi = {
  query: (params: AuditQuery) => {
    const query = new URLSearchParams(
      Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, String(v)])
    ).toString();
    return api.get<{ entries: AuditEntry[]; total: number }>(`/audit?${query}`);
  },
};

// Users API
export interface User {
  id: number;
  username: string;
  email: string;
  role: 'admin' | 'operator' | 'auditor';
  lastLogin?: string;
  createdAt: string;
}

export interface CreateUserRequest {
  username: string;
  email: string;
  password: string;
  role: 'admin' | 'operator' | 'auditor';
}

export const usersApi = {
  list: () => api.get<{ users: User[] }>('/users'),
  create: (data: CreateUserRequest) => api.post<User>('/users', data),
  update: (id: number, data: Partial<CreateUserRequest>) =>
    api.put<User>(`/users/${id}`, data),
  delete: (id: number) => api.delete<void>(`/users/${id}`),
  resetPassword: (id: number) => api.post<void>(`/users/${id}/reset-password`),
};

// Transport Maps API
export interface TransportMap {
  domain: string;
  transport: string;
  nextHop: string;
  port: number;
  enabled: boolean;
}

export const transportApi = {
  list: () => api.get<{ transportMaps: TransportMap[] }>('/transport'),
  create: (data: Omit<TransportMap, 'transport' | 'enabled'>) =>
    api.post<TransportMap>('/transport', data),
  update: (domain: string, data: Partial<TransportMap>) =>
    api.put<void>(`/transport/${encodeURIComponent(domain)}`, data),
  delete: (domain: string) =>
    api.delete<void>(`/transport/${encodeURIComponent(domain)}`),
};

// Sender-Dependent Relay API
export interface SenderRelay {
  sender: string;
  relayhost: string;
  enabled: boolean;
}

export const senderRelayApi = {
  list: () => api.get<{ senderRelays: SenderRelay[] }>('/sender-relays'),
  create: (data: Omit<SenderRelay, 'enabled'>) =>
    api.post<SenderRelay>('/sender-relays', data),
  update: (sender: string, data: Partial<SenderRelay>) =>
    api.put<void>(`/sender-relays/${encodeURIComponent(sender)}`, data),
  delete: (sender: string) =>
    api.delete<void>(`/sender-relays/${encodeURIComponent(sender)}`),
};

// Settings API
export interface NotificationChannel {
  id: number;
  name: string;
  type: 'email' | 'webhook' | 'slack';
  enabled: boolean;
  config: {
    // Email
    smtpHost?: string;
    smtpPort?: number;
    smtpUser?: string;
    smtpPassword?: string;
    smtpTls?: boolean;
    fromAddress?: string;
    toAddresses?: string[];
    // Webhook
    url?: string;
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    // Slack
    webhookUrl?: string;
    channel?: string;
  };
  createdAt: string;
}

export interface SystemSettings {
  logRetentionDays: number;
  auditRetentionDays: number;
  sessionTimeoutMinutes: number;
  alertSilenceDefaultMinutes: number;
  logSource: 'file' | 'journald';
  logFilePath: string;
}

export const settingsApi = {
  // Notification channels
  getChannels: () => api.get<{ channels: NotificationChannel[] }>('/settings/notifications'),
  createChannel: (data: Omit<NotificationChannel, 'id' | 'createdAt'>) =>
    api.post<NotificationChannel>('/settings/notifications', data),
  updateChannel: (id: number, data: Partial<NotificationChannel>) =>
    api.put<void>(`/settings/notifications/${id}`, data),
  deleteChannel: (id: number) =>
    api.delete<void>(`/settings/notifications/${id}`),
  testChannel: (id: number) =>
    api.post<{ success: boolean; message?: string }>(`/settings/notifications/${id}/test`),

  // System settings
  getSystem: () => api.get<{ settings: SystemSettings }>('/settings/system'),
  updateSystem: (settings: Partial<SystemSettings>) =>
    api.put<void>('/settings/system', settings),
};

// PSFXAdmin API - Mail domains, mailboxes, aliases
export interface MailDomain {
  id: number;
  domain: string;
  description: string;
  maxMailboxes: number;
  maxAliases: number;
  quotaBytes: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  mailboxCount: number;
  aliasCount: number;
}

export interface Mailbox {
  id: number;
  email: string;
  localPart: string;
  domainId: number;
  domain: string;
  displayName: string;
  quotaBytes: number;
  usedBytes: number;
  active: boolean;
  lastLogin: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MailAlias {
  id: number;
  sourceEmail: string;
  destinationEmail: string;
  domainId: number;
  domain: string;
  active: boolean;
  createdAt: string;
}

export interface AdminStats {
  domains: number;
  mailboxes: number;
  aliases: number;
  totalQuota: number;
  usedQuota: number;
  activeDomains: number;
}

export interface CreateDomainRequest {
  domain: string;
  description?: string;
  maxMailboxes?: number;
  maxAliases?: number;
  quotaBytes?: number;
}

export interface CreateMailboxRequest {
  localPart: string;
  domainId: number;
  password: string;
  displayName?: string;
  quotaBytes?: number;
}

export interface CreateAliasRequest {
  localPart: string;
  domainId: number;
  destinationEmail: string;
}

export const adminApi = {
  // Stats
  getStats: () => api.get<AdminStats>('/admin/stats'),

  // Domains
  listDomains: () => api.get<MailDomain[]>('/admin/domains'),
  getDomain: (id: number) => api.get<MailDomain>(`/admin/domains/${id}`),
  createDomain: (data: CreateDomainRequest) => api.post<{ id: number; domain: string; message: string }>('/admin/domains', data),
  updateDomain: (id: number, data: Partial<CreateDomainRequest>) => api.put<void>(`/admin/domains/${id}`, data),
  deleteDomain: (id: number) => api.delete<void>(`/admin/domains/${id}`),

  // Mailboxes
  listMailboxes: (domainId?: number) => {
    const query = domainId ? `?domain_id=${domainId}` : '';
    return api.get<Mailbox[]>(`/admin/mailboxes${query}`);
  },
  getMailbox: (id: number) => api.get<Mailbox>(`/admin/mailboxes/${id}`),
  createMailbox: (data: CreateMailboxRequest) => api.post<{ id: number; email: string; message: string }>('/admin/mailboxes', data),
  updateMailbox: (id: number, data: { displayName?: string; quotaBytes?: number; active?: boolean }) =>
    api.put<void>(`/admin/mailboxes/${id}`, data),
  deleteMailbox: (id: number) => api.delete<void>(`/admin/mailboxes/${id}`),
  resetMailboxPassword: (id: number, password: string) =>
    api.post<void>(`/admin/mailboxes/${id}/password`, { password }),

  // Aliases
  listAliases: (domainId?: number) => {
    const query = domainId ? `?domain_id=${domainId}` : '';
    return api.get<MailAlias[]>(`/admin/aliases${query}`);
  },
  createAlias: (data: CreateAliasRequest) => api.post<{ id: number; source: string; message: string }>('/admin/aliases', data),
  deleteAlias: (id: number) => api.delete<void>(`/admin/aliases/${id}`),
};

// PSFXMail API - Webmail
export interface MailFolder {
  name: string;
  delimiter: string;
  attributes?: string[];
  specialUse?: string;
  total: number;
  unseen: number;
}

export interface MailAddress {
  name: string;
  email: string;
}

export interface MailMessageSummary {
  uid: number;
  seqNum: number;
  subject: string;
  from: string;
  fromName: string;
  to: string[];
  date: string;
  size: number;
  read: boolean;
  starred: boolean;
  flags: string[];
  messageId: string;
  inReplyTo?: string;
  references?: string;
  conversationId?: string;
}

export interface MailConversation {
  id: string;
  subject: string;
  participants: string[];
  messageCount: number;
  unreadCount: number;
  starred: boolean;
  lastDate: string;
  messages: MailMessageSummary[];
  snippet?: string;
}

export interface MailMessage {
  uid: number;
  messageId: string;
  inReplyTo?: string;
  subject: string;
  from: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  replyTo?: MailAddress[];
  date: string;
  read: boolean;
  starred: boolean;
  flags: string[];
  textBody?: string;
  htmlBody?: string;
  attachments?: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    contentId?: string;
    inline: boolean;
  }[];
}

export interface ComposeMailRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  htmlBody?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: string[];
}

// Contact types
export interface MailContact {
  id: number;
  email: string;
  name?: string;
  company?: string;
  phone?: string;
  notes?: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContactRequest {
  email: string;
  name?: string;
  company?: string;
  phone?: string;
  notes?: string;
  favorite?: boolean;
}

// Signature types
export interface MailSignature {
  id: number;
  name: string;
  contentHtml: string;
  contentText: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSignatureRequest {
  name: string;
  contentHtml: string;
  contentText: string;
  isDefault?: boolean;
}

export const mailApi = {
  // Auth (separate from admin auth)
  login: (email: string, password: string) =>
    api.post<{ success: boolean; email: string }>('/mail/auth', { email, password }),
  logout: () => api.post<void>('/mail/logout'),

  // Folders
  getFolders: () => api.get<MailFolder[]>('/mail/folders'),

  // Messages
  getMessages: (folder: string, offset = 0, limit = 50, threaded = false) =>
    api.get<{ messages: MailMessageSummary[]; offset: number; limit: number }>(
      `/mail/folders/${encodeURIComponent(folder)}/messages?offset=${offset}&limit=${limit}${threaded ? '&threaded=true' : ''}`
    ),

  // Conversations (threaded messages)
  getConversations: (folder: string, offset = 0, limit = 50) =>
    api.get<{ conversations: MailConversation[]; offset: number; limit: number; threaded: boolean }>(
      `/mail/folders/${encodeURIComponent(folder)}/messages?offset=${offset}&limit=${limit}&threaded=true`
    ),
  getMessage: (uid: number, folder = 'INBOX') =>
    api.get<MailMessage>(`/mail/messages/${uid}?folder=${encodeURIComponent(folder)}`),

  // Flags
  markRead: (uid: number, folder = 'INBOX', read = true) =>
    api.put<void>(`/mail/messages/${uid}/flags`, { folder, read }),
  markStarred: (uid: number, folder = 'INBOX', starred = true) =>
    api.put<void>(`/mail/messages/${uid}/flags`, { folder, starred }),

  // Move/Delete
  moveMessages: (uids: number[], fromFolder: string, toFolder: string) =>
    api.post<void>('/mail/messages/move', { uids, fromFolder, toFolder }),
  deleteMessage: (uid: number, folder = 'INBOX') =>
    api.delete<void>(`/mail/messages/${uid}?folder=${encodeURIComponent(folder)}`),

  // Compose/Send
  send: (message: ComposeMailRequest) => api.post<{ success: boolean; messageId: string }>('/mail/send', message),

  // Search
  search: (params: { q?: string; folder?: string; from?: string; to?: string; subject?: string; since?: string; before?: string }) => {
    const searchParams = new URLSearchParams();
    if (params.q) searchParams.set('q', params.q);
    if (params.folder) searchParams.set('folder', params.folder);
    if (params.from) searchParams.set('from', params.from);
    if (params.to) searchParams.set('to', params.to);
    if (params.subject) searchParams.set('subject', params.subject);
    if (params.since) searchParams.set('since', params.since);
    if (params.before) searchParams.set('before', params.before);
    return api.get<{ messages: MailMessageSummary[]; query: Record<string, string> }>(`/mail/search?${searchParams.toString()}`);
  },

  // Drafts
  saveDraft: (draft: {
    uid?: number;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    htmlBody?: string;
    inReplyTo?: string;
  }) => api.post<{ success: boolean; message: string }>('/mail/drafts', draft),

  getDraft: (uid: number) => api.get<MailMessage>(`/mail/drafts/${uid}`),

  deleteDraft: (uid: number) => api.delete<{ message: string }>(`/mail/drafts/${uid}`),

  // Contacts
  listContacts: () => api.get<MailContact[]>('/mail/contacts'),

  createContact: (contact: CreateContactRequest) =>
    api.post<{ id: number; message: string }>('/mail/contacts', contact),

  getContact: (id: number) => api.get<MailContact>(`/mail/contacts/${id}`),

  updateContact: (id: number, contact: CreateContactRequest) =>
    api.put<{ message: string }>(`/mail/contacts/${id}`, contact),

  deleteContact: (id: number) => api.delete<{ message: string }>(`/mail/contacts/${id}`),

  searchContacts: (query: string) =>
    api.get<MailContact[]>(`/mail/contacts/search?q=${encodeURIComponent(query)}`),

  toggleContactFavorite: (id: number) =>
    api.put<{ message: string }>(`/mail/contacts/${id}/favorite`, {}),

  // Signatures
  listSignatures: () => api.get<MailSignature[]>('/mail/signatures'),

  createSignature: (signature: CreateSignatureRequest) =>
    api.post<{ id: number; message: string }>('/mail/signatures', signature),

  getSignature: (id: number) => api.get<MailSignature>(`/mail/signatures/${id}`),

  updateSignature: (id: number, signature: CreateSignatureRequest) =>
    api.put<{ message: string }>(`/mail/signatures/${id}`, signature),

  deleteSignature: (id: number) => api.delete<{ message: string }>(`/mail/signatures/${id}`),

  setDefaultSignature: (id: number) =>
    api.put<{ message: string }>(`/mail/signatures/${id}/default`, {}),

  getDefaultSignature: () => api.get<MailSignature | null>('/mail/signatures/default'),
};
