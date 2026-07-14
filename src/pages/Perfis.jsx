import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus, Copy, Pencil, Trash2, Search, Save, ChevronDown, ChevronRight, Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Can } from '@/lib/rbac/Can';
import {
  ADMIN_PROTECTED_KEYS,
  RBAC_ADMIN_SLUG,
  getAllPermissionKeys,
  permissionKey,
  permissionModules,
} from '@/lib/rbac/permissionCatalog';
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  getProfilePermissions,
  listProfiles,
  replaceProfilePermissions,
  updateProfileMeta,
} from '@/lib/rbac/rbacApi';
import { cn } from '@/lib/utils';

const ALL_KEYS = getAllPermissionKeys();

function profilesEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const k of a) if (!b.has(k)) return false;
  return true;
}

export default function Perfis() {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [permSet, setPermSet] = useState(() => new Set());
  const [savedPermSet, setSavedPermSet] = useState(() => new Set());
  const [loadingPerms, setLoadingPerms] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedModules, setExpandedModules] = useState(() =>
    Object.fromEntries(permissionModules.map((m) => [m.id, true]))
  );
  const [mobileShowPanel, setMobileShowPanel] = useState(false);

  const [metaDialog, setMetaDialog] = useState({ open: false, mode: 'create', nome: '', descricao: '', status: 'Ativo' });
  const [dupDialog, setDupDialog] = useState({ open: false, nome: '' });
  const [deleteDialog, setDeleteDialog] = useState({ open: false });
  const [discardDialog, setDiscardDialog] = useState({ open: false, nextId: null });

  const selected = profiles.find((p) => p.id === selectedId) || null;
  const dirty = !profilesEqual(permSet, savedPermSet);
  const totalKeys = ALL_KEYS.length;

  const loadProfiles = useCallback(async (preferId) => {
    setLoading(true);
    try {
      const rows = await listProfiles();
      const list = Array.isArray(rows) ? rows : [];
      setProfiles(list);
      const nextId = preferId && list.some((p) => p.id === preferId)
        ? preferId
        : (list[0]?.id || null);
      setSelectedId(nextId);
    } catch (err) {
      toast({ title: err.message || t('profiles.messages.loadError'), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

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
        const keys = await getProfilePermissions(selectedId);
        if (cancelled) return;
        const next = new Set(Array.isArray(keys) ? keys : []);
        setPermSet(next);
        setSavedPermSet(new Set(next));
      } catch (err) {
        if (!cancelled) {
          toast({ title: err.message || t('profiles.messages.loadPermsError'), variant: 'destructive' });
        }
      } finally {
        if (!cancelled) setLoadingPerms(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId, t, toast]);

  const selectProfile = (id) => {
    if (id === selectedId) {
      setMobileShowPanel(true);
      return;
    }
    if (dirty) {
      setDiscardDialog({ open: true, nextId: id });
      return;
    }
    setSelectedId(id);
    setMobileShowPanel(true);
  };

  const togglePermission = (key) => {
    setPermSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const setModuleKeys = (keys, enabled) => {
    setPermSet((prev) => {
      const next = new Set(prev);
      keys.forEach((k) => {
        if (enabled) next.add(k);
        else next.delete(k);
      });
      return next;
    });
  };

  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return permissionModules;
    return permissionModules
      .map((mod) => {
        const moduleLabel = t(mod.labelKey).toLowerCase();
        const resources = mod.resources
          .map((res) => {
            const resLabel = t(res.labelKey).toLowerCase();
            const actions = res.actions.filter((action) => {
              const aLabel = t(action.labelKey).toLowerCase();
              const key = permissionKey(res.id, action.key).toLowerCase();
              return moduleLabel.includes(q)
                || resLabel.includes(q)
                || aLabel.includes(q)
                || key.includes(q);
            });
            if (!actions.length && !resLabel.includes(q) && !moduleLabel.includes(q)) return null;
            return { ...res, actions: actions.length ? actions : res.actions };
          })
          .filter(Boolean);
        if (!resources.length) return null;
        return { ...mod, resources };
      })
      .filter(Boolean);
  }, [search, t]);

  useEffect(() => {
    if (!search.trim()) return;
    setExpandedModules((prev) => {
      const next = { ...prev };
      filteredModules.forEach((m) => { next[m.id] = true; });
      return next;
    });
  }, [search, filteredModules]);

  const isAdminProfile =
    selected?.slug === RBAC_ADMIN_SLUG
    || selected?.id === 'perfil_administrador'
    || (selected?.nome || '').trim().toLowerCase() === 'administrador';
  const isSystemProfile = Boolean(selected?.is_system) || isAdminProfile;

  const savePermissions = async () => {
    if (!selectedId) return;
    // Proteção só do perfil Administrador — não aplicar a Supervisor/Operacional/etc.
    if (isAdminProfile) {
      const missing = ADMIN_PROTECTED_KEYS.filter((k) => !permSet.has(k));
      if (missing.length) {
        toast({ title: t('profiles.messages.adminProtected'), variant: 'destructive' });
        return;
      }
    }
    setSaving(true);
    try {
      const result = await replaceProfilePermissions(selectedId, Array.from(permSet));
      if (result?.success === false) {
        throw new Error(result.error || t('profiles.messages.saveError'));
      }
      setSavedPermSet(new Set(permSet));
      await loadProfiles(selectedId);
      toast({ title: t('profiles.messages.saved') });
    } catch (err) {
      toast({ title: err.message || t('profiles.messages.saveError'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const openCreate = () => {
    setMetaDialog({ open: true, mode: 'create', nome: '', descricao: '', status: 'Ativo' });
  };

  const openEditMeta = () => {
    if (!selected) return;
    setMetaDialog({
      open: true,
      mode: 'edit',
      nome: selected.nome || '',
      descricao: selected.descricao || '',
      status: selected.status || 'Ativo',
    });
  };

  const saveMeta = async () => {
    if (!metaDialog.nome.trim()) {
      toast({ title: t('profiles.messages.nameRequired'), variant: 'destructive' });
      return;
    }
    try {
      if (metaDialog.mode === 'create') {
        const result = await createProfile({
          nome: metaDialog.nome.trim(),
          descricao: metaDialog.descricao || '',
          status: metaDialog.status,
        });
        if (result?.success === false) throw new Error(result.error);
        setMetaDialog((d) => ({ ...d, open: false }));
        await loadProfiles(result?.perfil?.id || result?.id);
        toast({ title: t('profiles.messages.created') });
      } else {
        const result = await updateProfileMeta(selectedId, {
          nome: metaDialog.nome.trim(),
          descricao: metaDialog.descricao || '',
          status: metaDialog.status,
        });
        if (result?.success === false) throw new Error(result.error);
        setMetaDialog((d) => ({ ...d, open: false }));
        await loadProfiles(selectedId);
        toast({ title: t('profiles.messages.updated') });
      }
    } catch (err) {
      toast({ title: err.message || t('profiles.messages.saveError'), variant: 'destructive' });
    }
  };

  const confirmDuplicate = async () => {
    if (!selectedId || !dupDialog.nome.trim()) {
      toast({ title: t('profiles.messages.nameRequired'), variant: 'destructive' });
      return;
    }
    try {
      const result = await duplicateProfile(selectedId, dupDialog.nome.trim());
      if (result?.success === false) throw new Error(result.error);
      setDupDialog({ open: false, nome: '' });
      await loadProfiles(result?.perfil?.id || result?.id);
      toast({ title: t('profiles.messages.duplicated') });
    } catch (err) {
      toast({ title: err.message || t('profiles.messages.saveError'), variant: 'destructive' });
    }
  };

  const confirmDelete = async () => {
    if (!selectedId) return;
    try {
      const result = await deleteProfile(selectedId);
      if (result?.success === false) throw new Error(result.error);
      setDeleteDialog({ open: false });
      setSelectedId(null);
      await loadProfiles();
      toast({ title: t('profiles.messages.deleted') });
    } catch (err) {
      toast({ title: err.message || t('profiles.messages.deleteError'), variant: 'destructive' });
    }
  };

  const grantedCount = (profile) => Number(profile.permissions_count ?? profile.permission_count ?? 0);
  const usersCount = (profile) => Number(profile.users_count ?? profile.user_count ?? 0);
  const percent = (profile) => {
    const count = selectedId === profile.id ? permSet.size : grantedCount(profile);
    if (!totalKeys) return 0;
    return Math.round((count / totalKeys) * 100);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">{t('profiles.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('profiles.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Can permission="profiles.create">
            <Button onClick={openCreate} className="text-white" style={{ background: '#2575D1' }}>
              <Plus className="w-4 h-4 mr-2" /> {t('profiles.new')}
            </Button>
          </Can>
          <Can permission="profiles.create">
            <Button
              variant="outline"
              disabled={!selected}
              onClick={() => setDupDialog({ open: true, nome: selected ? `${selected.nome} (cópia)` : '' })}
            >
              <Copy className="w-4 h-4 mr-2" /> {t('profiles.duplicate')}
            </Button>
          </Can>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden">
        {/* Left list */}
        <div className={cn(
          'lg:col-span-4 bg-card rounded-xl border border-border shadow-sm flex flex-col min-h-0 overflow-hidden',
          mobileShowPanel ? 'hidden lg:flex' : 'flex'
        )}>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" />
              </div>
            ) : profiles.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">{t('profiles.empty')}</div>
            ) : (
              <table className="w-full chemctrl-table text-sm">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left">{t('profiles.columns.name')}</th>
                    <th className="px-2 py-2 text-center">{t('profiles.columns.users')}</th>
                    <th className="px-2 py-2 text-center">{t('profiles.columns.perms')}</th>
                    <th className="px-2 py-2 text-center">{t('profiles.columns.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => {
                    const active = p.id === selectedId;
                    const pct = percent(p);
                    return (
                      <tr
                        key={p.id}
                        onClick={() => selectProfile(p.id)}
                        className={cn(
                          'border-b border-border cursor-pointer transition-colors',
                          active ? 'bg-blue-50 dark:bg-blue-950/30' : 'hover:bg-muted/50'
                        )}
                      >
                        <td className="px-3 py-2.5">
                          <div className="font-medium">{p.nome}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{pct}%</div>
                        </td>
                        <td className="px-2 py-2.5 text-center tabular-nums">{usersCount(p)}</td>
                        <td className="px-2 py-2.5 text-center tabular-nums">
                          {selectedId === p.id ? permSet.size : grantedCount(p)}
                        </td>
                        <td className="px-2 py-2.5 text-center">
                          <span className={cn(
                            'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                            p.status === 'Inativo' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          )}>
                            {p.status === 'Inativo' ? t('users.status.inactive') : t('users.status.active')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className={cn(
          'lg:col-span-8 bg-card rounded-xl border border-border shadow-sm flex flex-col min-h-0 overflow-hidden',
          mobileShowPanel ? 'flex' : 'hidden lg:flex'
        )}>
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-2 p-8">
              <Shield className="w-10 h-10 opacity-30" />
              <p className="text-sm">{t('profiles.selectHint')}</p>
            </div>
          ) : (
            <>
              <div className="shrink-0 border-b border-border p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <button
                      type="button"
                      className="lg:hidden text-xs text-[#2575D1] mb-1"
                      onClick={() => setMobileShowPanel(false)}
                    >
                      ← {t('profiles.backToList')}
                    </button>
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                      {selected.nome}
                      {isSystemProfile && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                          {t('profiles.systemBadge')}
                        </span>
                      )}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t('profiles.permSummary', {
                        granted: permSet.size,
                        total: totalKeys,
                        percent: totalKeys ? Math.round((permSet.size / totalKeys) * 100) : 0,
                      })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Can permission="profiles.edit">
                      <Button variant="outline" size="sm" onClick={openEditMeta}>
                        <Pencil className="w-3.5 h-3.5 mr-1.5" /> {t('profiles.editName')}
                      </Button>
                    </Can>
                    <Can permission="profiles.delete">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isSystemProfile || usersCount(selected) > 0}
                        onClick={() => setDeleteDialog({ open: true })}
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1.5" /> {t('buttons.delete')}
                      </Button>
                    </Can>
                    <Can permission="profiles.edit">
                      <Button
                        size="sm"
                        disabled={!dirty || saving || loadingPerms}
                        onClick={savePermissions}
                        className="text-white"
                        style={{ background: '#2575D1' }}
                      >
                        <Save className="w-3.5 h-3.5 mr-1.5" />
                        {saving ? t('common.saving') : t('profiles.savePermissions')}
                      </Button>
                    </Can>
                  </div>
                </div>
                <div className="relative max-w-md">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder={t('profiles.searchPermission')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
                {loadingPerms ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" />
                  </div>
                ) : (
                  filteredModules.map((mod) => {
                    const moduleKeys = mod.resources.flatMap((res) =>
                      res.actions.map((a) => permissionKey(res.id, a.key))
                    );
                    const allOn = moduleKeys.every((k) => permSet.has(k));
                    const isOpen = expandedModules[mod.id];
                    return (
                      <div key={mod.id} className="border border-border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 bg-muted/40">
                          <button
                            type="button"
                            className="flex items-center gap-2 flex-1 text-left"
                            onClick={() => setExpandedModules((p) => ({ ...p, [mod.id]: !p[mod.id] }))}
                          >
                            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            <span className="text-sm font-semibold">{t(mod.labelKey)}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {moduleKeys.filter((k) => permSet.has(k)).length}/{moduleKeys.length}
                            </span>
                          </button>
                          <Can permission="profiles.edit">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setModuleKeys(moduleKeys, true)}
                            >
                              {t('profiles.selectAll')}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setModuleKeys(moduleKeys, false)}
                              disabled={allOn && isAdminProfile && moduleKeys.some((k) => ADMIN_PROTECTED_KEYS.includes(k))}
                            >
                              {t('profiles.deselectAll')}
                            </Button>
                          </Can>
                        </div>
                        {isOpen && (
                          <div className="p-3 space-y-4">
                            {mod.resources.map((res) => (
                              <div key={res.id}>
                                <p className="text-xs font-medium text-muted-foreground mb-2">{t(res.labelKey)}</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                  {res.actions.map((action) => {
                                    const key = permissionKey(res.id, action.key);
                                    const checked = permSet.has(key);
                                    return (
                                      <label
                                        key={key}
                                        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 cursor-pointer"
                                      >
                                        <input
                                          type="checkbox"
                                          className="rounded border-border"
                                          checked={checked}
                                          onChange={() => togglePermission(key)}
                                        />
                                        <span>{t(action.labelKey)}</span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Meta dialog */}
      <Dialog open={metaDialog.open} onOpenChange={(open) => setMetaDialog((d) => ({ ...d, open }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {metaDialog.mode === 'create' ? t('profiles.new') : t('profiles.editName')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('profiles.fields.name')} *</label>
              <Input
                value={metaDialog.nome}
                onChange={(e) => setMetaDialog((d) => ({ ...d, nome: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('profiles.fields.description')}</label>
              <Input
                value={metaDialog.descricao}
                onChange={(e) => setMetaDialog((d) => ({ ...d, descricao: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('profiles.fields.status')}</label>
              <Select
                value={metaDialog.status}
                onValueChange={(v) => setMetaDialog((d) => ({ ...d, status: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Ativo">{t('users.status.active')}</SelectItem>
                  <SelectItem value="Inativo">{t('users.status.inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setMetaDialog((d) => ({ ...d, open: false }))}>{t('buttons.cancel')}</Button>
            <Button onClick={saveMeta} className="text-white" style={{ background: '#2575D1' }}>{t('buttons.save')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Duplicate */}
      <Dialog open={dupDialog.open} onOpenChange={(open) => setDupDialog((d) => ({ ...d, open }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('profiles.duplicate')}</DialogTitle></DialogHeader>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('profiles.fields.name')} *</label>
            <Input value={dupDialog.nome} onChange={(e) => setDupDialog((d) => ({ ...d, nome: e.target.value }))} />
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDupDialog({ open: false, nome: '' })}>{t('buttons.cancel')}</Button>
            <Button onClick={confirmDuplicate} className="text-white" style={{ background: '#2575D1' }}>{t('profiles.duplicate')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog({ open: false })}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('profiles.deleteConfirm.title')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('profiles.deleteConfirm.message', { name: selected?.nome })}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false })}>{t('buttons.cancel')}</Button>
            <Button onClick={confirmDelete} className="text-white" style={{ background: '#dc2626' }}>{t('buttons.delete')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Discard dirty */}
      <Dialog open={discardDialog.open} onOpenChange={(open) => !open && setDiscardDialog({ open: false, nextId: null })}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>{t('profiles.discard.title')}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">{t('profiles.discard.message')}</p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDiscardDialog({ open: false, nextId: null })}>{t('buttons.cancel')}</Button>
            <Button
              onClick={() => {
                const next = discardDialog.nextId;
                setDiscardDialog({ open: false, nextId: null });
                setSelectedId(next);
                setMobileShowPanel(true);
              }}
              className="text-white"
              style={{ background: '#2575D1' }}
            >
              {t('profiles.discard.confirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
