export class ProtectedDocumentError extends Error {
  constructor(code, status, detail) {
    super(detail || code);
    this.name = 'ProtectedDocumentError';
    this.code = code;
    this.status = status;
  }
}

export const PROTECTED_DOC_ERRORS = {
  FETCH_FAILED: 'FETCH_FAILED',
  EDGE_FAILED: 'EDGE_FAILED',
  NOT_AVAILABLE: 'NOT_AVAILABLE',
};

export function revokeBlobUrl(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    // ignore already-revoked URLs
  }
}

export async function fetchProtectedPdf(signedUrl) {
  if (!signedUrl) {
    throw new ProtectedDocumentError(PROTECTED_DOC_ERRORS.NOT_AVAILABLE);
  }
  const resp = await fetch(signedUrl);
  if (!resp.ok) {
    throw new ProtectedDocumentError(PROTECTED_DOC_ERRORS.FETCH_FAILED, resp.status);
  }
  const blob = await resp.blob();
  const objectUrl = URL.createObjectURL(blob);
  return { blob, objectUrl };
}

export function downloadBlobUrl(objectUrl, filename) {
  if (!objectUrl) return;
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename || 'document.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Fetch a protected PDF and open for view or download.
 * @returns {{ objectUrl, filename, revoke }}
 */
export async function openProtectedPdf({ signedUrl, filename, mode }) {
  const safeName = filename || 'document.pdf';
  const { objectUrl } = await fetchProtectedPdf(signedUrl);
  const revoke = () => revokeBlobUrl(objectUrl);

  if (mode === 'download') {
    downloadBlobUrl(objectUrl, safeName);
    setTimeout(revoke, 5000);
    return { objectUrl, filename: safeName, revoke };
  }

  return { objectUrl, filename: safeName, revoke };
}
