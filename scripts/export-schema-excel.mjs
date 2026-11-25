/**
 * Exporta estrutura do banco (tabelas + colunas) para um único Excel.
 * Uma aba por tabela; dentro da aba, somente os nomes das colunas.
 *
 * Fontes (nessa ordem):
 *   1) Postgres via DATABASE_URL
 *   2) OpenAPI PostgREST com service_role / secret key
 *   3) DDL dos arquivos SQL do projeto (fallback)
 *
 * Usage: node scripts/export-schema-excel.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv(filePath) {
  const env = {};
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  } catch {
    /* ignore */
  }
  return env;
}

const fileEnv = {
  ...loadEnv(path.join(root, '.env')),
  ...loadEnv(path.join(root, '.env.local')),
};
const env = { ...fileEnv, ...process.env };

const databaseUrl =
  env.DATABASE_URL ||
  env.CHEMFLOW_DATABASE_URL ||
  env.SUPABASE_DB_URL ||
  env.SUPABASE_DATABASE_URL ||
  env.POSTGRES_URL ||
  env.DIRECT_URL;

const supabaseUrl = (
  env.VITE_CHEMFLOW_SUPABASE_URL ||
  env.VITE_SUPABASE_URL ||
  env.VITE_CHEMBLEND_SUPABASE_URL ||
  ''
).replace(/\/$/, '');

const secretKey =
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.CHEMFLOW_SUPABASE_SERVICE_ROLE_KEY ||
  env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
  env.SUPABASE_SECRET_KEY ||
  '';

function toSheetName(tableName, used) {
  let base = String(tableName)
    .replace(/[\\/?*[\]]/g, '_')
    .slice(0, 31);
  if (!base) base = 'sheet';
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = `_${i}`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    i += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

/** @returns {Promise<Map<string, string[]>>} */
async function loadSchemaFromPostgres(url) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const { rows } = await client.query(`
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
    ORDER BY c.table_name, c.ordinal_position
  `);
  await client.end();

  const tables = new Map();
  for (const row of rows) {
    if (!tables.has(row.table_name)) tables.set(row.table_name, []);
    tables.get(row.table_name).push(row.column_name);
  }
  return tables;
}

/** @returns {Promise<Map<string, string[]>>} */
async function loadSchemaFromOpenApi(url, key) {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/openapi+json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAPI fetch failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const spec = await res.json();
  const definitions = spec.definitions || spec.components?.schemas || {};
  const tables = new Map();

  for (const [name, def] of Object.entries(definitions)) {
    if (!def || typeof def !== 'object') continue;
    const props = def.properties;
    if (!props || typeof props !== 'object') continue;
    const columns = Object.keys(props);
    if (columns.length === 0) continue;
    tables.set(name, columns);
  }

  const paths = spec.paths || {};
  const pathTables = new Map();
  for (const p of Object.keys(paths)) {
    const m = p.match(/^\/([A-Za-z0-9_]+)$/);
    if (!m) continue;
    const table = m[1];
    const ref =
      paths[p]?.get?.responses?.['200']?.schema?.items?.$ref ||
      paths[p]?.get?.responses?.['200']?.content?.['application/json']?.schema?.items?.$ref ||
      '';
    const defName = ref ? ref.split('/').pop() : table;
    const cols = tables.get(defName) || tables.get(table);
    if (cols?.length) pathTables.set(table, cols);
  }

  return pathTables.size > 0 ? pathTables : tables;
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\n]*/g, '');
}

function splitTopLevel(body) {
  const parts = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inSingle) {
      current += ch;
      if (ch === "'" && body[i + 1] === "'") {
        current += body[++i];
        continue;
      }
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      current += ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      current += ch;
      continue;
    }
    if (ch === ')') {
      depth -= 1;
      current += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function extractColumnName(colDef) {
  const trimmed = colDef.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (
    upper.startsWith('CONSTRAINT') ||
    upper.startsWith('PRIMARY KEY') ||
    upper.startsWith('UNIQUE') ||
    upper.startsWith('CHECK') ||
    upper.startsWith('FOREIGN KEY') ||
    upper.startsWith('EXCLUDE') ||
    upper.startsWith('LIKE ')
  ) {
    return null;
  }
  const m = trimmed.match(/^"([^"]+)"|^([A-Za-z_][A-Za-z0-9_]*)/);
  return m ? m[1] || m[2] : null;
}

function walkSqlFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSqlFiles(full, files);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sql')) {
      files.push(full);
    }
  }
  return files;
}

/** @returns {Map<string, string>} key = table.column */
function loadSqlColumnComments() {
  const dirs = [path.join(root, 'src', 'modules')];
  const files = dirs.flatMap((d) => walkSqlFiles(d));
  /** @type {Map<string, string>} */
  const comments = new Map();
  const re =
    /COMMENT\s+ON\s+COLUMN\s+(?:public\.)?("?[A-Za-z_][A-Za-z0-9_]*"?)\.("?[A-Za-z_][A-Za-z0-9_]*"?)\s+IS\s+'((?:[^']|'')*)'/gi;

  for (const file of files) {
    const sql = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(sql)) !== null) {
      const table = m[1].replace(/"/g, '');
      const column = m[2].replace(/"/g, '');
      const text = m[3].replace(/''/g, "'").replace(/\s+/g, ' ').trim();
      if (text) comments.set(`${table}.${column}`, text);
    }
  }
  return comments;
}

const EXACT_COLUMN_DESC = {
  id: 'Identificador único do registro',
  created_at: 'Data/hora de criação do registro',
  updated_at: 'Data/hora da última atualização',
  created_date: 'Data/hora de criação do registro',
  updated_date: 'Data/hora da última atualização',
  created_by_id: 'Identificador do usuário que criou o registro',
  created_by: 'Usuário que criou o registro',
  status: 'Status atual do registro',
  observacao: 'Observação livre',
  observacoes: 'Observações livres',
  observations: 'Observações livres',
  nome: 'Nome',
  nome_completo: 'Nome completo',
  usuario: 'Login/usuário de acesso',
  senha: 'Senha (legado; preferir senha_hash)',
  senha_hash: 'Hash da senha do usuário',
  email: 'Endereço de e-mail',
  telefone: 'Telefone de contato',
  cargo: 'Cargo do usuário',
  tipo: 'Tipo/classificação do registro',
  cliente: 'Nome ou referência do cliente',
  client: 'Nome ou referência do cliente',
  cliente_id: 'FK para o cliente',
  cliente_nome: 'Nome do cliente (snapshot)',
  produto: 'Nome do produto',
  product: 'Nome do produto',
  produto_id: 'FK para o produto',
  produto_nome: 'Nome do produto (snapshot)',
  produto_codigo: 'Código do produto (snapshot)',
  codigo: 'Código identificador',
  lote: 'Número do lote',
  lot: 'Número do lote',
  densidade: 'Densidade do material',
  quantidade: 'Quantidade',
  quantidade_total: 'Quantidade total',
  unidade_medida: 'Unidade de medida (kg, L, etc.)',
  unit: 'Unidade de medida',
  nota_fiscal: 'Número da nota fiscal',
  data: 'Data de referência',
  date: 'Data de referência',
  data_fabricacao: 'Data de fabricação',
  data_validade: 'Data de validade',
  validade_indeterminada: 'Indica se a validade é indeterminada',
  saldo_atual: 'Saldo/quantidade disponível atual',
  preco_unitario: 'Preço unitário',
  custo_total: 'Custo total',
  total_value: 'Valor total',
  unit_price: 'Preço unitário',
  volume: 'Volume',
  mass: 'Massa',
  embalado: 'Indica se o item está embalado',
  peso_liquido: 'Peso líquido',
  peso_bruto: 'Peso bruto',
  quantidade_embalagens: 'Quantidade de embalagens',
  status_wms: 'Flag de status no WMS',
  origem: 'Origem do registro/movimentação',
  destino: 'Destino da operação',
  modulo_origem: 'Módulo de origem (ex.: transbordo, industrialização)',
  public_token: 'Token público para acesso externo/QR',
  session_id: 'Identificador da sessão de autenticação',
  perfil_id: 'FK para o perfil de acesso',
  permissao_id: 'FK para a permissão',
  usuario_id: 'FK para o usuário',
  active: 'Indica se o registro está ativo',
  ativo: 'Indica se o registro está ativo',
  filtrado: 'Indica se o produto exige filtração',
  controlado: 'Indica se o produto é controlado',
  orgao_regulamentador: 'Órgão regulamentador do produto controlado',
  data_cadastro: 'Data de cadastro',
  capacidade: 'Capacidade (volume/peso)',
  tanka: 'Código/identificação do tanque (tanka)',
  codigo_itku: 'Código ITKU do isotanque',
  inicio_locacao: 'Data de início da locação',
  fornecedor: 'Nome do fornecedor',
  grupo_entrada: 'Agrupador da entrada',
  lotes: 'Lista JSON de lotes associados',
  itens: 'Lista JSON de itens',
  op_number: 'Número da ordem de produção (OP)',
  recipe_id: 'FK/referência da receita',
  recipe_revision: 'Revisão da receita utilizada',
  order_id: 'FK/referência do pedido',
  client_order: 'Número do pedido do cliente',
  packaging_type: 'Tipo de embalagem',
  packaging_info: 'Informações da embalagem',
  operator: 'Operador responsável',
  operador: 'Operador responsável',
  start_time: 'Data/hora de início',
  end_time: 'Data/hora de término',
  priority: 'Prioridade',
  qc_status: 'Status do controle de qualidade',
  qc_analyst: 'Analista de CQ',
  qc_observations: 'Observações do CQ',
  bypass_qc: 'Indica se o CQ foi dispensado',
  raw_materials_used: 'Matérias-primas utilizadas (JSON)',
  entry_id: 'Identificador da entrada de estoque',
  entry_date: 'Data da entrada',
  mp_code: 'Código da matéria-prima',
  local_armazenagem: 'Local de armazenagem',
  qtd_paletes: 'Quantidade de paletes',
  qtd_embalagem_por_palete: 'Quantidade de embalagens por palete',
  pedido_cliente: 'Número do pedido do cliente',
  data_solicitacao: 'Data da solicitação',
  data_programada: 'Data programada',
  usuario_criador: 'Usuário que criou o registro',
  usuario_responsavel: 'Usuário responsável',
  cancelamento_justificativa: 'Justificativa do cancelamento',
  cancelamento_usuario: 'Usuário que cancelou',
  cancelamento_data: 'Data/hora do cancelamento',
  saida_id: 'FK para a saída',
  estoque_id: 'FK para o estoque',
  transbordo_id: 'FK para o transbordo',
  producao_id: 'FK para a produção',
  production_id: 'FK para a produção',
  inventario_id: 'Identificador que agrupa linhas do inventário',
  linha_ordem: 'Ordem da linha dentro do agrupamento',
  resultado_id: 'Identificador que agrupa linhas do resultado de CQ',
  analysis_name: 'Nome da análise',
  methodology: 'Metodologia da análise',
  specification: 'Especificação',
  min_limit: 'Limite mínimo',
  max_limit: 'Limite máximo',
  resultado: 'Resultado obtido',
  vigencia_inicio: 'Início da vigência',
  vigencia_fim: 'Fim da vigência',
  tarifa_diaria: 'Valor da tarifa diária',
  capacidade_litros: 'Capacidade em litros',
  setor: 'Setor do operador',
  nivel_acesso: 'Nível de acesso do usuário',
  preferred_language: 'Idioma preferido do usuário',
  identity_key: 'Chave de identidade do vasilhame',
  confirmada: 'Indica se a capacidade foi confirmada',
  comunicacao_enviada: 'Indica se a comunicação já foi enviada',
  granel_pesagem: 'Indica pesagem a granel',
  granel_ticket: 'Ticket da pesagem a granel',
  granel_peso_bruto: 'Peso bruto da pesagem a granel',
  granel_peso_liquido: 'Peso líquido da pesagem a granel',
  granel_margem: 'Resultado da margem (dentro/fora)',
};

/**
 * Gera explicação breve em português do que a coluna armazena.
 * @param {string} table
 * @param {string} column
 * @param {Map<string, string>} [sqlComments]
 */
function describeColumn(table, column, sqlComments) {
  const fromSql = sqlComments?.get(`${table}.${column}`);
  if (fromSql) return fromSql;

  if (EXACT_COLUMN_DESC[column]) return EXACT_COLUMN_DESC[column];

  const c = column.toLowerCase();

  if (c.endsWith('_id') && c !== 'id') {
    const ref = c.slice(0, -3).replace(/_/g, ' ');
    return `Chave estrangeira / referência de ${ref}`;
  }
  if (c.endsWith('_at') || c.endsWith('_em')) {
    return `Data/hora relacionada a ${c.replace(/_/g, ' ')}`;
  }
  if (c.startsWith('data_') || c.startsWith('date_')) {
    return `Data de ${c.replace(/^(data|date)_/, '').replace(/_/g, ' ')}`;
  }
  if (c.startsWith('qtd_') || c.startsWith('quantidade_')) {
    return `Quantidade de ${c.replace(/^(qtd|quantidade)_/, '').replace(/_/g, ' ')}`;
  }
  if (c.startsWith('is_') || c.startsWith('has_') || c.endsWith('_flag')) {
    return `Indicador booleano (${c.replace(/_/g, ' ')})`;
  }
  if (c.includes('json') || c.endsWith('_data') || c === 'payload' || c === 'metadata') {
    return `Dados estruturados (JSON) de ${c.replace(/_/g, ' ')}`;
  }
  if (c.includes('token')) return 'Token de acesso ou identificação externa';
  if (c.includes('hash')) return 'Valor hash (não reversível)';
  if (c.includes('senha') || c.includes('password')) return 'Credencial de senha';
  if (c.includes('email')) return 'Endereço de e-mail';
  if (c.includes('telefone') || c.includes('phone')) return 'Telefone de contato';
  if (c.includes('endereco') || c.includes('address')) return 'Endereço';
  if (c.includes('observ')) return 'Texto de observação';
  if (c.includes('justificativa')) return 'Justificativa textual';
  if (c.includes('status')) return 'Status do registro/processo';
  if (c.includes('codigo') || c.includes('code')) return 'Código identificador';
  if (c.includes('nome') || c.includes('name')) return 'Nome descritivo';
  if (c.includes('descricao') || c.includes('description')) return 'Descrição';
  if (c.includes('valor') || c.includes('value') || c.includes('preco') || c.includes('price')) {
    return 'Valor monetário ou numérico';
  }
  if (c.includes('peso') || c.includes('weight')) return 'Peso';
  if (c.includes('volume')) return 'Volume';
  if (c.includes('densidade') || c.includes('density')) return 'Densidade';
  if (c.includes('capacidade') || c.includes('capacity')) return 'Capacidade';
  if (c.includes('validade') || c.includes('expiry') || c.includes('expiration')) {
    return 'Informação de validade';
  }
  if (c.includes('lote') || c === 'lot' || c.includes('batch')) return 'Lote';
  if (c.includes('cliente') || c.includes('client')) return 'Informação do cliente';
  if (c.includes('produto') || c.includes('product')) return 'Informação do produto';
  if (c.includes('usuario') || c.includes('user') || c.includes('operator') || c.includes('operador')) {
    return 'Referência a usuário/operador';
  }
  if (c.includes('permis')) return 'Informação de permissão de acesso';
  if (c.includes('perfil')) return 'Informação de perfil de acesso';
  if (c.includes('modulo')) return 'Módulo do sistema';
  if (c.includes('tarifa')) return 'Valor de tarifa';
  if (c.includes('vigencia')) return 'Período de vigência';
  if (c.includes('checklist')) return 'Item/dado de checklist';
  if (c.includes('leitura')) return 'Valor de leitura operacional';
  if (c.includes('reserva')) return 'Informação de reserva de material';
  if (c.includes('ajuste')) return 'Informação de ajuste de estoque';
  if (c.includes('destino')) return 'Destino da operação';
  if (c.includes('origem')) return 'Origem da operação/registro';

  return `Armazena ${c.replace(/_/g, ' ')}`;
}

/**
 * Extrai schema a partir dos DDLs do projeto (CREATE / ALTER ADD / RENAME).
 * Ignora rollbacks e seeds.
 */
function loadSchemaFromSqlFiles() {
  // Schema de produção atual: DDLs dos módulos (t_*, ind_*, cadastros, etc.).
  // new-schema/ é o banco v2 ainda não em produção — não misturar.
  const dirs = [path.join(root, 'src', 'modules')];

  const files = dirs
    .flatMap((d) => walkSqlFiles(d))
    .filter((f) => {
      const base = path.basename(f).toLowerCase();
      if (base.includes('rollback')) return false;
      if (base.includes('seed')) return false;
      if (base.includes('proposal')) return false;
      if (f.includes(`${path.sep}audit${path.sep}`)) return false;
      if (base.includes('id_mapping')) return false;
      return true;
    })
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  /** @type {Map<string, string[]>} */
  const tables = new Map();
  /** @type {Map<string, Set<string>>} */
  const colSets = new Map();

  function ensureTable(name) {
    if (!tables.has(name)) {
      tables.set(name, []);
      colSets.set(name, new Set());
    }
  }

  function addColumn(table, column) {
    ensureTable(table);
    const set = colSets.get(table);
    if (set.has(column)) return;
    set.add(column);
    tables.get(table).push(column);
  }

  function renameTable(from, to) {
    if (!tables.has(from)) {
      ensureTable(to);
      return;
    }
    const fromCols = tables.get(from) || [];
    tables.delete(from);
    colSets.delete(from);
    ensureTable(to);
    for (const col of fromCols) addColumn(to, col);
  }

  /** @type {{type:string, file:string, a?:string, b?:string, body?:string}[]} */
  const ops = [];

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const sql = stripSqlComments(raw);

    const createRe =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("?[A-Za-z_][A-Za-z0-9_]*"?)\s*\(/gi;
    let match;
    while ((match = createRe.exec(sql)) !== null) {
      const table = match[1].replace(/"/g, '');
      const start = match.index + match[0].length;
      let depth = 1;
      let i = start;
      let inSingle = false;
      for (; i < sql.length; i++) {
        const ch = sql[i];
        if (inSingle) {
          if (ch === "'" && sql[i + 1] === "'") {
            i += 1;
            continue;
          }
          if (ch === "'") inSingle = false;
          continue;
        }
        if (ch === "'") {
          inSingle = true;
          continue;
        }
        if (ch === '(') depth += 1;
        else if (ch === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      ops.push({ type: 'create', file, a: table, body: sql.slice(start, i) });
    }

    const addColRe =
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?("?[A-Za-z_][A-Za-z0-9_]*"?)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("?[A-Za-z_][A-Za-z0-9_]*"?)/gi;
    while ((match = addColRe.exec(sql)) !== null) {
      ops.push({
        type: 'add',
        file,
        a: match[1].replace(/"/g, ''),
        b: match[2].replace(/"/g, ''),
      });
    }

    const renameRe =
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?("?[A-Za-z_][A-Za-z0-9_]*"?)\s+RENAME\s+TO\s+("?[A-Za-z_][A-Za-z0-9_]*"?)/gi;
    while ((match = renameRe.exec(sql)) !== null) {
      ops.push({
        type: 'rename_final',
        file,
        a: match[1].replace(/"/g, ''),
        b: match[2].replace(/"/g, ''),
      });
    }

    // English → ind_* (deve rodar antes dos renames finais ind_* → cadastro_*)
    const renameFnRe =
      /_chemctrl_rename_table\s*\(\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*,\s*'([A-Za-z_][A-Za-z0-9_]*)'\s*\)/gi;
    while ((match = renameFnRe.exec(sql)) !== null) {
      ops.push({ type: 'rename_ind', file, a: match[1], b: match[2] });
    }

    const dropRe =
      /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?("?[A-Za-z_][A-Za-z0-9_]*"?)/gi;
    while ((match = dropRe.exec(sql)) !== null) {
      ops.push({ type: 'drop', file, a: match[1].replace(/"/g, '') });
    }
  }

  // Fases globais: CREATE → ADD → RENAME → DROP (evita ordem cruzada entre módulos)
  for (const op of ops.filter((o) => o.type === 'create')) {
    ensureTable(op.a);
    for (const part of splitTopLevel(op.body || '')) {
      const col = extractColumnName(part);
      if (col) addColumn(op.a, col);
    }
  }
  for (const op of ops.filter((o) => o.type === 'add')) {
    addColumn(op.a, op.b);
  }
  for (const op of ops.filter((o) => o.type === 'rename_ind')) {
    renameTable(op.a, op.b);
  }
  for (const op of ops.filter((o) => o.type === 'rename_final')) {
    renameTable(op.a, op.b);
  }
  // Só aplica DROP de scripts explícitos de limpeza legada (não migrações
  // recentes que podem ainda não ter rodado em todos os ambientes).
  for (const op of ops.filter((o) => o.type === 'drop')) {
    const base = path.basename(op.file).toLowerCase();
    const isLegacyDrop =
      base.includes('drop_legacy') ||
      base.includes('migration_drop') ||
      base.includes('drop_notifications');
    if (!isLegacyDrop) continue;
    tables.delete(op.a);
    colSets.delete(op.a);
  }

  // Remove tabelas temporárias / de migração interna e nomes ingleses
  // pré-migração ChemBlend (já renomeados para ind_* / cadastros).
  const legacyEnglish = new Set([
    'productions',
    'orders',
    'recipes',
    'raw_material_stocks',
    'stock_movements',
    'tanks',
    'transfers',
    'containers',
    'container_origins',
    'inventories',
    'production_checklists',
    'quality_tests',
    'quality_analyses',
    'quality_results',
    'lab_equipments',
  ]);

  for (const name of [...tables.keys()]) {
    if (name.startsWith('_')) tables.delete(name);
    else if (legacyEnglish.has(name)) tables.delete(name);
  }

  return tables;
}

async function writeExcel(tables, sqlComments) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ChemCtrl';
  workbook.created = new Date();

  const usedNames = new Set();
  let columnCount = 0;

  for (const [tableName, columns] of [...tables.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const sheet = workbook.addWorksheet(toSheetName(tableName, usedNames));
    sheet.getCell('A1').value = 'coluna';
    sheet.getCell('B1').value = 'explicacao';
    sheet.getCell('A1').font = { bold: true };
    sheet.getCell('B1').font = { bold: true };

    let maxDesc = 12;
    columns.forEach((col, idx) => {
      const desc = describeColumn(tableName, col, sqlComments);
      sheet.getCell(idx + 2, 1).value = col;
      sheet.getCell(idx + 2, 2).value = desc;
      maxDesc = Math.max(maxDesc, desc.length);
    });
    columnCount += columns.length;
    sheet.getColumn(1).width = Math.min(
      40,
      Math.max(18, ...columns.map((c) => String(c).length + 2), 10)
    );
    sheet.getColumn(2).width = Math.min(80, Math.max(28, maxDesc + 2));
  }

  const outDir = path.join(root, 'database');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'chemctrl-schema-tabelas-colunas.xlsx');
  await workbook.xlsx.writeFile(outPath);
  return { outPath, tableCount: tables.size, columnCount };
}

async function main() {
  let source;
  let tables;

  if (databaseUrl) {
    source = 'postgres';
    tables = await loadSchemaFromPostgres(databaseUrl);
  } else if (supabaseUrl && secretKey) {
    source = 'openapi-service-role';
    tables = await loadSchemaFromOpenApi(supabaseUrl, secretKey);
  } else {
    source = 'sql-files';
    tables = loadSchemaFromSqlFiles();
  }

  if (!tables.size) {
    console.error('Nenhuma tabela encontrada.');
    process.exit(1);
  }

  const sqlComments = loadSqlColumnComments();
  const result = await writeExcel(tables, sqlComments);
  console.log(
    JSON.stringify(
      {
        ok: true,
        source,
        file: result.outPath,
        tables: result.tableCount,
        columns: result.columnCount,
        sqlComments: sqlComments.size,
        tableNames: [...tables.keys()].sort(),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
