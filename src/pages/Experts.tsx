import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Plus, ArrowRight, Loader2, MessageSquare, Sparkles, Zap, ZapOff,
  Settings2, Crown, Play, ShieldAlert, Activity, Terminal, X,
  Users, CheckCircle2, Target, Wallet, AlertCircle, CornerDownRight,
} from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { zeitRelativ } from '../utils/i18n';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import { apiExperten, apiDashboard, type Experte as ExperteType, type DashboardData } from '../api/client';
import { ExpertModal } from '../components/ExpertModal';
import { ExpertChatDrawer } from '../components/ExpertChatDrawer';
import { useToast } from '../components/ToastProvider';
import { GlassCard } from '../components/GlassCard';

const CLI_ADAPTERS = ['codex-cli', 'gemini-cli', 'claude-code'];

// ── helpers ───────────────────────────────────────────────────────────────────

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

function centZuEuro(cent: number): string {
  return (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 10) return 'jetzt';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

// ── live trace types ──────────────────────────────────────────────────────────

interface TraceEvent {
  id: string;
  expertId: string;
  expertName?: string;
  typ: string;
  titel: string;
  details?: string;
  erstelltAm: string;
}

const TRACE_CFG: Record<string, { color: string; symbol: string; bg: string }> = {
  thinking:       { color: '#a855f7', symbol: '💭', bg: 'rgba(168,85,247,0.08)' },
  action:         { color: '#23CDCB', symbol: '⚡', bg: 'rgba(35,205,202,0.08)' },
  result:         { color: '#22c55e', symbol: '✓',  bg: 'rgba(34,197,94,0.08)'  },
  error:          { color: '#ef4444', symbol: '✗',  bg: 'rgba(239,68,68,0.08)'  },
  warning:        { color: '#f59e0b', symbol: '⚠',  bg: 'rgba(245,158,11,0.08)' },
  task_started:   { color: '#23CDCB', symbol: '▶',  bg: 'rgba(35,205,202,0.06)' },
  task_completed: { color: '#22c55e', symbol: '✔',  bg: 'rgba(34,197,94,0.06)'  },
  info:           { color: '#64748b', symbol: '·',  bg: 'rgba(100,116,139,0.05)' },
};

// ── mini live components ──────────────────────────────────────────────────────

function ThinkingDots() {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(id);
  }, []);
  return <span style={{ color: '#23CDCB', fontWeight: 800, letterSpacing: 2 }}>{dots || '.'}</span>;
}

function ElapsedTimer({ since }: { since: string | null }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!since) return;
    const start = new Date(since).getTime();
    const id = setInterval(() => setElapsed(Date.now() - start), 1000);
    setElapsed(Date.now() - start);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return null;
  return <span style={{ color: '#23CDCB', fontFamily: 'monospace', fontSize: 10 }}>{fmtDuration(elapsed)}</span>;
}

function AnimatedNum({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const frame = () => {
      const pct = Math.min(1, (Date.now() - start) / 600);
      setDisplay(Math.round(value * pct));
      if (pct < 1) requestAnimationFrame(frame);
      else setDisplay(value);
    };
    requestAnimationFrame(frame);
  }, [value]);
  return <>{display}{suffix}</>;
}

// ── System Pulse entry ────────────────────────────────────────────────────────

function PulseEntry({ ev, isNew }: { ev: TraceEvent; isNew: boolean }) {
  const [open, setOpen] = useState(false);
  const tc = TRACE_CFG[ev.typ] || TRACE_CFG.info;
  const hasDetails = !!ev.details?.trim();

  return (
    <div
      onClick={() => hasDetails && setOpen(o => !o)}
      style={{
        borderRadius: 8,
        background: isNew ? tc.bg : open ? `${tc.color}08` : 'transparent',
        border: `1px solid ${tc.color}${isNew ? '30' : open ? '20' : '10'}`,
        animation: isNew ? 'fadeInUp 0.25s ease-out' : 'none',
        cursor: hasDetails ? 'pointer' : 'default',
        transition: 'background 0.15s',
        flexShrink: 0,
      }}
    >
      <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'flex-start', gap: 7 }}>
        <span style={{ fontSize: 11, flexShrink: 0, paddingTop: 1 }}>{tc.symbol}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {ev.expertName && (
            <div style={{ fontSize: 9, fontWeight: 700, color: tc.color, marginBottom: 1 }}>{ev.expertName}</div>
          )}
          <div style={{
            fontSize: 11, color: isNew ? '#cbd5e1' : '#64748b', lineHeight: 1.35,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: open ? 99 : 1, WebkitBoxOrient: 'vertical',
          }}>
            {ev.titel}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: '#334155', whiteSpace: 'nowrap' }}>{timeAgo(ev.erstelltAm)}</span>
          {hasDetails && <span style={{ fontSize: 8, color: tc.color + '80' }}>{open ? '▲' : '▼'}</span>}
        </div>
      </div>
      {open && hasDetails && (
        <div style={{ padding: '0 10px 8px' }}>
          <pre style={{
            fontSize: 10, color: '#64748b', fontFamily: 'monospace',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5,
            maxHeight: 180, overflowY: 'auto',
            background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: '6px 9px', margin: 0,
          }}>
            {ev.details}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Agent Log Panel ───────────────────────────────────────────────────────────

function TraceRow({ ev }: { ev: TraceEvent }) {
  const tc = TRACE_CFG[ev.typ] || TRACE_CFG.info;
  const [open, setOpen] = useState(false);
  const hasDetails = !!ev.details?.trim();

  return (
    <div style={{ borderRadius: 6, background: tc.bg, border: `1px solid ${tc.color}18`, overflow: 'hidden' }}>
      <div
        style={{ padding: '5px 8px', display: 'flex', alignItems: 'flex-start', gap: 6, cursor: hasDetails ? 'pointer' : 'default' }}
        onClick={() => hasDetails && setOpen(o => !o)}
      >
        <span style={{ fontSize: 10, color: tc.color, flexShrink: 0, marginTop: 1 }}>{tc.symbol}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 10, color: '#94a3b8', lineHeight: 1.4,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: open ? 99 : 2, WebkitBoxOrient: 'vertical',
          }}>
            {ev.titel}
          </div>
          {hasDetails && !open && (
            <div style={{ fontSize: 9, color: '#475569', marginTop: 2, fontFamily: 'monospace', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
              {ev.details!.split('\n')[0].slice(0, 80)}
            </div>
          )}
          {hasDetails && open && (
            <pre style={{
              fontSize: 9, color: '#64748b', marginTop: 6, fontFamily: 'monospace',
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5,
              maxHeight: 200, overflowY: 'auto',
              background: 'rgba(0,0,0,0.3)', borderRadius: 4, padding: '6px 8px',
            }}>
              {ev.details}
            </pre>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: '#334155' }}>{timeAgo(ev.erstelltAm)}</span>
          {hasDetails && <span style={{ fontSize: 8, color: tc.color + '80' }}>{open ? '▲' : '▼'}</span>}
        </div>
      </div>
    </div>
  );
}

function AgentLogPanel({
  agent, traces, onClose,
}: {
  agent: ExperteType & { currentTask?: { id: string; titel: string } | null };
  traces: TraceEvent[];
  onClose: () => void;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const isRunning = agent.status === 'running';

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [traces.length]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200000, display: 'flex', alignItems: 'stretch' }}>
      <div style={{ flex: 1, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} onClick={onClose} />
      <div style={{
        width: 520, display: 'flex', flexDirection: 'column',
        background: 'rgba(8,10,20,0.98)',
        borderLeft: '1px solid rgba(35,205,202,0.2)',
        boxShadow: '-20px 0 60px rgba(35,205,202,0.05)',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          background: 'rgba(0,0,0,0.3)',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: agent.avatarFarbe + '20',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, color: agent.avatarFarbe, fontWeight: 700, flexShrink: 0,
          }}>
            {agent.avatar}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{agent.name}</span>
              {isRunning && (
                <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: 'rgba(35,205,202,0.2)', color: '#23CDCB', fontWeight: 800 }}>
                  LÄUFT
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{agent.rolle}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {agent.currentTask && (
          <div style={{
            padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
            background: isRunning ? 'rgba(35,205,202,0.05)' : 'rgba(0,0,0,0.2)',
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}>
            {isRunning
              ? <Play size={10} style={{ color: '#23CDCB' }} />
              : <CheckCircle2 size={10} style={{ color: '#475569' }} />}
            <span style={{ fontSize: 11, color: isRunning ? '#cbd5e1' : '#64748b', flex: 1 }}>
              {agent.currentTask.titel}
            </span>
            {isRunning && <ElapsedTimer since={agent.letzterZyklus} />}
            {isRunning && <ThinkingDots />}
          </div>
        )}

        <div style={{
          padding: '8px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <Terminal size={11} style={{ color: '#475569' }} />
          <span style={{ fontSize: 9, fontWeight: 800, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Aktivitätslog · {traces.length} Einträge
          </span>
          {isRunning && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#23CDCB', animation: 'pulse 1.5s ease-in-out infinite' }} />
              <span style={{ fontSize: 9, color: '#23CDCB', fontWeight: 700 }}>LIVE</span>
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {traces.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#334155', fontSize: 12, padding: 40 }}>
              Noch keine Aktivität aufgezeichnet
            </div>
          ) : [...traces].reverse().map((ev) => (
            <TraceRow key={ev.id} ev={ev} />
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

// ── labels ────────────────────────────────────────────────────────────────────

const verbindungsLabels: Record<string, string> = {
  'claude-code': 'Claude CLI', claude: 'Claude CLI', codex: 'Codex CLI', cursor: 'Cursor',
  http: 'HTTP Webhook', bash: 'Bash Script', openrouter: 'OpenRouter', openai: 'OpenAI GPT',
  anthropic: 'Anthropic', ollama: 'Ollama (Lokal)', ceo: 'CEO Engine', custom: 'Custom API',
};

// ── Main Component ────────────────────────────────────────────────────────────

export function Experts() {
  const i18n = useI18n();
  const { language } = i18n;
  const de = language === 'de';
  const navigate = useNavigate();
  const toast = useToast();
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', i18n.t.nav.experten]);

  const { data: alleExperten, loading, reload } = useApi<ExperteType[]>(
    () => apiExperten.liste(aktivesUnternehmen!.id),
    [aktivesUnternehmen?.id],
  );

  // ── existing state ────────────────────────────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [editingExpert, setEditingExpert] = useState<ExperteType | null>(null);
  const [activeChatExpert, setActiveChatExpert] = useState<ExperteType | null>(null);
  const [wakingUp, setWakingUp] = useState<Set<string>>(new Set());

  type QualityEntry = {
    expertId: string; name: string; totalRuns: number; approvedRuns: number;
    failedRuns: number; criticRejections: number; escalations: number;
    emptyActions: number; bashFailures: number; hedgingCount: number;
    halluzinationsScore: number; qualityLabel: string;
  };
  const [qualitaet, setQualitaet] = useState<QualityEntry[]>([]);
  const [showQuality, setShowQuality] = useState(false);

  // ── live / War Room state ─────────────────────────────────────────────────
  const [dashData, setDashData] = useState<DashboardData | null>(null);
  const [agentTraces, setAgentTraces] = useState<Record<string, TraceEvent[]>>({});
  const [feed, setFeed] = useState<TraceEvent[]>([]);
  const [showPulse, setShowPulse] = useState(false);
  const [pulseFilter, setPulseFilter] = useState<'all' | 'error' | 'action' | 'thinking'>('all');
  const [pulseAutoScroll, setPulseAutoScroll] = useState(true);
  const [newEventCount, setNewEventCount] = useState(0);
  const [logAgent, setLogAgent] = useState<ExperteType | null>(null);
  // WS live overlay: per-agent status + currentTask overrides DB values
  const [liveOverlay, setLiveOverlay] = useState<Record<string, {
    status?: string;
    currentTask?: { id: string; titel: string } | null;
  }>>({});
  const pulseRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // ── dashboard data ────────────────────────────────────────────────────────
  const loadDash = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    try { setDashData(await apiDashboard.laden(aktivesUnternehmen.id)); } catch {}
  }, [aktivesUnternehmen?.id]);

  useEffect(() => { loadDash(); }, [loadDash]);
  useEffect(() => { const id = setInterval(loadDash, 30_000); return () => clearInterval(id); }, [loadDash]);

  // ── per-agent trace history ───────────────────────────────────────────────
  const loadTraces = useCallback(async () => {
    if (!alleExperten?.length) return;
    const token = localStorage.getItem('opencognit_token');
    const map: Record<string, TraceEvent[]> = {};
    await Promise.all(alleExperten.map(async (a) => {
      try {
        const r = await fetch(`/api/experten/${a.id}/trace/history?limit=30`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (r.ok) map[a.id] = await r.json();
      } catch {}
    }));
    setAgentTraces(map);
    const combined = Object.entries(map)
      .flatMap(([id, ts]) => ts.map(t => ({ ...t, expertName: alleExperten.find(a => a.id === id)?.name })))
      .sort((a, b) => new Date(a.erstelltAm).getTime() - new Date(b.erstelltAm).getTime())
      .slice(-80);
    setFeed(combined);
  }, [alleExperten]);

  useEffect(() => { loadTraces(); }, [loadTraces]);

  // ── WebSocket live updates ────────────────────────────────────────────────
  useEffect(() => {
    if (!aktivesUnternehmen) return;
    const token = localStorage.getItem('opencognit_token');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.hostname}:3201/ws${token ? `?token=${token}` : ''}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.unternehmenId && msg.unternehmenId !== aktivesUnternehmen.id) return;

        if (msg.type === 'trace' && msg.data) {
          const { expertId, typ, titel, details, erstelltAm, expertName } = msg.data;
          const ev: TraceEvent = {
            id: crypto.randomUUID(), expertId, typ, titel, details,
            expertName, erstelltAm: erstelltAm || new Date().toISOString(),
          };
          setAgentTraces(prev => ({ ...prev, [expertId]: [ev, ...(prev[expertId] || [])].slice(0, 30) }));
          setFeed(prev => [...prev, ev].slice(-80));
          setLiveOverlay(prev => ({ ...prev, [expertId]: { ...prev[expertId], status: 'running' } }));
        }

        if (msg.type === 'task_started' && msg.agentId) {
          setLiveOverlay(prev => ({
            ...prev,
            [msg.agentId]: { status: 'running', currentTask: { id: msg.taskId || '', titel: msg.taskTitel || '' } },
          }));
          const agentName = alleExperten?.find(a => a.id === msg.agentId)?.name;
          setFeed(prev => [...prev, {
            id: crypto.randomUUID(), expertId: msg.agentId, expertName: agentName,
            typ: 'task_started', titel: msg.taskTitel || 'Task gestartet', erstelltAm: new Date().toISOString(),
          }].slice(-80));
        }

        if (msg.type === 'task_completed' && msg.agentId) {
          setLiveOverlay(prev => ({ ...prev, [msg.agentId]: { status: 'active', currentTask: null } }));
          const agentName = alleExperten?.find(a => a.id === msg.agentId)?.name;
          setFeed(prev => [...prev, {
            id: crypto.randomUUID(), expertId: msg.agentId, expertName: agentName,
            typ: 'task_completed', titel: msg.taskTitel || 'Task abgeschlossen', erstelltAm: new Date().toISOString(),
          }].slice(-80));
          setTimeout(loadDash, 2000);
        }
      } catch {}
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [aktivesUnternehmen?.id]);

  // ── pulse auto-scroll ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!pulseRef.current || !showPulse) return;
    if (pulseAutoScroll) {
      pulseRef.current.scrollTop = pulseRef.current.scrollHeight;
      setNewEventCount(0);
    } else {
      setNewEventCount(c => c + 1);
    }
  }, [feed.length, showPulse]);

  const handlePulseScroll = () => {
    if (!pulseRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = pulseRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (atBottom !== pulseAutoScroll) {
      setPulseAutoScroll(atBottom);
      if (atBottom) setNewEventCount(0);
    }
  };

  // ── quality fetch ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!aktivesUnternehmen || !showQuality) return;
    const token = localStorage.getItem('opencognit_token');
    fetch(`/api/unternehmen/${aktivesUnternehmen.id}/agent-qualitaet`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(setQualitaet).catch(() => {});
  }, [aktivesUnternehmen?.id, showQuality]);

  // ── wakeup ────────────────────────────────────────────────────────────────
  const triggerWakeup = async (expertId: string) => {
    const expert = alleExperten?.find(e => e.id === expertId);
    setWakingUp(prev => new Set(prev).add(expertId));
    try {
      await authFetch(`/api/experten/${expertId}/wakeup`, { method: 'POST' });
      toast.agent(
        de ? `${expert?.name || 'Agent'} wird aufgeweckt` : `Waking up ${expert?.name || 'agent'}`,
        de ? 'Agent startet seinen Arbeitszyklus' : 'Agent is starting its work cycle',
      );
    } catch (e: any) {
      toast.error(de ? 'Wakeup fehlgeschlagen' : 'Wakeup failed', e.message);
    } finally {
      setTimeout(() => {
        setWakingUp(prev => { const s = new Set(prev); s.delete(expertId); return s; });
        reload();
      }, 1500);
    }
  };

  if (!aktivesUnternehmen) return null;

  const runningCount = dashData?.experten.running ?? 0;

  return (
    <>
      {(activeChatExpert || editingExpert) && (
        <ExpertChatDrawer
          expert={(activeChatExpert || editingExpert)!}
          initialTab={editingExpert ? 'einstellungen' : 'überblick'}
          onClose={() => { setActiveChatExpert(null); setEditingExpert(null); }}
          onDeleted={() => { setActiveChatExpert(null); setEditingExpert(null); reload(); }}
          onUpdated={() => reload()}
        />
      )}

      {logAgent && (
        <AgentLogPanel
          agent={{ ...logAgent, currentTask: liveOverlay[logAgent.id]?.currentTask ?? null }}
          traces={agentTraces[logAgent.id] || []}
          onClose={() => setLogAgent(null)}
        />
      )}

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

        {/* ── Main column ────────────────────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <Sparkles size={20} style={{ color: '#23CDCB' }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#23CDCB', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {aktivesUnternehmen.name}
                </span>
                {runningCount > 0 && (
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '2px 10px', borderRadius: 20,
                    background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.25)',
                    fontSize: 11, fontWeight: 700, color: '#23CDCB',
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#23CDCB', display: 'inline-block', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    {runningCount} {de ? 'aktiv' : 'active'}
                  </span>
                )}
              </div>
              <h1 style={{
                fontSize: '2rem', fontWeight: 700,
                background: 'linear-gradient(to bottom right, #23CDCB 0%, #ffffff 100%)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
              }}>{i18n.t.experten.title}</h1>
              <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.25rem' }}>{i18n.t.experten.subtitle}</p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                onClick={() => setShowQuality(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.75rem 1.25rem',
                  backgroundColor: showQuality ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${showQuality ? 'rgba(239,68,68,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '12px', color: showQuality ? '#ef4444' : '#71717a',
                  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                <ShieldAlert size={16} /> {de ? 'Qualität' : 'Quality'}
              </button>
              <button
                onClick={() => setShowPulse(v => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.75rem 1.25rem',
                  backgroundColor: showPulse ? 'rgba(35,205,202,0.12)' : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${showPulse ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '12px', color: showPulse ? '#23CDCB' : '#71717a',
                  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                <Activity size={16} /> Live
              </button>
              <button
                onClick={() => setShowModal(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.75rem 1.25rem',
                  backgroundColor: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
                  borderRadius: '12px', color: '#23CDCB',
                  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                <Plus size={16} /> {i18n.t.experten.neuerExperte}
              </button>
            </div>
          </div>

          <PageHelp id="agents" lang={i18n.language} />

          {/* Metrics row */}
          {dashData && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.875rem', marginBottom: '1.5rem' }}>
              {[
                { icon: <Users size={14} style={{ color: '#23CDCB' }} />, label: de ? 'AGENTEN' : 'AGENTS', value: dashData.experten.gesamt, sub: `${dashData.experten.running} ${de ? 'laufen' : 'running'}`, color: '#23CDCB' },
                { icon: <CheckCircle2 size={14} style={{ color: '#22c55e' }} />, label: de ? 'ERLEDIGT' : 'DONE', value: dashData.aufgaben.erledigt, sub: `${dashData.aufgaben.inBearbeitung} ${de ? 'laufend' : 'in progress'}`, color: '#22c55e' },
                { icon: <Target size={14} style={{ color: '#a855f7' }} />, label: de ? 'OFFEN' : 'OPEN', value: dashData.aufgaben.offen, sub: `${dashData.aufgaben.blockiert} ${de ? 'blockiert' : 'blocked'}`, color: dashData.aufgaben.blockiert > 0 ? '#f59e0b' : '#a855f7' },
                { icon: <Wallet size={14} style={{ color: '#f59e0b' }} />, label: 'BUDGET', value: dashData.kosten.prozent, suffix: '%', sub: centZuEuro(dashData.kosten.gesamtVerbraucht), color: dashData.kosten.prozent > 80 ? '#ef4444' : '#f59e0b' },
              ].map((m, i) => (
                <GlassCard key={i} accent={m.color} style={{ padding: '0.875rem 1rem', borderRadius: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    {m.icon}
                    <span style={{ fontSize: '0.625rem', fontWeight: 800, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{m.label}</span>
                  </div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: m.color, lineHeight: 1, marginBottom: 2 }}>
                    <AnimatedNum value={m.value} suffix={(m as any).suffix} />
                  </div>
                  <div style={{ fontSize: '0.6875rem', color: '#475569' }}>{m.sub}</div>
                </GlassCard>
              ))}
            </div>
          )}

          {/* Agent grid */}
          {(loading || !alleExperten) ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
              <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#23CDCB' }} />
            </div>
          ) : null}

          <div style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '1.25rem',
            display: (loading || !alleExperten) ? 'none' : 'grid',
          }}>
            {(alleExperten ?? []).map((m, i) => {
              const budget = m.budgetMonatCent > 0 ? Math.round((m.verbrauchtMonatCent / m.budgetMonatCent) * 100) : 0;
              const manager = m.reportsTo ? (alleExperten ?? []).find(x => x.id === m.reportsTo) : null;
              let modell = '';
              try { if (m.verbindungsConfig) { const c = JSON.parse(m.verbindungsConfig); modell = c.model || ''; } } catch {}

              const isCEO = (() => {
                try { const cfg = JSON.parse(m.verbindungsConfig || '{}'); return cfg.isOrchestrator === true; } catch { return false; }
              })();

              const live = liveOverlay[m.id];
              const effectiveStatus = live?.status ?? m.status;
              const isRunning = effectiveStatus === 'running';
              const currentTask = live?.currentTask;
              const lastTrace = (agentTraces[m.id] || [])[0];

              return (
                <GlassCard
                  key={m.id}
                  onClick={() => setActiveChatExpert(m)}
                  active={isRunning}
                  accent={isCEO ? '#FFD700' : '#23CDCB'}
                  style={{
                    padding: '1.5rem', borderRadius: '24px',
                    animation: `fadeInUp 0.5s ease-out ${Math.min(i, 4) * 0.1}s both`,
                    ...(isCEO ? { boxShadow: '0 0 48px rgba(255, 215, 0, 0.07), 0 0 12px rgba(255, 215, 0, 0.04)' } : {}),
                  }}
                >
                  {isCEO && (
                    <div style={{
                      position: 'absolute', top: '0.75rem', right: '3.25rem',
                      background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.2)',
                      padding: '4px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: 6, zIndex: 10,
                    }}>
                      <Crown size={12} color="#FFD700" />
                      <span style={{ fontSize: '10px', color: '#FFD700', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>CEO</span>
                    </div>
                  )}

                  {/* Avatar + name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      <div style={{
                        width: '48px', height: '48px', borderRadius: '12px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.125rem', fontWeight: 600,
                        background: m.avatarFarbe + '22', color: m.avatarFarbe,
                        border: isRunning ? `1.5px solid ${m.avatarFarbe}80` : 'none',
                      }}>
                        {m.avatar}
                      </div>
                      {isRunning && (
                        <div style={{
                          position: 'absolute', bottom: -2, right: -2, width: 10, height: 10,
                          borderRadius: '50%', background: '#23CDCB',
                          border: '2px solid rgba(8,10,20,0.9)',
                          boxShadow: '0 0 10px rgba(35,205,202,0.6)',
                          animation: 'pulse 1.5s ease-in-out infinite',
                        }} />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{m.name}</span>
                        <StatusBadge status={effectiveStatus} />
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingExpert(m); }}
                          style={{ padding: '0.25rem', background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', display: 'flex', alignItems: 'center', marginLeft: 'auto', transition: 'color 0.2s' }}
                          onMouseEnter={e => e.currentTarget.style.color = '#23CDCB'}
                          onMouseLeave={e => e.currentTarget.style.color = '#71717a'}
                          title={i18n.t.actions.bearbeiten}
                        >
                          <Settings2 size={14} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.25rem' }}>
                        {(m.verbindungsTyp === 'ceo' || /ceo|geschäftsführer/i.test(m.rolle)) && (
                          <span style={{ padding: '0.125rem 0.5rem', backgroundColor: 'rgba(251,191,36,0.15)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: '9999px', fontSize: '0.625rem', fontWeight: 700, color: '#fbbf24', letterSpacing: '0.05em', textTransform: 'uppercase' }}>CEO</span>
                        )}
                        {CLI_ADAPTERS.includes(m.verbindungsTyp) && (
                          <span title={i18n.t.gedaechtnis.subscriptionBadge} style={{ padding: '0.125rem 0.5rem', backgroundColor: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '9999px', fontSize: '0.625rem', fontWeight: 700, color: '#a855f7', letterSpacing: '0.05em', textTransform: 'uppercase' }}>🔑</span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.875rem', color: '#71717a' }}>{m.titel}</div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.8125rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: '#71717a' }}>{i18n.t.experten.rolle}</span>
                      <span style={{ color: '#d4d4d8' }}>{m.rolle}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: '#71717a' }}>{i18n.t.experten.verbindung}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'end' }}>
                        <span style={{
                          padding: '0.25rem 0.625rem',
                          backgroundColor: CLI_ADAPTERS.includes(m.verbindungsTyp) ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)',
                          border: CLI_ADAPTERS.includes(m.verbindungsTyp) ? '1px solid rgba(168,85,247,0.3)' : '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '9999px', fontSize: '0.75rem',
                          color: CLI_ADAPTERS.includes(m.verbindungsTyp) ? '#a855f7' : '#d4d4d8',
                          fontWeight: CLI_ADAPTERS.includes(m.verbindungsTyp) ? 600 : 400,
                        }}>{verbindungsLabels[m.verbindungsTyp] || m.verbindungsTyp}</span>
                        {modell && <span style={{ fontSize: '0.6875rem', color: '#71717a', marginTop: '0.25rem' }}>{modell}</span>}
                      </div>
                    </div>
                    {manager && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ color: '#71717a' }}>{de ? 'Vorgesetzter' : 'Reports to'}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ width: '24px', height: '24px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.625rem', fontWeight: 600, background: manager.avatarFarbe + '22', color: manager.avatarFarbe }}>{manager.avatar}</div>
                          <span style={{ color: '#d4d4d8' }}>{manager.name}</span>
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: '#71717a' }}>{i18n.t.experten.letzterZyklus}</span>
                      <span style={{ color: '#d4d4d8' }}>{zeitRelativ(m.letzterZyklus, i18n.t)}</span>
                    </div>
                    {m.verbindungsTyp !== 'ollama' && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                          <span style={{ color: '#71717a' }}>{i18n.t.experten.budget}</span>
                          <span style={{ color: '#d4d4d8' }}>
                            {centZuEuro(m.verbrauchtMonatCent)} / {centZuEuro(m.budgetMonatCent)}
                            <span style={{ marginLeft: '0.5rem', color: budget > 90 ? '#ef4444' : budget > 70 ? '#eab308' : '#71717a', fontWeight: 600 }}>({budget}%)</span>
                          </span>
                        </div>
                        <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${budget}%`, backgroundColor: budget > 90 ? '#ef4444' : budget > 70 ? '#eab308' : '#22c55e', borderRadius: '3px', transition: 'width 0.3s' }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* ── Live section (shows when agent is running) ── */}
                  {isRunning && (
                    <div style={{
                      marginTop: '0.75rem', padding: '0.625rem 0.75rem',
                      borderRadius: '10px', background: 'rgba(35,205,202,0.05)', border: '1px solid rgba(35,205,202,0.15)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: lastTrace ? 4 : 0 }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#23CDCB', animation: 'pulse 1s ease-in-out infinite', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.75rem', color: currentTask ? '#cbd5e1' : '#64748b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontStyle: currentTask ? 'normal' : 'italic' }}>
                          {currentTask?.titel ?? (de ? 'Aktiv' : 'Running')}
                        </span>
                        <ElapsedTimer since={m.letzterZyklus} />
                        <ThinkingDots />
                      </div>
                      {lastTrace && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: 11 }}>
                          <CornerDownRight size={8} style={{ color: '#23CDCB', flexShrink: 0 }} />
                          <span style={{ fontSize: '0.6875rem', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {lastTrace.titel}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Autonomy toggle */}
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginTop: '0.75rem', padding: '0.625rem 0.875rem',
                      backgroundColor: m.zyklusAktiv ? 'rgba(35,205,202,0.06)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${m.zyklusAktiv ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.06)'}`,
                      borderRadius: '10px', transition: 'all 0.2s',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        {m.zyklusAktiv ? <Zap size={13} color="#23CDCB" /> : <ZapOff size={13} color="#71717a" />}
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: m.zyklusAktiv ? '#23CDCB' : '#a1a1aa' }}>
                          {m.zyklusAktiv ? i18n.t.experten.autonomAktiv : i18n.t.experten.autonomInaktiv}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.6875rem', color: '#52525b', paddingLeft: '1.25rem' }}>
                        {m.zyklusAktiv ? i18n.t.experten.autonomAktivHint : i18n.t.experten.autonomInaktivHint}
                      </span>
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await authFetch(`/api/mitarbeiter/${m.id}`, { method: 'PATCH', body: JSON.stringify({ zyklusAktiv: !m.zyklusAktiv }) });
                        reload();
                      }}
                      style={{ position: 'relative', width: '38px', height: '22px', borderRadius: '11px', backgroundColor: m.zyklusAktiv ? '#23CDCB' : 'rgba(255,255,255,0.1)', border: 'none', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0 }}
                    >
                      <span style={{ position: 'absolute', top: '3px', left: m.zyklusAktiv ? '19px' : '3px', width: '16px', height: '16px', borderRadius: '50%', backgroundColor: '#ffffff', transition: 'left 0.2s', display: 'block' }} />
                    </button>
                  </div>

                  {/* Footer */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: '0.75rem', color: '#71717a', maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.faehigkeiten}
                    </div>
                    <div style={{ display: 'flex', gap: '0.375rem' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveChatExpert(m); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.5rem 0.625rem', backgroundColor: 'rgba(35,205,202,0.08)', border: 'none', borderRadius: '8px', color: '#23CDCB', fontWeight: 600, fontSize: '0.8125rem', cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(35,205,202,0.15)'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(35,205,202,0.08)'}
                      >
                        <MessageSquare size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setLogAgent(m); }}
                        title={de ? 'Aktivitätslog' : 'Activity log'}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.5rem 0.625rem', backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: '#71717a', fontSize: '0.8125rem', cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={e => { e.currentTarget.style.color = '#23CDCB'; e.currentTarget.style.borderColor = 'rgba(35,205,202,0.3)'; }}
                        onMouseLeave={e => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                      >
                        <Terminal size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); triggerWakeup(m.id); }}
                        disabled={wakingUp.has(m.id)}
                        title={de ? 'Jetzt ausführen' : 'Run now'}
                        style={{ display: 'flex', alignItems: 'center', padding: '0.5rem 0.625rem', backgroundColor: wakingUp.has(m.id) ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${wakingUp.has(m.id) ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '8px', color: wakingUp.has(m.id) ? '#22c55e' : '#71717a', fontSize: '0.8125rem', cursor: wakingUp.has(m.id) ? 'default' : 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={e => { if (!wakingUp.has(m.id)) { e.currentTarget.style.backgroundColor = 'rgba(34,197,94,0.1)'; e.currentTarget.style.color = '#22c55e'; } }}
                        onMouseLeave={e => { if (!wakingUp.has(m.id)) { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#71717a'; } }}
                      >
                        {wakingUp.has(m.id) ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={14} />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate('/tasks'); }}
                        style={{ display: 'flex', alignItems: 'center', padding: '0.5rem 0.5rem', backgroundColor: 'transparent', border: 'none', borderRadius: '8px', color: '#23CDCB', fontSize: '0.8125rem', cursor: 'pointer' }}
                        title={de ? 'Aufgaben anzeigen' : 'View tasks'}
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>

          {/* Quality panel */}
          {showQuality && (
            <div style={{ marginTop: '2.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <ShieldAlert size={18} style={{ color: '#ef4444' }} />
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
                  {de ? 'Agent-Qualität & Halluzinations-Tracking' : 'Agent Quality & Hallucination Tracking'}
                </h2>
              </div>
              {qualitaet.length === 0 ? (
                <div style={{ padding: '2rem', borderRadius: '16px', backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', textAlign: 'center', color: '#71717a', fontSize: '0.875rem' }}>
                  {de ? 'Noch keine Runs aufgezeichnet — Agenten müssen erst Aufgaben ausführen.' : 'No runs recorded yet.'}
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
                  {qualitaet.map(q => {
                    const score = q.halluzinationsScore;
                    const scoreColor = score >= 70 ? '#ef4444' : score >= 40 ? '#eab308' : '#22c55e';
                    const labelColor = q.qualityLabel === 'critical' ? '#ef4444' : q.qualityLabel === 'low' ? '#f97316' : q.qualityLabel === 'moderate' ? '#eab308' : '#22c55e';
                    const labelText = q.qualityLabel === 'critical' ? (de ? 'Kritisch' : 'Critical') : q.qualityLabel === 'low' ? (de ? 'Niedrig' : 'Low') : q.qualityLabel === 'moderate' ? (de ? 'Mittel' : 'Moderate') : (de ? 'Gut' : 'Good');
                    return (
                      <div key={q.expertId} style={{ padding: '1.25rem', borderRadius: '16px', backgroundColor: 'rgba(255,255,255,0.03)', border: `1px solid ${score >= 70 ? 'rgba(239,68,68,0.2)' : score >= 40 ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.15)'}`, backdropFilter: 'blur(8px)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                          <span style={{ fontWeight: 700, color: '#ffffff', fontSize: '0.9375rem' }}>{q.name}</span>
                          <span style={{ padding: '0.25rem 0.625rem', borderRadius: '9999px', fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: labelColor + '22', color: labelColor, border: `1px solid ${labelColor}44` }}>{labelText}</span>
                        </div>
                        <div style={{ marginBottom: '1rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                            <span style={{ fontSize: '0.75rem', color: '#71717a' }}>{de ? 'Halluzinations-Score' : 'Hallucination Score'}</span>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: scoreColor }}>{score}/100</span>
                          </div>
                          <div style={{ height: '8px', backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${score}%`, backgroundColor: scoreColor, borderRadius: '4px', transition: 'width 0.5s', boxShadow: `0 0 8px ${scoreColor}66` }} />
                          </div>
                          <div style={{ fontSize: '0.6875rem', color: '#52525b', marginTop: '0.25rem' }}>
                            {de ? `${q.approvedRuns} von ${q.totalRuns} Runs erfolgreich` : `${q.approvedRuns} of ${q.totalRuns} runs successful`}
                          </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                          {[
                            { label: de ? 'Critic-Ablehnungen' : 'Critic Rejections', value: q.criticRejections, warn: q.criticRejections > 2 },
                            { label: de ? 'Eskalationen' : 'Escalations', value: q.escalations, warn: q.escalations > 0 },
                            { label: de ? 'Leere Aktionen' : 'Empty Actions', value: q.emptyActions, warn: q.emptyActions > 3 },
                            { label: de ? 'Bash-Fehler' : 'Bash Failures', value: q.bashFailures, warn: q.bashFailures > 2 },
                            { label: de ? 'Hedging-Sprache' : 'Hedging Language', value: q.hedgingCount, warn: q.hedgingCount > 3 },
                            { label: de ? 'Fehlgeschlagen' : 'Failed Runs', value: q.failedRuns, warn: q.failedRuns > 1 },
                          ].map(({ label, value, warn }) => (
                            <div key={label} style={{ padding: '0.5rem 0.625rem', borderRadius: '8px', backgroundColor: warn && value > 0 ? 'rgba(239,68,68,0.07)' : 'rgba(255,255,255,0.03)', border: `1px solid ${warn && value > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.06)'}` }}>
                              <div style={{ fontSize: '0.6875rem', color: '#71717a', marginBottom: '0.25rem' }}>{label}</div>
                              <div style={{ fontSize: '1.125rem', fontWeight: 700, color: warn && value > 0 ? '#ef4444' : value === 0 ? '#22c55e' : '#d4d4d8' }}>{value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── System Pulse sidebar ──────────────────────────────────────────── */}
        {showPulse && (
          <div style={{
            width: 300, flexShrink: 0,
            position: 'sticky', top: '1rem',
            height: 'calc(100vh - 8rem)',
            display: 'flex', flexDirection: 'column',
            borderRadius: '20px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(35,205,202,0.12)',
            backdropFilter: 'blur(12px)',
            overflow: 'hidden',
          }}>
            {/* Header */}
            <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(35,205,202,0.1)', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Activity size={13} style={{ color: '#23CDCB' }} />
                <span style={{ fontSize: '0.625rem', fontWeight: 800, color: '#23CDCB', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  System Pulse
                </span>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
                  {!pulseAutoScroll ? (
                    <span style={{ fontSize: 8, color: '#f59e0b', fontWeight: 700 }}>⏸ PAUSED</span>
                  ) : (
                    <>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#23CDCB', animation: 'pulse 2s ease-in-out infinite' }} />
                      <span style={{ fontSize: 9, color: '#23CDCB', fontWeight: 700 }}>LIVE</span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 3 }}>
                {(['all', 'error', 'action', 'thinking'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => setPulseFilter(f)}
                    style={{
                      padding: '2px 7px', borderRadius: 4, border: 'none', cursor: 'pointer',
                      fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                      background: pulseFilter === f ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.04)',
                      color: pulseFilter === f ? '#23CDCB' : '#334155', transition: 'all 0.15s',
                    }}
                  >
                    {f === 'all' ? (de ? 'Alle' : 'All') : f === 'error' ? '⚠ Err' : f === 'action' ? '⚡ Act' : '💭 Think'}
                  </button>
                ))}
              </div>
            </div>

            {/* Feed */}
            <div
              ref={pulseRef}
              onScroll={handlePulseScroll}
              style={{ flex: 1, overflowY: 'auto', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}
            >
              {feed.length === 0 ? (
                <div style={{ color: '#334155', fontSize: 11, padding: '20px 0', textAlign: 'center' }}>
                  {de ? 'Warte auf Ereignisse...' : 'Waiting for events...'}
                </div>
              ) : (() => {
                const now = Date.now();
                const filtered = pulseFilter === 'all' ? feed
                  : feed.filter(ev =>
                      pulseFilter === 'error' ? (ev.typ === 'error' || ev.typ === 'warning')
                      : pulseFilter === 'action' ? (ev.typ === 'action' || ev.typ === 'task_started' || ev.typ === 'task_completed')
                      : (ev.typ === 'thinking' || ev.typ === 'planning' || ev.typ === 'info'),
                    );
                return filtered.map((ev, i) => (
                  <PulseEntry key={ev.id || i} ev={ev} isNew={now - new Date(ev.erstelltAm).getTime() < 8000} />
                ));
              })()}
            </div>

            {!pulseAutoScroll && newEventCount > 0 && (
              <button
                onClick={() => {
                  pulseRef.current?.scrollTo({ top: pulseRef.current.scrollHeight, behavior: 'smooth' });
                  setPulseAutoScroll(true);
                  setNewEventCount(0);
                }}
                style={{
                  margin: '8px', borderRadius: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                  padding: '6px 10px',
                  background: 'rgba(35,205,202,0.15)', border: '1px solid rgba(35,205,202,0.4)',
                  color: '#23CDCB', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                }}
              >
                ↓ {newEventCount} {de ? 'neue' : 'new'}
              </button>
            )}

            {(dashData?.pendingApprovals || 0) > 0 && (
              <div style={{ padding: '10px 14px', borderTop: '1px solid rgba(245,158,11,0.2)', background: 'rgba(245,158,11,0.05)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertCircle size={12} style={{ color: '#f59e0b' }} />
                <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
                  {dashData?.pendingApprovals} {de ? 'Genehmigung(en) ausstehend' : 'approval(s) pending'}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <ExpertModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSaved={() => { setShowModal(false); reload(); }}
      />
    </>
  );
}
