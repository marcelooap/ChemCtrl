import React from 'react';
import { ArrowDown } from 'lucide-react';
import CycleCard from './CycleCard';

export default function HistoryCycles({ cycles }) {
  if (!cycles || cycles.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Nenhum ciclo de utilização encontrado para este vasilhame.
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="text-sm text-muted-foreground mb-3">
        {cycles.length} ciclo(s) encontrado(s) — do mais recente ao mais antigo.
      </div>
      {cycles.map((cycle, i) => (
        <React.Fragment key={cycle.containerId + '-' + i}>
          <CycleCard cycle={cycle} index={i} />
          {i < cycles.length - 1 && (
            <div className="flex justify-center py-1.5">
              <ArrowDown className="w-5 h-5 text-muted-foreground" />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
