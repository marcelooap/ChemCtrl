import { useMemo, useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import ConfirmDialog from '@shared/components/ConfirmDialog';
import {
  createTempItemId,
  isTempItemId,
} from '@painel/lib/checklistExpedicaoConfig';

function normalizeDescricao(value) {
  return String(value || '').trim();
}

function findDuplicateKeys(itens = []) {
  const counts = new Map();
  for (const item of itens) {
    const key = normalizeDescricao(item.descricao).toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const dupes = new Set();
  for (const [key, count] of counts) {
    if (count > 1) dupes.add(key);
  }
  return dupes;
}

/**
 * @param {{
 *   itens: Array<{ id: string, descricao: string }>,
 *   onChange: (next: Array) => void,
 *   disabled?: boolean,
 * }} props
 */
export default function ChecklistExpedicaoItensEditor({
  itens = [],
  onChange,
  disabled = false,
}) {
  const { t } = useTranslation();
  const [removeTarget, setRemoveTarget] = useState(null);

  const duplicateKeys = useMemo(() => findDuplicateKeys(itens), [itens]);
  const hasEmpty = itens.some((it) => !normalizeDescricao(it.descricao));
  const hasDuplicates = duplicateKeys.size > 0;

  const reorder = (from, to) => {
    if (from === to || from < 0 || to < 0 || from >= itens.length || to >= itens.length) {
      return;
    }
    const next = [...itens];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const handleDragEnd = (result) => {
    if (disabled || !result.destination) return;
    reorder(result.source.index, result.destination.index);
  };

  const updateDescricao = (id, descricao) => {
    onChange(
      itens.map((it) => (it.id === id ? { ...it, descricao } : it))
    );
  };

  const addItem = () => {
    onChange([
      ...itens,
      { id: createTempItemId(), descricao: '' },
    ]);
  };

  const requestRemove = (item) => {
    const empty = !normalizeDescricao(item.descricao);
    if (isTempItemId(item.id) || empty) {
      onChange(itens.filter((it) => it.id !== item.id));
      return;
    }
    setRemoveTarget(item);
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    onChange(itens.filter((it) => it.id !== removeTarget.id));
    setRemoveTarget(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {(hasEmpty || hasDuplicates) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {hasEmpty
            ? t('painel.configuracao.checklistExpedicao.emptyHint')
            : t('painel.configuracao.checklistExpedicao.duplicateHint')}
        </div>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="checklist-expedicao-itens">
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="space-y-2"
            >
              {itens.map((item, index) => {
                const descKey = normalizeDescricao(item.descricao).toLowerCase();
                const isDup = descKey && duplicateKeys.has(descKey);
                const isEmpty = !normalizeDescricao(item.descricao);
                return (
                  <Draggable
                    key={item.id}
                    draggableId={String(item.id)}
                    index={index}
                    isDragDisabled={disabled}
                  >
                    {(drag, snapshot) => (
                      <div
                        ref={drag.innerRef}
                        {...drag.draggableProps}
                        className={`flex items-start gap-2 rounded-lg border bg-card px-2.5 py-2 transition-shadow ${
                          snapshot.isDragging
                            ? 'shadow-md border-primary/40'
                            : isDup || isEmpty
                              ? 'border-amber-300'
                              : 'border-border'
                        }`}
                      >
                        <button
                          type="button"
                          className="mt-2 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing shrink-0 disabled:opacity-40"
                          aria-label={t('painel.configuracao.checklistExpedicao.reorder')}
                          disabled={disabled}
                          {...drag.dragHandleProps}
                        >
                          <GripVertical className="w-4 h-4" />
                        </button>

                        <div className="flex flex-col gap-1 shrink-0 mt-1">
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
                            aria-label={t('painel.configuracao.checklistExpedicao.moveUp')}
                            disabled={disabled || index === 0}
                            onClick={() => reorder(index, index - 1)}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-40"
                            aria-label={t('painel.configuracao.checklistExpedicao.moveDown')}
                            disabled={disabled || index === itens.length - 1}
                            onClick={() => reorder(index, index + 1)}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex-1 min-w-0">
                          <Input
                            value={item.descricao}
                            onChange={(e) => updateDescricao(item.id, e.target.value)}
                            placeholder={t(
                              'painel.configuracao.checklistExpedicao.itemPlaceholder'
                            )}
                            disabled={disabled}
                            className="h-9 text-sm"
                            aria-label={t(
                              'painel.configuracao.checklistExpedicao.itemLabel',
                              { index: index + 1 }
                            )}
                          />
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 mt-0.5 text-muted-foreground hover:text-destructive"
                          disabled={disabled}
                          onClick={() => requestRemove(item)}
                          aria-label={t('buttons.delete')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
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

      <div className="shrink-0">
        <Button
          type="button"
          variant="outline"
          className="gap-2"
          onClick={addItem}
          disabled={disabled}
        >
          <Plus className="w-4 h-4" />
          {t('painel.configuracao.checklistExpedicao.addItem')}
        </Button>
      </div>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(v) => {
          if (!v) setRemoveTarget(null);
        }}
        title={t('painel.configuracao.checklistExpedicao.removeTitle')}
        message={t('painel.configuracao.checklistExpedicao.removeConfirm', {
          descricao: removeTarget?.descricao || '',
        })}
        confirmLabel={t('buttons.delete')}
        confirmColor="#dc2626"
        onConfirm={confirmRemove}
      />
    </div>
  );
}

/** Validação compartilhada com a página de save. */
export function validateChecklistItens(itens = []) {
  const normalized = (itens || []).map((it) => ({
    ...it,
    descricao: normalizeDescricao(it.descricao),
  }));
  if (normalized.some((it) => !it.descricao)) {
    return { ok: false, code: 'EMPTY_DESCRICAO' };
  }
  const seen = new Set();
  for (const it of normalized) {
    const key = it.descricao.toLowerCase();
    if (seen.has(key)) return { ok: false, code: 'DUPLICATE_DESCRICAO' };
    seen.add(key);
  }
  return { ok: true, itens: normalized };
}
