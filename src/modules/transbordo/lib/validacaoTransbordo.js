import { chemflowSupabase } from "@/services/supabase/chemflow";
import { entities } from "@transbordo/services/entities";
import { createGranelEntrada } from "@transbordo/lib/createGranelEntrada";
import { createEntradaCompleta } from "@transbordo/lib/createEntradaCompleta";
import { persistTransbordo } from "@transbordo/lib/persistTransbordo";
import {
  getLoteQuantidadeDeclarada,
  kgToLoteUnidade,
} from "@transbordo/lib/conversao";
import { listTankas } from "@transbordo/lib/cadastroTankaCentral";

/**
 * Validação de operações vindas da Ordem de Transbordo.
 *
 * A tela `Painel → Ordem de Transbordo` grava aqui um registro "pendente".
 * A tela `Transbordo → Validação` confere, edita e valida — só nesse momento
 * o sistema roda os fluxos existentes (createGranelEntrada / persistTransbordo).
 *
 * Idempotência:
 *   Antes de efetivar, movemos o status "pendente" → "processando" em UM
 *   único UPDATE atômico. Se nenhuma linha for afetada (duplo-clique,
 *   reload, outra aba), rejeitamos a segunda tentativa.
 */

const PLACEHOLDER_PREFIX = "__PENDING_GRANEL__";

const nullIfEmpty = (v) => (v === "" || v === undefined ? null : v);

/**
 * Constrói o objeto que o TransbordoModal aceita como `prefillEntrada` para
 * o fluxo GRANEL na Ordem de Transbordo — sem gravar Entrada no banco.
 * Os IDs são placeholders (`__PENDING_GRANEL__::N`) e serão substituídos
 * pelos IDs reais de `t_estoque` na hora da validação.
 */
export function buildGranelPrefillFromPayload(granelPayload) {
  if (!granelPayload) return null;
  const lotes = Array.isArray(granelPayload.lotes) && granelPayload.lotes.length
    ? granelPayload.lotes
    : [
        {
          lote: granelPayload.lote || "",
          densidade: granelPayload.densidade || "",
          quantidade: granelPayload.quantidade || 0,
          unidade_medida: granelPayload.unidade_medida || "kg",
        },
      ];

  const nf = (granelPayload.nota_fiscal || "").trim();
  const pendingCodigo = nf ? `GRANEL (NF ${nf})` : "GRANEL (pendente)";

  const savedEstoques = lotes.map((lote, i) => ({
    id: `${PLACEHOLDER_PREFIX}::${i}`,
    entrada_id: `${PLACEHOLDER_PREFIX}::${i}`,
    entrada_codigo: pendingCodigo,
    cliente_id: granelPayload.cliente_id,
    cliente_nome: granelPayload.cliente_nome,
    produto_id: lote.produto_id || granelPayload.produto_id,
    produto_nome: lote.produto_nome || granelPayload.produto_nome,
    produto_codigo: lote.produto_codigo || granelPayload.produto_codigo,
    lote: lote.lote || "",
    densidade: lote.densidade || granelPayload.densidade,
    saldo_inicial: lote.quantidade || 0,
    quantidade: lote.quantidade || 0,
    saldo_final: lote.quantidade || 0,
    saldo_atual: lote.quantidade || 0,
    lotes: [
      {
        lote: lote.lote,
        quantidade: lote.quantidade,
        unidade_medida: lote.unidade_medida,
        densidade: lote.densidade,
      },
    ],
  }));

  return {
    ...granelPayload,
    id: PLACEHOLDER_PREFIX,
    entrada_codigo: pendingCodigo,
    savedEstoques,
  };
}

/**
 * Reidrata o prefill a partir dos payloads persistidos na validação,
 * para reabrir o modal em modo edição preservando as origens/destinos.
 */
export function buildEditingTransbordoFromValidacao(validacao) {
  if (!validacao?.transbordo_payload) return null;
  return {
    id: null, // sempre "novo" — a persistência real acontece na validação
    ...validacao.transbordo_payload,
  };
}

function toFiniteQty(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function unidadeLoteGranel(lote, granelPayload) {
  return lote?.unidade_medida || granelPayload?.unidade_medida || "kg";
}

function densidadeLoteGranel(lote, granelPayload) {
  return lote?.densidade || granelPayload?.densidade || "";
}

/**
 * Quantidade/unidade para exibição e resumo da validação.
 *
 * Granel: unidade e quantidade informadas no recebimento. Se a pesagem
 * ficou fora da margem, usa o peso líquido — convertido para a UOM
 * original quando ela não é kg.
 * Demais transbordos: sempre volume em L.
 */
export function resumoQuantidadeValidacao(validacao) {
  const granel = validacao?.granel_payload;
  const transbordo = validacao?.transbordo_payload;
  const isEntrada = validacao?.tipo === "entrada";
  const isGranel =
    validacao?.tipo === "granel_transbordo" ||
    validacao?.origem_tipo === "granel";

  if (isEntrada && granel) {
    const lotes = Array.isArray(granel.lotes) && granel.lotes.length
      ? granel.lotes
      : [granel];
    const unidade = lotes[0]?.unidade_medida || granel.unidade_medida || "";
    const quantidade = lotes.reduce(
      (s, l) => s + (Number(l.quantidade) || 0),
      0
    );
    return { quantidade, unidade_medida: unidade };
  }

  if (isGranel && granel) {
    const lote = Array.isArray(granel.lotes) && granel.lotes.length
      ? granel.lotes[0]
      : granel;
    const unidade = unidadeLoteGranel(lote, granel);
    const densidade = densidadeLoteGranel(lote, granel);
    const foraMargem = granel.granel_margem === "fora";

    if (foraMargem) {
      const convertida = toFiniteQty(lote?.quantidade);
      if (convertida > 0) {
        return { quantidade: convertida, unidade_medida: unidade };
      }
      return {
        quantidade: kgToLoteUnidade(
          granel.granel_peso_liquido,
          unidade,
          densidade
        ),
        unidade_medida: unidade,
      };
    }

    const declarada = toFiniteQty(getLoteQuantidadeDeclarada(lote));
    if (declarada > 0) {
      return { quantidade: declarada, unidade_medida: unidade };
    }
    const fallback = toFiniteQty(lote?.quantidade);
    return {
      quantidade: fallback,
      unidade_medida: unidade,
    };
  }

  const origens = transbordo?.origens || [];
  const totalVol = origens.reduce(
    (s, o) => s + (Number(o.volume_retirado) || 0),
    0
  );
  return { quantidade: totalVol, unidade_medida: "L" };
}

/** Junta lotes das origens (e lotes_retirados) para o resumo da validação. */
export function lotesLabelFromOrigens(origens = []) {
  const names = [];
  for (const o of origens || []) {
    const retirados = (o.lotes_retirados || [])
      .filter((l) => Number(l.volume_retirado) > 0)
      .map((l) => String(l.lote || "").trim())
      .filter(Boolean);
    if (retirados.length > 0) {
      for (const n of retirados) {
        if (!names.includes(n)) names.push(n);
      }
      continue;
    }
    const lote = String(o.lote || "").trim();
    if (!lote) continue;
    for (const part of lote.split(/\s*\/\s*/)) {
      const p = part.trim();
      if (p && !names.includes(p)) names.push(p);
    }
  }
  return names.join(" / ");
}

function extractResumo(tipo, granelPayload, transbordoPayload) {
  const qty = resumoQuantidadeValidacao({
    tipo,
    origem_tipo:
      tipo === "granel_transbordo"
        ? "granel"
        : tipo === "entrada"
          ? granelPayload?.lotes?.[0]?.tipo_recebimento || null
          : null,
    granel_payload: granelPayload,
    transbordo_payload: transbordoPayload,
  });
  const lote =
    (tipo === "granel_transbordo" || tipo === "entrada") && granelPayload
      ? granelPayload.lote || granelPayload.lotes?.[0]?.lote || ""
      : lotesLabelFromOrigens(transbordoPayload?.origens) ||
        transbordoPayload?.origens?.[0]?.lote ||
        "";
  return { lote, ...qty };
}

/**
 * Modelo para reabrir o OrdemTransbordoEnvaseModal a partir de uma validação
 * pendente (mesma UX da Ordem de Transbordo).
 */
function asPayloadObject(v) {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return typeof parsed === "object" && parsed != null ? parsed : null;
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? v : null;
}

export function buildEnvaseEditModelFromValidacao(validacao) {
  if (!validacao) return null;
  const tp = asPayloadObject(validacao.transbordo_payload);
  if (!tp) return null;

  const granel =
    asPayloadObject(validacao.granel_payload) ||
    asPayloadObject(validacao.entrada_payload) ||
    null;
  const origens = Array.isArray(tp.origens) ? tp.origens : [];
  const origemTipoRaw =
    validacao.origem_tipo ||
    origens[0]?.tipo_origem ||
    (validacao.tipo === "granel_transbordo" ? "granel" : "");
  const origemTipoOperacional =
    origemTipoRaw === "granel" ? "entrada" : origemTipoRaw || "entrada";

  const tankaOrigens =
    origemTipoOperacional === "tanka"
      ? origens.map((o) => {
          const codigo =
            String(o.tanka_codigo || "").trim() ||
            String(o.entrada_codigo || "")
              .split("—")[0]
              .trim() ||
            "Tanka";
          return {
            tankaId: o.tanka_id || o.entrada_id || "",
            tankaCodigo: codigo,
            lote: o.lote || "",
            quantidade:
              o.volume_retirado === "" || o.volume_retirado == null
                ? ""
                : Number(o.volume_retirado) || 0,
          };
        })
      : [];

  const vasilhameOrigens =
    origemTipoOperacional === "vasilhame"
      ? origens.map((o) => {
          const codigo =
            String(o.entrada_codigo || "")
              .split("—")[0]
              .trim() || "Vasilhame";
          const lotesDisp = Array.isArray(o.lotes_disponiveis)
            ? o.lotes_disponiveis
            : [];
          const lotesRet = Array.isArray(o.lotes_retirados)
            ? o.lotes_retirados
            : [];
          const loteLabel =
            lotesRet.length > 1
              ? lotesRet
                  .map((l) => String(l.lote || "").trim())
                  .filter(Boolean)
                  .join(" / ")
              : o.lote || lotesRet[0]?.lote || "";
          return {
            vasilhameId: o.entrada_id || "",
            codigo,
            lote: loteLabel,
            quantidade:
              o.volume_retirado === "" || o.volume_retirado == null
                ? ""
                : Number(o.volume_retirado) || 0,
            lotes_retirados: lotesRet,
            lotes_disponiveis: lotesDisp,
          };
        })
      : [];

  const totalFromOrigens = origens.reduce(
    (s, o) => s + (Number(o.volume_retirado) || 0),
    0
  );
  const isGranel =
    validacao.tipo === "granel_transbordo" || origemTipoRaw === "granel";
  const quantidade = isGranel
    ? granel?.quantidade ??
      granel?.lotes?.[0]?.quantidade ??
      totalFromOrigens
    : totalFromOrigens > 0
      ? totalFromOrigens
      : tp.volume_total || 0;
  const unidade = isGranel
    ? granel?.unidade_medida ||
      granel?.lotes?.[0]?.unidade_medida ||
      "kg"
    : "L";
  const densidade =
    tp.densidade ||
    granel?.densidade ||
    granel?.lotes?.[0]?.densidade ||
    "";
  const lote =
    lotesLabelFromOrigens(origens) ||
    (isGranel
      ? granel?.lote || granel?.lotes?.[0]?.lote || ""
      : "") ||
    tp.lote ||
    "";

  const productLabel = [tp.produto_codigo || validacao.produto_codigo, tp.produto_nome || validacao.produto_nome]
    .filter(Boolean)
    .join(" - ");

  return {
    productLabel,
    produtoId: tp.produto_id || validacao.produto_id || "",
    produtoNome: tp.produto_nome || validacao.produto_nome || "",
    produtoCodigo: tp.produto_codigo || validacao.produto_codigo || "",
    lote,
    quantidade,
    unidade,
    densidade,
    dataOp: tp.data || granel?.data || validacao.data || "",
    clienteId: tp.cliente_id || granel?.cliente_id || validacao.cliente_id || "",
    clienteNome:
      tp.cliente_nome || granel?.cliente_nome || validacao.cliente_nome || "",
    origemTipoOperacional,
    tankaOrigens,
    vasilhameOrigens,
    quantidadeEditable:
      origemTipoOperacional === "tanka"
        ? tankaOrigens.length <= 1
        : origemTipoOperacional === "vasilhame"
          ? vasilhameOrigens.length <= 1
          : true,
    granelPayload: isGranel && granel ? granel : null,
    initialPayload: tp,
  };
}

/**
 * Cria uma nova validação (status = 'pendente') a partir da Ordem de
 * Transbordo. Não executa nenhum movimento definitivo.
 *
 * @param {object} params
 * @param {'granel_transbordo'|'transbordo'|'entrada'} params.tipo
 * @param {object} params.header  { data, cliente_id, cliente_nome, produto_id, produto_nome, produto_codigo }
 * @param {string} params.origemTipo  granel|tanka|vasilhame|embalado
 * @param {object} [params.granelPayload]  payload aceito por createGranelEntrada / createEntradaCompleta
 * @param {object} [params.transbordoPayload]  payload aceito por persistTransbordo (obrigatório exceto tipo entrada)
 * @param {object} [params.criadoPor]  { id, nome }
 */
export async function criarValidacao({
  tipo,
  header,
  origemTipo,
  granelPayload = null,
  transbordoPayload = null,
  criadoPor = null,
}) {
  if (!tipo) throw new Error("tipo obrigatório");
  if (tipo !== "entrada" && !transbordoPayload) {
    throw new Error("transbordoPayload obrigatório");
  }
  if (tipo === "entrada" && !granelPayload) {
    throw new Error("granelPayload obrigatório");
  }

  const resumo = extractResumo(tipo, granelPayload, transbordoPayload);

  const record = {
    tipo,
    status: "pendente",
    data: header?.data || null,
    cliente_id: nullIfEmpty(header?.cliente_id),
    cliente_nome: header?.cliente_nome || null,
    produto_id: nullIfEmpty(header?.produto_id),
    produto_nome: header?.produto_nome || null,
    produto_codigo: header?.produto_codigo || null,
    lote: resumo.lote || null,
    quantidade: resumo.quantidade || 0,
    unidade_medida: resumo.unidade_medida || null,
    origem_tipo: origemTipo || null,
    granel_payload: granelPayload || null,
    transbordo_payload: transbordoPayload || null,
    criado_por_id: criadoPor?.id ? String(criadoPor.id) : null,
    criado_por_nome: criadoPor?.nome || null,
  };

  return entities.transbordoValidacoes.create(record);
}

/**
 * Atualiza o payload do transbordo (edição pré-validação). Só altera se
 * ainda estiver pendente. Não gera movimentação.
 */
export async function atualizarValidacaoTransbordoPayload({
  id,
  transbordoPayload = null,
  granelPayload = null,
  header = null,
}) {
  if (!id) throw new Error("id obrigatório");
  const atual = await entities.transbordoValidacoes.get(id);
  if (!atual) throw new Error("Validação não encontrada");
  if (atual.status !== "pendente") {
    throw new Error("Não é possível editar uma validação já processada");
  }

  const nextGranel =
    granelPayload ?? asPayloadObject(atual.granel_payload) ?? atual.granel_payload;
  const nextTransbordo =
    transbordoPayload ??
    asPayloadObject(atual.transbordo_payload) ??
    atual.transbordo_payload;
  const resumo = extractResumo(atual.tipo, nextGranel, nextTransbordo);

  return entities.transbordoValidacoes.update(id, {
    transbordo_payload: nextTransbordo,
    granel_payload: nextGranel,
    lote: header?.lote ?? resumo.lote ?? null,
    quantidade:
      header?.quantidade != null ? header.quantidade : resumo.quantidade || 0,
    unidade_medida:
      header?.unidade_medida ?? resumo.unidade_medida ?? null,
    data:
      header?.data ||
      nextTransbordo?.data ||
      nextGranel?.data ||
      atual.data ||
      null,
    cliente_id:
      nullIfEmpty(header?.cliente_id) ??
      nullIfEmpty(nextTransbordo?.cliente_id) ??
      nullIfEmpty(nextGranel?.cliente_id) ??
      atual.cliente_id,
    cliente_nome:
      header?.cliente_nome ||
      nextTransbordo?.cliente_nome ||
      nextGranel?.cliente_nome ||
      atual.cliente_nome,
    produto_id:
      nullIfEmpty(nextTransbordo?.produto_id) ??
      nullIfEmpty(nextGranel?.produto_id) ??
      atual.produto_id,
    produto_nome:
      nextTransbordo?.produto_nome ||
      nextGranel?.produto_nome ||
      atual.produto_nome,
    produto_codigo:
      nextTransbordo?.produto_codigo ||
      nextGranel?.produto_codigo ||
      atual.produto_codigo,
  });
}

/**
 * Exclui uma validação pendente.
 */
export async function excluirValidacao(id) {
  const atual = await entities.transbordoValidacoes.get(id);
  if (!atual) return true;
  if (atual.status !== "pendente") {
    throw new Error("Apenas validações pendentes podem ser excluídas");
  }
  return entities.transbordoValidacoes.delete(id);
}

/**
 * Substitui placeholders `__PENDING_GRANEL__::N` pelos IDs reais de
 * `t_estoque` gerados por createGranelEntrada.
 */
function swapGranelPlaceholders(transbordoPayload, savedEstoques, entradaCodigo) {
  const origens = (transbordoPayload.origens || []).map((o) => {
    const id = String(o.entrada_id || "");
    if (!id.startsWith(PLACEHOLDER_PREFIX)) return o;
    const idx = parseInt(id.split("::")[1] || "0", 10);
    const est = savedEstoques[idx] || savedEstoques[0];
    if (!est) return o;
    const produtoNome = est.produto_nome || o.produto_nome || "";
    const loteLabel = o.lote ? ` — Lote ${o.lote}` : "";
    return {
      ...o,
      entrada_id: est.id,
      entrada_codigo: `${entradaCodigo} - ${produtoNome}${loteLabel}`.trim(),
    };
  });
  return { ...transbordoPayload, origens };
}

/**
 * Efetiva o movimento físico (entrada granel + transbordo) a partir dos
 * payloads da validação. Usado pelo Transbordo e pela Industrialização.
 */
export async function persistOperacaoFromValidacao({
  tipo,
  granelPayload = null,
  transbordoPayload = null,
}) {
  let entradaId = null;
  let nextTransbordo = transbordoPayload || {};

  if (tipo === "granel_transbordo") {
    if (!granelPayload) {
      throw new Error("granel_payload ausente na validação");
    }
    const { savedEntrada, savedEstoques, entrada_codigo } =
      await createGranelEntrada({ data: granelPayload });
    entradaId = savedEntrada?.id || null;
    nextTransbordo = swapGranelPlaceholders(
      nextTransbordo,
      savedEstoques || [],
      entrada_codigo
    );
  }

  const [transbordos, produtos, isotanques, vasilhames] = await Promise.all([
    entities.transbordos.list("-created_date"),
    entities.produtos.list(),
    listTankas(),
    entities.vasilhames.list(),
  ]);

  const savedTransbordo = await persistTransbordo({
    data: nextTransbordo,
    editingTransbordo: null,
    transbordos,
    produtos,
    isotanques,
    vasilhames,
  });

  return {
    entradaId,
    transbordoId: savedTransbordo?.id || null,
    transbordoPayload: nextTransbordo,
  };
}

/**
 * Executa efetivamente a operação (chama os fluxos existentes).
 * Idempotente: se a validação não estiver pendente, lança erro sem duplicar.
 *
 * @param {object} params
 * @param {string} params.id  id da validação
 * @param {object} [params.validadoPor]  { id, nome }
 * @returns {Promise<object>}  validação atualizada
 */
export async function efetivarValidacao({ id, validadoPor = null }) {
  if (!id) throw new Error("id obrigatório");
  if (!chemflowSupabase) throw new Error("Supabase não configurado");

  // Lock atômico: só uma sessão consegue avançar 'pendente' → 'processando'.
  const { data: locked, error: lockError } = await chemflowSupabase
    .from("t_transbordo_validacoes")
    .update({ status: "processando" })
    .eq("id", id)
    .eq("status", "pendente")
    .select()
    .maybeSingle();

  if (lockError) throw new Error(lockError.message);
  if (!locked) {
    // Já está validada / processando em outra aba.
    const atual = await entities.transbordoValidacoes.get(id);
    if (atual?.status === "validado") {
      throw new Error("Esta validação já foi processada anteriormente.");
    }
    throw new Error("Esta validação está sendo processada por outra sessão.");
  }

  try {
    if (locked.tipo === "entrada") {
      if (!locked.granel_payload) {
        throw new Error("payload de entrada ausente na validação");
      }
      const produtosList = await entities.produtos.list();
      const { savedEntrada } = await createEntradaCompleta({
        data: locked.granel_payload,
        produtos: produtosList,
      });
      const entradaId = savedEntrada?.id || null;

      const validated = await entities.transbordoValidacoes.update(id, {
        status: "validado",
        entrada_id: entradaId,
        transbordo_id: null,
        validado_por_id: validadoPor?.id ? String(validadoPor.id) : null,
        validado_por_nome: validadoPor?.nome || null,
        validado_em: new Date().toISOString(),
      });
      return validated;
    }

    const persisted = await persistOperacaoFromValidacao({
      tipo: locked.tipo,
      granelPayload: locked.granel_payload,
      transbordoPayload: locked.transbordo_payload,
    });

    const validated = await entities.transbordoValidacoes.update(id, {
      status: "validado",
      entrada_id: persisted.entradaId,
      transbordo_id: persisted.transbordoId,
      transbordo_payload: persisted.transbordoPayload,
      validado_por_id: validadoPor?.id ? String(validadoPor.id) : null,
      validado_por_nome: validadoPor?.nome || null,
      validado_em: new Date().toISOString(),
    });
    return validated;
  } catch (err) {
    // Rollback do lock — devolve para 'pendente' para nova tentativa.
    try {
      await chemflowSupabase
        .from("t_transbordo_validacoes")
        .update({ status: "pendente" })
        .eq("id", id)
        .eq("status", "processando");
    } catch (rollbackErr) {
      console.error("[validacaoTransbordo] rollback:", rollbackErr);
    }
    throw err;
  }
}
