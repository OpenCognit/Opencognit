import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Send, CheckCircle2, Circle, Clock, Wallet, Activity,
  Settings, Monitor, Trash2, Pause, Play, Zap, Bot, Loader2,
  ChevronRight, ChevronDown, ChevronUp, AlertCircle, ToggleLeft, ToggleRight, Save, Eye, Sparkles, Wrench, BookOpen,
  LayoutDashboard, TrendingUp, BarChart3, UserCheck, ShieldQuestion, Shield, Terminal, Globe,
  FileText, Hash, Upload, Volume2, VolumeX, Paperclip, ImageIcon, StopCircle
} from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';
import { apiAufgaben, apiExperten, type Aufgabe, type Experte, type Aktivitaet } from '../api/client';
import { translateActivity } from '../utils/activityTranslator';
import { useToast } from './ToastProvider';
import { Select } from './Select';
import { GlassAgentPanel } from './GlassAgentPanel';
import { 
  RunActivityChart, PriorityChart, StatusChart, SuccessRateChart, ChartCard 
} from './AgentCharts';

// ── OpenRouter Model Picker ───────────────────────────────────────────────────
interface ORModel { id: string; name: string; pricing?: any }

// ── Simple code block renderer ──────────────────────────────────────────────
function MessageContent({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('```')) {
          const match = part.match(/^```(\w*)\n([\s\S]*?)```$/);
          const lang = match?.[1] || '';
          const code = match?.[2] || part.slice(3, -3);
          return (
            <pre key={i} style={{ background: 'rgba(0,0,0,0.35)', padding: '10px 12px', margin: '8px 0', borderRadius: 0, overflowX: 'auto', fontSize: 12, fontFamily: 'var(--font-mono)', lineHeight: 1.5, borderLeft: '2px solid var(--color-accent)' }}>
              {lang && <div style={{ fontSize: 10, opacity: 0.5, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{lang}</div>}
              <code>{code}</code>
            </pre>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

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
          background: open ? 'rgba(197,160,89,0.08)' : 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0,
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
            border: '1px solid rgba(255,255,255,0.12)', borderRadius: 0,
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
                    background: sel ? 'rgba(197,160,89,0.15)' : 'transparent',
                    color: sel ? '#c5a059' : 'var(--color-text-primary)',
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
    credentials: 'include',
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
  'claude-code': { de: 'Claude Code CLI', en: 'Claude Code CLI' },
  'codex-cli': { de: 'Codex CLI', en: 'Codex CLI' },
  'gemini-cli': { de: 'Gemini CLI', en: 'Gemini CLI' },
  'kimi-cli': { de: 'Kimi CLI', en: 'Kimi CLI' },
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
          <stop offset="0%" stopColor="rgba(197,160,89,0.18)" />
          <stop offset="100%" stopColor="rgba(197,160,89,0.04)" />
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
      <polygon points={polyPts} fill="url(#radarGlow)" stroke="#c5a059" strokeWidth={1.5} strokeLinejoin="round" filter="url(#glow)" />

      {/* Vertex dots */}
      {skills.map((s, i) => {
        const p = polar(i, maxR * Math.max(0.15, s.konfidenz / 100));
        return <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="#c5a059" filter="url(#glow)" />;
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
      <circle cx={cx} cy={cy} r={3} fill="rgba(197,160,89,0.4)" />
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
  const TAB_KEY = `expert_drawer_tab_${initialExpert.id}`;
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    // Honour explicit tab request (e.g. edit mode opening on 'einstellungen').
    // Otherwise restore the tab the user last used for this agent.
    if (initialTab !== 'überblick') return initialTab;
    return (localStorage.getItem(`expert_drawer_tab_${initialExpert.id}`) as Tab | null) || 'überblick';
  });
  const prevInitialTabRef = useRef<Tab>(initialTab);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    localStorage.setItem(TAB_KEY, tab);
  };

  // Chat state
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [loadingChat, setLoadingChat] = useState(true);
  const [agentTyping, setAgentTyping] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [commandFilter, setCommandFilter] = useState('');
  const [activeCmd, setActiveCmd] = useState(-1);
  const [isDragOver, setIsDragOver] = useState(false);
  const [directChatMode, setDirectChatMode] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [pendingImage, setPendingImage] = useState<{ data: string; mimeType: string; name: string; previewUrl: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Sync with parent props ─────────────────────────────────────────────────
  useEffect(() => {
    if (initialExpert.id !== expert.id) {
      setExpert(initialExpert);
      // Restore saved tab for the newly selected agent
      const saved = localStorage.getItem(`expert_drawer_tab_${initialExpert.id}`) as Tab | null;
      const tab = initialTab !== 'überblick' ? initialTab : (saved || 'überblick');
      setActiveTab(tab);
    }
  }, [initialExpert.id]);

  // Only reset activeTab when parent explicitly requests a specific tab (e.g. edit mode)
  useEffect(() => {
    if (prevInitialTabRef.current !== initialTab && initialTab !== 'überblick') {
      handleTabChange(initialTab);
      prevInitialTabRef.current = initialTab;
    }
  }, [initialTab]);

  // Monitor state
  const [tasks, setTasks] = useState<Aufgabe[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  // Aktivität state
  const [aktivitaet, setAktivitaet] = useState<Aktivitaet[]>([]);
  const [loadingAktivitaet, setLoadingAktivitaet] = useState(false);

  // Stats state
  const [stats, setStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Workspace file viewer state: taskId → { files, loading, fileContent }
  const [wsState, setWsState] = useState<Record<string, { files: any[]; loading: boolean; fileContent?: string; openFile?: string }>>({});

  const toggleWorkspace = async (taskId: string) => {
    if (wsState[taskId]) {
      setWsState(prev => { const n = { ...prev }; delete n[taskId]; return n; });
      return;
    }
    setWsState(prev => ({ ...prev, [taskId]: { files: [], loading: true } }));
    try {
      const info = await authFetch(`/api/tasks/${taskId}/workspace`).then(r => r.json());
      setWsState(prev => ({ ...prev, [taskId]: { files: info.files ?? [], loading: false } }));
    } catch {
      setWsState(prev => ({ ...prev, [taskId]: { files: [], loading: false } }));
    }
  };

  const openWorkspaceFile = async (taskId: string, filePath: string, fileName: string) => {
    const cur = wsState[taskId];
    if (cur?.openFile === fileName) {
      setWsState(prev => ({ ...prev, [taskId]: { ...prev[taskId], openFile: undefined, fileContent: undefined } }));
      return;
    }
    setWsState(prev => ({ ...prev, [taskId]: { ...prev[taskId], openFile: fileName, fileContent: '…' } }));
    try {
      const content = await authFetch(`/api/tasks/${taskId}/workspace/file?path=${encodeURIComponent(fileName)}`).then(r => r.text());
      setWsState(prev => ({ ...prev, [taskId]: { ...prev[taskId], fileContent: content } }));
    } catch {
      setWsState(prev => ({ ...prev, [taskId]: { ...prev[taskId], fileContent: '❌ Konnte Datei nicht laden' } }));
    }
  };

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
    connectionId: (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').connectionId || ''; } catch { return ''; } })(),
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

  // CLI status for connection-type indicators
  const [cliStatus, setCliStatus] = useState<{
    tools: Array<{ name: string; installed: boolean; version: string; authenticated?: boolean }>;
    loaded: boolean;
  }>({ tools: [], loaded: false });

  // Quick action loading state
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('opencognit_token');
    fetch('/api/system/cli-detect', {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.tools) setCliStatus({ tools: data.tools, loaded: true });
      })
      .catch(() => {});
  }, []);

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
  const [customConnections, setCustomConnections] = useState<{ id: string; name: string; baseUrl: string }[]>([]);

  useEffect(() => {
    if (!expert.id) return;

    // Fetch all experts for dropdowns
    apiExperten.liste(expert.unternehmenId)
      .then(list => setAllExperts(list))
      .catch(() => {});

    // Fetch global settings: custom connections + legacy base URL hint
    authFetch(`/api/einstellungen?unternehmenId=${expert.unternehmenId}`)
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        setGlobalCustomBaseUrl(data.custom_api_base_url || '');
        try {
          const conns = JSON.parse(data.custom_connections || '[]');
          setCustomConnections(conns.map((c: any) => ({ id: c.id, name: c.name, baseUrl: c.baseUrl })));
        } catch { setCustomConnections([]); }
      })
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
      connectionId: (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').connectionId || ''; } catch { return ''; } })(),
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

    // Reset chat state for new agent — clear stale messages/typing/streaming
    setMessages([]);
    setInputText('');
    setLoadingChat(true);
    setAgentTyping(false);
    setStreaming(false);
    setShowCommands(false);
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }

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
    const img = pendingImage;
    if ((!txt && !img) || !aktivesUnternehmen) return;
    setInputText('');
    setShowCommands(false);
    setPendingImage(null);
    if (inputRef.current) inputRef.current.style.height = '60px';

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

    const tempMsg = { id: `pending-${Date.now()}`, absenderTyp: 'board', nachricht: txt, images: img ? [img.previewUrl] : undefined, erstelltAm: new Date().toISOString(), _pending: true };
    setMessages(prev => [...prev, tempMsg]);
    setTimeout(scrollToBottom, 50);

    if (directChatMode) {
      // Streaming LLM call via SSE
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming(true);
      setAgentTyping(false);

      const agentMsgId = `stream-${Date.now()}`;
      setMessages(prev => [...prev, {
        id: agentMsgId, absenderTyp: 'agent', nachricht: '', thinking: '',
        _streaming: true, erstelltAm: new Date().toISOString(),
      }]);

      try {
        const res = await fetch(`/api/experten/${expert.id}/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-unternehmen-id': aktivesUnternehmen.id,
            ...(localStorage.getItem('opencognit_token') ? { 'Authorization': `Bearer ${localStorage.getItem('opencognit_token')}` } : {}),
          },
          body: JSON.stringify({ nachricht: txt, ...(img ? { image: { data: img.data, mimeType: img.mimeType } } : {}) }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error('stream_error');
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6));
              if (ev.type === 'thinking_start' || ev.type === 'thinking_delta') {
                setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, thinking: (m.thinking ?? '') + (ev.chunk ?? '') } : m));
              } else if (ev.type === 'text_delta') {
                setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, nachricht: m.nachricht + (ev.chunk ?? '') } : m));
              } else if (ev.type === 'done') {
                const final = ev.reply ?? '';
                setMessages(prev => prev.map(m => m.id === agentMsgId ? {
                  ...m, _streaming: false, nachricht: final || m.nachricht,
                  _model: ev.model, _inputTokens: ev.inputTokens, _outputTokens: ev.outputTokens, _costCents: ev.costCents,
                } : m));
                if (ttsEnabled && final) speak(final, agentMsgId);
              } else if (ev.type === 'error') {
                setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, _streaming: false, nachricht: m.nachricht || `❌ ${ev.message || 'Error'}` } : m));
              }
            } catch { /* ignore parse errors */ }
          }
        }
        setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, _streaming: false } : m));
      } catch (e: any) {
        if (e.name === 'AbortError') {
          setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, _streaming: false, nachricht: m.nachricht + '\n\n_[abgebrochen]_' } : m));
        } else {
          setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, _streaming: false, nachricht: `❌ ${de ? 'Verbindungsfehler' : 'Connection error'}` } : m));
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        setTimeout(scrollToBottom, 50);
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
      const idx = COMMANDS.findIndex(c => c.cmd.startsWith(val.toLowerCase()));
      setActiveCmd(idx >= 0 ? idx : -1);
    } else {
      setShowCommands(false);
      setActiveCmd(-1);
    }
    // Auto-resize textarea
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommands) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActiveCmd(p => (p < COMMANDS.length - 1 ? p + 1 : 0)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveCmd(p => (p > 0 ? p - 1 : COMMANDS.length - 1)); }
      else if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); if (activeCmd >= 0) { setInputText(COMMANDS[activeCmd].cmd + ' '); setShowCommands(false); setTimeout(() => inputRef.current?.focus(), 30); } }
      else if (e.key === 'Escape') { e.preventDefault(); setShowCommands(false); setActiveCmd(-1); }
      return;
    }
    if (e.key === 'Escape') { setShowCommands(false); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!streaming) sendMessage(); }
  };

  const speak = useCallback((text: string, msgId: string) => {
    window.speechSynthesis.cancel();
    if (speakingId === msgId) { setSpeakingId(null); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = de ? 'de-DE' : 'en-US'; u.rate = 1.05;
    u.onend = () => setSpeakingId(null);
    u.onerror = () => setSpeakingId(null);
    setSpeakingId(msgId);
    window.speechSynthesis.speak(u);
  }, [speakingId, de]);

  const pickImage = () => fileRef.current?.click();

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setPendingImage({ data, mimeType: file.type, name: file.name, previewUrl: URL.createObjectURL(file) });
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const file = files[0];
    if (file.type.startsWith('image/')) {
      handleImageFile(file);
      return;
    }
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
          connectionId: editForm.connectionId || undefined,
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
        background: 'linear-gradient(180deg, rgba(16,14,10,0.97) 0%, rgba(12,10,8,0.97) 100%)',
        backdropFilter: 'blur(24px) saturate(160%)',
        borderLeft: '1px solid rgba(197,160,89,0.15)',
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
              <div style={{ width: 56, height: 56, fontSize: 22, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: expert.avatarFarbe + '22', color: expert.avatarFarbe }}>
                {expert.avatar || <Bot size={24} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <h3 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>{expert.name}</h3>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5, padding: '2px 10px',
                    borderRadius: 0, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
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
                      borderRadius: 0, background: 'rgba(155, 135, 200, 0.1)', 
                      border: '1px solid rgba(155, 135, 200, 0.2)', fontSize: '10px', 
                      fontWeight: 600, color: '#9b87c8', textTransform: 'uppercase'
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
                onClick={() => handleTabChange(tab.id)}
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

                    {/* ── Agent Status Header ── */}
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0, padding: '20px 24px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          <div style={{
                            width: 10, height: 10, borderRadius: '50%',
                            background: expert.status === 'running' ? '#c5a059' : expert.status === 'paused' ? '#f59e0b' : expert.status === 'error' ? '#ef4444' : '#52525b',
                            boxShadow: expert.status === 'running' ? '0 0 10px rgba(197,160,89,0.6)' : 'none',
                          }} />
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>{expert.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{expert.rolle}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                          {/* Connection Type Badge */}
                          {(() => {
                            const vt = expert.verbindungsTyp;
                            const labelMap: Record<string, string> = {
                              'claude-code': 'Claude Code', 'kimi-cli': 'Kimi CLI', 'gemini-cli': 'Gemini CLI', 'codex-cli': 'Codex CLI',
                              'anthropic': 'Anthropic', 'openai': 'OpenAI', 'openrouter': 'OpenRouter', 'google': 'Google',
                              'ollama': 'Ollama', 'ollama_cloud': 'Ollama Cloud', 'moonshot': 'Moonshot', 'poe': 'Poe',
                              'bash': 'Bash', 'http': 'HTTP', 'ceo': 'CEO', 'custom': 'Custom',
                            };
                            const colorMap: Record<string, string> = {
                              'claude-code': '#c5a059', 'kimi-cli': '#a78bfa', 'gemini-cli': '#4285f4', 'codex-cli': '#10a37f',
                              'anthropic': '#d4a574', 'openai': '#10a37f', 'openrouter': '#c5a059', 'google': '#4285f4',
                              'ollama': '#22c55e', 'ollama_cloud': '#9b87c8', 'moonshot': '#a78bfa', 'poe': '#f59e0b',
                            };
                            const tool = cliStatus.tools.find((t: any) => t.name === vt);
                            const isCli = ['claude-code', 'kimi-cli', 'gemini-cli', 'codex-cli'].includes(vt);
                            const connected = isCli ? tool?.installed && (tool?.authenticated !== false) : true;
                            return (
                              <div style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '4px 10px', borderRadius: 0,
                                background: isCli ? (connected ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)') : 'rgba(255,255,255,0.05)',
                                border: `1px solid ${isCli ? (connected ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)') : 'rgba(255,255,255,0.1)'}`,
                              }}>
                                <span style={{
                                  width: 6, height: 6, borderRadius: '50%',
                                  background: isCli ? (connected ? '#22c55e' : '#ef4444') : (colorMap[vt] || '#c5a059'),
                                }} />
                                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                                  {labelMap[vt] || vt}
                                </span>
                                {isCli && (
                                  <span style={{ fontSize: 9, color: connected ? '#22c55e' : '#ef4444' }}>
                                    {connected ? (de ? 'OK' : 'OK') : (de ? 'Fehlt' : 'Missing')}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                          {/* Model badge */}
                          {(() => {
                            const model = (() => { try { return JSON.parse(expert.verbindungsConfig || '{}').model; } catch { return ''; } })();
                            return model ? (
                              <span style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: 0 }}>
                                {model}
                              </span>
                            ) : null;
                          })()}
                        </div>
                      </div>

                      {/* Budget mini-bar */}
                      {expert.budgetMonatCent > 0 && (
                        <div style={{ marginTop: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, color: 'var(--color-text-muted)' }}>
                            <span>{de ? 'Budget' : 'Budget'}</span>
                            <span>{centZuEuro(expert.verbrauchtMonatCent, i18n.language)} / {centZuEuro(expert.budgetMonatCent, i18n.language)}</span>
                          </div>
                          <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 0, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', width: `${Math.min((expert.verbrauchtMonatCent / expert.budgetMonatCent) * 100, 100)}%`,
                              background: (expert.verbrauchtMonatCent / expert.budgetMonatCent) > 0.9 ? '#ef4444' : '#c5a059',
                              borderRadius: 0, transition: 'width 0.5s ease',
                            }} />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ── Quick Actions ── */}
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <button
                        onClick={async () => {
                          const action = expert.status === 'paused' ? 'Resume' : 'Pause';
                          const url = `/api/agents/${expert.id}/${expert.status === 'paused' ? 'resume' : 'pause'}`;
                          setLoadingAction(action);
                          try {
                            const token = localStorage.getItem('opencognit_token');
                            const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
                            if (r.ok) {
                              toastCtx.success(de ? 'Erledigt' : 'Done', de ? `${action} erfolgreich` : `${action} successful`);
                              const newStatus = action === 'Pause' ? 'paused' : 'idle';
                              setExpert(prev => ({ ...prev, status: newStatus, zyklusAktiv: action === 'Resume' }));
                            } else throw new Error();
                          } catch {
                            toastCtx.error(de ? 'Fehler' : 'Error', de ? `${action} fehlgeschlagen` : `${action} failed`);
                          } finally { setLoadingAction(null); }
                        }}
                        disabled={loadingAction !== null}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 14px', borderRadius: 0, border: '1px solid rgba(255,255,255,0.1)',
                          background: expert.status === 'paused' ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
                          color: expert.status === 'paused' ? '#22c55e' : '#f59e0b',
                          fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        {loadingAction === (expert.status === 'paused' ? 'Resume' : 'Pause') ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : (expert.status === 'paused' ? <Play size={14} /> : <Pause size={14} />)}
                        {expert.status === 'paused' ? (de ? 'Fortsetzen' : 'Resume') : (de ? 'Pausieren' : 'Pause')}
                      </button>
                      <button
                        onClick={async () => {
                          setLoadingAction('Run Now');
                          try {
                            const token = localStorage.getItem('opencognit_token');
                            const r = await fetch(`/api/agents/${expert.id}/wakeup`, { method: 'POST', credentials: 'include', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
                            if (r.ok) toastCtx.success(de ? 'Erledigt' : 'Done', de ? 'Zyklus gestartet' : 'Cycle started');
                            else throw new Error();
                          } catch {
                            toastCtx.error(de ? 'Fehler' : 'Error', de ? 'Start fehlgeschlagen' : 'Start failed');
                          } finally { setLoadingAction(null); }
                        }}
                        disabled={loadingAction !== null || expert.status === 'paused'}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '8px 14px', borderRadius: 0, border: '1px solid rgba(197,160,89,0.25)',
                          background: 'rgba(197,160,89,0.08)', color: '#c5a059',
                          fontSize: 12, fontWeight: 600, cursor: expert.status === 'paused' ? 'not-allowed' : 'pointer',
                          opacity: expert.status === 'paused' ? 0.5 : 1,
                        }}
                      >
                        {loadingAction === 'Run Now' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Zap size={14} />}
                        {de ? 'Jetzt ausführen' : 'Run now'}
                      </button>
                    </div>

                    {/* ── Connection Status Card ── */}
                    {(['claude-code', 'codex-cli', 'gemini-cli', 'kimi-cli'].includes(expert.verbindungsTyp)) && (
                      <div style={{ background: 'rgba(10,10,10,0.6)', border: '1px solid rgba(197,160,89,0.15)', borderRadius: 0, padding: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 8, height: 8, borderRadius: '50%', background:
                              !cliStatus.loaded ? '#64748b'
                              : (cliStatus.tools.find((t: any) => t.name === expert.verbindungsTyp)?.installed
                                ? (cliStatus.tools.find((t: any) => t.name === expert.verbindungsTyp)?.authenticated ? '#22c55e' : '#f59e0b')
                                : '#ef4444'),
                              boxShadow: !cliStatus.loaded ? 'none'
                              : (cliStatus.tools.find((t: any) => t.name === expert.verbindungsTyp)?.installed
                                ? (cliStatus.tools.find((t: any) => t.name === expert.verbindungsTyp)?.authenticated ? '0 0 8px #22c55e' : '0 0 8px #f59e0b')
                                : '0 0 8px #ef4444'),
                            }} />
                            <span style={{ fontSize: 12, fontWeight: 700, color: '#e4e4e7' }}>
                              {verbindungsLabels[expert.verbindungsTyp]?.[i18n.language] || expert.verbindungsTyp}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              const token = localStorage.getItem('opencognit_token');
                              fetch('/api/system/cli-detect', { credentials: 'include', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } })
                                .then(r => r.ok ? r.json() : null)
                                .then(data => { if (data?.tools) setCliStatus({ tools: data.tools, loaded: true }); })
                                .catch(() => {});
                            }}
                            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            ↻ {de ? 'Aktualisieren' : 'Refresh'}
                          </button>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          {!cliStatus.loaded ? (
                            <span>{de ? 'Status wird geprüft…' : 'Checking status…'}</span>
                          ) : (() => {
                            const tool = cliStatus.tools.find((t: any) => t.name === expert.verbindungsTyp);
                            if (!tool) return <span>{de ? 'Unbekanntes Tool' : 'Unknown tool'}</span>;
                            if (!tool.installed) return <span>{de ? 'Nicht installiert' : 'Not installed'}</span>;
                            return (
                              <>
                                <span style={{ color: tool.authenticated ? '#22c55e' : '#f59e0b', fontWeight: 600 }}>
                                  {tool.authenticated ? (de ? 'Verbunden' : 'Connected') : (de ? 'Nicht eingeloggt' : 'Not logged in')}
                                </span>
                                {tool.version && <span style={{ color: 'var(--color-text-muted)' }}>— v{tool.version}</span>}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Latest Run Card */}
                    {stats?.latestRun && (
                      <div style={{ background: 'rgba(197, 160, 89, 0.05)', border: '1px solid rgba(197, 160, 89, 0.2)', borderRadius: 0, padding: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ 
                              padding: '4px 10px', borderRadius: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                              background: stats.latestRun.status === 'succeeded' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: stats.latestRun.status === 'succeeded' ? '#10b981' : '#ef4444'
                            }}>
                              {stats.latestRun.status === 'succeeded' ? (de ? '✓ Erfolg' : '✓ Success') : (de ? '✗ Fehler' : '✗ Failed')}
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{zeitRelativ(stats.latestRun.erstelltAm, i18n.language)}</span>
                          </div>
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 0 }}>
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
                        <div style={{ background: 'rgba(155, 135, 200, 0.05)', border: '1px solid rgba(155, 135, 200, 0.15)', borderRadius: 0, padding: 20 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 0, background: 'rgba(155, 135, 200, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b87c8' }}>
                              <UserCheck size={20} />
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#e4e4e7' }}>{de ? 'Strategische Führung' : 'Strategic Lead'}</div>
                              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{de ? 'Advisor zugewiesen' : 'Advisor assigned'}</div>
                            </div>
                          </div>
                          
                          {lastPlan && (
                            <div style={{ marginTop: 8, padding: 12, borderRadius: 0, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(155, 135, 200, 0.2)', fontSize: 13, color: 'var(--color-text-secondary)', fontStyle: 'italic', lineHeight: 1.5 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: '#9b87c8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                <Zap size={12} />
                                {de ? 'Advisor Direktive' : 'Advisor Directive'}
                              </div>
                              {lastPlan.details && (() => {
                                const details = JSON.parse(lastPlan.details);
                                const plan = details.plan || "";
                                return plan.startsWith('```json') ? (
                                  <pre style={{ margin: 0, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 0, fontSize: 11, overflowX: 'auto', fontStyle: 'normal' }}>
                                    {plan.replace(/```json|```/g, '').trim()}
                                  </pre>
                                ) : (
                                  plan
                                );
                              })()}
                            </div>
                          )}

                          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 0, marginTop: lastPlan ? 16 : 0 }}>
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
                            <span style={{ fontSize: 10, color: 'var(--color-text-muted)', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 0 }}>
                              {teamStatus?.team?.length ?? 0} {de ? 'Berichte' : 'reports'}
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
                        {teamStatus?.team?.length === 0 ? (
                          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 12, background: 'rgba(212,175,55,0.03)', border: '1px dashed rgba(212,175,55,0.15)', borderRadius: 0 }}>
                            {de ? 'Keine direkten Berichte.' : 'No direct reports.'}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {teamStatus?.team?.map((member: any) => {
                              const statusColors: Record<string, string> = { active: '#c5a059', running: '#3b82f6', idle: '#52525b', paused: '#f59e0b', error: '#ef4444', terminated: '#6b7280' };
                              const statusDot = statusColors[member.status] || '#52525b';
                              const lastSeen = member.letzterZyklus
                                ? (() => { const d = Date.now() - new Date(member.letzterZyklus).getTime(); const m = Math.floor(d/60000); return m < 60 ? `${m}m` : `${Math.floor(m/60)}h`; })()
                                : '—';
                              return (
                                <div key={member.id} style={{
                                  background: 'rgba(212,175,55,0.04)',
                                  border: '1px solid rgba(212,175,55,0.12)',
                                  borderRadius: 0,
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
                                    <span style={{ fontSize: 10, color: '#c5a059', fontWeight: 600 }}>
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
                        {teamStatus?.unassigned?.length > 0 && (
                          <div style={{ marginTop: 4 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                              {de ? `${teamStatus?.unassigned?.length ?? 0} nicht zugewiesen` : `${teamStatus?.unassigned?.length ?? 0} unassigned`}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {teamStatus?.unassigned?.slice(0, 5).map((task: any) => (
                                <div key={task.id} style={{
                                  background: 'rgba(245,158,11,0.04)',
                                  border: '1px solid rgba(245,158,11,0.15)',
                                  borderRadius: 0, padding: '8px 12px',
                                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                    <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 0, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', flexShrink: 0 }}>
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
                        <div style={{ background: 'rgba(197,160,89,0.03)', border: '1px solid rgba(197,160,89,0.12)', borderRadius: 0, padding: 20 }}>
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
                                  <div style={{ height: 3, background: 'rgba(255,255,255,0.07)', borderRadius: 0, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${s.konfidenz}%`, background: 'linear-gradient(90deg, #c5a059, #26e6e2)', borderRadius: 0, transition: 'width 0.6s ease' }} />
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
                      <div style={{ background: 'rgba(197,160,89,0.03)', border: '1px solid rgba(197,160,89,0.12)', borderRadius: 0, padding: 20 }}>
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>
                          {de ? 'Skill-Profil' : 'Skill Profile'}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          {skillsLibrary.filter(s => selectedSkills.includes(s.id)).map(s => (
                            <span key={s.id} style={{ padding: '5px 12px', background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.3)', borderRadius: 0, fontSize: 12, color: '#c5a059', fontWeight: 600 }}>
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
                            padding: '12px 16px', background: 'var(--color-bg-secondary)', borderRadius: 0, border: '1px solid var(--color-border)', 
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between' 
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <div style={{ width: 8, height: 8, borderRadius: '50%', background: task.status === 'done' ? '#10b981' : task.status === 'in_progress' ? '#c5a059' : '#6b7280' }} />
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
                    <div style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 0, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${budgetPercent > 90 ? 'rgba(239,68,68,0.6)' : 'rgba(197,160,89,0.4)'},transparent)`, borderRadius: '0' }} />
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Wallet size={10} /> {de ? 'Budget' : 'Budget'}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: budgetPercent > 90 ? 'var(--color-error)' : 'var(--color-accent)', fontVariantNumeric: 'tabular-nums' }}>{budgetPercent}%</div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.6, marginTop: 2 }}>{centZuEuro(expert.verbrauchtMonatCent, i18n.language)}</div>
                      <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 0, marginTop: 8, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(budgetPercent, 100)}%`, background: budgetPercent > 90 ? 'rgba(239,68,68,0.8)' : 'rgba(197,160,89,0.8)', borderRadius: 0, transition: 'width 0.5s ease' }} />
                      </div>
                    </div>
                  ) : (
                    <div style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 0, padding: '14px 16px' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Ollama</div>
                      <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--color-accent)' }}>Local</div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.6, marginTop: 2 }}>{de ? 'Kostenlos' : 'Free'}</div>
                    </div>
                  )}

                  {/* Tasks */}
                  <div style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 0, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,rgba(197,160,89,0.4),transparent)', borderRadius: '0' }} />
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>{de ? 'Aufgaben' : 'Tasks'}</div>
                    <div style={{ fontWeight: 800, fontSize: 24, color: 'var(--color-accent)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{activeTasks.length}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.6, marginTop: 4 }}>{completedTasks.length} {de ? 'erledigt' : 'done'}</div>
                  </div>

                  {/* Cycle */}
                  <div style={{ background: 'linear-gradient(135deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))', border: `1px solid ${expert.zyklusAktiv ? 'rgba(197,160,89,0.2)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 0, padding: '14px 16px', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${expert.zyklusAktiv ? 'rgba(197,160,89,0.5)' : 'rgba(107,114,128,0.3)'},transparent)`, borderRadius: '0' }} />
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Zap size={10} /> {de ? 'Zyklus' : 'Cycle'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {expert.zyklusAktiv && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#c5a059', boxShadow: '0 0 6px rgba(197,160,89,0.8)', animation: 'pulse-dot 2s ease-in-out infinite' }} />}
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
                      <div style={{ padding: '16px', textAlign: 'center', fontSize: 12, color: 'var(--color-text-muted)', opacity: 0.4, border: '1px dashed rgba(255,255,255,0.07)', borderRadius: 0 }}>
                        {de ? 'Keine aktiven Aufgaben' : 'No active tasks'}
                      </div>
                    ) : activeTasks.slice(0, 8).map(t => {
                      const prioColor: Record<string, string> = { critical: '#ef4444', high: '#f97316', medium: '#c5a059', low: '#6b7280' };
                      const statusIcon: Record<string, string> = { offen: '○', todo: '○', in_progress: '◑', in_review: '◐', blocked: '✕' };
                      const ws = wsState[t.id];
                      const textMimeTypes = ['text/', 'application/json', 'application/xml'];
                      const isTextFile = (mime: string) => textMimeTypes.some(p => mime.startsWith(p));
                      return (
                        <div key={t.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 0 }}>
                          <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 14, color: prioColor[t.prioritaet] || '#6b7280', flexShrink: 0 }}>{statusIcon[t.status] || '○'}</span>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.titel}</div>
                              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.55, marginTop: 2 }}>{t.status.replace(/_/g, ' ')}</div>
                            </div>
                            <div style={{ fontSize: 9, padding: '2px 7px', borderRadius: 0, background: `${prioColor[t.prioritaet] || '#6b7280'}18`, color: prioColor[t.prioritaet] || '#6b7280', fontWeight: 700, flexShrink: 0 }}>
                              {t.prioritaet}
                            </div>
                            <button
                              onClick={() => toggleWorkspace(t.id)}
                              title={de ? 'Workspace-Dateien anzeigen' : 'Show workspace files'}
                              style={{ background: ws ? 'rgba(197,160,89,0.12)' : 'none', border: '1px solid rgba(255,255,255,0.08)', padding: '3px 7px', cursor: 'pointer', color: ws ? 'var(--color-accent)' : 'var(--color-text-muted)', fontSize: 11, borderRadius: 0, flexShrink: 0 }}
                            >
                              📁
                            </button>
                          </div>
                          {ws && (
                            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '8px 14px', background: 'rgba(0,0,0,0.2)' }}>
                              {ws.loading ? (
                                <div style={{ fontSize: 11, opacity: 0.4 }}>{de ? 'Lade…' : 'Loading…'}</div>
                              ) : ws.files.length === 0 ? (
                                <div style={{ fontSize: 11, opacity: 0.35, fontStyle: 'italic' }}>{de ? 'Keine Dateien im Workspace' : 'No files in workspace'}</div>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {ws.files.filter(f => !f.isDirectory).map((f: any) => (
                                    <div key={f.name}>
                                      <button
                                        onClick={() => isTextFile(f.mimeTyp) && openWorkspaceFile(t.id, f.path, f.name)}
                                        style={{ width: '100%', textAlign: 'left', background: ws.openFile === f.name ? 'rgba(197,160,89,0.08)' : 'none', border: 'none', padding: '3px 0', cursor: isTextFile(f.mimeTyp) ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 8, color: 'inherit' }}
                                      >
                                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                                        <span style={{ fontSize: 10, opacity: 0.35, flexShrink: 0 }}>{f.sizeBytes > 1024 ? `${(f.sizeBytes/1024).toFixed(1)}KB` : `${f.sizeBytes}B`}</span>
                                      </button>
                                      {ws.openFile === f.name && ws.fileContent !== undefined && (
                                        <pre style={{ margin: '4px 0 8px', padding: '8px 10px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.06)', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)', overflowX: 'auto', maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                          {ws.fileContent}
                                        </pre>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
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
                          <span style={{ color: '#c5a059', fontSize: 12, flexShrink: 0 }}>✓</span>
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
                      <div style={{ flex: 1 }}>{translateActivity(a.aktion, i18n.language)}</div>
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
                      borderRadius: 0, padding: '1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      transition: 'all 0.3s ease', cursor: 'pointer',
                      boxShadow: editForm.isOrchestrator ? '0 10px 40px rgba(212, 175, 55, 0.1)' : 'none'
                    }}
                    onClick={() => setEditForm(f => ({ ...f, isOrchestrator: !f.isOrchestrator }))}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
                      <div style={{ 
                        width: '44px', height: '44px', borderRadius: 0, background: editForm.isOrchestrator ? 'rgba(212, 175, 55, 0.15)' : 'rgba(255,255,255,0.05)',
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
                      width: '48px', height: '26px', borderRadius: 0, background: editForm.isOrchestrator ? '#D4AF37' : 'rgba(255,255,255,0.1)',
                      padding: '3px', position: 'relative', transition: 'background 0.3s'
                    }}>
                      <div style={{ 
                        width: '20px', height: '20px', borderRadius: 0, background: '#fff',
                        position: 'absolute', left: editForm.isOrchestrator ? '25px' : '3px', transition: 'left 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)'
                      }} />
                    </div>
                  </div>

                  {/* --- VERBINDUNG & ENGINE --- */}
                  <div style={{ padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 0, border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <Zap size={15} style={{ color: 'var(--color-accent)' }} />
                      <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{de ? 'KI-Engine & Modell' : 'AI Engine & Model'}</h4>
                    </div>
                    
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 6 }}>{de ? 'Verbindung' : 'Connection'}</label>
                        <Select
                          value={editForm.verbindungsTyp}
                          onChange={v => setEditForm(f => ({ ...f, verbindungsTyp: v as any, connectionId: '' }))}
                          options={[
                            { value: 'claude-code', label: de ? '⚡ Claude Code CLI (Pro/Max-Abo)' : '⚡ Claude Code CLI (Pro/Max plan)' },
                            { value: 'openrouter', label: 'OpenRouter' },
                            { value: 'anthropic', label: 'Anthropic Claude' },
                            { value: 'openai', label: 'OpenAI GPT' },
                            { value: 'google', label: 'Google Gemini' },
                            { value: 'moonshot', label: 'Moonshot AI' },
                            { value: 'poe', label: 'Poe' },
                            { value: 'custom', label: de ? '🔌 Custom API (OpenAI-kompatibel)' : '🔌 Custom API (OpenAI-compatible)' },
                            { value: 'ollama', label: de ? 'Ollama (Lokal)' : 'Ollama (Local)' },
                            { value: 'ollama_cloud', label: '☁️ Ollama (Cloud / Remote)' },
                            { value: 'codex-cli', label: de ? '🐍 Codex CLI (OpenAI)' : '🐍 Codex CLI (OpenAI)' },
                            { value: 'gemini-cli', label: de ? '💎 Gemini CLI (Google)' : '💎 Gemini CLI (Google)' },
                            { value: 'kimi-cli', label: de ? '🌙 Kimi CLI (Moonshot)' : '🌙 Kimi CLI (Moonshot)' },
                            { value: 'bash', label: 'Bash Script' },
                            { value: 'http', label: 'HTTP Webhook' },
                          ]}
                        />
                        {/* Custom connection picker — shown when Custom API is selected */}
                        {editForm.verbindungsTyp === 'custom' && customConnections.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <label style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-text-muted)', display: 'block', marginBottom: 4 }}>
                              {de ? 'Welche Verbindung?' : 'Which connection?'}
                            </label>
                            <select
                              value={editForm.connectionId}
                              onChange={e => {
                                const conn = customConnections.find(c => c.id === e.target.value);
                                setEditForm(f => ({ ...f, connectionId: e.target.value, baseUrl: conn?.baseUrl || f.baseUrl }));
                              }}
                              style={{ width: '100%', padding: '6px 10px', borderRadius: 0, border: '1px solid rgba(197,160,89,0.2)', background: 'rgba(197,160,89,0.05)', color: 'var(--color-text-primary)', fontSize: 12, cursor: 'pointer' }}
                            >
                              <option value="" >{de ? '— Global (Standard) —' : '— Global (default) —'}</option>
                              {customConnections.map(c => (
                                <option key={c.id} value={c.id} >{c.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                      <div>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 6 }}>{de ? 'Modell / URL' : 'Model / URL'}</label>
                        {(() => { const vt = editForm.verbindungsTyp as string; return (
                        vt === 'openrouter' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {!editForm.modell && (
                              <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
                                borderRadius: 0, padding: '6px 10px', fontSize: 11.5,
                              }}>
                                <span style={{ color: '#f59e0b' }}>⚡ Kein Modell gewählt — nutzt Auto Free</span>
                                <button
                                  type="button"
                                  onClick={() => setEditForm(f => ({ ...f, modell: 'auto:free' }))}
                                  style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', borderRadius: 0, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
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
                              <div style={{ fontSize: 10, color: 'var(--color-accent)', opacity: 0.8, background: 'rgba(197, 160, 89, 0.1)', padding: '4px 8px', borderRadius: 0 }}>
                                {de ? 'Tipp: High-End Modell empfohlen (z.B. Claude 3.5 Sonnet).' : 'Tip: High-end model recommended (e.g. Claude 3.5 Sonnet).'}
                              </div>
                            )}
                          </div>
                        ) : vt === 'ollama' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              {ollamaModels.length > 0 ? (
                                <select
                                  value={editForm.modell}
                                  onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))}
                                  style={{ flex: 1, padding: '8px 12px', borderRadius: 0, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-primary)', fontSize: 14, cursor: 'pointer' }}
                                >
                                  {ollamaModels.map(m => (
                                    <option key={m.id} value={m.id} >
                                      {m.name}{m.size ? ` (${(m.size / 1e9).toFixed(1)} GB)` : ''}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <input className="input" style={{ flex: 1 }} value={editForm.modell} placeholder={loadingOllamaModels ? 'Lade Ollama-Modelle...' : 'z.B. qwen3.5:latest'} onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))} />
                              )}
                              <button onClick={() => loadOllamaModels(editForm.baseUrl)} disabled={loadingOllamaModels} title={de ? 'Modelle aktualisieren' : 'Refresh models'} style={{ padding: '8px 12px', borderRadius: 0, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--color-accent)', cursor: loadingOllamaModels ? 'wait' : 'pointer', fontSize: 16, lineHeight: 1 }}>
                                {loadingOllamaModels ? '⏳' : '🔄'}
                              </button>
                            </div>
                            {ollamaModels.length === 0 && !loadingOllamaModels && (
                              <div style={{ fontSize: 11, color: '#ef4444', padding: '4px 8px', background: 'rgba(239,68,68,0.08)', borderRadius: 0 }}>
                                {de ? '⚠ Ollama nicht erreichbar — URL prüfen & aktualisieren' : '⚠ Ollama not reachable — check URL & refresh'}
                              </div>
                            )}
                            {ollamaModels.length > 0 && <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{ollamaModels.length} {de ? 'lokale Modelle gefunden' : 'local models found'}</div>}
                          </div>
                        ) : vt === 'claude-code' ? (
                          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '8px 12px', borderRadius: 0, background: 'rgba(197,160,89,0.07)', border: '1px solid rgba(197,160,89,0.15)' }}>
                            ⚡ {de ? 'Nutzt dein Claude Pro/Max-Abo — kein API Key nötig' : 'Uses your Claude Pro/Max plan — no API key needed'}
                          </div>
                        ) : vt === 'codex-cli' ? (
                          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '8px 12px', borderRadius: 0, background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.15)' }}>
                            🐍 {de ? 'Nutzt OpenAI Codex CLI — kein API Key nötig' : 'Uses OpenAI Codex CLI — no API key needed'}
                          </div>
                        ) : vt === 'gemini-cli' ? (
                          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '8px 12px', borderRadius: 0, background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.15)' }}>
                            💎 {de ? 'Nutzt Google Gemini CLI — kein API Key nötig' : 'Uses Google Gemini CLI — no API key needed'}
                          </div>
                        ) : vt === 'kimi-cli' ? (
                          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '8px 12px', borderRadius: 0, background: 'rgba(139,92,246,0.07)', border: '1px solid rgba(139,92,246,0.15)' }}>
                            🌙 {de ? 'Nutzt Moonshot Kimi CLI — kein API Key nötig' : 'Uses Moonshot Kimi CLI — no API key needed'}
                          </div>
                        ) : vt === 'anthropic' ? (
                          <select value={editForm.modell} onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 0, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-primary)', fontSize: 14, cursor: 'pointer' }}>
                            <option value="claude-haiku-4-5-20251001" >⚡ Claude Haiku 4.5 — schnell &amp; günstig</option>
                            <option value="claude-sonnet-4-6" >✨ Claude Sonnet 4.6 — ausgewogen (empfohlen)</option>
                            <option value="claude-opus-4-6" >🧠 Claude Opus 4.6 — stärkste Reasoning</option>
                            <option value="claude-3-5-sonnet-20241022" >claude-3-5-sonnet-20241022</option>
                            <option value="claude-3-5-haiku-20241022" >claude-3-5-haiku-20241022</option>
                          </select>
                        ) : vt === 'openai' ? (
                          <select value={editForm.modell} onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))} style={{ width: '100%', padding: '8px 12px', borderRadius: 0, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', color: 'var(--color-text-primary)', fontSize: 14, cursor: 'pointer' }}>
                            <option value="gpt-4o-mini" >⚡ GPT-4o mini — schnell &amp; günstig</option>
                            <option value="gpt-4o" >✨ GPT-4o — ausgewogen (empfohlen)</option>
                            <option value="o4-mini" >🧠 o4-mini — Reasoning</option>
                            <option value="o3" >🔬 o3 — stärkstes Reasoning</option>
                            <option value="gpt-4-turbo" >gpt-4-turbo</option>
                          </select>
                        ) : vt === 'ollama_cloud' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                              <input className="input" style={{ flex: 1 }} value={editForm.modell} placeholder="z.B. llama3.2:latest, mistral:7b" onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))} />
                              <button
                                onClick={() => loadOllamaModels(editForm.baseUrl)}
                                disabled={loadingOllamaModels || !editForm.baseUrl}
                                title={editForm.baseUrl ? (de ? 'Modelle von Remote laden' : 'Fetch remote models') : (de ? 'Erst URL unten eintragen' : 'Enter URL below first')}
                                style={{ padding: '8px 12px', borderRadius: 0, border: '1px solid rgba(255,255,255,0.1)', background: editForm.baseUrl ? 'rgba(155,135,200,0.1)' : 'rgba(255,255,255,0.03)', color: editForm.baseUrl ? '#9b87c8' : '#475569', cursor: editForm.baseUrl && !loadingOllamaModels ? 'pointer' : 'not-allowed', fontSize: 16, lineHeight: 1 }}
                              >
                                {loadingOllamaModels ? '⏳' : '🔄'}
                              </button>
                            </div>
                            {ollamaModels.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {ollamaModels.map(m => (
                                  <button key={m.id} onClick={() => setEditForm(f => ({ ...f, modell: m.id }))} style={{ padding: '2px 9px', borderRadius: 0, fontSize: 11, cursor: 'pointer', background: editForm.modell === m.id ? 'rgba(155,135,200,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${editForm.modell === m.id ? 'rgba(155,135,200,0.5)' : 'rgba(255,255,255,0.08)'}`, color: editForm.modell === m.id ? '#9b87c8' : '#64748b', fontWeight: editForm.modell === m.id ? 700 : 400 }}>
                                    {m.name}
                                  </button>
                                ))}
                              </div>
                            )}
                            <div style={{ fontSize: 10, color: '#64748b' }}>
                              {de ? '☁️ Remote Ollama — URL unten eintragen, dann 🔄 drücken' : '☁️ Remote Ollama — enter URL below, then press 🔄'}
                            </div>
                          </div>
                        ) : vt === 'custom' ? (
                          <input className="input" style={{ width: '100%' }} placeholder="z.B. llama3-70b-8192, mistral-large-latest, …" value={editForm.modell} onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))} />
                        ) : (
                          <input className="input" style={{ width: '100%' }} value={editForm.modell} onChange={e => setEditForm(f => ({ ...f, modell: e.target.value }))} />
                        )
                        ); })()}
                      </div>
                    </div>

                    {(['claude-code', 'codex-cli', 'gemini-cli', 'kimi-cli'] as string[]).includes(editForm.verbindungsTyp) && (
                      <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 0, background: 'rgba(197,160,89,0.05)', border: '1px solid rgba(197,160,89,0.12)', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                        {(() => {
                          const tool = cliStatus.tools.find((t: any) => t.name === editForm.verbindungsTyp);
                          const installed = tool?.installed;
                          const authenticated = tool?.authenticated;
                          return (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{
                                  width: 8, height: 8, borderRadius: '50%',
                                  background: !cliStatus.loaded ? '#64748b' : installed ? (authenticated ? '#22c55e' : '#f59e0b') : '#ef4444',
                                  boxShadow: !cliStatus.loaded ? 'none' : installed ? (authenticated ? '0 0 8px #22c55e' : '0 0 8px #f59e0b') : '0 0 8px #ef4444',
                                  display: 'inline-block',
                                }} />
                                <span style={{ fontWeight: 600 }}>
                                  {!cliStatus.loaded ? (de ? 'Status wird geprüft…' : 'Checking status…')
                                    : installed
                                      ? (authenticated !== undefined
                                          ? (authenticated ? (de ? 'Verbunden' : 'Connected') : (de ? 'Nicht angemeldet' : 'Not logged in'))
                                          : (de ? 'Installiert' : 'Installed'))
                                      : (de ? 'Nicht installiert' : 'Not installed')}
                                </span>
                                {installed && tool?.version && (
                                  <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>— {tool.version}</span>
                                )}
                              </div>
                              <div>
                                💡 {de ? 'Arbeitsverzeichnis wird aus den globalen Einstellungen übernommen.' : 'Working directory is taken from global Settings.'}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {(() => { const vt2 = editForm.verbindungsTyp as string; return (vt2 === 'ollama' || vt2 === 'ollama_cloud' || vt2 === 'openai' || vt2 === 'custom') && (
                      <div style={{
                        marginTop: 16, padding: '12px 16px', borderRadius: 0,
                        background: vt2 === 'ollama_cloud' ? 'rgba(155,135,200,0.05)' : 'rgba(56,189,248,0.05)',
                        border: `1px solid ${vt2 === 'ollama_cloud' ? 'rgba(155,135,200,0.15)' : 'rgba(56,189,248,0.1)'}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <Globe size={14} style={{ color: vt2 === 'ollama_cloud' ? '#9b87c8' : 'var(--color-accent)' }} />
                          <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1 }}>
                            {vt2 === 'custom'
                              ? 'API Base URL'
                              : vt2 === 'ollama_cloud'
                                ? (de ? '☁️ Remote Ollama Server URL' : '☁️ Remote Ollama Server URL')
                                : (de ? 'Basis-URL (Optional für Relay/Cloud)' : 'Base URL (Optional for Relay/Cloud)')}
                          </label>
                        </div>
                        <input
                          className="input"
                          style={{ width: '100%' }}
                          placeholder={
                            vt2 === 'custom'
                              ? (globalCustomBaseUrl ? `${globalCustomBaseUrl} (Global)` : 'https://api.groq.com/openai/v1')
                              : vt2 === 'openai'
                                ? 'z.B. https://api.groq.com/openai/v1'
                                : vt2 === 'ollama_cloud'
                                  ? 'z.B. http://192.168.1.100:11434 oder https://mein-server.com:11434'
                                  : 'z.B. http://1.2.3.4:11434'
                          }
                          value={editForm.baseUrl}
                          onChange={e => setEditForm(f => ({ ...f, baseUrl: e.target.value }))}
                        />
                        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 6 }}>
                          {vt2 === 'custom'
                            ? (globalCustomBaseUrl && !editForm.baseUrl
                                ? <span style={{ color: '#c5a059' }}>{de ? `Globale URL aktiv: ${globalCustomBaseUrl}` : `Using global URL: ${globalCustomBaseUrl}`}</span>
                                : (de ? 'OpenAI-kompatibler Endpunkt. Leer = Wert aus den globalen Einstellungen.' : 'OpenAI-compatible endpoint. Empty = value from global Settings.'))
                            : vt2 === 'ollama_cloud'
                              ? (de ? 'IP/Domain deines Ollama-Servers. Port 11434 ist der Standard.' : 'IP/domain of your Ollama server. Port 11434 is the default.')
                              : (de ? 'Leer lassen, um den Standard-Endpoint zu nutzen.' : 'Leave empty to use the default endpoint.')}
                        </div>
                      </div>
                    ); })()}
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
                  <div style={{ padding: 20, background: 'rgba(155, 135, 200, 0.05)', borderRadius: 0, border: '1px solid rgba(155, 135, 200, 0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                      <UserCheck size={15} style={{ color: '#9b87c8' }} />
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
                  <div style={{ padding: 20, background: 'rgba(255,255,255,0.02)', borderRadius: 0, border: '1px solid rgba(255,255,255,0.06)' }}>
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
                          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', padding: '10px 12px', borderRadius: 0, background: val ? 'rgba(197,160,89,0.05)' : 'transparent', border: `1px solid ${val ? 'rgba(197,160,89,0.1)' : 'transparent'}`, transition: 'all 0.2s' }}>
                            <div onClick={() => setEditForm(f => ({ ...f, [key]: !val }))} style={{ width: 36, height: 20, borderRadius: 0, background: val ? '#c5a059' : 'rgba(255,255,255,0.1)', position: 'relative' }}>
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
                  <div style={{ marginTop: 20, padding: 18, borderRadius: 0, border: `1px solid ${editForm.zyklusAktiv ? 'rgba(197,160,89,0.2)' : 'rgba(255,255,255,0.07)'}`, background: 'rgba(255,255,255,0.02)', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg,${editForm.zyklusAktiv ? 'rgba(197,160,89,0.5)' : 'rgba(107,114,128,0.2)'},transparent)` }} />
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
                            borderRadius: 0,
                            border: `1px solid ${editForm.zyklusIntervallSek === sek ? 'rgba(197,160,89,0.6)' : 'rgba(255,255,255,0.08)'}`,
                            background: editForm.zyklusIntervallSek === sek ? 'rgba(197,160,89,0.12)' : 'rgba(255,255,255,0.03)',
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
                          <div style={{ width: 18, height: 18, borderRadius: 0, background: timerOnly ? (editForm.zyklusAktiv ? 'rgba(197,160,89,0.2)' : 'rgba(107,114,128,0.15)') : 'rgba(197,160,89,0.15)', border: `1px solid ${timerOnly ? (editForm.zyklusAktiv ? 'rgba(197,160,89,0.4)' : 'rgba(107,114,128,0.3)') : 'rgba(197,160,89,0.3)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>
                            ✓
                          </div>
                          <span style={{ fontSize: 11, color: timerOnly && !editForm.zyklusAktiv ? 'var(--color-text-tertiary)' : 'var(--color-text-muted)' }}>{icon} {label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* ─────────────────────────────────────────────────────────── */}

                  <div style={{ marginTop: 10 }}>
                    <button className="btn btn-primary" onClick={handleSaveSettings} disabled={savingSettings} style={{ width: '100%', height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 0, fontSize: 14, fontWeight: 700 }}>
                      <Save size={18} /> {savingSettings ? (de ? 'Speichern...' : 'Saving...') : saveSuccess ? (de ? '✓ Konfiguration Erfolgreich' : '✓ Configuration Successful') : (de ? 'Konfiguration Speichern' : 'Save Configuration')}
                    </button>
                    {saveError && <div style={{ color: 'var(--color-error)', fontSize: 12, marginTop: 10, textAlign: 'center', fontWeight: 500 }}>✗ {saveError}</div>}
                  </div>

                  <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid var(--color-border)' }}>
                     <h4 style={{ fontSize: 11, color: 'var(--color-error)', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 16, fontWeight: 700 }}>{de ? 'Gefahrenzone' : 'Danger Zone'}</h4>
                     {!deleteConfirm ? (
                       <button className="btn" onClick={() => setDeleteConfirm(true)} style={{ width: '100%', height: 44, borderRadius: 0, borderColor: 'rgba(239,68,68,0.2)', color: 'var(--color-error)', background: 'rgba(239,68,68,0.05)', fontWeight: 600 }}>
                         {de ? 'Agenten aus dem Dienst entlassen' : 'Dismiss agent from service'}
                       </button>
                     ) : (
                       <div style={{ background: 'rgba(239,68,68,0.1)', padding: 16, borderRadius: 0, border: '1px solid rgba(239,68,68,0.2)' }}>
                          <p style={{ fontSize: 13, color: 'var(--color-error)', marginBottom: 16, textAlign: 'center', fontWeight: 600 }}>{de ? 'Agent wirklich unwiderruflich entlassen?' : 'Really dismiss agent irrevocably?'}</p>
                          <div style={{ display: 'flex', gap: 12 }}>
                            <button className="btn btn-ghost" onClick={() => setDeleteConfirm(false)} style={{ flex: 1, borderRadius: 0 }}>{de ? 'Abbrechen' : 'Cancel'}</button>
                            <button className="btn" onClick={handleDelete} style={{ flex: 1, background: 'var(--color-error)', color: '#fff', borderRadius: 0, fontWeight: 700 }}>{de ? 'Ja, entlassen' : 'Yes, dismiss'}</button>
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
                  <div style={{ textAlign: 'center', padding: '40px 20px', background: 'var(--color-bg-secondary)', borderRadius: 0, border: '1px dashed var(--color-border)' }}>
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
                            background: isActive ? 'rgba(197, 160, 89, 0.08)' : 'var(--color-bg-secondary)',
                            border: `1px solid ${isActive ? 'rgba(197, 160, 89, 0.4)' : 'var(--color-border)'}`,
                            borderRadius: 0, cursor: 'pointer', transition: 'all 0.2s', textAlign: 'left',
                          }}
                        >
                          <div style={{
                            width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                            background: isActive ? '#c5a059' : 'rgba(255,255,255,0.08)',
                            border: `2px solid ${isActive ? '#c5a059' : 'rgba(255,255,255,0.2)'}`,
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
                    <div style={{ width: 36, height: 36, borderRadius: 0, background: 'linear-gradient(135deg,rgba(197,160,89,0.2),rgba(197,160,89,0.05))', border: '1px solid rgba(197,160,89,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Sparkles size={18} color="var(--color-accent)" />
                    </div>
                    <div>
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)', margin: 0 }}>SOUL</h3>
                      <p style={{ fontSize: 11, color: 'var(--color-text-muted)', margin: 0 }}>
                        {de ? 'Identität & Persönlichkeit des Agenten' : 'Agent identity & personality'}
                      </p>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6, padding: '10px 14px', background: 'rgba(197,160,89,0.04)', borderRadius: 0, border: '1px solid rgba(197,160,89,0.1)', margin: 0 }}>
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
                  style={{ width: '100%', marginBottom: 20, padding: '12px 0', borderRadius: 0, border: '1px solid rgba(197,160,89,0.3)', background: 'linear-gradient(135deg,rgba(197,160,89,0.1),rgba(197,160,89,0.05))', color: 'var(--color-accent)', fontWeight: 700, fontSize: 13, cursor: generatingSoul ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s', opacity: generatingSoul ? 0.6 : 1 }}
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
                      style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6, background: 'rgba(255,255,255,0.02)', borderColor: value ? 'rgba(197,160,89,0.25)' : 'rgba(255,255,255,0.07)' }}
                    />
                  </div>
                ))}

                {/* Preview */}
                {(soulIdentity || soulPrinciples || soulChecklist || soulPersonality) && (
                  <div style={{ marginBottom: 18, padding: 14, borderRadius: 0, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
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
                  style={{ width: '100%', padding: '13px 0', borderRadius: 0, border: 'none', background: soulSaved ? 'rgba(34,197,94,0.2)' : 'var(--color-accent)', color: soulSaved ? '#22c55e' : '#000', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s', opacity: (savingSoul || (!soulIdentity && !soulPrinciples && !soulChecklist && !soulPersonality)) ? 0.5 : 1 }}
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
            <div style={{ position: 'absolute', inset: 0, zIndex: 10, background: 'rgba(197,160,89,0.12)', border: '2px dashed var(--color-accent)', borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <div style={{ textAlign: 'center', color: 'var(--color-accent)' }}>
                <Upload size={28} style={{ marginBottom: 8 }} />
                <div style={{ fontWeight: 600 }}>{de ? 'Datei hier ablegen' : 'Drop file here'}</div>
              </div>
            </div>
          )}

          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
             <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{t.direktkanal}</h3>
                <div style={{ fontSize: 11, opacity: 0.5, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  Board → {expert.name}
                  {directChatMode && <span style={{ color: 'var(--color-accent)', fontWeight: 700 }}>⚡ Direct</span>}
                  {(() => { try { const m = JSON.parse(expert.verbindungsConfig || '{}').model; return m ? <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)', opacity: 1, background: 'rgba(197,160,89,0.08)', padding: '1px 6px' }}>{m}</span> : null; } catch { return null; } })()}
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
                <div key={m.id ?? i} style={{ alignSelf: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px 14px', borderRadius: 0, fontSize: 11, opacity: 0.65, maxWidth: '90%', whiteSpace: 'pre-line', wordBreak: 'break-word' }}>
                  {m.nachricht}
                </div>
              );

              const hasThinking = isAgent && m.thinking;
              const isStreaming = isAgent && m._streaming;
              const msgText = m.nachricht || '';

              return (
                <div key={m.id ?? i} style={{ alignSelf: isAgent ? 'flex-start' : 'flex-end', maxWidth: '88%', width: '100%' }}>
                  {hasThinking && (
                    <details style={{ marginBottom: 8, border: '1px solid rgba(197,160,89,0.15)', background: 'rgba(197,160,89,0.02)', fontSize: 11 }}>
                      <summary style={{ padding: '6px 10px', cursor: 'pointer', color: 'var(--color-accent)', fontFamily: 'var(--font-mono)', userSelect: 'none' }}>
                        🧠 {de ? 'Denkprozess' : 'Chain of thought'}
                      </summary>
                      <div style={{ padding: '8px 12px', borderTop: '1px solid rgba(197,160,89,0.1)', color: 'var(--color-text-muted)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', lineHeight: 1.5, maxHeight: 200, overflowY: 'auto' }}>
                        {m.thinking}
                      </div>
                    </details>
                  )}
                  <div style={{
                    padding: '12px 16px', borderRadius: 0, fontSize: 13, lineHeight: 1.55,
                    background: isAgent ? 'var(--color-bg-elevated)' : 'var(--color-accent)',
                    color: isAgent ? 'inherit' : '#fff',
                    border: isAgent ? '1px solid var(--color-border)' : 'none',
                    borderBottomLeftRadius: isAgent ? 2 : 16, borderBottomRightRadius: isAgent ? 16 : 2,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 350, overflowY: 'auto',
                  }}>
                    {m.images && m.images.map((img: string, idx: number) => (
                      <img key={idx} src={img} alt="" style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 0, marginBottom: 8, display: 'block' }} />
                    ))}
                    {!m.nachricht && isStreaming
                      ? <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: 12 }}>{m.thinking || (de ? 'Denkt nach…' : 'Thinking…')}</span>
                      : <MessageContent text={m.nachricht} />
                    }
                    {isStreaming && <span style={{ display: 'inline-block', width: 6, height: 6, background: 'var(--color-accent)', marginLeft: 4, verticalAlign: 'middle', animation: 'pulse 1s infinite' }} />}
                  </div>
                  <div style={{ fontSize: 10, opacity: 0.3, marginTop: 4, textAlign: isAgent ? 'left' : 'right', display: 'flex', alignItems: 'center', gap: 8, justifyContent: isAgent ? 'flex-start' : 'flex-end', flexWrap: 'wrap' }}>
                    <span>{new Date(m.erstelltAm).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {isAgent && m._model && (
                      <span style={{ fontFamily: 'var(--font-mono)', background: 'rgba(197,160,89,0.1)', color: 'var(--color-accent)', padding: '1px 5px', opacity: 1 }}>
                        {m._model}
                      </span>
                    )}
                    {isAgent && (m._inputTokens || m._outputTokens) && (
                      <span title={`${de ? 'Eingabe' : 'Input'}: ${m._inputTokens ?? 0} / ${de ? 'Ausgabe' : 'Output'}: ${m._outputTokens ?? 0} tokens`}>
                        {(m._inputTokens ?? 0) + (m._outputTokens ?? 0)} tok
                        {m._costCents ? ` · $${(m._costCents / 100).toFixed(4)}` : ''}
                      </span>
                    )}
                    {isAgent && msgText && (
                      <button onClick={() => speak(msgText, m.id)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', opacity: speakingId === m.id ? 1 : 0.5, color: speakingId === m.id ? 'var(--color-accent)' : 'inherit' }} title={de ? 'Vorlesen' : 'Read aloud'}>
                        {speakingId === m.id ? <VolumeX size={12} /> : <Volume2 size={12} />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {agentTyping && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', gap: 4, padding: '10px 14px', background: 'var(--color-bg-elevated)', borderRadius: 0, border: '1px solid var(--color-border)' }}>
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
              <div style={{ marginBottom: 8, background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 0, overflow: 'hidden' }}>
                {COMMANDS.filter(c => !commandFilter || c.cmd.slice(1).startsWith(commandFilter)).map((c, idx) => (
                  <button
                    key={c.cmd}
                    onClick={() => { setInputText(c.cmd + ' '); setShowCommands(false); setActiveCmd(-1); inputRef.current?.focus(); }}
                    style={{ width: '100%', textAlign: 'left', padding: '8px 14px', background: idx === activeCmd ? 'rgba(197,160,89,0.12)' : 'transparent', border: 'none', borderBottom: '1px solid var(--color-border)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: 'inherit' }}
                    onMouseOver={e => { (e.currentTarget.style.background = 'rgba(197,160,89,0.08)'); setActiveCmd(idx); }}
                    onMouseOut={e => (e.currentTarget.style.background = idx === activeCmd ? 'rgba(197,160,89,0.12)' : 'transparent')}
                  >
                    <span>{c.icon}</span>
                    <span style={{ fontFamily: 'monospace', color: 'var(--color-accent)', fontWeight: 600 }}>{c.cmd}</span>
                    <span style={{ opacity: 0.55 }}>{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
            {/* Pending image preview */}
            {pendingImage && (
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--color-border)', borderRadius: 0 }}>
                <img src={pendingImage.previewUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 0 }} />
                <span style={{ fontSize: 11, opacity: 0.6, flex: 1 }}>{pendingImage.name}</span>
                <button onClick={() => setPendingImage(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', opacity: 0.5 }}><X size={14} /></button>
              </div>
            )}
            {/* Mode indicator + hint */}
            <div style={{ fontSize: 10, opacity: 0.4, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{de ? 'Tippe / für Befehle · Datei per Drag & Drop einfügen' : 'Type / for commands · drag & drop files'}</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setTtsEnabled(!ttsEnabled)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', opacity: ttsEnabled ? 1 : 0.4, color: ttsEnabled ? 'var(--color-accent)' : 'inherit' }} title={de ? 'Text-to-Speech' : 'Text-to-Speech'}>
                  {ttsEnabled ? <Volume2 size={12} /> : <VolumeX size={12} />}
                </button>
                <span style={{ color: directChatMode ? 'var(--color-accent)' : undefined }}>{directChatMode ? '⚡ direct' : '🔄 heartbeat'}</span>
              </div>
            </div>
            <div style={{ position: 'relative' }}>
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />
              <textarea
                ref={inputRef}
                className="input"
                rows={1}
                style={{ width: '100%', paddingRight: 80, minHeight: 44, resize: 'none', overflowY: 'hidden', lineHeight: 1.5 }}
                placeholder={de ? 'Nachricht an Expert... (/ für Befehle)' : 'Message expert... (/ for commands)'}
                value={inputText}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
              />
              <div style={{ position: 'absolute', right: 8, top: 6, display: 'flex', gap: 4 }}>
                <button onClick={pickImage} style={{ width: 32, height: 32, background: 'transparent', border: 'none', borderRadius: 0, color: 'var(--color-text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title={de ? 'Bild hinzufügen' : 'Add image'}>
                  <Paperclip size={15} />
                </button>
                {streaming ? (
                  <button
                    onClick={() => { abortRef.current?.abort(); }}
                    style={{ width: 32, height: 32, background: '#dc2626', border: 'none', borderRadius: 0, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s', animation: 'pulse 1.5s infinite' }}
                    title={de ? 'Antwort abbrechen' : 'Stop response'}
                  >
                    <StopCircle size={15} />
                  </button>
                ) : (
                  <button
                    onClick={sendMessage}
                    disabled={!inputText.trim() && !pendingImage}
                    style={{ width: 32, height: 32, background: (inputText.trim() || pendingImage) ? 'var(--color-accent)' : 'rgba(197,160,89,0.3)', border: 'none', borderRadius: 0, color: '#fff', cursor: (inputText.trim() || pendingImage) ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' }}
                  >
                    <Send size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
