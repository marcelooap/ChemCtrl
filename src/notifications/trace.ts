/**
 * Trace logs do fluxo de notificações.
 * Ativo em DEV ou com localStorage.setItem('chemctrl_notif_trace', '1')
 */
export function isNotifTraceEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem('chemctrl_notif_trace') === '1';
  } catch {
    return false;
  }
}

export function notifTrace(step: string, detail?: unknown): void {
  if (!isNotifTraceEnabled()) return;
  if (detail !== undefined) {
    console.log(`[NotifTrace] ${step}`, detail);
  } else {
    console.log(`[NotifTrace] ${step}`);
  }
}
