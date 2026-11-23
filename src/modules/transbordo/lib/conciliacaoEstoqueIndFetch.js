import { base44 } from "@industrializacao/api/base44Client";
import {
  containerDensity,
  containerDisplayVolume,
} from "@industrializacao/lib/fractionalSupply";
import { convertToKg } from "@industrializacao/lib/productionViewUtils";
import { normalizeProductMatchKey } from "@industrializacao/lib/recipeRevisions";
import { roundQuantidade } from "@transbordo/lib/format";
import {
  CONCILIACAO_IND_PRODUCTS,
  getConciliacaoIndProductMeta,
  normalizeProductCode,
} from "@transbordo/lib/conciliacaoEstoque";

async function listAll(entityName, pageSize = 1000, maxRows = 20000) {
  const out = [];
  const seen = new Set();
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const rows = await base44.entities[entityName].list(
      "-created_date",
      pageSize,
      { offset }
    );
    const batch = Array.isArray(rows) ? rows : [];
    let added = 0;
    for (const row of batch) {
      const id = row?.id != null ? String(row.id) : "";
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      out.push(row);
      added += 1;
    }
    if (batch.length < pageSize || added === 0) break;
  }
  return out;
}

/**
 * Todas as matérias-primas da Industrialização (RawMaterialStock),
 * convertidas para kg e com cliente do cadastro quando disponível.
 */
async function fetchMpStocksAsLines() {
  const byId = new Map();

  try {
    const all = await listAll("RawMaterialStock");
    for (const row of all) {
      const code = String(row?.mp_code ?? "").trim();
      if (!normalizeProductCode(code)) continue;
      const id = row?.id != null ? String(row.id) : "";
      if (id) byId.set(id, row);
      else byId.set(`${row?.mp_code}|${row?.lot}|${byId.size}`, row);
    }
  } catch (err) {
    console.warn("[Conciliação] RawMaterialStock.list", err);
  }

  const lines = [];
  for (const row of byId.values()) {
    const meta = getConciliacaoIndProductMeta(row.mp_code);
    const qty = Number(row.current_stock) || 0;
    const unit = row.unit || "kg";
    const density = Number(row.density) || 1;
    lines.push({
      id: row.id,
      mp_code: meta?.code || row.mp_code,
      mp_name: row.mp_name || meta?.name || "",
      client: String(row.client || row.cliente_nome || "").trim(),
      lot: row.lot || "",
      current_stock: roundQuantidade(convertToKg(qty, unit, density)),
      unit: "kg",
      density: 1,
      _source: "mp",
    });
  }
  return lines;
}

/**
 * PA (Sisbrax ACE 75): Containers No Pátio → kg via volume × densidade.
 */
async function fetchPaContainersAsLines() {
  const paProducts = CONCILIACAO_IND_PRODUCTS.filter((p) => p.source === "pa");
  if (!paProducts.length) return [];

  let recipes = [];
  let productions = [];
  let containers = [];

  try {
    [recipes, productions, containers] = await Promise.all([
      listAll("Recipe", 1000, 5000),
      listAll("Production", 1000, 10000),
      listAll("Container", 1000, 20000),
    ]);
  } catch (err) {
    console.warn("[Conciliação] PA Industrialização:", err);
    return [];
  }

  // Nome da receita → meta do produto + cliente cadastrado na receita
  const metaByProductKey = new Map();
  const clientByProductKey = new Map();
  for (const recipe of recipes) {
    const meta = getConciliacaoIndProductMeta(recipe?.code);
    if (!meta || meta.source !== "pa") continue;
    const key = normalizeProductMatchKey(recipe?.product_name);
    if (key) {
      metaByProductKey.set(key, meta);
      const recipeClient = String(recipe?.client || "").trim();
      if (recipeClient && !clientByProductKey.has(key)) {
        clientByProductKey.set(key, recipeClient);
      }
    }
  }

  // Fallback: casar pelo nome cadastrado (SISBRAX ACE 75 / variantes)
  for (const p of paProducts) {
    const key = normalizeProductMatchKey(p.name);
    if (key && !metaByProductKey.has(key)) metaByProductKey.set(key, p);
    // Variante comum "SISBRAX ACE 75 T"
    const keyT = normalizeProductMatchKey(`${p.name} T`);
    if (keyT && !metaByProductKey.has(keyT)) metaByProductKey.set(keyT, p);
  }

  const lines = [];
  for (const container of containers) {
    if (String(container?.status || "").trim() !== "No Pátio") continue;

    const productKey = normalizeProductMatchKey(container?.product);
    let meta = metaByProductKey.get(productKey) || null;

    // Fallback textual: contém "sisbrax" + "ace" + "75"
    if (!meta) {
      const raw = String(container?.product || "").toLowerCase();
      if (raw.includes("sisbrax") && raw.includes("ace") && raw.includes("75")) {
        meta = paProducts[0];
      }
    }
    if (!meta) continue;

    const volumeL = containerDisplayVolume(container, productions);
    const density = containerDensity(container, productions, recipes) || 1;
    const saldoKg = roundQuantidade(convertToKg(volumeL, "L", density));
    if (!(saldoKg > 0) && saldoKg !== 0) continue;

    const client =
      String(container.client || container.cliente_nome || "").trim() ||
      clientByProductKey.get(productKey) ||
      "";

    lines.push({
      id: container.id,
      mp_code: meta.code,
      mp_name: meta.name,
      client,
      lot: container.lot || "",
      current_stock: saldoKg,
      unit: "kg",
      density: 1,
      _source: "pa",
    });
  }

  return lines;
}

/**
 * Carrega saldos da Industrialização para a conciliação (todas as MPs + PA), já em kg.
 * Formato compatível com buildIndustrializacaoKgIndex.
 */
export async function fetchIndustrializacaoStocksForConciliacao() {
  const [mpLines, paLines] = await Promise.all([
    fetchMpStocksAsLines(),
    fetchPaContainersAsLines(),
  ]);
  return [...mpLines, ...paLines];
}
