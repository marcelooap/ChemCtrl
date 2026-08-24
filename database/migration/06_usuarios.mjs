/**
 * 06 — Usuários: ind_lista_usuarios → usuarios (text PK → uuid)
 * Preserva senha_hash; senha=null para não re-hashar no trigger.
 * Garante que perfil_id exista no target (stub para perfis custom).
 * Uso: node database/migration/06_usuarios.mjs
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';
import { buildIdMap } from './lib/id-map.mjs';
import { renameTimestamps, remapPrimaryKey } from './lib/remap.mjs';

async function ensurePerfisForUsers(target, perfilIds) {
  const existing = await fetchAllRows(target, 'perfis');
  const have = new Set(existing.map((p) => String(p.id)));
  const stubs = [];
  for (const id of perfilIds) {
    if (!id || have.has(String(id))) continue;
    stubs.push({
      id: String(id),
      nome: `Perfil migrado ${String(id).slice(0, 8)}`,
      slug: null,
      descricao: 'Perfil customizado criado na migração (origem inacessível)',
      status: 'Ativo',
      is_system: false,
      default_route: '/',
    });
  }
  if (stubs.length) {
    console.log(`  criando ${stubs.length} perfil(is) stub para FK…`);
    await upsertBatch(target, 'perfis', stubs, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
  }
}

async function main() {
  console.log('=== 06 usuarios ===');
  const { source, target } = getClients();

  const rows = await fetchAllRows(source, 'ind_lista_usuarios');
  console.log(`origem ind_lista_usuarios: ${rows.length}`);

  const perfilIds = [
    ...new Set(rows.map((r) => r.perfil_id).filter(Boolean).map(String)),
  ];
  await ensurePerfisForUsers(target, perfilIds);

  const idMap = buildIdMap(
    'usuarios',
    rows.map((r) => r.id)
  );

  const mapped = rows.map((row) => {
    let out = renameTimestamps(row);
    out = remapPrimaryKey(out, idMap, 'usuarios');
    // Trigger manage_usuarios: senha vazia → não re-hash; mantém senha_hash
    out.senha = null;
    return out;
  });

  await upsertBatch(target, 'usuarios', mapped, {
    onConflict: 'id',
    ignoreDuplicates: true,
  });

  console.log('06 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
