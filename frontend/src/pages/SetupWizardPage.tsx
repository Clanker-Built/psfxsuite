import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  ArrowLeft,
  ArrowRight,
  Check,
  Shield,
  Eye,
  EyeOff,
  ExternalLink,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { configApi } from '@/lib/api';

// Email provider configurations
const EMAIL_PROVIDERS = {
  microsoft365: {
    name: 'Microsoft 365 / Office 365',
    icon: '📧',
    description: 'Relay through Microsoft 365 SMTP relay service',
    relayhost: '[smtp.office365.com]:587',
    tls: {
      smtp_tls_security_level: 'encrypt',
      smtp_tls_wrappermode: 'no',
    },
    sasl: {
      smtp_sasl_auth_enable: 'yes',
      smtp_sasl_security_options: 'noanonymous',
      smtp_sasl_tls_security_options: 'noanonymous',
    },
    instructions: [
      'You need a Microsoft 365 account with SMTP AUTH enabled',
      'Go to Microsoft 365 Admin Center > Settings > Org settings > Modern authentication',
      'Ensure SMTP AUTH is enabled for your organization',
      'Use your full email address as the username',
      'You may need an App Password if MFA is enabled',
    ],
    links: [
      { label: 'Microsoft SMTP AUTH documentation', url: 'https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/authenticated-client-smtp-submission' },
    ],
  },
  gmail: {
    name: 'Google Workspace / Gmail',
    icon: '📬',
    description: 'Relay through Gmail SMTP servers',
    relayhost: '[smtp.gmail.com]:587',
    tls: {
      smtp_tls_security_level: 'encrypt',
      smtp_tls_wrappermode: 'no',
    },
    sasl: {
      smtp_sasl_auth_enable: 'yes',
      smtp_sasl_security_options: 'noanonymous',
      smtp_sasl_tls_security_options: 'noanonymous',
    },
    instructions: [
      'You need a Google Workspace or Gmail account',
      'Enable "Less secure app access" OR use an App Password',
      'For App Passwords: Go to Google Account > Security > 2-Step Verification > App passwords',
      'Generate a new App Password for "Mail" on "Other (Custom name)"',
      'Use your full email address as the username',
    ],
    links: [
      { label: 'Google App Passwords', url: 'https://support.google.com/accounts/answer/185833' },
      { label: 'Gmail SMTP settings', url: 'https://support.google.com/mail/answer/7126229' },
    ],
  },
  aws_ses: {
    name: 'Amazon SES',
    icon: '☁️',
    description: 'Relay through Amazon Simple Email Service',
    relayhost: '[email-smtp.us-east-1.amazonaws.com]:587',
    tls: {
      smtp_tls_security_level: 'encrypt',
      smtp_tls_wrappermode: 'no',
    },
    sasl: {
      smtp_sasl_auth_enable: 'yes',
      smtp_sasl_security_options: 'noanonymous',
      smtp_sasl_tls_security_options: 'noanonymous',
    },
    instructions: [
      'You need an AWS account with SES configured',
      'Verify your sending domain or email addresses in SES',
      'Create SMTP credentials in SES Console > SMTP Settings',
      'Note: SMTP credentials are different from IAM credentials',
      'Update the relay host region if not using us-east-1',
    ],
    regions: [
      { label: 'US East (N. Virginia)', value: 'email-smtp.us-east-1.amazonaws.com' },
      { label: 'US East (Ohio)', value: 'email-smtp.us-east-2.amazonaws.com' },
      { label: 'US West (Oregon)', value: 'email-smtp.us-west-2.amazonaws.com' },
      { label: 'EU (Ireland)', value: 'email-smtp.eu-west-1.amazonaws.com' },
      { label: 'EU (Frankfurt)', value: 'email-smtp.eu-central-1.amazonaws.com' },
      { label: 'Asia Pacific (Mumbai)', value: 'email-smtp.ap-south-1.amazonaws.com' },
      { label: 'Asia Pacific (Singapore)', value: 'email-smtp.ap-southeast-1.amazonaws.com' },
      { label: 'Asia Pacific (Sydney)', value: 'email-smtp.ap-southeast-2.amazonaws.com' },
      { label: 'Asia Pacific (Tokyo)', value: 'email-smtp.ap-northeast-1.amazonaws.com' },
    ],
    links: [
      { label: 'AWS SES SMTP credentials', url: 'https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html' },
      { label: 'AWS SES endpoints', url: 'https://docs.aws.amazon.com/ses/latest/dg/regions.html' },
    ],
  },
  sendgrid: {
    name: 'SendGrid',
    icon: '📤',
    description: 'Relay through Twilio SendGrid',
    relayhost: '[smtp.sendgrid.net]:587',
    tls: {
      smtp_tls_security_level: 'encrypt',
      smtp_tls_wrappermode: 'no',
    },
    sasl: {
      smtp_sasl_auth_enable: 'yes',
      smtp_sasl_security_options: 'noanonymous',
      smtp_sasl_tls_security_options: 'noanonymous',
    },
    instructions: [
      'You need a SendGrid account',
      'Create an API key with "Mail Send" permissions',
      'The username is always "apikey" (literally)',
      'The password is your API key',
      'Verify your sender identity (domain or single sender)',
    ],
    links: [
      { label: 'SendGrid SMTP integration', url: 'https://docs.sendgrid.com/for-developers/sending-email/integrating-with-the-smtp-api' },
      { label: 'Create API key', url: 'https://app.sendgrid.com/settings/api_keys' },
    ],
  },
  mailgun: {
    name: 'Mailgun',
    icon: '📨',
    description: 'Relay through Mailgun SMTP',
    relayhost: '[smtp.mailgun.org]:587',
    tls: {
      smtp_tls_security_level: 'encrypt',
      smtp_tls_wrappermode: 'no',
    },
    sasl: {
      smtp_sasl_auth_enable: 'yes',
      smtp_sasl_security_options: 'noanonymous',
      smtp_sasl_tls_security_options: 'noanonymous',
    },
    instructions: [
      'You need a Mailgun account with a verified domain',
      'Find your SMTP credentials in Domain Settings > Sending > SMTP',
      'Username format: postmaster@your-domain.com',
      'Use your domain\'s SMTP password',
    ],
    links: [
      { label: 'Mailgun SMTP documentation', url: 'https://documentation.mailgun.com/en/latest/user_manual.html#sending-via-smtp' },
    ],
  },
  custom: {
    name: 'Custom SMTP Server',
    icon: '⚙️',
    description: 'Configure a custom SMTP relay server',
    relayhost: '',
    tls: {
      smtp_tls_security_level: 'may',
    },
    sasl: {
      smtp_sasl_auth_enable: 'no',
    },
    instructions: [
      'Enter your SMTP server details manually',
      'Format: [hostname]:port (brackets required for hostname)',
      'Common ports: 25 (plain), 587 (submission), 465 (SMTPS)',
    ],
    links: [],
  },
} as const;

type ProviderKey = keyof typeof EMAIL_PROVIDERS;
type EmailProvider = (typeof EMAIL_PROVIDERS)[ProviderKey];

// Type guard to check if provider has regions
function hasRegions(provider: EmailProvider): provider is EmailProvider & { regions: readonly { readonly label: string; readonly value: string }[] } {
  return 'regions' in provider && Array.isArray(provider.regions);
}

interface WizardState {
  provider: ProviderKey | null;
  step: number;
  hostname: string;
  domain: string;
  mynetworks: string;
  relayhost: string;
  username: string;
  password: string;
  region?: string;
}

export function SetupWizardPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<WizardState>({
    provider: null,
    step: 0,
    hostname: '',
    domain: '',
    mynetworks: '127.0.0.0/8\n10.0.0.0/8\n172.16.0.0/12\n192.168.0.0/16',
    relayhost: '',
    username: '',
    password: '',
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const provider = state.provider ? EMAIL_PROVIDERS[state.provider] : null;

      // Build config updates
      const general = {
        myhostname: state.hostname,
        mydomain: state.domain,
        myorigin: '$mydomain',
        inet_interfaces: 'all',
        inet_protocols: 'all',
      };

      const relay = {
        relayhost: state.relayhost,
        mynetworks: state.mynetworks.split('\n').join(', '),
        relay_domains: '',
      };

      const tls = provider?.tls || {
        smtp_tls_security_level: 'may',
      };

      const sasl = {
        ...provider?.sasl,
        smtp_sasl_password_maps: state.username ? 'hash:/etc/postfix/sasl_passwd' : '',
      };

      // Update config
      await configApi.update({ general } as any);
      await configApi.update({ relay } as any);
      await configApi.update({ tls } as any);
      await configApi.update({ sasl } as any);

      // If credentials provided, save them (backend will handle securely)
      if (state.username && state.password) {
        await configApi.saveCredentials({
          relayhost: state.relayhost,
          username: state.username,
          password: state.password,
        });
      }

      // Validate and apply
      const validation = await configApi.validate();
      if (!validation.valid) {
        throw new Error(validation.errors?.join(', ') || 'Validation failed');
      }

      return configApi.apply();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
      queryClient.invalidateQueries({ queryKey: ['status'] });
      toast({
        title: 'Configuration applied',
        description: 'Your relay has been configured and Postfix reloaded.',
      });
      navigate('/');
    },
    onError: (error: Error) => {
      toast({
        title: 'Configuration failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const selectProvider = (key: ProviderKey) => {
    const provider = EMAIL_PROVIDERS[key];
    setState({
      ...state,
      provider: key,
      step: 1,
      relayhost: provider.relayhost,
    });
  };

  const nextStep = () => setState({ ...state, step: state.step + 1 });
  const prevStep = () => setState({ ...state, step: state.step - 1 });

  // Step 0: Select provider
  if (state.step === 0) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Setup Wizard</h1>
          <p className="text-muted-foreground">
            Configure your Postfix relay in minutes by selecting your email provider
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Object.entries(EMAIL_PROVIDERS).map(([key, provider]) => (
            <Card
              key={key}
              className={cn(
                'cursor-pointer transition-all hover:border-primary hover:shadow-md',
                state.provider === key && 'border-primary ring-2 ring-primary'
              )}
              onClick={() => selectProvider(key as ProviderKey)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{provider.icon}</span>
                  <CardTitle className="text-lg">{provider.name}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <CardDescription>{provider.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => navigate('/config')}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Manual Configuration
          </Button>
        </div>
      </div>
    );
  }

  const provider = state.provider ? EMAIL_PROVIDERS[state.provider] : null;
  if (!provider) return null;

  // Step 1: Provider instructions
  if (state.step === 1) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <span>{provider.icon}</span>
            {provider.name}
          </h1>
          <p className="text-muted-foreground">
            Before continuing, make sure you have the following ready
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Prerequisites
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {provider.instructions.map((instruction, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
                  <span>{instruction}</span>
                </li>
              ))}
            </ul>

            {provider.links && provider.links.length > 0 && (
              <div className="pt-4 border-t">
                <p className="text-sm font-medium mb-2">Helpful links:</p>
                <div className="space-y-1">
                  {provider.links.map((link, i) => (
                    <a
                      key={i}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-sm text-blue-600 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => setState({ ...state, step: 0, provider: null })}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={nextStep}>
            I'm Ready
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // Step 2: Basic settings
  if (state.step === 2) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Server Identity</h1>
          <p className="text-muted-foreground">
            Configure how this mail server identifies itself
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hostname">Mail Server Hostname</Label>
              <Input
                id="hostname"
                value={state.hostname}
                onChange={(e) => setState({ ...state, hostname: e.target.value })}
                placeholder="mail.example.com"
              />
              <p className="text-sm text-muted-foreground">
                The fully qualified domain name of this server
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="domain">Mail Domain</Label>
              <Input
                id="domain"
                value={state.domain}
                onChange={(e) => setState({ ...state, domain: e.target.value })}
                placeholder="example.com"
              />
              <p className="text-sm text-muted-foreground">
                The domain this server sends mail for
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mynetworks">Allowed Networks</Label>
              <textarea
                id="mynetworks"
                value={state.mynetworks}
                onChange={(e) => setState({ ...state, mynetworks: e.target.value })}
                className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                placeholder="127.0.0.0/8&#10;10.0.0.0/8"
              />
              <p className="text-sm text-muted-foreground">
                Networks allowed to relay mail through this server (one per line)
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button variant="outline" onClick={prevStep}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={nextStep} disabled={!state.hostname || !state.domain}>
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // Step 3: Relay credentials
  if (state.step === 3) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Relay Credentials</h1>
          <p className="text-muted-foreground">
            Enter your {provider.name} SMTP credentials
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            {hasRegions(provider) && (
              <div className="space-y-2">
                <Label htmlFor="region">Region</Label>
                <select
                  id="region"
                  value={state.region || provider.regions[0].value}
                  onChange={(e) => setState({
                    ...state,
                    region: e.target.value,
                    relayhost: `[${e.target.value}]:587`,
                  })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {provider.regions.map((region) => (
                    <option key={region.value} value={region.value}>
                      {region.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="relayhost">Relay Host</Label>
              <Input
                id="relayhost"
                value={state.relayhost}
                onChange={(e) => setState({ ...state, relayhost: e.target.value })}
                placeholder="[smtp.example.com]:587"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">
                {state.provider === 'sendgrid' ? 'Username (use "apikey")' : 'Username / Email'}
              </Label>
              <Input
                id="username"
                value={state.username}
                onChange={(e) => setState({ ...state, username: e.target.value })}
                placeholder={state.provider === 'sendgrid' ? 'apikey' : 'user@example.com'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                {state.provider === 'sendgrid' ? 'API Key' :
                 state.provider === 'gmail' ? 'App Password' : 'Password'}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={state.password}
                  onChange={(e) => setState({ ...state, password: e.target.value })}
                  placeholder="••••••••••••"
                  className="pr-10"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Alert>
              <Shield className="h-4 w-4" />
              <AlertTitle>Secure Storage</AlertTitle>
              <AlertDescription>
                Credentials are encrypted at rest and stored with restricted file permissions.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>

        <div className="flex justify-between">
          <Button variant="outline" onClick={prevStep}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={nextStep} disabled={!state.relayhost}>
            Continue
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </div>
    );
  }

  // Step 4: Review and apply
  if (state.step === 4) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Review Configuration</h1>
          <p className="text-muted-foreground">
            Review your settings before applying
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Configuration Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Provider</p>
                <p className="font-medium">{provider.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Relay Host</p>
                <p className="font-mono text-sm">{state.relayhost}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Hostname</p>
                <p className="font-mono text-sm">{state.hostname}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Domain</p>
                <p className="font-mono text-sm">{state.domain}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Username</p>
                <p className="font-mono text-sm">{state.username || '(none)'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">TLS</p>
                <p className="font-mono text-sm">{provider.tls?.smtp_tls_security_level || 'may'}</p>
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-muted-foreground">Allowed Networks</p>
              <pre className="mt-1 p-2 bg-muted rounded text-sm font-mono">
                {state.mynetworks}
              </pre>
            </div>
          </CardContent>
        </Card>

        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Configuration will be applied</AlertTitle>
          <AlertDescription>
            This will update your Postfix configuration and reload the service.
            Make sure you have verified your settings.
          </AlertDescription>
        </Alert>

        <div className="flex justify-between">
          <Button variant="outline" onClick={prevStep}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button onClick={() => applyMutation.mutate()} disabled={applyMutation.isPending}>
            {applyMutation.isPending ? (
              <>Applying...</>
            ) : (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Apply Configuration
              </>
            )}
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
