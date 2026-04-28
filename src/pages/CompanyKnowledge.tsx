import { useState, useEffect, useCallback, useMemo } from 'react';
import { Brain, Search, Plus, Trash2, X, CheckCircle, Tag, Database, Sparkles } from 'lucide-react';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { authFetch } from '../utils/api';
import { PageHelp } from '../components/PageHelp';

interface KgFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  erstelltAm: string;
}

const PRESET_PREDICATES = [
  'ist', 'hat', 'verwendet', 'besitzt', 'arbeitet_an', 'gehört_zu',
  'erstellt', 'aktualisiert', 'benötigt', 'verantwortlich_für',
  'ist_ein', 'enthält', 'produziert', 'integriert_mit',
];

const PREDICATE_LABELS_DE: Record<string, string> = {
  ist: 'ist',
  hat: 'hat',
  verwendet: 'verwendet',
  besitzt: 'besitzt',
  arbeitet_an: 'arbeitet an',
  gehört_zu: 'gehört zu',
  erstellt: 'erstellt',
  aktualisiert: 'aktualisiert',
  benötigt: 'benötigt',
  verantwortlich_für: 'verantwortlich für',
  ist_ein: 'ist ein',
  enthält: 'enthält',
  produziert: 'produziert',
  integriert_mit: 'integriert mit',
};

const PREDICATE_LABELS_EN: Record<string, string> = {
  ist: 'is',
  hat: 'has',
  verwendet: 'uses',
  besitzt: 'owns',
  arbeitet_an: 'works on',
  gehört_zu: 'belongs to',
  erstellt: 'created',
  aktualisiert: 'updated',
  benötigt: 'needs',
  verantwortlich_für: 'responsible for',
  ist_ein: 'is a',
  enthält: 'contains',
  produziert: 'produces',
  integriert_mit: 'integrates with',
};

const predicateLabel = (p: string, de: boolean) =>
  (de ? PREDICATE_LABELS_DE : PREDICATE_LABELS_EN)[p] || p;

function predicateColor(p: string) {
  const colors: Record<string, string> = {
    ist: '#9b87c8', hat: '#22c55e', verwendet: '#3b82f6', besitzt: '#f59e0b',
    arbeitet_an: '#c5a059', gehört_zu: '#6366f1', erstellt: '#22c55e',
    aktualisiert: '#3b82f6', benötigt: '#ef4444', verantwortlich_für: '#c5a059',
    ist_ein: '#9b87c8', enthält: '#6366f1', produziert: '#22c55e', integriert_mit: '#3b82f6',
  };
  return colors[p] || '#71717a';
}

export function CompanyKnowledge() {
  const i18n = useI18n();
  const t = i18n.t;
  const { aktivesUnternehmen } = useCompany();
  const de = i18n.language === 'de';
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', de ? 'Wissensbasis' : 'Knowledge']);

  const [facts, setFacts] = useState<KgFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newPredicate, setNewPredicate] = useState('ist');
  const [newObject, setNewObject] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  const load = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    setLoading(true);
    try {
      const res = await authFetch(`/api/palace/kg/${aktivesUnternehmen.id}`);
      const data = await res.json();
      setFacts(Array.isArray(data) ? data : []);
    } catch { setFacts([]); }
    setLoading(false);
  }, [aktivesUnternehmen]);

  useEffect(() => { load(); }, [load]);

  const addFact = async () => {
    if (!newSubject.trim() || !newObject.trim() || !aktivesUnternehmen) return;
    setSaving(true);
    try {
      await authFetch(`/api/palace/kg/${aktivesUnternehmen.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: newSubject.trim(),
          predicate: newPredicate.trim(),
          object: newObject.trim(),
        }),
      });
      setNewSubject(''); setNewObject(''); setShowAdd(false);
      await load();
      showToast(de ? 'Fakt hinzugefügt' : 'Fact added');
    } catch {}
    setSaving(false);
  };

  const deleteFact = async (id: string) => {
    setDeleting(id);
    try {
      await authFetch(`/api/palace/kg/${id}`, { method: 'DELETE' });
      setFacts(prev => prev.filter(f => f.id !== id));
      showToast(de ? 'Fakt entfernt' : 'Fact removed');
    } catch {}
    setDeleting(null);
  };

  const sq = search.toLowerCase().trim();
  const filtered = useMemo(() => {
    if (!sq) return facts;
    return facts.filter(f =>
      f.subject.toLowerCase().includes(sq) ||
      f.predicate.toLowerCase().includes(sq) ||
      f.object.toLowerCase().includes(sq)
    );
  }, [facts, sq]);

  // Group by predicate for stats
  const predicateCounts = useMemo(() => {
    const map = new Map<string, number>();
    facts.forEach(f => map.set(f.predicate, (map.get(f.predicate) || 0) + 1));
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [facts]);

  return (
    <div>
      {toast && (
        <div style={{
          position: 'fixed', bottom: '2rem', right: '2rem', zIndex: 9999,
          padding: '0.875rem 1.25rem', background: 'rgba(34,197,94,0.15)',
          border: '1px solid rgba(34,197,94,0.3)', borderRadius: 0,
          color: '#22c55e', fontWeight: 600, fontSize: '0.875rem', backdropFilter: 'blur(20px)',
          display: 'flex', alignItems: 'center', gap: '0.5rem', animation: 'fadeInUp 0.3s ease-out',
        }}>
          <CheckCircle size={16} /> {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <Brain size={20} style={{ color: '#9b87c8' }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#9b87c8', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {aktivesUnternehmen?.name}
          </span>
        </div>
        <h1 style={{
          fontSize: '2rem', fontWeight: 700,
          background: 'linear-gradient(135deg, #9b87c8 0%, #c5a059 100%)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
        }}>
          {de ? 'Wissensbasis' : 'Company Knowledge'}
        </h1>
        <p style={{ color: '#71717a', fontSize: '0.875rem', marginTop: '0.25rem' }}>
          {de
            ? 'Was das System über dein Unternehmen weiß — verknüpfte Fakten, die Agenten für Entscheidungen nutzen.'
            : 'What the system knows about your company — linked facts that agents use for decisions.'}
        </p>
      </div>

      <PageHelp id="intelligence" lang={i18n.language} />

      {/* Stats Bar */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '1rem', marginBottom: '2rem',
      }}>
        {[
          { icon: Database, label: de ? 'Gesamtfakten' : 'Total Facts', value: `${facts.length}`, color: '#9b87c8' },
          { icon: Tag, label: de ? 'Kategorien' : 'Categories', value: `${predicateCounts.length}`, color: '#22c55e' },
          { icon: Sparkles, label: de ? 'Zuletzt aktualisiert' : 'Last Updated', value: facts.length > 0 ? new Date(facts[0].erstelltAm).toLocaleDateString(de ? 'de-DE' : 'en-US') : '—', color: '#c5a059' },
        ].map(({ icon: Icon, label, value, color }, i) => (
          <div key={i} style={{
            padding: '1.25rem', background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.07)', borderRadius: 0,
            display: 'flex', alignItems: 'center', gap: '1rem',
          }}>
            <div style={{ width: 40, height: 40, borderRadius: 0, background: color + '15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon size={18} style={{ color }} />
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#52525b', marginBottom: '0.25rem' }}>{label}</div>
              <div style={{ fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Predicate filter chips */}
      {predicateCounts.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
          {predicateCounts.map(([p, count]) => (
            <button
              key={p}
              onClick={() => setSearch(s => s === p ? '' : p)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.35rem 0.75rem', borderRadius: 0,
                background: search === p ? `${predicateColor(p)}18` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${search === p ? `${predicateColor(p)}40` : 'rgba(255,255,255,0.07)'}`,
                color: search === p ? predicateColor(p) : '#71717a',
                fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Tag size={11} />
              {predicateLabel(p, de)}
              <span style={{ opacity: 0.6, fontWeight: 400 }}>{count}</span>
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '1rem',
        marginBottom: '1.5rem', flexWrap: 'wrap',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          flex: 1, minWidth: 200,
          padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.07)', borderRadius: 0,
        }}>
          <Search size={16} style={{ color: '#52525b', flexShrink: 0 }} />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={de ? 'Fakten durchsuchen…' : 'Search facts…'}
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: '#e4e4e7', fontSize: '0.875rem', width: '100%',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52525b' }}>
              <X size={14} />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 1rem', borderRadius: 0,
            background: showAdd ? 'rgba(155,135,200,0.15)' : 'rgba(255,255,255,0.03)',
            border: `1px solid ${showAdd ? 'rgba(155,135,200,0.35)' : 'rgba(255,255,255,0.08)'}`,
            color: showAdd ? '#a78bfa' : '#e4e4e7',
            fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer',
          }}
        >
          {showAdd ? <X size={16} /> : <Plus size={16} />}
          {de ? 'Fakt hinzufügen' : 'Add Fact'}
        </button>
      </div>

      {/* Add Fact Form */}
      {showAdd && (
        <div style={{
          padding: '1.25rem', background: 'rgba(155,135,200,0.04)',
          border: '1px solid rgba(155,135,200,0.15)', borderRadius: 0,
          marginBottom: '1.5rem',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr auto 1fr',
            gap: '0.75rem', alignItems: 'end',
          }}>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#71717a', fontWeight: 600, display: 'block', marginBottom: '0.375rem' }}>
                {de ? 'Subjekt' : 'Subject'}
              </label>
              <input
                type="text"
                value={newSubject}
                onChange={e => setNewSubject(e.target.value)}
                placeholder={de ? 'z.B. Kunde X' : 'e.g. Customer X'}
                style={{
                  width: '100%', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0,
                  color: '#e4e4e7', fontSize: '0.875rem', outline: 'none',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#71717a', fontWeight: 600, display: 'block', marginBottom: '0.375rem' }}>
                {de ? 'Beziehung' : 'Relation'}
              </label>
              <select
                value={newPredicate}
                onChange={e => setNewPredicate(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0,
                  color: '#e4e4e7', fontSize: '0.875rem', outline: 'none',
                }}
              >
                {PRESET_PREDICATES.map(p => (
                  <option key={p} value={p} style={{ background: '#1a1a24' }}>
                    {predicateLabel(p, de)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem', color: '#71717a', fontWeight: 600, display: 'block', marginBottom: '0.375rem' }}>
                {de ? 'Objekt' : 'Object'}
              </label>
              <input
                type="text"
                value={newObject}
                onChange={e => setNewObject(e.target.value)}
                placeholder={de ? 'z.B. Produkt Y' : 'e.g. Product Y'}
                style={{
                  width: '100%', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.2)',
                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: 0,
                  color: '#e4e4e7', fontSize: '0.875rem', outline: 'none',
                }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.875rem' }}>
            <button
              onClick={addFact}
              disabled={saving || !newSubject.trim() || !newObject.trim()}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.5rem 1.25rem', borderRadius: 0,
                background: saving ? 'rgba(155,135,200,0.1)' : 'rgba(155,135,200,0.2)',
                border: '1px solid rgba(155,135,200,0.3)',
                color: '#a78bfa', fontSize: '0.875rem', fontWeight: 600,
                cursor: saving || !newSubject.trim() || !newObject.trim() ? 'default' : 'pointer',
                opacity: saving || !newSubject.trim() || !newObject.trim() ? 0.5 : 1,
              }}
            >
              {saving ? '…' : <><Plus size={16} /> {de ? 'Speichern' : 'Save'}</>}
            </button>
          </div>
        </div>
      )}

      {/* Facts Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#52525b' }}>
          <Brain size={32} style={{ animation: 'pulse 2s ease-in-out infinite', color: '#9b87c8' }} />
          <div style={{ marginTop: '1rem', fontSize: '0.875rem' }}>{de ? 'Lade Wissensbasis…' : 'Loading knowledge…'}</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '4rem 2rem',
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 0,
        }}>
          <Brain size={48} style={{ opacity: 0.2, marginBottom: '1rem', color: '#9b87c8' }} />
          <div style={{ color: '#71717a', fontSize: '0.9375rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            {sq ? (de ? 'Keine Fakten gefunden' : 'No facts found') : (de ? 'Noch keine Fakten' : 'No facts yet')}
          </div>
          <div style={{ color: '#52525b', fontSize: '0.8125rem' }}>
            {sq
              ? (de ? 'Versuche einen anderen Suchbegriff.' : 'Try a different search term.')
              : (de ? 'Füge deinen ersten Fakt hinzu — Agenten nutzen diese Informationen für Entscheidungen.' : 'Add your first fact — agents use this information for decisions.')}
          </div>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: '0.875rem',
        }}>
          {filtered.map((fact, i) => {
            const color = predicateColor(fact.predicate);
            return (
              <div key={fact.id} style={{
                padding: '1rem 1.25rem', background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)', borderRadius: 0,
                display: 'flex', flexDirection: 'column', gap: '0.625rem',
                transition: 'all 0.15s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{
                    padding: '0.2rem 0.5rem', borderRadius: 0,
                    background: color + '15', border: `1px solid ${color}30`,
                    fontSize: '0.625rem', fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.03em',
                    flexShrink: 0,
                  }}>
                    {predicateLabel(fact.predicate, de)}
                  </span>
                  <span style={{ fontSize: '0.6875rem', color: '#3f3f46', marginLeft: 'auto' }}>
                    {new Date(fact.erstelltAm).toLocaleDateString(de ? 'de-DE' : 'en-US')}
                  </span>
                </div>

                {/* Readable sentence */}
                <div style={{ fontSize: '0.9375rem', color: '#e4e4e7', lineHeight: 1.5, fontWeight: 500 }}>
                  <span style={{ color: '#c5a059' }}>{fact.subject}</span>
                  {' '}
                  <span style={{ color: '#71717a', fontWeight: 400 }}>{predicateLabel(fact.predicate, de)}</span>
                  {' '}
                  <span style={{ color: '#9b87c8' }}>{fact.object}</span>
                </div>

                {/* Triple breakdown */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  fontSize: '0.6875rem', color: '#3f3f46', fontFamily: 'monospace',
                }}>
                  <span>{fact.subject}</span>
                  <span style={{ color: '#52525b' }}>→</span>
                  <span>{fact.predicate}</span>
                  <span style={{ color: '#52525b' }}>→</span>
                  <span>{fact.object}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => deleteFact(fact.id)}
                    disabled={deleting === fact.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.25rem',
                      padding: '0.25rem 0.5rem', borderRadius: 0,
                      background: 'transparent', border: '1px solid rgba(239,68,68,0.15)',
                      color: '#ef4444', fontSize: '0.6875rem', fontWeight: 600,
                      cursor: 'pointer', opacity: deleting === fact.id ? 0.5 : 1,
                    }}
                  >
                    <Trash2 size={12} /> {de ? 'Entfernen' : 'Remove'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
