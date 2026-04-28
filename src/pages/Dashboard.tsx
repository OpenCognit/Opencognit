import { useState, useEffect, useRef } from 'react';
import {
  Users, ListTodo, ArrowRight, ShieldCheck,
  Loader2, Plus, MessageSquare, Zap, ZapOff, CheckCircle2,
  AlertCircle, Clock, Radio, Activity, Building2,
  Target, FolderOpen, Cpu, TrendingUp, TrendingDown, Minus,
  Brain, ChevronRight, MonitorPlay, Sparkles, RefreshCw,
  Bot, PlayCircle, BookOpen, X as XIcon, ChevronDown, ChevronUp, Key, Crown, Pause, Play,
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
import { translateTrace } from '../utils/translateTrace';
import { translateActivity } from '../utils/activityTranslator';
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
  running:    { color: '#c5a059', bg: 'rgba(197,160,89,0.12)',  label: { de: 'Arbeitet', en: 'Working' } },
  active:     { color: '#22c55e', bg: 'rgba(34,197,94,0.12)',   label: { de: 'Aktiv',    en: 'Active'  } },
  idle:       { color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', label: { de: 'Bereit',   en: 'Idle'    } },
  paused:     { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  label: { de: 'Pausiert', en: 'Paused'  } },
  error:      { color: '#ef4444', bg: 'rgba(239,68,68,0.12)',   label: { de: 'Fehler',   en: 'Error'   } },
  terminated: { color: '#6b7280', bg: 'rgba(107,114,128,0.10)', label: { de: 'Beendet',  en: 'Off'     } },
};

const TRACE_CFG: Record<string, { color: string; bg: string; label: string }> = {
  thinking: { color: '#9b87c8', bg: 'rgba(155,135,200,0.08)', label: '💭 Think' },
  action:   { color: '#c5a059', bg: 'rgba(197,160,89,0.08)',  label: '⚡ Act'   },
  result:   { color: '#22c55e', bg: 'rgba(34,197,94,0.08)',   label: '✓ Result' },
  error:    { color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   label: '✗ Error'  },
  warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)',  label: '⚠ Warn'   },
  info:     { color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', label: 'ℹ Info'   },
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
        credentials: 'include',
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
      background: 'rgba(197,160,89,0.03)',
      // backdropFilter removed
      borderRadius: 0,
      border: '1px solid rgba(197,160,89,0.1)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: briefing ? '0.75rem' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: 28, height: 28, borderRadius: 0,
            background: 'rgba(197,160,89,0.12)', border: '1px solid rgba(197,160,89,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Sparkles size={14} style={{ color: '#c5a059' }} />
          </div>
          <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#d4d4d8' }}>
            {de ? 'CEO Tagesbriefing' : 'CEO Daily Briefing'}
          </span>
          {source === 'ai' && (
            <span style={{
              padding: '0.1rem 0.5rem', borderRadius: '9999px', fontSize: '0.5625rem',
              fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
              background: 'rgba(197,160,89,0.1)', color: '#c5a059',
              border: '1px solid rgba(197,160,89,0.2)',
            }}>AI</span>
          )}
        </div>
        <button
          onClick={generate}
          disabled={loading}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.375rem 0.875rem', borderRadius: 0, cursor: loading ? 'wait' : 'pointer',
            background: 'rgba(197,160,89,0.08)', border: '1px solid rgba(197,160,89,0.2)',
            color: '#c5a059', fontSize: '0.75rem', fontWeight: 600,
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
            <span style={{ display: 'inline-block', width: 2, height: '1em', background: '#c5a059', animation: 'blink 1s step-end infinite', verticalAlign: 'text-bottom', marginLeft: 2 }} />
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
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c5a059' }}>{total}</span>
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="velocity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c5a059" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#c5a059" stopOpacity="0.02" />
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
        <path d={pathD} fill="none" stroke="#c5a059" strokeWidth={1.5} strokeLinejoin="round" />
        {/* Today dot */}
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].x}
            cy={points[points.length - 1].y}
            r={3}
            fill="#c5a059"
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

function Card({ children, style = {}, accent = '#c5a059', onClick }: {
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
        // backdropFilter removed
        borderRadius: 0,
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
        position: 'absolute', inset: 0, borderRadius: 0, pointerEvents: 'none',
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
        padding: '0.375rem 0.75rem', borderRadius: 0,
        border: '1px solid rgba(255,255,255,0.07)',
        transition: 'color 0.15s, border-color 0.15s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c5a059'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(197,160,89,0.3)'; }}
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
            width: 36, height: 36, borderRadius: 0,
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
        <div style={{ marginTop: '0.875rem', height: 4, borderRadius: 0, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 0, transition: 'width 0.6s ease',
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
        padding: '0.75rem 0.875rem', borderRadius: 0,
        cursor: 'pointer', transition: 'background 0.15s',
      }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: 0, flexShrink: 0,
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
        padding: '0.25rem 0.625rem', borderRadius: 0,
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
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(197,160,89,0.2)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(197,160,89,0.07)')}
        style={{
          width: 28, height: 28, borderRadius: 0, flexShrink: 0,
          background: 'rgba(197,160,89,0.07)', border: 'none',
          color: '#c5a059', cursor: 'pointer',
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
    item.entitaetTyp === 'experte'     ? '#c5a059' : '#475569';

  const actionText = translateActivity(item.aktion, lang);

  return (
    <div style={{ display: 'flex', gap: '0.875rem', alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: 0, flexShrink: 0, marginTop: 1,
        background: dotColor + '15', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.8125rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
          <strong style={{ color: '#f1f5f9', fontWeight: 600 }}>{item.akteurName}</strong>
          {' '}{actionText}
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
        marginTop: '0.75rem', padding: '0.375rem 0.875rem', borderRadius: 0,
        background: 'rgba(197,160,89,0.08)', border: '1px solid rgba(197,160,89,0.2)',
        color: '#c5a059', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
      }}>
        {lang === 'de' ? 'Projekt anlegen' : 'Create project'}
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {projects.map((p: any) => (
        <div key={p.id} onClick={() => navigate('/projects')} style={{
          padding: '0.75rem 0.875rem', borderRadius: 0,
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${p.farbe || '#c5a059'}40`; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.05)'; }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.farbe || '#c5a059', flexShrink: 0 }} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                {p.name}
              </span>
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: p.fortschritt >= 80 ? '#22c55e' : p.fortschritt >= 40 ? '#c5a059' : '#94a3b8' }}>
              {p.fortschritt}%
            </span>
          </div>
          <div style={{ height: 4, borderRadius: 0, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 0, transition: 'width 0.6s ease',
              width: `${p.fortschritt}%`,
              background: p.fortschritt >= 80 ? '#22c55e' : p.fortschritt >= 40 ? p.farbe || '#c5a059' : '#475569',
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
        marginTop: '0.75rem', padding: '0.375rem 0.875rem', borderRadius: 0,
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
    achieved: '#c5a059',
    cancelled:'#475569',
  };

  function progressColor(pct: number): string {
    if (pct >= 100) return '#c5a059';
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
            padding: '0.625rem 0.875rem', borderRadius: 0,
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
              <div style={{ height: 3, borderRadius: 0, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 0, background: pColor,
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
  thinking:       { color: '#9b87c8', bg: 'rgba(155,135,200,0.07)', symbol: '💭' },
  action:         { color: '#c5a059', bg: 'rgba(197,160,89,0.07)', symbol: '⚡' },
  result:         { color: '#22c55e', bg: 'rgba(34,197,94,0.07)',  symbol: '✓'  },
  error:          { color: '#ef4444', bg: 'rgba(239,68,68,0.07)',  symbol: '✗'  },
  warning:        { color: '#f59e0b', bg: 'rgba(245,158,11,0.07)', symbol: '⚠'  },
  task_started:   { color: '#c5a059', bg: 'rgba(197,160,89,0.05)', symbol: '▶'  },
  task_completed: { color: '#22c55e', bg: 'rgba(34,197,94,0.05)',  symbol: '✔'  },
  info:           { color: '#475569', bg: 'rgba(71,85,105,0.06)',  symbol: '·'  },
};

function SystemPulse({ unternehmenId, lang }: { unternehmenId: string; lang: string }) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Subscribe to real-time WS updates ONLY — no historical data
  useEffect(() => {
    if (!unternehmenId) return;
    let destroyed = false;
    const tok = localStorage.getItem('opencognit_token') || '';
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}/ws${tok ? `?token=${tok}` : ''}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => { if (!destroyed) setConnected(true); };
    ws.onclose = () => { if (!destroyed) setConnected(false); };
    ws.onerror = () => { if (!destroyed) setConnected(false); };

    ws.onmessage = ev => {
      if (destroyed) return;
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
    return () => {
      destroyed = true;
      // Avoid "closed before connection established" warning in StrictMode
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [unternehmenId, lang]);

  return (
    <Card style={{ padding: '1.25rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: connected ? '#c5a059' : '#475569',
          boxShadow: connected ? '0 0 8px #c5a05980' : 'none',
          animation: connected ? 'pulse 2s ease-in-out infinite' : 'none',
        }} />
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: connected ? '#c5a059' : '#475569', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {lang === 'de' ? 'Live-Aktivität' : 'Live Activity'}
        </span>
        {events.length > 0 && (
          <span style={{
            padding: '0.1rem 0.4rem', borderRadius: 0,
            background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.2)',
            fontSize: '0.625rem', fontWeight: 700, color: '#c5a059',
          }}>
            {events.length}
          </span>
        )}
        <span style={{ fontSize: '0.6875rem', color: '#334155', marginLeft: 'auto' }}>
          {connected
            ? (lang === 'de' ? 'Verbunden — warte auf Events' : 'Connected — waiting for events')
            : (lang === 'de' ? 'Verbinde…' : 'Connecting…')
          }
        </span>
      </div>

      {events.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '2rem 1rem',
          color: '#334155', fontSize: '0.8125rem',
        }}>
          <Radio size={24} style={{ opacity: 0.2, marginBottom: '0.5rem', display: 'block', margin: '0 auto 0.5rem' }} />
          {lang === 'de'
            ? 'Noch keine Live-Events. Aktivitäten erscheinen hier, sobald Agenten arbeiten.'
            : 'No live events yet. Activity will appear here once agents start working.'
          }
        </div>
      ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        {events.map(ev => {
          const cfg = PULSE_CFG[ev.typ] ?? PULSE_CFG.info;
          const isTask = ev.typ === 'task_started' || ev.typ === 'task_completed';
          return (
            <div key={ev.id} style={{
              display: 'flex', alignItems: 'center', gap: '0.625rem',
              padding: '0.4rem 0.75rem', borderRadius: 0,
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
                  {translateTrace(ev.titel, lang)}
                </span>
              </div>
              <span style={{ fontSize: '0.625rem', color: '#334155', flexShrink: 0 }}>
                {reltime(ev.erstelltAm, lang)}
              </span>
            </div>
          );
        })}
      </div>
      )}
    </Card>
  );
}

// ── Company Health Score ──────────────────────────────────────────────────────

function computeHealthScore(
  experten: { gesamt: number; aktiv: number; running: number; error: number },
  aufgaben: { gesamt: number; erledigt: number; fehlgeschlagen?: number; blockiert: number; inBearbeitung: number },
  kosten: { prozent: number },
  pendingApprovals: number,
  zyklen?: { total: number; succeeded: number; failed: number },
  recentActivityCount?: number,
  lang = 'en',
): { score: number; grade: string; gradeColor: string; factors: Array<{ label: string; delta: number; color: string }> } {
  const de = lang === 'de';
  let score = 60; // base — agents must earn the rest
  const factors: Array<{ label: string; delta: number; color: string }> = [];

  // ── Bonuses (up to +40) ──────────────────────────────────────────────────

  // Task success rate (max +20)
  const erledigt = aufgaben.erledigt || 0;
  const fehlgeschlagen = aufgaben.fehlgeschlagen || 0;
  const taskTotal = erledigt + fehlgeschlagen;
  if (taskTotal > 0) {
    const rate = erledigt / taskTotal;
    const bonus = Math.round(rate * 20);
    score += bonus;
    const pct = Math.round(rate * 100);
    factors.push({
      label: de ? `Task-Erfolgsrate ${pct}%` : `Task success rate ${pct}%`,
      delta: bonus,
      color: rate >= 0.8 ? '#22c55e' : rate >= 0.5 ? '#f59e0b' : '#ef4444',
    });
  } else if (erledigt > 0) {
    // Only completed tasks, zero failures — full bonus
    score += 20;
    factors.push({ label: de ? `${erledigt} Tasks erledigt` : `${erledigt} tasks completed`, delta: 20, color: '#22c55e' });
  }

  // Cycle reliability (max +15)
  if (zyklen && zyklen.total > 0) {
    const cycleRate = zyklen.succeeded / zyklen.total;
    const bonus = Math.round(cycleRate * 15);
    score += bonus;
    const pct = Math.round(cycleRate * 100);
    factors.push({
      label: de ? `Zyklen-Zuverlässigkeit ${pct}%` : `Cycle reliability ${pct}%`,
      delta: bonus,
      color: cycleRate >= 0.8 ? '#22c55e' : cycleRate >= 0.5 ? '#f59e0b' : '#ef4444',
    });
  }

  // Recent activity bonus (max +5)
  if (recentActivityCount && recentActivityCount > 0) {
    score += 5;
    factors.push({
      label: de ? `${recentActivityCount} Agenten heute aktiv` : `${recentActivityCount} agents active today`,
      delta: 5,
      color: '#22c55e',
    });
  } else if (experten.running > 0) {
    score += 5;
    factors.push({
      label: de ? `${experten.running} Agenten laufen gerade` : `${experten.running} agents running now`,
      delta: 5,
      color: '#c5a059',
    });
  }

  // ── Penalties ────────────────────────────────────────────────────────────

  // Budget (max -30)
  if (kosten.prozent >= 100) {
    score -= 30; factors.push({ label: de ? 'Budget überschritten' : 'Budget exceeded', delta: -30, color: '#ef4444' });
  } else if (kosten.prozent >= 90) {
    score -= 20; factors.push({ label: de ? 'Budget kritisch' : 'Budget critical', delta: -20, color: '#ef4444' });
  } else if (kosten.prozent >= 75) {
    score -= 10; factors.push({ label: de ? 'Budget knapp' : 'Budget low', delta: -10, color: '#f59e0b' });
  }

  // Agent errors (max -20)
  const errPenalty = Math.min(experten.error * 5, 20);
  if (errPenalty > 0) {
    score -= errPenalty;
    factors.push({ label: de ? `${experten.error} Agenten fehlerhaft` : `${experten.error} agents in error`, delta: -errPenalty, color: '#ef4444' });
  }

  // Failed tasks penalty (max -10) — separate from success rate
  if (fehlgeschlagen > 0 && taskTotal === 0) {
    // Only failures, zero success
    const pen = Math.min(fehlgeschlagen * 3, 10);
    score -= pen;
    factors.push({ label: de ? `${fehlgeschlagen} Tasks fehlgeschlagen` : `${fehlgeschlagen} tasks failed`, delta: -pen, color: '#ef4444' });
  }

  // Blocked tasks (max -15)
  const blockPenalty = Math.min(aufgaben.blockiert * 5, 15);
  if (blockPenalty > 0) {
    score -= blockPenalty;
    factors.push({ label: de ? `${aufgaben.blockiert} Tasks blockiert` : `${aufgaben.blockiert} tasks blocked`, delta: -blockPenalty, color: '#f59e0b' });
  }

  // Pending approvals (-5)
  if (pendingApprovals > 0) {
    score -= 5;
    factors.push({ label: de ? `${pendingApprovals} Genehmigungen offen` : `${pendingApprovals} approvals pending`, delta: -5, color: '#f59e0b' });
  }

  score = Math.max(0, Math.min(100, score));
  const grade = score >= 90
    ? (de ? 'Exzellent' : 'Excellent')
    : score >= 70
    ? (de ? 'Gut' : 'Good')
    : score >= 50
    ? (de ? 'Mittel' : 'Fair')
    : (de ? 'Kritisch' : 'Critical');
  const gradeColor = score >= 90 ? '#22c55e' : score >= 70 ? '#c5a059' : score >= 50 ? '#f59e0b' : '#ef4444';

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

function HealthScoreCard({ experten, aufgaben, kosten, pendingApprovals, zyklen, recentActivityCount, lang }: {
  experten: { gesamt: number; aktiv: number; running: number; error: number };
  aufgaben: { gesamt: number; erledigt: number; fehlgeschlagen?: number; blockiert: number; inBearbeitung: number };
  kosten: { prozent: number };
  pendingApprovals: number;
  zyklen?: { total: number; succeeded: number; failed: number };
  recentActivityCount?: number;
  lang: string;
}) {
  const de = lang === 'de';
  const { score, grade, gradeColor, factors } = computeHealthScore(experten, aufgaben, kosten, pendingApprovals, zyklen, recentActivityCount, lang);
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
                fontSize: '0.6875rem', padding: '0.15rem 0.5rem', borderRadius: 0,
                background: `${f.color}18`, border: `1px solid ${f.color}30`, color: f.color,
              }}>
                {f.delta < 0 ? `${f.delta}` : '+'} {f.label}
              </span>
            ))}
            {factors.length > 3 && (
              <button onClick={() => setExpanded(e => !e)} style={{
                fontSize: '0.6875rem', padding: '0.15rem 0.5rem', borderRadius: 0,
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
                  fontSize: '0.6875rem', padding: '0.15rem 0.5rem', borderRadius: 0,
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
    insight = { color: '#c5a059', text: de
      ? `${experten.running} Agent${experten.running > 1 ? 'en' : ''} arbeitet gerade`
      : `${experten.running} agent${experten.running > 1 ? 's' : ''} working right now` };
  } else if (aufgaben.erledigt > 0) {
    insight = { color: '#22c55e', text: de
      ? `${aufgaben.erledigt} Aufgaben erledigt gesamt`
      : `${aufgaben.erledigt} tasks completed total` };
  }

  const metrics: { label: string; value: string | number; color: string }[] = [
    { label: de ? 'Heute aktiv' : 'Events today',    value: todayEvents.length, color: '#c5a059' },
    { label: de ? 'Laufende Agenten' : 'Running',     value: experten.running,   color: '#22c55e' },
    { label: de ? 'Offene Aufgaben' : 'Open tasks',  value: aufgaben.offen,     color: '#94a3b8' },
    { label: de ? 'Budget genutzt' : 'Budget used',  value: `${kosten.prozent}%`, color: kosten.prozent > 80 ? '#ef4444' : '#22c55e' },
  ];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap',
      padding: '0.875rem 1.5rem', borderRadius: 0,
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
      // backdropFilter removed
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
            padding: '0.3rem 0.75rem', borderRadius: 0,
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
  traceEvents: { typ: string; titel: string }[];
  isOrchestrator?: boolean;
  principles?: string[];
}

function AgentMissionCard({
  agent, lang, onChat, onWakeup, waking, onPause, pausing,
}: {
  agent: LiveAgent; lang: string;
  onChat: (id: string) => void;
  onWakeup: (id: string) => void;
  waking: boolean;
  onPause: (id: string, isPaused: boolean) => void;
  pausing: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const isRunning = agent.status === 'running';
  const isError   = agent.status === 'error';
  const isCEO     = agent.isOrchestrator === true;
  const isPaused = agent.status === 'paused';
  const isReady = agent.status === 'active' || agent.status === 'idle';
  const statusColor = isRunning ? '#c5a059' : isError ? '#ef4444' : isPaused ? '#eab308' : isReady ? '#22c55e' : '#475569';
  const statusLabel = isRunning ? (lang === 'de' ? 'Arbeitet' : 'Working') : isError ? (lang === 'de' ? 'Fehler' : 'Error') : isPaused ? (lang === 'de' ? 'Pausiert' : 'Paused') : (lang === 'de' ? 'Bereit' : 'Ready');
  const traceEvents = agent.traceEvents || [];
  const traceCfg = agent.lastTrace ? (TRACE_CFG[agent.lastTrace.typ] || TRACE_CFG.info) : null;

  const borderColor = isCEO
    ? (hovered ? 'rgba(255,215,0,0.5)' : 'rgba(255,215,0,0.25)')
    : isRunning ? 'rgba(197,160,89,0.35)'
    : isError ? 'rgba(239,68,68,0.25)'
    : hovered ? `${agent.avatarFarbe}30` : 'rgba(255,255,255,0.07)';

  const shadowStyle = isCEO
    ? (hovered ? 'inset 0 1px 0 rgba(255,255,255,0.12), 0 8px 32px rgba(255,215,0,0.12)' : 'inset 0 1px 0 rgba(255,255,255,0.06), 0 0 16px rgba(255,215,0,0.04)')
    : isRunning ? 'inset 0 1px 0 rgba(255,255,255,0.12), 0 0 32px rgba(197,160,89,0.08), 0 6px 24px rgba(0,0,0,0.25)'
    : hovered ? 'inset 0 1px 0 rgba(255,255,255,0.15), 0 8px 32px rgba(0,0,0,0.3)'
    : 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.15)';

  const hasTask = !!agent.currentTask;
  const hasPrinciples = agent.principles && agent.principles.length > 0;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative', overflow: 'hidden',
        borderRadius: 0, padding: '1.25rem',
        background: hovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.035)',
        border: `1px solid ${borderColor}`,
        // backdropFilter removed
        boxShadow: shadowStyle,
        transform: hovered ? 'translateY(-3px)' : 'none',
        transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)',
        cursor: 'pointer',
      }}
    >
      {/* CEO gold left bar */}
      {isCEO && (
        <div style={{
          position: 'absolute', top: 0, left: 0, width: 3, height: '100%',
          background: 'linear-gradient(to bottom, #FFD700, #FFA500)',
        }} />
      )}

      {/* Running pulse ring */}
      {isRunning && (
        <div style={{
          position: 'absolute', inset: -1, borderRadius: 0,
          border: '1px solid rgba(197,160,89,0.35)',
          animation: 'aura 3s ease-in-out infinite', pointerEvents: 'none',
        }} />
      )}

      {/* ── HEADER ── */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: '0.875rem', marginBottom: '0.875rem' }}>
        {/* Avatar */}
        <div style={{
          width: 44, height: 44, borderRadius: 0, flexShrink: 0,
          background: isCEO ? 'rgba(255,215,0,0.08)' : `${agent.avatarFarbe}18`,
          border: `1px solid ${isCEO ? 'rgba(255,215,0,0.25)' : `${agent.avatarFarbe}35`}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem', fontWeight: 700,
          color: isCEO ? '#FFD700' : agent.avatarFarbe,
          boxShadow: isRunning ? `0 0 12px ${agent.avatarFarbe}25` : isCEO ? '0 0 12px rgba(255,215,0,0.1)' : 'none',
          position: 'relative',
        }}>
          {agent.avatar || agent.name.slice(0, 2).toUpperCase()}
          <div style={{
            position: 'absolute', bottom: -2, right: -2,
            width: 10, height: 10, borderRadius: '50%',
            background: statusColor, border: '2px solid rgba(4,4,10,0.95)',
            boxShadow: isRunning ? `0 0 6px ${statusColor}` : 'none',
            animation: isRunning ? 'pulse 2s ease-in-out infinite' : 'none',
          }} />
        </div>

        {/* Name + Role + Status */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.125rem' }}>
            <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {agent.name}
            </span>
            {isCEO && (
              <Crown size={12} color="#FFD700" style={{ flexShrink: 0, opacity: 0.9 }} />
            )}
          </div>
          <div style={{ fontSize: '0.8125rem', color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: '0.375rem' }}>
            {agent.titel || agent.rolle}
          </div>
          {/* Status badge — compact pill */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.15rem 0.5rem', borderRadius: 0,
            background: `${statusColor}12`, border: `1px solid ${statusColor}28`,
          }}>
            {isRunning
              ? <Loader2 size={8} style={{ color: statusColor, animation: 'spin 1s linear infinite' }} />
              : <div style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor }} />
            }
            <span style={{ fontSize: '0.5625rem', fontWeight: 700, color: statusColor, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              {statusLabel}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flexShrink: 0 }}>
          <ActionBtn
            icon={<MessageSquare size={13} />}
            label={lang === 'de' ? 'Chat' : 'Chat'}
            color="#c5a059"
            onClick={(e) => { e.stopPropagation(); onChat(agent.id); }}
          />
          <ActionBtn
            icon={pausing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : agent.status === 'paused' ? <Play size={13} /> : <Pause size={13} />}
            label={agent.status === 'paused' ? (lang === 'de' ? 'Start' : 'Start') : (lang === 'de' ? 'Pause' : 'Pause')}
            color={agent.status === 'paused' ? '#22c55e' : '#eab308'}
            onClick={(e) => { e.stopPropagation(); onPause(agent.id, agent.status === 'paused'); }}
            disabled={pausing}
          />
          <ActionBtn
            icon={waking ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Radio size={13} />}
            label={lang === 'de' ? 'Run' : 'Run'}
            color="#22c55e"
            onClick={(e) => { e.stopPropagation(); onWakeup(agent.id); }}
            disabled={waking}
          />
        </div>
      </div>

      {/* ── PRINCIPLES ── compact horizontal chips */}
      {hasPrinciples && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.75rem' }}>
          {agent.principles!.slice(0, 3).map((p, i) => (
            <span key={i} style={{
              padding: '0.15rem 0.5rem', borderRadius: 0,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              fontSize: '0.625rem', color: '#52525b',
              whiteSpace: 'nowrap',
            }}>
              {p.replace(/^[-•*\d]+\.?\s*/, '').slice(0, 40)}{p.length > 40 ? '…' : ''}
            </span>
          ))}
          {agent.principles!.length > 3 && (
            <span style={{ fontSize: '0.625rem', color: '#3f3f46', padding: '0.15rem 0' }}>
              +{agent.principles!.length - 3}
            </span>
          )}
        </div>
      )}

      {/* ── TASK ── */}
      <div style={{
        padding: '0.5rem 0.625rem', borderRadius: 0,
        background: isRunning ? 'rgba(197,160,89,0.06)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${isRunning ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)'}`,
        marginBottom: '0.625rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: hasTask ? '0.375rem' : 0 }}>
          {isRunning
            ? <Loader2 size={10} style={{ color: '#c5a059', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            : <div style={{ width: 5, height: 5, borderRadius: '50%', background: hasTask ? '#22c55e' : '#334155', flexShrink: 0 }} />
          }
          <span style={{ fontSize: '0.8125rem', color: hasTask ? '#e2e8f0' : '#52525b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: hasTask ? 500 : 400 }}>
            {hasTask ? agent.currentTask!.titel : (lang === 'de' ? 'Keine aktive Aufgabe' : 'No active task')}
          </span>
          {hasTask && agent.currentTask!.status && (
            <span style={{
              fontSize: '0.5625rem', fontWeight: 700, color: '#52525b',
              textTransform: 'uppercase', letterSpacing: '0.04em',
              padding: '0.1rem 0.35rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
              flexShrink: 0,
            }}>
              {agent.currentTask!.status}
            </span>
          )}
        </div>
        {/* Simulated task progress bar (placeholder — could be wired to real data) */}
        {hasTask && (
          <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 0, overflow: 'hidden', marginTop: '0.25rem' }}>
            <div style={{
              height: '100%', borderRadius: 0,
              width: isRunning ? '60%' : '100%',
              background: isRunning ? '#c5a059' : '#22c55e',
              transition: 'width 0.6s ease',
              animation: isRunning ? 'shimmer 2s ease-in-out infinite' : 'none',
            }} />
          </div>
        )}
      </div>

      {/* ── LIVE TRACE ── */}
      {traceEvents.length > 0 && (
        <div style={{ marginBottom: '0.625rem' }}>
          {/* Latest trace + toggle */}
          <div
            onClick={(e) => { e.stopPropagation(); setShowTrace(v => !v); }}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              cursor: 'pointer', padding: '0.25rem 0.375rem',
              borderRadius: 0, background: showTrace ? 'rgba(197,160,89,0.06)' : 'transparent',
              border: `1px solid ${showTrace ? 'rgba(197,160,89,0.15)' : 'transparent'}`,
              transition: 'all 0.15s',
            }}
          >
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: isRunning ? '#c5a059' : '#52525b',
              animation: isRunning ? 'pulse 2s ease-in-out infinite' : 'none',
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: '0.6875rem', fontWeight: 600, color: isRunning ? '#c5a059' : '#71717a',
              letterSpacing: '0.03em', textTransform: 'uppercase', flexShrink: 0,
            }}>
              {lang === 'de' ? 'Live' : 'Live'}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#52525b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {agent.lastTrace?.titel}
            </span>
            <span style={{ fontSize: '0.6875rem', color: '#3f3f46', flexShrink: 0 }}>
              {showTrace ? '▲' : '▼'} {traceEvents.length}
            </span>
          </div>

          {/* Expanded trace list */}
          {showTrace && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: '0.25rem',
              marginTop: '0.375rem', padding: '0.5rem 0.625rem',
              background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)',
              maxHeight: '160px', overflow: 'auto',
            }}>
              {traceEvents.map((ev, i) => {
                const cfg = TRACE_CFG[ev.typ] || TRACE_CFG.info;
                return (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '0.375rem',
                    fontSize: '0.6875rem', lineHeight: 1.4,
                  }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: '50%', background: cfg.color, flexShrink: 0,
                    }} />
                    <span style={{ color: '#71717a', flexShrink: 0, fontWeight: 600, minWidth: '3.5rem' }}>
                      {cfg.label}
                    </span>
                    <span style={{ color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.titel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── FOOTER ── compact meta row */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: '0.625rem',
        borderTop: '1px solid rgba(255,255,255,0.05)',
        fontSize: '0.6875rem', color: '#52525b',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Budget */}
          {agent.budgetPct > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span style={{
                color: agent.budgetPct > 90 ? '#ef4444' : agent.budgetPct > 70 ? '#eab308' : '#71717a',
                fontWeight: 600,
              }}>{agent.budgetPct}%</span>
              <span>Budget</span>
            </span>
          )}
          {/* Last cycle */}
          {agent.letzterZyklus && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <Clock size={9} />
              {reltime(agent.letzterZyklus, lang)}
            </span>
          )}
        </div>
        {/* Auto-cycle indicator */}
        <span style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem',
          color: agent.zyklusAktiv ? '#c5a059' : '#3f3f46',
        }}>
          {agent.zyklusAktiv ? <Zap size={10} /> : <ZapOff size={10} />}
          {agent.zyklusAktiv
            ? (lang === 'de' ? 'Auto' : 'Auto')
            : (lang === 'de' ? 'Manuell' : 'Manual')
          }
        </span>
      </div>
    </div>
  );
}

// Compact action button helper
function ActionBtn({ icon, label, color, onClick, disabled }: {
  icon: React.ReactNode; label: string; color: string;
  onClick: (e: React.MouseEvent) => void; disabled?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.25rem',
        padding: '0.2rem 0.5rem', borderRadius: 0,
        background: hovered ? `${color}12` : 'transparent',
        border: `1px solid ${hovered ? `${color}30` : 'rgba(255,255,255,0.06)'}`,
        color: hovered ? color : '#52525b',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: '0.625rem', fontWeight: 600,
        transition: 'all 0.15s',
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
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
  const [pausing, setPausing] = useState<Set<string>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);

  // Sync when parent reloads — ensure traceEvents array exists
  useEffect(() => {
    setAgents(initialAgents.map(a => ({ ...a, traceEvents: a.traceEvents || [] })));
  }, [initialAgents]);

  // Live WS updates for agent status changes
  useEffect(() => {
    if (!unternehmenId) return;
    let destroyed = false; // StrictMode guard: prevents errors when React unmounts during WS handshake
    const token = localStorage.getItem('opencognit_token');
    const _proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${_proto}//${window.location.host}/ws${token ? `?token=${token}` : ''}`);
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
          setAgents(prev => prev.map(a => {
            if (a.id !== msg.data.expertId) return a;
            const ev = { typ: msg.data.typ, titel: msg.data.titel };
            return {
              ...a,
              lastTrace: ev,
              status: 'running',
              traceEvents: [ev, ...(a.traceEvents || [])].slice(0, 8),
            };
          }));
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
      // Avoid "closed before connection established" warning in StrictMode
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [unternehmenId]);

  const handleWakeup = async (agentId: string) => {
    setWaking(prev => new Set(prev).add(agentId));
    const token = localStorage.getItem('opencognit_token');
    await fetch(`/api/experten/${agentId}/wakeup`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
    setTimeout(() => {
      setWaking(prev => { const s = new Set(prev); s.delete(agentId); return s; });
    }, 2000);
  };

  const handlePause = async (agentId: string, isPaused: boolean) => {
    setPausing(prev => new Set(prev).add(agentId));
    const token = localStorage.getItem('opencognit_token');
    const endpoint = isPaused ? `/api/mitarbeiter/${agentId}/fortsetzen` : `/api/mitarbeiter/${agentId}/pausieren`;
    await fetch(endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {});
    setAgents(prev => prev.map(a =>
      a.id === agentId ? { ...a, status: isPaused ? 'idle' : 'paused' } : a
    ));
    setTimeout(() => {
      setPausing(prev => { const s = new Set(prev); s.delete(agentId); return s; });
    }, 1000);
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
              background: runningCount > 0 ? '#c5a059' : '#475569',
              boxShadow: runningCount > 0 ? '0 0 8px #c5a05980' : 'none',
              animation: runningCount > 0 ? 'pulse 2s ease-in-out infinite' : 'none',
            }} />
          </div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#f8fafc', margin: 0 }}>
            {lang === 'de' ? 'Mein Team' : 'My Team'}
          </h2>
          {runningCount > 0 && (
            <span style={{
              padding: '0.2rem 0.625rem', borderRadius: 0,
              background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.2)',
              fontSize: '0.6875rem', fontWeight: 700, color: '#c5a059',
            }}>
              {runningCount} {lang === 'de' ? 'aktiv' : 'active'}
            </span>
          )}
        </div>
        <Link to="/experts" style={{
          display: 'flex', alignItems: 'center', gap: '0.375rem',
          fontSize: '0.8125rem', color: '#64748b', textDecoration: 'none',
          padding: '0.375rem 0.75rem', borderRadius: 0,
          border: '1px solid rgba(255,255,255,0.07)',
          transition: 'color 0.15s, border-color 0.15s',
        }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c5a059'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(197,160,89,0.3)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#64748b'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.07)'; }}
        >
          {lang === 'de' ? `Alle Agenten (${agents.length})` : `All agents (${agents.length})`} <ArrowRight size={14} />
        </Link>
      </div>

      {agents.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '3rem 1rem',
          background: 'rgba(255,255,255,0.02)', borderRadius: 0,
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <Cpu size={40} style={{ opacity: 0.15, marginBottom: '0.75rem', color: '#c5a059' }} />
          <p style={{ color: '#475569', fontWeight: 600, margin: '0 0 0.5rem' }}>
            {lang === 'de' ? 'Noch keine Agenten' : 'No agents yet'}
          </p>
          <Link to="/experts" style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.5rem 1rem', borderRadius: 0,
            background: 'rgba(197,160,89,0.08)', border: '1px solid rgba(197,160,89,0.2)',
            color: '#c5a059', textDecoration: 'none', fontSize: '0.875rem', fontWeight: 600,
          }}>
            <Plus size={14} /> {lang === 'de' ? 'Agent erstellen' : 'Create agent'}
          </Link>
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: '1rem',
          }}>
            {agents.slice(0, 4).map(agent => (
              <AgentMissionCard
                key={agent.id}
                agent={agent}
                lang={lang}
                onChat={onChat}
                onWakeup={handleWakeup}
                waking={waking.has(agent.id)}
                onPause={handlePause}
                pausing={pausing.has(agent.id)}
              />
            ))}
          </div>
        </>
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
        ? 'Im Live Room siehst du live, was deine Agenten gerade tun.'
        : 'The Live Room shows you live what your agents are doing.',
      action: { label: de ? 'Live Room öffnen →' : 'Open Live Room →', to: '/war-room' },
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
      background: 'linear-gradient(135deg, rgba(197,160,89,0.04) 0%, rgba(155,135,200,0.04) 100%)',
      border: '1px solid rgba(197,160,89,0.15)',
      borderRadius: 0, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ padding: '20px 24px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 0,
            background: 'rgba(197,160,89,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c5a059',
          }}>
            <Sparkles size={16} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#f4f4f5' }}>
              {de ? 'Erste Schritte' : 'Getting Started'}
            </div>
            <div style={{ fontSize: 11, color: '#52525b', marginTop: 1 }}>
              {completed}/{steps.length} {de ? 'abgeschlossen' : 'completed'}
              {allDone && <span style={{ color: '#c5a059', marginLeft: 6 }}>✓ {de ? 'Alles bereit!' : 'All done!'}</span>}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setHowOpen(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 0, padding: '5px 10px', cursor: 'pointer',
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
          height: '100%', borderRadius: 0, width: `${pct}%`,
          background: allDone ? '#c5a059' : 'linear-gradient(90deg, #c5a059, #9b87c8)',
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
              padding: '10px 14px', borderRadius: 0,
              background: step.done
                ? 'rgba(197,160,89,0.04)'
                : isNext
                  ? 'rgba(255,255,255,0.03)'
                  : 'transparent',
              border: step.done
                ? '1px solid rgba(197,160,89,0.12)'
                : isNext
                  ? '1px solid rgba(255,255,255,0.06)'
                  : '1px solid transparent',
              opacity: !step.done && !isNext ? 0.45 : 1,
              transition: 'all 0.2s',
            }}>
              {/* Icon / checkmark */}
              <div style={{
                width: 32, height: 32, borderRadius: 0, flexShrink: 0,
                background: step.done ? 'rgba(197,160,89,0.1)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${step.done ? 'rgba(197,160,89,0.25)' : 'rgba(255,255,255,0.06)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: step.done ? '#c5a059' : '#52525b',
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
                    flexShrink: 0, padding: '5px 12px', borderRadius: 0,
                    background: isNext ? 'rgba(197,160,89,0.1)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${isNext ? 'rgba(197,160,89,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    color: isNext ? '#c5a059' : '#52525b',
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
          borderRadius: 0,
          background: 'rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
            <BookOpen size={12} style={{ color: '#c5a059' }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#c5a059', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
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
        credentials: 'include',
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
        border: `1px solid ${focused ? 'rgba(197,160,89,0.3)' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: 0,
        transition: 'border-color 0.2s',
      }}>
        {/* Agent avatar */}
        <div style={{
          width: 28, height: 28, borderRadius: 0, flexShrink: 0,
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
            padding: '0.375rem 0.875rem', borderRadius: 0, border: 'none',
            background: command.trim() && !loading ? 'rgba(197,160,89,0.12)' : 'rgba(255,255,255,0.04)',
            color: command.trim() && !loading ? '#c5a059' : '#3f3f46',
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
          padding: '0.625rem 0.875rem', borderRadius: 0,
          background: result.ok ? 'rgba(197,160,89,0.04)' : 'rgba(239,68,68,0.06)',
          border: `1px solid ${result.ok ? 'rgba(197,160,89,0.15)' : 'rgba(239,68,68,0.15)'}`,
          fontSize: '0.8125rem', color: result.ok ? '#94a3b8' : '#fca5a5',
          lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 200, overflowY: 'auto',
        }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: result.ok ? '#c5a059' : '#ef4444', display: 'block', marginBottom: '0.25rem' }}>
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
        padding: '0.875rem 1.125rem', borderRadius: 0,
        background: hovered ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.04)',
        // backdropFilter removed
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
        width: 34, height: 34, borderRadius: 0, flexShrink: 0,
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
          background: '#f59e0b', color: '#0a0a0f', borderRadius: 0,
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

  // Refresh when approval status changes (e.g. via Telegram)
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener('opencognit:approval-changed', handler);
    return () => window.removeEventListener('opencognit:approval-changed', handler);
  }, [reload]);

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

  // Sync agent state to localStorage so Sidebar can highlight Setup section for new users
  useEffect(() => {
    if (data) {
      localStorage.setItem('oc_has_agents', data.experten.gesamt > 0 ? '1' : '0');
    }
  }, [data]);

  if (!aktivesUnternehmen) return null;

  // Wizard must stay mounted across loading/refresh cycles, otherwise its
  // internal state (step, description, workDir, plan) resets every 30s.
  const wizardOverlay = showWizard && (
    <SetupWizard
      onClose={() => setShowWizard(false)}
      onDone={() => { setShowWizard(false); setWizardDismissed(true); localStorage.setItem('oc_wizard_dismissed', '1'); reload(); }}
    />
  );

  if (loading && !data) return (
    <>
      {wizardOverlay}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Loader2 size={28} style={{ color: '#c5a059', animation: 'spin 1s linear infinite' }} />
      </div>
    </>
  );

  if (!data) return (
    <>
      {wizardOverlay}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '0.75rem' }}>
        <AlertCircle size={32} style={{ color: '#ef4444' }} />
        <p style={{ color: '#94a3b8', fontSize: '0.9375rem', margin: 0 }}>
          {error ? (lang === 'de' ? `Fehler: ${error}` : `Error: ${error}`) : (lang === 'de' ? 'Keine Daten verfügbar' : 'No data available')}
        </p>
      </div>
    </>
  );

  const { experten, aufgaben, kosten, pendingApprovals, topExperten, letzteAktivitaet } = data;
  const zyklen: { total: number; succeeded: number; failed: number } = (data as any).zyklen || { total: 0, succeeded: 0, failed: 0 };
  const recentActivityCount: number = (data as any).recentActivityCount || 0;
  const topProjekte: any[] = (data as any).topProjekte || [];
  const aktiveZiele: any[] = (data as any).aktiveZiele || [];
  const letzteTrace: TraceEvent[] = (data as any).letzteTrace || [];
  const alleExperten: LiveAgent[] = (data as any).alleExperten || [];

  const budgetColor = kosten.prozent > 95 ? '#ef4444' : kosten.prozent > 80 ? '#f59e0b' : '#22c55e';
  const hasRunningAgents = experten.running > 0;
  const { score: healthScore, grade: healthGrade, gradeColor: healthColor, factors: healthFactors } = computeHealthScore(experten, aufgaben, kosten, pendingApprovals, zyklen, recentActivityCount, lang);

  // Derive simple trends from current values
  const taskTrend: 'up' | 'down' | 'neutral' = aufgaben.inBearbeitung > 0 ? 'up' : 'neutral';
  const budgetTrend: 'up' | 'down' | 'neutral' = kosten.prozent > 80 ? 'up' : kosten.prozent < 20 ? 'neutral' : 'neutral';

  const de = lang === 'de';

  // ── Hero KPI data ──
  const heroKpis = [
    {
      value: experten.running > 0 ? experten.running : experten.aktiv,
      label: experten.running > 0 ? (de ? 'Agenten aktiv' : 'Agents live') : (de ? 'Agenten bereit' : 'Agents ready'),
      color: experten.running > 0 ? '#c5a059' : '#5c554d',
      pulse: experten.running > 0,
      link: '/experts',
    },
    {
      value: aufgaben.inBearbeitung,
      label: de ? 'In Bearbeitung' : 'In Progress',
      color: aufgaben.inBearbeitung > 0 ? '#9b87c8' : '#5c554d',
      pulse: false,
      link: '/tasks',
    },
    {
      value: aufgaben.offen,
      label: de ? 'Tasks offen' : 'Tasks open',
      color: aufgaben.offen > 0 ? '#ede5d8' : '#5c554d',
      pulse: false,
      link: '/tasks',
    },
    {
      value: aufgaben.blockiert > 0 ? aufgaben.blockiert : (pendingApprovals > 0 ? pendingApprovals : '✓'),
      label: aufgaben.blockiert > 0 ? (de ? 'Blockiert' : 'Blocked') : (de ? 'Genehmigungen' : 'Approvals'),
      color: aufgaben.blockiert > 0 ? '#c97b7b' : pendingApprovals > 0 ? '#d4a373' : '#5c554d',
      pulse: aufgaben.blockiert > 0 || pendingApprovals > 0,
      link: aufgaben.blockiert > 0 ? '/tasks' : '/approvals',
    },
    {
      value: `${kosten.prozent}%`,
      label: de ? 'Budget verbraucht' : 'Budget used',
      color: budgetColor,
      pulse: false,
      link: '/costs',
    },
  ];

  // ── Alert conditions ──
  const alerts: Array<{ msg: string; color: string; link: string }> = [];
  if (pendingApprovals > 0) alerts.push({ msg: de ? `${pendingApprovals} Genehmigung${pendingApprovals > 1 ? 'en' : ''} ausstehend` : `${pendingApprovals} approval${pendingApprovals > 1 ? 's' : ''} pending`, color: '#d4a373', link: '/approvals' });
  if (aufgaben.blockiert > 0) alerts.push({ msg: de ? `${aufgaben.blockiert} Tasks blockiert` : `${aufgaben.blockiert} tasks blocked`, color: '#c97b7b', link: '/tasks' });
  if (kosten.prozent >= 90) alerts.push({ msg: de ? `Budget fast aufgebraucht (${kosten.prozent}%)` : `Budget nearly exhausted (${kosten.prozent}%)`, color: '#c97b7b', link: '/costs' });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* ── CEO Setup Wizard Modal ── */}
      {wizardOverlay}

      {/* ── ALERT STRIP — action required, always first ── */}
      {alerts.length > 0 && (
        <div style={{
          display: 'flex', gap: '0.75rem', flexWrap: 'wrap',
        }}>
          {alerts.map((a, i) => (
            <button
              key={i}
              onClick={() => navigate(a.link)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.625rem',
                padding: '0.625rem 1.125rem',
                background: `${a.color}10`,
                border: `1px solid ${a.color}40`,
                color: a.color, cursor: 'pointer',
                fontSize: '0.875rem', fontWeight: 700,
                letterSpacing: '0.01em',
              }}
            >
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: a.color, boxShadow: `0 0 8px ${a.color}`, animation: 'pulse 1.5s ease-in-out infinite', flexShrink: 0 }} />
              {a.msg}
              <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>→</span>
            </button>
          ))}
        </div>
      )}

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' }}>
            <span style={{ fontSize: '0.625rem', fontWeight: 700, color: '#c5a059', letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>
              {aktivesUnternehmen.name}
            </span>
            {experten.running > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.1rem 0.5rem', border: '1px solid rgba(197,160,89,0.2)', fontSize: '0.5625rem', color: '#c5a059', fontWeight: 700, letterSpacing: '0.08em' }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#c5a059', animation: 'pulse 1.5s ease-in-out infinite' }} />
                {experten.running} LIVE
              </span>
            )}
          </div>
          <h1 className="page-title" style={{ margin: 0 }}>
            {t.dashboard.title}
          </h1>
          {(aktivesUnternehmen.ziel || aktivesUnternehmen.beschreibung) && (
            <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', marginTop: '0.375rem', maxWidth: 480, lineHeight: 1.5 }}>
              {((aktivesUnternehmen.ziel || aktivesUnternehmen.beschreibung) ?? '').slice(0, 100)}
              {((aktivesUnternehmen.ziel || aktivesUnternehmen.beschreibung) ?? '').length > 100 ? '…' : ''}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
          <button onClick={() => navigate('/war-room')} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.875rem', background: 'rgba(155,135,200,0.08)', border: '1px solid rgba(155,135,200,0.2)', color: '#9b87c8', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
            <MonitorPlay size={14} /> {de ? 'War Room' : 'War Room'}
          </button>
          <button onClick={() => navigate('/tasks')} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.875rem', background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.25)', color: '#c5a059', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer' }}>
            <Plus size={14} /> {de ? 'Neue Aufgabe' : 'New Task'}
          </button>
        </div>
      </div>

      {/* ── HERO KPI STRIP ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${heroKpis.length}, 1fr)`,
        border: '1px solid rgba(197,160,89,0.12)',
      }}>
        {heroKpis.map((kpi, i) => (
          <button
            key={i}
            onClick={() => navigate(kpi.link)}
            style={{
              display: 'flex', flexDirection: 'column', gap: '0.375rem',
              padding: '1.375rem 1.5rem',
              background: 'rgba(8,6,4,0.82)',
              border: 'none',
              borderRight: i < heroKpis.length - 1 ? '1px solid rgba(197,160,89,0.10)' : 'none',
              cursor: 'pointer', textAlign: 'left',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(197,160,89,0.05)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(8,6,4,0.82)')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {kpi.pulse && <div style={{ width: 6, height: 6, borderRadius: '50%', background: kpi.color, boxShadow: `0 0 6px ${kpi.color}`, animation: 'pulse 2s ease-in-out infinite', flexShrink: 0 }} />}
              <span style={{ fontSize: '2.25rem', fontWeight: 800, color: kpi.color, lineHeight: 1, fontFamily: 'var(--font-mono)', letterSpacing: '-0.03em' }}>
                {kpi.value}
              </span>
            </div>
            <span style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'var(--font-mono)' }}>
              {kpi.label}
            </span>
          </button>
        ))}
      </div>

      {/* ── First-Run Banner ── */}
      {isFirstRun && !wizardDismissed && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(197,160,89,0.08), rgba(79,70,229,0.08))',
          border: '1px solid rgba(197,160,89,0.25)',
          borderRadius: 0, padding: '1.25rem 1.5rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: 0, background: 'rgba(197,160,89,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Sparkles size={22} style={{ color: '#c5a059' }} />
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
              style={{ padding: '0.5rem 0.875rem', borderRadius: 0, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#64748b', fontSize: '0.8rem', cursor: 'pointer' }}
            >
              {lang === 'de' ? 'Später' : 'Later'}
            </button>
            <button
              onClick={() => setShowWizard(true)}
              style={{
                padding: '0.5rem 1.25rem', borderRadius: 0,
                background: 'rgba(197,160,89,0.9)', border: '1px solid rgba(197,160,89,0.4)',
                color: '#000', fontSize: '0.875rem', fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Sparkles size={14} /> {lang === 'de' ? 'CEO Setup starten' : 'Start CEO Setup'}
            </button>
          </div>
        </div>
      )}

      {/* ── My Team ── */}
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
              padding: '0.375rem 0.75rem', borderRadius: 0,
              border: '1px solid rgba(255,255,255,0.07)',
              transition: 'color 0.15s, border-color 0.15s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c5a059'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(197,160,89,0.3)'; }}
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
                marginTop: '1rem', padding: '0.5rem 1rem', borderRadius: 0,
                background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.2)',
                color: '#c5a059', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600,
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
                    <div style={{ flex: 1, height: 4, borderRadius: 0, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 0, background: s.color,
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
      <SystemPulse
        unternehmenId={aktivesUnternehmen.id}
        lang={lang}
      />

      {/* ── Quick actions ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem' }}>
        {[
          { icon: Plus,         label: lang === 'de' ? 'Neue Aufgabe'   : 'New Task',         to: '/tasks',        accent: '#c5a059' },
          { icon: Users,        label: lang === 'de' ? 'Team verwalten' : 'Manage Team',       to: '/experts',      accent: '#6366f1' },
          { icon: ShieldCheck,  label: lang === 'de' ? 'Genehmigungen'  : 'Approvals',         to: '/approvals',    accent: '#f59e0b', badge: pendingApprovals > 0 ? pendingApprovals : undefined },
          { icon: Zap,          label: lang === 'de' ? 'Routinen'       : 'Routines',           to: '/routines',     accent: '#22c55e' },
          { icon: FolderOpen,   label: lang === 'de' ? 'Projekte'       : 'Projects',           to: '/projects',     accent: '#9b87c8' },
          { icon: Brain,        label: lang === 'de' ? 'Wissensbasis'   : 'Knowledge',          to: '/company-knowledge', accent: '#9b87c8' },
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
