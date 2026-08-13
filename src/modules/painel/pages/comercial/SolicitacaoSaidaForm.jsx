import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SaidaForm from '@transbordo/pages/SaidaForm';
import AgendamentoPosSaidaModal from '@painel/components/comercial/AgendamentoPosSaidaModal';

const BASE_PATH = '/painel/comercial/solicitacoes-saida';

/** Formulário nova/editar solicitação de saída (Painel Comercial). */
export default function SolicitacaoSaidaForm() {
  const navigate = useNavigate();
  const [saidaParaAgendar, setSaidaParaAgendar] = useState(null);

  return (
    <>
      <SaidaForm
        basePath={BASE_PATH}
        enableMultiOrigem
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
