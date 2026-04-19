import { useEffect, useState } from 'react';
import { Server, Plus, X, CheckCircle2, AlertCircle, Power, Copy } from 'lucide-react';
import { useI18n } from '../i18n';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { GlassCard } from '../components/GlassCard';
import { PageHelp } from '../components/PageHelp';

function authFetch(url: string, init?: RequestInit) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, {
    ...init,
    headers: { ...(init?.headers || {}), 'content-type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
  });
}

interface Worker {
  id: string;
  name: string;
  hostname: string | null;
  capabilities: string[];
  status: 'online' | 'offline' | 'disabled';
  maxConcurrency: number;
  activeRuns: number;
  totalRuns: number;
  lastHeartbeatAt: string | null;
  registriertAm: string;
}

const CAPABILITY_OPTIONS = ['bash', 'http', 'claude-code', 'openrouter', 'ollama', 'openclaw', 'codex-cli', 'gemini-cli'];

export function WorkerNodes() {
  const i18n = useI18n();
  const de = i18n.language === 'de';
  useBreadcrumbs([de ? 'Worker-Nodes' : 'Worker Nodes']);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [caps, setCaps] = useState<string[]>(['bash', 'claude-code']);
  const [concurrency, setConcurrency] = useState(1);
  const [justRegistered, setJustRegistered] = useState<{ id: string; token: string } | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const r = await authFetch('/api/workers');
      if (!r.ok) throw new Error(await r.text());
      const d = await r.json();
      setWorkers(d.workers || []);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, []);

  const register = async () => {
    if (!name || caps.length === 0) return;
    try {
      const r = await authFetch('/api/workers/register', {
        method: 'POST',
        body: JSON.stringify({ name, hostname: hostname || undefined, capabilities: caps, maxConcurrency: concurrency }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setJustRegistered({ id: d.id, token: d.token });
      setShowRegister(false);
      setName(''); setHostname('');
      load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const disable = async (id: string) => {
    if (!confirm(de ? 'Worker deaktivieren?' : 'Disable this worker?')) return;
    await authFetch(`/api/workers/${id}/disable`, { method: 'POST' });
    load();
  };

  const statusColor = (s: Worker['status']) =>
    s === 'online' ? '#22c55e' : s === 'offline' ? '#f59e0b' : '#64748b';

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Server size={24} color="#23CDCB" />
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#e2e8f0' }}>{de ? 'Worker-Nodes' : 'Worker Nodes'}</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#94a3b8' }}>
            {de ? 'Verteilte Agent-Worker für mehr Durchsatz' : 'Distributed agent workers for higher throughput'}
          </p>
        </div>
        <button onClick={() => setShowRegister(true)} style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px',
          borderRadius: 10, border: '1px solid rgba(35,205,203,0.3)',
          background: 'rgba(35,205,203,0.1)', color: '#23CDCB', fontSize: 13, cursor: 'pointer',
        }}>
          <Plus size={14} /> {de ? 'Worker registrieren' : 'Register worker'}
        </button>
      </div>

      <PageHelp id="workers" lang={i18n.language} />

      {justRegistered && (
        <GlassCard style={{ padding: '1rem', marginBottom: 16, border: '1px solid rgba(34,197,94,0.3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <CheckCircle2 size={16} color="#22c55e" />
            <strong style={{ color: '#22c55e' }}>{de ? 'Worker registriert' : 'Worker registered'}</strong>
            <button onClick={() => setJustRegistered(null)} style={{
              marginLeft: 'auto', background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer',
            }}><X size={14} /></button>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: 12, color: '#94a3b8' }}>
            {de ? 'Token wird nur einmal angezeigt. Kopiere ihn jetzt.' : 'Token shown once only. Copy it now.'}
          </p>
          <div style={{ fontFamily: 'monospace', fontSize: 11, background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8, marginBottom: 8 }}>
            <div><span style={{ color: '#64748b' }}>ID:&nbsp;&nbsp;&nbsp;</span>{justRegistered.id}</div>
            <div><span style={{ color: '#64748b' }}>TOKEN:</span>{justRegistered.token}</div>
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(`OPENCOGNIT_WORKER_ID=${justRegistered.id}\nOPENCOGNIT_WORKER_TOKEN=${justRegistered.token}`)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
              background: 'rgba(35,205,203,0.1)', border: '1px solid rgba(35,205,203,0.3)',
              color: '#23CDCB', borderRadius: 6, fontSize: 12, cursor: 'pointer',
            }}
          >
            <Copy size={12} /> {de ? 'Als .env kopieren' : 'Copy as .env'}
          </button>
        </GlassCard>
      )}

      {showRegister && (
        <GlassCard style={{ padding: '1.5rem', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <strong style={{ color: '#e2e8f0' }}>{de ? 'Neuer Worker' : 'New worker'}</strong>
            <button onClick={() => setShowRegister(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}><X size={16} /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{de ? 'Name' : 'Name'}</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="gpu-worker-1" style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Hostname</span>
              <input value={hostname} onChange={e => setHostname(e.target.value)} placeholder="optional" style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>{de ? 'Max. Concurrency' : 'Max concurrency'}</span>
              <input type="number" value={concurrency} onChange={e => setConcurrency(Number(e.target.value) || 1)} min={1} max={20} style={inputStyle} />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>{de ? 'Fähigkeiten' : 'Capabilities'}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {CAPABILITY_OPTIONS.map(c => (
                <button
                  key={c}
                  onClick={() => setCaps(caps.includes(c) ? caps.filter(x => x !== c) : [...caps, c])}
                  style={{
                    padding: '4px 10px', borderRadius: 999, fontSize: 11, cursor: 'pointer',
                    background: caps.includes(c) ? 'rgba(35,205,203,0.2)' : 'rgba(148,163,184,0.1)',
                    color: caps.includes(c) ? '#23CDCB' : '#94a3b8',
                    border: `1px solid ${caps.includes(c) ? '#23CDCB' : 'rgba(148,163,184,0.2)'}`,
                  }}
                >{c}</button>
              ))}
            </div>
          </div>
          <button onClick={register} disabled={!name || caps.length === 0} style={{
            marginTop: 16, padding: '8px 16px', borderRadius: 8,
            background: 'rgba(35,205,203,0.15)', color: '#23CDCB',
            border: '1px solid rgba(35,205,203,0.3)', cursor: 'pointer', fontSize: 13,
            opacity: (!name || caps.length === 0) ? 0.5 : 1,
          }}>{de ? 'Registrieren' : 'Register'}</button>
        </GlassCard>
      )}

      {loading && <div style={{ color: '#94a3b8', padding: 20 }}>{de ? 'Lade…' : 'Loading…'}</div>}
      {error && <div style={{ color: '#ef4444', padding: 20, fontSize: 13 }}><AlertCircle size={14} style={{ display: 'inline', marginRight: 6 }} />{error}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 12 }}>
        {workers.map(w => {
          const color = statusColor(w.status);
          const loadPct = w.maxConcurrency > 0 ? (w.activeRuns / w.maxConcurrency) * 100 : 0;
          return (
            <GlassCard key={w.id} style={{ padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Server size={14} color={color} />
                <strong style={{ color: '#e2e8f0', fontSize: 14 }}>{w.name}</strong>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: `${color}22`, color, border: `1px solid ${color}44`, marginLeft: 'auto' }}>
                  {w.status}
                </span>
              </div>
              {w.hostname && <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{w.hostname}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {w.capabilities.map(c => (
                  <span key={c} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(35,205,203,0.1)', color: '#23CDCB' }}>{c}</span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                {de ? 'Auslastung' : 'Load'}: {w.activeRuns} / {w.maxConcurrency}
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
                <div style={{ width: `${Math.min(100, loadPct)}%`, height: '100%', background: loadPct > 80 ? '#f59e0b' : '#23CDCB' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b' }}>
                <span>{de ? 'Gesamt' : 'Total'}: {w.totalRuns}</span>
                {w.lastHeartbeatAt && <span>♥ {new Date(w.lastHeartbeatAt).toLocaleTimeString()}</span>}
              </div>
              {w.status !== 'disabled' && (
                <button onClick={() => disable(w.id)} style={{
                  marginTop: 10, width: '100%', padding: '6px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
                  background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                  <Power size={11} /> {de ? 'Deaktivieren' : 'Disable'}
                </button>
              )}
            </GlassCard>
          );
        })}
      </div>

      {!loading && workers.length === 0 && (
        <div style={{ color: '#64748b', padding: 40, textAlign: 'center', fontSize: 13 }}>
          {de ? 'Keine Worker registriert. Klicke oben auf "Worker registrieren" um den ersten hinzuzufügen.' : 'No workers registered. Click "Register worker" to add the first one.'}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 8, fontSize: 13,
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
  color: '#e2e8f0',
};

export default WorkerNodes;
