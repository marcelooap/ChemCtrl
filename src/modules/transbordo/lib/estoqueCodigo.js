/**
 * Formata o ID sequencial persistido de t_estoque.codigo_estoque (001, 002…).
 */
export function formatEstoqueCodigo(codigo) {
  const n = Number(codigo);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return String(Math.trunc(n)).padStart(3, "0");
}
