import { chemflowSupabase } from "@/services/supabase/chemflow";
import { entities } from "@transbordo/services/entities";
import { createGranelEntrada } from "@transbordo/lib/createGranelEntrada";
import { persistTransbordo } from "@transbordo/lib/persistTransbordo";
import {
  getLoteQuantidadeDeclarada,
  kgToLoteUnidade,
} from "@transbordo/lib/conversao";

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
    quantidade: lote.quantidade || 0,
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
  const isGranel =
    validacao?.tipo === "granel_transbordo" ||
    validacao?.origem_tipo === "granel" ||
    Boolean(granel);

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

function extractResumo(tipo, granelPayload, transbordoPayload) {
  const qty = resumoQuantidadeValidacao({
    tipo,
    origem_tipo: tipo === "granel_transbordo" ? "granel" : null,
    granel_payload: granelPayload,
    transbordo_payload: transbordoPayload,
  });
  const lote =
    tipo === "granel_transbordo" && granelPayload
      ? granelPayload.lote || granelPayload.lotes?.[0]?.lote || ""
      : transbordoPayload?.origens?.[0]?.lote || "";
  return { lote, ...qty };
}

/**
 * Cria uma nova validação (status = 'pendente') a partir da Ordem de
 * Transbordo. Não executa nenhum movimento definitivo.
 *
 * @param {object} params
 * @param {'granel_transbordo'|'transbordo'} params.tipo
 * @param {object} params.header  { data, cliente_id, cliente_nome, produto_id, produto_nome, produto_codigo }
 * @param {string} params.origemTipo  granel|tanka|vasilhame|embalado
 * @param {object} [params.granelPayload]  payload aceito por createGranelEntrada
 * @param {object} params.transbordoPayload  payload aceito por persistTransbordo
 * @param {object} [params.criadoPor]  { id, nome }
 */
export async function criarValidacao({
  tipo,
  header,
  origemTipo,
  granelPayload = null,
  transbordoPayload,
  criadoPor = null,
}) {
  if (!tipo) throw new Error("tipo obrigatório");
  if (!transbordoPayload) throw new Error("transbordoPayload obrigatório");

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
  transbordoPayload,
  granelPayload = null,
}) {
  if (!id) throw new Error("id obrigatório");
  const atual = await entities.transbordoValidacoes.get(id);
  if (!atual) throw new Error("Validação não encontrada");
  if (atual.status !== "pendente") {
    throw new Error("Não é possível editar uma validação já processada");
  }

  const nextGranel = granelPayload ?? atual.granel_payload;
  const resumo = extractResumo(atual.tipo, nextGranel, transbordoPayload);

  return entities.transbordoValidacoes.update(id, {
    transbordo_payload: transbordoPayload,
    granel_payload: nextGranel,
    lote: resumo.lote || null,
    quantidade: resumo.quantidade || 0,
    unidade_medida: resumo.unidade_medida || null,
    data:
      transbordoPayload?.data ||
      nextGranel?.data ||
      atual.data ||
      null,
    cliente_id:
      nullIfEmpty(transbordoPayload?.cliente_id) ??
      nullIfEmpty(nextGranel?.cliente_id) ??
      atual.cliente_id,
    cliente_nome:
      transbordoPayload?.cliente_nome ||
      nextGranel?.cliente_nome ||
      atual.cliente_nome,
    produto_id:
      nullIfEmpty(transbordoPayload?.produto_id) ??
      nullIfEmpty(nextGranel?.produto_id) ??
      atual.produto_id,
    produto_nome:
      transbordoPayload?.produto_nome ||
      nextGranel?.produto_nome ||
      atual.produto_nome,
    produto_codigo:
      transbordoPayload?.produto_codigo ||
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
    let entradaId = locked.entrada_id || null;
    let transbordoPayload = locked.transbordo_payload || {};

    if (locked.tipo === "granel_transbordo") {
      if (!locked.granel_payload) {
        throw new Error("granel_payload ausente na validação");
      }
      // Cria entrada + linhas de estoque (fluxo já existente).
      const { savedEntrada, savedEstoques, entrada_codigo } =
        await createGranelEntrada({ data: locked.granel_payload });
      entradaId = savedEntrada?.id || null;
      transbordoPayload = swapGranelPlaceholders(
        transbordoPayload,
        savedEstoques || [],
        entrada_codigo
      );
    }

    // Carrega o mundo atual para a persistência do transbordo.
    const [transbordos, produtos, isotanques, vasilhames] = await Promise.all([
      entities.transbordos.list("-created_date"),
      entities.produtos.list(),
      entities.isotanques.list(),
      entities.vasilhames.list(),
    ]);

    const savedTransbordo = await persistTransbordo({
      data: transbordoPayload,
      editingTransbordo: null,
      transbordos,
      produtos,
      isotanques,
      vasilhames,
    });

    const validated = await entities.transbordoValidacoes.update(id, {
      status: "validado",
      entrada_id: entradaId,
      transbordo_id: savedTransbordo?.id || null,
      transbordo_payload: transbordoPayload,
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
