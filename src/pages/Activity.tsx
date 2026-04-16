import { useState, useMemo } from 'react';
import { Loader2, Activity as ActivityIcon, Filter, X } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { zeitRelativ } from '../utils/i18n';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import { apiAktivitaet, type Aktivitaet as AktivitaetType } from '../api/client';
import { GlassCard } from '../components/GlassCard';

const typFarben: Record<string, string> = {
  aufgabe: '#3b82f6', experte: '#23CDCB', kosten: '#22c55e',
  genehmigung: '#eab308', system: '#71717a', unternehmen: '#a855f7',
};

// ── Activity Heatmap ──────────────────────────────────────────────────────────

function ActivityHeatmap({ data, de }: { data: AktivitaetType[]; de: boolean }) {
  const [tooltip, setTooltip] = useState<{ day: string; count: number; x: number; y: number } | null>(null);

  // Build last 28 days (4 weeks) — Monday-first
  const days = useMemo(() => {
    const result: string[] = [];
    const today = new Date();
    const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    // Align to Monday
    const dow = (base.getDay() + 6) % 7; // 0=Mon
    const startOffset = -(27 + dow % 7);
    for (let i = startOffset; i <= 0; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      result.push(`${y}-${m}-${day}`);
    }
    // Pad front to fill complete weeks
    while (result.length % 7 !== 0) result.unshift('');
    // Keep last 28
    return result.slice(-28);
  }, []);

  const countsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of data) {
      const day = a.erstelltAm.slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + 1);
    }
    return map;
  }, [data]);

  const maxCount = useMemo(() => Math.max(...Array.from(countsByDay.values()), 1), [countsByDay]);

  function cellColor(count: number): string {
    if (count === 0) return 'rgba(255,255,255,0.05)';
    const pct = count / maxCount;
    if (pct >= 0.75) return 'rgba(35,205,202,0.85)';
    if (pct >= 0.50) return 'rgba(35,205,202,0.55)';
    if (pct >= 0.25) return 'rgba(35,205,202,0.30)';
    return 'rgba(35,205,202,0.12)';
  }

  const DOW_LABELS = de
    ? ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
    : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  const totalEvents = data.length;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = countsByDay.get(today) ?? 0;
  const peakDay = [...countsByDay.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <GlassCard style={{ padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569', letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: '0.2rem' }}>
            {de ? 'Aktivitätsverlauf (28 Tage)' : 'Activity History (28 days)'}
          </div>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
              <strong style={{ color: '#f1f5f9' }}>{totalEvents}</strong> {de ? 'Ereignisse gesamt' : 'total events'}
            </span>
            <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
              <strong style={{ color: '#23CDCB' }}>{todayCount}</strong> {de ? 'heute' : 'today'}
            </span>
            {peakDay && (
              <span style={{ fontSize: '0.8125rem', color: '#64748b' }}>
                {de ? 'Peak:' : 'Peak:'} <strong style={{ color: '#f1f5f9' }}>{peakDay[1]}</strong> {de ? 'am' : 'on'} {peakDay[0]}
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{ fontSize: '0.6875rem', color: '#334155' }}>{de ? 'Weniger' : 'Less'}</span>
          {[0, 0.15, 0.35, 0.6, 0.9].map((pct, i) => (
            <div key={i} style={{
              width: 12, height: 12, borderRadius: '3px',
              background: pct === 0 ? 'rgba(255,255,255,0.05)' : `rgba(35,205,202,${pct})`,
            }} />
          ))}
          <span style={{ fontSize: '0.6875rem', color: '#334155' }}>{de ? 'Mehr' : 'More'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
        {/* DOW labels */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingTop: '0px', flexShrink: 0 }}>
          {DOW_LABELS.map(d => (
            <div key={d} style={{ height: 16, fontSize: '0.625rem', color: '#334155', display: 'flex', alignItems: 'center' }}>{d}</div>
          ))}
        </div>

        {/* Heatmap grid — column per week, row per day-of-week */}
        <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
              {week.map((day, di) => {
                const count = day ? (countsByDay.get(day) ?? 0) : 0;
                const isToday = day === today;
                return (
                  <div
                    key={di}
                    title={day ? `${day}: ${count} event${count !== 1 ? 's' : ''}` : ''}
                    onMouseEnter={e => {
                      if (day) {
                        const rect = (e.target as HTMLElement).getBoundingClientRect();
                        setTooltip({ day, count, x: rect.left, y: rect.top });
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                    style={{
                      height: 16, borderRadius: '3px',
                      background: day ? cellColor(count) : 'transparent',
                      border: isToday ? '1px solid rgba(35,205,202,0.7)' : '1px solid transparent',
                      cursor: day ? 'default' : 'default',
                      transition: 'transform 0.1s',
                    }}
                    onMouseDown={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.4)'; }}
                    onMouseUp={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Month labels */}
      <div style={{ display: 'flex', gap: '4px', marginTop: '6px', paddingLeft: '28px' }}>
        {weeks.map((week, wi) => {
          const firstDay = week.find(d => d);
          if (!firstDay) return <div key={wi} style={{ flex: 1 }} />;
          const d = new Date(firstDay + 'T12:00:00');
          const showMonth = wi === 0 || d.getDate() <= 7;
          return (
            <div key={wi} style={{ flex: 1 }}>
              {showMonth && (
                <span style={{ fontSize: '0.5625rem', color: '#334155' }}>
                  {d.toLocaleDateString(de ? 'de-DE' : 'en-US', { month: 'short' })}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

// ── Group by date ─────────────────────────────────────────────────────────────

function groupByDate(items: AktivitaetType[]): { dateLabel: string; items: AktivitaetType[] }[] {
  const groups = new Map<string, AktivitaetType[]>();
  for (const a of items) {
    const day = a.erstelltAm.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(a);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({ dateLabel: day, items }));
}

function formatDateLabel(day: string, de: boolean): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (day === today) return de ? 'Heute' : 'Today';
  if (day === yesterday) return de ? 'Gestern' : 'Yesterday';
  const d = new Date(day + 'T12:00:00');
  return d.toLocaleDateString(de ? 'de-DE' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ── Main ──────────────────────────────────────────────────────────────────────

export function Activity() {
  const i18n = useI18n();
  const de = i18n.language === 'de';
  const typLabels: Record<string, string> = {
    aufgabe:     i18n.t.aktivitaet.types.aufgabe,
    experte:     i18n.t.aktivitaet.types.experte,
    kosten:      i18n.t.aktivitaet.types.kosten,
    genehmigung: i18n.t.aktivitaet.types.genehmigung,
    unternehmen: i18n.t.aktivitaet.types.unternehmen,
  };

  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', i18n.t.nav.aktivitaet]);

  // Fetch with higher limit for heatmap data (covers ~30 days easily)
  const { data, loading } = useApi<AktivitaetType[]>(
    () => apiAktivitaet.liste(aktivesUnternehmen!.id, 1000),
    [aktivesUnternehmen?.id],
  );

  const [filterTyp, setFilterTyp]     = useState<string | null>(null);
  const [filterAkteur, setFilterAkteur] = useState<string | null>(null);

  const alleAkteure = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.map(a => a.akteurName))].sort();
  }, [data]);

  const alleTypen = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.map(a => a.entitaetTyp))];
  }, [data]);

  const gefiltert = useMemo(() => {
    if (!data) return [];
    return data.filter(a => {
      if (filterTyp   && a.entitaetTyp !== filterTyp)   return false;
      if (filterAkteur && a.akteurName  !== filterAkteur) return false;
      return true;
    });
  }, [data, filterTyp, filterAkteur]);

  const grouped = useMemo(() => groupByDate(gefiltert), [gefiltert]);

  if (!aktivesUnternehmen) return null;

  if (loading || !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#23CDCB' }} />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <ActivityIcon size={20} style={{ color: '#23CDCB' }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#23CDCB', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {aktivesUnternehmen.name}
          </span>
        </div>
        <h1 style={{
          fontSize: '2rem', fontWeight: 700, margin: 0,
          background: 'linear-gradient(135deg, #23CDCB 0%, #f8fafc 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          {i18n.t.nav.aktivitaet}
        </h1>
        <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.25rem' }}>
          {de ? 'Alle Aktionen und Ereignisse in Ihrem Unternehmen' : 'All actions and events across your company'}
        </p>
      </div>

      <PageHelp id="activity" lang={de ? 'de' : 'en'} />

      {/* Heatmap */}
      <ActivityHeatmap data={data} de={de} />

      {/* Filter Bar */}
      <GlassCard style={{ padding: '0.75rem 1rem', marginBottom: '1.5rem', borderRadius: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
        <Filter size={13} style={{ color: '#52525b', flexShrink: 0 }} />
        <span style={{ fontSize: '0.6875rem', color: '#52525b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
          {de ? 'Filter' : 'Filter'}
        </span>

        {alleTypen.map(typ => (
          <button key={typ} onClick={() => setFilterTyp(filterTyp === typ ? null : typ)} style={{
            padding: '0.2rem 0.5rem', borderRadius: '9999px', cursor: 'pointer',
            fontSize: '0.6875rem', fontWeight: 600,
            background: filterTyp === typ ? (typFarben[typ] || '#71717a') + '22' : 'transparent',
            border: `1px solid ${filterTyp === typ ? typFarben[typ] || '#71717a' : 'rgba(255,255,255,0.08)'}`,
            color: filterTyp === typ ? typFarben[typ] || '#d4d4d8' : '#71717a',
          }}>
            {typLabels[typ] || typ}
          </button>
        ))}

        {alleAkteure.length > 0 && (
          <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
        )}

        {alleAkteure.slice(0, 6).map(name => (
          <button key={name} onClick={() => setFilterAkteur(filterAkteur === name ? null : name)} style={{
            padding: '0.2rem 0.5rem', borderRadius: '9999px', cursor: 'pointer',
            fontSize: '0.6875rem', fontWeight: 600,
            background: filterAkteur === name ? 'rgba(35,205,202,0.12)' : 'transparent',
            border: `1px solid ${filterAkteur === name ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.08)'}`,
            color: filterAkteur === name ? '#23CDCB' : '#71717a',
          }}>
            {name}
          </button>
        ))}

        {(filterTyp || filterAkteur) && (
          <button onClick={() => { setFilterTyp(null); setFilterAkteur(null); }} style={{
            display: 'flex', alignItems: 'center', gap: '0.25rem',
            padding: '0.2rem 0.5rem', borderRadius: '9999px', cursor: 'pointer',
            fontSize: '0.6875rem', background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444',
          }}>
            <X size={10} /> {de ? 'Zurücksetzen' : 'Reset'}
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: '#334155' }}>
          {gefiltert.length} {de ? 'Ereignisse' : 'events'}
        </span>
      </div>
      </GlassCard>

      {/* Activity Feed — grouped by date */}
      <GlassCard>
        {grouped.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <ActivityIcon size={32} style={{ color: '#23CDCB', opacity: 0.2, margin: '0 auto 1rem', display: 'block' }} />
            <p style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#475569', margin: '0 0 0.25rem' }}>
              {de ? 'Keine Aktivitäten' : 'No activities'}
            </p>
            <p style={{ fontSize: '0.8125rem', color: '#334155', margin: 0 }}>
              {filterTyp || filterAkteur
                ? (de ? 'Versuche andere Filter' : 'Try different filters')
                : (de ? 'Aktivitäten erscheinen hier, sobald Agenten arbeiten' : 'Activities appear here as agents work')}
            </p>
          </div>
        ) : (
          grouped.map(group => (
            <div key={group.dateLabel}>
              {/* Date header */}
              <div style={{
                padding: '0.625rem 1.5rem',
                background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)',
                display: 'flex', alignItems: 'center', gap: '0.75rem',
              }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#475569' }}>
                  {formatDateLabel(group.dateLabel, de)}
                </span>
                <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.05)' }} />
                <span style={{ fontSize: '0.625rem', color: '#334155', fontWeight: 600 }}>
                  {group.items.length} {de ? 'Ereignisse' : 'events'}
                </span>
              </div>

              {/* Events for this day */}
              {group.items.map((a, i) => (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: '1rem',
                  padding: '0.875rem 1.5rem',
                  borderBottom: i < group.items.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                  transition: 'background 0.1s',
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <div style={{
                    width: 9, height: 9, borderRadius: '50%', marginTop: '0.35rem', flexShrink: 0,
                    background: typFarben[a.entitaetTyp] || '#71717a',
                    boxShadow: `0 0 8px ${(typFarben[a.entitaetTyp] || '#71717a')}40`,
                  }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                      <span style={{
                        padding: '0.1rem 0.4rem', borderRadius: '5px',
                        fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.04em',
                        background: (typFarben[a.entitaetTyp] || '#71717a') + '18',
                        color: typFarben[a.entitaetTyp] || '#d4d4d8',
                        textTransform: 'uppercase',
                      }}>
                        {typLabels[a.entitaetTyp] || a.entitaetTyp}
                      </span>
                    </div>
                    <p style={{ fontSize: '0.875rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
                      <strong style={{ color: '#f1f5f9', fontWeight: 600 }}>{a.akteurName}</strong>
                      {' '}
                      <span style={{ color: '#64748b' }}>{a.aktion}</span>
                    </p>
                  </div>
                  <span style={{ fontSize: '0.6875rem', color: '#334155', flexShrink: 0, marginTop: '0.25rem' }}>
                    {zeitRelativ(a.erstelltAm, i18n.t)}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </GlassCard>
    </div>
  );
}
