import { create } from 'zustand';

export type AlertSeverity = 'warning' | 'critical';
export type AlertStatus = 'firing' | 'acknowledged' | 'resolved' | 'silenced';

export interface Alert {
  id: number;
  ruleId: number;
  ruleName: string;
  status: AlertStatus;
  severity: AlertSeverity;
  triggeredAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  silencedUntil?: string;
  context: Record<string, unknown>;
}

interface AlertsState {
  alerts: Alert[];
  firingCount: number;
  setAlerts: (alerts: Alert[]) => void;
  addAlert: (alert: Alert) => void;
  updateAlert: (id: number, updates: Partial<Alert>) => void;
  removeAlert: (id: number) => void;
}

export const useAlertsStore = create<AlertsState>((set, get) => ({
  alerts: [],
  firingCount: 0,

  setAlerts: (alerts) => {
    const firingCount = alerts.filter((a) => a.status === 'firing').length;
    set({ alerts, firingCount });
  },

  addAlert: (alert) => {
    const alerts = [...get().alerts, alert];
    const firingCount = alerts.filter((a) => a.status === 'firing').length;
    set({ alerts, firingCount });
  },

  updateAlert: (id, updates) => {
    const alerts = get().alerts.map((a) =>
      a.id === id ? { ...a, ...updates } : a
    );
    const firingCount = alerts.filter((a) => a.status === 'firing').length;
    set({ alerts, firingCount });
  },

  removeAlert: (id) => {
    const alerts = get().alerts.filter((a) => a.id !== id);
    const firingCount = alerts.filter((a) => a.status === 'firing').length;
    set({ alerts, firingCount });
  },
}));
