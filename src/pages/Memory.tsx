import { useState } from 'react';
import { Search, Brain, Clock, User, Tag, AlertCircle, Loader2 } from 'lucide-react';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { authFetch } from '../utils/api';

interface MemoryResult {
  id: string;
  text: string;
  source: string;
  sourceId?: string;
  similarity: number;
}

interface SearchResponse {
  query: string;
  results: MemoryResult[];
  durationMs: number;
}

function SimilarityBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-accent)' : 'var(--color-text-muted)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <div style={{
        width: 60, height: 3,
        background: 'var(--color-border)',
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${pct}%`,
          background: color,
          transition: 'width 0.4s ease',
        }} />
      </div>
      <span style={{
        fontSize: 'var(--font-size-xs)',
        fontWeight: 600,
        color,
        fontFamily: 'monospace',
      }}>{pct}%</span>
    </div>
  );
}

const SOURCE_LABELS: Record<string, { de: string; en: string }> = {
  comment: { de: 'Kommentar', en: 'Comment' },
  soul:    { de: 'SOUL.md',   en: 'SOUL.md' },
  manual:  { de: 'Manuell',   en: 'Manual' },
  task:    { de: 'Task',      en: 'Task' },
};

export function Memory() {
  const { t, language } = useI18n();
  const de = language === 'de';
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', 'Semantic Memory']);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemoryResult[]>([]);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim() || !aktivesUnternehmen) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/semantic-memory/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), topK: 10 }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SearchResponse = await res.json();
      setResults(data.results);
      setDurationMs(data.durationMs);
      setSearched(true);
    } catch (e: any) {
      setError(e.message || 'Suche fehlgeschlagen');
    }
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') search();
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 860, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <Brain size={22} color="var(--color-accent)" />
          <h1 style={{
            margin: 0,
            fontSize: 'var(--font-size-xl)',
            fontWeight: 700,
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.02em',
          }}>
            {de ? 'Semantisches Gedächtnis' : 'Semantic Memory'}
          </h1>
        </div>
        <p style={{
          margin: 0,
          fontSize: 'var(--font-size-base)',
          color: 'var(--color-text-muted)',
          lineHeight: 'var(--line-height-relaxed)',
        }}>
          {de
            ? 'Suche im Wissens-Index aller Agenten. Ergebnisse basieren auf semantischer Ähnlichkeit — nicht auf exakten Keywords.'
            : 'Search the knowledge index of all agents. Results are based on semantic similarity — not exact keywords.'}
        </p>
      </div>

      {/* Search Bar — Industrial Terminal Style */}
      <div style={{
        display: 'flex',
        gap: '0.75rem',
        marginBottom: '2rem',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        padding: '0.75rem 1rem',
        alignItems: 'center',
      }}>
        <Search size={18} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={de ? 'z.B. Marktpreise Q3, Wettbewerber-Analyse, API-Design…' : 'e.g. Q3 market prices, competitor analysis, API design…'}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--color-text-primary)',
            fontSize: 'var(--font-size-base)',
            fontFamily: 'var(--font-family)',
          }}
        />
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          className="btn btn-primary"
          style={{
            padding: '0.5rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            opacity: loading || !query.trim() ? 0.5 : 1,
          }}
        >
          {loading ? <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Search size={14} />}
          {de ? 'Suchen' : 'Search'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1rem',
          background: 'var(--color-error-subtle)',
          border: '1px solid rgba(201, 123, 123, 0.2)',
          color: 'var(--color-error)',
          fontSize: 'var(--font-size-base)',
          marginBottom: '1.5rem',
        }}>
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Results */}
      {searched && !loading && (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1rem',
          }}>
            <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>
              {de
                ? `${results.length} Ergebnis${results.length !== 1 ? 'se' : ''} gefunden`
                : `${results.length} result${results.length !== 1 ? 's' : ''} found`}
            </span>
            {durationMs !== null && (
              <span style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
                fontFamily: 'monospace',
              }}>
                <Clock size={11} /> {durationMs}ms
              </span>
            )}
          </div>

          {results.length === 0 ? (
            <div style={{
              padding: '3rem',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--font-size-base)',
              border: '1px dashed var(--color-border)',
            }}>
              {de
                ? 'Keine relevanten Erinnerungen gefunden. Agenten sammeln automatisch Wissen während der Task-Ausführung.'
                : 'No relevant memories found. Agents automatically collect knowledge during task execution.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {results.map((r, i) => (
                <div key={r.id ?? i} style={{
                  padding: '1rem 1.25rem',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  transition: 'border-color 0.2s, background 0.2s',
                  cursor: 'default',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border-hover)';
                  (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-hover)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
                  (e.currentTarget as HTMLElement).style.background = 'var(--color-surface)';
                }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '1rem',
                    marginBottom: '0.625rem',
                  }}>
                    <p style={{
                      margin: 0,
                      color: 'var(--color-text-secondary)',
                      fontSize: 'var(--font-size-base)',
                      lineHeight: 'var(--line-height-relaxed)',
                      flex: 1,
                    }}>
                      {r.text}
                    </p>
                    <SimilarityBar value={r.similarity} />
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                  }}>
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      fontSize: 'var(--font-size-xs)',
                      color: 'var(--color-text-muted)',
                    }}>
                      <Tag size={10} />
                      {(SOURCE_LABELS[r.source]?.[de ? 'de' : 'en']) ?? r.source}
                    </span>
                    {r.sourceId && (
                      <span style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--color-text-muted)',
                        fontFamily: 'monospace',
                      }}>
                        <User size={10} />
                        {r.sourceId.slice(0, 8)}…
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Empty state before first search */}
      {!searched && !loading && (
        <div style={{
          padding: '4rem 2rem',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          border: '1px dashed var(--color-border)',
        }}>
          <Brain size={32} style={{ marginBottom: '1rem', color: 'var(--color-border)' }} />
          <p style={{ margin: 0, fontSize: 'var(--font-size-base)' }}>
            {de
              ? 'Gib einen Suchbegriff ein und drücke Enter oder klicke auf Suchen.'
              : 'Enter a search term and press Enter or click Search.'}
          </p>
        </div>
      )}
    </div>
  );
}
