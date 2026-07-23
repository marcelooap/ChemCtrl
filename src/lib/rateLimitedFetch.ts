// Interceptor único de rede do ChemCtrl. Todas as chamadas HTTP da aplicação
// (RPCs, REST de entidades, Storage, APIs públicas) passam por aqui.
//
// Pipeline por requisição:
//   1) Dedup      — reaproveita chamadas idênticas já em andamento
//   2) Circuit breaker — falha rápido se o backend está degradado (5xx em sequência)
//   3) Token bucket    — aplica o limite do tipo de chamada (login/read/write/upload/…)
//   4) Fila de concorrência — no máx. N requisições simultâneas, o resto espera
//   5) fetch real
//   6) Backoff exponencial — só para chamadas idempotentes (read/public/download)
//
// Nunca altera a Response retornada em caso de sucesso: para chamadas HTTP reais
// (incluindo 429 vindo do servidor), o wrapper devolve a Response como o `fetch`
// nativo faria — quem chama continua responsável por tratar `!resp.ok` como hoje.
// Erros gerados localmente (bucket esgotado, circuito aberto) lançam HttpError,
// já que não existe uma Response real para devolver.

import { toast } from '@/components/ui/use-toast';
import { HttpError, parseRetryAfterHeader } from './HttpError';
import { TokenBucket } from './tokenBucket';
import { apiCircuitBreaker } from './circuitBreaker';
import { globalConcurrencyQueue } from './concurrencyQueue';
import { dedupFetch } from './requestDedup';
import {
  RateLimitKind,
  READ_LIMITS_BY_ROLE,
  DEFAULT_ROLE,
  WRITE_LIMIT,
  WRITE_BURST,
  UPLOAD_LIMIT,
  UPLOAD_BURST,
  DOWNLOAD_LIMIT,
  DOWNLOAD_BURST,
  PUBLIC_LIMIT,
  PUBLIC_BURST,
  RATE_LIMIT_MESSAGES,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  BACKOFF_MAX_RETRIES,
  getCurrentUserRole,
} from './rateLimitConfig';

export interface RateLimitedFetchMeta {
  kind: RateLimitKind;
  /** Não mostra o toast genérico de 429 (ex.: login e público têm sua própria UX). */
  silent429?: boolean;
  /** Sobrescreve a chave de deduplicação (por padrão: método + url + corpo). */
  dedupKey?: string;
  /** Custo em tokens desta chamada (padrão 1). */
  cost?: number;
}

const buckets = new Map<string, TokenBucket>();

function getOrCreateBucket(key: string, limit: number, burst: number): TokenBucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = new TokenBucket(limit, burst);
    buckets.set(key, bucket);
  }
  return bucket;
}

/** `login` e `bypass` não usam bucket local — o servidor é a fonte de verdade. */
function getBucket(kind: RateLimitKind): TokenBucket | null {
  switch (kind) {
    case 'read': {
      const role = getCurrentUserRole();
      const cfg = READ_LIMITS_BY_ROLE[role] || READ_LIMITS_BY_ROLE[DEFAULT_ROLE];
      return getOrCreateBucket(`read:${role}`, cfg.limit, cfg.burst);
    }
    case 'write':
      return getOrCreateBucket('write', WRITE_LIMIT, WRITE_BURST);
    case 'upload':
      return getOrCreateBucket('upload', UPLOAD_LIMIT, UPLOAD_BURST);
    case 'download':
      return getOrCreateBucket('download', DOWNLOAD_LIMIT, DOWNLOAD_BURST);
    case 'public':
      return getOrCreateBucket('public', PUBLIC_LIMIT, PUBLIC_BURST);
    default:
      return null;
  }
}

let lastToastAt = 0;
function notifyTooManyRequests() {
  const now = Date.now();
  if (now - lastToastAt < 3000) return; // dedupe — evita empilhar toasts em burst
  lastToastAt = now;
  toast({ title: RATE_LIMIT_MESSAGES.api, variant: 'destructive' });
}

/** Só chamadas de leitura são repetidas automaticamente — writes/login nunca. */
function isIdempotentKind(kind: RateLimitKind): boolean {
  return kind === 'read' || kind === 'public' || kind === 'download';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let correlationCounter = 0;
function nextCorrelationId(): string {
  correlationCounter = (correlationCounter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${correlationCounter.toString(36)}`;
}

export async function rateLimitedFetch(
  url: string,
  options: RequestInit = {},
  meta: RateLimitedFetchMeta,
): Promise<Response> {
  const { kind, silent429 = false, cost = 1 } = meta;
  const method = (options.method || 'GET').toUpperCase();
  const bodyForKey = typeof options.body === 'string' ? options.body : '';
  const dedupKey = meta.dedupKey || `${method}:${url}:${bodyForKey}`;

  const correlationId = nextCorrelationId();
  const finalOptions: RequestInit = {
    ...options,
    headers: { ...(options.headers as Record<string, string> | undefined), 'x-correlation-id': correlationId },
  };

  return dedupFetch(dedupKey, async () => {
    let attempt = 0;
    for (;;) {
      if (!apiCircuitBreaker.canRequest()) {
        throw new HttpError(503, RATE_LIMIT_MESSAGES.serviceUnavailable, {
          retryAfterSec: apiCircuitBreaker.getCooldownRemainingSec(),
          endpoint: url,
        });
      }

      const bucket = getBucket(kind);
      if (bucket && !bucket.tryRemove(cost)) {
        const retryAfterSec = bucket.getRetryAfterSec(cost);
        if (!silent429) notifyTooManyRequests();
        throw new HttpError(429, RATE_LIMIT_MESSAGES.api, { retryAfterSec, endpoint: url });
      }

      // eslint-disable-next-line no-await-in-loop
      const resp = await globalConcurrencyQueue.run(() => fetch(url, finalOptions));

      if (resp.status >= 500 && resp.status <= 504) {
        apiCircuitBreaker.recordFailure();
      } else {
        apiCircuitBreaker.recordSuccess();
      }

      if (resp.status === 429 && !silent429) {
        notifyTooManyRequests();
      }

      const isRetryableStatus = resp.status === 429 || (resp.status >= 500 && resp.status <= 504);
      const shouldRetry = isIdempotentKind(kind) && isRetryableStatus && attempt < BACKOFF_MAX_RETRIES;
      if (!shouldRetry) return resp;

      const retryAfterSec = parseRetryAfterHeader(resp);
      const backoffMs = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
      attempt += 1;
      // eslint-disable-next-line no-await-in-loop
      await delay(retryAfterSec ? retryAfterSec * 1000 : backoffMs);
    }
  });
}
