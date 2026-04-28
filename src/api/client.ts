// OpenCognit API Client — verbindet das UI mit dem Express-Backend

const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('opencognit_token');
}

export async function request<T>(path: string, options?: RequestInit & { showToast?: boolean }): Promise<T> {
  const token = getToken();
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
      ...options,
    });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      throw new ApiError(res.status, errorBody.error || `HTTP ${res.status}`, errorBody);
    }

    return res.json();
  } catch (error) {
    // Re-throw for components to handle
    throw error;
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: any,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ===== Auth Types =====
export interface Benutzer {
  id: string;
  name: string;
  email: string;
  rolle: string;
}

export interface AuthAntwort {
  token: string;
  benutzer: Benutzer;
}

// ===== Types =====
export interface Unternehmen {
  id: string;
  name: string;
  beschreibung: string | null;
  ziel: string | null;
  status: 'active' | 'paused' | 'archived';
  erstelltAm: string;
  aktualisiertAm: string;
}

export interface Experte {
  id: string;
  unternehmenId: string;
  name: string;
  rolle: string;
  titel: string | null;
  status: 'active' | 'paused' | 'idle' | 'running' | 'error' | 'terminated';
  reportsTo: string | null;
  faehigkeiten: string | null;
  verbindungsTyp: 'claude' | 'anthropic' | 'openai' | 'openrouter' | 'google' | 'moonshot' | 'poe' | 'ollama' | 'ollama_cloud' | 'codex' | 'codex-cli' | 'gemini-cli' | 'kimi-cli' | 'cursor' | 'http' | 'bash' | 'ceo' | 'custom' | 'claude-code' | 'openclaw';
  verbindungsConfig: string | null;
  avatar: string | null;
  avatarFarbe: string;
  budgetMonatCent: number;
  verbrauchtMonatCent: number;
  letzterZyklus: string | null;
  zyklusIntervallSek: number | null;
  zyklusAktiv: boolean | null;
  systemPrompt?: string | null;
  advisorId?: string | null;
  advisorStrategy?: 'none' | 'planning' | 'native' | null;
  advisorConfig?: string | null;
  isOrchestrator?: boolean;
  nachrichtenCount?: number;
  erstelltAm: string;
  aktualisiertAm: string;
}

export interface Aufgabe {
  id: string;
  unternehmenId: string;
  titel: string;
  beschreibung: string | null;
  status: 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'blocked' | 'cancelled';
  prioritaet: 'critical' | 'high' | 'medium' | 'low';
  zugewiesenAn: string | null;
  erstelltVon: string | null;
  parentId: string | null;
  projektId: string | null;
  zielId: string | null;
  // Issue-Execution-Lock
  executionRunId: string | null;
  executionAgentNameKey: string | null;
  executionLockedAt: string | null;
  // Maximizer Mode
  isMaximizerMode: boolean;
  // Dependencies
  blockedBy: string | null;
  dueDate: string | null;
  gestartetAm: string | null;
  abgeschlossenAm: string | null;
  erstelltAm: string;
  aktualisiertAm: string;
}

export interface Kommentar {
  id: string;
  unternehmenId: string;
  aufgabeId: string;
  autorExpertId: string | null;
  autorTyp: 'agent' | 'board';
  inhalt: string;
  erstelltAm: string;
}

export interface Genehmigung {
  id: string;
  // English (current server response)
  type?: 'hire_expert' | 'approve_strategy' | 'budget_change' | 'agent_action';
  title?: string;
  description?: string | null;
  requestedBy?: string | null;
  decisionNote?: string | null;
  decidedAt?: string | null;
  createdAt?: string;
  companyId?: string;
  // Legacy German aliases (kept for backward-compat during rename)
  unternehmenId?: string;
  typ?: 'hire_expert' | 'approve_strategy' | 'budget_change' | 'agent_action';
  titel?: string;
  beschreibung?: string | null;
  angefordertVon?: string | null;
  entscheidungsnotiz?: string | null;
  entschiedenAm?: string | null;
  erstelltAm?: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  payload: Record<string, any> | null;
}

export interface Aktivitaet {
  id: string;
  unternehmenId: string;
  akteurTyp: 'agent' | 'board' | 'system';
  akteurId: string;
  akteurName: string | null;
  aktion: string;
  entitaetTyp: string;
  entitaetId: string;
  details: string | null;
  erstelltAm: string;
}

export interface Projekt {
  id: string;
  unternehmenId: string;
  name: string;
  beschreibung: string | null;
  status: 'aktiv' | 'pausiert' | 'abgeschlossen' | 'archiviert';
  prioritaet: 'critical' | 'high' | 'medium' | 'low';
  zielId: string | null;
  eigentuemerId: string | null;
  farbe: string;
  deadline: string | null;
  fortschritt: number;
  workDir: string | null;
  erstelltAm: string;
  aktualisiertAm: string;
}

export interface AgentPermissions {
  id: string;
  expertId: string;
  darfAufgabenErstellen: boolean;
  darfAufgabenZuweisen: boolean;
  darfGenehmigungAnfordern: boolean;
  darfGenehmigungEntscheiden: boolean;
  darfExpertenAnwerben: boolean;
  budgetLimitCent: number | null;
  erlaubtePfade: string | null;
  erlaubteDomains: string | null;
}

export interface DashboardData {
  unternehmen: Unternehmen;
  experten: { gesamt: number; aktiv: number; running: number; paused: number; error: number };
  aufgaben: { gesamt: number; offen: number; inBearbeitung: number; erledigt: number; blockiert: number; completedPerDay: number[] };
  kosten: { gesamtVerbraucht: number; gesamtBudget: number; prozent: number };
  pendingApprovals: number;
  topExperten: Experte[];
  letzteAktivitaet: Aktivitaet[];
}

export interface KostenZusammenfassung {
  gesamtVerbraucht: number;
  gesamtBudget: number;
  gesamtProzent: number;
  proExperte: Array<{
    id: string; name: string; titel: string | null; avatar: string | null;
    avatarFarbe: string; verbindungsTyp: string;
    verbrauchtMonatCent: number; budgetMonatCent: number; prozent: number;
  }>;
}

// ===== Auth API =====
export const apiAuth = {
  anmelden: (email: string, passwort: string) =>
    request<AuthAntwort>('/auth/anmelden', { method: 'POST', body: JSON.stringify({ email, passwort }) }),
  registrieren: (name: string, email: string, passwort: string) =>
    request<AuthAntwort>('/auth/registrieren', { method: 'POST', body: JSON.stringify({ name, email, passwort }) }),
  ich: () => request<Benutzer>('/auth/ich'),
};

// ===== API Functions =====

// Unternehmen
export const apiUnternehmen = {
  liste: () => request<Unternehmen[]>('/unternehmen'),
  details: (id: string) => request<Unternehmen>(`/unternehmen/${id}`),
  erstellen: (data: { name: string; beschreibung?: string; ziel?: string }) =>
    request<Unternehmen>('/unternehmen', { method: 'POST', body: JSON.stringify(data) }),
  aktualisieren: (id: string, data: Partial<Unternehmen>) =>
    request<Unternehmen>(`/unternehmen/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  loeschen: (id: string) =>
    request<{ success: boolean }>(`/unternehmen/${id}`, { method: 'DELETE' }),
};

// Experten
export const apiExperten = {
  liste: (unternehmenId: string) => request<Experte[]>(`/unternehmen/${unternehmenId}/experten`),
  details: (id: string) => request<Experte>(`/experten/${id}`),
  erstellen: (unternehmenId: string, data: Partial<Experte>) =>
    request<Experte>(`/unternehmen/${unternehmenId}/experten`, { method: 'POST', body: JSON.stringify(data) }),
  aktualisieren: (id: string, data: Partial<Experte>) =>
    request<Experte>(`/mitarbeiter/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  pausieren: (id: string) =>
    request<{ success: boolean }>(`/mitarbeiter/${id}/pausieren`, { method: 'POST' }),
  fortsetzen: (id: string) =>
    request<{ success: boolean }>(`/mitarbeiter/${id}/fortsetzen`, { method: 'POST' }),
  loeschen: (id: string) =>
    request<{ success: boolean }>(`/mitarbeiter/${id}`, { method: 'DELETE' }),
  aktivitaet: (id: string, limit?: number) =>
    request<Aktivitaet[]>(`/mitarbeiter/${id}/aktivitaet${limit ? `?limit=${limit}` : ''}`),
};

// Aufgaben
export const apiAufgaben = {
  liste: (unternehmenId: string) => request<Aufgabe[]>(`/unternehmen/${unternehmenId}/aufgaben`),
  details: (id: string) => request<Aufgabe>(`/aufgaben/${id}`),
  erstellen: (unternehmenId: string, data: Partial<Aufgabe>) =>
    request<Aufgabe>(`/unternehmen/${unternehmenId}/aufgaben`, { method: 'POST', body: JSON.stringify(data) }),
  aktualisieren: (id: string, data: Partial<Aufgabe>) =>
    request<Aufgabe>(`/aufgaben/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  checkout: (id: string, expertId: string) =>
    request<Aufgabe>(`/aufgaben/${id}/checkout`, { method: 'POST', body: JSON.stringify({ expertId }) }),
  kommentare: (id: string) => request<Kommentar[]>(`/aufgaben/${id}/kommentare`),
  kommentieren: (id: string, inhalt: string, autorTyp?: string) =>
    request<Kommentar>(`/aufgaben/${id}/kommentare`, { method: 'POST', body: JSON.stringify({ inhalt, autorTyp }) }),
};

// Genehmigungen
export const apiGenehmigungen = {
  liste: (unternehmenId: string) => request<Genehmigung[]>(`/unternehmen/${unternehmenId}/genehmigungen`),
  genehmigen: (id: string, notiz?: string) =>
    request<Genehmigung>(`/genehmigungen/${id}/genehmigen`, { method: 'POST', body: JSON.stringify({ notiz }) }),
  ablehnen: (id: string, notiz?: string) =>
    request<Genehmigung>(`/genehmigungen/${id}/ablehnen`, { method: 'POST', body: JSON.stringify({ notiz }) }),
};

// Dashboard
export const apiDashboard = {
  laden: (unternehmenId: string) => request<DashboardData>(`/unternehmen/${unternehmenId}/dashboard`),
};

// Kosten
export interface ProviderKosten {
  anbieter: string;
  kosten: number;
  tokens: number;
  buchungen: number;
}
export interface TimelineTag {
  datum: string;
  kostenCent: number;
}
export const apiKosten = {
  zusammenfassung: (unternehmenId: string) => request<KostenZusammenfassung>(`/unternehmen/${unternehmenId}/kosten/zusammenfassung`),
  nachProvider: (unternehmenId: string) => request<ProviderKosten[]>(`/unternehmen/${unternehmenId}/kosten/nach-provider`),
  timeline: (unternehmenId: string, tage?: number) => request<TimelineTag[]>(`/unternehmen/${unternehmenId}/kosten/timeline${tage ? `?tage=${tage}` : ''}`),
};

// Aktivität
export const apiAktivitaet = {
  liste: (unternehmenId: string, limit?: number) =>
    request<Aktivitaet[]>(`/unternehmen/${unternehmenId}/aktivitaet${limit ? `?limit=${limit}` : ''}`),
};

// Einstellungen
export const apiEinstellungen = {
  laden: () => request<Record<string, string>>('/einstellungen'),
  setzen: (key: string, wert: string) =>
    request<{ schluessel: string; wert: string }>(`/einstellungen/${key}`, { method: 'PUT', body: JSON.stringify({ wert }) }),
};

// Projekte
export const apiProjekte = {
  liste: (unternehmenId: string) => request<Projekt[]>(`/unternehmen/${unternehmenId}/projekte`),
  details: (id: string) => request<Projekt>(`/projekte/${id}`),
  erstellen: (unternehmenId: string, data: Partial<Projekt>) =>
    request<Projekt>(`/unternehmen/${unternehmenId}/projekte`, { method: 'POST', body: JSON.stringify(data) }),
  aktualisieren: (id: string, data: Partial<Projekt>) =>
    request<Projekt>(`/projekte/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  loeschen: (id: string) =>
    request<{ success: boolean }>(`/projekte/${id}`, { method: 'DELETE' }),
  fortschrittAktualisieren: (id: string) =>
    request<Projekt>(`/projekte/${id}/fortschritt-aktualisieren`, { method: 'POST' }),
};

// Agent Permissions
export const apiPermissions = {
  laden: (expertId: string) => request<AgentPermissions>(`/mitarbeiter/${expertId}/permissions`),
  speichern: (expertId: string, data: Partial<AgentPermissions>) =>
    request<AgentPermissions>(`/mitarbeiter/${expertId}/permissions`, { method: 'PUT', body: JSON.stringify(data) }),
};

// Health
export const apiHealth = {
  check: () => request<{ status: string; version: string; name: string }>('/health'),
};

// ─── Neue APIs (Task-Manager/Deep Integration) ─────────────────────

// Budget Policies
export interface BudgetPolicy {
  id: string;
  unternehmenId: string;
  scope: 'company' | 'project' | 'agent';
  scopeId: string;
  limitCent: number;
  fenster: 'monatlich' | 'lifetime';
  warnProzent: number;
  hardStop: boolean;
  aktiv: boolean;
  erstelltAm: string;
  aktualisiertAm: string;
  status?: { prozent: number; verbrauchtCent: number; status: 'ok' | 'warnung' | 'hard_stop' } | null;
}

export interface BudgetIncident {
  id: string;
  policyId: string;
  typ: 'warnung' | 'hard_stop';
  beobachteterBetrag: number;
  limitBetrag: number;
  status: 'offen' | 'behoben' | 'ignoriert';
  erstelltAm: string;
}

export const apiBudget = {
  policies: (uid: string) => request<BudgetPolicy[]>(`/unternehmen/${uid}/budget-policies`),
  createPolicy: (uid: string, data: Partial<BudgetPolicy>) =>
    request<{ id: string }>(`/unternehmen/${uid}/budget-policies`, { method: 'POST', body: JSON.stringify(data) }),
  incidents: (uid: string) => request<BudgetIncident[]>(`/unternehmen/${uid}/budget-incidents`),
  forecast: (uid: string) => request<{ forecasts: BudgetForecast[] }>(`/unternehmen/${uid}/budget/forecast`),
};

export interface BudgetForecast {
  policyId: string;
  scope: 'company' | 'project' | 'agent';
  scopeId: string;
  scopeLabel: string;
  limitCent: number;
  spentCent: number;
  percentUsed: number;
  fenster: 'monatlich' | 'lifetime';
  burnRateCentPerDay: number;
  daysObserved: number;
  projectedHitAt: string | null;
  daysToHit: number | null;
  willExceedThisWindow: boolean;
  warnProzent: number;
  triggered: 'none' | 'warn' | 'hard';
}

// Company Portability
export const apiPortability = {
  exportieren: (uid: string) => request<any>(`/unternehmen/${uid}/export`),
  importPreview: (uid: string, manifest: any) =>
    request<{ unternehmenName: string; agentenCount: number; aufgabenCount: number; skillsCount: number; collisions: Array<{ name: string; typ: string }> }>(
      `/unternehmen/${uid}/import/preview`, { method: 'POST', body: JSON.stringify(manifest) }),
  importieren: (uid: string, manifest: any, options: any) =>
    request<{ success: boolean; agentsImported: number; tasksImported: number; errors: string[] }>(
      `/unternehmen/${uid}/import`, { method: 'POST', body: JSON.stringify({ manifest, options }) }),
};

// Issue Dependencies
export const apiDependencies = {
  blocker: (aufgabeId: string) => request<Array<{ id: string; titel: string; status: string }>>(`/aufgaben/${aufgabeId}/blocker`),
  blockiert: (aufgabeId: string) => request<Array<{ id: string; titel: string; status: string }>>(`/aufgaben/${aufgabeId}/blockiert`),
  hinzufuegen: (aufgabeId: string, blockerId: string) =>
    request<{ success: boolean }>(`/aufgaben/${aufgabeId}/blocker`, { method: 'POST', body: JSON.stringify({ blockerId }) }),
  entfernen: (aufgabeId: string, blockerId: string) =>
    request<{ ok: boolean }>(`/aufgaben/${aufgabeId}/blocker/${blockerId}`, { method: 'DELETE' }),
};

// Memberships & Invites
export interface Mitgliedschaft {
  companyId: string;
  role: string;
  joinedAt: string | null;
  companyName: string | null;
  companyStatus: string | null;
}
export interface Mitglied {
  userId: string;
  name: string | null;
  email: string | null;
  role: string;
  joinedAt: string | null;
}
export const apiMemberships = {
  meine: () => request<Mitgliedschaft[]>('/user/memberships'),
  mitglieder: (companyId: string) => request<Mitglied[]>(`/companies/${companyId}/members`),
  einladen: (companyId: string, email: string, role?: string) =>
    request<{ token: string; email: string; role: string; message: string }>(`/companies/${companyId}/invites`, { method: 'POST', body: JSON.stringify({ email, role: role || 'member' }) }),
  akzeptieren: (token: string) =>
    request<{ ok: boolean; companyId: string; role: string }>(`/invites/${token}/accept`, { method: 'POST' }),
  entfernen: (companyId: string, userId: string) =>
    request<{ ok: boolean }>(`/companies/${companyId}/members/${userId}`, { method: 'DELETE' }),
};

// Channels
export const apiChannels = {
  status: () => request<Array<{ id: string; name: string; icon: string; status: { connected: boolean; lastActivity?: string; error?: string } }>>('/channels/status'),
};

// Device Nodes
export const apiNodes = {
  liste: () => request<Array<{ id: string; capabilities: string[]; registeredAt: string; lastSeen: string }>>('/nodes/status'),
};
