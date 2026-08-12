import { roundMass, parseDensidade, roundVolume } from "@transbordo/lib/format";
import {
  loteToKg,
  loteUnidadeEstoque,
  saldoKgToLitros,
} from "@transbordo/lib/conversao";
import {
  calculateFIFOAllocation,
  expandOrigensForFifo,
} from "@transbordo/lib/fifo";
import { entities } from "@transbordo/services/entities";

/**
 * Quantidade original do registro de estoque.
 * Fallback para o lote embutido quando `quantidade` veio zerada
 * (ex.: embalado em L sem densidade, que antes zerava na conversão).
 */
export function getEstoqueQuantidade(estoqueItem) {
  const qtd = Number(estoqueItem?.quantidade) || 0;
  if (qtd > 0) return qtd;

  const lote = estoqueItem?.lotes?.[0];
  if (lote) {
    const fromLote = loteToKg({
      ...lote,
      embalado: lote.embalado ?? estoqueItem.embalado,
    });
    if (fromLote > 0) return fromLote;
  }
  return 0;
}

/** NF original — coluna ou lote embutido. */
export function getEstoqueNotaFiscal(estoqueItem) {
  const fromCol = estoqueItem?.nota_fiscal;
  if (fromCol != null && String(fromCol).trim() !== "") return String(fromCol);
  const fromLote = estoqueItem?.lotes?.[0]?.nota_fiscal;
  if (fromLote != null && String(fromLote).trim() !== "") return String(fromLote);
  return "";
}

/** Troca fiscal — coluna ou lote embutido (JSONB). */
export function getEstoqueNotaFiscalTroca(estoqueItem) {
  const fromCol = estoqueItem?.nota_fiscal_troca;
  if (fromCol != null && String(fromCol).trim() !== "") return String(fromCol);
  const fromLote = estoqueItem?.lotes?.[0]?.nota_fiscal_troca;
  if (fromLote != null && String(fromLote).trim() !== "") return String(fromLote);
  return "";
}

/** Hidrata campos fiscais a partir do lote quando a coluna vier vazia. */
export function hydrateEstoqueFiscal(estoqueItem) {
  if (!estoqueItem) return estoqueItem;
  return {
    ...estoqueItem,
    nota_fiscal: getEstoqueNotaFiscal(estoqueItem) || estoqueItem.nota_fiscal || null,
    nota_fiscal_troca:
      getEstoqueNotaFiscalTroca(estoqueItem) || estoqueItem.nota_fiscal_troca || null,
  };
}

/** Unidade a exibir/persistir, com correção para lotes embalados. */
export function getEstoqueUnidade(estoqueItem) {
  const lote = estoqueItem?.lotes?.[0];
  if (estoqueItem?.embalado || lote?.embalado) {
    return loteUnidadeEstoque({
      ...lote,
      embalado: true,
      unidade_medida: lote?.unidade_medida || estoqueItem?.unidade_medida,
    });
  }
  return estoqueItem?.unidade_medida || "kg";
}

/**
 * Unidade de medida informada na entrada do produto (lote).
 * Diferente da unidade operacional do saldo (geralmente kg no convencional).
 */
export function getEstoqueUnidadeEntrada(estoqueItem) {
  const fromLote = estoqueItem?.lotes?.[0]?.unidade_medida;
  if (fromLote != null && String(fromLote).trim() !== "") {
    return String(fromLote).trim();
  }
  return estoqueItem?.unidade_medida || "kg";
}

/**
 * Saldo atual convertido para a unidade de medida da entrada.
 * O saldo persistido permanece operacional (kg no convencional);
 * esta função é só para exibição na listagem.
 */
export function getEstoqueSaldoEntrada(estoqueItem) {
  const saldo = Number(estoqueItem?.saldo_atual) || 0;
  if (saldo <= 0) return 0;

  // Embalado: quantidade/saldo já estão na unidade lançada na entrada
  if (estoqueItem?.embalado || estoqueItem?.lotes?.[0]?.embalado) {
    return Math.round(saldo);
  }

  const um = getEstoqueUnidadeEntrada(estoqueItem);
  const dens =
    parseFloat(
      String(
        estoqueItem?.densidade ||
          estoqueItem?.lotes?.[0]?.densidade ||
          "0"
      ).replace(",", ".")
    ) || 0;

  switch (um) {
    case "L":
      return saldoKgToLitros(saldo, dens, estoqueItem);
    case "gal": {
      const litros = saldoKgToLitros(saldo, dens, estoqueItem);
      return Math.round(litros / 3.78541);
    }
    case "lb":
      return Math.round(saldo / 0.453592);
    case "kg":
    default:
      return Math.round(saldo);
  }
}

/**
 * Massa/volume já retirado via transbordo para um registro de estoque.
 * Em transbordos, `origem.entrada_id` aponta para `estoque.id`.
 * Usado só para disponibilidade de novo transbordo — não para saldo na tela.
 */
export function calcTransbordado(estoqueItem, transbordos) {
  const id = estoqueItem?.id;
  if (!id) return 0;

  return (transbordos || []).reduce((sum, t) => {
    const dens =
      parseFloat(String(t.densidade || "0").replace(",", ".")) || 0;
    const matches = (t.origens || []).filter((o) => o.entrada_id === id);
    if (matches.length === 0) return sum;

    if ((estoqueItem.unidade_medida || "kg") === "kg") {
      return (
        sum +
        matches.reduce((s, o) => {
          const massa =
            o.massa_retirada || (o.volume_retirado || 0) * dens;
          return s + (Number(massa) || 0);
        }, 0)
      );
    }
    return (
      sum + matches.reduce((s, o) => s + (o.volume_retirado || 0), 0)
    );
  }, 0);
}

function placaBarrilKey(placa, barril) {
  return `${String(placa || "").trim().toUpperCase()}||${String(barril || "")
    .trim()
    .toUpperCase()}`;
}

/** Transbordos relacionados a um vasilhame (id, código OP ou placa/barril). */
export function findTransbordosForVasilhame(vasilhame, transbordos = []) {
  if (!vasilhame) return [];
  const byId = new Map();
  const add = (t) => {
    if (t?.id) byId.set(t.id, t);
  };

  if (vasilhame.transbordo_id) {
    const t = (transbordos || []).find((x) => x.id === vasilhame.transbordo_id);
    if (t) add(t);
  }

  const codigos = new Set(
    [
      vasilhame.numero_op,
      ...((vasilhame.composicao || []).map((c) => c.transbordo_codigo) || []),
    ].filter(Boolean)
  );
  (transbordos || []).forEach((t) => {
    if (codigos.has(t.codigo_transbordo)) add(t);
  });

  const key = placaBarrilKey(vasilhame.placa, vasilhame.barril);
  if (key !== "||") {
    (transbordos || []).forEach((t) => {
      const hit = (t.destinos || []).some(
        (d) => placaBarrilKey(d.placa || d.tanka_codigo, d.barril) === key
      );
      if (hit) add(t);
    });
  }

  return [...byId.values()];
}

function normCodigo(v) {
  return String(v || "")
    .trim()
    .toUpperCase();
}

/** Chaves que identificam uma embalagem de destino como possível origem futura. */
function collectEmbalagemKeysFromDestino(destino, transbordoId, vasilhames = []) {
  const keys = new Set();
  if (!destino) return keys;

  if (destino.tanka_id) keys.add(`tanka:${destino.tanka_id}`);
  const tankaCodigo = normCodigo(destino.tanka_codigo);
  if (tankaCodigo) keys.add(`tanka_codigo:${tankaCodigo}`);

  if (destino.vasilhame_existente_id) {
    keys.add(`vasilhame:${destino.vasilhame_existente_id}`);
  }

  const placa = destino.placa || destino.tanka_codigo || "";
  const barril = destino.barril || "";
  const pb = placaBarrilKey(placa, barril);
  if (pb !== "||") keys.add(`placa:${pb}`);

  if (transbordoId) {
    (vasilhames || []).forEach((v) => {
      if (v.transbordo_id !== transbordoId) return;
      const vPb = placaBarrilKey(v.placa, v.barril);
      if (pb !== "||" && vPb === pb) {
        if (v.id) keys.add(`vasilhame:${v.id}`);
      } else if (
        destino.tipo_embalagem === "Tankagem" &&
        v.tipo === "Tankagem" &&
        tankaCodigo &&
        normCodigo(v.placa) === tankaCodigo
      ) {
        if (v.id) keys.add(`vasilhame:${v.id}`);
      }
    });
  }

  return keys;
}

/** Verifica se a origem de um transbordo consome alguma embalagem rastreada. */
function origemMatchesEmbalagemKeys(origem, keys, vasilhames = []) {
  if (!origem || !keys || keys.size === 0) return false;
  const tipo = origem.tipo_origem || "";

  if (tipo === "tanka") {
    if (origem.entrada_id && keys.has(`tanka:${origem.entrada_id}`)) return true;
    const codigo = normCodigo(
      origem.entrada_codigo || origem.tanka_codigo || ""
    );
    if (codigo && keys.has(`tanka_codigo:${codigo}`)) return true;
    return false;
  }

  if (tipo === "vasilhame") {
    if (origem.entrada_id && keys.has(`vasilhame:${origem.entrada_id}`)) {
      return true;
    }
    const v = (vasilhames || []).find((x) => x.id === origem.entrada_id);
    if (v) {
      const pb = placaBarrilKey(v.placa, v.barril);
      if (pb !== "||" && keys.has(`placa:${pb}`)) return true;
      if (v.tipo === "Tankagem" && normCodigo(v.placa)) {
        if (keys.has(`tanka_codigo:${normCodigo(v.placa)}`)) return true;
      }
    }
    const codigo = normCodigo(origem.entrada_codigo || "");
    if (codigo) {
      // Labels do tipo "PLACA - Produto (N L)" — tenta placa no início
      const placaHint = codigo.split(/\s*[-–]\s*/)[0];
      if (placaHint && keys.has(`placa:${placaBarrilKey(placaHint, "")}`)) {
        return true;
      }
    }
    return false;
  }

  return false;
}

function labelOrigemTransbordo(origem, vasilhames = []) {
  if (!origem) return "—";
  if (origem.entrada_codigo) return origem.entrada_codigo;
  const tipo = origem.tipo_origem || "";
  if (tipo === "tanka") {
    return origem.tanka_codigo || "Tanka";
  }
  if (tipo === "vasilhame" && origem.entrada_id) {
    const v = (vasilhames || []).find((x) => x.id === origem.entrada_id);
    if (v) {
      return [v.placa, v.barril].filter(Boolean).join(" / ") || v.codigo || "Vasilhame";
    }
  }
  return tipo || "—";
}

function labelDestinoTransbordo(destino) {
  if (!destino) return "—";
  const placaBarril = [destino.placa, destino.barril].filter(Boolean).join(" / ");
  if (placaBarril) return placaBarril;
  if (destino.tanka_codigo) return destino.tanka_codigo;
  if (destino.tipo_embalagem) {
    const qtd = Number(destino.quantidade_embalagens) || 0;
    return qtd > 0
      ? `${destino.tipo_embalagem} (${qtd})`
      : destino.tipo_embalagem;
  }
  return "—";
}

/**
 * Destinos de transbordo que receberam volume deste estoque via FIFO.
 * Não lista todos os destinos do OP — só as embalagens alocadas a esta origem,
 * com volume/peso da fração FIFO (não o volume total do destino).
 */
export function listDestinosFifoForEstoque(estoqueItem, transbordos = []) {
  const id = estoqueItem?.id;
  if (!id) return [];

  const rows = [];

  for (const t of transbordos || []) {
    const origens = t.origens || [];
    const destinos = t.destinos || [];
    if (!origens.some((o) => o.entrada_id === id)) continue;
    if (destinos.length === 0) continue;

    const dens = parseDensidade(t.densidade);
    const origensFifo = expandOrigensForFifo(origens, dens);

    const matchingOrigemIdx = new Set();
    origensFifo.forEach((o, idx) => {
      if (o.entrada_id === id) matchingOrigemIdx.add(idx);
    });
    if (matchingOrigemIdx.size === 0) continue;

    const { destinoCompositions } = calculateFIFOAllocation(
      origensFifo,
      destinos,
      dens
    );

    destinos.forEach((d, idx) => {
      const fromThis = (destinoCompositions[idx] || []).filter((c) =>
        matchingOrigemIdx.has(c.origem_index)
      );
      if (fromThis.length === 0) return;

      const volume = roundVolume(
        fromThis.reduce((s, c) => s + (Number(c.quantidade_l) || 0), 0)
      );
      if (volume <= 0) return;

      let pesoLiq = roundMass(
        fromThis.reduce((s, c) => s + (Number(c.quantidade_kg) || 0), 0)
      );
      if (pesoLiq <= 0 && dens > 0) {
        pesoLiq = roundMass(volume * dens);
      }

      rows.push({
        key: `${t.id}-${idx}`,
        transbordoId: t.id,
        codigo: t.codigo_transbordo || "—",
        data: t.data,
        destino:
          [d.placa, d.barril].filter(Boolean).join(" / ") ||
          d.tanka_codigo ||
          (d.tipo_embalagem
            ? Number(d.quantidade_embalagens) > 0
              ? `${d.tipo_embalagem} (${d.quantidade_embalagens})`
              : d.tipo_embalagem
            : "—"),
        tipo: d.tipo_embalagem || (d.tanka_codigo ? "Tanka" : "—"),
        volume,
        pesoLiq,
        rawDestino: d,
      });
    });
  }

  return rows.sort((a, b) => {
    const da = new Date(a.data || 0).getTime();
    const db = new Date(b.data || 0).getTime();
    if (da !== db) return da - db;
    return String(a.codigo).localeCompare(String(b.codigo));
  });
}

/**
 * Histórico de re-transbordos encadeados: todas as embalagens pelas quais
 * o produto passou após o destino inicial (ex.: tanka → vasilhame).
 */
export function listHistoricoTransbordosEncadeados(
  estoqueItem,
  transbordos = [],
  vasilhames = []
) {
  const id = estoqueItem?.id;
  if (!id) return [];

  // Só rastreia destinos que o FIFO atribuiu a este estoque
  const firstDestinos = listDestinosFifoForEstoque(estoqueItem, transbordos);
  const firstIds = new Set(firstDestinos.map((r) => r.transbordoId).filter(Boolean));

  const trackedKeys = new Set();
  firstDestinos.forEach((row) => {
    if (!row.rawDestino) return;
    collectEmbalagemKeysFromDestino(
      row.rawDestino,
      row.transbordoId,
      vasilhames
    ).forEach((k) => trackedKeys.add(k));
  });

  if (trackedKeys.size === 0) return [];

  const visited = new Set(firstIds);
  const rows = [];
  let grew = true;

  while (grew) {
    grew = false;
    for (const t of transbordos || []) {
      if (!t?.id || visited.has(t.id)) continue;

      const matchingOrigens = (t.origens || []).filter((o) =>
        origemMatchesEmbalagemKeys(o, trackedKeys, vasilhames)
      );
      if (matchingOrigens.length === 0) continue;

      visited.add(t.id);
      grew = true;

      const origemLabel = matchingOrigens
        .map((o) => labelOrigemTransbordo(o, vasilhames))
        .filter(Boolean)
        .join(", ");

      (t.destinos || []).forEach((d, idx) => {
        rows.push({
          key: `${t.id}-${idx}`,
          transbordoId: t.id,
          codigo: t.codigo_transbordo || "—",
          data: t.data,
          origem: origemLabel || "—",
          destino: labelDestinoTransbordo(d),
          tipo: d.tipo_embalagem || (d.tanka_codigo ? "Tanka" : "—"),
          volume: d.volume_total || d.volume || 0,
          pesoLiq: d.peso_liquido || 0,
          rawDestino: d,
        });
        collectEmbalagemKeysFromDestino(d, t.id, vasilhames).forEach((k) =>
          trackedKeys.add(k)
        );
      });
    }
  }

  return rows.sort((a, b) => {
    const da = new Date(a.data || 0).getTime();
    const db = new Date(b.data || 0).getTime();
    if (da !== db) return da - db;
    return String(a.codigo).localeCompare(String(b.codigo));
  });
}

/**
 * Frações do conteúdo do vasilhame atribuídas a cada estoque de origem.
 * Retorna Map<estoqueId, weight> com soma ≈ 1.
 *
 * Inclui vínculo de entrada direta (tipo_recebimento = vasilhame), quando o
 * tanque foi criado na entrada sem passar por transbordo.
 */
export function getEstoqueWeightsForVasilhame(vasilhame, transbordos = [], estoqueItem = null) {
  const weights = new Map();
  const related = findTransbordosForVasilhame(vasilhame, transbordos);

  related.forEach((t) => {
    (t.origens || []).forEach((o) => {
      if (!o.entrada_id) return;
      const dens =
        parseFloat(String(t.densidade || "0").replace(",", ".")) || 0;
      const massa =
        Number(o.massa_retirada) ||
        (Number(o.volume_retirado) || 0) * dens ||
        0;
      weights.set(o.entrada_id, (weights.get(o.entrada_id) || 0) + massa);
    });
  });

  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // Sem massa conhecida: divide igualmente entre origens
    const ids = new Set();
    related.forEach((t) =>
      (t.origens || []).forEach((o) => {
        if (o.entrada_id) ids.add(o.entrada_id);
      })
    );
    if (ids.size === 0) {
      // Entrada direta como vasilhame (sem OP): 100% deste estoque
      if (estoqueItem && isVasilhameFromEntradaDireta(vasilhame, estoqueItem)) {
        weights.set(estoqueItem.id, 1);
      }
      return weights;
    }
    const w = 1 / ids.size;
    ids.forEach((id) => weights.set(id, w));
    return weights;
  }

  for (const [id, m] of weights) {
    weights.set(id, m / total);
  }
  return weights;
}

/** Tanque criado na própria entrada (sem transbordo intermediário). */
export function isVasilhameFromEntradaDireta(vasilhame, estoqueItem) {
  if (!vasilhame?.id || !estoqueItem?.id) return false;

  const lote = estoqueItem.lotes?.[0];
  if (lote?.vasilhame_id && lote.vasilhame_id === vasilhame.id) return true;

  const tipo =
    lote?.tipo_recebimento || estoqueItem.tipo_recebimento || "";
  if (tipo !== "vasilhame") return false;

  const entradaId = estoqueItem.entrada_id;
  if (
    entradaId &&
    (vasilhame.composicao || []).some(
      (c) => c.entrada_id === entradaId || c.estoque_id === estoqueItem.id
    )
  ) {
    return true;
  }

  if (
    (vasilhame.composicao || []).some((c) => c.estoque_id === estoqueItem.id)
  ) {
    return true;
  }

  return false;
}

/**
 * Quantidade já baixada por saídas de embalado (enviadas ao fiscal).
 * Em saídas, `item.entrada_id` aponta para `estoque.id`.
 */
export function calcSaidasEmbalado(estoqueItem, saidas) {
  const id = estoqueItem?.id;
  if (!id) return 0;

  return (saidas || []).reduce((sum, saida) => {
    if (!saida?.enviado_ao_fiscal) return sum;
    return (
      sum +
      (saida.itens || []).reduce((s, item) => {
        if (item.tipo !== "embalado" || item.entrada_id !== id) return s;
        return s + (item.quantidade_solicitada || 0);
      }, 0)
    );
  }, 0);
}

/**
 * Massa (kg) já baixada por saídas convencionais fiscais
 * cujos vasilhames se originaram deste estoque (via transbordo ou entrada direta).
 */
export function calcSaidasConvencional(
  estoqueItem,
  saidas,
  vasilhames = [],
  transbordos = []
) {
  const id = estoqueItem?.id;
  if (!id) return 0;

  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));

  return (saidas || []).reduce((sum, saida) => {
    if (!saida?.enviado_ao_fiscal) return sum;
    return (
      sum +
      (saida.itens || []).reduce((s, item) => {
        if (item.tipo !== "convencional" || !item.vasilhame_id) return s;
        const v = vasilhameById.get(item.vasilhame_id);
        if (!v) return s;
        const weights = getEstoqueWeightsForVasilhame(v, transbordos, estoqueItem);
        const w = weights.get(id) || 0;
        if (w <= 0) return s;
        // Baixa na unidade do estoque: L → volume_solicitado; kg → massa
        const qtd = estoqueOperaEmLitros(estoqueItem)
          ? Number(item.volume_solicitado) || 0
          : Number(item.quantidade_solicitada) ||
            Number(item.peso_liquido) ||
            0;
        return s + qtd * w;
      }, 0)
    );
  }, 0);
}

/** Vasilhame marcado como expedido (saída registrada no pátio). */
export function isVasilhameExpedido(vasilhame) {
  if (!vasilhame) return false;
  if (vasilhame.status === "Expedido") return true;
  const data = vasilhame.data_saida;
  return data != null && String(data).trim() !== "";
}

/** Estoque operacional em litros (embalado em L ou unidade de entrada L). */
export function estoqueOperaEmLitros(estoqueItem) {
  const um = String(
    estoqueItem?.unidade_medida ||
      estoqueItem?.lotes?.[0]?.unidade_medida ||
      "kg"
  )
    .trim()
    .toLowerCase();
  return um === "l" || um === "lt" || um === "litro" || um === "litros";
}

/**
 * Volume (L) do conteúdo do vasilhame para baixa de estoque em litros.
 * Se o volume já foi zerado, usa composição ou destino do OP.
 */
export function resolveVolumeVasilhameParaBaixa(vasilhame, transbordos = []) {
  if (!vasilhame) return 0;

  const vol = Number(vasilhame.volume) || 0;
  if (vol > 0) return vol;

  const fromComp = (vasilhame.composicao || []).reduce(
    (s, c) => s + (Number(c.quantidade_l) || 0),
    0
  );
  if (fromComp > 0) return fromComp;

  const dens =
    parseFloat(String(vasilhame.densidade || "0").replace(",", ".")) || 0;
  const peso = Number(vasilhame.peso_liquido) || 0;
  if (peso > 0 && dens > 0) return peso / dens;

  const related = findTransbordosForVasilhame(vasilhame, transbordos);
  let fromOp = 0;
  for (const t of related) {
    for (const d of t.destinos || []) {
      const sameId =
        d.vasilhame_existente_id &&
        d.vasilhame_existente_id === vasilhame.id;
      const samePlaca =
        placaBarrilKey(d.placa || d.tanka_codigo, d.barril) ===
          placaBarrilKey(vasilhame.placa, vasilhame.barril) &&
        placaBarrilKey(vasilhame.placa, vasilhame.barril) !== "||";
      if (!sameId && !samePlaca) continue;
      fromOp += Number(d.volume_total || d.volume) || 0;
    }
  }
  if (fromOp > 0) return fromOp;

  // Fallback: massa do OP / densidade
  const massa = resolveMassaVasilhameParaBaixa(vasilhame, transbordos);
  if (massa > 0 && dens > 0) return massa / dens;
  return 0;
}

/**
 * Massa do conteúdo do vasilhame para baixa de estoque.
 * Se o volume já foi zerado (saída fiscal), usa composição ou destino do OP.
 */
export function resolveMassaVasilhameParaBaixa(vasilhame, transbordos = []) {
  if (!vasilhame) return 0;

  const peso = Number(vasilhame.peso_liquido) || 0;
  if (peso > 0) return peso;

  const dens =
    parseFloat(String(vasilhame.densidade || "0").replace(",", ".")) || 0;
  const vol = Number(vasilhame.volume) || 0;
  if (vol > 0) return dens > 0 ? vol * dens : vol;

  const fromComp = (vasilhame.composicao || []).reduce(
    (s, c) => s + (Number(c.quantidade_kg) || 0),
    0
  );
  if (fromComp > 0) return fromComp;

  const fromCompL = (vasilhame.composicao || []).reduce(
    (s, c) => s + (Number(c.quantidade_l) || 0),
    0
  );
  if (fromCompL > 0) return dens > 0 ? fromCompL * dens : fromCompL;

  const related = findTransbordosForVasilhame(vasilhame, transbordos);
  let fromOp = 0;
  for (const t of related) {
    const densT =
      parseFloat(String(t.densidade || "0").replace(",", ".")) || dens;
    for (const d of t.destinos || []) {
      const sameId =
        d.vasilhame_existente_id &&
        d.vasilhame_existente_id === vasilhame.id;
      const samePlaca =
        placaBarrilKey(d.placa || d.tanka_codigo, d.barril) ===
          placaBarrilKey(vasilhame.placa, vasilhame.barril) &&
        placaBarrilKey(vasilhame.placa, vasilhame.barril) !== "||";
      if (!sameId && !samePlaca) continue;
      fromOp +=
        Number(d.peso_liquido) ||
        (Number(d.volume_total || d.volume) || 0) * densT ||
        0;
    }
  }
  return fromOp;
}

/**
 * Quantidade a baixar do estoque na unidade operacional do registro
 * (L para embalado em litros; kg no convencional).
 */
export function resolveQuantidadeVasilhameParaBaixa(
  estoqueItem,
  vasilhame,
  transbordos = []
) {
  if (estoqueOperaEmLitros(estoqueItem)) {
    return resolveVolumeVasilhameParaBaixa(vasilhame, transbordos);
  }
  return resolveMassaVasilhameParaBaixa(vasilhame, transbordos);
}

/**
 * Quantidade já baixada porque o vasilhame de origem foi expedido no pátio
 * (Registrar Saída em Vasilhames), sem passar pela saída fiscal.
 * Usa a mesma unidade do estoque (L ou kg) para não distorcer por densidade.
 * Evita duplicar o que já entrou em `calcSaidasConvencional`.
 */
export function calcVasilhamesExpedidosPatio(
  estoqueItem,
  vasilhames = [],
  transbordos = [],
  saidas = []
) {
  const id = estoqueItem?.id;
  if (!id) return 0;

  // Vasilhames já baixados via saída fiscal — não contar de novo
  const fiscalVasilhameIds = new Set();
  (saidas || []).forEach((saida) => {
    if (!saida?.enviado_ao_fiscal) return;
    (saida.itens || []).forEach((item) => {
      if (item.tipo === "convencional" && item.vasilhame_id) {
        fiscalVasilhameIds.add(item.vasilhame_id);
      }
    });
  });

  return (vasilhames || []).reduce((sum, v) => {
    if (!isVasilhameExpedido(v)) return sum;
    if (fiscalVasilhameIds.has(v.id)) return sum;

    const weights = getEstoqueWeightsForVasilhame(v, transbordos, estoqueItem);
    const w = weights.get(id) || 0;
    if (w <= 0) return sum;

    const qtd = resolveQuantidadeVasilhameParaBaixa(
      estoqueItem,
      v,
      transbordos
    );
    return sum + qtd * w;
  }, 0);
}

/** Estoque IDs de origem afetados por um vasilhame (OP ou entrada direta). */
export function resolveEstoqueIdsFromVasilhame(
  vasilhame,
  transbordos = [],
  estoqueList = []
) {
  if (!vasilhame) return [];
  const ids = new Set();
  const weights = getEstoqueWeightsForVasilhame(vasilhame, transbordos);
  weights.forEach((w, estoqueId) => {
    if (w > 0) ids.add(estoqueId);
  });
  (estoqueList || []).forEach((e) => {
    if (isVasilhameFromEntradaDireta(vasilhame, e)) ids.add(e.id);
  });
  return [...ids];
}

/**
 * Lista entradas do histórico de saídas vinculadas a um estoque
 * (embalado direto + convencional via vasilhame/transbordo).
 */
export function listSaidasHistoricoForEstoque(
  estoqueItem,
  saidas = [],
  vasilhames = [],
  transbordos = []
) {
  const id = estoqueItem?.id;
  if (!id) return [];

  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));
  const rows = [];

  (saidas || []).forEach((saida) => {
    (saida.itens || []).forEach((item, idx) => {
      let quantidade = 0;
      let unidade = "kg";
      let linked = false;

      if (item.tipo === "embalado" && item.entrada_id === id) {
        linked = true;
        quantidade = Number(item.quantidade_solicitada) || 0;
        unidade = estoqueItem.unidade_medida || "kg";
      } else if (item.tipo === "convencional" && item.vasilhame_id) {
        const v = vasilhameById.get(item.vasilhame_id);
        if (v) {
          const weights = getEstoqueWeightsForVasilhame(
            v,
            transbordos,
            estoqueItem
          );
          const w = weights.get(id) || 0;
          if (w > 0) {
            linked = true;
            const massa =
              Number(item.quantidade_solicitada) ||
              Number(item.peso_liquido) ||
              0;
            quantidade = roundMass(massa * w);
            unidade = "kg";
          }
        }
      }

      if (!linked) return;

      const vasilhameLabel =
        item.tipo === "embalado"
          ? "Embalado"
          : `${item.vasilhame_placa || vasilhameById.get(item.vasilhame_id)?.placa || "—"} - ${
              item.vasilhame_barril ||
              vasilhameById.get(item.vasilhame_id)?.barril ||
              "—"
            }`;

      rows.push({
        key: `${saida.id}-${idx}`,
        codigo: saida.codigo || "—",
        data: saida.data_solicitacao || saida.created_at,
        tipo: item.tipo || "—",
        vasilhame: vasilhameLabel,
        quantidade,
        unidade,
        status: saida.enviado_ao_fiscal
          ? "Validado"
          : saida.status === "enviado_fiscal"
            ? "Validado"
            : "Pendente",
        enviadoEm: saida.enviado_fiscal_data,
        responsavel:
          saida.enviado_fiscal_usuario ||
          saida.usuario_responsavel ||
          saida.usuario_criador ||
          "—",
        enviado_ao_fiscal: !!saida.enviado_ao_fiscal,
      });
    });
  });

  return rows.sort(
    (a, b) => new Date(b.data || 0) - new Date(a.data || 0)
  );
}

/** Estoque IDs afetados por itens convencionais de uma saída. */
export function resolveEstoqueIdsFromSaidaConvencional(
  itens = [],
  vasilhames = [],
  transbordos = [],
  estoqueList = []
) {
  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));
  const ids = new Set();
  itens.forEach((item) => {
    if (item.tipo !== "convencional" || !item.vasilhame_id) return;
    const v = vasilhameById.get(item.vasilhame_id);
    if (!v) return;

    // Origens via OP
    const weights = getEstoqueWeightsForVasilhame(v, transbordos);
    weights.forEach((w, estoqueId) => {
      if (w > 0) ids.add(estoqueId);
    });

    // Entrada direta: vincula pelo vasilhame_id / composição
    (estoqueList || []).forEach((e) => {
      if (isVasilhameFromEntradaDireta(v, e)) ids.add(e.id);
    });
  });
  return [...ids];
}

/**
 * Saldo atual na tela de Estoque.
 *
 * Regras de negócio:
 * - Na entrada: saldo = quantidade recebida
 * - Transbordo (OP) NÃO reduz o saldo (movimento interno granel → vasilhame)
 * - Embalado: reduz quando há saída enviada ao fiscal
 * - Convencional: reduz quando o vasilhame é expedido
 *   (Registrar Saída no pátio ou saída enviada ao fiscal)
 */
export function computeEstoqueSaldo(
  estoqueItem,
  transbordos,
  saidas,
  vasilhames = []
) {
  const quantidade = getEstoqueQuantidade(estoqueItem);
  const saidoEmb = calcSaidasEmbalado(estoqueItem, saidas);
  const saidoConv = calcSaidasConvencional(
    estoqueItem,
    saidas,
    vasilhames,
    transbordos
  );
  const saidoPatio = calcVasilhamesExpedidosPatio(
    estoqueItem,
    vasilhames,
    transbordos,
    saidas
  );
  return Math.max(
    0,
    roundMass(quantidade - saidoEmb - saidoConv - saidoPatio)
  );
}

/**
 * Quanto ainda pode ser retirado em um novo transbordo (kg/L conforme unidade).
 * Independente do saldo da tela de Estoque.
 */
export function computeDisponivelTransbordo(estoqueItem, transbordos) {
  const tipoRecebimento =
    estoqueItem?.lotes?.[0]?.tipo_recebimento ||
    estoqueItem?.tipo_recebimento;
  // Entrada já em tanque não é origem granel de OP
  if (tipoRecebimento === "vasilhame") return 0;
  if (estoqueItem?.embalado || estoqueItem?.lotes?.[0]?.embalado) return 0;

  const quantidade = getEstoqueQuantidade(estoqueItem);
  const transbordado = calcTransbordado(estoqueItem, transbordos);
  return Math.max(0, quantidade - transbordado);
}

/**
 * Recalcula e persiste saldo_atual dos registros de estoque informados.
 * Se `estoqueIds` for omitido/vazio, recalcula todos.
 */
export async function syncEstoqueSaldos(estoqueIds) {
  const [allEstoque, allTransbordos, allSaidas, allVasilhames] =
    await Promise.all([
      entities.estoque.list(),
      entities.transbordos.list(),
      entities.saidas.list(),
      entities.vasilhames.list(),
    ]);

  const idSet =
    estoqueIds && estoqueIds.length > 0
      ? new Set(estoqueIds.filter(Boolean))
      : null;

  const targets = idSet
    ? allEstoque.filter((e) => idSet.has(e.id))
    : allEstoque;

  const updates = [];
  const withSaldo = targets.map((item) => {
    const quantidade = getEstoqueQuantidade(item);
    const unidade_medida = getEstoqueUnidade(item);
    const saldo_atual = computeEstoqueSaldo(
      item,
      allTransbordos,
      allSaidas,
      allVasilhames
    );
    const patch = { id: item.id, saldo_atual };
    if ((Number(item.quantidade) || 0) <= 0 && quantidade > 0) {
      patch.quantidade = quantidade;
    }
    if (item.unidade_medida !== unidade_medida) {
      patch.unidade_medida = unidade_medida;
    }
    if (
      Math.abs((item.saldo_atual || 0) - saldo_atual) > 0.001 ||
      patch.quantidade != null ||
      patch.unidade_medida != null
    ) {
      updates.push(patch);
    }
    return { ...item, quantidade, unidade_medida, saldo_atual };
  });

  if (updates.length > 0) {
    await entities.estoque.bulkUpdate(updates);
  }

  return withSaldo;
}
