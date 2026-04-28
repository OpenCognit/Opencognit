import { useState, useEffect } from 'react';
import {
  Sparkles, ChevronDown, ChevronUp, Terminal, Shield, Wrench,
  UserCheck, BookOpen, CheckCircle2, Globe, Search, ArrowRight, ArrowLeft
} from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { apiPermissions, apiExperten, type Experte as ExperteType } from '../api/client';
import { Select } from './Select';
import { useApi } from '../hooks/useApi';
import { useI18n } from '../i18n';
import { useToast } from './ToastProvider';
import {
  ModalShell, FieldLabel, inputStyle, inputFocus, textareaStyle,
  btnPrimary, btnPrimaryHover, btnSecondary, btnSecondaryHover,
  btnDanger, btnDangerHover, ErrorBox
} from './ModalShell';

function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('opencognit_token');
  const body = (options as any).body;
  if (body && typeof body === 'string') {
    try {
      console.log('[authFetch] POST →', url, JSON.parse(body));
    } catch {}
  }
  return fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  }).then(async res => {
    if (!res.ok) {
      const clone = res.clone();
      try {
        const err = await clone.json();
        console.error('[authFetch] Error', res.status, err);
      } catch {
        console.error('[authFetch] Error', res.status, await res.clone().text());
      }
    }
    return res;
  });
}

interface Model {
  id: string;
  name: string;
  pricing: any;
  context_length: number;
}

// ── OpenRouter Model Selector mit Suche ──────────────────────────────────────

function OpenRouterModelSelect({ models, value, onChange, loading, de }: {
  models: Model[]; value: string; onChange: (v: string) => void; loading: boolean; de: boolean;
}) {
  const [search, setSearch] = useState('');

  const allOptions = [
    { id: 'openrouter/auto', name: '🤖 Auto Router (empfohlen)', pricing: null },
    ...models.filter(m => m.id !== 'openrouter/auto'),
  ];

  const q = search.toLowerCase();
  const filtered = q
    ? allOptions.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
    : allOptions;

  return (
    <div style={{ backgroundColor: 'rgba(197,160,89,0.05)', border: '1px solid rgba(197,160,89,0.1)', borderRadius: 0, padding: '1rem' }}>
      <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', color: 'var(--color-text-tertiary)' }}>
        {de ? 'Modell' : 'Model'}
        {loading && <span style={{ color: '#c5a059', fontSize: 10 }}>{de ? 'Lade...' : 'Loading...'}</span>}
      </label>

      {/* Suchfeld */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '5px 8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0 }}>
        <Search size={11} style={{ color: '#475569', flexShrink: 0 }} />
        <input
          type="text"
          placeholder={de ? 'Suchen... (llama, qwen, claude...)' : 'Search... (llama, qwen, claude...)'}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--color-text-primary)', fontSize: 12 }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 0, lineHeight: 1 }}>
            <span style={{ fontSize: 11 }}>✕</span>
          </button>
        )}
      </div>

      {/* Natives select */}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        size={8}
        style={{
          width: '100%',
          background: 'rgba(8,8,18,0.9)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 0,
          color: 'var(--color-text-primary)',
          fontSize: 12,
          padding: '2px 0',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        {filtered.slice(0, 200).map(m => (
          <option key={m.id} value={m.id} style={{ background: '#0c0c18', padding: '4px 8px' }}>
            {m.name}
          </option>
        ))}
        {filtered.length > 200 && (
          <option disabled value="">── {filtered.length - 200} {de ? 'weitere — Suche verfeinern' : 'more — refine search'} ──</option>
        )}
      </select>

      {value && value !== 'openrouter/auto' && (
        <div style={{ fontSize: 9, color: '#334155', marginTop: 4, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </div>
      )}
      <div style={{ fontSize: 9, color: '#334155', marginTop: 3 }}>
        {filtered.length} {de ? 'Modelle verfügbar' : 'models available'}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────

export function ExpertModal({ expert, onClose, onSaved, isOpen = true }: {
  expert?: ExperteType, onClose: () => void, onSaved: () => void, isOpen?: boolean
}) {
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const de = language === 'de';
  const toastCtx = useToast();

  // ── Wizard state (create mode only) ──
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);

  // ── Form fields ──
  const [name, setName] = useState('');
  const [rolle, setRolle] = useState('Strategie & Planung');
  const [verbindung, setVerbindung] = useState('openrouter');
  const [modell, setModell] = useState('openrouter/auto');
  const [faehigkeiten, setFaehigkeiten] = useState('Analyse, Strategie, Team-Management');
  const [budget, setBudget] = useState(500);

  const [activeTab, setActiveTab] = useState<'allgemein' | 'skills' | 'rechte'>('allgemein');

  const [reportsTo, setReportsTo] = useState('');
  const [autonomyLevel, setAutonomyLevel] = useState('copilot');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [zyklusAktiv, setZyklusAktiv] = useState(false);
  const [advisorId, setAdvisorId] = useState('');
  const [advisorStrategy, setAdvisorStrategy] = useState<'none' | 'planning' | 'native'>('none');
  const [baseUrl, setBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const [isOrchestrator, setIsOrchestrator] = useState(false);
  const [extendedThinking, setExtendedThinking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Permissions
  const [permAufgabenErstellen, setPermAufgabenErstellen] = useState(true);
  const [permAufgabenZuweisen, setPermAufgabenZuweisen] = useState(false);
  const [permGenehmigungAnfordern, setPermGenehmigungAnfordern] = useState(true);
  const [permGenehmigungEntscheiden, setPermGenehmigungEntscheiden] = useState(false);
  const [permExpertenAnwerben, setPermExpertenAnwerben] = useState(false);

  // Data for dropdowns
  const { data: alleExperten } = useApi<ExperteType[]>(
    () => apiExperten.liste(aktivesUnternehmen?.id || ''),
    [aktivesUnternehmen?.id]
  );

  // ── Reset wizard when opening in create mode ──
  useEffect(() => {
    if (!expert && isOpen) {
      setWizardStep(1);
    }
  }, [isOpen, expert]);

  // ── Initialize state if editing ──
  useEffect(() => {
    if (expert) {
      setName(expert.name);
      setRolle(expert.rolle || 'Strategie & Planung');
      setVerbindung(expert.verbindungsTyp || 'openrouter');
      setBudget(Math.round(expert.budgetMonatCent / 100));
      setReportsTo(expert.reportsTo || '');
      setFaehigkeiten(expert.faehigkeiten || '');
      setSystemPrompt(expert.systemPrompt || '');
      setZyklusAktiv(expert.zyklusAktiv || false);
      setAdvisorId(expert.advisorId || '');
      setAdvisorStrategy((expert.advisorStrategy as any) || 'none');

      if (expert.verbindungsTyp === 'ceo') {
        setIsOrchestrator(true);
        setVerbindung('openrouter');
      }

      try {
        if (expert.verbindungsConfig) {
          const config = JSON.parse(expert.verbindungsConfig);
          if (config.model) {
            const isFreeModel = config.model.endsWith(':free') || config.model === 'auto:free';
            setModell(isFreeModel ? 'openrouter/auto' : config.model);
          }
          if (expert.verbindungsTyp === 'claude-code' && config.model && config.model.includes('/') && config.model !== 'openrouter/auto') {
            setVerbindung('openrouter');
          }
          if (config.autonomyLevel) setAutonomyLevel(config.autonomyLevel);
          if (config.assignedSkills) setSelectedSkills(config.assignedSkills);
          if (config.baseUrl) setBaseUrl(config.baseUrl);
          if (config.isOrchestrator) setIsOrchestrator(true);
          if (config.extendedThinking === false) setExtendedThinking(false);
        }
      } catch (e) {}

      apiPermissions.laden(expert.id).then(p => {
        setPermAufgabenErstellen(p.darfAufgabenErstellen);
        setPermAufgabenZuweisen(p.darfAufgabenZuweisen);
        setPermGenehmigungAnfordern(p.darfGenehmigungAnfordern);
        setPermGenehmigungEntscheiden(p.darfGenehmigungEntscheiden);
        setPermExpertenAnwerben(p.darfExpertenAnwerben);
      }).catch(() => {});
    } else {
      setName('');
      setRolle('Strategie & Planung');
      setVerbindung('openrouter');
      setModell('openrouter/auto');
      setBudget(500);
      setReportsTo('');
      setAutonomyLevel('copilot');
      setSelectedSkills([]);
      setSystemPrompt('');
      setZyklusAktiv(false);
      setAdvisorId('');
      setAdvisorStrategy('none');
      setBaseUrl('');
      setShowAdvanced(false);
      setShowPermissions(false);
      setIsOrchestrator(false);
      setExtendedThinking(true);
      setPermAufgabenErstellen(true);
      setPermAufgabenZuweisen(false);
      setPermGenehmigungAnfordern(true);
      setPermGenehmigungEntscheiden(false);
      setPermExpertenAnwerben(false);
      setError(null);
    }
  }, [expert]);

  const [skillsLibrary, setSkillsLibrary] = useState<any[]>([]);
  useEffect(() => {
    if (aktivesUnternehmen) {
      authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/skills-library`)
        .then(r => r.json())
        .then(data => setSkillsLibrary(data || []))
        .catch(() => {});
    }
  }, [aktivesUnternehmen?.id]);

  // Reset model to sensible default when connection type changes
  useEffect(() => {
    switch (verbindung) {
      case 'openrouter': setModell('openrouter/auto'); break;
      case 'anthropic': setModell('claude-sonnet-4-6'); break;
      case 'openai': setModell('gpt-4o'); break;
      case 'poe': setModell('GPT-4o'); break;
      case 'ollama': setModell(''); break;
      case 'custom': setModell(''); break;
      default: break;
    }
  }, [verbindung]);

  useEffect(() => {
    if (expert && isOpen) {
      authFetch(`/api/experten/${expert.id}/skills-library`)
        .then(r => r.json())
        .then((data: any[]) => setSelectedSkills(data.map(s => s.id)))
        .catch(() => {});
    }
  }, [expert?.id, isOpen]);

  const [models, setModels] = useState<Model[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<{ id: string; name: string; size?: number }[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);

  const loadOllamaModels = (url?: string) => {
    setLoadingOllamaModels(true);
    const base = url?.trim() || 'http://127.0.0.1:11434';
    authFetch(`/api/ollama/models?baseUrl=${encodeURIComponent(base)}`)
      .then(r => r.json())
      .then(data => { if (data?.models) setOllamaModels(data.models); })
      .catch(() => {})
      .finally(() => setLoadingOllamaModels(false));
  };

  useEffect(() => {
    if (verbindung === 'openrouter') {
      setLoadingModels(true);
      fetch('https://openrouter.ai/api/v1/models')
        .then(r => r.json())
        .then(data => {
          if (data && data.data) {
            const paid = data.data.filter((m: any) => {
              if (m.id.endsWith(':free')) return false;
              const promptCost = parseFloat(m.pricing?.prompt || '0');
              const completionCost = parseFloat(m.pricing?.completion || '0');
              return promptCost > 0 || completionCost > 0;
            });
            const sorted = paid.sort((a: any, b: any) => a.name.localeCompare(b.name));
            setModels(sorted);
          }
          setLoadingModels(false);
        })
        .catch(() => setLoadingModels(false));
    }
    if (verbindung === 'ollama' || verbindung === 'ollama_cloud') {
      loadOllamaModels(baseUrl);
    }
  }, [verbindung]);

  // ── Quick model presets by connection ──
  const getQuickModelOptions = () => {
    switch (verbindung) {
      case 'openrouter':
        return <OpenRouterModelSelect models={models} value={modell} onChange={setModell} loading={loadingModels} de={de} />;
      case 'anthropic':
        return (
          <div style={{ backgroundColor: 'rgba(197,160,89,0.05)', border: '1px solid rgba(197,160,89,0.1)', borderRadius: 0, padding: '1rem' }}>
            <FieldLabel>{de ? 'Claude Modell' : 'Claude Model'}</FieldLabel>
            <select value={modell} onChange={e => setModell(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
              <option value="claude-haiku-4-5-20251001">⚡ Claude Haiku 4.5 — schnell &amp; günstig</option>
              <option value="claude-sonnet-4-6">✨ Claude Sonnet 4.6 — ausgewogen (empfohlen)</option>
              <option value="claude-opus-4-6">🧠 Claude Opus 4.6 — stärkste Reasoning</option>
              <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet-20241022</option>
              <option value="claude-3-5-haiku-20241022">claude-3-5-haiku-20241022</option>
            </select>
          </div>
        );
      case 'openai':
        return (
          <div style={{ backgroundColor: 'rgba(197,160,89,0.05)', border: '1px solid rgba(197,160,89,0.1)', borderRadius: 0, padding: '1rem' }}>
            <FieldLabel>{de ? 'OpenAI Modell' : 'OpenAI Model'}</FieldLabel>
            <select value={modell} onChange={e => setModell(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
              <option value="gpt-4o-mini">⚡ GPT-4o mini — schnell &amp; günstig</option>
              <option value="gpt-4o">✨ GPT-4o — ausgewogen (empfohlen)</option>
              <option value="o4-mini">🧠 o4-mini — Reasoning</option>
              <option value="o3">🔬 o3 — stärkstes Reasoning</option>
              <option value="gpt-4-turbo">gpt-4-turbo</option>
            </select>
          </div>
        );
      case 'ollama':
      case 'ollama_cloud':
        return (
          <div style={{ backgroundColor: 'rgba(197,160,89,0.05)', border: '1px solid rgba(197,160,89,0.1)', borderRadius: 0, padding: '1rem' }}>
            <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', color: 'var(--color-text-tertiary)' }}>
              {de ? 'Modell (Ollama)' : 'Model (Ollama)'}
              <button onClick={() => loadOllamaModels(baseUrl)} disabled={loadingOllamaModels} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: 0 }} title="Modelle aktualisieren">
                {loadingOllamaModels ? '⏳' : '🔄'}
              </button>
            </label>
            {ollamaModels.length > 0 ? (
              <select value={modell} onChange={e => setModell(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                {ollamaModels.map(m => (
                  <option key={m.id} value={m.id}>{m.name}{m.size ? ` (${(m.size / 1e9).toFixed(1)} GB)` : ''}</option>
                ))}
              </select>
            ) : (
              <div style={{ fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.08)', padding: '6px 10px', borderRadius: 0 }}>
                {loadingOllamaModels ? (de ? 'Lade Modelle...' : 'Loading models...') : (de ? '⚠ Ollama nicht erreichbar — URL prüfen' : '⚠ Ollama not reachable — check URL')}
              </div>
            )}
          </div>
        );
      case 'poe':
        return (
          <div style={{ backgroundColor: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.1)', borderRadius: 0, padding: '1rem' }}>
            <FieldLabel>{de ? 'Poe Modell' : 'Poe Model'}</FieldLabel>
            <select value={modell} onChange={e => setModell(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
              <option value="GPT-4o">GPT-4o</option>
              <option value="Claude-3.7-Sonnet">Claude-3.7-Sonnet</option>
              <option value="Claude-3.5-Sonnet">Claude-3.5-Sonnet</option>
              <option value="Claude-3.5-Haiku">Claude-3.5-Haiku</option>
              <option value="Gemini-2.0-Flash">Gemini-2.0-Flash</option>
              <option value="Llama-3.1-405B">Llama-3.1-405B</option>
              <option value="o1">o1</option>
              <option value="o3-mini">o3-mini</option>
              <option value="DeepSeek-R1">DeepSeek-R1</option>
            </select>
            <p style={{ fontSize: '0.6875rem', color: '#71717a', margin: '0.5rem 0 0' }}>
              {de ? 'Poe API Key in den Systemeinstellungen hinterlegen.' : 'Set Poe API Key in system settings.'}
            </p>
          </div>
        );
      case 'custom':
        return (
          <div style={{ backgroundColor: 'rgba(56,189,248,0.05)', border: '1px solid rgba(56,189,248,0.1)', borderRadius: 0, padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Globe size={14} style={{ color: '#c5a059' }} />
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d8' }}>{de ? 'API Base URL (Pflicht)' : 'API Base URL (required)'}</label>
            </div>
            <input className="input" placeholder="https://api.groq.com/openai/v1" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} style={{ ...inputStyle }}
              onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
              onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <div style={{ marginTop: '0.75rem' }}>
              <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d8', display: 'block', marginBottom: '0.375rem' }}>{de ? 'Modell-Name' : 'Model name'}</label>
              <input className="input" placeholder="z.B. llama3-70b-8192" value={modell} onChange={e => setModell(e.target.value)} style={{ ...inputStyle }}
                onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
                onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
          </div>
        );
      default:
        return (
          <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 0 }}>
            <p style={{ fontSize: '0.75rem', color: '#71717a', margin: 0 }}>
              {de ? 'CLI-Adapter verwenden das konfigurierte CLI-Binary — kein Modell erforderlich.' : 'CLI adapters use the configured CLI binary — no model selection needed.'}
            </p>
          </div>
        );
    }
  };

  const handleSave = async () => {
    if (!aktivesUnternehmen) {
      setError(de ? 'Kein Unternehmen ausgewählt' : 'No company selected');
      return;
    }
    if (!name.trim()) {
      setError(de ? 'Name ist erforderlich' : 'Name is required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        rolle,
        titel: rolle,
        faehigkeiten,
        verbindungsTyp: verbindung,
        verbindungsConfig: JSON.stringify({
          ...(verbindung !== 'claude-code' && verbindung !== 'gemini-cli' && verbindung !== 'codex-cli' && verbindung !== 'kimi-cli' ? { model: modell } : {}),
          autonomyLevel,
          assignedSkills: selectedSkills,
          baseUrl: baseUrl.trim() || undefined,
          isOrchestrator,
          ...(isOrchestrator && !extendedThinking ? { extendedThinking: false } : {}),
        }),
        isOrchestrator,
        reportsTo: reportsTo || null,
        budgetMonatCent: budget * 100,
        zyklusIntervallSek: 120,
        zyklusAktiv,
        systemPrompt: systemPrompt.trim() || null,
        advisorId: advisorId || null,
        advisorStrategy: advisorStrategy,
      };

      let res;
      if (expert) {
        res = await authFetch(`/api/mitarbeiter/${expert.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/experten`, { method: 'POST', body: JSON.stringify(body) });
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setError(errBody.error || `Fehler ${res.status}`);
        return;
      }

      const savedExpert = await res.json();
      const targetId = expert ? expert.id : savedExpert.id;

      await apiPermissions.speichern(targetId, {
        darfAufgabenErstellen: permAufgabenErstellen,
        darfAufgabenZuweisen: permAufgabenZuweisen,
        darfGenehmigungAnfordern: permGenehmigungAnfordern,
        darfGenehmigungEntscheiden: permGenehmigungEntscheiden,
        darfExpertenAnwerben: permExpertenAnwerben,
      }).catch(() => {});

      try {
        const currentRes = await authFetch(`/api/experten/${targetId}/skills-library`);
        if (currentRes.ok) {
          const currentData = await currentRes.json();
          const currentIds = currentData.map((s: any) => s.id);
          const toAdd = selectedSkills.filter(id => !currentIds.includes(id));
          const toRemove = currentIds.filter((id: string) => !selectedSkills.includes(id));
          for (const skillId of toAdd) {
            await authFetch(`/api/experten/${targetId}/skills-library`, { method: 'POST', body: JSON.stringify({ skillId }) });
          }
          for (const skillId of toRemove) {
            await authFetch(`/api/experten/${targetId}/skills-library/${skillId}`, { method: 'DELETE' });
          }
        }
      } catch (e) {}

      toastCtx.success(expert ? (de ? 'Agent gespeichert' : 'Agent saved') : (de ? 'Agent erstellt' : 'Agent created'), name);
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Network error');
      toastCtx.error(de ? 'Fehler beim Speichern' : 'Save failed', (e as any)?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!expert) return;
    const confirmed = window.confirm(de ? `Agent "${expert.name}" wirklich permanent löschen?` : `Really delete agent "${expert.name}" permanently?`);
    if (!confirmed) return;
    setSaving(true);
    try {
      const res = await apiExperten.loeschen(expert.id);
      if (res.success) {
        onSaved();
      } else {
        setError(de ? 'Löschen fehlgeschlagen' : 'Delete failed');
      }
    } catch (e: any) {
      setError(e.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  // ── Create Mode: single clean form ──
  const renderStep1 = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Name */}
      <div>
        <FieldLabel required>{de ? 'Name' : 'Name'}</FieldLabel>
        <input type="text" style={inputStyle} value={name} onChange={e => setName(e.target.value)}
          placeholder={de ? 'z.B. Research Agent' : 'e.g. Research Agent'}
          autoFocus
          onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
          onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
        />
      </div>

      {/* Rolle */}
      <div>
        <FieldLabel required>{de ? 'Rolle' : 'Role'}</FieldLabel>
        <input type="text" style={inputStyle} value={rolle} onChange={e => setRolle(e.target.value)}
          placeholder={de ? 'z.B. Marketing-Lead' : 'e.g. Marketing Lead'}
          onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
          onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
        />
      </div>

      {/* KI-Verbindung */}
      <div>
        <FieldLabel>{de ? 'KI-Verbindung' : 'AI Connection'}</FieldLabel>
        <Select value={verbindung} onChange={setVerbindung} options={[
          { value: 'openrouter', label: 'OpenRouter (empfohlen)' },
          { value: 'anthropic', label: 'Anthropic Claude' },
          { value: 'openai', label: 'OpenAI GPT' },
          { value: 'custom', label: '🔌 Custom API (OpenAI-kompatibel)' },
          { value: 'ollama', label: 'Ollama (Lokal)' },
          { value: 'ollama_cloud', label: '☁️ Ollama (Cloud / Remote)' },
          { value: 'claude-code', label: '🤖 Claude Code CLI' },
          { value: 'gemini-cli', label: '✨ Gemini CLI' },
          { value: 'codex-cli', label: '⚡ Codex CLI' },
          { value: 'kimi-cli', label: '🌙 Kimi CLI' },
          { value: 'poe', label: '🎭 Poe API' },
          { value: 'bash', label: 'Bash Script' },
          { value: 'http', label: 'HTTP' },
        ]} />
      </div>

      {/* Modell — nur für API-Verbindungen */}
      {getQuickModelOptions()}

      {/* Budget */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <div style={{ flex: 1 }}>
          <FieldLabel>{de ? 'Budget €/Monat' : 'Budget €/Month'}</FieldLabel>
          <input type="number" style={inputStyle} value={budget} onChange={e => setBudget(Number(e.target.value))}
            onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
            onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
          />
        </div>
        {/* CEO Toggle */}
        <div style={{ flex: 2 }}>
          <FieldLabel>{de ? 'Orchestrator (CEO)' : 'Orchestrator (CEO)'}</FieldLabel>
          <div
            onClick={() => setIsOrchestrator(!isOrchestrator)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem',
              background: isOrchestrator ? 'rgba(197,160,89,0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isOrchestrator ? 'rgba(197,160,89,0.4)' : 'rgba(255,255,255,0.08)'}`,
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            <div style={{
              width: 36, height: 20, background: isOrchestrator ? '#c5a059' : 'rgba(255,255,255,0.15)',
              position: 'relative', flexShrink: 0,
            }}>
              <div style={{
                position: 'absolute', top: 2, left: isOrchestrator ? 18 : 2,
                width: 16, height: 16, background: '#fff', transition: 'left 0.2s',
              }} />
            </div>
            <span style={{ fontSize: '0.8rem', color: isOrchestrator ? '#c5a059' : '#71717a' }}>
              {isOrchestrator ? (de ? 'Aktiv' : 'Active') : (de ? 'Inaktiv' : 'Inactive')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Wizard Step 2 / Edit Mode Content ──
  const renderAdvancedContent = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '350px' }}>
      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Tab Navigation (only in edit mode or step 2) */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.75rem', marginBottom: '-0.25rem' }}>
        {[
          { id: 'allgemein', label: de ? 'Allgemein' : 'General', icon: <Sparkles size={14} /> },
          { id: 'skills', label: de ? 'Skills & Wissen' : 'Skills & Knowledge', icon: <Wrench size={14} /> },
          { id: 'rechte', label: de ? 'Hierarchie & Rechte' : 'Hierarchy & Rights', icon: <Shield size={14} /> },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as any)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.375rem 0.75rem',
              background: activeTab === t.id ? 'rgba(197, 160, 89, 0.1)' : 'transparent',
              border: 'none', borderRadius: 0,
              color: activeTab === t.id ? '#c5a059' : '#71717a',
              fontSize: '0.8125rem', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'allgemein' && (
        <>
          {/* Row 1: Name & Rolle (shown in edit mode, or step 2 for completeness) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <FieldLabel required>{de ? 'Name' : 'Name'}</FieldLabel>
              <input type="text" style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder={de ? 'z.B. Agent Alpha' : 'e.g. Agent Alpha'}
                onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
                onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
            <div>
              <FieldLabel required>{de ? 'Rolle' : 'Role'}</FieldLabel>
              <input type="text" style={inputStyle} value={rolle} onChange={e => setRolle(e.target.value)} placeholder={de ? 'z.B. Marketing-Lead' : 'e.g. Marketing Lead'}
                onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
                onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
              />
            </div>
          </div>

          {/* CEO MODE TOGGLE */}
          <div
            style={{
              background: isOrchestrator ? 'linear-gradient(135deg, rgba(197, 160, 89, 0.1), rgba(79, 70, 229, 0.1))' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${isOrchestrator ? 'rgba(197, 160, 89, 0.5)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 0, padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              transition: 'all 0.3s ease', cursor: 'pointer',
              boxShadow: isOrchestrator ? '0 8px 32px rgba(197, 160, 89, 0.1)' : 'none'
            }}
            onClick={() => setIsOrchestrator(!isOrchestrator)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: 0, background: isOrchestrator ? 'rgba(197, 160, 89, 0.2)' : 'rgba(255,255,255,0.05)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOrchestrator ? '#c5a059' : '#71717a'
              }}>
                <Shield size={20} />
              </div>
              <div>
                <div style={{ fontSize: '0.875rem', fontWeight: 700, color: isOrchestrator ? '#fff' : '#71717a' }}>
                  {de ? 'Firmen-Orchestrator (CEO Engine)' : 'Company Orchestrator (CEO Engine)'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                  {de ? 'Delegiert Tasks & verwaltet das Team autonom' : 'Delegates tasks & manages team autonomously'}
                </div>
              </div>
            </div>
            <div style={{
              width: '44px', height: '24px', borderRadius: 0, background: isOrchestrator ? '#c5a059' : 'rgba(255,255,255,0.1)',
              padding: '2px', position: 'relative', transition: 'background 0.3s'
            }}>
              <div style={{
                width: '20px', height: '20px', borderRadius: 0, background: '#fff',
                position: 'absolute', left: isOrchestrator ? '22px' : '2px', transition: 'left 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
              }} />
            </div>
          </div>

          {/* EXTENDED THINKING TOGGLE */}
          {isOrchestrator && (
            <div
              style={{
                background: extendedThinking ? 'linear-gradient(135deg, rgba(79, 70, 229, 0.08), rgba(155, 135, 200, 0.08))' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${extendedThinking ? 'rgba(155, 135, 200, 0.4)' : 'rgba(255,255,255,0.06)'}`,
                borderRadius: 0, padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                transition: 'all 0.3s ease', cursor: 'pointer',
              }}
              onClick={() => setExtendedThinking(!extendedThinking)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{
                  width: '34px', height: '34px', borderRadius: 0,
                  background: extendedThinking ? 'rgba(155, 135, 200, 0.2)' : 'rgba(255,255,255,0.05)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: extendedThinking ? '#a78bfa' : '#52525b', fontSize: 18
                }}>
                  🧠
                </div>
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: extendedThinking ? '#c4b5fd' : '#71717a' }}>
                    {de ? 'Extended Thinking (Claude)' : 'Extended Thinking (Claude)'}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                    {de ? 'Tieferes Reasoning — höhere Kosten' : 'Deeper reasoning — higher cost'}
                  </div>
                </div>
              </div>
              <div style={{
                width: '44px', height: '24px', borderRadius: 0,
                background: extendedThinking ? '#9b87c8' : 'rgba(255,255,255,0.1)',
                padding: '2px', position: 'relative', transition: 'background 0.3s', flexShrink: 0
              }}>
                <div style={{
                  width: '20px', height: '20px', borderRadius: 0, background: '#fff',
                  position: 'absolute', left: extendedThinking ? '22px' : '2px', transition: 'left 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
                }} />
              </div>
            </div>
          )}

          {/* Skill Library Selector */}
          {skillsLibrary.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.5rem', color: 'var(--color-text-tertiary)' }}>
                <BookOpen size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                {de ? 'Skill-Bibliothek (Wiederverwendbar)' : 'Skill Library (Reusable)'}
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                {skillsLibrary.map(skill => {
                  const isActive = selectedSkills.includes(skill.id);
                  return (
                    <button key={skill.id} type="button" onClick={() => {
                        if (isActive) setSelectedSkills(selectedSkills.filter(id => id !== skill.id));
                        else setSelectedSkills([...selectedSkills, skill.id]);
                      }} style={{ padding: '0.4rem 0.75rem', borderRadius: 0, fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s', background: isActive ? 'rgba(197, 160, 89, 0.15)' : 'rgba(255, 255, 255, 0.03)', border: `1px solid ${isActive ? '#c5a059' : 'rgba(255, 255, 255, 0.1)'}`, color: isActive ? '#c5a059' : 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {isActive && <CheckCircle2 size={12} />}
                      {skill.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <FieldLabel>{de ? 'Spezifische Expertise (Manuell)' : 'Specific Expertise (Manual)'}</FieldLabel>
            <textarea style={textareaStyle} value={faehigkeiten} onChange={e => setFaehigkeiten(e.target.value)} rows={2}
              onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
              onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
              placeholder={de ? 'Was sind die Hauptaufgaben dieses Agenten?' : 'What are the main tasks of this agent?'}
            />
          </div>

          <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '1rem' }}>
            <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-primary)' }}>
              <Sparkles size={14} style={{ color: '#c5a059' }} />
              <span>{de ? 'KI-Engine & Budget' : 'AI Engine & Budget'}</span>
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '0.75rem' }}>
              <div>
                <FieldLabel>{de ? 'Verbindung' : 'Connection'}</FieldLabel>
                <Select value={verbindung} onChange={setVerbindung} options={[
                  { value: 'openrouter', label: 'OpenRouter' },
                  { value: 'anthropic', label: 'Anthropic Claude' },
                  { value: 'openai', label: 'OpenAI GPT' },
                  { value: 'custom', label: de ? '🔌 Custom API (OpenAI-kompatibel)' : '🔌 Custom API (OpenAI-compatible)' },
                  { value: 'ollama', label: de ? 'Ollama (Lokal)' : 'Ollama (Local)' },
                  { value: 'ollama_cloud', label: de ? '☁️ Ollama (Cloud / Remote)' : '☁️ Ollama (Cloud / Remote)' },
                  { value: 'claude-code', label: '🤖 Claude Code CLI (Pro/Max)' },
                  { value: 'gemini-cli', label: '✨ Gemini CLI' },
                  { value: 'codex-cli', label: '⚡ Codex CLI' },
                  { value: 'kimi-cli', label: '🌙 Kimi CLI' },
                  { value: 'poe', label: '🎭 Poe API' },
                  { value: 'bash', label: 'Bash Script' },
                  { value: 'http', label: 'HTTP' },
                ]} />
              </div>
              <div>
                <FieldLabel>{de ? 'Limit €/M' : 'Limit €/M'}</FieldLabel>
                <input type="number" style={inputStyle} value={budget} onChange={e => setBudget(Number(e.target.value))}
                  onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
                  onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
            </div>

            {/* Autonomous Cycle Toggle */}
            <div
              onClick={() => setZyklusAktiv(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.75rem 1rem', borderRadius: 0, cursor: 'pointer',
                background: zyklusAktiv ? 'rgba(197,160,89,0.08)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${zyklusAktiv ? 'rgba(197,160,89,0.3)' : 'rgba(255,255,255,0.08)'}`,
                transition: 'all 0.2s',
                marginBottom: '0.75rem',
              }}
            >
              <div>
                <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: zyklusAktiv ? '#c5a059' : '#d4d4d8' }}>
                  {de ? '⚡ Autonomer Zyklus' : '⚡ Autonomous Cycle'}
                </div>
                <div style={{ fontSize: '0.6875rem', color: '#71717a', marginTop: 2 }}>
                  {zyklusAktiv
                    ? (de ? 'Agent arbeitet selbstständig im Intervall' : 'Agent runs independently at interval')
                    : (de ? 'Nur bei manueller Zuweisung aktiv' : 'Only active on manual assignment')}
                </div>
              </div>
              <div style={{
                width: 40, height: 22, borderRadius: 0,
                background: zyklusAktiv ? '#c5a059' : 'rgba(255,255,255,0.15)',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}>
                <div style={{
                  position: 'absolute', top: 3, left: zyklusAktiv ? 21 : 3,
                  width: 16, height: 16, borderRadius: '50%', background: '#fff',
                  transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </div>
            </div>

            {(verbindung === 'ollama' || verbindung === 'ollama_cloud' || verbindung === 'openai' || verbindung === 'custom') && (
              <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(56, 189, 248, 0.05)', borderRadius: 0, border: '1px solid rgba(56, 189, 248, 0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <Globe size={14} style={{ color: '#c5a059' }} />
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d8' }}>
                    {verbindung === 'custom'
                      ? (de ? 'API Base URL (Pflicht)' : 'API Base URL (required)')
                      : (de ? 'Spezifische URL / Endpoint (Optional)' : 'Specific URL / Endpoint (Optional)')}
                  </label>
                </div>
                <input
                  className="input"
                  placeholder={verbindung === 'custom' ? 'https://api.groq.com/openai/v1' : verbindung === 'openai' ? 'z.B. https://api.groq.com/openai/v1' : 'z.B. http://1.2.3.4:11434'}
                  value={baseUrl}
                  onChange={e => setBaseUrl(e.target.value)}
                  style={{ ...inputStyle }}
                  onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
                  onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
                />
                <p style={{ fontSize: '0.65rem', color: '#71717a', marginTop: '0.375rem' }}>
                  {verbindung === 'custom'
                    ? (de ? 'OpenAI-kompatibler Endpunkt (Groq, Mistral, Together.ai, LM Studio…). Leer = Wert aus Einstellungen.' : 'OpenAI-compatible endpoint (Groq, Mistral, Together.ai, LM Studio…). Empty = value from Settings.')
                    : (de ? 'Leer lassen für Standard-Endpoint.' : 'Leave empty for default endpoint.')}
                </p>
                {verbindung === 'custom' && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d8', display: 'block', marginBottom: '0.375rem' }}>
                      {de ? 'Modell-Name' : 'Model name'}
                    </label>
                    <input
                      className="input"
                      placeholder="z.B. llama3-70b-8192, mistral-large-latest, …"
                      value={modell}
                      onChange={e => setModell(e.target.value)}
                      style={{ ...inputStyle }}
                      onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
                      onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
                    />
                    <p style={{ fontSize: '0.65rem', color: '#71717a', marginTop: '0.375rem' }}>
                      {de ? 'Exakter Modell-Name wie vom Anbieter angegeben.' : 'Exact model name as specified by the provider.'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {(verbindung === 'openrouter') && (
              <OpenRouterModelSelect models={models} value={modell} onChange={setModell} loading={loadingModels} de={de} />
            )}
            {verbindung === 'anthropic' && (
              <div style={{ backgroundColor: 'rgba(197, 160, 89, 0.05)', border: '1px solid rgba(197, 160, 89, 0.1)', borderRadius: 0, padding: '1rem' }}>
                <FieldLabel>{de ? 'Claude Modell' : 'Claude Model'}</FieldLabel>
                <select value={modell} onChange={e => setModell(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                  <option value="claude-haiku-4-5-20251001">⚡ Claude Haiku 4.5 — schnell &amp; günstig</option>
                  <option value="claude-sonnet-4-6">✨ Claude Sonnet 4.6 — ausgewogen (empfohlen)</option>
                  <option value="claude-opus-4-6">🧠 Claude Opus 4.6 — stärkste Reasoning</option>
                  <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet-20241022</option>
                  <option value="claude-3-5-haiku-20241022">claude-3-5-haiku-20241022</option>
                </select>
              </div>
            )}
            {verbindung === 'openai' && (
              <div style={{ backgroundColor: 'rgba(197, 160, 89, 0.05)', border: '1px solid rgba(197, 160, 89, 0.1)', borderRadius: 0, padding: '1rem' }}>
                <FieldLabel>{de ? 'OpenAI Modell' : 'OpenAI Model'}</FieldLabel>
                <select value={modell} onChange={e => setModell(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                  <option value="gpt-4o-mini">⚡ GPT-4o mini — schnell &amp; günstig</option>
                  <option value="gpt-4o">✨ GPT-4o — ausgewogen (empfohlen)</option>
                  <option value="o4-mini">🧠 o4-mini — Reasoning</option>
                  <option value="o3">🔬 o3 — stärkstes Reasoning</option>
                  <option value="gpt-4-turbo">gpt-4-turbo</option>
                </select>
              </div>
            )}
            {(verbindung === 'ollama' || verbindung === 'ollama_cloud') && (
              <div style={{ backgroundColor: 'rgba(197, 160, 89, 0.05)', border: '1px solid rgba(197, 160, 89, 0.1)', borderRadius: 0, padding: '1rem' }}>
                <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', color: 'var(--color-text-tertiary)' }}>
                  {de ? 'Modell (Ollama)' : 'Model (Ollama)'}
                  <button onClick={() => loadOllamaModels(baseUrl)} disabled={loadingOllamaModels} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: 0 }} title="Modelle aktualisieren">
                    {loadingOllamaModels ? '⏳' : '🔄'}
                  </button>
                </label>
                {ollamaModels.length > 0 ? (
                  <select value={modell} onChange={e => setModell(e.target.value)} style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}>
                    {ollamaModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name}{m.size ? ` (${(m.size / 1e9).toFixed(1)} GB)` : ''}</option>
                    ))}
                  </select>
                ) : (
                  <div style={{ fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.08)', padding: '6px 10px', borderRadius: 0 }}>
                    {loadingOllamaModels ? (de ? 'Lade Modelle...' : 'Loading models...') : (de ? '⚠ Ollama nicht erreichbar — URL prüfen' : '⚠ Ollama not reachable — check URL')}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.75rem' }}>
            <button type="button" onClick={() => setShowAdvanced(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', color: 'var(--color-text-tertiary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', padding: 0 }}>
              <Terminal size={12} /> {de ? 'System-Prompt' : 'System Prompt'} {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {showAdvanced && (
              <div style={{ marginTop: '0.75rem' }}>
                <textarea style={{ ...textareaStyle, fontFamily: 'monospace', minHeight: '80px' }} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={4}
                  onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
                  onBlur={(e) => { e.currentTarget.style.borderColor = (inputStyle as any).borderColor; e.currentTarget.style.boxShadow = 'none'; }}
                />
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'skills' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 0, textAlign: 'center' }}>
            <Wrench size={24} style={{ color: '#71717a', marginBottom: '0.5rem' }} />
            <p style={{ fontSize: '0.8125rem', color: '#71717a' }}>{de ? 'Skills werden im Allgemein-Tab verwaltet.' : 'Skills are managed in the General tab.'}</p>
          </div>
          <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 0, fontSize: '0.8125rem', color: '#71717a', textAlign: 'center' }}>
            {de ? 'Wissensquellen folgen bald.' : 'Knowledge sources coming soon.'}
          </div>
        </div>
      )}

      {activeTab === 'rechte' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <FieldLabel>{de ? 'Vorgesetzter' : 'Reports To'}</FieldLabel>
              <Select value={reportsTo} onChange={setReportsTo} options={[{ value: '', label: '— None —' }, ...(alleExperten?.map(e => ({ value: e.id, label: e.name })) || [])]} />
            </div>
            <div>
              <FieldLabel>{de ? 'Autonomie' : 'Autonomy'}</FieldLabel>
              <Select value={autonomyLevel} onChange={setAutonomyLevel} options={[{ value: 'copilot', label: '🛡️ Copilot' }, { value: 'teamplayer', label: '🤝 Team player' }, { value: 'autonomous', label: '🚀 Autonomous' }]} />
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '0.75rem' }}>
            <button type="button" onClick={() => setShowPermissions(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', color: 'var(--color-text-tertiary)', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', padding: 0 }}>
              <Shield size={12} /> {de ? 'Berechtigungen' : 'Permissions'} {showPermissions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
            {showPermissions && (
              <div style={{ marginTop: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                {[
                  { label: de ? 'Aufgaben erstellen' : 'Create tasks', value: permAufgabenErstellen, setter: setPermAufgabenErstellen },
                  { label: de ? 'Aufgaben zuweisen' : 'Assign tasks', value: permAufgabenZuweisen, setter: setPermAufgabenZuweisen },
                  { label: de ? 'Genehmigungen anfordern' : 'Request approvals', value: permGenehmigungAnfordern, setter: setPermGenehmigungAnfordern },
                  { label: de ? 'Genehmigungen entscheiden' : 'Decide on approvals', value: permGenehmigungEntscheiden, setter: setPermGenehmigungEntscheiden },
                  { label: de ? 'Agenten anwerben' : 'Recruit agents', value: permExpertenAnwerben, setter: setPermExpertenAnwerben },
                ].map(({ label, value, setter }) => (
                  <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', padding: '0.5rem 0.75rem', borderRadius: 0, background: value ? 'rgba(197,160,89,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${value ? 'rgba(197,160,89,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
                    <div onClick={() => setter(!value)} style={{ width: 36, height: 20, borderRadius: 0, background: value ? '#c5a059' : 'rgba(255,255,255,0.1)', position: 'relative' }}>
                      <div style={{ position: 'absolute', top: 2, left: value ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                    </div>
                    <span style={{ fontSize: '0.8125rem' }}>{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '1.25rem' }}>
            <FieldLabel>{de ? 'Agent Advisor (Architekt)' : 'Agent Advisor (Architect)'}</FieldLabel>
            <Select
              value={advisorId}
              onChange={(val) => setAdvisorId(val)}
              options={[
                { value: '', label: de ? 'Kein Advisor' : 'No Advisor' },
                ...(alleExperten || [])
                  .filter(e => e.id !== expert?.id)
                  .map(e => ({ value: e.id, label: `${e.name} (${e.rolle})` }))
              ]}
              icon={<UserCheck size={16} />}
            />
            <p style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: '0.375rem' }}>
              {de ? 'Dieser Agent erstellt die Strategie für den Executor.' : 'This agent creates the strategy for the executor.'}
            </p>
          </div>

          {advisorId && (
            <div style={{ marginBottom: '1.25rem' }}>
              <FieldLabel>{de ? 'Beratungs-Strategie' : 'Advisor Strategy'}</FieldLabel>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[
                  { id: 'planning', label: de ? 'Planung (Generic)' : 'Planning (Generic)', desc: de ? 'Zweistufiger Prozess (Plan -> Ausführung)' : 'Two-step process (Plan -> Execution)' },
                  { id: 'native', label: de ? 'Nativ (Claude Only)' : 'Native (Claude Only)', desc: de ? 'Natives Handoff-Tool (Beta)' : 'Native handoff tool (Beta)' }
                ].map(s => (
                  <button
                    key={s.id}
                    onClick={() => setAdvisorStrategy(s.id as any)}
                    style={{
                      flex: 1, padding: '0.75rem', borderRadius: 0, textAlign: 'left',
                      background: advisorStrategy === s.id ? 'rgba(197, 160, 89, 0.1)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${advisorStrategy === s.id ? 'rgba(197, 160, 89, 0.5)' : 'rgba(255,255,255,0.08)'}`,
                      transition: 'all 0.2s ease', cursor: 'pointer'
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: advisorStrategy === s.id ? '#c5a059' : 'white' }}>{s.label}</div>
                    <div style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  // ── Dynamic Footer ──
  const footer = (
    <>
      {expert && (
        <button
          style={{ marginRight: 'auto', ...btnDanger }}
          onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnDangerHover)}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = btnDanger.background;
            e.currentTarget.style.borderColor = btnDanger.borderColor;
          }}
          onClick={handleDelete}
        >
          {de ? 'Löschen' : 'Delete'}
        </button>
      )}

      {/* Wizard Step 1: Cancel + Create */}
      {!expert && wizardStep === 1 && (
        <>
          <button
            style={btnSecondary}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnSecondaryHover)}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = btnSecondary.background;
              e.currentTarget.style.borderColor = btnSecondary.borderColor;
              e.currentTarget.style.color = btnSecondary.color;
            }}
            onClick={onClose}
          >
            {de ? 'Abbrechen' : 'Cancel'}
          </button>
          <button
            style={{ ...btnSecondary, display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnSecondaryHover)}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = btnSecondary.background;
              e.currentTarget.style.borderColor = btnSecondary.borderColor;
              e.currentTarget.style.color = btnSecondary.color;
            }}
            onClick={() => setWizardStep(2)}
          >
            {de ? 'Erweitert' : 'Advanced'}
            <ArrowRight size={14} />
          </button>
          <button
            style={btnPrimary}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnPrimaryHover)}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = btnPrimary.background;
              e.currentTarget.style.borderColor = btnPrimary.borderColor;
              e.currentTarget.style.boxShadow = 'none';
            }}
            onClick={handleSave}
            disabled={saving || !name.trim()}
          >
            {saving ? '...' : (de ? 'Agent erstellen' : 'Create Agent')}
          </button>
        </>
      )}

      {/* Wizard Step 2: Back + Create */}
      {!expert && wizardStep === 2 && (
        <>
          <button
            style={{ ...btnSecondary, display: 'flex', alignItems: 'center', gap: '0.375rem' }}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnSecondaryHover)}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = btnSecondary.background;
              e.currentTarget.style.borderColor = btnSecondary.borderColor;
              e.currentTarget.style.color = btnSecondary.color;
            }}
            onClick={() => setWizardStep(1)}
          >
            <ArrowLeft size={14} />
            {de ? 'Zurück' : 'Back'}
          </button>
          <button
            style={btnPrimary}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnPrimaryHover)}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = btnPrimary.background;
              e.currentTarget.style.borderColor = btnPrimary.borderColor;
              e.currentTarget.style.boxShadow = 'none';
            }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '...' : (de ? 'Agent erstellen' : 'Create Agent')}
          </button>
        </>
      )}

      {/* Edit mode: Cancel + Save */}
      {expert && (
        <>
          <button
            style={btnSecondary}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnSecondaryHover)}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = btnSecondary.background;
              e.currentTarget.style.borderColor = btnSecondary.borderColor;
              e.currentTarget.style.color = btnSecondary.color;
            }}
            onClick={onClose}
          >
            {de ? 'Abbrechen' : 'Cancel'}
          </button>
          <button
            style={btnPrimary}
            onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnPrimaryHover)}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = btnPrimary.background;
              e.currentTarget.style.borderColor = btnPrimary.borderColor;
              e.currentTarget.style.boxShadow = 'none';
            }}
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? '...' : (de ? 'Speichern' : 'Save')}
          </button>
        </>
      )}
    </>
  );

  const title = expert
    ? (de ? `Agent "${expert.name}" bearbeiten` : `Edit Agent "${expert.name}"`)
    : wizardStep === 1
      ? (de ? 'Neuen Agenten erstellen' : 'Create New Agent')
      : (de ? 'Erweiterte Einstellungen' : 'Advanced Settings');

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      maxWidth={expert || wizardStep === 2 ? "520px" : "440px"}
      footer={footer}
    >
      {!expert && wizardStep === 1 ? renderStep1() : renderAdvancedContent()}
    </ModalShell>
  );
}
