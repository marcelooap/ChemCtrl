import { parseNumero, roundQuantidade } from "@transbordo/lib/format";
import { convertToKg } from "@industrializacao/lib/productionViewUtils";

/** Normaliza unidade para comparar compatibilidade na consolidação. */
function normalizeUnidade(unidade) {
  const u = String(unidade || "")
    .trim()
    .toLowerCase();
  if (!u) return "";
  if (u === "l" || u === "lt" || u === "litro" || u === "litros") return "l";
  if (
    u === "gal" ||
    u === "gallon" ||
    u === "gallons" ||
    u === "galão" ||
    u === "galoes" ||
    u === "galões"
  ) {
    return "gal";
  }
  if (u === "lb" || u === "lbs" || u === "libra" || u === "libras") return "lb";
  if (u === "kg" || u === "kgs" || u === "quilo" || u === "quilos") return "kg";
  return u;
}

function getItemUnidadeEntrada(item) {
  const fromLote = item?.lotes?.[0]?.unidade_medida;
  if (fromLote != null && String(fromLote).trim() !== "") {
    return String(fromLote).trim();
  }
  return item?.unidade_medida || "kg";
}

/**
 * Saldo efetivo da linha (mesma regra da coluna Saldo Atual).
 * Prefere soma dos locais já calculados em buildEstoqueView; senão usa saldo_atual.
 */
export function getChemCtrlSaldoEfetivo(item) {
  const locais = item?.locaisSaldo;
  if (locais != null) {
    return roundQuantidade(
      (Number(locais.patio) || 0) +
        (Number(locais.vasilhames) || 0) +
        (Number(locais.tankas) || 0)
    );
  }
  return roundQuantidade(Number(item?.saldo_atual) || 0);
}

/** Preferências fixas da planilha Proteus (seleção automática). */
const PREFERRED_PRODUCT_HEADER = "produto";
const PREFERRED_LOT_HEADER = "lote";
const PREFERRED_BALANCE_HEADER = "saldo lote";

/**
 * Normaliza código de produto para chave de comparação.
 * Códigos só numéricos (ex.: 1.023.021 / 01023021): só dígitos, sem zeros à esquerda.
 * Códigos alfanuméricos (ex.: 1M5R30.P00000): mantém letras/dígitos, remove pontuação.
 */
export function normalizeProductCode(code) {
  const raw = String(code ?? "").trim();
  if (!raw) return "";
  if (/[a-zA-Z]/.test(raw)) {
    return raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");
  }
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  const stripped = digits.replace(/^0+/, "");
  return stripped || "0";
}

/**
 * Produtos cujo Saldo ChemCtrl na conciliação vem da Industrialização (kg).
 * - 01023021: MP (RawMaterialStock) — Ácido Acético Glacial
 * - 01023175: PA (Container No Pátio) — Sisbrax ACE 75
 */
export const CONCILIACAO_IND_PRODUCTS = [
  {
    code: "01023021",
    name: "ÁCIDO ACÉTICO GLACIAL",
    source: "mp",
  },
  {
    code: "01023175",
    name: "SISBRAX ACE 75",
    source: "pa",
  },
];

export const CONCILIACAO_IND_PRODUCT_CODES = CONCILIACAO_IND_PRODUCTS.map(
  (p) => p.code
);

const CONCILIACAO_IND_CODE_SET = new Set(
  CONCILIACAO_IND_PRODUCT_CODES.map((c) => normalizeProductCode(c))
);

const CONCILIACAO_IND_BY_NORM = new Map(
  CONCILIACAO_IND_PRODUCTS.map((p) => [normalizeProductCode(p.code), p])
);

export function isConciliacaoIndProduct(code) {
  return CONCILIACAO_IND_CODE_SET.has(normalizeProductCode(code));
}

export function getConciliacaoIndProductMeta(code) {
  return CONCILIACAO_IND_BY_NORM.get(normalizeProductCode(code)) || null;
}

export function isConciliacaoIndPaProduct(code) {
  return getConciliacaoIndProductMeta(code)?.source === "pa";
}

export function isConciliacaoIndMpProduct(code) {
  return getConciliacaoIndProductMeta(code)?.source === "mp";
}

/** Converte dígitos unicode (fullwidth / árabe) para ASCII. */
function toAsciiDigits(s) {
  return String(s ?? "").replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30)
  );
}

/**
 * Normaliza lote para chave de comparação.
 * Lotes numéricos: 05003045856 ≡ 5003045856 (BigInt remove zeros à esquerda).
 * Também remove espaços, pontuação e artefatos do Excel.
 */
export function normalizeLot(lote) {
  let s = toAsciiDigits(String(lote ?? "")).trim();
  if (!s) return "";

  // Excel: 5.003045856E+9
  if (/e[+-]?\d+$/i.test(s.replace(",", "."))) {
    const n = Number(s.replace(",", "."));
    if (Number.isFinite(n)) s = String(Math.round(n));
  }

  // 5003045856.0
  if (/^\d+[.,]0+$/.test(s)) {
    s = s.replace(/[.,]0+$/, "");
  }

  const cleaned = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (!cleaned) return "";

  // Lote só com dígitos → BigInt elimina zeros à esquerda de forma definitiva
  if (/^\d+$/.test(cleaned)) {
    try {
      return BigInt(cleaned).toString();
    } catch {
      return cleaned.replace(/^0+/, "") || "0";
    }
  }

  return cleaned.replace(/^0+/, "") || cleaned;
}

export function makeConciliacaoKey(codigo, lote) {
  return `${normalizeProductCode(codigo)}|${normalizeLot(lote)}`;
}

/** Preferir grafia Proteus (sem zero à esquerda quando for o caso). */
export function preferProteusLotSpelling(lotA, lotB) {
  const a = String(lotA ?? "").trim();
  const b = String(lotB ?? "").trim();
  if (!a) return b;
  if (!b) return a;
  const aLead = /^0+/.test(a);
  const bLead = /^0+/.test(b);
  if (aLead && !bLead) return b;
  if (bLead && !aLead) return a;
  return b;
}

function combineSaldoSides(a, b) {
  const na = Number(a) || 0;
  const nb = Number(b) || 0;
  if (na === 0) return nb;
  if (nb === 0) return na;
  if (Math.abs(na - nb) < 0.0005) return na;
  return roundQuantidade(na + nb);
}

function normalizeHeader(header) {
  return String(header ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_/\\]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Índice do cabeçalho com nome exato (após normalização), ou null. */
function findExactHeaderIndex(headers, preferredNormalized) {
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeader(headers[i]) === preferredNormalized) return i;
  }
  return null;
}

/**
 * Identifica colunas pelos nomes preferidos da planilha Proteus.
 * Produto → "Produto"; Lote → "Lote"; Saldo → "Saldo Lote".
 * Se a coluna preferida não existir, deixa em branco para seleção manual.
 * @returns {{ produto: number|null, lote: number|null, saldo: number|null, unidade: number|null, missing: string[] }}
 */
export function detectColumnMapping(headers = []) {
  const mapping = {
    produto: findExactHeaderIndex(headers, PREFERRED_PRODUCT_HEADER),
    lote: findExactHeaderIndex(headers, PREFERRED_LOT_HEADER),
    saldo: findExactHeaderIndex(headers, PREFERRED_BALANCE_HEADER),
    unidade: null,
    missing: [],
  };

  if (mapping.produto == null) mapping.missing.push("Produto / Código");
  if (mapping.lote == null) mapping.missing.push("Lote");
  if (mapping.saldo == null) mapping.missing.push("Saldo / Quantidade");

  return mapping;
}

/**
 * Parse estrito de saldo. Retorna null se o valor for inválido (não numérico).
 * String vazia é tratada como 0.
 */
export function parseSaldoStrict(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") {
    return Number.isFinite(value) ? roundQuantidade(value) : null;
  }
  const s = String(value).trim();
  if (!s) return 0;
  if (!/\d/.test(s) || /[a-zA-Z]/.test(s)) return null;
  const n = parseNumero(s);
  if (!Number.isFinite(n)) return null;
  return roundQuantidade(n);
}

/**
 * Converte valor de célula Excel/CSV para string sem forçar Number.
 * Inteiros (lotes/códigos) evitam notação científica e ".0".
 */
export function cellValueToString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "";
    if (Number.isInteger(value) || Math.abs(value - Math.round(value)) < 1e-9) {
      return String(Math.round(value));
    }
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) {
      return value.richText.map((r) => r.text || "").join("").trim();
    }
    if (value.result != null) return cellValueToString(value.result);
    if (value.sharedFormula != null || value.formula != null) {
      return value.result != null ? cellValueToString(value.result) : "";
    }
    if (value.text != null) return String(value.text).trim();
  }
  return String(value).trim();
}

function excelCellToString(cell) {
  if (!cell) return "";
  const v = cell.value;
  // Preferir valor numérico inteiro (lote) — cell.text pode vir formatado/científico
  if (typeof v === "number" && Number.isFinite(v)) {
    if (Number.isInteger(v) || Math.abs(v - Math.round(v)) < 1e-9) {
      return String(Math.round(v));
    }
  }
  if (cell.text != null && String(cell.text).trim() !== "") {
    const t = String(cell.text).trim();
    if (/e[+-]?\d+$/i.test(t.replace(",", ".")) && typeof v === "number") {
      return String(Math.round(v));
    }
    return t;
  }
  return cellValueToString(v);
}

/**
 * Parser CSV leve (vírgula ou ponto-e-vírgula; aspas).
 */
export function parseCsvText(text) {
  const raw = String(text ?? "").replace(/^\uFEFF/, "");
  if (!raw.trim()) {
    return { headers: [], rows: [], error: "A planilha está vazia." };
  }

  const firstLine = raw.split(/\r?\n/).find((l) => l.trim()) || "";
  const delimiter =
    (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length
      ? ";"
      : ",";

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((c) => String(c).trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    if (row.some((c) => String(c).trim() !== "")) rows.push(row);
  }

  if (!rows.length) {
    return { headers: [], rows: [], error: "A planilha está vazia." };
  }

  const headers = rows[0].map((h) => String(h ?? "").trim());
  const dataRows = rows.slice(1).map((r) => {
    const padded = [...r];
    while (padded.length < headers.length) padded.push("");
    return padded.map((c) => String(c ?? "").trim());
  });

  return { headers, rows: dataRows, error: null };
}

/**
 * Lê arquivo .xlsx / .csv no navegador. .xls legado retorna erro orientativo.
 */
export async function readProteusSpreadsheet(file) {
  if (!file) {
    return { headers: [], rows: [], error: "Nenhum arquivo selecionado." };
  }

  const name = String(file.name || "").toLowerCase();
  const isXlsLegacy =
    name.endsWith(".xls") && !name.endsWith(".xlsx") && !name.endsWith(".xlsm");
  if (isXlsLegacy) {
    return {
      headers: [],
      rows: [],
      error:
        "Arquivos .xls legados não são suportados. Salve como .xlsx no Excel e anexe novamente.",
    };
  }

  if (name.endsWith(".csv") || file.type === "text/csv") {
    const text = await file.text();
    return parseCsvText(text);
  }

  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xlsm") ||
    file.type?.includes("spreadsheet") ||
    file.type?.includes("excel")
  ) {
    const ExcelJS = (await import("exceljs")).default;
    const buffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      return { headers: [], rows: [], error: "A planilha está vazia." };
    }

    const matrix = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = [];
      const maxCol = Math.max(row.cellCount, sheet.columnCount || 0);
      for (let c = 1; c <= maxCol; c++) {
        values.push(excelCellToString(row.getCell(c)));
      }
      if (values.some((v) => v !== "")) matrix.push(values);
    });

    if (!matrix.length) {
      return { headers: [], rows: [], error: "A planilha está vazia." };
    }

    const headers = matrix[0].map((h) => String(h ?? "").trim());
    const colCount = headers.length;
    const dataRows = matrix.slice(1).map((r) => {
      const padded = [...r];
      while (padded.length < colCount) padded.push("");
      return padded.slice(0, colCount).map((c) => String(c ?? "").trim());
    });

    return { headers, rows: dataRows, error: null };
  }

  return {
    headers: [],
    rows: [],
    error: "Formato não suportado. Use .xlsx ou .csv.",
  };
}

/**
 * Extrai linhas Proteus a partir da matriz e do mapeamento de colunas.
 */
export function parseProteusRows(rows, mapping) {
  const parsed = [];
  let skippedEmpty = 0;
  let invalidBalance = 0;

  for (const row of rows) {
    const codigo = cellValueToString(row[mapping.produto]);
    const lote = cellValueToString(row[mapping.lote]);
    const saldoRaw =
      mapping.saldo != null ? row[mapping.saldo] : undefined;
    const unidade =
      mapping.unidade != null
        ? cellValueToString(row[mapping.unidade])
        : "";

    if (!codigo && !lote) {
      skippedEmpty += 1;
      continue;
    }
    if (!codigo || !lote) {
      skippedEmpty += 1;
      continue;
    }

    const saldo = parseSaldoStrict(saldoRaw);
    if (saldo == null) {
      invalidBalance += 1;
      continue;
    }

    parsed.push({
      codigoOriginal: codigo,
      loteOriginal: lote,
      saldo: roundQuantidade(saldo),
      unidade,
      key: makeConciliacaoKey(codigo, lote),
    });
  }

  return { rows: parsed, skippedEmpty, invalidBalance };
}

/**
 * Agrupa por código+lote normalizados e soma saldos se a unidade for compatível.
 * Conflito de unidade → ambiguous: true, saldo: null.
 * Cliente: primeiro valor não vazio encontrado no grupo.
 */
export function consolidateByProductLot(items, accessors) {
  const {
    getCode,
    getLot,
    getBalance,
    getUnit,
    getDisplayCode,
    getDisplayName,
    getDisplayLot,
    getDisplayClient,
  } = accessors;

  const groups = new Map();

  for (const item of items) {
    const code = getCode(item);
    const lot = getLot(item);
    const key = makeConciliacaoKey(code, lot);
    if (!normalizeProductCode(code) || !normalizeLot(lot)) continue;

    const unitRaw = getUnit?.(item) ?? "";
    const unit = unitRaw ? normalizeUnidade(unitRaw) : "";
    const balance = roundQuantidade(getBalance(item));
    const cliente = String(getDisplayClient?.(item) ?? "").trim();

    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        codigoNormalizado: normalizeProductCode(code),
        loteNormalizado: normalizeLot(lot),
        codigoExibicao: getDisplayCode?.(item) ?? String(code ?? ""),
        produtoNome: getDisplayName?.(item) ?? "",
        loteExibicao: getDisplayLot?.(item) ?? String(lot ?? ""),
        cliente,
        unidade: unit,
        saldo: balance,
        ambiguous: false,
        sourceCount: 1,
      };
      groups.set(key, group);
      continue;
    }

    group.sourceCount += 1;

    if (!group.produtoNome && getDisplayName?.(item)) {
      group.produtoNome = getDisplayName(item);
    }
    if (!group.codigoExibicao && getDisplayCode?.(item)) {
      group.codigoExibicao = getDisplayCode(item);
    }
    if (!group.cliente && cliente) {
      group.cliente = cliente;
    }

    if (group.ambiguous) continue;

    const hasUnitA = Boolean(group.unidade);
    const hasUnitB = Boolean(unit);
    if (hasUnitA && hasUnitB && group.unidade !== unit) {
      group.ambiguous = true;
      group.saldo = null;
      continue;
    }

    if (!hasUnitA && hasUnitB) group.unidade = unit;
    group.saldo = roundQuantidade((Number(group.saldo) || 0) + balance);
  }

  return groups;
}

export function buildChemCtrlIndex(estoqueItems = []) {
  const lines = (estoqueItems || []).map((item) => {
    const lote =
      item?.lote ||
      item?.lotes?.[0]?.lote ||
      "";
    return {
      item,
      codigo: item?.produto_codigo ?? "",
      lote,
      saldo: getChemCtrlSaldoEfetivo(item),
      unidade: getItemUnidadeEntrada(item),
    };
  });

  return consolidateByProductLot(lines, {
    getCode: (r) => r.codigo,
    getLot: (r) => r.lote,
    getBalance: (r) => r.saldo,
    getUnit: (r) => r.unidade,
    getDisplayCode: (r) => r.item?.produto_codigo ?? r.codigo,
    getDisplayName: (r) => r.item?.produto_nome ?? "",
    getDisplayLot: (r) =>
      r.item?.lote || r.item?.lotes?.[0]?.lote || r.lote,
    getDisplayClient: (r) => r.item?.cliente_nome ?? "",
  });
}

export function buildProteusIndex(proteusRows = []) {
  return consolidateByProductLot(proteusRows, {
    getCode: (r) => r.codigoOriginal,
    getLot: (r) => r.loteOriginal,
    getBalance: (r) => r.saldo,
    getUnit: (r) => r.unidade,
    getDisplayCode: (r) => r.codigoOriginal,
    getDisplayName: () => "",
    getDisplayLot: (r) => r.loteOriginal,
    getDisplayClient: () => "",
  });
}

/**
 * Índice Industrialização em kg (todas as MPs + PA de override), consolidado por lote.
 * Linhas já podem vir em kg do fetch; se não, converte L/gal/lb → kg.
 */
export function buildIndustrializacaoKgIndex(mpRows = []) {
  const lines = [];
  for (const row of mpRows || []) {
    const codeRaw = row?.mp_code ?? row?.produto_codigo ?? "";
    if (!normalizeProductCode(codeRaw)) continue;
    const meta = getConciliacaoIndProductMeta(codeRaw);
    const qty = Number(row?.current_stock ?? row?.saldo_final) || 0;
    const unit = row?.unit ?? row?.unidade_medida ?? "kg";
    const density = Number(row?.density ?? row?.densidade) || 1;
    const saldoKg = roundQuantidade(convertToKg(qty, unit, density));
    lines.push({
      codigo: meta?.code || codeRaw,
      lote: row?.lot ?? row?.lote ?? "",
      saldo: saldoKg,
      unidade: "kg",
      nome: meta?.name || row?.mp_name || row?.produto_nome || "",
      cliente:
        row?.client ??
        row?.cliente_nome ??
        row?.cliente ??
        "",
    });
  }

  return consolidateByProductLot(lines, {
    getCode: (r) => r.codigo,
    getLot: (r) => r.lote,
    getBalance: (r) => r.saldo,
    getUnit: (r) => r.unidade,
    getDisplayCode: (r) => r.codigo,
    getDisplayName: (r) => r.nome,
    getDisplayLot: (r) => r.lote,
    getDisplayClient: (r) => r.cliente,
  });
}

/**
 * Mapa código normalizado → nome/código/cliente de exibição a partir de todos os
 * registros ChemCtrl (não depende da primeira linha do agrupamento por lote).
 */
export function buildChemCtrlProductCatalog(estoqueItems = []) {
  const catalog = new Map();
  for (const item of estoqueItems || []) {
    const norm = normalizeProductCode(item?.produto_codigo);
    if (!norm) continue;
    const nome = String(item?.produto_nome || "").trim();
    const codigoExibicao = String(item?.produto_codigo || "").trim();
    const cliente = String(item?.cliente_nome || "").trim();
    const current = catalog.get(norm);
    if (!current) {
      catalog.set(norm, { nome, codigoExibicao, cliente });
      continue;
    }
    if (!current.nome && nome) current.nome = nome;
    if (!current.codigoExibicao && codigoExibicao) {
      current.codigoExibicao = codigoExibicao;
    }
    if (!current.cliente && cliente) current.cliente = cliente;
  }
  return catalog;
}

/**
 * Exclui só na montagem do resultado: ChemCtrl zerado e ausente no Proteus.
 * Mantém se existir no Proteus (mesmo com saldo 0) ou se houver saldo em qualquer lado.
 */
export function shouldIncludeConciliacaoRow(row) {
  const inProteus =
    Boolean(row?.matched) ||
    Boolean(row?.onlyProteus) ||
    row?.saldoProteus != null;

  if (inProteus) return true;

  const chem = row?.saldoChemCtrl;
  if (chem == null) return false;
  return Number(chem) !== 0;
}

/**
 * Une linhas do mesmo produto/lote normalizado (ex.: 05003045856 ≡ 5003045856).
 * Grafia do lote: Proteus (sem zero à esquerda quando aplicável).
 */
export function mergeDuplicateLotRows(rows = []) {
  const map = new Map();

  for (const row of rows) {
    const codeNorm =
      row.codigoNormalizado || normalizeProductCode(row.codigo);
    const lotNorm = row.loteNormalizado || normalizeLot(row.lote);
    if (!codeNorm || !lotNorm) continue;

    const mergeKey = `${codeNorm}|${lotNorm}`;
    const prev = map.get(mergeKey);

    if (!prev) {
      map.set(mergeKey, {
        ...row,
        key: mergeKey,
        codigoNormalizado: codeNorm,
        loteNormalizado: lotNorm,
      });
      continue;
    }

    const saldoChemCtrl = combineSaldoSides(
      prev.saldoChemCtrl,
      row.saldoChemCtrl
    );
    const saldoProteus = combineSaldoSides(
      prev.saldoProteus,
      row.saldoProteus
    );

    const prevHadChem =
      prev.matched || prev.onlyChemCtrl || prev.sourceInd || (Number(prev.saldoChemCtrl) || 0) > 0;
    const rowHadChem =
      row.matched || row.onlyChemCtrl || row.sourceInd || (Number(row.saldoChemCtrl) || 0) > 0;
    const prevHadProt =
      prev.matched || prev.onlyProteus || (Number(prev.saldoProteus) || 0) > 0;
    const rowHadProt =
      row.matched || row.onlyProteus || (Number(row.saldoProteus) || 0) > 0;

    const hasChem = prevHadChem || rowHadChem || saldoChemCtrl > 0;
    const hasProt = prevHadProt || rowHadProt || saldoProteus > 0;
    const matched = hasChem && hasProt;
    const diferenca = roundQuantidade(saldoChemCtrl - saldoProteus);

    const lote = preferProteusLotSpelling(prev.lote, row.lote);

    map.set(mergeKey, {
      ...prev,
      key: mergeKey,
      codigo: prev.codigo || row.codigo,
      codigoNormalizado: codeNorm,
      loteNormalizado: lotNorm,
      produto: prev.produto || row.produto || "",
      cliente: prev.cliente || row.cliente || "",
      lote,
      saldoChemCtrl,
      saldoProteus,
      diferenca,
      ambiguous: Boolean(prev.ambiguous || row.ambiguous),
      onlyChemCtrl: hasChem && !hasProt,
      onlyProteus: hasProt && !hasChem,
      matched,
      equal: matched && diferenca === 0,
      divergent: matched && diferenca !== 0,
      sourceInd: Boolean(prev.sourceInd || row.sourceInd),
    });
  }

  return [...map.values()];
}

/**
 * Ordena: agrupa por produto (nome, depois código), matched antes de exclusivos,
 * lotes alfabéticos dentro de cada prioridade.
 */
export function sortConciliacaoRows(rows = []) {
  return [...rows].sort((a, b) => {
    const nameA = String(a.produto || "").trim();
    const nameB = String(b.produto || "").trim();

    if (nameA && !nameB) return -1;
    if (!nameA && nameB) return 1;
    const nameCmp = nameA.localeCompare(nameB, "pt-BR", {
      sensitivity: "base",
      numeric: true,
    });
    if (nameCmp !== 0) return nameCmp;

    const codeNormA = a.codigoNormalizado || normalizeProductCode(a.codigo);
    const codeNormB = b.codigoNormalizado || normalizeProductCode(b.codigo);
    const codeCmp = String(codeNormA).localeCompare(String(codeNormB), "pt-BR", {
      numeric: true,
    });
    if (codeCmp !== 0) return codeCmp;

    const prioA = a.matched ? 0 : 1;
    const prioB = b.matched ? 0 : 1;
    if (prioA !== prioB) return prioA - prioB;

    return String(a.lote || "").localeCompare(String(b.lote || ""), "pt-BR", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

/**
 * Compara índices consolidados (situações A–D).
 * Diferença = ChemCtrl − Proteus.
 * Células de saldo/diferença sem valor saem como 0,000.
 * Saldo ChemCtrl da Industrialização: todas as MPs (por lote) + PA whitelist (kg).
 */
export function reconcileEstoque(
  proteusRows,
  estoqueItems,
  { industrializacaoStocks = [] } = {}
) {
  const chemMap = buildChemCtrlIndex(estoqueItems);
  const proteusMap = buildProteusIndex(proteusRows);
  const indMap = buildIndustrializacaoKgIndex(industrializacaoStocks);
  const productCatalog = buildChemCtrlProductCatalog(estoqueItems);

  // Enriquecer catálogo com nomes/códigos da Industrialização (+ fallback fixo)
  for (const meta of CONCILIACAO_IND_PRODUCTS) {
    const norm = normalizeProductCode(meta.code);
    const current = productCatalog.get(norm);
    if (!current) {
      productCatalog.set(norm, {
        nome: meta.name,
        codigoExibicao: meta.code,
        cliente: "",
      });
    } else {
      if (!current.nome) current.nome = meta.name;
      current.codigoExibicao = meta.code;
    }
  }
  for (const group of indMap.values()) {
    const norm = group.codigoNormalizado;
    if (!norm) continue;
    const meta = getConciliacaoIndProductMeta(norm);
    const preferredCode = meta?.code || group.codigoExibicao || "";
    const preferredName = meta?.name || group.produtoNome || "";
    const preferredClient = String(group.cliente || "").trim();
    const current = productCatalog.get(norm);
    if (!current) {
      productCatalog.set(norm, {
        nome: preferredName,
        codigoExibicao: preferredCode,
        cliente: preferredClient,
      });
    } else {
      if (preferredName) current.nome = preferredName;
      if (preferredCode) current.codigoExibicao = preferredCode;
      if (!current.cliente && preferredClient) {
        current.cliente = preferredClient;
      }
    }
  }

  const keys = new Set([
    ...chemMap.keys(),
    ...proteusMap.keys(),
    ...indMap.keys(),
  ]);
  const rows = [];

  for (const key of keys) {
    const chemTransbordo = chemMap.get(key) || null;
    const proteus = proteusMap.get(key) || null;
    const chemInd = indMap.get(key) || null;

    const codigoHint =
      chemInd?.codigoExibicao ||
      chemTransbordo?.codigoExibicao ||
      proteus?.codigoExibicao ||
      "";
    const codigoNormalizado =
      chemInd?.codigoNormalizado ||
      chemTransbordo?.codigoNormalizado ||
      proteus?.codigoNormalizado ||
      normalizeProductCode(codigoHint);

    // Ind quando há saldo Ind no lote, ou produto PA/MP de override histórico
    const useInd =
      Boolean(chemInd) || isConciliacaoIndProduct(codigoNormalizado);
    const chem = useInd ? chemInd : chemTransbordo;

    const ambiguous = Boolean(chem?.ambiguous || proteus?.ambiguous);
    const hasChem = Boolean(chem) && !chem.ambiguous && chem.saldo != null;
    const hasProteus =
      Boolean(proteus) && !proteus.ambiguous && proteus.saldo != null;

    // Valores brutos (null = ausente) — usados no filtro e nas flags
    let saldoChemRaw = hasChem ? roundQuantidade(chem.saldo) : null;
    let saldoProtRaw = hasProteus ? roundQuantidade(proteus.saldo) : null;

    const catalogEntry = productCatalog.get(codigoNormalizado);
    const codigo =
      catalogEntry?.codigoExibicao ||
      chem?.codigoExibicao ||
      proteus?.codigoExibicao ||
      "";
    const produto =
      catalogEntry?.nome ||
      chem?.produtoNome ||
      chemTransbordo?.produtoNome ||
      chemInd?.produtoNome ||
      "";
    const cliente =
      chem?.cliente ||
      chemTransbordo?.cliente ||
      chemInd?.cliente ||
      catalogEntry?.cliente ||
      "";
    const loteChem =
      chem?.loteExibicao || chemTransbordo?.loteExibicao || "";
    const loteProt = proteus?.loteExibicao || "";
    // Preferir grafia Proteus; se só ChemCtrl, usa ChemCtrl
    const lote = hasProteus
      ? loteProt || loteChem
      : preferProteusLotSpelling(loteChem, loteProt) || loteChem;
    const loteNormalizado =
      chem?.loteNormalizado ||
      proteus?.loteNormalizado ||
      normalizeLot(lote);

    const draft = {
      key: `${codigoNormalizado}|${loteNormalizado}`,
      codigo,
      codigoNormalizado,
      produto,
      cliente,
      lote,
      loteNormalizado,
      saldoChemCtrl: saldoChemRaw,
      saldoProteus: saldoProtRaw,
      diferenca: null,
      ambiguous,
      onlyChemCtrl: hasChem && !hasProteus && !ambiguous,
      onlyProteus: hasProteus && !hasChem && !ambiguous,
      matched: hasChem && hasProteus,
      equal: false,
      divergent: false,
      sourceInd: useInd && hasChem,
    };

    if (!shouldIncludeConciliacaoRow(draft)) continue;

    // Preencher células em branco com 0,000 e calcular diferença sempre
    const saldoChemCtrl = saldoChemRaw == null ? 0 : saldoChemRaw;
    const saldoProteus = saldoProtRaw == null ? 0 : saldoProtRaw;
    const diferenca = roundQuantidade(saldoChemCtrl - saldoProteus);

    draft.saldoChemCtrl = saldoChemCtrl;
    draft.saldoProteus = saldoProteus;
    draft.diferenca = diferenca;
    draft.equal = draft.matched && diferenca === 0;
    draft.divergent = draft.matched && diferenca !== 0;

    rows.push(draft);
  }

  // Sempre reagrupar por lote normalizado (zeros à esquerda, etc.)
  const merged = mergeDuplicateLotRows(rows);
  const sorted = sortConciliacaoRows(merged);

  return {
    rows: sorted,
    summary: buildConciliacaoSummary(sorted),
  };
}

export function buildConciliacaoSummary(rows = []) {
  let matched = 0;
  let onlyChemCtrl = 0;
  let onlyProteus = 0;
  let equal = 0;
  let divergent = 0;
  let ambiguous = 0;

  for (const row of rows) {
    if (row.ambiguous) {
      ambiguous += 1;
      continue;
    }
    if (row.matched) {
      matched += 1;
      if (row.equal) equal += 1;
      else if (row.divergent) divergent += 1;
    } else if (row.onlyChemCtrl) {
      onlyChemCtrl += 1;
    } else if (row.onlyProteus) {
      onlyProteus += 1;
    }
  }

  return {
    matched,
    onlyChemCtrl,
    onlyProteus,
    equal,
    divergent,
    ambiguous,
    total: rows.length,
  };
}
