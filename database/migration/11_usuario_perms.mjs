/**
 * 11 — usuario_permissoes: remap usuario_id text → uuid
 * Também remapeia usuario_id em leituras/agendamentos/reservas quando possível.
 * Uso: node database/migration/11_usuario_perms.mjs
 */
import { randomUUID } from 'node:crypto';
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';
import { loadMap } from './lib/id-map.mjs';

function remapUserField(value, usuariosMap) {
  if (value == null || value === '') return value;
  const key = String(value);
  return usuariosMap[key] ?? value;
}

async function main() {
  console.log('=== 11 usuario_permissoes ===');
  const { source, target } = getClients();
  const usuariosMap = loadMap('usuarios');

  if (!Object.keys(usuariosMap).length) {
    throw new Error('Mapa usuarios.json vazio — rode 06_usuarios.mjs antes');
  }

  // Source: id text; Target: id uuid + usuario_id uuid
  const rows = await fetchAllRows(source, 'usuario_permissoes');
  console.log(`origem usuario_permissoes: ${rows.length}`);

  const mapped = [];
  let skipped = 0;
  for (const row of rows) {
    const newUserId = usuariosMap[String(row.usuario_id)];
    if (!newUserId) {
      skipped += 1;
      continue;
    }
    mapped.push({
      id: randomUUID(),
      usuario_id: newUserId,
      permissao_id: row.permissao_id,
      created_at: row.created_at ?? new Date().toISOString(),
    });
  }
  if (skipped) {
    console.warn(
      `  WARN: ${skipped} permissão(ões) sem usuário no mapa — omitidas`
    );
  }

  // Unique (usuario_id, permissao_id) — ignoreDuplicates na constraint composta
  await upsertBatch(target, 'usuario_permissoes', mapped, {
    onConflict: 'usuario_id,permissao_id',
    ignoreDuplicates: true,
  });

  // Remap usuario_id em tabelas que guardam o id antigo como text
  const userTextTables = [
    {
      table: 'saida_leituras',
      fields: ['usuario_id'],
    },
    {
      table: 'validacao_leituras',
      fields: ['usuario_id'],
    },
    {
      table: 'material_reservas',
      fields: ['usuario_id', 'removido_por_id'],
    },
    {
      table: 'agendamentos_carregamento',
      fields: [
        'usuario_id',
        'operador_conclusao_id',
        'checklist_operador_id',
      ],
    },
    {
      table: 'checklist_producao',
      fields: ['usuario_id'],
    },
  ];

  for (const { table, fields } of userTextTables) {
    let rowsT;
    try {
      rowsT = await fetchAllRows(target, table);
    } catch (err) {
      console.warn(`  SKIP remap ${table}: ${err.message}`);
      continue;
    }
    const updates = [];
    for (const row of rowsT) {
      let changed = false;
      const next = { ...row };
      for (const f of fields) {
        const before = next[f];
        const after = remapUserField(before, usuariosMap);
        if (after !== before) {
          next[f] = after;
          changed = true;
        }
      }
      if (changed) updates.push(next);
    }
    if (updates.length) {
      console.log(`  remapeando usuario_id em ${table}: ${updates.length}`);
      await upsertBatch(target, table, updates, {
        onConflict: 'id',
        ignoreDuplicates: false,
      });
    } else {
      console.log(`  ${table}: nenhum usuario_id a remapear`);
    }
  }

  console.log('11 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
