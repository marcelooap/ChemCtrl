import { useTranslation } from 'react-i18next';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@shared/components/ui/dialog';
import AgendamentosGrade from '@painel/components/comercial/AgendamentosGrade';

export default function AgendamentoPosSaidaModal({
  open,
  saida,
  onScheduled,
  onClose,
  deferBooking = false,
}) {
  const { t } = useTranslation();
  const dismissible = deferBooking && typeof onClose === 'function';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && dismissible) onClose();
      }}
    >
      <DialogContent
        className={`max-w-4xl max-h-[88vh] overflow-y-auto gap-3 ${dismissible ? '' : '[&>button.absolute]:hidden'}`}
        onPointerDownOutside={(e) => {
          if (!dismissible) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (!dismissible) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (!dismissible) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {t(
              deferBooking
                ? 'painel.comercial.agendamentos.reschedule.title'
                : 'painel.comercial.agendamentos.afterSave.title',
              { codigo: saida?.codigo || '—' }
            )}
          </DialogTitle>
          <DialogDescription>
            {t(
              deferBooking
                ? 'painel.comercial.agendamentos.reschedule.subtitle'
                : 'painel.comercial.agendamentos.afterSave.subtitle',
              { cliente: saida?.cliente_nome || '—' }
            )}
          </DialogDescription>
        </DialogHeader>

        {saida ? (
          <AgendamentosGrade
            key={saida.id}
            compact
            hideHeader
            lockedSaida={saida}
            deferBooking={deferBooking}
            permissionPrefix="painel_comercial_agendamentos"
            onBooked={onScheduled}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
