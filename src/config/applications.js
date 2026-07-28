import {
  LayoutDashboard,
  Package,
  BookOpen,
  ShieldCheck,
  Factory,
  Truck,
  ArrowRightLeft,
  Filter,
  Cylinder,
  ClipboardList,
} from 'lucide-react';

/**
 * Portal de aplicações do ecossistema ChemCtrl.
 * Para adicionar um novo módulo, inclua um item neste array.
 *
 * @typedef {Object} ApplicationFeature
 * @property {string} id
 * @property {string} labelKey - chave i18n relativa a systemSelector.apps.<appId>.features.<id>
 * @property {import('lucide-react').LucideIcon} icon
 *
 * @typedef {Object} ApplicationDefinition
 * @property {string} id
 * @property {string} nameKey
 * @property {string} descriptionKey
 * @property {string} logoSrc
 * @property {boolean} enabled
 * @property {boolean} [requiresAdmin] - se true, só administradores acessam
 * @property {string|null} route - rota fixa; se null e enabled, usa getDefaultRoute(user)
 * @property {string} [badgeKey]
 * @property {string} [ctaKey]
 * @property {string} [ctaDisabledKey]
 * @property {ApplicationFeature[]} features
 */

/** @type {ApplicationDefinition[]} */
export const applications = [
  {
    id: 'chemblend',
    nameKey: 'systemSelector.apps.chemblend.name',
    descriptionKey: 'systemSelector.apps.chemblend.description',
    logoSrc: '/icons/chemblend-logo.png',
    enabled: true,
    // null → resolveApplicationRoute usa getDefaultRoute(user)
    // (ex.: cliente externo → /chemblend/tela-clientes; interno → /chemblend)
    route: null,
    ctaKey: 'systemSelector.apps.chemblend.cta',
    features: [
      { id: 'production', labelKey: 'systemSelector.apps.chemblend.features.production', icon: Factory },
      { id: 'stock', labelKey: 'systemSelector.apps.chemblend.features.stock', icon: Package },
      { id: 'recipes', labelKey: 'systemSelector.apps.chemblend.features.recipes', icon: BookOpen },
      { id: 'quality', labelKey: 'systemSelector.apps.chemblend.features.quality', icon: ShieldCheck },
      { id: 'dashboard', labelKey: 'systemSelector.apps.chemblend.features.dashboard', icon: LayoutDashboard },
    ],
  },
  {
    id: 'chemflow',
    nameKey: 'systemSelector.apps.chemflow.name',
    descriptionKey: 'systemSelector.apps.chemflow.description',
    logoSrc: '/icons/chemflow-logo.png',
    enabled: true,
    /** Em desenvolvimento: apenas administradores acessam o módulo. */
    requiresAdmin: true,
    route: '/chemflow',
    badgeKey: 'systemSelector.apps.chemflow.badge',
    ctaKey: 'systemSelector.apps.chemflow.cta',
    ctaDisabledKey: 'systemSelector.apps.chemflow.ctaDisabled',
    features: [
      { id: 'truck', labelKey: 'systemSelector.apps.chemflow.features.truck', icon: Truck },
      { id: 'transfer', labelKey: 'systemSelector.apps.chemflow.features.transfer', icon: ArrowRightLeft },
      { id: 'filtration', labelKey: 'systemSelector.apps.chemflow.features.filtration', icon: Filter },
      { id: 'tanks', labelKey: 'systemSelector.apps.chemflow.features.tanks', icon: Cylinder },
      { id: 'operations', labelKey: 'systemSelector.apps.chemflow.features.operations', icon: ClipboardList },
    ],
  },
];
