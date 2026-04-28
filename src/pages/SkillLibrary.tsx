import { useState, useEffect } from 'react';
import { Plus, BookOpen, Trash2, Edit3, X, Save, Tag, Bot, CheckCircle2, Search, Zap, TrendingUp, AlertTriangle } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import { authFetch } from '../utils/api';

interface Skill {
  id: string;
  unternehmenId: string;
  name: string;
  beschreibung: string | null;
  inhalt: string;
  tags: string | null;
  // Learning Loop Felder
  konfidenz?: number;
  nutzungen?: number;
  erfolge?: number;
  quelle?: 'manuell' | 'learning-loop' | 'clipmart';
  remoteRef?: string | null;
  erstelltVon?: string | null;
  erstelltAm: string;
  aktualisiertAm: string;
}

interface Experte {
  id: string;
  name: string;
  rolle: string;
}

// ─── Skill-Editor Modal ───────────────────────────────────────────────────────
function SkillEditor({
  unternehmenId,
  skill,
  onClose,
  onSaved,
}: {
  unternehmenId: string;
  skill: Skill | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(skill?.name ?? '');
  const [beschreibung, setBeschreibung] = useState(skill?.beschreibung ?? '');
  const [inhalt, setInhalt] = useState(skill?.inhalt ?? '');
  const [tagsRaw, setTagsRaw] = useState(
    skill?.tags ? (JSON.parse(skill.tags) as string[]).join(', ') : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim() || !inhalt.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean);
      const body = { name: name.trim(), beschreibung: beschreibung.trim() || null, inhalt: inhalt.trim(), tags };
      if (skill) {
        await authFetch(`/api/skills-library/${skill.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      } else {
        await authFetch(`/api/unternehmen/${unternehmenId}/skills-library`, { method: 'POST', body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Save error');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.625rem 0.75rem',
    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 0, color: '#ffffff', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box',
  };

  // i18n inside SkillEditor
  const editorI18n = useI18n();
  const sl = editorI18n.t.skillLibrary;
  const lang = editorI18n.language;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div style={{ width: '100%', maxWidth: 700, maxHeight: '90vh', overflowY: 'auto', background: 'rgba(10,10,20,0.98)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0, padding: '1.75rem', boxShadow: '0 32px 64px rgba(0,0,0,0.7)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem' }}>
          <BookOpen size={18} style={{ color: '#c5a059' }} />
          <h2 style={{ flex: 1, fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
            {skill ? sl.editSkill : sl.newSkill}
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={18} /></button>
        </div>

        {error && <div style={{ padding: '0.75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 0, color: '#f87171', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sl.name} *</label>
            <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder={lang === 'de' ? 'z.B. Mandantenkommunikation' : 'e.g. Client Communication'} autoFocus />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sl.description}</label>
            <input style={inputStyle} value={beschreibung} onChange={e => setBeschreibung(e.target.value)} placeholder={lang === 'de' ? 'Wofür wird dieser Skill verwendet?' : 'What is this skill used for?'} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {sl.content} *
            </label>
            <textarea
              rows={14}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 200, fontFamily: 'monospace', lineHeight: 1.6 }}
              value={inhalt}
              onChange={e => setInhalt(e.target.value)}
              placeholder={`# Skill-Name\n\n## Description\n...`}
            />
            <p style={{ fontSize: '0.7rem', color: '#334155', marginTop: 4 }}>
              {lang === 'de' ? 'Markdown wird unterstützt. Dieser Text wird automatisch in die Agenten-System-Prompts injiziert.' : 'Markdown supported. This text is automatically injected into agent system prompts.'}
            </p>
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sl.tags}</label>
            <input style={inputStyle} value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} placeholder={lang === 'de' ? 'z.B. steuerrecht, mandanten' : 'e.g. legal, clients'} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '0.625rem 1.25rem', borderRadius: 0, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', cursor: 'pointer', fontSize: '0.875rem' }}>
            {lang === 'de' ? 'Abbrechen' : 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim() || !inhalt.trim()}
            style={{ padding: '0.625rem 1.25rem', borderRadius: 0, background: name.trim() && inhalt.trim() ? '#c5a059' : 'rgba(197,160,89,0.3)', border: 'none', color: '#000', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <Save size={14} /> {saving ? (lang === 'de' ? 'Speichern…' : 'Saving…') : (lang === 'de' ? 'Speichern' : 'Save')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Expert Assignment Panel ──────────────────────────────────────────────────
function ExpertAssignPanel({ skill, experten, onClose }: { skill: Skill; experten: Experte[]; onClose: () => void }) {
  const assignI18n = useI18n();
  const lang = assignI18n.language;
  const [assignments, setAssignments] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState<string | null>(null);

  // Load current assignments for all experts
  useEffect(() => {
    Promise.all(
      experten.map(e =>
        authFetch(`/api/experten/${e.id}/skills-library`)
          .then(r => r.json())
          .then((skills: { id: string }[]) => ({ expertId: e.id, assigned: skills.some(s => s.id === skill.id) }))
      )
    ).then(results => {
      const map: Record<string, boolean> = {};
      results.forEach(r => { map[r.expertId] = r.assigned; });
      setAssignments(map);
    });
  }, [skill.id, experten.length]);

  const toggle = async (expertId: string, currentlyAssigned: boolean) => {
    setLoading(expertId);
    try {
      if (currentlyAssigned) {
        await authFetch(`/api/experten/${expertId}/skills-library/${skill.id}`, { method: 'DELETE' });
      } else {
        await authFetch(`/api/experten/${expertId}/skills-library`, { method: 'POST', body: JSON.stringify({ skillId: skill.id }) });
      }
      setAssignments(prev => ({ ...prev, [expertId]: !currentlyAssigned }));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }}>
      <div style={{ width: '100%', maxWidth: 480, background: 'rgba(10,10,20,0.98)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0, padding: '1.5rem', boxShadow: '0 32px 64px rgba(0,0,0,0.7)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.25rem' }}>
          <Bot size={16} style={{ color: '#c5a059' }} />
          <h3 style={{ flex: 1, fontSize: '1rem', fontWeight: 700, color: '#fff', margin: 0 }}>
            {lang === 'de' ? `Agenten zuweisen — ${skill.name}` : `Assign agents — ${skill.name}`}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}><X size={16} /></button>
        </div>
        <p style={{ fontSize: '0.8rem', color: '#475569', marginBottom: '1rem', lineHeight: 1.5 }}>
          {lang === 'de' ? 'Wähle, welche Agenten diesen Skill nutzen dürfen. Der Skill-Inhalt wird automatisch in ihren System-Prompt injiziert.' : 'Select which agents can use this skill. The skill content is automatically injected into their system prompt.'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {experten.map(experte => {
            const isAssigned = assignments[experte.id] ?? false;
            return (
              <div key={experte.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0.75rem', background: isAssigned ? 'rgba(197,160,89,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isAssigned ? 'rgba(197,160,89,0.2)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(155,135,200,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Bot size={16} style={{ color: '#a78bfa' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#e2e8f0' }}>{experte.name}</div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{experte.rolle}</div>
                </div>
                <button
                  onClick={() => toggle(experte.id, isAssigned)}
                  disabled={loading === experte.id}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                    background: isAssigned ? 'rgba(197,160,89,0.2)' : 'rgba(255,255,255,0.06)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: isAssigned ? '#c5a059' : '#475569', transition: 'all 0.15s',
                  }}
                >
                  <CheckCircle2 size={16} />
                </button>
              </div>
            );
          })}
          {experten.length === 0 && <p style={{ color: '#334155', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem' }}>{lang === 'de' ? 'Keine Agenten vorhanden.' : 'No agents available.'}</p>}
        </div>
        <button onClick={onClose} style={{ marginTop: '1.25rem', width: '100%', padding: '0.625rem', borderRadius: 0, background: 'rgba(197,160,89,0.15)', border: '1px solid rgba(197,160,89,0.3)', color: '#c5a059', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>
          {lang === 'de' ? 'Fertig' : 'Done'}
        </button>
      </div>
    </div>
  );
}

// ─── Hauptseite ───────────────────────────────────────────────────────────────
export function SkillLibrary() {
  const i18n = useI18n();
  const sl = i18n.t.skillLibrary;
  const lang = i18n.language;
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', i18n.t.nav.skillLibrary]);
  const [showEditor, setShowEditor] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [assigningSkill, setAssigningSkill] = useState<Skill | null>(null);
  const [search, setSearch] = useState('');
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<{ added: number } | null>(null);
  const [hasAttemptedSeed, setHasAttemptedSeed] = useState(false);

  const handleSeedStandardSkills = async () => {
    if (!aktivesUnternehmen) return;
    setSeeding(true);
    setSeedResult(null);
    try {
      const res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/skills-library/seed`, { method: 'POST' });
      const data = await res.json();
      setSeedResult({ added: data.added });
      reload();
      setTimeout(() => setSeedResult(null), 4000);
    } finally {
      setSeeding(false);
    }
  };

  const { data: skills, reload } = useApi<Skill[]>(
    () => authFetch(`/api/unternehmen/${aktivesUnternehmen!.id}/skills-library`).then(r => r.json()),
    [aktivesUnternehmen?.id],
  );

  // Auto-seed when library is empty on first load (only once)
  useEffect(() => {
    if (skills && skills.length === 0 && aktivesUnternehmen && !seeding && !hasAttemptedSeed) {
      setHasAttemptedSeed(true);
      handleSeedStandardSkills();
    }
  }, [skills, aktivesUnternehmen?.id, seeding, hasAttemptedSeed]);

  const { data: experten } = useApi<Experte[]>(
    () => authFetch(`/api/unternehmen/${aktivesUnternehmen!.id}/experten`).then(r => r.json()),
    [aktivesUnternehmen?.id],
  );

  const filtered = (skills ?? []).filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.beschreibung ?? '').toLowerCase().includes(q) || (s.tags ?? '').toLowerCase().includes(q);
  });

  const handleDelete = async (id: string) => {
    if (!window.confirm(sl.confirmDelete)) return;
    await authFetch(`/api/skills-library/${id}`, { method: 'DELETE' });
    reload();
  };

  if (!aktivesUnternehmen) return null;

  return (
    <div>
      <main>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ffffff', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              <BookOpen size={24} style={{ color: '#c5a059' }} /> {sl.title}
            </h1>
            <p style={{ color: '#64748b', marginTop: '0.4rem', fontSize: '0.9rem' }}>
              {sl.subtitle}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {seedResult && (
              <span style={{ fontSize: '0.8rem', color: '#c5a059', fontWeight: 600 }}>
                ✓ {seedResult.added} {lang === 'de' ? 'Skills hinzugefügt' : 'skills added'}
              </span>
            )}
            <button
              onClick={handleSeedStandardSkills}
              disabled={seeding}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.625rem 1.25rem', borderRadius: 0, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', cursor: seeding ? 'wait' : 'pointer', fontSize: '0.875rem', fontWeight: 600, opacity: seeding ? 0.6 : 1 }}
              title={lang === 'de' ? '50+ vordefinierte Skills aus der Standard-Bibliothek laden' : 'Load 50+ predefined skills from standard library'}
            >
              <Zap size={15} style={{ color: '#f59e0b' }} />
              {seeding ? (lang === 'de' ? 'Lädt…' : 'Loading…') : (lang === 'de' ? 'Standard-Skills laden' : 'Load Standard Skills')}
            </button>
            <button
              onClick={() => { setEditingSkill(null); setShowEditor(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.625rem 1.25rem', borderRadius: 0, background: 'rgba(197,160,89,0.15)', border: '1px solid rgba(197,160,89,0.35)', color: '#c5a059', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}
            >
              <Plus size={16} /> {sl.newSkill}
            </button>
          </div>
        </div>

        <PageHelp id="skill-library" lang={lang} />

        {/* Info Banner */}
        <div style={{ padding: '1rem 1.25rem', background: 'rgba(197,160,89,0.05)', border: '1px solid rgba(197,160,89,0.12)', borderRadius: 0, marginBottom: '1.5rem', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <Tag size={16} style={{ color: '#c5a059', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: '0.83rem', color: '#64748b', lineHeight: 1.6 }}>
            <strong style={{ color: '#94a3b8' }}>{lang === 'de' ? 'Wie es funktioniert:' : 'How it works:'}</strong> {sl.howItWorks}
          </div>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: '1.5rem' }}>
          <Search size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#475569' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={lang === 'de' ? 'Skills durchsuchen…' : 'Search skills…'}
            style={{ width: '100%', padding: '0.625rem 0.75rem 0.625rem 2.5rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0, color: '#e2e8f0', fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {/* Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {[
            { label: sl.totalSkills, value: skills?.length ?? 0, color: '#c5a059' },
            { label: lang === 'de' ? 'Von Learning Loop' : 'By Learning Loop', value: (skills ?? []).filter(s => s.quelle === 'learning-loop').length, color: '#eab308' },
            { label: lang === 'de' ? 'Avg. Konfidenz' : 'Avg. Confidence', value: (skills?.length ?? 0) > 0 ? Math.round((skills ?? []).reduce((a, s) => a + (s.konfidenz ?? 50), 0) / (skills?.length || 1)) + '%' : '—', color: '#22c55e' },
            { label: lang === 'de' ? 'Agenten' : 'Agents', value: experten?.length ?? 0, color: '#3b82f6' },
          ].map(s => (
            <div key={s.label} style={{ padding: '1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 0 }}>
              <div style={{ fontSize: '1.6rem', fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: '0.72rem', color: '#475569', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Skills Grid */}
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem 2rem', background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 0 }}>
            <BookOpen size={48} style={{ color: '#1e293b', margin: '0 auto 1rem', display: 'block' }} />
            <p style={{ color: '#475569', fontWeight: 600, marginBottom: '0.5rem' }}>
              {search ? (lang === 'de' ? 'Keine Skills gefunden' : 'No skills found') : sl.noSkills}
            </p>
            <p style={{ color: '#334155', fontSize: '0.85rem', lineHeight: 1.6, maxWidth: 400, margin: '0 auto 1.5rem' }}>
              {search ? (lang === 'de' ? 'Versuche einen anderen Suchbegriff.' : 'Try a different search term.') : sl.noSkillsHint}
            </p>
            {!search && (
              <button
                onClick={() => { setEditingSkill(null); setShowEditor(true); }}
                style={{ padding: '0.625rem 1.5rem', borderRadius: 0, background: 'rgba(197,160,89,0.15)', border: '1px solid rgba(197,160,89,0.3)', color: '#c5a059', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}
              >
                {lang === 'de' ? 'Ersten Skill erstellen' : 'Create First Skill'}
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
            {filtered.map(skill => {
              const tags: string[] = skill.tags ? JSON.parse(skill.tags).filter((t: string) => !t.startsWith('remote:')) : [];
              const charCount = skill.inhalt.length;
              const konfidenz = skill.konfidenz ?? 50;
              const isLearningLoop = skill.quelle === 'learning-loop';
              const isClipmart = skill.quelle === 'clipmart';
              const konfidenzFarbe = konfidenz >= 70 ? '#22c55e' : konfidenz >= 40 ? '#eab308' : '#ef4444';
              const erfolgsRate = (skill.nutzungen ?? 0) > 0 ? Math.round(((skill.erfolge ?? 0) / (skill.nutzungen ?? 1)) * 100) : 0;
              return (
                <div key={skill.id} style={{
                  background: 'rgba(255,255,255,0.025)',
                  border: `1px solid ${konfidenz < 20 ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 0, padding: '1.25rem',
                  display: 'flex', flexDirection: 'column', gap: 12, transition: 'border-color 0.2s',
                }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(197,160,89,0.25)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = konfidenz < 20 ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)')}
                >
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: 0,
                      background: isLearningLoop ? 'rgba(234,179,8,0.1)' : isClipmart ? 'rgba(155,135,200,0.1)' : 'rgba(197,160,89,0.1)',
                      border: `1px solid ${isLearningLoop ? 'rgba(234,179,8,0.2)' : isClipmart ? 'rgba(155,135,200,0.2)' : 'rgba(197,160,89,0.2)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {isLearningLoop ? <Zap size={17} style={{ color: '#eab308' }} /> :
                       isClipmart ? <TrendingUp size={17} style={{ color: '#a78bfa' }} /> :
                       <BookOpen size={17} style={{ color: '#c5a059' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e2e8f0' }}>{skill.name}</span>
                        {isLearningLoop && (
                          <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 0, background: 'rgba(234,179,8,0.15)', border: '1px solid rgba(234,179,8,0.3)', color: '#eab308', fontWeight: 700 }}>
                            LEARNING LOOP
                          </span>
                        )}
                        {isClipmart && (
                          <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 0, background: 'rgba(155,135,200,0.15)', border: '1px solid rgba(155,135,200,0.3)', color: '#a78bfa', fontWeight: 700 }}>
                            CLIPMART
                          </span>
                        )}
                      </div>
                      {skill.beschreibung && <div style={{ fontSize: '0.78rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.beschreibung}</div>}
                    </div>
                  </div>

                  {/* Konfidenz-Balken */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 6, borderRadius: 0, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${konfidenz}%`,
                        background: konfidenzFarbe,
                        borderRadius: 0,
                        transition: 'width 0.5s, background 0.3s',
                      }} />
                    </div>
                    <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: konfidenzFarbe, minWidth: 32, textAlign: 'right' }}>
                      {konfidenz}%
                    </span>
                    {konfidenz < 20 && <AlertTriangle size={12} style={{ color: '#ef4444' }} />}
                  </div>

                  {/* Preview */}
                  <div style={{ padding: '0.625rem 0.75rem', background: 'rgba(0,0,0,0.3)', borderRadius: 0, fontSize: '0.72rem', color: '#475569', lineHeight: 1.5, maxHeight: 64, overflow: 'hidden', fontFamily: 'monospace' }}>
                    {skill.inhalt.slice(0, 200)}
                    {skill.inhalt.length > 200 ? '...' : ''}
                  </div>

                  {/* Tags */}
                  {tags.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {tags.map(tag => (
                        <span key={tag} style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: 0, background: 'rgba(155,135,200,0.1)', border: '1px solid rgba(155,135,200,0.2)', color: '#a78bfa' }}>{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Meta + Learning Loop Stats */}
                  <div style={{ fontSize: '0.7rem', color: '#334155', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                    <span>{charCount.toLocaleString()} {sl.totalChars}</span>
                    {(skill.nutzungen ?? 0) > 0 && (
                      <span style={{ color: '#64748b' }}>
                        {skill.nutzungen}x {lang === 'de' ? 'genutzt' : 'used'} ({erfolgsRate}% {lang === 'de' ? 'Erfolg' : 'success'})
                      </span>
                    )}
                    <span>{new Date(skill.erstelltAm).toLocaleDateString()}</span>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 8, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
                    <button
                      onClick={() => setAssigningSkill(skill)}
                      style={{ flex: 1, padding: '0.5rem', borderRadius: 0, background: 'rgba(155,135,200,0.1)', border: '1px solid rgba(155,135,200,0.2)', color: '#a78bfa', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                    >
                      <Bot size={13} /> {sl.assignAgents}
                    </button>
                    <button
                      onClick={() => { setEditingSkill(skill); setShowEditor(true); }}
                      style={{ padding: '0.5rem 0.75rem', borderRadius: 0, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem' }}
                    >
                      <Edit3 size={13} /> {lang === 'de' ? 'Bearbeiten' : 'Edit'}
                    </button>
                    <button
                      onClick={() => handleDelete(skill.id)}
                      style={{ padding: '0.5rem 0.6rem', borderRadius: 0, background: 'transparent', border: '1px solid rgba(239,68,68,0.15)', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#f87171'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.4)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#64748b'; (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(239,68,68,0.15)'; }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {showEditor && (
        <SkillEditor
          unternehmenId={aktivesUnternehmen.id}
          skill={editingSkill}
          onClose={() => { setShowEditor(false); setEditingSkill(null); }}
          onSaved={() => { setShowEditor(false); setEditingSkill(null); reload(); }}
        />
      )}

      {assigningSkill && (
        <ExpertAssignPanel
          skill={assigningSkill}
          experten={experten ?? []}
          onClose={() => setAssigningSkill(null)}
        />
      )}
    </div>
  );
}
