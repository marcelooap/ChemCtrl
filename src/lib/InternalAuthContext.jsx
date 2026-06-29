import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const InternalAuthContext = createContext();
const SESSION_KEY = 'chemctrl_session';

function mapUser(u) {
  if (!u) return null;
  const nivel = (u.nivel_acesso || '').toLowerCase();
  return {
    ...u,
    id: u.id,
    nome: u.nome_completo,
    full_name: u.nome_completo,
    username: u.usuario,
    nivel: nivel,
    nivel_acesso: u.nivel_acesso,
    active: u.status === 'Ativo',
    tipo: u.tipo || 'interno',
    cliente: u.cliente || '',
    cargo: u.cargo || '',
    senha: u.senha,
  };
}

export const InternalAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw);
        setUser(mapUser(session));
      }
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
    }
    setLoading(false);
  }, []);

  const login = async (username, password) => {
    const allUsers = await base44.entities.Usuario.list('-created_date', 500);
    const found = allUsers.find(u => u.usuario === username);

    if (!found) {
      return { success: false, error: 'Usuário ou senha inválidos.' };
    }

    if (found.status === 'Inativo') {
      return { success: false, error: 'Usuário inativo. Contate o administrador do sistema.' };
    }

    if (found.senha !== password) {
      return { success: false, error: 'Usuário ou senha inválidos.' };
    }

    const sessionData = {
      id: found.id,
      nome_completo: found.nome_completo,
      usuario: found.usuario,
      nivel_acesso: found.nivel_acesso,
      status: found.status,
      tipo: found.tipo || 'interno',
      cliente: found.cliente || '',
      cargo: found.cargo || '',
      senha: found.senha,
    };

    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    sessionStorage.setItem('chemctrl_welcome', '1');
    const mapped = mapUser(sessionData);
    setUser(mapped);
    return { success: true, user: mapped };
  };

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
    window.location.href = '/login';
  };

  const isAuthenticated = !!user;

  return (
    <InternalAuthContext.Provider value={{ user, isAuthenticated, loading, login, logout }}>
      {children}
    </InternalAuthContext.Provider>
  );
};

export const useInternalAuth = () => {
  const context = useContext(InternalAuthContext);
  if (!context) {
    throw new Error('useInternalAuth must be used within an InternalAuthProvider');
  }
  return context;
};
