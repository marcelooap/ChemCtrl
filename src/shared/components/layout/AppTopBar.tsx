import React, { type ReactNode } from 'react';
import { UserMenu } from '@shared/components/user/UserMenu';
import { AppVersionBadge } from '@/pwa/components/AppVersionBadge';
import { TerminalWeatherInfo } from '@shared/components/layout/TerminalWeatherInfo';

interface AppTopBarProps {
  /** Optional actions rendered before the user menu (e.g. admin modules hub). */
  topBarActions?: ReactNode;
  /** Optional extras inside the user dropdown (e.g. system manual). */
  userMenuExtras?: ReactNode;
  getRoleLabel?: (user: Record<string, unknown> | null) => string;
}

export function AppTopBar({ topBarActions, userMenuExtras, getRoleLabel }: AppTopBarProps = {}) {
  return (
    <header className="shrink-0 flex items-center justify-between gap-1 sm:gap-2 h-12 px-2 sm:px-4 mb-4 -mt-2 bg-background/90 backdrop-blur-sm border-b border-border">
      <TerminalWeatherInfo />
      <div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-auto">
        <AppVersionBadge />
        {topBarActions}
        <UserMenu menuExtras={userMenuExtras} getRoleLabel={getRoleLabel} />
      </div>
    </header>
  );
}
