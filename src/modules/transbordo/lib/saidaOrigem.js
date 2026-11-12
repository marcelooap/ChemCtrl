/** Origens e tipos de item para solicitações de saída (Painel Comercial). */

import { parseDensidade, roundMass, roundVolume } from "@transbordo/lib/format";
import {
  isDestinoEmbalagemUnitaria,
  getQuantidadeEmbalagensFromVasilhame,
  getVolumePorEmbalagemFromVasilhame,
  buildPlacaEmbalagens,
} from "@transbordo/lib/tiposEmbalagem";
import {
  isUnitPackagingType,
  getContainerPackageQty,
  getUnitPackagingCapacity,
  formatAggregatedContainerLabel,
} from "@industrializacao/lib/packagingTypes";

export const ORIGEM_TRANSBORDO = "transbordo";
export const ORIGEM_INDUSTRIALIZACAO = "industrializacao";

/** Módulo que criou a solicitação de saída (header em `t_saidas.modulo_origem`). */
export const MODULO_SAIDA_CHEMFLOW = "chemflow";
export const MODULO_SAIDA_PAINEL = "painel";
export const MODULO_SAIDA_INDUSTRIALIZACAO = "industrializacao";

export function isSaidaModuloChemflow(saida) {
  return saida?.modulo_origem === MODULO_SAIDA_CHEMFLOW;
}

export function isSaidaModuloPainel(saida) {
  return saida?.modulo_origem === MODULO_SAIDA_PAINEL;
}

/**
 * No Transbordo, só se exclui saída criada no próprio módulo.
 * Origem Painel (`modulo_origem = painel`) não pode ser apagada por esse fluxo.
 */
export function canExcluirSaidaNoTransbordo(saida) {
  return !isSaidaModuloPainel(saida);
}

/** Alias: Painel não pode excluir a saída pelos módulos operacionais. */
export function canExcluirSaidaNoModuloOperacional(saida) {
  return canExcluirSaidaNoTransbordo(saida);
}

export const TIPO_EMBALADO = "embalado";
export const TIPO_CONVENCIONAL = "convencional";
export const TIPO_IND_VASILHAME = "ind_vasilhame";
export const TIPO_IND_RETORNO_MP = "ind_retorno_mp";

export const DESTINO_RETORNO_MP = "Retorno de MP Não Aplicada";

export function normalizeClientName(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(ltda|ltd|me|eireli|sa|s\.a\.|comercio|indústria|industria)\b/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function clientsMatch(a, b) {
  const na = normalizeClientName(a);
  const nb = normalizeClientName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Match parcial (nomes comerciais vs cadastro Ind com razão social)
  return na.includes(nb) || nb.includes(na);
}

/**
 * Mesmo cliente com grafias curtas vs completas (ex.: "vibra" e "VIBRA ENERGIA").
 * Exige fronteira de palavra para não unir "inter" com "intertank".
 */
export function isClienteNomeAlias(a, b) {
  const na = normalizeClientName(a);
  const nb = normalizeClientName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  return longer.startsWith(`${shorter} `);
}

/** Chave de deduplicação da lista de clientes (nome exato, sem diferenciar maiúsculas). */
export function clienteNomeKey(nome) {
  return String(nome || "").trim().toLowerCase();
}

/**
 * Estoque/vasilhame do Transbordo pode estar ligado a um id duplicado do mesmo nome.
 * Aceita o id selecionado ou o mesmo nome.
 */
export function sameClienteRecord(record, clienteId, clienteNome) {
  if (!record) return false;
  const recordId = record.cliente_id ? String(record.cliente_id) : "";
  const selectedId = clienteId ? String(clienteId) : "";
  if (selectedId && recordId && selectedId === recordId) return true;
  const left = clienteNomeKey(record.cliente_nome || record.client);
  const right = clienteNomeKey(clienteNome);
  return Boolean(left && right && left === right);
}

/** Status de pátio igual à tela de Vasilhames da Industrialização. */
export function isContainerNoPatio(container) {
  const status = String(container?.status || "No Pátio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return status === "no patio" || status === "";
}

/**
 * Cliente do vasilhame da Industrialização pertence ao cliente selecionado.
 * Igualdade após normalizar (maiúsculas, acento, LTDA/SA). Também aceita o
 * nome comercial completo dentro da razão social, sem tratar "REP" ou "BRASIL"
 * como o mesmo cliente de "REP BRASIL".
 */
export function containerClientMatches(containerClient, clienteNome) {
  const current = normalizeClientName(containerClient);
  const target = normalizeClientName(clienteNome);
  if (!current || !target) return false;
  if (current === target) return true;

  const shorter = current.length <= target.length ? current : target;
  const longer = current.length <= target.length ? target : current;
  const shorterWords = shorter.split(" ").filter(Boolean);
  if (shorterWords.length < 2) return false;
  const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`).test(longer);
}

/**
 * Vasilhames No Pátio somente do cliente selecionado.
 * Sem cliente, ou sem correspondência de nome, a lista fica vazia.
 */
export function filterContainersIndForSaida(
  containers = [],
  clienteNome = "",
  { usedIds = new Set(), keepId = null } = {}
) {
  const yard = (containers || []).filter((c) => {
    if (!isContainerNoPatio(c)) return false;
    if (usedIds.has(c.id) && c.id !== keepId) return false;
    return true;
  });

  if (!normalizeClientName(clienteNome)) return [];

  const list = yard.filter((c) => containerClientMatches(c.client, clienteNome));

  return [...list].sort((a, b) => {
    const typeCmp = String(a.type || "").localeCompare(String(b.type || ""), "pt-BR");
    if (typeCmp !== 0) return typeCmp;
    const clientCmp = String(a.client || "").localeCompare(String(b.client || ""), "pt-BR");
    if (clientCmp !== 0) return clientCmp;
    return String(a.container_number || "").localeCompare(
      String(b.container_number || ""),
      "pt-BR"
    );
  });
}

export function resolveItemOrigem(item) {
  if (item?.origem === ORIGEM_INDUSTRIALIZACAO || item?.origem === ORIGEM_TRANSBORDO) {
    return item.origem;
  }
  if (item?.tipo === TIPO_IND_VASILHAME || item?.tipo === TIPO_IND_RETORNO_MP) {
    return ORIGEM_INDUSTRIALIZACAO;
  }
  return ORIGEM_TRANSBORDO;
}

export function isIndustrializacaoItem(item) {
  return resolveItemOrigem(item) === ORIGEM_INDUSTRIALIZACAO;
}

export function isTransbordoItem(item) {
  return resolveItemOrigem(item) === ORIGEM_TRANSBORDO;
}

/** Saída com pelo menos um item da Industrialização. */
export function saidaHasIndustrializacaoItems(saida) {
  return (saida?.itens || []).some(isIndustrializacaoItem);
}

/** Saída com pelo menos um item do Transbordo. */
export function saidaHasTransbordoItems(saida) {
  return (saida?.itens || []).some(isTransbordoItem);
}

/**
 * Listagem operacional do Transbordo.
 * Solicitação do Painel só com produtos da Industrialização não entra aqui.
 * Rascunho criado no ChemFlow, ainda sem produto, continua visível.
 */
export function saidaVisivelNoTransbordo(saida) {
  const itens = (saida?.itens || []).filter((item) => !isItemSaidaVazio(item));
  if (itens.some(isTransbordoItem)) return true;
  if (itens.some(isIndustrializacaoItem)) return false;
  return (
    !isSaidaModuloPainel(saida) &&
    saida?.modulo_origem !== MODULO_SAIDA_INDUSTRIALIZACAO
  );
}

export function getValidacaoModulo(saida, modulo) {
  const raw = saida?.validacao_modulos;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entry = raw[modulo];
  if (!entry || typeof entry !== "object") return null;
  return entry;
}

/** Módulos que de fato têm itens nesta saída. */
export function getModulosRelevantesSaida(saida) {
  const mods = [];
  if (saidaHasTransbordoItems(saida)) mods.push(ORIGEM_TRANSBORDO);
  if (saidaHasIndustrializacaoItems(saida)) mods.push(ORIGEM_INDUSTRIALIZACAO);
  return mods;
}

/**
 * Validação do módulo (Painel misto) ou status global legado.
 * `enviado_ao_fiscal` só vale como fallback quando o módulo ainda
 * não gravou `validacao_modulos`.
 */
export function isSaidaValidadaNoModulo(saida, modulo) {
  const entry = getValidacaoModulo(saida, modulo);
  if (entry && typeof entry.validado === "boolean") {
    return Boolean(entry.validado);
  }
  return Boolean(saida?.enviado_ao_fiscal || saida?.status === "enviado_fiscal");
}

/** Item de carregamento de tanque vazio (sem produto). */
export function isTanqueVazioItem(item) {
  return Boolean(item?.tanque_vazio);
}

/** Saída só com contentores/tanques vazios (sem produto). */
export function isSaidaCargaVazia(saida) {
  const itens = saida?.itens || [];
  if (itens.length === 0) return false;
  return itens.every(isTanqueVazioItem);
}

/** Gera uid estável para chave de edição/checklist (tanque vazio sem cadastro). */
export function newSaidaItemUid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `uid:${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Identidade estável do item (tanque, lote, retorno ou tanque vazio).
 * Item vazio não tem chave.
 */
export function saidaItemChave(item) {
  if (!item || isItemSaidaVazio(item)) return "";
  if (isTanqueVazioItem(item)) {
    const uid = String(item.item_uid || "").trim();
    return uid ? `vazio:${uid}` : "";
  }
  if (
    (item.tipo === TIPO_CONVENCIONAL || item.tipo === "convencional") &&
    item.vasilhame_id
  ) {
    return `conv:${item.vasilhame_id}`;
  }
  if (item.tipo === TIPO_IND_VASILHAME && item.container_id) {
    return `ind:${item.container_id}`;
  }
  if (
    (item.tipo === TIPO_EMBALADO || item.tipo === "embalado") &&
    item.entrada_id
  ) {
    return `emb:${item.entrada_id}`;
  }
  if (item.tipo === TIPO_IND_RETORNO_MP && (item.movement_id || item.stock_id)) {
    return `mp:${item.movement_id || item.stock_id}`;
  }
  return "";
}

/**
 * O estoque deste item já foi baixado (status atual).
 * `validado: false` é pendente (novo item ou desvalidado).
 * Sem a flag, vale a validação do módulo (saídas antigas).
 */
export function itemFoiBaixado(item, saida) {
  if (!item || isItemSaidaVazio(item)) return false;
  if (item.validado === false) return false;
  if (item.validado === true) return true;
  if (!saida) return false;
  return isSaidaValidadaNoModulo(saida, resolveItemOrigem(item));
}

/**
 * Histórico de validação do item — independente do status atual.
 * `validado_historico: true` permanece após desvalidação.
 * Legado: item atualmente baixado (ou herdando validação do módulo) conta
 * como histórico até a próxima gravação gravar a flag explícita.
 */
export function itemTemHistoricoValidacao(item, saida) {
  if (!item || isItemSaidaVazio(item)) return false;
  if (item.validado_historico === true) return true;
  // Status atual validado implica que já passou por validação.
  if (item.validado === true) return true;
  // Pendente explícito sem marcador de histórico: nunca validado
  // (ou desvalidado antes desta flag existir).
  if (item.validado === false) return false;
  if (!saida) return false;
  return isSaidaValidadaNoModulo(saida, resolveItemOrigem(item));
}

/** Check verde na visualização: já passou por validação (histórico). */
export function isItemValidadoParaExibicao(item, saida) {
  return itemTemHistoricoValidacao(item, saida);
}

/**
 * Aplica status atual de validação preservando/marcando o histórico.
 * Desvalidar nunca apaga `validado_historico`.
 */
export function applyItemValidacaoFlags(item, checked, { hadBaixa = false } = {}) {
  const next = { ...item, validado: Boolean(checked) };
  if (
    checked ||
    hadBaixa ||
    item?.validado_historico === true ||
    item?.validado === true
  ) {
    next.validado_historico = true;
  }
  return next;
}

/** Há tanque/produto deste módulo incluído depois da validação. */
export function saidaTemItemPendenteNoModulo(saida, modulo) {
  return (saida?.itens || []).some(
    (item) =>
      !isItemSaidaVazio(item) &&
      resolveItemOrigem(item) === modulo &&
      item.validado === false
  );
}

export function allModulosRelevantesValidados(saida, validacaoOverride = null) {
  const mods = getModulosRelevantesSaida(saida);
  if (mods.length === 0) {
    return Boolean(saida?.enviado_ao_fiscal || saida?.status === "enviado_fiscal");
  }
  const merged = {
    ...(saida?.validacao_modulos && typeof saida.validacao_modulos === "object"
      ? saida.validacao_modulos
      : {}),
    ...(validacaoOverride || {}),
  };
  return mods.every((m) => Boolean(merged[m]?.validado));
}

export function emptySaidaItem(origem = ORIGEM_TRANSBORDO) {
  const base = {
    origem,
    tipo: origem === ORIGEM_INDUSTRIALIZACAO ? TIPO_IND_VASILHAME : TIPO_EMBALADO,
    item_uid: newSaidaItemUid(),
    tanque_vazio: false,
    produto_id: "",
    produto_nome: "",
    produto_codigo: "",
    quantidade_solicitada: 0,
    peso_liquido_embalagem: 0,
    quantidade_embalagens: 0,
    lote: "",
    estoque_atual: 0,
    estoque_final: 0,
    entrada_id: "",
    vasilhame_id: "",
    vasilhame_placa: "",
    vasilhame_barril: "",
    volume_disponivel: 0,
    volume_solicitado: 0,
    saldo_final: 0,
    peso_liquido: 0,
    peso_bruto: 0,
    // Industrialização
    container_id: "",
    container_type: "",
    stock_id: "",
    movement_id: "",
    unidade: "kg",
    reserva_id: "",
    sem_reserva: false,
    reserva_solicitante: "",
    reserva_chave: "",
    quantidade_carregada: null,
    reserva_abatida: false,
    quantidade_abatida: null,
    abatimento_origem: "",
  };
  return base;
}

/**
 * Linha de produto sem nenhuma seleção/quantidade (placeholder do formulário).
 * Permite reservar o horário da saída antes de o cliente informar os tanques.
 * Tanque vazio (toggle ligado) conta como item preenchido mesmo sem produto.
 */
export function isItemSaidaVazio(item) {
  if (!item) return true;
  if (isTanqueVazioItem(item)) return false;
  const semSelecao = [
    item.entrada_id,
    item.produto_id,
    item.produto_nome,
    item.vasilhame_id,
    item.container_id,
    item.stock_id,
    item.movement_id,
  ].every((v) => !v);
  const semQuantidade =
    !Number(item.quantidade_solicitada) && !Number(item.volume_solicitado);
  return semSelecao && semQuantidade;
}

/** Placa ou barril informados no item de tanque vazio. */
export function tanqueVazioTemIdentificacao(item) {
  const placa = String(item?.vasilhame_placa || "").trim();
  const barril = String(item?.vasilhame_barril || "").trim();
  return Boolean(placa || barril);
}

function isSaidaItemTanque(item) {
  const tipo = String(item?.tipo || "");
  return (
    tipo === TIPO_CONVENCIONAL ||
    tipo === TIPO_IND_VASILHAME ||
    tipo === "Vasilhame"
  );
}

function findVasilhameForSaidaItem(item, vasilhames = []) {
  if (!item || !Array.isArray(vasilhames) || vasilhames.length === 0) return null;
  if (item.vasilhame_id) {
    const byId = vasilhames.find(
      (v) => String(v?.id || "") === String(item.vasilhame_id)
    );
    if (byId) return byId;
  }
  const placa = String(item.vasilhame_placa || "")
    .trim()
    .toUpperCase();
  if (!placa) return null;
  const patio = vasilhames.find(
    (v) =>
      String(v?.placa || "")
        .trim()
        .toUpperCase() === placa &&
      (v.status || "No Pátio") === "No Pátio" &&
      !v.data_saida
  );
  if (patio) return patio;
  return (
    vasilhames.find(
      (v) =>
        String(v?.placa || "")
          .trim()
          .toUpperCase() === placa
    ) || null
  );
}

function densFromSameProduct(item, transbordos = []) {
  const produtoId = String(item?.produto_id || "").trim();
  const produtoNome = String(item?.produto_nome || "")
    .trim()
    .toUpperCase();
  if (!produtoId && !produtoNome) return 0;

  for (const t of transbordos || []) {
    if (produtoId && String(t?.produto_id || "") === produtoId) {
      const dens = parseDensidade(t?.densidade);
      if (dens > 0) return dens;
    }
  }
  if (!produtoNome) return 0;
  for (const t of transbordos || []) {
    if (
      String(t?.produto_nome || "")
        .trim()
        .toUpperCase() === produtoNome
    ) {
      const dens = parseDensidade(t?.densidade);
      if (dens > 0) return dens;
    }
  }
  return 0;
}

function densFromRelatedTransbordos(vasilhame, item, transbordos = []) {
  if (!Array.isArray(transbordos) || transbordos.length === 0) return 0;

  const codigos = new Set(
    [
      vasilhame?.numero_op,
      ...((vasilhame?.composicao || []).map((c) => c?.transbordo_codigo) || []),
    ]
      .map((c) => String(c || "").trim().toUpperCase())
      .filter(Boolean)
  );
  const placa = String(vasilhame?.placa || item?.vasilhame_placa || "")
    .trim()
    .toUpperCase();

  for (const t of transbordos) {
    const codigo = String(t?.codigo_transbordo || "")
      .trim()
      .toUpperCase();
    if (codigos.size > 0 && codigo && codigos.has(codigo)) {
      const dens = parseDensidade(t?.densidade);
      if (dens > 0) return dens;
    }
  }

  if (placa) {
    for (const t of transbordos) {
      for (const d of t?.destinos || []) {
        const destPlaca = String(d?.placa || d?.tanka_codigo || "")
          .trim()
          .toUpperCase();
        if (destPlaca !== placa) continue;
        const densDest =
          parseDensidade(t?.densidade) ||
          (Number(d?.peso_liquido) > 0 && Number(d?.volume_total || d?.volume) > 0
            ? Number(d.peso_liquido) / Number(d.volume_total || d.volume)
            : 0);
        if (densDest > 0) return densDest;
      }
    }
  }

  return densFromSameProduct(item, transbordos);
}

/**
 * Massa (kg) de um item para o total da saída.
 * Prefere peso_liquido (tanques); cai em quantidade_solicitada (embalado/MP).
 * Para tanque com volume e massa zerada (OP sem dens), deriva kg via densidade
 * do vasilhame/OP relacionado ou do mesmo produto.
 */
export function saidaItemQuantidadeKg(item, ctx = {}) {
  if (!item || isTanqueVazioItem(item) || isItemSaidaVazio(item)) return 0;
  const direct =
    Number(item.peso_liquido) || Number(item.quantidade_solicitada) || 0;
  if (direct > 0) return direct;

  if (!isSaidaItemTanque(item)) return 0;
  const vol = roundVolume(item.volume_solicitado || 0);
  if (!(vol > 0)) return 0;

  const vasilhames = ctx.vasilhames || [];
  const transbordos = ctx.transbordos || [];
  const vasilhame = findVasilhameForSaidaItem(item, vasilhames);

  let dens =
    parseDensidade(item?.densidade) ||
    parseDensidade(vasilhame?.densidade) ||
    densFromRelatedTransbordos(vasilhame, item, transbordos);

  if (dens > 0) return roundMass(vol * dens);

  const tankVol = roundVolume(vasilhame?.volume || 0);
  const tankKg = Number(vasilhame?.peso_liquido) || 0;
  if (tankVol > 0 && tankKg > 0) {
    return roundMass((tankKg * vol) / tankVol);
  }

  const fromCompKg = (vasilhame?.composicao || []).reduce(
    (sum, c) => sum + (Number(c?.quantidade_kg) || 0),
    0
  );
  if (fromCompKg > 0) {
    const fromCompL = (vasilhame?.composicao || []).reduce(
      (sum, c) => sum + (Number(c?.quantidade_l) || 0),
      0
    );
    if (fromCompL > 0) return roundMass((fromCompKg * vol) / fromCompL);
    return roundMass(fromCompKg);
  }

  return 0;
}

/** Quantidade total (kg) atual da saída, recalculada a partir dos itens. */
export function calcSaidaQuantidadeTotal(itens = [], ctx = {}) {
  return roundMass(
    (itens || []).reduce(
      (sum, item) => sum + saidaItemQuantidadeKg(item, ctx),
      0
    )
  );
}

export function origemLabel(origem) {
  if (origem === ORIGEM_INDUSTRIALIZACAO) return "Industrialização";
  return "Transbordo";
}

/** Lote vazio ou marcador "Não informado" (sem lote real). */
export function isLoteNaoInformado(lote) {
  const text = String(lote ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  return text === "" || text === "-" || /^NAO INFORMAD[OA]$/.test(text);
}

/**
 * Resolve o lote do item (direto, vasilhame ou composição).
 * Lote gravado como "Não informado" não bloqueia o lote atual do vasilhame.
 */
export function resolveSaidaItemLote(item, { vasilhame, preferVasilhame = false } = {}) {
  const loteFromComp = () => {
    const comp = Array.isArray(vasilhame?.composicao) ? vasilhame.composicao : [];
    let best = "";
    let bestVol = -1;
    for (const c of comp) {
      const vol = Number(c?.quantidade_l) || 0;
      const lote = String(c?.lote || "").trim();
      if (lote && vol >= bestVol) {
        bestVol = vol;
        best = lote;
      }
    }
    return best;
  };

  const itemLote = String(item?.lote ?? "").trim();
  const doVasilhame = () =>
    [vasilhame?.lote, loteFromComp()]
      .map((lote) => String(lote ?? "").trim())
      .find((lote) => !isLoteNaoInformado(lote));

  // Vasilhame é a fonte do lote (tela de Vasilhames); a saída guarda só uma cópia.
  if (preferVasilhame) {
    const atual = doVasilhame();
    if (atual) return atual;
  }
  if (itemLote && !isLoteNaoInformado(itemLote)) return itemLote;

  return doVasilhame() || itemLote || String(vasilhame?.lote ?? "").trim();
}

/**
 * Coluna Lote na visualização de saída.
 */
export function formatSaidaItemLote(item, { vasilhame, preferVasilhame = false } = {}) {
  if (isTanqueVazioItem(item)) return "—";
  return resolveSaidaItemLote(item, { vasilhame, preferVasilhame }) || "—";
}

const EMBALAGEM_VAZIA = new Set(["", "-", "—", "–", "−"]);

/** Primeiro código útil entre cadastro e cópia gravada na saída. */
function codigoEmbalagem(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!EMBALAGEM_VAZIA.has(text)) return text;
  }
  return "";
}

/**
 * Coluna Embalagem.
 * - Embalado / retorno de MP: "-"
 * - Placa e barril: "nº placa (nº barril)"
 * - Só um dos dois: o que estiver registrado
 */
export function formatSaidaItemEmbalagem(item, { vasilhame } = {}) {
  if (item?.tipo === TIPO_EMBALADO || item?.tipo === TIPO_IND_RETORNO_MP) {
    return "-";
  }

  // Tanque vazio: só o texto digitado na solicitação (sem cadastro).
  if (isTanqueVazioItem(item)) {
    const placa = codigoEmbalagem(item?.vasilhame_placa);
    const barril = codigoEmbalagem(item?.vasilhame_barril);
    if (placa && barril) return `${placa} (${barril})`;
    return placa || barril || "—";
  }

  // Cadastro do vasilhame (Transbordo: placa/barril; Industrialização:
  // container_number/barril_number) prevalece sobre a cópia da saída.
  const placa = codigoEmbalagem(
    vasilhame?.placa,
    vasilhame?.container_number,
    item?.vasilhame_placa
  );
  const barril = codigoEmbalagem(
    vasilhame?.barril,
    vasilhame?.barril_number,
    item?.vasilhame_barril
  );

  if (placa && barril) return `${placa} (${barril})`;
  return placa || barril || "—";
}

/**
 * Texto da coluna "Informações" (legado — PDF/relatórios).
 * - Embalado / retorno MP: lote (e embalagem no modo agendamento)
 * - Convencional / vasilhame: placa (barril) [- lote]
 *
 * @param {{ includeLote?: boolean, context?: 'default' | 'agendamento' | 'fiscal' }} [options]
 */
export function formatSaidaItemInformacoes(
  item,
  { vasilhame, includeLote = true, context = "default" } = {}
) {
  if (isTanqueVazioItem(item)) {
    return formatSaidaItemEmbalagem(item);
  }

  const lote = resolveSaidaItemLote(item, { vasilhame });
  const withLote = includeLote && context !== "fiscal";

  if (item?.tipo === TIPO_EMBALADO || item?.tipo === TIPO_IND_RETORNO_MP) {
    return lote ? `Lote: ${lote}` : "—";
  }

  const base = formatSaidaItemEmbalagem(item, { vasilhame });
  const embalagem = base === "—" || base === "-" ? "" : base;

  if (withLote && lote) {
    return embalagem ? `${embalagem} - ${lote}` : lote;
  }
  return embalagem || "—";
}

export function tipoItemLabel(item) {
  if (isTanqueVazioItem(item)) return "Tanque Vazio";
  const tipo = item?.tipo;
  if (tipo === TIPO_EMBALADO) return "Embalado";
  if (tipo === TIPO_CONVENCIONAL) return "Vasilhame";
  if (tipo === TIPO_IND_VASILHAME) return "Vasilhame";
  if (tipo === TIPO_IND_RETORNO_MP) return DESTINO_RETORNO_MP;
  return tipo || "—";
}

export function containerLabel(c) {
  if (!c) return "—";
  const placa = c.container_number || c.placa || "—";
  const barril = c.barril_number || c.barril || "";
  const type = c.type || c.container_type || "";
  const product = c.product || "";
  const client = c.client || "";
  const vol = Number(c.volume);
  const parts = [];
  if (type) parts.push(type);
  parts.push(barril ? `${placa} / ${barril}` : placa);
  if (product) parts.push(product);
  if (client) parts.push(client);
  if (Number.isFinite(vol) && vol > 0) parts.push(`${vol} L`);
  return parts.join(" · ");
}

export function retornoMpLabel(row) {
  if (!row) return "—";
  const reg = row.entry_id || "—";
  const code = row.mp_code || row.produto_codigo || "—";
  const name = row.mp_name || row.produto_nome || "—";
  const lot = row.lot || row.lote || "—";
  const qty = Number(row.quantity ?? row.quantidade_solicitada ?? 0);
  const qtd = Number.isFinite(qty)
    ? qty.toLocaleString("pt-BR", { maximumFractionDigits: 3 })
    : "0";
  const unit = row.unit || row.unidade || "kg";
  return `${reg} - ${code} - ${name} - ${lot} - ${qtd} ${unit}`;
}

function isItemEmbalagemUnitaria(item, vasilhame = null) {
  if (isTanqueVazioItem(item)) return false;
  if (item?.tipo === TIPO_CONVENCIONAL) {
    if (isDestinoEmbalagemUnitaria(item.tipo_embalagem)) return true;
    if (isDestinoEmbalagemUnitaria(vasilhame?.tipo)) return true;
    return /^\d+\s*x\s+/i.test(String(item.vasilhame_placa || vasilhame?.placa || ""));
  }
  if (item?.tipo === TIPO_IND_VASILHAME) {
    return (
      isUnitPackagingType(item.container_type) ||
      isUnitPackagingType(vasilhame?.type) ||
      /^\d+\s*x\s+/i.test(
        String(item.vasilhame_placa || vasilhame?.container_number || "")
      )
    );
  }
  return false;
}

function qtdEmbalagensDoItemSaida(item, vasilhame = null) {
  const explicit = Math.round(Number(item?.quantidade_embalagens) || 0);
  if (explicit > 0) return explicit;

  const volPor =
    Number(item?.volume_por_embalagem) ||
    (item?.tipo === TIPO_IND_VASILHAME
      ? getUnitPackagingCapacity(item.container_type || vasilhame?.type) ||
        0
      : getVolumePorEmbalagemFromVasilhame(vasilhame)) ||
    0;
  const vol = Number(item?.volume_solicitado) || 0;
  if (volPor > 0 && vol > 0) return Math.max(1, Math.round(vol / volPor));

  if (item?.tipo === TIPO_IND_VASILHAME && vasilhame) {
    const fromC = getContainerPackageQty(vasilhame);
    if (fromC > 0) return fromC;
  }
  if (vasilhame && isDestinoEmbalagemUnitaria(vasilhame.tipo)) {
    const fromV = getQuantidadeEmbalagensFromVasilhame(vasilhame);
    // Só usa o total do cadastro quando a linha pede o volume inteiro do tanque.
    const volCadastro = Number(vasilhame.volume) || 0;
    if (fromV > 0 && volCadastro > 0 && Math.abs(volCadastro - vol) < 0.5) {
      return fromV;
    }
  }
  return 1;
}

function unitarioSaidaGroupKey(item, vasilhame = null) {
  if (!isItemEmbalagemUnitaria(item, vasilhame)) return null;
  const produto = String(item.produto_nome || item.produto_id || "")
    .trim()
    .toLowerCase();
  const lote = String(item.lote || "").trim().toLowerCase();
  if (item.tipo === TIPO_CONVENCIONAL) {
    const id = String(item.vasilhame_id || "").trim();
    const placa = String(
      vasilhame?.placa || item.vasilhame_placa || item.tipo_embalagem || ""
    )
      .trim()
      .toLowerCase()
      .replace(/^\d+\s*x\s+/i, "");
    return `tb:${id || placa}|${produto}|${lote}`;
  }
  const id = String(item.container_id || "").trim();
  const placa = String(
    vasilhame?.container_number || item.vasilhame_placa || item.container_type || ""
  )
    .trim()
    .toLowerCase()
    .replace(/^\d+\s*x\s+/i, "");
  return `ind:${id || placa}|${produto}|${lote}`;
}

/**
 * Unifica linhas de bombona/IBC/tambor do mesmo envase na visualização
 * de agendamento (N× "01" → 1 linha com quantidade total).
 */
export function aggregateUnitarioSaidaItens(
  itens = [],
  { vasilhames = [], containersById = null } = {}
) {
  const list = Array.isArray(itens) ? itens : [];
  if (list.length <= 1) return list;

  const vasilhameById = new Map(
    (vasilhames || []).map((v) => [String(v.id), v])
  );
  const resolveSource = (item) => {
    if (item?.tipo === TIPO_IND_VASILHAME && item.container_id) {
      if (containersById instanceof Map) {
        return containersById.get(String(item.container_id)) || null;
      }
      return null;
    }
    if (item?.vasilhame_id) {
      return vasilhameById.get(String(item.vasilhame_id)) || null;
    }
    return null;
  };

  const out = [];
  const groupIndex = new Map();

  list.forEach((item, index) => {
    const source = resolveSource(item);
    const key = unitarioSaidaGroupKey(item, source);
    if (!key) {
      out.push({ ...item, _sourceIndexes: [index] });
      return;
    }

    const qtdEmb = qtdEmbalagensDoItemSaida(item, source);
    const existingIdx = groupIndex.get(key);
    if (existingIdx == null) {
      groupIndex.set(key, out.length);
      const tipoEmb =
        item.tipo_embalagem ||
        item.container_type ||
        source?.tipo ||
        source?.type ||
        "";
      const volPor =
        Number(item.volume_por_embalagem) ||
        getVolumePorEmbalagemFromVasilhame(source) ||
        getUnitPackagingCapacity(tipoEmb) ||
        0;
      const placa =
        source?.placa ||
        source?.container_number ||
        (qtdEmb > 0 && tipoEmb
          ? item.tipo === TIPO_IND_VASILHAME
            ? formatAggregatedContainerLabel(qtdEmb, tipoEmb)
            : buildPlacaEmbalagens(qtdEmb, tipoEmb)
          : item.vasilhame_placa) ||
        item.vasilhame_placa ||
        "";
      out.push({
        ...item,
        quantidade_embalagens: qtdEmb,
        volume_por_embalagem: volPor || item.volume_por_embalagem || 0,
        vasilhame_placa: placa,
        _sourceIndexes: [index],
        _aggregateKey: key,
      });
      return;
    }

    const acc = out[existingIdx];
    const vol = roundVolume(
      (Number(acc.volume_solicitado) || 0) + (Number(item.volume_solicitado) || 0)
    );
    const peso = roundMass(
      (Number(acc.peso_liquido) || 0) + (Number(item.peso_liquido) || 0)
    );
    const qtdTotal = (Number(acc.quantidade_embalagens) || 0) + qtdEmb;
    const tipoEmb =
      acc.tipo_embalagem ||
      acc.container_type ||
      source?.tipo ||
      source?.type ||
      "";
    const placa =
      source?.placa ||
      source?.container_number ||
      (qtdTotal > 0 && tipoEmb
        ? item.tipo === TIPO_IND_VASILHAME
          ? formatAggregatedContainerLabel(qtdTotal, tipoEmb)
          : buildPlacaEmbalagens(qtdTotal, tipoEmb)
        : acc.vasilhame_placa);

    out[existingIdx] = {
      ...acc,
      volume_solicitado: vol,
      peso_liquido: peso,
      peso_bruto: roundMass((Number(acc.tara) || 0) + peso),
      quantidade_solicitada: roundMass(
        (Number(acc.quantidade_solicitada) || 0) +
          (Number(item.quantidade_solicitada) || 0)
      ),
      quantidade_embalagens: qtdTotal,
      vasilhame_placa: placa || acc.vasilhame_placa,
      _sourceIndexes: [...(acc._sourceIndexes || []), index],
    };
  });

  return out;
}
