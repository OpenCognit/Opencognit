import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiUnternehmen, type Unternehmen } from '../api/client';

interface CompanyContextType {
  unternehmen: Unternehmen[];
  aktivesUnternehmen: Unternehmen | null;
  setAktivesUnternehmenId: (id: string) => void;
  reload: () => void;
  loading: boolean;
  unternehmenListe: Unternehmen[];
  wechselUnternehmen: (id: string) => void;
}

const CompanyContext = createContext<CompanyContextType>({
  unternehmen: [],
  aktivesUnternehmen: null,
  setAktivesUnternehmenId: () => {},
  reload: () => {},
  loading: true,
  unternehmenListe: [],
  wechselUnternehmen: () => {},
});

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [unternehmen, setUnternehmen] = useState<Unternehmen[]>([]);
  const [aktivesUnternehmenId, setAktivesUnternehmenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      setLoading(true);
      const data = await apiUnternehmen.liste();
      setUnternehmen(data);
      // Auto-select first active company
      if (!aktivesUnternehmenId && data.length > 0) {
        const active = data.find(f => f.status === 'active') || data[0];
        setAktivesUnternehmenId(active.id);
      }
    } catch (e) {
      console.error('Fehler beim Laden der Unternehmen:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const aktivesUnternehmen = unternehmen.find(f => f.id === aktivesUnternehmenId) || null;

  const wechselUnternehmen = (id: string) => {
    setAktivesUnternehmenId(id);
  };

  return (
    <CompanyContext.Provider value={{
      unternehmen,
      aktivesUnternehmen,
      setAktivesUnternehmenId,
      reload: load,
      loading,
      unternehmenListe: unternehmen,
      wechselUnternehmen,
    }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}
