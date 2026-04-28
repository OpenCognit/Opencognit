import { useState, useEffect, useRef } from 'react';
import { Users, Sparkles, Loader2 } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';
import type { Experte } from '../api/client';
import { Select } from './Select';
import { ModalShell, FieldLabel, inputStyle, inputFocus, textareaStyle, btnPrimary, btnPrimaryHover, btnSecondary, btnSecondaryHover, ErrorBox } from './ModalShell';

function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

interface AufgabeModalProps {
  onClose: () => void;
  onSaved: () => void;
  isOpen?: boolean;
  experten: Experte[];
}

export function TaskModal({ onClose, onSaved, isOpen = true, experten }: AufgabeModalProps) {
  const { aktivesUnternehmen } = useCompany();
  const i18n = useI18n();
  const de = i18n.language === 'de';
  const [titel, setTitel] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [prioritaet, setPrioritaet] = useState<'medium' | 'high' | 'critical' | 'low'>('medium');
  const [zugewiesenAn, setZugewiesenAn] = useState('');
  const [status, setStatus] = useState<'backlog' | 'todo' | 'in_progress'>('todo');
  const [zielId, setZielId] = useState('');
  const [projektId, setProjektId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ziele, setZiele] = useState<{ id: string; titel: string }[]>([]);
  const [projekte, setProjekte] = useState<{ id: string; name: string }[]>([]);
  const [matchResult, setMatchResult] = useState<{ agentId: string; agentName: string; matchScore: number } | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const matchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!aktivesUnternehmen || !isOpen) return;
    const token = localStorage.getItem('opencognit_token');
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    fetch(`/api/unternehmen/${aktivesUnternehmen.id}/ziele`, { credentials: 'include', headers: h })
      .then(r => r.json()).then(d => Array.isArray(d) && setZiele(d)).catch(() => {});
    fetch(`/api/unternehmen/${aktivesUnternehmen.id}/projekte`, { credentials: 'include', headers: h })
      .then(r => r.json()).then(d => Array.isArray(d) && setProjekte(d)).catch(() => {});
  }, [aktivesUnternehmen?.id, isOpen]);

  useEffect(() => {
    if (!aktivesUnternehmen || titel.trim().length < 5 || zugewiesenAn) {
      setMatchResult(null);
      return;
    }
    if (matchDebounceRef.current) clearTimeout(matchDebounceRef.current);
    matchDebounceRef.current = setTimeout(async () => {
      setMatchLoading(true);
      try {
        const res = await authFetch('/api/aufgaben/match-agent', {
          method: 'POST',
          body: JSON.stringify({ unternehmenId: aktivesUnternehmen.id, titel: titel.trim(), beschreibung }),
        });
        if (res.ok) {
          const data = await res.json();
          setMatchResult(data.match ?? null);
        }
      } catch {}
      setMatchLoading(false);
    }, 600);
    return () => { if (matchDebounceRef.current) clearTimeout(matchDebounceRef.current); };
  }, [titel, beschreibung, aktivesUnternehmen?.id, zugewiesenAn]);

  const handleSave = async () => {
    if (!aktivesUnternehmen || !titel.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/aufgaben`, {
        method: 'POST',
        body: JSON.stringify({
          titel,
          beschreibung,
          prioritaet,
          zugewiesenAn: zugewiesenAn || null,
          status,
          zielId: zielId || null,
          projektId: projektId || null,
        })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Fehler ${res.status}`);
        return;
      }
      onSaved();
    } catch (e) {
      setError('Network error – please try again');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <>
      <button
        style={btnSecondary}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnSecondaryHover)}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = btnSecondary.background;
          e.currentTarget.style.borderColor = btnSecondary.borderColor;
          e.currentTarget.style.color = btnSecondary.color;
        }}
        onClick={onClose}
      >
        {i18n.t.actions?.abbrechen ?? 'Abbrechen'}
      </button>
      <button
        style={{
          ...btnPrimary,
          cursor: saving || !titel ? 'not-allowed' : 'pointer',
          opacity: titel && !saving ? 1 : 0.5,
        }}
        onMouseEnter={(e) => {
          if (titel && !saving) Object.assign(e.currentTarget.style, btnPrimaryHover);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = btnPrimary.background;
          e.currentTarget.style.borderColor = btnPrimary.borderColor;
          e.currentTarget.style.boxShadow = 'none';
        }}
        onClick={handleSave}
        disabled={!titel || saving}
      >
        {saving ? (i18n.t.actions?.speichern ?? 'Speichern') + '...' : (i18n.t.aufgaben?.erstellen ?? 'Erstellen')}
      </button>
    </>
  );

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={i18n.t.aufgaben?.neueAufgabeErstellen ?? 'Neue Aufgabe erstellen'}
      maxWidth="480px"
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {error && (
          <ErrorBox>
            {error}
          </ErrorBox>
        )}

        {/* Titel */}
        <div>
          <FieldLabel required>Titel</FieldLabel>
          <input
            type="text"
            style={inputStyle}
            onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = (inputStyle as any).borderColor;
              e.currentTarget.style.boxShadow = 'none';
            }}
            value={titel}
            onChange={e => setTitel(e.target.value)}
            placeholder="e.g. write API documentation"
            required
          />
        </div>

        {/* Beschreibung */}
        <div>
          <FieldLabel>Beschreibung</FieldLabel>
          <textarea
            style={textareaStyle}
            onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = (inputStyle as any).borderColor;
              e.currentTarget.style.boxShadow = 'none';
            }}
            value={beschreibung}
            onChange={e => setBeschreibung(e.target.value)}
            rows={2}
            placeholder="Was muss gemacht werden?"
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          {/* Priorität */}
          <div>
            <FieldLabel>Priorität</FieldLabel>
            <Select
              value={prioritaet}
              onChange={v => setPrioritaet(v as any)}
              options={[
                { value: 'low', label: i18n.t.priority.low },
                { value: 'medium', label: i18n.t.priority.medium },
                { value: 'high', label: i18n.t.priority.high },
                { value: 'critical', label: i18n.t.priority.critical },
              ]}
            />
          </div>

          {/* Status */}
          <div>
            <FieldLabel>Status</FieldLabel>
            <Select
              value={status}
              onChange={v => setStatus(v as any)}
              options={[
                { value: 'backlog', label: i18n.t.status.backlog },
                { value: 'todo', label: i18n.t.status.todo },
                { value: 'in_progress', label: i18n.t.status.in_progress },
              ]}
            />
          </div>
        </div>

        {/* Experte zuweisen */}
        <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '1rem' }}>
          <h3
            style={{
              fontSize: '0.875rem',
              fontWeight: 600,
              marginBottom: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--color-text-primary)',
            }}
          >
            <Users size={14} style={{ color: '#c5a059' }} />
            <span>{i18n.t.aufgaben?.expertenZuweisen ?? 'Experten zuweisen'}</span>
          </h3>

          <Select
            value={zugewiesenAn}
            onChange={setZugewiesenAn}
            options={[
              { value: '', label: i18n.t.aufgaben?.keinemExpertenZuweisen ?? 'Keinem Experten zuweisen' },
              ...experten.map(e => ({ value: e.id, label: `${e.name} (${e.rolle})` })),
            ]}
          />

          {/* AI Match Preview */}
          {!zugewiesenAn && (matchLoading || matchResult) && (
            <div style={{
              marginTop: '0.625rem',
              padding: '0.5rem 0.75rem',
              borderRadius: 0,
              background: 'rgba(197,160,89,0.05)',
              border: '1px solid rgba(197,160,89,0.15)',
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              animation: 'fadeInUp 0.2s ease-out',
            }}>
              {matchLoading ? (
                <>
                  <Loader2 size={13} style={{ color: '#c5a059', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.75rem', color: '#52525b' }}>
                    {de ? 'Suche besten Agenten…' : 'Finding best agent…'}
                  </span>
                </>
              ) : matchResult ? (
                <>
                  <Sparkles size={13} style={{ color: '#c5a059', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>
                    {de ? 'Bester Match:' : 'Best match:'}
                  </span>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c5a059' }}>
                    {matchResult.agentName}
                  </span>
                  <span style={{
                    marginLeft: 'auto', fontSize: '0.625rem', fontWeight: 700, color: '#c5a059',
                    padding: '0.1rem 0.4rem', borderRadius: 0,
                    background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.2)',
                  }}>
                    {matchResult.matchScore}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setZugewiesenAn(matchResult.agentId)}
                    style={{
                      padding: '0.2rem 0.5rem', borderRadius: 0, cursor: 'pointer',
                      background: 'rgba(197,160,89,0.12)', border: '1px solid rgba(197,160,89,0.25)',
                      color: '#c5a059', fontSize: '0.625rem', fontWeight: 700, whiteSpace: 'nowrap',
                    }}
                  >
                    {de ? 'Übernehmen' : 'Apply'}
                  </button>
                </>
              ) : null}
            </div>
          )}
        </div>

        {/* Goal + Project linking */}
        {(ziele.length > 0 || projekte.length > 0) && (
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {ziele.length > 0 && (
              <div>
                <FieldLabel>{de ? 'Ziel' : 'Goal'}</FieldLabel>
                <Select
                  value={zielId}
                  onChange={setZielId}
                  options={[
                    { value: '', label: de ? '— Kein Ziel —' : '— No Goal —' },
                    ...ziele.map(z => ({ value: z.id, label: z.titel })),
                  ]}
                />
              </div>
            )}
            {projekte.length > 0 && (
              <div>
                <FieldLabel>{de ? 'Projekt' : 'Project'}</FieldLabel>
                <Select
                  value={projektId}
                  onChange={setProjektId}
                  options={[
                    { value: '', label: de ? '— Kein Projekt —' : '— No Project —' },
                    ...projekte.map(p => ({ value: p.id, label: p.name })),
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
