/**
 * Helpers da tela Filtração — registros espelhados de vasilhames
 * de produtos marcados como filtrados.
 * Apenas embalagens do tipo "Vasilhame" (não Tankagem / IBC / etc.).
 */

import { roundVolume } from "@transbordo/lib/format";
import { getDominantLote } from "@transbordo/lib/vasilhameComposicao";
import { resolveVasilhameExpedidoDisplay } from "@transbordo/lib/vasilhamePatio";

export const PARTICULA_TAMANHOS = [
  { key: "particulas_6", label: "6 mm", short: "6" },
  { key: "particulas_14", label: "14 mm", short: "14" },
  { key: "particulas_21", label: "21 mm", short: "21" },
  { key: "particulas_38", label: "38 mm", short: "38" },
  { key: "particulas_70", label: "70 mm", short: "70" },
];

/** Contagens em formato PT-BR (ex.: 10.000 ou 13,547). */
export function formatParticulaCount(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

/** Filtração só registra tipo Vasilhame — exclui Tankagem e demais embalagens. */
export function isFiltracaoElegivel(vasilhame) {
  return (vasilhame?.tipo || "") === "Vasilhame";
}

/** Monta payload de filtração a partir de um vasilhame persistido. */
export function buildFiltracaoFromVasilhame(vasilhame, extras = {}) {
  return {
    vasilhame_id: vasilhame.id,
    transbordo_id: vasilhame.transbordo_id || extras.transbordo_id || null,
    codigo: vasilhame.codigo || extras.codigo || "",
    placa: vasilhame.placa || "",
    barril: vasilhame.barril || "",
    produto_id: vasilhame.produto_id || null,
    produto_codigo: vasilhame.produto_codigo || "",
    produto_nome: vasilhame.produto_nome || "",
    cliente_id: vasilhame.cliente_id || null,
    cliente_nome: vasilhame.cliente_nome || "",
    lote: vasilhame.lote || "",
    composicao: vasilhame.composicao || [],
    volume: vasilhame.volume || 0,
    filtro_id: extras.filtro_id ?? null,
    filtro_codigo: extras.filtro_codigo ?? "",
    sae: extras.sae ?? null,
    particulas_6: extras.particulas_6 ?? null,
    particulas_14: extras.particulas_14 ?? null,
    particulas_21: extras.particulas_21 ?? null,
    particulas_38: extras.particulas_38 ?? null,
    particulas_70: extras.particulas_70 ?? null,
  };
}

/** Busca o cartucho com status Em uso (no máximo um esperado). */
export async function getFiltroEmUso(entities) {
  const list = await entities.elementos_filtrantes.filter({ status: "Em uso" });
  return list[0] || null;
}

/**
 * Coloca um elemento Em uso.
 * O que estava Em uso passa automaticamente para Descartado.
 */
export async function promoverFiltroEmUso(entities, elementoId, elementosAtuais = []) {
  if (!elementoId) return null;
  const lista =
    elementosAtuais.length > 0
      ? elementosAtuais
      : await entities.elementos_filtrantes.list();
  const anteriores = lista.filter(
    (e) => e.status === "Em uso" && e.id !== elementoId
  );
  await Promise.all(
    anteriores.map((e) =>
      entities.elementos_filtrantes.update(e.id, { status: "Descartado" })
    )
  );
  return entities.elementos_filtrantes.update(elementoId, { status: "Em uso" });
}

export const STATUS_ELEMENTO = ["Em uso", "Almoxarifado", "Descartado"];

export function statusElementoBadgeClass(status) {
  if (status === "Em uso") return "bg-green-100 text-green-800";
  if (status === "Descartado") return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-700";
}

/** Próximos códigos F00N — síncrono só para preview UI. */
export function generateProximosCodigosFiltro(existentes, quantidade) {
  const nums = (existentes || [])
    .map((e) => e.codigo)
    .filter(Boolean)
    .map((c) => parseInt(String(c).replace(/\D/g, ""), 10))
    .filter((n) => !Number.isNaN(n));
  let max = nums.length > 0 ? Math.max(...nums) : 0;
  const qtd = Math.max(0, Math.round(Number(quantidade) || 0));
  const codigos = [];
  for (let i = 0; i < qtd; i++) {
    max += 1;
    codigos.push(`F${String(max).padStart(3, "0")}`);
  }
  return codigos;
}

/** Alocação atômica via sequence (preferida na criação). */
export async function allocateProximosCodigosFiltro(existentes, quantidade) {
  const { allocateFiltroCodigos } = await import("@transbordo/lib/allocateBusinessCodes");
  return allocateFiltroCodigos(quantidade, existentes);
}

/** Soma volumes das filtrações vinculadas a cada cartucho. */
export function volumeTotalPorFiltro(filtracoes = []) {
  const map = new Map();
  for (const f of filtracoes) {
    if (!f.filtro_id) continue;
    map.set(f.filtro_id, (map.get(f.filtro_id) || 0) + (Number(f.volume) || 0));
  }
  return map;
}

/** SAE informado — o tanque deixa de estar pendente de resultado. */
export function filtracaoTemSae(filtracao) {
  return filtracao?.sae !== null && filtracao?.sae !== undefined && filtracao?.sae !== "";
}

function composicaoSignature(composicao) {
  return (composicao || [])
    .map((c) => {
      const lote = String(c?.lote || "").trim();
      const litros = roundVolume(c?.quantidade_l || 0);
      const op = String(c?.transbordo_codigo || "").trim();
      return `${lote}|${litros}|${op}`;
    })
    .sort()
    .join(";");
}

function sameVolume(a, b) {
  return Math.abs(roundVolume(a) - roundVolume(b)) < 0.0005;
}

/** Itens de saída convencional agrupados pelo vasilhame, como na grade de Vasilhames. */
export function indexSaidaItemsByVasilhame(saidas = []) {
  const map = new Map();
  for (const saida of saidas || []) {
    for (const item of saida?.itens || []) {
      if (item?.tipo !== "convencional" || !item.vasilhame_id) continue;
      const list = map.get(item.vasilhame_id) || [];
      list.push({ saida, item });
      map.set(item.vasilhame_id, list);
    }
  }
  return map;
}

/**
 * Volume exibido na grade de Vasilhames para o tanque ligado à filtração.
 * Expedido zera o cadastro; a grade recupera o conteúdo (saída, composição ou OP).
 * Devolve 0 quando não há conteúdo recuperável — o espelho não deve apagar o volume.
 */
export function volumeExibidoDoVasilhame(vasilhame, ctx = {}) {
  if (!vasilhame) return 0;
  const display = resolveVasilhameExpedidoDisplay(vasilhame, {
    linkedItems: ctx.linkedItems || [],
    transbordos: ctx.transbordos || [],
  });
  return roundVolume(display?.volume || 0);
}

function sameText(a, b) {
  return String(a ?? "").trim() === String(b ?? "").trim();
}

/**
 * Identidade comercial gravada no vasilhame (só deste tanque).
 * Sem produto no tanque, não apaga o que já está na filtração.
 */
function produtoSnapshotPatch(filtracao, vasilhame) {
  const produtoId = vasilhame?.produto_id || null;
  const produtoCodigo = vasilhame?.produto_codigo || "";
  const produtoNome = String(vasilhame?.produto_nome || "").trim();
  if (!produtoId && !produtoNome && !String(produtoCodigo).trim()) return {};

  const patch = {};
  if (!sameText(filtracao?.produto_id, produtoId)) patch.produto_id = produtoId;
  if (!sameText(filtracao?.produto_codigo, produtoCodigo)) {
    patch.produto_codigo = produtoCodigo;
  }
  if (!sameText(filtracao?.produto_nome, produtoNome)) {
    patch.produto_nome = produtoNome;
  }
  return patch;
}

/** Nº placa e nº barril deste tanque. Placa vazia não apaga a filtração. */
function identificacaoSnapshotPatch(filtracao, vasilhame) {
  const patch = {};
  const placa = String(vasilhame?.placa || "").trim();
  const barril = String(vasilhame?.barril || "").trim();
  if (placa && !sameText(filtracao?.placa, placa)) patch.placa = placa;
  if (!sameText(filtracao?.barril, barril)) patch.barril = barril;
  return patch;
}

/**
 * Ajusta produto, placa, barril, volume, composição e lote da filtração ao vasilhame.
 * Não mexe em SAE, partículas ou filtro.
 * Produto, placa e barril acompanham o tanque mesmo quando o volume exibido é zero.
 */
export function mirrorFiltracaoFromVasilhame(filtracao, vasilhame, ctx = {}) {
  if (!filtracao || !vasilhame) return { row: filtracao, patch: null };

  const patch = {
    ...produtoSnapshotPatch(filtracao, vasilhame),
    ...identificacaoSnapshotPatch(filtracao, vasilhame),
  };

  const volume = volumeExibidoDoVasilhame(vasilhame, ctx);
  if (volume > 0) {
    const composicao =
      Array.isArray(vasilhame.composicao) && vasilhame.composicao.length > 0
        ? vasilhame.composicao
        : filtracao.composicao || [];
    const lote =
      getDominantLote(composicao) || vasilhame.lote || filtracao.lote || "";

    if (!sameVolume(filtracao.volume, volume)) patch.volume = volume;
    if (composicaoSignature(filtracao.composicao) !== composicaoSignature(composicao)) {
      patch.composicao = composicao;
    }
    if (lote && String(lote) !== String(filtracao.lote || "")) patch.lote = lote;
  }

  if (Object.keys(patch).length === 0) return { row: filtracao, patch: null };

  return {
    row: { ...filtracao, ...patch },
    patch: { id: filtracao.id, ...patch },
  };
}

/**
 * Reescreve filtrações cujo produto, placa, barril ou volume ficou para trás do tanque.
 */
export async function alignFiltracoesComVasilhames(
  entities,
  {
    vasilhames = null,
    filtracoes = null,
    saidas = null,
    transbordos = null,
    persist = true,
  } = {}
) {
  const [vasList, filList, saidaList, transList] = await Promise.all([
    vasilhames ? Promise.resolve(vasilhames) : entities.vasilhames.list(),
    filtracoes ? Promise.resolve(filtracoes) : entities.filtracoes.list("-created_date"),
    saidas ? Promise.resolve(saidas) : entities.saidas.list("-created_date").catch(() => []),
    transbordos ? Promise.resolve(transbordos) : entities.transbordos.list().catch(() => []),
  ]);

  const vasById = new Map((vasList || []).filter((v) => v?.id).map((v) => [v.id, v]));
  const transbordoById = new Map(
    (transList || []).filter((t) => t?.id).map((t) => [t.id, t])
  );
  const saidaByVas = indexSaidaItemsByVasilhame(saidaList);
  const rows = [];
  const patches = [];

  for (const filtracao of filList || []) {
    const vasilhame = vasById.get(filtracao.vasilhame_id);
    const mirrored = mirrorFiltracaoFromVasilhame(filtracao, vasilhame, {
      linkedItems: saidaByVas.get(filtracao.vasilhame_id) || [],
      transbordos: transList || [],
    });
    const transbordoId = mirrored.row?.transbordo_id || vasilhame?.transbordo_id;
    const transbordo = transbordoId ? transbordoById.get(transbordoId) : null;
    rows.push({
      ...mirrored.row,
      data_operacao:
        transbordo?.data ||
        mirrored.row?.created_at ||
        mirrored.row?.created_date ||
        null,
    });
    if (mirrored.patch) patches.push(mirrored.patch);
  }

  if (persist && patches.length > 0) {
    try {
      await entities.filtracoes.bulkUpdate(patches);
    } catch (err) {
      console.error("[Transbordo] Falha ao alinhar volume das filtrações:", err);
    }
  }

  return { rows, patches };
}

/** Campos espelhados do vasilhame (sem sobrescrever SAE/partículas). */
export function syncFiltracaoFromVasilhame(vasilhame, ctx = {}) {
  const volume = volumeExibidoDoVasilhame(vasilhame, ctx);
  return {
    codigo: vasilhame.codigo || "",
    placa: vasilhame.placa || "",
    barril: vasilhame.barril || "",
    produto_id: vasilhame.produto_id || null,
    produto_codigo: vasilhame.produto_codigo || "",
    produto_nome: vasilhame.produto_nome || "",
    cliente_id: vasilhame.cliente_id || null,
    cliente_nome: vasilhame.cliente_nome || "",
    lote: getDominantLote(vasilhame.composicao) || vasilhame.lote || "",
    composicao: vasilhame.composicao || [],
    volume: volume > 0 ? volume : vasilhame.volume || 0,
  };
}

/**
 * Cria ou atualiza registro de filtração ligado a um vasilhame
 * (usado em top-up / fracionado). Ignora Tankagem e outros tipos.
 */
export async function upsertFiltracaoForVasilhame(entities, vasilhame, extras = {}) {
  if (!vasilhame?.id || !isFiltracaoElegivel(vasilhame)) return null;
  const existing = await entities.filtracoes.filter({ vasilhame_id: vasilhame.id });
  if (existing.length > 0) {
    const patch = syncFiltracaoFromVasilhame(vasilhame);
    if (!existing[0].filtro_id && extras.filtro_id) {
      patch.filtro_id = extras.filtro_id;
      patch.filtro_codigo = extras.filtro_codigo || "";
    }
    return entities.filtracoes.update(existing[0].id, patch);
  }
  return entities.filtracoes.create(
    buildFiltracaoFromVasilhame(vasilhame, extras)
  );
}
