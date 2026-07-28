// Configuração central de Rate Limiting do ChemCtrl.
// Único arquivo de knobs — ajuste os valores aqui para afinar limites em produção.
// Os valores de login/público têm espelho em src/sql/migration_rate_limiting_helpers.sql
// (a fonte de verdade de segurança é sempre o servidor; o cliente só evita chamadas óbvias).

export type RateLimitKind = 'login' | 'read' | 'write' | 'upload' | 'download' | 'public' | 'bypass';

export type UserRole = 'administrador' | 'supervisor' | 'operacional';

// ---------------------------------------------------------------------------
// Login (força bruta) — espelha LOGIN_MAX_ATTEMPTS/LOGIN_WINDOW na migration SQL
// ---------------------------------------------------------------------------
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_RETRY_AFTER_SEC = 15 * 60;

// ---------------------------------------------------------------------------
// Token Bucket — leitura (reads), por perfil.
// `limit` = tokens renovados por minuto (regime permanente).
// `burst` = tokens disponíveis de imediato, sem esperar refill (evita bloqueio artificial).
// ---------------------------------------------------------------------------
export const READ_LIMITS_BY_ROLE: Record<UserRole, { limit: number; burst: number }> = {
  administrador: { limit: 200, burst: 40 },
  supervisor: { limit: 150, burst: 30 },
  operacional: { limit: 100, burst: 20 },
};
export const DEFAULT_ROLE: UserRole = 'operacional';

// ---------------------------------------------------------------------------
// Token Bucket — escrita (INSERT/UPDATE/DELETE e RPCs que alteram dados)
// ---------------------------------------------------------------------------
export const WRITE_LIMIT = 30;
export const WRITE_WINDOW_MS = 60_000;
export const WRITE_BURST = 8;

// Upload — bucket próprio (mais restritivo, upload é pesado)
export const UPLOAD_LIMIT = 5;
export const UPLOAD_WINDOW_MS = 60_000;
export const UPLOAD_BURST = 2;

// Download — PDFs, COA, SDS, arquivos assinados do Storage
export const DOWNLOAD_LIMIT = 30;
export const DOWNLOAD_WINDOW_MS = 60_000;
export const DOWNLOAD_BURST = 10;

// APIs públicas (consulta pública via QR Code, sem autenticação)
export const PUBLIC_LIMIT = 30;
export const PUBLIC_WINDOW_MS = 60_000;
export const PUBLIC_BURST = 10;

// ---------------------------------------------------------------------------
// Concorrência e resiliência
// ---------------------------------------------------------------------------
export const MAX_CONCURRENT_REQUESTS = 6;

export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 5;
export const CIRCUIT_BREAKER_WINDOW_MS = 30_000;
export const CIRCUIT_BREAKER_COOLDOWN_MS = 5_000;

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 8_000;
export const BACKOFF_MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Cache — TTL por entidade (ms). 0 = nunca cachear (dados "quentes").
// Entidades não listadas usam CACHE_TTL_DEFAULT.
// ---------------------------------------------------------------------------
export const CACHE_TTL_BY_ENTITY: Record<string, number> = {
  Recipe: 60_000,
  Usuario: 60_000,
  Perfil: 60_000,
  PerfilPermissao: 60_000,
  Production: 5_000,
  ProductionChecklist: 0,
};
export const CACHE_TTL_DEFAULT = 30_000;
export const CACHE_TTL_PUBLIC = 15_000;

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
export const SEARCH_DEBOUNCE_MS = 400;

export const RATE_LIMIT_MESSAGES = {
  login: 'Muitas tentativas de login. Aguarde alguns minutos antes de tentar novamente.',
  api: 'Muitas requisições. Aguarde alguns segundos.',
  serviceUnavailable: 'O sistema está momentaneamente indisponível. Tentando novamente em instantes...',
};

// ---------------------------------------------------------------------------
// Classificação de RPCs conhecidas (src/api/rpcClient.js).
// O que não estiver listado é tratado como leitura — evita falso bloqueio
// em RPCs novas que ainda não foram classificadas aqui.
// ---------------------------------------------------------------------------

/** RPCs que nunca podem ser bloqueadas pelo cliente (logout precisa sempre funcionar). */
export const RPC_BYPASS = new Set<string>(['destroy_session']);

export const RPC_LOGIN = new Set<string>(['login_user']);

export const RPC_PUBLIC = new Set<string>([
  'get_public_lot_info',
  'get_public_coa_data',
  'get_public_sds_path',
]);

export const RPC_WRITE = new Set<string>([
  'create_profile',
  'update_profile_meta',
  'replace_profile_permissions',
  'duplicate_profile',
  'delete_profile',
  'update_user_language',
  'submit_operational_checklist',
]);

export function classifyRpc(functionName: string): RateLimitKind {
  if (RPC_BYPASS.has(functionName)) return 'bypass';
  if (RPC_LOGIN.has(functionName)) return 'login';
  if (RPC_PUBLIC.has(functionName)) return 'public';
  if (RPC_WRITE.has(functionName)) return 'write';
  return 'read';
}

/**
 * Lê o perfil do usuário autenticado diretamente do localStorage.
 * Não depende de React/Context — usado por módulos utilitários fora de componentes.
 */
export function getCurrentUserRole(): UserRole {
  try {
    const raw = localStorage.getItem('chemctrl_session');
    if (!raw) return DEFAULT_ROLE;
    const parsed = JSON.parse(raw);
    const candidate = String(
      parsed?.perfil?.slug || parsed?.perfil?.nome || parsed?.nivel_acesso || '',
    ).toLowerCase();
    if (candidate.startsWith('admin')) return 'administrador';
    if (candidate.startsWith('supervisor')) return 'supervisor';
    return DEFAULT_ROLE;
  } catch {
    return DEFAULT_ROLE;
  }
}

export function getCacheTtlForEntity(entityName?: string): number {
  if (!entityName) return CACHE_TTL_DEFAULT;
  if (entityName in CACHE_TTL_BY_ENTITY) return CACHE_TTL_BY_ENTITY[entityName];
  return CACHE_TTL_DEFAULT;
}
