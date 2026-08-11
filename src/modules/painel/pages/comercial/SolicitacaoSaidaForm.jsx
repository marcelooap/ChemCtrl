import SaidaForm from '@transbordo/pages/SaidaForm';

const BASE_PATH = '/painel/comercial/solicitacoes-saida';

/** Formulário nova/editar solicitação de saída (Painel Comercial). */
export default function SolicitacaoSaidaForm() {
  return <SaidaForm basePath={BASE_PATH} />;
}
