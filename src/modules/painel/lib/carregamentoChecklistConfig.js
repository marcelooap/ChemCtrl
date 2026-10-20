/**
 * Checklist de liberação de carregamento — por item da saída.
 * Convencional/Vasilhame: conferência por tanque.
 * Embalado: conferência por produto/linha.
 */

import {
  TIPO_CONVENCIONAL,
  TIPO_EMBALADO,
  clienteNomeKey,
  TIPO_IND_RETORNO_MP,
  TIPO_IND_VASILHAME,
  formatSaidaItemLote,
  tipoItemLabel,
  isTanqueVazioItem,
} from '@transbordo/lib/saidaOrigem';
import { formatMass, formatVolume } from '@transbordo/lib/format';
import { resolveVasilhameLoteDatas } from '@transbordo/lib/vasilhameComposicao';
import {
  calcularDataLimiteTestes,
  resolverTestesPorDestino,
  validadeTesteCheckKey,
} from '@painel/lib/validadeTestesTanque';

export const CHECKLIST_STATUS = {
  PENDENTE: 'pendente',
  EM_CONFERENCIA: 'em_conferencia',
  APROVADO: 'aprovado',
  REPROVADO: 'reprovado',
};

export const CHECKLIST_KIND = {
  CONVENCIONAL: 'convencional',
  EMBALADO: 'embalado',
  TANQUE_VAZIO: 'tanque_vazio',
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

export function checklistKindForLinha(linha) {
  if (isTanqueVazioItem(linha)) return CHECKLIST_KIND.TANQUE_VAZIO;
  return checklistKindForTipo(linha?.tipo);
}

export function checksForKind(kind) {
  if (kind === CHECKLIST_KIND.TANQUE_VAZIO) return [];
  return kind === CHECKLIST_KIND.CONVENCIONAL ? CONVENCIONAL_CHECKS : EMBALADO_CHECKS;
}

/** Verificação automática da validade dos testes do tanque (habilitada por cliente). */
export const VALIDADE_TESTES_CHECK_KEY = 'validade_testes_tanque';
export const VALIDADE_TESTES_SECTION = 'validade_testes';

/** Verificação do Color Cod da eslinga (quando cadastrado no destino). */
export const ESLINGA_COLOR_CHECK_KEY = 'color_cod_eslinga';
export const ESLINGA_COLOR_SECTION = 'color_cod_eslinga';

const VALIDADE_TESTES_CHECK_DEF = Object.freeze({
  key: VALIDADE_TESTES_CHECK_KEY,
  section: VALIDADE_TESTES_SECTION,
  labelKey: 'painel.comercial.agendamentos.checklist.validadeTestes.resultado',
});

const ESLINGA_COLOR_CHECK_DEF = Object.freeze({
  key: ESLINGA_COLOR_CHECK_KEY,
  section: ESLINGA_COLOR_SECTION,
  labelKey: 'painel.comercial.agendamentos.checklist.eslingaColor.resultado',
});

/**
 * Um item de checklist por teste do destino.
 * Conferência antiga (prazo único, sem lista) continua com a verificação única.
 * Destino da solicitação fora do cadastro gera um item bloqueado.
 */
export function validadeTesteDefs(validade) {
  if (!validade) return [];
  const testes = Array.isArray(validade.testes) ? validade.testes : null;
  if (testes && testes.length > 0) {
    return testes.map((teste) => ({
      key: teste.key || validadeTesteCheckKey(teste.nome),
      section: VALIDADE_TESTES_SECTION,
      label: teste.nome,
    }));
  }
  if (validade.dias != null && validade.configurado !== false && !testes) {
    return [VALIDADE_TESTES_CHECK_DEF];
  }
  if (validade.encontrado === false) return [VALIDADE_TESTES_CHECK_DEF];
  return [];
}

/**
 * Definições de verificação de um item: snapshot customizado do cliente
 * ou os checks padrão do kind (legado / cliente sem configuração).
 * Quando o item carrega `validade_testes`, cada teste do destino vira uma
 * verificação; com Color Cod cadastrado, segue a da eslinga.
 */
export function checkDefsForItem(item) {
  const base =
    Array.isArray(item?.check_defs) && item.check_defs.length > 0
      ? item.check_defs
      : checksForKind(item?.kind);
  const defs = [...base];
  // Tanque vazio: só as verificações configuradas para esse tipo (sem validade/eslinga).
  if (item?.kind === CHECKLIST_KIND.TANQUE_VAZIO || item?.tanque_vazio) {
    return defs;
  }
  defs.push(...validadeTesteDefs(item?.validade_testes));
  if (item?.validade_testes?.color_cod) defs.push(ESLINGA_COLOR_CHECK_DEF);
  return defs;
}

/** Rótulo traduzível: preferência por label persistido (config por cliente). */
export function checkDefLabel(def, t) {
  if (!def) return '';
  if (def.label) return String(def.label);
  if (def.labelKey && typeof t === 'function') return t(def.labelKey);
  return String(def.key || '');
}

export function emptyChecksMapForDefs(defs = []) {
  const map = {};
  for (const c of defs || []) {
    if (c?.key) map[c.key] = '';
  }
  return map;
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
 * Chave, no mapa de verificações, do cliente identificado pelo nome.
 * O cadastro pode ter ids duplicados para o mesmo nome; o nome garante o vínculo.
 */
export function checkDefsNomeKey(nome) {
  const key = clienteNomeKey(nome);
  return key ? `nome:${key}` : null;
}

function resolveCustomCheckDefs(defsMap, clienteId, clienteNome) {
  if (!defsMap) return null;
  const nomeKey = checkDefsNomeKey(clienteNome);
  return (
    (clienteId && defsMap.get(clienteId)) ||
    (nomeKey && defsMap.get(nomeKey)) ||
    null
  );
}

/**
 * Testes do tanque para o destino da solicitação.
 * A data limite de cada teste é hoje menos o prazo: a execução no físico
 * precisa ser maior que essa data. Destino fora do cadastro não traz testes.
 */
function buildValidadeTestes(config, destino, hoje) {
  const resolved = resolverTestesPorDestino(config, destino);
  return {
    destino: resolved.destino,
    encontrado: resolved.encontrado,
    color_cod: resolved.color_cod || null,
    testes: resolved.testes.map((teste) => ({
      key: validadeTesteCheckKey(teste.nome),
      nome: teste.nome,
      dias: teste.dias,
      data_limite: calcularDataLimiteTestes(teste.dias, hoje),
    })),
  };
}

/** Color Cod da eslinga mudou → a verificação da eslinga precisa ser reconferida. */
function isEslingaColorSnapshotVigente(built, saved) {
  return String(built?.color_cod || '') === String(saved?.color_cod || '');
}

/**
 * Monta a lista de itens de conferência a partir das saídas do slot.
 * @param {Map<string, Array>|Record<string, Array>|null} [checkDefsByCliente]
 *   Definições customizadas por cliente_id ou por `checkDefsNomeKey(nome)`.
 *   Ausência / lista vazia → checks padrão do kind.
 * @returns {Array<object>}
 */
export function buildChecklistItemsFromSaidas({
  bookings = [],
  saidas = [],
  vasilhames = [],
  entradas = [],
  transbordos = [],
  containerDatasById = null,
  checkDefsByCliente = null,
  checkDefsTanqueVazioByCliente = null,
  validadeTestesByCliente = null,
} = {}) {
  const hoje = new Date();
  const saidaById = new Map((saidas || []).map((s) => [String(s.id), s]));
  const vasilhameById = new Map((vasilhames || []).map((v) => [String(v.id), v]));
  const estoqueById = new Map((entradas || []).map((e) => [String(e.id), e]));
  const defsMap =
    checkDefsByCliente instanceof Map
      ? checkDefsByCliente
      : checkDefsByCliente && typeof checkDefsByCliente === 'object'
        ? new Map(Object.entries(checkDefsByCliente))
        : null;
  const defsVazioMap =
    checkDefsTanqueVazioByCliente instanceof Map
      ? checkDefsTanqueVazioByCliente
      : checkDefsTanqueVazioByCliente && typeof checkDefsTanqueVazioByCliente === 'object'
        ? new Map(Object.entries(checkDefsTanqueVazioByCliente))
        : null;
  const items = [];
  let convencionalSeq = 0;
  let tanqueVazioSeq = 0;

  for (const booking of bookings || []) {
    const saida = saidaById.get(String(booking.saida_id));
    if (!saida) continue;
    const linhas = Array.isArray(saida.itens) ? saida.itens : [];
    const clienteId = String(saida.cliente_id || booking.cliente_id || '').trim() || null;
    const customDefsCheio = resolveCustomCheckDefs(
      defsMap,
      clienteId,
      saida.cliente_nome || booking.cliente_nome
    );
    const customDefsVazio = resolveCustomCheckDefs(
      defsVazioMap,
      clienteId,
      saida.cliente_nome || booking.cliente_nome
    );
    const validadeConfig = resolveCustomCheckDefs(
      validadeTestesByCliente,
      clienteId,
      saida.cliente_nome || booking.cliente_nome
    );

    linhas.forEach((linha, idx) => {
      const kind = checklistKindForLinha(linha);
      const isTanqueVazio = kind === CHECKLIST_KIND.TANQUE_VAZIO;
      const vasilhame =
        (linha.vasilhame_id && vasilhameById.get(String(linha.vasilhame_id))) ||
        null;
      const estoque =
        (linha.entrada_id && estoqueById.get(String(linha.entrada_id))) ||
        (linha.stock_id && estoqueById.get(String(linha.stock_id))) ||
        null;
      const container =
        (linha.container_id && containerDatasById?.get?.(String(linha.container_id))) ||
        null;
      // Lacres: vasilhame do Transbordo ou container da Industrialização.
      const lacres = isTanqueVazio
        ? []
        : parseLacresFromEnvase(
            vasilhame?.lacres || container?.lacres || linha.lacres || ''
          );
      const isConv = kind === CHECKLIST_KIND.CONVENCIONAL;
      if (isConv) convencionalSeq += 1;
      if (isTanqueVazio) tanqueVazioSeq += 1;

      const itemKey = isTanqueVazio
        ? `vazio:${saida.id}:${linha.item_uid || idx}`
        : isConv
          ? `conv:${saida.id}:${linha.vasilhame_id || linha.container_id || idx}`
          : `emb:${saida.id}:${linha.entrada_id || linha.stock_id || idx}`;

      const { lote, data_fabricacao, data_validade } = isTanqueVazio
        ? { lote: '—', data_fabricacao: null, data_validade: null }
        : resolveItemLoteDatas({
            linha,
            vasilhame,
            estoque,
            estoqueById,
            transbordos,
            container,
          });

      // Tanque vazio: só o checklist configurado para esse tipo (sem fallback do cheio).
      // Tanque cheio: custom do cliente ou checks padrão do kind.
      let check_defs = null;
      let checklist_config_missing = false;
      if (isTanqueVazio) {
        const useCustomVazio =
          Array.isArray(customDefsVazio) && customDefsVazio.length > 0;
        if (useCustomVazio) {
          check_defs = customDefsVazio;
        } else {
          check_defs = [];
          checklist_config_missing = true;
        }
      } else {
        const useCustom =
          Array.isArray(customDefsCheio) && customDefsCheio.length > 0;
        check_defs = useCustom ? customDefsCheio : null;
      }

      // Validade dos testes: apenas tanques cheios (convencional/vasilhame).
      const validade_testes =
        isConv && validadeConfig?.ativo
          ? buildValidadeTestes(validadeConfig, saida.destino, hoje)
          : null;
      const defs = checkDefsForItem({
        kind,
        check_defs,
        validade_testes,
        tanque_vazio: isTanqueVazio,
      });

      const placa = String(linha.vasilhame_placa || '').trim();
      const barril = String(linha.vasilhame_barril || '').trim();

      items.push({
        item_key: itemKey,
        saida_id: saida.id,
        saida_codigo: saida.codigo || booking.saida_codigo || '—',
        item_index: idx,
        kind,
        tanque_vazio: isTanqueVazio,
        checklist_config_missing,
        tipo: linha.tipo,
        tipo_label: tipoItemLabel(linha),
        label: isTanqueVazio
          ? tanqueLabel(linha, null, tanqueVazioSeq - 1).replace(
              /^Tanque/,
              'Tanque Vazio'
            )
          : isConv
            ? tanqueLabel(linha, vasilhame, convencionalSeq - 1)
            : `${linha.produto_nome || linha.produto || 'Produto'} · ${saida.codigo || ''}`.trim(),
        produto: isTanqueVazio
          ? 'Tanque Vazio'
          : linha.produto_nome || linha.produto || '—',
        produto_codigo: isTanqueVazio ? '' : linha.produto_codigo || '',
        lote: isTanqueVazio ? '—' : lote,
        quantidade: isTanqueVazio ? '—' : formatQtdItem(linha),
        quantidade_embalagens: isTanqueVazio
          ? null
          : linha.quantidade_embalagens ?? null,
        unidade: isTanqueVazio ? '' : linha.unidade || (isConv ? 'L' : 'kg'),
        vasilhame_id: isTanqueVazio ? null : linha.vasilhame_id || null,
        vasilhame_placa: isTanqueVazio
          ? placa
          : linha.vasilhame_placa || vasilhame?.placa || '',
        vasilhame_barril: isTanqueVazio
          ? barril
          : linha.vasilhame_barril || vasilhame?.barril || '',
        peso_liquido: isTanqueVazio
          ? null
          : linha.peso_liquido ?? vasilhame?.peso_liquido ?? null,
        peso_bruto: isTanqueVazio
          ? null
          : linha.peso_bruto ?? vasilhame?.peso_bruto ?? null,
        volume_solicitado: isTanqueVazio ? null : linha.volume_solicitado ?? null,
        tipo_embalagem: isTanqueVazio ? '' : linha.tipo_embalagem || '',
        data_fabricacao: isTanqueVazio ? null : data_fabricacao,
        data_validade: isTanqueVazio ? null : data_validade,
        lacres,
        check_defs,
        validade_testes,
        checks: emptyChecksMapForDefs(defs),
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
 * Lote, fabricação e validade exibidos no checklist.
 * - Vasilhame do Transbordo: valores da tela de Vasilhames (lote do vasilhame e
 *   datas editadas ou herdadas da entrada de origem).
 * - Container da Industrialização: valores da tela de Vasilhames da Industrialização.
 * - Embalado: dados da entrada/estoque.
 */
function resolveItemLoteDatas({
  linha,
  vasilhame,
  estoque,
  estoqueById,
  transbordos,
  container,
}) {
  if (container) {
    const fallback = resolveItemDates({ linha, vasilhame: null, estoque, estoqueById });
    return {
      lote: container.lote || formatSaidaItemLote(linha, { vasilhame }),
      data_fabricacao: container.data_fabricacao || fallback.data_fabricacao,
      data_validade: container.data_validade || fallback.data_validade,
    };
  }

  const fallback = resolveItemDates({ linha, vasilhame, estoque, estoqueById });
  if (!vasilhame) {
    return { lote: formatSaidaItemLote(linha, { vasilhame }), ...fallback };
  }

  // Datas da tela de Vasilhames valem por inteiro (inclusive campo limpo);
  // só sem nenhuma data resolvida recorre ao vínculo antigo com o estoque.
  const datas = resolveVasilhameLoteDatas(vasilhame, estoqueById, { transbordos });
  const temDatas = Boolean(datas.data_fabricacao || datas.data_validade);
  return {
    lote: formatSaidaItemLote(linha, { vasilhame, preferVasilhame: true }),
    data_fabricacao: temDatas ? datas.data_fabricacao || null : fallback.data_fabricacao,
    data_validade: temDatas ? datas.data_validade || null : fallback.data_validade,
  };
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
  return emptyChecksMapForDefs(checksForKind(kind));
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

/**
 * Resumo das verificações de um item.
 * Aceita (item) ou (kind, checks) para compatibilidade com callers legados.
 */
export function computeChecksSummary(kindOrItem, checksMaybe) {
  let defs;
  let checks;
  if (kindOrItem && typeof kindOrItem === 'object' && !Array.isArray(kindOrItem)) {
    defs = checkDefsForItem(kindOrItem);
    checks = kindOrItem.checks;
  } else {
    defs = checksForKind(kindOrItem);
    checks = checksMaybe;
  }
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
    complete: answered === defs.length && defs.length > 0,
  };
}

/**
 * Status do item derivado das respostas:
 * qualquer verificação reprovada → Reprovado;
 * todas respondidas sem reprovação → Aprovado;
 * parcialmente respondido → Em conferência.
 * Aceita (item) ou (kind, checks).
 */
export function computeItemStatus(kindOrItem, checksMaybe) {
  const s = computeChecksSummary(kindOrItem, checksMaybe);
  if (s.reprovados > 0) return CHECKLIST_STATUS.REPROVADO;
  if (s.complete) return CHECKLIST_STATUS.APROVADO;
  if (s.answered > 0) return CHECKLIST_STATUS.EM_CONFERENCIA;
  return CHECKLIST_STATUS.PENDENTE;
}

export function isItemApproved(item) {
  return item?.status === CHECKLIST_STATUS.APROVADO;
}

/** Conferência encerrada pela logística — o PDF do item já pode ser baixado. */
export function isChecklistItemRealizado(item) {
  return (
    item?.status === CHECKLIST_STATUS.APROVADO ||
    item?.status === CHECKLIST_STATUS.REPROVADO
  );
}

export function areAllItemsApproved(items = []) {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.every((it) => isItemApproved(it));
}

/** Item com ao menos uma foto anexada na conferência. */
export function itemHasPhotos(item) {
  return Array.isArray(item?.fotos) && item.fotos.length > 0;
}

/** Tanque vazio: a foto permanece disponível, mas não bloqueia a liberação. */
export function isChecklistTanqueVazio(item) {
  return item?.kind === CHECKLIST_KIND.TANQUE_VAZIO || Boolean(item?.tanque_vazio);
}

/** Foto obrigatória em tanque cheio e embalado. Tanque vazio não exige foto. */
export function itemRequiresPhoto(item) {
  return !isChecklistTanqueVazio(item);
}

/** Itens que ainda não têm a foto exigida para liberar a expedição. */
export function countItemsMissingPhotos(items = []) {
  return (items || []).filter((it) => itemRequiresPhoto(it) && !itemHasPhotos(it)).length;
}

/**
 * Checklist apto para liberar a expedição: todos os itens aprovados e,
 * quando `requirePhotos`, cada item que exige foto com ao menos uma.
 * Tanque vazio libera sem foto. Aceita itens do modal ou do payload persistido.
 */
export function areAllItemsReleasable(items = [], { requirePhotos = true } = {}) {
  if (!areAllItemsApproved(items)) return false;
  return !requirePhotos || countItemsMissingPhotos(items) === 0;
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

  if (isTanqueVazioItem(linha)) {
    const key = `vazio:${saida.id}:${linha?.item_uid || index}`;
    return list.find((it) => it.item_key === key) || null;
  }

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
      tanque_vazio: Boolean(it.tanque_vazio),
      checklist_config_missing: Boolean(it.checklist_config_missing),
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
      // Snapshot das verificações do cliente — preserva histórico se a config mudar.
      check_defs: Array.isArray(it.check_defs) && it.check_defs.length > 0
        ? it.check_defs.map((d) => ({
            key: d.key,
            label: d.label || null,
            labelKey: d.labelKey || null,
            section: d.section || 'verificacoes',
          }))
        : null,
      // Testes, prazos e datas limite vigentes na conferência (histórico auditável).
      validade_testes: it.validade_testes
        ? {
            destino: it.validade_testes.destino || null,
            encontrado: it.validade_testes.encontrado !== false,
            color_cod: it.validade_testes.color_cod || null,
            // Conferências antigas guardam um prazo único, sem a lista de testes.
            dias: it.validade_testes.dias ?? null,
            data_limite: it.validade_testes.data_limite ?? null,
            configurado: Array.isArray(it.validade_testes.testes)
              ? it.validade_testes.testes.length > 0
              : it.validade_testes.configurado !== false,
            testes: Array.isArray(it.validade_testes.testes)
              ? it.validade_testes.testes.map((teste) => ({
                  key: teste.key,
                  nome: teste.nome,
                  dias: teste.dias,
                  data_limite: teste.data_limite,
                }))
              : null,
          }
        : null,
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

    // Preferência: defs reconstruídas da config atual; se o built não trouxe
    // custom e o snapshot salvo existe, mantém o snapshot (inspeção já iniciada).
    const check_defs =
      Array.isArray(built.check_defs) && built.check_defs.length > 0
        ? built.check_defs
        : Array.isArray(saved.check_defs) && saved.check_defs.length > 0
          ? saved.check_defs
          : null;

    // A data limite anda com o dia até o operador responder. Depois disso, fica a data
    // da conferência — desde que o prazo daquele teste não tenha mudado.
    const invalidatedTesteKeys = new Set();
    let validade_testes = built.validade_testes;
    if (validade_testes?.testes?.length) {
      const savedByKey = new Map(
        (saved.validade_testes?.testes || []).map((teste) => [teste.key, teste])
      );
      validade_testes = {
        ...validade_testes,
        testes: validade_testes.testes.map((teste) => {
          const prev = savedByKey.get(teste.key);
          const answered = Boolean(normalizeCheckValue(saved.checks?.[teste.key]));
          if (!answered || !prev?.data_limite) return teste;
          if (Number(prev.dias) !== Number(teste.dias)) {
            invalidatedTesteKeys.add(teste.key);
            return teste;
          }
          return { ...teste, data_limite: prev.data_limite };
        }),
      };
    }
    const validadeInvalidada =
      invalidatedTesteKeys.size > 0 ||
      Boolean(
        validade_testes?.encontrado === false &&
          normalizeCheckValue(saved.checks?.[VALIDADE_TESTES_CHECK_KEY])
      );

    const answeredEslinga = Boolean(normalizeCheckValue(saved.checks?.[ESLINGA_COLOR_CHECK_KEY]));
    const eslingaInvalidada = Boolean(
      answeredEslinga &&
        !isEslingaColorSnapshotVigente(built.validade_testes, saved.validade_testes)
    );

    const mergedBase = { ...built, check_defs, validade_testes };
    const defs = checkDefsForItem(mergedBase);
    const checks = { ...emptyChecksMapForDefs(defs) };
    for (const key of Object.keys(checks)) {
      checks[key] = normalizeCheckValue(saved.checks?.[key]);
    }
    for (const key of invalidatedTesteKeys) checks[key] = '';
    if (validade_testes?.encontrado === false) checks[VALIDADE_TESTES_CHECK_KEY] = '';
    if (eslingaInvalidada) checks[ESLINGA_COLOR_CHECK_KEY] = '';

    const status = computeItemStatus({ ...mergedBase, checks });
    const isFinal = status === CHECKLIST_STATUS.APROVADO || status === CHECKLIST_STATUS.REPROVADO;
    const keepConferencia = (!validadeInvalidada && !eslingaInvalidada) || isFinal;
    return {
      ...mergedBase,
      checks,
      fotos: Array.isArray(saved.fotos) ? [...saved.fotos] : [],
      status,
      conferido_em: keepConferencia ? saved.conferido_em || null : null,
      conferido_por_id: keepConferencia ? saved.conferido_por_id || null : null,
      conferido_por_nome: keepConferencia ? saved.conferido_por_nome || null : null,
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
