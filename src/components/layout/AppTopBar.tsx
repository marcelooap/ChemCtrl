import React from 'react';
import { NotificationBell } from '@/notifications/components/NotificationBell';
import { UserMenu } from '@/components/user/UserMenu';

export function AppTopBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-end gap-1 sm:gap-2 h-12 px-2 sm:px-4 mb-4 -mt-2 bg-background/90 backdrop-blur-sm border-b border-border">
      <NotificationBell />
      <UserMenu />
    </header>
  );
}
