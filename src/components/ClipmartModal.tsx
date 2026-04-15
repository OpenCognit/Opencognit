import { useState, useEffect } from 'react';
import { Package, Download, Users, Sparkles, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { authFetch } from '../utils/api';

interface ClipmartTemplate {
  name: string;
  beschreibung: string;
  version: string;
  agentCount: number;
}

interface ImportResult {
  success: boolean;
  templateName: string;
  agentsCreated: number;
  skillsCreated: number;
  errors: string[];
}

export function ClipmartModal({
  isOpen,
  onClose,
  unternehmenId,
  onImported,
}: {
  isOpen: boolean;
  onClose: () => void;
  unternehmenId: string;
  onImported: () => void;
}) {
  const [templates, setTemplates] = useState<ClipmartTemplate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      authFetch('/api/clipmart/templates')
        .then(r => r.json())
        .then(setTemplates)
        .catch(() => setError('Templates konnten nicht geladen werden'));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleImport = async () => {
    if (!selected) return;
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const res = await authFetch(`/api/unternehmen/${unternehmenId}/clipmart/import`, {
        method: 'POST',
        body: JSON.stringify({ templateName: selected }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        onImported();
      } else {
        setError(data.error || 'Import fehlgeschlagen');
      }
    } catch {
      setError('Netzwerkfehler');
    } finally {
      setImporting(false);
    }
  };

  const TEMPLATE_ICONS: Record<string, string> = {
    "Gary Tan's GStack": '🚀',
    "Don Cheeto's Game Studio": '🎮',
  };

  const TEMPLATE_COLORS: Record<string, string> = {
    "Gary Tan's GStack": '#f59e0b',
    "Don Cheeto's Game Studio": '#8b5cf6',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width: '560px', maxHeight: '80vh', overflow: 'auto',
        background: 'rgba(24,24,27,0.95)', border: '1px solid rgba(63,63,70,0.5)',
        borderRadius: '16px', padding: '2rem',
        boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Package size={24} style={{ color: '#23CDCB' }} />
            <div>
              <h2 style={{
                fontSize: '1.25rem', fontWeight: 700, margin: 0,
                background: 'linear-gradient(135deg, #23CDCB, #3b82f6)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                Clipmart
              </h2>
              <p style={{ fontSize: '0.8125rem', color: '#71717a', margin: 0 }}>
                Team-Templates importieren
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: '#71717a', padding: '0.25rem',
          }}>
            <X size={20} />
          </button>
        </div>

        {/* Templates */}
        {!result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {templates.map(t => {
              const isSelected = selected === t.name;
              const accentColor = TEMPLATE_COLORS[t.name] || '#23CDCB';

              return (
                <button
                  key={t.name}
                  onClick={() => setSelected(t.name)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '1rem',
                    padding: '1rem 1.25rem', textAlign: 'left',
                    background: isSelected ? `rgba(35,205,203,0.08)` : 'rgba(39,39,42,0.5)',
                    border: `1px solid ${isSelected ? accentColor : 'rgba(63,63,70,0.4)'}`,
                    borderRadius: '12px', cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <span style={{ fontSize: '2rem', lineHeight: 1 }}>
                    {TEMPLATE_ICONS[t.name] || '📦'}
                  </span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: '#fafafa', fontSize: '0.9375rem' }}>
                      {t.name}
                    </div>
                    <div style={{ color: '#a1a1aa', fontSize: '0.8125rem', marginTop: '0.25rem' }}>
                      {t.beschreibung}
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#71717a', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Users size={12} /> {t.agentCount} Agenten
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#71717a' }}>
                        v{t.version}
                      </span>
                    </div>
                  </div>
                  {isSelected && (
                    <Sparkles size={18} style={{ color: accentColor, marginTop: '0.25rem' }} />
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Result */}
        {result && (
          <div style={{
            padding: '1.5rem', borderRadius: '12px', textAlign: 'center',
            background: result.success ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${result.success ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}>
            {result.success ? (
              <CheckCircle size={40} style={{ color: '#10b981', margin: '0 auto 0.75rem' }} />
            ) : (
              <AlertTriangle size={40} style={{ color: '#ef4444', margin: '0 auto 0.75rem' }} />
            )}
            <div style={{ fontWeight: 600, color: '#fafafa', fontSize: '1rem' }}>
              {result.success ? 'Import erfolgreich!' : 'Import mit Fehlern'}
            </div>
            <div style={{ color: '#a1a1aa', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              {result.agentsCreated} Agenten und {result.skillsCreated} Skills erstellt
            </div>
            {result.errors.length > 0 && (
              <div style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: '#fca5a5', textAlign: 'left' }}>
                {result.errors.map((e, i) => <div key={i}>- {e}</div>)}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            marginTop: '0.75rem', padding: '0.75rem', borderRadius: '8px',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5', fontSize: '0.8125rem',
          }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '0.5rem 1.25rem', borderRadius: '8px',
            background: 'rgba(63,63,70,0.5)', border: '1px solid rgba(63,63,70,0.5)',
            color: '#a1a1aa', cursor: 'pointer', fontSize: '0.875rem',
          }}>
            {result ? 'Schliessen' : 'Abbrechen'}
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={!selected || importing}
              style={{
                padding: '0.5rem 1.25rem', borderRadius: '8px',
                background: selected ? 'linear-gradient(135deg, #23CDCB, #0ea5e9)' : 'rgba(63,63,70,0.3)',
                border: 'none', color: selected ? '#000' : '#52525b',
                cursor: selected ? 'pointer' : 'not-allowed',
                fontWeight: 600, fontSize: '0.875rem',
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                opacity: importing ? 0.6 : 1,
              }}
            >
              <Download size={16} />
              {importing ? 'Importiere...' : 'Importieren'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
