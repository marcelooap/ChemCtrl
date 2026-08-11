import { useTranslation } from 'react-i18next';
import Saida from '@transbordo/pages/Saida';

const BASE_PATH = '/painel/comercial/solicitacoes-saida';

/**
 * Solicitações de Saída no Painel Comercial.
 * Reutiliza a tela completa de Saídas do ChemFlow (listagem, filtros, fiscal, CRUD).
 */
export default function SolicitacoesSaida() {
  const { t } = useTranslation();

  return (
    <Saida
      basePath={BASE_PATH}
      title={t('painel.comercial.sections.solicitacoesSaida.title')}
    />
  );
}
