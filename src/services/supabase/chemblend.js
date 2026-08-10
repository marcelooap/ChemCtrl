// Wrapper de descoberta para o cliente de dados do ChemCtrl (Supabase Projeto A).
// O cliente real permanece em `@industrializacao/api/supabaseClient` (REST) e
// `@industrializacao/lib/realtime` (WebSocket) — este módulo apenas os reexporta
// com um nome alinhado à convenção `services/supabase/<modulo>` da plataforma.
// Projeto A também é o banco de autenticação da plataforma (ver `@/lib/InternalAuthContext`).
export { supabaseUrl, supabaseAnonKey, entityTableMap } from '@industrializacao/api/supabaseClient';
export { base44 as chemblendEntities } from '@industrializacao/api/base44Client';
