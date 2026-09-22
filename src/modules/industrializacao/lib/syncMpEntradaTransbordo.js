import { entities } from "@transbordo/services/entities";
import { createEntradaCompleta } from "@transbordo/lib/createEntradaCompleta";
import { syncEntradaEstoqueCascade } from "@transbordo/lib/cascadeEntradaUpdate";
import {
  loteQuantidadeEstoque,
  loteUnidadeEstoque,
} from "@transbordo/lib/conversao";
import { base44 } from "@industrializacao/api/base44Client";

const LINK_PREFIX = "INDMP:";

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function mpEntradaGrupo(mpId) {
  return `${LINK_PREFIX}${mpId}`;
}

const GRANEL_PESAGEM_KEYS = [
  "granel_ticket",
  "granel_peso_bruto",
  "granel_validacao_bruto",
  "granel_peso_liquido",
  "granel_validacao_liquido",
  "granel_erro_admissivel",
  "granel_peso_minimo",
  "granel_peso_maximo",
  "granel_margem",
];

function hasPesagemInformada(source) {
  if (!source) return false;
  if (source.granel_pesagem) return true;
  return GRANEL_PESAGEM_KEYS.some((key) => {
    const value = source[key];
    return value != null && value !== "";
  });
}

/** Campos de pesagem do recebimento granel, prontos para gravar na entrada. */
export function granelPesagemFields(source) {
  if (!hasPesagemInformada(source)) return null;
  const fields = { granel_pesagem: true };
  for (const key of GRANEL_PESAGEM_KEYS) {
    const value = source[key];
    if (value != null && value !== "") fields[key] = value;
  }
  return fields;
}

function mpIdFromEntrada(entrada) {
  const grupo = String(entrada?.grupo_entrada || "");
  if (grupo.startsWith(LINK_PREFIX)) return grupo.slice(LINK_PREFIX.length);
  const lote = (entrada?.lotes || []).find((item) => item?.ind_mp_id);
  return lote?.ind_mp_id || null;
}

function parseIdList(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function asPayload(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? value : null;
}

function mpToLote(mp) {
  const packaging = String(mp?.packaging_type || "").toLowerCase();
  const embalado = packaging === "embalado";
  const qty = Number(mp?.initial_stock) || 0;
  return {
    produto_nome: mp?.mp_name || "",
    produto_codigo: mp?.mp_code || "",
    nota_fiscal: mp?.nota_fiscal || "",
    lote: mp?.lot || "",
    densidade:
      mp?.density != null && mp.density !== "" ? String(mp.density) : "",
    quantidade: qty,
    unidade_medida: mp?.unit || "kg",
    data_fabricacao: nullIfEmpty(mp?.manufacture_date),
    data_validade: nullIfEmpty(mp?.expiry_date),
    preco_unitario: Number(mp?.unit_price) || 0,
    embalado,
    peso_liquido: embalado ? mp?.packaging_capacity || null : null,
    quantidade_embalagens: embalado ? mp?.packaging_quantity || null : null,
    tipo_recebimento:
      packaging === "embalado"
        ? "embalado"
        : packaging === "vasilhame"
          ? "vasilhame"
          : "granel",
    ind_mp_id: mp?.id || null,
  };
}

function mpToEntradaFields(mp) {
  const lote = mpToLote(mp);
  const qty = Number(lote.quantidade) || 0;
  const preco = Number(lote.preco_unitario) || 0;
  return {
    data: mp?.entry_date || todayISO(),
    cliente_id: null,
    cliente_nome: mp?.client || "",
    produto_id: null,
    produto_nome: lote.produto_nome,
    produto_codigo: lote.produto_codigo,
    nota_fiscal: lote.nota_fiscal,
    lote: lote.lote,
    densidade: lote.densidade,
    data_fabricacao: lote.data_fabricacao,
    data_validade: lote.data_validade,
    quantidade: qty,
    unidade_medida: lote.unidade_medida,
    preco_unitario: preco,
    custo_total: qty * preco,
    saldo_atual: Number(mp?.current_stock ?? qty) || 0,
    embalado: lote.embalado,
    peso_liquido: lote.peso_liquido,
    quantidade_embalagens: lote.quantidade_embalagens,
    status_wms: !!mp?.status_wms,
    fornecedor: nullIfEmpty(mp?.supplier),
    origem: "industrializacao",
    grupo_entrada: mpEntradaGrupo(mp.id),
    lotes: [lote],
    ...(granelPesagemFields(mp) || {}),
  };
}

function estoqueFromLote(lote, { entradaId, entradaCodigo, grupo, statusWms, clienteNome }) {
  const loteQtd = loteQuantidadeEstoque(lote);
  const lotePreco = Number(lote.preco_unitario) || 0;
  return {
    entrada_id: entradaId,
    entrada_codigo: entradaCodigo || null,
    grupo_entrada: grupo,
    cliente_id: null,
    cliente_nome: clienteNome || "",
    produto_id: null,
    produto_nome: lote.produto_nome || "",
    produto_codigo: lote.produto_codigo || "",
    nota_fiscal: lote.nota_fiscal || "",
    lote: lote.lote || "",
    densidade: lote.densidade || "",
    data_fabricacao: nullIfEmpty(lote.data_fabricacao),
    data_validade: nullIfEmpty(lote.data_validade),
    quantidade: loteQtd,
    unidade_medida: loteUnidadeEstoque(lote),
    saldo_atual: loteQtd,
    preco_unitario: lotePreco,
    custo_total: loteQtd * lotePreco,
    embalado: !!lote.embalado,
    peso_liquido: lote.peso_liquido ?? null,
    quantidade_embalagens: lote.quantidade_embalagens ?? null,
    status_wms: !!statusWms,
    origem: "industrializacao",
    lotes: [lote],
  };
}

function sortByCreated(rows) {
  return [...(rows || [])].sort((a, b) => {
    const da = new Date(a.created_at || a.created_date || 0).getTime();
    const db = new Date(b.created_at || b.created_date || 0).getTime();
    return da - db;
  });
}

async function findLinkedEntrada(mpId) {
  const byGrupo = await entities.entradas.filter({
    grupo_entrada: mpEntradaGrupo(mpId),
  });
  if (byGrupo[0]) return { entrada: byGrupo[0], scope: "entrada" };

  const industriais = await entities.entradas.filter({
    origem: "industrializacao",
  });
  const shared = (industriais || []).find((entrada) =>
    (entrada.lotes || []).some((lote) => lote?.ind_mp_id === mpId)
  );
  if (shared) return { entrada: shared, scope: "lote" };
  return null;
}

async function createEntradaFromMp(mp) {
  const data = mpToEntradaFields(mp);
  return createEntradaCompleta({ data, produtos: [] });
}

async function updateWholeEntrada(entrada, mp) {
  const fields = mpToEntradaFields(mp);
  await entities.entradas.update(entrada.id, fields);
  const existing = sortByCreated(
    await entities.estoque.filter({ entrada_id: entrada.id })
  );
  const codigo = existing[0]?.entrada_codigo || "";
  const estoqueRecords = fields.lotes.map((lote) =>
    estoqueFromLote(lote, {
      entradaId: entrada.id,
      entradaCodigo: codigo,
      grupo: fields.grupo_entrada,
      statusWms: fields.status_wms,
      clienteNome: fields.cliente_nome,
    })
  );
  await syncEntradaEstoqueCascade({
    entradaId: entrada.id,
    estoqueRecords,
  });
  return entrada;
}

async function updateLoteEntrada(entrada, mp) {
  const lote = mpToLote(mp);
  const lotes = (entrada.lotes || []).map((item) =>
    item?.ind_mp_id === mp.id ? { ...item, ...lote } : item
  );
  const first = lotes[0] || lote;
  await entities.entradas.update(entrada.id, {
    origem: "industrializacao",
    lotes,
    produto_nome: first.produto_nome || entrada.produto_nome,
    produto_codigo: first.produto_codigo || entrada.produto_codigo,
    cliente_nome: mp.client || entrada.cliente_nome,
    nota_fiscal: first.nota_fiscal ?? entrada.nota_fiscal,
    lote: first.lote ?? entrada.lote,
    densidade: first.densidade ?? entrada.densidade,
    quantidade: Number(first.quantidade) || entrada.quantidade,
    unidade_medida: first.unidade_medida || entrada.unidade_medida,
    data: mp.entry_date || entrada.data,
  });

  const estoques = sortByCreated(
    await entities.estoque.filter({ entrada_id: entrada.id })
  );
  const match =
    estoques.find((row) => row?.lotes?.[0]?.ind_mp_id === mp.id) || null;
  if (!match) return entrada;
  const patch = estoqueFromLote(lote, {
    entradaId: entrada.id,
    entradaCodigo: match.entrada_codigo,
    grupo: match.grupo_entrada || entrada.grupo_entrada,
    statusWms: mp.status_wms,
    clienteNome: mp.client || entrada.cliente_nome,
  });
  await entities.estoque.update(match.id, patch);
  return entrada;
}

async function findValidacaoRow(entrada) {
  const lote = entrada?.lote || entrada?.lotes?.[0]?.lote || "";
  const mpId = mpIdFromEntrada(entrada);
  let rows = [];
  if (lote) {
    rows = await base44.entities.IndValidacao.filter({
      lote,
      status: "validado",
    });
  }
  const list = rows || [];
  const byMp = mpId
    ? list.find((row) => parseIdList(row?.estoque_mp_ids).includes(String(mpId)))
    : null;
  return (
    byMp ||
    list.find(
      (row) =>
        row?.produto_codigo &&
        entrada?.produto_codigo &&
        row.produto_codigo === entrada.produto_codigo &&
        row.cliente_nome === entrada.cliente_nome
    ) ||
    null
  );
}

function destinosInformadosFromValidacao(row) {
  const transbordo = asPayload(row?.transbordo_payload);
  return Array.isArray(transbordo?.destinos) ? transbordo.destinos : [];
}

/**
 * Entradas de matéria-prima já gravadas sem a pesagem do recebimento granel.
 * Recupera os pesos na validação e grava na entrada e no estoque.
 */
export async function backfillEntradaPesagem(entrada, validacaoRow = undefined) {
  if (!entrada?.id || entrada.origem !== "industrializacao") return entrada;
  if (granelPesagemFields(entrada)) return entrada;

  const row = validacaoRow === undefined ? await findValidacaoRow(entrada) : validacaoRow;
  const payload = asPayload(row?.entrada_payload);
  const pesagem = granelPesagemFields(payload);
  if (!pesagem) return entrada;

  await entities.entradas.update(entrada.id, pesagem);
  const estoques = await entities.estoque.filter({ entrada_id: entrada.id });
  await Promise.all(
    (estoques || [])
      .filter((row) => row?.id && !granelPesagemFields(row))
      .map((row) => entities.estoque.update(row.id, pesagem))
  );
  return { ...entrada, ...pesagem };
}

/** Pesagem e destinos informados na ordem, para a visualização da entrada. */
export async function prepareEntradaView(entrada) {
  if (!entrada?.id || entrada.origem !== "industrializacao") {
    return { entrada, destinosInformados: [] };
  }
  const row = await findValidacaoRow(entrada);
  const enriched = await backfillEntradaPesagem(entrada, row);
  return {
    entrada: enriched,
    destinosInformados: destinosInformadosFromValidacao(row),
  };
}

/** Cria ou atualiza a entrada do Transbordo espelhada neste registro de MP. */
export async function upsertEntradaFromMp(mp) {
  if (!mp?.id) return null;
  const linked = await findLinkedEntrada(mp.id);
  if (!linked) return createEntradaFromMp(mp);
  if (linked.scope === "lote") return updateLoteEntrada(linked.entrada, mp);
  return updateWholeEntrada(linked.entrada, mp);
}

async function deleteEntradaRecord(entradaId) {
  await entities.estoque.deleteMany({ entrada_id: entradaId });
  await entities.entradas.delete(entradaId);
}

/** Remove a entrada (ou o lote) do Transbordo ligado a este MP. */
export async function deleteEntradaLinkedToMp(mpId) {
  if (!mpId) return;
  const linked = await findLinkedEntrada(mpId);
  if (!linked) return;

  if (linked.scope === "entrada") {
    await deleteEntradaRecord(linked.entrada.id);
    return;
  }

  const lotes = (linked.entrada.lotes || []).filter(
    (lote) => lote?.ind_mp_id !== mpId
  );
  const estoques = await entities.estoque.filter({
    entrada_id: linked.entrada.id,
  });
  const match = (estoques || []).find(
    (row) => row?.lotes?.[0]?.ind_mp_id === mpId
  );
  if (match?.id) await entities.estoque.delete(match.id);

  if (lotes.length === 0) {
    await deleteEntradaRecord(linked.entrada.id);
    return;
  }

  const first = lotes[0];
  await entities.entradas.update(linked.entrada.id, {
    lotes,
    produto_nome: first.produto_nome || linked.entrada.produto_nome,
    produto_codigo: first.produto_codigo || linked.entrada.produto_codigo,
    nota_fiscal: first.nota_fiscal ?? linked.entrada.nota_fiscal,
    lote: first.lote ?? linked.entrada.lote,
    quantidade: Number(first.quantidade) || 0,
    unidade_medida: first.unidade_medida || linked.entrada.unidade_medida,
  });
}

/**
 * Amarra a entrada já criada na validação (granel) aos registros de MP.
 * Uma MP vira a entrada inteira; várias MPs ficam como lotes da mesma entrada.
 */
export async function linkExistingEntradaToMp(entradaId, mpRows) {
  if (!entradaId || !mpRows?.length) return null;
  const entrada = await entities.entradas.get(entradaId);
  if (!entrada) return null;

  const baseLotes =
    Array.isArray(entrada.lotes) && entrada.lotes.length
      ? entrada.lotes
      : mpRows.map((mp) => mpToLote(mp));
  const lotes = baseLotes.map((lote, index) => ({
    ...lote,
    ind_mp_id: mpRows[index]?.id || lote?.ind_mp_id || null,
  }));

  const patch = {
    origem: "industrializacao",
    lotes,
  };
  if (mpRows.length === 1 && mpRows[0]?.id) {
    patch.grupo_entrada = mpEntradaGrupo(mpRows[0].id);
  }
  await entities.entradas.update(entradaId, patch);

  const estoques = sortByCreated(
    await entities.estoque.filter({ entrada_id: entradaId })
  );
  const updates = estoques.map((row, index) => ({
    id: row.id,
    origem: "industrializacao",
    ...(mpRows.length === 1 && mpRows[0]?.id
      ? { grupo_entrada: mpEntradaGrupo(mpRows[0].id) }
      : {}),
    lotes: [
      {
        ...(row.lotes?.[0] || lotes[index] || {}),
        ind_mp_id: mpRows[index]?.id || row.lotes?.[0]?.ind_mp_id || null,
      },
    ],
  }));
  if (updates.length > 0) await entities.estoque.bulkUpdate(updates);
  return entrada;
}
