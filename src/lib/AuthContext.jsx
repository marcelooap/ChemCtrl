import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState(null);

  useEffect(() => {
    initializeAuth();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setIsAuthenticated(!!session);
      setAuthChecked(true);
      setIsLoadingAuth(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const initializeAuth = async () => {
    try {
      setIsLoadingAuth(true);
      setAuthError(null);

      const {
        data: { session }
      } = await supabase.auth.getSession();

      setSession(session);
      setUser(session?.user ?? null);
      setIsAuthenticated(!!session);
    } catch (error) {
      console.error(error);

      setAuthError({
        type: "auth_error",
        message: error.message
      });

      setUser(null);
      setSession(null);
      setIsAuthenticated(false);
    } finally {
      setAuthChecked(true);
      setIsLoadingAuth(false);
    }
  };

  const checkUserAuth = async () => {
    try {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      setUser(user);
      setIsAuthenticated(!!user);

      return user;
    } catch (error) {
      console.error(error);

      setUser(null);
      setIsAuthenticated(false);

      return null;
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();

    setUser(null);
    setSession(null);
    setIsAuthenticated(false);
  };

  const navigateToLogin = () => {
    window.location.href = "/login";
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isAuthenticated,
        isLoadingAuth,
        authChecked,
        authError,
        checkUserAuth,
        logout,
        navigateToLogin
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth deve ser usado dentro de AuthProvider");
  }

  return context;
};
