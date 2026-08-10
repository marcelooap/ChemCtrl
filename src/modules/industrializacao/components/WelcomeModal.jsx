import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

export default function WelcomeModal({ user, onClose }) {
  const { t } = useTranslation();
  if (!user) return null;
  const name = user.nome || user.full_name || user.usuario || t('common.defaultUser');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/85 backdrop-blur-md">
      <div className="relative bg-card rounded-2xl shadow-2xl border border-border px-8 py-10 max-w-md w-[90%] text-center">
        <button onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-muted transition-colors">
          <X className="w-5 h-5 text-muted-foreground" />
        </button>

        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 text-2xl font-bold text-white"
          style={{ background: '#2575D1' }}>
          {name.charAt(0).toUpperCase()}
        </div>

        <h2 className="text-xl font-bold mb-1">
          {t('welcome.title', { name })}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {t('welcome.subtitle')}
        </p>

        <button onClick={onClose}
          className="w-full py-2.5 rounded-lg text-white font-medium text-sm transition-opacity hover:opacity-90"
          style={{ background: '#2575D1' }}>
          {t('welcome.continue')}
        </button>
      </div>
    </div>
  );
}
