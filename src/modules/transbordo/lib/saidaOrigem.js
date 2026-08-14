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
 * Lista vasilhames disponíveis (No Pátio), preferindo o cliente selecionado.
 * Se nenhum bater o nome, retorna todos do pátio (como a tela de Vasilhames).
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

  const matched = clienteNome
    ? yard.filter((c) => clientsMatch(c.client, clienteNome))
    : yard;

  const list = matched.length > 0 ? matched : yard;

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
  };
  return base;
}

export function origemLabel(origem) {
  if (origem === ORIGEM_INDUSTRIALIZACAO) return "Industrialização";
  return "Transbordo";
}

/**
 * Texto da coluna "Informações" na visualização/relatório de saída.
 * - Embalado / retorno MP: lote (e embalagem no modo agendamento)
 * - Convencional / vasilhame: placa (barril) [- lote]
 *
 * @param {{ includeLote?: boolean, context?: 'default' | 'agendamento' | 'fiscal' }} [options]
 */
export function formatSaidaItemInformacoes(
  item,
  { vasilhame, includeLote = true, context = "default" } = {}
) {
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

  const lote = String(
    item?.lote || vasilhame?.lote || loteFromComp() || ""
  ).trim();

  const withLote = includeLote && context !== "fiscal";

  if (item?.tipo === TIPO_EMBALADO || item?.tipo === TIPO_IND_RETORNO_MP) {
    return lote ? `Lote: ${lote}` : "—";
  }

  const placa = String(
    item?.vasilhame_placa || vasilhame?.placa || ""
  ).trim();
  const barril = String(
    item?.vasilhame_barril || vasilhame?.barril || ""
  ).trim();
  const hasBarril = Boolean(barril) && barril !== "—" && barril !== "-";

  let base = "";
  if (!placa) {
    base = "";
  } else if (hasBarril) {
    base = `${placa} (${barril})`;
  } else {
    base = placa;
  }

  if (withLote && lote) {
    return base ? `${base} - ${lote}` : lote;
  }
  return base || "—";
}

export function tipoItemLabel(item) {
  const tipo = item?.tipo;
  if (tipo === TIPO_EMBALADO) return "Embalado";
  if (tipo === TIPO_CONVENCIONAL) return "Convencional";
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
  const code = row.mp_code || row.produto_codigo || "";
  const name = row.mp_name || row.produto_nome || "—";
  const lot = row.lot || row.lote || "—";
  const qty = row.quantity ?? row.current_stock ?? row.quantidade_solicitada ?? 0;
  const unit = row.unit || row.unidade || "kg";
  const codePart = code ? `${code} — ` : "";
  return `${codePart}${name} | Lote ${lot} | ${qty} ${unit}`;
}
