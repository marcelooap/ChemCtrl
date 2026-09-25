import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Button } from '@shared/components/ui/button';
import { openEquipmentFile } from '@industrializacao/lib/equipmentFiles';

export function useEquipmentFile() {
  const { t } = useTranslation();
  const [preview, setPreview] = useState(null);
  const [loadingKey, setLoadingKey] = useState(null);

  const closePreview = useCallback(() => {
    setPreview((current) => {
      current?.revoke?.();
      return null;
    });
  }, []);

  const viewFile = useCallback(async (path, title) => {
    if (!path) return;
    const key = `view:${path}`;
    setLoadingKey(key);
    try {
      const file = await openEquipmentFile(path, { mode: 'view' });
      if (!file) return;
      setPreview((current) => {
        current?.revoke?.();
        return { ...file, path, title: title || file.filename };
      });
    } catch {
      alert(t('quality.equipment.viewDialog.openFailed'));
    } finally {
      setLoadingKey((current) => (current === key ? null : current));
    }
  }, [t]);

  const downloadFile = useCallback(async (path, title) => {
    if (!path) return;
    const key = `download:${path}`;
    setLoadingKey(key);
    try {
      await openEquipmentFile(path, { mode: 'download', filename: title });
    } catch {
      alert(t('quality.equipment.viewDialog.openFailed'));
    } finally {
      setLoadingKey((current) => (current === key ? null : current));
    }
  }, [t]);

  return { preview, loadingKey, viewFile, downloadFile, closePreview };
}

export default function EquipmentFilePreview({ preview, onClose, onDownload, loadingKey }) {
  const { t } = useTranslation();
  const downloading = preview ? loadingKey === `download:${preview.path}` : false;

  return (
    <Dialog open={!!preview} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="z-[60] flex h-[min(88vh,920px)] w-[min(960px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-4 pr-12 text-left">
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="truncate">{preview?.title || t('quality.equipment.viewDialog.currentCertificate')}</DialogTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!preview || downloading}
              onClick={() => preview && onDownload(preview.path, preview.filename)}
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              {t('common.download')}
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 bg-muted">
          {preview?.isImage ? (
            <img src={preview.url} alt={preview.title} className="h-full w-full object-contain" />
          ) : (
            <iframe src={preview?.url} title={preview?.title || t('quality.equipment.viewDialog.currentCertificate')} className="h-full w-full border-0 bg-white" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
