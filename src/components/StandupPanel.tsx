import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2, Sparkles, Users, RefreshCw, CheckCircle2, Clock, AlertTriangle, Copy, Check } from 'lucide-react';
import { authFetch } from '../utils/api';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StandupParticipant {
  agent: { id: string; name: string; avatar: string; avatarFarbe: string; rolle: string; status: string };
  yesterday: string;
  today: string;
  blockers: string;
  source: 'ai' | 'template';
}

interface StandupData {
  date: string;
  participants: StandupParticipant[];
}

// ─── Typewriter ───────────────────────────────────────────────────────────────

function Typewriter({ text, delay = 0, speed = 18 }: { text: string; delay?: number; speed?: number }) {
  const [displayed, setDisplayed] = useState('');
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const idx = useRef(0);

  useEffect(() => {
    idx.current = 0;
    setDisplayed('');
    setDone(false);
    setStarted(false);
    const delayTimer = setTimeout(() => {
      setStarted(true);
      const id = setInterval(() => {
        if (idx.current < text.length) {
          setDisplayed(text.slice(0, ++idx.current));
        } else {
          setDone(true);
          clearInterval(id);
        }
      }, speed);
      return () => clearInterval(id);
    }, delay);
    return () => clearTimeout(delayTimer);
  }, [text, delay, speed]);

  if (!started) return null;
  return (
    <span>
      {displayed}
      {!done && <span style={{ animation: 'blink 1s step-end infinite', color: '#23CDCB' }}>|</span>}
    </span>
  );
}

// ─── Participant Card ─────────────────────────────────────────────────────────

function ParticipantCard({ participant, index, visible }: { participant: StandupParticipant; index: number; visible: boolean }) {
  const isDE = participant.yesterday.includes('Habe') || participant.yesterday.includes('Keine');
  const hasBlockers = !participant.blockers.toLowerCase().includes('no blocker') &&
                      !participant.blockers.toLowerCase().includes('keine blocker');
  const delay = index * 800;
  const agent = participant.agent;

  const STATUS_COLOR: Record<string, string> = {
    running: '#23CDCB', active: '#22c55e', idle: '#94a3b8',
    paused: '#f59e0b', error: '#ef4444', terminated: '#475569',
  };
  const statusColor = STATUS_COLOR[agent.status] ?? '#94a3b8';

  return (
    <div style={{
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(20px)',
      transition: `opacity 0.4s ease ${delay}ms, transform 0.4s ease ${delay}ms`,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 16,
      overflow: 'hidden',
    }}>
      {/* Agent Header */}
      <div style={{
        padding: '0.875rem 1rem',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', gap: '0.75rem',
        background: 'rgba(255,255,255,0.01)',
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
          background: agent.avatarFarbe || 'rgba(35,205,202,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem', fontWeight: 700, color: '#fff',
          boxShadow: `0 0 12px ${statusColor}30`,
          position: 'relative',
        }}>
          {agent.avatar || agent.name.slice(0, 2).toUpperCase()}
          <div style={{
            position: 'absolute', bottom: -1, right: -1,
            width: 10, height: 10, borderRadius: '50%',
            background: statusColor, border: '2px solid #0a0a0f',
          }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#f4f4f5' }}>{agent.name}</div>
          <div style={{ fontSize: '0.6875rem', color: '#71717a' }}>{agent.rolle}</div>
        </div>
        {participant.source === 'ai' && (
          <span style={{
            padding: '0.125rem 0.5rem', borderRadius: 999,
            background: 'rgba(35,205,202,0.1)', color: '#23CDCB',
            fontSize: '0.625rem', fontWeight: 700, letterSpacing: '0.06em',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <Sparkles size={9} /> AI
          </span>
        )}
      </div>

      {/* Standup items */}
      <div style={{ padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Yesterday */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.3rem' }}>
            <CheckCircle2 size={12} style={{ color: '#22c55e', flexShrink: 0 }} />
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {isDE ? 'Gestern' : 'Yesterday'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#a1a1aa', lineHeight: 1.55 }}>
            {visible ? <Typewriter text={participant.yesterday} delay={delay + 200} /> : null}
          </p>
        </div>

        {/* Today */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.3rem' }}>
            <Clock size={12} style={{ color: '#23CDCB', flexShrink: 0 }} />
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#23CDCB', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {isDE ? 'Heute' : 'Today'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: '#a1a1aa', lineHeight: 1.55 }}>
            {visible ? <Typewriter text={participant.today} delay={delay + 200 + participant.yesterday.length * 18 + 400} /> : null}
          </p>
        </div>

        {/* Blockers */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.3rem' }}>
            <AlertTriangle size={12} style={{ color: hasBlockers ? '#ef4444' : '#3f3f46', flexShrink: 0 }} />
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: hasBlockers ? '#ef4444' : '#3f3f46', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {isDE ? 'Blocker' : 'Blockers'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '0.8125rem', color: hasBlockers ? '#fca5a5' : '#3f3f46', lineHeight: 1.55 }}>
            {visible ? <Typewriter text={participant.blockers} delay={delay + 200 + (participant.yesterday.length + participant.today.length) * 18 + 800} /> : null}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

interface StandupPanelProps {
  open: boolean;
  onClose: () => void;
}

export function StandupPanel({ open, onClose }: StandupPanelProps) {
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const isDE = language === 'de';

  const [data, setData] = useState<StandupData | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const runStandup = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    setLoading(true);
    setVisible(false);
    setData(null);
    try {
      const res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/standup`, {
        method: 'POST',
        body: JSON.stringify({ language }),
      });
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setTimeout(() => setVisible(true), 100);
      }
    } catch {}
    finally { setLoading(false); }
  }, [aktivesUnternehmen?.id, language]);

  useEffect(() => {
    if (open && !data) {
      runStandup();
    }
  }, [open]);

  function handleCopy() {
    if (!data) return;
    const lines = data.participants.map(p =>
      `**${p.agent.name}** (${p.agent.rolle})\n` +
      `↳ Yesterday: ${p.yesterday}\n` +
      `↳ Today: ${p.today}\n` +
      `↳ Blockers: ${p.blockers}`
    ).join('\n\n');
    const text = `Team Standup — ${new Date(data.date).toLocaleDateString()}\n\n${lines}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '92vw', maxWidth: 760, maxHeight: '88vh',
          background: 'rgba(10,10,18,0.98)', backdropFilter: 'blur(40px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 20,
          boxShadow: '0 30px 90px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column',
          animation: 'modalSlideUp 0.25s cubic-bezier(0.34,1.56,0.64,1)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '1.125rem 1.5rem',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10,
              background: 'linear-gradient(135deg, rgba(35,205,202,0.15), rgba(168,85,247,0.15))',
              border: '1px solid rgba(35,205,202,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#23CDCB',
            }}>
              <Users size={16} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#f4f4f5' }}>
                {isDE ? 'Team Standup' : 'Team Standup'}
              </h2>
              <p style={{ margin: 0, fontSize: '0.6875rem', color: '#52525b' }}>
                {data ? new Date(data.date).toLocaleDateString(isDE ? 'de-DE' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : isDE ? 'KI-generiert' : 'AI-generated'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {data && (
              <button
                onClick={handleCopy}
                style={{
                  padding: '0.375rem 0.75rem', borderRadius: 8,
                  background: copied ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${copied ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
                  color: copied ? '#22c55e' : '#71717a', cursor: 'pointer',
                  fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4,
                  transition: 'all 0.2s',
                }}
              >
                {copied ? <><Check size={12} /> {isDE ? 'Kopiert!' : 'Copied!'}</> : <><Copy size={12} /> {isDE ? 'Kopieren' : 'Copy'}</>}
              </button>
            )}
            <button
              onClick={runStandup}
              disabled={loading}
              style={{
                padding: '0.375rem 0.75rem', borderRadius: 8,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                color: '#71717a', cursor: loading ? 'wait' : 'pointer',
                fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {isDE ? 'Neu' : 'Refresh'}
            </button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52525b', padding: 4 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
          {loading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 200, gap: '0.875rem' }}>
              <Loader2 size={24} style={{ color: '#23CDCB', animation: 'spin 1s linear infinite' }} />
              <div style={{ color: '#52525b', fontSize: '0.875rem', textAlign: 'center' }}>
                {isDE ? 'Agenten werden befragt…' : 'Querying your agents…'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#3f3f46' }}>
                {isDE ? 'Das dauert einen Moment' : 'This takes a moment'}
              </div>
            </div>
          ) : data?.participants.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#52525b' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🤖</div>
              <div>{isDE ? 'Keine Agenten für das Standup gefunden.' : 'No agents available for standup.'}</div>
            </div>
          ) : data ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {data.participants.map((p, i) => (
                <ParticipantCard key={p.agent.id} participant={p} index={i} visible={visible} />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes modalSlideUp {
          from { opacity: 0; transform: scale(0.95) translateY(16px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      ` }} />
    </div>
  );
}
