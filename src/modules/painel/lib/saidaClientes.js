import { base44 } from "@industrializacao/api/base44Client";
import { ensureClienteByNome } from "@transbordo/lib/ensureCliente";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/** Entidades da Industrialização que guardam o cliente como texto. */
const IND_CLIENT_SOURCES = [
  ["Recipe", "client"],
  ["RawMaterialStock", "client"],
  ["Container", "client"],
  ["Order", "client"],
  ["Production", "client"],
  ["Tank", "client"],
  ["Transfer", "client"],
  ["StockMovement", "client"],
  ["QualityTest", "client"],
  ["IndValidacao", "cliente_nome"],
];

function isUuid(value) {
  return UUID_RE.test(String(value || ""));
}

async function collectColumn(entity, column) {
  const names = [];
  let previousFirstId = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await entity.list("id", PAGE_SIZE, {
      select: `id,${column}`,
      offset: page * PAGE_SIZE,
    });
    const list = Array.isArray(rows) ? rows : [];
    if (list.length === 0) break;
    const firstId = list[0]?.id ?? null;
    if (page > 0 && firstId && firstId === previousFirstId) break;
    previousFirstId = firstId;
    for (const row of list) {
      if (row?.[column]) names.push(row[column]);
    }
    if (list.length < PAGE_SIZE) break;
  }
  return names;
}

/** Nomes de cliente usados no módulo Industrialização. */
export async function listNomesClientesIndustrializacao() {
  const lists = await Promise.all(
    IND_CLIENT_SOURCES.map(async ([entityName, column]) => {
      const entity = base44.entities?.[entityName];
      if (!entity?.list) return [];
      try {
        return await collectColumn(entity, column);
      } catch (err) {
        console.warn(
          `[saidaClientes] Falha ao ler ${entityName}.${column}:`,
          err?.message || err
        );
        return [];
      }
    })
  );
  return lists.flat();
}

/**
 * Cliente só da Industrialização entra na lista com id temporário.
 * Na gravação, reutiliza ou cria o registro em `t_clientes` para respeitar a FK.
 */
export async function persistClienteSelecionado(clienteId, clienteNome) {
  const nome = String(clienteNome || "").trim();
  if (isUuid(clienteId)) return { id: clienteId, nome };
  const ensured = await ensureClienteByNome(nome);
  if (!ensured?.id) return { id: null, nome };
  return { id: ensured.id, nome: ensured.nome || nome };
}
