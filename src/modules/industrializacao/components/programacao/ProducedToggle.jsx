import { Check } from 'lucide-react';
import { cn } from '@shared/lib/utils';

export default function ProducedToggle({
  produced,
  disabled,
  busy,
  label,
  onToggle,
  className,
}) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled || busy) return;
        onToggle?.();
      }}
      aria-pressed={produced}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled ? 'cursor-default' : 'cursor-pointer',
        busy ? 'opacity-60' : '',
        className
      )}
    >
      <span
        className={cn(
          'flex h-[18px] w-[18px] items-center justify-center rounded-full border transition-colors',
          produced
            ? 'border-emerald-500 bg-emerald-500 text-white'
            : disabled
              ? 'border-current/35 bg-background/80 text-transparent'
              : 'border-current/35 bg-background/80 text-transparent hover:border-emerald-500'
        )}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    </button>
  );
}
