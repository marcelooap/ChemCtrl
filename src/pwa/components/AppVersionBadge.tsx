import React from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdate } from '../hooks/useUpdate';

export function AppVersionBadge() {
  const { t } = useTranslation();
  const { updateAvailable, nextVersion } = useUpdate();

  if (!updateAvailable || !nextVersion) return null;

  return (
    <span
      className="hidden sm:inline-flex items-center rounded-full border border-[#2575D1]/30 bg-[#2575D1]/10 px-2.5 py-1 text-[11px] font-semibold text-[#2575D1] shrink-0"
      role="status"
    >
      {t('pwa.update.badgeNewVersion', { version: nextVersion })}
    </span>
  );
}
