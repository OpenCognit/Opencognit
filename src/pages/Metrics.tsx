import { useState, useEffect, useCallback } from 'react';
import { BarChart3, TrendingUp, Cpu, AlertTriangle, CheckCircle, RefreshCw,
         Zap, DollarSign, Activity, Shield, Database, Trash2, Download } from 'lucide-react';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';

function authFetch(url: string, opts?: RequestInit) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: token ? `Bearer ${token}` : '' } });
}

function centToEuro(cent: number) {
  return (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
function fmtNumber(n: number) {
  return n.toLocaleString('de-DE');
}

interface MetricsData {
  period: { days: number; since: string };
  totals: { inputTokens: number; outputTokens: number; kostenCent: number };
  costPerAgent: Array<{ expertId: string; expertName: string; kostenCent: number; inputTokens: number; outputTokens: number; runs: number }>;
  dailyCosts: Array<{ day: string; kostenCent: number; runs: number }>;
  taskStats: Array<{ status: string; cnt: number }>;
  runStats: Array<{ status: string; cnt: number }>;
  agentActivity: Array<{ expertId: string; expertName: string; totalRuns: number; succeededRuns: number; lastActive: string }>;
}

interface HealthData {
  healthy: boolean;
  stuckAgents: Array<{ id: string; name: string; status: string; letzterZyklus: string }>;
  loopyWakeups: Array<{ expertId: string; expertName: string; coalescedCount: number; reason: string }>;
  errorAgents: Array<{ id: string; name: string; letzterZyklus: string }>;
  recentFailures: Array<{ expertId: string; expertName: string; failCount: number }>;
  staleWakeups: Array<{ expertId: string; expertName: string; count: number }>;
  checkedAt: string;
}

interface Backup {
  name: string;
  sizeBytes: number;
  createdAt: string;
}

const TASK_STATUS_COLOR: Record<string, string> = {
  done: '#22c55e',
  in_progress: '#23CDCB',
  todo: '#60a5fa',
  backlog: '#6b7280',
  blocked: '#ef4444',
  cancelled: '#a1a1aa',
  in_review: '#f59e0b',
};

const RUN_STATUS_COLOR: Record<string, string> = {
  succeeded: '#22c55e',
  failed: '#ef4444',
  running: '#23CDCB',
  queued: '#60a5fa',
  cancelled: '#a1a1aa',
  timed_out: '#f97316',
  deferred: '#a855f7',
};

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', flex: 1 }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color = '#23CDCB' }: {
  icon: any; label: string; value: string; sub?: string; color?: string;
}) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 14,
      padding: '1.25rem 1.5rem',
      display: 'flex',
      gap: '1rem',
      alignItems: 'flex-start',
      backdropFilter: 'blur(10px)',
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
        background: `${color}18`, border: `1px solid ${color}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={18} style={{ color }} />
      </div>
      <div>
        <div style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff' }}>{value}</div>
        {sub && <div style={{ fontSize: '0.7rem', color: '#52525b', marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

export function Metrics() {
  const { t } = useI18n();
  useBreadcrumbs([t.nav.metrics ?? 'Metrics']);
  const { aktivesUnternehmen } = useCompany();
  const selectedUnternehmenId = aktivesUnternehmen?.id;

  const [days, setDays] = useState(30);
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [healthLoading, setHealthLoading] = useState(true);
  const [backupRunning, setBackupRunning] = useState(false);
  const [cleanupRunning, setCleanupRunning] = useState(false);
  const [cleanupStats, setCleanupStats] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'health' | 'backups'>('overview');

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (selectedUnternehmenId) params.set('unternehmenId', selectedUnternehmenId);
      const res = await authFetch(`/api/metrics?${params}`);
      if (res.ok) setMetrics(await res.json());
    } finally {
      setLoading(false);
    }
  }, [days, selectedUnternehmenId]);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedUnternehmenId) params.set('unternehmenId', selectedUnternehmenId);
      const res = await authFetch(`/api/health/agents?${params}`);
      if (res.ok) setHealth(await res.json());
    } finally {
      setHealthLoading(false);
    }
  }, [selectedUnternehmenId]);

  const loadBackups = useCallback(async () => {
    const res = await authFetch('/api/system/backups');
    if (res.ok) {
      const data = await res.json();
      setBackups(data.backups || []);
    }
  }, []);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);
  useEffect(() => { loadHealth(); loadBackups(); }, [loadHealth, loadBackups]);

  const runBackup = async () => {
    setBackupRunning(true);
    try {
      await authFetch('/api/system/backups', { method: 'POST' });
      await loadBackups();
    } finally {
      setBackupRunning(false);
    }
  };

  const runCleanup = async () => {
    setCleanupRunning(true);
    setCleanupStats(null);
    try {
      const res = await authFetch('/api/system/cleanup', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setCleanupStats(data.stats);
      }
    } finally {
      setCleanupRunning(false);
    }
  };

  const maxDailyCost = metrics ? Math.max(...metrics.dailyCosts.map(d => d.kostenCent), 1) : 1;
  const maxAgentCost = metrics ? Math.max(...metrics.costPerAgent.map(a => a.kostenCent), 1) : 1;

  const taskTotal = metrics?.taskStats.reduce((s, t) => s + t.cnt, 0) || 0;
  const runTotal = metrics?.runStats.reduce((s, r) => s + r.cnt, 0) || 0;

  const alertCount = health
    ? health.stuckAgents.length + health.errorAgents.length + health.loopyWakeups.length + health.recentFailures.length
    : 0;

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', margin: 0 }}>
            {t.metriken.title}
          </h1>
          <p style={{ color: '#71717a', margin: '0.25rem 0 0', fontSize: '0.875rem' }}>
            {t.metriken.subtitle}
          </p>
        </div>
        <button onClick={loadMetrics} style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.5rem 1rem', borderRadius: 8,
          background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
          color: '#23CDCB', cursor: 'pointer', fontSize: '0.8125rem',
        }}>
          <RefreshCw size={14} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {t.metriken.refresh}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '0.25rem', width: 'fit-content' }}>
        {[
          { id: 'overview', label: t.metriken.tabOverview, icon: BarChart3 },
          { id: 'health', label: `${t.metriken.tabHealth}${alertCount > 0 ? ` (${alertCount})` : ''}`, icon: alertCount > 0 ? AlertTriangle : Shield },
          { id: 'backups', label: t.metriken.tabBackups, icon: Database },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 1rem', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontSize: '0.8125rem', fontWeight: 500,
            background: activeTab === tab.id ? 'rgba(35,205,202,0.15)' : 'transparent',
            color: activeTab === tab.id ? '#23CDCB' : '#71717a',
          }}>
            <tab.icon size={14} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <>
          {/* Period selector */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
            {[7, 14, 30, 90].map(d => (
              <button key={d} onClick={() => setDays(d)} style={{
                padding: '0.375rem 0.75rem', borderRadius: 8, border: '1px solid',
                borderColor: days === d ? 'rgba(35,205,202,0.4)' : 'rgba(255,255,255,0.08)',
                background: days === d ? 'rgba(35,205,202,0.1)' : 'transparent',
                color: days === d ? '#23CDCB' : '#a1a1aa',
                fontSize: '0.8125rem', cursor: 'pointer',
              }}>
                {d} Tage
              </button>
            ))}
          </div>

          {/* Summary cards */}
          {metrics && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
              <StatCard icon={DollarSign} label="Gesamtkosten" value={centToEuro(metrics.totals.kostenCent)} sub={`letzte ${days} Tage`} />
              <StatCard icon={Zap} label="Input-Tokens" value={fmtNumber(metrics.totals.inputTokens || 0)} color="#60a5fa" />
              <StatCard icon={TrendingUp} label="Output-Tokens" value={fmtNumber(metrics.totals.outputTokens || 0)} color="#a78bfa" />
              <StatCard icon={Activity} label="Ausführungen" value={fmtNumber(runTotal)} sub={`${metrics.runStats.find(r => r.status === 'succeeded')?.cnt || 0} erfolgreich`} color="#22c55e" />
            </div>
          )}

          {!loading && metrics && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>

              {/* Daily cost chart */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#a1a1aa', fontWeight: 600 }}>
                  Tageskosten (letzte {days} Tage)
                </h3>
                {metrics.dailyCosts.length === 0
                  ? <p style={{ color: '#52525b', fontSize: '0.8rem' }}>Keine Daten</p>
                  : (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 100 }}>
                      {metrics.dailyCosts.slice(-30).map(d => {
                        const pct = maxDailyCost > 0 ? (d.kostenCent / maxDailyCost) * 100 : 0;
                        return (
                          <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
                            title={`${d.day}: ${centToEuro(d.kostenCent)} (${d.runs} Runs)`}>
                            <div style={{
                              width: '100%', minWidth: 4, background: '#23CDCB',
                              height: `${Math.max(pct, 2)}%`, borderRadius: '3px 3px 0 0',
                              opacity: 0.8, transition: 'height 0.3s ease',
                            }} />
                          </div>
                        );
                      })}
                    </div>
                  )
                }
              </div>

              {/* Cost per agent */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#a1a1aa', fontWeight: 600 }}>
                  Kosten pro Agent
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                  {metrics.costPerAgent.slice(0, 8).map(a => (
                    <div key={a.expertId} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                      <span style={{ width: 110, fontSize: '0.75rem', color: '#d4d4d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {a.expertName || 'Unbekannt'}
                      </span>
                      <MiniBar value={a.kostenCent} max={maxAgentCost} color="#23CDCB" />
                      <span style={{ width: 60, fontSize: '0.7rem', color: '#71717a', textAlign: 'right', flexShrink: 0 }}>
                        {centToEuro(a.kostenCent)}
                      </span>
                    </div>
                  ))}
                  {metrics.costPerAgent.length === 0 && (
                    <p style={{ color: '#52525b', fontSize: '0.8rem' }}>Keine Kosten erfasst</p>
                  )}
                </div>
              </div>

              {/* Task status distribution */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#a1a1aa', fontWeight: 600 }}>
                  Aufgaben nach Status
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {metrics.taskStats.sort((a, b) => b.cnt - a.cnt).map(s => (
                    <div key={s.status} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: TASK_STATUS_COLOR[s.status] || '#52525b',
                      }} />
                      <span style={{ flex: 1, fontSize: '0.75rem', color: '#d4d4d8', textTransform: 'capitalize' }}>{s.status}</span>
                      <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff' }}>{fmtNumber(s.cnt)}</span>
                      <span style={{ fontSize: '0.7rem', color: '#52525b', width: 36, textAlign: 'right' }}>
                        {taskTotal > 0 ? `${Math.round((s.cnt / taskTotal) * 100)}%` : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Run status + agent activity */}
              <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 1rem', fontSize: '0.875rem', color: '#a1a1aa', fontWeight: 600 }}>
                  Aktivste Agenten
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {metrics.agentActivity.slice(0, 8).map(a => {
                    const successRate = a.totalRuns > 0 ? Math.round((a.succeededRuns / a.totalRuns) * 100) : 0;
                    return (
                      <div key={a.expertId} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                        <span style={{ flex: 1, fontSize: '0.75rem', color: '#d4d4d8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {a.expertName || 'Unbekannt'}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#71717a' }}>{fmtNumber(a.totalRuns)} Runs</span>
                        <span style={{
                          fontSize: '0.7rem', fontWeight: 600, width: 38, textAlign: 'right',
                          color: successRate >= 80 ? '#22c55e' : successRate >= 50 ? '#f59e0b' : '#ef4444',
                        }}>
                          {successRate}%
                        </span>
                      </div>
                    );
                  })}
                  {metrics.agentActivity.length === 0 && (
                    <p style={{ color: '#52525b', fontSize: '0.8rem' }}>Keine Aktivität</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(35,205,202,0.2)', borderTopColor: '#23CDCB', animation: 'spin 0.8s linear infinite' }} />
            </div>
          )}
        </>
      )}

      {/* ── HEALTH TAB ───────────────────────────────────────────────────────── */}
      {activeTab === 'health' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {healthLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '3rem' }}>
              <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(35,205,202,0.2)', borderTopColor: '#23CDCB', animation: 'spin 0.8s linear infinite' }} />
            </div>
          ) : health && (
            <>
              {/* Overall health badge */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.75rem',
                padding: '0.875rem 1.25rem', borderRadius: 12,
                background: health.healthy ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${health.healthy ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
              }}>
                {health.healthy
                  ? <CheckCircle size={18} style={{ color: '#22c55e' }} />
                  : <AlertTriangle size={18} style={{ color: '#ef4444' }} />}
                <span style={{ fontWeight: 600, color: health.healthy ? '#22c55e' : '#ef4444' }}>
                  {health.healthy ? 'Alle Agenten gesund' : `${alertCount} Problem(e) erkannt`}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#52525b' }}>
                  Geprüft: {new Date(health.checkedAt).toLocaleTimeString('de-DE')}
                </span>
                <button onClick={loadHealth} style={{
                  padding: '0.25rem 0.625rem', borderRadius: 6, border: '1px solid rgba(255,255,255,0.1)',
                  background: 'transparent', color: '#71717a', cursor: 'pointer', fontSize: '0.75rem',
                }}>
                  <RefreshCw size={12} />
                </button>
              </div>

              {/* Stuck agents */}
              {health.stuckAgents.length > 0 && (
                <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={14} /> Feststeckende Agenten (&gt;5 Minuten in &apos;running&apos;)
                  </h3>
                  {health.stuckAgents.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0', borderTop: '1px solid rgba(239,68,68,0.1)' }}>
                      <span style={{ color: '#fca5a5', fontWeight: 500 }}>{a.name}</span>
                      <span style={{ color: '#52525b', fontSize: '0.75rem' }}>
                        seit {new Date(a.letzterZyklus).toLocaleTimeString('de-DE')}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Error agents */}
              {health.errorAgents.length > 0 && (
                <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#ef4444', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={14} /> Agenten im Fehlerstatus
                  </h3>
                  {health.errorAgents.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0', borderTop: '1px solid rgba(239,68,68,0.1)' }}>
                      <span style={{ color: '#fca5a5', fontWeight: 500 }}>{a.name}</span>
                      <span style={{ color: '#52525b', fontSize: '0.75rem' }}>
                        letzter Zyklus: {a.letzterZyklus ? new Date(a.letzterZyklus).toLocaleString('de-DE') : 'nie'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Loop detection */}
              {health.loopyWakeups.length > 0 && (
                <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#f59e0b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={14} /> Mögliche Endlosschleifen (coalescedCount &ge; 10)
                  </h3>
                  {health.loopyWakeups.map((w, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0', borderTop: '1px solid rgba(245,158,11,0.1)' }}>
                      <span style={{ color: '#fde68a', fontWeight: 500 }}>{w.expertName}</span>
                      <span style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', borderRadius: 6, padding: '2px 6px', fontSize: '0.7rem', fontWeight: 700 }}>
                        ×{w.coalescedCount}
                      </span>
                      <span style={{ color: '#52525b', fontSize: '0.75rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {w.reason}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Recent failures */}
              {health.recentFailures.length > 0 && (
                <div style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 12, padding: '1.25rem' }}>
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '0.875rem', color: '#f87171', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertTriangle size={14} /> Häufige Fehler (letzte 24h, &ge; 3 Fehlschläge)
                  </h3>
                  {health.recentFailures.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.5rem 0', borderTop: '1px solid rgba(239,68,68,0.1)' }}>
                      <span style={{ color: '#fca5a5', fontWeight: 500 }}>{f.expertName}</span>
                      <span style={{ color: '#ef4444', fontWeight: 700 }}>{f.failCount}×</span>
                      <span style={{ color: '#52525b', fontSize: '0.75rem' }}>fehlgeschlagen</span>
                    </div>
                  ))}
                </div>
              )}

              {health.healthy && (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#22c55e', fontSize: '0.875rem' }}>
                  <CheckCircle size={32} style={{ marginBottom: 8 }} />
                  <div>Kein Problem erkannt. Alle Agenten arbeiten normal.</div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── BACKUPS TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'backups' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button onClick={runBackup} disabled={backupRunning} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.625rem 1.25rem', borderRadius: 8,
              background: backupRunning ? 'rgba(35,205,202,0.05)' : 'rgba(35,205,202,0.1)',
              border: '1px solid rgba(35,205,202,0.25)', color: '#23CDCB',
              cursor: backupRunning ? 'not-allowed' : 'pointer', fontSize: '0.8125rem', fontWeight: 500,
            }}>
              <Download size={14} style={{ animation: backupRunning ? 'spin 1s linear infinite' : 'none' }} />
              {backupRunning ? t.metriken.backingUp : t.metriken.backupNow}
            </button>

            <button onClick={runCleanup} disabled={cleanupRunning} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.625rem 1.25rem', borderRadius: 8,
              background: cleanupRunning ? 'rgba(239,68,68,0.03)' : 'rgba(239,68,68,0.06)',
              border: '1px solid rgba(239,68,68,0.2)', color: '#f87171',
              cursor: cleanupRunning ? 'not-allowed' : 'pointer', fontSize: '0.8125rem', fontWeight: 500,
            }}>
              <Trash2 size={14} style={{ animation: cleanupRunning ? 'spin 1s linear infinite' : 'none' }} />
              {cleanupRunning ? t.metriken.cleanupRunning : t.metriken.cleanupNow}
            </button>
          </div>

          {/* Cleanup result */}
          {cleanupStats && (
            <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 12, padding: '1rem 1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <CheckCircle size={14} style={{ color: '#22c55e' }} />
                <span style={{ color: '#22c55e', fontWeight: 600, fontSize: '0.875rem' }}>Cleanup abgeschlossen</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.5rem' }}>
                {Object.entries(cleanupStats).map(([key, val]) => (
                  <div key={key} style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>
                    <span style={{ color: '#d4d4d8', fontWeight: 500 }}>{val as number}</span>{' '}
                    {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Backup list */}
          <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={14} style={{ color: '#71717a' }} />
              <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#a1a1aa' }}>
                Gespeicherte Backups ({backups.length}/7)
              </span>
            </div>
            {backups.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#52525b', fontSize: '0.875rem' }}>
                Noch kein Backup vorhanden. Klicke &quot;Jetzt sichern&quot; um das erste zu erstellen.
              </div>
            ) : (
              backups.map(b => (
                <div key={b.name} style={{
                  display: 'flex', alignItems: 'center', gap: '1rem',
                  padding: '0.875rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}>
                  <Database size={14} style={{ color: '#23CDCB', flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '0.8125rem', color: '#d4d4d8', fontFamily: 'monospace' }}>
                    {b.name}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#52525b' }}>
                    {(b.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#52525b' }}>
                    {new Date(b.createdAt).toLocaleDateString('de-DE')}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Policy info */}
          <div style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 10, fontSize: '0.8rem', color: '#52525b', lineHeight: 1.6 }}>
            <strong style={{ color: '#71717a' }}>Backup-Strategie:</strong>{' '}
            Täglich automatisch via SQLite hot-backup. Maximale Aufbewahrung: 7 Tage (älteste werden automatisch gelöscht).
            Cleanup läuft alle 6 Stunden: Session-Files (&gt;7 Tage), Ausführungsläufe (&gt;30 Tage),
            abgelaufene Wakeups, alte Trace-Events (&gt;14 Tage), überzählige Memory-Versionen.
          </div>
        </div>
      )}
    </div>
  );
}
