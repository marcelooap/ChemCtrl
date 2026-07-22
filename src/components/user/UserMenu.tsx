import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { getRoleLabel } from '@/lib/permissions';
import { getInstalledVersion } from '@/pwa/version';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { UserAvatar, getUserDisplayName, getUserFirstName } from './UserAvatar';
import { ThemeSelector } from './ThemeSelector';
import { LanguageSelector } from './LanguageSelector';
import { SystemManualMenu } from './SystemManualMenu';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useToast } from '@/components/ui/use-toast';
import {
  LANGUAGE_LABELS,
  LANGUAGE_FLAGS,
  type SupportedLocale,
} from '@/i18n';
import { cn } from '@/lib/utils';

export function UserMenu() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, updateLanguage } = useInternalAuth();
  const [languageConfirm, setLanguageConfirm] = useState<{
    open: boolean;
    pendingLocale: SupportedLocale | null;
  }>({ open: false, pendingLocale: null });

  if (!user) return null;

  const displayName = getUserDisplayName(user);
  const firstName = getUserFirstName(user);
  const roleLabel = getRoleLabel(user);
  const jobTitle = user.cargo?.trim() || '';
  const username = user.usuario || user.username || '—';
  const version = getInstalledVersion();

  const handleLanguageSelect = (locale: SupportedLocale) => {
    setLanguageConfirm({ open: true, pendingLocale: locale });
  };

  const handleLanguageConfirm = async () => {
    if (!languageConfirm.pendingLocale) return;
    await updateLanguage(languageConfirm.pendingLocale);
    toast({
      title: t('welcome.toast.title', { name: firstName }),
      description: t('welcome.toast.message', { name: firstName }),
    });
    setLanguageConfirm({ open: false, pendingLocale: null });
  };

  const pendingLabel = languageConfirm.pendingLocale
    ? `${LANGUAGE_FLAGS[languageConfirm.pendingLocale]} ${LANGUAGE_LABELS[languageConfirm.pendingLocale]}`
    : '';

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-haspopup="menu"
                className={cn(
                  'flex items-center gap-2 rounded-lg px-2 py-1.5',
                  'hover:bg-accent/80 transition-colors outline-none',
                  'focus-visible:ring-2 focus-visible:ring-ring'
                )}
              >
                <UserAvatar user={user} size="sm" />
                <div className="hidden sm:block min-w-0 max-w-[180px] text-left">
                  <p className="text-sm font-medium text-foreground truncate leading-tight">{displayName}</p>
                  {jobTitle && (
                    <p className="text-[11px] text-muted-foreground truncate leading-tight">{jobTitle}</p>
                  )}
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-xs">
            <div className="space-y-1 text-left">
              <p>
                <span className="opacity-80">{t('users.menu.fullName')}</span>
                <br />
                <span className="font-medium">{displayName}</span>
              </p>
              <p>
                <span className="opacity-80">{t('users.menu.role')}</span>
                <br />
                <span className="font-medium">{roleLabel}</span>
              </p>
              <p>
                <span className="opacity-80">{t('users.menu.username')}</span>
                <br />
                <span className="font-medium">{username}</span>
              </p>
              <p>
                <span className="opacity-80">{t('users.menu.version')}</span>
                <br />
                <span className="font-medium">{version}</span>
              </p>
            </div>
          </TooltipContent>
        </Tooltip>

        <DropdownMenuContent align="end" className="w-64 p-0">
          <div className="px-4 py-4 flex items-start gap-3">
            <UserAvatar user={user} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm text-foreground truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">@{username}</p>
              <span className="inline-block mt-1.5 text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {roleLabel}
              </span>
            </div>
          </div>

          <DropdownMenuSeparator />

          <ThemeSelector />

          <DropdownMenuSeparator />

          <LanguageSelector onSelectLocale={handleLanguageSelect} />

          <DropdownMenuSeparator />

          <SystemManualMenu />

          <DropdownMenuSeparator />

          <div className="px-4 py-2 text-center">
            <span className="text-[10px] text-muted-foreground">{t('common.versionShort')} {version}</span>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmDialog
        open={languageConfirm.open}
        onOpenChange={(open) => !open && setLanguageConfirm({ open: false, pendingLocale: null })}
        title={t('language.changeTitle')}
        message={t('language.changeConfirm', { language: pendingLabel })}
        onConfirm={handleLanguageConfirm}
        confirmLabel={t('buttons.confirm')}
        cancelLabel={t('buttons.cancel')}
      />
    </>
  );
}
