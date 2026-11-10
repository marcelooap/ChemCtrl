import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import DateInputBr from '@shared/components/ui/DateInputBr';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';

export default function FaturamentoFiltros({
  clientes = [],
  clienteId,
  search,
  dateFrom,
  dateTo,
  onClienteChange,
  onSearchChange,
  onDateFromChange,
  onDateToChange,
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm px-5 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1 min-w-[180px] flex-1 sm:flex-none sm:w-[220px]">
          <Label className="text-[11px] text-muted-foreground">
            {t('painel.faturamento.filters.cliente')}
          </Label>
          <Select
            value={clienteId || '__all__'}
            onValueChange={(v) => onClienteChange?.(v === '__all__' ? '' : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder={t('painel.faturamento.filters.clienteAll')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">
                {t('painel.faturamento.filters.clienteAll')}
              </SelectItem>
              {clientes.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nome || c.cliente_nome || c.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1 min-w-[200px] flex-1">
          <Label className="text-[11px] text-muted-foreground">
            {t('painel.faturamento.filters.search')}
          </Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => onSearchChange?.(e.target.value)}
              placeholder={t('painel.faturamento.filters.searchPlaceholder')}
              className="pl-8"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            {t('painel.faturamento.filters.dateFrom')}
          </Label>
          <DateInputBr value={dateFrom} onChange={onDateFromChange} className="w-[148px]" />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">
            {t('painel.faturamento.filters.dateTo')}
          </Label>
          <DateInputBr value={dateTo} onChange={onDateToChange} className="w-[148px]" />
        </div>
      </div>
    </div>
  );
}
