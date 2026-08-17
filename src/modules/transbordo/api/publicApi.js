import { callRPC } from '@industrializacao/api/rpcClient';
import { supabaseUrl, supabaseAnonKey } from '@industrializacao/api/supabaseClient';
import { ProtectedDocumentError, PROTECTED_DOC_ERRORS } from '@industrializacao/lib/protectedDocument';
import { rateLimitedFetch } from '@industrializacao/lib/rateLimitedFetch';

const getPublicHeaders = () => ({
  apikey: supabaseAnonKey,
  Authorization: `Bearer ${supabaseAnonKey}`,
  'Content-Type': 'application/json',
});

export const fetchPublicProdutoInfo = (publicToken) =>
  callRPC('get_public_produto_info', { p_token: publicToken });

const signPublicStoragePath = async (storagePath, expiresIn = 3600) => {
  if (!storagePath) return null;
  const resp = await rateLimitedFetch(`${supabaseUrl}/storage/v1/object/sign/${storagePath}`, {
    method: 'POST',
    headers: getPublicHeaders(),
    body: JSON.stringify({ expiresIn }),
  }, { kind: 'public' });
  if (!resp.ok) return null;
  const data = await resp.json();
  const signed = data.signedURL || data.signedUrl;
  if (!signed) return null;
  return signed.startsWith('http') ? signed : `${supabaseUrl}/storage/v1${signed}`;
};

export const fetchPublicProdutoSdsSignedUrl = async (publicToken) => {
  const sdsInfo = await callRPC('get_public_produto_sds_path', { p_token: publicToken });
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
