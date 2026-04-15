import React, { useState, useEffect } from 'react';
import { Package, File, FileText, Link, FolderOpen, Search, Filter, ExternalLink, Eye, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { authFetch } from '../utils/api';
import { useCompany } from '../hooks/useCompany';

interface WorkProduct {
  id: string;
  aufgabeId: string;
  expertId: string;
  runId: string | null;
  typ: 'file' | 'text' | 'url' | 'directory';
  name: string;
  pfad: string | null;
  inhalt: string | null;
  groeßeBytes: number | null;
  mimeTyp: string | null;
  erstelltAm: string;
}

const PAGE_SIZE = 50;

const typeIcon = (typ: string, mimeTyp: string | null) => {
  if (typ === 'url') return <Link size={16} />;
  if (typ === 'directory') return <FolderOpen size={16} />;
  if (mimeTyp?.startsWith('text/') || typ === 'text') return <FileText size={16} />;
  return <File size={16} />;
};

const typeColor = (typ: string) => {
  if (typ === 'url') return '#3b82f6';
  if (typ === 'directory') return '#f59e0b';
  if (typ === 'text') return '#a855f7';
  return '#23CDCB';
};

const formatBytes = (bytes: number | null) => {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export function WorkProducts() {
  const { aktivesUnternehmen: selectedCompany } = useCompany();
  const [products, setProducts] = useState<WorkProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterTyp, setFilterTyp] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [preview, setPreview] = useState<WorkProduct | null>(null);

  const load = async (p = 0, typ?: string) => {
    if (!selectedCompany) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(p * PAGE_SIZE) });
      if (typ && typ !== 'all') params.set('typ', typ);
      const res = await authFetch(`/api/unternehmen/${selectedCompany.id}/work-products?${params}`);
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : []);
      setTotal(data.length === PAGE_SIZE ? (p + 1) * PAGE_SIZE + 1 : p * PAGE_SIZE + data.length);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(0, filterTyp); setPage(0); }, [selectedCompany, filterTyp]);

  const filtered = products.filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.pfad?.toLowerCase().includes(search.toLowerCase()) ||
    p.inhalt?.toLowerCase().includes(search.toLowerCase())
  );

  const types = ['all', 'file', 'text', 'url', 'directory'];

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Package size={22} style={{ color: '#23CDCB' }} /> Work Products
        </h1>
        <p style={{ color: '#52525b', fontSize: '0.875rem', margin: '0.25rem 0 0' }}>
          Alle Artefakte die deine Agenten produziert haben
        </p>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {/* Search */}
        <div style={{ position: 'relative', flex: '1', minWidth: 200 }}>
          <Search size={14} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: '#52525b' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suche nach Name, Pfad, Inhalt…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '0.55rem 0.75rem 0.55rem 2.25rem',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '10px', color: '#fff', fontSize: '0.875rem', outline: 'none',
            }}
          />
        </div>

        {/* Type filter */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '2px', border: '1px solid rgba(255,255,255,0.06)' }}>
          {types.map(t => (
            <button key={t} onClick={() => setFilterTyp(t)} style={{
              padding: '0.4rem 0.75rem', borderRadius: '8px', border: 'none', cursor: 'pointer',
              fontSize: '0.75rem', fontWeight: 600, transition: 'all 0.15s',
              background: filterTyp === t ? 'rgba(35,205,202,0.12)' : 'transparent',
              color: filterTyp === t ? '#23CDCB' : '#52525b',
            }}>
              {t === 'all' ? 'Alle' : t}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      {!loading && (
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          {(['file', 'text', 'url', 'directory'] as const).map(typ => {
            const count = products.filter(p => p.typ === typ).length;
            if (!count) return null;
            return (
              <div key={typ} style={{
                padding: '0.375rem 0.75rem', borderRadius: '8px',
                background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                fontSize: '0.75rem', color: '#71717a',
                display: 'flex', alignItems: 'center', gap: '0.375rem',
              }}>
                <span style={{ color: typeColor(typ) }}>{typeIcon(typ, null)}</span>
                {count} {typ}
              </div>
            );
          })}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
          <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid rgba(35,205,202,0.2)', borderTopColor: '#23CDCB', animation: 'spin 0.8s linear infinite' }} />
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem', color: '#3f3f46' }}>
          <Package size={40} style={{ marginBottom: '1rem', opacity: 0.3 }} />
          <div style={{ fontSize: '0.9rem' }}>Noch keine Work Products vorhanden</div>
          <div style={{ fontSize: '0.75rem', marginTop: '0.5rem' }}>Agenten produzieren Artefakte wenn sie Tasks ausführen</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
          {filtered.map(p => (
            <div key={p.id} style={{
              padding: '1rem', borderRadius: '12px',
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
              transition: 'border-color 0.15s', cursor: 'default',
            }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = `${typeColor(p.typ)}40`)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
            >
              {/* Type badge + name */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem', marginBottom: '0.625rem' }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '8px', flexShrink: 0,
                  background: `${typeColor(p.typ)}15`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: typeColor(p.typ),
                }}>
                  {typeIcon(p.typ, p.mimeTyp)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#d4d4d8', fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name}
                  </div>
                  {p.pfad && (
                    <div style={{ fontSize: '0.7rem', color: '#3f3f46', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '0.1rem' }}>
                      {p.pfad}
                    </div>
                  )}
                </div>
              </div>

              {/* Meta */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.7rem', color: '#52525b' }}>
                <span style={{
                  padding: '0.1rem 0.4rem', borderRadius: '4px',
                  background: `${typeColor(p.typ)}12`, color: typeColor(p.typ), fontWeight: 600,
                }}>{p.typ}</span>
                {p.groeßeBytes && <span>{formatBytes(p.groeßeBytes)}</span>}
                {p.mimeTyp && <span style={{ color: '#3f3f46' }}>{p.mimeTyp}</span>}
                <span style={{ marginLeft: 'auto' }}>{formatDate(p.erstelltAm)}</span>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: '0.375rem', marginTop: '0.75rem' }}>
                {(p.typ === 'text' || p.inhalt) && (
                  <button onClick={() => setPreview(p)} style={{
                    flex: 1, padding: '0.35rem', borderRadius: '7px', border: '1px solid rgba(255,255,255,0.07)',
                    background: 'rgba(255,255,255,0.03)', color: '#71717a', cursor: 'pointer',
                    fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem',
                  }}>
                    <Eye size={12} /> Vorschau
                  </button>
                )}
                {p.typ === 'url' && p.pfad && (
                  <a href={p.pfad} target="_blank" rel="noopener noreferrer" style={{
                    flex: 1, padding: '0.35rem', borderRadius: '7px', border: '1px solid rgba(59,130,246,0.2)',
                    background: 'rgba(59,130,246,0.06)', color: '#60a5fa', cursor: 'pointer',
                    fontSize: '0.7rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem',
                    textDecoration: 'none',
                  }}>
                    <ExternalLink size={12} /> Öffnen
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', marginTop: '1.5rem' }}>
          <button disabled={page === 0} onClick={() => { setPage(p => p - 1); load(page - 1, filterTyp); }} style={{
            padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(255,255,255,0.03)', color: page === 0 ? '#3f3f46' : '#71717a',
            cursor: page === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem',
          }}>
            <ChevronLeft size={14} /> Zurück
          </button>
          <span style={{ fontSize: '0.8rem', color: '#52525b' }}>Seite {page + 1}</span>
          <button disabled={products.length < PAGE_SIZE} onClick={() => { setPage(p => p + 1); load(page + 1, filterTyp); }} style={{
            padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(255,255,255,0.03)', color: products.length < PAGE_SIZE ? '#3f3f46' : '#71717a',
            cursor: products.length < PAGE_SIZE ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8rem',
          }}>
            Weiter <ChevronRight size={14} />
          </button>
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div onClick={() => setPreview(null)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1.5rem',
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            width: '100%', maxWidth: 720, maxHeight: '80vh',
            background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px', overflow: 'hidden', display: 'flex', flexDirection: 'column',
          }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ color: typeColor(preview.typ) }}>{typeIcon(preview.typ, preview.mimeTyp)}</span>
              <span style={{ fontWeight: 600, color: '#d4d4d8', fontSize: '0.9rem', flex: 1 }}>{preview.name}</span>
              <button onClick={() => setPreview(null)} style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', padding: '0.25rem' }}>
                <X size={18} />
              </button>
            </div>
            <div style={{ padding: '1.25rem', overflowY: 'auto', flex: 1 }}>
              <pre style={{
                margin: 0, fontSize: '0.8rem', lineHeight: 1.6, color: '#a1a1aa',
                fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {preview.inhalt || '(kein Inhalt)'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
