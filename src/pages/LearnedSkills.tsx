import { useState, useEffect, useCallback, useMemo } from 'react';
import { Brain, Pin, PinOff, Power, PowerOff, Trash2, Search, RefreshCw, Loader2, AlertTriangle, Edit3, Save, X } from 'lucide-react';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useCompany } from '../hooks/useCompany';
import { authFetch } from '../utils/api';
import { GlassCard } from '../components/GlassCard';

interface LearnedSkill {
  id: string;
  companyId: string;
  sourceAgentId: string | null;
  sourceAgentName: string | null;
  sourceTaskId: string | null;
  sourceRunId: string | null;
  title: string;
  pattern: string;
  recipe: string;
  keywords: string[];
  confidence: number;
  useCount: number;
  lastUsedAt: string | null;
  isPinned: boolean;
  isDisabled: boolean;
  extractedBy: 'heuristic' | 'llm';
  createdAt: string;
  updatedAt: string;
}

export function LearnedSkills() {
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', 'Learned Skills']);

  const [skills, setSkills] = useState<LearnedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showDisabled, setShowDisabled] = useState(false);
  const [editing, setEditing] = useState<LearnedSkill | null>(null);

  const reload = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await authFetch(
        `/api/companies/${aktivesUnternehmen.id}/learned-skills${showDisabled ? '?includeDisabled=1' : ''}`,
        { headers: { 'x-unternehmen-id': aktivesUnternehmen.id } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSkills(await res.json());
    } catch (e: any) {
      setErr(e?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [aktivesUnternehmen, showDisabled]);

  useEffect(() => { reload(); }, [reload]);

  const filtered = useMemo(() => {
    if (!search.trim()) return skills;
    const q = search.toLowerCase();
    return skills.filter(s =>
      s.title.toLowerCase().includes(q) ||
      s.pattern.toLowerCase().includes(q) ||
      s.recipe.toLowerCase().includes(q) ||
      s.keywords.some(k => k.toLowerCase().includes(q))
    );
  }, [skills, search]);

  const patch = async (id: string, body: Partial<LearnedSkill>) => {
    await authFetch(`/api/learned-skills/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    reload();
  };
  const del = async (id: string) => {
    if (!confirm('Diesen gelernten Skill löschen?')) return;
    await authFetch(`/api/learned-skills/${id}`, { method: 'DELETE' });
    reload();
  };

  const headerStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 };
  const labelStyle: React.CSSProperties = { fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginTop: 8 };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Brain size={24} style={{ color: '#c5a059' }} />
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#f4f4f5', margin: 0 }}>
          Learned Skills
        </h1>
        <span style={{ fontSize: 11, color: '#71717a', padding: '3px 8px', background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.3)', borderRadius: 4 }}>
          AUTO-EXTRACTED
        </span>
      </div>
      <p style={{ color: '#a1a1aa', fontSize: 13, marginBottom: 24, maxWidth: 700, lineHeight: 1.5 }}>
        Wiederverwendbare Muster, die das System automatisch aus erfolgreich abgeschlossenen Tasks lernt.
        Wenn ein Agent einen ähnlichen Task bekommt, werden die passendsten Patterns automatisch in seinen Kontext injiziert.
        Pin wichtige Skills oder deaktiviere irrelevante.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 240 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: '#71717a' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suche nach Titel, Pattern oder Keyword…"
            style={{
              width: '100%', padding: '8px 10px 8px 32px',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6, color: '#f4f4f5', fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#a1a1aa', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDisabled} onChange={e => setShowDisabled(e.target.checked)} />
          Deaktivierte zeigen
        </label>
        <button
          onClick={reload}
          style={{ padding: '7px 12px', background: 'transparent', border: '1px solid #52525b', borderRadius: 6, color: '#a1a1aa', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={13} /> Reload
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#71717a' }}>
          {filtered.length} / {skills.length}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: '#71717a' }}>
          <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginRight: 10 }} /> Lädt...
        </div>
      ) : err ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: '#ef4444', flexDirection: 'column', gap: 12 }}>
          <AlertTriangle size={28} /> {err}
        </div>
      ) : filtered.length === 0 ? (
        <GlassCard style={{ padding: 40, textAlign: 'center' }}>
          <Brain size={36} style={{ color: '#52525b', marginBottom: 12 }} />
          <div style={{ color: '#a1a1aa', fontSize: 14, marginBottom: 8 }}>
            {skills.length === 0
              ? 'Noch keine Learned Skills.'
              : 'Keine Skills für diese Suche.'}
          </div>
          {skills.length === 0 && (
            <div style={{ color: '#71717a', fontSize: 12, maxWidth: 480, margin: '0 auto' }}>
              Wenn ein Agent einen Task erfolgreich abschließt (mit Critic-Approval), wird automatisch ein wiederverwendbares Muster extrahiert und hier angezeigt.
            </div>
          )}
        </GlassCard>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {filtered.map(s => (
            <GlassCard
              key={s.id}
              style={{
                padding: 16,
                opacity: s.isDisabled ? 0.45 : 1,
                borderLeft: s.isPinned ? '3px solid #c5a059' : undefined,
              }}
            >
              <div style={headerStyle}>
                {s.isPinned && <Pin size={13} style={{ color: '#c5a059' }} />}
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#f4f4f5', margin: 0, flex: 1 }}>
                  {s.title}
                </h3>
                <span style={{ fontSize: 10, color: '#a1a1aa', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 3 }}>
                  conf {s.confidence}
                </span>
                <span style={{ fontSize: 10, color: '#a1a1aa', padding: '2px 6px', background: 'rgba(255,255,255,0.05)', borderRadius: 3 }}>
                  used {s.useCount}×
                </span>
                {s.extractedBy === 'llm' && (
                  <span style={{ fontSize: 9, color: '#c5a059', padding: '2px 6px', border: '1px solid rgba(197,160,89,0.3)', borderRadius: 3 }}>
                    LLM
                  </span>
                )}
              </div>
              {s.sourceAgentName && (
                <div style={{ fontSize: 11, color: '#71717a', marginBottom: 8 }}>
                  von <span style={{ color: '#a1a1aa' }}>{s.sourceAgentName}</span> · {new Date(s.createdAt).toLocaleDateString()}
                </div>
              )}
              <div style={labelStyle}>WHEN</div>
              <div style={{ fontSize: 12, color: '#d4d4d8', lineHeight: 1.5 }}>{s.pattern}</div>
              <div style={labelStyle}>RECIPE</div>
              <pre style={{ fontSize: 11, color: '#a1a1aa', background: 'rgba(0,0,0,0.25)', padding: 10, borderRadius: 4, overflow: 'auto', maxHeight: 240, margin: '4px 0 8px', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' }}>
                {s.recipe}
              </pre>
              {s.keywords.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                  {s.keywords.map(k => (
                    <span key={k} style={{ fontSize: 10, color: '#a1a1aa', padding: '2px 6px', background: 'rgba(197,160,89,0.08)', borderRadius: 3 }}>
                      {k}
                    </span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <button
                  onClick={() => patch(s.id, { isPinned: !s.isPinned })}
                  title={s.isPinned ? 'Unpin' : 'Pin'}
                  style={{ padding: '5px 10px', background: 'transparent', border: '1px solid #3f3f46', borderRadius: 5, color: s.isPinned ? '#c5a059' : '#71717a', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  {s.isPinned ? <PinOff size={11} /> : <Pin size={11} />}
                  {s.isPinned ? 'Unpin' : 'Pin'}
                </button>
                <button
                  onClick={() => patch(s.id, { isDisabled: !s.isDisabled })}
                  title={s.isDisabled ? 'Aktivieren' : 'Deaktivieren'}
                  style={{ padding: '5px 10px', background: 'transparent', border: '1px solid #3f3f46', borderRadius: 5, color: s.isDisabled ? '#71717a' : '#a1a1aa', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  {s.isDisabled ? <Power size={11} /> : <PowerOff size={11} />}
                  {s.isDisabled ? 'Aktivieren' : 'Deaktivieren'}
                </button>
                <button
                  onClick={() => setEditing(s)}
                  style={{ padding: '5px 10px', background: 'transparent', border: '1px solid #3f3f46', borderRadius: 5, color: '#a1a1aa', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                >
                  <Edit3 size={11} /> Bearbeiten
                </button>
                <button
                  onClick={() => del(s.id)}
                  style={{ padding: '5px 10px', background: 'transparent', border: '1px solid #3f3f46', borderRadius: 5, color: '#ef4444', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, marginLeft: 'auto' }}
                >
                  <Trash2 size={11} /> Löschen
                </button>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {editing && (
        <EditModal
          skill={editing}
          onClose={() => setEditing(null)}
          onSave={async (changes) => {
            await patch(editing.id, changes);
            setEditing(null);
          }}
        />
      )}

    </div>
  );
}

// ── Edit Modal ───────────────────────────────────────────────────────────────
function EditModal({ skill, onClose, onSave }: { skill: LearnedSkill; onClose: () => void; onSave: (changes: Partial<LearnedSkill>) => Promise<void> }) {
  const [title, setTitle] = useState(skill.title);
  const [pattern, setPattern] = useState(skill.pattern);
  const [recipe, setRecipe] = useState(skill.recipe);
  const [saving, setSaving] = useState(false);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0a0a0f', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 20, width: '90%', maxWidth: 720, maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, color: '#f4f4f5', margin: 0, flex: 1 }}>Skill bearbeiten</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#71717a', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Title</div>
        <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle} />
        <div style={{ fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 12, marginBottom: 4 }}>When (Pattern)</div>
        <textarea value={pattern} onChange={e => setPattern(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
        <div style={{ fontSize: 11, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: 12, marginBottom: 4 }}>Recipe</div>
        <textarea value={recipe} onChange={e => setRecipe(e.target.value)} rows={12} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'ui-monospace, monospace' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 14px', background: 'transparent', border: '1px solid #3f3f46', borderRadius: 5, color: '#a1a1aa', cursor: 'pointer' }}>Abbrechen</button>
          <button
            onClick={async () => { setSaving(true); await onSave({ title, pattern, recipe }); setSaving(false); }}
            disabled={saving || !title.trim() || !pattern.trim() || !recipe.trim()}
            style={{ padding: '7px 14px', background: '#c5a059', border: 'none', borderRadius: 5, color: '#0a0a0f', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}
          >
            <Save size={13} /> {saving ? 'Speichern...' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 5, color: '#f4f4f5', fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
