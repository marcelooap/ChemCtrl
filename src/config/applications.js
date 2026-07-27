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
 * @property {string|null} route - rota fixa; se null e enabled, usa getDefaultRoute(user)
 * @property {string} [badgeKey]
 * @property {string} [ctaKey]
 * @property {string} [ctaDisabledKey]
 * @property {ApplicationFeature[]} features
 */

/** @type {ApplicationDefinition[]} */
export const applications = [
  {
    id: 'chemctrl',
    nameKey: 'systemSelector.apps.chemctrl.name',
    descriptionKey: 'systemSelector.apps.chemctrl.description',
    logoSrc: '/icons/chemctrl-logo.svg',
    enabled: true,
    route: null,
    ctaKey: 'systemSelector.apps.chemctrl.cta',
    features: [
      { id: 'production', labelKey: 'systemSelector.apps.chemctrl.features.production', icon: Factory },
      { id: 'stock', labelKey: 'systemSelector.apps.chemctrl.features.stock', icon: Package },
      { id: 'recipes', labelKey: 'systemSelector.apps.chemctrl.features.recipes', icon: BookOpen },
      { id: 'quality', labelKey: 'systemSelector.apps.chemctrl.features.quality', icon: ShieldCheck },
      { id: 'dashboard', labelKey: 'systemSelector.apps.chemctrl.features.dashboard', icon: LayoutDashboard },
    ],
  },
  {
    id: 'chemflow',
    nameKey: 'systemSelector.apps.chemflow.name',
    descriptionKey: 'systemSelector.apps.chemflow.description',
    logoSrc: '/icons/chemflow-logo.svg',
    enabled: false,
    route: null,
    badgeKey: 'systemSelector.comingSoon',
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
