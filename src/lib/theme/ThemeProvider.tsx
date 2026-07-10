import React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

type ThemeProviderProps = {
  children: React.ReactNode;
  forcedTheme?: string;
  enableSystem?: boolean;
};

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
      forcedTheme={forcedTheme}
      storageKey="chemctrl-theme"
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemesProvider>
  );
}
