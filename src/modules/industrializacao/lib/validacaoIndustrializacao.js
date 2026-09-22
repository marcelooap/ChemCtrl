import { chemflowSupabase } from "@/services/supabase/chemflow";
import { base44 } from "@industrializacao/api/base44Client";
import { buildMpStockPayload } from "@industrializacao/lib/mpStockForm";
import { persistOperacaoFromValidacao, resumoQuantidadeValidacao } from "@transbordo/lib/validacaoTransbordo";
import { allocateMpEntryIds } from "@industrializacao/lib/allocateMpEntryId";
import {
  deleteEntradaLinkedToMp,
  granelPesagemFields,
  linkExistingEntradaToMp,
  upsertEntradaFromMp,
} from "@industrializacao/lib/syncMpEntradaTransbordo";

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

function asObject(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? v : null;
}

function resumoFromPayload(payload) {
  const data = asObject(payload) || payload || {};
  const lotes = Array.isArray(data?.lotes) && data.lotes.length
    ? data.lotes
    : data?.lote
      ? [data]
      : [];
  const first = lotes[0] || {};
  const quantidade = lotes.reduce((s, l) => s + (Number(l.quantidade) || 0), 0);
  return {
    lote: first.lote || data?.lote || "",
    quantidade,
    unidade_medida: first.unidade_medida || data?.unidade_medida || "",
  };
}

export function parseEntradaPayload(payload) {
  return asObject(payload) || payload || null;
}

export function isValidacaoIndEntrada(validacao) {
  return !validacao?.tipo || validacao.tipo === "entrada";
}

export function toValidacaoViewModel(validacao) {
  if (!validacao) return null;
  const tipo = validacao.tipo || "entrada";
  return {
    ...validacao,
    tipo,
    granel_payload: parseEntradaPayload(validacao.entrada_payload),
    transbordo_payload: parseEntradaPayload(validacao.transbordo_payload),
  };
}

export function resumoQuantidadeValidacaoInd(validacao) {
  if (isValidacaoIndEntrada(validacao)) {
    return resumoFromPayload(validacao?.entrada_payload);
  }
  return resumoQuantidadeValidacao(toValidacaoViewModel(validacao));
}

export function entradaPayloadToMpRows(payload) {
  const data = asObject(payload) || payload || {};
  const lotes = Array.isArray(data?.lotes) && data.lotes.length
    ? data.lotes
    : [];
  return lotes.map((lote) => {
    const tipo = lote.tipo_recebimento || (lote.embalado ? "embalado" : "");
    const qty = Number(lote.quantidade) || 0;
    const form = {
      mp_name: lote.produto_nome || data.produto_nome || "",
      mp_code: lote.produto_codigo || data.produto_codigo || "",
      client: data.cliente_nome || "",
      lot: lote.lote || "",
      nota_fiscal: lote.nota_fiscal || "",
      supplier: lote.fornecedor || data.fornecedor || "",
      unit: lote.unidade_medida || "kg",
      unit_price: lote.preco_unitario || 0,
      entry_date: data.data || null,
      manufacture_date: lote.data_fabricacao || data.data_fabricacao || "",
      expiry_date: lote.data_validade || data.data_validade || "",
      initial_stock: qty,
      current_stock: qty,
      density: parseFloat(lote.densidade) || 0,
      observations: "",
      tank_storage: false,
      tank_entries: [],
      packaging_type: tipo === "embalado" ? "embalado" : tipo === "vasilhame" ? "vasilhame" : "",
      packaging_capacity: tipo === "embalado" ? lote.peso_liquido || "" : "",
      packaging_quantity: tipo === "embalado" ? lote.quantidade_embalagens || 0 : 0,
      status_wms: !!data.status_wms,
    };
    return buildMpStockPayload(form, { isEditing: false });
  });
}

function mpRowsFromOperacao(validacao) {
  const granel = asObject(validacao?.entrada_payload) || validacao?.entrada_payload;
  const fromGranel = entradaPayloadToMpRows(granel);
  if (fromGranel.length > 0) return fromGranel;

  const transbordo = asObject(validacao?.transbordo_payload) || {};
  const view = toValidacaoViewModel(validacao);
  const resumo = resumoQuantidadeValidacaoInd(view);
  const origem = transbordo?.origens?.[0] || {};
  const qty = Number(resumo.quantidade) || Number(validacao?.quantidade) || 0;
  return [
    buildMpStockPayload(
      {
        mp_name: validacao?.produto_nome || transbordo?.produto_nome || "",
        mp_code: validacao?.produto_codigo || transbordo?.produto_codigo || "",
        client: validacao?.cliente_nome || transbordo?.cliente_nome || "",
        lot: validacao?.lote || origem.lote || "",
        nota_fiscal: origem.nota_fiscal || "",
        supplier: granel?.fornecedor || "",
        unit: resumo.unidade_medida || "kg",
        unit_price: 0,
        entry_date: validacao?.data || null,
        manufacture_date: granel?.data_fabricacao || "",
        expiry_date: granel?.data_validade || "",
        initial_stock: qty,
        current_stock: qty,
        density: transbordo?.densidade || "",
        observations: "",
        tank_storage: false,
        tank_entries: [],
        packaging_type: "",
        packaging_capacity: "",
        packaging_quantity: 0,
        status_wms: false,
      },
      { isEditing: false }
    ),
  ];
}

function isDuplicateMpEntryId(err) {
  const msg = String(err?.message || err || "");
  return (
    msg.includes("uq_ind_estoque_mp_entry_id") ||
    msg.includes("duplicate key")
  );
}

async function createMpStockRows(payloads, criadoPor) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const entryIds = await allocateMpEntryIds(
      base44.entities.RawMaterialStock,
      payloads.length,
      { offset: attempt * payloads.length }
    );
    const rows = payloads.map((row, i) => {
      const { id: _omitId, entry_id: _omitEntry, ...rest } = row;
      return {
        ...rest,
        entry_id: entryIds[i],
        created_by_id: criadoPor?.id ? String(criadoPor.id) : null,
      };
    });
    try {
      const created = await base44.entities.RawMaterialStock.bulkCreate(rows);
      return (created || []).map((row, i) => ({ ...rows[i], ...row }));
    } catch (err) {
      lastErr = err;
      if (!isDuplicateMpEntryId(err) || attempt === 3) throw err;
    }
  }
  throw lastErr;
}

async function rollbackMpRows(rows) {
  for (const row of rows || []) {
    if (!row?.id) continue;
    try {
      await deleteEntradaLinkedToMp(row.id);
    } catch (err) {
      console.error("[validacaoIndustrializacao] rollback entrada:", err);
    }
    try {
      await base44.entities.RawMaterialStock.delete(row.id);
    } catch (err) {
      console.error("[validacaoIndustrializacao] rollback mp:", err);
    }
  }
}

export async function criarValidacaoIndustrializacao({
  tipo = "entrada",
  header,
  origemTipo,
  entradaPayload = null,
  granelPayload = null,
  transbordoPayload = null,
  criadoPor = null,
}) {
  const granel = granelPayload || entradaPayload;
  if ((tipo === "entrada" || tipo === "granel_transbordo") && !granel) {
    throw new Error("entradaPayload obrigatório");
  }
  if (tipo === "transbordo" && !transbordoPayload) {
    throw new Error("transbordoPayload obrigatório");
  }

  const view = {
    tipo,
    origem_tipo: origemTipo,
    granel_payload: granel,
    transbordo_payload: transbordoPayload,
  };
  const resumo = isValidacaoIndEntrada(view)
    ? resumoFromPayload(granel)
    : resumoQuantidadeValidacao(view);
  const lote =
    (tipo === "entrada" || tipo === "granel_transbordo") && granel
      ? granel.lote || granel.lotes?.[0]?.lote || resumo.lote
      : transbordoPayload?.origens?.[0]?.lote || resumo.lote || "";

  return base44.entities.IndValidacao.create({
    tipo,
    status: "pendente",
    data: header?.data || granel?.data || transbordoPayload?.data || null,
    cliente_nome:
      header?.cliente_nome || granel?.cliente_nome || transbordoPayload?.cliente_nome || null,
    produto_nome:
      header?.produto_nome || granel?.produto_nome || transbordoPayload?.produto_nome || null,
    produto_codigo:
      header?.produto_codigo || granel?.produto_codigo || transbordoPayload?.produto_codigo || null,
    lote: lote || null,
    quantidade: resumo.quantidade || 0,
    unidade_medida: resumo.unidade_medida || null,
    origem_tipo: origemTipo || null,
    entrada_payload: granel,
    transbordo_payload: transbordoPayload,
    criado_por_id: criadoPor?.id ? String(criadoPor.id) : null,
    criado_por_nome: criadoPor?.nome || null,
  });
}

export async function atualizarValidacaoIndustrializacao({
  id,
  entradaPayload,
  transbordoPayload,
}) {
  if (!id) throw new Error("id obrigatório");
  const atual = await base44.entities.IndValidacao.get(id);
  if (!atual) throw new Error("Validação não encontrada");
  if (atual.status !== "pendente") {
    throw new Error("Não é possível editar uma validação já processada");
  }

  const nextEntrada =
    entradaPayload !== undefined
      ? entradaPayload
      : parseEntradaPayload(atual.entrada_payload);
  const nextTransbordo =
    transbordoPayload !== undefined
      ? transbordoPayload
      : parseEntradaPayload(atual.transbordo_payload);

  const view = toValidacaoViewModel({
    ...atual,
    entrada_payload: nextEntrada,
    transbordo_payload: nextTransbordo,
  });
  const resumo = resumoQuantidadeValidacaoInd(view);
  const lote =
    (atual.tipo === "entrada" || atual.tipo === "granel_transbordo") && nextEntrada
      ? nextEntrada.lote || nextEntrada.lotes?.[0]?.lote || resumo.lote
      : nextTransbordo?.origens?.[0]?.lote || resumo.lote || atual.lote;

  return base44.entities.IndValidacao.update(id, {
    entrada_payload: nextEntrada,
    transbordo_payload: nextTransbordo,
    data:
      nextTransbordo?.data ||
      nextEntrada?.data ||
      atual.data ||
      null,
    cliente_nome:
      nextTransbordo?.cliente_nome ||
      nextEntrada?.cliente_nome ||
      atual.cliente_nome,
    produto_nome:
      nextTransbordo?.produto_nome ||
      nextEntrada?.produto_nome ||
      atual.produto_nome,
    produto_codigo:
      nextTransbordo?.produto_codigo ||
      nextEntrada?.produto_codigo ||
      atual.produto_codigo,
    lote: resumo.lote || atual.lote || null,
    quantidade: resumo.quantidade || 0,
    unidade_medida: resumo.unidade_medida || null,
  });
}

export async function excluirValidacaoIndustrializacao(id) {
  const atual = await base44.entities.IndValidacao.get(id);
  if (!atual) return true;
  if (atual.status !== "pendente") {
    throw new Error("Apenas validações pendentes podem ser excluídas");
  }
  return base44.entities.IndValidacao.delete(id);
}

export async function efetivarValidacaoIndustrializacao({ id, validadoPor = null }) {
  if (!id) throw new Error("id obrigatório");
  if (!chemflowSupabase) throw new Error("Supabase não configurado");

  const { data: locked, error: lockError } = await chemflowSupabase
    .from("ind_validacoes")
    .update({ status: "processando" })
    .eq("id", id)
    .eq("status", "pendente")
    .select()
    .maybeSingle();

  if (lockError) throw new Error(lockError.message);
  if (!locked) {
    const atual = await base44.entities.IndValidacao.get(id);
    if (atual?.status === "validado") {
      throw new Error("Esta validação já foi processada anteriormente.");
    }
    throw new Error("Esta validação está sendo processada por outra sessão.");
  }

  try {
    const transbordoInformado = asObject(locked.transbordo_payload);
    const granelOrigem = asObject(locked.entrada_payload);
    const materiaPrima =
      granelOrigem?.origem === "industrializacao" || !transbordoInformado;
    if (isValidacaoIndEntrada(locked) || materiaPrima) {
      if (!locked.entrada_payload) {
        throw new Error("entrada_payload ausente na validação");
      }
      const payload = asObject(locked.entrada_payload) || locked.entrada_payload;
      const mapped = entradaPayloadToMpRows(payload);
      if (mapped.length === 0) {
        throw new Error("Nenhum lote para registrar no estoque de MP.");
      }
      const mpRows = await createMpStockRows(mapped, validadoPor);
      const pesagem = granelPesagemFields(payload);
      try {
        for (const row of mpRows) {
          await upsertEntradaFromMp(pesagem ? { ...row, ...pesagem } : row);
        }
      } catch (syncErr) {
        await rollbackMpRows(mpRows);
        throw syncErr;
      }
      const ids = mpRows.map((r) => r.id).filter(Boolean);

      return base44.entities.IndValidacao.update(id, {
        status: "validado",
        estoque_mp_ids: ids,
        validado_por_id: validadoPor?.id ? String(validadoPor.id) : null,
        validado_por_nome: validadoPor?.nome || null,
        validado_em: new Date().toISOString(),
      });
    }

    const mpRows = await createMpStockRows(mpRowsFromOperacao(locked), validadoPor);

    const granel = asObject(locked.entrada_payload) || locked.entrada_payload;
    let persisted = null;
    try {
      persisted = await persistOperacaoFromValidacao({
        tipo: locked.tipo,
        granelPayload: granel
          ? { ...granel, origem: "industrializacao" }
          : null,
        transbordoPayload:
          asObject(locked.transbordo_payload) || locked.transbordo_payload,
      });
      if (persisted?.entradaId) {
        await linkExistingEntradaToMp(persisted.entradaId, mpRows);
      } else {
        for (const row of mpRows) {
          await upsertEntradaFromMp(row);
        }
      }
    } catch (syncErr) {
      if (!persisted) {
        await rollbackMpRows(mpRows);
        throw syncErr;
      }
      console.error("[validacaoIndustrializacao] espelho entrada:", syncErr);
    }

    return base44.entities.IndValidacao.update(id, {
      status: "validado",
      estoque_mp_ids: mpRows.map((r) => r.id).filter(Boolean),
      entrada_id: persisted.entradaId ? String(persisted.entradaId) : null,
      transbordo_id: persisted.transbordoId ? String(persisted.transbordoId) : null,
      transbordo_payload: persisted.transbordoPayload,
      validado_por_id: validadoPor?.id ? String(validadoPor.id) : null,
      validado_por_nome: validadoPor?.nome || null,
      validado_em: new Date().toISOString(),
    });
  } catch (err) {
    try {
      await chemflowSupabase
        .from("ind_validacoes")
        .update({ status: "pendente" })
        .eq("id", id)
        .eq("status", "processando");
    } catch (rollbackErr) {
      console.error("[validacaoIndustrializacao] rollback:", rollbackErr);
    }
    throw err;
  }
}

export { nullIfEmpty };
