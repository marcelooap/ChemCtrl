/**
 * Read-only audit: FK orphans, initial_stock divergence, densidade, legacy columns, RLS probe.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function loadEnv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...loadEnv(path.join(root, '.env')), ...process.env };
const url = env.VITE_CHEMFLOW_SUPABASE_URL;
const key = env.VITE_CHEMFLOW_SUPABASE_ANON_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function fetchAll(table, select, filter = '') {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const q = `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}${filter}&order=id.asc&offset=${from}&limit=${pageSize}`;
    const res = await fetch(q, { headers });
    if (!res.ok) throw new Error(`${table} ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchAllByPk(table, select, pk = 'id') {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const q = `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=${pk}.asc&offset=${from}&limit=${pageSize}`;
    const res = await fetch(q, { headers });
    if (!res.ok) throw new Error(`${table} ${res.status} ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function isNumericDensity(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  return /^-?[0-9]+([.][0-9]+)?$/.test(s);
}

function tryNormalizeDensity(v) {
  if (v == null) return { kind: 'null' };
  let s = String(v).trim();
  if (!s) return { kind: 'empty' };
  if (/^-?[0-9]+([.][0-9]+)?$/.test(s)) {
    return { kind: 'already_numeric', normalized: s };
  }
  const comma = s.replace(',', '.');
  if (/^-?[0-9]+([.][0-9]+)?$/.test(comma)) {
    return { kind: 'comma_decimal', original: s, normalized: comma };
  }
  const digitsOnly = s.replace(/[^0-9.,-]/g, '').replace(',', '.');
  if (/^-?[0-9]+([.][0-9]+)?$/.test(digitsOnly) && digitsOnly !== s) {
    return { kind: 'strip_units_ambiguous', original: s, normalized: digitsOnly };
  }
  return { kind: 'manual_review', original: s };
}

async function main() {
  const ep = await fetchAllByPk(
    'estoque_produtos',
    'id,origem,produto_id,cliente_id,vasilhame_id,produto_codigo,cliente_nome,id_entrada,legacy_entrada_codigo,legacy_mp_entry_id,initial_stock,quantidade,densidade,legacy_estoque_id,legacy_mp_id_text,data,created_at',
    'id'
  );

  let produtos = [];
  let clientes = [];
  let vasilhames = [];
  const refErrors = {};

  for (const t of ['cadastro_produtos', 't_produtos']) {
    try {
      produtos = await fetchAll(t, 'id,codigo,produto');
      if (produtos.length) break;
    } catch (e) {
      refErrors[t] = String(e.message || e);
    }
  }
  try {
    clientes = await fetchAllByPk('t_clientes', 'id,nome');
  } catch (e) {
    refErrors.t_clientes = String(e.message || e);
  }
  try {
    vasilhames = await fetchAllByPk('t_vasilhames', 'id,placa,barril');
  } catch (e) {
    refErrors.t_vasilhames = String(e.message || e);
  }

  const prodSet = new Set(produtos.map((p) => p.id));
  const cliSet = new Set(clientes.map((c) => c.id));
  const vasSet = new Set(vasilhames.map((v) => v.id));

  const fk = {
    produto_id: { filled: 0, null: 0, orphan: [], orphan_count: 0 },
    cliente_id: { filled: 0, null: 0, orphan: [], orphan_count: 0 },
    vasilhame_id: { filled: 0, null: 0, orphan: [], orphan_count: 0 },
  };

  for (const r of ep) {
    for (const col of ['produto_id', 'cliente_id', 'vasilhame_id']) {
      const v = r[col];
      if (v == null) {
        fk[col].null += 1;
        continue;
      }
      fk[col].filled += 1;
      const set = col === 'produto_id' ? prodSet : col === 'cliente_id' ? cliSet : vasSet;
      if (!set.has(v)) {
        fk[col].orphan_count += 1;
        if (fk[col].orphan.length < 50) {
          fk[col].orphan.push({
            ep_id: r.id,
            origem: r.origem,
            value: v,
            produto_codigo: r.produto_codigo,
            cliente_nome: r.cliente_nome,
          });
        }
      }
    }
  }

  const initialStockDiv = ep.filter(
    (r) =>
      r.origem === 'ARMAZENAGEM' &&
      Number(r.initial_stock) !== Number(r.quantidade)
  );

  const densidadeIssues = ep
    .filter((r) => !isNumericDensity(r.densidade))
    .map((r) => ({
      id: r.id,
      origem: r.origem,
      produto_codigo: r.produto_codigo,
      densidade: r.densidade,
      normalize: tryNormalizeDensity(r.densidade),
    }));

  const legacyEntrada = ep.filter(
    (r) => r.legacy_entrada_codigo != null && String(r.legacy_entrada_codigo).trim() !== ''
  );
  const legacyEntradaVsId = legacyEntrada.map((r) => ({
    id: r.id,
    id_entrada: r.id_entrada,
    legacy_entrada_codigo: r.legacy_entrada_codigo,
    same_as_id_entrada: String(r.legacy_entrada_codigo) === String(r.id_entrada),
    looks_legacy_mp: /^MP/i.test(String(r.legacy_entrada_codigo)),
    looks_e_code: /^E[0-9]+$/i.test(String(r.legacy_entrada_codigo)),
  }));
  const legacyMpEntry = ep.filter(
    (r) => r.legacy_mp_entry_id != null && String(r.legacy_mp_entry_id).trim() !== ''
  );
  const legacyMpVsId = legacyMpEntry.map((r) => ({
    id: r.id,
    origem: r.origem,
    id_entrada: r.id_entrada,
    legacy_mp_entry_id: r.legacy_mp_entry_id,
    same_as_id_entrada: String(r.legacy_mp_entry_id) === String(r.id_entrada),
    looks_mp_prefix: /^MP/i.test(String(r.legacy_mp_entry_id)),
  }));

  // RLS probe: anon without session can mutate?
  const rlsProbe = {};
  const probeRes = await fetch(`${url}/rest/v1/estoque_produtos?select=id&limit=1`, { headers });
  rlsProbe.anon_select_ok = probeRes.ok;
  rlsProbe.anon_select_status = probeRes.status;

  const noSessionHeaders = { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'return=minimal' };
  const fakeUpdate = await fetch(`${url}/rest/v1/estoque_produtos?id=eq.-999999999`, {
    method: 'PATCH',
    headers: { ...noSessionHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
  });
  rlsProbe.anon_update_without_session_status = fakeUpdate.status;
  rlsProbe.anon_update_allowed = fakeUpdate.status >= 200 && fakeUpdate.status < 300;

  const report = {
    generated_at: new Date().toISOString(),
    row_count: ep.length,
    ref_tables: {
      cadastro_produtos_count: produtos.length,
      t_clientes_count: clientes.length,
      t_vasilhames_count: vasilhames.length,
      refErrors,
    },
    foreign_keys: fk,
    initial_stock_divergence_armazenagem: initialStockDiv,
    densidade: {
      non_numeric_count: densidadeIssues.length,
      by_normalize_kind: densidadeIssues.reduce((acc, d) => {
        const k = d.normalize.kind;
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
      rows: densidadeIssues,
    },
    legacy_entrada_codigo: {
      filled: legacyEntrada.length,
      same_as_id_entrada: legacyEntradaVsId.filter((x) => x.same_as_id_entrada).length,
      sample_diff: legacyEntradaVsId.filter((x) => !x.same_as_id_entrada).slice(0, 30),
      all_patterns: legacyEntradaVsId,
    },
    legacy_mp_entry_id: {
      filled: legacyMpEntry.length,
      same_as_id_entrada: legacyMpVsId.filter((x) => x.same_as_id_entrada).length,
      sample_diff: legacyMpVsId.filter((x) => !x.same_as_id_entrada).slice(0, 30),
      all_patterns: legacyMpVsId,
    },
    rls_probe: rlsProbe,
    fk_ready:
      fk.produto_id.orphan_count === 0 &&
      fk.cliente_id.orphan_count === 0 &&
      fk.vasilhame_id.orphan_count === 0,
  };

  const outPath = path.join(root, 'database', 'audit', '02_pendencias_estoque_produtos.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(
    JSON.stringify(
      {
        wrote: outPath,
        fk_orphans: {
          produto_id: fk.produto_id.orphan_count,
          cliente_id: fk.cliente_id.orphan_count,
          vasilhame_id: fk.vasilhame_id.orphan_count,
        },
        fk_ready: report.fk_ready,
        initial_stock_div: initialStockDiv.length,
        densidade_non_numeric: densidadeIssues.length,
        legacy_entrada_filled: legacyEntrada.length,
        legacy_mp_entry_filled: legacyMpEntry.length,
        rls_probe: report.rls_probe,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
