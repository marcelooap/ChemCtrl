/**
 * Catálogo genérico de módulos de aplicativo (shells).
 * Escala para futuros módulos (comercial, logística, etc.) sem ifs espalhados.
 */

export const MODULE_IDS = Object.freeze({
  INDUSTRIALIZACAO: 'industrializacao',
  TRANSBORDO: 'transbordo',
});

/** @typedef {{ id: string, route: string, routePrefixes: string[], accent: string, icon: string, titleKey: string, descriptionKey: string }} AppModule */

/** @type {AppModule[]} */
export const APP_MODULES = [
  {
    id: MODULE_IDS.INDUSTRIALIZACAO,
    route: '/',
    routePrefixes: [],
    accent: '#2575D1',
    icon: 'Factory',
    titleKey: 'moduleSelection.modules.industrializacao.title',
    descriptionKey: 'moduleSelection.modules.industrializacao.description',
  },
  {
    id: MODULE_IDS.TRANSBORDO,
    route: '/chemflow',
    routePrefixes: ['/chemflow'],
    accent: '#0D9488',
    icon: 'ArrowRightLeft',
    titleKey: 'moduleSelection.modules.transbordo.title',
    descriptionKey: 'moduleSelection.modules.transbordo.description',
  },
];

export function getModuleById(moduleId) {
  return APP_MODULES.find((m) => m.id === moduleId) || null;
}

export function getModuleByRoute(pathname) {
  if (!pathname) return null;
  if (pathname === '/' || pathname === '') {
    return getModuleById(MODULE_IDS.INDUSTRIALIZACAO);
  }
  const sorted = [...APP_MODULES]
    .filter((m) => m.routePrefixes.length > 0)
    .sort((a, b) => (b.routePrefixes[0]?.length || 0) - (a.routePrefixes[0]?.length || 0));
  for (const mod of sorted) {
    if (mod.routePrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
      return mod;
    }
  }
  // Rotas raiz do ChemCtrl (industrialização) — exclui shells de outros módulos
  if (
    !pathname.startsWith('/chemflow')
    && !pathname.startsWith('/painel')
    && !pathname.startsWith('/selecionar-modulo')
    && !pathname.startsWith('/login')
  ) {
    return getModuleById(MODULE_IDS.INDUSTRIALIZACAO);
  }
  return null;
}
