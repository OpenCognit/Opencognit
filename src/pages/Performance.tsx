import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Minus, Trophy, Zap, CheckCircle, XCircle, Wallet, RefreshCw, Bot, ChevronDown, ChevronUp } from 'lucide-react';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { apiExperten, type Experte } from '../api/client';

function authFetch(url: string) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, { credentials: 'include', headers: { Authorization: token ? `Bearer ${token}` : '' } });
}

function centZuEuro(cent: number) {
  return (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

interface AgentStats {
  arbeitszyklen: Array<{ status: string; erstelltAm: string }>;
  aufgaben: Array<{ status: string; prioritaet: string; erstelltAm: string }>;
}

interface AgentPerf {
  expert: Experte;
  stats: AgentStats | null;
  tasksDone: number;
  totalTasks: number;
  totalCycles: number;
  succeededCycles: number;
  successRate: number;
  costPerTask: number;
  weekActivity: number[]; // 7 values, index 0 = 6 days ago, 6 = today
  trend: 'up' | 'down' | 'flat';
}

function computeWeekActivity(cycles: Array<{ erstelltAm: string }>): number[] {
  const buckets = Array(7).fill(0);
  const now = Date.now();
  for (const c of cycles) {
    const diff = now - new Date(c.erstelltAm).getTime();
    const dayIdx = Math.floor(diff / (86400_000));
    if (dayIdx >= 0 && dayIdx < 7) buckets[6 - dayIdx]++;
  }
  return buckets;
}

function MiniBar({ values }: { values: number[] }) {
  const max = Math.max(...values, 1);
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28 }}>
      {values.map((v, i) => (
        <div key={i} title={`${days[i]}: ${v}`} style={{
          width: 10,
          height: Math.max(3, Math.round((v / max) * 28)),
          background: v > 0 ? `rgba(197,160,89,${0.3 + (v / max) * 0.7})` : 'rgba(255,255,255,0.06)',
          borderRadius: 0,
          transition: 'height 0.4s ease',
        }} />
      ))}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span style={{ fontSize: 16 }}>🥇</span>;
  if (rank === 2) return <span style={{ fontSize: 16 }}>🥈</span>;
  if (rank === 3) return <span style={{ fontSize: 16 }}>🥉</span>;
  return <span style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 600, minWidth: 18, textAlign: 'center' }}>#{rank}</span>;
}

function TrendIcon({ trend }: { trend: 'up' | 'down' | 'flat' }) {
  if (trend === 'up') return <TrendingUp size={14} style={{ color: '#22c55e' }} />;
  if (trend === 'down') return <TrendingDown size={14} style={{ color: '#ef4444' }} />;
  return <Minus size={14} style={{ color: 'var(--color-text-muted)' }} />;
}

type SortKey = 'tasksDone' | 'successRate' | 'costPerTask' | 'totalCycles';

export function Performance() {
  const i18n = useI18n();
  const de = i18n.language === 'de';
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', de ? 'Performance' : 'Performance']);

  const [agents, setAgents] = useState<AgentPerf[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('tasksDone');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [refreshing, setRefreshing] = useState(false);
  const [evolution, setEvolution] = useState<any[] | null>(null);

  useEffect(() => {
    if (!aktivesUnternehmen) return;
    authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/performance/leaderboard?days=30`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setEvolution(d?.agents ?? []))
      .catch(() => setEvolution([]));
  }, [aktivesUnternehmen?.id]);

  const load = async () => {
    if (!aktivesUnternehmen) return;
    setRefreshing(true);
    try {
      const experts = await apiExperten.liste(aktivesUnternehmen.id);
      const statsResults = await Promise.all(
        experts.map(e =>
          authFetch(`/api/experten/${e.id}/stats`)
            .then(r => r.json())
            .catch(() => null)
        )
      );

      const now = Date.now();
      const fourteenDaysAgo = now - 14 * 86400_000;
      const sevenDaysAgo = now - 7 * 86400_000;

      const perfs: AgentPerf[] = experts.map((expert, i) => {
        const stats: AgentStats | null = statsResults[i];
        if (!stats) {
          return {
            expert, stats: null,
            tasksDone: 0, totalTasks: 0,
            totalCycles: 0, succeededCycles: 0,
            successRate: 0, costPerTask: 0,
            weekActivity: Array(7).fill(0),
            trend: 'flat',
          };
        }

        const cycles = stats.arbeitszyklen || [];
        const tasks = stats.aufgaben || [];

        const tasksDone = tasks.filter(t => t.status === 'done').length;
        const totalTasks = tasks.length;
        const totalCycles = cycles.length;
        const succeededCycles = cycles.filter(c => c.status === 'succeeded').length;
        const successRate = totalCycles > 0 ? Math.round((succeededCycles / totalCycles) * 100) : 0;

        const cost = expert.verbrauchtMonatCent;
        const costPerTask = tasksDone > 0 ? cost / tasksDone : cost;

        // Week activity
        const weekActivity = computeWeekActivity(cycles);

        // Trend: compare last 7 days vs previous 7 days
        const recentCycles = cycles.filter(c => new Date(c.erstelltAm).getTime() > sevenDaysAgo).length;
        const prevCycles = cycles.filter(c => {
          const t = new Date(c.erstelltAm).getTime();
          return t > fourteenDaysAgo && t <= sevenDaysAgo;
        }).length;
        const trend: 'up' | 'down' | 'flat' = recentCycles > prevCycles ? 'up' : recentCycles < prevCycles ? 'down' : 'flat';

        return { expert, stats, tasksDone, totalTasks, totalCycles, succeededCycles, successRate, costPerTask, weekActivity, trend };
      });

      setAgents(perfs);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, [aktivesUnternehmen?.id]);

  const sorted = [...agents].sort((a, b) => {
    const mul = sortDir === 'desc' ? -1 : 1;
    if (sortKey === 'tasksDone') return mul * (a.tasksDone - b.tasksDone);
    if (sortKey === 'successRate') return mul * (a.successRate - b.successRate);
    if (sortKey === 'costPerTask') return mul * (a.costPerTask - b.costPerTask);
    if (sortKey === 'totalCycles') return mul * (a.totalCycles - b.totalCycles);
    return 0;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };

  // Company-wide KPIs
  const totalTasksDone = agents.reduce((s, a) => s + a.tasksDone, 0);
  const avgSuccessRate = agents.length > 0
    ? Math.round(agents.filter(a => a.totalCycles > 0).reduce((s, a) => s + a.successRate, 0) / Math.max(1, agents.filter(a => a.totalCycles > 0).length))
    : 0;
  const totalCost = agents.reduce((s, a) => s + a.expert.verbrauchtMonatCent, 0);
  const totalCycles = agents.reduce((s, a) => s + a.totalCycles, 0);

  const SortIndicator = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ChevronDown size={12} style={{ opacity: 0.3 }} />;
    return sortDir === 'desc' ? <ChevronDown size={12} style={{ color: '#c5a059' }} /> : <ChevronUp size={12} style={{ color: '#c5a059' }} />;
  };

  if (!aktivesUnternehmen) return null;

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <div style={{ width: 40, height: 40, borderRadius: 0, background: 'rgba(245,158,11,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Trophy size={20} style={{ color: '#f59e0b' }} />
            </div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, background: 'linear-gradient(135deg, #f59e0b, #ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {de ? 'Performance Center' : 'Performance Center'}
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--color-text-muted)' }}>
            {de ? 'Agenten-Leistung und Team-Metriken auf einen Blick' : 'Agent performance and team metrics at a glance'}
          </p>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid var(--color-border)',
            borderRadius: 0, cursor: 'pointer', fontSize: 13, color: 'var(--color-text-secondary)',
            transition: 'all 0.15s',
          }}
        >
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          {de ? 'Aktualisieren' : 'Refresh'}
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 32 }}>
        {[
          {
            icon: <CheckCircle size={20} style={{ color: '#22c55e' }} />,
            label: de ? 'Aufgaben erledigt' : 'Tasks Done',
            value: totalTasksDone,
            sub: de ? 'diesen Monat' : 'this month',
            color: '#22c55e',
          },
          {
            icon: <Zap size={20} style={{ color: '#c5a059' }} />,
            label: de ? 'Ø Erfolgsrate' : 'Avg. Success Rate',
            value: `${avgSuccessRate}%`,
            sub: de ? 'aller Agenten' : 'all agents',
            color: '#c5a059',
          },
          {
            icon: <Bot size={20} style={{ color: '#9b87c8' }} />,
            label: de ? 'Zyklen gesamt' : 'Total Cycles',
            value: totalCycles,
            sub: de ? 'letzte 30 Tage' : 'last 30 days',
            color: '#9b87c8',
          },
          {
            icon: <Wallet size={20} style={{ color: '#f59e0b' }} />,
            label: de ? 'Kosten (Monat)' : 'Cost (Month)',
            value: centZuEuro(totalCost),
            sub: de ? 'alle Agenten' : 'all agents',
            color: '#f59e0b',
          },
        ].map((kpi, i) => (
          <div key={i} style={{
            padding: 20, borderRadius: 0,
            background: `rgba(${kpi.color === '#22c55e' ? '34,197,94' : kpi.color === '#c5a059' ? '197,160,89' : kpi.color === '#9b87c8' ? '155,135,200' : '245,158,11'},0.04)`,
            border: `1px solid ${kpi.color}22`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              {kpi.icon}
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 1 }}>{kpi.label}</span>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: kpi.color, marginBottom: 4 }}>{kpi.value}</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Evolution — Self-Evolving Agents (30d vs previous 30d) */}
      {evolution && evolution.length > 0 && (
        <div style={{
          background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)',
          borderRadius: 0, padding: '20px 24px', marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <TrendingUp size={16} style={{ color: '#c5a059' }} />
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
              {de ? 'Agenten-Evolution' : 'Agent Evolution'}
            </h2>
            <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
              {de ? 'Aktuelle 30 Tage vs. vorherige 30 Tage' : 'Last 30 days vs. previous 30 days'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
            {evolution.slice(0, 8).map((e: any) => {
              const dur = e.changes.avgDurationPct;
              const cost = e.changes.avgCostPerTaskPct;
              const succ = e.changes.successRatePct;
              const bestSignal = dur !== null ? dur : (succ !== null ? -succ : cost);
              const color = bestSignal === null ? 'var(--color-text-muted)' :
                bestSignal < -5 ? '#22c55e' : bestSignal > 5 ? '#ef4444' : 'var(--color-text-muted)';
              const pill = (label: string, val: number | null, invert = false) => {
                if (val === null) return null;
                const good = invert ? val > 0 : val < 0;
                const c = Math.abs(val) < 1 ? 'var(--color-text-muted)' : good ? '#22c55e' : '#ef4444';
                return (
                  <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 0, background: `${c}22`, color: c, border: `1px solid ${c}44` }}>
                    {label} {val > 0 ? '+' : ''}{val.toFixed(0)}%
                  </span>
                );
              };
              return (
                <div key={e.current.expertId} style={{
                  padding: '12px 14px', borderRadius: 0,
                  background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Bot size={14} style={{ color }} />
                    <strong style={{ fontSize: 13 }}>{e.current.name}</strong>
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-muted)' }}>
                      {e.current.runsTotal} {de ? 'Zyklen' : 'cycles'}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10, lineHeight: 1.5 }}>
                    {e.verdict}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {pill(de ? 'Dauer' : 'duration', dur)}
                    {pill(de ? 'Tokens' : 'tokens', e.changes.avgTokensPct)}
                    {pill(de ? 'Kosten/Task' : 'cost/task', cost)}
                    {pill(de ? 'Erfolg' : 'success', succ, true)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', borderRadius: 0, overflow: 'hidden' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Trophy size={16} style={{ color: '#f59e0b' }} />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{de ? 'Agenten-Leaderboard' : 'Agent Leaderboard'}</h2>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
            {de ? `${agents.length} Agenten • letzte 30 Tage` : `${agents.length} agents • last 30 days`}
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            <div style={{ width: 32, height: 32, border: '2px solid var(--color-border)', borderTopColor: '#c5a059', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
            {de ? 'Lade Performance-Daten...' : 'Loading performance data...'}
          </div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            {de ? 'Keine Agenten gefunden.' : 'No agents found.'}
          </div>
        ) : (
          <>
            {/* Table header */}
            <div style={{
              display: 'grid', gridTemplateColumns: '36px 1fr 80px 80px 80px 100px 90px 70px',
              gap: 12, padding: '10px 24px', borderBottom: '1px solid var(--color-border)',
              fontSize: 10, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 1,
            }}>
              <div style={{ textAlign: 'center' }}>#</div>
              <div>{de ? 'Agent' : 'Agent'}</div>
              <button onClick={() => toggleSort('tasksDone')} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', color: sortKey === 'tasksDone' ? '#c5a059' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                {de ? 'Erledigt' : 'Done'} <SortIndicator k="tasksDone" />
              </button>
              <button onClick={() => toggleSort('totalCycles')} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', color: sortKey === 'totalCycles' ? '#c5a059' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                {de ? 'Zyklen' : 'Cycles'} <SortIndicator k="totalCycles" />
              </button>
              <button onClick={() => toggleSort('successRate')} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', color: sortKey === 'successRate' ? '#c5a059' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                {de ? 'Erfolg' : 'Success'} <SortIndicator k="successRate" />
              </button>
              <div>{de ? 'Aktivität (7T)' : 'Activity (7d)'}</div>
              <button onClick={() => toggleSort('costPerTask')} style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', color: sortKey === 'costPerTask' ? '#c5a059' : 'var(--color-text-muted)', cursor: 'pointer', fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>
                {de ? '€/Aufgabe' : '€/Task'} <SortIndicator k="costPerTask" />
              </button>
              <div>{de ? 'Trend' : 'Trend'}</div>
            </div>

            {/* Rows */}
            {sorted.map((perf, idx) => {
              const rank = idx + 1;
              const successColor = perf.successRate >= 80 ? '#22c55e' : perf.successRate >= 50 ? '#f59e0b' : '#ef4444';
              return (
                <div key={perf.expert.id} style={{
                  display: 'grid', gridTemplateColumns: '36px 1fr 80px 80px 80px 100px 90px 70px',
                  gap: 12, padding: '16px 24px',
                  borderBottom: idx < sorted.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  alignItems: 'center',
                  background: rank <= 3 ? `rgba(${rank === 1 ? '245,158,11' : rank === 2 ? '148,163,184' : '234,88,12'},0.03)` : 'transparent',
                  transition: 'background 0.15s',
                }}>
                  {/* Rank */}
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <RankBadge rank={rank} />
                  </div>

                  {/* Agent */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 0, background: (perf.expert.avatarFarbe || '#c5a059') + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                      {perf.expert.avatar || <Bot size={18} style={{ color: perf.expert.avatarFarbe || '#c5a059' }} />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {perf.expert.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {perf.expert.rolle}
                      </div>
                    </div>
                  </div>

                  {/* Tasks Done */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: perf.tasksDone > 0 ? '#22c55e' : 'var(--color-text-muted)' }}>{perf.tasksDone}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>/ {perf.totalTasks}</div>
                  </div>

                  {/* Cycles */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{perf.totalCycles}</div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{perf.succeededCycles} ✓</div>
                  </div>

                  {/* Success Rate */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: successColor }}>
                      {perf.totalCycles > 0 ? `${perf.successRate}%` : '—'}
                    </div>
                    <div style={{ height: 3, width: '60%', margin: '4px auto 0', background: 'rgba(255,255,255,0.07)', borderRadius: 0, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${perf.successRate}%`, background: successColor, borderRadius: 0 }} />
                    </div>
                  </div>

                  {/* Mini bar chart */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <MiniBar values={perf.weekActivity} />
                  </div>

                  {/* Cost per task */}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                      {perf.tasksDone > 0 ? centZuEuro(perf.costPerTask) : '—'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                      {de ? 'gesamt' : 'total'}: {centZuEuro(perf.expert.verbrauchtMonatCent)}
                    </div>
                  </div>

                  {/* Trend */}
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <TrendIcon trend={perf.trend} />
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Skills Coverage */}
      {!loading && agents.length > 0 && (
        <div style={{ marginTop: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Status breakdown */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', borderRadius: 0, padding: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {de ? 'Agenten-Status' : 'Agent Status'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {[
                { status: 'active', color: '#22c55e', label: de ? 'Aktiv' : 'Active' },
                { status: 'running', color: '#3b82f6', label: de ? 'Läuft' : 'Running' },
                { status: 'idle', color: '#94a3b8', label: de ? 'Inaktiv' : 'Idle' },
                { status: 'paused', color: '#f59e0b', label: de ? 'Pausiert' : 'Paused' },
                { status: 'error', color: '#ef4444', label: de ? 'Fehler' : 'Error' },
              ].map(({ status, color, label }) => {
                const cnt = agents.filter(a => a.expert.status === status).length;
                const pct = agents.length > 0 ? (cnt / agents.length) * 100 : 0;
                if (cnt === 0) return null;
                return (
                  <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', minWidth: 60 }}>{label}</div>
                    <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 0, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 0, transition: 'width 0.6s ease' }} />
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color, minWidth: 20, textAlign: 'right' }}>{cnt}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top performers summary */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--color-border)', borderRadius: 0, padding: 20 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 13, fontWeight: 700, color: 'var(--color-text-primary)' }}>
              {de ? 'Top Performer' : 'Top Performers'}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sorted.slice(0, 5).map((perf, i) => (
                <div key={perf.expert.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 14, minWidth: 20 }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </span>
                  <div style={{ width: 24, height: 24, borderRadius: 0, background: (perf.expert.avatarFarbe || '#c5a059') + '22', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, flexShrink: 0 }}>
                    {perf.expert.avatar || '🤖'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{perf.expert.name}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>{perf.tasksDone} ✓</span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>{perf.totalCycles > 0 ? `${perf.successRate}%` : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
