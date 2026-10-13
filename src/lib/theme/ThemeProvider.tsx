import React, { useEffect } from 'react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';

type ThemeProviderProps = {
  children: React.ReactNode;
  forcedTheme?: string;
  enableSystem?: boolean;
};

const THEME_COLOR = {
  light: '#f3f4f6',
  dark: '#0f111a',
} as const;

function setMetaContent(name: string, content: string) {
  const meta = document.querySelector(`meta[name="${name}"]`);
  if (meta) meta.setAttribute('content', content);
}

/** Keeps browser chrome and forced-dark mode in sync with the selected theme. */
function ThemeDocumentSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const dark = root.classList.contains('dark');
      setMetaContent('color-scheme', dark ? 'only dark' : 'only light');
      setMetaContent('theme-color', dark ? THEME_COLOR.dark : THEME_COLOR.light);
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  return null;
}

export function ThemeProvider({
  children,
  forcedTheme,
  enableSystem = true,
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem={enableSystem}
      enableColorScheme={false}
      forcedTheme={forcedTheme}
      storageKey="chemctrl-theme"
      disableTransitionOnChange={false}
    >
      <ThemeDocumentSync />
      {children}
    </NextThemesProvider>
  );
}
