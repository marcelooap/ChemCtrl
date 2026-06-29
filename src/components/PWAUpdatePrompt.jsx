import React, { useState, useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { applyUpdate } from '@/lib/pwa';

/**
 * Fixed banner that appears when a new version of the PWA is available.
 * The user can update immediately or dismiss the notification.
 */
export default function PWAUpdatePrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener('pwa-update-available', handler);
    return () => window.removeEventListener('pwa-update-available', handler);
  }, []);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] max-w-sm animate-in slide-in-from-bottom-5 duration-300">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 p-4 pr-10 relative">
        <button
          onClick={() => setVisible(false)}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Fechar"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
            <RefreshCw className="w-5 h-5 text-[#2575D1]" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-sm text-gray-900">Nova versão disponível</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Uma nova versão do ChemCtrl está pronta para uso.
            </p>
            <Button
              onClick={applyUpdate}
              size="sm"
              className="mt-3 w-full"
              style={{ background: '#2575D1' }}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Atualizar agora
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
