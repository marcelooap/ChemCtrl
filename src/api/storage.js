// Storage utilities — fully self-contained (no cross-module imports to avoid Vite cache issues)
import { openProtectedPdf } from '@/lib/protectedDocument';
import { rateLimitedFetch } from '@/lib/rateLimitedFetch';
import { HttpError, parseRetryAfterHeader } from '@/lib/HttpError';

const getSessionId = () => localStorage.getItem('chemctrl_session_id') || '';

const supabaseUrl = 'https://cpzibnwytukcgxeamfhp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwemlibnd5dHVrY2d4ZWFtZmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcyMjksImV4cCI6MjA5NzMzMzIyOX0.28Y66Ba_u1GyQNnDpsdPXLiGHvcn_BkjGOyHsBPSqR0';

export const TECH_DOCS_BUCKET = 'documentos-tecnicos';
export const DOC_TYPES = { SDS: 'sds', TDS: 'tds', CERTIFICATES: 'certificates' };

/** Manual do sistema — path fixo no bucket (admin atualiza; todos baixam). */
export const SYSTEM_MANUAL_OBJECT_PATH = 'manual/guia-uso-chemctrl.pdf';
export const SYSTEM_MANUAL_STORAGE_URL = `${TECH_DOCS_BUCKET}/${SYSTEM_MANUAL_OBJECT_PATH}`;
export const SYSTEM_MANUAL_PUBLIC_FALLBACK = '/docs/Guia_de_Uso_ChemCtrl.pdf';
export const SYSTEM_MANUAL_FILENAME = 'Guia_de_Uso_ChemCtrl.pdf';

const BLOCKED_EXTENSIONS = new Set(['doc', 'docx', 'xls', 'xlsx', 'png', 'jpg', 'jpeg', 'zip', 'rar']);
const MAX_PDF_SIZE = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set(['application/pdf']);

export const PDF_VALIDATION_ERRORS = {
  INVALID_TYPE: 'invalidType',
  INVALID_SIZE: 'invalidSize',
  INVALID_CONTENT: 'invalidContent',
};

/** Relative path inside bucket: recipes/{id}/{docType}/{docType}.pdf */
export const getRecipeDocPath = (recipeId, docType) =>
  `recipes/${recipeId}/${docType}/${docType}.pdf`;

/** Full stored path including bucket prefix */
export const getRecipeDocStorageUrl = (recipeId, docType) =>
  `${TECH_DOCS_BUCKET}/${getRecipeDocPath(recipeId, docType)}`;

export const validatePdfFile = async (file) => {
  if (!file) return { valid: false, error: PDF_VALIDATION_ERRORS.INVALID_TYPE };

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (ext !== 'pdf' || BLOCKED_EXTENSIONS.has(ext)) {
    return { valid: false, error: PDF_VALIDATION_ERRORS.INVALID_TYPE };
  }

  const mime = (file.type || '').toLowerCase();
  if (mime && !ALLOWED_MIME.has(mime)) {
    return { valid: false, error: PDF_VALIDATION_ERRORS.INVALID_TYPE };
  }

  if (file.size > MAX_PDF_SIZE) {
    return { valid: false, error: PDF_VALIDATION_ERRORS.INVALID_SIZE };
  }

  try {
    const header = await file.slice(0, 4).arrayBuffer();
    const bytes = new Uint8Array(header);
    const magic = String.fromCharCode(...bytes);
    if (magic !== '%PDF') {
      return { valid: false, error: PDF_VALIDATION_ERRORS.INVALID_CONTENT };
    }
  } catch {
    return { valid: false, error: PDF_VALIDATION_ERRORS.INVALID_CONTENT };
  }

  return { valid: true };
};

const storageFetch = async (path, options = {}, kind = 'write') => {
  const sessionId = getSessionId();
  return rateLimitedFetch(`${supabaseUrl}/storage/v1/object/${path}`, {
    ...options,
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
      ...options.headers,
    },
  }, { kind });
};

export const uploadFileToSupabase = async (file, bucket = 'fotos-cq') => {
  const ext = (file.name ? file.name.split('.').pop() : null) || 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const contentType = file.type && file.type !== '' ? file.type : 'image/jpeg';
  const resp = await storageFetch(`${bucket}/${fileName}`, {
    method: 'POST',
    headers: {
      'x-upsert': 'true',
      'Content-Type': contentType,
    },
    body: file,
  }, 'upload');
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new HttpError(resp.status, `Upload falhou (${resp.status}): ${errBody}`, { retryAfterSec: parseRetryAfterHeader(resp) });
  }
  return `${bucket}/${fileName}`;
};

export const uploadRecipeDocument = async (recipeId, docType, file) => {
  const validation = await validatePdfFile(file);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.code = validation.error;
    throw err;
  }
  const objectPath = `${TECH_DOCS_BUCKET}/${getRecipeDocPath(recipeId, docType)}`;
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
    throw new HttpError(resp.status, `Upload falhou (${resp.status}): ${errBody}`, { retryAfterSec: parseRetryAfterHeader(resp) });
  }
  return objectPath;
};

export const deleteRecipeDocument = async (recipeId, docType) => {
  const objectPath = `${TECH_DOCS_BUCKET}/${getRecipeDocPath(recipeId, docType)}`;
  const resp = await storageFetch(objectPath, { method: 'DELETE' }, 'write');
  if (!resp.ok && resp.status !== 404) {
    const errBody = await resp.text().catch(() => '');
    throw new HttpError(resp.status, `Exclusão falhou (${resp.status}): ${errBody}`, { retryAfterSec: parseRetryAfterHeader(resp) });
  }
};

export const getSignedFileUrl = async (url, expiresIn = 3600) => {
  if (!url) return null;
  let path = url;
  const publicPrefix = `${supabaseUrl}/storage/v1/object/public/`;
  if (path.startsWith(publicPrefix)) path = path.substring(publicPrefix.length);
  const sessionId = getSessionId();
  const resp = await rateLimitedFetch(`${supabaseUrl}/storage/v1/object/sign/${path}`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
      ...(sessionId ? { 'x-session-id': sessionId } : {}),
    },
    body: JSON.stringify({ expiresIn }),
  }, { kind: 'download' });
  if (!resp.ok) {
    return url.startsWith('http') ? url : `${supabaseUrl}/storage/v1/object/public/${path}`;
  }
  const data = await resp.json();
  if (data.signedURL) {
    return data.signedURL.startsWith('http') ? data.signedURL : `${supabaseUrl}/storage/v1${data.signedURL}`;
  }
  return url.startsWith('http') ? url : `${supabaseUrl}/storage/v1/object/public/${path}`;
};

export const getRecipeDocumentSignedUrl = (fdsUrl, expiresIn = 3600) =>
  getSignedFileUrl(fdsUrl, expiresIn);

export const viewRecipeDocument = async (fdsUrl, filename) => {
  const url = await getRecipeDocumentSignedUrl(fdsUrl);
  if (!url) return;
  const { objectUrl } = await openProtectedPdf({
    signedUrl: url,
    filename: filename || 'document.pdf',
    mode: 'view',
  });
  window.open(objectUrl, '_blank');
};

export const downloadRecipeDocument = async (fdsUrl, filename) => {
  const url = await getRecipeDocumentSignedUrl(fdsUrl);
  if (!url) return;
  await openProtectedPdf({
    signedUrl: url,
    filename: filename || 'document.pdf',
    mode: 'download',
  });
};

const downloadFromPublicFallback = () => {
  const a = document.createElement('a');
  a.href = SYSTEM_MANUAL_PUBLIC_FALLBACK;
  a.download = SYSTEM_MANUAL_FILENAME;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
};

/**
 * Baixa o guia de uso.
 * Prioriza a versão no Storage (atualizada pelo admin); se não existir, usa /public/docs.
 */
export const downloadSystemManual = async () => {
  try {
    const sessionId = getSessionId();
    const resp = await rateLimitedFetch(`${supabaseUrl}/storage/v1/object/sign/${SYSTEM_MANUAL_STORAGE_URL}`, {
      method: 'POST',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json',
        ...(sessionId ? { 'x-session-id': sessionId } : {}),
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    }, { kind: 'download' });
    if (resp.ok) {
      const data = await resp.json();
      if (data.signedURL) {
        const signedUrl = data.signedURL.startsWith('http')
          ? data.signedURL
          : `${supabaseUrl}/storage/v1${data.signedURL}`;
        await openProtectedPdf({
          signedUrl,
          filename: SYSTEM_MANUAL_FILENAME,
          mode: 'download',
        });
        return;
      }
    }
  } catch {
    // fallback abaixo
  }
  downloadFromPublicFallback();
};

/**
 * Substitui o guia de uso no Storage.
 * Somente admin pode chamar esta ação pela UI (isAdminUser).
 */
export const uploadSystemManual = async (file) => {
  const validation = await validatePdfFile(file);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.code = validation.error;
    throw err;
  }
  const resp = await storageFetch(SYSTEM_MANUAL_STORAGE_URL, {
    method: 'POST',
    headers: {
      'x-upsert': 'true',
      'Content-Type': 'application/pdf',
    },
    body: file,
  }, 'upload');
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    throw new HttpError(resp.status, `Upload falhou (${resp.status}): ${errBody}`, { retryAfterSec: parseRetryAfterHeader(resp) });
  }
  return SYSTEM_MANUAL_STORAGE_URL;
};
