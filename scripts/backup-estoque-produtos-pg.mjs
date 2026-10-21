/**
 * Backup estoque_produtos (+ _entrada_id_map) via DATABASE_URL using node-pg.
 * Also validates restore into temporary schema _restore_check.
 *
 * Usage: $env:DATABASE_URL='postgresql://...'; node scripts/backup-estoque-produtos-pg.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set in this session.');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(root, 'database', 'backups');
fs.mkdirSync(backupDir, { recursive: true });

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

async function q(sql, params) {
  return (await client.query(sql, params)).rows;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function dumpTable(tableName) {
  const cols = await q(
    `SELECT column_name, data_type, udt_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [tableName]
  );
  const colNames = cols.map((c) => c.column_name);
  const rows = await q(`SELECT * FROM public.${tableName} ORDER BY 1`);
  const lines = [];
  lines.push(`-- Backup of public.${tableName} @ ${new Date().toISOString()}`);
  lines.push(`-- rows=${rows.length}`);
  lines.push(`CREATE SCHEMA IF NOT EXISTS _restore_check;`);
  const colDefs = cols.map((c) => {
    let t = c.data_type;
    if (c.udt_name === 'uuid') t = 'uuid';
    else if (c.udt_name === 'jsonb') t = 'jsonb';
    else if (c.udt_name === 'bool') t = 'boolean';
    else if (c.udt_name === 'int4') t = 'integer';
    else if (c.udt_name === 'int8') t = 'bigint';
    else if (c.udt_name === 'numeric') t = 'numeric';
    else if (c.udt_name === 'timestamptz') t = 'timestamptz';
    else if (c.udt_name === 'date') t = 'date';
    else if (c.udt_name === 'text') t = 'text';
    else t = c.udt_name || t;
    return `  ${c.column_name} ${t}`;
  });
  lines.push(`DROP TABLE IF EXISTS _restore_check.${tableName};`);
  lines.push(`CREATE TABLE _restore_check.${tableName} (`);
  lines.push(colDefs.join(',\n'));
  lines.push(');');
  for (const row of rows) {
    const vals = colNames.map((c) => sqlLiteral(row[c]));
    lines.push(
      `INSERT INTO _restore_check.${tableName} (${colNames.join(', ')}) VALUES (${vals.join(', ')});`
    );
  }
  return { sql: lines.join('\n'), count: rows.length, colNames };
}

async function main() {
  await client.connect();

  // Schema dump via information_schema + indexes
  const schemaParts = [];
  schemaParts.push(`-- schema-only snapshot ${new Date().toISOString()}`);
  const cols = await q(`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='estoque_produtos'
    ORDER BY ordinal_position
  `);
  schemaParts.push(JSON.stringify({ columns: cols }, null, 2));
  const indexes = await q(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename='estoque_produtos'
    ORDER BY indexname
  `);
  schemaParts.push(JSON.stringify({ indexes }, null, 2));
  const schemaPath = path.join(backupDir, `estoque_produtos_schema_${stamp}.json`);
  fs.writeFileSync(schemaPath, schemaParts.join('\n'), 'utf8');

  const ep = await dumpTable('estoque_produtos');
  const mapExists = (await q(`SELECT to_regclass('public._entrada_id_map') IS NOT NULL AS e`))[0]?.e;
  let map = { sql: '', count: 0 };
  if (mapExists) map = await dumpTable('_entrada_id_map');

  const dataPath = path.join(backupDir, `estoque_produtos_data_${stamp}.sql`);
  fs.writeFileSync(dataPath, `${ep.sql}\n\n${map.sql}\n`, 'utf8');

  // Checksums before restore
  const before = (await q(`
    SELECT count(*)::bigint AS n,
           md5(string_agg(id::text, '' ORDER BY id)) AS checksum
    FROM public.estoque_produtos
  `))[0];

  // Restore validation in temp schema
  await client.query('BEGIN');
  try {
    await client.query(ep.sql);
    if (mapExists) await client.query(map.sql);
    const after = (await q(`
      SELECT count(*)::bigint AS n,
             md5(string_agg(id::text, '' ORDER BY id)) AS checksum
      FROM _restore_check.estoque_produtos
    `))[0];
    const ok = String(before.n) === String(after.n) && before.checksum === after.checksum;
    await client.query('DROP SCHEMA IF EXISTS _restore_check CASCADE');
    await client.query('COMMIT');

    const report = {
      schemaPath,
      dataPath,
      estoque_produtos_rows: ep.count,
      entrada_id_map_rows: map.count,
      checksum_before: before,
      checksum_restore: after,
      restore_ok: ok,
    };
    const reportPath = path.join(backupDir, `estoque_produtos_backup_report_${stamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ ...report, reportPath }, null, 2));
    if (!ok) process.exit(1);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }

  await client.end();
}

main().catch(async (e) => {
  console.error(e.message || e);
  try { await client.end(); } catch { /* ignore */ }
  process.exit(1);
});
