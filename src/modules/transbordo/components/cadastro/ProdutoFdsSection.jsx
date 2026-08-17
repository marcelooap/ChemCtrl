import { useRef, useState } from 'react';
import { Upload, Loader2, Eye, Download, RefreshCw, Trash2, FileText } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@shared/components/ui/alert-dialog';
import { useToast } from '@shared/components/ui/use-toast';
import { entities } from '@transbordo/services/entities';
import {
  validatePdfFile,
  uploadProdutoDocument,
  deleteProdutoDocument,
  viewProdutoDocument,
  downloadProdutoDocument,
  getProdutoDocStorageUrl,
} from '@transbordo/api/storage';
import { generatePublicToken } from '@industrializacao/lib/publicToken';

const ACCEPT_PDF = '.pdf,application/pdf';

const ERROR_MESSAGES = {
  invalidType: 'Envie um arquivo PDF válido.',
  invalidSize: 'O PDF deve ter no máximo 20 MB.',
  invalidContent: 'O arquivo não parece ser um PDF válido.',
  uploadFailed: 'Não foi possível enviar a FDS. Tente novamente.',
};

export default function ProdutoFdsSection({
  produtoId,
  fdsUrl,
  fdsFilename,
  fdsUploadedAt,
  uploadedBy,
  onMetadataChange,
  readOnly = false,
}) {
  const { toast } = useToast();
  const fileInputRef = useRef(null);
  const replaceInputRef = useRef(null);

  const [uploading, setUploading] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [removeOpen, setRemoveOpen] = useState(false);

  const hasFds = Boolean(fdsUrl);

  const handleValidationError = (errorCode) => {
    toast({
      title: 'FDS',
      description: ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.uploadFailed,
      variant: 'destructive',
    });
  };

  const handleFileSelect = async (file, isReplace = false) => {
    if (!file || !produtoId) return;
    const validation = await validatePdfFile(file);
    if (!validation.valid) {
      handleValidationError(validation.error);
      return;
    }
    if (isReplace) {
      setReplaceTarget(file);
      return;
    }
    await performUpload(file);
  };

  const persistMetadata = async (metadata) => {
    const payload = { ...metadata };
    await entities.produtos.update(produtoId, payload);
    onMetadataChange?.(payload);
  };

  const performUpload = async (file) => {
    setUploading(true);
    try {
      const path = await uploadProdutoDocument(produtoId, file);
      const metadata = {
        fds_url: path || getProdutoDocStorageUrl(produtoId),
        fds_filename: file.name,
        fds_uploaded_at: new Date().toISOString(),
        fds_uploaded_by: uploadedBy || '',
      };
      const current = await entities.produtos.get(produtoId).catch(() => null);
      if (!current?.public_token) {
        metadata.public_token = generatePublicToken();
      }
      await persistMetadata(metadata);
      toast({ title: 'FDS anexada com sucesso' });
    } catch (err) {
      handleValidationError(err.code || 'uploadFailed');
    } finally {
      setUploading(false);
    }
  };

  const confirmReplace = async () => {
    if (!replaceTarget) return;
    setUploading(true);
    try {
      const path = await uploadProdutoDocument(produtoId, replaceTarget);
      await persistMetadata({
        fds_url: path || getProdutoDocStorageUrl(produtoId),
        fds_filename: replaceTarget.name,
        fds_uploaded_at: new Date().toISOString(),
        fds_uploaded_by: uploadedBy || '',
      });
      toast({ title: 'FDS substituída com sucesso' });
    } catch (err) {
      handleValidationError(err.code || 'uploadFailed');
    } finally {
      setUploading(false);
      setReplaceTarget(null);
    }
  };

  const confirmRemove = async () => {
    setUploading(true);
    try {
      await deleteProdutoDocument(produtoId);
      await persistMetadata({
        fds_url: null,
        fds_filename: null,
        fds_uploaded_at: null,
        fds_uploaded_by: null,
      });
      toast({ title: 'FDS removida' });
    } catch (err) {
      toast({
        title: 'FDS',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="border-t border-border pt-4 mt-1">
      <h3 className="text-sm font-semibold mb-3">Ficha de Dados de Segurança (FDS)</h3>

      {hasFds ? (
        <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">{fdsFilename || 'sds.pdf'}</span>
          </div>
          {fdsUploadedAt ? (
            <p className="text-xs text-muted-foreground">
              Enviada em {new Date(fdsUploadedAt).toLocaleString('pt-BR')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => viewProdutoDocument(fdsUrl, fdsFilename)}
              className="gap-1.5"
            >
              <Eye className="w-3.5 h-3.5" /> Visualizar
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => downloadProdutoDocument(fdsUrl, fdsFilename)}
              className="gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Baixar
            </Button>
            {!readOnly && (
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
                  Substituir
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => setRemoveOpen(true)}
                  className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remover
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Nenhuma FDS anexada a este produto.</p>
          {!readOnly && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5"
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Anexar FDS
            </Button>
          )}
        </div>
      )}

      <div className="mt-2 space-y-0.5">
        <p className="text-xs text-muted-foreground">Apenas PDF. O QR da etiqueta convencional abre esta FDS.</p>
        <p className="text-xs text-muted-foreground">Tamanho máximo: 20 MB.</p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT_PDF}
        className="hidden"
        onChange={(e) => {
          handleFileSelect(e.target.files?.[0], false);
          e.target.value = '';
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept={ACCEPT_PDF}
        className="hidden"
        onChange={(e) => {
          handleFileSelect(e.target.files?.[0], true);
          e.target.value = '';
        }}
      />

      <AlertDialog
        open={!!replaceTarget}
        onOpenChange={(open) => { if (!open && !uploading) setReplaceTarget(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Substituir FDS</AlertDialogTitle>
            <AlertDialogDescription>
              O arquivo atual será substituído pelo novo PDF. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={uploading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReplace} disabled={uploading}>
              Substituir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={removeOpen}
        onOpenChange={(open) => { if (!open && !uploading) setRemoveOpen(false); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover FDS</AlertDialogTitle>
            <AlertDialogDescription>
              A FDS será removida deste produto. O QR da etiqueta deixará de exibir o documento.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={uploading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              disabled={uploading}
              className="bg-red-600 hover:bg-red-700"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
