// Public API for traceability consultation — no authentication required.
// Uses Supabase RPC (SECURITY DEFINER) that returns ONLY public fields.
// No internal data (costs, stock, observations, users) is ever exposed.

import { callRPC } from '@/api/rpcClient';

const supabaseUrl = 'https://cpzibnwytukcgxeamfhp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwemlibnd5dHVrY2d4ZWFtZmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcyMjksImV4cCI6MjA5NzMzMzIyOX0.28Y66Ba_u1GyQNnDpsdPXLiGHvcn_BkjGOyHsBPSqR0';

export const fetchPublicLotInfo = (publicToken) =>
  callRPC('get_public_lot_info', { p_token: publicToken });

export const fetchPublicCoaData = (publicToken) =>
  callRPC('get_public_coa_data', { p_token: publicToken });

export const fetchPublicSdsSignedUrl = async (publicToken) => {
  const resp = await fetch(`${supabaseUrl}/functions/v1/public-sds-url`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token: publicToken }),
  });
  if (resp.status === 404) {
    return { has_sds: false };
  }
  if (!resp.ok) {
    throw new Error(`SDS request failed (${resp.status})`);
  }
  return resp.json();
};
