import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SaidaForm from '@transbordo/pages/SaidaForm';
import AgendamentoPosSaidaModal from '@painel/components/comercial/AgendamentoPosSaidaModal';
import { MODULO_SAIDA_PAINEL } from '@transbordo/lib/saidaOrigem';
import { isSaidaExpedida, listSaidaIdsExpedidas } from '@transbordo/lib/saidaExpedicao';

const BASE_PATH = '/painel/comercial/solicitacoes-saida';

/** Formulário nova/editar solicitação de saída (Painel Comercial). */
export default function SolicitacaoSaidaForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [saidaParaAgendar, setSaidaParaAgendar] = useState(null);
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

  if (checkingExpedicao) return null;

  return (
    <>
      <SaidaForm
        basePath={BASE_PATH}
        enableMultiOrigem
        moduloOrigem={MODULO_SAIDA_PAINEL}
        onCreateSuccess={setSaidaParaAgendar}
      />
      <AgendamentoPosSaidaModal
        open={!!saidaParaAgendar}
        saida={saidaParaAgendar}
        onScheduled={() => navigate(BASE_PATH)}
      />
    </>
  );
}
