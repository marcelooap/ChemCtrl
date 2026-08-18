import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import TankSilo from '@transbordo/components/tankagem/TankSilo';
import { formatVolume } from '@transbordo/lib/format';

/**
 * Distribuição visual de tankas por cliente (mesmo padrão da Tankagem do Transbordo).
 */
export default function OperacionalTankagemBoard({
  groupedByClient,
  productColorMap,
  onView,
}) {
  const { t } = useTranslation();
  const groups = Object.entries(groupedByClient || {});

  if (groups.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center text-sm text-muted-foreground">
        {t('painel.operacional.estoque.tankas.empty')}
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto space-y-6 pr-0.5">
      {groups.map(([cliente, tanks]) => {
        const totalVolume = tanks.reduce((sum, tank) => sum + (Number(tank.volumeAtual) || 0), 0);
        return (
          <div
            key={cliente}
            className="bg-card rounded-xl border border-border shadow-sm p-6"
          >
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border flex-wrap">
              <span className="w-3 h-3 rounded-full bg-primary flex-shrink-0" />
              <h2 className="text-lg font-bold text-foreground">{cliente}</h2>
              <span className="text-sm text-muted-foreground">
                {t('painel.operacional.estoque.tankas.tankaCount', { count: tanks.length })}
              </span>
              <span className="text-sm font-medium text-foreground/80 ml-auto">
                {formatVolume(totalVolume)} L
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
              {tanks.map((tank) => (
                <TankSilo
                  key={tank.id}
                  tanka={tank.tanka || tank.tankaCodigo || tank.codigo_itku}
                  capacidade={tank.capacidade || 0}
                  volume={tank.volumeAtual}
                  produto={tank.produto}
                  fillColor={tank.produto ? productColorMap[tank.produto] : null}
                  onView={() => onView?.(tank)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
