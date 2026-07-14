/**
 * Valida que os arquivos de migração de notificações contêm os GRANTs necessários.
 * Execute: node scripts/validate-notifications-migration.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const requiredSession = [
  'CREATE TABLE IF NOT EXISTS sessions',
  'CREATE OR REPLACE FUNCTION get_current_session()',
  'CREATE OR REPLACE FUNCTION is_internal_user()',
  'GRANT EXECUTE ON FUNCTION get_current_session() TO anon',
];

const requiredGrants = [
  'GRANT SELECT ON notifications TO anon',
  'GRANT EXECUTE ON FUNCTION create_notification',
  'GRANT EXECUTE ON FUNCTION get_unread_notification_count',
  'GRANT EXECUTE ON FUNCTION mark_notification_read',
];

const requiredRealtime = [
  'public.notifications',
  'public.notification_reads',
];

const requiredRealtimeFix = [
  'notification_realtime_signals',
  'emit_notification_realtime_signal',
  'trg_notification_realtime_signal',
];

function checkFile(relativePath, checks, label) {
  const content = readFileSync(join(root, relativePath), 'utf8');
  const missing = checks.filter((c) => !content.includes(c));
  if (missing.length > 0) {
    console.error(`[FAIL] ${label} — faltando:`);
    missing.forEach((m) => console.error(`  - ${m}`));
    return false;
  }
  console.log(`[OK] ${label}`);
  return true;
}

let ok = true;
ok = checkFile('src/sql/migration_notifications.sql', [...requiredSession, ...requiredGrants], 'migration_notifications.sql') && ok;
ok = checkFile('src/sql/migration_realtime_replica_identity.sql', requiredRealtime, 'migration_realtime_replica_identity.sql') && ok;
ok = checkFile('src/sql/migration_notifications_grants.sql', requiredGrants, 'migration_notifications_grants.sql') && ok;
ok = checkFile('src/sql/migration_notifications_realtime_fix.sql', requiredRealtimeFix, 'migration_notifications_realtime_fix.sql') && ok;

if (!ok) {
  process.exit(1);
}

console.log('\nMigrações de notificação validadas. Execute no Supabase SQL Editor:');
console.log('  0. (Opcional) src/sql/migration_notifications_diagnostic.sql — verificar estado');
console.log('  1. src/sql/migration_notifications.sql (completo, autossuficiente)');
console.log('  2. OU src/sql/migration_notifications_grants.sql (só GRANTs, se tabelas já existem)');
console.log('  3. src/sql/migration_notifications_realtime_fix.sql (OBRIGATÓRIO — Realtime + auth interna)');
console.log('\nSe login/RLS geral ainda não foi configurado, execute também:');
console.log('  src/sql/migration_security_audit.sql');
