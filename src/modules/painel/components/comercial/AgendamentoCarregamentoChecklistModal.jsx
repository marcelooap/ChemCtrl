import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Container,
  ImagePlus,
  Loader2,
  MinusCircle,
  Package,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { useToast } from '@shared/components/ui/use-toast';
import { Can } from '@industrializacao/lib/rbac/Can';
import { cn } from '@shared/lib/utils';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { uploadFileToSupabase } from '@industrializacao/api/storage';
import SignedImage from '@industrializacao/components/SignedImage';
import {
  ENCAIXE_HORARIO,
  formatDateBR,
  normalizeBookings,
  summarizeSlotBookings,
} from '@painel/lib/agendamentosCarregamento';
import {
  COLOR_COD_TEXT_CLASS,
} from '@painel/lib/validadeTestesTanque';
import {
  CHECK_ANSWER,
  CHECKLIST_KIND,
  CHECKLIST_STATUS,
  ESLINGA_COLOR_CHECK_KEY,
  ESLINGA_COLOR_SECTION,
  VALIDADE_TESTES_SECTION,
  areAllItemsApproved,
  areAllItemsReleasable,
  buildChecklistItemsFromSaidas,
  buildChecklistPayloadV2,
  checkDefLabel,
  checkDefsForItem,
  computeChecksSummary,
  computeItemStatus,
  hasRejectedItem,
  itemHasPhotos,
  mergeChecklistItems,
  parseStoredChecklist,
} from '@painel/lib/carregamentoChecklistConfig';
import { loadChecklistExpedicaoOperacional } from '@painel/lib/checklistExpedicaoConfig';
import { formatDataLimiteTestes } from '@painel/lib/validadeTestesTanque';
import { entities } from '@transbordo/services/entities';
import { TIPO_IND_VASILHAME } from '@transbordo/lib/saidaOrigem';
import { loadContainerLoteDatasMap } from '@industrializacao/lib/containerLoteDatas';

const STATUS_STYLE = {
  [CHECKLIST_STATUS.PENDENTE]: 'bg-muted text-muted-foreground',
  [CHECKLIST_STATUS.EM_CONFERENCIA]: 'bg-amber-100 text-amber-800',
  [CHECKLIST_STATUS.APROVADO]: 'bg-emerald-100 text-emerald-800',
  [CHECKLIST_STATUS.REPROVADO]: 'bg-red-100 text-red-800',
};

const STATUS_ICON = {
  [CHECKLIST_STATUS.APROVADO]: CheckCircle2,
  [CHECKLIST_STATUS.REPROVADO]: XCircle,
};

function StatusBadge({ status, label, className }) {
  const Icon = STATUS_ICON[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        STATUS_STYLE[status] || STATUS_STYLE[CHECKLIST_STATUS.PENDENTE],
        className
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {label}
    </span>
  );
}

function InfoChip({ label, value, className, valueClassName }) {
  return (
    <div className={cn('rounded-md border border-border bg-white px-2.5 py-1.5 shadow-sm', className)}>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('text-sm font-medium text-foreground break-words', valueClassName)}>
        {value || '—'}
      </p>
    </div>
  );
}

const ANSWER_OPTIONS = [
  {
    value: CHECK_ANSWER.APROVADO,
    icon: CheckCircle2,
    labelKey: 'painel.comercial.agendamentos.checklist.answers.aprovado',
    active: 'bg-emerald-600 border-emerald-600 text-white',
    idle: 'border-border text-muted-foreground hover:border-emerald-400 hover:text-emerald-700',
  },
  {
    value: CHECK_ANSWER.REPROVADO,
    icon: XCircle,
    labelKey: 'painel.comercial.agendamentos.checklist.answers.reprovado',
    active: 'bg-red-600 border-red-600 text-white',
    idle: 'border-border text-muted-foreground hover:border-red-400 hover:text-red-700',
  },
  {
    value: CHECK_ANSWER.NAO_SE_APLICA,
    icon: MinusCircle,
    labelKey: 'painel.comercial.agendamentos.checklist.answers.naoSeAplica',
    active: 'bg-slate-500 border-slate-500 text-white',
    idle: 'border-border text-muted-foreground hover:border-slate-400 hover:text-slate-700',
  },
];

/** Numeração sequencial dos itens de verificação: 1 -> "01 -". */
function formatItemNumber(n) {
  return `${String(n).padStart(2, '0')} -`;
}

/** `bare`: sem moldura própria, para uso dentro de um card que agrupa o item de verificação. */
function CheckAnswerRow({
  label,
  number,
  value,
  disabled,
  onChange,
  t,
  options = ANSWER_OPTIONS,
  bare = false,
}) {
  const isRejected = value === CHECK_ANSWER.REPROVADO;
  return (
    <div
      className={cn(
        'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
        !bare && 'rounded-lg border px-3 py-2.5 shadow-sm',
        !bare && (isRejected ? 'border-red-200 bg-red-50' : 'border-border bg-white')
      )}
    >
      <p className="text-sm leading-snug sm:flex-1">
        {number != null ? (
          <span className="mr-1.5 font-semibold tabular-nums text-[#2575D1]">
            {formatItemNumber(number)}
          </span>
        ) : null}
        {label}
      </p>
      <div className="flex shrink-0 gap-1.5">
        {options.map((opt) => {
          const Icon = opt.icon;
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(selected ? '' : opt.value)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60 disabled:cursor-default',
                selected ? opt.active : opt.idle
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(opt.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const APPROVE_REJECT_OPTIONS = ANSWER_OPTIONS.filter(
  (o) => o.value === CHECK_ANSWER.APROVADO || o.value === CHECK_ANSWER.REPROVADO
);

/**
 * Conferência teste a teste. A data limite é hoje menos o prazo do teste;
 * a data de execução no físico precisa ser maior que essa data.
 * Sem testes para o destino, a verificação fica bloqueada.
 * Itens antigos (um prazo único, sem lista) continuam no card legado.
 */
function ValidadeTestesSection({ validade, defs, itemNumbers, checks, disabled, onChange, language, t }) {
  const prefix = 'painel.comercial.agendamentos.checklist.validadeTestes';
  const testes = Array.isArray(validade?.testes) ? validade.testes : [];
  const legado = testes.length === 0 && validade?.dias != null && validade?.configurado !== false;
  const bloqueado = testes.length === 0 && !legado;
  const chipClass = 'border-border/60 bg-muted/30 shadow-none';
  const testeByKey = new Map(testes.map((teste) => [teste.key, teste]));

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t(`painel.comercial.agendamentos.checklist.sections.${VALIDADE_TESTES_SECTION}`)}
      </p>

      <div className="space-y-2">
        <InfoChip
          className={chipClass}
          label={t(`${prefix}.destino`)}
          value={validade?.destino || t(`${prefix}.destinoVazio`)}
        />

        {bloqueado ? (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">{t(`${prefix}.naoConfigurado`)}</p>
              <p className="mt-0.5 text-xs">
                {t(validade?.destino ? `${prefix}.naoConfiguradoHint` : `${prefix}.naoConfiguradoSemDestino`)}
              </p>
            </div>
          </div>
        ) : null}

        {(defs || []).map((def) => {
          const teste = testeByKey.get(def.key);
          const value = checks?.[def.key] || '';
          const isRejected = value === CHECK_ANSWER.REPROVADO;
          const dataLimite = teste
            ? formatDataLimiteTestes(teste.data_limite, language)
            : legado
              ? formatDataLimiteTestes(validade.data_limite, language)
              : '—';
          const dias = teste?.dias ?? (legado ? validade.dias : null);
          return (
            <div
              key={def.key}
              className={cn(
                'space-y-3 rounded-lg border p-3 shadow-sm',
                isRejected ? 'border-red-200 bg-red-50' : 'border-border bg-white'
              )}
            >
              <p className="text-sm font-semibold text-foreground">
                {teste?.nome || (legado ? t(`${prefix}.resultado`) : checkDefLabel(def, t))}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <InfoChip
                  className={chipClass}
                  label={t(`${prefix}.prazo`)}
                  value={dias != null ? t(`${prefix}.prazoDias`, { dias }) : '—'}
                />
                <InfoChip
                  className={chipClass}
                  label={t(teste ? `${prefix}.dataLimiteExecucao` : `${prefix}.dataLimite`)}
                  value={dataLimite}
                  valueClassName={dias != null ? 'font-bold text-emerald-800' : undefined}
                />
              </div>
              {teste ? (
                <p className="text-xs text-muted-foreground">
                  {t(`${prefix}.execucaoHint`, { dias: teste.dias, data: dataLimite })}
                </p>
              ) : legado ? (
                <p className="text-xs text-muted-foreground">
                  {t(`${prefix}.hint`, { dias: validade.dias })}
                </p>
              ) : null}
              <div className="border-t border-border/60 pt-3">
                <CheckAnswerRow
                  bare
                  label={t(`${prefix}.resultado`)}
                  number={itemNumbers.get(def.key)}
                  value={value}
                  disabled={disabled || bloqueado}
                  onChange={(v) => onChange(def.key, v)}
                  options={APPROVE_REJECT_OPTIONS}
                  t={t}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Color Cod da eslinga: exibe a cor cadastrada no Check List do cliente
 * (somente visualização) e registra Aprovado/Reprovado pelo operador.
 */
function EslingaColorSection({ colorCod, number, value, disabled, onChange, t }) {
  const prefix = 'painel.comercial.agendamentos.checklist.eslingaColor';
  const isRejected = value === CHECK_ANSWER.REPROVADO;
  const colorClass = COLOR_COD_TEXT_CLASS[colorCod] || 'text-foreground';
  const colorName = t(
    `painel.configuracao.checklistExpedicao.validadeTestes.destinos.colorOptions.${colorCod}`,
    { defaultValue: colorCod }
  );

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t(`painel.comercial.agendamentos.checklist.sections.${ESLINGA_COLOR_SECTION}`)}
      </p>
      <div
        className={cn(
          'space-y-3 rounded-lg border p-3 shadow-sm',
          isRejected ? 'border-red-200 bg-red-50' : 'border-border bg-white'
        )}
      >
        <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t(`${prefix}.colorLabel`)}
          </p>
          <p className={cn('mt-0.5 text-base font-bold tracking-wide', colorClass)}>
            {colorName}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t(`${prefix}.hint`)}</p>
        </div>

        <div className="border-t border-border/60 pt-3">
          <CheckAnswerRow
            bare
            label={t(`${prefix}.resultado`)}
            number={number}
            value={value}
            disabled={disabled}
            onChange={onChange}
            options={APPROVE_REJECT_OPTIONS}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}

export default function AgendamentoCarregamentoChecklistModal({
  open,
  onClose,
  bookings,
  saidas = [],
  vasilhames = [],
  entradas = [],
  permissionPrefix = 'painel_logistica_agendamentos',
  onSaveProgress,
  onLiberar,
}) {
  const { t, i18n } = useTranslation();
  const { user } = useInternalAuth();
  const { toast } = useToast();
  const galleryInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const bodyRef = useRef(null);

  const list = normalizeBookings(bookings);
  const summary = summarizeSlotBookings(list);
  const booking = summary.first;
  const alreadyLiberated = Boolean(booking?.checklist_validado_em);
  const isCarregado = list.length > 0 && list.every((r) => r.status === 'concluido');
  // Após liberação ainda permite editar/anexar fotos; bloqueia só quando o carregamento já concluiu.
  const readOnly = isCarregado;

  const [checkDefsByCliente, setCheckDefsByCliente] = useState(null);
  const [validadeTestesByCliente, setValidadeTestesByCliente] = useState(null);
  const [defsLoading, setDefsLoading] = useState(false);

  // Clientes das saídas do slot (id + nome): o nome é o vínculo quando o cadastro
  // tem ids duplicados ou a saída não guarda o id do cliente.
  const clientesKey = useMemo(() => {
    const byKey = new Map();
    const collect = (row) => {
      const id = row?.cliente_id ? String(row.cliente_id) : '';
      const nome = String(row?.cliente_nome || '').trim();
      if (!id && !nome) return;
      byKey.set(`${id}|${nome.toLowerCase()}`, { id, nome });
    };
    const saidaIds = new Set(list.map((b) => String(b?.saida_id)));
    list.forEach(collect);
    (saidas || []).filter((s) => saidaIds.has(String(s?.id))).forEach(collect);
    return JSON.stringify([...byKey.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, c]) => c));
  }, [list, saidas]);

  useEffect(() => {
    if (!open) {
      setCheckDefsByCliente(null);
      setValidadeTestesByCliente(null);
      setDefsLoading(false);
      return;
    }
    let cancelled = false;
    setDefsLoading(true);
    loadChecklistExpedicaoOperacional(JSON.parse(clientesKey))
      .then(({ checkDefs, validadeTestes }) => {
        if (cancelled) return;
        setCheckDefsByCliente(checkDefs);
        setValidadeTestesByCliente(validadeTestes);
      })
      .catch(() => {
        if (cancelled) return;
        setCheckDefsByCliente(new Map());
        setValidadeTestesByCliente(new Map());
      })
      .finally(() => {
        if (!cancelled) setDefsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, clientesKey]);

  // Origem do produto: Transbordo (OPs) e Industrialização (containers) fornecem
  // lote/fabricação/validade iguais aos da tela de Vasilhames de cada módulo.
  const origemNeeds = useMemo(() => {
    const containerIds = new Set();
    let precisaTransbordos = false;
    for (const saida of saidas || []) {
      for (const linha of saida?.itens || []) {
        if (linha?.vasilhame_id) precisaTransbordos = true;
        if (linha?.tipo === TIPO_IND_VASILHAME && linha.container_id) {
          containerIds.add(String(linha.container_id));
        }
      }
    }
    return {
      precisaTransbordos,
      containerKey: [...containerIds].sort().join(','),
    };
  }, [saidas]);

  const [transbordos, setTransbordos] = useState([]);
  const [containerDatasById, setContainerDatasById] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    if (origemNeeds.precisaTransbordos) {
      entities.transbordos
        .list()
        .then((rows) => !cancelled && setTransbordos(rows || []))
        .catch(() => {});
    }
    if (origemNeeds.containerKey) {
      loadContainerLoteDatasMap(origemNeeds.containerKey.split(','))
        .then((map) => !cancelled && setContainerDatasById(map))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [open, origemNeeds.precisaTransbordos, origemNeeds.containerKey]);

  const builtItems = useMemo(
    () => {
      if (defsLoading || checkDefsByCliente == null) return [];
      return buildChecklistItemsFromSaidas({
        bookings: list,
        saidas,
        vasilhames,
        entradas,
        transbordos,
        containerDatasById,
        checkDefsByCliente,
        validadeTestesByCliente,
      });
    },
    [
      list,
      saidas,
      vasilhames,
      entradas,
      transbordos,
      containerDatasById,
      checkDefsByCliente,
      validadeTestesByCliente,
      defsLoading,
    ]
  );

  const [items, setItems] = useState([]);
  const [activeKey, setActiveKey] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const dirtyRef = useRef(false);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      return;
    }
    if (!booking || defsLoading || checkDefsByCliente == null) return;
    if (initializedRef.current) return;
    initializedRef.current = true;
    const stored = parseStoredChecklist(booking.checklist_respostas);
    setItems(mergeChecklistItems(builtItems, stored.items));
    setActiveKey(null);
    setSaving(false);
    setUploading(false);
    setError('');
    dirtyRef.current = false;
  }, [open, booking, builtItems, defsLoading, checkDefsByCliente]);

  // Reconcilia quando saídas/vasilhames carregam depois da abertura, sem perder progresso local
  useEffect(() => {
    if (!open || !initializedRef.current || builtItems.length === 0) return;
    setItems((prev) => {
      if (prev.length === 0) {
        const stored = parseStoredChecklist(booking?.checklist_respostas);
        return mergeChecklistItems(builtItems, stored.items);
      }
      return mergeChecklistItems(builtItems, prev);
    });
  }, [builtItems, open, booking?.checklist_respostas]);

  const activeIndex = activeKey ? items.findIndex((it) => it.item_key === activeKey) : -1;
  const active = activeIndex >= 0 ? items[activeIndex] : null;
  const nextItem = activeIndex >= 0 && activeIndex < items.length - 1 ? items[activeIndex + 1] : null;
  const allApproved = areAllItemsApproved(items);
  // Foto obrigatória em cada item para liberar (liberações anteriores são preservadas).
  const releaseOptions = { requirePhotos: !alreadyLiberated };
  const canRelease = areAllItemsReleasable(items, releaseOptions);
  const anyRejected = hasRejectedItem(items);
  const doneCount = items.filter(
    (it) => it.status === CHECKLIST_STATUS.APROVADO || it.status === CHECKLIST_STATUS.REPROVADO
  ).length;
  const operadorNome =
    user?.nome || user?.full_name || user?.username || user?.email || '—';

  const statusLabel = (status) =>
    t(`painel.comercial.agendamentos.checklist.status.${
      {
        [CHECKLIST_STATUS.PENDENTE]: 'pendente',
        [CHECKLIST_STATUS.EM_CONFERENCIA]: 'emConferencia',
        [CHECKLIST_STATUS.APROVADO]: 'aprovado',
        [CHECKLIST_STATUS.REPROVADO]: 'reprovado',
      }[status] || 'pendente'
    }`);

  const updateItem = (itemKey, updater) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.item_key !== itemKey) return it;
        const next = updater(it);
        const status = computeItemStatus(next);
        const wasFinal =
          it.status === CHECKLIST_STATUS.APROVADO || it.status === CHECKLIST_STATUS.REPROVADO;
        const isFinal =
          status === CHECKLIST_STATUS.APROVADO || status === CHECKLIST_STATUS.REPROVADO;
        return {
          ...next,
          status,
          conferido_em: isFinal ? (wasFinal && it.conferido_em ? it.conferido_em : new Date().toISOString()) : null,
          conferido_por_id: isFinal ? (user?.id != null ? String(user.id) : null) : null,
          conferido_por_nome: isFinal ? operadorNome : null,
        };
      })
    );
    dirtyRef.current = true;
    setError('');
  };

  const setAnswer = (key, value) => {
    if (!active || readOnly) return;
    updateItem(active.item_key, (it) => ({
      ...it,
      checks: { ...it.checks, [key]: value },
    }));
  };

  const persist = async (nextItems, { markValidated = false } = {}) => {
    const payload = buildChecklistPayloadV2({ items: nextItems, user });
    await onSaveProgress?.({
      payload,
      markValidated: markValidated || areAllItemsReleasable(nextItems, releaseOptions),
    });
    dirtyRef.current = false;
    return payload;
  };

  const saveIfDirty = async (currentItems) => {
    if (!dirtyRef.current || readOnly) return;
    try {
      await persist(currentItems);
    } catch {
      // best-effort; erro exibido apenas em ações explícitas
    }
  };

  const handleBackToList = async () => {
    setActiveKey(null);
    await saveIfDirty(items);
  };

  const handleGoToNextItem = async () => {
    if (!nextItem || saving || uploading) return;
    setActiveKey(nextItem.item_key);
    await saveIfDirty(items);
  };

  const handleClose = async () => {
    if (saving) return;
    onClose();
    await saveIfDirty(items);
  };

  const handleLiberar = async () => {
    if (!canRelease || readOnly) return;
    setSaving(true);
    setError('');
    try {
      const payload = await persist(items, { markValidated: true });
      const stamped = list.map((row) => ({
        ...row,
        checklist_respostas: payload,
        checklist_validado_em: new Date().toISOString(),
        checklist_operador_id: user?.id != null ? String(user.id) : null,
        checklist_operador_nome: operadorNome,
      }));
      await onLiberar?.(stamped);
    } catch (err) {
      setError(err?.message || t('painel.comercial.agendamentos.checklist.liberarError'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveChanges = async () => {
    if (readOnly) return;
    setSaving(true);
    setError('');
    try {
      await persist(items, { markValidated: areAllItemsReleasable(items, releaseOptions) });
      dirtyRef.current = false;
      toast({ title: t('painel.comercial.agendamentos.checklist.progressSaved') });
    } catch (err) {
      setError(err?.message || t('painel.comercial.agendamentos.checklist.submitError'));
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length || !active || readOnly) return;
    setUploading(true);
    setError('');
    try {
      const urls = [];
      for (const file of files) {
        const url = await uploadFileToSupabase(file, 'fotos-cq');
        urls.push(url);
      }
      updateItem(active.item_key, (it) => ({
        ...it,
        fotos: [...(it.fotos || []), ...urls],
      }));
    } catch (err) {
      setError(err?.message || t('painel.comercial.agendamentos.checklist.photoError'));
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (url) => {
    if (!active || readOnly) return;
    updateItem(active.item_key, (it) => ({
      ...it,
      fotos: (it.fotos || []).filter((f) => f !== url),
    }));
  };

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [activeKey]);

  if (!booking) return null;

  const horarioLabel =
    booking.horario === ENCAIXE_HORARIO
      ? t('painel.comercial.agendamentos.encaixe')
      : booking.horario;

  const checkDefs = active ? checkDefsForItem(active) : [];
  const hasCustomChecks = Array.isArray(active?.check_defs) && active.check_defs.length > 0;
  const sections = [...new Set(checkDefs.map((c) => c.section))];
  const sectionTitle = (section) =>
    t(`painel.comercial.agendamentos.checklist.sections.${section}`, { defaultValue: section });

  const showLacresBlock = active?.kind === CHECKLIST_KIND.CONVENCIONAL && !hasCustomChecks;
  const showEslingaColor = Boolean(active?.validade_testes?.color_cod);
  const validadeDefs = checkDefs.filter((c) => c.section === VALIDADE_TESTES_SECTION);
  const visibleSections = sections.filter(
    (section) =>
      section !== VALIDADE_TESTES_SECTION &&
      section !== ESLINGA_COLOR_SECTION &&
      !(showLacresBlock && section === 'lacres')
  );

  // Ordem de exibição = ordem de conferência: lacres, testes, eslinga e demais seções.
  const itemNumbers = (() => {
    const orderedKeys = [];
    if (showLacresBlock) {
      checkDefs.filter((c) => c.section === 'lacres').forEach((c) => orderedKeys.push(c.key));
    }
    validadeDefs.forEach((c) => orderedKeys.push(c.key));
    if (showEslingaColor) orderedKeys.push(ESLINGA_COLOR_CHECK_KEY);
    visibleSections.forEach((section) => {
      checkDefs.filter((c) => c.section === section).forEach((c) => orderedKeys.push(c.key));
    });
    return new Map(orderedKeys.map((key, index) => [key, index + 1]));
  })();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && handleClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
        {/* Cabeçalho */}
        <DialogHeader className="space-y-2 border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-[#2575D1]" />
            {t('painel.comercial.agendamentos.checklist.title')}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {t('painel.comercial.agendamentos.modal.slotLabel', {
              date: formatDateBR(String(booking.data).slice(0, 10)),
              time: horarioLabel,
            })}
            {summary.codesLabel && summary.codesLabel !== '—' ? ` · ${summary.codesLabel}` : ''}
          </p>

          {items.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-muted-foreground">
                  {t('painel.comercial.agendamentos.checklist.progress', {
                    done: doneCount,
                    total: items.length,
                  })}
                </span>
                {allApproved ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t('painel.comercial.agendamentos.checklist.status.aprovado')}
                  </span>
                ) : anyRejected ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-red-700">
                    <XCircle className="h-3.5 w-3.5" />
                    {t('painel.comercial.agendamentos.checklist.status.reprovado')}
                  </span>
                ) : null}
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    anyRejected ? 'bg-red-500' : 'bg-emerald-500'
                  )}
                  style={{ width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }}
                />
              </div>
            </div>
          ) : null}
        </DialogHeader>

        {/* Corpo */}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
          {defsLoading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('painel.comercial.agendamentos.checklist.loadingDefs', {
                defaultValue: 'Carregando checklist...',
              })}
            </div>
          ) : items.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              {t('painel.comercial.agendamentos.checklist.emptyItems')}
            </div>
          ) : !active ? (
            /* ---- Tela 1: lista de itens ---- */
            <div className="space-y-2 px-6 py-4">
              {anyRejected ? (
                <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{t('painel.comercial.agendamentos.checklist.rejectedBanner')}</span>
                </div>
              ) : null}
              {items.map((it) => {
                const s = computeChecksSummary(it);
                const Icon = it.kind === CHECKLIST_KIND.CONVENCIONAL ? Container : Package;
                return (
                  <button
                    key={it.item_key}
                    type="button"
                    onClick={() => setActiveKey(it.item_key)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left shadow-sm transition-colors',
                      it.status === CHECKLIST_STATUS.REPROVADO
                        ? 'border-red-200 bg-red-50 hover:bg-red-100/60'
                        : it.status === CHECKLIST_STATUS.APROVADO
                          ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100/60'
                          : 'border-border bg-white hover:bg-slate-50'
                    )}
                  >
                    <div
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                        it.status === CHECKLIST_STATUS.APROVADO
                          ? 'bg-emerald-100 text-emerald-700'
                          : it.status === CHECKLIST_STATUS.REPROVADO
                            ? 'bg-red-100 text-red-700'
                            : 'bg-muted text-muted-foreground'
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{it.label}</p>
                        <StatusBadge status={it.status} label={statusLabel(it.status)} className="shrink-0" />
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {it.saida_codigo} · {it.tipo_label} · {it.produto}
                        {it.lote && it.lote !== '—' ? ` · ${t('painel.comercial.agendamentos.checklist.fields.lote')} ${it.lote}` : ''}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {t('painel.comercial.agendamentos.checklist.checksProgress', {
                          answered: s.answered,
                          total: s.total,
                        })}
                        {releaseOptions.requirePhotos && !itemHasPhotos(it) ? (
                          <span className="ml-2 font-medium text-amber-700">
                            · {t('painel.comercial.agendamentos.checklist.photoRequired')}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          ) : (
            /* ---- Tela 2: conferência do item ---- */
            <div className="space-y-4 px-6 py-4">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={handleBackToList}
                  className="inline-flex items-center gap-1 text-sm font-medium text-[#2575D1] hover:underline"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {t('painel.comercial.agendamentos.checklist.backToItems')}
                </button>
                <StatusBadge status={active.status} label={statusLabel(active.status)} />
              </div>

              <div>
                <h3 className="text-base font-semibold text-foreground">{active.label}</h3>
                <p className="text-xs text-muted-foreground">
                  {t('painel.comercial.agendamentos.checklist.saidaId')}:{' '}
                  <span className="font-medium text-foreground">{active.saida_codigo}</span>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.produto')}
                  value={active.produto}
                />
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.tipo')}
                  value={active.tipo_label}
                />
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.quantidade')}
                  value={active.quantidade}
                />
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.lote')}
                  value={active.lote}
                />
                {active.kind === CHECKLIST_KIND.CONVENCIONAL ? (
                  <>
                    <InfoChip
                      label={t('painel.comercial.agendamentos.checklist.fields.tanque')}
                      value={
                        [active.vasilhame_placa, active.vasilhame_barril]
                          .filter(Boolean)
                          .join(' / ') || '—'
                      }
                    />
                    <InfoChip
                      label={t('painel.comercial.agendamentos.checklist.fields.pesoLiquido')}
                      value={
                        active.peso_liquido != null
                          ? `${formatMassSafe(active.peso_liquido)} kg`
                          : '—'
                      }
                    />
                  </>
                ) : (
                  <InfoChip
                    label={t('painel.comercial.agendamentos.checklist.fields.embalagens')}
                    value={formatEmbalagens(active.quantidade_embalagens)}
                  />
                )}
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.fabricacao')}
                  value={formatChecklistDate(active.data_fabricacao, i18n.language)}
                />
                <InfoChip
                  label={t('painel.comercial.agendamentos.checklist.fields.validade')}
                  value={formatChecklistDate(active.data_validade, i18n.language)}
                />
              </div>

              {showLacresBlock ? (
                <div className="space-y-3 rounded-lg border border-border bg-white p-3 shadow-sm">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('painel.comercial.agendamentos.checklist.sections.lacres')}
                    </p>
                    {active.lacres?.length > 0 ? (
                      <>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('painel.comercial.agendamentos.checklist.lacresCount', {
                            count: active.lacres.length,
                          })}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {active.lacres.map((l, i) => (
                            <span
                              key={`${l.numero}-${i}`}
                              className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2.5 py-1 font-mono text-sm font-medium text-foreground"
                            >
                              {l.numero}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-amber-700">
                        {t('painel.comercial.agendamentos.checklist.noLacres')}
                      </p>
                    )}
                  </div>
                  <div className="space-y-1.5 border-t border-border pt-3">
                    {checkDefs
                      .filter((c) => c.section === 'lacres')
                      .map((c) => (
                        <CheckAnswerRow
                          key={c.key}
                          label={checkDefLabel(c, t)}
                          number={itemNumbers.get(c.key)}
                          value={active.checks?.[c.key] || ''}
                          disabled={readOnly || saving}
                          onChange={(v) => setAnswer(c.key, v)}
                          options={APPROVE_REJECT_OPTIONS}
                          t={t}
                        />
                      ))}
                  </div>
                </div>
              ) : null}

              {active.kind === CHECKLIST_KIND.CONVENCIONAL && hasCustomChecks && active.lacres?.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-border bg-white p-3 shadow-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('painel.comercial.agendamentos.checklist.sections.lacres')}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {active.lacres.map((l, i) => (
                      <span
                        key={`${l.numero}-${i}`}
                        className="inline-flex items-center rounded-md border border-border bg-muted/40 px-2.5 py-1 font-mono text-sm font-medium text-foreground"
                      >
                        {l.numero}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {validadeDefs.length > 0 ? (
                <ValidadeTestesSection
                  validade={active.validade_testes}
                  defs={validadeDefs}
                  itemNumbers={itemNumbers}
                  checks={active.checks}
                  disabled={readOnly || saving}
                  onChange={setAnswer}
                  language={i18n.language}
                  t={t}
                />
              ) : null}

              {showEslingaColor ? (
                <EslingaColorSection
                  colorCod={active.validade_testes.color_cod}
                  number={itemNumbers.get(ESLINGA_COLOR_CHECK_KEY)}
                  value={active.checks?.[ESLINGA_COLOR_CHECK_KEY] || ''}
                  disabled={readOnly || saving}
                  onChange={(v) => setAnswer(ESLINGA_COLOR_CHECK_KEY, v)}
                  t={t}
                />
              ) : null}

              {visibleSections.map((section) => (
                <div key={section} className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {sectionTitle(section)}
                  </p>
                  {checkDefs
                    .filter((c) => c.section === section)
                    .map((c) => (
                      <CheckAnswerRow
                        key={c.key}
                        label={checkDefLabel(c, t)}
                        number={itemNumbers.get(c.key)}
                        value={active.checks?.[c.key] || ''}
                        disabled={readOnly || saving}
                        onChange={(v) => setAnswer(c.key, v)}
                        t={t}
                      />
                    ))}
                </div>
              ))}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('painel.comercial.agendamentos.checklist.sections.fotos')}
                  {releaseOptions.requirePhotos ? (
                    <span className="ml-1 text-red-600" aria-hidden="true">*</span>
                  ) : null}
                </p>
                {releaseOptions.requirePhotos && !itemHasPhotos(active) ? (
                  <p className="text-xs text-amber-700">
                    {t('painel.comercial.agendamentos.checklist.photoRequiredHint')}
                  </p>
                ) : null}
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={handlePhotoUpload}
                />
                <div className="flex flex-wrap gap-2">
                  {(active.fotos || []).map((url) => (
                    <div key={url} className="group relative">
                      <SignedImage
                        url={url}
                        alt={t('painel.comercial.agendamentos.checklist.photoAlt')}
                        className="h-16 w-16 rounded-lg border object-cover"
                      />
                      {!readOnly ? (
                        <button
                          type="button"
                          onClick={() => removePhoto(url)}
                          className="absolute -right-1 -top-1 rounded-full border bg-white p-0.5 text-red-500 opacity-0 group-hover:opacity-100"
                          title={t('buttons.delete')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {!readOnly ? (
                    <>
                      <button
                        type="button"
                        disabled={uploading || saving}
                        onClick={() => cameraInputRef.current?.click()}
                        className="flex h-16 min-w-[7rem] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 text-xs font-medium text-gray-500 hover:border-[#2575D1] hover:text-[#2575D1] disabled:opacity-50"
                      >
                        {uploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Camera className="h-4 w-4" />
                        )}
                        {t('painel.comercial.agendamentos.checklist.takePhoto')}
                      </button>
                      <button
                        type="button"
                        disabled={uploading || saving}
                        onClick={() => galleryInputRef.current?.click()}
                        className="flex h-16 min-w-[7rem] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 px-3 text-xs font-medium text-gray-500 hover:border-[#2575D1] hover:text-[#2575D1] disabled:opacity-50"
                      >
                        {uploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ImagePlus className="h-4 w-4" />
                        )}
                        {t('painel.comercial.agendamentos.checklist.attachPhotos')}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {active.conferido_em ? (
                <p className="text-xs text-muted-foreground">
                  {t('painel.comercial.agendamentos.checklist.itemValidatedAt', {
                    date: new Date(active.conferido_em).toLocaleString(i18n.language || 'pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }),
                    operador: active.conferido_por_nome || '—',
                  })}
                </p>
              ) : null}

              {nextItem ? (
                <button
                  type="button"
                  onClick={handleGoToNextItem}
                  disabled={saving || uploading}
                  className="flex w-full items-center gap-3 rounded-xl border border-[#2575D1]/30 bg-[#2575D1]/5 px-4 py-3 text-left shadow-sm transition-colors hover:bg-[#2575D1]/10 disabled:cursor-default disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#2575D1]">
                      {t('painel.comercial.agendamentos.checklist.nextItem')}
                    </p>
                    <p className="truncate text-sm font-semibold text-foreground">{nextItem.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {nextItem.saida_codigo}
                      {nextItem.produto ? ` · ${nextItem.produto}` : ''}
                    </p>
                  </div>
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2575D1] text-white">
                    <ChevronRight className="h-5 w-5" />
                  </span>
                </button>
              ) : null}
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="space-y-2 border-t border-border bg-muted/20 px-6 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">
                {t('painel.comercial.agendamentos.checklist.responsible')}
              </p>
              <p className="font-semibold text-foreground">{operadorNome}</p>
            </div>
            {readOnly && booking.checklist_validado_em ? (
              <p className="text-xs text-emerald-700 font-medium">
                {t('painel.comercial.agendamentos.checklist.validatedAt', {
                  date: new Date(booking.checklist_validado_em).toLocaleString(
                    i18n.language || 'pt-BR',
                    {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }
                  ),
                  operador: booking.checklist_operador_nome || '—',
                })}
              </p>
            ) : alreadyLiberated && booking.checklist_validado_em ? (
              <p className="text-xs text-emerald-700 font-medium">
                {t('painel.comercial.agendamentos.checklist.validatedEditableHint', {
                  date: new Date(booking.checklist_validado_em).toLocaleString(
                    i18n.language || 'pt-BR',
                    {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    }
                  ),
                })}
              </p>
            ) : null}
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 border-t border-border bg-muted/30 px-6 py-3">
          <Button type="button" variant="outline" onClick={handleClose} disabled={saving}>
            {t('buttons.close')}
          </Button>
          {!readOnly ? (
            <Can anyOf={[`${permissionPrefix}.edit`, `${permissionPrefix}.view`]}>
              {items.length > 0 ? (
                <Button
                  type="button"
                  variant={alreadyLiberated ? 'default' : 'outline'}
                  disabled={saving || uploading}
                  onClick={handleSaveChanges}
                  className={alreadyLiberated ? 'text-white' : undefined}
                  style={alreadyLiberated ? { background: '#2575D1' } : undefined}
                >
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  {t('painel.comercial.agendamentos.checklist.saveProgress')}
                </Button>
              ) : null}
              {!alreadyLiberated ? (
                <Button
                  type="button"
                  disabled={!canRelease || saving || uploading}
                  onClick={handleLiberar}
                  className="text-white"
                  style={{ background: canRelease ? '#059669' : '#94a3b8' }}
                  title={
                    canRelease
                      ? ''
                      : anyRejected
                        ? t('painel.comercial.agendamentos.checklist.rejectedBlockedHint')
                        : allApproved
                          ? t('painel.comercial.agendamentos.checklist.photoRequiredHint')
                          : t('painel.comercial.agendamentos.checklist.liberarBlockedHint')
                  }
                >
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  {t('painel.comercial.agendamentos.checklist.liberarExpedicao')}
                </Button>
              ) : null}
            </Can>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatEmbalagens(n) {
  if (n == null || n === '') return '—';
  const value = Number(n);
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMassSafe(n) {
  try {
    return Number(n).toLocaleString('pt-BR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
  } catch {
    return String(n);
  }
}

function formatChecklistDate(value, language = 'pt-BR') {
  if (!value) return '—';
  const raw = String(value);
  const date = raw.includes('T') ? new Date(raw) : new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(language || 'pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
