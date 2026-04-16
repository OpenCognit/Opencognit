import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Send, CheckCircle2, Circle, Clock, Wallet, Activity,
  Settings, Monitor, Trash2, Pause, Play, Zap, Bot,
  ChevronRight, ChevronDown, ChevronUp, AlertCircle, ToggleLeft, ToggleRight, Save, Eye, Sparkles, Wrench, BookOpen,
  LayoutDashboard, TrendingUp, BarChart3, UserCheck, ShieldQuestion, Shield, Terminal, Globe,
  FileText, Hash, Upload
} from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';
import { apiAufgaben, apiExperten, type Aufgabe, type Experte, type Aktivitaet } from '../api/client';
import { useToast } from './ToastProvider';
import { Select } from './Select';
import { GlassAgentPanel } from './GlassAgentPanel';
import { 
  RunActivityChart, PriorityChart, StatusChart, SuccessRateChart, ChartCard 
} from './AgentCharts';

// ── OpenRouter Model Picker ───────────────────────────────────────────────────
interface ORModel { id: string; name: string; pricing?: any }

function OpenRouterModelPicker({ models, value, onChange, de }: {
  models: ORModel[]; value: string; onChange: (v: string) => void; de: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const all = [
    { id: 'openrouter/auto', name: '🤖 Auto Router (empfohlen)', pricing: null },
    ...models.filter(m => m.id !== 'openrouter/auto'),
  ];
  const q = search.toLowerCase();
  const filtered = q ? all.filter(m => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)) : all;
  const selected = all.find(m => m.id === value);

  const openDrop = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    // Open upward if not enough space below
    const spaceBelow = window.innerHeight - r.bottom;
    const dropH = Math.min(320, filtered.length * 38 + 52);
    const top = spaceBelow > dropH ? r.bottom + 4 : r.top - dropH - 4;
    setPos({ top, left: r.left, width: r.width });
    setOpen(true);
    setTimeout(() => searchRef.current?.focus(), 30);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!triggerRef.current?.contains(e.target as Node) && !dropRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <>
      {/* Trigger — gleiche Optik wie Select */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => open ? setOpen(false) : openDrop()}
        style={{
          width: '100%', padding: '0.5rem 2rem 0.5rem 0.75rem',
          background: open ? 'rgba(35,205,202,0.08)' : 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
          fontSize: '0.875rem', color: 'var(--color-text-primary)',
          textAlign: 'left', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          outline: 'none',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: selected ? 'var(--color-text-primary)' : '#f59e0b' }}>
          {selected?.name || (value ? value : '⚡ Auto Free (Standard)')}
        </span>
        <ChevronDown size={14} style={{ color: '#475569', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {/* Dropdown via Portal */}
      {open && createPortal(
        <div
          ref={dropRef}
          onWheel={e => e.stopPropagation()}
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width,
            zIndex: 2147483647,
            background: 'rgba(12,12,24,0.99)', backdropFilter: 'blur(20px)',
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            display: 'flex', flexDirection: 'column', maxHeight: 320,
          }}
        >
          {/* Suchfeld */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 13, color: '#475569' }}>🔍</span>
            <input
              ref={searchRef}
              type="text"
              placeholder={de ? 'Suchen... (llama, qwen, claude)' : 'Search... (llama, qwen, claude)'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: 'var(--color-text-primary)', fontSize: '0.875rem' }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 0, fontSize: 14, lineHeight: 1 }}>✕</button>
            )}
          </div>

          {/* Liste */}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {filtered.length === 0 && (
              <div style={{ padding: 16, fontSize: '0.875rem', color: '#475569', textAlign: 'center' }}>
                {de ? 'Keine Modelle gefunden' : 'No models found'}
              </div>
            )}
            {filtered.slice(0, 150).map(m => {
              const sel = m.id === value;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onChange(m.id); setOpen(false); setSearch(''); }}
                  style={{
                    width: '100%', padding: '0.5rem 0.75rem', textAlign: 'left',
                    border: 'none', cursor: 'pointer', fontSize: '0.875rem',
                    background: sel ? 'rgba(35,205,202,0.15)' : 'transparent',
                    color: sel ? '#23CDCB' : 'var(--color-text-primary)',
                    display: 'flex', alignItems: 'center', gap: 8,
                  }}
                  onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.06)'; }}
                  onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                </button>
              );
            })}
            {filtered.length > 150 && (
              <div style={{ padding: '6px 12px', fontSize: 11, color: '#475569', textAlign: 'center', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                +{filtered.length - 150} {de ? 'weitere — oben filtern' : 'more — filter above'}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

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

function centZuEuro(cent: number, language: string) {
  const locale = language === 'de' ? 'de-DE' : 'en-US';
  const currency = language === 'de' ? 'EUR' : 'USD';
  return (cent / 100).toLocaleString(locale, { style: 'currency', currency });
}

function zeitRelativ(iso: string, language: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  const de = language === 'de';
  
  if (s < 60) return de ? 'gerade eben' : 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return de ? `vor ${m} Min.` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return de ? `vor ${h} Std.` : `${h}h ago`;
  return new Date(iso).toLocaleDateString(de ? 'de-DE' : 'en-US');
}

const verbindungsLabels: Record<string, any> = {
  claude: { de: 'Claude Code CLI', en: 'Claude Code CLI' },
  anthropic: { de: 'Anthropic API', en: 'Anthropic API' },
  openai: { de: 'OpenAI GPT', en: 'OpenAI GPT' },
  openrouter: { de: 'OpenRouter', en: 'OpenRouter' },
  ollama: { de: 'Ollama (Lokal)', en: 'Ollama (Local)' },
  ollama_cloud: { de: 'Ollama (Cloud / Remote)', en: 'Ollama (Cloud / Remote)' },
  custom: { de: 'Custom API (OpenAI-kompatibel)', en: 'Custom API (OpenAI-compatible)' },
  ceo: { de: 'CEO Engine', en: 'CEO Engine' },
  http: { de: 'HTTP Webhook', en: 'HTTP Webhook' },
  bash: { de: 'Bash Script', en: 'Bash Script' },
  codex: { de: 'Codex', en: 'Codex' },
  cursor: { de: 'Cursor', en: 'Cursor' },
};

const akteurIcon: Record<string, string> = {
  agent: '🤖', board: '👤', system: '⚙️',
};

const statusColor: Record<string, string> = {
  active: 'var(--color-success)', running: '#3b82f6', idle: 'var(--color-text-muted)',
  paused: 'var(--color-warning)', error: 'var(--color-error)', terminated: '#6b7280',
};

type Tab = 'überblick' | 'monitor' | 'glass' | 'aktivitaet' | 'einstellungen' | 'skills' | 'soul';

// ─── Skill Radar Chart ────────────────────────────────────────────────────────
function SkillRadarChart({ skills }: { skills: Array<{ name: string; konfidenz: number }> }) {
  const n = skills.length;
  if (n === 0) return null;

  const size = 220;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = 78;
  const labelR = maxR + 18;
  const startAngle = -Math.PI / 2;
  const step = (2 * Math.PI) / n;

  const polar = (i: number, r: number) => ({
    x: cx + r * Math.cos(startAngle + i * step),
    y: cy + r * Math.sin(startAngle + i * step),
  });

  const polyPts = skills
    .map((s, i) => { const p = polar(i, maxR * Math.max(0.15, s.konfidenz / 100)); return `${p.x},${p.y}`; })
    .join(' ');

  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
      <defs>
        <radialGradient id="radarGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(35,205,202,0.18)" />
          <stop offset="100%" stopColor="rgba(35,205,202,0.04)" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
          <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Grid circles */}
      {gridLevels.map((lvl, i) => (
        <circle key={i} cx={cx} cy={cy} r={maxR * lvl}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} strokeDasharray={i < 3 ? '3 3' : 'none'} />
      ))}

      {/* Axis lines */}
      {skills.map((_, i) => {
        const p = polar(i, maxR);
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />;
      })}

      {/* Filled polygon with glow */}
      <polygon points={polyPts} fill="url(#radarGlow)" stroke="#23CDCB" strokeWidth={1.5} strokeLinejoin="round" filter="url(#glow)" />

      {/* Vertex dots */}
      {skills.map((s, i) => {
        const p = polar(i, maxR * Math.max(0.15, s.konfidenz / 100));
        return <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#23CDCB" filter="url(#glow)" />;
      })}

      {/* Labels */}
      {skills.map((s, i) => {
        const lp = polar(i, labelR);
        const label = s.name.length > 11 ? s.name.slice(0, 11) + '…' : s.name;
        return (
          <text key={i} x={lp.x} y={lp.y} textAnchor="middle" dominantBaseline="middle"
            fontSize={8.5} fill="rgba(255,255,255,0.65)" style={{ userSelect: 'none' }}>
            {label}
          </text>
        );
      })}

      {/* Center dot */}
      <circle cx={cx} cy={cy} r={3} fill="rgba(35,205,202,0.4)" />
    </svg>
  );
}

export function ExpertChatDrawer({ expert: initialExpert, onClose, onDeleted, onUpdated, initialTab = 'überblick' }: {
  expert: Experte;
  onClose: () => void;
  onDeleted?: () => void;
  onUpdated?: () => void;
  initialTab?: Tab;
}) {
  const { aktivesUnternehmen } = useCompany();
  const i18n = useI18n();
  const t = i18n.t.expertChat;
  const de = i18n.language === 'de';
  const toastCtx = useToast();
  const [expert, setExpert] = useState<Experte>(initialExpert);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);

  // Chat state
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [loadingChat, setLoadingChat] = useState(true);
  const [agentTyping, setAgentTyping] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [commandFilter, setCommandFilter] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [directChatMode, setDirectChatMode] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Monitor state
  const [tasks, setTasks] = useState<Aufgabe[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  // Aktivität state
  const [aktivitaet, setAktivitaet] = useState<Aktivitaet[]>([]);
  const [loadingAktivitaet, setLoadingAktivitaet] = useState(false);

  // Stats state
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Team status state (for orchestrators)
  const [teamStatus, setTeamStatus] = useState<{ team: any[]; unassigned: any[] } | null>(null);

  // Einstellungen state
  const [editForm, setEditForm] = useState({
    name: expert.name,
    rolle: expert.rolle,
    titel: expert.titel || '',
    faehigkeiten: expert.faehigkeiten || '',
    verbindungsTyp: expert.verbindungsTyp,
    modell: (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').model || ''; } catch { return ''; } })(),
    autonomyLevel: (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').autonomyLevel || 'copilot'; } catch { return 'copilot'; } })(),
    baseUrl: (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').baseUrl || ''; } catch { return ''; } })(),
    workDir: (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').workDir || ''; } catch { return ''; } })(),
    isOrchestrator: expert.isOrchestrator || false,
    budgetMonatCent: Math.round(expert.budgetMonatCent / 100),
    zyklusAktiv: expert.zyklusAktiv || false,
    zyklusIntervallSek: expert.zyklusIntervallSek || 120,
    reportsTo: expert.reportsTo || '',
    systemPrompt: expert.systemPrompt || '',
    advisorId: expert.advisorId || '',
    advisorStrategy: (expert.advisorStrategy || 'none') as 'none' | 'planning' | 'native',
    permAufgabenErstellen: true,
    permAufgabenZuweisen: false,
    permGenehmigungAnfordern: true,
    permGenehmigungEntscheiden: false,
    permExpertenAnwerben: false,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // SOUL state
  const [soulIdentity, setSoulIdentity] = useState('');
  const [soulPrinciples, setSoulPrinciples] = useState('');
  const [soulChecklist, setSoulChecklist] = useState('');
  const [soulPersonality, setSoulPersonality] = useState('');
  const [generatingSoul, setGeneratingSoul] = useState(false);
  const [savingSoul, setSavingSoul] = useState(false);
  const [soulSaved, setSoulSaved] = useState(false);

  // Parse existing systemPrompt into SOUL sections on mount
  React.useEffect(() => {
    const sp = expert.systemPrompt || '';
    const extract = (tag: string) => {
      const m = sp.match(new RegExp(`## ${tag}\\n([\\s\\S]*?)(?=\\n## |$)`));
      return m ? m[1].trim() : '';
    };
    if (sp.includes('## IDENTITÄT') || sp.includes('## IDENTITY')) {
      setSoulIdentity(extract('IDENTITÄT') || extract('IDENTITY'));
      setSoulPrinciples(extract('ENTSCHEIDUNGSPRINZIPIEN') || extract('DECISION PRINCIPLES'));
      setSoulChecklist(extract('ZYKLUS-CHECKLISTE') || extract('CYCLE CHECKLIST'));
      setSoulPersonality(extract('PERSÖNLICHKEIT') || extract('PERSONALITY'));
    }
  }, [expert.systemPrompt]);

  // Skill Library state
  const [skillsLibrary, setSkillsLibrary] = useState<any[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [allExperts, setAllExperts] = useState<Experte[]>([]);
  const [globalCustomBaseUrl, setGlobalCustomBaseUrl] = useState('');

  useEffect(() => {
    if (!expert.id) return;

    // Fetch all experts for dropdowns
    apiExperten.liste(expert.unternehmenId)
      .then(list => setAllExperts(list))
      .catch(() => {});

    // Fetch global custom API base URL as hint for the per-agent field
    authFetch(`/api/einstellungen?unternehmenId=${expert.unternehmenId}`)
      .then(r => r.json())
      .then((data: Record<string, string>) => setGlobalCustomBaseUrl(data.custom_api_base_url || ''))
      .catch(() => {});

    // Fetch permissions
    authFetch(`/api/mitarbeiter/${expert.id}/permissions`)
      .then(r => r.json())
      .then(p => {
        setEditForm(prev => ({
          ...prev,
          permAufgabenErstellen: p.darfAufgabenErstellen,
          permAufgabenZuweisen: p.darfAufgabenZuweisen,
          permGenehmigungAnfordern: p.darfGenehmigungAnfordern,
          permGenehmigungEntscheiden: p.darfGenehmigungEntscheiden,
          permExpertenAnwerben: p.darfExpertenAnwerben,
        }));
      })
      .catch(() => {});

    authFetch(`/api/unternehmen/${expert.unternehmenId}/skills-library`)
      .then(r => r.json())
      .then(data => setSkillsLibrary(Array.isArray(data) ? data : []))
      .catch(() => {});

    authFetch(`/api/experten/${expert.id}/skills-library`)
      .then(r => r.json())
      .then((data: any[]) => setSelectedSkills(Array.isArray(data) ? data.map(s => s.id) : []))
      .catch(() => {});
  }, [expert.id, expert.unternehmenId]);

  // Sync editForm when expert changes
  useEffect(() => {
    // Don't reset the form while user is actively editing settings — it would discard unsaved changes.
    // Only sync when a different expert is opened (id change) or after the user saves (aktualisiertAm
    // changes while NOT on the settings tab).
    if (activeTab === 'einstellungen') return;
    setEditForm({
      name: expert.name,
      rolle: expert.rolle,
      titel: expert.titel || '',
      faehigkeiten: expert.faehigkeiten || '',
      verbindungsTyp: expert.verbindungsTyp,
      modell: (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').model || ''; } catch { return ''; } })(),
      autonomyLevel: (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').autonomyLevel || 'copilot'; } catch { return 'copilot'; } })(),
      baseUrl: (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').baseUrl || ''; } catch { return ''; } })(),
      workDir: (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').workDir || ''; } catch { return ''; } })(),
      budgetMonatCent: Math.round(expert.budgetMonatCent / 100),
      zyklusAktiv: expert.zyklusAktiv || false,
      zyklusIntervallSek: expert.zyklusIntervallSek || 120,
      reportsTo: expert.reportsTo || '',
      systemPrompt: expert.systemPrompt || '',
      advisorId: expert.advisorId || '',
      advisorStrategy: expert.advisorStrategy || 'none',
      isOrchestrator: (() => {
        try {
          const config = JSON.parse(expert.verbindungsConfig || '{}');
          return config.isOrchestrator === true || expert.verbindungsTyp === 'ceo';
        } catch { return false; }
      })(),
      permAufgabenErstellen: editForm.permAufgabenErstellen,
      permAufgabenZuweisen: editForm.permAufgabenZuweisen,
      permGenehmigungAnfordern: editForm.permGenehmigungAnfordern,
      permGenehmigungEntscheiden: editForm.permGenehmigungEntscheiden,
      permExpertenAnwerben: editForm.permExpertenAnwerben,
    });
  }, [expert.id, expert.aktualisiertAm]); // sync on expert switch or after save

  useEffect(() => {
    setLoadingStats(true);
    authFetch(`/api/experten/${expert.id}/stats`)
      .then(r => r.json())
      .then(data => {
        setStats(data);
        setLoadingStats(false);
      })
      .catch(() => setLoadingStats(false));
  }, [expert.id]);

  // Load team status when this is an orchestrator
  useEffect(() => {
    if (!expert.isOrchestrator) return;
    const unternehmenId = aktivesUnternehmen?.id;
    if (!unternehmenId) return;
    authFetch(`/api/experten/${expert.id}/team-status`, {
      headers: { 'x-unternehmen-id': unternehmenId },
    })
      .then(r => r.json())
      .then(data => setTeamStatus(data))
      .catch(() => {});
  }, [expert.id, expert.isOrchestrator, aktivesUnternehmen?.id]);

  // OpenRouter model list
  const [orModels, setOrModels] = useState<{ id: string; name: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<{ id: string; name: string; size?: number }[]>([]);
  const [loadingOllamaModels, setLoadingOllamaModels] = useState(false);

  const loadOllamaModels = (baseUrl?: string) => {
    setLoadingOllamaModels(true);
    const url = baseUrl?.trim() || 'http://127.0.0.1:11434';
    authFetch(`/api/ollama/models?baseUrl=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then(data => { if (data?.models) setOllamaModels(data.models); })
      .catch(() => {})
      .finally(() => setLoadingOllamaModels(false));
  };

  useEffect(() => {
    if (editForm.verbindungsTyp !== 'openrouter' && editForm.verbindungsTyp !== 'ceo') return;
    setLoadingModels(true);
    fetch('https://openrouter.ai/api/v1/models')
      .then(r => r.json())
      .then(data => {
        if (data?.data) {
          const paid = data.data.filter((m: any) => {
            if (m.id.endsWith(':free')) return false;
            const p = parseFloat(m.pricing?.prompt || '0');
            const c = parseFloat(m.pricing?.completion || '0');
            return p > 0 || c > 0;
          });
          const sorted = paid.sort((a: any, b: any) => (a.name || a.id).localeCompare(b.name || b.id));
          setOrModels(sorted.map((m: any) => ({ id: m.id, name: m.name || m.id })));
        }
      })
      .catch(() => {})
      .finally(() => setLoadingModels(false));
  }, [editForm.verbindungsTyp]);

  // Load Ollama models when switching to ollama type
  useEffect(() => {
    if (editForm.verbindungsTyp !== 'ollama') return;
    loadOllamaModels(editForm.baseUrl);
  }, [editForm.verbindungsTyp]);

  const scrollToBottom = () => bottomRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => {
    if (!aktivesUnternehmen) return;

    // Chat history
    authFetch(`/api/experten/${expert.id}/chat`, { headers: { 'x-unternehmen-id': aktivesUnternehmen.id } })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setMessages(data); setLoadingChat(false); setTimeout(scrollToBottom, 500); })
      .catch(() => setLoadingChat(false));

    // Tasks
    apiAufgaben.liste(aktivesUnternehmen.id)
      .then(all => { setTasks(all.filter(t => t.zugewiesenAn === expert.id)); setLoadingTasks(false); })
      .catch(() => setLoadingTasks(false));

    // WebSocket with safe cleanup and auto-reconnect
    const _wsToken = localStorage.getItem('opencognit_token') || '';
    const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws' + (_wsToken ? `?token=${_wsToken}` : '');
    let intentionallyClosed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'chat_message') {
          const cm = msg.data;
          if (cm.unternehmenId === aktivesUnternehmen.id && cm.expertId === expert.id) {
            setMessages(prev => {
              // Dedup by real id
              if (prev.find(m => m.id === cm.id)) return prev;
              if (cm.absenderTyp === 'board') {
                // Replace optimistic pending message
                const pendingIdx = prev.findIndex(m => m._pending && m.nachricht === cm.nachricht);
                if (pendingIdx !== -1) {
                  const next = [...prev];
                  next[pendingIdx] = cm;
                  return next;
                }
              }
              if (cm.absenderTyp === 'agent') {
                // Replace HTTP-fallback message (id starts with 'direct-') that has same content
                const fallbackIdx = prev.findIndex(m =>
                  typeof m.id === 'string' && m.id.startsWith('direct-') && m.nachricht === cm.nachricht
                );
                if (fallbackIdx !== -1) {
                  const next = [...prev];
                  next[fallbackIdx] = cm; // swap in the real DB-backed message
                  return next;
                }
              }
              return [...prev, cm];
            });
            setTimeout(scrollToBottom, 50);
            if (cm.absenderTyp === 'agent') setAgentTyping(false);
          }
        }

        if (msg.type === 'experte_updated' && msg.data?.id === expert.id) {
          setExpert(prev => ({ ...prev, ...msg.data }));
        }
      } catch {}
    };

    const connect = () => {
      ws = new WebSocket(wsUrl);
      ws.onmessage = handleMessage;
      ws.onerror = () => {}; // suppress noise — onclose handles reconnect
      ws.onclose = () => {
        wsRef.current = null;
        if (!intentionallyClosed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
      wsRef.current = ws;
    };

    connect();

    return () => {
      intentionallyClosed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      } else if (ws.readyState === WebSocket.CONNECTING) {
        // Wait for open, then close — avoids "closed before established" warning
        ws.onopen = () => ws.close();
      }
      wsRef.current = null;
    };
  }, [expert.id, aktivesUnternehmen]);

  // Load Aktivität initial and when component mounts
  useEffect(() => {
    setLoadingAktivitaet(true);
    apiExperten.aktivitaet(expert.id, 100)
      .then(data => { setAktivitaet(data); setLoadingAktivitaet(false); })
      .catch(() => setLoadingAktivitaet(false));
  }, [expert.id]);

  const COMMANDS = [
    { cmd: '/help',    icon: '❓', desc: de ? 'Verfügbare Befehle anzeigen' : 'Show available commands' },
    { cmd: '/status',  icon: '📊', desc: de ? 'Agent-Status anzeigen' : 'Show agent status' },
    { cmd: '/context', icon: '🔍', desc: de ? 'Kontext & Hierarchie anzeigen' : 'Show context & hierarchy' },
    { cmd: '/task',    icon: '📋', desc: de ? 'Aufgabe erstellen: /task Titel' : 'Create task: /task title' },
    { cmd: '/pause',   icon: '⏸',  desc: de ? 'Agent pausieren' : 'Pause agent' },
    { cmd: '/resume',  icon: '▶',  desc: de ? 'Agent fortsetzen' : 'Resume agent' },
    { cmd: '/clear',   icon: '🗑',  desc: de ? 'Chat lokal leeren' : 'Clear chat locally' },
    { cmd: '/direct',  icon: '⚡', desc: de ? 'Direktmodus umschalten (schnelle LLM-Antwort)' : 'Toggle direct mode (fast LLM response)' },
  ];

  const addSystemMsg = useCallback((text: string) => {
    setMessages(prev => [...prev, { id: `sys-${Date.now()}`, absenderTyp: 'system', nachricht: text, erstelltAm: new Date().toISOString() }]);
    setTimeout(scrollToBottom, 50);
  }, []);

  const sendMessage = async () => {
    const txt = inputText.trim();
    if (!txt || !aktivesUnternehmen) return;
    setInputText('');
    setShowCommands(false);

    // ── Slash command handling ────────────────────────────────────────────
    if (txt.startsWith('/')) {
      const parts = txt.split(' ');
      const cmd = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ');

      switch (cmd) {
        case '/help':
          addSystemMsg(COMMANDS.map(c => `${c.icon} ${c.cmd} — ${c.desc}`).join('\n'));
          return;

        case '/status': {
          const budgetPct = expert.budgetMonatCent > 0 ? Math.round(expert.verbrauchtMonatCent / expert.budgetMonatCent * 100) : 0;
          addSystemMsg([
            `🤖 ${expert.name} · ${expert.rolle}`,
            `📌 Status: ${expert.status}`,
            `🔗 Engine: ${expert.verbindungsTyp}`,
            expert.budgetMonatCent > 0 ? `💰 ${de ? 'Budget' : 'Budget'}: ${budgetPct}% ${de ? 'verbraucht' : 'used'}` : '',
            expert.zyklusAktiv ? `⚡ ${de ? 'Auto-Zyklus' : 'Auto-cycle'}: ${expert.zyklusIntervallSek}s` : `⏹ ${de ? 'Auto-Zyklus: aus' : 'Auto-cycle: off'}`,
            expert.isOrchestrator ? `👑 ${de ? 'Orchestrator-Modus aktiv' : 'Orchestrator mode active'}` : '',
            directChatMode ? `⚡ ${de ? 'Direktmodus aktiv' : 'Direct mode active'}` : `🔄 ${de ? 'Heartbeat-Modus' : 'Heartbeat mode'}`,
          ].filter(Boolean).join('\n'));
          return;
        }

        case '/context': {
          const supervisor = allExperts.find(e => e.id === expert.reportsTo);
          const reports = allExperts.filter(e => e.reportsTo === expert.id);
          addSystemMsg([
            `🔍 ${de ? 'Agent-Kontext' : 'Agent Context'} · ${expert.name}`,
            supervisor ? `📤 ${de ? 'Vorgesetzter' : 'Reports to'}: ${supervisor.name} (${supervisor.rolle})` : `🏢 ${de ? 'Keine Hierarchie (autonome Einheit)' : 'No supervisor (autonomous unit)'}`,
            reports.length > 0 ? `👥 ${de ? 'Direkte Berichte' : 'Direct reports'}: ${reports.map(r => r.name).join(', ')}` : '',
            expert.isOrchestrator ? `👑 ${de ? 'Orchestrator' : 'Orchestrator'}` : '',
            `🔑 ${de ? 'Berechtigungen' : 'Permissions'}: ${de ? 'Aufgaben erstellen & empfangen, Genehmigungen anfordern' : 'create & receive tasks, request approvals'}`,
            `🌐 ${de ? 'Unternehmen' : 'Company'}: ${aktivesUnternehmen.name}`,
          ].filter(Boolean).join('\n'));
          return;
        }

        case '/task': {
          if (!arg) { addSystemMsg(`⚠️ ${de ? 'Verwendung' : 'Usage'}: /task ${de ? 'Titel der Aufgabe' : 'task title'}`); return; }
          try {
            await authFetch('/api/aufgaben', {
              method: 'POST',
              headers: { 'x-unternehmen-id': aktivesUnternehmen.id },
              body: JSON.stringify({ titel: arg, zugewiesenAn: expert.id, status: 'offen', prioritaet: 'mittel' }),
            });
            addSystemMsg(`✅ ${de ? 'Aufgabe erstellt' : 'Task created'}: "${arg}"`);
          } catch {
            addSystemMsg(`❌ ${de ? 'Fehler beim Erstellen der Aufgabe' : 'Failed to create task'}`);
          }
          return;
        }

        case '/pause':
          await handlePauseResume();
          addSystemMsg(`⏸ ${de ? 'Agent pausiert' : 'Agent paused'}`);
          return;

        case '/resume':
          await handlePauseResume();
          addSystemMsg(`▶ ${de ? 'Agent fortgesetzt' : 'Agent resumed'}`);
          return;

        case '/clear':
          setMessages([]);
          return;

        case '/direct':
          setDirectChatMode(prev => {
            const next = !prev;
            addSystemMsg(next
              ? `⚡ ${de ? 'Direktmodus aktiviert — Antworten kommen direkt vom LLM' : 'Direct mode on — responses come directly from the LLM'}`
              : `🔄 ${de ? 'Heartbeat-Modus — Agent antwortet im nächsten Zyklus' : 'Heartbeat mode — agent responds in next cycle'}`
            );
            return next;
          });
          return;

        default:
          addSystemMsg(`❓ ${de ? 'Unbekannter Befehl' : 'Unknown command'}: ${cmd}. ${de ? 'Tippe /help für eine Liste.' : 'Type /help for a list.'}`);
          return;
      }
    }

    // ── Normal message ────────────────────────────────────────────────────
    setAgentTyping(true);

    const tempMsg = { id: `pending-${Date.now()}`, absenderTyp: 'board', nachricht: txt, erstelltAm: new Date().toISOString(), _pending: true };
    setMessages(prev => [...prev, tempMsg]);
    setTimeout(scrollToBottom, 50);

    if (directChatMode) {
      // Fast direct LLM call — reply comes back in HTTP response AND via WebSocket
      // We use the HTTP response as the source of truth; WS deduplicates by id
      try {
        const res = await authFetch(`/api/experten/${expert.id}/chat/direct`, {
          method: 'POST',
          headers: { 'x-unternehmen-id': aktivesUnternehmen.id },
          body: JSON.stringify({ nachricht: txt }),
        });
        const data = await res.json();
        if (data.error === 'no_api_key') {
          setAgentTyping(false);
          addSystemMsg(`⚠️ ${data.message}`);
          return;
        }
        if (data.error) {
          setAgentTyping(false);
          addSystemMsg(`❌ ${data.message || (de ? 'Fehler beim Antworten' : 'Error generating reply')}`);
          return;
        }
        // HTTP response is authoritative — stop typing and add reply now.
        // The WS broadcast will arrive too, but the dedup check (find by id) handles that.
        setAgentTyping(false);
        // Remove any pending board message (WS may not arrive if connection dropped)
        setMessages(prev => prev.map(m => m._pending ? { ...m, _pending: false } : m));
        if (data.reply) {
          const replyMsg = {
            id: `direct-${Date.now()}`,
            absenderTyp: 'agent',
            nachricht: data.reply,
            erstelltAm: new Date().toISOString(),
          };
          setMessages(prev => {
            // Don't add if WS already delivered an agent reply for this exchange
            // (WS delivers with a real DB id, so it won't match 'direct-*')
            if (prev.some(m => m.absenderTyp === 'agent' && m.nachricht === data.reply)) return prev;
            return [...prev, replyMsg];
          });
          setTimeout(scrollToBottom, 50);
        }
      } catch {
        setAgentTyping(false);
        addSystemMsg(`❌ ${de ? 'Verbindungsfehler' : 'Connection error'}`);
      }
    } else {
      // Heartbeat-triggered response (legacy — only used if user manually switches off direct mode)
      await authFetch(`/api/experten/${expert.id}/chat`, {
        method: 'POST',
        headers: { 'x-unternehmen-id': aktivesUnternehmen.id },
        body: JSON.stringify({ nachricht: txt }),
      });
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    if (val.startsWith('/') && !val.includes(' ')) {
      setCommandFilter(val.slice(1).toLowerCase());
      setShowCommands(true);
    } else {
      setShowCommands(false);
    }
    // Auto-resize textarea
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setShowCommands(false); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = (ev.target?.result as string) || '';
      const snippet = content.length > 4000 ? content.slice(0, 4000) + '\n...(truncated)' : content;
      setInputText(prev => (prev ? prev + '\n\n' : '') + `📎 ${file.name}:\n\`\`\`\n${snippet}\n\`\`\``);
      setTimeout(() => inputRef.current?.focus(), 50);
    };
    reader.readAsText(file);
  };

  const handlePauseResume = async () => {
    try {
      if (expert.status === 'paused') {
        await apiExperten.fortsetzen(expert.id);
        setExpert(prev => ({ ...prev, status: 'idle' }));
      } else {
        await apiExperten.pausieren(expert.id);
        setExpert(prev => ({ ...prev, status: 'paused' }));
      }
    } catch {}
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const updated = await apiExperten.aktualisieren(expert.id, {
        name: editForm.name,
        rolle: editForm.rolle,
        titel: editForm.titel,
        faehigkeiten: editForm.faehigkeiten,
        verbindungsTyp: editForm.verbindungsTyp as any,
        verbindungsConfig: JSON.stringify({
          model: editForm.modell,
          autonomyLevel: editForm.autonomyLevel,
          baseUrl: editForm.baseUrl || undefined,
          workDir: editForm.workDir || undefined,
          isOrchestrator: editForm.isOrchestrator,
        }),
        isOrchestrator: editForm.isOrchestrator,
        budgetMonatCent: editForm.budgetMonatCent * 100,
        zyklusAktiv: editForm.zyklusAktiv,
        zyklusIntervallSek: editForm.zyklusIntervallSek,
        reportsTo: editForm.reportsTo || null,
        systemPrompt: editForm.systemPrompt || null,
        advisorId: editForm.advisorId || null,
        advisorStrategy: editForm.advisorStrategy as any,
      });

      // Save Permissions
      await authFetch(`/api/mitarbeiter/${expert.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({
          darfAufgabenErstellen: editForm.permAufgabenErstellen,
          darfAufgabenZuweisen: editForm.permAufgabenZuweisen,
          darfGenehmigungAnfordern: editForm.permGenehmigungAnfordern,
          darfGenehmigungEntscheiden: editForm.permGenehmigungEntscheiden,
          darfExpertenAnwerben: editForm.permExpertenAnwerben,
        })
      });

      // Sync Skill Library assignments
      try {
        const currentRes = await authFetch(`/api/experten/${expert.id}/skills-library`);
        if (currentRes.ok) {
          const currentData = await currentRes.json();
          const currentIds = currentData.map((s: any) => s.id);
          const toAdd = selectedSkills.filter(id => !currentIds.includes(id));
          const toRemove = currentIds.filter((id: string) => !selectedSkills.includes(id));

          for (const skillId of toAdd) {
            await authFetch(`/api/experten/${expert.id}/skills-library`, {
              method: 'POST',
              body: JSON.stringify({ skillId })
            });
          }
          for (const skillId of toRemove) {
            await authFetch(`/api/experten/${expert.id}/skills-library/${skillId}`, {
              method: 'DELETE'
            });
          }
        }
      } catch (e) {
        console.error('Skill Sync Error:', e);
      }

      setExpert(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      toastCtx.success(de ? 'Einstellungen gespeichert' : 'Settings saved', expert.name);
      onUpdated?.();
    } catch (err: any) {
      setSaveError(err?.message || 'Fehler');
      toastCtx.error(de ? 'Fehler beim Speichern' : 'Save failed', err?.message);
    }
    setSavingSettings(false);
  };

  const handleDelete = async () => {
    setDeleteError(null);
    try {
      await apiExperten.loeschen(expert.id);
      toastCtx.info(
        de ? `${expert.name} entlassen` : `${expert.name} dismissed`,
        de ? 'Agent und alle zugehörigen Daten wurden gelöscht' : 'Agent and all associated data have been deleted',
      );
      onDeleted?.();
      onClose();
    } catch (err: any) {
      setDeleteError(err?.message || 'Fehler');
      setDeleteConfirm(false);
    }
  };

  const activeTasks = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled');
  const completedTasks = tasks.filter(t => t.status === 'done').slice(0, 10);
  const budgetPercent = expert.budgetMonatCent > 0 ? Math.round((expert.verbrauchtMonatCent / expert.budgetMonatCent) * 100) : 0;

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', zIndex: 9998 }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0,
        width: 'min(1200px, 98vw)',
        background: 'rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(24px) saturate(160%)',
        borderLeft: '1px solid rgba(255, 255, 255, 0.1)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'row',
        boxShadow: '-20px 0 60px rgba(0,0,0,0.9)',
        animation: 'slideInRight 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }}>

        {/* ═══ LINKES PANEL (60%) ═══ */}
        <div style={{ width: '60%', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          {/* Header */}
          <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--color-border)', background: 'rgba(255,255,255,0.02)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 56, height: 56, fontSize: 22, borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', background: expert.avatarFarbe + '22', color: expert.avatarFarbe }}>
                {expert.avatar || <Bot size={24} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{expert.name}</h3>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '2px 10px',
                    borderRadius: 20, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    background: (statusColor[expert.status] || '#888') + '22',
                    color: statusColor[expert.status] || '#888',
                    border: `1px solid ${(statusColor[expert.status] || '#888')}44`,
                  }}>
                    {expert.status}
                  </div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 500 }}>{expert.rolle}</span>
                  <span style={{ opacity: 0.4 }}>•</span>
                  <span>{verbindungsLabels[expert.verbindungsTyp]?.[i18n.language] || expert.verbindungsTyp}</span>
                </div>
                
                {/* Advisor Badge */}
                {expert.advisorId && (
                  <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ 
                      display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', 
                      borderRadius: '8px', background: 'rgba(168, 85, 247, 0.1)', 
                      border: '1px solid rgba(168, 85, 247, 0.2)', fontSize: '10px', 
                      fontWeight: 600, color: '#a855f7', textTransform: 'uppercase'
                    }}>
                      <UserCheck size={10} />
                      {de ? 'Advisor Aktiv' : 'Advisor Active'}
                    </div>
                    {expert.advisorStrategy === 'planning' && (
                      <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', opacity: 0.7 }}>
                        {de ? 'Planung & Coaching' : 'Planning & Coaching'}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={handlePauseResume}>
                {expert.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
            {([
              { id: 'überblick', label: de ? 'Übersicht' : 'Overview', icon: LayoutDashboard },
              { id: 'monitor', label: de ? 'Monitor' : 'Monitor', icon: Monitor },
              { id: 'glass', label: 'Glass Agent', icon: Eye },
              { id: 'aktivitaet', label: de ? 'Aktivität' : 'Activity', icon: Activity },
              { id: 'einstellungen', label: de ? 'Einstellungen' : 'Settings', icon: Settings },
              { id: 'skills', label: de ? 'Skills' : 'Skills', icon: Wrench },
              { id: 'soul', label: 'SOUL', icon: Sparkles },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, padding: '14px 0', background: 'none', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  color: activeTab === tab.id ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                  borderBottom: activeTab === tab.id ? '2px solid var(--color-accent)' : '2px solid transparent',
                  fontWeight: activeTab === tab.id ? 700 : 500, fontSize: 13, transition: 'all 0.15s'
                }}
              >
                <tab.icon size={15} /> {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {activeTab === 'überblick' && (
              <div style={{ padding: 28 }}>
                {loadingStats ? (
                  <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>{de ? 'Statistiken werden geladen...' : 'Loading statistics...'}</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                    
                    {/* Latest Run Card */}
                    {stats?.latestRun && (
                      <div style={{ background: 'rgba(35, 205, 202, 0.05)', border: '1px solid rgba(35, 205, 202, 0.2)', borderRadius: 16, padding: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ 
                              padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                              background: stats.latestRun.status === 'succeeded' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: stats.latestRun.status === 'succeeded' ? '#10b981' : '#ef4444'
                            }}>
                              {stats.latestRun.status === 'succeeded' ? (de ? '✓ Erfolg' : '✓ Success') : (de ? '✗ Fehler' : '✗ Failed')}
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{zeitRelativ(stats.latestRun.erstelltAm, i18n.language)}</span>
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 6 }}>
                             #{stats.latestRun.id.slice(0, 8)}
                          </span>
                        </div>
                        <div style={{ fontSize: 14, lineHeight: 1.6, color: '#e4e4e7', fontStyle: 'italic' }}>
                          "{stats.latestRun.ausgabe || (de ? 'Keine Ausgabe.' : 'No output.')}"
                        </div>
                      </div>
                    )}

                    {/* Advisor Card in Overview */}
                    {expert.advisorId && (() => {
                      const lastPlan = aktivitaet.find(a => a.aktion === 'advisor_plan_created');
                      return (
                        <div style={{ background: 'rgba(168, 85, 247, 0.05)', border: '1px solid rgba(168, 85, 247, 0.15)', borderRadius: 16, padding: 20 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(168, 85, 247, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a855f7' }}>
                              <UserCheck size={20} />
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#e4e4e7' }}>{de ? 'Strategische Führung' : 'Strategic Lead'}</div>
                              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{de ? 'Advisor zugewiesen' : 'Advisor assigned'}</div>
                            </div>
                          </div>
                          
                          {lastPlan && (
                            <div style={{ marginTop: 8, padding: 12, borderRadius: 12, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(168, 85, 247, 0.2)', fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic', lineHeight: 1.5 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: '#a855f7', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                <Zap size={12} />
                                {de ? 'Advisor Direktive' : 'Advisor Directive'}
                              </div>
                              {lastPlan.details && (() => {
                                const details = JSON.parse(lastPlan.details);
                                const plan = details.plan || "";
                                return plan.startsWith('```json') ? (
                                  <pre style={{ margin: 0, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 6, fontSize: 11, overflowX: 'auto', fontStyle: 'normal' }}>
                                    {plan.replace(/```json|```/g, '').trim()}
                                  </pre>
                                ) : (
                                  plan
                                );
                              })()}
                            </div>
                          )}

                          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 10, marginTop: lastPlan ? 16 : 0 }}>
                            {de 
                              ? `Dieser Agent wird von einem Advisor unterstützt. Bevor er Aufgaben ausführt, konsultiert er seinen Advisor für eine strategische Planung.`
                              : `This agent is supported by an advisor. Before executing tasks, it consults its advisor for strategic planning.`
                            }
                          </div>
                        </div>
                      );
                    })()}

                    {/* Orchestrator Team Panel */}
                    {expert.isOrchestrator && teamStatus && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* Team Header */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#D4AF37' }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#D4AF37', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                              {de ? 'Team-Status' : 'Team Status'}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 4 }}>
                              {teamStatus.team.length} {de ? 'Berichte' : 'reports'}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              const unternehmenId = aktivesUnternehmen?.id;
                              if (!unternehmenId) return;
                              authFetch(`/api/experten/${expert.id}/team-status`, { headers: { 'x-unternehmen-id': unternehmenId } })
                                .then(r => r.json()).then(setTeamStatus).catch(() => {});
                            }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4, display: 'flex', fontSize: 10, alignItems: 'center', gap: 4 }}
                          >
                            ↻ {de ? 'Aktualisieren' : 'Refresh'}
                          </button>
                        </div>

                        {/* Team Members */}
                        {teamStatus.team.length === 0 ? (
                          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12, background: 'rgba(212,175,55,0.03)', border: '1px dashed rgba(212,175,55,0.15)', borderRadius: 12 }}>
                            {de ? 'Keine direkten Berichte.' : 'No direct reports.'}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {teamStatus.team.map((member: any) => {
                              const statusColors: Record<string, string> = { active: '#23CDCB', running: '#3b82f6', idle: '#52525b', paused: '#f59e0b', error: '#ef4444', terminated: '#6b7280' };
                              const statusDot = statusColors[member.status] || '#52525b';
                              const lastSeen = member.letzterZyklus
                                ? (() => { const d = Date.now() - new Date(member.letzterZyklus).getTime(); const m = Math.floor(d/60000); return m < 60 ? `${m}m` : `${Math.floor(m/60)}h`; })()
                                : '—';
                              return (
                                <div key={member.id} style={{
                                  background: 'rgba(212,175,55,0.04)',
                                  border: '1px solid rgba(212,175,55,0.12)',
                                  borderRadius: 12,
                                  padding: '12px 14px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 12,
                                }}>
                                  {/* Status Dot */}
                                  <div style={{
                                    width: 8, height: 8, borderRadius: '50%',
                                    background: statusDot, flexShrink: 0,
                                    boxShadow: member.status === 'running' ? `0 0 6px ${statusDot}` : 'none',
                                  }} />
                                  {/* Info */}
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                      <span style={{ fontSize: 13, fontWeight: 600, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {member.name}
                                      </span>
                                      <span style={{ fontSize: 10, color: 'var(--color-text-muted)', flexShrink: 0 }}>{member.rolle}</span>
                                    </div>
                                    {member.topTask ? (
                                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        ↳ {member.topTask.titel}
                                      </div>
                                    ) : (
                                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{de ? 'Keine aktiven Aufgaben' : 'No active tasks'}</div>
                                    )}
                                  </div>
                                  {/* Stats */}
                                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                                    <span style={{ fontSize: 10, color: '#23CDCB', fontWeight: 600 }}>
                                      {member.activeTasks.length} {de ? 'aktiv' : 'active'}
                                    </span>
                                    <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                                      {de ? 'vor' : ''} {lastSeen} {de ? '' : 'ago'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Unassigned Tasks */}
                        {teamStatus.unassigned.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                              {de ? `${teamStatus.unassigned.length} nicht zugewiesen` : `${teamStatus.unassigned.length} unassigned`}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {teamStatus.unassigned.slice(0, 5).map((task: any) => (
                                <div key={task.id} style={{
                                  background: 'rgba(245,158,11,0.04)',
                                  border: '1px solid rgba(245,158,11,0.15)',
                                  borderRadius: 10, padding: '8px 12px',
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', flexShrink: 0 }}>
                                      {task.prioritaet}
                                    </span>
                                    <span style={{ fontSize: 12, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {task.titel}
                                    </span>
                                  </div>
                                  <span style={{ fontSize: 9, color: 'var(--color-text-muted)', flexShrink: 0 }}>
                                    {task.id.slice(0, 6)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Charts Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      <ChartCard title={de ? 'Aktivität' : 'Activity'} subtitle={de ? 'Letzte 14 Tage' : 'Last 14 days'}>
                        <RunActivityChart runs={stats?.arbeitszyklen || []} emptyLabel={de ? 'Noch keine Zyklen' : 'No runs yet'} />
                      </ChartCard>
                      <ChartCard title={de ? 'Erfolgsquote' : 'Success Rate'} subtitle={de ? 'Erfolg / Gesamt' : 'Succeed / Total'}>
                        <SuccessRateChart runs={stats?.arbeitszyklen || []} emptyLabel={de ? 'Noch keine Daten' : 'No data yet'} />
                      </ChartCard>
                      <ChartCard title={de ? 'Prioritäten' : 'Priorities'} subtitle={de ? 'Nach Wichtigkeit' : 'By importance'}>
                        <PriorityChart tasks={stats?.aufgaben || []} emptyLabel={de ? 'Keine Aufgaben' : 'No tasks'} />
                      </ChartCard>
                      <ChartCard title={de ? 'Status' : 'Status'} subtitle={de ? 'Aufgaben-Fortschritt' : 'Task progress'}>
                        <StatusChart tasks={stats?.aufgaben || []} emptyLabel={de ? 'Keine Aufgaben' : 'No tasks'} />
                      </ChartCard>
                    </div>

                    {/* Skill Radar */}
                    {skillsLibrary.length > 0 && selectedSkills.length >= 3 && (() => {
                      const assigned = skillsLibrary.filter(s => selectedSkills.includes(s.id));
                      if (assigned.length < 3) return null;
                      return (
                        <div style={{ background: 'rgba(35,205,202,0.03)', border: '1px solid rgba(35,205,202,0.12)', borderRadius: 16, padding: 20 }}>
                          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>
                            {de ? 'Skill-Profil' : 'Skill Profile'}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
                            <div style={{ maxWidth: 200, margin: '0 auto', width: '100%' }}>
                              <SkillRadarChart skills={assigned.map(s => ({ name: s.name, konfidenz: s.konfidenz }))} />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {assigned.map(s => (
                                <div key={s.id}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{s.name}</span>
                                    <span style={{ fontSize: 10, color: 'var(--color-accent)' }}>{s.konfidenz}%</span>
                                  </div>
                                  <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 2, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${s.konfidenz}%`, background: 'linear-gradient(90deg, #23CDCB, #26e6e2)', borderRadius: 2, transition: 'width 0.6s ease' }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Skill badges (< 3 skills) */}
                    {skillsLibrary.length > 0 && selectedSkills.length > 0 && selectedSkills.length < 3 && (
                      <div style={{ background: 'rgba(35,205,202,0.03)', border: '1px solid rgba(35,205,202,0.12)', borderRadius: 16, padding: 20 }}>
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>
                          {de ? 'Skill-Profil' : 'Skill Profile'}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {skillsLibrary.filter(s => selectedSkills.includes(s.id)).map(s => (
                            <span key={s.id} style={{ padding: '5px 12px', background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.3)', borderRadius: 20, fontSize: 12, color: '#23CDCB', fontWeight: 600 }}>
                              {s.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Recent Tasks List */}
                    <div>
                      <h4 style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16 }}>
                        {de ? 'Letzte Aufgaben' : 'Recent Tasks'}
                      </h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {stats?.recentTasks?.length === 0 && <div style={{ fontSize: 12, opacity: 0.5 }}>{de ? 'Keine Aufgaben gefunden' : 'No tasks found'}</div>}
                        {stats?.recentTasks?.map((task: any) => (
                          <div key={task.id} style={{ 
                            padding: '12px 16px', background: 'var(--color-bg-secondary)', borderRadius: 12, border: '1px solid var(--color-border)', 
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between' 
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: task.status === 'done' ? '#10b981' : task.status === 'in_progress' ? '#3b82f6' : '#6b7280' }} />
                              <span style={{ fontSize: 13, fontWeight: 500 }}>{task.titel}</span>
                            </div>
                            <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{zeitRelativ(task.erstelltAm, i18n.language)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            )}

            {activeTab === 'monitor' && (
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* ── Stat Cards ── */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  {/* Budget */}
                  {expert.verbindungsTyp !== 'ollama' ? (
                    <div style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${budgetPercent > 90 ? 'rgba(239,68,68,0.6)' : 'rgba(35,205,202,0.4)'},transparent)`, borderRadius: '14px 14px 0 0' }} />
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Wallet size={10} /> {de ? 'Budget' : 'Budget'}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: budgetPercent > 90 ? 'var(--color-error)' : 'var(--color-accent)', fontVariantNumeric: 'tabular-nums' }}>{budgetPercent}%</div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.6, marginTop: 2 }}>{centZuEuro(expert.verbrauchtMonatCent, i18n.language)}</div>
                      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(budgetPercent, 100)}%`, background: budgetPercent > 90 ? 'rgba(239,68,68,0.8)' : 'rgba(35,205,202,0.8)', borderRadius: 2, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  ) : (
                    <div style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '14px 16px' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Ollama</div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--color-accent)' }}>Local</div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.6, marginTop: 2 }}>{de ? 'Kostenlos' : 'Free'}</div>
                    </div>
                  )}

                  {/* Tasks */}
                  <div style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 14, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,rgba(35,205,202,0.4),transparent)', borderRadius: '14px 14px 0 0' }} />
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{de ? 'Aufgaben' : 'Tasks'}</div>
                    <div style={{ fontWeight: 800, fontSize: 24, color: 'var(--color-accent)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{activeTasks.length}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.6, marginTop: 4 }}>{completedTasks.length} {de ? 'erledigt' : 'done'}</div>
                  </div>

                  {/* Cycle */}
                  <div style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))', border: `1px solid ${expert.zyklusAktiv ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 14, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${expert.zyklusAktiv ? 'rgba(35,205,202,0.5)' : 'rgba(107,114,128,0.3)'},transparent)`, borderRadius: '14px 14px 0 0' }} />
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Zap size={10} /> {de ? 'Zyklus' : 'Cycle'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {expert.zyklusAktiv && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#23CDCB', boxShadow: '0 0 6px rgba(35,205,202,0.8)', animation: 'pulse-dot 2s ease-in-out infinite' }} />}
                      <div style={{ fontWeight: 700, fontSize: 13, color: expert.zyklusAktiv ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
                        {expert.zyklusAktiv ? (de ? 'Aktiv' : 'Active') : (de ? 'Aus' : 'Off')}
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.55, marginTop: 4 }}>
                      {expert.letzterZyklus ? zeitRelativ(expert.letzterZyklus, i18n.language) : '—'}
                    </div>
                  </div>
                </div>

                {/* ── Active Tasks ── */}
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>{de ? 'Aktive Aufgaben' : 'Active Tasks'}</span>
                    {activeTasks.length > 0 && <span style={{ color: 'var(--color-accent)', fontWeight: 800 }}>{activeTasks.length}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {activeTasks.length === 0 ? (
                      <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)', opacity: 0.4, border: '1px dashed rgba(255,255,255,0.07)', borderRadius: 12 }}>
                        {de ? 'Keine aktiven Aufgaben' : 'No active tasks'}
                      </div>
                    ) : activeTasks.slice(0, 8).map(t => {
                      const prioColor: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#23CDCB', low: '#6b7280' };
                      const statusIcon: Record<string, string> = { offen: '○', todo: '○', in_progress: '◑', in_review: '◐', blocked: '✕' };
                      return (
                        <div key={t.id} style={{ padding: '10px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 14, color: prioColor[t.prioritaet] || '#6b7280', flexShrink: 0 }}>{statusIcon[t.status] || '○'}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.titel}</div>
                            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.55, marginTop: 2 }}>{t.status.replace(/_/g, ' ')}</div>
                          </div>
                          <div style={{ fontSize: 9, padding: '2px 7px', borderRadius: 6, background: `${prioColor[t.prioritaet] || '#6b7280'}18`, color: prioColor[t.prioritaet] || '#6b7280', fontWeight: 700, flexShrink: 0 }}>
                            {t.prioritaet}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* ── Completed Tasks ── */}
                {completedTasks.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
                      {de ? 'Zuletzt erledigt' : 'Recently done'}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {completedTasks.slice(0, 5).map(t => (
                        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <span style={{ color: '#23CDCB', fontSize: 12, flexShrink: 0 }}>✓</span>
                          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', opacity: 0.5, textDecoration: 'line-through', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.titel}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'aktivitaet' && (
              <div style={{ padding: 28 }}>
                <h4 style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 20 }}>{de ? 'Protokoll' : 'Logs'}</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {aktivitaet.map(a => (
                    <div key={a.id} style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                      <div style={{ opacity: 0.5, whiteSpace: 'nowrap' }}>{zeitRelativ(a.erstelltAm, i18n.language)}</div>
                      <div style={{ flex: 1 }}>{a.aktion}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'glass' && (
              <div style={{ padding: 28 }}>
                <GlassAgentPanel expertId={expert.id} expertName={expert.name} embedded />
              </div>
            )}

            {activeTab === 'einstellungen' && (
              <div style={{ padding: 28 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  
                  {/* --- ALLGEMEIN --- */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>Name</label>
                        <input className="input" style={{ width: '100%' }} value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>Rolle</label>
                        <input className="input" style={{ width: '100%' }} value={editForm.rolle} onChange={e => setEditForm(f => ({ ...f, rolle: e.target.value }))} />
                      </div>
                    </div>
                    
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>{de ? 'Spezifische Expertise' : 'Specific Expertise'}</label>
                      <textarea className="input" rows={2} style={{ width: '100%', resize: 'none' }} value={editForm.faehigkeiten} onChange={e => setEditForm(f => ({ ...f, faehigkeiten: e.target.value }))} />
                    </div>
                  </div>

                  {/* CEO MODE TOGGLE */}
                  <div 
                    style={{ 
                      background: editForm.isOrchestrator ? 'rgba(212, 175, 55, 0.08)' : 'rgba(255, 255, 255, 0.03)', 
                      border: `1px solid ${editForm.isOrchestrator ? 'rgba(212, 175, 55, 0.4)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: '20px', padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      transition: 'all 0.3s ease', cursor: 'pointer',
                      boxShadow: editForm.isOrchestrator ? '0 10px 40px rgba(212, 175, 55, 0.1)' : 'none'
                    }}
                    onClick={() => setEditForm(f => ({ ...f, isOrchestrator: !f.isOrchestrator }))}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                      <div style={{ 
                        width: '44px', height: '44px', borderRadius: '14px', background: editForm.isOrchestrator ? 'rgba(212, 175, 55, 0.15)' : 'rgba(255,255,255,0.05)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: editForm.isOrchestrator ? '#D4AF37' : '#71717a'
                      }}>
                        <Shield size={22} />
                      </div>
                      <div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: editForm.isOrchestrator ? '#fff' : '#71717a' }}>
                          {de ? 'Firmen-Orchestrator (CEO Mode)' : 'Company Orchestrator (CEO Mode)'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                          {de ? 'Primärer Kontakt für Telegram & autonomes Team-Management' : 'Primary contact for Telegram & autonomous team management'}
                        </div>
                      </div>
                    </div>
                    <div style={{ 
                      width: '48px', height: '26px', borderRadius: '13px', background: editForm.isOrchestrator ? '#D4AF37' : 'rgba(255,255,255,0.1)',
                      padding: '3px', position: 'relative', transition: 'background 0.3s'
                    }}>
                      <div style={{ 
                        width: '20px', height: '20px', borderRadius: '10px', background: '#fff',
                        position: 'absolute', left: editForm.isOrchestrator ? '25px' : '3px', transition: 'left 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
                      }} />
                    </div>
                  </div>

                  {/* --- VERBINDUNG & ENGINE --- */}
                  <div style={{ padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <Zap size={15} style={{ color: 'var(--color-accent)' }} />
                      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{de ? 'KI-Engine & Modell' : 'AI Engine & Model'}</h4>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 6 }}>{de ? 'Verbindung' : 'Connection'}</label>
                        <Select
                          value={editForm.verbindungsTyp}
                          onChange={v => setEditForm(f => ({ ...f, verbindungsTyp: v as any }))}
                          options={[
                            { value: 'claude-code', label: de ? '⚡ Claude Code CLI (Pro/Max-Abo)' : '⚡ Claude Code CLI (Pro/Max plan)' },
                            { value: 'openrouter', label: 'OpenRouter' },
                            { value: 'anthropic', label: 'Anthropic Claude' },
                            { value: 'openai', label: 'OpenAI GPT' },
                            { value: 'custom', label: de ? '🔌 Custom API (OpenAI-kompatibel)' : '🔌 Custom API (OpenAI-compatible)' },
                            { value: 'ollama', label: de ? 'Ollama (Lokal)' : 'Ollama (Local)' },
                            { value: 'ollama_cloud', label: '☁️ Ollama (Cloud / Remote)' },
                            { value: 'bash', label: 'Bash Script' },
                            { value: 'http', label: 'HTTP Webhook' },
                          ]}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 6 }}>{de ? 'Modell / URL' : 'Model / URL'}</label>
                        {editForm.verbindungsTyp === 'openrouter' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {!editForm.modell && (
                              <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                                borderRadius: 8, padding: '6px 10px', fontSize: 11.5,
                              }}>
                                <span style={{ color: '#f59e0b' }}>⚡ Kein Modell gewählt — nutzt Auto Free</span>
                                <button
                                  type="button"
                                  onClick={() => setEditForm(f => ({ ...f, modell: 'auto:free' }))}
                                  style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                                >
                                  Setzen
                                </button>
                              </div>
                            )}
                            <OpenRouterModelPicker
                              models={orModels}
                              value={editForm.modell}
                              onChange={v => setEditForm(f => ({ ...f, modell: v }))}
                              de={de}
                            />
                            {editForm.isOrchestrator && (
                              <div style={{ fontSize: 10, color: 'var(--color-accent)', opacity: 0.8, background: 'rgba(35, 205, 202, 0.1)', padding: '4px 8px', borderRadius: 4 }}>
                                {de ? 'Tipp: High-End Modell empfohlen (z.B. Claude 3.5 Sonnet).' : 'Tip: High-end model recommended (e.g. Claude 3.5 Sonnet).'}
                              </div>
                            )}
                          </div>
                        ) : (editForm.verbindungsTyp === 'ollama') ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              {ollamaModels.length > 0 ? (
                                <select
                                  value={editForm.modell}
                                  onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))}
                                  style={{
                                    flex: 1,
                                    padding: '8px 12px',
                                    borderRadius: 10,
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    background: 'rgba(255,255,255,0.05)',
                                    color: 'var(--color-text-primary)',
                                    fontSize: 14,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {ollamaModels.map(m => (
                                    <option key={m.id} value={m.id} style={{ background: '#1a1a2e' }}>
                                      {m.name}{m.size ? ` (${(m.size / 1e9).toFixed(1)} GB)` : ''}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input
                                  className="input"
                                  style={{ flex: 1 }}
                                  value={editForm.modell}
                                  placeholder={loadingOllamaModels ? 'Lade Ollama-Modelle...' : 'z.B. qwen3.5:latest'}
                                  onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))}
                                />
                              )}
                              <button
                                onClick={() => loadOllamaModels(editForm.baseUrl)}
                                disabled={loadingOllamaModels}
                                title={de ? 'Modelle aktualisieren' : 'Refresh models'}
                                style={{
                                  padding: '8px 12px',
                                  borderRadius: 10,
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  background: 'rgba(255,255,255,0.05)',
                                  color: 'var(--color-accent)',
                                  cursor: loadingOllamaModels ? 'wait' : 'pointer',
                                  fontSize: 16,
                                  lineHeight: 1,
                                }}
                              >
                                {loadingOllamaModels ? '⏳' : '🔄'}
                              </button>
                            </div>
                            {ollamaModels.length === 0 && !loadingOllamaModels && (
                              <div style={{ fontSize: 11, color: '#ef4444', padding: '4px 8px', background: 'rgba(239,68,68,0.08)', borderRadius: 6 }}>
                                {de ? '⚠ Ollama nicht erreichbar — URL prüfen & aktualisieren' : '⚠ Ollama not reachable — check URL & refresh'}
                              </div>
                            )}
                            {ollamaModels.length > 0 && (
                              <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                                {ollamaModels.length} {de ? 'lokale Modelle gefunden' : 'local models found'}
                              </div>
                            )}
                          </div>
                        ) : (editForm.verbindungsTyp === 'claude-code') ? (
                          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '8px 12px', borderRadius: 8, background: 'rgba(35,205,202,0.07)', border: '1px solid rgba(35,205,202,0.15)' }}>
                            ⚡ {de ? 'Nutzt dein Claude Pro/Max-Abo — kein API Key nötig' : 'Uses your Claude Pro/Max plan — no API key needed'}
                          </div>
                        ) : (editForm.verbindungsTyp === 'anthropic') ? (
                          <select
                            value={editForm.modell}
                            onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-primary)', fontSize: 14, cursor: 'pointer' }}
                          >
                            <option value="claude-haiku-4-5-20251001" style={{ background: '#1a1a2e' }}>⚡ Claude Haiku 4.5 — schnell &amp; günstig</option>
                            <option value="claude-sonnet-4-6" style={{ background: '#1a1a2e' }}>✨ Claude Sonnet 4.6 — ausgewogen (empfohlen)</option>
                            <option value="claude-opus-4-6" style={{ background: '#1a1a2e' }}>🧠 Claude Opus 4.6 — stärkste Reasoning</option>
                            <option value="claude-3-5-sonnet-20241022" style={{ background: '#1a1a2e' }}>claude-3-5-sonnet-20241022</option>
                            <option value="claude-3-5-haiku-20241022" style={{ background: '#1a1a2e' }}>claude-3-5-haiku-20241022</option>
                          </select>
                        ) : (editForm.verbindungsTyp === 'openai') ? (
                          <select
                            value={editForm.modell}
                            onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))}
                            style={{ width: '100%', padding: '8px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-primary)', fontSize: 14, cursor: 'pointer' }}
                          >
                            <option value="gpt-4o-mini" style={{ background: '#1a1a2e' }}>⚡ GPT-4o mini — schnell &amp; günstig</option>
                            <option value="gpt-4o" style={{ background: '#1a1a2e' }}>✨ GPT-4o — ausgewogen (empfohlen)</option>
                            <option value="o4-mini" style={{ background: '#1a1a2e' }}>🧠 o4-mini — Reasoning</option>
                            <option value="o3" style={{ background: '#1a1a2e' }}>🔬 o3 — stärkstes Reasoning</option>
                            <option value="gpt-4-turbo" style={{ background: '#1a1a2e' }}>gpt-4-turbo</option>
                          </select>
                        ) : (editForm.verbindungsTyp === 'custom') ? (
                          <input
                            className="input"
                            style={{ width: '100%' }}
                            placeholder="z.B. llama3-70b-8192, mistral-large-latest, …"
                            value={editForm.modell}
                            onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))}
                          />
                        ) : (
                          <input className="input" style={{ width: '100%' }} value={editForm.modell} onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))} />
                        )}
                      </div>
                    </div>

                    {editForm.verbindungsTyp === 'claude-code' && (
                      <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 10, background: 'rgba(35,205,202,0.05)', border: '1px solid rgba(35,205,202,0.12)', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                        💡 {de ? 'Arbeitsverzeichnis wird aus den globalen Einstellungen übernommen.' : 'Working directory is taken from global Settings.'}
                      </div>
                    )}

                    {(editForm.verbindungsTyp === 'ollama' || editForm.verbindungsTyp === 'openai' || editForm.verbindungsTyp === 'custom') && (
                      <div style={{ marginTop: 16, padding: '12px 16px', borderRadius: 12, background: 'rgba(56, 189, 248, 0.05)', border: '1px solid rgba(56, 189, 248, 0.1)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <Globe size={14} style={{ color: 'var(--color-accent)' }} />
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1 }}>
                            {editForm.verbindungsTyp === 'custom'
                              ? (de ? 'API Base URL' : 'API Base URL')
                              : (de ? 'Basis-URL (Optional für Relay/Cloud)' : 'Base URL (Optional for Relay/Cloud)')}
                          </label>
                        </div>
                        <input
                          className="input"
                          style={{ width: '100%' }}
                          placeholder={editForm.verbindungsTyp === 'custom' ? (globalCustomBaseUrl ? `${globalCustomBaseUrl} (Global)` : 'https://api.groq.com/openai/v1') : editForm.verbindungsTyp === 'openai' ? 'z.B. https://api.groq.com/openai/v1' : 'z.B. http://1.2.3.4:11434'}
                          value={editForm.baseUrl}
                          onChange={e => setEditForm(f => ({ ...f, baseUrl: e.target.value }))}
                        />
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6 }}>
                          {editForm.verbindungsTyp === 'custom'
                            ? (globalCustomBaseUrl && !editForm.baseUrl
                                ? <span style={{ color: '#23CDCB' }}>{de ? `Globale URL aktiv: ${globalCustomBaseUrl}` : `Using global URL: ${globalCustomBaseUrl}`}</span>
                                : (de ? 'OpenAI-kompatibler Endpunkt. Leer = Wert aus den globalen Einstellungen.' : 'OpenAI-compatible endpoint. Empty = value from global Settings.'))
                            : (de ? 'Leer lassen, um den Standard-Endpoint zu nutzen.' : 'Leave empty to use the default endpoint.')}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* --- HIERARCHIE & AUTONOMIE --- */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                         <Shield size={12} style={{ marginRight: 6 }} />
                         {de ? 'Autonomie-Level' : 'Autonomy Level'}
                      </label>
                      <Select
                        value={editForm.autonomyLevel}
                        onChange={v => setEditForm(f => ({ ...f, autonomyLevel: v }))}
                        options={[
                          { value: 'copilot', label: de ? '🛡️ Copilot (Bestätigung nötig)' : '🛡️ Copilot (Approval needed)' },
                          { value: 'teamplayer', label: de ? '🤝 Teamplayer (Semi-Autonom)' : '🤝 Teamplayer (Semi-Autonomous)' },
                          { value: 'autonomous', label: de ? '🚀 Autonom (Volle Freiheit)' : '🚀 Autonomous (Full Freedom)' },
                        ]}
                      />
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.4 }}>
                        {de ? 'Bestimmt, wie viel Freiheit der Agent bei der Ausführung von Aufgaben hat.' : 'Defines how much freedom the agent has when executing tasks.'}
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                        <UserCheck size={12} style={{ marginRight: 6 }} />
                        {de ? 'Vorgesetzter' : 'Reports To'}
                      </label>
                      <Select
                        value={editForm.reportsTo}
                        onChange={v => setEditForm(f => ({ ...f, reportsTo: v }))}
                        options={[
                          { value: '', label: de ? '— Keiner —' : '— None —' },
                          ...allExperts.filter(e => e.id !== expert.id).map(e => ({ value: e.id, label: e.name }))
                        ]}
                      />
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.4 }}>
                        {de ? 'Legt die Hierarchie fest. Agenten eskalieren Probleme an ihren Vorgesetzten.' : 'Sets the hierarchy. Agents escalate problems to their supervisor.'}
                      </div>
                    </div>
                  </div>


                  {/* --- ADVISOR --- */}
                  <div style={{ padding: 20, background: 'rgba(168, 85, 247, 0.05)', borderRadius: 16, border: '1px solid rgba(168, 85, 247, 0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <UserCheck size={15} style={{ color: '#a855f7' }} />
                      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{de ? 'Agent Advisor (Strategischer Lead)' : 'Agent Advisor (Strategic Lead)'}</h4>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <label style={{ fontSize: 11, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 6 }}>{de ? 'Advisor Agent' : 'Advisor Agent'}</label>
                        <Select
                          value={editForm.advisorId}
                          onChange={v => setEditForm(f => ({ ...f, advisorId: v }))}
                          options={[
                            { value: '', label: de ? '— Kein Advisor —' : '— No Advisor —' },
                            ...allExperts.filter(e => e.id !== expert.id).map(e => ({ value: e.id, label: e.name }))
                          ]}
                        />
                      </div>
                      {editForm.advisorId && (
                        <div>
                          <label style={{ fontSize: 11, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 6 }}>{de ? 'Strategie' : 'Strategy'}</label>
                          <Select
                            value={editForm.advisorStrategy}
                            onChange={v => setEditForm(f => ({ ...f, advisorStrategy: v as any }))}
                            options={[
                              { value: 'planning', label: de ? 'Planung (Generic)' : 'Planning (Generic)' },
                              { value: 'native', label: de ? 'Nativ (Handoff)' : 'Native (Handoff)' },
                            ]}
                          />
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 8, lineHeight: 1.4, gridColumn: 'span 2' }}>
                      {de 
                        ? 'Ein Mentor-Agent, der vor der Ausführung strategische Pläne erstellt und bei Fehlern automatisch eine Kurskorrektur einleitet.' 
                        : 'A mentor agent that generates strategic plans before execution and automatically initiates course correction on errors.'}
                    </div>
                  </div>

                  {/* --- BERECHTIGUNGEN --- */}
                  <div style={{ padding: 20, background: 'rgba(255,255,255,0.02)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <Shield size={15} style={{ color: 'var(--color-success)' }} />
                      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{de ? 'Berechtigungen & Rechte' : 'Permissions & Rights'}</h4>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[
                        { label: de ? 'Aufgaben erstellen' : 'Create tasks', key: 'permAufgabenErstellen' },
                        { label: de ? 'Aufgaben zuweisen' : 'Assign tasks', key: 'permAufgabenZuweisen' },
                        { label: de ? 'Genehmigungen anfordern' : 'Request approvals', key: 'permGenehmigungAnfordern' },
                        { label: de ? 'Genehmigungen entscheiden' : 'Decide on approvals', key: 'permGenehmigungEntscheiden' },
                        { label: de ? 'Agenten anwerben' : 'Recruit agents', key: 'permExpertenAnwerben' },
                      ].map(({ label, key }) => {
                        const val = (editForm as any)[key];
                        return (
                          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '10px 12px', borderRadius: 10, background: val ? 'rgba(35,205,202,0.05)' : 'transparent', border: `1px solid ${val ? 'rgba(35,205,202,0.1)' : 'transparent'}`, transition: 'all 0.2s' }}>
                            <div onClick={() => setEditForm(f => ({ ...f, [key]: !val }))} style={{ width: 36, height: 20, borderRadius: 10, background: val ? '#23CDCB' : 'rgba(255,255,255,0.1)', position: 'relative' }}>
                              <div style={{ position: 'absolute', top: 2, left: val ? 18 : 2, width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
                            </div>
                            <span style={{ fontSize: 13, color: val ? '#fff' : 'var(--color-text-tertiary)' }}>{label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* --- SYSTEM PROMPT --- */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <Terminal size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                      <h4 style={{ margin: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--color-text-tertiary)' }}>
                        {de ? 'System-Prompt (Anweisungen)' : 'System Prompt (Instructions)'}
                      </h4>
                    </div>
                    <textarea
                      className="input"
                      rows={4}
                      style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }}
                      value={editForm.systemPrompt}
                      onChange={e => setEditForm(f => ({ ...f, systemPrompt: e.target.value }))}
                      placeholder={de ? 'Beschreibe hier die Persönlichkeit und spezifischen Anweisungen für diesen Agenten...' : 'Describe the personality and specific instructions for this agent here...'}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>{de ? 'Monats-Budget (€)' : 'Monthly Budget (€)'}</label>
                      {expert.verbindungsTyp === 'ollama' ? (
                        <div style={{ height: 42, display: 'flex', alignItems: 'center', color: 'var(--color-success)', fontSize: 12, fontWeight: 500 }}>
                          {de ? '∞ Unbegrenzt (Lokal)' : '∞ Unlimited (Local)'}
                        </div>
                      ) : (
                        <input type="number" className="input" style={{ width: '100%' }} value={editForm.budgetMonatCent} onChange={e => setEditForm(f => ({ ...f, budgetMonatCent: Number(e.target.value) }))} />
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                       <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>{de ? 'Status' : 'Status'}</label>
                       <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 42 }}>
                          <button onClick={() => setEditForm(f => ({ ...f, zyklusAktiv: !f.zyklusAktiv }))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: editForm.zyklusAktiv ? 'var(--color-accent)' : 'var(--color-text-muted)', transition: 'color 0.2s' }}>
                            {editForm.zyklusAktiv ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
                          </button>
                          <span style={{ fontSize: 12, fontWeight: 600, color: editForm.zyklusAktiv ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
                            {editForm.zyklusAktiv ? (de ? 'Autonom Aktiv' : 'Autonomous Active') : (de ? 'Inaktiv' : 'Inactive')}
                          </span>
                       </div>
                    </div>
                  </div>

                  {/* ── Heartbeat Konfiguration ─────────────────────────────────── */}
                  <div style={{ marginTop: 20, padding: 18, borderRadius: 14, border: `1px solid ${editForm.zyklusAktiv ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.07)'}`, background: 'rgba(255,255,255,0.02)', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${editForm.zyklusAktiv ? 'rgba(35,205,202,0.5)' : 'rgba(107,114,128,0.2)'},transparent)` }} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <Activity size={14} color={editForm.zyklusAktiv ? 'var(--color-accent)' : 'var(--color-text-muted)'} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: editForm.zyklusAktiv ? 'var(--color-accent)' : 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                        {de ? 'Heartbeat Konfiguration' : 'Heartbeat Configuration'}
                      </span>
                    </div>

                    {/* Interval presets */}
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 8 }}>
                      {de ? 'Wake-up Intervall' : 'Wake-up Interval'}
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 16 }}>
                      {[
                        { label: '5m',  sek: 300 },
                        { label: '15m', sek: 900 },
                        { label: '30m', sek: 1800 },
                        { label: '1h',  sek: 3600 },
                        { label: '2h',  sek: 7200 },
                        { label: '4h',  sek: 14400 },
                        { label: '8h',  sek: 28800 },
                        { label: '24h', sek: 86400 },
                      ].map(({ label, sek }) => (
                        <button
                          key={sek}
                          onClick={() => setEditForm(f => ({ ...f, zyklusIntervallSek: sek }))}
                          style={{
                            padding: '7px 0',
                            borderRadius: 8,
                            border: `1px solid ${editForm.zyklusIntervallSek === sek ? 'rgba(35,205,202,0.6)' : 'rgba(255,255,255,0.08)'}`,
                            background: editForm.zyklusIntervallSek === sek ? 'rgba(35,205,202,0.12)' : 'rgba(255,255,255,0.03)',
                            color: editForm.zyklusIntervallSek === sek ? 'var(--color-accent)' : 'var(--color-text-muted)',
                            fontSize: 12,
                            fontWeight: editForm.zyklusIntervallSek === sek ? 700 : 500,
                            cursor: 'pointer',
                            transition: 'all 0.15s',
                          }}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {/* Custom interval */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                      <input
                        type="number"
                        min={60}
                        max={86400}
                        value={editForm.zyklusIntervallSek}
                        onChange={e => setEditForm(f => ({ ...f, zyklusIntervallSek: Math.max(60, Number(e.target.value)) }))}
                        className="input"
                        style={{ width: 90, textAlign: 'center' }}
                      />
                      <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {de ? 'Sekunden' : 'seconds'} = {editForm.zyklusIntervallSek < 3600
                          ? `${Math.round(editForm.zyklusIntervallSek / 60)} min`
                          : `${(editForm.zyklusIntervallSek / 3600).toFixed(1)}h`}
                      </span>
                    </div>

                    {/* Wakeup sources info */}
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 8 }}>
                      {de ? 'Wakeup-Quellen (immer aktiv)' : 'Wakeup Sources (always active)'}
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {[
                        { icon: '📋', label: de ? 'Bei Task-Zuweisung' : 'On task assignment' },
                        { icon: '💬', label: de ? 'Bei Chat-Nachricht' : 'On chat message' },
                        { icon: '🔗', label: de ? 'Bei Task-Chaining (Abhängigkeit erfüllt)' : 'On task chaining (dependency met)' },
                        { icon: '⏰', label: de ? `Timer (alle ${editForm.zyklusIntervallSek < 3600 ? Math.round(editForm.zyklusIntervallSek/60)+'min' : (editForm.zyklusIntervallSek/3600).toFixed(1)+'h'})` : `Timer (every ${editForm.zyklusIntervallSek < 3600 ? Math.round(editForm.zyklusIntervallSek/60)+'min' : (editForm.zyklusIntervallSek/3600).toFixed(1)+'h'})`, timerOnly: true },
                      ].map(({ icon, label, timerOnly }) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 18, height: 18, borderRadius: 4, background: timerOnly ? (editForm.zyklusAktiv ? 'rgba(35,205,202,0.2)' : 'rgba(107,114,128,0.15)') : 'rgba(35,205,202,0.15)', border: `1px solid ${timerOnly ? (editForm.zyklusAktiv ? 'rgba(35,205,202,0.4)' : 'rgba(107,114,128,0.3)') : 'rgba(35,205,202,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>
                            ✓
                          </div>
                          <span style={{ fontSize: 11, color: timerOnly && !editForm.zyklusAktiv ? 'var(--color-text-tertiary)' : 'var(--color-text-muted)' }}>{icon} {label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* ─────────────────────────────────────────────────────────── */}

                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-primary" onClick={handleSaveSettings} disabled={savingSettings} style={{ width: '100%', height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 12, fontSize: 14, fontWeight: 700 }}>
                      <Save size={18} /> {savingSettings ? (de ? 'Speichern...' : 'Saving...') : saveSuccess ? (de ? '✓ Konfiguration Erfolgreich' : '✓ Configuration Successful') : (de ? 'Konfiguration Speichern' : 'Save Configuration')}
                    </button>
                    {saveError && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 10, textAlign: 'center', fontWeight: 500 }}>✗ {saveError}</div>}
                  </div>

                  <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--color-border)' }}>
                     <h4 style={{ fontSize: 11, color: 'var(--color-error)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16, fontWeight: 700 }}>{de ? 'Gefahrenzone' : 'Danger Zone'}</h4>
                     {!deleteConfirm ? (
                       <button className="btn" onClick={() => setDeleteConfirm(true)} style={{ width: '100%', height: 44, borderRadius: 12, borderColor: 'rgba(239,68,68,0.2)', color: 'var(--color-error)', background: 'rgba(239,68,68,0.05)', fontWeight: 600 }}>
                         {de ? 'Agenten aus dem Dienst entlassen' : 'Dismiss agent from service'}
                       </button>
                     ) : (
                       <div style={{ background: 'rgba(239,68,68,0.1)', padding: 16, borderRadius: 16, border: '1px solid rgba(239,68,68,0.2)' }}>
                          <p style={{ fontSize: 13, color: 'var(--color-error)', marginBottom: 16, textAlign: 'center', fontWeight: 600 }}>{de ? 'Agent wirklich unwiderruflich entlassen?' : 'Really dismiss agent irrevocably?'}</p>
                          <div style={{ display: 'flex', gap: 12 }}>
                            <button className="btn btn-ghost" onClick={() => setDeleteConfirm(false)} style={{ flex: 1, borderRadius: 10 }}>{de ? 'Abbrechen' : 'Cancel'}</button>
                            <button className="btn" onClick={handleDelete} style={{ flex: 1, background: 'var(--color-error)', color: '#fff', borderRadius: 10, fontWeight: 700 }}>{de ? 'Ja, entlassen' : 'Yes, dismiss'}</button>
                          </div>
                          {deleteError && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 10, textAlign: 'center' }}>✗ {deleteError}</div>}
                       </div>
                     )}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'skills' && (
              <div style={{ padding: 28 }}>
                <h4 style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>
                  {de ? 'Skills aus der Bibliothek' : 'Skills from Library'}
                </h4>
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 20, opacity: 0.6 }}>
                  {de ? 'Wähle Skills für diesen Agenten aus.' : 'Select skills for this agent.'}
                </p>

                {skillsLibrary.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--color-bg-secondary)', borderRadius: 14, border: '1px dashed var(--color-border)' }}>
                    <BookOpen size={28} style={{ color: 'var(--color-text-muted)', marginBottom: 12, opacity: 0.4 }} />
                    <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                      {de ? 'Keine Skills in der Bibliothek' : 'No skills in library'}
                    </p>
                    <p style={{ fontSize: 11, opacity: 0.5 }}>
                      {de ? 'Erstelle Skills unter → Skill-Bibliothek' : 'Create skills under → Skill Library'}
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {skillsLibrary.map(skill => {
                      const isActive = selectedSkills.includes(skill.id);
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => {
                            if (isActive) setSelectedSkills(selectedSkills.filter(id => id !== skill.id));
                            else setSelectedSkills([...selectedSkills, skill.id]);
                          }}
                          style={{
                            display: 'flex', alignItems: 'flex-start', gap: 14,
                            padding: '14px 16px',
                            background: isActive ? 'rgba(35, 205, 202, 0.08)' : 'var(--color-bg-secondary)',
                            border: `1px solid ${isActive ? 'rgba(35, 205, 202, 0.4)' : 'var(--color-border)'}`,
                            borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left',
                          }}
                        >
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                            background: isActive ? '#23CDCB' : 'rgba(255,255,255,0.08)',
                            border: `2px solid ${isActive ? '#23CDCB' : 'rgba(255,255,255,0.2)'}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {isActive && <CheckCircle2 size={12} style={{ color: '#000' }} />}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: isActive ? '#e4e4e7' : 'var(--color-text-secondary)', marginBottom: 3 }}>
                              {skill.name}
                            </div>
                            {skill.beschreibung && (
                              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', opacity: 0.7, lineHeight: 1.4 }}>
                                {skill.beschreibung}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div style={{ marginTop: 20 }}>
                  <button
                    className="btn btn-primary"
                    onClick={handleSaveSettings}
                    disabled={savingSettings}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <Save size={16} />
                    {savingSettings
                      ? (de ? 'Speichern...' : 'Saving...')
                      : saveSuccess
                        ? (de ? '✓ Gespeichert' : '✓ Saved')
                        : (de ? `${selectedSkills.length} Skill(s) speichern` : `Save ${selectedSkills.length} skill(s)`)}
                  </button>
                </div>
              </div>
            )}

            {/* ══ SOUL TAB ══════════════════════════════════════════════════════ */}
            {activeTab === 'soul' && (
              <div style={{ padding: 28 }}>
                {/* Header */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,rgba(35,205,202,0.2),rgba(35,205,202,0.05))', border: '1px solid rgba(35,205,202,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Sparkles size={18} color="var(--color-accent)" />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>SOUL</h3>
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 0 }}>
                        {de ? 'Identität & Persönlichkeit des Agenten' : 'Agent identity & personality'}
                      </p>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6, padding: '10px 14px', background: 'rgba(35,205,202,0.04)', borderRadius: 10, border: '1px solid rgba(35,205,202,0.1)', margin: 0 }}>
                    {de
                      ? 'SOUL löst das "Memento Man Problem": Beim Aufwachen weiß der Agent sofort wer er ist, wie er entscheidet und was er tun soll — ohne menschliche Eingabe.'
                      : 'SOUL solves the "Memento Man Problem": on wakeup the agent instantly knows who it is, how it decides, and what to do — no human input needed.'}
                  </p>
                </div>

                {/* Auto-Generate Button */}
                <button
                  onClick={async () => {
                    setGeneratingSoul(true);
                    try {
                      const { authFetch } = await import('../utils/api');
                      const res = await authFetch(`/api/experten/${expert.id}/soul/generate`, { method: 'POST' });
                      const data = await res.json() as any;
                      if (data.identity)    setSoulIdentity(data.identity);
                      if (data.principles)  setSoulPrinciples(data.principles);
                      if (data.checklist)   setSoulChecklist(data.checklist);
                      if (data.personality) setSoulPersonality(data.personality);
                    } catch { /* ignore */ }
                    setGeneratingSoul(false);
                  }}
                  disabled={generatingSoul}
                  style={{ width: '100%', marginBottom: 20, padding: '12px 0', borderRadius: 12, border: '1px solid rgba(35,205,202,0.3)', background: 'linear-gradient(135deg,rgba(35,205,202,0.1),rgba(35,205,202,0.05))', color: 'var(--color-accent)', fontWeight: 700, fontSize: 13, cursor: generatingSoul ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s', opacity: generatingSoul ? 0.6 : 1 }}
                >
                  <Sparkles size={16} />
                  {generatingSoul
                    ? (de ? '✨ Generiere SOUL...' : '✨ Generating SOUL...')
                    : (de ? '✨ SOUL automatisch generieren' : '✨ Auto-generate SOUL')}
                </button>

                {/* SOUL Sections */}
                {([
                  { key: 'identity',    label: de ? '🧬 IDENTITÄT' : '🧬 IDENTITY',                          value: soulIdentity,     set: setSoulIdentity,     placeholder: de ? `Ich bin ${expert.name}, ${expert.rolle}. Meine Hauptaufgabe ist...` : `I am ${expert.name}, ${expert.rolle}. My main purpose is...`, rows: 3 },
                  { key: 'principles',  label: de ? '🎯 ENTSCHEIDUNGSPRINZIPIEN' : '🎯 DECISION PRINCIPLES', value: soulPrinciples,   set: setSoulPrinciples,   placeholder: de ? '1. Qualität vor Geschwindigkeit\n2. Bei Unsicherheit: CEO fragen\n3. Immer den Kontext beachten' : '1. Quality over speed\n2. When in doubt: ask CEO\n3. Always consider context', rows: 4 },
                  { key: 'checklist',   label: de ? '✅ ZYKLUS-CHECKLISTE' : '✅ CYCLE CHECKLIST',           value: soulChecklist,    set: setSoulChecklist,    placeholder: de ? '- Inbox prüfen\n- Aktive Tasks reviewen\n- Bei Blockern: sofort eskalieren\n- Ergebnisse dokumentieren' : '- Check inbox\n- Review active tasks\n- Blockers: escalate immediately\n- Document results', rows: 4 },
                  { key: 'personality', label: de ? '💬 PERSÖNLICHKEIT & STIL' : '💬 PERSONALITY & STYLE',  value: soulPersonality,  set: setSoulPersonality,  placeholder: de ? 'Direkt und präzise. Keine Ausreden. Lösungsorientiert.' : 'Direct and precise. No excuses. Solution-oriented.', rows: 3 },
                ] as const).map(({ key, label, value, set, placeholder, rows }) => (
                  <div key={key} style={{ marginBottom: 18 }}>
                    <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: 1.5, display: 'block', marginBottom: 8 }}>
                      {label}
                    </label>
                    <textarea
                      value={value}
                      onChange={e => set(e.target.value)}
                      placeholder={placeholder}
                      rows={rows}
                      className="input"
                      style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, background: 'rgba(255,255,255,0.02)', borderColor: value ? 'rgba(35,205,202,0.25)' : 'rgba(255,255,255,0.07)' }}
                    />
                  </div>
                ))}

                {/* Preview */}
                {(soulIdentity || soulPrinciples || soulChecklist || soulPersonality) && (
                  <div style={{ marginBottom: 18, padding: 14, borderRadius: 10, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                      {de ? 'Vorschau — wird als System Prompt gespeichert' : 'Preview — saved as system prompt'}
                    </div>
                    <pre style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace', lineHeight: 1.5, maxHeight: 200, overflow: 'auto' }}>
                      {[
                        soulIdentity    && `## IDENTITÄT\n${soulIdentity}`,
                        soulPrinciples  && `## ENTSCHEIDUNGSPRINZIPIEN\n${soulPrinciples}`,
                        soulChecklist   && `## ZYKLUS-CHECKLISTE\n${soulChecklist}`,
                        soulPersonality && `## PERSÖNLICHKEIT\n${soulPersonality}`,
                      ].filter(Boolean).join('\n\n')}
                    </pre>
                  </div>
                )}

                {/* Save Button */}
                <button
                  onClick={async () => {
                    setSavingSoul(true);
                    const soulPrompt = [
                      soulIdentity    && `## IDENTITÄT\n${soulIdentity}`,
                      soulPrinciples  && `## ENTSCHEIDUNGSPRINZIPIEN\n${soulPrinciples}`,
                      soulChecklist   && `## ZYKLUS-CHECKLISTE\n${soulChecklist}`,
                      soulPersonality && `## PERSÖNLICHKEIT\n${soulPersonality}`,
                    ].filter(Boolean).join('\n\n');
                    try {
                      const { authFetch } = await import('../utils/api');
                      await authFetch(`/api/experten/${expert.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ systemPrompt: soulPrompt }),
                      });
                      setExpert(e => ({ ...e, systemPrompt: soulPrompt }));
                      setSoulSaved(true);
                      setTimeout(() => setSoulSaved(false), 3000);
                    } catch { /* ignore */ }
                    setSavingSoul(false);
                  }}
                  disabled={savingSoul || (!soulIdentity && !soulPrinciples && !soulChecklist && !soulPersonality)}
                  style={{ width: '100%', padding: '13px 0', borderRadius: 12, border: 'none', background: soulSaved ? 'rgba(34,197,94,0.2)' : 'var(--color-accent)', color: soulSaved ? '#22c55e' : '#000', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s', opacity: (savingSoul || (!soulIdentity && !soulPrinciples && !soulChecklist && !soulPersonality)) ? 0.5 : 1 }}
                >
                  <Save size={16} />
                  {savingSoul ? (de ? 'Speichern...' : 'Saving...') : soulSaved ? (de ? '✓ SOUL gespeichert' : '✓ SOUL saved') : (de ? 'SOUL speichern' : 'Save SOUL')}
                </button>
              </div>
            )}
            {/* ════════════════════════════════════════════════════════════════ */}
          </div>
        </div>

        {/* ═══ RECHTES PANEL: Chat (40%) ═══ */}
        <div
          style={{ width: '40%', display: 'flex', flexDirection: 'column', position: 'relative' }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drag overlay */}
          {isDragOver && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(35,205,202,0.12)', border: '2px dashed var(--color-accent)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ textAlign: 'center', color: 'var(--color-accent)' }}>
                <Upload size={28} style={{ marginBottom: 8 }} />
                <div style={{ fontWeight: 600 }}>{de ? 'Datei hier ablegen' : 'Drop file here'}</div>
              </div>
            </div>
          )}

          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
             <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t.direktkanal}</h3>
                <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}>
                  Board → {expert.name}
                  {directChatMode && <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>⚡ Direct</span>}
                </div>
             </div>
             <button onClick={onClose} className="btn btn-ghost" style={{ padding: 8 }}><X size={20} /></button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {loadingChat && <div style={{ textAlign: 'center', marginTop: 40, opacity: 0.5 }}>{t.loadingHistory}</div>}
            {messages.map((m, i) => {
              const isAgent = m.absenderTyp === 'agent';
              const isSystem = m.absenderTyp === 'system';
              if (isSystem) return (
                <div key={i} style={{ alignSelf: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 14px', borderRadius: 8, fontSize: 11, opacity: 0.65, maxWidth: '90%', whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
                  {m.nachricht}
                </div>
              );

              return (
                <div key={i} style={{ alignSelf: isAgent ? 'flex-start' : 'flex-end', maxWidth: '88%' }}>
                   <div style={{
                     padding: '12px 16px', borderRadius: 16, fontSize: 13, lineHeight: 1.55,
                     background: isAgent ? 'var(--color-bg-elevated)' : 'var(--color-accent)',
                     color: isAgent ? 'inherit' : '#fff',
                     border: isAgent ? '1px solid var(--color-border)' : 'none',
                     borderBottomLeftRadius: isAgent ? 2 : 16, borderBottomRightRadius: isAgent ? 16 : 2,
                     whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                   }}>
                     {m.nachricht}
                   </div>
                   <div style={{ fontSize: 10, opacity: 0.3, marginTop: 4, textAlign: isAgent ? 'left' : 'right' }}>
                     {new Date(m.erstelltAm).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                   </div>
                </div>
              );
            })}
            {agentTyping && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '10px 14px', background: 'var(--color-bg-elevated)', borderRadius: 12, border: '1px solid var(--color-border)' }}>
                {[0,1,2].map(d => (
                  <div key={d} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--color-accent)', animation: 'bounce 1.2s infinite', animationDelay: `${d * 0.2}s` }} />
                ))}
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div style={{ padding: '12px 20px 20px', borderTop: '1px solid var(--color-border)' }}>
            {/* Command autocomplete */}
            {showCommands && (
              <div style={{ marginBottom: 8, background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
                {COMMANDS.filter(c => !commandFilter || c.cmd.slice(1).startsWith(commandFilter)).map(c => (
                  <button
                    key={c.cmd}
                    onClick={() => { setInputText(c.cmd + ' '); setShowCommands(false); inputRef.current?.focus(); }}
                    style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'inherit' }}
                    onMouseOver={e => (e.currentTarget.style.background = 'rgba(35,205,202,0.08)')}
                    onMouseOut={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span>{c.icon}</span>
                    <span style={{ fontFamily: 'monospace', color: 'var(--color-accent)', fontWeight: 600 }}>{c.cmd}</span>
                    <span style={{ opacity: 0.55 }}>{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Mode indicator + hint */}
            <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 6, display: 'flex', gap: 8 }}>
              <span>{de ? 'Tippe / für Befehle · Datei per Drag & Drop einfügen' : 'Type / for commands · drag & drop files'}</span>
              <span>·</span>
              <span style={{ color: directChatMode ? 'var(--color-accent)' : undefined }}>{directChatMode ? '⚡ direct' : '🔄 heartbeat'}</span>
            </div>
            <div style={{ position: 'relative' }}>
              <textarea
                ref={inputRef}
                className="input"
                rows={1}
                style={{ width: '100%', paddingRight: 48, minHeight: 44, resize: 'none', overflowY: 'hidden', lineHeight: 1.5 }}
                placeholder={de ? 'Nachricht an Expert... (/ für Befehle)' : 'Message expert... (/ for commands)'}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
              />
              <button
                onClick={sendMessage}
                disabled={!inputText.trim()}
                style={{ position: 'absolute', right: 8, top: 6, width: 32, height: 32, background: inputText.trim() ? 'var(--color-accent)' : 'rgba(35,205,202,0.3)', border: 'none', borderRadius: 8, color: '#fff', cursor: inputText.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
