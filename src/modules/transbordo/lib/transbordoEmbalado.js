/**
 * Helpers de destinos unitários (IBC / Bombona / Tambor).
 * Esses tipos passam a gerar registro em Vasilhames (não no Estoque).
 * Funções de estoque embalado legado são mantidas para compatibilidade.
 */

import { roundMass, roundVolume, parseDensidade } from "@transbordo/lib/format";
import { calculateFIFOAllocation } from "@transbordo/lib/fifo";
import { getDominantLote } from "@transbordo/lib/vasilhameComposicao";
import { entities } from "@transbordo/services/entities";
import {
  isDestinoEstoqueEmbalado,
  isVasilhameLegadoEmbalado,
  buildPlacaEmbalagens,
  getQuantidadeEmbalagensFromVasilhame,
  VOLUME_PADRAO_EMBALAGEM,
} from "@transbordo/lib/tiposEmbalagem";

export {
  TIPOS_EMBALAGEM_DESTINO,
  TIPOS_EMBALAGEM_ESTOQUE,
  TIPOS_NAO_VASILHAME,
  VOLUME_PADRAO_EMBALAGEM,
  isDestinoEstoqueEmbalado,
  isDestinoEmbalagemUnitaria,
  isVasilhameLegadoEmbalado,
  labelTipoEmbalagem,
  buildPlacaEmbalagens,
  getQuantidadeEmbalagensFromVasilhame,
  getVolumePorEmbalagemFromVasilhame,
} from "@transbordo/lib/tiposEmbalagem";


/** Chave estável para localizar/apagar estoque gerado por um transbordo. */
export function estoqueGrupoDoTransbordo(transbordoId) {
  return `TB:${transbordoId}`;
}

/** Identifica estoque gerado por destino unitário (bombona/tambor/IBC). */
export function isEstoqueEmbalagemUnitaria(estoqueItem) {
  if (!estoqueItem?.embalado) return false;
  const lote = estoqueItem.lotes?.[0] || {};
  const tipo = lote.tipo_embalagem || estoqueItem.tipo_embalagem || "";
  if (isDestinoEstoqueEmbalado(tipo) || isVasilhameLegadoEmbalado(tipo)) {
    return true;
  }
  const grupo = String(estoqueItem.grupo_entrada || "");
  // Estoque criado por OP de transbordo (TB:uuid) com qtd de embalagens
  if (
    grupo.startsWith("TB:") &&
    (Number(estoqueItem.quantidade_embalagens) > 0 ||
      Number(lote.quantidade_embalagens) > 0)
  ) {
    return true;
  }
  return false;
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
 * Desativada: embalagens unitárias passam a permanecer em Vasilhames.
 */
export async function migrateVasilhamesEmbaladosParaEstoque() {
  return { migratedGroups: 0, deletedVasilhames: 0, skipped: true };
}

/**
 * Move bombonas/tambores/IBC do Estoque Embalado para a tela de Vasilhames
 * e remove os registros correspondentes do estoque.
 */
export async function migrateEstoqueEmbaladoParaVasilhames() {
  const [estoqueList, vasilhames, transbordos] = await Promise.all([
    entities.estoque.list(),
    entities.vasilhames.list(),
    entities.transbordos.list(),
  ]);

  const candidatos = (estoqueList || []).filter(isEstoqueEmbalagemUnitaria);
  if (candidatos.length === 0) {
    return { migrated: 0, deletedEstoque: 0 };
  }

  const transbordoById = new Map((transbordos || []).map((t) => [t.id, t]));
  const existingKeys = new Set(
    (vasilhames || []).map((v) => {
      const tid = v.transbordo_id || "";
      const di = v.destino_index ?? "";
      const tipo = v.tipo || "";
      return `${tid}|${di}|${tipo}|${v.placa || ""}`;
    })
  );

  const toCreate = [];
  const toDeleteIds = [];

  for (const e of candidatos) {
    const lote = e.lotes?.[0] || {};
    const tipo =
      lote.tipo_embalagem ||
      e.tipo_embalagem ||
      "Bombona de 200 L";
    const qtdEmb = Math.max(
      1,
      Math.round(
        Number(e.quantidade_embalagens) ||
          Number(lote.quantidade_embalagens) ||
          0
      ) || 1
    );
    const volPorEmb = roundVolume(
      lote.volume_por_embalagem ||
        VOLUME_PADRAO_EMBALAGEM[tipo] ||
        0
    );
    const dens =
      parseDensidade(e.densidade) ||
      parseDensidade(lote.densidade);
    const volumeTotal = roundVolume(
      lote.volume_total ||
        (volPorEmb > 0 ? qtdEmb * volPorEmb : 0) ||
        (dens > 0 ? (Number(e.quantidade) || 0) / dens : 0)
    );
    const pesoTotal =
      dens > 0
        ? roundMass(volumeTotal * dens)
        : roundMass(
            (Number(e.peso_liquido) || 0) * qtdEmb ||
              Number(e.quantidade) ||
              0
          );

    const transbordoId =
      lote.transbordo_id ||
      (String(e.grupo_entrada || "").startsWith("TB:")
        ? e.grupo_entrada.slice(3)
        : null);
    const transbordo = transbordoId
      ? transbordoById.get(transbordoId)
      : null;
    const codigo =
      lote.transbordo_codigo ||
      transbordo?.codigo_transbordo ||
      e.entrada_codigo ||
      "EMB";
    const destinoIndex =
      lote.destino_index != null ? lote.destino_index : null;
    const placa = buildPlacaEmbalagens(qtdEmb, tipo);
    const key = `${transbordoId || ""}|${destinoIndex ?? ""}|${tipo}|${placa}`;

    toDeleteIds.push(e.id);

    // Já existe vasilhame correspondente → só remove estoque
    if (existingKeys.has(key)) continue;
    const alreadySameOp = (vasilhames || []).some(
      (v) =>
        v.transbordo_id &&
        transbordoId &&
        v.transbordo_id === transbordoId &&
        (v.destino_index == null ||
          destinoIndex == null ||
          Number(v.destino_index) === Number(destinoIndex)) &&
        isDestinoEstoqueEmbalado(v.tipo || "")
    );
    if (alreadySameOp) continue;

    const pesoPorEmb =
      qtdEmb > 0 ? roundMass(pesoTotal / qtdEmb) : pesoTotal;

    toCreate.push({
      codigo,
      transbordo_id: nullIfEmpty(transbordoId),
      origem: "transbordo",
      numero_op: codigo,
      placa,
      barril: "",
      tipo,
      produto_id: nullIfEmpty(e.produto_id),
      produto_nome: e.produto_nome || "",
      produto_codigo: e.produto_codigo || "",
      cliente_id: nullIfEmpty(e.cliente_id),
      cliente_nome: e.cliente_nome || "",
      lote: e.lote || lote.lote || "",
      densidade: e.densidade || lote.densidade || "",
      volume: volumeTotal,
      tara: 0,
      peso_liquido: pesoTotal,
      peso_bruto: pesoTotal,
      lacres: "",
      eslinga: "",
      gps: "",
      menor_teste: null,
      status: Number(e.saldo_atual) > 0 ? "No Pátio" : "Expedido",
      data_saida: Number(e.saldo_atual) > 0 ? null : null,
      responsavel: "",
      fracionado: false,
      composicao: [
        {
          lote: e.lote || lote.lote || "",
          quantidade_l: volumeTotal,
          quantidade_kg: pesoTotal,
          quantidade_embalagens: qtdEmb,
          volume_por_embalagem: volPorEmb || pesoPorEmb,
          peso_liquido_embalagem: pesoPorEmb,
          transbordo_codigo: codigo,
          data: null,
        },
      ],
      destino_index: destinoIndex,
    });
    existingKeys.add(key);
  }

  if (toCreate.length > 0) {
    await entities.vasilhames.bulkCreate(toCreate);
  }

  for (const id of toDeleteIds) {
    await entities.estoque.delete(id);
  }

  return {
    migrated: toCreate.length,
    deletedEstoque: toDeleteIds.length,
  };
}

/**
 * Normaliza bombona/tambor/IBC já registrados:
 * - Nº Barril vazio (exibe "—")
 * - Placa no padrão "04 x Bombonas de 200 L"
 */
export async function normalizeBarrilEmbalagensUnitarias() {
  const list = await entities.vasilhames.list();
  const toFix = [];

  for (const v of list || []) {
    if (!isDestinoEstoqueEmbalado(v.tipo || "")) continue;

    const qtd = getQuantidadeEmbalagensFromVasilhame(v);
    const placaEsperada = buildPlacaEmbalagens(
      qtd > 0 ? qtd : 1,
      v.tipo
    );

    const barrilSujo =
      v.barril != null && String(v.barril).trim() !== "";
    const placaErrada = String(v.placa || "") !== placaEsperada;

    if (!barrilSujo && !placaErrada) continue;

    toFix.push({
      id: v.id,
      ...(barrilSujo ? { barril: "" } : {}),
      ...(placaErrada ? { placa: placaEsperada } : {}),
    });
  }

  if (toFix.length === 0) {
    return { updated: 0 };
  }

  await entities.vasilhames.bulkUpdate(toFix);
  return { updated: toFix.length };
}

/**
 * Vasilhames criados pela tela de Entrada usavam "E003-V1".
 * Normaliza para somente o ID da entrada: "E003".
 */
export async function normalizeCodigoVasilhamesEntrada() {
  const list = await entities.vasilhames.list();
  const toFix = [];

  for (const v of list || []) {
    const codigo = String(v.codigo || "").trim();
    const m = codigo.match(/^(E\d+)-V\d+$/i);
    if (!m) continue;
    // Preferencialmente origem manual (entrada) ou composição com entrada_id
    const fromEntrada =
      v.origem === "manual" ||
      (v.composicao || []).some((c) => c.entrada_id || c.entrada_codigo);
    if (!fromEntrada && v.origem === "transbordo") continue;

    toFix.push({ id: v.id, codigo: m[1].toUpperCase() });
  }

  if (toFix.length === 0) return { updated: 0 };
  await entities.vasilhames.bulkUpdate(toFix);
  return { updated: toFix.length };
}
