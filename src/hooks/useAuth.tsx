import React, { createContext, useContext, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authClient } from '../lib/auth';
import { apiAuth, type Benutzer } from '../api/client';
import { queryKeys } from '../lib/queryKeys';

interface AuthContextType {
  benutzer: Benutzer | null;
  istAngemeldet: boolean;
  laden: boolean;
  anmelden: (email: string, passwort: string) => Promise<void>;
  registrieren: (name: string, email: string, passwort: string) => Promise<void>;
  abmelden: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [benutzer, setBenutzer] = useState<Benutzer | null>(null);
  const [laden, setLaden] = useState(true);

  // Session laden — try BetterAuth first, then JWT fallback
  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      setLaden(true);
      try {
        // 1. Try BetterAuth session
        const { data: session, error } = await authClient.getSession();
        if (!cancelled && session?.user) {
          setBenutzer({
            id: session.user.id,
            name: session.user.name || session.user.email,
            email: session.user.email,
            rolle: (session.user as any).role || 'mitglied',
          });
          setLaden(false);
          return;
        }
      } catch {
        // BetterAuth failed — try JWT fallback
      }

      // 2. JWT fallback (legacy tokens during migration)
      try {
        const token = localStorage.getItem('opencognit_token');
        if (token && !cancelled) {
          const u = await apiAuth.ich();
          if (!cancelled) setBenutzer(u);
        }
      } catch {
        localStorage.removeItem('opencognit_token');
      } finally {
        if (!cancelled) setLaden(false);
      }
    }

    loadSession();
    return () => { cancelled = true; };
  }, []);

  const anmelden = async (email: string, passwort: string) => {
    const { data, error } = await authClient.signIn.email({
      email,
      password: passwort,
    });
    if (error) throw new Error(error.message || 'Anmeldung fehlgeschlagen');
    if (data?.user) {
      const u: Benutzer = {
        id: data.user.id,
        name: data.user.name || data.user.email,
        email: data.user.email,
        rolle: (data.user as any).role || 'mitglied',
      };
      setBenutzer(u);
      queryClient.invalidateQueries({ queryKey: queryKeys.system.status });
    }
  };

  const registrieren = async (name: string, email: string, passwort: string) => {
    const { data, error } = await authClient.signUp.email({
      name,
      email,
      password: passwort,
    });
    if (error) throw new Error(error.message || 'Registrierung fehlgeschlagen');
    if (data?.user) {
      const u: Benutzer = {
        id: data.user.id,
        name: data.user.name || data.user.email,
        email: data.user.email,
        rolle: (data.user as any).role || 'mitglied',
      };
      setBenutzer(u);
      queryClient.invalidateQueries({ queryKey: queryKeys.system.status });
    }
  };

  const abmelden = async () => {
    await authClient.signOut();
    localStorage.removeItem('opencognit_token');
    setBenutzer(null);
    queryClient.clear();
  };

  return (
    <AuthContext.Provider value={{
      benutzer: benutzer ?? null,
      istAngemeldet: !!benutzer,
      laden,
      anmelden,
      registrieren,
      abmelden,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth muss innerhalb von AuthProvider verwendet werden');
  return ctx;
}
