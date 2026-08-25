/**
 * Checklist de liberação de carregamento — por item da saída.
 * Convencional/Vasilhame: conferência por tanque.
 * Embalado: conferência por produto/linha.
 */

import {
  TIPO_CONVENCIONAL,
  TIPO_EMBALADO,
  TIPO_IND_RETORNO_MP,
  TIPO_IND_VASILHAME,
  formatSaidaItemLote,
  tipoItemLabel,
} from '@transbordo/lib/saidaOrigem';
import { formatMass, formatVolume } from '@transbordo/lib/format';

export const CHECKLIST_STATUS = {
  PENDENTE: 'pendente',
  EM_CONFERENCIA: 'em_conferencia',
  APROVADO: 'aprovado',
  REPROVADO: 'reprovado',
};

export const CHECKLIST_KIND = {
  CONVENCIONAL: 'convencional',
  EMBALADO: 'embalado',
};

/** Resposta de cada verificação individual. */
export const CHECK_ANSWER = {
  APROVADO: 'aprovado',
  REPROVADO: 'reprovado',
  NAO_SE_APLICA: 'nao_se_aplica',
};

/** Checks obrigatórios — Convencional / Vasilhame (por tanque). */
export const CONVENCIONAL_CHECKS = [
  {
    key: 'identificacao_confere',
    section: 'identificacao',
    labelKey: 'painel.comercial.agendamentos.checklist.items.convencional.identificacaoConfere',
  },
  {
    key: 'etiqueta_confere',
    section: 'etiqueta',
    labelKey: 'painel.comercial.agendamentos.checklist.items.convencional.etiquetaConfere',
  },
  {
    key: 'lacres_numeros_conferem',
    section: 'lacres',
    labelKey: 'painel.comercial.agendamentos.checklist.items.convencional.lacresNumeros',
  },
  {
    key: 'tanque_lacrado',
    section: 'lacres',
    labelKey: 'painel.comercial.agendamentos.checklist.items.convencional.tanqueLacrado',
  },
  {
    key: 'estado_bom',
    section: 'estado',
    labelKey: 'painel.comercial.agendamentos.checklist.items.convencional.estadoBom',
  },
  {
    key: 'sem_amassados',
    section: 'estado',
    labelKey: 'painel.comercial.agendamentos.checklist.items.convencional.semAmassados',
  },
  {
    key: 'sem_corrosao',
    section: 'estado',
    labelKey: 'painel.comercial.agendamentos.checklist.items.convencional.semCorrosao',
  },
  {
    key: 'sem_vazamento',
    section: 'estado',
    labelKey: 'painel.comercial.agendamentos.checklist.items.convencional.semVazamento',
  },
  {
    key: 'sem_sujidade',
    section: 'estado',
    labelKey: 'painel.comercial.agendamentos.checklist.items.convencional.semSujidade',
  },
  {
    key: 'cap_valvula',
    section: 'estado',
    labelKey: 'painel.comercial.agendamentos.checklist.items.convencional.capValvula',
  },
];

/** Checks obrigatórios — Embalado. */
export const EMBALADO_CHECKS = [
  {
    key: 'quantidade_confere',
    section: 'quantidade',
    labelKey: 'painel.comercial.agendamentos.checklist.items.embalado.quantidadeConfere',
  },
  {
    key: 'lote_confere',
    section: 'lote',
    labelKey: 'painel.comercial.agendamentos.checklist.items.embalado.loteConfere',
  },
  {
    key: 'embalagens_lacradas',
    section: 'lacracao',
    labelKey: 'painel.comercial.agendamentos.checklist.items.embalado.embalagensLacradas',
  },
  {
    key: 'paletes_ok',
    section: 'paletes',
    labelKey: 'painel.comercial.agendamentos.checklist.items.embalado.paletesOk',
  },
];

export function isTipoConvencionalChecklist(tipo) {
  return tipo === TIPO_CONVENCIONAL || tipo === TIPO_IND_VASILHAME;
}

export function isTipoEmbaladoChecklist(tipo) {
  return tipo === TIPO_EMBALADO || tipo === TIPO_IND_RETORNO_MP;
}

export function checklistKindForTipo(tipo) {
  if (isTipoConvencionalChecklist(tipo)) return CHECKLIST_KIND.CONVENCIONAL;
  if (isTipoEmbaladoChecklist(tipo)) return CHECKLIST_KIND.EMBALADO;
  return CHECKLIST_KIND.EMBALADO;
}

export function checksForKind(kind) {
  return kind === CHECKLIST_KIND.CONVENCIONAL ? CONVENCIONAL_CHECKS : EMBALADO_CHECKS;
}

/** Parseia lacres do envase (texto livre) sem criar novos números. */
export function parseLacresFromEnvase(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];

  // Separa por vírgula, ponto-e-vírgula, quebra de linha, barra ou pipe.
  // Se o trecho ainda tiver vários números separados por espaço, desmembra.
  const parts = text
    .split(/[,;\n|/]+/)
    .flatMap((part) => {
      const trimmed = part.trim();
      if (!trimmed) return [];
      const spaced = trimmed.split(/\s+/).filter(Boolean);
      if (spaced.length > 1 && spaced.every((t) => /^[\w./#-]+$/.test(t))) {
        return spaced;
      }
      return [trimmed];
    });

  return parts.map((part) => {
    const match = part.match(/^(.+?)\s*[:=\-–]\s*(.+)$/);
    if (match) {
      return {
        local: match[1].trim(),
        numero: match[2].trim(),
      };
    }
    return {
      local: '',
      numero: part,
    };
  });
}

function formatQtdItem(item) {
  if (isTipoConvencionalChecklist(item?.tipo)) {
    const vol = item.volume_solicitado ?? item.peso_liquido;
    return vol != null && vol !== '' ? `${formatVolume(vol)} L` : '—';
  }
  const qtd = item.quantidade_solicitada ?? item.quantidade_embalagens;
  const u = String(item.unidade || 'kg').toLowerCase().trim();
  const isVol = u === 'l' || u === 'lt' || u === 'litro' || u === 'litros';
  if (qtd == null || qtd === '') return '—';
  return `${isVol ? formatVolume(qtd) : formatMass(qtd)} ${item.unidade || 'kg'}`;
}

function tanqueLabel(item, vasilhame, index) {
  const placa =
    item?.vasilhame_placa ||
    vasilhame?.placa ||
    item?.container_number ||
    vasilhame?.container_number ||
    '';
  const barril = item?.vasilhame_barril || vasilhame?.barril || vasilhame?.barril_number || '';
  const num = placa || barril || String(index + 1).padStart(2, '0');
  const prefix = `Tanque ${String(index + 1).padStart(2, '0')}`;
  return placa || barril ? `${prefix} — Nº ${[placa, barril].filter(Boolean).join(' / ')}` : `${prefix} — Nº ${num}`;
}

/**
 * Monta a lista de itens de conferência a partir das saídas do slot.
 * @returns {Array<object>}
 */
export function buildChecklistItemsFromSaidas({
  bookings = [],
  saidas = [],
  vasilhames = [],
  entradas = [],
} = {}) {
  const saidaById = new Map((saidas || []).map((s) => [String(s.id), s]));
  const vasilhameById = new Map((vasilhames || []).map((v) => [String(v.id), v]));
  const estoqueById = new Map((entradas || []).map((e) => [String(e.id), e]));
  const items = [];
  let convencionalSeq = 0;

  for (const booking of bookings || []) {
    const saida = saidaById.get(String(booking.saida_id));
    if (!saida) continue;
    const linhas = Array.isArray(saida.itens) ? saida.itens : [];

    linhas.forEach((linha, idx) => {
      const kind = checklistKindForTipo(linha.tipo);
      const vasilhame =
        (linha.vasilhame_id && vasilhameById.get(String(linha.vasilhame_id))) ||
        null;
      const estoque =
        (linha.entrada_id && estoqueById.get(String(linha.entrada_id))) ||
        (linha.stock_id && estoqueById.get(String(linha.stock_id))) ||
        null;
      const lacres = parseLacresFromEnvase(vasilhame?.lacres || linha.lacres || '');
      const isConv = kind === CHECKLIST_KIND.CONVENCIONAL;
      if (isConv) convencionalSeq += 1;

      const itemKey = isConv
        ? `conv:${saida.id}:${linha.vasilhame_id || linha.container_id || idx}`
        : `emb:${saida.id}:${linha.entrada_id || linha.stock_id || idx}`;

      const { data_fabricacao, data_validade } = resolveItemDates({
        linha,
        vasilhame,
        estoque,
        estoqueById,
      });

      items.push({
        item_key: itemKey,
        saida_id: saida.id,
        saida_codigo: saida.codigo || booking.saida_codigo || '—',
        item_index: idx,
        kind,
        tipo: linha.tipo,
        tipo_label: tipoItemLabel(linha),
        label: isConv
          ? tanqueLabel(linha, vasilhame, convencionalSeq - 1)
          : `${linha.produto_nome || linha.produto || 'Produto'} · ${saida.codigo || ''}`.trim(),
        produto: linha.produto_nome || linha.produto || '—',
        produto_codigo: linha.produto_codigo || '',
        lote: formatSaidaItemLote(linha, { vasilhame }),
        quantidade: formatQtdItem(linha),
        quantidade_embalagens: linha.quantidade_embalagens ?? null,
        unidade: linha.unidade || (isConv ? 'L' : 'kg'),
        vasilhame_id: linha.vasilhame_id || null,
        vasilhame_placa: linha.vasilhame_placa || vasilhame?.placa || '',
        vasilhame_barril: linha.vasilhame_barril || vasilhame?.barril || '',
        peso_liquido: linha.peso_liquido ?? vasilhame?.peso_liquido ?? null,
        peso_bruto: linha.peso_bruto ?? vasilhame?.peso_bruto ?? null,
        volume_solicitado: linha.volume_solicitado ?? null,
        tipo_embalagem: linha.tipo_embalagem || '',
        data_fabricacao,
        data_validade,
        lacres,
        checks: emptyChecksMap(kind),
        fotos: [],
        status: CHECKLIST_STATUS.PENDENTE,
        conferido_em: null,
        conferido_por_id: null,
        conferido_por_nome: null,
      });
    });
  }

  return items;
}

/**
 * Resolve fabricação/validade a partir do item, estoque (embalado) ou
 * composição do tanque (convencional).
 */
function resolveItemDates({ linha, vasilhame, estoque, estoqueById }) {
  let fabricacao =
    linha?.data_fabricacao ||
    estoque?.data_fabricacao ||
    null;
  let validade =
    linha?.data_validade ||
    estoque?.data_validade ||
    null;

  if ((!fabricacao || !validade) && vasilhame) {
    const composicao = Array.isArray(vasilhame.composicao) ? vasilhame.composicao : [];
    for (const c of composicao) {
      const estoqueId = c?.estoque_id || null;
      const entradaId = c?.entrada_id || null;
      const row =
        (estoqueId && estoqueById.get(String(estoqueId))) ||
        (entradaId && estoqueById.get(String(entradaId))) ||
        null;
      if (!row) continue;
      if (!fabricacao && row.data_fabricacao) fabricacao = row.data_fabricacao;
      if (!validade && row.data_validade) validade = row.data_validade;
      if (fabricacao && validade) break;
    }

    // Fallback por lote quando a composição não aponta para o estoque
    if ((!fabricacao || !validade) && (vasilhame.lote || linha?.lote)) {
      const loteKey = String(vasilhame.lote || linha?.lote || '')
        .trim()
        .toLowerCase();
      if (loteKey) {
        for (const row of estoqueById.values()) {
          if (String(row.lote || '').trim().toLowerCase() !== loteKey) continue;
          if (!fabricacao && row.data_fabricacao) fabricacao = row.data_fabricacao;
          if (!validade && row.data_validade) validade = row.data_validade;
          if (fabricacao && validade) break;
        }
      }
    }
  }

  return {
    data_fabricacao: fabricacao || null,
    data_validade: validade || null,
  };
}

export function emptyChecksMap(kind) {
  const map = {};
  for (const c of checksForKind(kind)) {
    map[c.key] = '';
  }
  return map;
}

/** Normaliza valores salvos (inclui formato antigo booleano). */
export function normalizeCheckValue(value) {
  if (value === true) return CHECK_ANSWER.APROVADO;
  if (
    value === CHECK_ANSWER.APROVADO ||
    value === CHECK_ANSWER.REPROVADO ||
    value === CHECK_ANSWER.NAO_SE_APLICA
  ) {
    return value;
  }
  return '';
}

/** Resumo das verificações de um item. */
export function computeChecksSummary(kind, checks) {
  const defs = checksForKind(kind);
  let answered = 0;
  let reprovados = 0;
  for (const d of defs) {
    const v = normalizeCheckValue(checks?.[d.key]);
    if (v) answered += 1;
    if (v === CHECK_ANSWER.REPROVADO) reprovados += 1;
  }
  return {
    total: defs.length,
    answered,
    reprovados,
    complete: answered === defs.length,
  };
}

/**
 * Status do item derivado das respostas:
 * qualquer verificação reprovada → Reprovado;
 * todas respondidas sem reprovação → Aprovado;
 * parcialmente respondido → Em conferência.
 */
export function computeItemStatus(kind, checks) {
  const s = computeChecksSummary(kind, checks);
  if (s.reprovados > 0) return CHECKLIST_STATUS.REPROVADO;
  if (s.complete) return CHECKLIST_STATUS.APROVADO;
  if (s.answered > 0) return CHECKLIST_STATUS.EM_CONFERENCIA;
  return CHECKLIST_STATUS.PENDENTE;
}

export function isItemApproved(item) {
  return item?.status === CHECKLIST_STATUS.APROVADO;
}

export function areAllItemsApproved(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((it) => isItemApproved(it));
}

export function hasRejectedItem(items = []) {
  return (items || []).some((it) => it?.status === CHECKLIST_STATUS.REPROVADO);
}

/**
 * Localiza o item de checklist correspondente a uma linha da saída.
 */
export function findChecklistItemForSaidaLinha(checklistItems, saida, linha, index) {
  const list = Array.isArray(checklistItems) ? checklistItems : [];
  if (list.length === 0 || !saida) return null;

  const saidaId = String(saida.id);
  const byIndex = list.find(
    (it) => String(it.saida_id) === saidaId && Number(it.item_index) === Number(index)
  );
  if (byIndex) return byIndex;

  const isConv = isTipoConvencionalChecklist(linha?.tipo);
  const key = isConv
    ? `conv:${saida.id}:${linha?.vasilhame_id || linha?.container_id || index}`
    : `emb:${saida.id}:${linha?.entrada_id || linha?.stock_id || index}`;

  return list.find((it) => it.item_key === key) || null;
}

/**
 * Extrai itens de checklist de um booking (checklist_respostas), filtrando por saída.
 */
export function checklistItemsFromBooking(booking, saidaId = null) {
  const parsed = parseStoredChecklist(booking?.checklist_respostas);
  const items = parsed.items || [];
  if (!saidaId) return items;
  return items.filter((it) => String(it.saida_id) === String(saidaId));
}

/**
 * Payload versionado persistido em checklist_respostas (jsonb).
 * Compatível com leitura do formato legado (array de perguntas sim/não).
 */
export function buildChecklistPayloadV2({ items, user }) {
  return {
    version: 2,
    items: (items || []).map((it) => ({
      item_key: it.item_key,
      saida_id: it.saida_id,
      saida_codigo: it.saida_codigo,
      item_index: it.item_index,
      kind: it.kind,
      tipo: it.tipo,
      tipo_label: it.tipo_label,
      label: it.label,
      produto: it.produto,
      produto_codigo: it.produto_codigo,
      lote: it.lote,
      quantidade: it.quantidade,
      quantidade_embalagens: it.quantidade_embalagens,
      unidade: it.unidade,
      vasilhame_id: it.vasilhame_id,
      vasilhame_placa: it.vasilhame_placa,
      vasilhame_barril: it.vasilhame_barril,
      peso_liquido: it.peso_liquido,
      peso_bruto: it.peso_bruto,
      volume_solicitado: it.volume_solicitado,
      tipo_embalagem: it.tipo_embalagem,
      data_fabricacao: it.data_fabricacao || null,
      data_validade: it.data_validade || null,
      lacres: Array.isArray(it.lacres) ? it.lacres : [],
      checks: { ...it.checks },
      fotos: Array.isArray(it.fotos) ? [...it.fotos] : [],
      status: it.status || CHECKLIST_STATUS.PENDENTE,
      conferido_em: it.conferido_em || null,
      conferido_por_id: it.conferido_por_id || null,
      conferido_por_nome: it.conferido_por_nome || null,
    })),
    saved_at: new Date().toISOString(),
    saved_by_id: user?.id != null ? String(user.id) : null,
    saved_by_nome:
      user?.nome || user?.full_name || user?.username || user?.email || null,
  };
}

/** @returns {{ version: number, items: Array<object>, legacy?: boolean }} */
export function parseStoredChecklist(respostas) {
  if (respostas && typeof respostas === 'object' && !Array.isArray(respostas) && respostas.version === 2) {
    return {
      version: 2,
      items: Array.isArray(respostas.items) ? respostas.items : [],
      legacy: false,
    };
  }
  // Formato legado: array de { question_key, answer }
  if (Array.isArray(respostas)) {
    return { version: 1, items: [], legacy: true, legacyAnswers: respostas };
  }
  return { version: 2, items: [], legacy: false };
}

/**
 * Mescla itens reconstruídos da saída com progresso salvo.
 * Preserva checks/fotos/status; atualiza dados de exibição do sistema.
 */
export function mergeChecklistItems(builtItems, storedItems) {
  const byKey = new Map((storedItems || []).map((it) => [it.item_key, it]));
  return (builtItems || []).map((built) => {
    const saved = byKey.get(built.item_key);
    if (!saved) return built;
    const checks = { ...emptyChecksMap(built.kind) };
    for (const key of Object.keys(checks)) {
      checks[key] = normalizeCheckValue(saved.checks?.[key]);
    }
    return {
      ...built,
      checks,
      fotos: Array.isArray(saved.fotos) ? [...saved.fotos] : [],
      status: computeItemStatus(built.kind, checks),
      conferido_em: saved.conferido_em || null,
      conferido_por_id: saved.conferido_por_id || null,
      conferido_por_nome: saved.conferido_por_nome || null,
    };
  });
}

/** Checklist completo (todos os itens aprovados) — habilita liberação. */
export function isChecklistItemsComplete(respostas) {
  const parsed = parseStoredChecklist(respostas);
  if (parsed.legacy) {
    // Legado: se havia checklist_validado_em, tratado fora; aqui não há itens.
    return false;
  }
  return areAllItemsApproved(parsed.items);
}

// --- Compatibilidade com o checklist legado (perguntas sim/não) ---

export const CARREGAMENTO_ANSWER = {
  SIM: 'sim',
  NAO: 'nao',
};

/** @deprecated Mantido para leitura de registros antigos */
export function getCarregamentoChecklistQuestions() {
  return [];
}

export function validateCarregamentoChecklistAnswers() {
  return { ok: true, errors: {} };
}

export function buildCarregamentoChecklistPayload() {
  return [];
}

export function parseStoredCarregamentoChecklistAnswers(respostas) {
  const parsed = parseStoredChecklist(respostas);
  if (parsed.legacy && Array.isArray(parsed.legacyAnswers)) {
    const map = {};
    for (const item of parsed.legacyAnswers) {
      if (!item?.question_key) continue;
      map[item.question_key] = {
        answer: item.answer || '',
        observacao: item.observacao || '',
      };
    }
    return map;
  }
  return {};
}
