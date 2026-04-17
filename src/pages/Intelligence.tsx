import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Brain, Sparkles, Trash2, Save, X, CheckCircle, TrendingUp, Cpu, Key,
  ChevronDown, ChevronUp, Zap, Clock, BookOpen, Terminal, GitBranch, Calendar, Plus, Archive, RefreshCw, Radio, Search, Network } from 'lucide-react';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { zeitRelativ } from '../utils/i18n';
import { authFetch } from '../utils/api';
import { PageHelp } from '../components/PageHelp';

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface Expert {
  id: string;
  name: string;
  rolle: string;
  avatar: string;
  avatarFarbe: string;
  status: string;
  verbindungsTyp: string;
  budgetMonatCent: number;
  verbrauchtMonatCent: number;
  letzterZyklus: string | null;
}

interface DrawerEntry {
  id: string;
  room: string;
  inhalt: string;
  erstelltAm: string;
}

interface RoomData {
  room: string;
  count: number;
  entries: DrawerEntry[];
}

interface RoomsResponse {
  wing: string;
  aktualisiertAm?: string;
  rooms: RoomData[];
}

interface DiaryEntry {
  id: string;
  datum: string;
  thought: string | null;
  action: string | null;
  knowledge: string | null;
  erstelltAm: string;
}

interface KgFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  validFrom: string | null;
  erstelltAm: string;
}

interface SummaryInfo {
  version: number;
  komprimierteTurns: number;
  aktualisiertAm: string;
  inhalt: string;
}

interface TraceEvent {
  id: string;
  typ: 'thinking' | 'action' | 'result' | 'error' | 'warning' | 'info';
  titel: string;
  details?: string | null;
  erstelltAm: string;
}

const TRACE_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  thinking: { color: '#a855f7', bg: 'rgba(168,85,247,0.06)',  label: '💭 Denkt' },
  action:   { color: '#23CDCB', bg: 'rgba(35,205,202,0.06)',  label: '⚡ Aktion' },
  result:   { color: '#22c55e', bg: 'rgba(34,197,94,0.06)',   label: '✓ Ergebnis' },
  error:    { color: '#ef4444', bg: 'rgba(239,68,68,0.06)',   label: '✗ Fehler' },
  warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.06)',  label: '⚠ Warnung' },
  info:     { color: '#94a3b8', bg: 'rgba(148,163,184,0.04)', label: 'ℹ Info' },
};

// ─── Live Trace Tab ───────────────────────────────────────────────────────────

function LiveTraceTab({ expertId, isExpanded }: { expertId: string; isExpanded: boolean }) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Load history on expand
  useEffect(() => {
    if (!isExpanded) return;
    setLoading(true);
    const token = localStorage.getItem('opencognit_token') || '';
    fetch(`/api/experten/${expertId}/trace/history?limit=30&token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setEvents(data.reverse());
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isExpanded, expertId]);

  // Auto-scroll to bottom
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const startLive = () => {
    if (esRef.current) return;
    const token = localStorage.getItem('opencognit_token') || '';
    const es = new EventSource(`/api/experten/${expertId}/trace?token=${encodeURIComponent(token)}`);
    esRef.current = es;
    setLive(true);
    es.onmessage = ev => {
      try {
        const data: TraceEvent = JSON.parse(ev.data);
        setEvents(prev => [...prev, data].slice(-50));
      } catch { /* ignore */ }
    };
    es.onerror = () => { es.close(); esRef.current = null; setLive(false); };
  };

  const stopLive = () => {
    esRef.current?.close();
    esRef.current = null;
    setLive(false);
  };

  useEffect(() => {
    return () => { esRef.current?.close(); };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {live ? (
          <button onClick={stopLive} style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.75rem',
            borderRadius: '7px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1.2s ease-in-out infinite' }} />
            Live — Stop
          </button>
        ) : (
          <button onClick={startLive} style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.25rem 0.75rem',
            borderRadius: '7px', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600,
            background: 'rgba(35,205,202,0.08)', border: '1px solid rgba(35,205,202,0.2)', color: '#23CDCB',
          }}>
            <Radio size={11} /> Live starten
          </button>
        )}
        <span style={{ fontSize: '0.6875rem', color: '#3f3f46', marginLeft: 'auto' }}>
          {events.length} Ereignisse
        </span>
      </div>

      {/* Event list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
          <Cpu size={18} style={{ animation: 'spin 1s linear infinite', color: '#23CDCB' }} />
        </div>
      ) : events.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: '#3f3f46', fontSize: '0.8125rem' }}>
          <Terminal size={28} style={{ opacity: 0.2, marginBottom: '0.5rem' }} />
          <div>Noch keine Trace-Ereignisse für diesen Agenten.</div>
          <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#2d2d2d' }}>
            Starte Live um Echtzeit-Aktivität zu sehen.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', maxHeight: '400px', overflow: 'auto', fontFamily: 'monospace' }}>
          {events.map((ev, i) => {
            const cfg = TRACE_COLORS[ev.typ] ?? TRACE_COLORS.info;
            return (
              <div key={ev.id || i} style={{
                padding: '0.5rem 0.75rem', borderRadius: '8px',
                background: cfg.bg, border: `1px solid ${cfg.color}20`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: ev.details ? '0.25rem' : 0 }}>
                  <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: cfg.color, flexShrink: 0 }}>
                    {cfg.label}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#a1a1aa', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ev.titel}
                  </span>
                  <span style={{ fontSize: '0.625rem', color: '#3f3f46', flexShrink: 0 }}>
                    {new Date(ev.erstelltAm).toLocaleTimeString()}
                  </span>
                </div>
                {ev.details && (
                  <pre style={{
                    margin: 0, fontSize: '0.6875rem', color: '#52525b',
                    whiteSpace: 'pre-wrap', lineHeight: 1.5,
                    maxHeight: 100, overflow: 'hidden',
                  }}>
                    {ev.details.slice(0, 400)}{ev.details.length > 400 ? '…' : ''}
                  </pre>
                )}
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      )}
    </div>
  );
}

const CLI_ADAPTERS = ['codex-cli', 'gemini-cli', 'claude-code'];

function computeHealthScore(expert: Expert): number {
  let score = 100;
  if (expert.budgetMonatCent > 0) {
    const pct = (expert.verbrauchtMonatCent / expert.budgetMonatCent) * 100;
    if (pct >= 100) score -= 40; else if (pct >= 80) score -= 20; else if (pct >= 60) score -= 10;
  }
  if (expert.letzterZyklus) {
    const ageH = (Date.now() - new Date(expert.letzterZyklus).getTime()) / 3600000;
    if (ageH > 24) score -= 20; else if (ageH > 6) score -= 10;
  } else { score -= 15; }
  if (expert.status === 'error') score -= 30;
  if (expert.status === 'paused') score -= 10;
  return Math.max(0, Math.min(100, score));
}

function HealthRing({ score, size = 56, color }: { score: number; size?: number; color: string }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" style={{ transition: 'stroke-dasharray 0.8s ease' }} />
    </svg>
  );
}

// ─── Knowledge Graph Sektion (Company-weit) ─────────────────────────────────

interface GraphNode { id: string; label: string; x: number; y: number; vx: number; vy: number; degree: number; }
interface GraphEdge { id: string; source: string; target: string; label: string; color: string; }

function predicateColor(pred: string): string {
  let hash = 0;
  for (let i = 0; i < pred.length; i++) hash = (hash * 31 + pred.charCodeAt(i)) | 0;
  const h = Math.abs(hash) % 360;
  return `hsl(${h},65%,60%)`;
}

function KnowledgeGraphPanel({ facts, unternehmenId, onRefresh }: { facts: KgFact[]; unternehmenId: string; onRefresh: () => void }) {
  const { language } = useI18n();
  const de = language === 'de';
  const [view, setView] = useState<'graph' | 'list'>('graph');
  const [focused, setFocused] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newPredicate, setNewPredicate] = useState('');
  const [newObject, setNewObject] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const nodesRef = useRef<Map<string, GraphNode>>(new Map());
  const dragRef = useRef<{ id: string } | null>(null);
  const rafRef = useRef<number>(0);
  const [, setTick] = useState(0);

  const W = 700, H = 360;

  // Build edge list + degree map from facts
  const { edges, degrees } = useMemo(() => {
    const degrees = new Map<string, number>();
    const edges: GraphEdge[] = facts.map(f => {
      degrees.set(f.subject, (degrees.get(f.subject) || 0) + 1);
      degrees.set(f.object, (degrees.get(f.object) || 0) + 1);
      return { id: f.id, source: f.subject, target: f.object, label: f.predicate, color: predicateColor(f.predicate) };
    });
    return { edges, degrees };
  }, [facts]);

  // Sync nodes when facts change
  useEffect(() => {
    const existing = nodesRef.current;
    const needed = new Set<string>();
    facts.forEach(f => { needed.add(f.subject); needed.add(f.object); });
    for (const id of existing.keys()) { if (!needed.has(id)) existing.delete(id); }
    let idx = existing.size;
    for (const id of needed) {
      if (!existing.has(id)) {
        const angle = idx * 2.399963;
        const r = 40 + Math.sqrt(idx) * 55;
        existing.set(id, { id, label: id, x: W/2 + Math.cos(angle)*Math.min(r,240), y: H/2 + Math.sin(angle)*Math.min(r,140), vx: 0, vy: 0, degree: 0 });
        idx++;
      }
    }
    for (const [id, n] of existing) n.degree = degrees.get(id) || 0;
  }, [facts, degrees]);

  // Live force simulation
  useEffect(() => {
    let running = true;
    const simulate = () => {
      if (!running) return;
      const ns = Array.from(nodesRef.current.values());
      if (ns.length > 1) {
        for (let i = 0; i < ns.length; i++) {
          for (let j = i+1; j < ns.length; j++) {
            const dx = ns[j].x - ns[i].x, dy = ns[j].y - ns[i].y;
            const d2 = dx*dx + dy*dy;
            const dist = Math.max(Math.sqrt(d2), 1);
            const f = 3500 / (d2 + 1);
            ns[i].vx -= (dx/dist)*f; ns[i].vy -= (dy/dist)*f;
            ns[j].vx += (dx/dist)*f; ns[j].vy += (dy/dist)*f;
          }
        }
        for (const e of edges) {
          const s = nodesRef.current.get(e.source), t = nodesRef.current.get(e.target);
          if (!s || !t) continue;
          const dx = t.x - s.x, dy = t.y - s.y;
          const dist = Math.max(Math.sqrt(dx*dx+dy*dy), 1);
          const f = (dist - 130) * 0.045;
          s.vx += (dx/dist)*f; s.vy += (dy/dist)*f;
          t.vx -= (dx/dist)*f; t.vy -= (dy/dist)*f;
        }
        for (const n of ns) { n.vx += (W/2-n.x)*0.018; n.vy += (H/2-n.y)*0.018; }
        for (const n of ns) {
          if (dragRef.current?.id === n.id) continue;
          n.x = Math.max(40, Math.min(W-40, n.x + n.vx*0.4));
          n.y = Math.max(35, Math.min(H-35, n.y + n.vy*0.4));
          n.vx *= 0.65; n.vy *= 0.65;
        }
        setTick(t => t+1);
      }
      rafRef.current = requestAnimationFrame(simulate);
    };
    rafRef.current = requestAnimationFrame(simulate);
    return () => { running = false; cancelAnimationFrame(rafRef.current); };
  }, [edges]);

  // SVG drag
  const onSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) * (W / rect.width);
    const svgY = (e.clientY - rect.top) * (H / rect.height);
    const n = nodesRef.current.get(dragRef.current.id);
    if (n) { n.x = Math.max(40, Math.min(W-40, svgX)); n.y = Math.max(35, Math.min(H-35, svgY)); n.vx = 0; n.vy = 0; }
  };
  const onSvgMouseUp = () => { dragRef.current = null; };
  const onNodeMouseDown = (e: React.MouseEvent, id: string) => { e.stopPropagation(); dragRef.current = { id }; };

  // Focus ring: which nodes are connected to the focused node
  const connectedIds = useMemo(() => {
    if (!focused) return null;
    const ids = new Set<string>([focused]);
    edges.forEach(e => { if (e.source === focused || e.target === focused) { ids.add(e.source); ids.add(e.target); } });
    return ids;
  }, [focused, edges]);

  const sq = search.toLowerCase().trim();
  const matchNode = (id: string) => sq === '' || id.toLowerCase().includes(sq);

  // Add fact
  const addFact = async () => {
    if (!newSubject.trim() || !newPredicate.trim() || !newObject.trim()) return;
    setSaving(true);
    try {
      await authFetch(`/api/palace/kg/${unternehmenId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: newSubject.trim(), predicate: newPredicate.trim(), object: newObject.trim() }),
      });
      setNewSubject(''); setNewPredicate(''); setNewObject(''); setAddOpen(false);
      onRefresh();
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  // Delete fact
  const deleteFact = async (factId: string) => {
    setDeleting(factId);
    try {
      await authFetch(`/api/palace/kg/${factId}`, { method: 'DELETE' });
      onRefresh();
    } catch { /* ignore */ } finally { setDeleting(null); }
  };

  const nodes = Array.from(nodesRef.current.values());
  const uniqueSubjects = new Set(facts.map(f => f.subject)).size;
  const uniquePredicates = new Set(facts.map(f => f.predicate)).size;
  const uniqueObjects = new Set(facts.map(f => f.object)).size;

  if (facts.length === 0 && !addOpen) return null;

  return (
    <div style={{ marginBottom: '2rem', background: 'rgba(34,197,94,0.03)', border: '1px solid rgba(34,197,94,0.15)', borderRadius: '16px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.875rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#22c55e', fontWeight: 700, fontSize: '0.9375rem' }}>
          <Network size={16} /> Knowledge Graph
          <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 400, background: 'rgba(34,197,94,0.08)', padding: '0.15rem 0.5rem', borderRadius: '999px' }}>{facts.length} {de ? 'Fakten' : 'facts'}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <Search size={11} style={{ position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={de ? 'Suchen…' : 'Search…'}
              style={{ paddingLeft: 22, paddingRight: 8, paddingTop: 4, paddingBottom: 4, borderRadius: 7, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)', color: '#e2e8f0', fontSize: '0.75rem', width: 120, outline: 'none' }} />
          </div>
          <button onClick={() => setAddOpen(o => !o)} style={{ padding: '0.25rem 0.625rem', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(34,197,94,0.3)', background: addOpen ? 'rgba(34,197,94,0.15)' : 'transparent', color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={11} /> {de ? 'Fakt' : 'Fact'}
          </button>
          {(['graph', 'list'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{ padding: '0.25rem 0.75rem', borderRadius: 7, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', border: 'none', background: view === v ? 'rgba(34,197,94,0.15)' : 'transparent', color: view === v ? '#22c55e' : '#475569' }}>{v === 'graph' ? 'Graph' : (de ? 'Tabelle' : 'Table')}</button>
          ))}
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: '1.5rem', padding: '0.4rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.6875rem', color: '#475569', alignItems: 'center' }}>
        <span><span style={{ color: '#22c55e', fontWeight: 700 }}>{uniqueSubjects}</span> {de ? 'Subjekte' : 'Subjects'}</span>
        <span><span style={{ color: '#a855f7', fontWeight: 700 }}>{uniquePredicates}</span> {de ? 'Prädikate' : 'Predicates'}</span>
        <span><span style={{ color: '#23CDCB', fontWeight: 700 }}>{uniqueObjects}</span> {de ? 'Objekte' : 'Objects'}</span>
        {focused && <span style={{ marginLeft: 'auto', color: '#22c55e', cursor: 'pointer', fontSize: '0.625rem' }} onClick={() => setFocused(null)}>✕ {de ? 'Fokus aufheben' : 'Clear focus'}</span>}
      </div>

      {/* Add Fact form */}
      {addOpen && (
        <div style={{ padding: '0.625rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {([
            { val: newSubject, set: setNewSubject, ph: de ? 'Subjekt' : 'Subject', color: '#22c55e' },
            { val: newPredicate, set: setNewPredicate, ph: de ? 'Prädikat' : 'Predicate', color: '#a855f7' },
            { val: newObject, set: setNewObject, ph: de ? 'Objekt' : 'Object', color: '#23CDCB' },
          ] as const).map(({ val, set, ph, color }) => (
            <input key={ph} value={val} onChange={e => set(e.target.value)} placeholder={ph}
              onKeyDown={e => e.key === 'Enter' && addFact()}
              style={{ flex: 1, minWidth: 90, padding: '0.35rem 0.6rem', borderRadius: 7, border: `1px solid ${color}40`, background: 'rgba(255,255,255,0.03)', color, fontSize: '0.8rem', outline: 'none' }} />
          ))}
          <button onClick={addFact} disabled={saving} style={{ padding: '0.35rem 0.875rem', borderRadius: 7, border: 'none', background: 'rgba(34,197,94,0.15)', color: '#22c55e', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
            {saving ? '…' : (de ? 'Speichern' : 'Save')}
          </button>
          <button onClick={() => setAddOpen(false)} style={{ padding: '0.35rem 0.625rem', borderRadius: 7, border: 'none', background: 'transparent', color: '#475569', fontSize: '0.8rem', cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {view === 'graph' ? (
        <div style={{ padding: '0.5rem', overflowX: 'auto' }}>
          <style>{`@keyframes kg-flow{from{stroke-dashoffset:24}to{stroke-dashoffset:0}}`}</style>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%"
            style={{ display: 'block', minWidth: 360, cursor: dragRef.current ? 'grabbing' : 'default' }}
            onMouseMove={onSvgMouseMove} onMouseUp={onSvgMouseUp} onMouseLeave={onSvgMouseUp}
            onClick={() => setFocused(null)}>
            <defs>
              <marker id="kg-arrow" markerWidth="8" markerHeight="8" refX="18" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="rgba(148,163,184,0.4)" />
              </marker>
              <filter id="kg-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
              <filter id="kg-glow-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>

            {/* Edges */}
            {edges.map(e => {
              const s = nodesRef.current.get(e.source), t = nodesRef.current.get(e.target);
              if (!s || !t) return null;
              const isConn = !connectedIds || (connectedIds.has(e.source) && connectedIds.has(e.target));
              const hit = sq === '' || matchNode(e.source) || matchNode(e.target) || e.label.toLowerCase().includes(sq);
              const active = isConn && hit;
              const dx = t.x - s.x, dy = t.y - s.y, len = Math.max(Math.sqrt(dx*dx+dy*dy), 1);
              const mx = (s.x+t.x)/2, my = (s.y+t.y)/2;
              const nx = -dy/len, ny = dx/len;
              const cx = mx+nx*22, cy = my+ny*22;
              return (
                <g key={e.id} style={{ opacity: active ? 1 : 0.05, transition: 'opacity 0.25s' }}>
                  <path d={`M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`}
                    fill="none" stroke={e.color} strokeWidth={active ? 1.5 : 1}
                    strokeDasharray="6 6" strokeOpacity={active ? 0.65 : 0.2}
                    markerEnd="url(#kg-arrow)"
                    style={{ animation: active ? 'kg-flow 0.9s linear infinite' : 'none' }} />
                  {active && (
                    <text x={cx} y={cy-6} textAnchor="middle" fontSize="8" fill={e.color}
                      style={{ pointerEvents: 'none', fontFamily: 'monospace' }} opacity={0.9}>
                      {e.label.length > 18 ? e.label.slice(0,18)+'…' : e.label}
                    </text>
                  )}
                </g>
              );
            })}

            {/* Nodes */}
            {nodes.map(n => {
              const isConn = !connectedIds || connectedIds.has(n.id);
              const hit = matchNode(n.id);
              const active = isConn && hit;
              const isFoc = focused === n.id;
              const r = Math.min(14 + n.degree * 4, 35);
              const isSubj = facts.some(f => f.subject === n.id);
              const color = isSubj ? '#22c55e' : '#23CDCB';
              return (
                <g key={n.id} transform={`translate(${n.x},${n.y})`}
                  onMouseDown={e => onNodeMouseDown(e, n.id)}
                  onClick={e => { e.stopPropagation(); setFocused(focused === n.id ? null : n.id); }}
                  style={{ cursor: 'grab', opacity: active ? 1 : 0.1, transition: 'opacity 0.25s' }}>
                  {isFoc && <circle r={r+9} fill="none" stroke={color} strokeWidth={1} strokeDasharray="3 3" opacity={0.45} style={{ animation: 'kg-flow 1.4s linear infinite' }} />}
                  <circle r={r}
                    fill={isFoc ? `${color}28` : `${color}12`}
                    stroke={isFoc ? color : active ? `${color}70` : `${color}30`}
                    strokeWidth={isFoc ? 2 : 1}
                    filter={isFoc ? 'url(#kg-glow)' : active ? 'url(#kg-glow-soft)' : undefined}
                    style={{ transition: 'all 0.2s' }} />
                  <text textAnchor="middle" dominantBaseline="middle"
                    fontSize={Math.max(7, Math.min(9, r*0.58))}
                    fill={active ? (isFoc ? color : '#e2e8f0') : '#2d3748'}
                    fontWeight={isSubj ? '700' : '400'}
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {n.label.length > 14 ? n.label.slice(0,14)+'…' : n.label}
                  </text>
                </g>
              );
            })}
          </svg>

          <div style={{ display: 'flex', gap: '1rem', padding: '0.375rem 0.75rem', fontSize: '0.625rem', color: '#334155', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(34,197,94,0.3)', border: '1px solid #22c55e', display: 'inline-block' }} /> {de ? 'Subjekt' : 'Subject'}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(35,205,202,0.2)', border: '1px solid #23CDCB', display: 'inline-block' }} /> {de ? 'Objekt' : 'Object'}
            </span>
            <span style={{ color: '#2d3748' }}>{de ? 'Größe = Grad · Klick = Fokus · Ziehen = Position' : 'Size = Degree · Click = Focus · Drag = Position'}</span>
          </div>
        </div>
      ) : (
        <div style={{ padding: '0.75rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {facts.filter(f => sq === '' || f.subject.toLowerCase().includes(sq) || f.predicate.toLowerCase().includes(sq) || f.object.toLowerCase().includes(sq)).map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', fontSize: '0.8125rem' }}>
              <span style={{ color: '#22c55e', fontWeight: 600 }}>{f.subject}</span>
              <span style={{ color: predicateColor(f.predicate), fontStyle: 'italic', fontSize: '0.75rem' }}>{f.predicate}</span>
              <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{f.object}</span>
              {f.validFrom && <span style={{ marginLeft: 'auto', fontSize: '0.6875rem', color: '#334155', flexShrink: 0 }}>{de ? 'seit' : 'since'} {f.validFrom}</span>}
              <button onClick={() => deleteFact(f.id)} disabled={deleting === f.id}
                style={{ marginLeft: f.validFrom ? '0.5rem' : 'auto', padding: '0.15rem 0.375rem', borderRadius: 5, border: 'none', background: 'transparent', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                {deleting === f.id ? '…' : <Trash2 size={11} />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Write to Memory Form ───────────────────────────────────────────────────

const ALLOWED_ROOMS = ['entscheidungen', 'kontakte', 'projekt', 'erkenntnisse', 'notizen', 'aufgaben', 'fehler'];

function WriteMemoryForm({ expertId, onSaved, t }: { expertId: string; onSaved: () => void; t: any }) {
  const [room, setRoom] = useState(ALLOWED_ROOMS[0]);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await authFetch(`/api/palace/${expertId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, content: content.trim() }),
      });
      setContent('');
      onSaved();
    } catch { /* silent */ }
    setSaving(false);
  };

  return (
    <div style={{ padding: '1rem', background: 'rgba(35,205,202,0.04)', border: '1px solid rgba(35,205,202,0.15)', borderRadius: '10px', marginTop: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
        <select value={room} onChange={e => setRoom(e.target.value)} style={{
          padding: '0.375rem 0.5rem', borderRadius: '6px', fontSize: '0.8125rem',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#a78bfa', cursor: 'pointer',
        }}>
          {ALLOWED_ROOMS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <textarea value={content} onChange={e => setContent(e.target.value)} placeholder={t.gedaechtnis.contentPlaceholder}
        rows={3} style={{
          width: '100%', padding: '0.5rem', borderRadius: '6px', fontSize: '0.8125rem', resize: 'vertical',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: '#e4e4e7',
          fontFamily: 'monospace', boxSizing: 'border-box',
        }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.375rem' }}>
        <button onClick={save} disabled={saving || !content.trim()} style={{
          display: 'flex', alignItems: 'center', gap: '0.375rem',
          padding: '0.375rem 0.875rem', borderRadius: '7px', cursor: saving ? 'wait' : 'pointer',
          background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.25)', color: '#23CDCB',
          fontSize: '0.8125rem', fontWeight: 600, opacity: saving || !content.trim() ? 0.5 : 1,
        }}>
          <Save size={13} /> {saving ? t.gedaechtnis.saving : t.gedaechtnis.save}
        </button>
      </div>
    </div>
  );
}

// ─── Wing Card (pro Agent) ──────────────────────────────────────────────────

function WingCard({ expert, t }: { expert: Expert; t: any }) {
  const [expanded, setExpanded] = useState(false);
  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [summary, setSummary] = useState<SummaryInfo | null>(null);
  const [activeRoom, setActiveRoom] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'rooms' | 'diary' | 'summary' | 'live'>('rooms');
  const [loading, setLoading] = useState(false);
  const [showWriteForm, setShowWriteForm] = useState(false);
  const [consolidating, setConsolidating] = useState(false);

  const budgetPct = expert.budgetMonatCent > 0 ? Math.round((expert.verbrauchtMonatCent / expert.budgetMonatCent) * 100) : 0;
  const health = computeHealthScore(expert);
  const healthColor = health >= 70 ? '#22c55e' : health >= 40 ? '#eab308' : '#ef4444';
  const wingName = expert.name.toLowerCase().replace(/\s+/g, '_');

  const loadData = useCallback(async () => {
    if (!expanded) return;
    setLoading(true);
    try {
      const [roomsRes, diaryRes, summaryRes] = await Promise.all([
        authFetch(`/api/palace/${expert.id}/rooms`).then(r => r.json()),
        authFetch(`/api/palace/${expert.id}/diary`).then(r => r.json()),
        authFetch(`/api/palace/${expert.id}/summary`).then(r => r.json()).catch(() => null),
      ]);
      setRooms(roomsRes.rooms || []);
      setDiary(Array.isArray(diaryRes) ? diaryRes : []);
      setSummary(summaryRes);
      if (roomsRes.rooms?.length > 0 && !activeRoom) {
        setActiveRoom(roomsRes.rooms[0].room);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [expanded, expert.id]);

  useEffect(() => { loadData(); }, [loadData]);

  const deleteDrawerEntry = async (entryId: string) => {
    await authFetch(`/api/palace/drawer/${entryId}`, { method: 'DELETE' });
    setRooms(prev => prev.map(r => ({ ...r, entries: r.entries.filter(e => e.id !== entryId), count: r.entries.filter(e => e.id !== entryId).length })));
  };

  const deleteDiaryEntry = async (entryId: string) => {
    await authFetch(`/api/palace/diary/${entryId}`, { method: 'DELETE' });
    setDiary(prev => prev.filter(e => e.id !== entryId));
  };

  const triggerConsolidation = async () => {
    setConsolidating(true);
    try {
      const res = await authFetch(`/api/palace/${expert.id}/consolidate`, { method: 'POST' });
      if (res.ok) {
        await loadData();
        setActiveTab('summary');
      }
    } catch { /* silent */ }
    setConsolidating(false);
  };

  const totalEntries = rooms.reduce((a, r) => a + r.count, 0);

  return (
    <div style={{
      backgroundColor: 'rgba(255,255,255,0.02)',
      border: `1px solid ${health < 40 ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: '20px', overflow: 'hidden', transition: 'all 0.3s',
    }}>
      {/* Header */}
      <div onClick={() => setExpanded(!expanded)} style={{
        display: 'flex', alignItems: 'center', gap: '1rem',
        padding: '1.25rem 1.5rem', cursor: 'pointer',
        background: expanded ? 'rgba(255,255,255,0.03)' : 'transparent',
      }}>
        <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
          <div style={{ position: 'absolute', inset: 0 }}><HealthRing score={health} size={56} color={healthColor} /></div>
          <div style={{
            position: 'absolute', inset: 4, borderRadius: '50%', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: '1.25rem', background: expert.avatarFarbe + '22', color: expert.avatarFarbe, fontWeight: 700,
          }}>{expert.avatar}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.9375rem' }}>{expert.name}</span>
            <span style={{ padding: '0.125rem 0.5rem', background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.25)', borderRadius: '9999px', fontSize: '0.625rem', color: '#23CDCB', fontWeight: 600, fontFamily: 'monospace' }}>
              {wingName}
            </span>
            {totalEntries > 0 && (
              <span style={{ fontSize: '0.625rem', color: '#8b5cf6', fontWeight: 600 }}>
                {totalEntries} Eintr. / {rooms.length} Rooms / {diary.length} Diary
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.8125rem', color: '#71717a', marginTop: '0.125rem' }}>{expert.rolle}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <div style={{ width: 60, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${budgetPct}%`, background: budgetPct >= 90 ? '#ef4444' : budgetPct >= 70 ? '#eab308' : '#22c55e', transition: 'width 0.5s' }} />
              </div>
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: budgetPct >= 90 ? '#ef4444' : budgetPct >= 70 ? '#eab308' : '#71717a' }}>{budgetPct}%</span>
            </div>
            <span style={{ fontSize: '0.6875rem', color: healthColor, fontWeight: 600 }}>{health}</span>
            {expert.letzterZyklus && (
              <span style={{ fontSize: '0.6875rem', color: '#52525b', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <Clock size={10} /> {zeitRelativ(expert.letzterZyklus, t)}
              </span>
            )}
          </div>
        </div>
        <div style={{ color: '#52525b', flexShrink: 0 }}>
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </div>
      </div>

      {/* Expanded */}
      {expanded && (
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '0 1.5rem 1.5rem' }}>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#52525b' }}>
              <Cpu size={20} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : (
            <>
              {/* Tab Bar: Rooms | Diary | Summary */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '1rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
                {[
                  { key: 'rooms' as const, label: `Rooms (${rooms.length})`, icon: BookOpen },
                  { key: 'diary' as const, label: `Diary (${diary.length})`, icon: Calendar },
                  { key: 'summary' as const, label: summary ? `Summary v${summary.version}` : 'Summary', icon: Archive },
                  { key: 'live' as const, label: 'Live Trace', icon: Terminal },
                ].map(tab => (
                  <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                    display: 'flex', alignItems: 'center', gap: '0.375rem',
                    padding: '0.375rem 0.75rem', borderRadius: '8px',
                    background: activeTab === tab.key ? 'rgba(35,205,202,0.1)' : 'transparent',
                    border: `1px solid ${activeTab === tab.key ? 'rgba(35,205,202,0.25)' : 'transparent'}`,
                    color: activeTab === tab.key ? '#23CDCB' : '#52525b',
                    cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600,
                  }}>
                    <tab.icon size={13} /> {tab.label}
                  </button>
                ))}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.375rem' }}>
                  <button onClick={() => setShowWriteForm(v => !v)} style={{
                    display: 'flex', alignItems: 'center', gap: '0.25rem',
                    padding: '0.25rem 0.625rem', borderRadius: '7px', cursor: 'pointer', fontSize: '0.75rem',
                    background: showWriteForm ? 'rgba(139,92,246,0.12)' : 'transparent',
                    border: `1px solid ${showWriteForm ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.08)'}`,
                    color: showWriteForm ? '#a78bfa' : '#52525b',
                  }}>
                    <Plus size={12} /> Schreiben
                  </button>
                  <button onClick={triggerConsolidation} disabled={consolidating} style={{
                    display: 'flex', alignItems: 'center', gap: '0.25rem',
                    padding: '0.25rem 0.625rem', borderRadius: '7px', cursor: consolidating ? 'wait' : 'pointer',
                    fontSize: '0.75rem', opacity: consolidating ? 0.6 : 1,
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: '#52525b',
                  }}>
                    <RefreshCw size={12} style={consolidating ? { animation: 'spin 1s linear infinite' } : {}} />
                    {consolidating ? t.gedaechtnis.consolidating : t.gedaechtnis.consolidate}
                  </button>
                </div>
              </div>

              {/* Write to Memory Form */}
              {showWriteForm && (
                <WriteMemoryForm expertId={expert.id} onSaved={() => { setShowWriteForm(false); loadData(); }} t={t} />
              )}

              {/* Live Trace Tab */}
              {activeTab === 'live' && (
                <LiveTraceTab expertId={expert.id} isExpanded={expanded} />
              )}

              {/* Rooms Tab */}
              {activeTab === 'rooms' && (
                <>
                  {rooms.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#3f3f46', fontSize: '0.8125rem' }}>
                      <Brain size={28} style={{ opacity: 0.2, marginBottom: '0.5rem' }} />
                      <div>{t.gedaechtnis.noMemory}</div>
                    </div>
                  ) : (
                    <>
                      {/* Room Tabs */}
                      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                        {rooms.map(r => (
                          <button key={r.room} onClick={() => setActiveRoom(r.room)} style={{
                            padding: '0.25rem 0.625rem', borderRadius: '6px',
                            background: activeRoom === r.room ? 'rgba(139,92,246,0.12)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${activeRoom === r.room ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.06)'}`,
                            color: activeRoom === r.room ? '#a78bfa' : '#71717a',
                            cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                          }}>
                            {r.room} ({r.count})
                          </button>
                        ))}
                      </div>
                      {/* Room Content */}
                      {(() => {
                        const room = rooms.find(r => r.room === activeRoom);
                        if (!room) return null;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '300px', overflow: 'auto' }}>
                            {room.entries.map(entry => (
                              <div key={entry.id} style={{
                                padding: '0.75rem', borderRadius: '8px', position: 'relative',
                                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                              }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                                  <span style={{ fontSize: '0.6875rem', color: '#3f3f46' }}>
                                    {new Date(entry.erstelltAm).toLocaleString()}
                                  </span>
                                  <button onClick={() => deleteDrawerEntry(entry.id)} style={{
                                    background: 'none', border: 'none', cursor: 'pointer', padding: '0.125rem 0.25rem',
                                    color: '#3f3f46', borderRadius: '4px', display: 'flex', alignItems: 'center',
                                  }}
                                    onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                                    onMouseLeave={e => (e.currentTarget.style.color = '#3f3f46')}>
                                    <Trash2 size={11} />
                                  </button>
                                </div>
                                <div style={{ fontSize: '0.8125rem', color: '#a1a1aa', whiteSpace: 'pre-wrap', lineHeight: 1.5, fontFamily: 'monospace', maxHeight: '120px', overflow: 'hidden' }}>
                                  {entry.inhalt.slice(0, 800)}{entry.inhalt.length > 800 ? '...' : ''}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </>
                  )}
                </>
              )}

              {/* Summary Tab */}
              {activeTab === 'summary' && (
                <>
                  {!summary ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#3f3f46', fontSize: '0.8125rem' }}>
                      <Archive size={28} style={{ opacity: 0.2, marginBottom: '0.5rem' }} />
                      <div style={{ marginBottom: '0.5rem' }}>{t.gedaechtnis.noSummaryYet}</div>
                      <button onClick={triggerConsolidation} disabled={consolidating} style={{
                        padding: '0.375rem 0.875rem', borderRadius: '7px', cursor: consolidating ? 'wait' : 'pointer',
                        background: 'rgba(35,205,202,0.08)', border: '1px solid rgba(35,205,202,0.2)', color: '#23CDCB',
                        fontSize: '0.8125rem', fontWeight: 600,
                      }}>
                        {consolidating ? t.gedaechtnis.consolidating : t.gedaechtnis.consolidateNow}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                      {/* Meta bar */}
                      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ fontSize: '0.75rem', color: '#52525b' }}>
                          Version <strong style={{ color: '#23CDCB' }}>v{summary.version}</strong>
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#52525b' }}>
                          <strong style={{ color: '#a78bfa' }}>{summary.komprimierteTurns}</strong> Turns komprimiert
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#52525b' }}>
                          Zuletzt: <strong style={{ color: '#e4e4e7' }}>{new Date(summary.aktualisiertAm).toLocaleString()}</strong>
                        </span>
                      </div>
                      {/* Summary text */}
                      <div style={{ maxHeight: '400px', overflow: 'auto', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <pre style={{ fontSize: '0.75rem', color: '#a1a1aa', whiteSpace: 'pre-wrap', fontFamily: 'monospace', lineHeight: 1.6, margin: 0 }}>
                          {summary.inhalt}
                        </pre>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Diary Tab */}
              {activeTab === 'diary' && (
                <>
                  {diary.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '2rem', color: '#3f3f46', fontSize: '0.8125rem' }}>
                      <Calendar size={28} style={{ opacity: 0.2, marginBottom: '0.5rem' }} />
                      <div>Kein Tagebuch vorhanden</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '350px', overflow: 'auto' }}>
                      {diary.map(entry => (
                        <div key={entry.id} style={{
                          padding: '0.875rem', borderRadius: '10px',
                          background: 'rgba(139,92,246,0.04)', border: '1px solid rgba(139,92,246,0.12)',
                          position: 'relative',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                            <span style={{ fontSize: '0.75rem', color: '#8b5cf6', fontWeight: 700 }}>{entry.datum}</span>
                            <button onClick={() => deleteDiaryEntry(entry.id)} style={{
                              background: 'none', border: 'none', cursor: 'pointer', padding: '0.125rem 0.25rem',
                              color: '#3f3f46', borderRadius: '4px', display: 'flex', alignItems: 'center',
                            }}
                              onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                              onMouseLeave={e => (e.currentTarget.style.color = '#3f3f46')}>
                              <Trash2 size={11} />
                            </button>
                          </div>
                          {entry.thought && (
                            <div style={{ fontSize: '0.8125rem', marginBottom: '0.25rem' }}>
                              <span style={{ color: '#71717a' }}>Gedanke:</span>{' '}
                              <span style={{ color: '#d4d4d8' }}>{entry.thought}</span>
                            </div>
                          )}
                          {entry.action && (
                            <div style={{ fontSize: '0.8125rem', marginBottom: '0.25rem' }}>
                              <span style={{ color: '#71717a' }}>Aktion:</span>{' '}
                              <span style={{ color: '#d4d4d8' }}>{entry.action}</span>
                            </div>
                          )}
                          {entry.knowledge && (
                            <div style={{ fontSize: '0.8125rem' }}>
                              <span style={{ color: '#71717a' }}>Wissen:</span>{' '}
                              <span style={{ color: '#22c55e' }}>{entry.knowledge}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Hauptseite ─────────────────────────────────────────────────────────────

export function Intelligence() {
  const i18n = useI18n();
  const t = i18n.t;
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', t.nav.intelligence]);

  const [experts, setExperts] = useState<Expert[]>([]);
  const [kgFacts, setKgFacts] = useState<KgFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    setLoading(true);
    try {
      const [expertsRes, kgRes] = await Promise.all([
        authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/experten`).then(r => r.json()),
        authFetch(`/api/palace/kg/${aktivesUnternehmen.id}`).then(r => r.json()).catch(() => []),
      ]);
      setExperts(expertsRes);
      setKgFacts(Array.isArray(kgRes) ? kgRes : []);
    } catch (e) { console.error('Intelligence load error:', e); }
    setLoading(false);
  }, [aktivesUnternehmen]);

  useEffect(() => { load(); }, [load]);

  const avgHealth = experts.length > 0
    ? Math.round(experts.reduce((acc, e) => acc + computeHealthScore(e), 0) / experts.length) : 0;
  const healthColor = avgHealth >= 70 ? '#22c55e' : avgHealth >= 40 ? '#eab308' : '#ef4444';
  const cliExperten = experts.filter(e => CLI_ADAPTERS.includes(e.verbindungsTyp));

  return (
    <>
      {toast && (
        <div style={{
          position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 9999,
          padding: '0.875rem 1.25rem', background: 'rgba(35,205,202,0.15)',
          border: '1px solid rgba(35,205,202,0.3)', borderRadius: '12px',
          color: '#23CDCB', fontWeight: 600, fontSize: '0.875rem', backdropFilter: 'blur(20px)',
          display: 'flex', alignItems: 'center', gap: '0.5rem', animation: 'fadeInUp 0.3s ease-out',
        }}>
          <CheckCircle size={16} /> {toast}
        </div>
      )}

      <div>
          {/* Header */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <Brain size={20} style={{ color: '#a855f7' }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#a855f7', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {aktivesUnternehmen?.name}
              </span>
            </div>
            <h1 style={{
              fontSize: '2rem', fontWeight: 700,
              background: 'linear-gradient(135deg, #a855f7 0%, #23CDCB 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>
              {t.gedaechtnis.title}
            </h1>
            <p style={{ color: '#71717a', fontSize: '0.875rem', marginTop: '0.25rem' }}>
              {t.gedaechtnis.subtitle}
            </p>
          </div>

          <PageHelp id="intelligence" lang={i18n.language} />

          {/* Stats Bar */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '1rem', marginBottom: '2rem',
          }}>
            {[
              { icon: Brain, label: t.gedaechtnis.agentCount, value: `${experts.length}`, color: '#a855f7' },
              { icon: GitBranch, label: 'Knowledge Graph', value: `${kgFacts.length} ${i18n.language === 'de' ? 'Fakten' : 'facts'}`, color: '#22c55e' },
              { icon: TrendingUp, label: t.gedaechtnis.healthScore, value: `${avgHealth} / 100`, color: healthColor },
              { icon: Key, label: t.gedaechtnis.subscriptionBadge, value: `${cliExperten.length} CLI`, color: '#8b5cf6' },
            ].map(({ icon: Icon, label, value, color }, i) => (
              <div key={i} style={{
                padding: '1.25rem', background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.07)', borderRadius: '16px',
                display: 'flex', alignItems: 'center', gap: '1rem',
                animation: `fadeInUp 0.4s ease-out ${i * 0.08}s both`,
              }}>
                <div style={{ width: 40, height: 40, borderRadius: '10px', background: color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Icon size={18} style={{ color }} />
                </div>
                <div>
                  <div style={{ fontSize: '0.75rem', color: '#52525b', marginBottom: '0.25rem' }}>{label}</div>
                  <div style={{ fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>{value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Knowledge Graph (Company-weit) */}
          <KnowledgeGraphPanel facts={kgFacts} unternehmenId={aktivesUnternehmen?.id || ''} onRefresh={() => {
            if (!aktivesUnternehmen) return;
            authFetch(`/api/palace/kg/${aktivesUnternehmen.id}`).then(r => r.json()).then(setKgFacts).catch(() => {});
          }} />

          {/* Agent Wing Cards */}
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem', color: '#52525b' }}>
              <Cpu size={32} style={{ animation: 'spin 1s linear infinite', color: '#a855f7' }} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {experts.map(expert => (
                <WingCard key={expert.id} expert={expert} t={t} />
              ))}
              {experts.length === 0 && (
                <div style={{ textAlign: 'center', padding: '4rem 2rem', color: '#52525b' }}>
                  <Brain size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                  <div>Keine Agenten vorhanden</div>
                </div>
              )}
            </div>
          )}
      </div>
    </>
  );
}
