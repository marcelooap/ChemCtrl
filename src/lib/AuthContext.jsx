import React, { createContext, useState, useContext, useEffect } from 'react';
import { supabase } from '@/api/subaseClient'; // Usando o seu cliente do Supabase

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings, setIsLoadingPublicSettings] = useState(false); // Não mais necessário para o Base44
  const [authError, setAuthError] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [appPublicSettings, setAppPublicSettings] = useState({ id: 'chemctrl', public_settings: {} }); // Mockado para evitar quebras no restante do app

  useEffect(() => {
    // 1. Checa a sessão atual assim que o app carrega
    const checkUserAuth = async () => {
      try {
        setIsLoadingAuth(true);
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) throw error;

        if (session?.user) {
          setUser(session.user);
          setIsAuthenticated(true);
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (error) {
        console.error('Erro ao checar autenticação:', error);
        setAuthError({
          type: 'unknown',
          message: error.message || 'Falha ao verificar sessão.'
        });
      } finally {
        setIsLoadingAuth(false);
        setAuthChecked(true);
      }
    };

    checkUserAuth();

    // 2. Escuta mudanças no estado da autenticação (Login, SignOut, etc.) de forma nativa
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setUser(session.user);
        setIsAuthenticated(true);
      } else {
        setUser(null);
        setIsAuthenticated(false);
      }
      setIsLoadingAuth(false);
      setAuthChecked(true);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  // Função de logout nativa do Supabase
  const logout = async () => {
    try {
      setIsLoadingAuth(true);
      await supabase.auth.signOut();
      setUser(null);
      setIsAuthenticated(false);
    } catch (error) {
      console.error('Erro ao deslogar:', error);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  // Mantido a assinatura da função antiga para evitar quebras, redirecionando para a sua rota de login (/login ou /auth)
  const navigateToLogin = () => {
    window.location.href = '/login'; 
  };

  const checkAppState = async () => {
    // Função antiga do Base44 mantida vazia para não quebrar componentes que a chamavam
    setIsLoadingPublicSettings(false);
  };

  const checkUserAuth = async () => {
    // Função antiga simulada usando o estado atual do Supabase
    const { data: { session } } = await supabase.auth.getSession();
    return !!session?.user;
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      isAuthenticated, 
      isLoadingAuth,
      isLoadingPublicSettings,
      authError,
      appPublicSettings,
      authChecked,
      logout,
      navigateToLogin,
      checkUserAuth,
      checkAppState
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};
