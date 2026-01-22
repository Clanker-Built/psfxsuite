import { useState } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import {
  Save,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Upload,
  FileKey,
  FileBadge,
  Eye,
  EyeOff,
  History,
  RotateCcw,
} from 'lucide-react';
import {
  configApi,
  type PostfixConfig,
  type TLSCertificate,
} from '@/lib/api';
import { StagedChangesPanel } from '@/components/StagedChangesPanel';

function ConfigNav() {
  const tabs = [
    { to: '/config', label: 'General', end: true },
    { to: '/config/relay', label: 'Relay' },
    { to: '/config/tls', label: 'TLS & Certificates' },
    { to: '/config/auth', label: 'SASL Auth' },
    { to: '/config/restrictions', label: 'Restrictions' },
    { to: '/config/history', label: 'History' },
  ];

  return (
    <nav className="flex border-b mb-6 overflow-x-auto">
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          className={({ isActive }) =>
            cn(
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap',
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
  );
}

// Reusable form field component
function FormField({
  label,
  description,
  error,
  children,
}: {
  label: string;
  description?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

// General Config Form
function GeneralConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: configApi.get,
  });

  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<PostfixConfig['general']>({
    values: data?.config?.general,
  });

  const submitMutation = useMutation({
    mutationFn: (general: PostfixConfig['general']) =>
      configApi.submit({ general }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staged-config'] });
      queryClient.invalidateQueries({ queryKey: ['staged-diff'] });
      reset(undefined, { keepValues: true });
      toast({ title: 'Changes Staged', description: 'Changes staged for review. Click "Apply Changes" to activate.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const onSubmit = (data: PostfixConfig['general']) => {
    submitMutation.mutate(data);
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Loading configuration...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>
            Configure basic Postfix identity and network interfaces.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Hostname (myhostname)"
            description="The internet hostname of this mail system. Usually the FQDN."
          >
            <Input {...register('myhostname')} placeholder="mail.example.com" />
          </FormField>

          <FormField
            label="Domain (mydomain)"
            description="The internet domain name of this mail system."
          >
            <Input {...register('mydomain')} placeholder="example.com" />
          </FormField>

          <FormField
            label="Origin (myorigin)"
            description="The domain name used in outbound mail. Usually $mydomain."
          >
            <Input {...register('myorigin')} placeholder="$mydomain" />
          </FormField>

          <FormField
            label="Network Interfaces (inet_interfaces)"
            description="Network interfaces to receive mail on. Use 'all', 'loopback-only', or specific addresses."
          >
            <Input {...register('inet_interfaces')} placeholder="all" />
          </FormField>

          <FormField
            label="IP Protocols (inet_protocols)"
            description="Enable IPv4, IPv6, or both. Options: all, ipv4, ipv6"
          >
            <Input {...register('inet_protocols')} placeholder="all" />
          </FormField>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset()}
          disabled={!isDirty}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
        <Button type="submit" disabled={!isDirty || submitMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          Submit for Review
        </Button>
      </div>
    </form>
  );
}

// Relay Config Form
function RelayConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: configApi.get,
  });

  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<PostfixConfig['relay']>({
    values: data?.config?.relay,
  });

  const submitMutation = useMutation({
    mutationFn: (relay: PostfixConfig['relay']) =>
      configApi.submit({ relay }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staged-config'] });
      queryClient.invalidateQueries({ queryKey: ['staged-diff'] });
      reset(undefined, { keepValues: true });
      toast({ title: 'Changes Staged', description: 'Changes staged for review. Click "Apply Changes" to activate.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const onSubmit = (data: PostfixConfig['relay']) => {
    submitMutation.mutate(data);
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Loading configuration...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Relay Settings</CardTitle>
          <CardDescription>
            Configure how mail is relayed to upstream servers and which networks can relay through this server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Relay Host (relayhost)"
            description="The upstream mail server to relay mail through. Format: [hostname]:port or empty for direct delivery."
          >
            <Input {...register('relayhost')} placeholder="[smtp.example.com]:587" />
          </FormField>

          <FormField
            label="My Networks (mynetworks)"
            description="Trusted networks that can relay mail through this server. One CIDR per line."
          >
            <Textarea
              {...register('mynetworks')}
              placeholder="127.0.0.0/8&#10;10.0.0.0/8&#10;192.168.0.0/16"
              rows={4}
              className="font-mono"
            />
          </FormField>

          <FormField
            label="Relay Domains (relay_domains)"
            description="Domains this server will relay mail for. Leave empty to relay for all."
          >
            <Textarea
              {...register('relay_domains')}
              placeholder="example.com&#10;sub.example.com"
              rows={3}
              className="font-mono"
            />
          </FormField>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset()}
          disabled={!isDirty}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
        <Button type="submit" disabled={!isDirty || submitMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          Submit for Review
        </Button>
      </div>
    </form>
  );
}

// TLS Config Form with Certificate Upload
function TLSConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState<'smtp' | 'smtpd' | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: configApi.get,
  });

  const { data: certData } = useQuery({
    queryKey: ['certificates'],
    queryFn: configApi.getCertificates,
  });

  const { register, handleSubmit, reset, watch, setValue, formState: { isDirty } } = useForm<PostfixConfig['tls']>({
    values: data?.config?.tls,
  });

  const submitMutation = useMutation({
    mutationFn: (tls: PostfixConfig['tls']) =>
      configApi.submit({ tls }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staged-config'] });
      queryClient.invalidateQueries({ queryKey: ['staged-diff'] });
      reset(undefined, { keepValues: true });
      toast({ title: 'Changes Staged', description: 'Changes staged for review. Click "Apply Changes" to activate.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleCertUpload = async (type: 'smtp' | 'smtpd', certFile: File, keyFile: File) => {
    setUploading(type);
    try {
      await configApi.uploadCertificate(type, certFile, keyFile);
      queryClient.invalidateQueries({ queryKey: ['certificates'] });
      queryClient.invalidateQueries({ queryKey: ['config'] });
      toast({
        title: 'Certificate uploaded',
        description: `${type.toUpperCase()} certificate installed successfully.`,
      });
    } catch (error) {
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Failed to upload certificate',
        variant: 'destructive',
      });
    } finally {
      setUploading(null);
    }
  };

  const onSubmit = (data: PostfixConfig['tls']) => {
    submitMutation.mutate(data);
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Loading configuration...</div>;
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>TLS Settings</CardTitle>
            <CardDescription>
              Configure TLS encryption for inbound and outbound connections.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
              <FormField
                label="Outbound TLS (smtp_tls_security_level)"
                description="TLS policy for outbound connections"
              >
                <Select
                  value={watch('smtp_tls_security_level')}
                  onValueChange={(v) => setValue('smtp_tls_security_level', v, { shouldDirty: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">none - No TLS</SelectItem>
                    <SelectItem value="may">may - Opportunistic TLS</SelectItem>
                    <SelectItem value="encrypt">encrypt - Mandatory TLS</SelectItem>
                    <SelectItem value="dane">dane - DANE verification</SelectItem>
                    <SelectItem value="verify">verify - Server cert verification</SelectItem>
                    <SelectItem value="secure">secure - Strict verification</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>

              <FormField
                label="Inbound TLS (smtpd_tls_security_level)"
                description="TLS policy for inbound connections"
              >
                <Select
                  value={watch('smtpd_tls_security_level')}
                  onValueChange={(v) => setValue('smtpd_tls_security_level', v, { shouldDirty: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select level" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">none - No TLS</SelectItem>
                    <SelectItem value="may">may - Opportunistic TLS</SelectItem>
                    <SelectItem value="encrypt">encrypt - Mandatory TLS</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            <FormField
              label="CA Certificate File"
              description="Path to the CA certificate bundle for verifying remote certificates"
            >
              <Input {...register('smtp_tls_CAfile')} placeholder="/etc/ssl/certs/ca-certificates.crt" />
            </FormField>

            <FormField
              label="TLS Log Level"
              description="Verbosity of TLS-related log messages (0-4)"
            >
              <Select
                value={watch('smtp_tls_loglevel')}
                onValueChange={(v) => setValue('smtp_tls_loglevel', v, { shouldDirty: true })}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 - Disabled</SelectItem>
                  <SelectItem value="1">1 - TLS handshake and cert info</SelectItem>
                  <SelectItem value="2">2 - + TLS negotiation</SelectItem>
                  <SelectItem value="3">3 - + TLS hex/ASCII dump</SelectItem>
                  <SelectItem value="4">4 - + Complete hex/ASCII dump</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => reset()}
            disabled={!isDirty}
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          <Button type="submit" disabled={!isDirty || submitMutation.isPending}>
            <Save className="h-4 w-4 mr-2" />
            Submit for Review
          </Button>
        </div>
      </form>

      {/* Certificate Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle>SSL Certificates</CardTitle>
          <CardDescription>
            Upload SSL certificates for TLS encryption. Both .crt and .key files are required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <CertificateUploadSection
            title="Outbound (SMTP Client) Certificate"
            description="Certificate used when connecting to upstream relay servers"
            type="smtp"
            certificate={certData?.certificates?.find((c) => c.type === 'smtp')}
            uploading={uploading === 'smtp'}
            onUpload={handleCertUpload}
          />

          <div className="border-t" />

          <CertificateUploadSection
            title="Inbound (SMTPD Server) Certificate"
            description="Certificate presented to clients connecting to this server"
            type="smtpd"
            certificate={certData?.certificates?.find((c) => c.type === 'smtpd')}
            uploading={uploading === 'smtpd'}
            onUpload={handleCertUpload}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// Certificate upload component
function CertificateUploadSection({
  title,
  description,
  type,
  certificate,
  uploading,
  onUpload,
}: {
  title: string;
  description: string;
  type: 'smtp' | 'smtpd';
  certificate?: TLSCertificate;
  uploading: boolean;
  onUpload: (type: 'smtp' | 'smtpd', certFile: File, keyFile: File) => void;
}) {
  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);

  const handleUpload = () => {
    if (certFile && keyFile) {
      onUpload(type, certFile, keyFile);
      setCertFile(null);
      setKeyFile(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-medium">{title}</h4>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {certificate ? (
        <Alert variant="success">
          <CheckCircle className="h-4 w-4" />
          <AlertTitle>Certificate Installed</AlertTitle>
          <AlertDescription className="space-y-1">
            <p><strong>Subject:</strong> {certificate.subject || 'N/A'}</p>
            <p><strong>Issuer:</strong> {certificate.issuer || 'N/A'}</p>
            {certificate.validTo && (
              <p><strong>Expires:</strong> {new Date(certificate.validTo).toLocaleDateString()}</p>
            )}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>No Certificate</AlertTitle>
          <AlertDescription>
            No certificate is currently configured for {type.toUpperCase()}.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${type}-cert`}>Certificate File (.crt/.pem)</Label>
          <div className="flex gap-2">
            <Input
              id={`${type}-cert`}
              type="file"
              accept=".crt,.pem,.cer"
              onChange={(e) => setCertFile(e.target.files?.[0] || null)}
              className="cursor-pointer"
            />
            {certFile && <FileBadge className="h-5 w-5 text-green-600 shrink-0 mt-2" />}
          </div>
          {certFile && <p className="text-sm text-muted-foreground">{certFile.name}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${type}-key`}>Private Key File (.key)</Label>
          <div className="flex gap-2">
            <Input
              id={`${type}-key`}
              type="file"
              accept=".key,.pem"
              onChange={(e) => setKeyFile(e.target.files?.[0] || null)}
              className="cursor-pointer"
            />
            {keyFile && <FileKey className="h-5 w-5 text-green-600 shrink-0 mt-2" />}
          </div>
          {keyFile && <p className="text-sm text-muted-foreground">{keyFile.name}</p>}
        </div>
      </div>

      <Button
        onClick={handleUpload}
        disabled={!certFile || !keyFile || uploading}
      >
        {uploading ? (
          <>
            <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            Uploading...
          </>
        ) : (
          <>
            <Upload className="h-4 w-4 mr-2" />
            Upload Certificate
          </>
        )}
      </Button>
    </div>
  );
}

// SASL Auth Config Form
function AuthConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [credentials, setCredentials] = useState({ username: '', password: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: configApi.get,
  });

  const { register, handleSubmit, reset, watch, setValue, formState: { isDirty } } = useForm<PostfixConfig['sasl']>({
    values: data?.config?.sasl,
  });

  const submitMutation = useMutation({
    mutationFn: (sasl: PostfixConfig['sasl']) =>
      configApi.submit({ sasl }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staged-config'] });
      queryClient.invalidateQueries({ queryKey: ['staged-diff'] });
      reset(undefined, { keepValues: true });
      toast({ title: 'Changes Staged', description: 'Changes staged for review. Click "Apply Changes" to activate.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const onSubmit = (data: PostfixConfig['sasl']) => {
    submitMutation.mutate(data);
  };

  const saslEnabled = watch('smtp_sasl_auth_enable') === 'yes';

  if (isLoading) {
    return <div className="text-muted-foreground">Loading configuration...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>SASL Authentication</CardTitle>
          <CardDescription>
            Configure authentication credentials for the upstream relay server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center space-x-4">
            <Switch
              checked={saslEnabled}
              onCheckedChange={(checked) =>
                setValue('smtp_sasl_auth_enable', checked ? 'yes' : 'no', { shouldDirty: true })
              }
            />
            <div>
              <Label>Enable SASL Authentication</Label>
              <p className="text-sm text-muted-foreground">
                Authenticate with the upstream relay server
              </p>
            </div>
          </div>

          {saslEnabled && (
            <>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Credentials Storage</AlertTitle>
                <AlertDescription>
                  Relay credentials are stored encrypted. The password map file path is managed automatically.
                </AlertDescription>
              </Alert>

              <div className="grid gap-4 md:grid-cols-2">
                <FormField
                  label="Relay Username"
                  description="Username for upstream relay authentication"
                >
                  <Input
                    value={credentials.username}
                    onChange={(e) => setCredentials((c) => ({ ...c, username: e.target.value }))}
                    placeholder="relay-user@example.com"
                  />
                </FormField>

                <FormField
                  label="Relay Password"
                  description="Password for upstream relay authentication"
                >
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={credentials.password}
                      onChange={(e) => setCredentials((c) => ({ ...c, password: e.target.value }))}
                      placeholder="••••••••"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </FormField>
              </div>

              <FormField
                label="Security Options"
                description="SASL security options (comma-separated: noplaintext, noactive, nodictionary, noanonymous)"
              >
                <Input
                  {...register('smtp_sasl_security_options')}
                  placeholder="noanonymous"
                />
              </FormField>

              <FormField
                label="TLS Security Options"
                description="Additional security options when using TLS"
              >
                <Input
                  {...register('smtp_sasl_tls_security_options')}
                  placeholder="noanonymous"
                />
              </FormField>
            </>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset()}
          disabled={!isDirty}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
        <Button type="submit" disabled={!isDirty || submitMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          Submit for Review
        </Button>
      </div>
    </form>
  );
}

// Restrictions Config Form
function RestrictionsConfig() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['config'],
    queryFn: configApi.get,
  });

  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<PostfixConfig['restrictions']>({
    values: data?.config?.restrictions,
  });

  const submitMutation = useMutation({
    mutationFn: (restrictions: PostfixConfig['restrictions']) =>
      configApi.submit({ restrictions }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staged-config'] });
      queryClient.invalidateQueries({ queryKey: ['staged-diff'] });
      reset(undefined, { keepValues: true });
      toast({ title: 'Changes Staged', description: 'Changes staged for review. Click "Apply Changes" to activate.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const onSubmit = (data: PostfixConfig['restrictions']) => {
    submitMutation.mutate(data);
  };

  if (isLoading) {
    return <div className="text-muted-foreground">Loading configuration...</div>;
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Relay Restrictions</CardTitle>
          <CardDescription>
            Configure sender and recipient restrictions. These control who can send and receive mail through this server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <FormField
            label="Relay Restrictions (smtpd_relay_restrictions)"
            description="Restrictions for relay access. One restriction per line."
          >
            <Textarea
              {...register('smtpd_relay_restrictions')}
              placeholder="permit_mynetworks&#10;permit_sasl_authenticated&#10;defer_unauth_destination"
              rows={4}
              className="font-mono"
            />
          </FormField>

          <FormField
            label="Recipient Restrictions (smtpd_recipient_restrictions)"
            description="Restrictions based on recipient address. One restriction per line."
          >
            <Textarea
              {...register('smtpd_recipient_restrictions')}
              placeholder="permit_mynetworks&#10;reject_unauth_destination"
              rows={4}
              className="font-mono"
            />
          </FormField>

          <FormField
            label="Sender Restrictions (smtpd_sender_restrictions)"
            description="Restrictions based on sender address. One restriction per line."
          >
            <Textarea
              {...register('smtpd_sender_restrictions')}
              placeholder="permit_mynetworks&#10;reject_unknown_sender_domain"
              rows={4}
              className="font-mono"
            />
          </FormField>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => reset()}
          disabled={!isDirty}
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
        <Button type="submit" disabled={!isDirty || submitMutation.isPending}>
          <Save className="h-4 w-4 mr-2" />
          Submit for Review
        </Button>
      </div>
    </form>
  );
}

// Config History
function ConfigHistory() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['config-history'],
    queryFn: configApi.history,
  });

  const rollbackMutation = useMutation({
    mutationFn: (version: number) => configApi.rollback(version),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['config-history'] });
      toast({ title: 'Rollback successful', description: 'Configuration has been rolled back.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Rollback failed', description: error.message, variant: 'destructive' });
    },
  });

  if (isLoading) {
    return <div className="text-muted-foreground">Loading history...</div>;
  }

  const versions = data?.versions || [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Configuration History</CardTitle>
          <CardDescription>
            View previous configurations and rollback if needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No configuration history available.
            </p>
          ) : (
            <div className="space-y-4">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <History className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Version {version.versionNumber}</p>
                      <p className="text-sm text-muted-foreground">
                        by {version.createdBy} on{' '}
                        {new Date(version.createdAt).toLocaleString()}
                      </p>
                      {version.notes && (
                        <p className="text-sm text-muted-foreground">{version.notes}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'px-2 py-1 text-xs rounded',
                        version.status === 'applied'
                          ? 'bg-green-100 text-green-800'
                          : version.status === 'rolled_back'
                          ? 'bg-gray-100 text-gray-800'
                          : 'bg-yellow-100 text-yellow-800'
                      )}
                    >
                      {version.status}
                    </span>
                    {version.status !== 'applied' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rollbackMutation.mutate(version.versionNumber)}
                        disabled={rollbackMutation.isPending}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        Rollback
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Main ConfigPage with staged changes panel
export function ConfigPage() {
  const { toast } = useToast();

  const validateMutation = useMutation({
    mutationFn: configApi.validate,
    onSuccess: (data) => {
      if (data.valid) {
        toast({ title: 'Validation passed', description: 'Configuration is valid.' });
      } else {
        toast({
          title: 'Validation failed',
          description: data.errors?.join('\n') || 'Configuration has errors.',
          variant: 'destructive',
        });
      }
    },
    onError: (error: Error) => {
      toast({ title: 'Validation error', description: error.message, variant: 'destructive' });
    },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Configuration</h1>
          <p className="text-muted-foreground">
            Manage Postfix relay configuration
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => validateMutation.mutate()}
            disabled={validateMutation.isPending}
          >
            {validateMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle className="h-4 w-4 mr-2" />
            )}
            Validate Config
          </Button>
        </div>
      </div>

      {/* Staged Changes Panel - shows pending changes across all tabs */}
      <div className="mb-6">
        <StagedChangesPanel />
      </div>

      <ConfigNav />

      <Routes>
        <Route index element={<GeneralConfig />} />
        <Route path="relay" element={<RelayConfig />} />
        <Route path="tls" element={<TLSConfig />} />
        <Route path="auth" element={<AuthConfig />} />
        <Route path="restrictions" element={<RestrictionsConfig />} />
        <Route path="history" element={<ConfigHistory />} />
      </Routes>
    </div>
  );
}
