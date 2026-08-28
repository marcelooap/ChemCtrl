import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight, LayoutDashboard } from 'lucide-react';
import { SidebarFooter } from '@shared/components/user/SidebarFooter';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';

const AUTO_COLLAPSE_MS = 3000;

const ACTIVE_BG = '#2575D1';
const SIDEBAR_BG = 'hsl(230, 25%, 12%)';

const labelClass = (collapsed) =>
  cn(
    'truncate transition-[max-width,opacity] duration-200 ease-out overflow-hidden whitespace-nowrap',
    collapsed ? 'max-w-0 opacity-0' : 'max-w-[12rem] opacity-100'
  );

/** Tooltip lateral só com a sidebar recolhida (ícone sem rótulo). */
function CollapsedNavTooltip({ collapsed, label, children }) {
  if (!collapsed || !label) return children;

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        align="center"
        sideOffset={8}
        className="bg-slate-900 text-white border border-white/10 shadow-lg"
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Platform sidebar chrome shared by ChemCtrl and the ChemFlow module.
 *
 * @param {object} props
 * @param {boolean} props.collapsed
 * @param {(v: boolean) => void} props.setCollapsed
 * @param {string} props.logoSrc
 * @param {string} props.logoAlt
 * @param {string} props.moduleName
 * @param {string} props.moduleSubtitle
 * @param {Array} props.items - flat or grouped nav items (optional badgeCount)
 * @param {(path: string) => boolean} [props.canAccessPath]
 * @param {(item: object) => string} [props.resolveLabel] - defaults to item.label
 * @param {boolean} [props.showModulesLink] - link de volta ao ChemCtrl
 */
export default function ModuleSidebar({
  collapsed,
  setCollapsed,
  logoSrc,
  logoAlt,
  moduleName,
  moduleSubtitle,
  items = [],
  canAccessPath = () => true,
  resolveLabel = (item) => item.label,
  showModulesLink = true,
}) {
  const location = useLocation();
  const setCollapsedRef = useRef(setCollapsed);
  const autoCollapseTimerRef = useRef(null);
  setCollapsedRef.current = setCollapsed;

  const clearAutoCollapse = () => {
    if (autoCollapseTimerRef.current != null) {
      window.clearTimeout(autoCollapseTimerRef.current);
      autoCollapseTimerRef.current = null;
    }
  };

  const scheduleAutoCollapse = () => {
    clearAutoCollapse();
    if (collapsed) return;
    if (typeof setCollapsedRef.current !== 'function') return;
    autoCollapseTimerRef.current = window.setTimeout(() => {
      autoCollapseTimerRef.current = null;
      setCollapsedRef.current(true);
    }, AUTO_COLLAPSE_MS);
  };

  // Ao recolher (manual ou automático), cancela qualquer timer pendente.
  useEffect(() => {
    if (collapsed) clearAutoCollapse();
  }, [collapsed]);

  useEffect(() => () => clearAutoCollapse(), []);

  const [expandedGroups, setExpandedGroups] = useState(() => {
    const initial = {};
    for (const item of items) {
      if (
        item.groupId &&
        item.children?.some((c) => {
          const path = c.path;
          if (!path || typeof window === 'undefined') return false;
          const pathname = window.location.pathname;
          return pathname === path || pathname.startsWith(`${path}/`);
        })
      ) {
        initial[item.groupId] = true;
      }
    }
    return initial;
  });

  const toggleGroup = (groupId) => {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const isActive = (path, end = false) => {
    if (!path) return false;
    if (end || path === '/' || path.split('/').filter(Boolean).length === 1) {
      return location.pathname === path;
    }
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  const visibleItems = useMemo(() => items, [items]);

  const renderLeaf = (item, { nested = false } = {}) => {
    if (!canAccessPath(item.path)) return null;

    const Icon = item.icon || LayoutDashboard;
    const label = resolveLabel(item);
    const active = isActive(item.path, item.end);
    const badgeCount = Number(item.badgeCount) || 0;
    const badgeText = badgeCount > 99 ? '+99' : badgeCount > 0 ? `+${badgeCount}` : '';
    const tooltipLabel = badgeText ? `${label} (${badgeText})` : label;

    if (nested) {
      return (
        <Link
          key={item.path}
          to={item.path}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
            active ? 'text-white bg-white/10' : 'text-white/50 hover:text-white hover:bg-white/5'
          }`}
        >
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          {badgeText ? (
            <span className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums text-sky-300">
              {badgeText}
            </span>
          ) : null}
        </Link>
      );
    }

    return (
      <CollapsedNavTooltip key={item.path} collapsed={collapsed} label={tooltipLabel}>
        <Link
          to={item.path}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 transition-colors ${
            active ? 'text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/5'
          }`}
          style={active ? { background: ACTIVE_BG } : {}}
        >
          <span className="relative shrink-0">
            <Icon className="w-4 h-4" />
            {collapsed && badgeText ? (
              <span
                className={`pointer-events-none absolute -top-1.5 -right-2.5 min-w-[1.15rem] h-[1.15rem] px-0.5 rounded-full text-[9px] font-bold leading-none flex items-center justify-center tabular-nums ${
                  active ? 'bg-white text-[#2575D1]' : 'bg-[#2575D1] text-white'
                }`}
                aria-label={`${badgeCount} novas solicitações`}
              >
                {badgeText}
              </span>
            ) : null}
          </span>
          <span className={labelClass(collapsed)}>{label}</span>
          {!collapsed && badgeText ? (
            <span
              className="shrink-0 text-[11px] font-semibold tabular-nums text-sky-300"
              aria-label={`${badgeCount} novas solicitações`}
            >
              {badgeText}
            </span>
          ) : null}
        </Link>
      </CollapsedNavTooltip>
    );
  };

  return (
    <aside
      className={`fixed left-0 top-0 h-screen z-40 flex flex-col transition-[width] duration-200 ease-out ${
        collapsed ? 'w-16' : 'w-64'
      }`}
      style={{ background: SIDEBAR_BG }}
      onMouseEnter={clearAutoCollapse}
      onMouseLeave={scheduleAutoCollapse}
    >
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-3 px-4 h-16 border-b border-white/10 shrink-0 hover:bg-white/5 transition-colors w-full"
      >
        <img
          src={logoSrc}
          alt={logoAlt}
          className="w-8 h-8 object-cover shrink-0 rounded-full"
        />
        <div
          className={cn(
            'overflow-hidden text-left transition-[max-width,opacity] duration-200 ease-out',
            collapsed ? 'max-w-0 opacity-0' : 'max-w-[10rem] opacity-100'
          )}
        >
          <p className="text-white font-bold text-sm leading-tight whitespace-nowrap">{moduleName}</p>
          <p className="text-white/50 text-[10px] whitespace-nowrap">{moduleSubtitle}</p>
        </div>
      </button>

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {visibleItems.map((item) => {
          if (item.children) {
            const accessibleChildren = item.children.filter((c) => canAccessPath(c.path));
            if (!accessibleChildren.length) return null;

            const isGroupActive = accessibleChildren.some((c) => isActive(c.path, c.end));
            const isExpanded = expandedGroups[item.groupId];
            const groupLabel = resolveLabel(item);
            const GroupIcon = item.icon || LayoutDashboard;

            return (
              <div key={item.groupId} className="mb-0.5">
                <CollapsedNavTooltip collapsed={collapsed} label={groupLabel}>
                  <button
                    type="button"
                    onClick={() => {
                      if (collapsed) {
                        setCollapsed(false);
                        setExpandedGroups((prev) => ({
                          ...prev,
                          [item.groupId]: true,
                        }));
                        return;
                      }
                      toggleGroup(item.groupId);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                      isGroupActive
                        ? 'text-white bg-white/10'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <GroupIcon className="w-4 h-4 shrink-0" />
                    <span className={cn(labelClass(collapsed), 'flex-1 text-left')}>{groupLabel}</span>
                    <ChevronDown
                      className={cn(
                        'w-3 h-3 shrink-0 transition-opacity duration-300',
                        collapsed || !isExpanded ? 'hidden' : 'block'
                      )}
                    />
                    <ChevronRight
                      className={cn(
                        'w-3 h-3 shrink-0 transition-opacity duration-300',
                        collapsed || isExpanded ? 'hidden' : 'block'
                      )}
                    />
                  </button>
                </CollapsedNavTooltip>
                {!collapsed && isExpanded && (
                  <div className="ml-4 pl-3 border-l border-white/10">
                    {accessibleChildren.map((child) => renderLeaf(child, { nested: true }))}
                  </div>
                )}
              </div>
            );
          }
          return renderLeaf(item);
        })}
      </nav>

      <SidebarFooter
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        showModulesLink={showModulesLink}
      />
    </aside>
  );
}
