/** Limites do mês corrente no fuso local, em ISO (yyyy-mm-dd). */
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function currentMonthBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  return { start: iso(start), end: iso(end) };
}

export function formatDateBr(dateStr) {
  if (!dateStr) return "-";
  const raw = String(dateStr).slice(0, 10);
  const [y, m, d] = raw.split("-");
  if (!y || !m || !d) return String(dateStr);
  return `${d}/${m}/${y}`;
}

function normalizeTanka(value) {
  return String(value || "").trim().toLowerCase();
}

function asText(value) {
  const out = value == null ? "" : String(value).trim();
  return out;
}

/**
 * Locação vigente no tanka imediatamente antes (ou na data) da descontaminação.
 * É o cadastro cujo início é o mais recente entre os que começaram até essa data.
 */
export function resolveLocacaoAntes(isotanques, tanka, dataDescontaminacao) {
  const key = normalizeTanka(tanka);
  if (!key) return null;

  const date = String(dataDescontaminacao || "").slice(0, 10);
  const matches = (isotanques || []).filter(
    (it) => normalizeTanka(it.tanka) === key
  );
  if (!matches.length) return null;

  const before = matches
    .filter((it) => {
      const ini = it.inicio_locacao ? String(it.inicio_locacao).slice(0, 10) : "";
      return Boolean(ini) && (!date || ini <= date);
    })
    .sort((a, b) => {
      const ia = String(a.inicio_locacao).slice(0, 10);
      const ib = String(b.inicio_locacao).slice(0, 10);
      if (ia !== ib) return ib.localeCompare(ia);
      return String(b.created_at || "").localeCompare(String(a.created_at || ""));
    });

  if (before.length) return before[0];

  const hasLaterDated = matches.some((it) => {
    const ini = it.inicio_locacao ? String(it.inicio_locacao).slice(0, 10) : "";
    return Boolean(ini) && Boolean(date) && ini > date;
  });
  if (hasLaterDated) return null;

  const undated = matches
    .filter((it) => !it.inicio_locacao)
    .sort((a, b) =>
      String(b.created_at || "").localeCompare(String(a.created_at || ""))
    );
  return undated[0] || null;
}

function preferStored(stored, fallback) {
  const saved = asText(stored);
  if (saved) return saved;
  const derived = asText(fallback);
  return derived || "-";
}

/** Linha de exibição: snapshot gravado, ou a locação vigente na data. */
export function enrichDescontaminacao(record, isotanques) {
  const loc = resolveLocacaoAntes(
    isotanques,
    record?.tanka,
    record?.data_descontaminacao
  );
  return {
    id: record?.id,
    data_descontaminacao: record?.data_descontaminacao || "",
    tanka: preferStored(record?.tanka, null),
    codigo_itku: preferStored(record?.codigo_itku, loc?.codigo_itku),
    cliente_nome: preferStored(record?.cliente_nome, loc?.cliente_nome),
    ultimo_produto: preferStored(record?.produto_nome, loc?.produto_nome),
  };
}

export function normalizePeriod(de, ate) {
  let from = de ? String(de).slice(0, 10) : "";
  let to = ate ? String(ate).slice(0, 10) : "";
  if (from && to && from > to) {
    return { from: to, to: from };
  }
  return { from, to };
}

export function filterDescontaminacoesByPeriod(rows, de, ate) {
  const { from, to } = normalizePeriod(de, ate);
  return (rows || []).filter((row) => {
    const d = String(row.data_descontaminacao || "").slice(0, 10);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

export function sortDescontaminacoes(rows) {
  return [...(rows || [])].sort((a, b) => {
    const da = String(a.data_descontaminacao || "");
    const db = String(b.data_descontaminacao || "");
    if (da !== db) return db.localeCompare(da);
    return String(a.tanka || "").localeCompare(String(b.tanka || ""), "pt-BR", {
      numeric: true,
    });
  });
}

export function periodLabel(de, ate) {
  const { from, to } = normalizePeriod(de, ate);
  const start = from ? formatDateBr(from) : "";
  const end = to ? formatDateBr(to) : "";
  if (start && end) return `${start} a ${end}`;
  if (start) return `a partir de ${start}`;
  if (end) return `até ${end}`;
  return "todos os períodos";
}

/** Payload com o produto, cliente e ITKU vigentes no momento do registro. */
export function buildDescontaminacaoPayload(isotanques, data) {
  const loc = resolveLocacaoAntes(
    isotanques,
    data?.tanka,
    data?.data_descontaminacao
  );
  return {
    tanka: data.tanka,
    data_descontaminacao: data.data_descontaminacao,
    codigo_itku: asText(loc?.codigo_itku) || null,
    cliente_nome: asText(loc?.cliente_nome) || null,
    produto_nome: asText(loc?.produto_nome) || null,
  };
}

export function isMissingSnapshotColumnError(err) {
  const msg = String(err?.message || "").toLowerCase();
  const missing =
    msg.includes("schema cache") ||
    msg.includes("could not find") ||
    msg.includes("does not exist");
  const field =
    msg.includes("codigo_itku") ||
    msg.includes("produto_nome") ||
    msg.includes("cliente_nome");
  return missing && field;
}
