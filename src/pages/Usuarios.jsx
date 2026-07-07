import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useRealtimeEntity } from '@/hooks/useRealtimeEntity';
import { useInternalAuth } from '@/lib/InternalAuthContext';
import { Plus, Search, Pencil, Power, Trash2, EyeOff, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { getNivelOptionsForTipo } from '@/lib/permissions';

const emptyForm = { nome_completo: '', usuario: '', senha: '', cargo: '', nivel_acesso: 'Operacional', status: 'Ativo', tipo: 'interno', cliente: '' };

export default function Usuarios() {
  const { user: currentUser } = useInternalAuth();
  const { data: users, loading, reload: load } = useRealtimeEntity('Usuario', () => base44.entities.Usuario.list('-created_date', 200));
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState({ open: false, user: null });
  const [hidePasswords, setHidePasswords] = useState(true);
  const { toast } = useToast();

  const nivelBadge = (nivel) => {
    const colors = {
      Administrador: 'bg-red-100 text-red-700',
      Supervisor: 'bg-amber-100 text-amber-700',
      Operacional: 'bg-blue-100 text-blue-700',
      'Visualização': 'bg-gray-200 text-gray-700',
    };
    return <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${colors[nivel] || colors.Operacional}`}>{nivel || 'Operacional'}</span>;
  };

  const generateUsername = (nome) => {
    return nome.toLowerCase().trim().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '');
  };

  // Auto-fill username from nome_completo, but only if user hasn't manually edited it
  const handleNomeChange = (val) => {
    setForm(prev => {
      // If usuario is empty or was auto-generated from previous nome, update it
      const prevAuto = prev.usuario && generateUsername(prev.nome_completo) === prev.usuario;
      return {
        ...prev,
        nome_completo: val,
        usuario: (prevAuto || !prev.usuario) ? generateUsername(val) : prev.usuario,
      };
    });
  };

  const openNew = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); };

  const openEdit = (u) => {
    setForm({
      nome_completo: u.nome_completo || '',
      usuario: u.usuario || '',
      senha: u.senha || '',
      cargo: u.cargo || '',
      nivel_acesso: u.nivel_acesso || 'Operacional',
      status: u.status || 'Ativo',
      tipo: u.tipo || 'interno',
      cliente: u.cliente || '',
    });
    setEditingId(u.id);
    setShowForm(true);
  };

  const deleteUser = async (u) => {
    if (u.usuario === currentUser?.usuario) {
      toast({ title: 'Você não pode excluir seu próprio usuário.', variant: 'destructive' });
      return;
    }
    setConfirmDelete({ open: true, user: u });
  };

  const confirmDeleteUser = async () => {
    const u = confirmDelete.user;
    try {
      await base44.entities.Usuario.delete(u.id);
      toast({ title: 'Usuário excluído com sucesso.' });
      setConfirmDelete({ open: false, user: null });
      load();
    } catch (err) {
      toast({ title: err.message || 'Erro ao excluir usuário', variant: 'destructive' });
    }
  };

  const toggleActive = async (u) => {
    const newStatus = u.status === 'Inativo' ? 'Ativo' : 'Inativo';
    await base44.entities.Usuario.update(u.id, { status: newStatus });
    toast({ title: `Usuário ${newStatus === 'Ativo' ? 'reativado' : 'inativado'} com sucesso!` });
    load();
  };

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return !q || [u.nome_completo, u.usuario, u.cargo, u.nivel_acesso, u.cliente].some(v => (v || '').toLowerCase().includes(q));
  });

  const handleTipoChange = (newTipo) => {
    const allowedNiveis = getNivelOptionsForTipo(newTipo);
    // If current nivel is not allowed for this tipo, force it to the only valid option
    const newNivel = allowedNiveis.includes(form.nivel_acesso) ? form.nivel_acesso : allowedNiveis[0];
    setForm({ ...form, tipo: newTipo, nivel_acesso: newNivel, cliente: newTipo === 'interno' ? '' : form.cliente });
  };

  const saveUser = async () => {
    if (!form.nome_completo || !form.usuario) {
      toast({ title: 'Preencha nome e usuário', variant: 'destructive' });
      return;
    }
    if (!editingId && !form.senha) {
      toast({ title: 'Informe a senha inicial', variant: 'destructive' });
      return;
    }
    if (!form.nivel_acesso) {
      toast({ title: 'Selecione o nível de acesso', variant: 'destructive' });
      return;
    }
    if (form.tipo === 'externo' && form.nivel_acesso !== 'Visualização') {
      toast({ title: 'Usuários externos devem ter nível Visualização', variant: 'destructive' });
      return;
    }
    if (form.tipo === 'externo' && !form.cliente) {
      toast({ title: 'Informe o cliente para usuários externos', variant: 'destructive' });
      return;
    }

    // Check for duplicate username
    const duplicate = users.find(u => u.usuario === form.usuario && u.id !== editingId);
    if (duplicate) {
      toast({ title: 'Já existe um usuário cadastrado com este login.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const data = {
        nome_completo: form.nome_completo,
        usuario: form.usuario,
        cargo: form.cargo,
        nivel_acesso: form.nivel_acesso,
        status: form.status,
        tipo: form.tipo,
        cliente: form.tipo === 'externo' ? form.cliente : null,
      };
      if (form.senha) {
        data.senha = form.senha;
      }

      if (editingId) {
        await base44.entities.Usuario.update(editingId, data);
        toast({ title: 'Usuário atualizado com sucesso!' });
      } else {
        data.criado_por = currentUser?.nome_completo || 'Sistema';
        await base44.entities.Usuario.create(data);
        toast({ title: 'Usuário cadastrado com sucesso.' });
      }
      setShowForm(false);
      setForm(emptyForm);
      setEditingId(null);
      load();
    } catch (err) {
      toast({ title: err.message || 'Erro ao salvar usuário', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const nivelOptions = getNivelOptionsForTipo(form.tipo);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 48px)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: '#1A1A2E' }}>Usuários</h1>
          <p className="text-sm text-muted-foreground">Gerencie o acesso ao sistema · {users.length} usuário(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setHidePasswords(v => !v)} title={hidePasswords ? 'Mostrar senhas' : 'Ocultar senhas'}>
            {hidePasswords ? <Eye className="w-4 h-4 mr-2" /> : <EyeOff className="w-4 h-4 mr-2" />}
            {hidePasswords ? 'Mostrar Senhas' : 'Ocultar Senhas'}
          </Button>
          <Button onClick={openNew} className="text-white" style={{ background: '#2575D1' }}>
            <Plus className="w-4 h-4 mr-2" /> Adicionar Usuário
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex-1 flex flex-col overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32"><div className="w-6 h-6 border-2 border-gray-200 border-t-[#2575D1] rounded-full animate-spin" /></div>
        ) : (
          <>
            <div className="p-4 border-b border-gray-100 shrink-0">
              <div className="relative w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Buscar usuário..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full chemctrl-table">
                <thead className="sticky top-0 z-10"><tr className="border-b border-gray-50 bg-gray-50">
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">Usuário</th>
                  <th className="px-4 py-3 text-left">Senha</th>
                  <th className="px-4 py-3 text-left">Cargo</th>
                  <th className="px-4 py-3 text-center">Nível</th>
                  <th className="px-4 py-3 text-center">Tipo</th>
                  <th className="px-4 py-3 text-left">Cliente</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Ações</th>
                </tr></thead>
                <tbody>
                  {filtered.map(u => {
                    const inactive = u.status === 'Inativo';
                    return (
                      <tr key={u.id} className="border-b border-gray-50" style={{ opacity: inactive ? 0.5 : 1 }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: '#2575D1' }}>
                              {(u.nome_completo || 'U').charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium text-sm">{u.nome_completo || '—'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground font-mono">{u.usuario || '—'}</td>
                        <td className="px-4 py-3 text-sm font-mono">
                          {hidePasswords
                            ? <span className="text-muted-foreground/60 tracking-widest select-none">••••••</span>
                            : (u.senha || '—')}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{u.cargo || '—'}</td>
                        <td className="px-4 py-3 text-center">{nivelBadge(u.nivel_acesso)}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.tipo === 'externo' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}`}>
                            {u.tipo || 'interno'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{u.cliente || '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${inactive ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                            {inactive ? 'Inativo' : 'Ativo'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={() => openEdit(u)} className="p-1.5 rounded hover:bg-blue-50" title="Editar">
                              <Pencil className="w-3.5 h-3.5 text-blue-500" />
                            </button>
                            <button onClick={() => toggleActive(u)} className="p-1.5 rounded hover:bg-gray-100" title={inactive ? 'Reativar' : 'Inativar'}>
                              <Power className={`w-3.5 h-3.5 ${inactive ? 'text-green-500' : 'text-red-400'}`} />
                            </button>
                            <button onClick={() => deleteUser(u)} className="p-1.5 rounded hover:bg-red-50" title="Excluir">
                              <Trash2 className="w-3.5 h-3.5 text-red-500" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Fixed Footer */}
            <div className="shrink-0 border-t border-gray-100 bg-gray-50 px-4 py-1.5">
              <div className="flex items-center gap-4 text-xs flex-wrap">
                <span className="text-muted-foreground">Total: <span className="font-bold" style={{ color: '#1A1A2E' }}>{users.length}</span></span>
                <span className="text-muted-foreground">Internos: <span className="font-bold text-green-600">{users.filter(u => u.tipo === 'interno').length}</span></span>
                <span className="text-muted-foreground">Externos: <span className="font-bold text-purple-600">{users.filter(u => u.tipo === 'externo').length}</span></span>
                <span className="text-muted-foreground">Ativos: <span className="font-bold text-green-600">{users.filter(u => u.status === 'Ativo').length}</span></span>
                <span className="text-muted-foreground">Inativos: <span className="font-bold text-red-600">{users.filter(u => u.status === 'Inativo').length}</span></span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Add/Edit User Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="text-base font-bold" style={{ color: '#1e293b' }}>{editingId ? 'Editar Usuário' : 'Adicionar Usuário'}</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nome Completo *</label>
              <Input value={form.nome_completo} onChange={e => handleNomeChange(e.target.value)} placeholder="Nome completo" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Usuário *</label>
              <Input value={form.usuario} onChange={e => setForm({ ...form, usuario: e.target.value })} placeholder="ex: marcelo.amaral" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Senha {editingId ? '(deixe em branco para manter)' : '*'}</label>
              <Input type="password" value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })} placeholder={editingId ? 'Nova senha ou deixe em branco' : 'Senha inicial'} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Cargo</label>
              <Input value={form.cargo} onChange={e => setForm({ ...form, cargo: e.target.value })} placeholder="Ex: Operador, Analista..." />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Tipo *</label>
              <Select value={form.tipo} onValueChange={handleTipoChange}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="interno">Interno</SelectItem>
                  <SelectItem value="externo">Externo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nível de Acesso *</label>
              <Select value={form.nivel_acesso} onValueChange={v => setForm({ ...form, nivel_acesso: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {nivelOptions.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
              {form.tipo === 'externo' && (
                <p className="text-xs text-muted-foreground mt-1">Usuários externos têm acesso somente à Tela Clientes (somente visualização).</p>
              )}
            </div>
            {editingId && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Ativo">Ativo</SelectItem>
                    <SelectItem value="Inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.tipo === 'externo' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Cliente *</label>
                <Input value={form.cliente} onChange={e => setForm({ ...form, cliente: e.target.value })} placeholder="Nome do cliente" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={saveUser} disabled={saving} className="text-white" style={{ background: '#2575D1' }}>
              {saving ? 'Salvando...' : editingId ? 'Salvar Alterações' : 'Cadastrar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={confirmDelete.open} onOpenChange={(open) => !open && setConfirmDelete({ open: false, user: null })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold" style={{ color: '#1e293b' }}>Excluir Usuário</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Tem certeza que deseja excluir o usuário <strong>{confirmDelete.user?.nome_completo}</strong> ({confirmDelete.user?.usuario})? Esta ação não pode ser desfeita.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmDelete({ open: false, user: null })}>Cancelar</Button>
            <Button onClick={confirmDeleteUser} className="text-white" style={{ background: '#dc2626' }}>
              Excluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
