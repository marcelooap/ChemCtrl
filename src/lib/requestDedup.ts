// Deduplicação de requisições em voo — se duas chamadas idênticas (mesma URL,
// método e corpo) ocorrerem enquanto a primeira ainda está em andamento, a segunda
// reaproveita a mesma Promise em vez de gerar uma nova requisição de rede.
// Cobre tanto F5/remounts simultâneos (leituras) quanto duplo clique em botões (escritas).

const inFlight = new Map<string, Promise<unknown>>();

export function dedupFetch<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}
