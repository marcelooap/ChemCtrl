import React from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUpdate } from '../hooks/useUpdate';

export function UpdateModal() {
  const { updateAvailable, currentVersion, availableVersion, isUpdating, applyUpdate } =
    useUpdate();

  if (!updateAvailable) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ backdropFilter: 'blur(8px)', backgroundColor: 'rgba(0,0,0,0.55)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 flex flex-col items-center text-center">
        <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-5">
          <RefreshCw
            className={`w-8 h-8 text-[#2575D1] ${isUpdating ? 'animate-spin' : ''}`}
          />
        </div>

        <h2
          id="update-modal-title"
          className="text-xl font-bold mb-2"
          style={{ color: '#1A1A2E' }}
        >
          Nova versão disponível
        </h2>

        <p className="text-sm text-muted-foreground leading-relaxed mb-5">
          Uma nova versão do <strong className="text-foreground">ChemCtrl</strong> foi
          publicada.
          <br />
          <br />
          Atualize o aplicativo para utilizar os recursos mais recentes e correções
          disponíveis.
        </p>

        <div className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 mb-6 text-left text-sm space-y-2">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Versão atual:</span>
            <span className="font-medium" style={{ color: '#1A1A2E' }}>
              {currentVersion}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">Nova versão:</span>
            <span className="font-semibold text-[#2575D1]">
              {availableVersion ?? '...'}
            </span>
          </div>
        </div>

        <Button
          onClick={() => applyUpdate()}
          disabled={isUpdating}
          className="w-full py-6 rounded-xl font-semibold text-sm bg-[#2575D1] hover:bg-[#2575D1]/90 text-white"
        >
          {isUpdating ? 'Atualizando...' : 'Atualizar Agora'}
        </Button>
      </div>
    </div>
  );
}
