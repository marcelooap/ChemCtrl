/**
 * Unifica itens unitários (bombona/IBC/tambor) duplicados em t_saidas.itens
 * após a consolidação dos vasilhames (mesmo vasilhame_id / envase).
 *
 * Uso:
 *   node scripts/consolidate-saida-unitario-itens.mjs --dry-run
 *   node scripts/consolidate-saida-unitario-itens.mjs
 *   node scripts/consolidate-saida-unitario-itens.mjs --codigo=S140
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TIPOS_UNIT = /bombona|tambor|ibc|one\s*way/i;

function loadEnv(filePath) {
  const env = {};
  try {
    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    // ignore
  }
  return env;
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function isUnitarioItem(item) {
  if (item?.tipo !== 'convencional' && item?.tipo !== 'ind_vasilhame') return false;
  if (TIPOS_UNIT.test(String(item.tipo_embalagem || item.container_type || ''))) {
    return true;
  }
  return /^\d+\s*x\s+/i.test(String(item.vasilhame_placa || ''));
}

function qtdEmb(item) {
  const explicit = Math.round(Number(item.quantidade_embalagens) || 0);
  if (explicit > 0) return explicit;
  const volPor = Number(item.volume_por_embalagem) || 0;
  const vol = Number(item.volume_solicitado) || 0;
  if (volPor > 0 && vol > 0) return Math.max(1, Math.round(vol / volPor));
  return 1;
}

function groupKey(item) {
  const produto = String(item.produto_nome || item.produto_id || '')
    .trim()
    .toLowerCase();
  const lote = String(item.lote || '').trim().toLowerCase();
  if (item.tipo === 'convencional') {
    const id = String(item.vasilhame_id || '').trim();
    const placa = String(item.vasilhame_placa || '')
      .trim()
      .toLowerCase()
      .replace(/^\d+\s*x\s+/i, '');
    return `tb:${id || placa}|${produto}|${lote}`;
  }
  const id = String(item.container_id || '').trim();
  const placa = String(item.vasilhame_placa || item.container_type || '')
    .trim()
    .toLowerCase()
    .replace(/^\d+\s*x\s+/i, '');
  return `ind:${id || placa}|${produto}|${lote}`;
}

function buildPlaca(qtd, tipolike) {
  const n = String(Math.max(0, Math.round(Number(qtd) || 0))).padStart(2, '0');
  const raw = String(tipolike || 'Bombonas').trim();
  const m = raw.match(/^\d+\s*x\s+(.+)$/i);
  const label = m ? m[1] : raw.replace(/^\d+\s*x\s+/i, '');
  let plural = label;
  const lower = plural.toLowerCase();
  if (lower.startsWith('bombona ')) plural = `Bombonas ${plural.slice(plural.indexOf(' ') + 1)}`;
  else if (lower === 'bombona') plural = 'Bombonas';
  else if (lower.startsWith('tambor ')) plural = `Tambores ${plural.slice(plural.indexOf(' ') + 1)}`;
  return `${n} x ${plural}`;
}

function aggregateItens(itens) {
  const out = [];
  const idx = new Map();
  let merged = 0;

  for (const item of itens || []) {
    if (!isUnitarioItem(item)) {
      out.push(item);
      continue;
    }
    const key = groupKey(item);
    const qtd = qtdEmb(item);
    const existing = idx.get(key);
    if (existing == null) {
      idx.set(key, out.length);
      out.push({
        ...item,
        quantidade_embalagens: qtd,
        vasilhame_placa: buildPlaca(
          qtd,
          item.vasilhame_placa || item.tipo_embalagem || item.container_type
        ),
      });
      continue;
    }
    const acc = out[existing];
    const qtdTotal = (Number(acc.quantidade_embalagens) || 0) + qtd;
    out[existing] = {
      ...acc,
      volume_solicitado: round3(
        (Number(acc.volume_solicitado) || 0) + (Number(item.volume_solicitado) || 0)
      ),
      peso_liquido: round3(
        (Number(acc.peso_liquido) || 0) + (Number(item.peso_liquido) || 0)
      ),
      peso_bruto: round3(
        (Number(acc.peso_bruto) || 0) + (Number(item.peso_bruto) || 0)
      ),
      quantidade_solicitada: round3(
        (Number(acc.quantidade_solicitada) || 0) +
          (Number(item.quantidade_solicitada) || 0)
      ),
      quantidade_embalagens: qtdTotal,
      vasilhame_placa: buildPlaca(
        qtdTotal,
        acc.vasilhame_placa || item.vasilhame_placa || item.tipo_embalagem
      ),
    };
    merged += 1;
  }

  return { itens: out, merged };
}

async function fetchAll(supabase, table) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const chunk = data || [];
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const codigoArg = process.argv.find((a) => a.startsWith('--codigo='));
  const onlyCodigo = codigoArg ? codigoArg.split('=')[1].trim().toUpperCase() : null;

  const root = resolve(process.cwd());
  const env = {
    ...loadEnv(resolve(root, '.env')),
    ...loadEnv(resolve(root, '.env.local')),
    ...process.env,
  };
  const url = (env.VITE_CHEMFLOW_SUPABASE_URL || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '');
  const key = (env.VITE_CHEMFLOW_SUPABASE_ANON_KEY || '').trim();
  if (!url || !key) {
    console.error('Configure VITE_CHEMFLOW_SUPABASE_URL e VITE_CHEMFLOW_SUPABASE_ANON_KEY');
    process.exit(1);
  }
  const supabase = createClient(url, key);
  let saidas = await fetchAll(supabase, 't_saidas');
  if (onlyCodigo) {
    saidas = saidas.filter(
      (s) => String(s.codigo || '').trim().toUpperCase() === onlyCodigo
    );
  }

  let saidasTouched = 0;
  let linesRemoved = 0;

  for (const saida of saidas) {
    const before = saida.itens || [];
    const { itens, merged } = aggregateItens(before);
    if (merged <= 0 || itens.length === before.length) continue;

    console.log(
      `${saida.codigo || saida.id}: ${before.length} → ${itens.length} itens (unificados ${before.length - itens.length})`
    );
    saidasTouched += 1;
    linesRemoved += before.length - itens.length;

    if (dryRun) continue;

    const { error } = await supabase
      .from('t_saidas')
      .update({ itens })
      .eq('id', saida.id);
    if (error) throw new Error(`${saida.codigo}: ${error.message}`);
  }

  console.log(
    `\n${dryRun ? '[dry-run] ' : ''}Saídas atualizadas: ${saidasTouched} | linhas removidas: ${linesRemoved}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
