import { roundMass } from "@chemflow/lib/format";
import { loteToKg, loteUnidadeEstoque } from "@chemflow/lib/conversao";
import { entities } from "@chemflow/services/entities";

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

/**
 * Frações do conteúdo do vasilhame atribuídas a cada estoque de origem.
 * Retorna Map<estoqueId, weight> com soma ≈ 1.
 */
export function getEstoqueWeightsForVasilhame(vasilhame, transbordos = []) {
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
    if (ids.size === 0) return weights;
    const w = 1 / ids.size;
    ids.forEach((id) => weights.set(id, w));
    return weights;
  }

  for (const [id, m] of weights) {
    weights.set(id, m / total);
  }
  return weights;
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
 * cujos vasilhames se originaram deste estoque (via transbordo).
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
        const weights = getEstoqueWeightsForVasilhame(v, transbordos);
        const w = weights.get(id) || 0;
        if (w <= 0) return s;
        const massa =
          Number(item.quantidade_solicitada) ||
          Number(item.peso_liquido) ||
          0;
        return s + massa * w;
      }, 0)
    );
  }, 0);
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
          const weights = getEstoqueWeightsForVasilhame(v, transbordos);
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
          ? "Enviado ao fiscal"
          : saida.status === "enviado_fiscal"
            ? "Enviado ao fiscal"
            : "Aguardando",
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
  transbordos = []
) {
  const vasilhameById = new Map((vasilhames || []).map((v) => [v.id, v]));
  const ids = new Set();
  itens.forEach((item) => {
    if (item.tipo !== "convencional" || !item.vasilhame_id) return;
    const v = vasilhameById.get(item.vasilhame_id);
    if (!v) return;
    const weights = getEstoqueWeightsForVasilhame(v, transbordos);
    weights.forEach((w, estoqueId) => {
      if (w > 0) ids.add(estoqueId);
    });
  });
  return [...ids];
}

/**
 * Saldo atual na tela de Estoque.
 *
 * Regras de negócio:
 * - Na entrada: saldo = quantidade recebida
 * - Transbordo NÃO reduz o saldo (é movimento interno granel → vasilhame)
 * - Embalado: reduz quando há saída enviada ao fiscal
 * - Convencional: reduz quando o vasilhame originado deste estoque é enviado ao fiscal
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
  return Math.max(0, roundMass(quantidade - saidoEmb - saidoConv));
}

/**
 * Quanto ainda pode ser retirado em um novo transbordo (kg/L conforme unidade).
 * Independente do saldo da tela de Estoque.
 */
export function computeDisponivelTransbordo(estoqueItem, transbordos) {
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
