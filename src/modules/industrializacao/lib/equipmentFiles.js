import { fetchProtectedPdf, openProtectedPdf, revokeBlobUrl } from '@industrializacao/lib/protectedDocument';
import { getSignedFileUrl } from '@industrializacao/api/storage';

export function parseJsonArray(value) {
  try {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
  } catch {
    return [];
  }
}

export function fileNameFromPath(path) {
  if (!path) return 'certificado.pdf';
  const raw = String(path).split('?')[0].split('/').pop() || 'certificado.pdf';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function getEquipmentCertificatePath(equipment) {
  if (!equipment) return null;
  if (equipment.certificate_url) return equipment.certificate_url;
  const history = parseJsonArray(equipment.calibration_history);
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.certificate_url) return history[i].certificate_url;
  }
  return null;
}

export function listEquipmentFiles(equipment) {
  if (!equipment) return [];
  const files = [];
  const certificatePath = getEquipmentCertificatePath(equipment);
  if (certificatePath) {
    files.push({
      id: `certificate:${certificatePath}`,
      url: certificatePath,
      kind: 'certificate',
    });
  }
  if (equipment.manual_url) {
    files.push({
      id: `manual:${equipment.manual_url}`,
      url: equipment.manual_url,
      kind: 'manual',
    });
  }
  parseJsonArray(equipment.attachments).forEach((attachment, index) => {
    if (!attachment?.url || attachment.url === certificatePath || attachment.url === equipment.manual_url) return;
    files.push({
      id: `attachment:${index}:${attachment.url}`,
      url: attachment.url,
      kind: 'attachment',
      name: attachment.name,
    });
  });
  return files;
}

export async function openEquipmentFile(path, { mode = 'view', filename } = {}) {
  const signedUrl = await getSignedFileUrl(path);
  if (!signedUrl) throw new Error('missing');
  const storedName = fileNameFromPath(path);
  const safeName = filename && /\.[a-z0-9]{2,5}$/i.test(filename) ? filename : storedName;

  if (mode === 'download') {
    await openProtectedPdf({ signedUrl, filename: safeName, mode: 'download' });
    return null;
  }

  const { blob, objectUrl } = await fetchProtectedPdf(signedUrl);
  return {
    url: objectUrl,
    filename: safeName,
    isImage: (blob.type || '').startsWith('image/'),
    revoke: () => revokeBlobUrl(objectUrl),
  };
}
