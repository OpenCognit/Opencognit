import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiUnternehmen, apiMemberships, type Unternehmen, type Mitgliedschaft } from '../api/client';

interface CompanyContextType {
  unternehmen: Unternehmen[];
  aktivesUnternehmen: Unternehmen | null;
  setAktivesUnternehmenId: (id: string) => void;
  reload: () => void;
  loading: boolean;
  unternehmenListe: Unternehmen[];
  wechselUnternehmen: (id: string) => void;
  mitgliedschaften: Mitgliedschaft[];
  aktiveRolle: string | null;
}

const CompanyContext = createContext<CompanyContextType>({
  unternehmen: [],
  aktivesUnternehmen: null,
  setAktivesUnternehmenId: () => {},
  reload: () => {},
  loading: true,
  unternehmenListe: [],
  wechselUnternehmen: () => {},
  mitgliedschaften: [],
  aktiveRolle: null,
});

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [unternehmen, setUnternehmen] = useState<Unternehmen[]>([]);
  const [mitgliedschaften, setMitgliedschaften] = useState<Mitgliedschaft[]>([]);
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
      const [data, memberships] = await Promise.all([
        apiUnternehmen.liste(),
        apiMemberships.meine().catch(() => [] as Mitgliedschaft[]),
      ]);
      setUnternehmen(data);
      setMitgliedschaften(memberships);
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
  const aktiveRolle = mitgliedschaften.find(m => m.companyId === aktivesUnternehmenId)?.role || null;

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
      mitgliedschaften,
      aktiveRolle,
    }}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}
