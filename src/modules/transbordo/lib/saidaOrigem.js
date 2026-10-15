/** Origens e tipos de item para solicitações de saída (Painel Comercial). */

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

/**
 * Identidade estável do item (tanque, lote ou retorno).
 * Item vazio não tem chave.
 */
export function saidaItemChave(item) {
  if (!item || isItemSaidaVazio(item)) return "";
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
 * O estoque deste item já foi baixado.
 * `validado: false` é um item incluído depois e ainda pendente.
 * Sem a flag, vale a validação do módulo (saídas antigas).
 */
export function itemFoiBaixado(item, saida) {
  if (!item || isItemSaidaVazio(item)) return false;
  if (item.validado === false) return false;
  if (item.validado === true) return true;
  if (!saida) return false;
  return isSaidaValidadaNoModulo(saida, resolveItemOrigem(item));
}

/** Check verde na visualização: item já validado. */
export function isItemValidadoParaExibicao(item, saida) {
  return itemFoiBaixado(item, saida);
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
 */
export function isItemSaidaVazio(item) {
  if (!item) return true;
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
