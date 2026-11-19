import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { useUpdate } from '../hooks/useUpdate';

/**
 * Modal de atualização PWA.
 * Renderizado via portal em document.body com pointer-events:auto —
 * necessário porque Dialog/Sheet/AlertDialog do Radix aplicam
 * pointer-events:none no body enquanto abertos; sem portal o botão
 * fica visível mas inclicável.
 */
export function UpdateModal() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { isAuthenticated, loading: authLoading } = useInternalAuth();
  const { updateAvailable, currentVersion, nextVersion, isUpdating, applyUpdate } =
    useUpdate();

  // Public / unauthenticated surfaces must never be blocked by update UI
  if (
    pathname.startsWith('/consulta/') ||
    pathname.startsWith('/consulta-produto/') ||
    pathname.startsWith('/consulta-equipamento/') ||
    pathname.startsWith('/login')
  ) {
    return null;
  }
  if (authLoading || !isAuthenticated) return null;
  if (!updateAvailable) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4"
      style={{
        backdropFilter: 'blur(8px)',
        backgroundColor: 'rgba(0,0,0,0.55)',
        // Restaura cliques mesmo com body em pointer-events:none (Radix modal)
        pointerEvents: 'auto',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
      data-chemctrl-update-modal="true"
    >
      <div
        className="bg-card rounded-2xl shadow-2xl w-full max-w-md p-8 flex flex-col items-center text-center"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-5">
          <RefreshCw
            className={`w-8 h-8 text-[#2575D1] ${isUpdating ? 'animate-spin' : ''}`}
          />
        </div>

        <h2 id="update-modal-title" className="text-xl font-bold mb-2">
          {t('pwa.update.title')}
        </h2>

        <p className="text-sm text-muted-foreground leading-relaxed mb-5">
          {t('pwa.update.description')}
          <br />
          <br />
          {t('pwa.update.instruction')}
        </p>

        <div className="w-full rounded-xl border border-border bg-muted/50 px-4 py-3 mb-6 text-left text-sm space-y-2">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('pwa.update.currentVersion')}</span>
            <span className="font-medium">{currentVersion}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('pwa.update.newVersion')}</span>
            <span className="font-semibold text-[#2575D1]">
              {nextVersion ?? '...'}
            </span>
          </div>
        </div>

        <Button
          type="button"
          onClick={() => {
            void applyUpdate();
          }}
          disabled={isUpdating}
          className="w-full py-6 rounded-xl font-semibold text-sm bg-[#2575D1] hover:bg-[#2575D1]/90 text-white"
        >
          {isUpdating ? t('pwa.update.updating') : t('pwa.update.updateNow')}
        </Button>
      </div>
    </div>,
    document.body
  );
}
