/**
 * JSON backup of estoque_produtos via PostgREST (anon key).
 * Complements Pro PITR; use DATABASE_URL backup when available for schema+restore test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

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
if (!url || !key) {
  console.error('Missing Supabase URL/anon key in .env');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(root, 'database', 'backups');
fs.mkdirSync(backupDir, { recursive: true });

async function main() {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  for (;;) {
    const res = await fetch(
      `${url}/rest/v1/estoque_produtos?select=*&order=id.asc&offset=${from}&limit=${pageSize}`,
      { headers }
    );
    if (!res.ok) throw new Error(`select failed ${res.status}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }

  const payload = JSON.stringify(rows);
  const checksum = crypto.createHash('md5').update(payload).digest('hex');
  const dataPath = path.join(backupDir, `estoque_produtos_rest_${stamp}.json`);
  fs.writeFileSync(dataPath, payload, 'utf8');

  // Round-trip integrity: re-read file and compare hash
  const reread = fs.readFileSync(dataPath, 'utf8');
  const checksum2 = crypto.createHash('md5').update(reread).digest('hex');
  const report = {
    dataPath,
    rows: rows.length,
    bytes: Buffer.byteLength(payload),
    md5: checksum,
    reread_md5: checksum2,
    integrity_ok: checksum === checksum2,
    by_origem: rows.reduce((acc, r) => {
      acc[r.origem || '(null)'] = (acc[r.origem || '(null)'] || 0) + 1;
      return acc;
    }, {}),
    columns: rows[0] ? Object.keys(rows[0]).sort() : [],
  };
  const reportPath = path.join(backupDir, `estoque_produtos_rest_report_${stamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (!report.integrity_ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
