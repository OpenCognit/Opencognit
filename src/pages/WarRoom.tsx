import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X, Zap, CheckCircle2, Clock, Wallet, Users, Radio, Target,
  Cpu, ChevronDown, ChevronUp, Activity, Terminal, CornerDownRight,
  Play, Pause, AlertCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';
import { apiDashboard, type DashboardData } from '../api/client';
import { GlassCard } from '../components/GlassCard';

// ── helpers ───────────────────────────────────────────────────────────────────

function authFetch(url: string, opts: RequestInit = {}) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...opts.headers } });
}

function formatCost(cent: number, language: string) {
  const locale = language === 'de' ? 'de-DE' : 'en-US';
  const currency = language === 'de' ? 'EUR' : 'USD';
  return (cent / 100).toLocaleString(locale, { style: 'currency', currency });
}

function timeAgo(iso: string, de: boolean) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 10) return de ? 'gerade eben' : 'just now';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}m ${sec}s`;
}

const STATUS_CFG: Record<string, { color: string; glow: string; labelDe: string; labelEn: string }> = {
  running:    { color: '#23CDCB', glow: '0 0 20px rgba(35,205,202,0.5)', labelDe: 'LÄUFT', labelEn: 'RUNNING' },
  active:     { color: '#22c55e', glow: '0 0 10px rgba(34,197,94,0.3)', labelDe: 'BEREIT', labelEn: 'READY' },
  idle:       { color: '#94a3b8', glow: 'none', labelDe: 'IDLE', labelEn: 'IDLE' },
  paused:     { color: '#f59e0b', glow: '0 0 10px rgba(245,158,11,0.3)', labelDe: 'PAUSIERT', labelEn: 'PAUSED' },
  error:      { color: '#ef4444', glow: '0 0 15px rgba(239,68,68,0.5)', labelDe: 'FEHLER', labelEn: 'ERROR' },
  terminated: { color: '#475569', glow: 'none', labelDe: 'AUS', labelEn: 'OFF' },
};

const TRACE_CFG: Record<string, { color: string; symbol: string; bg: string; label: string }> = {
  thinking:       { color: '#a855f7', symbol: '💭', bg: 'rgba(168,85,247,0.08)', label: 'Thinking' },
  action:         { color: '#23CDCB', symbol: '⚡', bg: 'rgba(35,205,202,0.08)', label: 'Action' },
  result:         { color: '#22c55e', symbol: '✓',  bg: 'rgba(34,197,94,0.08)',  label: 'Result' },
  error:          { color: '#ef4444', symbol: '✗',  bg: 'rgba(239,68,68,0.08)',  label: 'Error' },
  warning:        { color: '#f59e0b', symbol: '⚠',  bg: 'rgba(245,158,11,0.08)', label: 'Warning' },
  task_started:   { color: '#23CDCB', symbol: '▶',  bg: 'rgba(35,205,202,0.06)', label: 'Started' },
  task_completed: { color: '#22c55e', symbol: '✔',  bg: 'rgba(34,197,94,0.06)',  label: 'Done' },
  info:           { color: '#64748b', symbol: '·',  bg: 'rgba(100,116,139,0.05)', label: 'Info' },
};

interface LiveAgent {
  id: string; name: string; rolle: string; avatar: string; avatarFarbe: string;
  status: string; letzterZyklus: string | null; zyklusAktiv: boolean;
  budgetMonatCent: number; verbrauchtMonatCent: number;
  currentTask?: { id: string; titel: string; status: string } | null;
  lastTrace?: { typ: string; titel: string } | null;
  isOrchestrator?: boolean;
}

interface TraceEvent {
  id: string; expertId: string; expertName?: string;
  typ: string; titel: string; details?: string; erstelltAm: string;
}

// ── Animated metric ────────────────────────────────────────────────────────────

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

// ── Pulse ring ─────────────────────────────────────────────────────────────────

function PulseRing({ color, active }: { color: string; active: boolean }) {
  if (!active) return null;
  return (
    <div style={{
      position: 'absolute', inset: -4, borderRadius: '50%',
      border: `2px solid ${color}`,
      animation: 'aura 2s ease-in-out infinite',
      pointerEvents: 'none',
    }} />
  );
}

// ── Thinking dots ──────────────────────────────────────────────────────────────

function ThinkingDots() {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    return () => clearInterval(id);
  }, []);
  return <span style={{ color: '#23CDCB', fontWeight: 800, letterSpacing: 2 }}>{dots || '.'}</span>;
}

// ── Live elapsed timer ─────────────────────────────────────────────────────────

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

// ── Trace row — shown inside AgentCard and LogPanel ───────────────────────────

function TraceRow({ ev, showDetails = true }: { ev: TraceEvent; showDetails?: boolean }) {
  const tc = TRACE_CFG[ev.typ] || TRACE_CFG.info;
  const [open, setOpen] = useState(false);
  const hasDetails = !!ev.details?.trim();

  return (
    <div style={{
      borderRadius: 6, background: tc.bg, border: `1px solid ${tc.color}18`,
      animation: 'fadeInUp 0.25s ease-out',
      overflow: 'hidden',
    }}>
      <div
        style={{
          padding: '5px 8px',
          display: 'flex', alignItems: 'flex-start', gap: 6,
          cursor: hasDetails && showDetails ? 'pointer' : 'default',
        }}
        onClick={() => hasDetails && showDetails && setOpen(o => !o)}
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
          {/* details preview — first line when collapsed */}
          {hasDetails && showDetails && !open && (
            <div style={{
              fontSize: 9, color: '#475569', marginTop: 2, fontFamily: 'monospace',
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}>
              {ev.details!.split('\n')[0].slice(0, 80)}
            </div>
          )}
          {/* full details when expanded */}
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
          <span style={{ fontSize: 9, color: '#334155' }}>{timeAgo(ev.erstelltAm, true)}</span>
          {hasDetails && showDetails && (
            <span style={{ fontSize: 8, color: tc.color + '80' }}>{open ? '▲' : '▼'}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Full Agent Log Panel ───────────────────────────────────────────────────────

function AgentLogPanel({
  agent,
  traces,
  onClose,
  language,
}: {
  agent: LiveAgent;
  traces: TraceEvent[];
  onClose: () => void;
  language: string;
}) {
  const de = language === 'de';
  const cfg = STATUS_CFG[agent.status] ?? STATUS_CFG.idle;
  const isRunning = agent.status === 'running';
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll when new traces arrive
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [traces.length]);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200000,
      display: 'flex', alignItems: 'stretch',
    }}>
      {/* Backdrop */}
      <div
        style={{ flex: 1, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div style={{
        width: 520, display: 'flex', flexDirection: 'column',
        background: 'rgba(8,10,20,0.98)',
        borderLeft: `1px solid ${cfg.color}30`,
        boxShadow: `-20px 0 60px ${cfg.color}10`,
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid rgba(255,255,255,0.06)`,
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          background: 'rgba(0,0,0,0.3)',
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: agent.avatarFarbe + '20', border: `1px solid ${cfg.color}50`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, color: agent.avatarFarbe, fontWeight: 700, flexShrink: 0,
          }}>
            {agent.avatar || agent.name.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#f1f5f9' }}>{agent.name}</span>
              {agent.isOrchestrator && (
                <span style={{ fontSize: 8, fontWeight: 800, color: '#a855f7', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 4, padding: '1px 5px' }}>CEO</span>
              )}
              <span style={{ fontSize: 9, padding: '1px 7px', borderRadius: 20, background: cfg.color + '20', color: cfg.color, fontWeight: 800, border: `1px solid ${cfg.color}40` }}>
                {de ? cfg.labelDe : cfg.labelEn}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{agent.rolle}</div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', padding: 4 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Current task banner */}
        {agent.currentTask && (
          <div style={{
            padding: '10px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
            background: isRunning ? 'rgba(35,205,202,0.05)' : 'rgba(0,0,0,0.2)',
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
          }}>
            {isRunning ? <Play size={10} style={{ color: '#23CDCB' }} /> : <Pause size={10} style={{ color: '#475569' }} />}
            <span style={{ fontSize: 11, color: isRunning ? '#cbd5e1' : '#64748b', flex: 1 }}>
              {agent.currentTask.titel}
            </span>
            {isRunning && <ElapsedTimer since={agent.letzterZyklus} />}
            {isRunning && <ThinkingDots />}
          </div>
        )}

        {/* Log title */}
        <div style={{
          padding: '8px 20px', borderBottom: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
        }}>
          <Terminal size={11} style={{ color: '#475569' }} />
          <span style={{ fontSize: 9, fontWeight: 800, color: '#475569', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {de ? `Aktivitätslog · ${traces.length} Einträge` : `Activity log · ${traces.length} entries`}
          </span>
          {isRunning && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#23CDCB', animation: 'pulse 1.5s ease-in-out infinite' }} />
              <span style={{ fontSize: 9, color: '#23CDCB', fontWeight: 700 }}>LIVE</span>
            </div>
          )}
        </div>

        {/* Trace log — newest at bottom (chronological) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {traces.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#334155', fontSize: 12, padding: 40 }}>
              {de ? 'Noch keine Aktivität aufgezeichnet' : 'No activity recorded yet'}
            </div>
          ) : [...traces].reverse().map((ev) => (
            <TraceRow key={ev.id} ev={ev} showDetails={true} />
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
    </div>
  );
}

// ── Agent Card ─────────────────────────────────────────────────────────────────

function AgentCard({ agent, traces, onWakeup, waking, language, onOpenLog }: {
  agent: LiveAgent;
  traces: TraceEvent[];
  onWakeup: (id: string) => void;
  waking: boolean;
  language: string;
  onOpenLog: () => void;
}) {
  const de = language === 'de';
  const cfg = STATUS_CFG[agent.status] ?? STATUS_CFG.idle;
  const isRunning = agent.status === 'running';
  const budgetPct = agent.budgetMonatCent > 0 ? Math.round((agent.verbrauchtMonatCent / agent.budgetMonatCent) * 100) : 0;
  const [expanded, setExpanded] = useState(false);

  // Latest trace for "what I'm doing now"
  const latestTrace = traces[0] || null;
  const visibleTraces = traces.slice(0, expanded ? 8 : 4);

  return (
    <GlassCard active={isRunning} accent={cfg.color} style={{ overflow: 'hidden' }}>
      {/* ── Header ── */}
      <div style={{ padding: '13px 14px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: agent.avatarFarbe + '22',
            border: `1.5px solid ${isRunning ? cfg.color + '80' : agent.avatarFarbe + '44'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: agent.avatarFarbe,
          }}>
            {agent.avatar || agent.name.slice(0, 2).toUpperCase()}
          </div>
          <PulseRing color={cfg.color} active={isRunning} />
          <div style={{
            position: 'absolute', bottom: -2, right: -2, width: 9, height: 9,
            borderRadius: '50%', background: cfg.color,
            border: '2px solid rgba(8,10,20,0.9)',
            boxShadow: cfg.glow,
            animation: isRunning ? 'pulse 1.5s ease-in-out infinite' : 'none',
          }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agent.name}
            </span>
            {agent.isOrchestrator && (
              <span style={{ fontSize: 7, fontWeight: 800, color: '#a855f7', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 3, padding: '1px 4px', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                CEO
              </span>
            )}
          </div>
          <div style={{ fontSize: 9, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
            {agent.rolle}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <div style={{
            padding: '2px 7px', borderRadius: 20, fontSize: 8, fontWeight: 800,
            background: cfg.color + '20', color: cfg.color,
            letterSpacing: '0.08em', border: `1px solid ${cfg.color}35`,
          }}>
            {de ? cfg.labelDe : cfg.labelEn}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {/* Log button */}
            <button
              onClick={onOpenLog}
              title="Activity log"
              style={{
                width: 20, height: 20, borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.04)', color: '#475569',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Terminal size={8} />
            </button>
            {/* Wakeup button */}
            <button
              onClick={() => onWakeup(agent.id)}
              disabled={waking}
              title={de ? 'Wecken' : 'Wake up'}
              style={{
                width: 20, height: 20, borderRadius: 4, border: '1px solid rgba(255,255,255,0.1)',
                background: waking ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                color: waking ? '#22c55e' : '#475569',
                cursor: waking ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Radio size={8} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Current Task ── */}
      <div style={{ padding: '0 14px 8px' }}>
        <div style={{
          padding: '7px 10px', borderRadius: 8,
          background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)',
          minHeight: 32,
        }}>
          {isRunning && agent.currentTask ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#23CDCB', animation: 'pulse 1s ease-in-out infinite', flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {agent.currentTask.titel}
                </span>
                <ThinkingDots />
              </div>
              {/* Running timer */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, paddingLeft: 11 }}>
                <Clock size={8} style={{ color: '#334155' }} />
                <ElapsedTimer since={agent.letzterZyklus} />
                {traces.length > 0 && (
                  <span style={{ fontSize: 9, color: '#334155' }}>· {traces.length} {de ? 'Schritte' : 'steps'}</span>
                )}
              </div>
            </>
          ) : agent.currentTask ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={9} style={{ color: '#475569', flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {agent.currentTask.titel}
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 9, color: '#1e3a3a', fontStyle: 'italic' }}>
                {de ? '— kein aktiver Task —' : '— no active task —'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── "What I'm doing now" — latest action detail ── */}
      {isRunning && latestTrace && latestTrace.details && (
        <div style={{ padding: '0 14px 8px' }}>
          <div style={{
            padding: '6px 9px', borderRadius: 7,
            background: 'rgba(35,205,202,0.04)',
            border: '1px solid rgba(35,205,202,0.12)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <CornerDownRight size={8} style={{ color: '#23CDCB' }} />
              <span style={{ fontSize: 8, fontWeight: 700, color: '#23CDCB', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {de ? 'Zuletzt' : 'Latest'}
              </span>
            </div>
            <div style={{
              fontSize: 9, color: '#64748b', fontFamily: 'monospace', lineHeight: 1.5,
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              whiteSpace: 'pre-wrap',
            }}>
              {latestTrace.details.split('\n')[0].slice(0, 120)}
            </div>
          </div>
        </div>
      )}

      {/* ── Live Trace Feed ── */}
      {visibleTraces.length > 0 && (
        <div style={{ padding: '0 14px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          {visibleTraces.map((ev) => (
            <TraceRow key={ev.id} ev={ev} showDetails={false} />
          ))}
        </div>
      )}

      {/* ── Footer: budget bar + expand + log ── */}
      <div style={{ padding: '6px 14px 10px', display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        {budgetPct > 0 ? (
          <div style={{ flex: 1 }}>
            <div style={{ height: 2, borderRadius: 1, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 1,
                width: `${Math.min(budgetPct, 100)}%`,
                background: budgetPct > 90 ? '#ef4444' : budgetPct > 70 ? '#f59e0b' : '#22c55e',
                transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{ fontSize: 8, color: '#334155', marginTop: 2 }}>{budgetPct}% {de ? 'Budget' : 'budget'}</div>
          </div>
        ) : <div style={{ flex: 1 }} />}

        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {traces.length > 3 && (
            <button
              onClick={() => setExpanded(e => !e)}
              style={{
                display: 'flex', alignItems: 'center', gap: 2,
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 8, color: '#334155', padding: '2px 4px',
              }}
            >
              {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
              {expanded ? (de ? 'weniger' : 'less') : `+${traces.length - 3}`}
            </button>
          )}
          <button
            onClick={onOpenLog}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              background: 'rgba(35,205,202,0.06)', border: '1px solid rgba(35,205,202,0.15)',
              borderRadius: 5, cursor: 'pointer', fontSize: 8, color: '#23CDCB',
              padding: '3px 7px', fontWeight: 700,
            }}
          >
            <Terminal size={8} />
            Log
          </button>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Pulse Entry — clickable, expandable event row ─────────────────────────────

function PulseEntry({ ev, isNew, de }: { ev: TraceEvent & { expertName?: string }; isNew: boolean; de: boolean }) {
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
        transition: 'background 0.15s ease',
        overflow: 'hidden',
      }}
    >
      {/* Main row */}
      <div style={{ padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ fontSize: 12, flexShrink: 0 }}>{tc.symbol}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          {ev.expertName && (
            <div style={{ fontSize: 9, fontWeight: 700, color: tc.color, marginBottom: 1, letterSpacing: '0.04em' }}>
              {ev.expertName}
            </div>
          )}
          <div style={{
            fontSize: 11, color: isNew ? '#cbd5e1' : '#64748b', lineHeight: 1.35,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: open ? 99 : 2, WebkitBoxOrient: 'vertical',
          }}>
            {ev.titel}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: '#334155' }}>{timeAgo(ev.erstelltAm, de)}</span>
          {hasDetails && (
            <span style={{ fontSize: 8, color: tc.color + '80' }}>{open ? '▲' : '▼'}</span>
          )}
        </div>
      </div>

      {/* Expanded details */}
      {open && hasDetails && (
        <div style={{ padding: '0 10px 8px' }}>
          <pre style={{
            fontSize: 10, color: '#64748b', fontFamily: 'monospace',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5,
            maxHeight: 200, overflowY: 'auto',
            background: 'rgba(0,0,0,0.3)', borderRadius: 6, padding: '7px 9px',
            margin: 0,
          }}>
            {ev.details}
          </pre>
        </div>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Main Component ─────────────────────────────────────────────────────────────

export function WarRoom() {
  const navigate = useNavigate();
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const de = language === 'de';
  const locale = de ? 'de-DE' : 'en-US';

  const [data, setData] = useState<DashboardData | null>(null);
  const [agents, setAgents] = useState<LiveAgent[]>([]);
  const [agentTraces, setAgentTraces] = useState<Record<string, TraceEvent[]>>({});
  const [feed, setFeed] = useState<(TraceEvent & { expertName?: string })[]>([]);
  const [waking, setWaking] = useState<Set<string>>(new Set());
  const [clock, setClock] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [logAgent, setLogAgent] = useState<LiveAgent | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // System Pulse scroll management
  const pulseRef = useRef<HTMLDivElement>(null);
  const [pulseAutoScroll, setPulseAutoScroll] = useState(true);
  const [newEventCount, setNewEventCount] = useState(0);
  const [pulseFilter, setPulseFilter] = useState<string>('all'); // 'all' | 'error' | 'action' | 'thinking'

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    try {
      const d = await apiDashboard.laden(aktivesUnternehmen.id);
      setData(d);
      const allAgents: LiveAgent[] = (d as any).alleExperten || [];
      setAgents(allAgents);

      const token = localStorage.getItem('opencognit_token');
      const traceMap: Record<string, TraceEvent[]> = {};
      await Promise.all(allAgents.map(async (a) => {
        try {
          const r = await fetch(`/api/experten/${a.id}/trace/history?limit=30`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (r.ok) traceMap[a.id] = await r.json();
        } catch { /* ignore */ }
      }));
      setAgentTraces(traceMap);

      const combined = Object.values(traceMap)
        .flat()
        .sort((a, b) => new Date(a.erstelltAm).getTime() - new Date(b.erstelltAm).getTime()) // oldest first → newest at bottom
        .slice(-80)
        .map(ev => ({ ...ev, expertName: allAgents.find(a => a.id === ev.expertId)?.name }));
      setFeed(combined);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [aktivesUnternehmen?.id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  // WebSocket for live updates
  useEffect(() => {
    if (!aktivesUnternehmen) return;
    const token = localStorage.getItem('opencognit_token');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.hostname}:3201/ws${token ? `?token=${token}` : ''}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.unternehmenId && msg.unternehmenId !== aktivesUnternehmen.id) return;

        if (msg.type === 'trace' && msg.data) {
          const { expertId, typ, titel, details, erstelltAm, expertName } = msg.data;
          const newEvent: TraceEvent = {
            id: crypto.randomUUID(),
            expertId, typ, titel, details,
            expertName,
            erstelltAm: erstelltAm || new Date().toISOString(),
          };

          setAgentTraces(prev => ({
            ...prev,
            [expertId]: [newEvent, ...(prev[expertId] || [])].slice(0, 30),
          }));

          setFeed(prev => [...prev, newEvent].slice(-80));

          setAgents(prev => prev.map(a =>
            a.id === expertId
              ? { ...a, lastTrace: { typ, titel }, status: 'running' }
              : a
          ));
        }

        if (msg.type === 'task_started' && msg.agentId) {
          setAgents(prev => prev.map(a =>
            a.id === msg.agentId
              ? { ...a, status: 'running', currentTask: { id: msg.taskId || '', titel: msg.taskTitel || '', status: 'in_progress' } }
              : a
          ));
          // Also inject into global feed so it's visible in the live log
          const agentName = agents.find(a => a.id === msg.agentId)?.name || msg.agentName;
          const taskEvent: TraceEvent & { expertName?: string } = {
            id: crypto.randomUUID(),
            expertId: msg.agentId,
            expertName: agentName,
            typ: 'task_started',
            titel: msg.taskTitel || 'Task gestartet',
            erstelltAm: new Date().toISOString(),
          };
          setFeed(prev => [taskEvent, ...prev].slice(0, 40));
        }

        if (msg.type === 'task_completed' && msg.agentId) {
          setAgents(prev => prev.map(a =>
            a.id === msg.agentId ? { ...a, status: 'active', currentTask: null } : a
          ));
          const agentName = agents.find(a => a.id === msg.agentId)?.name || msg.agentName;
          const doneEvent: TraceEvent & { expertName?: string } = {
            id: crypto.randomUUID(),
            expertId: msg.agentId,
            expertName: agentName,
            typ: 'task_completed',
            titel: msg.taskTitel || 'Task abgeschlossen',
            erstelltAm: new Date().toISOString(),
          };
          setFeed(prev => [doneEvent, ...prev].slice(0, 40));
          setTimeout(load, 2000);
        }
      } catch {}
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [aktivesUnternehmen?.id, load]);

  // Auto-scroll System Pulse to bottom when new events arrive (if user is at bottom)
  useEffect(() => {
    if (!pulseRef.current) return;
    if (pulseAutoScroll) {
      pulseRef.current.scrollTop = pulseRef.current.scrollHeight;
      setNewEventCount(0);
    } else {
      setNewEventCount(c => c + 1);
    }
  }, [feed.length]); // trigger on count change, not content (avoid stale closure)

  const handlePulseScroll = () => {
    if (!pulseRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = pulseRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (atBottom && !pulseAutoScroll) {
      setPulseAutoScroll(true);
      setNewEventCount(0);
    } else if (!atBottom && pulseAutoScroll) {
      setPulseAutoScroll(false);
    }
  };

  const scrollPulseToBottom = () => {
    if (!pulseRef.current) return;
    pulseRef.current.scrollTo({ top: pulseRef.current.scrollHeight, behavior: 'smooth' });
    setPulseAutoScroll(true);
    setNewEventCount(0);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (logAgent) { setLogAgent(null); return; }
        navigate('/');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, logAgent]);

  const handleWakeup = async (agentId: string) => {
    setWaking(prev => new Set(prev).add(agentId));
    await authFetch(`/api/experten/${agentId}/wakeup`, { method: 'POST' }).catch(() => {});
    setTimeout(() => {
      setWaking(prev => { const s = new Set(prev); s.delete(agentId); return s; });
    }, 3000);
  };

  const runningCount = agents.filter(a => a.status === 'running').length;
  const timeStr = clock.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateStr = clock.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'linear-gradient(135deg, #060812 0%, #080a16 50%, #060812 100%)',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      {/* Grid background */}
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.1, pointerEvents: 'none' }}>
        <defs>
          <pattern id="war-grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(35,205,202,0.6)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#war-grid)" />
      </svg>
      <div style={{ position: 'absolute', top: '20%', left: '15%', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(35,205,202,0.04) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '20%', right: '10%', width: 350, height: 350, borderRadius: '50%', background: 'radial-gradient(circle, rgba(168,85,247,0.04) 0%, transparent 70%)', pointerEvents: 'none' }} />

      {/* ── TOP BAR ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', borderBottom: '1px solid rgba(35,205,202,0.12)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(20px)',
        flexShrink: 0, position: 'relative', zIndex: 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: runningCount > 0 ? '#23CDCB' : '#475569',
              boxShadow: runningCount > 0 ? '0 0 10px #23CDCB' : 'none',
              animation: runningCount > 0 ? 'pulse 1.5s ease-in-out infinite' : 'none',
            }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: '#23CDCB', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              {aktivesUnternehmen?.name || 'OpenCognit'}
            </span>
            <span style={{ fontSize: 9, color: '#334155', letterSpacing: '0.1em', textTransform: 'uppercase' }}>· WAR ROOM</span>
          </div>

          {runningCount > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px',
              borderRadius: 20, background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.25)',
              fontSize: 11, fontWeight: 700, color: '#23CDCB',
            }}>
              <Cpu size={12} style={{ animation: 'spin 3s linear infinite' }} />
              {runningCount} {de ? `Agent${runningCount !== 1 ? 'en' : ''} aktiv` : `agent${runningCount !== 1 ? 's' : ''} active`}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f1f5f9', letterSpacing: '0.05em', fontVariantNumeric: 'tabular-nums' }}>
            {timeStr}
          </div>
          <div style={{ fontSize: 10, color: '#475569', letterSpacing: '0.06em', marginTop: 1 }}>
            {dateStr}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 9, color: '#334155', letterSpacing: '0.06em' }}>
            {de ? 'Echtzeit-Übersicht · ESC beendet' : 'Live overview · ESC to exit'}
          </span>
          <button
            onClick={() => navigate('/')}
            style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.2)'; (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; (e.currentTarget as HTMLElement).style.color = '#94a3b8'; }}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 300px', gap: 0, overflow: 'hidden', position: 'relative', zIndex: 1 }}>

        {/* Left: Metrics + Agent Grid */}
        <div style={{ display: 'flex', flexDirection: 'column', padding: '18px 14px 18px 22px', gap: 14, overflow: 'hidden' }}>

          {/* Metrics row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, flexShrink: 0 }}>
            {[
              { icon: <Users size={14} style={{ color: '#23CDCB' }} />, label: de ? 'AGENTEN' : 'AGENTS', value: data?.experten.gesamt || 0, sub: `${data?.experten.running || 0} ${de ? 'aktiv' : 'active'}`, color: '#23CDCB' },
              { icon: <CheckCircle2 size={14} style={{ color: '#22c55e' }} />, label: de ? 'ERLEDIGT' : 'DONE', value: data?.aufgaben.erledigt || 0, sub: `${data?.aufgaben.inBearbeitung || 0} ${de ? 'laufend' : 'running'}`, color: '#22c55e' },
              { icon: <Target size={14} style={{ color: '#a855f7' }} />, label: de ? 'OFFEN' : 'OPEN', value: data?.aufgaben.offen || 0, sub: `${data?.aufgaben.blockiert || 0} ${de ? 'blockiert' : 'blocked'}`, color: data?.aufgaben.blockiert ? '#f59e0b' : '#a855f7' },
              { icon: <Wallet size={14} style={{ color: '#f59e0b' }} />, label: 'BUDGET', value: `${data?.kosten.prozent || 0}%`, sub: formatCost(data?.kosten.gesamtVerbraucht || 0, language), color: (data?.kosten.prozent || 0) > 80 ? '#ef4444' : '#f59e0b' },
            ].map((m, i) => (
              <GlassCard key={i} accent={m.color} style={{ padding: '11px 12px', borderRadius: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  {m.icon}
                  <span style={{ fontSize: 8, fontWeight: 800, color: '#475569', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{m.label}</span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 800, color: m.color, lineHeight: 1, marginBottom: 2 }}>
                  {typeof m.value === 'number' ? <AnimatedNum value={m.value} /> : m.value}
                </div>
                <div style={{ fontSize: 9, color: '#475569' }}>{m.sub}</div>
              </GlassCard>
            ))}
          </div>

          {/* Agent grid */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '0.75rem' }}>
                <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(35,205,202,0.2)', borderTopColor: '#23CDCB', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ fontSize: 11, color: '#475569', letterSpacing: '0.1em' }}>
                  {de ? 'LADE AGENTEN-DATEN…' : 'LOADING AGENT DATA…'}
                </span>
              </div>
            ) : agents.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '0.875rem' }}>
                <div style={{ fontSize: '2rem' }}>🤖</div>
                <button onClick={() => navigate('/experts')} style={{ background: 'none', border: '1px solid rgba(35,205,202,0.3)', borderRadius: 8, color: '#23CDCB', cursor: 'pointer', padding: '0.375rem 0.875rem', fontSize: 12, fontWeight: 700 }}>
                  {de ? 'Agenten einrichten →' : 'Set up agents →'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 10, alignContent: 'start' }}>
                {agents.map(agent => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    traces={agentTraces[agent.id] || []}
                    onWakeup={handleWakeup}
                    waking={waking.has(agent.id)}
                    language={language}
                    onOpenLog={() => setLogAgent(agent)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: System Pulse */}
        <div style={{
          borderLeft: '1px solid rgba(35,205,202,0.1)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: 'rgba(0,0,0,0.2)',
          position: 'relative', // needed for badge positioning
        }}>
          {/* Pulse header */}
          <div style={{
            padding: '10px 12px', borderBottom: '1px solid rgba(35,205,202,0.1)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Activity size={12} style={{ color: '#23CDCB' }} />
              <span style={{ fontSize: 10, fontWeight: 800, color: '#23CDCB', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                System Pulse
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                {!pulseAutoScroll ? (
                  <span style={{ fontSize: 8, color: '#f59e0b', fontWeight: 700, letterSpacing: '0.08em' }}>⏸ PAUSED</span>
                ) : (
                  <>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#23CDCB', animation: 'pulse 2s ease-in-out infinite' }} />
                    <span style={{ fontSize: 9, color: '#23CDCB', fontWeight: 700 }}>LIVE</span>
                  </>
                )}
              </div>
            </div>
            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 4 }}>
              {(['all', 'error', 'action', 'thinking'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setPulseFilter(f)}
                  style={{
                    padding: '2px 7px', borderRadius: 4, border: 'none', cursor: 'pointer',
                    fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                    background: pulseFilter === f ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.04)',
                    color: pulseFilter === f ? '#23CDCB' : '#334155',
                    transition: 'all 0.15s',
                  }}
                >
                  {f === 'all' ? (de ? 'Alle' : 'All') : f === 'error' ? '⚠ Errors' : f === 'action' ? '⚡ Actions' : '🧠 Thinking'}
                </button>
              ))}
            </div>
          </div>

          {/* Pulse feed — newest at bottom, auto-scrolling */}
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
              const filtered = pulseFilter === 'all' ? feed
                : feed.filter(ev =>
                    pulseFilter === 'error' ? (ev.typ === 'error' || ev.typ === 'warning' || ev.typ === 'critic_rejected')
                    : pulseFilter === 'action' ? (ev.typ === 'action' || ev.typ === 'task_started' || ev.typ === 'task_completed' || ev.typ === 'tool_call')
                    : /* thinking */ (ev.typ === 'thinking' || ev.typ === 'planning' || ev.typ === 'info')
                  );
              return filtered.map((ev, i) => (
                <PulseEntry
                  key={ev.id || i}
                  ev={ev}
                  isNew={i === filtered.length - 1} // newest is last (bottom)
                  de={de}
                />
              ));
            })()}
            {/* Invisible anchor for scroll measurement */}
            <div style={{ height: 1, flexShrink: 0 }} />
          </div>

          {/* "New events" badge when auto-scroll is paused */}
          {!pulseAutoScroll && newEventCount > 0 && (
            <button
              onClick={scrollPulseToBottom}
              style={{
                position: 'absolute', bottom: (data?.pendingApprovals || 0) > 0 ? 52 : 12,
                right: 12, zIndex: 10,
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 12,
                background: 'rgba(35,205,202,0.15)', border: '1px solid rgba(35,205,202,0.4)',
                color: '#23CDCB', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
                animation: 'fadeInUp 0.2s ease-out',
              }}
            >
              ↓ {newEventCount} {de ? 'neue' : 'new'}
            </button>
          )}

          {(data?.pendingApprovals || 0) > 0 && (
            <div style={{
              padding: '10px 14px', borderTop: '1px solid rgba(245,158,11,0.2)',
              background: 'rgba(245,158,11,0.05)', flexShrink: 0,
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <AlertCircle size={12} style={{ color: '#f59e0b' }} />
              <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>
                {de
                  ? `${data?.pendingApprovals} Genehmigung${data?.pendingApprovals !== 1 ? 'en' : ''} ausstehend`
                  : `${data?.pendingApprovals} approval${data?.pendingApprovals !== 1 ? 's' : ''} pending`}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div style={{
        padding: '6px 22px', borderTop: '1px solid rgba(35,205,202,0.08)',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(10px)',
        display: 'flex', alignItems: 'center', flexShrink: 0, position: 'relative', zIndex: 1,
      }}>
        <span style={{ fontSize: 8, color: '#1e293b', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          OpenCognit OS · War Room v3 · {de ? 'Klick auf Log für vollständige Aktivität' : 'Click Log for full agent activity'}
        </span>
        <span style={{ fontSize: 8, color: '#1e293b', marginLeft: 'auto' }}>
          {de ? `${agents.length} Agenten · Auto-refresh 30s` : `${agents.length} agents · Auto-refresh 30s`}
        </span>
      </div>

      {/* Agent Log Overlay */}
      {logAgent && (
        <AgentLogPanel
          agent={logAgent}
          traces={agentTraces[logAgent.id] || []}
          onClose={() => setLogAgent(null)}
          language={language}
        />
      )}
    </div>
  );
}
