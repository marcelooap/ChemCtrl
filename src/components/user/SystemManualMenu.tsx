import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, Loader2, Upload } from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { isAdminUser } from '@/lib/permissions';
import {
  downloadSystemManual,
  uploadSystemManual,
  PDF_VALIDATION_ERRORS,
} from '@/api/storage';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

export function SystemManualMenu() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user } = useInternalAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const canUpdate = isAdminUser(user);

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadSystemManual();
      toast({
        title: t('users.manual.downloadStarted'),
        description: t('users.manual.downloadStartedDesc'),
      });
    } catch {
      toast({
        title: t('errors.pdfFailed'),
        description: t('users.manual.downloadError'),
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleUpdateClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canUpdate || uploading) return;
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!canUpdate) {
      toast({
        title: t('errors.forbidden'),
        description: t('users.manual.updateForbidden'),
        variant: 'destructive',
      });
      return;
    }

    setUploading(true);
    try {
      await uploadSystemManual(file);
      toast({
        title: t('users.manual.updateSuccess'),
        description: t('users.manual.updateSuccessDesc'),
      });
    } catch (err) {
      const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
      let description = t('users.manual.updateError');
      if (code === PDF_VALIDATION_ERRORS.INVALID_TYPE || code === PDF_VALIDATION_ERRORS.INVALID_CONTENT) {
        description = t('users.manual.invalidPdf');
      } else if (code === PDF_VALIDATION_ERRORS.INVALID_SIZE) {
        description = t('errors.fileTooLarge');
      } else if (err instanceof Error && /403|401|forbidden/i.test(err.message)) {
        description = t('users.manual.updateForbidden');
      }
      toast({
        title: t('errors.uploadFailed'),
        description,
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="px-2 py-2 space-y-1">
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className={cn(
          'flex items-center gap-2 w-full px-2 py-2 text-xs font-medium rounded-md',
          'text-foreground hover:bg-accent/50 transition-colors',
          'disabled:opacity-60 disabled:pointer-events-none'
        )}
      >
        {downloading ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-primary" />
        ) : (
          <BookOpen className="w-3.5 h-3.5 shrink-0 text-primary" />
        )}
        <span className="truncate">{t('users.manual.downloadButton')}</span>
      </button>

      {canUpdate && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={handleUpdateClick}
            disabled={uploading}
            className={cn(
              'flex items-center gap-2 w-full px-2 py-2 text-xs font-medium rounded-md',
              'text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors',
              'disabled:opacity-60 disabled:pointer-events-none'
            )}
          >
            {uploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : (
              <Upload className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">{t('users.manual.updateButton')}</span>
          </button>
        </>
      )}
    </div>
  );
}
