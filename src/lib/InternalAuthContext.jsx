import React, { createContext, useState, useContext, useEffect } from 'react';
import { callRPC, setSessionId, clearSessionId, getSessionId } from '@/api/rpcClient';
import { applyLanguage, isSupportedLocale, DEFAULT_LOCALE } from '@/i18n';
import i18n from '@/i18n';

const InternalAuthContext = createContext();
const SESSION_KEY = 'chemctrl_session';

function normalizeLanguage(value) {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}

function normalizePermissions(raw) {
  if (Array.isArray(raw)) return raw.filter((k) => typeof k === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapUser(u) {
  if (!u) return null;
  const nivel = (u.nivel_acesso || '').toLowerCase();
  const permissions = normalizePermissions(u.permissions);
  const perfil = u.perfil && typeof u.perfil === 'object'
    ? u.perfil
    : (u.perfil_id
      ? { id: u.perfil_id, nome: u.perfil_nome || u.nivel_acesso || '', slug: u.perfil_slug || null }
      : null);
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
    perfil_id: u.perfil_id || perfil?.id || null,
    perfil,
    permissions,
  };
}

function persistUserSession(userData) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(userData));
}

async function syncUserLanguage(userData) {
  const locale = normalizeLanguage(userData?.preferred_language);
  await applyLanguage(locale);
}

function clearLocalAuth() {
  clearSessionId();
  localStorage.removeItem(SESSION_KEY);
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
        if (session && session.session_id) {
          const userData = JSON.parse(rawSession);
          userData.permissions = normalizePermissions(
            session.permissions ?? userData.permissions
          );
          if (session.perfil_id) userData.perfil_id = session.perfil_id;
          if (session.perfil && typeof session.perfil === 'object') userData.perfil = session.perfil;
          if (session.nivel_acesso) userData.nivel_acesso = session.nivel_acesso;
          persistUserSession(userData);
          const mapped = mapUser(userData);
          setUser(mapped);
          await syncUserLanguage(mapped);
        } else {
          clearLocalAuth();
          setUser(null);
        }
      } catch (_e) {
        // Sem fallback de sessão fantasma: se validate falhar, obriga novo login.
        clearLocalAuth();
        setUser(null);
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
        // NÃO usar fallback com session_id falso — isso causa “pisca e volta ao login”.
        let detail = '';
        try {
          const parsed = JSON.parse(String(rpcErr?.message || ''));
          detail = parsed?.message || parsed?.hint || parsed?.code || '';
        } catch {
          detail = String(rpcErr?.message || '').slice(0, 180);
        }

        const msg = String(rpcErr?.message || '');
        if (
          msg.includes('42703')
          || msg.toLowerCase().includes('column')
          || msg.includes('PGRST')
          || msg.toLowerCase().includes('schema')
        ) {
          return {
            success: false,
            error: detail
              ? `${i18n.t('login.errors.rpcSchema')} (${detail})`
              : i18n.t('login.errors.rpcSchema'),
          };
        }
        return {
          success: false,
          error: detail || i18n.t('login.errors.network'),
        };
      }

      if (!result || !result.success) {
        return { success: false, error: result?.error || 'Usuário ou senha inválidos.' };
      }

      if (!result.session_id || !result.user) {
        return {
          success: false,
          error: i18n.t('login.errors.generic'),
        };
      }

      const userData = {
        ...result.user,
        preferred_language: normalizeLanguage(result.user?.preferred_language),
        permissions: normalizePermissions(result.user?.permissions),
      };
      setSessionId(result.session_id);
      persistUserSession(userData);
      sessionStorage.setItem('chemctrl_welcome', '1');

      const mapped = mapUser(userData);
      setUser(mapped);
      await syncUserLanguage(mapped);
      return { success: true, user: mapped };
    } catch (_e) {
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
          // continue with local fallback
        }
      }
    } catch (_) {
      // local only
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
    clearLocalAuth();
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
