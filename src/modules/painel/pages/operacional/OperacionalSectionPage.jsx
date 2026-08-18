import { useTranslation } from 'react-i18next';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';

/**
 * Placeholder das seções de Operacional no Painel.
 * @param {{ sectionKey: string, icon: import('lucide-react').LucideIcon }} props
 */
export default function OperacionalSectionPage({ sectionKey, icon: Icon }) {
  const { t } = useTranslation();

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {t(`painel.operacional.sections.${sectionKey}.title`)}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t(`painel.operacional.sections.${sectionKey}.subtitle`)}
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {t(`painel.operacional.sections.${sectionKey}.emptyTitle`)}
              </CardTitle>
              <CardDescription className="mt-1.5">
                {t(`painel.operacional.sections.${sectionKey}.emptyDescription`)}
              </CardDescription>
            </div>
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              <Icon className="w-5 h-5 text-muted-foreground" />
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
}
