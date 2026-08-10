/**
 * Destinos de transbordo que viram Estoque (tipo Embalado),
 * e não registros na tela de Vasilhames.
 */

import { roundMass, roundVolume, parseDensidade } from "@transbordo/lib/format";
import { calculateFIFOAllocation } from "@transbordo/lib/fifo";
import { getDominantLote } from "@transbordo/lib/vasilhameComposicao";
import { entities } from "@transbordo/services/entities";

/** Destinos unitários do formulário de transbordo → Estoque Embalado. */
export const TIPOS_EMBALAGEM_ESTOQUE = new Set([
  "One Way (IBC)",
  "Bombona 200 L",
  "Tambor 200 L",
]);

/** Tipos legados na tela de Vasilhames que também devem migrar. */
const TIPOS_VASILHAME_LEGADO_EMBALADO = new Set([
  ...TIPOS_EMBALAGEM_ESTOQUE,
  "Tambor",
  "Bombona",
  "IBC",
  "One Way",
]);

export function isDestinoEstoqueEmbalado(tipoEmbalagem) {
  return TIPOS_EMBALAGEM_ESTOQUE.has(tipoEmbalagem);
}

export function isVasilhameLegadoEmbalado(tipo) {
  return TIPOS_VASILHAME_LEGADO_EMBALADO.has(tipo);
}

/** Chave estável para localizar/apagar estoque gerado por um transbordo. */
export function estoqueGrupoDoTransbordo(transbordoId) {
  return `TB:${transbordoId}`;
}

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

/**
 * Resolve o estoque/entrada de origem predominante (FIFO) para copiar NF, datas e preço.
 */
function resolveOrigemEstoque(comp, origens, estoqueById) {
  const ranked = [...(comp || [])].sort(
    (a, b) => (b.quantidade_l || 0) - (a.quantidade_l || 0)
  );
  for (const c of ranked) {
    const o = origens[c.origem_index];
    if (!o?.entrada_id) continue;
    const est = estoqueById.get(o.entrada_id);
    if (est) return { origem: o, estoque: est };
  }
  for (const o of origens || []) {
    if (!o?.entrada_id) continue;
    const est = estoqueById.get(o.entrada_id);
    if (est) return { origem: o, estoque: est };
  }
  return { origem: origens?.[0] || null, estoque: null };
}

/**
 * Monta um único registro de estoque Embalado para o destino
 * (N tambores/IBCs = 1 linha com quantidade_embalagens = N).
 */
export function buildEstoqueEmbaladoFromDestino({
  payload,
  savedTransbordo,
  destino,
  destinoIndex,
  comp = [],
  origens = [],
  estoqueById = new Map(),
}) {
  const dens = parseDensidade(payload.densidade);
  const qtdEmb = Math.max(0, Math.round(destino.quantidade_embalagens || 0));
  const volumeTotal = roundVolume(destino.volume_total || destino.volume || 0);
  const pesoTotal =
    destino.peso_liquido != null && destino.peso_liquido !== ""
      ? roundMass(destino.peso_liquido)
      : dens > 0
        ? roundMass(volumeTotal * dens)
        : 0;
  const pesoPorEmbalagem =
    qtdEmb > 0 ? roundMass(pesoTotal / qtdEmb) : pesoTotal;

  const { origem, estoque: origemEstoque } = resolveOrigemEstoque(
    comp,
    origens,
    estoqueById
  );
  const origemLote = origemEstoque?.lotes?.[0] || null;
  const lote =
    getDominantLote(comp) ||
    origem?.lote ||
    origemEstoque?.lote ||
    "";

  const notaFiscal =
    origemEstoque?.nota_fiscal ||
    origemLote?.nota_fiscal ||
    null;
  const notaFiscalTroca =
    origemEstoque?.nota_fiscal_troca ||
    origemLote?.nota_fiscal_troca ||
    null;
  const preco =
    Number(origemEstoque?.preco_unitario) ||
    Number(origemLote?.preco_unitario) ||
    0;

  const entradaId = null; // não vincular à entrada de origem (evita sync/cascade misturar lotes)
  const lotePayload = {
    lote,
    quantidade: pesoTotal,
    unidade_medida: "kg",
    densidade: payload.densidade || origemEstoque?.densidade || "",
    embalado: true,
    peso_liquido: pesoPorEmbalagem,
    quantidade_embalagens: qtdEmb,
    nota_fiscal: notaFiscal,
    data_fabricacao:
      origemEstoque?.data_fabricacao || origemLote?.data_fabricacao || null,
    data_validade:
      origemEstoque?.data_validade || origemLote?.data_validade || null,
    preco_unitario: preco,
    produto_id: nullIfEmpty(payload.produto_id) || origemEstoque?.produto_id,
    produto_nome: payload.produto_nome || origemEstoque?.produto_nome || "",
    produto_codigo:
      payload.produto_codigo || origemEstoque?.produto_codigo || "",
    tipo_embalagem: destino.tipo_embalagem || "",
    volume_por_embalagem: roundVolume(destino.volume_por_embalagem || 0),
    volume_total: volumeTotal,
    transbordo_id: savedTransbordo.id,
    transbordo_codigo: savedTransbordo.codigo_transbordo || payload.codigo_transbordo || "",
    destino_index: destinoIndex,
    origem_estoque_id: origemEstoque?.id || origem?.entrada_id || null,
    ...(notaFiscalTroca != null ? { nota_fiscal_troca: notaFiscalTroca } : {}),
  };

  const record = {
    entrada_id: entradaId,
    entrada_codigo:
      origemEstoque?.entrada_codigo ||
      origem?.entrada_codigo ||
      savedTransbordo.codigo_transbordo ||
      "",
    grupo_entrada: estoqueGrupoDoTransbordo(savedTransbordo.id),
    cliente_id:
      nullIfEmpty(payload.cliente_id) ||
      nullIfEmpty(origemEstoque?.cliente_id),
    cliente_nome: payload.cliente_nome || origemEstoque?.cliente_nome || "",
    produto_id:
      nullIfEmpty(payload.produto_id) ||
      nullIfEmpty(origemEstoque?.produto_id),
    produto_nome: payload.produto_nome || origemEstoque?.produto_nome || "",
    produto_codigo:
      payload.produto_codigo || origemEstoque?.produto_codigo || "",
    nota_fiscal: notaFiscal,
    lote,
    densidade: payload.densidade || origemEstoque?.densidade || "",
    data_fabricacao: nullIfEmpty(
      origemEstoque?.data_fabricacao || origemLote?.data_fabricacao
    ),
    data_validade: nullIfEmpty(
      origemEstoque?.data_validade || origemLote?.data_validade
    ),
    quantidade: pesoTotal,
    unidade_medida: "kg",
    saldo_atual: pesoTotal,
    preco_unitario: preco,
    custo_total: roundMass(pesoTotal * preco),
    embalado: true,
    peso_liquido: pesoPorEmbalagem,
    quantidade_embalagens: qtdEmb,
    status_wms: origemEstoque?.status_wms || false,
    origem: origemEstoque?.origem || "transbordo",
    lotes: [lotePayload],
  };

  if (
    origemEstoque &&
    Object.prototype.hasOwnProperty.call(origemEstoque, "nota_fiscal_troca")
  ) {
    record.nota_fiscal_troca = notaFiscalTroca;
  }

  return record;
}

/** Remove estoque gerado por um transbordo (edit/delete). */
export async function deleteEstoqueDoTransbordo(transbordoId) {
  if (!transbordoId) return;
  await entities.estoque.deleteMany({
    grupo_entrada: estoqueGrupoDoTransbordo(transbordoId),
  });
}

/**
 * Massa/volume já convertido em Estoque Embalado a partir deste registro de origem.
 * Usado no saldo da tela para não duplicar inventário (origem + embalado).
 */
export function calcTransbordadoParaEmbalado(estoqueItem, transbordos = []) {
  const id = estoqueItem?.id;
  if (!id) return 0;

  let total = 0;
  for (const t of transbordos || []) {
    const origens = t.origens || [];
    const destinos = t.destinos || [];
    if (!origens.some((o) => o.entrada_id === id)) continue;
    if (!destinos.some((d) => isDestinoEstoqueEmbalado(d.tipo_embalagem))) {
      continue;
    }

    const dens = parseDensidade(t.densidade);
    const { destinoCompositions } = calculateFIFOAllocation(
      origens,
      destinos,
      dens
    );
    const emKg = (estoqueItem.unidade_medida || "kg") === "kg";

    destinos.forEach((d, i) => {
      if (!isDestinoEstoqueEmbalado(d.tipo_embalagem)) return;
      for (const c of destinoCompositions[i] || []) {
        const o = origens[c.origem_index];
        if (o?.entrada_id !== id) continue;
        if (emKg) {
          total +=
            dens > 0
              ? Number(c.quantidade_l || 0) * dens
              : Number(c.quantidade_kg || 0);
        } else {
          total += Number(c.quantidade_l || 0);
        }
      }
    });
  }

  return roundMass(total);
}

/**
 * Migra Tambor/IBC/Bombona ainda na tela de Vasilhames para Estoque Embalado.
 * Agrupa unidades do mesmo OP/tipo em uma única linha.
 */
export async function migrateVasilhamesEmbaladosParaEstoque() {
  const [vasilhames, transbordos, estoqueList] = await Promise.all([
    entities.vasilhames.list(),
    entities.transbordos.list(),
    entities.estoque.list(),
  ]);

  const candidatos = (vasilhames || []).filter((v) =>
    isVasilhameLegadoEmbalado(v.tipo)
  );
  if (candidatos.length === 0) {
    return { migratedGroups: 0, deletedVasilhames: 0 };
  }

  const estoqueById = new Map((estoqueList || []).map((e) => [e.id, e]));
  const transbordoById = new Map((transbordos || []).map((t) => [t.id, t]));

  const estoqueJaCobre = (transbordoId, destinoIndex, tipo) =>
    (estoqueList || []).some((e) => {
      if (e.grupo_entrada !== estoqueGrupoDoTransbordo(transbordoId)) return false;
      const lote = e.lotes?.[0];
      if (!lote) return true; // grupo do OP já migrado (legado)
      if (destinoIndex != null && lote.destino_index != null) {
        return Number(lote.destino_index) === Number(destinoIndex);
      }
      return (lote.tipo_embalagem || "") === (tipo || "");
    });

  const groups = new Map();
  for (const v of candidatos) {
    const key = [
      v.transbordo_id || "manual",
      v.tipo || "",
      v.produto_id || "",
      v.cliente_id || "",
      (v.lote || "").trim(),
      v.destino_index ?? "",
    ].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }

  const toCreate = [];
  const toDeleteIds = [];

  for (const [, items] of groups) {
    const first = items[0];
    const transbordo = first.transbordo_id
      ? transbordoById.get(first.transbordo_id)
      : null;

    // Sempre remove os vasilhames unitários; cria estoque só se ainda não existir
    toDeleteIds.push(...items.map((v) => v.id));

    if (
      first.transbordo_id &&
      estoqueJaCobre(first.transbordo_id, first.destino_index, first.tipo)
    ) {
      continue;
    }

    const dens =
      parseDensidade(first.densidade) ||
      parseDensidade(transbordo?.densidade);
    const volumeTotal = roundVolume(
      items.reduce((s, v) => s + (Number(v.volume) || 0), 0)
    );
    const pesoTotal = roundMass(
      items.reduce((s, v) => s + (Number(v.peso_liquido) || 0), 0) ||
        (dens > 0 ? volumeTotal * dens : 0)
    );
    const qtdEmb = items.length;
    const pesoPorEmbalagem =
      qtdEmb > 0 ? roundMass(pesoTotal / qtdEmb) : pesoTotal;
    const tipoEmbalagem = first.tipo || "Tambor 200 L";

    let origemEstoque = null;
    let origem = null;
    let comp = [];
    if (transbordo) {
      const destinos = transbordo.destinos || [];
      const origens = transbordo.origens || [];
      const destinoIndex =
        first.destino_index != null
          ? first.destino_index
          : destinos.findIndex((d) => d.tipo_embalagem === tipoEmbalagem);
      const { destinoCompositions } = calculateFIFOAllocation(
        origens,
        destinos,
        dens
      );
      comp =
        destinoIndex >= 0 ? destinoCompositions[destinoIndex] || [] : [];
      ({ origem, estoque: origemEstoque } = resolveOrigemEstoque(
        comp,
        origens,
        estoqueById
      ));
    }

    const origemLote = origemEstoque?.lotes?.[0] || null;
    const lote =
      getDominantLote(
        items.flatMap((v) => v.composicao || [])
      ) ||
      first.lote ||
      origem?.lote ||
      origemEstoque?.lote ||
      "";

    const syntheticId = first.transbordo_id || first.id;
    const grupo = first.transbordo_id
      ? estoqueGrupoDoTransbordo(first.transbordo_id)
      : `TB-MIG:${syntheticId}`;

    const notaFiscal =
      origemEstoque?.nota_fiscal || origemLote?.nota_fiscal || null;
    const preco =
      Number(origemEstoque?.preco_unitario) ||
      Number(origemLote?.preco_unitario) ||
      0;

    const lotePayload = {
      lote,
      quantidade: pesoTotal,
      unidade_medida: "kg",
      densidade: first.densidade || transbordo?.densidade || "",
      embalado: true,
      peso_liquido: pesoPorEmbalagem,
      quantidade_embalagens: qtdEmb,
      nota_fiscal: notaFiscal,
      data_fabricacao:
        origemEstoque?.data_fabricacao || origemLote?.data_fabricacao || null,
      data_validade:
        origemEstoque?.data_validade || origemLote?.data_validade || null,
      preco_unitario: preco,
      tipo_embalagem: tipoEmbalagem,
      volume_total: volumeTotal,
      volume_por_embalagem:
        qtdEmb > 0 ? roundVolume(volumeTotal / qtdEmb) : volumeTotal,
      transbordo_id: first.transbordo_id || null,
      transbordo_codigo: first.numero_op || transbordo?.codigo_transbordo || "",
      destino_index: first.destino_index ?? null,
      migrado_de_vasilhame: true,
    };

    toCreate.push({
      entrada_id: null, // não vincula à entrada de origem
      entrada_codigo:
        origemEstoque?.entrada_codigo ||
        origem?.entrada_codigo ||
        first.numero_op ||
        "",
      grupo_entrada: grupo,
      cliente_id:
        nullIfEmpty(first.cliente_id) ||
        nullIfEmpty(origemEstoque?.cliente_id),
      cliente_nome: first.cliente_nome || origemEstoque?.cliente_nome || "",
      produto_id:
        nullIfEmpty(first.produto_id) ||
        nullIfEmpty(origemEstoque?.produto_id),
      produto_nome: first.produto_nome || origemEstoque?.produto_nome || "",
      produto_codigo:
        first.produto_codigo || origemEstoque?.produto_codigo || "",
      nota_fiscal: notaFiscal,
      lote,
      densidade: first.densidade || transbordo?.densidade || "",
      data_fabricacao: nullIfEmpty(
        origemEstoque?.data_fabricacao || origemLote?.data_fabricacao
      ),
      data_validade: nullIfEmpty(
        origemEstoque?.data_validade || origemLote?.data_validade
      ),
      quantidade: pesoTotal,
      unidade_medida: "kg",
      saldo_atual: pesoTotal,
      preco_unitario: preco,
      custo_total: roundMass(pesoTotal * preco),
      embalado: true,
      peso_liquido: pesoPorEmbalagem,
      quantidade_embalagens: qtdEmb,
      status_wms: false,
      origem: origemEstoque?.origem || "transbordo",
      lotes: [lotePayload],
    });
  }

  if (toCreate.length > 0) {
    await entities.estoque.bulkCreate(toCreate);
  }

  for (const id of toDeleteIds) {
    await entities.vasilhames.delete(id);
  }

  return {
    migratedGroups: toCreate.length,
    deletedVasilhames: toDeleteIds.length,
  };
}
