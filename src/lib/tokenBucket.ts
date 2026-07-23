// Token Bucket — algoritmo padrão para rate limiting com suporte a burst.
// Diferente de uma janela fixa (ex.: "100 por minuto, reseta em X:00"), o bucket
// é reabastecido continuamente, então nunca há picos artificiais na virada da janela.

export class TokenBucket {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private tokens: number;
  private lastRefill: number;

  /**
   * @param limitPerMinute tokens renovados por minuto em regime permanente
   * @param burst tokens disponíveis imediatamente, sem esperar refill
   */
  constructor(limitPerMinute: number, burst: number) {
    this.capacity = Math.max(limitPerMinute, burst, 1);
    this.tokens = Math.max(burst, 0);
    this.refillPerMs = limitPerMinute / 60_000;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefill;
    if (elapsedMs <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedMs * this.refillPerMs);
    this.lastRefill = now;
  }

  /** Tenta consumir `cost` tokens. Retorna false sem efeito colateral se não houver saldo. */
  tryRemove(cost = 1): boolean {
    this.refill();
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }

  /** Estimativa de segundos até `cost` tokens estarem disponíveis (mínimo 1s). */
  getRetryAfterSec(cost = 1): number {
    this.refill();
    const missing = cost - this.tokens;
    if (missing <= 0) return 0;
    const ms = missing / this.refillPerMs;
    return Math.max(1, Math.ceil(ms / 1000));
  }
}
