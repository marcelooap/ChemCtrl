import { useTranslation } from 'react-i18next';
import AgendamentosGrade from '@painel/components/comercial/AgendamentosGrade';

export default function Agendamentos() {
  const { t } = useTranslation();

  return (
    <AgendamentosGrade
      title={t('painel.comercial.sections.agendamentos.title')}
      subtitle={t('painel.comercial.agendamentos.subtitle')}
      permissionPrefix="painel_comercial_agendamentos"
      showTransporte
    />
  );
}
