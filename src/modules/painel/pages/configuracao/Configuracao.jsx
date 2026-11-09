import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Tag,
  HardHat,
  ClipboardCheck,
  MapPin,
  ClipboardList,
} from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { canAccessRoute } from '@industrializacao/lib/permissions';
import { cn } from '@shared/lib/utils';

const CARDS = [
  {
    id: 'etiquetas',
    path: '/painel/configuracao/etiquetas',
    icon: Tag,
    titleKey: 'painel.configuracao.hub.etiquetas',
    descriptionKey: 'painel.configuracao.hub.etiquetasHint',
  },
  {
    id: 'operadores',
    path: '/painel/configuracao/operadores',
    icon: HardHat,
    titleKey: 'painel.configuracao.hub.operadores',
    descriptionKey: 'painel.configuracao.hub.operadoresHint',
  },
  {
    id: 'checklist',
    path: '/painel/configuracao/checklist-expedicao',
    icon: ClipboardCheck,
    titleKey: 'painel.configuracao.hub.checklist',
    descriptionKey: 'painel.configuracao.hub.checklistHint',
  },
  {
    id: 'destinos',
    path: '/painel/configuracao/destino-carregamentos',
    icon: MapPin,
    titleKey: 'painel.configuracao.hub.destinos',
    descriptionKey: 'painel.configuracao.hub.destinosHint',
  },
  {
    id: 'justificativas',
    path: '/painel/configuracao/justificativas-atraso',
    icon: ClipboardList,
    titleKey: 'painel.configuracao.hub.justificativas',
    descriptionKey: 'painel.configuracao.hub.justificativasHint',
  },
];

export default function Configuracao() {
  const { t } = useTranslation();
  const { user } = useInternalAuth();

  const visibleCards = useMemo(
    () => CARDS.filter((card) => canAccessRoute(user, card.path)),
    [user]
  );

  return (
    <div className="h-full min-h-0 overflow-y-auto w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          {t('painel.configuracao.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('painel.configuracao.subtitle')}
        </p>
      </div>

      {visibleCards.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-6 py-12 text-center text-muted-foreground">
          {t('painel.configuracao.hub.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {visibleCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.id}
                to={card.path}
                className={cn(
                  'group flex flex-col items-center justify-center gap-3',
                  'min-h-[140px] rounded-xl border border-border bg-card px-4 py-6',
                  'text-center shadow-sm',
                  'transition-[transform,box-shadow,border-color,background-color] duration-200',
                  'hover:-translate-y-0.5 hover:border-[#2575D1]/40 hover:shadow-md',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2575D1]/40'
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#2575D1]/10 text-[#2575D1] transition-colors group-hover:bg-[#2575D1] group-hover:text-white">
                  <Icon className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground leading-snug">
                    {t(card.titleKey)}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">
                    {t(card.descriptionKey)}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
