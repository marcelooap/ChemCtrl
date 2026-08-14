import { useTranslation } from 'react-i18next';
import Saida from '@transbordo/pages/Saida';

const BASE_PATH = '/painel/comercial/solicitacoes-saida';

/**
 * Solicitações de Saída no Painel Comercial.
 * Reutiliza a listagem de Saídas do ChemFlow com Status de expedição
 * (Expedido / Aguardando) baseado no carregamento concluído.
 */
export default function SolicitacoesSaida() {
  const { t } = useTranslation();

  return (
    <Saida
      basePath={BASE_PATH}
      title={t('painel.comercial.sections.solicitacoesSaida.title')}
      statusMode="expedicao"
      excludeChemflow
    />
  );
}
