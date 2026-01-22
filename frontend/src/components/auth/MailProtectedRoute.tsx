import { Navigate, Outlet } from 'react-router-dom';
import { useMailStore } from '@/stores/mail';

interface MailProtectedRouteProps {
  children?: React.ReactNode;
}

export function MailProtectedRoute({ children }: MailProtectedRouteProps) {
  const isAuthenticated = useMailStore((state) => state.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
