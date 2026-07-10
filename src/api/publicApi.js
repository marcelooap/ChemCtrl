// Public API for traceability consultation — no authentication required.
// Uses Supabase RPC (SECURITY DEFINER) that returns ONLY public fields.
// No internal data (costs, stock, observations, users) is ever exposed.

import { callRPC } from '@/api/rpcClient';
import { ProtectedDocumentError, PROTECTED_DOC_ERRORS } from '@/lib/protectedDocument';

const supabaseUrl = 'https://cpzibnwytukcgxeamfhp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwemlibnd5dHVrY2d4ZWFtZmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcyMjksImV4cCI6MjA5NzMzMzIyOX0.28Y66Ba_u1GyQNnDpsdPXLiGHvcn_BkjGOyHsBPSqR0';

const getPublicHeaders = () => ({
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
});

export const fetchPublicLotInfo = (publicToken) =>
  callRPC('get_public_lot_info', { p_token: publicToken });

export const fetchPublicCoaData = (publicToken) =>
  callRPC('get_public_coa_data', { p_token: publicToken });

const signPublicStoragePath = async (storagePath, expiresIn = 3600) => {
  if (!storagePath) return null;
  const resp = await fetch(`${supabaseUrl}/storage/v1/object/sign/${storagePath}`, {
    method: 'POST',
    headers: getPublicHeaders(),
    body: JSON.stringify({ expiresIn }),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const signed = data.signedURL || data.signedUrl;
  if (!signed) return null;
  return signed.startsWith('http') ? signed : `${supabaseUrl}/storage/v1${signed}`;
};

/** Fallback when edge function is unavailable: RPC path + client-side signed URL */
const fetchPublicSdsViaRpc = async (publicToken) => {
  const sdsInfo = await callRPC('get_public_sds_path', { p_token: publicToken });
  if (!sdsInfo?.fds_url || sdsInfo?.has_sds === false) {
    return { has_sds: false };
  }

  const signedUrl = await signPublicStoragePath(sdsInfo.fds_url);
  if (!signedUrl) {
    throw new ProtectedDocumentError(
      PROTECTED_DOC_ERRORS.EDGE_FAILED,
      null,
      'Failed to sign SDS URL',
    );
  }

  return {
    has_sds: true,
    signed_url: signedUrl,
    fds_filename: sdsInfo.fds_filename || 'sds.pdf',
  };
};

export const fetchPublicSdsSignedUrl = async (publicToken) => {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/public-sds-url`, {
      method: 'POST',
      headers: getPublicHeaders(),
      body: JSON.stringify({ token: publicToken }),
    });

    if (resp.ok) {
      const data = await resp.json();
      if (data?.signed_url) return data;
    }

    // Edge function missing (404) or returned no URL — fall back to RPC + storage sign
    if (resp.status === 404) {
      return fetchPublicSdsViaRpc(publicToken);
    }

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new ProtectedDocumentError(
        PROTECTED_DOC_ERRORS.EDGE_FAILED,
        resp.status,
        body.error || `SDS request failed (${resp.status})`,
      );
    }
  } catch (err) {
    if (err instanceof ProtectedDocumentError) throw err;
    // Network error or edge unavailable — try RPC fallback
    return fetchPublicSdsViaRpc(publicToken);
  }

  return fetchPublicSdsViaRpc(publicToken);
};
