import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@shared/components/ui/dialog';
import AgendamentosGrade from '@painel/components/comercial/AgendamentosGrade';

export default function AgendamentoPosSaidaModal({ open, saida, onScheduled }) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="max-w-3xl max-h-[88vh] overflow-y-auto gap-3 [&>button.absolute]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {t('painel.comercial.agendamentos.afterSave.title', {
              codigo: saida?.codigo || '—',
            })}
          </DialogTitle>
          <DialogDescription>
            {t('painel.comercial.agendamentos.afterSave.subtitle', {
              cliente: saida?.cliente_nome || '—',
            })}
          </DialogDescription>
        </DialogHeader>

        {saida ? (
          <AgendamentosGrade
            compact
            hideHeader
            lockedSaida={saida}
            permissionPrefix="painel_comercial_agendamentos"
            onBooked={onScheduled}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
