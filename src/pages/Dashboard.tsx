import { useState, useEffect, useRef } from 'react';
import {
  Users, ListTodo, Wallet, Gauge, ArrowRight, ShieldCheck,
  Loader2, Plus, MessageSquare, Zap, ZapOff, CheckCircle2,
  AlertCircle, Clock, Radio, Activity, Building2,
  Target, FolderOpen, Cpu, TrendingUp, TrendingDown, Minus,
  Brain, ChevronRight, MonitorPlay, Sparkles, RefreshCw,
  Bot, PlayCircle, BookOpen, X as XIcon, ChevronDown, ChevronUp, Key, Crown,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import { apiDashboard, apiChannels, type DashboardData, type Experte as ExperteType } from '../api/client';
import { ExpertChatDrawer } from '../components/ExpertChatDrawer';
import { StandupPanel } from '../components/StandupPanel';
import { SetupWizard } from '../components/SetupWizard';
import { authFetch } from '../utils/api';
import { BentoGrid, type BentoItem } from '../components/BentoGrid';

// ── Helpers ───────────────────────────────────────────────────────────────────

function euro(cent: number) {
  return (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function reltime(iso: string, lang: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return lang === 'de' ? 'gerade eben' : 'just now';
  if (m < 60) return lang === 'de' ? `vor ${m} Min.` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return lang === 'de' ? `vor ${h} Std.` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return lang === 'de' ? `vor ${d} Tag${d > 1 ? 'en' : ''}` : `${d}d ago`;
}

const STATUS_CFG: Record<string, { color: string; bg: string; label: { de: string; en: string } }> = {
  running:    { color: '#23CDCB', bg: 'rgba(35,205,202,0.12)',  label: { de: 'Arbeitet', en: 'Working' } },
  active:     { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   label: { de: 'Aktiv',    en: 'Active'  } },
  idle:       { color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', label: { de: 'Bereit',   en: 'Idle'    } },
  paused:     { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: { de: 'Pausiert', en: 'Paused'  } },
  error:      { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: { de: 'Fehler',   en: 'Error'   } },
  terminated: { color: '#6b7280', bg: 'rgba(107,114,128,0.10)', label: { de: 'Beendet',  en: 'Off'     } },
};

const TRACE_CFG: Record<string, { color: string; bg: string }> = {
  thinking: { color: '#a855f7', bg: 'rgba(168,85,247,0.08)' },
  action:   { color: '#23CDCB', bg: 'rgba(35,205,202,0.08)' },
  result:   { color: '#22c55e', bg: 'rgba(34,197,94,0.08)'  },
  error:    { color: '#ef4444', bg: 'rgba(239,68,68,0.08)'  },
  warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
  info:     { color: '#94a3b8', bg: 'rgba(148,163,184,0.06)'},
};

// ── Daily Briefing Widget ─────────────────────────────────────────────────────

function DailyBriefingWidget({ unternehmenId, lang }: { unternehmenId: string; lang: string }) {
  const de = lang === 'de';
  const cacheKey = `briefing_${unternehmenId}_${new Date().toDateString()}`;
  const [briefing, setBriefing] = useState<string | null>(() => localStorage.getItem(cacheKey));
  const [loading, setLoading] = useState(false);
  const [displayed, setDisplayed] = useState<string>('');
  const [source, setSource] = useState<'ai' | 'template' | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Typewriter effect
  useEffect(() => {
    if (!briefing) return;
    setDisplayed('');
    let i = 0;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      i++;
      setDisplayed(briefing.slice(0, i));
      if (i >= briefing.length) {
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }, 12);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [briefing]);

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setBriefing(null);
    setDisplayed('');
    try {
      const token = localStorage.getItem('opencognit_token');
      const resp = await fetch(`/api/unternehmen/${unternehmenId}/briefing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ language: lang }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setBriefing(data.briefing);
        setSource(data.source);
        localStorage.setItem(cacheKey, data.briefing);
      }
    } catch {}
    setLoading(false);
  };

  return (
    <div style={{
      padding: '1.125rem 1.5rem',
      background: 'rgba(35,205,202,0.03)',
      backdropFilter: 'blur(20px)',
      borderRadius: '16px',
      border: '1px solid rgba(35,205,202,0.1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: briefing ? '0.75rem' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: 28, height: 28, borderRadius: '8px',
            background: 'rgba(35,205,202,0.12)', border: '1px solid rgba(35,205,202,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Sparkles size={14} style={{ color: '#23CDCB' }} />
          </div>
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#d4d4d8' }}>
            {de ? 'CEO Tagesbriefing' : 'CEO Daily Briefing'}
          </span>
          {source === 'ai' && (
            <span style={{
              padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.5625rem',
              fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              background: 'rgba(35,205,202,0.1)', color: '#23CDCB',
              border: '1px solid rgba(35,205,202,0.2)',
            }}>AI</span>
          )}
        </div>
        <button
          onClick={generate}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.375rem 0.875rem', borderRadius: '10px', cursor: loading ? 'wait' : 'pointer',
            background: 'rgba(35,205,202,0.08)', border: '1px solid rgba(35,205,202,0.2)',
            color: '#23CDCB', fontSize: '0.75rem', fontWeight: 600,
            opacity: loading ? 0.7 : 1, transition: 'all 0.2s',
          }}
        >
          {loading
            ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> {de ? 'Generiere…' : 'Generating…'}</>
            : <><RefreshCw size={12} /> {briefing ? (de ? 'Neu generieren' : 'Regenerate') : (de ? 'Briefing generieren' : 'Generate Briefing')}</>
          }
        </button>
      </div>

      {displayed && (
        <p style={{
          margin: 0, fontSize: '0.875rem', lineHeight: 1.65,
          color: '#94a3b8', fontStyle: 'normal',
        }}>
          {displayed}
          {displayed.length < (briefing?.length ?? 0) && (
            <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#23CDCB', animation: 'blink 1s step-end infinite', verticalAlign: 'text-bottom', marginLeft: 2 }} />
          )}
        </p>
      )}

      {!briefing && !loading && (
        <p style={{ margin: 0, fontSize: '0.8125rem', color: '#334155', fontStyle: 'italic' }}>
          {de ? 'Klicke "Briefing generieren" für eine KI-Zusammenfassung des heutigen Status.' : 'Click "Generate Briefing" for an AI summary of today\'s company status.'}
        </p>
      )}
    </div>
  );
}

// ── Velocity Chart ────────────────────────────────────────────────────────────

function VelocityChart({ completedPerDay, lang }: { completedPerDay: number[]; lang: string }) {
  const de = lang === 'de';
  const DAYS = 14;
  const W = 280, H = 60;
  const PAD = 4;

  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (DAYS - 1 - i));
    return d;
  });

  const counts = completedPerDay.length === DAYS ? completedPerDay : Array(DAYS).fill(0);

  const maxCount = Math.max(...counts, 1);
  const colW = (W - PAD * 2) / DAYS;

  // Build smooth area path
  const points = counts.map((c, i) => {
    const x = PAD + i * colW + colW / 2;
    const y = PAD + (H - PAD * 2) * (1 - c / maxCount);
    return { x, y };
  });

  // Smooth bezier
  const pathD = points.reduce((d, p, i) => {
    if (i === 0) return `M ${p.x} ${p.y}`;
    const prev = points[i - 1];
    const cpx = (prev.x + p.x) / 2;
    return `${d} C ${cpx} ${prev.y} ${cpx} ${p.y} ${p.x} ${p.y}`;
  }, '');

  const areaD = `${pathD} L ${points[points.length - 1].x} ${H - PAD} L ${points[0].x} ${H - PAD} Z`;

  const total = counts.reduce((a, b) => a + b, 0);
  const today = counts[counts.length - 1];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {de ? 'Aufgaben erledigt (14 Tage)' : 'Tasks done (14 days)'}
        </span>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline' }}>
          {today > 0 && (
            <span style={{ fontSize: '0.6875rem', color: '#22c55e', fontWeight: 600 }}>
              +{today} {de ? 'heute' : 'today'}
            </span>
          )}
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#23CDCB' }}>{total}</span>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="velocity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#23CDCB" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#23CDCB" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* Horizontal grid lines */}
        {[0.33, 0.67, 1].map((p, i) => (
          <line key={i}
            x1={PAD} y1={PAD + (H - PAD * 2) * (1 - p)}
            x2={W - PAD} y2={PAD + (H - PAD * 2) * (1 - p)}
            stroke="rgba(255,255,255,0.04)" strokeWidth={1}
          />
        ))}
        {/* Area */}
        <path d={areaD} fill="url(#velocity-fill)" />
        {/* Line */}
        <path d={pathD} fill="none" stroke="#23CDCB" strokeWidth={1.5} strokeLinejoin="round" />
        {/* Today dot */}
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={3}
            fill="#23CDCB"
          />
        )}
        {/* Day labels: show Mon and first of month only */}
        {days.map((d, i) => {
          const show = d.getDay() === 1 || d.getDate() === 1;
          if (!show) return null;
          return (
            <text key={i} x={PAD + i * colW + colW / 2} y={H} fontSize={7} textAnchor="middle" fill="#3f3f46">
              {d.toLocaleDateString(de ? 'de-DE' : 'en-US', { day: 'numeric', month: 'short' })}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ children, style = {}, accent = '#23CDCB', onClick }: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  accent?: string;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(24px) saturate(160%)',
        borderRadius: '20px',
        border: `1px solid ${hovered ? `${accent}30` : 'rgba(255,255,255,0.09)'}`,
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered
          ? `inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 40px rgba(0,0,0,0.35), 0 0 0 1px ${accent}18`
          : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.2)',
        transition: 'all 0.25s ease',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {/* Dot pattern */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: hovered ? 1 : 0, transition: 'opacity 0.3s',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.035) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
      }} />
      {/* Gradient glow */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '20px', pointerEvents: 'none',
        background: `linear-gradient(135deg, ${accent}12, transparent 60%, ${accent}08)`,
        opacity: hovered ? 1 : 0, transition: 'opacity 0.3s',
      }} />
      <div style={{ position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}

function SectionHeader({ title, to, linkLabel }: { title: string; to: string; linkLabel: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
      <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>{title}</h2>
      <Link to={to} style={{
        display: 'flex', alignItems: 'center', gap: '0.375rem',
        fontSize: '0.8125rem', color: '#64748b', textDecoration: 'none',
        padding: '0.375rem 0.75rem', borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.07)',
        transition: 'color 0.15s, border-color 0.15s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#23CDCB'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(35,205,202,0.3)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#64748b'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; }}
      >
        {linkLabel} <ArrowRight size={12} />
      </Link>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, accent, bar, trend,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; accent: string;
  bar?: { pct: number; color: string };
  trend?: 'up' | 'down' | 'neutral';
}) {
  const TrendIcon = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus;
  const trendColor = trend === 'up' ? '#22c55e' : trend === 'down' ? '#ef4444' : '#475569';

  return (
    <Card style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#94a3b8' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {trend && <TrendIcon size={13} style={{ color: trendColor }} />}
          <div style={{
            width: 36, height: 36, borderRadius: '10px',
            background: `${accent}18`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={16} style={{ color: accent }} />
          </div>
        </div>
      </div>
      <div style={{ fontSize: '2.25rem', fontWeight: 800, color: '#f8fafc', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.375rem' }}>{sub}</div>}
      {bar && (
        <div style={{ marginTop: '0.875rem', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 2, transition: 'width 0.6s ease',
            width: `${Math.min(bar.pct, 100)}%`, background: bar.color,
          }} />
        </div>
      )}
    </Card>
  );
}

// ── Agent Row ─────────────────────────────────────────────────────────────────

function AgentRow({
  expert, lang, onChat, onClick,
}: {
  expert: ExperteType; lang: string;
  onChat: (e: ExperteType) => void;
  onClick: (e: ExperteType) => void;
}) {
  const cfg = STATUS_CFG[expert.status] ?? STATUS_CFG.idle;
  return (
    <div
      onClick={() => onClick(expert)}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.875rem',
        padding: '0.75rem 0.875rem', borderRadius: '12px',
        cursor: 'pointer', transition: 'background 0.15s',
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: '10px', flexShrink: 0,
        background: expert.avatarFarbe + '20',
        border: `1px solid ${expert.avatarFarbe}35`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.75rem', fontWeight: 700, color: expert.avatarFarbe,
      }}>
        {expert.avatar || expert.name.slice(0, 2).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {expert.name}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {expert.titel ?? expert.rolle}
        </div>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '0.25rem 0.625rem', borderRadius: '999px',
        background: cfg.bg, flexShrink: 0,
      }}>
        {expert.status === 'running'
          ? <Loader2 size={10} style={{ color: cfg.color, animation: 'spin 1s linear infinite' }} />
          : <div style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color }} />
        }
        <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: cfg.color }}>
          {cfg.label[lang as 'de' | 'en'] ?? cfg.label.en}
        </span>
      </div>
      {expert.letzterZyklus && (
        <span style={{ fontSize: '0.6875rem', color: '#334155', flexShrink: 0 }}>
          {reltime(expert.letzterZyklus, lang)}
        </span>
      )}
      <button
        onClick={ev => { ev.stopPropagation(); onChat(expert); }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(35,205,202,0.2)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(35,205,202,0.07)')}
        style={{
          width: 28, height: 28, borderRadius: '8px', flexShrink: 0,
          background: 'rgba(35,205,202,0.07)', border: 'none',
          color: '#23CDCB', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.15s',
        }}
      >
        <MessageSquare size={12} />
      </button>
    </div>
  );
}

// ── Activity item ─────────────────────────────────────────────────────────────

function ActivityItem({ item, lang }: { item: any; lang: string }) {
  const dotColor =
    item.entitaetTyp === 'aufgabe'     ? '#3b82f6' :
    item.entitaetTyp === 'kosten'      ? '#22c55e' :
    item.entitaetTyp === 'genehmigung' ? '#f59e0b' :
    item.entitaetTyp === 'experte'     ? '#23CDCB' : '#475569';

  return (
    <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '8px', flexShrink: 0, marginTop: 1,
        background: dotColor + '15', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.8125rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
          <strong style={{ color: '#f1f5f9', fontWeight: 600 }}>{item.akteurName}</strong>
          {' '}{item.aktion}
        </p>
        <p style={{ fontSize: '0.6875rem', color: '#475569', marginTop: '0.1875rem' }}>
          {reltime(item.erstelltAm, lang)}
        </p>
      </div>
    </div>
  );
}

// ── Projects Widget ───────────────────────────────────────────────────────────

function ProjectsWidget({ projects, lang }: { projects: any[]; lang: string }) {
  const navigate = useNavigate();
  if (projects.length === 0) return (
    <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#475569' }}>
      <FolderOpen size={28} style={{ opacity: 0.2, marginBottom: '0.5rem' }} />
      <p style={{ fontSize: '0.8125rem', margin: 0 }}>
        {lang === 'de' ? 'Noch keine Projekte' : 'No projects yet'}
      </p>
      <button onClick={() => navigate('/projects')} style={{
        marginTop: '0.75rem', padding: '0.375rem 0.875rem', borderRadius: '8px',
        background: 'rgba(35,205,202,0.08)', border: '1px solid rgba(35,205,202,0.2)',
        color: '#23CDCB', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
      }}>
        {lang === 'de' ? 'Projekt anlegen' : 'Create project'}
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {projects.map((p: any) => (
        <div key={p.id} onClick={() => navigate('/projects')} style={{
          padding: '0.75rem 0.875rem', borderRadius: '12px',
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${p.farbe || '#23CDCB'}40`; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.05)'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.farbe || '#23CDCB', flexShrink: 0 }} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                {p.name}
              </span>
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: p.fortschritt >= 80 ? '#22c55e' : p.fortschritt >= 40 ? '#23CDCB' : '#94a3b8' }}>
              {p.fortschritt}%
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2, transition: 'width 0.6s ease',
              width: `${p.fortschritt}%`,
              background: p.fortschritt >= 80 ? '#22c55e' : p.fortschritt >= 40 ? p.farbe || '#23CDCB' : '#475569',
            }} />
          </div>
          {p.deadline && (
            <div style={{ fontSize: '0.6875rem', color: '#475569', marginTop: '0.375rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Clock size={10} />
              {new Date(p.deadline).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { day: 'numeric', month: 'short' })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Goals Widget ──────────────────────────────────────────────────────────────

function GoalsWidget({ goals, lang }: { goals: any[]; lang: string }) {
  const navigate = useNavigate();
  if (goals.length === 0) return (
    <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#475569' }}>
      <Target size={28} style={{ opacity: 0.2, marginBottom: '0.5rem' }} />
      <p style={{ fontSize: '0.8125rem', margin: 0 }}>
        {lang === 'de' ? 'Noch keine Ziele definiert' : 'No goals defined yet'}
      </p>
      <button onClick={() => navigate('/goals')} style={{
        marginTop: '0.75rem', padding: '0.375rem 0.875rem', borderRadius: '8px',
        background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
        color: '#22c55e', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
      }}>
        {lang === 'de' ? 'Ziel erstellen' : 'Create goal'}
      </button>
    </div>
  );

  const statusColor: Record<string, string> = {
    active:   '#22c55e',
    planned:  '#94a3b8',
    achieved: '#23CDCB',
    cancelled:'#475569',
  };

  function progressColor(pct: number): string {
    if (pct >= 100) return '#23CDCB';
    if (pct >= 70)  return '#22c55e';
    if (pct >= 40)  return '#3b82f6';
    return '#94a3b8';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {goals.map((g: any) => {
        const pct = g.fortschritt ?? 0;
        const pColor = progressColor(pct);
        return (
          <div key={g.id} onClick={() => navigate('/goals')} style={{
            padding: '0.625rem 0.875rem', borderRadius: '10px',
            background: 'rgba(255,255,255,0.02)', border: `1px solid ${g.status === 'active' ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)'}`,
            cursor: 'pointer', transition: 'border-color 0.15s',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = g.status === 'active' ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)'; }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: pct > 0 ? '0.375rem' : 0 }}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                background: statusColor[g.status] || '#475569',
                boxShadow: g.status === 'active' ? `0 0 5px ${statusColor[g.status]}80` : 'none',
              }} />
              <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.titel}</span>
              {pct > 0 && (
                <span style={{ fontSize: '0.625rem', fontWeight: 700, color: pColor, flexShrink: 0 }}>{pct}%</span>
              )}
            </div>
            {pct > 0 && (
              <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: pColor,
                  width: `${pct}%`, transition: 'width 0.6s ease',
                }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── System Pulse (Live Activity Feed) ─────────────────────────────────────────

interface TraceEvent {
  id: string;
  expertId: string;
  expertName?: string;
  typ: string;
  titel: string;
  erstelltAm: string;
}

const PULSE_CFG: Record<string, { color: string; bg: string; symbol: string }> = {
  thinking:       { color: '#a855f7', bg: 'rgba(168,85,247,0.07)', symbol: '💭' },
  action:         { color: '#23CDCB', bg: 'rgba(35,205,202,0.07)', symbol: '⚡' },
  result:         { color: '#22c55e', bg: 'rgba(34,197,94,0.07)',  symbol: '✓'  },
  error:          { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',  symbol: '✗'  },
  warning:        { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', symbol: '⚠'  },
  task_started:   { color: '#23CDCB', bg: 'rgba(35,205,202,0.05)', symbol: '▶'  },
  task_completed: { color: '#22c55e', bg: 'rgba(34,197,94,0.05)',  symbol: '✔'  },
  info:           { color: '#475569', bg: 'rgba(71,85,105,0.06)',  symbol: '·'  },
};

function SystemPulse({ unternehmenId, initialTrace, lang }: { unternehmenId: string; initialTrace: TraceEvent[]; lang: string }) {
  const [events, setEvents] = useState<TraceEvent[]>(initialTrace.slice(0, 12));
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    setEvents(initialTrace.slice(0, 12));
  }, [initialTrace]);

  // Subscribe to real-time WS updates
  useEffect(() => {
    if (!unternehmenId) return;
    const tok = localStorage.getItem('opencognit_token') || '';
    const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws' + (tok ? `?token=${tok}` : '');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.unternehmenId && msg.unternehmenId !== unternehmenId) return;

        if (msg.type === 'trace' && msg.data) {
          setEvents(prev => [{
            id: crypto.randomUUID(),
            expertId: msg.data.expertId,
            expertName: msg.data.expertName,
            typ: msg.data.typ,
            titel: msg.data.titel,
            erstelltAm: msg.data.erstelltAm || new Date().toISOString(),
          }, ...prev].slice(0, 12));
        }
        if (msg.type === 'task_started' && msg.agentId) {
          setEvents(prev => [{
            id: crypto.randomUUID(),
            expertId: msg.agentId,
            expertName: msg.agentName,
            typ: 'task_started',
            titel: msg.taskTitel || (lang === 'de' ? 'Task gestartet' : 'Task started'),
            erstelltAm: new Date().toISOString(),
          }, ...prev].slice(0, 12));
        }
        if (msg.type === 'task_completed' && msg.agentId) {
          setEvents(prev => [{
            id: crypto.randomUUID(),
            expertId: msg.agentId,
            expertName: msg.agentName,
            typ: 'task_completed',
            titel: msg.taskTitel || (lang === 'de' ? 'Task abgeschlossen' : 'Task completed'),
            erstelltAm: new Date().toISOString(),
          }, ...prev].slice(0, 12));
        }
      } catch { /* ignore */ }
    };
    return () => { ws.close(); wsRef.current = null; };
  }, [unternehmenId, lang]);

  if (events.length === 0) return null;

  return (
    <Card style={{ padding: '1.25rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#23CDCB', boxShadow: '0 0 8px #23CDCB80', animation: 'pulse 2s ease-in-out infinite' }} />
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#23CDCB', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {lang === 'de' ? 'Live-Aktivität' : 'Live Activity'}
        </span>
        <span style={{ fontSize: '0.6875rem', color: '#334155', marginLeft: 'auto' }}>
          {lang === 'de' ? 'Echtzeit-Log aller Agenten' : 'Real-time agent log'}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        {events.map(ev => {
          const cfg = PULSE_CFG[ev.typ] ?? PULSE_CFG.info;
          const isTask = ev.typ === 'task_started' || ev.typ === 'task_completed';
          return (
            <div key={ev.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.625rem',
              padding: '0.4rem 0.75rem', borderRadius: '8px',
              background: cfg.bg,
              border: `1px solid ${cfg.color}${isTask ? '30' : '15'}`,
            }}>
              <span style={{ fontSize: '0.625rem', flexShrink: 0, color: cfg.color }}>{cfg.symbol}</span>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                {ev.expertName && (
                  <span style={{ fontSize: '0.6875rem', color: cfg.color, fontWeight: 700, flexShrink: 0 }}>
                    {ev.expertName}
                  </span>
                )}
                <span style={{ fontSize: '0.6875rem', color: isTask ? '#94a3b8' : '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.titel}
                </span>
              </div>
              <span style={{ fontSize: '0.625rem', color: '#334155', flexShrink: 0 }}>
                {reltime(ev.erstelltAm, lang)}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Company Health Score ──────────────────────────────────────────────────────

function computeHealthScore(
  experten: { gesamt: number; aktiv: number; running: number; error: number },
  aufgaben: { gesamt: number; erledigt: number; blockiert: number; inBearbeitung: number },
  kosten: { prozent: number },
  pendingApprovals: number,
): { score: number; grade: string; gradeColor: string; factors: Array<{ label: string; delta: number; color: string }> } {
  let score = 100;
  const factors: Array<{ label: string; delta: number; color: string }> = [];

  // Budget health (max penalty -30)
  if (kosten.prozent >= 100) {
    score -= 30; factors.push({ label: 'Budget überschritten', delta: -30, color: '#ef4444' });
  } else if (kosten.prozent >= 90) {
    score -= 20; factors.push({ label: 'Budget kritisch', delta: -20, color: '#ef4444' });
  } else if (kosten.prozent >= 75) {
    score -= 10; factors.push({ label: 'Budget knapp', delta: -10, color: '#f59e0b' });
  }

  // Agent errors (max penalty -20)
  const errPenalty = Math.min(experten.error * 5, 20);
  if (errPenalty > 0) {
    score -= errPenalty; factors.push({ label: `${experten.error} Agenten fehlerhaft`, delta: -errPenalty, color: '#ef4444' });
  }

  // Blocked tasks (max penalty -20)
  const blockPenalty = Math.min(aufgaben.blockiert * 5, 20);
  if (blockPenalty > 0) {
    score -= blockPenalty; factors.push({ label: `${aufgaben.blockiert} blockierte Aufgaben`, delta: -blockPenalty, color: '#f59e0b' });
  }

  // Pending approvals penalty (-5)
  if (pendingApprovals > 0) {
    score -= 5; factors.push({ label: `${pendingApprovals} ausstehende Genehmigungen`, delta: -5, color: '#f59e0b' });
  }

  // Positive: agents actively working
  if (experten.running > 0) {
    factors.push({ label: `${experten.running} Agenten aktiv`, delta: 0, color: '#22c55e' });
  }

  // Positive: tasks being completed
  if (aufgaben.erledigt > 0) {
    factors.push({ label: `${aufgaben.erledigt} Aufgaben erledigt`, delta: 0, color: '#22c55e' });
  }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 90 ? 'Exzellent' : score >= 70 ? 'Gut' : score >= 50 ? 'Mittel' : 'Kritisch';
  const gradeColor = score >= 90 ? '#22c55e' : score >= 70 ? '#23CDCB' : score >= 50 ? '#f59e0b' : '#ef4444';

  return { score, grade, gradeColor, factors };
}

function HealthScoreGauge({ score, color, size = 80 }: { score: number; color: string; size?: number }) {
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const arc = 0.75 * circ; // 270 degrees
  const pct = Math.max(0, Math.min(1, score / 100));
  const dash = pct * arc;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(135deg)' }}>
      {/* Background track */}
      <circle cx={size/2} cy={size/2} r={r}
        fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={7}
        strokeDasharray={`${arc} ${circ - arc}`} strokeLinecap="round"
      />
      {/* Value arc */}
      <circle cx={size/2} cy={size/2} r={r}
        fill="none" stroke={color} strokeWidth={7}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${color}80)`, transition: 'stroke-dasharray 0.8s ease' }}
      />
    </svg>
  );
}

function HealthScoreCard({ experten, aufgaben, kosten, pendingApprovals, lang }: {
  experten: { gesamt: number; aktiv: number; running: number; error: number };
  aufgaben: { gesamt: number; erledigt: number; blockiert: number; inBearbeitung: number };
  kosten: { prozent: number };
  pendingApprovals: number;
  lang: string;
}) {
  const de = lang === 'de';
  const { score, grade, gradeColor, factors } = computeHealthScore(experten, aufgaben, kosten, pendingApprovals);
  const [expanded, setExpanded] = useState(false);

  return (
    <Card style={{ padding: '1.25rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Gauge */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <HealthScoreGauge score={score} color={gradeColor} size={72} />
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', flexDirection: 'column',
          }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: gradeColor, lineHeight: 1 }}>{score}</span>
          </div>
        </div>

        {/* Labels */}
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {de ? 'Unternehmensgesundheit' : 'Company Health'}
            </span>
          </div>
          <div style={{ fontSize: '1.125rem', fontWeight: 800, color: gradeColor, marginBottom: '0.375rem' }}>
            {grade}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
            {factors.slice(0, 3).map((f, i) => (
              <span key={i} style={{
                fontSize: '0.6875rem', padding: '0.15rem 0.5rem', borderRadius: '999px',
                background: `${f.color}18`, border: `1px solid ${f.color}30`, color: f.color,
              }}>
                {f.delta < 0 ? `${f.delta}` : '+'} {f.label}
              </span>
            ))}
            {factors.length > 3 && (
              <button onClick={() => setExpanded(e => !e)} style={{
                fontSize: '0.6875rem', padding: '0.15rem 0.5rem', borderRadius: '999px',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#94a3b8', cursor: 'pointer',
              }}>
                {expanded ? (de ? 'weniger' : 'less') : `+${factors.length - 3} ${de ? 'mehr' : 'more'}`}
              </button>
            )}
          </div>
          {expanded && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '0.375rem' }}>
              {factors.slice(3).map((f, i) => (
                <span key={i} style={{
                  fontSize: '0.6875rem', padding: '0.15rem 0.5rem', borderRadius: '999px',
                  background: `${f.color}18`, border: `1px solid ${f.color}30`, color: f.color,
                }}>
                  {f.delta < 0 ? `${f.delta}` : ''} {f.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Company Brief ─────────────────────────────────────────────────────────────

function CompanyBrief({
  experten, aufgaben, kosten, pendingApprovals, letzteAktivitaet, lang,
}: {
  experten: { aktiv: number; running: number; gesamt: number };
  aufgaben: { offen: number; inBearbeitung: number; blockiert: number; erledigt: number; gesamt: number };
  kosten: { prozent: number };
  pendingApprovals: number;
  letzteAktivitaet: any[];
  lang: string;
}) {
  const de = lang === 'de';

  // Filter activity for today
  const today = new Date().toDateString();
  const todayEvents = letzteAktivitaet.filter(a => new Date(a.erstelltAm).toDateString() === today);
  const todayDone   = todayEvents.filter(a => a.aktion?.toLowerCase().includes('erledigt') || a.aktion?.toLowerCase().includes('completed') || a.aktion?.toLowerCase().includes('done')).length;

  // Derive one smart insight
  type Insight = { color: string; text: string };
  let insight: Insight | null = null;
  if (kosten.prozent >= 90) {
    insight = { color: '#ef4444', text: de ? `⚠ Budget fast aufgebraucht (${kosten.prozent}%)` : `⚠ Budget nearly exhausted (${kosten.prozent}%)` };
  } else if (aufgaben.blockiert > 0 && experten.aktiv > experten.running) {
    const idleCount = experten.aktiv - experten.running;
    insight = { color: '#f59e0b', text: de
      ? `${aufgaben.blockiert} blockierte Aufgaben · ${idleCount} Agenten verfügbar`
      : `${aufgaben.blockiert} blocked tasks · ${idleCount} agents available` };
  } else if (pendingApprovals > 0) {
    insight = { color: '#f59e0b', text: de
      ? `${pendingApprovals} Genehmigung${pendingApprovals > 1 ? 'en' : ''} ausstehend`
      : `${pendingApprovals} approval${pendingApprovals > 1 ? 's' : ''} pending` };
  } else if (experten.running > 0) {
    insight = { color: '#23CDCB', text: de
      ? `${experten.running} Agent${experten.running > 1 ? 'en' : ''} arbeitet gerade`
      : `${experten.running} agent${experten.running > 1 ? 's' : ''} working right now` };
  } else if (aufgaben.erledigt > 0) {
    insight = { color: '#22c55e', text: de
      ? `${aufgaben.erledigt} Aufgaben erledigt gesamt`
      : `${aufgaben.erledigt} tasks completed total` };
  }

  const metrics: { label: string; value: string | number; color: string }[] = [
    { label: de ? 'Heute aktiv' : 'Events today',    value: todayEvents.length, color: '#23CDCB' },
    { label: de ? 'Laufende Agenten' : 'Running',     value: experten.running,   color: '#22c55e' },
    { label: de ? 'Offene Aufgaben' : 'Open tasks',  value: aufgaben.offen,     color: '#94a3b8' },
    { label: de ? 'Budget genutzt' : 'Budget used',  value: `${kosten.prozent}%`, color: kosten.prozent > 80 ? '#ef4444' : '#22c55e' },
  ];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap',
      padding: '0.875rem 1.5rem', borderRadius: '16px',
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
      backdropFilter: 'blur(20px)',
    }}>
      {/* Date label */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ fontSize: '0.625rem', fontWeight: 700, color: '#334155', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {de ? 'Heute' : 'Today'}
        </div>
        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#64748b' }}>
          {new Date().toLocaleDateString(de ? 'de-DE' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' })}
        </div>
      </div>

      <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

      {/* Metrics strip */}
      {metrics.map((m, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          <span style={{ fontSize: '1.125rem', fontWeight: 800, color: m.color }}>{m.value}</span>
          <span style={{ fontSize: '0.75rem', color: '#475569' }}>{m.label}</span>
        </div>
      ))}

      {/* Insight */}
      {insight && (
        <>
          <div style={{ width: 1, height: 32, background: 'rgba(255,255,255,0.07)', flexShrink: 0, marginLeft: 'auto' }} />
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.3rem 0.75rem', borderRadius: '999px',
            background: insight.color + '12', border: `1px solid ${insight.color}30`,
            fontSize: '0.75rem', fontWeight: 600, color: insight.color, flexShrink: 0,
          }}>
            {insight.text}
          </div>
        </>
      )}
    </div>
  );
}

// ── Mission Control ───────────────────────────────────────────────────────────

interface LiveAgent {
  id: string; name: string; rolle: string; titel?: string;
  avatar?: string; avatarFarbe: string;
  status: string; zyklusAktiv: boolean;
  letzterZyklus?: string;
  budgetPct: number;
  currentTask: { id: string; titel: string; status: string } | null;
  lastTrace: { typ: string; titel: string } | null;
  isOrchestrator?: boolean;
}

function AgentMissionCard({
  agent, lang, onChat, onWakeup, waking,
}: {
  agent: LiveAgent; lang: string;
  onChat: (id: string) => void;
  onWakeup: (id: string) => void;
  waking: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const isRunning = agent.status === 'running';
  const isError   = agent.status === 'error';
  const isCEO     = agent.isOrchestrator === true;
  const statusColor = isRunning ? '#23CDCB' : isError ? '#ef4444' : agent.status === 'active' || agent.status === 'idle' ? '#22c55e' : '#475569';
  const statusLabel = isRunning ? (lang === 'de' ? 'Arbeitet' : 'Working') : isError ? (lang === 'de' ? 'Fehler' : 'Error') : (lang === 'de' ? 'Bereit' : 'Ready');
  const traceCfg = agent.lastTrace ? (TRACE_CFG[agent.lastTrace.typ] || TRACE_CFG.info) : null;

  const borderColor = isCEO
    ? (hovered ? 'rgba(255,215,0,0.6)' : 'rgba(255,215,0,0.3)')
    : isRunning ? 'rgba(35,205,202,0.35)'
    : isError ? 'rgba(239,68,68,0.25)'
    : hovered ? `${agent.avatarFarbe}35` : 'rgba(255,255,255,0.09)';

  const shadowStyle = isCEO
    ? (hovered ? 'inset 0 1px 0 rgba(255,255,255,0.15), 0 10px 40px rgba(255,215,0,0.15)' : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 0 20px rgba(255,215,0,0.05)')
    : isRunning ? 'inset 0 1px 0 rgba(255,255,255,0.15), 0 0 40px rgba(35,205,202,0.1), 0 8px 32px rgba(0,0,0,0.3)'
    : hovered ? 'inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 40px rgba(0,0,0,0.35)'
    : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.2)';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: '24px', padding: '1.5rem',
        background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${borderColor}`,
        backdropFilter: 'blur(24px) saturate(160%)',
        boxShadow: shadowStyle,
        transform: hovered ? 'translateY(-4px)' : 'none',
        transition: 'all 0.3s cubic-bezier(0.4,0,0.2,1)',
        cursor: 'pointer',
      }}
    >
      {/* CEO gold left bar */}
      {isCEO && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: 4, height: '100%',
          background: 'linear-gradient(to bottom, #FFD700, #FFA500)',
          borderRadius: '24px 0 0 24px',
        }} />
      )}

      {/* CEO crown badge */}
      {isCEO && (
        <div style={{
          position: 'absolute', top: '0.875rem', right: '3.5rem',
          background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.25)',
          padding: '3px 8px', borderRadius: '6px',
          display: 'flex', alignItems: 'center', gap: 5,
          boxShadow: '0 4px 12px rgba(255,215,0,0.1)',
        }}>
          <Crown size={11} color="#FFD700" />
          <span style={{ fontSize: '9px', color: '#FFD700', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>CEO</span>
        </div>
      )}

      {/* Running pulse ring */}
      {isRunning && (
        <div style={{
          position: 'absolute', inset: -1, borderRadius: '25px',
          border: '1px solid rgba(35,205,202,0.4)',
          animation: 'aura 3s ease-in-out infinite', pointerEvents: 'none',
        }} />
      )}

      {/* Dot pattern */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: hovered || isRunning ? 1 : 0, transition: 'opacity 0.3s',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
      }} />

      {/* Header */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{
          width: 48, height: 48, borderRadius: '12px', flexShrink: 0,
          background: isCEO ? 'rgba(255,215,0,0.1)' : `${agent.avatarFarbe}22`,
          border: `1px solid ${isCEO ? 'rgba(255,215,0,0.3)' : `${agent.avatarFarbe}40`}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.125rem', fontWeight: 600,
          color: isCEO ? '#FFD700' : agent.avatarFarbe,
          boxShadow: isRunning ? `0 0 16px ${agent.avatarFarbe}30` : isCEO ? '0 0 16px rgba(255,215,0,0.15)' : 'none',
          transition: 'box-shadow 0.3s',
          position: 'relative',
        }}>
          {agent.avatar || agent.name.slice(0, 2).toUpperCase()}
          <div style={{
            position: 'absolute', bottom: -3, right: -3,
            width: 11, height: 11, borderRadius: '50%',
            background: statusColor, border: '2px solid rgba(4,4,10,0.95)',
            boxShadow: isRunning ? `0 0 8px ${statusColor}` : 'none',
            animation: isRunning ? 'pulse 2s ease-in-out infinite' : 'none',
          }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agent.name}
            </span>
            {/* Status badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0,
              padding: '0.2rem 0.5rem', borderRadius: '999px',
              background: `${statusColor}18`, border: `1px solid ${statusColor}35`,
            }}>
              {isRunning
                ? <Loader2 size={9} style={{ color: statusColor, animation: 'spin 1s linear infinite' }} />
                : <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor }} />
              }
              <span style={{ fontSize: '0.5625rem', fontWeight: 700, color: statusColor, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {statusLabel}
              </span>
            </div>
          </div>
          <div style={{ fontSize: '0.875rem', color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {agent.titel || agent.rolle}
          </div>
        </div>

        {/* Action buttons top-right */}
        <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
          <button onClick={(e) => { e.stopPropagation(); onChat(agent.id); }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#23CDCB'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#71717a'; }}
            title={lang === 'de' ? 'Chatten' : 'Chat'}
            style={{ padding: '0.25rem', background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}>
            <MessageSquare size={14} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); onWakeup(agent.id); }} disabled={waking}
            onMouseEnter={e => { if (!waking) (e.currentTarget as HTMLElement).style.color = '#22c55e'; }}
            onMouseLeave={e => { if (!waking) (e.currentTarget as HTMLElement).style.color = '#71717a'; }}
            title={lang === 'de' ? 'Jetzt ausführen' : 'Run now'}
            style={{ padding: '0.25rem', background: 'none', border: 'none', color: waking ? '#22c55e' : '#71717a', cursor: waking ? 'default' : 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }}>
            {waking ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Radio size={14} />}
          </button>
        </div>
      </div>

      {/* Info rows */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '0.625rem', fontSize: '0.8125rem', marginBottom: '0.875rem' }}>
        {/* Current task */}
        <div style={{
          padding: '0.5rem 0.75rem', borderRadius: '10px',
          background: isRunning ? 'rgba(35,205,202,0.05)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${isRunning ? 'rgba(35,205,202,0.15)' : 'rgba(255,255,255,0.06)'}`,
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          {isRunning
            ? <Loader2 size={11} style={{ color: '#23CDCB', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            : <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#334155', flexShrink: 0 }} />
          }
          <span style={{ color: isRunning ? '#e2e8f0' : '#52525b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8125rem' }}>
            {agent.currentTask ? agent.currentTask.titel : (lang === 'de' ? 'Keine aktive Aufgabe' : 'No active task')}
          </span>
        </div>

        {/* Last trace */}
        {agent.lastTrace && traceCfg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', paddingLeft: '0.25rem' }}>
            <div style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: traceCfg.color }} />
            <span style={{ color: '#52525b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.75rem' }}>
              {agent.lastTrace.titel}
            </span>
          </div>
        )}

        {/* Last cycle */}
        {agent.letzterZyklus && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ color: '#52525b' }}>{lang === 'de' ? 'Letzter Zyklus' : 'Last cycle'}</span>
            <span style={{ color: '#d4d4d8' }}>{reltime(agent.letzterZyklus, lang)}</span>
          </div>
        )}

        {/* Budget bar */}
        {agent.budgetPct > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
              <span style={{ color: '#52525b' }}>Budget</span>
              <span style={{ color: agent.budgetPct > 90 ? '#ef4444' : agent.budgetPct > 70 ? '#eab308' : '#71717a', fontWeight: 600 }}>
                {agent.budgetPct}%
              </span>
            </div>
            <div style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3, transition: 'width 0.3s',
                width: `${Math.min(agent.budgetPct, 100)}%`,
                background: agent.budgetPct > 90 ? '#ef4444' : agent.budgetPct > 70 ? '#eab308' : '#22c55e',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Autonomy row */}
      <div style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.5rem 0.75rem', borderRadius: '10px',
        background: agent.zyklusAktiv ? 'rgba(35,205,202,0.06)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${agent.zyklusAktiv ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.06)'}`,
      }}>
        {agent.zyklusAktiv
          ? <Zap size={13} color="#23CDCB" />
          : <ZapOff size={13} color="#52525b" />
        }
        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: agent.zyklusAktiv ? '#23CDCB' : '#71717a' }}>
          {agent.zyklusAktiv
            ? (lang === 'de' ? 'Auto-Zyklus aktiv' : 'Auto-cycle active')
            : (lang === 'de' ? 'Auto-Zyklus inaktiv' : 'Auto-cycle inactive')
          }
        </span>
      </div>
    </div>
  );
}

function MissionControl({
  initialAgents, unternehmenId, lang, onChat,
}: {
  initialAgents: LiveAgent[]; unternehmenId: string; lang: string;
  onChat: (expertId: string) => void;
}) {
  const [agents, setAgents] = useState<LiveAgent[]>(initialAgents);
  const [waking, setWaking] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);

  // Sync when parent reloads
  useEffect(() => { setAgents(initialAgents); }, [initialAgents]);

  // Live WS updates for agent status changes
  useEffect(() => {
    if (!unternehmenId) return;
    let destroyed = false; // StrictMode guard: prevents errors when React unmounts during WS handshake
    const token = localStorage.getItem('opencognit_token');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.hostname}:3201/ws${token ? `?token=${token}` : ''}`);
    wsRef.current = ws;

    ws.onmessage = ev => {
      if (destroyed) return;
      try {
        const msg = JSON.parse(ev.data);
        // Update agent status when heartbeat fires
        if (msg.type === 'heartbeat' && msg.data?.expertId) {
          setAgents(prev => prev.map(a =>
            a.id === msg.data.expertId
              ? { ...a, status: msg.data.status || a.status, letzterZyklus: new Date().toISOString() }
              : a
          ));
        }
        // Update agent card when task status changes
        if (msg.type === 'task_completed' && msg.agentId) {
          setAgents(prev => prev.map(a =>
            a.id === msg.agentId ? { ...a, status: 'active', currentTask: null } : a
          ));
        }
        if (msg.type === 'task_started' && msg.agentId) {
          setAgents(prev => prev.map(a =>
            a.id === msg.agentId
              ? { ...a, status: 'running', currentTask: { id: msg.taskId || '', titel: msg.taskTitel || '', status: 'in_progress' } }
              : a
          ));
        }
        // Update trace events per agent
        if (msg.type === 'trace' && msg.data?.expertId) {
          setAgents(prev => prev.map(a =>
            a.id === msg.data.expertId
              ? { ...a, lastTrace: { typ: msg.data.typ, titel: msg.data.titel }, status: 'running' }
              : a
          ));
        }
      } catch {}
    };

    // Suppress console noise from StrictMode double-invoke closing the socket mid-handshake
    ws.onerror = () => { if (!destroyed) console.warn('[MissionControl] WebSocket error'); };
    ws.onclose = () => { if (!destroyed) console.debug('[MissionControl] WebSocket closed'); };

    return () => {
      destroyed = true;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      wsRef.current = null;
    };
  }, [unternehmenId]);

  const handleWakeup = async (agentId: string) => {
    setWaking(prev => new Set(prev).add(agentId));
    const token = localStorage.getItem('opencognit_token');
    await fetch(`/api/experten/${agentId}/wakeup`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
    setTimeout(() => {
      setWaking(prev => { const s = new Set(prev); s.delete(agentId); return s; });
    }, 2000);
  };

  const runningCount = agents.filter(a => a.status === 'running').length;

  return (
    <div>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: runningCount > 0 ? '#23CDCB' : '#475569',
              boxShadow: runningCount > 0 ? '0 0 8px #23CDCB80' : 'none',
              animation: runningCount > 0 ? 'pulse 2s ease-in-out infinite' : 'none',
            }} />
          </div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            {lang === 'de' ? 'Mission Control' : 'Mission Control'}
          </h2>
          {runningCount > 0 && (
            <span style={{
              padding: '0.2rem 0.625rem', borderRadius: '999px',
              background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
              fontSize: '0.6875rem', fontWeight: 700, color: '#23CDCB',
            }}>
              {runningCount} {lang === 'de' ? 'aktiv' : 'active'}
            </span>
          )}
        </div>
        <Link to="/experts" style={{
          display: 'flex', alignItems: 'center', gap: '0.375rem',
          fontSize: '0.8125rem', color: '#64748b', textDecoration: 'none',
          padding: '0.375rem 0.75rem', borderRadius: '8px',
          border: '1px solid rgba(255,255,255,0.07)',
          transition: 'color 0.15s, border-color 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#23CDCB'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(35,205,202,0.3)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#64748b'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; }}
        >
          {lang === 'de' ? 'Alle Agenten' : 'All agents'} <ArrowRight size={14} />
        </Link>
      </div>

      {agents.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '3rem 1rem',
          background: 'rgba(255,255,255,0.02)', borderRadius: '20px',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <Cpu size={40} style={{ opacity: 0.15, marginBottom: '0.75rem', color: '#23CDCB' }} />
          <p style={{ color: '#475569', fontWeight: 600, margin: '0 0 0.5rem' }}>
            {lang === 'de' ? 'Noch keine Agenten' : 'No agents yet'}
          </p>
          <Link to="/experts" style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.5rem 1rem', borderRadius: '10px',
            background: 'rgba(35,205,202,0.08)', border: '1px solid rgba(35,205,202,0.2)',
            color: '#23CDCB', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 600,
          }}>
            <Plus size={14} /> {lang === 'de' ? 'Agent erstellen' : 'Create agent'}
          </Link>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '1rem',
        }}>
          {agents.map(agent => (
            <AgentMissionCard
              key={agent.id}
              agent={agent}
              lang={lang}
              onChat={onChat}
              onWakeup={handleWakeup}
              waking={waking.has(agent.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Onboarding / Getting Started ─────────────────────────────────────────────

function GettingStartedCard({
  companyId,
  hasAgents,
  hasCycle,
  hasTasks,
  hasDoneTasks,
  lang,
  navigate,
}: {
  companyId: string;
  hasAgents: boolean;
  hasCycle: boolean;
  hasTasks: boolean;
  hasDoneTasks: boolean;
  lang: string;
  navigate: (to: string) => void;
}) {
  const de = lang === 'de';
  const storageKey = `onboarding_dismissed_${companyId}`;
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(storageKey) === '1');
  const [howOpen, setHowOpen] = useState(false);

  const steps = [
    {
      done: true,
      icon: Building2,
      title: de ? 'Workspace erstellt' : 'Workspace created',
      desc: de ? 'Dein Unternehmen ist eingerichtet.' : 'Your company is set up.',
      action: null,
    },
    {
      done: hasAgents,
      icon: Bot,
      title: de ? 'Ersten Agenten anlegen' : 'Create your first agent',
      desc: de
        ? 'Gib ihm eine Rolle (z.B. "Entwickler") und wähle ein LLM.'
        : 'Give it a role (e.g. "Developer") and pick an LLM.',
      action: { label: de ? 'Agenten erstellen →' : 'Create agent →', to: '/experts' },
    },
    {
      done: hasCycle,
      icon: PlayCircle,
      title: de ? 'Auto-Zyklus aktivieren' : 'Enable auto-cycle',
      desc: de
        ? 'Agent wacht automatisch auf und bearbeitet Aufgaben.'
        : 'Agent wakes up automatically and processes tasks.',
      action: { label: de ? 'Agenten öffnen →' : 'Open agents →', to: '/experts' },
    },
    {
      done: hasTasks,
      icon: ListTodo,
      title: de ? 'Erste Aufgabe erstellen' : 'Create your first task',
      desc: de
        ? 'Weise sie einem Agenten zu — er erledigt sie eigenständig.'
        : 'Assign it to an agent — it will handle it autonomously.',
      action: { label: de ? 'Aufgabe anlegen →' : 'Create task →', to: '/tasks' },
    },
    {
      done: hasDoneTasks,
      icon: MonitorPlay,
      title: de ? 'Ergebnis beobachten' : 'Watch it run',
      desc: de
        ? 'Im War Room siehst du live, was deine Agenten gerade tun.'
        : 'The War Room shows you live what your agents are doing.',
      action: { label: de ? 'War Room öffnen →' : 'Open War Room →', to: '/war-room' },
    },
  ];

  const completed = steps.filter(s => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);
  const allDone = completed === steps.length;

  // Auto-dismiss once all steps done (after short delay)
  useEffect(() => {
    if (allDone && !dismissed) {
      const t = setTimeout(() => {
        localStorage.setItem(storageKey, '1');
        setDismissed(true);
      }, 4000);
      return () => clearTimeout(t);
    }
  }, [allDone, dismissed, storageKey]);

  if (dismissed) return null;

  const HOW_IT_WORKS_DE = `OpenCognit ist ein KI-Agenten-Betriebssystem. So funktioniert es:

① Company (Workspace)
   Alles lebt in deiner Company: Agenten, Aufgaben, Budget, Erinnerungen.

② Agenten = KI-Mitarbeiter
   Jeder Agent hat eine Rolle (z.B. "Backend Developer"), ist mit einem LLM verbunden (Claude, GPT-4, Ollama…) und hat Skills aus der Skill Library.

③ Aufgaben = Arbeitspakete
   Du (oder ein Orchestrator-Agent) erstellst Aufgaben mit Titel + Beschreibung. Der Agent bekommt sie in seine Inbox.

④ Auto-Zyklus = der Herzschlag
   Alle N Sekunden wacht der Agent auf, liest seine Inbox, denkt nach und handelt — er aktualisiert Tasks, erstellt Sub-Tasks, schreibt Dateien, schickt Nachrichten an Kollegen.

⑤ Orchestrator = Team-Lead
   Ein Orchestrator-Agent delegiert Aufgaben, ruft Meetings ein und koordiniert das Team. Du musst nichts manuell zuweisen.

⑥ Memory + Learning Loop
   Agenten speichern Wissen dauerhaft (Memory) und lernen aus ihrer Arbeit neue Skills (Learning Loop), die beim nächsten Zyklus automatisch eingesetzt werden.`;

  const HOW_IT_WORKS_EN = `OpenCognit is an AI agent operating system. Here's how it works:

① Company (Workspace)
   Everything lives inside your company: agents, tasks, budget, memory.

② Agents = AI workers
   Each agent has a role (e.g. "Backend Developer"), is connected to an LLM (Claude, GPT-4, Ollama…) and has skills from the Skill Library.

③ Tasks = work items
   You (or an orchestrator agent) create tasks with a title + description. The agent receives them in its inbox.

④ Auto-cycle = the heartbeat
   Every N seconds the agent wakes up, reads its inbox, thinks, and acts — it updates tasks, creates sub-tasks, writes files, sends messages to colleagues.

⑤ Orchestrator = team lead
   An orchestrator agent delegates tasks, calls meetings, and coordinates the team. You don't need to assign anything manually.

⑥ Memory + Learning Loop
   Agents store knowledge permanently (Memory) and learn new skills from their work (Learning Loop), which are automatically applied in future cycles.`;

  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(35,205,202,0.04) 0%, rgba(168,85,247,0.04) 100%)',
      border: '1px solid rgba(35,205,202,0.15)',
      borderRadius: 20, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'rgba(35,205,202,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#23CDCB',
          }}>
            <Sparkles size={16} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#f4f4f5' }}>
              {de ? 'Erste Schritte' : 'Getting Started'}
            </div>
            <div style={{ fontSize: 11, color: '#52525b', marginTop: 1 }}>
              {completed}/{steps.length} {de ? 'abgeschlossen' : 'completed'}
              {allDone && <span style={{ color: '#23CDCB', marginLeft: 6 }}>✓ {de ? 'Alles bereit!' : 'All done!'}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setHowOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
              fontSize: 11, color: '#71717a', fontWeight: 600,
            }}
          >
            <BookOpen size={12} />
            {de ? 'Wie funktioniert es?' : 'How does it work?'}
            {howOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          <button
            onClick={() => { localStorage.setItem(storageKey, '1'); setDismissed(true); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3f3f46', padding: 4, display: 'flex' }}
            title={de ? 'Schließen' : 'Dismiss'}
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 2, background: 'rgba(255,255,255,0.04)', margin: '0 24px' }}>
        <div style={{
          height: '100%', borderRadius: 1, width: `${pct}%`,
          background: allDone ? '#23CDCB' : 'linear-gradient(90deg, #23CDCB, #a855f7)',
          transition: 'width 0.6s ease',
        }} />
      </div>

      {/* Steps */}
      <div style={{ padding: '16px 24px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step, i) => {
          const Icon = step.icon;
          const isNext = !step.done && steps.slice(0, i).every(s => s.done);
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', borderRadius: 12,
              background: step.done
                ? 'rgba(35,205,202,0.04)'
                : isNext
                  ? 'rgba(255,255,255,0.03)'
                  : 'transparent',
              border: step.done
                ? '1px solid rgba(35,205,202,0.12)'
                : isNext
                  ? '1px solid rgba(255,255,255,0.06)'
                  : '1px solid transparent',
              opacity: !step.done && !isNext ? 0.45 : 1,
              transition: 'all 0.2s',
            }}>
              {/* Icon / checkmark */}
              <div style={{
                width: 32, height: 32, borderRadius: 9, flexShrink: 0,
                background: step.done ? 'rgba(35,205,202,0.1)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${step.done ? 'rgba(35,205,202,0.25)' : 'rgba(255,255,255,0.06)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: step.done ? '#23CDCB' : '#52525b',
              }}>
                {step.done ? <CheckCircle2 size={14} /> : <Icon size={14} />}
              </div>

              {/* Text */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: step.done ? '#a1a1aa' : '#e4e4e7', textDecoration: step.done ? 'line-through' : 'none', textDecorationColor: '#52525b' }}>
                  {step.title}
                </div>
                {!step.done && (
                  <div style={{ fontSize: 11, color: '#52525b', marginTop: 1 }}>{step.desc}</div>
                )}
              </div>

              {/* Action */}
              {!step.done && step.action && (
                <button
                  onClick={() => navigate(step.action!.to)}
                  style={{
                    flexShrink: 0, padding: '5px 12px', borderRadius: 8,
                    background: isNext ? 'rgba(35,205,202,0.1)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isNext ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    color: isNext ? '#23CDCB' : '#52525b',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {step.action.label}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* "How it works" expandable */}
      {howOpen && (
        <div style={{
          margin: '0 24px 20px',
          padding: '16px 18px',
          borderRadius: 14,
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <BookOpen size={12} style={{ color: '#23CDCB' }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#23CDCB', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {de ? 'Wie OpenCognit funktioniert' : 'How OpenCognit works'}
            </span>
          </div>
          <pre style={{
            fontSize: 11, color: '#71717a', lineHeight: 1.7,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            margin: 0, fontFamily: 'inherit',
          }}>
            {de ? HOW_IT_WORKS_DE : HOW_IT_WORKS_EN}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Command Bar ───────────────────────────────────────────────────────────────

function CommandBar({ agents, companyId, lang }: { agents: LiveAgent[]; companyId: string; lang: string }) {
  const de = lang === 'de';
  const [command, setCommand] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const orchestrator = agents.find(a => (a as any).isOrchestrator) || agents[0];

  const submit = async () => {
    if (!command.trim() || !orchestrator || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const token = localStorage.getItem('opencognit_token');
      const resp = await fetch(`/api/experten/${orchestrator.id}/chat/direct`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-unternehmen-id': companyId,
        },
        body: JSON.stringify({ nachricht: command }),
      });
      const data = await resp.json();
      setResult({ text: data.reply || (de ? 'Erledigt.' : 'Done.'), ok: true });
      setCommand('');
    } catch (e: any) {
      setResult({ text: e.message, ok: false });
    }
    setLoading(false);
  };

  if (!orchestrator) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.625rem',
        padding: '0.625rem 0.875rem',
        background: 'rgba(255,255,255,0.02)',
        border: `1px solid ${focused ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: '14px',
        transition: 'border-color 0.2s',
      }}>
        {/* Agent avatar */}
        <div style={{
          width: 28, height: 28, borderRadius: '8px', flexShrink: 0,
          background: `${orchestrator.avatarFarbe}18`,
          border: `1px solid ${orchestrator.avatarFarbe}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.6875rem', fontWeight: 700, color: orchestrator.avatarFarbe,
        }}>
          {orchestrator.avatar || orchestrator.name.slice(0, 2).toUpperCase()}
        </div>

        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={e => { setCommand(e.target.value); setResult(null); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={de
            ? `${orchestrator.name} beauftragen… (z.B. "Erstelle einen täglichen Report-Task für das Marketing-Team")`
            : `Task ${orchestrator.name}… (e.g. "Create a daily report task for the marketing team")`}
          style={{
            flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
            color: '#e4e4e7', fontSize: '0.875rem', cursor: 'text',
          }}
          disabled={loading}
        />

        <button
          onClick={submit}
          disabled={!command.trim() || loading}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.375rem 0.875rem', borderRadius: '9px', border: 'none',
            background: command.trim() && !loading ? 'rgba(35,205,202,0.12)' : 'rgba(255,255,255,0.04)',
            color: command.trim() && !loading ? '#23CDCB' : '#3f3f46',
            fontSize: '0.75rem', fontWeight: 700, cursor: command.trim() && !loading ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s', flexShrink: 0,
          }}
        >
          {loading
            ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
            : <Zap size={12} />
          }
          {loading ? (de ? 'Sendet…' : 'Sending…') : (de ? 'Senden' : 'Send')}
        </button>
      </div>

      {/* Inline result */}
      {result && (
        <div style={{
          padding: '0.625rem 0.875rem', borderRadius: '10px',
          background: result.ok ? 'rgba(35,205,202,0.04)' : 'rgba(239,68,68,0.06)',
          border: `1px solid ${result.ok ? 'rgba(35,205,202,0.15)' : 'rgba(239,68,68,0.15)'}`,
          fontSize: '0.8125rem', color: result.ok ? '#94a3b8' : '#fca5a5',
          lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 200, overflowY: 'auto',
        }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: result.ok ? '#23CDCB' : '#ef4444', display: 'block', marginBottom: '0.25rem' }}>
            {orchestrator.name}
          </span>
          {result.text}
        </div>
      )}
    </div>
  );
}

// ── Quick Action Card ─────────────────────────────────────────────────────────

function QuickActionCard({ item, onClick }: {
  item: { icon: React.ElementType; label: string; accent: string; badge?: number };
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const accent = item.accent;
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        padding: '0.875rem 1.125rem', borderRadius: '16px',
        background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(24px) saturate(160%)',
        border: `1px solid ${hovered ? `${accent}30` : 'rgba(255,255,255,0.09)'}`,
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered
          ? `inset 0 1px 0 rgba(255,255,255,0.18), 0 12px 32px rgba(0,0,0,0.3), 0 0 0 1px ${accent}15`
          : 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.18)',
        cursor: 'pointer', textAlign: 'left', transition: 'all 0.25s ease',
      }}
    >
      {/* Dot pattern */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        opacity: hovered ? 1 : 0, transition: 'opacity 0.3s',
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)',
        backgroundSize: '14px 14px',
      }} />
      <div style={{
        width: 34, height: 34, borderRadius: '10px', flexShrink: 0,
        background: hovered ? `${accent}20` : `${accent}15`,
        border: `1px solid ${hovered ? `${accent}35` : `${accent}20`}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'all 0.25s', position: 'relative',
      }}>
        <item.icon size={15} style={{ color: accent }} />
      </div>
      <span style={{ fontSize: '0.875rem', fontWeight: 600, color: hovered ? '#f1f5f9' : '#94a3b8', transition: 'color 0.2s', position: 'relative' }}>
        {item.label}
      </span>
      {item.badge !== undefined && (
        <span style={{
          position: 'absolute', top: '0.5rem', right: '0.5rem',
          background: '#f59e0b', color: '#0a0a0f', borderRadius: '999px',
          fontSize: '0.625rem', fontWeight: 800, padding: '0.1rem 0.375rem',
          minWidth: 16, textAlign: 'center',
        }}>
          {item.badge}
        </span>
      )}
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { aktivesUnternehmen } = useCompany();
  const { t, language: lang } = useI18n();
  const navigate = useNavigate();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', t.nav.dashboard]);

  const { data, loading, error, reload } = useApi<DashboardData>(
    () => apiDashboard.laden(aktivesUnternehmen!.id),
    [aktivesUnternehmen?.id],
    { showToast: false },
  );

  // Auto-refresh every 30s
  useEffect(() => {
    if (!aktivesUnternehmen) return;
    const id = setInterval(reload, 30000);
    return () => clearInterval(id);
  }, [aktivesUnternehmen, reload]);

  // Refresh when user returns to tab
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible' && aktivesUnternehmen) {
        reload();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [aktivesUnternehmen, reload]);

  useEffect(() => { if (error) console.error('Dashboard:', error); }, [error]);

  const { data: channels } = useApi<Array<{
    id: string; name: string; icon: string;
    status: { connected: boolean };
  }>>(
    () => apiChannels.status(), [], { showToast: false },
  );

  const [chatExpert, setChatExpert] = useState<ExperteType | null>(null);
  const [editExpert, setEditExpert] = useState<ExperteType | null>(null);
  const [standupOpen, setStandupOpen] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardDismissed, setWizardDismissed] = useState(() => !!localStorage.getItem('oc_wizard_dismissed'));

  // Show wizard banner when no agents exist
  const isFirstRun = !loading && data && (data.experten?.gesamt === 0);

  if (!aktivesUnternehmen) return null;

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <Loader2 size={28} style={{ color: '#23CDCB', animation: 'spin 1s linear infinite' }} />
    </div>
  );

  if (!data) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '0.75rem' }}>
      <AlertCircle size={32} style={{ color: '#ef4444' }} />
      <p style={{ color: '#94a3b8', fontSize: '0.9375rem', margin: 0 }}>
        {error ? (lang === 'de' ? `Fehler: ${error}` : `Error: ${error}`) : (lang === 'de' ? 'Keine Daten verfügbar' : 'No data available')}
      </p>
    </div>
  );

  const { experten, aufgaben, kosten, pendingApprovals, topExperten, letzteAktivitaet } = data;
  const topProjekte: any[] = (data as any).topProjekte || [];
  const aktiveZiele: any[] = (data as any).aktiveZiele || [];
  const letzteTrace: TraceEvent[] = (data as any).letzteTrace || [];
  const alleExperten: LiveAgent[] = (data as any).alleExperten || [];

  const budgetColor = kosten.prozent > 95 ? '#ef4444' : kosten.prozent > 80 ? '#f59e0b' : '#22c55e';
  const hasRunningAgents = experten.running > 0;
  const { score: healthScore, grade: healthGrade, gradeColor: healthColor, factors: healthFactors } = computeHealthScore(experten, aufgaben, kosten, pendingApprovals);

  // Derive simple trends from current values
  const taskTrend: 'up' | 'down' | 'neutral' = aufgaben.inBearbeitung > 0 ? 'up' : 'neutral';
  const budgetTrend: 'up' | 'down' | 'neutral' = kosten.prozent > 80 ? 'up' : kosten.prozent < 20 ? 'neutral' : 'neutral';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── CEO Setup Wizard Modal ── */}
      {showWizard && (
        <SetupWizard
          onClose={() => setShowWizard(false)}
          onDone={() => { setShowWizard(false); setWizardDismissed(true); localStorage.setItem('oc_wizard_dismissed', '1'); reload(); }}
        />
      )}

      {/* ── First-Run Banner ── */}
      {isFirstRun && !wizardDismissed && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(35,205,202,0.08), rgba(79,70,229,0.08))',
          border: '1px solid rgba(35,205,202,0.25)',
          borderRadius: '16px', padding: '1.25rem 1.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(35,205,202,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Sparkles size={22} style={{ color: '#23CDCB' }} />
            </div>
            <div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#fff', marginBottom: 3 }}>
                {lang === 'de' ? 'Lass den CEO dein Team einrichten' : 'Let the CEO set up your team'}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                {lang === 'de'
                  ? 'Beschreibe dein Vorhaben — CEO erstellt Projekte, Ordner, Agenten und Tasks automatisch'
                  : 'Describe your goal — CEO creates projects, folders, agents and tasks automatically'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
            <button
              onClick={() => { setWizardDismissed(true); localStorage.setItem('oc_wizard_dismissed', '1'); }}
              style={{ padding: '0.5rem 0.875rem', borderRadius: 9, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', fontSize: '0.8rem', cursor: 'pointer' }}
            >
              {lang === 'de' ? 'Später' : 'Later'}
            </button>
            <button
              onClick={() => setShowWizard(true)}
              style={{
                padding: '0.5rem 1.25rem', borderRadius: 9,
                background: 'rgba(35,205,202,0.9)', border: '1px solid rgba(35,205,202,0.4)',
                color: '#000', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Sparkles size={14} /> {lang === 'de' ? 'CEO Setup starten' : 'Start CEO Setup'}
            </button>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' }}>
            <Building2 size={14} style={{ color: '#23CDCB' }} />
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#23CDCB', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {aktivesUnternehmen.name}
            </span>
            {hasRunningAgents && (
              <span style={{
                display: 'flex', alignItems: 'center', gap: '0.3rem',
                padding: '0.15rem 0.5rem', borderRadius: '9999px',
                background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
                fontSize: '0.625rem', color: '#23CDCB', fontWeight: 700,
              }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#23CDCB', animation: 'pulse 1.5s ease-in-out infinite' }} />
                {experten.running} {lang === 'de' ? 'aktiv' : 'live'}
              </span>
            )}
          </div>
          <h1 style={{
            fontSize: '1.875rem', fontWeight: 800, margin: 0, lineHeight: 1.1,
            background: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            {t.dashboard.title}
          </h1>
          {(aktivesUnternehmen.ziel || aktivesUnternehmen.beschreibung) && (
            <p style={{ fontSize: '0.8125rem', color: '#475569', marginTop: '0.375rem', maxWidth: 540, lineHeight: 1.5 }}>
              {(aktivesUnternehmen.ziel || aktivesUnternehmen.beschreibung)?.slice(0, 120)}
              {((aktivesUnternehmen.ziel || aktivesUnternehmen.beschreibung) ?? '').length > 120 ? '…' : ''}
            </p>
          )}
          {/* Project directory indicator */}
          {(aktivesUnternehmen as any).workDir ? (
            <button
              onClick={async () => {
                await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/open-folder`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ path: (aktivesUnternehmen as any).workDir }),
                });
              }}
              title="Projektverzeichnis im Dateimanager öffnen"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                marginTop: '0.5rem', padding: '0.25rem 0.625rem',
                background: 'rgba(35,205,203,0.08)', border: '1px solid rgba(35,205,203,0.2)',
                borderRadius: '8px', cursor: 'pointer',
                fontSize: '0.7rem', color: '#23CDCB', fontFamily: 'monospace',
                maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              <FolderOpen size={11} />
              {(aktivesUnternehmen as any).workDir}
            </button>
          ) : (
            <button
              onClick={() => navigate('/settings')}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                marginTop: '0.5rem', padding: '0.25rem 0.625rem',
                background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
                borderRadius: '8px', cursor: 'pointer',
                fontSize: '0.7rem', color: '#f59e0b',
              }}
            >
              <FolderOpen size={11} />
              {lang === 'de' ? 'Projektverzeichnis einrichten →' : 'Set up project directory →'}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {pendingApprovals > 0 && (
            <button onClick={() => navigate('/approvals')} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.625rem 1rem', borderRadius: '12px',
              background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
              color: '#f59e0b', fontWeight: 700, fontSize: '0.8125rem', cursor: 'pointer',
            }}>
              <ShieldCheck size={15} />
              {pendingApprovals} {lang === 'de' ? 'offene Anfragen' : 'pending approvals'}
            </button>
          )}
          <button onClick={() => setStandupOpen(true)} style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.625rem 1rem', borderRadius: '12px',
            background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
            color: '#22c55e', fontWeight: 700, fontSize: '0.8125rem', cursor: 'pointer',
          }}>
            <Users size={15} />
            {lang === 'de' ? 'Standup' : 'Standup'}
          </button>
          <button onClick={() => setShowWizard(true)} style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.625rem 1rem', borderRadius: '12px',
            background: 'rgba(35,205,202,0.08)', border: '1px solid rgba(35,205,202,0.2)',
            color: '#23CDCB', fontWeight: 700, fontSize: '0.8125rem', cursor: 'pointer',
          }}>
            <Sparkles size={15} />
            {lang === 'de' ? 'CEO Setup' : 'CEO Setup'}
          </button>
          <button onClick={() => navigate('/war-room')} style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.625rem 1rem', borderRadius: '12px',
            background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)',
            color: '#a855f7', fontWeight: 700, fontSize: '0.8125rem', cursor: 'pointer',
          }}>
            <MonitorPlay size={15} />
            {lang === 'de' ? 'War Room' : 'War Room'}
          </button>
          <button onClick={() => navigate('/tasks')} style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.625rem 1rem', borderRadius: '12px',
            background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
            color: '#23CDCB', fontWeight: 700, fontSize: '0.8125rem', cursor: 'pointer',
          }}>
            <Plus size={15} />
            {lang === 'de' ? 'Neue Aufgabe' : 'New Task'}
          </button>
        </div>
      </div>

      {/* ── Command Bar ── */}
      {alleExperten.length > 0 && (
        <CommandBar agents={alleExperten} companyId={aktivesUnternehmen.id} lang={lang} />
      )}

      {/* ── Onboarding ── */}
      <GettingStartedCard
        companyId={aktivesUnternehmen.id}
        hasAgents={experten.gesamt > 0}
        hasCycle={alleExperten.some((e: any) => e.zyklusAktiv)}
        hasTasks={aufgaben.gesamt > 0}
        hasDoneTasks={aufgaben.erledigt > 0}
        lang={lang}
        navigate={navigate}
      />

      {/* ── Status Bento Grid ── */}
      {(() => {
        const de = lang === 'de';
        const todayEvents = letzteAktivitaet.filter(a => new Date(a.erstelltAm).toDateString() === new Date().toDateString()).length;

        // Time-aware greeting
        const hour = new Date().getHours();
        const greeting = de
          ? hour < 12 ? 'Guten Morgen' : hour < 18 ? 'Guten Nachmittag' : 'Guten Abend'
          : hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening';

        // Smart insight sentence
        let insight = '';
        if (kosten.prozent >= 90) {
          insight = de ? `⚠ Budget fast aufgebraucht (${kosten.prozent}%)` : `⚠ Budget nearly exhausted (${kosten.prozent}%)`;
        } else if (pendingApprovals > 0) {
          insight = de ? `${pendingApprovals} Genehmigung${pendingApprovals > 1 ? 'en' : ''} warten auf dich` : `${pendingApprovals} approval${pendingApprovals > 1 ? 's' : ''} waiting for you`;
        } else if (aufgaben.blockiert > 0) {
          insight = de ? `${aufgaben.blockiert} blockierte Aufgabe${aufgaben.blockiert > 1 ? 'n' : ''} — Eingriff empfohlen` : `${aufgaben.blockiert} blocked task${aufgaben.blockiert > 1 ? 's' : ''} — action recommended`;
        } else if (experten.running > 0) {
          insight = de ? `${experten.running} Agent${experten.running > 1 ? 'en' : ''} arbeite${experten.running > 1 ? 'n' : 't'} gerade` : `${experten.running} agent${experten.running > 1 ? 's' : ''} working right now`;
        } else if (aufgaben.erledigt > 0) {
          insight = de ? `${aufgaben.erledigt} Aufgaben erledigt — gute Arbeit!` : `${aufgaben.erledigt} tasks completed — great work!`;
        } else if (experten.gesamt === 0) {
          insight = de ? 'Starte mit dem CEO Setup um dein Team einzurichten' : 'Start with CEO Setup to configure your team';
        } else {
          insight = de ? 'System bereit — keine aktiven Aufgaben' : 'System ready — no active tasks';
        }

        const bentoItems: BentoItem[] = [
          // ── Status Overview (wide) ──
          {
            icon: <Building2 size={16} style={{ color: '#23CDCB' }} />,
            title: greeting,
            meta: new Date().toLocaleDateString(de ? 'de-DE' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' }),
            colSpan: 2,
            accent: '#23CDCB',
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Metrics row */}
                <div style={{ display: 'flex', gap: '0', flexWrap: 'wrap' }}>
                  {[
                    { label: de ? 'Agenten live' : 'Agents live',     value: experten.running,     color: experten.running > 0 ? '#23CDCB' : '#475569', pulse: experten.running > 0 },
                    { label: de ? 'Aufgaben offen' : 'Tasks open',     value: aufgaben.offen,       color: aufgaben.offen > 0 ? '#94a3b8' : '#334155',   pulse: false },
                    { label: de ? 'Budget genutzt' : 'Budget used',    value: `${kosten.prozent}%`, color: budgetColor,                                   pulse: false },
                    { label: de ? 'Ereignisse heute' : 'Events today', value: todayEvents,          color: todayEvents > 0 ? '#64748b' : '#334155',        pulse: false },
                  ].map((m, i, arr) => (
                    <div key={i} style={{
                      display: 'flex', flexDirection: 'column', gap: '0.25rem',
                      paddingRight: i < arr.length - 1 ? '1.75rem' : 0,
                      marginRight: i < arr.length - 1 ? '1.75rem' : 0,
                      borderRight: i < arr.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        {m.pulse && (
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#23CDCB', boxShadow: '0 0 6px #23CDCB', animation: 'pulse 2s ease-in-out infinite', flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: '1.75rem', fontWeight: 800, color: m.color, lineHeight: 1 }}>{m.value}</span>
                      </div>
                      <span style={{ fontSize: '0.6875rem', color: '#475569', fontWeight: 500 }}>{m.label}</span>
                    </div>
                  ))}
                </div>
                {/* Insight line */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.5rem 0.75rem', borderRadius: '8px',
                  background: pendingApprovals > 0 || aufgaben.blockiert > 0 || kosten.prozent >= 90
                    ? 'rgba(245,158,11,0.06)' : experten.running > 0
                    ? 'rgba(35,205,202,0.06)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${pendingApprovals > 0 || aufgaben.blockiert > 0 || kosten.prozent >= 90
                    ? 'rgba(245,158,11,0.15)' : experten.running > 0
                    ? 'rgba(35,205,202,0.12)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                  <span style={{
                    fontSize: '0.75rem', fontWeight: 500,
                    color: pendingApprovals > 0 || aufgaben.blockiert > 0 || kosten.prozent >= 90
                      ? '#f59e0b' : experten.running > 0 ? '#23CDCB' : '#475569',
                  }}>
                    {insight}
                  </span>
                </div>
              </div>
            ),
          },
          // ── Health Score ──
          {
            icon: <Gauge size={16} style={{ color: healthColor }} />,
            title: String(healthScore),
            meta: healthGrade,
            status: de ? 'Unternehmensgesundheit' : 'Company Health',
            statusColor: healthColor,
            colSpan: 1,
            accent: healthColor,
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.875rem' }}>
                {/* Gauge */}
                <div style={{ position: 'relative' }}>
                  <HealthScoreGauge score={healthScore} color={healthColor} size={96} />
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.1rem' }}>
                    <span style={{ fontSize: 22, fontWeight: 900, color: healthColor, lineHeight: 1 }}>{healthScore}</span>
                    <span style={{ fontSize: '0.5625rem', fontWeight: 700, color: healthColor, opacity: 0.7, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{healthGrade}</span>
                  </div>
                </div>
                {/* Factors */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', width: '100%' }}>
                  {healthFactors.length === 0 ? (
                    <div style={{ textAlign: 'center', fontSize: '0.6875rem', color: '#334155', fontStyle: 'italic' }}>
                      {de ? 'Keine Probleme erkannt' : 'No issues detected'}
                    </div>
                  ) : (
                    healthFactors.slice(0, 4).map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: f.color, flexShrink: 0 }} />
                        <span style={{ fontSize: '0.6875rem', color: f.color, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.delta < 0 ? `${f.delta} ` : ''}{f.label}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ),
          },
          // ── Agents ──
          {
            icon: <Users size={16} style={{ color: '#23CDCB' }} />,
            title: String(experten.aktiv),
            meta: de ? 'Agenten aktiv' : 'Agents active',
            description: de
              ? `${experten.gesamt} gesamt · ${experten.running} laufen gerade`
              : `${experten.gesamt} total · ${experten.running} running`,
            status: experten.running > 0 ? 'LIVE' : de ? 'Bereit' : 'Ready',
            statusColor: experten.running > 0 ? '#23CDCB' : '#475569',
            accent: '#23CDCB',
            cta: de ? 'Agenten →' : 'Agents →',
            hasPersistentHover: experten.running > 0,
            onClick: () => navigate('/experts'),
          },
          // ── Tasks ──
          {
            icon: <ListTodo size={16} style={{ color: '#3b82f6' }} />,
            title: String(aufgaben.offen),
            meta: de ? 'Aufgaben offen' : 'Tasks open',
            description: de
              ? `${aufgaben.inBearbeitung} aktiv · ${aufgaben.blockiert} blockiert · ${aufgaben.erledigt} erledigt`
              : `${aufgaben.inBearbeitung} active · ${aufgaben.blockiert} blocked · ${aufgaben.erledigt} done`,
            status: aufgaben.blockiert > 0 ? `${aufgaben.blockiert} blockiert` : 'OK',
            statusColor: aufgaben.blockiert > 0 ? '#ef4444' : '#22c55e',
            accent: '#3b82f6',
            cta: de ? 'Aufgaben →' : 'Tasks →',
            onClick: () => navigate('/tasks'),
          },
          // ── Budget ──
          {
            icon: <Wallet size={16} style={{ color: budgetColor }} />,
            title: euro(kosten.gesamtVerbraucht),
            meta: `${de ? 'von' : 'of'} ${euro(kosten.gesamtBudget)}`,
            description: de ? `${kosten.prozent}% des Budgets genutzt` : `${kosten.prozent}% of budget used`,
            status: kosten.prozent > 90 ? '⚠ Kritisch' : kosten.prozent > 75 ? (de ? 'Hoch' : 'High') : 'OK',
            statusColor: kosten.prozent > 90 ? '#ef4444' : kosten.prozent > 75 ? '#f59e0b' : '#22c55e',
            accent: budgetColor,
            cta: de ? 'Kosten →' : 'Costs →',
            onClick: () => navigate('/costs'),
            children: (
              <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: budgetColor,
                  width: `${Math.min(kosten.prozent, 100)}%`, transition: 'width 0.6s ease',
                }} />
              </div>
            ),
          },
          // ── Approvals ──
          {
            icon: <ShieldCheck size={16} style={{ color: pendingApprovals > 0 ? '#f59e0b' : '#22c55e' }} />,
            title: pendingApprovals > 0 ? String(pendingApprovals) : '✓',
            meta: de ? 'Genehmigungen' : 'Approvals',
            description: pendingApprovals > 0
              ? (de ? 'Anfragen warten auf deine Freigabe' : 'Requests waiting for your approval')
              : (de ? 'Keine ausstehenden Anfragen' : 'No pending requests'),
            status: pendingApprovals > 0 ? (de ? 'Aktion nötig' : 'Action needed') : (de ? 'Alles klar' : 'All clear'),
            statusColor: pendingApprovals > 0 ? '#f59e0b' : '#22c55e',
            accent: pendingApprovals > 0 ? '#f59e0b' : '#22c55e',
            hasPersistentHover: pendingApprovals > 0,
            cta: pendingApprovals > 0 ? (de ? 'Prüfen →' : 'Review →') : undefined,
            onClick: () => navigate('/approvals'),
          },
        ];

        return <BentoGrid items={bentoItems} columns={3} />;
      })()}

      {/* ── Mission Control ── */}
      <MissionControl
        initialAgents={alleExperten}
        unternehmenId={aktivesUnternehmen.id}
        lang={lang}
        onChat={(id) => {
          const exp = topExperten.find(e => e.id === id) ?? alleExperten.find(a => a.id === id);
          if (exp) setChatExpert(exp as any);
        }}
      />

      {/* ── Activity + Task Stats ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,0.8fr)', gap: '1rem' }}>

        {/* Recent Activity */}
        <Card style={{ padding: '1.5rem' }}>
          <SectionHeader
            title={t.dashboard.letzteAktivitaet}
            to="/activity"
            linkLabel={lang === 'de' ? 'Alle anzeigen' : 'View all'}
          />
          {letzteAktivitaet.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#475569' }}>
              <Activity size={32} style={{ opacity: 0.2, marginBottom: '0.75rem' }} />
              <p style={{ fontSize: '0.875rem', margin: 0 }}>
                {lang === 'de' ? 'Noch keine Aktivitäten' : 'No activity yet'}
              </p>
              <p style={{ fontSize: '0.75rem', marginTop: '0.375rem', color: '#334155' }}>
                {lang === 'de'
                  ? 'Agenten berichten hier nach ihrem ersten Arbeitszyklus'
                  : 'Agents report here after their first work cycle'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {letzteAktivitaet.slice(0, 8).map(a => (
                <ActivityItem key={a.id} item={a} lang={lang} />
              ))}
            </div>
          )}
        </Card>

        {/* Task Stats: Velocity + Breakdown */}
        <Card style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              {lang === 'de' ? 'Aufgaben' : 'Tasks'}
            </h2>
            <Link to="/tasks" style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              fontSize: '0.8125rem', color: '#64748b', textDecoration: 'none',
              padding: '0.375rem 0.75rem', borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.07)',
              transition: 'color 0.15s, border-color 0.15s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#23CDCB'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(35,205,202,0.3)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#64748b'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; }}
            >
              {lang === 'de' ? 'Alle anzeigen' : 'View all'} <ArrowRight size={12} />
            </Link>
          </div>

          {aufgaben.gesamt === 0 ? (
            <div style={{ textAlign: 'center', padding: '2.5rem 1rem', color: '#475569' }}>
              <ListTodo size={32} style={{ opacity: 0.2, marginBottom: '0.75rem' }} />
              <p style={{ fontSize: '0.875rem', margin: 0 }}>
                {lang === 'de' ? 'Noch keine Aufgaben' : 'No tasks yet'}
              </p>
              <button onClick={() => navigate('/tasks')} style={{
                marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: '10px',
                background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
                color: '#23CDCB', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600,
              }}>
                {lang === 'de' ? 'Erste Aufgabe anlegen' : 'Create first task'}
              </button>
            </div>
          ) : (
            <>
              {/* Status breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
                {[
                  { label: lang === 'de' ? 'Aktiv' : 'Active',      value: aufgaben.inBearbeitung,                  color: '#3b82f6' },
                  { label: lang === 'de' ? 'Offen' : 'Open',        value: aufgaben.offen - aufgaben.inBearbeitung, color: '#94a3b8' },
                  { label: lang === 'de' ? 'Blockiert' : 'Blocked', value: aufgaben.blockiert,                      color: '#ef4444' },
                  { label: lang === 'de' ? 'Erledigt' : 'Done',     value: aufgaben.erledigt,                       color: '#22c55e' },
                ].filter(s => s.value > 0).map(s => (
                  <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                    <span style={{ fontSize: '0.6875rem', color: '#475569', width: 56, flexShrink: 0 }}>{s.label}</span>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 2, background: s.color,
                        width: `${Math.round((s.value / aufgaben.gesamt) * 100)}%`,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: '0.6875rem', color: '#475569', width: 18, textAlign: 'right', flexShrink: 0 }}>{s.value}</span>
                  </div>
                ))}
              </div>

              {/* Velocity chart */}
              <div style={{ paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <VelocityChart completedPerDay={aufgaben.completedPerDay ?? []} lang={lang} />
              </div>
            </>
          )}
        </Card>
      </div>

      {/* ── Projects + Goals ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '1rem' }}>

        {/* Projects */}
        <Card style={{ padding: '1.5rem' }}>
          <SectionHeader
            title={lang === 'de' ? 'Aktive Projekte' : 'Active Projects'}
            to="/projects"
            linkLabel={lang === 'de' ? 'Alle anzeigen' : 'View all'}
          />
          <ProjectsWidget projects={topProjekte} lang={lang} />
        </Card>

        {/* Goals */}
        <Card style={{ padding: '1.5rem' }}>
          <SectionHeader
            title={(lang === 'de' ? 'Unternehmensziele' : 'Company Goals')}
            to="/goals"
            linkLabel={lang === 'de' ? 'Alle anzeigen' : 'View all'}
          />
          <GoalsWidget goals={aktiveZiele} lang={lang} />
        </Card>
      </div>

      {/* ── System Pulse (Live Trace) ── */}
      {letzteTrace.length > 0 && (
        <SystemPulse
          unternehmenId={aktivesUnternehmen.id}
          initialTrace={letzteTrace}
          lang={lang}
        />
      )}

      {/* ── Quick actions ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
        {[
          { icon: Plus,         label: lang === 'de' ? 'Neue Aufgabe'   : 'New Task',         to: '/tasks',        accent: '#23CDCB' },
          { icon: Users,        label: lang === 'de' ? 'Team verwalten' : 'Manage Team',       to: '/experts',      accent: '#6366f1' },
          { icon: ShieldCheck,  label: lang === 'de' ? 'Genehmigungen'  : 'Approvals',         to: '/approvals',    accent: '#f59e0b', badge: pendingApprovals > 0 ? pendingApprovals : undefined },
          { icon: Zap,          label: lang === 'de' ? 'Routinen'       : 'Routines',           to: '/routines',     accent: '#22c55e' },
          { icon: FolderOpen,   label: lang === 'de' ? 'Projekte'       : 'Projects',           to: '/projects',     accent: '#8b5cf6' },
          { icon: Brain,        label: lang === 'de' ? 'Intelligence'   : 'Intelligence',       to: '/intelligence', accent: '#a855f7' },
          { icon: MessageSquare,label: lang === 'de' ? 'Meetings'       : 'Meetings',           to: '/meetings',     accent: '#6366f1' },
          { icon: Clock,        label: lang === 'de' ? 'Aktivität'      : 'Activity',           to: '/activity',     accent: '#3b82f6' },
        ].map(item => (
          <QuickActionCard key={item.to} item={item} onClick={() => navigate(item.to)} />
        ))}
      </div>

      {/* ── Channels strip ── */}
      {channels && channels.length > 0 && (
        <Card style={{ padding: '1rem 1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginRight: '0.5rem' }}>
              <Radio size={14} style={{ color: '#475569' }} />
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', letterSpacing: '0.05em' }}>
                CHANNELS
              </span>
            </div>
            {channels.map(ch => (
              <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{
                  width: 7, height: 7, borderRadius: '50%',
                  background: ch.status.connected ? '#22c55e' : '#ef4444',
                  boxShadow: `0 0 5px ${ch.status.connected ? '#22c55e80' : '#ef444480'}`,
                }} />
                <span style={{ fontSize: '0.75rem', color: ch.status.connected ? '#94a3b8' : '#475569', fontWeight: 500 }}>
                  {ch.icon} {ch.name}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Chat / Edit Drawer ── */}
      {(chatExpert || editExpert) && (
        <ExpertChatDrawer
          expert={(chatExpert || editExpert)!}
          initialTab={editExpert && !chatExpert ? 'einstellungen' : 'überblick'}
          onClose={() => { setChatExpert(null); setEditExpert(null); }}
          onUpdated={() => {}}
        />
      )}
      <StandupPanel open={standupOpen} onClose={() => setStandupOpen(false)} />
    </div>
  );
}
