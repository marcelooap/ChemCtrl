import React from 'react';
import { useTranslation } from 'react-i18next';

export default function InvoiceToggle({ invoiced, onToggle }) {
  const { t } = useTranslation();

  return (
    <button
      onClick={onToggle}
      title={invoiced ? t('production.invoice.sentTitle') : t('production.invoice.pendingTitle')}
      className="inline-flex items-center gap-2"
    >
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${
          invoiced ? 'bg-green-500' : 'bg-amber-400'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
            invoiced ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </span>
      <span className={`text-xs font-semibold ${invoiced ? 'text-green-700' : 'text-amber-700'}`}>
        {invoiced ? t('production.invoice.sent') : t('production.invoice.pending')}
      </span>
    </button>
  );
}
