import { useMemo, useRef, useState, useCallback } from 'react';
import { Calendar, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import type { Aufgabe, Experte } from '../api/client';

const STATUS_COLORS: Record<string, string> = {
  backlog: '#52525b',
  todo: '#3b82f6',
  in_progress: '#23CDCB',
  in_review: '#eab308',
  done: '#22c55e',
  blocked: '#ef4444',
};

const PRIORITY_STRIPE: Record<string, string> = {
  critical: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(239,68,68,0.15) 4px, rgba(239,68,68,0.15) 8px)',
  high: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(234,179,8,0.1) 4px, rgba(234,179,8,0.1) 8px)',
};

const ROW_H = 44;
const HEADER_H = 56;
const LABEL_W = 200;
const DAY_W = 48;
const TODAY_COLOR = 'rgba(35,205,202,0.12)';

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86400000);
}

function formatDate(d: Date, lang: string): string {
  return d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { month: 'short', day: 'numeric' });
}

function formatMonth(d: Date, lang: string): string {
  return d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { month: 'long', year: 'numeric' });
}

interface Props {
  aufgaben: Aufgabe[];
  experten: Experte[];
  lang: string;
  onSelect: (id: string) => void;
  i18n: any;
}

// Build timeline rows: group by agent, then unassigned
function buildRows(aufgaben: Aufgabe[], experten: Experte[]) {
  const byAgent = new Map<string | null, Aufgabe[]>();
  byAgent.set(null, []);
  experten.forEach(e => byAgent.set(e.id, []));

  aufgaben.forEach(a => {
    const key = a.zugewiesenAn ?? null;
    if (!byAgent.has(key)) byAgent.set(key, []);
    byAgent.get(key)!.push(a);
  });

  const rows: Array<{
    type: 'agent-header' | 'task';
    agentId: string | null;
    agent?: Experte;
    task?: Aufgabe;
  }> = [];

  // Assigned agents first
  experten.forEach(e => {
    const tasks = byAgent.get(e.id) || [];
    if (tasks.length === 0) return;
    rows.push({ type: 'agent-header', agentId: e.id, agent: e });
    tasks.forEach(t => rows.push({ type: 'task', agentId: e.id, agent: e, task: t }));
  });

  // Unassigned
  const unassigned = byAgent.get(null) || [];
  if (unassigned.length > 0) {
    rows.push({ type: 'agent-header', agentId: null });
    unassigned.forEach(t => rows.push({ type: 'task', agentId: null, task: t }));
  }

  return rows;
}

export function TimelineView({ aufgaben, experten, lang, onSelect, i18n }: Props) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewStart, setViewStart] = useState<Date>(() => {
    // Start view 7 days before today
    const s = addDays(today, -7);
    return s;
  });
  const DAYS = 42; // 6 weeks visible
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; task: Aufgabe } | null>(null);

  const viewEnd = useMemo(() => addDays(viewStart, DAYS), [viewStart]);

  const rows = useMemo(() => buildRows(aufgaben, experten), [aufgaben, experten]);

  const dayColumns = useMemo(() => {
    const cols: Date[] = [];
    for (let i = 0; i < DAYS; i++) {
      cols.push(addDays(viewStart, i));
    }
    return cols;
  }, [viewStart]);

  const todayOffset = useMemo(() => daysBetween(viewStart, today), [viewStart, today]);

  const navigate = useCallback((dir: number) => {
    setViewStart(prev => addDays(prev, dir * 14));
  }, []);

  const getBarGeometry = useCallback((task: Aufgabe) => {
    const created = startOfDay(new Date(task.erstelltAm));
    const started = task.gestartetAm ? startOfDay(new Date(task.gestartetAm)) : null;
    const completed = task.abgeschlossenAm ? startOfDay(new Date(task.abgeschlossenAm)) : null;

    let start = (started ?? created);
    if (start < viewStart) start = viewStart;

    let end: Date;
    if (completed) {
      end = completed;
    } else if (task.status === 'done') {
      end = addDays(start, 1);
    } else if (task.status === 'in_progress' || task.status === 'in_review') {
      end = today > viewStart ? today : viewStart;
      end = addDays(end, 1);
    } else {
      // Backlog / todo: show a 2-day estimate from start
      end = addDays(start, 2);
    }

    if (end > viewEnd) end = viewEnd;
    if (start >= viewEnd || end <= viewStart) return null;

    const x = Math.max(0, daysBetween(viewStart, start)) * DAY_W;
    const w = Math.max(DAY_W * 0.5, daysBetween(start, end) * DAY_W);
    return { x, w };
  }, [viewStart, viewEnd, today]);

  const totalWidth = DAYS * DAY_W;
  const totalHeight = rows.length * ROW_H;

  if (aufgaben.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: 300, gap: '0.75rem', color: '#52525b',
        background: 'rgba(255,255,255,0.02)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.06)',
      }}>
        <Calendar size={40} style={{ opacity: 0.3 }} />
        <p style={{ margin: 0, fontSize: '0.9375rem' }}>
          {lang === 'de' ? 'Keine Aufgaben für Timeline' : 'No tasks for timeline'}
        </p>
      </div>
    );
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      backdropFilter: 'blur(20px)',
      borderRadius: '16px',
      border: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden',
      animation: 'fadeInUp 0.4s ease-out',
    }}>
      {/* Controls */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '1rem 1.25rem',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Calendar size={15} style={{ color: '#23CDCB' }} />
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#d4d4d8' }}>
            {formatMonth(viewStart, lang)} — {formatMonth(addDays(viewStart, DAYS - 1), lang)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            onClick={() => setViewStart(addDays(today, -7))}
            style={{
              padding: '0.3rem 0.75rem', background: 'rgba(35,205,202,0.08)',
              border: '1px solid rgba(35,205,202,0.2)', borderRadius: '8px',
              color: '#23CDCB', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {lang === 'de' ? 'Heute' : 'Today'}
          </button>
          <button onClick={() => navigate(-1)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '0.3rem', cursor: 'pointer', color: '#a1a1aa', display: 'flex' }}>
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => navigate(1)} style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '0.3rem', cursor: 'pointer', color: '#a1a1aa', display: 'flex' }}>
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.5rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.04)', flexWrap: 'wrap' }}>
        {Object.entries(STATUS_COLORS).map(([key, color]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.6875rem', color: '#71717a' }}>
            <div style={{ width: 10, height: 10, borderRadius: '3px', background: color }} />
            {(i18n.status as any)[key] || key}
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.6875rem', color: '#71717a', marginLeft: 'auto' }}>
          <AlertCircle size={10} style={{ color: '#52525b' }} />
          {lang === 'de' ? 'Dunkel gestreift = kritische Priorität' : 'Striped = critical priority'}
        </div>
      </div>

      {/* Gantt area */}
      <div style={{ display: 'flex', overflow: 'hidden' }}>
        {/* Left label panel */}
        <div style={{
          width: LABEL_W, flexShrink: 0,
          borderRight: '1px solid rgba(255,255,255,0.06)',
          overflow: 'hidden',
        }}>
          {/* Header spacer */}
          <div style={{ height: HEADER_H, borderBottom: '1px solid rgba(255,255,255,0.06)' }} />
          {/* Row labels */}
          {rows.map((row, i) => (
            <div
              key={i}
              style={{
                height: ROW_H,
                display: 'flex',
                alignItems: 'center',
                padding: '0 0.875rem',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
                background: row.type === 'agent-header'
                  ? 'rgba(255,255,255,0.03)'
                  : 'transparent',
                gap: '0.5rem',
                overflow: 'hidden',
              }}
            >
              {row.type === 'agent-header' ? (
                <>
                  {row.agent ? (
                    <>
                      <div style={{
                        width: 24, height: 24, borderRadius: '8px', flexShrink: 0,
                        background: (row.agent.avatarFarbe || '#23CDCB') + '22',
                        color: row.agent.avatarFarbe || '#23CDCB',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.625rem', fontWeight: 700,
                      }}>
                        {row.agent.avatar}
                      </div>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.agent.name}
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#52525b' }}>
                      {lang === 'de' ? 'Nicht zugewiesen' : 'Unassigned'}
                    </span>
                  )}
                </>
              ) : (
                <span
                  style={{
                    fontSize: '0.75rem', color: row.task?.id === hoveredId ? '#ffffff' : '#a1a1aa',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    paddingLeft: '1.25rem', cursor: 'pointer', transition: 'color 0.15s',
                  }}
                  onClick={() => row.task && onSelect(row.task.id)}
                >
                  {row.task?.titel}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Scrollable chart area */}
        <div ref={scrollRef} style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden' }}>
          <div style={{ width: totalWidth, minWidth: '100%' }}>
            {/* Day headers */}
            <div style={{
              height: HEADER_H,
              display: 'flex',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              position: 'relative',
            }}>
              {dayColumns.map((d, i) => {
                const isToday = d.getTime() === today.getTime();
                const isMonthStart = d.getDate() === 1;
                const isWeekStart = d.getDay() === 1; // Monday
                const showLabel = i === 0 || isMonthStart || (i % 7 === 0);
                return (
                  <div
                    key={i}
                    style={{
                      width: DAY_W, flexShrink: 0,
                      borderRight: `1px solid ${isMonthStart ? 'rgba(255,255,255,0.12)' : isWeekStart ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)'}`,
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'flex-end',
                      paddingBottom: '0.375rem',
                      background: isToday ? TODAY_COLOR : 'transparent',
                    }}
                  >
                    {showLabel && (
                      <span style={{
                        fontSize: '0.625rem', fontWeight: isMonthStart ? 700 : 500,
                        color: isToday ? '#23CDCB' : isMonthStart ? '#d4d4d8' : '#52525b',
                        whiteSpace: 'nowrap',
                      }}>
                        {isMonthStart
                          ? d.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { month: 'short' })
                          : formatDate(d, lang)
                        }
                      </span>
                    )}
                    {isToday && (
                      <div style={{
                        position: 'absolute', bottom: 0,
                        left: (i * DAY_W) + (DAY_W / 2),
                        width: 2, height: 6, background: '#23CDCB', borderRadius: 1,
                      }} />
                    )}
                    <span style={{
                      fontSize: '0.5625rem', color: isToday ? '#23CDCB' : '#3f3f46',
                    }}>
                      {d.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Rows with bars */}
            <div style={{ position: 'relative', height: totalHeight }}>
              {/* Today vertical line */}
              {todayOffset >= 0 && todayOffset < DAYS && (
                <div style={{
                  position: 'absolute',
                  left: todayOffset * DAY_W + DAY_W / 2,
                  top: 0, bottom: 0,
                  width: 2,
                  background: 'rgba(35,205,202,0.5)',
                  zIndex: 2,
                  pointerEvents: 'none',
                }} />
              )}

              {/* Weekend shading + day columns */}
              {dayColumns.map((d, i) => {
                const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                const isToday = d.getTime() === today.getTime();
                return (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: i * DAY_W,
                      top: 0, bottom: 0,
                      width: DAY_W,
                      background: isToday ? TODAY_COLOR : isWeekend ? 'rgba(255,255,255,0.01)' : 'transparent',
                      borderRight: '1px solid rgba(255,255,255,0.02)',
                      pointerEvents: 'none',
                    }}
                  />
                );
              })}

              {/* Row backgrounds and bars */}
              {rows.map((row, rowIdx) => {
                const y = rowIdx * ROW_H;
                const isHeader = row.type === 'agent-header';

                return (
                  <div key={rowIdx} style={{ position: 'absolute', left: 0, right: 0, top: y, height: ROW_H }}>
                    {/* Row bg */}
                    <div style={{
                      position: 'absolute', inset: 0,
                      borderBottom: '1px solid rgba(255,255,255,0.03)',
                      background: isHeader ? 'rgba(255,255,255,0.02)' : 'transparent',
                    }} />

                    {/* Task bar */}
                    {row.task && (() => {
                      const geo = getBarGeometry(row.task);
                      if (!geo) return null;
                      const { x, w } = geo;
                      const color = STATUS_COLORS[row.task.status] || '#52525b';
                      const isHovered = row.task.id === hoveredId;
                      const hasPriorityStripe = row.task.prioritaet === 'critical' || row.task.prioritaet === 'high';
                      const isDone = row.task.status === 'done';

                      return (
                        <div
                          onClick={() => onSelect(row.task!.id)}
                          onMouseEnter={(e) => {
                            setHoveredId(row.task!.id);
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTooltip({ x: rect.left, y: rect.top, task: row.task! });
                          }}
                          onMouseLeave={() => {
                            setHoveredId(null);
                            setTooltip(null);
                          }}
                          style={{
                            position: 'absolute',
                            left: x + 2,
                            top: ROW_H * 0.2,
                            height: ROW_H * 0.6,
                            width: Math.max(w - 4, 20),
                            borderRadius: '6px',
                            background: color + (isDone ? '50' : '30'),
                            border: `1px solid ${color}${isHovered ? 'cc' : '55'}`,
                            cursor: 'pointer',
                            zIndex: 3,
                            transition: 'all 0.15s',
                            overflow: 'hidden',
                            boxShadow: isHovered ? `0 0 12px ${color}44` : 'none',
                            opacity: isDone ? 0.7 : 1,
                            display: 'flex',
                            alignItems: 'center',
                            paddingLeft: '0.375rem',
                            ...(hasPriorityStripe ? { backgroundImage: `${PRIORITY_STRIPE[row.task.prioritaet]}, linear-gradient(${color}30, ${color}30)` } : {}),
                          }}
                        >
                          {w > 60 && (
                            <span style={{
                              fontSize: '0.6875rem', fontWeight: 600,
                              color: isHovered ? '#ffffff' : color,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              maxWidth: w - 16,
                            }}>
                              {row.task.titel}
                            </span>
                          )}
                          {isDone && (
                            <div style={{
                              position: 'absolute', inset: 0,
                              background: `repeating-linear-gradient(90deg, transparent, transparent 6px, ${color}20 6px, ${color}20 7px)`,
                            }} />
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: tooltip.x + 10,
          top: tooltip.y - 80,
          zIndex: 9999,
          background: 'rgba(10,10,20,0.97)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '12px',
          padding: '0.75rem 1rem',
          pointerEvents: 'none',
          minWidth: 180, maxWidth: 280,
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}>
          <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#f1f5f9', marginBottom: '0.375rem' }}>
            {tooltip.task.titel}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{
              padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.6875rem',
              background: (STATUS_COLORS[tooltip.task.status] || '#52525b') + '25',
              color: STATUS_COLORS[tooltip.task.status] || '#52525b',
              border: `1px solid ${STATUS_COLORS[tooltip.task.status] || '#52525b'}40`,
            }}>
              {(i18n.status as any)[tooltip.task.status]}
            </span>
            <span style={{
              padding: '0.125rem 0.5rem', borderRadius: '4px', fontSize: '0.6875rem',
              background: 'rgba(255,255,255,0.05)', color: '#71717a',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
              {(i18n.priority as any)[tooltip.task.prioritaet]}
            </span>
          </div>
          {tooltip.task.gestartetAm && (
            <div style={{ fontSize: '0.6875rem', color: '#71717a', marginTop: '0.375rem' }}>
              {lang === 'de' ? 'Gestartet' : 'Started'}: {new Date(tooltip.task.gestartetAm).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { day: 'numeric', month: 'short' })}
            </div>
          )}
          {tooltip.task.abgeschlossenAm && (
            <div style={{ fontSize: '0.6875rem', color: '#22c55e', marginTop: '0.25rem' }}>
              {lang === 'de' ? 'Abgeschlossen' : 'Completed'}: {new Date(tooltip.task.abgeschlossenAm).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { day: 'numeric', month: 'short' })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
