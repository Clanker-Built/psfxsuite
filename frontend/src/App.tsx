import { useEffect, Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
// Auth store is used by api.ts error handling
import { Layout } from '@/components/layout/Layout';
import { MailAppLayout } from '@/components/layout/MailAppLayout';
import { MailLoginPage } from '@/pages/MailLoginPage';
import { AdminLoginPage } from '@/pages/AdminLoginPage';
import { SetupPage } from '@/pages/SetupPage';
import { Toaster } from '@/components/ui/toaster';
import { initCSRF, setupApi } from '@/lib/api';
import { MailProtectedRoute, AdminProtectedRoute } from '@/components/auth';

// Lazy load pages for better performance
const SuiteDashboard = lazy(() => import('@/pages/SuiteDashboard'));
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const ConfigPage = lazy(() => import('@/pages/ConfigPage').then(m => ({ default: m.ConfigPage })));
const LogsPage = lazy(() => import('@/pages/LogsPage').then(m => ({ default: m.LogsPage })));
const AlertsPage = lazy(() => import('@/pages/AlertsPage').then(m => ({ default: m.AlertsPage })));
const QueuePage = lazy(() => import('@/pages/QueuePage').then(m => ({ default: m.QueuePage })));
const AuditPage = lazy(() => import('@/pages/AuditPage').then(m => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const SetupWizardPage = lazy(() => import('@/pages/SetupWizardPage').then(m => ({ default: m.SetupWizardPage })));
const TransportMapsPage = lazy(() => import('@/pages/TransportMapsPage').then(m => ({ default: m.TransportMapsPage })));
const UsersPage = lazy(() => import('@/pages/UsersPage').then(m => ({ default: m.UsersPage })));

// PSFXAdmin pages (lazy loaded)
const DomainsPage = lazy(() => import('@/pages/admin/DomainsPage'));
const MailboxesPage = lazy(() => import('@/pages/admin/MailboxesPage'));
const AliasesPage = lazy(() => import('@/pages/admin/AliasesPage'));

// PSFXMail pages (lazy loaded)
const MailInbox = lazy(() => import('@/pages/mail/Inbox'));
const MailCompose = lazy(() => import('@/pages/mail/Compose'));
const MailFolder = lazy(() => import('@/pages/mail/FolderView'));
const MailMessage = lazy(() => import('@/pages/mail/MessageView'));

// Mail feature pages
const SearchPage = lazy(() => import('@/pages/mail/SearchPage'));
const ContactsPage = lazy(() => import('@/pages/mail/ContactsPage').catch(() => ({ default: PlaceholderPage('Contacts') })));
const MailSettingsPage = lazy(() => import('@/pages/mail/MailSettingsPage').catch(() => ({ default: PlaceholderPage('Mail Settings') })));

// Placeholder component for pages not yet created
function PlaceholderPage(name: string) {
  return function Placeholder() {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">{name}</h2>
          <p className="text-muted-foreground">Coming soon...</p>
        </div>
      </div>
    );
  };
}

// Loading fallback
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-muted-foreground">Loading...</div>
    </div>
  );
}

// Route that redirects to setup if needed (only for admin routes)
function SetupGuard({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { data: setupStatus, isLoading } = useQuery({
    queryKey: ['setup-status'],
    queryFn: setupApi.getStatus,
    staleTime: 5 * 60 * 1000,
    // Only check setup status for admin routes
    enabled: location.pathname.startsWith('/admin') || location.pathname === '/setup',
  });

  // While loading setup status for admin routes
  if (isLoading && (location.pathname.startsWith('/admin') || location.pathname === '/setup')) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // If setup is required and we're trying to access admin, redirect to setup
  if (setupStatus?.setupRequired && location.pathname.startsWith('/admin') && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  // If setup is complete and we're on setup page, redirect to admin login
  if (!setupStatus?.setupRequired && location.pathname === '/setup') {
    return <Navigate to="/admin/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  // Initialize CSRF token on app mount
  useEffect(() => {
    initCSRF();
  }, []);

  return (
    <>
      <SetupGuard>
        <Routes>
          {/* ==================== PUBLIC ROUTES ==================== */}

          {/* Mail login - default landing page */}
          <Route path="/" element={<MailLoginPage />} />

          {/* Admin login */}
          <Route path="/admin/login" element={<AdminLoginPage />} />

          {/* Setup wizard */}
          <Route path="/setup" element={<SetupPage />} />

          {/* ==================== MAIL ROUTES (Mail Auth Required) ==================== */}

          <Route
            element={
              <MailProtectedRoute>
                <MailAppLayout />
              </MailProtectedRoute>
            }
          >
            {/* Inbox */}
            <Route
              path="/inbox"
              element={
                <Suspense fallback={<PageLoader />}>
                  <MailInbox />
                </Suspense>
              }
            />

            {/* Compose */}
            <Route
              path="/compose"
              element={
                <Suspense fallback={<PageLoader />}>
                  <MailCompose />
                </Suspense>
              }
            />

            {/* View message */}
            <Route
              path="/message/:uid"
              element={
                <Suspense fallback={<PageLoader />}>
                  <MailMessage />
                </Suspense>
              }
            />

            {/* Folder view */}
            <Route
              path="/folder/:folder"
              element={
                <Suspense fallback={<PageLoader />}>
                  <MailFolder />
                </Suspense>
              }
            />

            {/* Search */}
            <Route
              path="/search"
              element={
                <Suspense fallback={<PageLoader />}>
                  <SearchPage />
                </Suspense>
              }
            />

            {/* Contacts */}
            <Route
              path="/contacts"
              element={
                <Suspense fallback={<PageLoader />}>
                  <ContactsPage />
                </Suspense>
              }
            />

            {/* Mail settings */}
            <Route
              path="/settings"
              element={
                <Suspense fallback={<PageLoader />}>
                  <MailSettingsPage />
                </Suspense>
              }
            />
          </Route>

          {/* ==================== ADMIN ROUTES (Admin Auth Required) ==================== */}

          <Route
            element={
              <AdminProtectedRoute>
                <Layout />
              </AdminProtectedRoute>
            }
          >
            {/* Admin Dashboard */}
            <Route
              path="/admin"
              element={
                <Suspense fallback={<PageLoader />}>
                  <SuiteDashboard />
                </Suspense>
              }
            />

            {/* PSFXRelay routes */}
            <Route
              path="/admin/relay"
              element={
                <Suspense fallback={<PageLoader />}>
                  <DashboardPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/relay/wizard"
              element={
                <Suspense fallback={<PageLoader />}>
                  <SetupWizardPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/relay/config/*"
              element={
                <Suspense fallback={<PageLoader />}>
                  <ConfigPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/relay/routing"
              element={
                <Suspense fallback={<PageLoader />}>
                  <TransportMapsPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/relay/logs"
              element={
                <Suspense fallback={<PageLoader />}>
                  <LogsPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/relay/alerts/*"
              element={
                <Suspense fallback={<PageLoader />}>
                  <AlertsPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/relay/queue"
              element={
                <Suspense fallback={<PageLoader />}>
                  <QueuePage />
                </Suspense>
              }
            />
            <Route
              path="/admin/relay/audit"
              element={
                <Suspense fallback={<PageLoader />}>
                  <AuditPage />
                </Suspense>
              }
            />

            {/* PSFXAdmin routes */}
            <Route
              path="/admin/domains"
              element={
                <Suspense fallback={<PageLoader />}>
                  <DomainsPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/mailboxes"
              element={
                <Suspense fallback={<PageLoader />}>
                  <MailboxesPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/aliases"
              element={
                <Suspense fallback={<PageLoader />}>
                  <AliasesPage />
                </Suspense>
              }
            />
            <Route
              path="/admin/users"
              element={
                <Suspense fallback={<PageLoader />}>
                  <UsersPage />
                </Suspense>
              }
            />

            {/* Admin settings */}
            <Route
              path="/admin/settings/*"
              element={
                <Suspense fallback={<PageLoader />}>
                  <SettingsPage />
                </Suspense>
              }
            />
          </Route>

          {/* ==================== LEGACY REDIRECTS ==================== */}

          {/* Old login redirects */}
          <Route path="/login" element={<Navigate to="/admin/login" replace />} />

          {/* Old mail routes */}
          <Route path="/mail" element={<Navigate to="/inbox" replace />} />
          <Route path="/mail/compose" element={<Navigate to="/compose" replace />} />
          <Route path="/mail/message/:uid" element={<Navigate to="/message/:uid" replace />} />
          <Route path="/mail/folder/:folder" element={<Navigate to="/folder/:folder" replace />} />

          {/* Old relay routes (now under /admin/relay) */}
          <Route path="/relay" element={<Navigate to="/admin/relay" replace />} />
          <Route path="/relay/*" element={<Navigate to="/admin/relay" replace />} />

          {/* Old root routes (now under /admin) */}
          <Route path="/wizard" element={<Navigate to="/admin/relay/wizard" replace />} />
          <Route path="/config/*" element={<Navigate to="/admin/relay/config" replace />} />
          <Route path="/routing" element={<Navigate to="/admin/relay/routing" replace />} />
          <Route path="/logs" element={<Navigate to="/admin/relay/logs" replace />} />
          <Route path="/alerts/*" element={<Navigate to="/admin/relay/alerts" replace />} />
          <Route path="/queue" element={<Navigate to="/admin/relay/queue" replace />} />
          <Route path="/audit" element={<Navigate to="/admin/relay/audit" replace />} />
          <Route path="/users" element={<Navigate to="/admin/users" replace />} />
          <Route path="/admin/audit" element={<Navigate to="/admin/relay/audit" replace />} />

          {/* Catch all - redirect to mail login */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SetupGuard>
      <Toaster />
    </>
  );
}
