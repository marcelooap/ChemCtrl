// Public API for traceability consultation — no authentication required.
// Uses Supabase RPC (SECURITY DEFINER) that returns ONLY public fields.
// No internal data (costs, stock, observations, users) is ever exposed.

import { callRPC } from '@/api/rpcClient';

export const fetchPublicLotInfo = (publicToken) =>
  callRPC('get_public_lot_info', { p_token: publicToken });

export const fetchPublicCoaData = (publicToken) =>
  callRPC('get_public_coa_data', { p_token: publicToken });
