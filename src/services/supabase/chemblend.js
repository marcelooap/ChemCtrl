// Wrapper de descoberta para o cliente de dados do ChemBlend (Supabase Projeto A).
// O cliente real permanece em `@chemblend/api/supabaseClient` (REST) e
// `@chemblend/lib/realtime` (WebSocket) — este módulo apenas os reexporta
// com um nome alinhado à convenção `services/supabase/<modulo>` da plataforma.
// Projeto A também é o banco de autenticação da plataforma (ver `@/lib/InternalAuthContext`).
export { supabaseUrl, supabaseAnonKey, entityTableMap } from '@chemblend/api/supabaseClient';
export { base44 as chemblendEntities } from '@chemblend/api/base44Client';
