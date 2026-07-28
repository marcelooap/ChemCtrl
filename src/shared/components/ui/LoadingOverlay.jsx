import React from 'react';
import { Loader2 } from 'lucide-react';

export default function LoadingOverlay({ visible, label }) {
  if (!visible) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center rounded-lg bg-background/85 backdrop-blur-[1px]">
      <div className="flex flex-col items-center gap-2">
        <Loader2 className="w-7 h-7 animate-spin text-primary" />
        <p className="text-xs font-medium text-muted-foreground">{label || 'Processando...'}</p>
      </div>
    </div>
  );
}
