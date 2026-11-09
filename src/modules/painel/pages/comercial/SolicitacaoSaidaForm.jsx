import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SaidaForm from '@transbordo/pages/SaidaForm';
import AgendamentoPosSaidaModal from '@painel/components/comercial/AgendamentoPosSaidaModal';
import { MODULO_SAIDA_PAINEL } from '@transbordo/lib/saidaOrigem';
import { isSaidaExpedida, listSaidaIdsExpedidas } from '@transbordo/lib/saidaExpedicao';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/components/ui/alert-dialog';

const BASE_PATH = '/painel/comercial/solicitacoes-saida';

/** Formulário nova/editar solicitação de saída (Painel Comercial). */
export default function SolicitacaoSaidaForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [confirmAgendarSaida, setConfirmAgendarSaida] = useState(null);
  const [saidaParaAgendar, setSaidaParaAgendar] = useState(null);
  const [skipBusy, setSkipBusy] = useState(false);
  const [checkingExpedicao, setCheckingExpedicao] = useState(!!id);

  useEffect(() => {
    if (!id) {
      setCheckingExpedicao(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const expedidasIds = await listSaidaIdsExpedidas();
        if (cancelled) return;
        if (isSaidaExpedida(id, expedidasIds)) {
          navigate(BASE_PATH, { replace: true });
          return;
        }
      } catch (err) {
        console.error('[Painel] Falha ao verificar expedição da saída:', err);
      } finally {
        if (!cancelled) setCheckingExpedicao(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const handleCreateSuccess = (saida) => {
    if (!saida?.id) return;
    setConfirmAgendarSaida(saida);
  };

  const handleAgendarAgora = () => {
    if (!confirmAgendarSaida) return;
    setSaidaParaAgendar(confirmAgendarSaida);
    setConfirmAgendarSaida(null);
  };

  const handleAdiarAgendamento = () => {
    if (!confirmAgendarSaida?.id || skipBusy) return;
    setSkipBusy(true);
    setConfirmAgendarSaida(null);
    setSkipBusy(false);
    // Sem agendamento: data_programada permanece vazia → listas mostram "Aguardando".
    navigate(BASE_PATH);
  };

  if (checkingExpedicao) return null;

  return (
    <>
      <SaidaForm
        basePath={BASE_PATH}
        enableMultiOrigem
        moduloOrigem={MODULO_SAIDA_PAINEL}
        onCreateSuccess={handleCreateSuccess}
        enableAgendamentoEdit={!!id}
      />

      <AlertDialog
        open={!!confirmAgendarSaida}
        onOpenChange={(open) => {
          // Escolha obrigatória: só fecha via Sim/Não.
          if (!open) return;
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Deseja realizar o agendamento agora?</AlertDialogTitle>
            <AlertDialogDescription>
              A solicitação {confirmAgendarSaida?.codigo || ''} já foi registrada.
              Você pode agendar o carregamento agora ou deixar como pendente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={skipBusy}
              onClick={(e) => {
                e.preventDefault();
                handleAdiarAgendamento();
              }}
            >
              Não
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={skipBusy}
              onClick={(e) => {
                e.preventDefault();
                handleAgendarAgora();
              }}
            >
              Sim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AgendamentoPosSaidaModal
        open={!!saidaParaAgendar}
        saida={saidaParaAgendar}
        onScheduled={() => navigate(BASE_PATH)}
      />
    </>
  );
}
