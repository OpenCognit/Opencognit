import React, { useEffect, useRef, useState } from 'react';
import { Activity, Brain, Zap, AlertCircle, Info, CheckCircle2, X, Minimize2, Maximize2 } from 'lucide-react';

export interface TraceEvent {
  id: string;
  expertId: string;
  typ: 'thinking' | 'action' | 'result' | 'error' | 'info';
  titel: string;
  details?: string;
  erstelltAm: string;
}

const zeitRelativ = (iso: string) => {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const sek = Math.floor(diff / 1000);
  if (sek < 60) return 'jetzt';
  const min = Math.floor(sek / 60);
  if (min < 60) return `${min}m`;
  const std = Math.floor(min / 60);
  if (std < 24) return `${std}std`;
  return d.toLocaleDateString('de-DE');
};

interface GlassAgentPanelProps {
  expertId: string;
  expertName: string;
  onClose?: () => void;
  /** Render inline (no fixed positioning) — for embedding inside panels */
  inline?: boolean;
  /** Look like a flat list (no background/border) */
  embedded?: boolean;
}


const TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  thinking: {
    icon: <Brain size={13} />,
    color: '#a78bfa',
    bg: 'rgba(167,139,250,0.1)',
    label: 'Denkt',
  },
  action: {
    icon: <Zap size={13} />,
    color: '#c5a059',
    bg: 'rgba(197,160,89,0.1)',
    label: 'Aktion',
  },
  result: {
    icon: <CheckCircle2 size={13} />,
    color: '#10b981',
    bg: 'rgba(16,185,129,0.1)',
    label: 'Ergebnis',
  },
  error: {
    icon: <AlertCircle size={13} />,
    color: '#ef4444',
    bg: 'rgba(239,68,68,0.1)',
    label: 'Fehler',
  },
  info: {
    icon: <Info size={13} />,
    color: '#94a3b8',
    bg: 'rgba(148,163,184,0.06)',
    label: 'Info',
  },
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function GlassAgentPanel({ expertId, expertName, onClose, inline = false, embedded = false }: GlassAgentPanelProps) {
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Fresh token from localStorage for each connection attempt
    const token = localStorage.getItem('opencognit_token');
    const url = `/api/experten/${expertId}/trace?token=${encodeURIComponent(token || '')}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setRetryCount(0);
    };

    es.onerror = (e) => {
      setConnected(false);
      console.error('[GlassAgent] SSE Error', e);
      es.close();
      
      // Exponential backoff for manual reconnect if ES doesn't do it right due to auth
      const timeout = Math.min(1000 * Math.pow(2, retryCount), 30000);
      setTimeout(() => {
        setRetryCount(prev => prev + 1);
      }, timeout);
    };

    es.onmessage = (e) => {
      try {
        const event: TraceEvent = JSON.parse(e.data);
        setEvents(prev => {
          if (prev.some(p => p.id === event.id)) return prev;
          // Auto-expand NEW events that are either "thinking" or "action" or "error"
          if (['thinking', 'action', 'error'].includes(event.typ)) {
            setExpandedId(event.id);
          }
          return [...prev.slice(-199), event];
        });
      } catch { /* ignore parse errors */ }
    };

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, [expertId, retryCount]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (!minimized && events.length > 0) {
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [events.length, minimized]);

  const clearEvents = () => setEvents([]);

  return (
    <div
      style={embedded ? {
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      } : (inline ? {
        width: '100%',
        maxHeight: '460px',
        backgroundColor: 'rgba(8,8,18,0.97)',
        border: '1px solid rgba(197,160,89,0.2)',
        borderRadius: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      } : {
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        width: minimized ? '260px' : '420px',
        maxHeight: minimized ? 'auto' : '520px',
        backgroundColor: 'rgba(8,8,18,0.97)',
        backdropFilter: 'blur(40px)',
        border: '1px solid rgba(197,160,89,0.2)',
        borderRadius: 0,
        boxShadow: '0 0 0 1px rgba(197,160,89,0.05), 0 24px 48px rgba(0,0,0,0.6)',
        zIndex: 9000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width 0.2s, max-height 0.2s',
      })}
    >
      {/* Header (hidden if embedded) */}
      {!embedded && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1rem',
          borderBottom: minimized ? 'none' : '1px solid rgba(255,255,255,0.06)',
          cursor: 'pointer',
        }}
          onClick={() => setMinimized(v => !v)}
        >
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#10b981' : '#ef4444',
            boxShadow: connected ? '0 0 6px #10b981' : 'none',
            flexShrink: 0,
            animation: connected ? 'pulse 2s infinite' : 'none',
          }} />
          <Activity size={14} style={{ color: '#c5a059', flexShrink: 0 }} />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#e2e8f0', flex: 1, letterSpacing: '0.02em' }}>
            Glass Agent — {expertName}
          </span>
          <span style={{ fontSize: '0.65rem', color: '#64748b' }}>
            {events.length} Events
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setMinimized(v => !v); }}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px', display: 'flex' }}
          >
            {minimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>
          {onClose && (
            <button
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '2px', display: 'flex' }}
            >
              <X size={13} />
            </button>
          )}
        </div>
      )}

      {/* Body */}
      {!minimized && (
        <>
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: embedded ? '0' : '0.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: embedded ? '0' : '3px',
            maxHeight: embedded ? 'none' : '420px',
            scrollbarWidth: 'thin',
          }}>
            {events.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '3rem 1rem',
                color: '#334155',
                fontSize: '0.8rem',
              }}>
                <Activity size={28} style={{ margin: '0 auto 0.75rem', display: 'block', opacity: 0.3 }} />
                Warte auf Agent-Aktivität…
              </div>
            )}

            {events.map((event, i) => {
              const cfg = TYPE_CONFIG[event.typ] ?? TYPE_CONFIG.info;
              const isExpanded = expandedId === event.id;

              if (embedded) {
                return (
                  <div
                    key={event.id}
                    onClick={() => setExpandedId(isExpanded ? null : event.id)}
                    style={{
                      display: 'flex',
                      gap: 12,
                      alignItems: 'flex-start',
                      padding: '12px 0',
                      borderBottom: i < events.length - 1 ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
                      cursor: event.details ? 'pointer' : 'default',
                      animation: 'fadeInUp 0.3s ease-out both',
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      background: cfg.bg,
                      color: cfg.color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: 2,
                      boxShadow: event.typ === 'thinking' ? `0 0 10px ${cfg.color}44` : 'none',
                      animation: event.typ === 'thinking' ? 'thinking-pulse 2s infinite ease-in-out' : 'none',
                    }}>
                      {cfg.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{
                          padding: '2px 8px',
                          backgroundColor: 'rgba(255, 255, 255, 0.03)',
                          border: `1px solid ${cfg.color}33`,
                          borderRadius: '9999px',
                          fontSize: '10px',
                          color: cfg.color,
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          letterSpacing: '0.04em',
                        }}>
                          {cfg.label}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                          {event.titel}
                        </span>
                      </div>
                      
                      {isExpanded && event.details && (
                        <div style={{
                          marginTop: '8px',
                          padding: '10px 12px',
                          background: 'rgba(0,0,0,0.2)',
                          borderLeft: `2px solid ${cfg.color}`,
                          borderRadius: 0,
                          fontSize: '12px',
                          color: 'var(--color-text-secondary)',
                          whiteSpace: 'pre-wrap',
                          lineHeight: 1.6,
                        }}>
                          {event.details}
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)', flexShrink: 0, marginTop: 4 }}>
                      {zeitRelativ(event.erstelltAm)}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={event.id}
                  onClick={() => setExpandedId(isExpanded ? null : event.id)}
                  style={{
                    padding: '0.4rem 0.6rem',
                    borderRadius: 0,
                    background: cfg.bg,
                    border: `1px solid ${cfg.color}22`,
                    cursor: event.details ? 'pointer' : 'default',
                    transition: 'background 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ 
                      color: cfg.color, 
                      flexShrink: 0, 
                      display: 'flex', 
                      alignItems: 'center',
                      animation: event.typ === 'thinking' ? 'thinking-pulse 2s infinite ease-in-out' : 'none',
                    }}>
                      {cfg.icon}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: '#e2e8f0', flex: 1, fontWeight: 500 }}>
                      {event.titel}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: '#475569', flexShrink: 0 }}>
                      {formatTime(event.erstelltAm)}
                    </span>
                  </div>
                  {isExpanded && event.details && (
                    <div style={{
                      marginTop: '0.4rem',
                      padding: '0.4rem 0.5rem',
                      background: 'rgba(0,0,0,0.3)',
                      borderRadius: 0,
                      fontSize: '0.7rem',
                      color: '#94a3b8',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '120px',
                      overflowY: 'auto',
                      lineHeight: 1.5,
                    }}>
                      {event.details}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Footer */}
          <div style={{
            padding: embedded ? '16px 0 0' : '0.4rem 0.75rem',
            borderTop: embedded ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(255,255,255,0.04)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: embedded ? 8 : 0,
          }}>
            <span style={{ fontSize: '0.65rem', color: connected ? '#10b981' : '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', boxShadow: connected ? '0 0 6px currentColor' : 'none' }} />
              {connected ? 'Verbunden (Live)' : 'Getrennt'}
            </span>
            <button
              onClick={clearEvents}
              style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
                color: 'var(--color-text-secondary)', fontSize: '11px',
                cursor: 'pointer', padding: '4px 10px',
                borderRadius: 0,
                transition: 'all 0.2s',
              }}
              onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
              onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.03)'}
            >
              Leeren
            </button>
          </div>
        </>
      )}

    </div>
  );
}
