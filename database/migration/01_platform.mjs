/**
 * 01 — Platform: perfis + perfil_permissoes
 * Garante perfis de sistema mesmo se a origem bloquear leitura (RLS/anon)
 * ou se 10_seeds.sql não tiver sido aplicado no target.
 * Uso: node database/migration/01_platform.mjs
 */
import { getClients } from './lib/client.mjs';
import { fetchAllRows } from './lib/paginate.mjs';
import { upsertBatch } from './lib/upsert.mjs';

/** Fallback = seeds de 10_seeds.sql (ids semânticos usados pelo frontend). */
const SYSTEM_PERFIS = [
  {
    id: 'perfil_administrador',
    nome: 'Administrador',
    slug: 'administrador',
    descricao: 'Acesso total ao sistema',
    status: 'Ativo',
    is_system: true,
    default_route: '/',
  },
  {
    id: 'perfil_supervisor',
    nome: 'Supervisor',
    slug: 'supervisor',
    descricao: 'Gestão operacional sem administração de usuários',
    status: 'Ativo',
    is_system: true,
    default_route: '/',
  },
  {
    id: 'perfil_operacional',
    nome: 'Operacional',
    slug: 'operacional',
    descricao: 'Execução de produção e inventário',
    status: 'Ativo',
    is_system: true,
    default_route: '/ordens',
  },
  {
    id: 'perfil_visualizacao',
    nome: 'Visualização',
    slug: 'visualizacao',
    descricao: 'Somente leitura em telas permitidas',
    status: 'Ativo',
    is_system: true,
    default_route: '/vasilhames',
  },
  {
    id: 'perfil_cliente',
    nome: 'Cliente',
    slug: 'cliente',
    descricao: 'Portal do cliente externo',
    status: 'Ativo',
    is_system: true,
    default_route: '/tela-clientes',
  },
];

async function main() {
  console.log('=== 01 platform ===');
  const { source, target } = getClients();

  // 1) Sempre garante perfis de sistema no target
  console.log(`garantindo ${SYSTEM_PERFIS.length} perfis de sistema…`);
  await upsertBatch(target, 'perfis', SYSTEM_PERFIS, {
    onConflict: 'id',
    ignoreDuplicates: false,
  });

  // 2) Tenta trazer perfis extras da origem (customizados)
  let perfisOrigem = [];
  try {
    perfisOrigem = await fetchAllRows(source, 'perfis');
  } catch (err) {
    console.warn(`  WARN leitura perfis origem: ${err.message}`);
  }
  console.log(`origem perfis: ${perfisOrigem.length}`);
  if (perfisOrigem.length) {
    await upsertBatch(target, 'perfis', perfisOrigem, {
      onConflict: 'id',
      ignoreDuplicates: false,
    });
  }

  let pp = [];
  try {
    pp = await fetchAllRows(source, 'perfil_permissoes', {
      orderBy: 'perfil_id',
    });
  } catch (err) {
    console.warn(`  WARN leitura perfil_permissoes: ${err.message}`);
  }
  console.log(`origem perfil_permissoes: ${pp.length}`);
  if (pp.length) {
    await upsertBatch(target, 'perfil_permissoes', pp, {
      onConflict: 'perfil_id,permission_key',
      ignoreDuplicates: true,
    });
  }

  // perfil_modulos: NÃO migrar (seeds / já no DDL)
  console.log('01 OK.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
