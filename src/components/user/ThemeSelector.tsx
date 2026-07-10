import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ThemeSelector() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  const themes = [
    { value: 'light', labelKey: 'theme.light', icon: Sun },
    { value: 'dark', labelKey: 'theme.dark', icon: Moon },
    { value: 'system', labelKey: 'theme.system', icon: Monitor },
  ] as const;

  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="flex gap-1 p-1">
        {themes.map((th) => (
          <div key={th.value} className="flex-1 h-9 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="px-2 py-2">
      <p className="text-xs font-medium text-muted-foreground mb-2 px-1">{t('theme.label')}</p>
      <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
        {themes.map(({ value, labelKey, icon: Icon }) => {
          const isActive = theme === value;
          const label = t(labelKey);
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              title={label}
              aria-label={t('theme.ariaLabel', { theme: label })}
              aria-pressed={isActive}
              className={cn(
                'flex-1 flex flex-col items-center gap-1 py-2 px-1 rounded-md text-xs transition-all',
                isActive
                  ? 'bg-background text-primary shadow-sm ring-1 ring-primary/30'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
              )}
            >
              <Icon className={cn('w-4 h-4', isActive && 'text-primary')} />
              <span className="text-[10px] font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
