/**
 * Cadastro mestre de tankas (tabela cadastro_tanka).
 * Identidade: nome normalizado único globalmente; codigo_itku único quando preenchido.
 */
import { entities } from '@transbordo/services/entities';

const DEFAULT_SELECT =
  'id, codigo_itku, nome, cliente_id, cliente_nome, capacidade, inicio_locacao, produto_id, produto_nome, observacao, created_at, updated_at, created_by_id';

export function normTankaKey(value) {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Rótulo amigável para selects. */
export function tankaLabel(tanka) {
  if (!tanka) return '';
  const itku = String(tanka.codigo_itku || '').trim();
  const nome = String(tanka.nome || tanka.tanka || tanka.name || '').trim();
  if (itku && nome && normTankaKey(itku) !== normTankaKey(nome)) {
    return `${itku} — ${nome}`;
  }
  return nome || itku || '';
}

/**
 * Normaliza registro do mestre + aliases de compatibilidade
 * (tanka/name, client, capacity) para consumidores legados.
 */
export function normalizeTankaRow(row) {
  if (!row) return null;
  const nome = String(row.nome || row.tanka || row.name || '').trim();
  const cliente_nome = String(
    row.cliente_nome || row.client || ''
  ).trim();
  const capacidade =
    row.capacidade != null
      ? row.capacidade
      : row.capacity != null
        ? row.capacity
        : null;
  return {
    ...row,
    id: row.id,
    codigo_itku: row.codigo_itku ?? null,
    nome,
    tanka: nome,
    name: nome,
    cliente_id: row.cliente_id ?? null,
    cliente_nome,
    client: cliente_nome,
    capacidade,
    capacity: capacidade,
    inicio_locacao: row.inicio_locacao ?? null,
    produto_id: row.produto_id ?? null,
    produto_nome: row.produto_nome || row.product || '',
    product: row.produto_nome || row.product || '',
    observacao: row.observacao ?? null,
  };
}

export function toTankaSelectOption(tanka) {
  const n = normalizeTankaRow(tanka);
  if (!n?.id) return null;
  return {
    value: n.id,
    label: tankaLabel(n),
    id: n.id,
    codigo_itku: n.codigo_itku || '',
    nome: n.nome,
    tanka: n.nome,
    cliente_id: n.cliente_id,
    cliente_nome: n.cliente_nome,
    item: n,
  };
}

export async function listTankas(opts = {}) {
  const {
    clienteId,
    clienteNome,
    search,
    select = DEFAULT_SELECT,
    limit,
    sort = 'nome',
  } = opts;

  const listOpts = {
    ...(Number.isFinite(limit) && limit > 0 ? { limit } : {}),
  };
  const rows = await entities.isotanques.list(sort, { select, ...listOpts });

  const q = normTankaKey(search || '');
  const hasCliente = Boolean(
    String(clienteId || '').trim() || String(clienteNome || '').trim()
  );
  const cId = String(clienteId || '').trim();
  const cNome = normTankaKey(clienteNome || '');

  return (rows || [])
    .map(normalizeTankaRow)
    .filter((t) => {
      if (hasCliente) {
        const tId = String(t.cliente_id || '').trim();
        const tNome = normTankaKey(t.cliente_nome || '');
        if (cId && tId) {
          if (tId !== cId && !(cNome && tNome === cNome)) return false;
        } else if (cNome && tNome !== cNome) {
          return false;
        }
      }
      if (q) {
        const hay = `${normTankaKey(t.codigo_itku)} ${normTankaKey(t.nome)} ${normTankaKey(t.cliente_nome)}`;
        if (!hay.includes(q)) return false;
      }
      return Boolean(t.nome);
    })
    .sort((a, b) =>
      String(a.nome).localeCompare(String(b.nome), 'pt-BR')
    );
}

export async function getTankaById(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  const row = await entities.isotanques.get(key);
  return normalizeTankaRow(row);
}

export async function findTankaByNome(nome) {
  const key = normTankaKey(nome);
  if (!key) return null;
  const rows = await listTankas({});
  return rows.find((t) => normTankaKey(t.nome) === key) || null;
}

export async function findTankaByItku(codigoItku) {
  const key = normTankaKey(codigoItku);
  if (!key) return null;
  const rows = await listTankas({});
  return (
    rows.find((t) => normTankaKey(t.codigo_itku) === key) || null
  );
}

/**
 * Payload canônico para create/update no mestre.
 * Aceita aliases Ind (name/client/capacity).
 */
export function toMasterPayload(input = {}, { partial = false } = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};

  const set = (key, value) => {
    if (value === undefined) return;
    if (partial && value === undefined) return;
    out[key] = value;
  };

  if ('codigo_itku' in src || !partial) {
    if ('codigo_itku' in src) {
      set(
        'codigo_itku',
        src.codigo_itku === '' || src.codigo_itku == null
          ? null
          : String(src.codigo_itku).trim()
      );
    }
  }

  const nomeRaw = src.nome ?? src.tanka ?? src.name;
  if (nomeRaw !== undefined) {
    set('nome', String(nomeRaw || '').trim());
  }

  if ('cliente_id' in src) {
    set(
      'cliente_id',
      src.cliente_id === '' || src.cliente_id == null
        ? null
        : src.cliente_id
    );
  }

  const clienteNome = src.cliente_nome ?? src.client;
  if (clienteNome !== undefined) {
    set(
      'cliente_nome',
      clienteNome === '' || clienteNome == null
        ? null
        : String(clienteNome).trim()
    );
  }

  const capacidade = src.capacidade ?? src.capacity;
  if (capacidade !== undefined) {
    set(
      'capacidade',
      capacidade === '' || capacidade == null ? null : Number(capacidade)
    );
  }

  if ('inicio_locacao' in src) {
    set(
      'inicio_locacao',
      src.inicio_locacao === '' || src.inicio_locacao == null
        ? null
        : src.inicio_locacao
    );
  }

  if ('produto_id' in src) {
    set(
      'produto_id',
      src.produto_id === '' || src.produto_id == null
        ? null
        : src.produto_id
    );
  }

  const produtoNome = src.produto_nome ?? src.product;
  if (produtoNome !== undefined) {
    set(
      'produto_nome',
      produtoNome === '' || produtoNome == null
        ? null
        : String(produtoNome).trim()
    );
  }

  if ('observacao' in src) {
    set(
      'observacao',
      src.observacao === '' || src.observacao == null
        ? null
        : src.observacao
    );
  }

  if ('created_by_id' in src) {
    set('created_by_id', src.created_by_id || null);
  }

  return out;
}

export async function createTanka(input) {
  const payload = toMasterPayload(input, { partial: false });
  if (!payload.nome) {
    throw new Error('Nome da tanka é obrigatório.');
  }
  const existing = await findTankaByNome(payload.nome);
  if (existing) {
    const err = new Error(
      `Já existe uma tanka cadastrada com o nome "${payload.nome}".`
    );
    err.code = 'TANKA_NOME_DUPLICADO';
    err.existing = existing;
    throw err;
  }
  if (payload.codigo_itku) {
    const byItku = await findTankaByItku(payload.codigo_itku);
    if (byItku) {
      const err = new Error(
        `Já existe uma tanka com o código ITKU "${payload.codigo_itku}".`
      );
      err.code = 'TANKA_ITKU_DUPLICADO';
      err.existing = byItku;
      throw err;
    }
  }
  if (payload.capacidade == null) {
    payload.capacidade = 26000;
  }
  const created = await entities.isotanques.create(payload);
  return normalizeTankaRow(created);
}

/**
 * Update parcial: não envia campos ausentes (não zera o que o form não tocou).
 */
export async function updateTanka(id, input) {
  const key = String(id || '').trim();
  if (!key) throw new Error('ID da tanka é obrigatório.');
  const current = await getTankaById(key);
  if (!current) {
    throw new Error('Tanka não encontrada no cadastro mestre.');
  }
  const payload = toMasterPayload(input, { partial: true });
  if (payload.nome && normTankaKey(payload.nome) !== normTankaKey(current.nome)) {
    const clash = await findTankaByNome(payload.nome);
    if (clash && String(clash.id) !== key) {
      const err = new Error(
        `Já existe uma tanka cadastrada com o nome "${payload.nome}".`
      );
      err.code = 'TANKA_NOME_DUPLICADO';
      err.existing = clash;
      throw err;
    }
  }
  if (
    payload.codigo_itku &&
    normTankaKey(payload.codigo_itku) !== normTankaKey(current.codigo_itku)
  ) {
    const byItku = await findTankaByItku(payload.codigo_itku);
    if (byItku && String(byItku.id) !== key) {
      const err = new Error(
        `Já existe uma tanka com o código ITKU "${payload.codigo_itku}".`
      );
      err.code = 'TANKA_ITKU_DUPLICADO';
      err.existing = byItku;
      throw err;
    }
  }
  const updated = await entities.isotanques.update(key, payload);
  return normalizeTankaRow(updated);
}

export async function deleteTanka(id) {
  const key = String(id || '').trim();
  if (!key) throw new Error('ID da tanka é obrigatório.');
  await entities.isotanques.delete(key);
  return true;
}

/**
 * Garante tanka no mestre pelo nome (ex.: AddTankDialog operacional).
 * Não cria duplicata se o nome já existir.
 */
export async function ensureTankaByNome({
  nome,
  clienteNome,
  clienteId,
  capacidade,
} = {}) {
  const name = String(nome || '').trim();
  if (!name) return null;
  const existing = await findTankaByNome(name);
  if (existing) return existing;
  return createTanka({
    nome: name,
    cliente_nome: clienteNome || '',
    cliente_id: clienteId || null,
    capacidade: capacidade ?? 26000,
  });
}
