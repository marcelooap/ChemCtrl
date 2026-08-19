import { chemflowSupabase } from "@/services/supabase/chemflow";
import { base44 } from "@industrializacao/api/base44Client";
import { buildMpStockPayload } from "@industrializacao/lib/mpStockForm";
import { persistOperacaoFromValidacao, resumoQuantidadeValidacao } from "@transbordo/lib/validacaoTransbordo";
import { allocateMpEntryIds } from "@industrializacao/lib/allocateMpEntryId";

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
      supplier: "",
      unit: lote.unidade_medida || "kg",
      unit_price: lote.preco_unitario || 0,
      entry_date: data.data || null,
      manufacture_date: lote.data_fabricacao || "",
      expiry_date: lote.data_validade || "",
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
  if (tipo === "entrada" && !granel) {
    throw new Error("entradaPayload obrigatório");
  }
  if (tipo !== "entrada" && !transbordoPayload) {
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
    if (isValidacaoIndEntrada(locked)) {
      if (!locked.entrada_payload) {
        throw new Error("entrada_payload ausente na validação");
      }
      const payload = asObject(locked.entrada_payload) || locked.entrada_payload;
      const mapped = entradaPayloadToMpRows(payload);
      if (mapped.length === 0) {
        throw new Error("Nenhum lote para registrar no estoque de MP.");
      }
      const entryIds = await allocateMpEntryIds(
        base44.entities.RawMaterialStock,
        mapped.length
      );
      const rows = mapped.map((row, i) => {
        const { id: _omitId, ...rest } = row;
        return {
          ...rest,
          entry_id: entryIds[i],
          created_by_id: validadoPor?.id ? String(validadoPor.id) : null,
        };
      });
      const created = await base44.entities.RawMaterialStock.bulkCreate(rows);
      const ids = (created || []).map((r) => r.id).filter(Boolean);

      return base44.entities.IndValidacao.update(id, {
        status: "validado",
        estoque_mp_ids: ids,
        validado_por_id: validadoPor?.id ? String(validadoPor.id) : null,
        validado_por_nome: validadoPor?.nome || null,
        validado_em: new Date().toISOString(),
      });
    }

    const persisted = await persistOperacaoFromValidacao({
      tipo: locked.tipo,
      granelPayload: asObject(locked.entrada_payload) || locked.entrada_payload,
      transbordoPayload:
        asObject(locked.transbordo_payload) || locked.transbordo_payload,
    });

    return base44.entities.IndValidacao.update(id, {
      status: "validado",
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
