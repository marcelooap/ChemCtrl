// ─────────────────────────────────────────────────────────────────────────────
// Supabase REST API client (fetch-based, no WebSocket dependency)
// All CRUD operations use the PostgREST API directly.
// ─────────────────────────────────────────────────────────────────────────────

import { emitEntityChange } from '@/lib/entityEvents';

const supabaseUrl = 'https://cpzibnwytukcgxeamfhp.supabase.co';
const supabaseAnonKey = 'sb_publishable_L85UbhedNgfzFEhmqftzxA_4ADaw2Lw';
const restUrl = `${supabaseUrl}/rest/v1`;

const baseHeaders = {
  'apikey': supabaseAnonKey,
  'Authorization': `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
};

// Fetch options that prevent the browser from caching GET responses.
// Combined with the service worker bypass for Supabase, this guarantees
// that list/filter/get always returns fresh data from the database.
const noCacheFetch = { cache: 'no-store' };

// Entity name → Supabase table name mapping
const entityTableMap = {
  Usuario: 'usuarios',
  Production: 'productions',
  RawMaterialStock: 'raw_material_stocks',
  Tank: 'tanks',
  Transfer: 'transfers',
  Container: 'containers',
  Order: 'orders',
  Recipe: 'recipes',
  QualityResult: 'quality_results',
  QualityTest: 'quality_tests',
  Inventory: 'inventories',
};

// Parse sort string: '-created_date' → { column: 'created_date', ascending: false }
const parseSort = (sort) => {
  if (!sort) return null;
  const desc = sort.startsWith('-');
  const column = desc ? sort.slice(1) : sort;
  return { column, ascending: !desc };
};

// Apply equality filters from a query object to URL search params
const applyFilters = (params, queryObj) => {
  if (!queryObj) return params;
  Object.entries(queryObj).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.set(key, `eq.${value}`);
    }
  });
  return params;
};

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic table column detection
// PostgREST returns 400 if you PATCH/POST a field that doesn't exist as a column.
// We fetch one row per table (select=*&limit=1) to learn the real column names,
// then filter unknown fields out before sending. Cache avoids repeated fetches.
// When the DB schema changes (columns added), a page refresh picks them up.
// ─────────────────────────────────────────────────────────────────────────────
const tableColumnsCache = {};

const getTableColumns = async (tableName) => {
  if (tableColumnsCache[tableName]) return tableColumnsCache[tableName];
  try {
    const resp = await fetch(`${restUrl}/${tableName}?select=*&limit=1`, { headers: baseHeaders, ...noCacheFetch });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.length > 0) {
        const cols = Object.keys(data[0]);
        tableColumnsCache[tableName] = cols;
        return cols;
      }
    }
  } catch { /* fall through to null */ }
  tableColumnsCache[tableName] = null;
  return null;
};

// Filter out keys that don't exist as columns in the DB table
const filterKnownColumns = (data, columns) => {
  if (!columns) return data;
  const filtered = {};
  for (const [key, value] of Object.entries(data)) {
    if (columns.includes(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
};

// Clean data before sending to PostgREST:
// - Convert empty strings to null (PostgREST rejects '' for date/numeric/boolean columns)
// - Stringify arrays/objects for jsonb columns
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

// Error helper
const handleResponse = async (resp) => {
  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const body = await resp.json();
      msg = body.message || body.error || msg;
    } catch { /* ignore parse error */ }
    throw new Error(msg);
  }
  // Handle empty response body (e.g. DELETE without Prefer: return=representation)
  const text = await resp.text();
  if (!text) return [];
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
};

// Create an entity wrapper that mimics the Base44 SDK entities API
const createEntity = (entityName, tableName) => ({
  list: async (sort, limit) => {
    const params = new URLSearchParams();
    params.set('select', '*');
    const sortInfo = parseSort(sort);
    if (sortInfo) {
      params.set('order', `${sortInfo.column}.${sortInfo.ascending ? 'asc' : 'desc'}`);
    }
    if (limit) params.set('limit', String(limit));
    const resp = await fetch(`${restUrl}/${tableName}?${params.toString()}`, { headers: baseHeaders, ...noCacheFetch });
    return handleResponse(resp);
  },

  filter: async (queryObj, sort, limit) => {
    const params = new URLSearchParams();
    params.set('select', '*');
    applyFilters(params, queryObj);
    const sortInfo = parseSort(sort);
    if (sortInfo) {
      params.set('order', `${sortInfo.column}.${sortInfo.ascending ? 'asc' : 'desc'}`);
    }
    if (limit) params.set('limit', String(limit));
    const resp = await fetch(`${restUrl}/${tableName}?${params.toString()}`, { headers: baseHeaders, ...noCacheFetch });
    return handleResponse(resp);
  },

  get: async (id) => {
    const params = new URLSearchParams();
    params.set('select', '*');
    params.set('id', `eq.${id}`);
    const resp = await fetch(`${restUrl}/${tableName}?${params.toString()}`, { headers: baseHeaders, ...noCacheFetch });
    const data = await handleResponse(resp);
    if (!data || data.length === 0) throw new Error('Registro não encontrado');
    return data[0];
  },

  create: async (itemData) => {
    const cols = await getTableColumns(tableName);
    const resp = await fetch(`${restUrl}/${tableName}`, {
      method: 'POST',
      headers: { ...baseHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify(cleanData(filterKnownColumns(itemData, cols))),
    });
    const data = await handleResponse(resp);
    if (data[0]) emitEntityChange(entityName, { eventType: 'INSERT', new: data[0], old: null });
    return data[0];
  },

  update: async (id, itemData) => {
    const cols = await getTableColumns(tableName);
    const params = new URLSearchParams();
    params.set('id', `eq.${id}`);
    const resp = await fetch(`${restUrl}/${tableName}?${params.toString()}`, {
      method: 'PATCH',
      headers: { ...baseHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify(cleanData(filterKnownColumns(itemData, cols))),
    });
    const data = await handleResponse(resp);
    if (!data || data.length === 0) throw new Error('Registro não encontrado para atualização');
    emitEntityChange(entityName, { eventType: 'UPDATE', new: data[0], old: null });
    return data[0];
  },

  delete: async (id) => {
    const params = new URLSearchParams();
    params.set('id', `eq.${id}`);
    const resp = await fetch(`${restUrl}/${tableName}?${params.toString()}`, {
      method: 'DELETE',
      headers: { ...baseHeaders, 'Prefer': 'return=representation' },
    });
    const data = await handleResponse(resp);
    const old = (data && data[0]) || { id };
    emitEntityChange(entityName, { eventType: 'DELETE', new: null, old });
    return true;
  },

  bulkCreate: async (dataArray) => {
    const cols = await getTableColumns(tableName);
    const resp = await fetch(`${restUrl}/${tableName}`, {
      method: 'POST',
      headers: { ...baseHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify(dataArray.map(d => cleanData(filterKnownColumns(d, cols)))),
    });
    const data = await handleResponse(resp);
    data.forEach((record) => emitEntityChange(entityName, { eventType: 'INSERT', new: record, old: null }));
    return data;
  },

  bulkUpdate: async (items) => {
    const cols = await getTableColumns(tableName);
    // PostgREST doesn't support bulk PATCH with different values, so update individually
    const results = [];
    for (const item of items) {
      const { id, ...updates } = item;
      const params = new URLSearchParams();
      params.set('id', `eq.${id}`);
      const resp = await fetch(`${restUrl}/${tableName}?${params.toString()}`, {
        method: 'PATCH',
        headers: { ...baseHeaders, 'Prefer': 'return=representation' },
        body: JSON.stringify(cleanData(filterKnownColumns(updates, cols))),
      });
      const data = await handleResponse(resp);
      if (data && data.length > 0) {
        results.push(data[0]);
        emitEntityChange(entityName, { eventType: 'UPDATE', new: data[0], old: null });
      }
    }
    return results;
  },

  updateMany: async (queryObj, update) => {
    const cols = await getTableColumns(tableName);
    // First get matching IDs
    const selectParams = new URLSearchParams();
    selectParams.set('select', 'id');
    applyFilters(selectParams, queryObj);
    const selectResp = await fetch(`${restUrl}/${tableName}?${selectParams.toString()}`, { headers: baseHeaders, ...noCacheFetch });
    const matches = await handleResponse(selectResp);
    if (!matches || matches.length === 0) return { modified: 0, has_more: false };

    const updates = update.$set || update;
    const ids = matches.map((m) => m.id);
    const params = new URLSearchParams();
    // PostgREST "in" filter for multiple values: id=in.(val1,val2,...)
    params.set('id', `in.(${ids.join(',')})`);
    const resp = await fetch(`${restUrl}/${tableName}?${params.toString()}`, {
      method: 'PATCH',
      headers: { ...baseHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify(cleanData(filterKnownColumns(updates, cols))),
    });
    const data = await handleResponse(resp);
    emitEntityChange(entityName, { eventType: 'REFRESH' });
    return { modified: data?.length || 0, has_more: false };
  },

  deleteMany: async (queryObj) => {
    const params = new URLSearchParams();
    applyFilters(params, queryObj);
    const resp = await fetch(`${restUrl}/${tableName}?${params.toString()}`, {
      method: 'DELETE',
      headers: { ...baseHeaders, 'Prefer': 'return=representation' },
    });
    const data = await handleResponse(resp);
    if (data && data.length > 0) {
      data.forEach((record) => emitEntityChange(entityName, { eventType: 'DELETE', new: null, old: record }));
    } else {
      emitEntityChange(entityName, { eventType: 'REFRESH' });
    }
    return [];
  },

  subscribe: () => {
    // Realtime not supported in fetch-based client; return no-op unsubscribe
    return () => {};
  },

  schema: () => ({ properties: {} }),
});

export const createSupabaseEntities = () => {
  const entities = {};
  Object.entries(entityTableMap).forEach(([entityName, tableName]) => {
    entities[entityName] = createEntity(entityName, tableName);
    // Pre-fetch columns in the background so the cache is warm by the time
    // the user performs a create/update
    getTableColumns(tableName);
  });
  return entities;
};

export { entityTableMap, supabaseUrl, supabaseAnonKey };
