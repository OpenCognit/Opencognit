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
  const [aktivesUnternehmenId, _setAktivesUnternehmenId] = useState<string | null>(
    () => localStorage.getItem('aktives_unternehmen_id'),
  );
  const [loading, setLoading] = useState(true);

  const setAktivesUnternehmenId = (id: string) => {
    if (id) {
      localStorage.setItem('aktives_unternehmen_id', id);
    } else {
      localStorage.removeItem('aktives_unternehmen_id');
    }
    _setAktivesUnternehmenId(id || null);
  };

  const load = async () => {
    try {
      setLoading(true);
      const data = await apiUnternehmen.liste();
      setUnternehmen(data);
      // Auto-select first active company only if nothing is persisted
      const persisted = localStorage.getItem('aktives_unternehmen_id');
      const stillExists = persisted && data.some(f => f.id === persisted);
      if (!stillExists && data.length > 0) {
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

  const wechselUnternehmen = setAktivesUnternehmenId;

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
