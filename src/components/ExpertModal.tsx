import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, ChevronDown, ChevronUp, Terminal, Shield, Wrench, UserCheck, Database, BookOpen, CheckCircle2, Globe, Search } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { apiPermissions, apiExperten, type Experte as ExperteType } from '../api/client';
import { Select } from './Select';
import { useApi } from '../hooks/useApi';
import { useI18n } from '../i18n';
import { useToast } from './ToastProvider';

function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
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
    <div style={{ backgroundColor: 'rgba(35,205,202,0.05)', border: '1px solid rgba(35,205,202,0.1)', borderRadius: 12, padding: '1rem' }}>
      <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', color: 'var(--color-text-tertiary)' }}>
        {de ? 'Modell' : 'Model'}
        {loading && <span style={{ color: '#23CDCB', fontSize: 10 }}>{de ? 'Lade...' : 'Loading...'}</span>}
      </label>

      {/* Suchfeld */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '5px 8px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 7 }}>
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
            <X size={11} />
          </button>
        )}
      </div>

      {/* Natives select — scrollt immer zuverlässig */}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        size={8}
        style={{
          width: '100%',
          background: 'rgba(8,8,18,0.9)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
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

      {/* Gewählte Model-ID */}
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

export function ExpertModal({ expert, onClose, onSaved, isOpen = true }: { expert?: ExperteType, onClose: () => void, onSaved: () => void, isOpen?: boolean }) {
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const de = language === 'de';
  const toastCtx = useToast();
  const [name, setName] = useState('');
  const [rolle, setRolle] = useState('Strategie & Planung');
  const [verbindung, setVerbindung] = useState('openrouter');
  const [modell, setModell] = useState('openrouter/auto');
  const [faehigkeiten, setFaehigkeiten] = useState('Analyse, Strategie, Team-Management');
  const [budget, setBudget] = useState(500);

  // New Tab State
  const [activeTab, setActiveTab] = useState<'allgemein' | 'skills' | 'rechte'>('allgemein');

  // New Fields
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

  // Fetch data for dropdowns
  const { data: alleExperten } = useApi<ExperteType[]>(
    () => apiExperten.liste(aktivesUnternehmen?.id || ''),
    [aktivesUnternehmen?.id]
  );

  // Initialize state if editing
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
      
      // Auto-legacy support for 'ceo' connection type
      if (expert.verbindungsTyp === 'ceo') {
        setIsOrchestrator(true);
        setVerbindung('openrouter');
      }

      try {
        if (expert.verbindungsConfig) {
          const config = JSON.parse(expert.verbindungsConfig);
          if (config.model) {
            // Auto-fix: replace free models with openrouter/auto
            const isFreeModel = config.model.endsWith(':free') || config.model === 'auto:free';
            setModell(isFreeModel ? 'openrouter/auto' : config.model);
          }
          // Auto-fix: if verbindungsTyp is 'claude-code' but a provider-specific model is configured
          // (e.g. 'mistralai/mistral-7b'), switch to openrouter. Exclude generic 'openrouter/auto'.
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
      
      // Load permissions
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
      setBudget(500);
      setReportsTo('');
      setAutonomyLevel('copilot');
      setSelectedSkills([]);
      setSystemPrompt('');
      setAdvisorId('');
      setAdvisorStrategy('none');
      setBaseUrl('');
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
            // Exclude free models — they cause hallucinations and context overflows
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

  const handleSave = async () => {
    if (!aktivesUnternehmen || !name.trim()) return;
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
          // Don't persist model for CLI-based adapters — they use the CLI binary, not an API model
          ...(verbindung !== 'claude-code' && verbindung !== 'gemini-cli' && verbindung !== 'codex-cli' ? { model: modell } : {}),
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
        res = await authFetch(`/api/mitarbeiter/${expert.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/experten`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
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
            await authFetch(`/api/experten/${targetId}/skills-library`, {
              method: 'POST',
              body: JSON.stringify({ skillId })
            });
          }
          for (const skillId of toRemove) {
            await authFetch(`/api/experten/${targetId}/skills-library/${skillId}`, {
              method: 'DELETE'
            });
          }
        }
      } catch (e) {}

      toastCtx.success(expert ? (de ? 'Agent gespeichert' : 'Agent saved') : (de ? 'Agent erstellt' : 'Agent created'), name);
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Netzwerkfehler');
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

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', zIndex: 100, padding: '1rem',
      }}
    >
      <div
        style={{
          background: 'rgba(12, 12, 20, 0.75)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '24px', padding: '1.5rem',
          width: '100%', maxWidth: '480px', maxHeight: '90vh', overflowY: 'auto', position: 'relative',
          boxShadow: '0 30px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
          animation: 'slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: '1rem', right: '1rem', background: 'none',
            border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer',
          }}
        >
          <X size={20} />
        </button>

        <h2
          style={{
            fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem',
            background: 'linear-gradient(to bottom right, #23CDCB 0%, #ffffff 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}
        >
          {expert 
            ? (de ? `Agent "${expert.name}" bearbeiten` : `Edit Agent "${expert.name}"`)
            : (de ? 'Agenten ins Team holen' : 'Add Agent to Team')}
        </h2>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.75rem' }}>
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
                background: activeTab === t.id ? 'rgba(35, 205, 202, 0.1)' : 'transparent',
                border: 'none', borderRadius: '8px',
                color: activeTab === t.id ? '#23CDCB' : '#71717a',
                fontSize: '0.8125rem', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.2s',
              }}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: '350px' }}>
          {activeTab === 'allgemein' && (
            <>
              {/* Row 1: Name & Rolle */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-tertiary)' }}>
                    {de ? 'Name' : 'Name'}
                  </label>
                  <input type="text" style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--color-text-primary)' }} value={name} onChange={e => setName(e.target.value)} placeholder={de ? 'z.B. Agent Alpha' : 'e.g. Agent Alpha'} />
                </div>
                <div>
                  <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-tertiary)' }}>
                    {de ? 'Rolle' : 'Role'}
                  </label>
                  <input type="text" style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--color-text-primary)' }} value={rolle} onChange={e => setRolle(e.target.value)} placeholder={de ? 'z.B. Marketing-Lead' : 'e.g. Marketing Lead'} />
                </div>
              </div>

              {/* CEO MODE TOGGLE */}
              <div 
                style={{ 
                  background: isOrchestrator ? 'linear-gradient(135deg, rgba(35, 205, 202, 0.1), rgba(79, 70, 229, 0.1))' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${isOrchestrator ? 'rgba(35, 205, 202, 0.5)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '16px', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  transition: 'all 0.3s ease', cursor: 'pointer',
                  boxShadow: isOrchestrator ? '0 8px 32px rgba(35, 205, 202, 0.1)' : 'none'
                }}
                onClick={() => setIsOrchestrator(!isOrchestrator)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ 
                    width: '40px', height: '40px', borderRadius: '12px', background: isOrchestrator ? 'rgba(35, 205, 202, 0.2)' : 'rgba(255,255,255,0.05)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: isOrchestrator ? '#23CDCB' : '#71717a'
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
                  width: '44px', height: '24px', borderRadius: '12px', background: isOrchestrator ? '#23CDCB' : 'rgba(255,255,255,0.1)',
                  padding: '2px', position: 'relative', transition: 'background 0.3s'
                }}>
                  <div style={{ 
                    width: '20px', height: '20px', borderRadius: '10px', background: '#fff',
                    position: 'absolute', left: isOrchestrator ? '22px' : '2px', transition: 'left 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
                  }} />
                </div>
              </div>

              {/* EXTENDED THINKING TOGGLE — only for CEO Engine */}
              {isOrchestrator && (
                <div
                  style={{
                    background: extendedThinking ? 'linear-gradient(135deg, rgba(79, 70, 229, 0.08), rgba(139, 92, 246, 0.08))' : 'rgba(255,255,255,0.02)',
                    border: `1px solid ${extendedThinking ? 'rgba(139, 92, 246, 0.4)' : 'rgba(255,255,255,0.06)'}`,
                    borderRadius: '14px', padding: '0.875rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    transition: 'all 0.3s ease', cursor: 'pointer',
                  }}
                  onClick={() => setExtendedThinking(!extendedThinking)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{
                      width: '34px', height: '34px', borderRadius: '10px',
                      background: extendedThinking ? 'rgba(139, 92, 246, 0.2)' : 'rgba(255,255,255,0.05)',
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
                    width: '44px', height: '24px', borderRadius: '12px',
                    background: extendedThinking ? '#7c3aed' : 'rgba(255,255,255,0.1)',
                    padding: '2px', position: 'relative', transition: 'background 0.3s', flexShrink: 0
                  }}>
                    <div style={{
                      width: '20px', height: '20px', borderRadius: '10px', background: '#fff',
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
                          }} style={{ padding: '0.4rem 0.75rem', borderRadius: '20px', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', transition: 'all 0.2s', background: isActive ? 'rgba(35, 205, 202, 0.15)' : 'rgba(255, 255, 255, 0.03)', border: `1px solid ${isActive ? '#23CDCB' : 'rgba(255, 255, 255, 0.1)'}`, color: isActive ? '#23CDCB' : 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                          {isActive && <CheckCircle2 size={12} />}
                          {skill.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-tertiary)' }}>
                  {de ? 'Spezifische Expertise (Manuell)' : 'Specific Expertise (Manual)'}
                </label>
                <textarea style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--color-text-primary)', resize: 'vertical', minHeight: '60px' }} value={faehigkeiten} onChange={e => setFaehigkeiten(e.target.value)} rows={2} placeholder={de ? 'Was sind die Hauptaufgaben dieses Agenten?' : 'What are the main tasks of this agent?'} />
              </div>

              <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '1rem' }}>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Sparkles size={14} style={{ color: '#23CDCB' }} />
                  <span>{de ? 'KI-Engine & Budget' : 'AI Engine & Budget'}</span>
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '0.75rem' }}>
                  <div>
                    <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-tertiary)' }}>{de ? 'Verbindung' : 'Connection'}</label>
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
                      { value: 'bash', label: 'Bash Script' },
                      { value: 'http', label: 'HTTP' },
                    ]} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-tertiary)' }}>{de ? 'Limit €/M' : 'Limit €/M'}</label>
                    <input type="number" style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--color-text-primary)' }} value={budget} onChange={e => setBudget(Number(e.target.value))} />
                  </div>
                </div>

                {/* Autonomous Cycle Toggle */}
                <div
                  onClick={() => setZyklusAktiv(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.75rem 1rem', borderRadius: '12px', cursor: 'pointer',
                    background: zyklusAktiv ? 'rgba(35,205,202,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${zyklusAktiv ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    transition: 'all 0.2s',
                    marginBottom: '0.75rem',
                  }}
                >
                  <div>
                    <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: zyklusAktiv ? '#23CDCB' : '#d4d4d8' }}>
                      {de ? '⚡ Autonomer Zyklus' : '⚡ Autonomous Cycle'}
                    </div>
                    <div style={{ fontSize: '0.6875rem', color: '#71717a', marginTop: 2 }}>
                      {zyklusAktiv
                        ? (de ? 'Agent arbeitet selbstständig im Intervall' : 'Agent runs independently at interval')
                        : (de ? 'Nur bei manueller Zuweisung aktiv' : 'Only active on manual assignment')}
                    </div>
                  </div>
                  <div style={{
                    width: 40, height: 22, borderRadius: 11,
                    background: zyklusAktiv ? '#23CDCB' : 'rgba(255,255,255,0.15)',
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
                  <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(56, 189, 248, 0.05)', borderRadius: '12px', border: '1px solid rgba(56, 189, 248, 0.1)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <Globe size={14} style={{ color: '#23CDCB' }} />
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
                      style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--color-text-primary)' }}
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
                          style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--color-text-primary)' }}
                        />
                        <p style={{ fontSize: '0.65rem', color: '#71717a', marginTop: '0.375rem' }}>
                          {de ? 'Exakter Modell-Name wie vom Anbieter angegeben.' : 'Exact model name as specified by the provider.'}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {(verbindung === 'openrouter') && (
                  <OpenRouterModelSelect
                    models={models}
                    value={modell}
                    onChange={setModell}
                    loading={loadingModels}
                    de={de}
                  />
                )}
                {verbindung === 'anthropic' && (
                  <div style={{ backgroundColor: 'rgba(35, 205, 202, 0.05)', border: '1px solid rgba(35, 205, 202, 0.1)', borderRadius: '12px', padding: '1rem' }}>
                    <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.5rem', color: 'var(--color-text-tertiary)' }}>
                      {de ? 'Claude Modell' : 'Claude Model'}
                    </label>
                    <select
                      value={modell}
                      onChange={e => setModell(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}
                    >
                      <option value="claude-haiku-4-5-20251001" style={{ background: '#1a1a2e' }}>⚡ Claude Haiku 4.5 — schnell &amp; günstig</option>
                      <option value="claude-sonnet-4-6" style={{ background: '#1a1a2e' }}>✨ Claude Sonnet 4.6 — ausgewogen (empfohlen)</option>
                      <option value="claude-opus-4-6" style={{ background: '#1a1a2e' }}>🧠 Claude Opus 4.6 — stärkste Reasoning</option>
                      <option value="claude-3-5-sonnet-20241022" style={{ background: '#1a1a2e' }}>claude-3-5-sonnet-20241022</option>
                      <option value="claude-3-5-haiku-20241022" style={{ background: '#1a1a2e' }}>claude-3-5-haiku-20241022</option>
                    </select>
                  </div>
                )}
                {verbindung === 'openai' && (
                  <div style={{ backgroundColor: 'rgba(35, 205, 202, 0.05)', border: '1px solid rgba(35, 205, 202, 0.1)', borderRadius: '12px', padding: '1rem' }}>
                    <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.5rem', color: 'var(--color-text-tertiary)' }}>
                      {de ? 'OpenAI Modell' : 'OpenAI Model'}
                    </label>
                    <select
                      value={modell}
                      onChange={e => setModell(e.target.value)}
                      style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}
                    >
                      <option value="gpt-4o-mini" style={{ background: '#1a1a2e' }}>⚡ GPT-4o mini — schnell &amp; günstig</option>
                      <option value="gpt-4o" style={{ background: '#1a1a2e' }}>✨ GPT-4o — ausgewogen (empfohlen)</option>
                      <option value="o4-mini" style={{ background: '#1a1a2e' }}>🧠 o4-mini — Reasoning</option>
                      <option value="o3" style={{ background: '#1a1a2e' }}>🔬 o3 — stärkstes Reasoning</option>
                      <option value="gpt-4-turbo" style={{ background: '#1a1a2e' }}>gpt-4-turbo</option>
                    </select>
                  </div>
                )}
                {(verbindung === 'ollama' || verbindung === 'ollama_cloud') && (
                  <div style={{ backgroundColor: 'rgba(35, 205, 202, 0.05)', border: '1px solid rgba(35, 205, 202, 0.1)', borderRadius: '12px', padding: '1rem' }}>
                    <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', color: 'var(--color-text-tertiary)' }}>
                      {de ? 'Modell (Ollama)' : 'Model (Ollama)'}
                      <button onClick={() => loadOllamaModels(baseUrl)} disabled={loadingOllamaModels} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: 0 }} title="Modelle aktualisieren">
                        {loadingOllamaModels ? '⏳' : '🔄'}
                      </button>
                    </label>
                    {ollamaModels.length > 0 ? (
                      <select
                        value={modell}
                        onChange={e => setModell(e.target.value)}
                        style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '0.875rem', color: 'var(--color-text-primary)', cursor: 'pointer' }}
                      >
                        {ollamaModels.map(m => (
                          <option key={m.id} value={m.id} style={{ background: '#1a1a2e' }}>
                            {m.name}{m.size ? ` (${(m.size / 1e9).toFixed(1)} GB)` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div style={{ fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.08)', padding: '6px 10px', borderRadius: 6 }}>
                        {loadingOllamaModels ? (de ? 'Lade Modelle...' : 'Loading models...') : (de ? '⚠ Ollama nicht erreichbar — URL prüfen' : '⚠ Ollama not reachable — check URL')}
                      </div>
                    )}
                    {ollamaModels.length > 0 && (
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
                        {ollamaModels.length} {de ? 'lokale Modelle' : 'local models'}
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
                    <textarea style={{ width: '100%', padding: '0.5rem 0.75rem', backgroundColor: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', fontSize: '0.8125rem', color: 'var(--color-text-primary)', fontFamily: 'monospace', resize: 'vertical', minHeight: '80px' }} value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={4} />
                  </div>
                )}
              </div>
            </>
          )}

          {activeTab === 'skills' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '12px', textAlign: 'center' }}>
                <Wrench size={24} style={{ color: '#71717a', marginBottom: '0.5rem' }} />
                <p style={{ fontSize: '0.8125rem', color: '#71717a' }}>{de ? 'Skills werden im Allgemein-Tab verwaltet.' : 'Skills are managed in the General tab.'}</p>
              </div>
              <div style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '0.8125rem', color: '#71717a', textAlign: 'center' }}>
                {de ? 'Wissensquellen folgen bald.' : 'Knowledge sources coming soon.'}
              </div>
            </div>
          )}

          {activeTab === 'rechte' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-tertiary)' }}>{de ? 'Vorgesetzter' : 'Reports To'}</label>
                  <Select value={reportsTo} onChange={setReportsTo} options={[{ value: '', label: '— None —' }, ...(alleExperten?.map(e => ({ value: e.id, label: e.name })) || [])]} />
                </div>
                <div>
                  <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-tertiary)' }}>{de ? 'Autonomie' : 'Autonomy'}</label>
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
                      <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', cursor: 'pointer', padding: '0.5rem 0.75rem', borderRadius: '8px', background: value ? 'rgba(35,205,202,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${value ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.06)'}` }}>
                        <div onClick={() => setter(!value)} style={{ width: 36, height: 20, borderRadius: '10px', background: value ? '#23CDCB' : 'rgba(255,255,255,0.1)', position: 'relative' }}>
                          <div style={{ position: 'absolute', top: 2, left: value ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                        </div>
                        <span style={{ fontSize: '0.8125rem' }}>{label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {de ? 'Agent Advisor (Architekt)' : 'Agent Advisor (Architect)'}
                </label>
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
                  <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {de ? 'Beratungs-Strategie' : 'Advisor Strategy'}
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    {[
                      { id: 'planning', label: de ? 'Planung (Generic)' : 'Planning (Generic)', desc: de ? 'Zweistufiger Prozess (Plan -> Ausführung)' : 'Two-step process (Plan -> Execution)' },
                      { id: 'native', label: de ? 'Nativ (Claude Only)' : 'Native (Claude Only)', desc: de ? 'Natives Handoff-Tool (Beta)' : 'Native handoff tool (Beta)' }
                    ].map(s => (
                      <button
                        key={s.id}
                        onClick={() => setAdvisorStrategy(s.id as any)}
                        style={{
                          flex: 1, padding: '0.75rem', borderRadius: '12px', textAlign: 'left',
                          background: advisorStrategy === s.id ? 'rgba(35, 205, 202, 0.1)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${advisorStrategy === s.id ? 'rgba(35, 205, 202, 0.5)' : 'rgba(255,255,255,0.08)'}`,
                          transition: 'all 0.2s ease', cursor: 'pointer'
                        }}
                      >
                        <div style={{ fontSize: '0.75rem', fontWeight: 600, color: advisorStrategy === s.id ? '#23CDCA' : 'white' }}>{s.label}</div>
                        <div style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>{s.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: 'auto' }}>
            <button style={{ padding: '0.5rem 1rem', background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '8px', color: 'var(--color-text-secondary)' }} onClick={onClose}>
              {de ? 'Abbrechen' : 'Cancel'}
            </button>
            {expert && (
              <button style={{ padding: '0.5rem 1rem', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '8px', marginRight: 'auto' }} onClick={handleDelete}>
                {de ? 'Löschen' : 'Delete'}
              </button>
            )}
            <button style={{ padding: '0.5rem 1.25rem', background: 'rgba(35, 205, 202, 0.1)', color: '#23CDCB', border: '1px solid rgba(35, 205, 202, 0.2)', borderRadius: '8px' }} onClick={handleSave} disabled={saving}>
              {saving ? '...' : (expert ? (de ? 'Speichern' : 'Save') : (de ? 'Erstellen' : 'Create'))}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
