import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, ChevronRight, ArrowLeft, Home, Check, Loader2, X, FolderPlus } from 'lucide-react';
import { authFetch } from '../utils/api';
import { useI18n } from '../i18n';

interface DirEntry {
  name: string;
  path: string;
}

interface DirResponse {
  current: string;
  parent: string | null;
  home: string;
  dirs: DirEntry[];
}

interface Props {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function FolderPickerModal({ initialPath, onSelect, onClose }: Props) {
  const { language } = useI18n();
  const de = language === 'de';

  const [current, setCurrent] = useState<DirResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manualInput, setManualInput] = useState(initialPath || '');
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [creating, setCreating] = useState(false);

  const browse = useCallback(async (p?: string) => {
    setLoading(true);
    setError('');
    try {
      const params = p ? `?path=${encodeURIComponent(p)}` : '';
      const res = await authFetch(`/api/fs/dirs${params}`);
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || (de ? 'Fehler beim Laden' : 'Load error'));
        return;
      }
      const data: DirResponse = await res.json();
      setCurrent(data);
      setManualInput(data.current);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [de]);

  useEffect(() => {
    browse(initialPath || undefined);
  }, []);

  const navigateTo = (p: string) => {
    setShowNewFolder(false);
    browse(p);
  };

  const handleManualGo = () => {
    if (manualInput.trim()) browse(manualInput.trim());
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !current) return;
    setCreating(true);
    try {
      const newPath = current.current.replace(/\/$/, '') + '/' + newFolderName.trim();
      const res = await authFetch('/api/fs/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: newPath }),
      });
      if (res.ok) {
        setNewFolderName('');
        setShowNewFolder(false);
        await browse(current.current);
      }
    } finally {
      setCreating(false);
    }
  };

  // Breadcrumb parts
  const breadcrumbs = current
    ? current.current.split('/').filter(Boolean).reduce<{ label: string; path: string }[]>((acc, part) => {
        const prev = acc.length > 0 ? acc[acc.length - 1].path : '';
        acc.push({ label: part, path: `${prev}/${part}` });
        return acc;
      }, [{ label: de ? 'Root' : 'Root', path: '/' }])
    : [];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: 'rgba(15,15,25,0.98)',
        border: '1px solid rgba(35,205,202,0.2)',
        borderRadius: 20,
        width: 560, maxWidth: '95vw',
        maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(35,205,202,0.1)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '1.125rem 1.5rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <div style={{
              width: 32, height: 32, borderRadius: 9,
              background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#23CDCB',
            }}>
              <FolderOpen size={15} />
            </div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f4f4f5' }}>
                {de ? 'Projektverzeichnis wählen' : 'Select Project Directory'}
              </div>
              <div style={{ fontSize: 11, color: '#52525b' }}>
                {de ? 'Agenten dieses Projekts arbeiten in diesem Ordner' : 'Agents in this project will work in this folder'}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#52525b', cursor: 'pointer',
            display: 'flex', padding: 4, borderRadius: 6,
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Manual path input */}
        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={manualInput}
              onChange={e => setManualInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleManualGo()}
              placeholder={de ? '/pfad/zum/projekt' : '/path/to/project'}
              style={{
                flex: 1, padding: '0.5rem 0.75rem', borderRadius: 8,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#e4e4e7', fontSize: 13, fontFamily: 'monospace', outline: 'none',
              }}
            />
            <button onClick={handleManualGo} style={{
              padding: '0.5rem 0.875rem', borderRadius: 8, cursor: 'pointer',
              background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
              color: '#23CDCB', fontSize: 12, fontWeight: 600,
            }}>
              {de ? 'Gehen' : 'Go'}
            </button>
            {current && (
              <button onClick={() => navigateTo(current.home)} title={de ? 'Home-Verzeichnis' : 'Home directory'} style={{
                padding: '0.5rem', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                color: '#71717a', display: 'flex', alignItems: 'center',
              }}>
                <Home size={14} />
              </button>
            )}
          </div>
          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', marginTop: 4 }}>{error}</div>
          )}
        </div>

        {/* Breadcrumbs */}
        {current && (
          <div style={{
            padding: '0.5rem 1.25rem',
            display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}>
            {current.parent && (
              <button onClick={() => navigateTo(current.parent!)} style={{
                background: 'none', border: 'none', color: '#71717a', cursor: 'pointer',
                display: 'flex', alignItems: 'center', padding: '2px 4px', borderRadius: 4,
              }}>
                <ArrowLeft size={13} />
              </button>
            )}
            {breadcrumbs.map((b, i) => (
              <span key={b.path} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                {i > 0 && <ChevronRight size={11} style={{ color: '#3f3f46' }} />}
                <button
                  onClick={() => navigateTo(b.path)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px',
                    borderRadius: 5, fontSize: 12,
                    color: i === breadcrumbs.length - 1 ? '#23CDCB' : '#71717a',
                    fontWeight: i === breadcrumbs.length - 1 ? 600 : 400,
                  }}
                >
                  {b.label}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Directory list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2.5rem', color: '#52525b' }}>
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : current?.dirs.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: '#3f3f46', fontSize: 13 }}>
              {de ? 'Keine Unterordner vorhanden' : 'No subdirectories found'}
            </div>
          ) : (
            current?.dirs.map(dir => (
              <button
                key={dir.path}
                onClick={() => navigateTo(dir.path)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.625rem',
                  width: '100%', padding: '0.5rem 0.75rem', borderRadius: 9,
                  background: 'none', border: '1px solid transparent',
                  color: '#e4e4e7', cursor: 'pointer', textAlign: 'left',
                  fontSize: 13, transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(35,205,202,0.06)';
                  e.currentTarget.style.borderColor = 'rgba(35,205,202,0.12)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'none';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <FolderOpen size={15} style={{ color: '#23CDCB', flexShrink: 0, opacity: 0.7 }} />
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {dir.name}
                </span>
                <ChevronRight size={13} style={{ color: '#3f3f46', flexShrink: 0 }} />
              </button>
            ))
          )}
        </div>

        {/* New folder input */}
        {showNewFolder && (
          <div style={{ padding: '0.625rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                autoFocus
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
                placeholder={de ? 'Neuer Ordner-Name…' : 'New folder name…'}
                style={{
                  flex: 1, padding: '0.4rem 0.625rem', borderRadius: 7,
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                  color: '#e4e4e7', fontSize: 13, outline: 'none',
                }}
              />
              <button onClick={handleCreateFolder} disabled={!newFolderName.trim() || creating} style={{
                padding: '0.4rem 0.75rem', borderRadius: 7, cursor: 'pointer',
                background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
                color: '#23CDCB', fontSize: 12, fontWeight: 600, opacity: !newFolderName.trim() ? 0.5 : 1,
              }}>
                {creating ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : (de ? 'Erstellen' : 'Create')}
              </button>
              <button onClick={() => setShowNewFolder(false)} style={{
                background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', padding: 4,
              }}>
                <X size={14} />
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '0.875rem 1.25rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
        }}>
          <button
            onClick={() => setShowNewFolder(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.5rem 0.875rem', borderRadius: 9, cursor: 'pointer',
              background: showNewFolder ? 'rgba(35,205,202,0.08)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${showNewFolder ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.08)'}`,
              color: showNewFolder ? '#23CDCB' : '#71717a', fontSize: 13,
            }}
          >
            <FolderPlus size={14} />
            {de ? 'Neuer Ordner' : 'New Folder'}
          </button>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={onClose} style={{
              padding: '0.5rem 1rem', borderRadius: 9, cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#71717a', fontSize: 13,
            }}>
              {de ? 'Abbrechen' : 'Cancel'}
            </button>
            <button
              onClick={() => current && onSelect(current.current)}
              disabled={!current}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.5rem 1.125rem', borderRadius: 9, cursor: current ? 'pointer' : 'not-allowed',
                background: current ? 'rgba(35,205,202,0.9)' : 'rgba(35,205,202,0.3)',
                border: '1px solid rgba(35,205,202,0.3)',
                color: '#000', fontSize: 13, fontWeight: 700,
              }}
            >
              <Check size={14} />
              {de ? 'Diesen Ordner wählen' : 'Select this folder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
