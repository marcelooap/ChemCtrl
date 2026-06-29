import React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AlertCircle } from 'lucide-react';

export default function ConfirmDialog({ open, onOpenChange, title, message, onConfirm, confirmLabel = 'Sim', cancelLabel = 'Não', confirmColor = '#2575D1' }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#FEF3C7' }}>
            <AlertCircle className="w-5 h-5 text-amber-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-bold" style={{ color: '#1A1A2E' }}>{title}</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed whitespace-pre-line">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
          <Button onClick={() => { onConfirm(); onOpenChange(false); }} className="text-white" style={{ background: confirmColor }}>{confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
