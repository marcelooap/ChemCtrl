import {
  chemflowSupabaseUrl,
  chemflowSupabaseAnonKey,
  isChemFlowConfigured,
  CHEMFLOW_CONFIG_ERROR,
} from '@/services/supabase/chemflow';
import { getSessionId } from '@industrializacao/api/rpcClient';
import { rateLimitedFetch } from '@industrializacao/lib/rateLimitedFetch';
import { HttpError, parseRetryAfterHeader } from '@industrializacao/lib/HttpError';
import {
  TECH_DOCS_BUCKET,
  validatePdfFile,
  viewRecipeDocument,
  downloadRecipeDocument,
} from '@industrializacao/api/storage';

export { validatePdfFile, TECH_DOCS_BUCKET };

export const viewProdutoDocument = viewRecipeDocument;
export const downloadProdutoDocument = downloadRecipeDocument;

/** Path relativo no bucket: produtos/{id}/sds/sds.pdf */
export const getProdutoDocPath = (produtoId) =>
  `produtos/${produtoId}/sds/sds.pdf`;

export const getProdutoDocStorageUrl = (produtoId) =>
  `${TECH_DOCS_BUCKET}/${getProdutoDocPath(produtoId)}`;

function assertConfigured(context) {
  if (!isChemFlowConfigured || !chemflowSupabaseUrl || !chemflowSupabaseAnonKey) {
    throw new Error(`[ChemFlow:${context}] ${CHEMFLOW_CONFIG_ERROR}`);
  }
}

const storageFetch = async (path, options = {}, kind = 'write') => {
  assertConfigured('storage');
  const sessionId = getSessionId();
  return rateLimitedFetch(`${chemflowSupabaseUrl}/storage/v1/object/${path}`, {
    ...options,
    headers: {
      apikey: chemflowSupabaseAnonKey,
      Authorization: `Bearer ${chemflowSupabaseAnonKey}`,
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
      ...options.headers,
    },
  }, { kind });
};

export const uploadProdutoDocument = async (produtoId, file) => {
  const validation = await validatePdfFile(file);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.code = validation.error;
    throw err;
  }
  const objectPath = getProdutoDocStorageUrl(produtoId);
  const resp = await storageFetch(objectPath, {
    method: 'POST',
    headers: {
      'x-upsert': 'true',
      'Content-Type': 'application/pdf',
    },
    body: file,
  }, 'upload');
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new HttpError(resp.status, `Upload falhou (${resp.status}): ${errBody}`, {
      retryAfterSec: parseRetryAfterHeader(resp),
    });
  }
  return objectPath;
};

export const deleteProdutoDocument = async (produtoId) => {
  const objectPath = getProdutoDocStorageUrl(produtoId);
  const resp = await storageFetch(objectPath, { method: 'DELETE' }, 'write');
  if (!resp.ok && resp.status !== 404) {
    const errBody = await resp.text().catch(() => '');
    throw new HttpError(resp.status, `Exclusão falhou (${resp.status}): ${errBody}`, {
      retryAfterSec: parseRetryAfterHeader(resp),
    });
  }
};
