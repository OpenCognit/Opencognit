import React, { createContext, useContext } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiAuth, type Benutzer } from '../api/client';
import { queryKeys } from '../lib/queryKeys';

interface AuthContextType {
  benutzer: Benutzer | null;
  istAngemeldet: boolean;
  laden: boolean;
  anmelden: (email: string, passwort: string) => Promise<void>;
  registrieren: (name: string, email: string, passwort: string) => Promise<void>;
  abmelden: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // Session laden
  const { data: benutzer, isLoading: laden } = useQuery<Benutzer | null>({
    queryKey: queryKeys.auth.session,
    queryFn: async () => {
      const token = localStorage.getItem('opencognit_token');
      if (!token) return null;
      try {
        return await apiAuth.ich();
      } catch {
        localStorage.removeItem('opencognit_token');
        return null;
      }
    },
    retry: false,
  });

  // Login Mutation
  const anmeldenMutation = useMutation({
    mutationFn: async ({ email, passwort }: { email: string; passwort: string }) => {
      const antwort = await apiAuth.anmelden(email, passwort);
      localStorage.setItem('opencognit_token', antwort.token);
      return antwort.benutzer;
    },
    onSuccess: (benutzer) => {
      queryClient.setQueryData(queryKeys.auth.session, benutzer);
      queryClient.invalidateQueries({ queryKey: queryKeys.system.status });
    },
  });

  // Registrieren Mutation
  const registrierenMutation = useMutation({
    mutationFn: async ({ name, email, passwort }: { name: string; email: string; passwort: string }) => {
      const antwort = await apiAuth.registrieren(name, email, passwort);
      localStorage.setItem('opencognit_token', antwort.token);
      return antwort.benutzer;
    },
    onSuccess: (benutzer) => {
      queryClient.setQueryData(queryKeys.auth.session, benutzer);
      queryClient.invalidateQueries({ queryKey: queryKeys.system.status });
    },
  });

  const anmelden = async (email: string, passwort: string) => {
    await anmeldenMutation.mutateAsync({ email, passwort });
  };

  const registrieren = async (name: string, email: string, passwort: string) => {
    await registrierenMutation.mutateAsync({ name, email, passwort });
  };

  const abmelden = () => {
    localStorage.removeItem('opencognit_token');
    queryClient.setQueryData(queryKeys.auth.session, null);
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
