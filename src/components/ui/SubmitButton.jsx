import React from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export default function SubmitButton({ saving, savingLabel, children, onClick, disabled, ...props }) {
  return (
    <Button
      onClick={onClick}
      disabled={saving || disabled}
      {...props}
    >
      {saving ? (
        <>
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          {savingLabel || 'Processando...'}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
