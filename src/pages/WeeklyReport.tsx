import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp, CheckCircle2, AlertTriangle, Wallet, Users,
  Sparkles, Download, Calendar, Trophy, Zap, RefreshCw, Target
} from 'lucide-react';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useCompany } from '../hooks/useCompany';
import { authFetch } from '../utils/api';
import { useI18n } from '../i18n';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DayCompletion { day: string; date: string; count: number; }

interface AgentMetric {
  id: string; name: string; avatar: string; avatarFarbe: string;
  rolle: string; completed: number; inProgress: number; costCent: number;
}

interface GoalInfo { id: string; titel: string; fortschritt: number; status: string; }
interface TopTask { id: string; titel: string; agentName: string | null; abgeschlossenAm: string; }

interface ReportData {
  weekLabel: string;
  weekStart: string;
  weekEnd: string;
  summary: {
    tasksCreated: number;
    tasksCompleted: number;
    tasksBlocked: number;
    tasksInProgress: number;
    completionRate: number;
    weekCostCent: number;
    activeAgents: number;
  };
  dailyCompletions: DayCompletion[];
  agentMetrics: AgentMetric[];
  activeGoals: GoalInfo[];
  topCompletions: TopTask[];
  aiNarrative: string | null;
}

// ─── Mini Bar Chart ───────────────────────────────────────────────────────────

function MiniBarChart({ days }: { days: DayCompletion[] }) {
  const max = Math.max(...days.map(d => d.count), 1);
  const today = new Date().toDateString();

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, padding: '0 4px' }}>
      {days.map((d, i) => {
        const h = Math.max(4, Math.round((d.count / max) * 80));
        const isToday = new Date(d.date + ' 2024').toDateString() === today;
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div
              title={`${d.date}: ${d.count} completed`}
              style={{
                width: '100%',
                height: h,
                borderRadius: '0',
                background: d.count > 0
                  ? (isToday ? '#c5a059' : 'rgba(197,160,89,0.5)')
                  : 'rgba(255,255,255,0.06)',
                transition: 'height 0.6s ease',
                cursor: 'default',
              }}
            />
            <span style={{ fontSize: '0.625rem', color: isToday ? '#c5a059' : '#52525b', fontWeight: isToday ? 700 : 400 }}>
              {d.day}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Progress Ring ────────────────────────────────────────────────────────────

function ProgressRing({ pct, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: 'stroke-dasharray 0.8s ease' }} />
    </svg>
  );
}

// ─── Typewriter ───────────────────────────────────────────────────────────────

function TypewriterText({ text }: { text: string }) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setDisplayed('');
    setDone(false);
    const id = setInterval(() => {
      if (idx.current < text.length) {
        setDisplayed(text.slice(0, ++idx.current));
      } else {
        setDone(true);
        clearInterval(id);
      }
    }, 14);
    return () => clearInterval(id);
  }, [text]);

  return (
    <span>
      {displayed}
      {!done && <span style={{ animation: 'blink 1s step-end infinite', color: '#c5a059' }}>|</span>}
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function WeeklyReport() {
  useBreadcrumbs(['Reports', 'Weekly Report']);
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const isDE = language === 'de';

  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/weekly-report?language=${language}`);
      if (!res.ok) throw new Error('Failed');
      setData(await res.json());
    } catch {
      setError('Could not load report');
    } finally {
      setLoading(false);
    }
  }, [aktivesUnternehmen?.id, language]);

  useEffect(() => { load(); }, [load]);

  function handlePrint() {
    window.print();
  }

  if (!aktivesUnternehmen) return null;

  return (
    <div style={{ padding: '1.5rem', maxWidth: 960, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
            <div style={{
              width: 36, height: 36, borderRadius: 0,
              background: 'linear-gradient(135deg, rgba(197,160,89,0.2), rgba(155,135,200,0.2))',
              border: '1px solid rgba(197,160,89,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c5a059',
            }}>
              <Calendar size={18} />
            </div>
            <h1 style={{
              margin: 0, fontSize: '1.5rem', fontWeight: 800,
              background: 'linear-gradient(135deg, #f4f4f5, #a1a1aa)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              Weekly Report
            </h1>
          </div>
          {data && (
            <p style={{ color: '#52525b', fontSize: '0.875rem', margin: 0 }}>
              {data.weekLabel}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={load}
            disabled={loading}
            style={{
              padding: '0.5rem 0.875rem', borderRadius: 0,
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
              color: '#71717a', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.375rem',
            }}
          >
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {isDE ? 'Aktualisieren' : 'Refresh'}
          </button>
          <button
            onClick={handlePrint}
            style={{
              padding: '0.5rem 0.875rem', borderRadius: 0,
              background: 'rgba(197,160,89,0.08)', border: '1px solid rgba(197,160,89,0.2)',
              color: '#c5a059', cursor: 'pointer',
              fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.375rem',
              fontWeight: 600,
            }}
          >
            <Download size={13} />
            {isDE ? 'Exportieren' : 'Export'}
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', color: '#52525b', gap: '0.75rem' }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid rgba(197,160,89,0.3)', borderTopColor: '#c5a059', animation: 'spin 0.8s linear infinite' }} />
          {isDE ? 'Bericht wird geladen…' : 'Loading report…'}
        </div>
      ) : error ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#ef4444' }}>
          <AlertTriangle size={28} style={{ margin: '0 auto 0.75rem', display: 'block' }} />
          {error}
        </div>
      ) : data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* AI Narrative */}
          {data.aiNarrative && (
            <div style={{
              padding: '1.25rem 1.5rem', borderRadius: 0,
              background: 'linear-gradient(135deg, rgba(197,160,89,0.04), rgba(155,135,200,0.04))',
              border: '1px solid rgba(197,160,89,0.15)',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: -20, right: -20, opacity: 0.04 }}>
                <Sparkles size={100} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 0, flexShrink: 0,
                  background: 'rgba(197,160,89,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c5a059',
                }}>
                  <Sparkles size={16} />
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c5a059', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.375rem' }}>
                    AI Insights
                  </div>
                  <p style={{ color: '#d4d4d8', fontSize: '0.9375rem', lineHeight: 1.65, margin: 0 }}>
                    <TypewriterText text={data.aiNarrative} />
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* KPI Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.875rem' }}>
            {[
              { label: isDE ? 'Erstellt' : 'Created', value: data.summary.tasksCreated, color: '#a1a1aa', icon: <Zap size={16} /> },
              { label: isDE ? 'Erledigt' : 'Completed', value: data.summary.tasksCompleted, color: '#22c55e', icon: <CheckCircle2 size={16} /> },
              { label: isDE ? 'Blockiert' : 'Blocked', value: data.summary.tasksBlocked, color: '#ef4444', icon: <AlertTriangle size={16} /> },
              { label: isDE ? 'Agenten' : 'Agents', value: data.summary.activeAgents, color: '#c5a059', icon: <Users size={16} /> },
              { label: isDE ? 'Kosten' : 'Cost', value: `${(data.summary.weekCostCent / 100).toFixed(2)} €`, color: '#f59e0b', icon: <Wallet size={16} /> },
            ].map(kpi => (
              <div key={kpi.label} style={{
                padding: '1rem', borderRadius: 0,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.5rem' }}>
                  <span style={{ color: kpi.color }}>{kpi.icon}</span>
                  <span style={{ fontSize: '0.6875rem', color: '#52525b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{kpi.label}</span>
                </div>
                <div style={{ fontSize: '1.625rem', fontWeight: 800, color: '#f4f4f5', fontVariantNumeric: 'tabular-nums' }}>
                  {kpi.value}
                </div>
              </div>
            ))}
          </div>

          {/* Two-column: Chart + Completion Rate */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', alignItems: 'stretch' }}>
            {/* Daily Completions Chart */}
            <div style={{
              padding: '1.25rem',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 0,
            }}>
              <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#f4f4f5', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <TrendingUp size={14} style={{ color: '#c5a059' }} />
                {isDE ? 'Tägliche Erledigungen' : 'Daily Completions'}
              </div>
              <MiniBarChart days={data.dailyCompletions} />
            </div>

            {/* Completion Rate */}
            <div style={{
              padding: '1.25rem',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: '0.5rem', minWidth: 140,
            }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ProgressRing pct={data.summary.completionRate} color="#c5a059" size={80} />
                <div style={{ position: 'absolute', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#f4f4f5', lineHeight: 1 }}>
                    {data.summary.completionRate}%
                  </div>
                </div>
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#71717a', textAlign: 'center', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {isDE ? 'Abschlussrate' : 'Completion Rate'}
              </div>
            </div>
          </div>

          {/* Agent Performance */}
          {data.agentMetrics.length > 0 && (
            <div style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 0, overflow: 'hidden',
            }}>
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Trophy size={14} style={{ color: '#f59e0b' }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f4f4f5' }}>
                  {isDE ? 'Agent-Performance' : 'Agent Performance'}
                </span>
              </div>
              <div>
                {data.agentMetrics.map((agent, i) => {
                  const maxCompleted = Math.max(...data.agentMetrics.map(a => a.completed), 1);
                  const barW = (agent.completed / maxCompleted) * 100;
                  return (
                    <div key={agent.id} style={{
                      padding: '0.875rem 1.25rem',
                      borderBottom: i < data.agentMetrics.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                      display: 'flex', alignItems: 'center', gap: '0.875rem',
                    }}>
                      {/* Rank */}
                      <span style={{
                        width: 22, height: 22, borderRadius: 0, flexShrink: 0,
                        background: i === 0 ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)',
                        color: i === 0 ? '#f59e0b' : '#52525b',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.6875rem', fontWeight: 800,
                      }}>
                        {i === 0 ? '🥇' : i + 1}
                      </span>

                      {/* Avatar */}
                      <div style={{
                        width: 32, height: 32, borderRadius: 0, flexShrink: 0,
                        background: agent.avatarFarbe || '#c5a059',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.875rem',
                      }}>
                        {agent.avatar || agent.name[0]}
                      </div>

                      {/* Info + Bar */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.3rem' }}>
                          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f4f4f5' }}>{agent.name}</span>
                          <span style={{ fontSize: '0.6875rem', color: '#52525b' }}>{agent.rolle}</span>
                        </div>
                        <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 0, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', width: `${barW}%`,
                            background: i === 0 ? '#c5a059' : 'rgba(197,160,89,0.5)',
                            borderRadius: 0, transition: 'width 0.8s ease',
                          }} />
                        </div>
                      </div>

                      {/* Stats */}
                      <div style={{ display: 'flex', gap: '1rem', flexShrink: 0, fontSize: '0.8125rem' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontWeight: 800, color: '#22c55e' }}>{agent.completed}</div>
                          <div style={{ fontSize: '0.625rem', color: '#52525b', marginTop: 1 }}>done</div>
                        </div>
                        {agent.costCent > 0 && (
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontWeight: 700, color: '#f59e0b' }}>€{(agent.costCent / 100).toFixed(2)}</div>
                            <div style={{ fontSize: '0.625rem', color: '#52525b', marginTop: 1 }}>cost</div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Two-column: Goal Progress + Top Completions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>

            {/* Goal Progress */}
            {data.activeGoals.length > 0 && (
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 0, overflow: 'hidden',
              }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Target size={14} style={{ color: '#9b87c8' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f4f4f5' }}>
                    {isDE ? 'Aktive Ziele' : 'Active Goals'}
                  </span>
                </div>
                <div style={{ padding: '0.75rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                  {data.activeGoals.map(goal => (
                    <div key={goal.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <span style={{ fontSize: '0.8125rem', color: '#d4d4d8', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, paddingRight: '0.5rem' }}>{goal.titel}</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#c5a059', flexShrink: 0 }}>{goal.fortschritt}%</span>
                      </div>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 0 }}>
                        <div style={{
                          height: '100%', width: `${goal.fortschritt}%`,
                          background: goal.fortschritt >= 100 ? '#c5a059' : goal.fortschritt >= 70 ? '#22c55e' : '#9b87c8',
                          borderRadius: 0, transition: 'width 0.6s ease',
                        }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top Completions */}
            {data.topCompletions.length > 0 && (
              <div style={{
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 0, overflow: 'hidden',
              }}>
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <CheckCircle2 size={14} style={{ color: '#22c55e' }} />
                  <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f4f4f5' }}>
                    {isDE ? 'Zuletzt erledigt' : 'Recently Completed'}
                  </span>
                </div>
                <div>
                  {data.topCompletions.map((task, i) => (
                    <div key={task.id} style={{
                      padding: '0.625rem 1.25rem',
                      borderBottom: i < data.topCompletions.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none',
                      display: 'flex', alignItems: 'center', gap: '0.625rem',
                    }}>
                      <CheckCircle2 size={13} style={{ color: '#22c55e', flexShrink: 0 }} />
                      <span style={{ fontSize: '0.8125rem', color: '#a1a1aa', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {task.titel}
                      </span>
                      {task.agentName && (
                        <span style={{ fontSize: '0.6875rem', color: '#3f3f46', flexShrink: 0 }}>
                          {task.agentName}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer note */}
          <p style={{ color: '#3f3f46', fontSize: '0.75rem', textAlign: 'center', margin: 0 }}>
            {isDE
              ? `Bericht generiert am ${new Date().toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · OpenCognit`
              : `Report generated ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} · OpenCognit`}
          </p>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          .app-topbar, .app-sidebar { display: none !important; }
          .app-main { margin: 0 !important; }
          body { background: white !important; color: black !important; }
        }
      ` }} />
    </div>
  );
}
