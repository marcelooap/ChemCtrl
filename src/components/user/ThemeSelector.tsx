import React from 'react';
import { useTheme } from 'next-themes';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';

const themes = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
] as const;

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="flex gap-1 p-1">
        {themes.map((t) => (
          <div key={t.value} className="flex-1 h-9 rounded-md bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="px-2 py-2">
      <p className="text-xs font-medium text-muted-foreground mb-2 px-1">Tema</p>
      <div className="flex gap-1 p-1 bg-muted/50 rounded-lg">
        {themes.map(({ value, label, icon: Icon }) => {
          const isActive = theme === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setTheme(value)}
              title={label}
              aria-label={`Tema ${label}`}
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
