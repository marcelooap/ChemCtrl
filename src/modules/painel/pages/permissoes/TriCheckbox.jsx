import { useEffect, useRef } from 'react';
import { cn } from '@shared/lib/utils';

/**
 * Checkbox nativo com suporte a estado indeterminado (parcial).
 * O estado indeterminado é apenas visual — não altera permissões sozinho.
 */
export default function TriCheckbox({
  checked = false,
  indeterminate = false,
  disabled = false,
  onChange,
  className,
  'aria-label': ariaLabel,
}) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = Boolean(indeterminate) && !checked;
    }
  }, [indeterminate, checked]);

  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'h-4 w-4 shrink-0 accent-[#2575D1] rounded border-border',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
      aria-label={ariaLabel}
    />
  );
}
