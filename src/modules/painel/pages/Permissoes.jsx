import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Lock,
  Save,
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
  getPermissionTree,
  getScreenViewKeys,
} from '@industrializacao/lib/rbac/permissionCatalog';
import { getUserPermissions, saveUserPermissions } from '@industrializacao/lib/rbac/rbacApi';
import { base44 } from '@industrializacao/api/base44Client';
import { cn } from '@shared/lib/utils';

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

export default function Permissoes() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const tree = useMemo(() => getPermissionTree(), []);

  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [permSet, setPermSet] = useState(() => new Set());
  const [savedPermSet, setSavedPermSet] = useState(() => new Set());
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(() =>
    Object.fromEntries(tree.map((m) => [m.id, m.id === 'painel']))
  );
  const [discardDialog, setDiscardDialog] = useState({ open: false, nextId: null });

  const selected = users.find((u) => u.id === selectedId) || null;
  const isExterno = selected?.tipo === 'externo';
  const dirty = !setsEqual(permSet, savedPermSet);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const rows = await base44.entities.Usuario.list('nome_completo', 500);
      const list = Array.isArray(rows) ? rows : [];
      setUsers(list);
    } catch (err) {
      toast({ title: err.message || t('userPermissions.messages.loadUsersError'), variant: 'destructive' });
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
          toast({ title: err.message || t('userPermissions.messages.loadPermsError'), variant: 'destructive' });
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

  const isLockedKey = (key) => {
    if (isExterno) return false;
    return REQUIRED_INTERNAL_KEYS.includes(key);
  };

  const toggleKey = (key) => {
    if (isLockedKey(key)) return;
    setPermSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleScreen = (screen) => {
    setPermSet((prev) => {
      const next = new Set(prev);
      const enabled = next.has(screen.viewKey);
      if (enabled) {
        next.delete(screen.viewKey);
        screen.actions.forEach((a) => next.delete(a.key));
      } else {
        next.add(screen.viewKey);
      }
      return next;
    });
  };

  const toggleAction = (screen, actionKey) => {
    setPermSet((prev) => {
      const next = new Set(prev);
      if (next.has(actionKey)) {
        next.delete(actionKey);
      } else {
        next.add(screen.viewKey);
        next.add(actionKey);
      }
      return next;
    });
  };

  const toggleModule = (mod) => {
    if (mod.required && !isExterno) return;
    setPermSet((prev) => {
      const next = new Set(prev);
      const enabled = next.has(mod.moduleAccessKey);
      const viewKeys = getScreenViewKeys(mod.id);
      const allKeys = getKeysForAppModule(mod.id);
      if (enabled) {
        allKeys.forEach((k) => {
          if (!isLockedKey(k)) next.delete(k);
        });
      } else {
        next.add(mod.moduleAccessKey);
        viewKeys.forEach((k) => next.add(k));
        setExpanded((e) => ({ ...e, [mod.id]: true }));
      }
      return next;
    });
  };

  const selectModuleViews = (mod) => {
    setPermSet((prev) => {
      const next = new Set(prev);
      next.add(mod.moduleAccessKey);
      getScreenViewKeys(mod.id).forEach((k) => next.add(k));
      return next;
    });
    setExpanded((e) => ({ ...e, [mod.id]: true }));
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
      tree.forEach((mod) => {
        next.add(mod.moduleAccessKey);
        getScreenViewKeys(mod.id).forEach((k) => next.add(k));
      });
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
      const saved = new Set(Array.isArray(result?.permissions) ? result.permissions : Array.from(permSet));
      setPermSet(saved);
      setSavedPermSet(new Set(saved));
      toast({ title: t('userPermissions.messages.saved') });
    } catch (err) {
      toast({ title: err.message || t('userPermissions.messages.saveError'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const visibleTree = isExterno
    ? tree.map((mod) => ({
      ...mod,
      screens: mod.screens.filter((s) => s.id === 'client_portal'),
    })).filter((mod) => mod.screens.length)
    : tree;

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
        <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
          {t('userPermissions.userLabel')}
        </label>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full max-w-lg justify-between font-normal">
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

        {selected && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('common.name')}</div>
              <div className="font-medium">{selected.nome_completo || '—'}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('users.fields.username')}</div>
              <div className="font-mono text-muted-foreground">{selected.usuario || '—'}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{t('users.fields.profile')}</div>
              <span className={cn('inline-flex text-xs font-semibold px-2.5 py-1 rounded-full', nivelBadgeClass(selected.nivel_acesso))}>
                {selected.nivel_acesso || '—'}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 bg-card rounded-xl border border-border shadow-sm overflow-hidden flex flex-col">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center p-8 text-sm text-muted-foreground">
            {t('userPermissions.selectHint')}
          </div>
        ) : loadingPerms ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {dirty && (
              <div className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
                {t('userPermissions.unsaved')}
              </div>
            )}
            {visibleTree.map((mod) => {
              const moduleOn = permSet.has(mod.moduleAccessKey) || (mod.required && !isExterno);
              const locked = Boolean(mod.required && !isExterno);
              const isOpen = expanded[mod.id] && moduleOn;
              return (
                <div key={mod.id} className="rounded-lg border border-border">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#2575D1]"
                      checked={moduleOn}
                      disabled={locked}
                      onChange={() => toggleModule(mod)}
                      aria-label={t(mod.labelKey)}
                    />
                    <button
                      type="button"
                      className="flex items-center gap-1.5 flex-1 text-left font-semibold text-sm"
                      onClick={() => {
                        if (!moduleOn) return;
                        setExpanded((e) => ({ ...e, [mod.id]: !e[mod.id] }));
                      }}
                      disabled={!moduleOn}
                    >
                      {isOpen
                        ? <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                      {t(mod.labelKey)}
                    </button>
                    {locked && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                        <Lock className="w-3 h-3" />
                        {t('userPermissions.required')}
                      </span>
                    )}
                    {moduleOn && (
                      <div className="hidden sm:flex items-center gap-1">
                        <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => selectModuleViews(mod)}>
                          {t('userPermissions.selectModule')}
                        </Button>
                        {!locked && (
                          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => clearModule(mod)}>
                            {t('userPermissions.clearModule')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {isOpen && (
                    <div className="border-t border-border px-3 py-2 space-y-2 bg-muted/20">
                      {mod.screens.map((screen) => {
                        const screenOn = permSet.has(screen.viewKey);
                        const screenLocked = isLockedKey(screen.viewKey);
                        return (
                          <div key={screen.id} className="pl-4">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-[#2575D1]"
                                checked={screenOn}
                                disabled={screenLocked}
                                onChange={() => toggleScreen(screen)}
                              />
                              <span className="font-medium">{t(screen.labelKey)}</span>
                            </label>
                            {screen.actions.length > 0 && screenOn && (
                              <div className="pl-6 mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                                {screen.actions.map((action) => (
                                  <label key={action.key} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                                    <input
                                      type="checkbox"
                                      className="h-3.5 w-3.5 accent-[#2575D1]"
                                      checked={permSet.has(action.key)}
                                      onChange={() => toggleAction(screen, action.key)}
                                    />
                                    {t(action.labelKey)}
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={discardDialog.open} onOpenChange={(open) => setDiscardDialog((d) => ({ ...d, open }))}>
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
