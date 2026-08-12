import { useTranslation } from 'react-i18next';
import AgendamentosGrade from '@painel/components/comercial/AgendamentosGrade';

export default function LogisticaAgendamentos() {
  const { t } = useTranslation();

  return (
    <AgendamentosGrade
      title={t('painel.logistica.sections.agendamentos.title')}
      subtitle={t('painel.logistica.sections.agendamentos.subtitle')}
      permissionPrefix="painel_logistica_agendamentos"
      showViewSaida
    />
  );
}
