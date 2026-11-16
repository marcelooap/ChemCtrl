import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PAGE_SIZE } from '@shared/lib/pagination';
import { useDebouncedValue } from '@shared/hooks/useDebouncedValue';

/**
 * Estado de listagem com paginação server-side (pageSize padrão 50).
 *
 * @param {(args: {
 *   page: number,
 *   pageSize: number,
 *   search: string,
 *   filters: Record<string, unknown>,
 *   sort: string | undefined,
 * }) => Promise<{ rows: any[], total: number | null | undefined }>} fetcher
 * @param {{
 *   pageSize?: number,
 *   initialFilters?: Record<string, unknown>,
 *   sort?: string,
 *   searchDebounceMs?: number,
 *   enabled?: boolean,
 * }} [options]
 */
export function useServerPagedList(fetcher, options = {}) {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const enabled = options.enabled !== false;
  const sort = options.sort;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState(options.initialFilters || {});
  const debouncedSearch = useDebouncedValue(search, options.searchDebounceMs ?? 300);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const requestIdRef = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled) return;
    const reqId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current({
        page,
        pageSize,
        search: debouncedSearch,
        filters,
        sort,
      });
      if (reqId !== requestIdRef.current) return;
      setRows(Array.isArray(result?.rows) ? result.rows : []);
      setTotal(Number(result?.total) || 0);
    } catch (err) {
      if (reqId !== requestIdRef.current) return;
      setError(err);
      setRows([]);
      setTotal(0);
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, [enabled, page, pageSize, debouncedSearch, filters, sort]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setFilter = useCallback((key, value) => {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const replaceFilters = useCallback((next) => {
    setPage(1);
    setFilters(next || {});
  }, []);

  const updateSearch = useCallback((value) => {
    setPage(1);
    setSearch(value);
  }, []);

  const totalPages = Math.max(1, Math.ceil((total || 0) / pageSize));

  return {
    rows,
    total,
    page,
    pageSize,
    totalPages,
    loading,
    error,
    search,
    setSearch: updateSearch,
    filters,
    setFilter,
    setFilters: replaceFilters,
    setPage,
    reload,
  };
}
