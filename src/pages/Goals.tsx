import { useState, useCallback, useMemo } from 'react';
import { Target, Plus, Loader2, Trash2, Check, X, Edit2, ChevronRight, ChevronDown, TrendingUp, Award } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import { authFetch } from '../utils/api';
import { GlassCard } from '../components/GlassCard';

interface Ziel {
  id: string;
  titel: string;
  beschreibung?: string | null;
  ebene: 'company' | 'team' | 'agent' | 'task';
  status: 'planned' | 'active' | 'achieved' | 'cancelled';
  fortschritt: number;
  parentId?: string | null;
  erstelltAm: string;
}

const STATUS_OPTIONS = ['planned', 'active', 'achieved', 'cancelled'] as const;
const EBENE_OPTIONS = ['company', 'team', 'agent'] as const;

const STATUS_CFG: Record<string, { color: string; bg: string; label: { de: string; en: string } }> = {
  planned:   { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', label: { de: 'Geplant',     en: 'Planned'   } },
  active:    { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   label: { de: 'Aktiv',       en: 'Active'    } },
  achieved:  { color: '#c5a059', bg: 'rgba(197,160,89,0.1)', label: { de: 'Erreicht',    en: 'Achieved'  } },
  cancelled: { color: '#475569', bg: 'rgba(71,85,105,0.1)',  label: { de: 'Abgebrochen', en: 'Cancelled' } },
};

const EBENE_CFG: Record<string, { color: string; label: { de: string; en: string } }> = {
  company: { color: '#9b87c8', label: { de: 'Unternehmen', en: 'Company' } },
  team:    { color: '#3b82f6', label: { de: 'Team',        en: 'Team'    } },
  agent:   { color: '#c5a059', label: { de: 'Agent',       en: 'Agent'   } },
  task:    { color: '#f59e0b', label: { de: 'Aufgabe',     en: 'Task'    } },
};

function progressColor(pct: number): string {
  if (pct >= 100) return '#c5a059';
  if (pct >= 70)  return '#22c55e';
  if (pct >= 40)  return '#3b82f6';
  return '#94a3b8';
}

// ── GoalRow ───────────────────────────────────────────────────────────────────

function GoalRow({
  goal, depth, children, onUpdate, onDelete, de,
}: {
  goal: Ziel;
  depth: number;
  children?: React.ReactNode;
  onUpdate: (id: string, data: Partial<Ziel>) => void;
  onDelete: (id: string) => void;
  de: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [titel, setTitel] = useState(goal.titel);
  const [beschreibung, setBeschreibung] = useState(goal.beschreibung || '');
  const [status, setStatus] = useState(goal.status);
  const [fortschritt, setFortschritt] = useState(goal.fortschritt ?? 0);
  const [saving, setSaving] = useState(false);
  const hasChildren = !!children;

  const save = async () => {
    setSaving(true);
    await onUpdate(goal.id, { titel, beschreibung: beschreibung || null, status, fortschritt });
    setSaving(false);
    setEditing(false);
  };

  const cfg = STATUS_CFG[goal.status] ?? STATUS_CFG.planned;
  const ebene = EBENE_CFG[goal.ebene] ?? EBENE_CFG.company;
  const pct = goal.fortschritt ?? 0;
  const pColor = progressColor(pct);
  const indent = depth * 28;

  if (editing) {
    return (
      <div style={{ marginLeft: indent }}>
        <div style={{
          padding: '1rem', borderRadius: 0,
          background: 'rgba(197,160,89,0.04)', border: '1px solid rgba(197,160,89,0.2)',
          marginBottom: '0.5rem',
        }}>
          <input
            value={titel}
            onChange={e => setTitel(e.target.value)}
            autoFocus
            onKeyDown={e => e.key === 'Enter' && save()}
            style={{
              width: '100%', boxSizing: 'border-box', marginBottom: '0.5rem',
              padding: '0.5rem 0.75rem', borderRadius: 0, fontSize: '0.9375rem', fontWeight: 600,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#f1f5f9', outline: 'none',
            }}
          />
          <input
            value={beschreibung}
            onChange={e => setBeschreibung(e.target.value)}
            placeholder={de ? 'Beschreibung (optional)' : 'Description (optional)'}
            style={{
              width: '100%', boxSizing: 'border-box', marginBottom: '0.75rem',
              padding: '0.5rem 0.75rem', borderRadius: 0, fontSize: '0.8125rem',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#a1a1aa', outline: 'none',
            }}
          />

          {/* Progress slider */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                {de ? 'Fortschritt' : 'Progress'}
              </span>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: progressColor(fortschritt) }}>
                {fortschritt}%
              </span>
            </div>
            <input
              type="range"
              min={0} max={100} step={5}
              value={fortschritt}
              onChange={e => setFortschritt(Number(e.target.value))}
              style={{ width: '100%', accentColor: progressColor(fortschritt), cursor: 'pointer' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={status} onChange={e => setStatus(e.target.value as any)} style={{
              padding: '0.375rem 0.625rem', borderRadius: 0, fontSize: '0.8125rem',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: '#e4e4e7', cursor: 'pointer',
            }}>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_CFG[s].label[de ? 'de' : 'en']}</option>)}
            </select>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.375rem' }}>
              <button onClick={() => setEditing(false)} style={{
                padding: '0.375rem 0.75rem', borderRadius: 0, cursor: 'pointer', fontSize: '0.8125rem',
                background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b',
                display: 'flex', alignItems: 'center', gap: '0.25rem',
              }}>
                <X size={13} /> {de ? 'Abbrechen' : 'Cancel'}
              </button>
              <button onClick={save} disabled={saving || !titel.trim()} style={{
                padding: '0.375rem 0.875rem', borderRadius: 0, cursor: 'pointer', fontSize: '0.8125rem',
                background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.3)', color: '#c5a059',
                fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem',
                opacity: saving || !titel.trim() ? 0.6 : 1,
              }}>
                {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={13} />}
                {de ? 'Speichern' : 'Save'}
              </button>
            </div>
          </div>
        </div>
        {hasChildren && expanded && children}
      </div>
    );
  }

  return (
    <div style={{ marginLeft: indent }}>
      <GlassCard
        style={{ padding: '0.875rem 1rem', borderRadius: 0, marginBottom: '0.375rem', opacity: goal.status === 'cancelled' ? 0.5 : 1 }}
        accent={goal.status === 'active' ? '#22c55e' : goal.status === 'achieved' ? '#c5a059' : '#94a3b8'}
      >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.875rem' }}>
        {/* Expand/collapse toggle */}
        <button
          onClick={() => hasChildren && setExpanded(v => !v)}
          style={{
            width: 18, height: 18, borderRadius: 0, flexShrink: 0, marginTop: '0.2rem',
            background: 'transparent', border: 'none', cursor: hasChildren ? 'pointer' : 'default',
            color: hasChildren ? '#475569' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
          }}
        >
          {hasChildren
            ? (expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
            : <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.color, boxShadow: goal.status === 'active' ? `0 0 6px ${cfg.color}80` : 'none' }} />
          }
        </button>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.3rem' }}>
            <span style={{ fontSize: '0.9375rem', fontWeight: 600, color: goal.status === 'achieved' ? '#94a3b8' : '#f1f5f9', textDecoration: goal.status === 'cancelled' ? 'line-through' : 'none' }}>
              {goal.titel}
            </span>
            {goal.status === 'achieved' && <Award size={13} style={{ color: '#c5a059', flexShrink: 0 }} />}
          </div>

          {goal.beschreibung && (
            <div style={{ fontSize: '0.8125rem', color: '#64748b', lineHeight: 1.4, marginBottom: '0.5rem' }}>
              {goal.beschreibung}
            </div>
          )}

          {/* Progress bar */}
          {goal.status !== 'cancelled' && (
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <div style={{ flex: 1, height: 5, borderRadius: 0, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 0,
                    width: `${pct}%`, background: pColor,
                    transition: 'width 0.6s ease',
                    boxShadow: pct > 0 ? `0 0 6px ${pColor}60` : 'none',
                  }} />
                </div>
                <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: pColor, minWidth: 28, textAlign: 'right' }}>
                  {pct}%
                </span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{
              padding: '0.1rem 0.4rem', borderRadius: 0, fontSize: '0.625rem', fontWeight: 700,
              background: cfg.bg, color: cfg.color, letterSpacing: '0.03em',
            }}>
              {cfg.label[de ? 'de' : 'en']}
            </span>
            <span style={{
              padding: '0.1rem 0.4rem', borderRadius: 0, fontSize: '0.625rem', fontWeight: 700,
              background: ebene.color + '15', color: ebene.color, letterSpacing: '0.03em',
            }}>
              {ebene.label[de ? 'de' : 'en']}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
          <button onClick={() => setEditing(true)} style={{
            width: 28, height: 28, borderRadius: 0, border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.04)', color: '#475569', transition: 'color 0.15s',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#c5a059'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#475569'; }}>
            <Edit2 size={12} />
          </button>
          <button onClick={() => onDelete(goal.id)} style={{
            width: 28, height: 28, borderRadius: 0, border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(239,68,68,0.06)', color: '#3f3f46', transition: 'color 0.15s',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#3f3f46'; }}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>
      </GlassCard>

      {/* Children */}
      {hasChildren && expanded && children}
    </div>
  );
}

// ── Create form ───────────────────────────────────────────────────────────────

function CreateGoalForm({ unternehmenId, onCreated, de }: { unternehmenId: string; onCreated: () => void; de: boolean }) {
  const [open, setOpen] = useState(false);
  const [titel, setTitel] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [ebene, setEbene] = useState<'company' | 'team' | 'agent'>('company');
  const [status, setStatus] = useState<'planned' | 'active'>('planned');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!titel.trim()) return;
    setSaving(true);
    await authFetch(`/api/unternehmen/${unternehmenId}/ziele`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titel: titel.trim(), beschreibung: beschreibung.trim() || null, ebene, status }),
    });
    setTitel(''); setBeschreibung(''); setEbene('company'); setStatus('planned');
    setSaving(false);
    setOpen(false);
    onCreated();
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem',
        padding: '0.75rem 1.25rem', borderRadius: 0,
        background: 'rgba(197,160,89,0.08)', border: '1px dashed rgba(197,160,89,0.25)',
        color: '#c5a059', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
        width: '100%', justifyContent: 'center', transition: 'all 0.15s',
      }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(197,160,89,0.12)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(197,160,89,0.08)'; }}
      >
        <Plus size={15} /> {de ? 'Neues Ziel hinzufügen' : 'Add new goal'}
      </button>
    );
  }

  return (
    <div style={{
      padding: '1.25rem', borderRadius: 0,
      background: 'rgba(197,160,89,0.04)', border: '1px solid rgba(197,160,89,0.2)',
    }}>
      <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#c5a059', marginBottom: '1rem' }}>
        {de ? 'Neues Ziel' : 'New Goal'}
      </div>
      <input
        value={titel}
        onChange={e => setTitel(e.target.value)}
        placeholder={de ? 'Ziel-Titel *' : 'Goal title *'}
        autoFocus
        onKeyDown={e => e.key === 'Enter' && save()}
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: '0.625rem',
          padding: '0.625rem 0.75rem', borderRadius: 0, fontSize: '0.9375rem', fontWeight: 600,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          color: '#f1f5f9', outline: 'none',
        }}
      />
      <input
        value={beschreibung}
        onChange={e => setBeschreibung(e.target.value)}
        placeholder={de ? 'Beschreibung (optional)' : 'Description (optional)'}
        style={{
          width: '100%', boxSizing: 'border-box', marginBottom: '0.625rem',
          padding: '0.625rem 0.75rem', borderRadius: 0, fontSize: '0.8125rem',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          color: '#a1a1aa', outline: 'none',
        }}
      />
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <select value={ebene} onChange={e => setEbene(e.target.value as any)} style={{
          padding: '0.375rem 0.625rem', borderRadius: 0, fontSize: '0.8125rem',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          color: '#e4e4e7', cursor: 'pointer',
        }}>
          {EBENE_OPTIONS.map(e => <option key={e} value={e}>{EBENE_CFG[e].label[de ? 'de' : 'en']}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value as any)} style={{
          padding: '0.375rem 0.625rem', borderRadius: 0, fontSize: '0.8125rem',
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          color: '#e4e4e7', cursor: 'pointer',
        }}>
          <option value="planned">{STATUS_CFG.planned.label[de ? 'de' : 'en']}</option>
          <option value="active">{STATUS_CFG.active.label[de ? 'de' : 'en']}</option>
        </select>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <button onClick={() => setOpen(false)} style={{
          padding: '0.5rem 1rem', borderRadius: 0, cursor: 'pointer', fontSize: '0.8125rem',
          background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b',
        }}>
          {de ? 'Abbrechen' : 'Cancel'}
        </button>
        <button onClick={save} disabled={saving || !titel.trim()} style={{
          padding: '0.5rem 1.125rem', borderRadius: 0, cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 700,
          background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.3)', color: '#c5a059',
          display: 'flex', alignItems: 'center', gap: '0.375rem',
          opacity: saving || !titel.trim() ? 0.6 : 1,
        }}>
          {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={13} />}
          {de ? 'Erstellen' : 'Create'}
        </button>
      </div>
    </div>
  );
}

// ── Build tree ────────────────────────────────────────────────────────────────

function buildTree(goals: Ziel[]): { roots: Ziel[]; childrenOf: Map<string, Ziel[]> } {
  const childrenOf = new Map<string, Ziel[]>();
  const allIds = new Set(goals.map(g => g.id));
  const roots: Ziel[] = [];
  for (const g of goals) {
    const parent = g.parentId && allIds.has(g.parentId) ? g.parentId : null;
    if (!parent) {
      roots.push(g);
    } else {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(g);
    }
  }
  return { roots, childrenOf };
}

function renderTree(
  goals: Ziel[],
  childrenOf: Map<string, Ziel[]>,
  depth: number,
  onUpdate: (id: string, data: Partial<Ziel>) => void,
  onDelete: (id: string) => void,
  de: boolean,
): React.ReactNode {
  return goals.map(g => {
    const kids = childrenOf.get(g.id) || [];
    return (
      <GoalRow
        key={g.id} goal={g} depth={depth}
        onUpdate={onUpdate} onDelete={onDelete} de={de}
        children={kids.length > 0 ? renderTree(kids, childrenOf, depth + 1, onUpdate, onDelete, de) : undefined}
      />
    );
  });
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function Goals() {
  const i18n = useI18n();
  const de = i18n.language === 'de';
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', de ? 'Ziele' : 'Goals']);

  const { data, loading, reload } = useApi<Ziel[]>(
    () => authFetch(`/api/unternehmen/${aktivesUnternehmen!.id}/ziele`).then(r => r.json()),
    [aktivesUnternehmen?.id],
  );

  const [filterStatus, setFilterStatus] = useState<string>('all');

  const updateGoal = useCallback(async (id: string, updates: Partial<Ziel>) => {
    await authFetch(`/api/ziele/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    reload();
  }, [reload]);

  const deleteGoal = useCallback(async (id: string) => {
    await authFetch(`/api/ziele/${id}`, { method: 'DELETE' });
    reload();
  }, [reload]);

  const stats = useMemo(() => {
    if (!data) return { total: 0, active: 0, achieved: 0, avgProgress: 0 };
    const active   = data.filter(g => g.status === 'active');
    const achieved = data.filter(g => g.status === 'achieved');
    const withProgress = active.filter(g => g.fortschritt > 0);
    const avgProgress = active.length > 0
      ? Math.round(active.reduce((s, g) => s + (g.fortschritt ?? 0), 0) / active.length)
      : 0;
    return { total: data.length, active: active.length, achieved: achieved.length, avgProgress, withProgress: withProgress.length };
  }, [data]);

  const { filteredRoots, childrenOf } = useMemo(() => {
    if (!data) return { filteredRoots: [], childrenOf: new Map<string, Ziel[]>() };
    const filtered = filterStatus === 'all' ? data : data.filter(g => g.status === filterStatus);
    const { roots, childrenOf } = buildTree(filtered);
    return { filteredRoots: roots, childrenOf };
  }, [data, filterStatus]);

  if (!aktivesUnternehmen) return null;

  if (loading || !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#c5a059' }} />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <Target size={20} style={{ color: '#22c55e' }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#22c55e', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              {aktivesUnternehmen.name}
            </span>
          </div>
          <h1 style={{
            fontSize: '2rem', fontWeight: 700, margin: 0,
            background: 'linear-gradient(135deg, #22c55e 0%, #c5a059 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
          }}>
            {de ? 'Unternehmensziele' : 'Goals & OKRs'}
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.25rem' }}>
            {de ? 'Strategische Ziele und Meilensteine Ihres Unternehmens' : "Track your company's strategic goals and milestones"}
          </p>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {[
            { label: de ? 'Gesamt'   : 'Total',    value: stats.total,       color: '#94a3b8' },
            { label: de ? 'Aktiv'    : 'Active',   value: stats.active,      color: '#22c55e' },
            { label: de ? 'Erreicht' : 'Achieved', value: stats.achieved,    color: '#c5a059' },
          ].map(s => (
            <GlassCard key={s.label} style={{ padding: '0.875rem 1.25rem', borderRadius: 0, textAlign: 'center' }} accent={s.color}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '0.6875rem', color: '#475569', fontWeight: 500 }}>{s.label}</div>
            </GlassCard>
          ))}

          {/* Average progress card */}
          {stats.active > 0 && (
            <GlassCard style={{ padding: '0.875rem 1.25rem', borderRadius: 0, textAlign: 'center', minWidth: 100 }} accent="#22c55e">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', marginBottom: '0.25rem' }}>
                <TrendingUp size={12} style={{ color: progressColor(stats.avgProgress) }} />
                <span style={{ fontSize: '1.5rem', fontWeight: 800, color: progressColor(stats.avgProgress) }}>
                  {stats.avgProgress}%
                </span>
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#475569', fontWeight: 500 }}>
                {de ? 'Ø Fortschritt' : 'Avg Progress'}
              </div>
            </GlassCard>
          )}
        </div>
      </div>

      <PageHelp id="goals" lang={de ? 'de' : 'en'} />

      {/* Progress overview bar (only when there are active goals with progress) */}
      {stats.active > 0 && stats.avgProgress > 0 && (
        <GlassCard style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', flexShrink: 0 }}>
              {de ? 'Gesamtfortschritt' : 'Overall Progress'}
            </div>
            <div style={{ flex: 1, height: 8, borderRadius: 0, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 0,
                width: `${stats.avgProgress}%`,
                background: `linear-gradient(90deg, #22c55e, #c5a059)`,
                transition: 'width 0.8s ease',
                boxShadow: '0 0 10px rgba(197,160,89,0.4)',
              }} />
            </div>
            <div style={{ fontSize: '0.875rem', fontWeight: 800, color: '#c5a059', flexShrink: 0 }}>
              {stats.avgProgress}%
            </div>
          </div>
        </GlassCard>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {(['all', ...STATUS_OPTIONS] as const).map(s => {
          const isActive = filterStatus === s;
          const cfg = s === 'all'
            ? { color: '#94a3b8', label: de ? 'Alle' : 'All' }
            : { color: STATUS_CFG[s].color, label: STATUS_CFG[s].label[de ? 'de' : 'en'] };
          return (
            <button key={s} onClick={() => setFilterStatus(s)} style={{
              padding: '0.375rem 0.875rem', borderRadius: '9999px', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer',
              background: isActive ? cfg.color + '15' : 'transparent',
              border: `1px solid ${isActive ? cfg.color : 'rgba(255,255,255,0.08)'}`,
              color: isActive ? cfg.color : '#475569',
              transition: 'all 0.15s',
            }}>
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Goals tree */}
      <GlassCard style={{ padding: '1.5rem' }}>
        {filteredRoots.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <Target size={40} style={{ opacity: 0.15, marginBottom: '1rem', color: '#22c55e' }} />
            <p style={{ color: '#475569', fontWeight: 600, fontSize: '0.9375rem', margin: '0 0 0.25rem' }}>
              {de ? 'Noch keine Ziele' : 'No goals yet'}
            </p>
            <p style={{ color: '#334155', fontSize: '0.8125rem', margin: 0 }}>
              {de ? 'Definiere strategische Ziele für dein Team' : 'Define strategic goals for your team'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginBottom: '1rem' }}>
            {renderTree(filteredRoots, childrenOf, 0, updateGoal, deleteGoal, de)}
          </div>
        )}

        <CreateGoalForm unternehmenId={aktivesUnternehmen.id} onCreated={reload} de={de} />
      </GlassCard>
    </div>
  );
}
