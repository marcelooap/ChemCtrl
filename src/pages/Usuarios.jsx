import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { Plus, Search, Pencil, Power, Trash2, EyeOff, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { translateUserStatus, translateUserType } from '@/i18n/domainMaps';
import { listProfiles } from '@/lib/rbac/rbacApi';
import { Can } from '@/lib/rbac/Can';

const emptyForm = {
  nome_completo: '',
  usuario: '',
  senha: '',
  cargo: '',
  perfil_id: '',
  status: 'Ativo',
  tipo: 'interno',
  cliente: '',
};

export default function Usuarios() {
  const { t } = useTranslation();
  const { user: currentUser } = useInternalAuth();
  const { data: users, loading, reload: load } = useRealtimeEntity('Usuario', () => base44.entities.Usuario.list('-created_date', 200));
  const [profiles, setProfiles] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState({ open: false, user: null });
  const [hidePasswords, setHidePasswords] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    listProfiles()
      .then((rows) => setProfiles(Array.isArray(rows) ? rows.filter((p) => p.status !== 'Inativo') : []))
      .catch(() => setProfiles([]));
  }, []);

  const profileById = useMemo(() => {
    const map = {};
    profiles.forEach((p) => { map[p.id] = p; });
    return map;
  }, [profiles]);

  const resolveProfileName = (u) => {
    if (u.perfil_id && profileById[u.perfil_id]) return profileById[u.perfil_id].nome;
    if (u.perfil?.nome) return u.perfil.nome;
    return u.nivel_acesso || t('common.notAvailable');
  };

  const profileBadge = (name) => {
    const colors = {
      Administrador: 'bg-red-100 text-red-700',
      Supervisor: 'bg-amber-100 text-amber-700',
      Operacional: 'bg-blue-100 text-blue-700',
      Visualização: 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
      Cliente: 'bg-purple-100 text-purple-700',
    };
    return (
      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${colors[name] || 'bg-slate-100 text-slate-700'}`}>
        {name}
      </span>
    );
  };

  const generateUsername = (nome) =>
    nome.toLowerCase().trim().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');

  const handleNomeChange = (val) => {
    setForm((prev) => {
      const prevAuto = prev.usuario && generateUsername(prev.nome_completo) === prev.usuario;
      return {
        ...prev,
        nome_completo: val,
        usuario: (prevAuto || !prev.usuario) ? generateUsername(val) : prev.usuario,
      };
    });
  };

  const defaultPerfilIdForTipo = (tipo) => {
    if (tipo === 'externo') {
      return profiles.find((p) => p.slug === 'cliente')?.id
        || profiles.find((p) => (p.nome || '').toLowerCase() === 'cliente')?.id
        || '';
    }
    return profiles.find((p) => p.slug === 'operacional')?.id
      || profiles.find((p) => (p.nome || '').toLowerCase() === 'operacional')?.id
      || profiles[0]?.id
      || '';
  };

  const openNew = () => {
    setForm({ ...emptyForm, perfil_id: defaultPerfilIdForTipo('interno') });
    setEditingId(null);
    setShowForm(true);
  };

  const openEdit = (u) => {
    setForm({
      nome_completo: u.nome_completo || '',
      usuario: u.usuario || '',
      senha: u.senha || '',
      cargo: u.cargo || '',
      perfil_id: u.perfil_id || defaultPerfilIdForTipo(u.tipo || 'interno'),
      status: u.status || 'Ativo',
      tipo: u.tipo || 'interno',
      cliente: u.cliente || '',
    });
    setEditingId(u.id);
    setShowForm(true);
  };

  const deleteUser = async (u) => {
    if (u.usuario === currentUser?.usuario) {
      toast({ title: t('users.messages.cannotDeleteSelf'), variant: 'destructive' });
      return;
    }
    setConfirmDelete({ open: true, user: u });
  };

  const confirmDeleteUser = async () => {
    const u = confirmDelete.user;
    try {
      await base44.entities.Usuario.delete(u.id);
      toast({ title: t('users.messages.deleted') });
      setConfirmDelete({ open: false, user: null });
      load();
    } catch (err) {
      toast({ title: err.message || t('users.messages.deleteError'), variant: 'destructive' });
    }
  };

  const toggleActive = async (u) => {
    const newStatus = u.status === 'Inativo' ? 'Ativo' : 'Inativo';
    await base44.entities.Usuario.update(u.id, { status: newStatus });
    toast({ title: newStatus === 'Ativo' ? t('users.messages.activated') : t('users.messages.deactivated') });
    load();
  };

  const filtered = users.filter((u) => {
    const q = search.toLowerCase();
    const profileName = resolveProfileName(u);
    return !q || [u.nome_completo, u.usuario, u.cargo, profileName, u.cliente].some((v) => (v || '').toLowerCase().includes(q));
  });

  const handleTipoChange = (newTipo) => {
    setForm((prev) => ({
      ...prev,
      tipo: newTipo,
      cliente: newTipo === 'interno' ? '' : prev.cliente,
      perfil_id: defaultPerfilIdForTipo(newTipo) || prev.perfil_id,
    }));
  };

  const saveUser = async () => {
    if (!form.nome_completo || !form.usuario) {
      toast({ title: t('users.messages.fillRequired'), variant: 'destructive' });
      return;
    }
    if (!editingId && !form.senha) {
      toast({ title: t('users.messages.passwordRequired'), variant: 'destructive' });
      return;
    }
    if (!form.perfil_id) {
      toast({ title: t('users.messages.profileRequired'), variant: 'destructive' });
      return;
    }
    if (form.tipo === 'externo' && !form.cliente) {
      toast({ title: t('users.messages.clientRequired'), variant: 'destructive' });
      return;
    }

    const duplicate = users.find((u) => u.usuario === form.usuario && u.id !== editingId);
    if (duplicate) {
      toast({ title: t('users.messages.duplicateUsername'), variant: 'destructive' });
      return;
    }

    const profile = profileById[form.perfil_id];
    setSaving(true);
    try {
      const data = {
        nome_completo: form.nome_completo,
        usuario: form.usuario,
        cargo: form.cargo,
        perfil_id: form.perfil_id,
        nivel_acesso: profile?.nome || form.nivel_acesso || 'Operacional',
        status: form.status,
        tipo: form.tipo,
        cliente: form.tipo === 'externo' ? form.cliente : null,
      };
      if (form.senha) data.senha = form.senha;

      if (editingId) {
        await base44.entities.Usuario.update(editingId, data);
        toast({ title: t('users.messages.updated') });
      } else {
        data.criado_por = currentUser?.nome_completo || 'Sistema';
        await base44.entities.Usuario.create(data);
        toast({ title: t('users.messages.created') });
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      toast({ title: err.message || t('users.messages.saveError'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const availableProfiles = form.tipo === 'externo'
    ? profiles.filter((p) => p.slug === 'cliente' || (p.nome || '').toLowerCase() === 'cliente')
    : profiles.filter((p) => p.slug !== 'cliente');

  const displayProfiles = availableProfiles.length ? availableProfiles : profiles;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{t('users.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('users.subtitle', { count: users.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setHidePasswords((v) => !v)} title={hidePasswords ? t('users.showPasswordsTitle') : t('users.hidePasswordsTitle')}>
            {hidePasswords ? <Eye className="w-4 h-4 mr-2" /> : <EyeOff className="w-4 h-4 mr-2" />}
            {hidePasswords ? t('users.showPasswords') : t('users.hidePasswords')}
          </Button>
          <Can permission="users.create">
            <Button onClick={openNew} className="text-white" style={{ background: '#2575D1' }}>
              <Plus className="w-4 h-4 mr-2" /> {t('users.addUser')}
            </Button>
          </Can>
        </div>
      </div>

      <div className="bg-card rounded-xl shadow-sm border border-border flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="shrink-0 p-4 border-b border-border">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder={t('users.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-border border-t-[#2575D1] rounded-full animate-spin" /></div>
          ) : (
            <table className="w-full chemctrl-table">
              <thead className="sticky top-0 z-10 bg-card"><tr className="border-b border-border">
                <th className="px-4 py-3 text-left">{t('common.name')}</th>
                <th className="px-4 py-3 text-left">{t('users.fields.username')}</th>
                <th className="px-4 py-3 text-left">{t('users.fields.password')}</th>
                <th className="px-4 py-3 text-left">{t('users.fields.cargo')}</th>
                <th className="px-4 py-3 text-center">{t('users.fields.profile')}</th>
                <th className="px-4 py-3 text-center">{t('users.fields.type')}</th>
                <th className="px-4 py-3 text-left">{t('users.fields.client')}</th>
                <th className="px-4 py-3 text-center">{t('users.fields.status')}</th>
                <th className="px-4 py-3 text-center">{t('common.actions')}</th>
              </tr></thead>
              <tbody>
                {filtered.map((u) => {
                  const inactive = u.status === 'Inativo';
                  return (
                    <tr key={u.id} className="border-b border-border" style={{ opacity: inactive ? 0.5 : 1 }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: '#2575D1' }}>
                            {(u.nome_completo || 'U').charAt(0).toUpperCase()}
                          </div>
                          <span className="font-medium text-sm">{u.nome_completo || t('common.notAvailable')}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{u.usuario || t('common.notAvailable')}</td>
                      <td className="px-4 py-3 text-sm font-mono">
                        {hidePasswords
                          ? <span className="text-muted-foreground/60 tracking-widest select-none">••••••</span>
                          : (u.senha || t('common.notAvailable'))}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{u.cargo || t('common.notAvailable')}</td>
                      <td className="px-4 py-3 text-center">{profileBadge(resolveProfileName(u))}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.tipo === 'externo' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                          {translateUserType(u.tipo || 'interno')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{u.cliente || t('common.notAvailable')}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${inactive ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                          {translateUserStatus(inactive ? 'Inativo' : 'Ativo')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Can permission="users.edit">
                            <button onClick={() => openEdit(u)} className="p-1.5 rounded hover:bg-blue-50" title={t('buttons.edit')}>
                              <Pencil className="w-3.5 h-3.5 text-blue-500" />
                            </button>
                          </Can>
                          <Can permission="users.edit">
                            <button onClick={() => toggleActive(u)} className="p-1.5 rounded hover:bg-muted" title={inactive ? t('users.actions.activate') : t('users.actions.deactivate')}>
                              <Power className={`w-3.5 h-3.5 ${inactive ? 'text-green-500' : 'text-red-400'}`} />
                            </button>
                          </Can>
                          <Can permission="users.delete">
                            <button onClick={() => deleteUser(u)} className="p-1.5 rounded hover:bg-red-50" title={t('buttons.delete')}>
                              <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </button>
                          </Can>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="shrink-0 border-t border-border bg-muted/50 px-4 py-1.5">
          <div className="flex items-center gap-4 text-xs flex-wrap">
            <span className="text-muted-foreground">{t('users.footer.total')}: <span className="font-bold">{users.length}</span></span>
            <span className="text-muted-foreground">{t('users.footer.internal')}: <span className="font-bold text-green-600">{users.filter((u) => u.tipo === 'interno').length}</span></span>
            <span className="text-muted-foreground">{t('users.footer.external')}: <span className="font-bold text-purple-600">{users.filter((u) => u.tipo === 'externo').length}</span></span>
            <span className="text-muted-foreground">{t('users.footer.active')}: <span className="font-bold text-green-600">{users.filter((u) => u.status === 'Ativo').length}</span></span>
            <span className="text-muted-foreground">{t('users.footer.inactive')}: <span className="font-bold text-red-600">{users.filter((u) => u.status === 'Inativo').length}</span></span>
          </div>
        </div>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-base font-bold">{editingId ? t('users.edit') : t('users.addUser')}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('users.fields.fullName')} *</label>
              <Input value={form.nome_completo} onChange={(e) => handleNomeChange(e.target.value)} placeholder={t('users.placeholders.fullName')} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('users.fields.username')} *</label>
              <Input value={form.usuario} onChange={(e) => setForm({ ...form, usuario: e.target.value })} placeholder={t('users.placeholders.username')} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('users.fields.password')} {editingId ? t('users.passwordKeepBlank') : '*'}</label>
              <Input type="password" value={form.senha} onChange={(e) => setForm({ ...form, senha: e.target.value })} placeholder={editingId ? t('users.placeholders.passwordNew') : t('users.placeholders.passwordInitial')} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('users.fields.cargo')}</label>
              <Input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} placeholder={t('users.placeholders.cargo')} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('users.fields.type')} *</label>
              <Select value={form.tipo} onValueChange={handleTipoChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="interno">{t('users.types.internal')}</SelectItem>
                  <SelectItem value="externo">{t('users.types.external')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('users.fields.profile')} *</label>
              <Select value={form.perfil_id} onValueChange={(v) => setForm({ ...form, perfil_id: v })}>
                <SelectTrigger><SelectValue placeholder={t('users.placeholders.profile')} /></SelectTrigger>
                <SelectContent>
                  {displayProfiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.tipo === 'externo' && (
                <p className="text-xs text-muted-foreground mt-1">{t('users.externalAccessNote')}</p>
              )}
            </div>
            {editingId && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('users.fields.status')}</label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Ativo">{t('users.status.active')}</SelectItem>
                    <SelectItem value="Inativo">{t('users.status.inactive')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.tipo === 'externo' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('users.fields.client')} *</label>
                <Input value={form.cliente} onChange={(e) => setForm({ ...form, cliente: e.target.value })} placeholder={t('users.placeholders.client')} />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)}>{t('buttons.cancel')}</Button>
            <Button onClick={saveUser} disabled={saving} className="text-white" style={{ background: '#2575D1' }}>
              {saving ? t('common.saving') : editingId ? t('buttons.save') : t('buttons.register')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete.open} onOpenChange={(open) => !open && setConfirmDelete({ open: false, user: null })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">{t('users.deleteConfirm.title')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {t('users.deleteConfirm.message', { name: confirmDelete.user?.nome_completo, username: confirmDelete.user?.usuario })}
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmDelete({ open: false, user: null })}>{t('buttons.cancel')}</Button>
            <Button onClick={confirmDeleteUser} className="text-white" style={{ background: '#dc2626' }}>
              {t('buttons.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
