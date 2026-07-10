import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, Loader2, Eye, Download, RefreshCw, Trash2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/use-toast';
import { base44 } from '@/api/base44Client';
import {
  validatePdfFile,
  uploadRecipeDocument,
  deleteRecipeDocument,
  viewRecipeDocument,
  downloadRecipeDocument,
  DOC_TYPES,
  getRecipeDocStorageUrl,
} from '@/api/storage';

const ACCEPT_PDF = '.pdf,application/pdf';

export default function RecipeFdsSection({
  recipeId,
  fdsUrl,
  fdsFilename,
  fdsUploadedAt,
  canManage,
  canRemove,
  canView,
  uploadedBy,
  onMetadataChange,
  pendingFile,
  onPendingFileChange,
  mode = 'edit',
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);

  const [uploading, setUploading] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const hasFds = Boolean(fdsUrl);
  const isCreate = mode === 'create';
  const showViewDownload = canView || canManage;

  const handleValidationError = (errorCode) => {
    const key = `recipes.fds.errors.${errorCode || 'uploadFailed'}`;
    toast({
      title: t('recipes.fds.errors.title'),
      description: t(key),
      variant: 'destructive',
    });
  };

  const handleFileSelect = async (file, isReplace = false) => {
    if (!file) return;
    const validation = await validatePdfFile(file);
    if (!validation.valid) {
      handleValidationError(validation.error);
      return;
    }

    if (isCreate && !recipeId) {
      onPendingFileChange?.(file);
      return;
    }

    if (isReplace) {
      setReplaceTarget(file);
      return;
    }

    if (!recipeId) return;
    await performUpload(file);
  };

  const buildMetadata = (file) => ({
    fds_url: getRecipeDocStorageUrl(recipeId, DOC_TYPES.SDS),
    fds_filename: file.name,
    fds_uploaded_at: new Date().toISOString(),
    fds_uploaded_by: uploadedBy || '',
  });

  const performUpload = async (file) => {
    if (!recipeId) return;
    setUploading(true);
    try {
      const path = await uploadRecipeDocument(recipeId, DOC_TYPES.SDS, file);
      const metadata = { ...buildMetadata(file), fds_url: path };
      await base44.entities.Recipe.update(recipeId, metadata);
      onMetadataChange?.(metadata);
      onPendingFileChange?.(null);
      toast({ title: t('recipes.fds.success.uploaded') });
    } catch (err) {
      handleValidationError(err.code || 'uploadFailed');
    } finally {
      setUploading(false);
    }
  };

  const confirmReplace = async () => {
    if (!replaceTarget || !recipeId) return;
    setUploading(true);
    try {
      const path = await uploadRecipeDocument(recipeId, DOC_TYPES.SDS, replaceTarget);
      const metadata = { ...buildMetadata(replaceTarget), fds_url: path };
      await base44.entities.Recipe.update(recipeId, metadata);
      onMetadataChange?.(metadata);
      toast({ title: t('recipes.fds.success.replaced') });
    } catch (err) {
      handleValidationError(err.code || 'uploadFailed');
    } finally {
      setUploading(false);
      setReplaceTarget(null);
    }
  };

  const confirmRemove = async () => {
    if (!recipeId) return;
    setUploading(true);
    try {
      await deleteRecipeDocument(recipeId, DOC_TYPES.SDS);
      const cleared = {
        fds_url: null,
        fds_filename: null,
        fds_uploaded_at: null,
        fds_uploaded_by: null,
      };
      await base44.entities.Recipe.update(recipeId, cleared);
      onMetadataChange?.(cleared);
      toast({ title: t('recipes.fds.success.removed') });
    } catch (err) {
      toast({
        title: t('recipes.fds.errors.title'),
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const displayName = isCreate
    ? (pendingFile?.name || t('recipes.fds.noFileSelected'))
    : (fdsFilename || t('recipes.fds.noFileSelected'));

  return (
    <div className="border-t border-border pt-4 mt-2">
      <h3 className="text-sm font-semibold mb-3">{t('recipes.fds.title')}</h3>

      {hasFds || (isCreate && pendingFile) ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">{displayName}</span>
          </div>
          {fdsUploadedAt && !isCreate && (
            <p className="text-xs text-muted-foreground">
              {t('recipes.fds.uploadedAt', { date: new Date(fdsUploadedAt).toLocaleString() })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {showViewDownload && hasFds && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => viewRecipeDocument(fdsUrl)}
                  className="gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5" /> {t('recipes.fds.view')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => downloadRecipeDocument(fdsUrl, fdsFilename)}
                  className="gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" /> {t('recipes.fds.download')}
                </Button>
              </>
            )}
            {canManage && !isCreate && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => replaceInputRef.current?.click()}
                  className="gap-1.5"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  {t('recipes.fds.replace')}
                </Button>
                {canRemove && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploading}
                    onClick={() => setRemoveOpen(true)}
                    className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> {t('recipes.fds.remove')}
                  </Button>
                )}
              </>
            )}
            {canManage && isCreate && pendingFile && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onPendingFileChange?.(null)}
                className="gap-1.5 text-red-600"
              >
                <Trash2 className="w-3.5 h-3.5" /> {t('recipes.fds.clearSelection')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {!isCreate && (
            <p className="text-sm text-muted-foreground">{t('recipes.fds.noneAttached')}</p>
          )}
          {canManage && (
            <>
              {isCreate ? (
                <label className="flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-border cursor-pointer hover:bg-accent/50 transition-colors">
                  <Upload className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">{t('recipes.fds.selectFile')}</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_PDF}
                    className="hidden"
                    onChange={(e) => handleFileSelect(e.target.files?.[0], false)}
                  />
                </label>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="gap-1.5"
                >
                  {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  {t('recipes.fds.attach')}
                </Button>
              )}
              {!isCreate && (
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT_PDF}
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files?.[0], false)}
                />
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-2 space-y-0.5">
        <p className="text-xs text-muted-foreground">{t('recipes.fds.formatHint')}</p>
        <p className="text-xs text-muted-foreground">{t('recipes.fds.sizeHint')}</p>
      </div>

      <input
        ref={replaceInputRef}
        type="file"
        accept={ACCEPT_PDF}
        className="hidden"
        onChange={(e) => handleFileSelect(e.target.files?.[0], true)}
      />

      <ConfirmDialog
        open={!!replaceTarget}
        onOpenChange={(open) => { if (!open) setReplaceTarget(null); }}
        title={t('recipes.fds.replaceConfirm.title')}
        message={t('recipes.fds.replaceConfirm.message')}
        confirmLabel={t('recipes.fds.replace')}
        onConfirm={confirmReplace}
      />

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={t('recipes.fds.removeConfirm.title')}
        message={t('recipes.fds.removeConfirm.message')}
        confirmLabel={t('recipes.fds.remove')}
        confirmColor="#DC2626"
        onConfirm={confirmRemove}
      />
    </div>
  );
}

/** Read-only FDS block for the view recipe dialog */
export function RecipeFdsViewSection({ fdsUrl, fdsFilename, canView }) {
  const { t } = useTranslation();
  if (!fdsUrl || !canView) {
    if (!canView) return null;
    return (
      <div className="border-t border-border pt-4 mt-4">
        <h4 className="text-sm font-semibold mb-2">{t('recipes.fds.title')}</h4>
        <p className="text-sm text-muted-foreground">{t('recipes.fds.noneAttached')}</p>
      </div>
    );
  }
  return (
    <div className="border-t border-border pt-4 mt-4">
      <h4 className="text-sm font-semibold mb-2">{t('recipes.fds.title')}</h4>
      <div className="flex items-center gap-2 mb-2">
        <FileText className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">{fdsFilename}</span>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => viewRecipeDocument(fdsUrl)} className="gap-1.5">
          <Eye className="w-3.5 h-3.5" /> {t('recipes.fds.view')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => downloadRecipeDocument(fdsUrl, fdsFilename)} className="gap-1.5">
          <Download className="w-3.5 h-3.5" /> {t('recipes.fds.download')}
        </Button>
      </div>
    </div>
  );
}
