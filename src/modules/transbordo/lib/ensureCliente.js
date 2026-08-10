import { entities } from '@transbordo/services/entities';

/** Converte string vazia / undefined em null (necessário para colunas UUID). */
export function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
}

/**
 * Garante que o cliente exista em `t_clientes`.
 * Se o nome já existir (case-insensitive), reutiliza o registro.
 * Se for nome novo, cria o registro e devolve id + nome.
 */
export async function ensureClienteByNome(nome) {
  const trimmed = typeof nome === 'string' ? nome.trim() : '';
  if (!trimmed) {
    return { id: null, nome: null };
  }

  const existentes = await entities.clientes.list();
  const found = existentes.find(
    (c) => c.nome?.trim().toLowerCase() === trimmed.toLowerCase()
  );
  if (found) {
    return { id: found.id, nome: found.nome };
  }

  const created = await entities.clientes.create({ nome: trimmed });
  return { id: created.id, nome: created.nome };
}
