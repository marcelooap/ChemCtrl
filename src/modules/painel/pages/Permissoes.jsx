import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Lock,
  Save,
  Search,
} from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/components/ui/command';
import { useToast } from '@shared/components/ui/use-toast';
import { Can } from '@industrializacao/lib/rbac/Can';
import {
  REQUIRED_INTERNAL_KEYS,
  getKeysForAppModule,
  getPermissionHierarchy,
} from '@industrializacao/lib/rbac/permissionCatalog';
import { getUserPermissions, saveUserPermissions } from '@industrializacao/lib/rbac/rbacApi';
import { getRpcErrorMessage } from '@industrializacao/lib/HttpError';
import { base44 } from '@industrializacao/api/base44Client';
import { cn } from '@shared/lib/utils';
import TriCheckbox from '@painel/pages/permissoes/TriCheckbox';
import { resolvePermissionIcon } from '@painel/pages/permissoes/permissionIcons';

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

function nivelBadgeClass(name) {
  const colors = {
    Administrador: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
    Supervisor: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
    Operacional: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
    Visualização: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
    Cliente: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300',
  };
  return colors[name] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
}

function collectSectionPageKeys(section) {
  return section.pages.flatMap((page) => [
    page.viewKey,
    ...page.actions.map((a) => a.key),
  ]);
}

function countEnabledPages(mod, permSet) {
  let enabled = 0;
  let total = 0;
  for (const item of mod.items) {
    if (item.type === 'section') {
      const sectionOn = Boolean(item.sectionKey && permSet.has(item.sectionKey));
      for (const page of item.pages) {
        total += 1;
        if (sectionOn && permSet.has(page.viewKey)) enabled += 1;
      }
    } else {
      total += 1;
      if (permSet.has(item.viewKey)) enabled += 1;
    }
  }
  return { enabled, total };
}

function PageRow({
  page,
  permSet,
  locked,
  disabled,
  highlighted,
  isLockedKey,
  onTogglePage,
  onToggleAction,
  rowRef,
}) {
  const { t } = useTranslation();
  const pageOn = permSet.has(page.viewKey);
  const pageLocked = isLockedKey(page.viewKey);
  const Icon = resolvePermissionIcon(page.icon);

  return (
    <div
      ref={rowRef}
      id={`perm-page-${page.id}`}
      className={cn(
        'rounded-md px-2 py-1.5 transition-colors',
        highlighted && 'ring-2 ring-[#2575D1]/30 bg-sky-50 dark:bg-sky-950/30',
        disabled && 'opacity-50'
      )}
    >
      <label className={cn('flex items-center gap-2 text-sm', disabled && 'cursor-not-allowed')}>
        <TriCheckbox
          checked={pageOn}
          disabled={disabled || pageLocked || locked}
          onChange={() => onTogglePage(page)}
          aria-label={t(page.labelKey)}
        />
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="font-medium truncate">{t(page.labelKey)}</span>
        {pageLocked && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground ml-auto">
            <Lock className="w-3 h-3" />
            {t('userPermissions.required')}
          </span>
        )}
      </label>
      {page.actions.length > 0 && pageOn && !disabled && (
        <div className="pl-6 mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
          {page.actions.map((action) => (
            <label
              key={action.key}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <TriCheckbox
                checked={permSet.has(action.key)}
                onChange={() => onToggleAction(page, action.key)}
                className="h-3.5 w-3.5"
                aria-label={t(action.labelKey)}
              />
              {t(action.labelKey)}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionRow({
  section,
  permSet,
  moduleOn,
  expanded,
  highlighted,
  highlightPageId,
  isLockedKey,
  onToggleSection,
  onSelectSection,
  onClearSection,
  onToggleExpand,
  onTogglePage,
  onToggleAction,
  pageRefs,
}) {
  const { t } = useTranslation();
  const sectionOn = Boolean(section.sectionKey && permSet.has(section.sectionKey));
  const pagesOn = section.pages.filter((p) => permSet.has(p.viewKey)).length;
  const allPagesOn = pagesOn === section.pages.length && section.pages.length > 0;
  const somePagesOn = pagesOn > 0 && !allPagesOn;
  const Icon = resolvePermissionIcon(section.icon);
  const isOpen = expanded && moduleOn;

  return (
    <div
      id={`perm-section-${section.id}`}
      className={cn(
        'rounded-lg border border-border/70 bg-background',
        highlighted && 'ring-2 ring-[#2575D1]/30'
      )}
    >
      <div className="flex items-center gap-2 px-2.5 py-2 flex-wrap">
        <TriCheckbox
          checked={sectionOn && (allPagesOn || pagesOn === 0)}
          indeterminate={sectionOn && somePagesOn}
          disabled={!moduleOn}
          onChange={() => onToggleSection(section)}
          aria-label={t(section.labelKey)}
        />
        <button
          type="button"
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-sm font-semibold disabled:opacity-50"
          onClick={() => onToggleExpand(section.id)}
          disabled={!moduleOn}
        >
          {isOpen
            ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
          <span className="truncate">{t(section.labelKey)}</span>
          <span className="text-[11px] font-normal text-muted-foreground tabular-nums ml-1">
            {pagesOn}/{section.pages.length}
          </span>
        </button>
        {moduleOn && (
          <div className="flex items-center gap-1 ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => onSelectSection(section)}
            >
              {t('userPermissions.selectSection')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs px-2"
              onClick={() => onClearSection(section)}
            >
              {t('userPermissions.clearSection')}
            </Button>
          </div>
        )}
      </div>
      {isOpen && (
        <div className="border-t border-border/60 px-2 py-1.5 ml-3 pl-3 border-l border-l-border/50 space-y-0.5 bg-muted/10">
          {section.pages.map((page) => (
            <PageRow
              key={page.id}
              page={page}
              permSet={permSet}
              locked={false}
              disabled={!sectionOn}
              highlighted={highlightPageId === page.id}
              isLockedKey={isLockedKey}
              onTogglePage={onTogglePage}
              onToggleAction={onToggleAction}
              rowRef={(el) => {
                if (pageRefs) pageRefs.current[page.id] = el;
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ModuleCard({
  mod,
  permSet,
  expanded,
  sectionExpanded,
  highlightId,
  highlightPageId,
  isLockedKey,
  onToggleModule,
  onSelectModule,
  onClearModule,
  onToggleModuleExpand,
  onToggleSectionExpand,
  onToggleSection,
  onSelectSection,
  onClearSection,
  onTogglePage,
  onToggleAction,
  pageRefs,
}) {
  const { t } = useTranslation();
  const moduleOn = permSet.has(mod.moduleAccessKey) || (mod.required && true);
  const locked = Boolean(mod.required);
  const isOpen = expanded && moduleOn;
  const { enabled, total } = countEnabledPages(mod, permSet);
  const Icon = resolvePermissionIcon(mod.icon);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-3 bg-card">
        <TriCheckbox
          checked={moduleOn}
          disabled={locked}
          onChange={() => onToggleModule(mod)}
          aria-label={t(mod.labelKey)}
        />
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0 text-left disabled:opacity-50"
          onClick={() => {
            if (!moduleOn) return;
            onToggleModuleExpand(mod.id);
          }}
          disabled={!moduleOn}
        >
          {isOpen
            ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
            style={{ background: 'rgba(37, 117, 209, 0.1)' }}
          >
            <Icon className="w-4 h-4" style={{ color: '#2575D1' }} />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{t(mod.labelKey)}</div>
            <div className="text-[11px] text-muted-foreground tabular-nums">
              {t('userPermissions.pageCount', { enabled, total })}
            </div>
          </div>
        </button>
        {locked && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground shrink-0">
            <Lock className="w-3 h-3" />
            {t('userPermissions.required')}
          </span>
        )}
        {moduleOn && (
          <div className="hidden sm:flex items-center gap-1 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onSelectModule(mod)}
            >
              {t('userPermissions.selectModule')}
            </Button>
            {!locked && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onClearModule(mod)}
              >
                {t('userPermissions.clearModule')}
              </Button>
            )}
          </div>
        )}
      </div>

      {isOpen && (
        <div className="border-t border-border px-3 py-2.5 space-y-2 bg-muted/15">
          {mod.items.map((item) => {
            if (item.type === 'section') {
              return (
                <SectionRow
                  key={item.id}
                  section={item}
                  permSet={permSet}
                  moduleOn={moduleOn}
                  expanded={Boolean(sectionExpanded[item.id])}
                  highlighted={highlightId === `section:${item.id}`}
                  highlightPageId={highlightPageId}
                  isLockedKey={isLockedKey}
                  onToggleSection={onToggleSection}
                  onSelectSection={onSelectSection}
                  onClearSection={onClearSection}
                  onToggleExpand={onToggleSectionExpand}
                  onTogglePage={onTogglePage}
                  onToggleAction={onToggleAction}
                  pageRefs={pageRefs}
                />
              );
            }
            return (
              <div
                key={item.id}
                className="rounded-lg border border-border/60 bg-background px-1 py-0.5"
              >
                <PageRow
                  page={item}
                  permSet={permSet}
                  locked={false}
                  disabled={false}
                  highlighted={highlightPageId === item.id}
                  isLockedKey={isLockedKey}
                  onTogglePage={onTogglePage}
                  onToggleAction={onToggleAction}
                  rowRef={(el) => {
                    if (pageRefs) pageRefs.current[item.id] = el;
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Permissoes() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const hierarchy = useMemo(() => getPermissionHierarchy(), []);
  const pageRefs = useRef({});

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [permSet, setPermSet] = useState(() => new Set());
  const [savedPermSet, setSavedPermSet] = useState(() => new Set());
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedModules, setExpandedModules] = useState(() =>
    Object.fromEntries(hierarchy.map((m) => [m.id, m.id === 'painel']))
  );
  const [expandedSections, setExpandedSections] = useState({});
  const [discardDialog, setDiscardDialog] = useState({ open: false, nextId: null });
  const [permSearch, setPermSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlightId, setHighlightId] = useState(null);
  const [highlightPageId, setHighlightPageId] = useState(null);

  const selected = users.find((u) => u.id === selectedId) || null;
  const isExterno = selected?.tipo === 'externo';
  const dirty = !setsEqual(permSet, savedPermSet);

  const visibleHierarchy = useMemo(() => {
    if (!isExterno) return hierarchy;
    return hierarchy
      .map((mod) => ({
        ...mod,
        items: mod.items
          .map((item) => {
            if (item.type === 'section') {
              return {
                ...item,
                pages: item.pages.filter((p) => p.id === 'client_portal'),
              };
            }
            return item.id === 'client_portal' ? item : null;
          })
          .filter((item) => item && (item.type !== 'section' || item.pages.length > 0)),
      }))
      .filter((mod) => mod.items.length > 0);
  }, [hierarchy, isExterno]);

  const searchIndex = useMemo(() => {
    const results = [];
    for (const mod of visibleHierarchy) {
      const modLabel = t(mod.labelKey);
      for (const item of mod.items) {
        if (item.type === 'section') {
          const sectionLabel = t(item.labelKey);
          results.push({
            id: `section:${item.id}`,
            kind: 'section',
            moduleId: mod.id,
            sectionId: item.id,
            pageId: null,
            label: sectionLabel,
            path: `${modLabel} → ${sectionLabel}`,
          });
          for (const page of item.pages) {
            const pageLabel = t(page.labelKey);
            results.push({
              id: `page:${page.id}`,
              kind: 'page',
              moduleId: mod.id,
              sectionId: item.id,
              pageId: page.id,
              label: pageLabel,
              path: `${modLabel} → ${sectionLabel} → ${pageLabel}`,
            });
          }
        } else {
          const pageLabel = t(item.labelKey);
          results.push({
            id: `page:${item.id}`,
            kind: 'page',
            moduleId: mod.id,
            sectionId: null,
            pageId: item.id,
            label: pageLabel,
            path: `${modLabel} → ${pageLabel}`,
          });
        }
      }
    }
    return results;
  }, [visibleHierarchy, t]);

  const searchResults = useMemo(() => {
    const q = permSearch.trim().toLowerCase();
    if (!q) return [];
    return searchIndex
      .filter((r) => r.label.toLowerCase().includes(q) || r.path.toLowerCase().includes(q))
      .slice(0, 20);
  }, [permSearch, searchIndex]);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const rows = await base44.entities.Usuario.list('nome_completo', 500);
      setUsers(Array.isArray(rows) ? rows : []);
    } catch (err) {
      toast({
        title: getRpcErrorMessage(err, t('userPermissions.messages.loadUsersError')),
        variant: 'destructive',
      });
    } finally {
      setLoadingUsers(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const fromQuery = searchParams.get('user');
    if (!fromQuery || selectedId || !users.length) return;
    if (users.some((u) => u.id === fromQuery)) {
      setSelectedId(fromQuery);
    }
  }, [searchParams, users, selectedId]);

  useEffect(() => {
    if (!selectedId) {
      setPermSet(new Set());
      setSavedPermSet(new Set());
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingPerms(true);
      try {
        const keys = await getUserPermissions(selectedId);
        if (cancelled) return;
        const next = new Set(Array.isArray(keys) ? keys : []);
        setPermSet(next);
        setSavedPermSet(new Set(next));
      } catch (err) {
        if (!cancelled) {
          toast({
            title: getRpcErrorMessage(err, t('userPermissions.messages.loadPermsError')),
            variant: 'destructive',
          });
        }
      } finally {
        if (!cancelled) setLoadingPerms(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, t, toast]);

  const selectUser = (id) => {
    if (id === selectedId) {
      setPickerOpen(false);
      return;
    }
    if (dirty) {
      setDiscardDialog({ open: true, nextId: id });
      setPickerOpen(false);
      return;
    }
    setSelectedId(id);
    setPickerOpen(false);
  };

  const isLockedKey = useCallback((key) => {
    if (isExterno) return false;
    return REQUIRED_INTERNAL_KEYS.includes(key);
  }, [isExterno]);

  const togglePage = (page) => {
    if (isLockedKey(page.viewKey)) return;
    setPermSet((prev) => {
      const next = new Set(prev);
      const enabled = next.has(page.viewKey);
      if (enabled) {
        next.delete(page.viewKey);
        page.actions.forEach((a) => next.delete(a.key));
      } else {
        next.add(page.viewKey);
      }
      return next;
    });
  };

  const toggleAction = (page, actionKey) => {
    setPermSet((prev) => {
      const next = new Set(prev);
      if (next.has(actionKey)) {
        next.delete(actionKey);
      } else {
        next.add(page.viewKey);
        next.add(actionKey);
      }
      return next;
    });
  };

  const toggleSection = (section) => {
    if (!section.sectionKey) return;
    setPermSet((prev) => {
      const next = new Set(prev);
      if (next.has(section.sectionKey)) {
        next.delete(section.sectionKey);
      } else {
        next.add(section.sectionKey);
        setExpandedSections((e) => ({ ...e, [section.id]: true }));
      }
      return next;
    });
  };

  const selectSection = (section) => {
    setPermSet((prev) => {
      const next = new Set(prev);
      if (section.sectionKey) next.add(section.sectionKey);
      section.pages.forEach((p) => next.add(p.viewKey));
      return next;
    });
    setExpandedSections((e) => ({ ...e, [section.id]: true }));
  };

  const clearSection = (section) => {
    setPermSet((prev) => {
      const next = new Set(prev);
      collectSectionPageKeys(section).forEach((k) => {
        if (!isLockedKey(k)) next.delete(k);
      });
      if (section.sectionKey && !isLockedKey(section.sectionKey)) {
        next.delete(section.sectionKey);
      }
      return next;
    });
  };

  const grantVisibleModule = (next, mod) => {
    next.add(mod.moduleAccessKey);
    for (const item of mod.items) {
      if (item.type === 'section') {
        if (item.sectionKey) next.add(item.sectionKey);
        item.pages.forEach((p) => next.add(p.viewKey));
      } else {
        next.add(item.viewKey);
      }
    }
  };

  const toggleModule = (mod) => {
    if (mod.required && !isExterno) return;
    setPermSet((prev) => {
      const next = new Set(prev);
      const enabled = next.has(mod.moduleAccessKey);
      const allKeys = getKeysForAppModule(mod.id);
      if (enabled) {
        allKeys.forEach((k) => {
          if (!isLockedKey(k)) next.delete(k);
        });
      } else {
        grantVisibleModule(next, mod);
        setExpandedModules((e) => ({ ...e, [mod.id]: true }));
      }
      return next;
    });
  };

  const selectModule = (mod) => {
    setPermSet((prev) => {
      const next = new Set(prev);
      grantVisibleModule(next, mod);
      return next;
    });
    setExpandedModules((e) => ({ ...e, [mod.id]: true }));
    const sectionIds = {};
    mod.items.forEach((item) => {
      if (item.type === 'section') sectionIds[item.id] = true;
    });
    setExpandedSections((e) => ({ ...e, ...sectionIds }));
  };

  const clearModule = (mod) => {
    setPermSet((prev) => {
      const next = new Set(prev);
      getKeysForAppModule(mod.id).forEach((k) => {
        if (!isLockedKey(k)) next.delete(k);
      });
      return next;
    });
  };

  const selectAll = () => {
    setPermSet((prev) => {
      const next = new Set(prev);
      visibleHierarchy.forEach((mod) => grantVisibleModule(next, mod));
      return next;
    });
  };

  const clearAll = () => {
    setPermSet((prev) => {
      const next = new Set();
      if (!isExterno) {
        REQUIRED_INTERNAL_KEYS.forEach((k) => {
          if (prev.has(k)) next.add(k);
        });
        next.add('module.painel');
        next.add('painel_home.view');
      }
      return next;
    });
  };

  const save = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      const result = await saveUserPermissions(selectedId, Array.from(permSet));
      if (result?.success === false) {
        throw new Error(result.error || t('userPermissions.messages.saveError'));
      }
      const saved = new Set(
        Array.isArray(result?.permissions) ? result.permissions : Array.from(permSet)
      );
      setPermSet(saved);
      setSavedPermSet(new Set(saved));
      toast({ title: t('userPermissions.messages.saved') });
    } catch (err) {
      toast({
        title: getRpcErrorMessage(err, t('userPermissions.messages.saveError')),
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const focusSearchResult = (result) => {
    setExpandedModules((e) => ({ ...e, [result.moduleId]: true }));
    if (result.sectionId) {
      setExpandedSections((e) => ({ ...e, [result.sectionId]: true }));
    }
    setHighlightId(result.kind === 'section' ? `section:${result.sectionId}` : null);
    setHighlightPageId(result.pageId);
    setSearchOpen(false);
    setPermSearch('');

    window.setTimeout(() => {
      const el = result.pageId
        ? pageRefs.current[result.pageId]
        : document.getElementById(`perm-section-${result.sectionId}`);
      el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 80);

    window.setTimeout(() => {
      setHighlightId(null);
      setHighlightPageId(null);
    }, 2500);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t('userPermissions.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('userPermissions.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" disabled={!selected} onClick={selectAll}>
            {t('userPermissions.selectAll')}
          </Button>
          <Button variant="outline" size="sm" disabled={!selected} onClick={clearAll}>
            {t('userPermissions.clearAll')}
          </Button>
          <Can permission="profiles.edit">
            <Button
              onClick={save}
              disabled={!selected || !dirty || saving}
              className="text-white"
              style={{ background: '#2575D1' }}
            >
              <Save className="w-4 h-4 mr-2" />
              {saving ? t('common.saving') : t('userPermissions.save')}
            </Button>
          </Can>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm p-4 mb-4 shrink-0">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-5">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              {t('userPermissions.userLabel')}
            </label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-between font-normal">
                  <span className="truncate">
                    {selected
                      ? `${selected.nome_completo || selected.usuario} (${selected.usuario})`
                      : t('userPermissions.searchUser')}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command>
                  <CommandInput placeholder={t('userPermissions.searchUser')} />
                  <CommandList>
                    <CommandEmpty>
                      {loadingUsers ? t('common.loading') : t('userPermissions.emptyUsers')}
                    </CommandEmpty>
                    <CommandGroup>
                      {users.map((u) => (
                        <CommandItem
                          key={u.id}
                          value={`${u.nome_completo || ''} ${u.usuario || ''}`}
                          onSelect={() => selectUser(u.id)}
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="truncate font-medium">{u.nome_completo || u.usuario}</span>
                            <span className="text-xs text-muted-foreground truncate">{u.usuario}</span>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>

          {selected && (
            <>
              <div className="lg:col-span-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  {t('common.name')}
                </div>
                <div className="font-medium text-sm truncate">{selected.nome_completo || '—'}</div>
              </div>
              <div className="lg:col-span-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  {t('users.fields.username')}
                </div>
                <div className="font-mono text-sm text-muted-foreground truncate">
                  {selected.usuario || '—'}
                </div>
              </div>
              <div className="lg:col-span-2">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  {t('users.fields.profile')}
                </div>
                <span
                  className={cn(
                    'inline-flex text-xs font-semibold px-2.5 py-1 rounded-full',
                    nivelBadgeClass(selected.nivel_acesso)
                  )}
                >
                  {selected.nivel_acesso || '—'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center rounded-xl border border-border bg-card shadow-sm p-8 text-sm text-muted-foreground">
            {t('userPermissions.selectHint')}
          </div>
        ) : loadingPerms ? (
          <div className="flex-1 flex items-center justify-center rounded-xl border border-border bg-card shadow-sm">
            <div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-0.5">
            {dirty && (
              <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                {t('userPermissions.unsaved')}
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={permSearch}
                onChange={(e) => {
                  setPermSearch(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setSearchOpen(false), 150)}
                placeholder={t('userPermissions.searchPermission')}
                className="pl-9 bg-card"
              />
              {searchOpen && searchResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full rounded-lg border border-border bg-card shadow-lg max-h-64 overflow-y-auto">
                  {searchResults.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 border-b border-border/50 last:border-0"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => focusSearchResult(r)}
                    >
                      <div className="font-medium truncate">{r.label}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{r.path}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {visibleHierarchy.map((mod) => (
              <ModuleCard
                key={mod.id}
                mod={{
                  ...mod,
                  required: Boolean(mod.required && !isExterno),
                }}
                permSet={permSet}
                expanded={Boolean(expandedModules[mod.id])}
                sectionExpanded={expandedSections}
                highlightId={highlightId}
                highlightPageId={highlightPageId}
                isLockedKey={isLockedKey}
                onToggleModule={toggleModule}
                onSelectModule={selectModule}
                onClearModule={clearModule}
                onToggleModuleExpand={(id) =>
                  setExpandedModules((e) => ({ ...e, [id]: !e[id] }))
                }
                onToggleSectionExpand={(id) =>
                  setExpandedSections((e) => ({ ...e, [id]: !e[id] }))
                }
                onToggleSection={toggleSection}
                onSelectSection={selectSection}
                onClearSection={clearSection}
                onTogglePage={togglePage}
                onToggleAction={toggleAction}
                pageRefs={pageRefs}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={discardDialog.open}
        onOpenChange={(open) => setDiscardDialog((d) => ({ ...d, open }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('userPermissions.discard.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('userPermissions.discard.message')}</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDiscardDialog({ open: false, nextId: null })}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                setSelectedId(discardDialog.nextId);
                setDiscardDialog({ open: false, nextId: null });
              }}
            >
              {t('userPermissions.discard.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
