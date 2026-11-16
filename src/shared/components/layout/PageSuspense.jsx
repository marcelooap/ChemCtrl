import { Suspense } from 'react';

/**
 * Fallback leve só na área de conteúdo — não substitui sidebar/topbar.
 * Evita o “piscar” de tela cheia ao trocar rotas lazy.
 */
export function PageFallback() {
  return (
    <div
      className="relative flex min-h-[12rem] flex-1 flex-col"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden rounded-full bg-border/60">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/70" />
      </div>
      <div className="flex flex-1 items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/25 border-t-primary/80" />
      </div>
    </div>
  );
}

/**
 * Isola o suspense da página: o chrome (sidebar/topbar) permanece montado.
 */
export default function PageSuspense({ children }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}
