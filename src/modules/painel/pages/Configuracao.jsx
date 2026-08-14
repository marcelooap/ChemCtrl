import { useTranslation } from 'react-i18next';
import { Settings } from 'lucide-react';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';

export default function Configuracao() {
  const { t } = useTranslation();

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">{t('painel.configuracao.title')}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('painel.configuracao.subtitle')}</p>
      </div>

      <Card className="rounded-[20px] border-border/80 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{t('painel.configuracao.emptyTitle')}</CardTitle>
              <CardDescription className="mt-1.5">
                {t('painel.configuracao.emptyDescription')}
              </CardDescription>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-muted flex items-center justify-center shrink-0">
              <Settings className="w-5 h-5 text-muted-foreground" />
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
