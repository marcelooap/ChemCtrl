// Fila de concorrência — limita quantas requisições de rede podem estar em voo
// simultaneamente (ex.: um F5 que dispara 20 hooks de uma vez). As demais entram
// numa fila FIFO e são liberadas conforme slots vagam, suavizando picos de carga.

import { MAX_CONCURRENT_REQUESTS } from './rateLimitConfig';

class ConcurrencyQueue {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  private dequeueNext() {
    if (this.active >= this.max) return;
    const resolve = this.waiting.shift();
    if (resolve) {
      this.active += 1;
      resolve();
    }
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.dequeueNext();
    });
  }

  private release() {
    this.active = Math.max(0, this.active - 1);
    this.dequeueNext();
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export const globalConcurrencyQueue = new ConcurrencyQueue(MAX_CONCURRENT_REQUESTS);
