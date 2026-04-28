import React, { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Activity as ActivityIcon, CheckCircle2, XCircle, Play, MessageSquare, DollarSign,
  ShieldCheck, AlertTriangle, Info, ChevronDown, ChevronRight, ArrowLeft, Clock,
} from 'lucide-react';
import { authFetch } from '../utils/api';
import { useI18n } from '../i18n';

interface TimelineEvent {
  id: string;
  at: string;
  kind: string;
  title: string;
  actor?: string | null;
  runId?: string | null;
  data?: any;
}

interface TimelineResponse {
  task: { id: string; titel: string; status: string; unternehmenId: string; zugewiesenAn: string | null };
  events: TimelineEvent[];
  runs: { id: string; status: string; gestartetAm: string | null; beendetAm: string | null }[];
}

const kindIcon = (kind: string) => {
  if (kind.startsWith('task_created')) return <Info size={14} />;
  if (kind.startsWith('task_started') || kind === 'run_started') return <Play size={14} />;
  if (kind === 'task_completed' || kind === 'run_succeeded') return <CheckCircle2 size={14} />;
  if (kind === 'task_cancelled' || kind === 'run_failed') return <XCircle size={14} />;
  if (kind === 'comment') return <MessageSquare size={14} />;
  if (kind === 'cost') return <DollarSign size={14} />;
  if (kind.startsWith('approval_')) return <ShieldCheck size={14} />;
  if (kind.startsWith('trace_')) return <ActivityIcon size={14} />;
  if (kind.startsWith('log_')) return <Info size={14} />;
  return <AlertTriangle size={14} />;
};

const kindColor = (kind: string) => {
  if (kind === 'run_succeeded' || kind === 'task_completed' || kind === 'approval_approved') return '#22c55e';
  if (kind === 'run_failed' || kind === 'task_cancelled' || kind === 'approval_rejected') return '#ef4444';
  if (kind === 'cost') return '#f59e0b';
  if (kind === 'comment') return '#9b87c8';
  if (kind.startsWith('trace_')) return '#c5a059';
  if (kind.startsWith('approval_')) return '#3b82f6';
  return '#94a3b8';
};

const fmtDate = (iso: string) => {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};

const fmtCostCents = (c: number) => `${(c / 100).toFixed(3)} €`;

export function TaskTimeline() {
  const { id } = useParams<{ id: string }>();
  const { language } = useI18n();
  const de = language === 'de';
  const [data, setData] = useState<TimelineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [runFilter, setRunFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    authFetch(`/api/aufgaben/${id}/timeline`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => setData(d))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const events = useMemo(() => {
    if (!data) return [];
    if (!runFilter) return data.events;
    return data.events.filter(e => e.runId === runFilter);
  }, [data, runFilter]);

  const totalCost = useMemo(() => {
    if (!data) return 0;
    return data.events
      .filter(e => e.kind === 'cost')
      .reduce((sum, e) => sum + (e.data?.kostenCent || 0), 0);
  }, [data]);

  const toggle = (eventId: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      if (n.has(eventId)) n.delete(eventId); else n.add(eventId);
      return n;
    });
  };

  if (loading) return <div style={{ padding: 32, color: '#94a3b8' }}>{de ? 'Lade Timeline…' : 'Loading timeline…'}</div>;
  if (error) return <div style={{ padding: 32, color: '#ef4444' }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <Link to="/tasks" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#c5a059', textDecoration: 'none', fontSize: 13, marginBottom: 16 }}>
        <ArrowLeft size={14} /> {de ? 'Zurück zu Tasks' : 'Back to tasks'}
      </Link>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{de ? 'Task-Timeline' : 'Task timeline'}</div>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: '#e2e8f0', margin: 0 }}>{data.task.titel}</h1>
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: '#94a3b8' }}>
          <span>{de ? 'Status' : 'Status'}: <strong style={{ color: '#e2e8f0' }}>{data.task.status}</strong></span>
          <span>{de ? 'Ereignisse' : 'Events'}: <strong style={{ color: '#e2e8f0' }}>{data.events.length}</strong></span>
          <span>{de ? 'Zyklen' : 'Cycles'}: <strong style={{ color: '#e2e8f0' }}>{data.runs.length}</strong></span>
          <span>{de ? 'Kosten' : 'Cost'}: <strong style={{ color: '#f59e0b' }}>{fmtCostCents(totalCost)}</strong></span>
        </div>
      </div>

      {data.runs.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          <button
            onClick={() => setRunFilter(null)}
            style={{
              padding: '4px 10px', borderRadius: 0, fontSize: 11,
              background: runFilter === null ? 'rgba(35,205,203,0.2)' : 'rgba(148,163,184,0.1)',
              color: runFilter === null ? '#c5a059' : '#94a3b8',
              border: `1px solid ${runFilter === null ? '#c5a059' : 'rgba(148,163,184,0.2)'}`,
              cursor: 'pointer',
            }}
          >{de ? 'Alle Ereignisse' : 'All events'}</button>
          {data.runs.map(r => (
            <button
              key={r.id}
              onClick={() => setRunFilter(runFilter === r.id ? null : r.id)}
              style={{
                padding: '4px 10px', borderRadius: 0, fontSize: 11,
                background: runFilter === r.id ? 'rgba(35,205,203,0.2)' : 'rgba(148,163,184,0.1)',
                color: runFilter === r.id ? '#c5a059' : '#94a3b8',
                border: `1px solid ${runFilter === r.id ? '#c5a059' : 'rgba(148,163,184,0.2)'}`,
                cursor: 'pointer',
              }}
              title={`${r.status} · ${r.gestartetAm || ''}`}
            >
              <Clock size={10} style={{ display: 'inline', marginRight: 4 }} />
              {r.id.slice(0, 8)} · {r.status}
            </button>
          ))}
        </div>
      )}

      <div style={{ position: 'relative', paddingLeft: 24 }}>
        <div style={{ position: 'absolute', left: 7, top: 4, bottom: 4, width: 2, background: 'rgba(148,163,184,0.15)' }} />
        {events.map(ev => {
          const color = kindColor(ev.kind);
          const isOpen = expanded.has(ev.id);
          const hasDetails = ev.data && (typeof ev.data === 'object' ? Object.keys(ev.data).length > 0 : String(ev.data).length > 0);
          return (
            <div key={ev.id} style={{ position: 'relative', marginBottom: 12 }}>
              <div style={{
                position: 'absolute', left: -24, top: 6, width: 16, height: 16, borderRadius: '50%',
                background: '#0f172a', border: `2px solid ${color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color,
              }}>
                {kindIcon(ev.kind)}
              </div>
              <div
                onClick={() => hasDetails && toggle(ev.id)}
                style={{
                  background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(148,163,184,0.15)', borderRadius: 0,
                  padding: '10px 12px', cursor: hasDetails ? 'pointer' : 'default',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                    {hasDetails && (isOpen ? <ChevronDown size={12} color="#64748b" /> : <ChevronRight size={12} color="#64748b" />)}
                    <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {ev.title}
                    </span>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 0, background: `${color}20`, color, border: `1px solid ${color}40` }}>
                      {ev.kind}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>{fmtDate(ev.at)}</span>
                </div>
                {ev.actor && (
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                    {de ? 'Von' : 'By'}: {ev.actor}{ev.runId ? ` · run ${ev.runId.slice(0, 8)}` : ''}
                  </div>
                )}
                {isOpen && hasDetails && (
                  <pre style={{
                    marginTop: 10, padding: 10, background: 'rgba(0,0,0,0.4)',
                    borderRadius: 0, fontSize: 11, color: '#cbd5e1',
                    overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    maxHeight: 400, overflowY: 'auto',
                  }}>
                    {typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          );
        })}
        {events.length === 0 && (
          <div style={{ color: '#64748b', fontSize: 13, padding: 16 }}>{de ? 'Keine Ereignisse.' : 'No events.'}</div>
        )}
      </div>
    </div>
  );
}

export default TaskTimeline;
