import { cn } from '@shared/lib/utils';

const TONES = {
  default: 'text-muted-foreground hover:bg-muted',
  danger: 'text-red-500 hover:bg-red-50',
  success: 'text-green-600 hover:bg-muted',
};

/** Ícone da coluna Ações, no padrão visual do módulo Industrialização. */
export function RowActionButton({
  tone = 'default',
  className,
  type = 'button',
  title,
  'aria-label': ariaLabel,
  children,
  ...props
}) {
  return (
    <button
      type={type}
      title={title}
      aria-label={ariaLabel ?? title}
      className={cn(
        'inline-flex items-center justify-center p-1 rounded transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
        'disabled:opacity-40 disabled:pointer-events-none',
        '[&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:shrink-0',
        TONES[tone] ?? TONES.default,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
