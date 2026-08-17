import { entities } from '@transbordo/services/entities';
import { clientsMatch, normalizeClientName } from '@transbordo/lib/saidaOrigem';

export const ETIQUETA_CONTEXTOS = [
  { value: 'industrializacao', labelKey: 'painel.configuracao.etiquetas.industrializacao' },
  { value: 'convencional', labelKey: 'painel.configuracao.etiquetas.convencional' },
];

/** Valor persistido na coluna `tipo` (NOT NULL no banco). A UI não expõe mais Granel/Embalado. */
const TIPO_PADRAO = 'embalado';

/** Campos disponíveis na configuração e na impressão. */
export const ETIQUETA_FIELD_CATALOG = [
  { key: 'nome', labelKey: 'painel.configuracao.etiquetas.fields.nome' },
  { key: 'qr', labelKey: 'painel.configuracao.etiquetas.fields.qr' },
  { key: 'id', labelKey: 'painel.configuracao.etiquetas.fields.id' },
  { key: 'lote', labelKey: 'painel.configuracao.etiquetas.fields.lote' },
  { key: 'fabricacao', labelKey: 'painel.configuracao.etiquetas.fields.fabricacao' },
  { key: 'validade', labelKey: 'painel.configuracao.etiquetas.fields.validade' },
  { key: 'peso_liquido', labelKey: 'painel.configuracao.etiquetas.fields.pesoLiquido' },
  { key: 'peso_bruto', labelKey: 'painel.configuracao.etiquetas.fields.pesoBruto' },
  { key: 'volume', labelKey: 'painel.configuracao.etiquetas.fields.volume' },
  { key: 'cliente', labelKey: 'painel.configuracao.etiquetas.fields.cliente' },
  { key: 'embalagem', labelKey: 'painel.configuracao.etiquetas.fields.embalagem' },
  { key: 'responsavel_tecnico', labelKey: 'painel.configuracao.etiquetas.fields.responsavelTecnico' },
];

const FIELD_KEYS = ETIQUETA_FIELD_CATALOG.map((f) => f.key);

const DATA_ROW_KEYS = new Set([
  'lote',
  'fabricacao',
  'validade',
  'cliente',
  'volume',
  'id',
  'responsavel_tecnico',
]);
const WEIGHT_KEYS = new Set(['peso_liquido', 'peso_bruto']);

function defaultEnabledKeys(contexto) {
  if (contexto === 'industrializacao') {
    return new Set([
      'nome',
      'qr',
      'id',
      'cliente',
      'lote',
      'fabricacao',
      'validade',
      'peso_liquido',
      'peso_bruto',
      'embalagem',
    ]);
  }
  return new Set([
    'nome',
    'qr',
    'id',
    'lote',
    'fabricacao',
    'validade',
    'peso_liquido',
    'peso_bruto',
    'embalagem',
  ]);
}

export function getDefaultCampos(contexto = 'industrializacao') {
  const enabled = defaultEnabledKeys(contexto);
  return ETIQUETA_FIELD_CATALOG.map((f, index) => ({
    key: f.key,
    enabled: enabled.has(f.key),
    ordem: index,
  }));
}

export function normalizeCampos(campos, contexto) {
  const defaults = getDefaultCampos(contexto);
  const incoming = Array.isArray(campos) ? campos : [];
  const byKey = new Map(
    incoming
      .filter((c) => c && FIELD_KEYS.includes(c.key))
      .map((c, i) => [
        c.key,
        {
          key: c.key,
          enabled: c.enabled !== false,
          ordem: Number.isFinite(Number(c.ordem)) ? Number(c.ordem) : i,
        },
      ])
  );

  const ordered = incoming
    .filter((c) => c && FIELD_KEYS.includes(c.key))
    .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0))
    .map((c) => c.key);

  const missing = defaults.map((d) => d.key).filter((k) => !byKey.has(k));
  const keys = [...ordered.filter((k, i) => ordered.indexOf(k) === i), ...missing];
  const withoutRt = keys.filter((k) => k !== 'responsavel_tecnico');
  const pinned = keys.includes('responsavel_tecnico')
    ? [...withoutRt, 'responsavel_tecnico']
    : withoutRt;

  return pinned.map((key, index) => ({
    key,
    enabled: byKey.has(key) ? byKey.get(key).enabled : defaults.find((d) => d.key === key)?.enabled,
    ordem: index,
  }));
}

export function isCampoEnabled(campos, key) {
  return Boolean((campos || []).find((c) => c.key === key && c.enabled));
}

const LEFT_COLUMN_KEYS = ['cliente', 'lote', 'volume', 'responsavel_tecnico'];
const RIGHT_COLUMN_KEYS = ['fabricacao', 'validade'];

/**
 * Coluna esquerda: Cliente, Lote, Volume, Resp. Téc.
 * Coluna direita: Fabricação e Validade — só quando os quatro campos
 * da esquerda estiverem ativos, para não sobrepor com poucos dados.
 */
export function buildEtiquetaDataLayout(dataRows = []) {
  const rows = (dataRows || []).filter(Boolean);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const leftAllActive = LEFT_COLUMN_KEYS.every((key) => byKey.has(key));
  const hasDates = RIGHT_COLUMN_KEYS.some((key) => byKey.has(key));
  const splitDates = leftAllActive && hasDates;

  const takeInOrder = (keys) => keys.map((key) => byKey.get(key)).filter(Boolean);
  const withRtLast = (list) => {
    const rt = list.filter((row) => row.key === 'responsavel_tecnico');
    const rest = list.filter((row) => row.key !== 'responsavel_tecnico');
    return [...rest, ...rt];
  };

  if (splitDates) {
    const used = new Set([...LEFT_COLUMN_KEYS, ...RIGHT_COLUMN_KEYS]);
    const extras = rows.filter((row) => !used.has(row.key));
    return {
      mode: 'split',
      left: withRtLast([...takeInOrder(LEFT_COLUMN_KEYS), ...extras]),
      right: takeInOrder(RIGHT_COLUMN_KEYS),
    };
  }

  const preferred = [...LEFT_COLUMN_KEYS, ...RIGHT_COLUMN_KEYS];
  const seen = new Set();
  const stack = [];
  for (const key of preferred) {
    const row = byKey.get(key);
    if (!row) continue;
    stack.push(row);
    seen.add(key);
  }
  for (const row of rows) {
    if (!seen.has(row.key)) stack.push(row);
  }
  return { mode: 'stack', left: withRtLast(stack), right: [] };
}

export function partitionEtiquetaCampos(campos = []) {
  const showQr = isCampoEnabled(campos, 'qr');
  const dataRows = campos.filter((c) => {
    if (!c.enabled || !DATA_ROW_KEYS.has(c.key)) return false;
    if (c.key === 'id' && showQr) return false;
    return true;
  });
  const weights = campos.filter((c) => c.enabled && WEIGHT_KEYS.has(c.key));
  const dataLayout = buildEtiquetaDataLayout(dataRows);
  return {
    showNome: isCampoEnabled(campos, 'nome'),
    showQr,
    showId: isCampoEnabled(campos, 'id'),
    showEmbalagem: isCampoEnabled(campos, 'embalagem'),
    dataRows,
    dataLayout,
    weights,
  };
}

/** Ordem fixa da etiqueta vertical: produto no topo, dados, QR, pesos, embalagem. */
export const VERTICAL_DATA_FIELD_ORDER = [
  'cliente',
  'lote',
  'fabricacao',
  'validade',
  'volume',
  'responsavel_tecnico',
  'id',
];

export const VERTICAL_WEIGHT_ORDER = ['peso_liquido', 'peso_bruto'];

export function getVerticalEtiquetaLayout(campos = []) {
  const enabled = new Set(
    (campos || [])
      .filter((c) => c && c.enabled && c.key !== '_opcoes')
      .map((c) => c.key)
  );
  return {
    showNome: enabled.has('nome'),
    showQr: enabled.has('qr'),
    showEmbalagem: enabled.has('embalagem'),
    dataRows: VERTICAL_DATA_FIELD_ORDER.filter((key) => enabled.has(key)).map((key) => ({
      key,
      enabled: true,
    })),
    weights: VERTICAL_WEIGHT_ORDER.filter((key) => enabled.has(key)).map((key) => ({
      key,
      enabled: true,
    })),
  };
}

export const ETIQUETA_DATE_FORMATS = [
  { value: 'dmy', labelKey: 'painel.configuracao.etiquetas.dateFormatDmy' },
  { value: 'month_year', labelKey: 'painel.configuracao.etiquetas.dateFormatMonthYear' },
];

export function normalizeDateFormat(value) {
  return value === 'month_year' ? 'month_year' : 'dmy';
}

export function extractDateFormat(saved) {
  if (!saved) return 'dmy';
  if (typeof saved === 'string') return normalizeDateFormat(saved);
  if (saved.date_format) return normalizeDateFormat(saved.date_format);
  if (saved.dateFormat) return normalizeDateFormat(saved.dateFormat);
  const campos = Array.isArray(saved) ? saved : saved.campos;
  if (Array.isArray(campos)) {
    const meta = campos.find((c) => c && c.key === '_opcoes');
    if (meta) return normalizeDateFormat(meta.dateFormat || meta.date_format);
  }
  return 'dmy';
}

export function withEtiquetaOpcoes(campos, dateFormat, orientation = 'horizontal') {
  const fields = (campos || []).filter((c) => c && c.key !== '_opcoes');
  return [
    ...fields,
    {
      key: '_opcoes',
      dateFormat: normalizeDateFormat(dateFormat),
      orientation: normalizeOrientation(orientation),
    },
  ];
}

export function normalizeOrientation(value) {
  return value === 'vertical' ? 'vertical' : 'horizontal';
}

export function extractOrientation(saved) {
  if (!saved) return 'horizontal';
  if (typeof saved === 'string') return normalizeOrientation(saved);
  if (saved.orientation) return normalizeOrientation(saved.orientation);
  const campos = Array.isArray(saved) ? saved : saved.campos;
  if (Array.isArray(campos)) {
    const meta = campos.find((c) => c && c.key === '_opcoes');
    if (meta) return normalizeOrientation(meta.orientation);
  }
  return 'horizontal';
}

const DATE_LOCALE_MAP = {
  'pt-BR': 'pt-BR',
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
};

function parseCalendarDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatEtiquetaDate(value, dateFormat = 'dmy', language = 'pt-BR') {
  const date = parseCalendarDate(value);
  if (!date) return value ? String(value) : '—';
  const locale =
    DATE_LOCALE_MAP[language] ||
    (String(language).startsWith('pt') ? 'pt-BR' : language) ||
    'pt-BR';
  if (normalizeDateFormat(dateFormat) === 'month_year') {
    const month = date.toLocaleDateString(locale, { month: 'long' });
    const pretty = month ? month.charAt(0).toUpperCase() + month.slice(1) : '';
    return `${pretty} / ${date.getFullYear()}`;
  }
  return date.toLocaleDateString(locale);
}

export const ETIQUETA_PREVIEW_MOCK = {
  product: 'ÁCIDO ACÉTICO GLACIAL',
  client: 'Cliente Exemplo',
  op_number: 'OP-00421',
  lot: '250817-01',
  manufactureDate: '2026-08-01',
  expiryDate: '2027-08-01',
  net_weight: 1000.5,
  gross_weight: 1085.2,
  volume: 980,
  container_number: '25435-2',
  barril_number: '12',
  packaging_type: 'IBC 1000 L',
  publicToken: 'preview-token',
  responsavel_tecnico: 'Eng. Ana Souza',
};

const LOCAL_STORAGE_KEY = 'chemctrl.etiquetaConfigs.v1';

function isTableMissingError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('pgrst205') ||
    msg.includes("could not find the table 'public.t_etiqueta_configs'") ||
    (msg.includes('t_etiqueta_configs') &&
      (msg.includes('does not exist') ||
        msg.includes('schema cache') ||
        msg.includes('could not find') ||
        msg.includes('relation')))
  );
}

function isMissingColumnError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('pgrst204') ||
    (msg.includes('config_etiquetas') &&
      (msg.includes('column') || msg.includes('schema cache') || msg.includes('could not find'))) ||
    (msg.includes('responsavel_tecnico') &&
      (msg.includes('column') || msg.includes('schema cache') || msg.includes('could not find')))
  );
}

function isUniqueViolation(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('duplicate') || msg.includes('unique') || msg.includes('23505');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPersistedTableId(id) {
  return typeof id === 'string' && UUID_RE.test(id);
}

let etiquetaTableAvailable = true;

export function isEtiquetaTableAvailable() {
  return etiquetaTableAvailable;
}

function clientKey(nome) {
  return normalizeClientName(nome) || String(nome || '').trim().toLowerCase();
}

function readLocalStore() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return { configs: [], responsaveis: {} };
    const parsed = JSON.parse(raw);
    return {
      configs: Array.isArray(parsed?.configs) ? parsed.configs : [],
      responsaveis: parsed?.responsaveis && typeof parsed.responsaveis === 'object'
        ? parsed.responsaveis
        : {},
    };
  } catch {
    return { configs: [], responsaveis: {} };
  }
}

function writeLocalStore(store) {
  localStorage.setItem(
    LOCAL_STORAGE_KEY,
    JSON.stringify({
      configs: store.configs || [],
      responsaveis: store.responsaveis || {},
    })
  );
}

function mergeConfigLists(...lists) {
  const out = [];
  for (const list of lists) {
    for (const row of list || []) {
      if (!row) continue;
      const existing = findConfigInList(out, {
        clienteId: row.cliente_id,
        clienteNome: row.cliente_nome,
        contexto: row.contexto,
      });
      if (!existing) out.push(row);
    }
  }
  return out;
}

function configsFromClienteJson(clientes = []) {
  const rows = [];
  for (const c of clientes || []) {
    const blob = c?.config_etiquetas;
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) continue;
    for (const contexto of ['industrializacao', 'convencional']) {
      const entry = blob[contexto];
      if (!entry || !Array.isArray(entry.campos)) continue;
      rows.push({
        id: `${c.id || c.nome}:${contexto}`,
        cliente_id: c.id || null,
        cliente_nome: c.nome,
        contexto,
        tipo: TIPO_PADRAO,
        campos: entry.campos,
        date_format: entry.date_format,
        orientation: entry.orientation,
        updated_at: entry.updated_at || c.updated_at,
        _source: 'cliente',
      });
    }
  }
  return rows;
}

async function listEtiquetaConfigsFromTable() {
  try {
    const rows = (await entities.etiquetaConfigs.list('-updated_at')) || [];
    etiquetaTableAvailable = true;
    return rows;
  } catch (err) {
    if (isTableMissingError(err)) {
      etiquetaTableAvailable = false;
      return [];
    }
    throw err;
  }
}

export async function listEtiquetaConfigs() {
  const fromTable = await listEtiquetaConfigsFromTable();
  let clientes = [];
  try {
    clientes = (await entities.clientes.list('nome')) || [];
  } catch {
    clientes = [];
  }
  const fromJson = configsFromClienteJson(clientes);
  const fromLocal = readLocalStore().configs;
  return mergeConfigLists(fromTable, fromJson, fromLocal);
}

export function findConfigInList(configs, { clienteId, clienteNome, contexto }) {
  const rows = (configs || [])
    .filter((c) => c.contexto === contexto)
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  if (clienteId) {
    const byId = rows.find((c) => c.cliente_id && String(c.cliente_id) === String(clienteId));
    if (byId) return byId;
  }
  const nome = String(clienteNome || '').trim();
  if (!nome) return null;
  const exact = rows.find(
    (c) => String(c.cliente_nome || '').trim().toLowerCase() === nome.toLowerCase()
  );
  if (exact) return exact;
  return rows.find((c) => clientsMatch(c.cliente_nome, nome)) || null;
}

export async function resolveEtiquetaPrintConfig({
  clienteId,
  clienteNome,
  contexto = 'industrializacao',
  configs,
} = {}) {
  try {
    const list = configs || (await listEtiquetaConfigs());
    const saved = findConfigInList(list, { clienteId, clienteNome, contexto });
    return {
      campos: normalizeCampos(saved?.campos, contexto),
      dateFormat: extractDateFormat(saved),
      orientation: extractOrientation(saved),
    };
  } catch {
    return {
      campos: getDefaultCampos(contexto),
      dateFormat: 'dmy',
      orientation: 'horizontal',
    };
  }
}

export async function resolveEtiquetaCampos(options = {}) {
  const { campos } = await resolveEtiquetaPrintConfig(options);
  return campos;
}

function persistLocalResponsavel(clienteNome, responsavelTecnico) {
  const store = readLocalStore();
  const key = clientKey(clienteNome);
  const rt = String(responsavelTecnico || '').trim();
  if (!key) return;
  if (rt) store.responsaveis[key] = rt;
  else delete store.responsaveis[key];
  writeLocalStore(store);
}

async function persistResponsavelOnCliente({ clienteId, clienteNome, responsavelTecnico }) {
  const rt = String(responsavelTecnico || '').trim() || null;
  persistLocalResponsavel(clienteNome, rt);

  let id = clienteId || null;
  if (!rt && !id) return null;

  try {
    if (!id) {
      const { ensureClienteByNome } = await import('@transbordo/lib/ensureCliente');
      const ensured = await ensureClienteByNome(clienteNome);
      id = ensured?.id || null;
    }
    if (!id) return null;
    await entities.clientes.update(id, { responsavel_tecnico: rt });
    return id;
  } catch (err) {
    if (isMissingColumnError(err)) return id;
    throw err;
  }
}

async function saveToEtiquetaTable(payload, lookup) {
  const fromTable = await listEtiquetaConfigsFromTable();
  const existing = findConfigInList(fromTable, lookup);
  if (existing?.id && isPersistedTableId(existing.id)) {
    return entities.etiquetaConfigs.update(existing.id, payload);
  }
  try {
    return await entities.etiquetaConfigs.create(payload);
  } catch (err) {
    if (isUniqueViolation(err)) {
      const retry = findConfigInList(await listEtiquetaConfigsFromTable(), lookup);
      if (retry?.id && isPersistedTableId(retry.id)) {
        return entities.etiquetaConfigs.update(retry.id, payload);
      }
    }
    throw err;
  }
}

async function saveToClienteJson({ clienteId, clienteNome, contexto, tipo, campos, responsavelTecnico }) {
  let id = clienteId || null;
  if (!id) {
    const { ensureClienteByNome } = await import('@transbordo/lib/ensureCliente');
    const ensured = await ensureClienteByNome(clienteNome);
    id = ensured?.id || null;
  }
  if (!id) throw new Error('Não foi possível gravar no cadastro do cliente.');

  let blob = {};
  try {
    const cliente = await entities.clientes.get(id);
    if (cliente?.config_etiquetas && typeof cliente.config_etiquetas === 'object' && !Array.isArray(cliente.config_etiquetas)) {
      blob = { ...cliente.config_etiquetas };
    }
  } catch {
    blob = {};
  }

  const updatedAt = new Date().toISOString();
  blob[contexto] = {
    campos,
    date_format: extractDateFormat({ campos }),
    orientation: extractOrientation({ campos }),
    updated_at: updatedAt,
  };

  const update = { config_etiquetas: blob };
  const rt = String(responsavelTecnico || '').trim();
  if (rt) update.responsavel_tecnico = rt;

  try {
    await entities.clientes.update(id, update);
  } catch (err) {
    if (update.responsavel_tecnico !== undefined && isMissingColumnError(err)) {
      delete update.responsavel_tecnico;
      await entities.clientes.update(id, update);
    } else {
      throw err;
    }
  }

  return {
    id: `${id}:${contexto}`,
    cliente_id: id,
    cliente_nome: clienteNome,
    contexto,
    tipo,
    campos,
    updated_at: updatedAt,
    _source: 'cliente',
    responsavel_tecnico: rt,
  };
}

function saveToLocal({ clienteId, clienteNome, contexto, tipo, campos, responsavelTecnico }) {
  const store = readLocalStore();
  const rt = String(responsavelTecnico || '').trim();
  const next = {
    id: `local:${contexto}:${clientKey(clienteNome)}`,
    cliente_id: clienteId || null,
    cliente_nome: clienteNome,
    contexto,
    tipo,
    campos,
    updated_at: new Date().toISOString(),
    _source: 'local',
    responsavel_tecnico: rt,
  };
  store.configs = [
    next,
    ...store.configs.filter(
      (c) =>
        !(c.contexto === contexto && clientKey(c.cliente_nome) === clientKey(clienteNome))
    ),
  ];
  if (rt) store.responsaveis[clientKey(clienteNome)] = rt;
  writeLocalStore(store);
  return next;
}

export function createResponsavelRequiredError() {
  const err = new Error('Informe o responsável técnico deste cliente.');
  err.code = 'RESPONSAVEL_TECNICO_REQUIRED';
  return err;
}

export async function saveEtiquetaConfig({
  clienteId = null,
  clienteNome,
  contexto,
  campos,
  dateFormat = 'dmy',
  orientation = 'horizontal',
  responsavelTecnico = '',
}) {
  const nome = String(clienteNome || '').trim();
  if (!nome) throw new Error('Selecione um cliente.');

  const normalized = withEtiquetaOpcoes(
    normalizeCampos(campos, contexto),
    dateFormat,
    orientation
  );
  const rt = String(responsavelTecnico || '').trim();
  if (isCampoEnabled(normalized, 'responsavel_tecnico') && !rt) {
    throw createResponsavelRequiredError();
  }

  persistLocalResponsavel(nome, rt);

  let resolvedClienteId = clienteId || null;
  try {
    const id = await persistResponsavelOnCliente({
      clienteId: resolvedClienteId,
      clienteNome: nome,
      responsavelTecnico: rt,
    });
    if (id) resolvedClienteId = id;
  } catch (err) {
    if (!isMissingColumnError(err)) {
      // Cadastro do RT não pode impedir o salvamento do layout
      console.warn('[etiquetaConfig] responsável técnico:', err);
    }
  }

  const payload = {
    cliente_id: resolvedClienteId || null,
    cliente_nome: nome,
    contexto,
    tipo: TIPO_PADRAO,
    campos: normalized,
  };

  try {
    const saved = await saveToEtiquetaTable(payload, {
      clienteId: resolvedClienteId,
      clienteNome: nome,
      contexto,
    });
    return { ...saved, _source: 'table', responsavel_tecnico: rt };
  } catch (err) {
    if (!isTableMissingError(err)) throw err;
  }

  try {
    return await saveToClienteJson({
      ...payload,
      clienteId: resolvedClienteId,
      clienteNome: nome,
      responsavelTecnico: rt,
    });
  } catch (err) {
    if (!isMissingColumnError(err) && !isTableMissingError(err)) throw err;
  }

  return saveToLocal({
    ...payload,
    clienteId: resolvedClienteId,
    clienteNome: nome,
    responsavelTecnico: rt,
  });
}

export async function resolveResponsavelTecnico({ clienteId, clienteNome } = {}) {
  const nome = String(clienteNome || '').trim();
  if (clienteId) {
    try {
      const c = await entities.clientes.get(clienteId);
      if (c?.responsavel_tecnico) return String(c.responsavel_tecnico).trim();
    } catch {
      // segue para busca por nome / local
    }
  }
  if (nome) {
    try {
      const list = (await entities.clientes.list('nome')) || [];
      const found = list.find(
        (c) =>
          String(c.nome || '').trim().toLowerCase() === nome.toLowerCase() ||
          clientsMatch(c.nome, nome)
      );
      if (found?.responsavel_tecnico) return String(found.responsavel_tecnico).trim();
    } catch {
      // segue para localStorage
    }
  }
  return String(readLocalStore().responsaveis[clientKey(nome)] || '').trim();
}

function uniqueClientNames(items, getter) {
  const map = new Map();
  for (const item of items || []) {
    const nome = String(getter(item) || '').trim();
    if (!nome) continue;
    const key = normalizeClientName(nome) || nome.toLowerCase();
    if (!map.has(key)) map.set(key, nome);
  }
  return map;
}

/**
 * Lista de clientes para a tela de etiquetas: cadastro Transbordo + nomes
 * já usados na Industrialização (quando disponíveis).
 */
export async function listEtiquetaClientes() {
  const [clientes, produtos, vasilhames, estoque] = await Promise.all([
    entities.clientes.list('nome').catch(() => []),
    entities.produtos.list().catch(() => []),
    entities.vasilhames.list().catch(() => []),
    entities.estoque.list().catch(() => []),
  ]);

  const localRt = readLocalStore().responsaveis;
  const byKey = new Map();
  for (const c of clientes || []) {
    const nome = String(c.nome || '').trim();
    if (!nome) continue;
    const key = normalizeClientName(nome) || nome.toLowerCase();
    if (!byKey.has(key)) {
      byKey.set(key, {
        id: c.id,
        nome,
        responsavel_tecnico: String(c.responsavel_tecnico || localRt[key] || '').trim(),
        config_etiquetas: c.config_etiquetas,
      });
    }
  }

  const extras = uniqueClientNames(
    [...(produtos || []), ...(vasilhames || []), ...(estoque || [])],
    (row) => row.cliente_nome
  );
  for (const [key, nome] of extras) {
    if (!byKey.has(key)) {
      byKey.set(key, { id: null, nome, responsavel_tecnico: String(localRt[key] || '').trim() });
    }
  }

  try {
    const { base44 } = await import('@industrializacao/api/base44Client');
    const [productions, stocks, containers] = await Promise.all([
      base44.entities.Production.list('-created_date', 400).catch(() => []),
      base44.entities.RawMaterialStock.list('-created_date', 400).catch(() => []),
      base44.entities.Container.list('-created_date', 400).catch(() => []),
    ]);
    const ind = uniqueClientNames(
      [...(productions || []), ...(stocks || []), ...(containers || [])],
      (row) => row.client
    );
    for (const [key, nome] of ind) {
      if (!byKey.has(key)) {
        byKey.set(key, { id: null, nome, responsavel_tecnico: String(localRt[key] || '').trim() });
      }
    }
  } catch {
    // Industrialização indisponível — segue só com o cadastro do Transbordo
  }

  return Array.from(byKey.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' })
  );
}
