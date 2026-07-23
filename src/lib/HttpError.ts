// Erro tipado usado em toda a camada de rede (rpcClient, supabaseClient, storage,
// publicApi). Sempre carrega o status HTTP e, quando disponível, quantos segundos
// o cliente deve esperar antes de tentar de novo.

export interface HttpErrorOptions {
  retryAfterSec?: number;
  code?: string | null;
  endpoint?: string;
}

export class HttpError extends Error {
  status: number;
  retryAfterSec?: number;
  code?: string | null;
  endpoint?: string;

  constructor(status: number, message: string, options: HttpErrorOptions = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfterSec = options.retryAfterSec;
    this.code = options.code ?? null;
    this.endpoint = options.endpoint;
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return err instanceof HttpError;
}

/** Lê o header Retry-After (segundos) de uma Response real, quando presente. */
export function parseRetryAfterHeader(resp: Response): number | undefined {
  const header = resp?.headers?.get?.('Retry-After');
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * PostgREST devolve exceções do Postgres como JSON `{ message, code, details, hint }`.
 * Quando o backend embute `retry_after_seconds` no DETAIL (ex.: bloqueio de login),
 * extrai o valor para permitir que a UI mostre um tempo de espera preciso.
 */
export function parseRetryAfterFromBody(bodyText: string): number | undefined {
  if (!bodyText) return undefined;
  try {
    const parsed = JSON.parse(bodyText);
    const details = parsed?.details ?? parsed?.detail;
    if (!details) return undefined;
    const detailsParsed = typeof details === 'string' ? JSON.parse(details) : details;
    const seconds = Number(detailsParsed?.retry_after_seconds);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
  } catch {
    return undefined;
  }
}
