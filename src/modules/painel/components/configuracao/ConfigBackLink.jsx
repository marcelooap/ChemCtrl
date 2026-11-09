import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';

/** Link de retorno ao hub Configuração. */
export default function ConfigBackLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/painel/configuracao"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowLeft className="w-4 h-4" />
      {t('painel.configuracao.backToHub')}
    </Link>
  );
}
