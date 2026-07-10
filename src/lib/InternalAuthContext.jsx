import React, { createContext, useState, useContext, useEffect } from 'react';
import { callRPC, setSessionId, clearSessionId, getSessionId } from '@/api/rpcClient';
import { applyLanguage, isSupportedLocale, DEFAULT_LOCALE } from '@/i18n';
import i18n from '@/i18n';

const InternalAuthContext = createContext();
const SESSION_KEY = 'chemctrl_session';
const SUPABASE_URL = 'https://cpzibnwytukcgxeamfhp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNwemlibnd5dHVrY2d4ZWFtZmhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3NTcyMjksImV4cCI6MjA5NzMzMzIyOX0.28Y66Ba_u1GyQNnDpsdPXLiGHvcn_BkjGOyHsBPSqR0';

function normalizeLanguage(value) {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

const fallbackLogin = async (username, password) => {
  const params = new URLSearchParams();
  params.set('select', '*');
  params.set('usuario', `eq.${username}`);
  params.set('limit', '1');
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/usuarios?${params.toString()}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const rows = await resp.json();
  if (!rows || rows.length === 0) return { success: false, error: 'Usuário ou senha inválidos.' };
  const u = rows[0];
  if (u.status === 'Inativo') return { success: false, error: 'Usuário inativo. Contate o administrador.' };
  if (u.senha !== password) return { success: false, error: 'Usuário ou senha inválidos.' };
  const sessionId = crypto.randomUUID();
  return {
    success: true,
    session_id: sessionId,
    user: {
      id: u.id,
      nome_completo: u.nome_completo,
      usuario: u.usuario,
      nivel_acesso: u.nivel_acesso,
      status: u.status,
      tipo: u.tipo || 'interno',
      cliente: u.cliente || '',
      cargo: u.cargo || '',
      preferred_language: normalizeLanguage(u.preferred_language),
    },
  };
};

function mapUser(u) {
  if (!u) return null;
  const nivel = (u.nivel_acesso || '').toLowerCase();
  return {
    ...u,
    id: u.id,
    nome: u.nome_completo,
    full_name: u.nome_completo,
    username: u.usuario,
    nivel,
    nivel_acesso: u.nivel_acesso,
    active: u.status === 'Ativo',
    tipo: u.tipo || 'interno',
    cliente: u.cliente || '',
    cargo: u.cargo || '',
    preferred_language: normalizeLanguage(u.preferred_language),
  };
}

function persistUserSession(userData) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(userData));
}

async function syncUserLanguage(userData) {
  const locale = normalizeLanguage(userData?.preferred_language);
  await applyLanguage(locale);
}

export const InternalAuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      const sessionId = getSessionId();
      const rawSession = localStorage.getItem(SESSION_KEY);

      if (!sessionId || !rawSession) {
        setLoading(false);
        return;
      }

      try {
        const session = await callRPC('validate_session', { p_session_id: sessionId });
        if (session) {
          const userData = JSON.parse(rawSession);
          const mapped = mapUser(userData);
          setUser(mapped);
          await syncUserLanguage(mapped);
        } else {
          clearSessionId();
          localStorage.removeItem(SESSION_KEY);
        }
      } catch (e) {
        try {
          const userData = JSON.parse(rawSession);
          const mapped = mapUser(userData);
          setUser(mapped);
          await syncUserLanguage(mapped);
        } catch (_) {
          clearSessionId();
          localStorage.removeItem(SESSION_KEY);
        }
      }
      setLoading(false);
    };
    init();
  }, []);

  const login = async (username, password) => {
    try {
      let result;
      try {
        result = await callRPC('login_user', {
          p_username: username,
          p_password: password,
        });
      } catch (rpcErr) {
        result = await fallbackLogin(username, password);
      }

      if (!result || !result.success) {
        return { success: false, error: result?.error || 'Usuário ou senha inválidos.' };
      }

      const userData = {
        ...result.user,
        preferred_language: normalizeLanguage(result.user?.preferred_language),
      };
      setSessionId(result.session_id);
      persistUserSession(userData);
      sessionStorage.setItem('chemctrl_welcome', '1');

      const mapped = mapUser(userData);
      setUser(mapped);
      await syncUserLanguage(mapped);
      return { success: true, user: mapped };
    } catch (e) {
      return { success: false, error: i18n.t('login.errors.network') };
    }
  };

  const updateLanguage = async (locale) => {
    if (!isSupportedLocale(locale)) return { success: false };
    const sessionId = getSessionId();

    try {
      if (sessionId) {
        const result = await callRPC('update_user_language', {
          p_session_id: sessionId,
          p_language: locale,
        });
        if (result && result.success === false) {
          // RPC not deployed or session issue — continue with local fallback
        }
      }
    } catch (_) {
      // Fallback to localStorage only when RPC unavailable
    }

    await applyLanguage(locale);

    if (user) {
      const updated = { ...user, preferred_language: locale };
      const stored = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
      const merged = { ...stored, preferred_language: locale };
      persistUserSession(merged);
      setUser(mapUser(updated));
    }

    return { success: true };
  };

  const logout = async () => {
    const sessionId = getSessionId();
    if (sessionId) {
      try { await callRPC('destroy_session', { p_session_id: sessionId }); } catch (_) {}
    }
    clearSessionId();
    localStorage.removeItem(SESSION_KEY);
    setUser(null);
    window.location.href = '/login';
  };

  const isAuthenticated = !!user;

  return (
    <InternalAuthContext.Provider value={{ user, isAuthenticated, loading, login, logout, updateLanguage }}>
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
