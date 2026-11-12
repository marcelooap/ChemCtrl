import { entities } from '@transbordo/services/entities';
import { chemflowSupabase, isChemFlowConfigured } from '@/services/supabase/chemflow';

/** Lista histórica usada no Transbordo enquanto o cadastro não existir. */
export const OPERADORES_FALLBACK = [
  'Adriano Q.',
  'Leonardo S.',
  'Rafael N.',
  'Mariano',
  'Ezequiel F.',
  'Wandre C.',
];

const TABLE_MISSING_MESSAGE =
  'A tabela de operadores ainda não existe no banco. Execute o script SQL 025_t_operadores.sql no Supabase e recarregue a página.';

function normalizeNome(nome) {
  return String(nome || '').trim();
}

function normalizeSetor(setor) {
  const value = String(setor || '').trim();
  return value || null;
}

function normalizeSetorKey(setor) {
  const value = normalizeSetor(setor);
  if (!value) return null;
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isTableMissingError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('pgrst205') ||
    msg.includes("could not find the table 'public.t_operadores'") ||
    (msg.includes('t_operadores') &&
      (msg.includes('does not exist') ||
        msg.includes('schema cache') ||
        msg.includes('could not find') ||
        msg.includes('relation')))
  );
}

function isVirtualOperador(operadorOrId) {
  if (!operadorOrId) return false;
  if (typeof operadorOrId === 'string') return operadorOrId.startsWith('virtual:');
  return Boolean(operadorOrId._virtual) || String(operadorOrId.id || '').startsWith('virtual:');
}

function virtualRow(nome, ativo = true) {
  return {
    id: `virtual:${nome}`,
    nome,
    setor: null,
    ativo,
    _virtual: true,
  };
}

/**
 * Opções do dropdown: ativos + nomes já selecionados no registro (histórico).
 */
export function mergeOperadoresDropdown(ativos = [], selecionados = []) {
  const seen = new Set();
  const out = [];
  for (const nome of [...ativos, ...selecionados]) {
    const n = normalizeNome(nome);
    if (!n) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

async function collectNomesDoHistorico() {
  if (!isChemFlowConfigured || !chemflowSupabase) return [];
  try {
    const { data, error } = await chemflowSupabase
      .from('t_transbordos')
      .select('operadores');
    if (error) return [];
    const names = [];
    for (const row of data || []) {
      for (const nome of Array.isArray(row.operadores) ? row.operadores : []) {
        const n = normalizeNome(nome);
        if (n) names.push(n);
      }
    }
    return names;
  } catch {
    return [];
  }
}

export async function listOperadoresCadastro() {
  try {
    const rows = await entities.operadores.list('nome');
    return (rows || []).sort((a, b) =>
      String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', {
        sensitivity: 'base',
      })
    );
  } catch (err) {
    if (!isTableMissingError(err)) throw err;
    const historico = await collectNomesDoHistorico();
    const nomes = mergeOperadoresDropdown(OPERADORES_FALLBACK, historico);
    return nomes.map((nome) => virtualRow(nome, true));
  }
}

function matchesSetor(row, setor) {
  if (!setor) return true;
  return normalizeSetorKey(row?.setor) === normalizeSetorKey(setor);
}

/**
 * Operadores ativos do cadastro.
 * @param {{ setor?: string }} [opts] — quando informado, restringe ao setor (ex.: "Transbordo").
 */
export async function listOperadoresAtivos({ setor } = {}) {
  const rows = await listOperadoresCadastro();
  if (!rows.length) {
    if (setor) return [];
    return OPERADORES_FALLBACK.map((nome) => virtualRow(nome, true));
  }
  return rows.filter((r) => r.ativo !== false && matchesSetor(r, setor));
}

/**
 * Nomes ativos para o dropdown de novos registros.
 * Se a tabela ainda não existir (SQL não aplicado), usa a lista histórica.
 * @param {{ setor?: string }} [opts] — quando informado, restringe ao setor (ex.: "Transbordo").
 */
export async function listOperadoresAtivosNomes({ setor } = {}) {
  const rows = await listOperadoresAtivos({ setor });
  if (!rows.length) return setor ? [] : [...OPERADORES_FALLBACK];
  return rows.map((r) => r.nome).filter(Boolean);
}

export async function createOperador(nome, { setor } = {}) {
  const trimmed = normalizeNome(nome);
  if (!trimmed) {
    throw new Error('Informe o nome do operador.');
  }
  try {
    return await entities.operadores.create({
      nome: trimmed,
      setor: normalizeSetor(setor),
      ativo: true,
    });
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}

export async function updateOperador(id, payload) {
  if (isVirtualOperador(id)) throw new Error(TABLE_MISSING_MESSAGE);
  return entities.operadores.update(id, payload);
}

function namesMatch(a, b) {
  return normalizeNome(a).toLowerCase() === normalizeNome(b).toLowerCase();
}

async function fetchAllRows(table, columns) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    const { data, error } = await chemflowSupabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

/**
 * Substitui o nome do operador em transbordos.operadores e
 * vasilhames.responsavel (histórico denormalizado).
 */
export async function syncOperadorNomeNoHistorico(oldName, nextName) {
  const from = normalizeNome(oldName);
  const to = normalizeNome(nextName);
  if (!from || !to || from === to) {
    return { transbordos: 0, vasilhames: 0 };
  }
  if (!isChemFlowConfigured || !chemflowSupabase) {
    throw new Error('Supabase ChemFlow não configurado.');
  }

  const transbordos = await fetchAllRows('t_transbordos', 'id, operadores');
  const transbordoPatches = [];
  for (const row of transbordos) {
    const ops = Array.isArray(row.operadores) ? row.operadores : [];
    let changed = false;
    const next = ops.map((n) => {
      if (!namesMatch(n, from)) return n;
      changed = true;
      return to;
    });
    if (changed) transbordoPatches.push({ id: row.id, operadores: next });
  }
  if (transbordoPatches.length > 0) {
    await entities.transbordos.bulkUpdate(transbordoPatches);
  }

  const vasilhames = await fetchAllRows('t_vasilhames', 'id, responsavel');
  const vasilhamePatches = [];
  for (const row of vasilhames) {
    const parts = String(row.responsavel || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!parts.some((n) => namesMatch(n, from))) continue;
    vasilhamePatches.push({
      id: row.id,
      responsavel: parts.map((n) => (namesMatch(n, from) ? to : n)).join(', '),
    });
  }
  if (vasilhamePatches.length > 0) {
    await entities.vasilhames.bulkUpdate(vasilhamePatches);
  }

  return {
    transbordos: transbordoPatches.length,
    vasilhames: vasilhamePatches.length,
  };
}

/**
 * Renomeia o operador no cadastro e nos registros operacionais que
 * guardam o nome (transbordos.operadores e vasilhames.responsavel).
 * Não altera registros se o operador apenas for inativado.
 *
 * Ordem: histórico primeiro, cadastro depois — se o sync falhar,
 * o nome no cadastro permanece e a edição pode ser refeita.
 */
export async function renameOperadorComHistorico(operador, novoNome, { setor } = {}) {
  if (isVirtualOperador(operador)) throw new Error(TABLE_MISSING_MESSAGE);

  const oldName = normalizeNome(operador?.nome);
  const nextName = normalizeNome(novoNome);
  const nextSetor = normalizeSetor(setor);
  const setorChanged =
    setor !== undefined &&
    normalizeSetor(operador?.setor) !== nextSetor;
  if (!operador?.id) throw new Error('Operador inválido.');
  if (!nextName) throw new Error('Informe o nome do operador.');
  if (oldName === nextName && !setorChanged) {
    return operador;
  }

  const nomeChanged = oldName !== nextName;
  if (nomeChanged) {
    try {
      await syncOperadorNomeNoHistorico(oldName, nextName);
    } catch (err) {
      if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
      throw new Error(
        `Não foi possível atualizar o histórico com o novo nome: ${err?.message || err}`
      );
    }
  }

  const patch = { nome: nextName };
  if (setor !== undefined) patch.setor = nextSetor;

  try {
    return await entities.operadores.update(operador.id, patch);
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}

export async function setOperadorAtivo(id, ativo) {
  if (isVirtualOperador(id)) throw new Error(TABLE_MISSING_MESSAGE);
  try {
    return await entities.operadores.update(id, { ativo: Boolean(ativo) });
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}

/** Remove o operador do cadastro. O histórico operacional (nomes) permanece. */
export async function deleteOperador(id) {
  if (isVirtualOperador(id)) throw new Error(TABLE_MISSING_MESSAGE);
  try {
    return await entities.operadores.delete(id);
  } catch (err) {
    if (isTableMissingError(err)) throw new Error(TABLE_MISSING_MESSAGE);
    throw err;
  }
}
