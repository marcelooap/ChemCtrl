import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { entities } from '@transbordo/services/entities';
import { listProdutos } from '@transbordo/lib/cadastroProdutosCentral';
import { LIST_PROJECTIONS } from '@shared/lib/pagination';
import { queryClientInstance } from '@/lib/query-client';

const STALE_MS = 60_000;

export const CHEM_FLOW_QUERY_KEYS = {
  clientes: ['chemflow', 'clientes'],
  produtosArmazenagem: ['chemflow', 'produtos', 'ARMAZENAGEM'],
  vasilhames: ['chemflow', 'vasilhames'],
  saidas: ['chemflow', 'saidas'],
  transbordos: ['chemflow', 'transbordos'],
};

export function useChemflowClientes(options = {}) {
  return useQuery({
    queryKey: CHEM_FLOW_QUERY_KEYS.clientes,
    queryFn: () =>
      entities.clientes.list('nome', {
        select: LIST_PROJECTIONS.t_clientes,
      }),
    staleTime: STALE_MS,
    enabled: options.enabled !== false,
  });
}

export function useChemflowProdutosArmazenagem(options = {}) {
  return useQuery({
    queryKey: CHEM_FLOW_QUERY_KEYS.produtosArmazenagem,
    queryFn: () => listProdutos({ modulo: 'ARMAZENAGEM' }),
    staleTime: STALE_MS,
    enabled: options.enabled !== false,
  });
}

export function useChemflowSaidasPage(
  { page = 1, pageSize = 50, sort = '-created_date', select, filters } = {},
  options = {}
) {
  return useQuery({
    queryKey: [...CHEM_FLOW_QUERY_KEYS.saidas, 'page', page, pageSize, sort, select, filters],
    queryFn: () =>
      entities.saidas.listPage({
        page,
        pageSize,
        sort,
        select: select || LIST_PROJECTIONS.t_saidas,
        filters,
      }),
    staleTime: STALE_MS,
    enabled: options.enabled !== false,
    placeholderData: keepPreviousData,
  });
}

export function useChemflowVasilhamesPage(
  { page = 1, pageSize = 50, sort = '-created_date', select, filters } = {},
  options = {}
) {
  return useQuery({
    queryKey: [...CHEM_FLOW_QUERY_KEYS.vasilhames, 'page', page, pageSize, sort, select, filters],
    queryFn: () =>
      entities.vasilhames.listPage({
        page,
        pageSize,
        sort,
        select: select || LIST_PROJECTIONS.t_vasilhames,
        filters,
      }),
    staleTime: STALE_MS,
    enabled: options.enabled !== false,
    placeholderData: keepPreviousData,
  });
}

export function invalidateChemflowCatalogs() {
  return Promise.all([
    queryClientInstance.invalidateQueries({ queryKey: ['chemflow'] }),
  ]);
}
