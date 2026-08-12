import { useTranslation } from 'react-i18next';
import Saida from '@transbordo/pages/Saida';

const BASE_PATH = '/saida';

/**
 * Saídas do módulo Industrialização.
 * Lista apenas solicitações com itens vinculados à Industrialização.
 */
export default function IndSaida() {
  const { t } = useTranslation();

  return (
    <Saida
      basePath={BASE_PATH}
      title={t('saida.title')}
      onlyIndustrializacao
    />
  );
}
