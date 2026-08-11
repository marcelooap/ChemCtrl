import SaidaView from '@transbordo/pages/SaidaView';

const BASE_PATH = '/painel/comercial/solicitacoes-saida';

/** Visualização completa da solicitação de saída (Painel Comercial). */
export default function SolicitacaoSaidaView() {
  return <SaidaView basePath={BASE_PATH} />;
}
