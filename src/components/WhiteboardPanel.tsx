import { useState, useEffect, useRef } from 'react';
import { Layout, Send, Trash2, X, Bot, User } from 'lucide-react';

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

interface WhiteboardEntry {
  id: string;
  von: string; // expertId or 'board'
  inhalt: string;
  erstelltAm: string;
}

interface WhiteboardState {
  eintraege: WhiteboardEntry[];
  aktualisiertAm: string | null;
}

interface WhiteboardPanelProps {
  projektId: string;
  projektName: string;
  expertenMap?: Record<string, string>; // id -> name
  onClose?: () => void;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function WhiteboardPanel({ projektId, projektName, expertenMap = {}, onClose }: WhiteboardPanelProps) {
  const [state, setState] = useState<WhiteboardState>({ eintraege: [], aktualisiertAm: null });
  const [loading, setLoading] = useState(true);
  const [newEntry, setNewEntry] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await authFetch(`/api/projekte/${projektId}/whiteboard`);
      const data = await res.json();
      setState(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [projektId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.eintraege]);

  const handlePost = async () => {
    if (!newEntry.trim() || saving) return;
    setSaving(true);
    try {
      await authFetch(`/api/projekte/${projektId}/whiteboard`, {
        method: 'PUT',
        body: JSON.stringify({ inhalt: newEntry.trim(), expertId: 'board' }),
      });
      setNewEntry('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Whiteboard wirklich leeren?')) return;
    setClearing(true);
    try {
      await authFetch(`/api/projekte/${projektId}/whiteboard`, { method: 'DELETE' });
      await load();
    } finally {
      setClearing(false);
    }
  };

  const getName = (von: string) => {
    if (von === 'board') return 'Board';
    return expertenMap[von] ?? von.slice(0, 8);
  };

  const isBoard = (von: string) => von === 'board';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 8000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        width: '100%', maxWidth: 680, maxHeight: '85vh',
        background: 'rgba(10,10,20,0.98)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20, display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 32px 64px rgba(0,0,0,0.7)',
      }}>
        {/* Header */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <Layout size={16} style={{ color: '#23CDCA' }} />
          <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#e2e8f0', flex: 1 }}>
            Whiteboard — {projektName}
          </span>
          <span style={{ fontSize: '0.7rem', color: '#475569' }}>
            {state.eintraege.length} Einträge
          </span>
          <button
            onClick={handleClear}
            disabled={clearing || state.eintraege.length === 0}
            style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: '4px', display: 'flex', borderRadius: 6 }}
            title="Whiteboard leeren"
          >
            <Trash2 size={14} />
          </button>
          {onClose && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: '4px', display: 'flex', borderRadius: 6 }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* Info bar */}
        <div style={{ padding: '0.5rem 1.25rem', background: 'rgba(35,205,202,0.04)', borderBottom: '1px solid rgba(35,205,202,0.08)', fontSize: '0.72rem', color: '#475569', flexShrink: 0 }}>
          Geteilter Projektraum — Agenten und Board schreiben hier Ergebnisse, Notizen und Entscheidungen.
          {state.aktualisiertAm && ` · Zuletzt aktualisiert: ${formatTime(state.aktualisiertAm)}`}
        </div>

        {/* Entries */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: 10, scrollbarWidth: 'thin' }}>
          {loading && (
            <div style={{ textAlign: 'center', color: '#334155', padding: '3rem', fontSize: '0.85rem' }}>Lade Whiteboard…</div>
          )}
          {!loading && state.eintraege.length === 0 && (
            <div style={{ textAlign: 'center', padding: '3rem 1rem' }}>
              <Layout size={40} style={{ margin: '0 auto 1rem', display: 'block', color: '#1e293b' }} />
              <p style={{ color: '#334155', fontSize: '0.85rem', lineHeight: 1.6 }}>
                Das Whiteboard ist leer.<br />Agenten und Board können hier Ergebnisse und Notizen hinterlassen.
              </p>
            </div>
          )}

          {state.eintraege.map(entry => (
            <div key={entry.id} style={{
              display: 'flex', gap: 10,
              flexDirection: isBoard(entry.von) ? 'row-reverse' : 'row',
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: isBoard(entry.von) ? 'rgba(35,205,202,0.2)' : 'rgba(139,92,246,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${isBoard(entry.von) ? 'rgba(35,205,202,0.3)' : 'rgba(139,92,246,0.3)'}`,
              }}>
                {isBoard(entry.von)
                  ? <User size={14} style={{ color: '#23CDCA' }} />
                  : <Bot size={14} style={{ color: '#8b5cf6' }} />
                }
              </div>
              <div style={{ maxWidth: '72%' }}>
                <div style={{
                  fontSize: '0.65rem', color: '#475569', marginBottom: 4,
                  textAlign: isBoard(entry.von) ? 'right' : 'left',
                  display: 'flex', gap: 6, alignItems: 'center',
                  flexDirection: isBoard(entry.von) ? 'row-reverse' : 'row',
                }}>
                  <span style={{ fontWeight: 600, color: isBoard(entry.von) ? '#23CDCA' : '#a78bfa' }}>
                    {getName(entry.von)}
                  </span>
                  <span>{formatTime(entry.erstelltAm)}</span>
                </div>
                <div style={{
                  padding: '0.6rem 0.875rem',
                  background: isBoard(entry.von) ? 'rgba(35,205,202,0.08)' : 'rgba(139,92,246,0.08)',
                  border: `1px solid ${isBoard(entry.von) ? 'rgba(35,205,202,0.15)' : 'rgba(139,92,246,0.15)'}`,
                  borderRadius: isBoard(entry.von) ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                  fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.6,
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {entry.inhalt}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 10, flexShrink: 0 }}>
          <textarea
            value={newEntry}
            onChange={e => setNewEntry(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
            placeholder="Notiz, Entscheidung oder Ergebnis hinterlassen… (Enter zum Senden)"
            rows={2}
            style={{
              flex: 1, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 10, color: '#e2e8f0', fontSize: '0.875rem', padding: '0.6rem 0.75rem',
              resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5,
            }}
          />
          <button
            onClick={handlePost}
            disabled={saving || !newEntry.trim()}
            style={{
              background: newEntry.trim() ? '#23CDCA' : 'rgba(35,205,202,0.15)',
              border: 'none', borderRadius: 10, color: newEntry.trim() ? '#000' : '#334155',
              width: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: newEntry.trim() ? 'pointer' : 'not-allowed', flexShrink: 0,
              transition: 'all 0.15s',
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
