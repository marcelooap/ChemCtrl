import React from 'react';
import { cn } from '@/lib/utils';
import i18n from '@/i18n';

interface ChemCtrlUser {
  nome?: string;
  full_name?: string;
  nome_completo?: string;
}

interface UserAvatarProps {
  user: ChemCtrlUser | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'w-7 h-7 text-[10px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-sm',
};

function getInitial(user: ChemCtrlUser | null): string {
  const name = user?.nome || user?.full_name || user?.nome_completo || 'U';
  return name.charAt(0).toUpperCase();
}

export function UserAvatar({ user, size = 'md', className }: UserAvatarProps) {
  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center font-bold text-white shrink-0',
        sizeClasses[size],
        className
      )}
      style={{ background: '#2575D1' }}
    >
      {getInitial(user)}
    </div>
  );
}

export function getUserDisplayName(user: ChemCtrlUser | null): string {
  return user?.nome || user?.full_name || user?.nome_completo || i18n.t('common.defaultUser');
}

export function getUserFirstName(user: ChemCtrlUser | null): string {
  const full = getUserDisplayName(user);
  return full.split(' ')[0] || full;
}
