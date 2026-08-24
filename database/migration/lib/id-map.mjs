/**
 * Persistência de mapas old_id (text) → new_id (uuid).
 * Arquivos em database/migration/id_maps/<name>.json
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MIGRATION_ROOT } from './client.mjs';

const MAPS_DIR = resolve(MIGRATION_ROOT, 'id_maps');

export function mapsDir() {
  if (!existsSync(MAPS_DIR)) {
    mkdirSync(MAPS_DIR, { recursive: true });
  }
  return MAPS_DIR;
}

/**
 * @param {string} name  ex: 'usuarios', 'receitas'
 * @returns {Record<string, string>}
 */
export function loadMap(name) {
  const path = resolve(mapsDir(), `${name}.json`);
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

/**
 * @param {string} name
 * @param {Record<string, string>} map
 */
export function saveMap(name, map) {
  const path = resolve(mapsDir(), `${name}.json`);
  writeFileSync(path, JSON.stringify(map, null, 2) + '\n', 'utf8');
  console.log(`  map saved: id_maps/${name}.json (${Object.keys(map).length} ids)`);
}

/**
 * Garante um new_id para cada old_id. Reutiliza mapa existente (idempotência).
 * @param {string} name
 * @param {string[]} oldIds
 * @returns {Record<string, string>}
 */
export function buildIdMap(name, oldIds) {
  const map = loadMap(name);
  let added = 0;
  for (const oldId of oldIds) {
    if (oldId == null || oldId === '') continue;
    const key = String(oldId);
    if (!map[key]) {
      map[key] = randomUUID();
      added += 1;
    }
  }
  saveMap(name, map);
  if (added) {
    console.log(`  map ${name}: +${added} novos ids`);
  }
  return map;
}

/**
 * @param {string} name
 * @param {unknown} data
 */
export function saveJson(name, data) {
  const path = resolve(mapsDir(), `${name}.json`);
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/**
 * @param {string} name
 */
export function loadJson(name) {
  const path = resolve(mapsDir(), `${name}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}
