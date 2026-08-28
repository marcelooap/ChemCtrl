/**
 * Helpers da tela Filtração — registros espelhados de vasilhames
 * de produtos marcados como filtrados.
 * Apenas embalagens do tipo "Vasilhame" (não Tankagem / IBC / etc.).
 */

export const PARTICULA_TAMANHOS = [
  { key: "particulas_6", label: "6 mm", short: "6" },
  { key: "particulas_14", label: "14 mm", short: "14" },
  { key: "particulas_21", label: "21 mm", short: "21" },
  { key: "particulas_38", label: "38 mm", short: "38" },
  { key: "particulas_70", label: "70 mm", short: "70" },
];

/** Contagens em formato PT-BR (ex.: 10.000). */
export function formatParticulaCount(v) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    maximumFractionDigits: 0,
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

/** Campos espelhados do vasilhame (sem sobrescrever SAE/partículas). */
export function syncFiltracaoFromVasilhame(vasilhame) {
  return {
    codigo: vasilhame.codigo || "",
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
