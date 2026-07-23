// Supabase REST API client — v6 (explicit import+export to break Vite cache)
import { uploadFileToSupabase, getSignedFileUrl } from '@/api/storage';
import { emitEntityChange } from '@/lib/entityEvents';

export { uploadFileToSupabase, getSignedFileUrl };
import { getSessionId } from '@/api/rpcClient';
import { rateLimitedFetch } from '@/lib/rateLimitedFetch';
import { HttpError, parseRetryAfterHeader } from '@/lib/HttpError';
import { withCache, invalidate } from '@/lib/queryCache';
import { getCacheTtlForEntity } from '@/lib/rateLimitConfig';

const supabaseUrl = 'https://cpzibnwytukcgxeamfhp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwemlibnd5dHVrY2d4ZWFtZmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcyMjksImV4cCI6MjA5NzMzMzIyOX0.28Y66Ba_u1GyQNnDpsdPXLiGHvcn_BkjGOyHsBPSqR0';
const restUrl = `${supabaseUrl}/rest/v1`;

export { supabaseUrl, supabaseAnonKey };
export { getSessionId } from '@/api/rpcClient';

const getHeaders = (extra = {}) => {
  const sessionId = getSessionId();
  return {
    'apikey': supabaseAnonKey,
    'Authorization': `Bearer ${supabaseAnonKey}`,
    'Content-Type': 'application/json',
    ...(sessionId ? { 'x-session-id': sessionId } : {}),
    ...extra,
  };
};

const noCacheFetch = { cache: 'no-store' };

const entityTableMap = {
  Usuario: 'usuarios',
  Perfil: 'perfis',
  PerfilPermissao: 'perfil_permissoes',
  Production: 'productions',
  RawMaterialStock: 'raw_material_stocks',
  Tank: 'tanks',
  Transfer: 'transfers',
  Container: 'containers',
  ContainerOrigin: 'container_origins',
  Order: 'orders',
  Recipe: 'recipes',
  QualityResult: 'quality_results',
  QualityTest: 'quality_tests',
  Inventory: 'inventories',
  StockMovement: 'stock_movements',
  LabEquipment: 'lab_equipments',
  ProductionChecklist: 'production_checklists',
};
export { entityTableMap };

const parseSort = (sort) => {
  if (!sort) return null;
  const desc = sort.startsWith('-');
  const column = desc ? sort.slice(1) : sort;
  return { column, ascending: !desc };
};

const applyFilters = (params, queryObj) => {
  if (!queryObj) return params;
  Object.entries(queryObj).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, `eq.${value}`);
    }
  });
  return params;
};

const tableColumnsCache = {};

const getTableColumns = async (tableName) => {
  if (tableColumnsCache[tableName]) return tableColumnsCache[tableName];
  try {
    const rowResp = await rateLimitedFetch(`${restUrl}/${tableName}?select=*&limit=1`, { headers: getHeaders(), ...noCacheFetch }, { kind: 'read' });
    if (rowResp.ok) {
      const rowData = await rowResp.json();
      if (rowData && rowData.length > 0) {
        const cols = Object.keys(rowData[0]);
        tableColumnsCache[tableName] = cols;
        return cols;
      }
    }
  } catch (_e) { /* fall through */ }
  tableColumnsCache[tableName] = null;
  return null;
};

const filterKnownColumns = (data, columns) => {
  if (!columns) return data;
  const filtered = {};
  for (const [key, value] of Object.entries(data)) {
    if (columns.includes(key)) filtered[key] = value;
  }
  return filtered;
};

const cleanData = (data) => {
  const cleaned = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === '') {
      cleaned[key] = null;
    } else if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      cleaned[key] = JSON.stringify(value);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

/** Tables introduced by later migrations — list/filter must not break core flows if absent. */
const OPTIONAL_TABLES = new Set(['container_origins']);

const isMissingTableError = (code, msg) => {
  const m = String(msg || '');
  return code === 'PGRST205'
    || m.includes('schema cache')
    || /Could not find the (table|relation)/i.test(m);
};

const handleResponse = async (resp, { allowMissingTable = false } = {}) => {
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    let code = null;
    try {
      const body = await resp.json();
      msg = body.message || body.error || msg;
      code = body.code || null;
    } catch (_e) { /* ignore */ }
    if (allowMissingTable && isMissingTableError(code, msg)) return [];
    throw new HttpError(resp.status, msg, { code, retryAfterSec: parseRetryAfterHeader(resp) });
  }
  const text = await resp.text();
  if (!text) return [];
  try { return JSON.parse(text); } catch { return []; }
};

const createEntity = (entityName, tableName) => {
  const cacheTtl = getCacheTtlForEntity(entityName);

  return {
  list: async (sort, limit) => {
    const params = new URLSearchParams();
    params.set('select', '*');
    const sortInfo = parseSort(sort);
    if (sortInfo) params.set('order', `${sortInfo.column}.${sortInfo.ascending ? 'asc' : 'desc'}`);
    if (limit) params.set('limit', String(limit));
    const cacheKey = `${entityName}:list:${sort || ''}:${limit || ''}`;
    return withCache(cacheKey, cacheTtl, async () => {
      const resp = await rateLimitedFetch(`${restUrl}/${tableName}?${params.toString()}`, { headers: getHeaders(), ...noCacheFetch }, { kind: 'read' });
      return handleResponse(resp, { allowMissingTable: OPTIONAL_TABLES.has(tableName) });
    });
  },
  filter: async (queryObj, sort, limit) => {
    const params = new URLSearchParams();
    params.set('select', '*');
    applyFilters(params, queryObj);
    const sortInfo = parseSort(sort);
    if (sortInfo) params.set('order', `${sortInfo.column}.${sortInfo.ascending ? 'asc' : 'desc'}`);
    if (limit) params.set('limit', String(limit));
    const cacheKey = `${entityName}:filter:${JSON.stringify(queryObj || {})}:${sort || ''}:${limit || ''}`;
    return withCache(cacheKey, cacheTtl, async () => {
      const resp = await rateLimitedFetch(`${restUrl}/${tableName}?${params.toString()}`, { headers: getHeaders(), ...noCacheFetch }, { kind: 'read' });
      return handleResponse(resp, { allowMissingTable: OPTIONAL_TABLES.has(tableName) });
    });
  },
  get: async (id) => {
    const params = new URLSearchParams();
    params.set('select', '*');
    params.set('id', `eq.${id}`);
    const cacheKey = `${entityName}:get:${id}`;
    return withCache(cacheKey, cacheTtl, async () => {
      const resp = await rateLimitedFetch(`${restUrl}/${tableName}?${params.toString()}`, { headers: getHeaders(), ...noCacheFetch }, { kind: 'read' });
      const data = await handleResponse(resp, { allowMissingTable: OPTIONAL_TABLES.has(tableName) });
      if (!data || data.length === 0) throw new Error('Registro não encontrado');
      return data[0];
    });
  },
  create: async (itemData) => {
    delete tableColumnsCache[tableName];
    const cols = await getTableColumns(tableName);
    const body = cleanData(filterKnownColumns(itemData, cols));
    const resp = await rateLimitedFetch(`${restUrl}/${tableName}`, {
      method: 'POST',
      headers: getHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(body),
    }, { kind: 'write' });
    if (!resp.ok) {
      const errText = await resp.text();
      if (errText.includes('PGRST204') || errText.includes('column')) {
        const safeBody = {};
        for (const [k, v] of Object.entries(body)) {
          if (!errText.includes(`'${k}'`)) safeBody[k] = v;
        }
        const retry = await rateLimitedFetch(`${restUrl}/${tableName}`, {
          method: 'POST',
          headers: getHeaders({ 'Prefer': 'return=representation' }),
          body: JSON.stringify(safeBody),
        }, { kind: 'write' });
        const data = await handleResponse(retry);
        invalidate(entityName);
        if (data[0]) emitEntityChange(entityName, { eventType: 'INSERT', new: data[0], old: null });
        return data[0];
      }
      throw new HttpError(resp.status, errText, { retryAfterSec: parseRetryAfterHeader(resp) });
    }
    const data = await handleResponse(resp);
    invalidate(entityName);
    if (data[0]) emitEntityChange(entityName, { eventType: 'INSERT', new: data[0], old: null });
    return data[0];
  },
  update: async (id, itemData) => {
    const hasComplex = Object.values(itemData).some(v => Array.isArray(v) || (typeof v === 'object' && v !== null));
    let body;
    if (hasComplex) {
      delete tableColumnsCache[tableName];
      const cols = await getTableColumns(tableName);
      body = cleanData(filterKnownColumns(itemData, cols));
    } else {
      body = cleanData(itemData);
    }
    const params = new URLSearchParams();
    params.set('id', `eq.${id}`);
    const resp = await rateLimitedFetch(`${restUrl}/${tableName}?${params.toString()}`, {
      method: 'PATCH',
      headers: getHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(body),
    }, { kind: 'write' });
    if (!resp.ok) {
      const errText = await resp.text();
      if (errText.includes('PGRST204') || errText.includes('column')) {
        const safeBody = {};
        for (const [k, v] of Object.entries(body)) {
          if (!errText.includes(`'${k}'`)) safeBody[k] = v;
        }
        const retry = await rateLimitedFetch(`${restUrl}/${tableName}?${params.toString()}`, {
          method: 'PATCH',
          headers: getHeaders({ 'Prefer': 'return=representation' }),
          body: JSON.stringify(safeBody),
        }, { kind: 'write' });
        const data = await handleResponse(retry);
        const updated = (data && data.length > 0) ? data[0] : { id, ...itemData };
        invalidate(entityName);
        emitEntityChange(entityName, { eventType: 'UPDATE', new: updated, old: null });
        return updated;
      }
      throw new HttpError(resp.status, errText, { retryAfterSec: parseRetryAfterHeader(resp) });
    }
    const data = await handleResponse(resp);
    const updated = (data && data.length > 0) ? data[0] : { id, ...itemData };
    invalidate(entityName);
    emitEntityChange(entityName, { eventType: 'UPDATE', new: updated, old: null });
    return updated;
  },
  delete: async (id) => {
    const params = new URLSearchParams();
    params.set('id', `eq.${id}`);
    const resp = await rateLimitedFetch(`${restUrl}/${tableName}?${params.toString()}`, {
      method: 'DELETE',
      headers: getHeaders({ 'Prefer': 'return=representation' }),
    }, { kind: 'write' });
    const data = await handleResponse(resp);
    const old = (data && data[0]) || { id };
    invalidate(entityName);
    emitEntityChange(entityName, { eventType: 'DELETE', new: null, old });
    return true;
  },
  bulkCreate: async (dataArray) => {
    const cols = await getTableColumns(tableName);
    const resp = await rateLimitedFetch(`${restUrl}/${tableName}`, {
      method: 'POST',
      headers: getHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(dataArray.map(d => cleanData(filterKnownColumns(d, cols)))),
    }, { kind: 'write' });
    const data = await handleResponse(resp);
    invalidate(entityName);
    data.forEach((record) => emitEntityChange(entityName, { eventType: 'INSERT', new: record, old: null }));
    return data;
  },
  bulkUpdate: async (items) => {
    const cols = await getTableColumns(tableName);
    const results = [];
    for (const item of items) {
      const { id, ...updates } = item;
      const params = new URLSearchParams();
      params.set('id', `eq.${id}`);
      const resp = await rateLimitedFetch(`${restUrl}/${tableName}?${params.toString()}`, {
        method: 'PATCH',
        headers: getHeaders({ 'Prefer': 'return=representation' }),
        body: JSON.stringify(cleanData(filterKnownColumns(updates, cols))),
      }, { kind: 'write' });
      const data = await handleResponse(resp);
      if (data && data.length > 0) {
        results.push(data[0]);
        emitEntityChange(entityName, { eventType: 'UPDATE', new: data[0], old: null });
      }
    }
    invalidate(entityName);
    return results;
  },
  updateMany: async (queryObj, update) => {
    const cols = await getTableColumns(tableName);
    const selectParams = new URLSearchParams();
    selectParams.set('select', 'id');
    applyFilters(selectParams, queryObj);
    const selectResp = await rateLimitedFetch(`${restUrl}/${tableName}?${selectParams.toString()}`, { headers: getHeaders(), ...noCacheFetch }, { kind: 'read' });
    const matches = await handleResponse(selectResp);
    if (!matches || matches.length === 0) return { modified: 0, has_more: false };
    const updates = update.$set || update;
    const ids = matches.map((m) => m.id);
    const params = new URLSearchParams();
    params.set('id', `in.(${ids.join(',')})`);
    const resp = await rateLimitedFetch(`${restUrl}/${tableName}?${params.toString()}`, {
      method: 'PATCH',
      headers: getHeaders({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(cleanData(filterKnownColumns(updates, cols))),
    }, { kind: 'write' });
    const data = await handleResponse(resp);
    invalidate(entityName);
    emitEntityChange(entityName, { eventType: 'REFRESH' });
    return { modified: data?.length || 0, has_more: false };
  },
  deleteMany: async (queryObj) => {
    const params = new URLSearchParams();
    applyFilters(params, queryObj);
    const resp = await rateLimitedFetch(`${restUrl}/${tableName}?${params.toString()}`, {
      method: 'DELETE',
      headers: getHeaders({ 'Prefer': 'return=representation' }),
    }, { kind: 'write' });
    const data = await handleResponse(resp);
    invalidate(entityName);
    if (data && data.length > 0) {
      data.forEach((record) => emitEntityChange(entityName, { eventType: 'DELETE', new: null, old: record }));
    } else {
      emitEntityChange(entityName, { eventType: 'REFRESH' });
    }
    return [];
  },
  subscribe: () => () => {},
  schema: () => ({ properties: {} }),
  };
};

export const createSupabaseEntities = () => {
  const entities = {};
  Object.entries(entityTableMap).forEach(([entityName, tableName]) => {
    entities[entityName] = createEntity(entityName, tableName);
    getTableColumns(tableName);
  });
  return entities;
};