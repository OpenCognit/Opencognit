import { useState, useEffect, useRef } from 'react';
import { X, Users, Sparkles, Loader2 } from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';
import type { Experte } from '../api/client';
import { Select } from './Select';

function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, {
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
    fetch(`/api/unternehmen/${aktivesUnternehmen.id}/ziele`, { headers: h })
      .then(r => r.json()).then(d => Array.isArray(d) && setZiele(d)).catch(() => {});
    fetch(`/api/unternehmen/${aktivesUnternehmen.id}/projekte`, { headers: h })
      .then(r => r.json()).then(d => Array.isArray(d) && setProjekte(d)).catch(() => {});
  }, [aktivesUnternehmen?.id, isOpen]);

  // Debounced AI agent matching preview
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
      setError('Netzwerkfehler – bitte erneut versuchen');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '1rem',
      }}
    >
      <div
        style={{
          background: 'rgba(12, 12, 20, 0.75)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '24px',
          padding: '1.5rem',
          width: '100%',
          maxWidth: '480px',
          position: 'relative',
          boxShadow: '0 30px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
          animation: 'slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'none',
            border: 'none',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
          }}
        >
          <X size={20} />
        </button>

        <h2
          style={{
            fontSize: '1.125rem',
            fontWeight: 700,
            marginBottom: '1rem',
            background: 'linear-gradient(to bottom right, #23CDCB 0%, #ffffff 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          {i18n.t.aufgaben?.neueAufgabeErstellen ?? 'Neue Aufgabe erstellen'}
        </h2>

        {error && (
          <div style={{
            padding: '0.5rem 0.75rem',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            color: '#ef4444',
            fontSize: '0.8125rem',
            marginBottom: '0.5rem',
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Titel */}
          <div>
            <label
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'block',
                marginBottom: '0.25rem',
                color: 'var(--color-text-tertiary)'
              }}
            >
              Titel *
            </label>
            <input
              type="text"
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                fontSize: '0.875rem',
                color: 'var(--color-text-primary)',
              }}
              value={titel}
              onChange={e => setTitel(e.target.value)}
              placeholder="z.B. API-Dokumentation erstellen"
              required
            />
          </div>

          {/* Beschreibung */}
          <div>
            <label
              style={{
                fontSize: '0.6875rem',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                display: 'block',
                marginBottom: '0.25rem',
                color: 'var(--color-text-tertiary)'
              }}
            >
              Beschreibung
            </label>
            <textarea
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                fontSize: '0.875rem',
                color: 'var(--color-text-primary)',
                resize: 'vertical',
                minHeight: '60px'
              }}
              value={beschreibung}
              onChange={e => setBeschreibung(e.target.value)}
              rows={2}
              placeholder="Was muss gemacht werden?"
            ></textarea>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {/* Priorität */}
            <div>
              <label
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'block',
                  marginBottom: '0.25rem',
                  color: 'var(--color-text-tertiary)'
                }}
              >
                Priorität
              </label>
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
              <label
                style={{
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  display: 'block',
                  marginBottom: '0.25rem',
                  color: 'var(--color-text-tertiary)'
                }}
              >
                Status
              </label>
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
                gap: '0.5rem'
              }}
            >
              <Users size={14} style={{ color: '#23CDCB' }} />
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
                borderRadius: '10px',
                background: 'rgba(35,205,202,0.05)',
                border: '1px solid rgba(35,205,202,0.15)',
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                animation: 'fadeInUp 0.2s ease-out',
              }}>
                {matchLoading ? (
                  <>
                    <Loader2 size={13} style={{ color: '#23CDCB', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.75rem', color: '#52525b' }}>
                      {de ? 'Suche besten Agenten…' : 'Finding best agent…'}
                    </span>
                  </>
                ) : matchResult ? (
                  <>
                    <Sparkles size={13} style={{ color: '#23CDCB', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.75rem', color: '#a1a1aa' }}>
                      {de ? 'Bester Match:' : 'Best match:'}
                    </span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#23CDCB' }}>
                      {matchResult.agentName}
                    </span>
                    <span style={{
                      marginLeft: 'auto', fontSize: '0.625rem', fontWeight: 700, color: '#23CDCB',
                      padding: '0.1rem 0.4rem', borderRadius: '4px',
                      background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
                    }}>
                      {matchResult.matchScore}%
                    </span>
                    <button
                      type="button"
                      onClick={() => setZugewiesenAn(matchResult.agentId)}
                      style={{
                        padding: '0.2rem 0.5rem', borderRadius: '6px', cursor: 'pointer',
                        background: 'rgba(35,205,202,0.12)', border: '1px solid rgba(35,205,202,0.25)',
                        color: '#23CDCB', fontSize: '0.625rem', fontWeight: 700, whiteSpace: 'nowrap',
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
                  <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-tertiary)' }}>
                    {de ? 'Ziel' : 'Goal'}
                  </label>
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
                  <label style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-tertiary)' }}>
                    {de ? 'Projekt' : 'Project'}
                  </label>
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

          {/* Actions */}
          <div
            style={{
              paddingTop: '1rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '0.75rem',
              marginTop: '0.5rem'
            }}
          >
            <button
              style={{
                padding: '0.5rem 1rem',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                color: 'var(--color-text-secondary)',
                fontWeight: 500,
                fontSize: '0.875rem',
                cursor: 'pointer',
              }}
              onClick={onClose}
            >
              {i18n.t.actions?.abbrechen ?? 'Abbrechen'}
            </button>
            <button
              style={{
                padding: '0.5rem 1.25rem',
                backgroundColor: 'rgba(35, 205, 202, 0.1)',
                border: '1px solid rgba(35, 205, 202, 0.2)',
                borderRadius: '8px',
                color: '#23CDCB',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: saving || !titel ? 'not-allowed' : 'pointer',
                opacity: titel && !saving ? 1 : 0.5,
              }}
              onClick={handleSave}
              disabled={!titel || saving}
            >
              {saving ? (i18n.t.actions?.speichern ?? 'Speichern') + '...' : (i18n.t.aufgaben?.erstellen ?? 'Erstellen')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}