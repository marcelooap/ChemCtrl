import React from 'react';
import { UserMenu } from '@/components/user/UserMenu';
import { AppVersionBadge } from '@/pwa/components/AppVersionBadge';
import { TerminalWeatherInfo } from '@/components/layout/TerminalWeatherInfo';

export function AppTopBar() {
  return (
    <header className="shrink-0 flex items-center justify-between gap-1 sm:gap-2 h-12 px-2 sm:px-4 mb-4 -mt-2 bg-background/90 backdrop-blur-sm border-b border-border">
      <TerminalWeatherInfo />
      <div className="flex items-center gap-1 sm:gap-2 shrink-0 ml-auto">
        <AppVersionBadge />
        <UserMenu />
      </div>
    </header>
  );
}
