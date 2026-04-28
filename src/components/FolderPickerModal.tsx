import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, ChevronRight, ArrowLeft, Home, Check, Loader2, FolderPlus } from 'lucide-react';
import { authFetch } from '../utils/api';
import { useI18n } from '../i18n';
import { ModalShell, inputStyle, inputFocus, btnPrimary, btnPrimaryHover, btnSecondary, btnSecondaryHover } from './ModalShell';

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

  const footer = (
    <>
      <button
        onClick={() => setShowNewFolder(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.375rem',
          marginRight: 'auto',
          ...btnSecondary,
          background: showNewFolder ? 'rgba(197,160,89,0.08)' : btnSecondary.background,
          borderColor: showNewFolder ? 'rgba(197,160,89,0.2)' : btnSecondary.borderColor,
          color: showNewFolder ? '#c5a059' : btnSecondary.color,
        }}
        onMouseEnter={(e) => Object.assign(e.currentTarget.style, btnSecondaryHover)}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = showNewFolder ? 'rgba(197,160,89,0.08)' : btnSecondary.background;
          e.currentTarget.style.borderColor = showNewFolder ? 'rgba(197,160,89,0.2)' : btnSecondary.borderColor;
          e.currentTarget.style.color = showNewFolder ? '#c5a059' : btnSecondary.color;
        }}
      >
        <FolderPlus size={14} />
        {de ? 'Neuer Ordner' : 'New Folder'}
      </button>
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
        {de ? 'Abbrechen' : 'Cancel'}
      </button>
      <button
        onClick={() => current && onSelect(current.current)}
        disabled={!current}
        style={{
          ...btnPrimary,
          cursor: current ? 'pointer' : 'not-allowed',
          opacity: current ? 1 : 0.5,
        }}
        onMouseEnter={(e) => {
          if (current) Object.assign(e.currentTarget.style, btnPrimaryHover);
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = btnPrimary.background;
          e.currentTarget.style.borderColor = btnPrimary.borderColor;
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        <Check size={14} />
        {de ? 'Diesen Ordner wählen' : 'Select this folder'}
      </button>
    </>
  );

  return (
    <ModalShell
      isOpen={true}
      onClose={onClose}
      title={de ? 'Projektverzeichnis wählen' : 'Select Project Directory'}
      titleIcon={<FolderOpen size={15} />}
      maxWidth="560px"
      footer={footer}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {/* Manual path input */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            value={manualInput}
            onChange={e => setManualInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleManualGo()}
            placeholder={de ? '/pfad/zum/projekt' : '/path/to/project'}
            style={{
              ...inputStyle,
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 13,
            }}
            onFocus={(e) => Object.assign(e.currentTarget.style, inputFocus)}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = (inputStyle as any).borderColor;
              e.currentTarget.style.boxShadow = 'none';
            }}
          />
          <button onClick={handleManualGo} style={{
            padding: '0.5rem 0.875rem', borderRadius: 0, cursor: 'pointer',
            background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.2)',
            color: '#c5a059', fontSize: 12, fontWeight: 600,
          }}>
            {de ? 'Gehen' : 'Go'}
          </button>
          {current && (
            <button onClick={() => navigateTo(current.home)} title={de ? 'Home-Verzeichnis' : 'Home directory'} style={{
              padding: '0.5rem', borderRadius: 0, cursor: 'pointer',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#71717a', display: 'flex', alignItems: 'center',
            }}>
              <Home size={14} />
            </button>
          )}
        </div>
        {error && (
          <div style={{ fontSize: 12, color: '#ef4444' }}>{error}</div>
        )}

        {/* Breadcrumbs */}
        {current && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.25rem', flexWrap: 'wrap',
            padding: '0.375rem 0',
          }}>
            {current.parent && (
              <button onClick={() => navigateTo(current.parent!)} style={{
                background: 'none', border: 'none', color: '#71717a', cursor: 'pointer',
                display: 'flex', alignItems: 'center', padding: '2px 4px', borderRadius: 0,
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
                    borderRadius: 0, fontSize: 12,
                    color: i === breadcrumbs.length - 1 ? '#c5a059' : '#71717a',
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
        <div style={{ maxHeight: '280px', overflowY: 'auto', marginTop: '0.25rem' }}>
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
                  width: '100%', padding: '0.5rem 0.75rem', borderRadius: 0,
                  background: 'none', border: '1px solid transparent',
                  color: '#e4e4e7', cursor: 'pointer', textAlign: 'left',
                  fontSize: 13, transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(197,160,89,0.06)';
                  e.currentTarget.style.borderColor = 'rgba(197,160,89,0.12)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'none';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <FolderOpen size={15} style={{ color: '#c5a059', flexShrink: 0, opacity: 0.7 }} />
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
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
              placeholder={de ? 'Neuer Ordner-Name…' : 'New folder name…'}
              style={{
                flex: 1, padding: '0.4rem 0.625rem', borderRadius: 0,
                background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#e4e4e7', fontSize: 13, outline: 'none',
              }}
            />
            <button onClick={handleCreateFolder} disabled={!newFolderName.trim() || creating} style={{
              padding: '0.4rem 0.75rem', borderRadius: 0, cursor: 'pointer',
              background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.2)',
              color: '#c5a059', fontSize: 12, fontWeight: 600, opacity: !newFolderName.trim() ? 0.5 : 1,
            }}>
              {creating ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : (de ? 'Erstellen' : 'Create')}
            </button>
          </div>
        )}
      </div>
    </ModalShell>
  );
}
