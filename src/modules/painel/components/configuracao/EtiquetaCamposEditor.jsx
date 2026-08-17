import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { GripVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@shared/components/ui/input';
import { Switch } from '@shared/components/ui/switch';
import {
  ETIQUETA_DATE_FORMATS,
  ETIQUETA_FIELD_CATALOG,
} from '@transbordo/lib/etiquetaConfig';

const CATALOG_BY_KEY = Object.fromEntries(
  ETIQUETA_FIELD_CATALOG.map((f) => [f.key, f])
);

const RT_KEY = 'responsavel_tecnico';

function pinResponsavelLast(list) {
  const rt = list.find((c) => c.key === RT_KEY);
  const rest = list.filter((c) => c.key !== RT_KEY);
  const next = rt ? [...rest, rt] : rest;
  return next.map((c, i) => ({ ...c, ordem: i }));
}

export default function EtiquetaCamposEditor({
  campos,
  onChange,
  responsavelTecnico = '',
  onResponsavelTecnicoChange,
  dateFormat = 'dmy',
  onDateFormatChange,
  orientation = 'horizontal',
  onOrientationChange,
}) {
  const { t } = useTranslation();

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const from = result.source.index;
    const to = result.destination.index;
    if (from === to) return;
    if (campos[from]?.key === RT_KEY) return;
    const next = [...campos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(pinResponsavelLast(next));
  };

  const toggle = (key, enabled) => {
    onChange(
      campos.map((c) => (c.key === key ? { ...c, enabled } : c))
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 mb-2 space-y-1.5">
        <h2 className="text-sm font-semibold text-foreground leading-tight">
          {t('painel.configuracao.etiquetas.fieldsTitle')}
        </h2>
        <div className="flex items-center gap-2">
          <label
            htmlFor="etiqueta-date-format"
            className="text-xs text-muted-foreground whitespace-nowrap"
          >
            {t('painel.configuracao.etiquetas.dateFormat')}
          </label>
          <select
            id="etiqueta-date-format"
            value={dateFormat}
            onChange={(e) => onDateFormatChange?.(e.target.value)}
            title={t('painel.configuracao.etiquetas.dateFormatHint')}
            className="h-7 flex-1 min-w-0 rounded-md border border-input bg-background px-2 text-xs"
          >
            {ETIQUETA_DATE_FORMATS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t(opt.labelKey)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {t('painel.configuracao.etiquetas.orientation')}
          </span>
          <div className="flex items-center gap-2">
            <span className={`text-xs ${orientation === 'horizontal' ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              {t('painel.configuracao.etiquetas.orientationHorizontal')}
            </span>
            <Switch
              checked={orientation === 'vertical'}
              onCheckedChange={(v) => onOrientationChange?.(v ? 'vertical' : 'horizontal')}
              aria-label={t('painel.configuracao.etiquetas.orientation')}
            />
            <span className={`text-xs ${orientation === 'vertical' ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              {t('painel.configuracao.etiquetas.orientationVertical')}
            </span>
          </div>
        </div>
      </div>
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="etiqueta-campos">
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="flex-1 min-h-0 overflow-auto space-y-1 pr-1"
            >
              {campos.map((campo, index) => {
                const meta = CATALOG_BY_KEY[campo.key];
                const label = meta ? t(meta.labelKey) : campo.key;
                const isRt = campo.key === RT_KEY;
                return (
                  <Draggable
                    key={campo.key}
                    draggableId={campo.key}
                    index={index}
                    isDragDisabled={isRt}
                  >
                    {(drag, snapshot) => (
                      <div
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 bg-card transition-shadow ${
                          snapshot.isDragging
                            ? 'shadow-md border-primary/40'
                            : 'border-border'
                        } ${campo.enabled ? '' : 'opacity-60'}`}
                      >
                        {isRt ? (
                          <span className="w-4 shrink-0" />
                        ) : (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shrink-0"
                            aria-label={t('painel.configuracao.etiquetas.reorder')}
                            {...drag.dragHandleProps}
                          >
                            <GripVertical className="w-4 h-4" />
                          </button>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate leading-tight">
                            {label}
                          </p>
                          {isRt && campo.enabled && (
                            <div className="mt-1.5" onMouseDown={(e) => e.stopPropagation()}>
                              <Input
                                value={responsavelTecnico}
                                onChange={(e) => onResponsavelTecnicoChange?.(e.target.value)}
                                placeholder={t('painel.configuracao.etiquetas.responsavelPlaceholder')}
                                className="h-7 text-xs"
                                aria-label={label}
                              />
                            </div>
                          )}
                        </div>
                        <Switch
                          checked={campo.enabled}
                          onCheckedChange={(v) => toggle(campo.key, v)}
                          aria-label={label}
                        />
                      </div>
                    )}
                  </Draggable>
                );
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}
