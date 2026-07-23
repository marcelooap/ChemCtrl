// Circuit Breaker simples (fechado → aberto → semiaberto) para proteger o backend
// (e a experiência do usuário) quando o Supabase começa a responder 500/502/503/504
// em sequência. Enquanto aberto, novas chamadas falham rápido em vez de empilhar
// requisições contra um serviço já degradado.

import {
  CIRCUIT_BREAKER_FAILURE_THRESHOLD,
  CIRCUIT_BREAKER_WINDOW_MS,
  CIRCUIT_BREAKER_COOLDOWN_MS,
} from './rateLimitConfig';

export class CircuitBreaker {
  private failureTimestamps: number[] = [];
  private openedAt: number | null = null;

  /** Verifica (e faz a transição aberto → semiaberto quando o cooldown expira). */
  canRequest(): boolean {
    if (this.openedAt === null) return true;
    if (Date.now() - this.openedAt >= CIRCUIT_BREAKER_COOLDOWN_MS) {
      // Semiaberto: libera uma tentativa de sondagem; sucesso/falha decide o próximo estado.
      this.openedAt = null;
      this.failureTimestamps = [];
      return true;
    }
    return false;
  }

  getCooldownRemainingSec(): number {
    if (this.openedAt === null) return 0;
    const remainingMs = CIRCUIT_BREAKER_COOLDOWN_MS - (Date.now() - this.openedAt);
    return Math.max(1, Math.ceil(remainingMs / 1000));
  }

  recordSuccess() {
    this.failureTimestamps = [];
    this.openedAt = null;
  }

  recordFailure() {
    const now = Date.now();
    this.failureTimestamps.push(now);
    this.failureTimestamps = this.failureTimestamps.filter(
      (ts) => now - ts <= CIRCUIT_BREAKER_WINDOW_MS,
    );
    if (this.failureTimestamps.length >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this.openedAt = now;
    }
  }
}

/** Instância única — o backend (Supabase) é compartilhado por toda a aplicação. */
export const apiCircuitBreaker = new CircuitBreaker();
