import React, { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { applyUpdate } from '@/lib/pwa';

/**
 * Modal obrigatório exibido quando uma nova versão do PWA está disponível.
 * Bloqueia toda interação com a aplicação até o usuário atualizar.
 */
export default function PWAUpdatePrompt() {
  const [visible, setVisible] = useState(false);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const handler = () => setVisible(true);
    window.addEventListener('pwa-update-available', handler);
    return () => window.removeEventListener('pwa-update-available', handler);
  }, []);

  if (!visible) return null;

  const handleUpdate = () => {
    setUpdating(true);
    applyUpdate();
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backdropFilter: 'blur(6px)', backgroundColor: 'rgba(0,0,0,0.6)' }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8 flex flex-col items-center text-center">
        {/* Ícone */}
        <div className="w-16 h-16 rounded-full bg-blue-50 flex items-center justify-center mb-5">
          <RefreshCw className={`w-8 h-8 text-blue-600 ${updating ? 'animate-spin' : ''}`} />
        </div>

        {/* Título */}
        <h2 className="text-xl font-bold text-gray-900 mb-2">
          Nova versão disponível!
        </h2>

        {/* Mensagem */}
        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          Uma versão mais recente do <strong className="text-gray-700">ChemCtrl</strong> foi publicada.
          Para continuar utilizando o sistema, é necessário atualizar o aplicativo.
        </p>

        {/* Botão único — sem opção de fechar */}
        <button
          onClick={handleUpdate}
          disabled={updating}
          className="w-full py-3 rounded-xl font-semibold text-white text-sm transition-all disabled:opacity-70"
          style={{ background: '#2575D1' }}
        >
          {updating ? 'Atualizando...' : 'Atualizar agora'}
        </button>
      </div>
    </div>
  );
}
