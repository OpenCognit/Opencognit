/**
 * AgentCharts — Pure CSS/Flex mini-charts for the Agent Overview tab.
 * No external chart libraries needed.
 */

import React from 'react';

export interface RunStat {
  status: string;
  erstelltAm: string;
}

export interface TaskStat {
  status: string;
  prioritaet: string;
  erstelltAm: string;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function getLast14Days(): string[] {
  const today = new Date();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() - (13 - i));
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
}

function fmtDay(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ─── Shared Primitives ────────────────────────────────────────────────────────

function DateLabels({ days }: { days: string[] }) {
  return (
    <div style={{ display: 'flex', gap: 3, marginTop: 5 }}>
      {days.map((day, i) => (
        <div key={day} style={{ flex: 1, textAlign: 'center' }}>
          {(i === 0 || i === 6 || i === 13) ? (
            <span style={{ fontSize: 8, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums', opacity: 0.6 }}>
              {fmtDay(day)}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 8px', marginTop: 8 }}>
      {items.map(item => (
        <span key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.75 }}>
          <span style={{ width: 7, height: 7, borderRadius: 0, background: item.color, flexShrink: 0 }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({ title, subtitle, badge, children }: {
  title: string;
  subtitle?: string;
  badge?: string | number;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 0,
      padding: '14px 16px',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Subtle top-left accent */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, rgba(197,160,89,0.3), transparent)', borderRadius: '0' }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.55, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {badge !== undefined && (
          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--color-accent)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
            {badge}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  // Show subtle placeholder bars
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
        {Array.from({ length: 14 }, (_, i) => (
          <div key={i} style={{
            flex: 1, height: `${8 + Math.sin(i * 0.9) * 6 + Math.random() * 4}%`,
            background: 'rgba(255,255,255,0.04)', borderRadius: '0',
          }} />
        ))}
      </div>
      <p style={{ fontSize: 10, color: 'var(--color-text-muted)', opacity: 0.4, marginTop: 8, marginBottom: 0, textAlign: 'center' }}>{label}</p>
    </div>
  );
}

// ─── Run Activity Chart ───────────────────────────────────────────────────────

export function RunActivityChart({ runs, emptyLabel = 'No runs yet' }: { runs: RunStat[]; emptyLabel?: string }) {
  const days = getLast14Days();
  const grouped = new Map<string, { succeeded: number; failed: number; other: number }>();
  for (const day of days) grouped.set(day, { succeeded: 0, failed: 0, other: 0 });

  for (const run of runs) {
    const day = run.erstelltAm.slice(0, 10);
    const entry = grouped.get(day);
    if (!entry) continue;
    if (run.status === 'succeeded') entry.succeeded++;
    else if (run.status === 'failed' || run.status === 'timed_out') entry.failed++;
    else entry.other++;
  }

  const maxValue = Math.max(...Array.from(grouped.values()).map(v => v.succeeded + v.failed + v.other), 1);
  const hasData = Array.from(grouped.values()).some(v => v.succeeded + v.failed + v.other > 0);
  const total = runs.length;

  if (!hasData) return <EmptyChart label={emptyLabel} />;

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-accent)', marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
        {total} <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.6 }}>runs</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
        {days.map(day => {
          const e = grouped.get(day)!;
          const total = e.succeeded + e.failed + e.other;
          const heightPct = (total / maxValue) * 100;
          return (
            <div key={day} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }} title={`${day}: ${total} runs`}>
              {total > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'hidden', height: `${heightPct}%`, minHeight: 3, borderRadius: '0' }}>
                  {e.failed > 0 && <div style={{ flex: e.failed, background: 'rgba(239,68,68,0.85)', borderRadius: '0' }} />}
                  {e.other > 0 && <div style={{ flex: e.other, background: 'rgba(107,114,128,0.7)' }} />}
                  {e.succeeded > 0 && <div style={{ flex: e.succeeded, background: 'rgba(197,160,89,0.85)' }} />}
                </div>
              ) : (
                <div style={{ height: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 0 }} />
              )}
            </div>
          );
        })}
      </div>
      <DateLabels days={days} />
      <Legend items={[{ color: '#c5a059', label: 'OK' }, { color: '#ef4444', label: 'Error' }, { color: '#6b7280', label: 'Other' }]} />
    </div>
  );
}

// ─── Priority Chart ───────────────────────────────────────────────────────────

const priorityColors: Record<string, string> = {
  critical: 'rgba(239,68,68,0.85)',
  high: 'rgba(249,115,22,0.85)',
  medium: 'rgba(234,179,8,0.85)',
  low: 'rgba(107,114,128,0.7)',
};
const priorityOrder = ['critical', 'high', 'medium', 'low'] as const;

export function PriorityChart({ tasks, emptyLabel = 'No tasks' }: { tasks: TaskStat[]; emptyLabel?: string }) {
  if (!tasks.length) return <EmptyChart label={emptyLabel} />;

  // Donut-style breakdown instead of bars
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const t of tasks) {
    if (t.prioritaet in counts) counts[t.prioritaet as keyof typeof counts]++;
  }
  const total = tasks.length;

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-accent)', marginBottom: 10, fontVariantNumeric: 'tabular-nums' }}>
        {total} <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.6 }}>tasks</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {priorityOrder.filter(p => counts[p] > 0).map(p => {
          const pct = Math.round((counts[p] / total) * 100);
          return (
            <div key={p}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 9, textTransform: 'capitalize', color: 'var(--color-text-muted)', opacity: 0.7 }}>{p}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-secondary)' }}>{counts[p]}</span>
              </div>
              <div style={{ height: 4, borderRadius: 0, background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 0, background: priorityColors[p], transition: 'width 0.5s ease' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Status Chart ─────────────────────────────────────────────────────────────

const statusColors: Record<string, string> = {
  todo: 'rgba(59,130,246,0.85)',
  offen: 'rgba(59,130,246,0.85)',
  in_progress: 'rgba(155,135,200,0.85)',
  in_review: 'rgba(155,135,200,0.85)',
  done: 'rgba(197,160,89,0.85)',
  abgeschlossen: 'rgba(197,160,89,0.85)',
  blocked: 'rgba(239,68,68,0.85)',
  cancelled: 'rgba(107,114,128,0.6)',
  backlog: 'rgba(100,116,139,0.6)',
};

const statusLabels: Record<string, string> = {
  todo: 'To Do', offen: 'Open', in_progress: 'In Progress', in_review: 'Review',
  done: 'Done', abgeschlossen: 'Done', blocked: 'Blocked', cancelled: 'Cancelled', backlog: 'Backlog',
};

export function StatusChart({ tasks, emptyLabel = 'No tasks' }: { tasks: TaskStat[]; emptyLabel?: string }) {
  if (!tasks.length) return <EmptyChart label={emptyLabel} />;

  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status] = (counts[t.status] ?? 0) + 1;
  const total = tasks.length;
  const statuses = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);

  const doneCount = (counts['done'] ?? 0) + (counts['abgeschlossen'] ?? 0);
  const completionRate = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--color-accent)', marginBottom: 4, fontVariantNumeric: 'tabular-nums' }}>
        {completionRate}% <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.6 }}>done</span>
      </div>
      {/* Progress bar */}
      <div style={{ height: 5, borderRadius: 0, background: 'rgba(255,255,255,0.06)', marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${completionRate}%`, background: 'linear-gradient(90deg, rgba(197,160,89,0.6), rgba(197,160,89,0.9))', borderRadius: 0, transition: 'width 0.5s ease' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {statuses.map(s => {
          const pct = Math.round((counts[s] / total) * 100);
          return (
            <div key={s}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 9, color: 'var(--color-text-muted)', opacity: 0.7 }}>{statusLabels[s] ?? s}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-text-secondary)' }}>{counts[s]}</span>
              </div>
              <div style={{ height: 4, borderRadius: 0, background: 'rgba(255,255,255,0.06)' }}>
                <div style={{ height: '100%', width: `${pct}%`, borderRadius: 0, background: statusColors[s] ?? 'rgba(107,114,128,0.7)', transition: 'width 0.5s ease' }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Success Rate Chart ───────────────────────────────────────────────────────

export function SuccessRateChart({ runs, emptyLabel = 'No runs yet' }: { runs: RunStat[]; emptyLabel?: string }) {
  const days = getLast14Days();
  const grouped = new Map<string, { succeeded: number; total: number }>();
  for (const day of days) grouped.set(day, { succeeded: 0, total: 0 });

  for (const run of runs) {
    const day = run.erstelltAm.slice(0, 10);
    const entry = grouped.get(day);
    if (!entry) continue;
    entry.total++;
    if (run.status === 'succeeded') entry.succeeded++;
  }

  const hasData = Array.from(grouped.values()).some(v => v.total > 0);
  if (!hasData) return <EmptyChart label={emptyLabel} />;

  const totalRuns = runs.length;
  const totalSucceeded = runs.filter(r => r.status === 'succeeded').length;
  const globalRate = totalRuns > 0 ? Math.round((totalSucceeded / totalRuns) * 100) : 0;
  const rateColor = globalRate >= 80 ? '#c5a059' : globalRate >= 50 ? '#eab308' : '#ef4444';

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 800, color: rateColor, marginBottom: 8, fontVariantNumeric: 'tabular-nums' }}>
        {globalRate}% <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.6, color: 'var(--color-text-muted)' }}>success</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
        {days.map(day => {
          const e = grouped.get(day)!;
          const rate = e.total > 0 ? e.succeeded / e.total : 0;
          const color = e.total === 0 ? undefined : rate >= 0.8 ? 'rgba(197,160,89,0.85)' : rate >= 0.5 ? 'rgba(234,179,8,0.85)' : 'rgba(239,68,68,0.85)';
          return (
            <div key={day} style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
              title={`${day}: ${e.total > 0 ? Math.round(rate * 100) : 0}% (${e.succeeded}/${e.total})`}>
              {e.total > 0 ? (
                <div style={{ height: `${Math.max(rate * 100, 4)}%`, background: color, borderRadius: '0', minHeight: 3, position: 'relative' }}>
                  {rate >= 0.8 && <div style={{ position: 'absolute', inset: 0, background: 'rgba(197,160,89,0.2)', borderRadius: '0', filter: 'blur(3px)' }} />}
                </div>
              ) : (
                <div style={{ height: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 0 }} />
              )}
            </div>
          );
        })}
      </div>
      <DateLabels days={days} />
    </div>
  );
}
