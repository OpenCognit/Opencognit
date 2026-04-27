import { useEffect, useState } from 'react';
import { Package, Download, Trash2, RefreshCw, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { GlassCard } from '../components/GlassCard';
import { PageHelp } from '../components/PageHelp';

function authFetch(url: string, init?: RequestInit) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.headers || {}), 'content-type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
  });
}

interface RegistryPlugin {
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  type: 'adapter';
  source: string;
  homepage?: string;
  tags?: string[];
  installed?: boolean;
}

export function Plugins() {
  const i18n = useI18n();
  const de = i18n.language === 'de';
  useBreadcrumbs([de ? 'Plugins' : 'Plugins']);

  const [plugins, setPlugins] = useState<RegistryPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const [registryUrl, setRegistryUrl] = useState('');

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const u = registryUrl ? `/api/plugin-registry?url=${encodeURIComponent(registryUrl)}` : '/api/plugin-registry';
      const r = await authFetch(u);
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setPlugins(d.plugins || []);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const install = async (p: RegistryPlugin) => {
    setBusy(p.id);
    try {
      const r = await authFetch('/api/plugin-registry/install', { method: 'POST', body: JSON.stringify(p) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'install failed');
      setToast({ kind: 'ok', msg: de ? `Installiert: ${p.name} (${d.loadedAdapters} Adapter aktiv)` : `Installed: ${p.name} (${d.loadedAdapters} adapters active)` });
      load();
    } catch (e: any) {
      setToast({ kind: 'err', msg: e.message });
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  const uninstall = async (p: RegistryPlugin) => {
    if (!confirm(de ? `"${p.name}" wirklich entfernen?` : `Really remove "${p.name}"?`)) return;
    setBusy(p.id);
    try {
      const r = await authFetch('/api/plugin-registry/uninstall', { method: 'POST', body: JSON.stringify({ id: p.id }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'uninstall failed');
      setToast({ kind: 'ok', msg: de ? `Entfernt: ${p.name}` : `Removed: ${p.name}` });
      load();
    } catch (e: any) {
      setToast({ kind: 'err', msg: e.message });
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 4000);
    }
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Package size={24} color="#c5a059" />
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#e2e8f0' }}>{de ? 'Plugins' : 'Plugins'}</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
            {de ? 'Adapter-Plugins aus der Registry installieren' : 'Install adapter plugins from the registry'}
          </p>
        </div>
        <button onClick={load} style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          borderRadius: 0, border: '1px solid rgba(35,205,203,0.3)',
          background: 'rgba(35,205,203,0.1)', color: '#c5a059', fontSize: 13, cursor: 'pointer',
        }}>
          <RefreshCw size={14} /> {de ? 'Aktualisieren' : 'Refresh'}
        </button>
      </div>

      <PageHelp id="plugins" lang={i18n.language} />

      <GlassCard style={{ padding: '1rem', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, color: '#94a3b8', minWidth: 110 }}>
            {de ? 'Registry-URL' : 'Registry URL'}
          </label>
          <input
            type="text"
            value={registryUrl}
            onChange={e => setRegistryUrl(e.target.value)}
            placeholder={de ? 'Leer = offizielle Registry' : 'Empty = official registry'}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 0, fontSize: 13,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#e2e8f0',
            }}
          />
          <button onClick={load} style={{
            padding: '8px 16px', borderRadius: 0, fontSize: 13, cursor: 'pointer',
            background: 'rgba(35,205,203,0.15)', color: '#c5a059',
            border: '1px solid rgba(35,205,203,0.3)',
          }}>{de ? 'Laden' : 'Load'}</button>
        </div>
      </GlassCard>

      {toast && (
        <div style={{
          padding: '10px 14px', marginBottom: 16, borderRadius: 0, fontSize: 13,
          background: toast.kind === 'ok' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${toast.kind === 'ok' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
          color: toast.kind === 'ok' ? '#22c55e' : '#ef4444',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {toast.kind === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
          {toast.msg}
        </div>
      )}

      {loading && <div style={{ color: '#94a3b8', padding: 20 }}>{de ? 'Lade…' : 'Loading…'}</div>}
      {error && (
        <div style={{ color: '#ef4444', padding: 20, fontSize: 13 }}>
          {de ? 'Registry nicht erreichbar' : 'Registry unreachable'}: {error}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {plugins.map(p => (
          <GlassCard key={p.id} style={{ padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ color: '#e2e8f0', fontSize: 14 }}>{p.name}</strong>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 0, background: 'rgba(148,163,184,0.15)', color: '#94a3b8' }}>
                    v{p.version}
                  </span>
                  {p.installed && (
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 0, background: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>
                      {de ? 'installiert' : 'installed'}
                    </span>
                  )}
                </div>
                {p.author && <div style={{ fontSize: 11, color: '#64748b' }}>by {p.author}</div>}
              </div>
              {p.homepage && (
                <a href={p.homepage} target="_blank" rel="noopener noreferrer" style={{ color: '#c5a059' }} title="Homepage">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>
            {p.description && (
              <p style={{ margin: '8px 0', fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{p.description}</p>
            )}
            {p.tags && p.tags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {p.tags.map(t => (
                  <span key={t} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 0, background: 'rgba(35,205,203,0.1)', color: '#c5a059' }}>{t}</span>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
              {p.installed ? (
                <button
                  onClick={() => uninstall(p)}
                  disabled={busy === p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 0,
                    fontSize: 12, cursor: busy === p.id ? 'wait' : 'pointer',
                    background: 'rgba(239,68,68,0.1)', color: '#ef4444',
                    border: '1px solid rgba(239,68,68,0.3)',
                    opacity: busy === p.id ? 0.6 : 1,
                  }}
                >
                  <Trash2 size={12} /> {de ? 'Entfernen' : 'Uninstall'}
                </button>
              ) : (
                <button
                  onClick={() => install(p)}
                  disabled={busy === p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 0,
                    fontSize: 12, cursor: busy === p.id ? 'wait' : 'pointer',
                    background: 'rgba(35,205,203,0.15)', color: '#c5a059',
                    border: '1px solid rgba(35,205,203,0.3)',
                    opacity: busy === p.id ? 0.6 : 1,
                  }}
                >
                  <Download size={12} /> {busy === p.id ? (de ? 'Installiere…' : 'Installing…') : (de ? 'Installieren' : 'Install')}
                </button>
              )}
            </div>
          </GlassCard>
        ))}
      </div>

      {!loading && !error && plugins.length === 0 && (
        <div style={{ color: '#64748b', padding: 40, textAlign: 'center', fontSize: 13 }}>
          {de ? 'Keine Plugins in dieser Registry.' : 'No plugins in this registry.'}
        </div>
      )}
    </div>
  );
}

export default Plugins;
