import { useState, useEffect } from 'react';
import { Package, Download, Users, Sparkles, CheckCircle, AlertTriangle } from 'lucide-react';
import { authFetch } from '../utils/api';
import { ModalShell, btnPrimary, btnPrimaryHover, btnSecondary, btnSecondaryHover } from './ModalShell';

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
        .catch(() => setError('Failed to load templates'));
    }
  }, [isOpen]);

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
      setError('Network error');
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
    "Don Cheeto's Game Studio": '#9b87c8',
  };

  const footer = (
    <>
      <button
        onClick={onClose}
        style={btnSecondary}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnSecondaryHover)}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = btnSecondary.background;
          e.currentTarget.style.borderColor = btnSecondary.borderColor;
          e.currentTarget.style.color = btnSecondary.color;
        }}
      >
        {result ? 'Schliessen' : 'Abbrechen'}
      </button>
      {!result && (
        <button
          onClick={handleImport}
          disabled={!selected || importing}
          style={{
            ...btnPrimary,
            cursor: selected ? 'pointer' : 'not-allowed',
            opacity: selected && !importing ? 1 : 0.5,
          }}
          onMouseEnter={(e) => {
            if (selected && !importing) Object.assign(e.currentTarget.style, btnPrimaryHover);
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = btnPrimary.background;
            e.currentTarget.style.borderColor = btnPrimary.borderColor;
            e.currentTarget.style.boxShadow = 'none';
          }}
        >
          <Download size={16} />
          {importing ? 'Importiere...' : 'Importieren'}
        </button>
      )}
    </>
  );

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Clipmart"
      titleIcon={<Package size={20} />}
      maxWidth="560px"
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Templates */}
        {!result && (
          <>
            {templates.map(t => {
              const isSelected = selected === t.name;
              const accentColor = TEMPLATE_COLORS[t.name] || '#c5a059';

              return (
                <button
                  key={t.name}
                  onClick={() => setSelected(t.name)}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '1rem',
                    padding: '1rem 1.25rem', textAlign: 'left',
                    background: isSelected ? `rgba(35,205,203,0.08)` : 'rgba(39,39,42,0.5)',
                    border: `1px solid ${isSelected ? accentColor : 'rgba(63,63,70,0.4)'}`,
                    borderRadius: 0, cursor: 'pointer',
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
          </>
        )}

        {/* Result */}
        {result && (
          <div style={{
            padding: '1.5rem', borderRadius: 0, textAlign: 'center',
            background: result.success ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
            border: `1px solid ${result.success ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
          }}>
            {result.success ? (
              <CheckCircle size={40} style={{ color: '#10b981', margin: '0 auto 0.75rem' }} />
            ) : (
              <AlertTriangle size={40} style={{ color: '#ef4444', margin: '0 auto 0.75rem' }} />
            )}
            <div style={{ fontWeight: 600, color: '#fafafa', fontSize: '1rem' }}>
              {result.success ? 'Import successful!' : 'Import had errors'}
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
            padding: '0.75rem', borderRadius: 0,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5', fontSize: '0.8125rem',
          }}>
            {error}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
