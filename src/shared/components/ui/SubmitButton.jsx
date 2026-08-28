import React from 'react';
import { Button } from './button';
import { Loader2 } from 'lucide-react';

/**
 * Thin presentational wrapper for save/submit actions.
 * Pair with `useSubmitGuard` and pass `busy` (or legacy `saving`) from the hook.
 */
export default function SubmitButton({ saving, busy, savingLabel, children, onClick, disabled, ...props }) {
  const isBusy = Boolean(saving || busy);
  return (
    <Button
      onClick={onClick}
      disabled={isBusy || disabled}
      {...props}
    >
      {isBusy ? (
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
