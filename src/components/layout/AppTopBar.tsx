import React from 'react';
import { NotificationBell } from '@/notifications/components/NotificationBell';

export function AppTopBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-end h-12 px-2 sm:px-4 mb-4 -mt-2 bg-[#F5F5F7]/90 backdrop-blur-sm border-b border-gray-200/60">
      <NotificationBell />
    </header>
  );
}
