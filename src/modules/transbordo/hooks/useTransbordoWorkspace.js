import { useQuery } from '@tanstack/react-query';
import {
  loadTransbordoWorkspaceLists,
  TRANSBORDO_WORKSPACE_QUERY_KEY,
} from '@transbordo/services/transbordoWorkspace';

const WORKSPACE_STALE_MS = 60_000;

/**
 * Listas compartilhadas (transbordos, estoque, saídas, vasilhames) com cache entre telas.
 */
export function useTransbordoWorkspace(options = {}) {
  const enabled = options.enabled !== false;
  return useQuery({
    queryKey: TRANSBORDO_WORKSPACE_QUERY_KEY,
    queryFn: () => loadTransbordoWorkspaceLists(),
    enabled,
    staleTime: WORKSPACE_STALE_MS,
  });
}
