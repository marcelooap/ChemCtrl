/**
 * Preenche cliente_nome (e cliente_id quando possível) em cadastro_produtos
 * para MPs que vieram das receitas sem cliente.
 *
 * Uso: node scripts/fix-cadastro-produtos-mp-cliente.mjs
 *      node scripts/fix-cadastro-produtos-mp-cliente.mjs --dry-run
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

function loadEnv(filePath) {
  const env = {};
  try {
    for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[trimmed.slice(0, eq).trim()] = value;
    }
  } catch {
    // ignore
  }
  return env;
}

function norm(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseRawMaterials(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function fetchAll(url, key, table, select) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: 'count=exact',
  };
  const pageSize = 1000;
  let offset = 0;
  const rows = [];
  while (true) {
    const qs = new URLSearchParams({
      select,
      limit: String(pageSize),
      offset: String(offset),
    });
    const resp = await fetch(`${url}/rest/v1/${table}?${qs}`, { headers });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`${table}: ${resp.status} ${text.slice(0, 200)}`);
    const chunk = text ? JSON.parse(text) : [];
    rows.push(...chunk);
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function patchProduto(url, key, id, payload) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  const resp = await fetch(`${url}/rest/v1/cadastro_produtos?id=eq.${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`patch ${id}: ${resp.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const env = { ...loadEnv(resolve(root, '.env')), ...process.env };
  const url = (env.VITE_CHEMFLOW_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');
  const anonKey = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();
  if (!url || !anonKey) {
    console.error('Credenciais VITE_CHEMFLOW_SUPABASE_* ausentes');
    process.exit(2);
  }

  const [produtos, clientes, receitas] = await Promise.all([
    fetchAll(
      url,
      anonKey,
      'cadastro_produtos',
      'id,codigo,produto,cliente_id,cliente_nome,origem'
    ),
    fetchAll(url, anonKey, 't_clientes', 'id,nome'),
    fetchAll(
      url,
      anonKey,
      'receitas',
      'id,code,product_name,client,raw_materials,mp_code,mp_name'
    ).catch(async () =>
      // fallback se colunas 047 ainda não existirem
      fetchAll(
        url,
        anonKey,
        'receitas',
        'id,code,product_name,client,raw_materials'
      )
    ),
  ]);

  const clienteByNome = new Map();
  for (const c of clientes) {
    const k = norm(c.nome);
    if (k && !clienteByNome.has(k)) clienteByNome.set(k, c);
  }

  // mpKey (codigo|nome) -> Map(normClient -> { nome, count })
  const mpClients = new Map();

  const addMpClient = (code, name, client) => {
    const c = String(client || '').trim();
    if (!c) return;
    const ck = norm(code);
    const nk = norm(name);
    if (!ck || !nk) return;
    const mpKey = `${ck}|${nk}`;
    if (!mpClients.has(mpKey)) mpClients.set(mpKey, new Map());
    const m = mpClients.get(mpKey);
    const cn = norm(c);
    const prev = m.get(cn);
    m.set(cn, { nome: c, count: (prev?.count || 0) + 1 });
  };

  const pickClient = (clientsMap) => {
    if (!clientsMap || clientsMap.size === 0) return null;
    // Cliente mais frequente nas receitas; empate → ordem alfabética estável
    return [...clientsMap.values()].sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.nome.localeCompare(b.nome, 'pt-BR');
    })[0].nome;
  };

  for (const r of receitas) {
    const recipeClient = r.client || r.cliente_nome || '';
    // Produto acabado da receita
    if (r.code && r.product_name) {
      addMpClient(r.code, r.product_name, recipeClient);
    }
    // Modelo linha (047): MP nas colunas
    if (r.mp_code && r.mp_name) {
      addMpClient(r.mp_code, r.mp_name, recipeClient);
    }
    // Modelo legado / coluna raw_materials
    for (const mp of parseRawMaterials(r.raw_materials)) {
      addMpClient(mp.mp_code, mp.mp_name, recipeClient);
    }
  }

  let candidates = 0;
  let updated = 0;
  let skippedAmbiguous = 0;
  let skippedNoMatch = 0;
  const samples = [];

  for (const p of produtos) {
    const nomeAtual = String(p.cliente_nome || '').trim();
    const hasClient =
      (nomeAtual && nomeAtual !== '-') || p.cliente_id;
    if (hasClient) continue;

    const mpKey = `${norm(p.codigo)}|${norm(p.produto)}`;
    const clients = mpClients.get(mpKey);
    const clienteNome = pickClient(clients);
    if (!clienteNome) {
      skippedNoMatch += 1;
      continue;
    }
    if (clients.size > 1) {
      skippedAmbiguous += 1; // preenchido com o mais frequente
    }

    const cliente = clienteByNome.get(norm(clienteNome));
    const payload = {
      cliente_nome: clienteNome,
      cliente_id: cliente?.id || null,
    };
    candidates += 1;
    if (samples.length < 20) {
      samples.push({
        id: p.id,
        codigo: p.codigo,
        produto: p.produto,
        clients_in_recipes: clients.size,
        ...payload,
      });
    }
    if (!dryRun) {
      await patchProduto(url, anonKey, p.id, payload);
      updated += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        produtos: produtos.length,
        receitas: receitas.length,
        mp_keys_with_client: mpClients.size,
        candidates_to_update: candidates,
        updated: dryRun ? 0 : updated,
        skipped_no_recipe_client: skippedNoMatch,
        skipped_ambiguous: skippedAmbiguous,
        samples,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
