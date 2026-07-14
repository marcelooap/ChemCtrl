import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertCircle, Loader2 } from 'lucide-react';

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  onConfirm,
  confirmLabel,
  cancelLabel,
  confirmColor = '#2575D1',
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!loading) onOpenChange(v); }}>
      <DialogContent className="max-w-md" onInteractOutside={(e) => loading && e.preventDefault()}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-amber-100">
            <AlertCircle className="w-5 h-5 text-amber-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold">{title || t('common.confirmDialog.title')}</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed whitespace-pre-line">{message || t('common.confirmDialog.message')}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel || t('buttons.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={loading} className="text-white" style={{ background: confirmColor }}>
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t('common.confirmDialog.processing')}</> : (confirmLabel || t('buttons.confirm'))}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
