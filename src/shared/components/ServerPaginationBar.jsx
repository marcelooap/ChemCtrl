import { Button } from '@shared/components/ui/button';
import { DEFAULT_PAGE_SIZE } from '@shared/lib/pagination';

/**
 * Barra compacta de paginação server-side (50/página por padrão).
 */
export function ServerPaginationBar({
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  total = 0,
  onPageChange,
  className = '',
  disabled = false,
}) {
  const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / (pageSize || DEFAULT_PAGE_SIZE)));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm text-muted-foreground ${className}`}
    >
      <span>
        {total === 0
          ? 'Nenhum registro'
          : `Mostrando ${from}–${to} de ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || current <= 1}
          onClick={() => onPageChange?.(current - 1)}
        >
          Anterior
        </Button>
        <span className="tabular-nums">
          {current} / {totalPages}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || current >= totalPages}
          onClick={() => onPageChange?.(current + 1)}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}
