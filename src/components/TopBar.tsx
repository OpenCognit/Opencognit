import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Bell, Cpu, CheckCircle2, AlertCircle, MessageSquare, Play, X, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { apiGenehmigungen } from '../api/client';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';

interface Notification {
  id: string;
  type: 'task_completed' | 'task_started' | 'agent_error' | 'chat_message' | 'approval';
  title: string;
  body?: string;
  link?: string;
  at: number; // timestamp
  read: boolean;
}

interface TopBarProps {
  breadcrumb?: string[];
  onSearchClick: () => void;
}

const NOTIF_KEY = 'opencognit_notifications';

function loadNotifs(): Notification[] {
  try {
    return JSON.parse(localStorage.getItem(NOTIF_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveNotifs(ns: Notification[]) {
  // Keep only last 30
  localStorage.setItem(NOTIF_KEY, JSON.stringify(ns.slice(-30)));
}

function timeAgo(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const TYPE_CONFIG: Record<Notification['type'], { icon: React.ReactNode; color: string; label: string }> = {
  task_completed: { icon: <CheckCircle2 size={14} />, color: '#22c55e', label: 'Task done' },
  task_started:   { icon: <Play size={14} />, color: '#23CDCB', label: 'Task started' },
  agent_error:    { icon: <AlertCircle size={14} />, color: '#ef4444', label: 'Agent error' },
  chat_message:   { icon: <MessageSquare size={14} />, color: '#8b5cf6', label: 'Message' },
  approval:       { icon: <Bell size={14} />, color: '#eab308', label: 'Approval' },
};

export function TopBar({ breadcrumb, onSearchClick }: TopBarProps) {
  const i18n = useI18n();
  const navigate = useNavigate();
  const { aktivesUnternehmen } = useCompany();
  const { breadcrumbs: contextCrumbs } = useBreadcrumbs();
  const [runningAgents, setRunningAgents] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>(loadNotifs);
  const [bellOpen, setBellOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const displayCrumbs = breadcrumb || contextCrumbs;
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  const unreadCount = notifications.filter(n => !n.read).length;
  const hasAgentEvents = notifications.some(n => !n.read && (n.type === 'task_started' || n.type === 'task_completed'));

  const addNotification = useCallback((notif: Omit<Notification, 'id' | 'at' | 'read'>) => {
    const n: Notification = {
      ...notif,
      id: Math.random().toString(36).slice(2),
      at: Date.now(),
      read: false,
    };
    setNotifications(prev => {
      const next = [...prev, n];
      saveNotifs(next);
      return next;
    });
  }, []);

  // Load pending approvals as notifications on mount
  useEffect(() => {
    if (!aktivesUnternehmen?.id) return;
    apiGenehmigungen.liste(aktivesUnternehmen.id)
      .then(list => {
        const pending = list.filter(g => g.status === 'pending');
        if (pending.length > 0) {
          // Only add if not already in notifications
          setNotifications(prev => {
            const existingApprovals = prev.filter(n => n.type === 'approval');
            if (existingApprovals.length === pending.length) return prev;
            // Replace approval notifications
            const nonApprovals = prev.filter(n => n.type !== 'approval');
            const newApprovals: Notification[] = pending.slice(0, 5).map(g => ({
              id: `approval-${g.id}`,
              type: 'approval',
              title: g.titel,
              body: `Pending approval`,
              link: '/approvals',
              at: new Date(g.erstelltAm).getTime(),
              read: false,
            }));
            const next = [...nonApprovals, ...newApprovals];
            saveNotifs(next);
            return next;
          });
        }
      })
      .catch(() => {});
  }, [aktivesUnternehmen?.id]);

  // WebSocket for live events
  useEffect(() => {
    if (!aktivesUnternehmen?.id) return;
    const token = localStorage.getItem('opencognit_token');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.hostname}:3201/ws${token ? `?token=${token}` : ''}`);
    wsRef.current = ws;

    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.unternehmenId && msg.unternehmenId !== aktivesUnternehmen.id) return;

        if (msg.type === 'task_started') {
          setRunningAgents(c => c + 1);
          const d = msg.data ?? msg;
          addNotification({
            type: 'task_started',
            title: d.titel ?? 'Task started',
            body: d.agentName ? `Assigned to ${d.agentName}` : undefined,
            link: '/tasks',
          });
        }
        if (msg.type === 'task_completed') {
          setRunningAgents(c => Math.max(0, c - 1));
          const d = msg.data ?? msg;
          addNotification({
            type: 'task_completed',
            title: d.titel ?? 'Task completed',
            body: d.agentName ? `By ${d.agentName}` : undefined,
            link: '/tasks',
          });
        }
        if (msg.type === 'agent_error') {
          const d = msg.data ?? msg;
          addNotification({
            type: 'agent_error',
            title: d.agentName ? `Error: ${d.agentName}` : 'Agent error',
            body: d.error ?? undefined,
            link: '/experts',
          });
        }
        if (msg.type === 'chat_message') {
          const d = msg.data ?? msg;
          if (d.absenderTyp === 'agent') {
            addNotification({
              type: 'chat_message',
              title: d.agentName ?? 'Agent message',
              body: d.inhalt ? (d.inhalt.length > 60 ? d.inhalt.slice(0, 60) + '…' : d.inhalt) : undefined,
              link: '/experts',
            });
          }
        }
      } catch {}
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [aktivesUnternehmen?.id, addNotification]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!bellOpen) return;
    function handler(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bellOpen]);

  function openBell() {
    setBellOpen(v => !v);
    // Mark all as read when opening
    if (!bellOpen) {
      setNotifications(prev => {
        const next = prev.map(n => ({ ...n, read: true }));
        saveNotifs(next);
        return next;
      });
    }
  }

  function clearAll() {
    setNotifications([]);
    saveNotifs([]);
  }

  function dismissNotif(id: string) {
    setNotifications(prev => {
      const next = prev.filter(n => n.id !== id);
      saveNotifs(next);
      return next;
    });
  }

  const recent = [...notifications].reverse().slice(0, 15);

  return (
    <header className="app-topbar">
      <div className="topbar-left">
        {displayCrumbs && displayCrumbs.length > 0 && (
          <div className="topbar-breadcrumb" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#71717a', fontSize: '0.8125rem' }}>
            {displayCrumbs.map((item, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {i > 0 && <span style={{ opacity: 0.3 }}>/</span>}
                <span style={{
                  color: i === displayCrumbs.length - 1 ? '#e4e4e7' : 'inherit',
                  fontWeight: i === displayCrumbs.length - 1 ? 500 : 400
                }}>
                  {item}
                </span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Live agent indicator */}
        {runningAgents > 0 && (
          <button
            onClick={() => navigate('/war-room')}
            title="Agenten aktiv — klicken für War Room"
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.3rem 0.75rem', borderRadius: '999px',
              background: 'rgba(35,205,202,0.12)', border: '1px solid rgba(35,205,202,0.45)',
              color: '#23CDCB', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
              boxShadow: '0 0 16px rgba(35,205,202,0.25)',
              animation: 'agentBadgePulse 2s ease-in-out infinite',
            }}>
            {/* Pulsing dot */}
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: '#23CDCB',
              boxShadow: '0 0 8px rgba(35,205,202,0.8)',
              animation: 'agentDotPulse 1s ease-in-out infinite',
              flexShrink: 0,
            }} />
            <Cpu size={12} />
            {runningAgents} {runningAgents === 1 ? 'Agent aktiv' : 'Agents aktiv'}
          </button>
        )}

        {/* Search */}
        <button
          onClick={onSearchClick}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            padding: '0.375rem 0.625rem',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: '8px',
            color: '#71717a',
            fontSize: '0.8125rem',
            cursor: 'text',
            width: '200px',
            transition: 'all 0.15s ease',
            textAlign: 'left',
          }}
          className="search-btn-hover"
        >
          <Search size={14} />
          <span style={{ flex: 1 }}>{i18n.t.actions.suchen}</span>
          <kbd style={{
            fontSize: '9px',
            padding: '1px 4px',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '4px',
            color: '#52525b',
            fontFamily: 'monospace'
          }}>
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>

        {/* Notification Bell */}
        <div ref={bellRef} style={{ position: 'relative' }}>
          <button
            className="btn btn-ghost"
            onClick={openBell}
            style={{
              position: 'relative',
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: bellOpen ? '#23CDCB' : (hasAgentEvents ? '#23CDCB' : unreadCount > 0 ? '#eab308' : '#71717a'),
              background: bellOpen ? 'rgba(35,205,202,0.08)' : 'transparent',
              border: bellOpen ? '1px solid rgba(35,205,202,0.2)' : '1px solid transparent',
              transition: 'all 0.2s',
            }}
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 7, right: 7,
                minWidth: 8, height: 8, borderRadius: '50%',
                background: '#ef4444', border: '2px solid #0a0a0f',
                boxShadow: '0 0 10px rgba(239, 68, 68, 0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.5rem', fontWeight: 800, color: '#fff',
              }}>
                {unreadCount > 9 ? '' : ''}
              </span>
            )}
          </button>

          {/* Dropdown */}
          {bellOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              width: 340,
              background: 'rgba(10, 10, 18, 0.97)',
              backdropFilter: 'blur(40px)',
              WebkitBackdropFilter: 'blur(40px)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '16px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
              zIndex: 500,
              overflow: 'hidden',
              animation: 'slideDown 0.2s ease',
            }}>
              {/* Header */}
              <div style={{
                padding: '0.875rem 1rem',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#f4f4f5' }}>
                  Notifications
                  {unreadCount > 0 && (
                    <span style={{
                      marginLeft: '0.5rem',
                      padding: '0.1rem 0.4rem',
                      background: 'rgba(35,205,202,0.15)',
                      border: '1px solid rgba(35,205,202,0.3)',
                      borderRadius: '999px',
                      fontSize: '0.6875rem',
                      color: '#23CDCB',
                    }}>
                      {unreadCount} new
                    </span>
                  )}
                </span>
                {notifications.length > 0 && (
                  <button
                    onClick={clearAll}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: '0.75rem', color: '#52525b',
                      padding: '0.25rem 0.5rem', borderRadius: 6,
                      transition: 'color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
                  >
                    Clear all
                  </button>
                )}
              </div>

              {/* Notification list */}
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {recent.length === 0 ? (
                  <div style={{
                    padding: '3rem 1rem', textAlign: 'center',
                    color: '#52525b', fontSize: '0.875rem',
                  }}>
                    <Bell size={28} style={{ margin: '0 auto 0.625rem', display: 'block', opacity: 0.3 }} />
                    All quiet — agents are standing by
                  </div>
                ) : (
                  recent.map(n => {
                    const cfg = TYPE_CONFIG[n.type];
                    return (
                      <div
                        key={n.id}
                        style={{
                          padding: '0.75rem 1rem',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          display: 'flex', gap: '0.625rem', alignItems: 'flex-start',
                          cursor: n.link ? 'pointer' : 'default',
                          background: n.read ? 'transparent' : 'rgba(255,255,255,0.015)',
                          transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = n.read ? 'transparent' : 'rgba(255,255,255,0.015)'; }}
                        onClick={() => {
                          if (n.link) { navigate(n.link); setBellOpen(false); }
                        }}
                      >
                        {/* Icon */}
                        <div style={{
                          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                          background: cfg.color + '18',
                          color: cfg.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {cfg.icon}
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.375rem' }}>
                            <span style={{ fontSize: '0.8125rem', fontWeight: n.read ? 500 : 700, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {n.title}
                            </span>
                            {!n.read && (
                              <span style={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: '#23CDCB', flexShrink: 0,
                              }} />
                            )}
                          </div>
                          {n.body && (
                            <div style={{ fontSize: '0.75rem', color: '#71717a', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {n.body}
                            </div>
                          )}
                          <div style={{ fontSize: '0.6875rem', color: '#3f3f46', marginTop: 3 }}>
                            {timeAgo(n.at)}
                          </div>
                        </div>

                        {/* Dismiss */}
                        <button
                          onClick={e => { e.stopPropagation(); dismissNotif(n.id); }}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#3f3f46', padding: 2, flexShrink: 0,
                            display: 'flex', alignItems: 'center',
                            opacity: 0, transition: 'opacity 0.15s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                          className="notif-dismiss"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer */}
              {notifications.length > 0 && (
                <div style={{
                  padding: '0.625rem 1rem',
                  borderTop: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', justifyContent: 'center',
                }}>
                  <button
                    onClick={() => { navigate('/activity'); setBellOpen(false); }}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontSize: '0.75rem', color: '#52525b',
                      display: 'flex', alignItems: 'center', gap: '0.25rem',
                      transition: 'color 0.2s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#23CDCB'}
                    onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
                  >
                    View all activity <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <style dangerouslySetInnerHTML={{
        __html: `
        .search-btn-hover:hover {
          background: rgba(255, 255, 255, 0.08) !important;
          border-color: rgba(35, 205, 202, 0.3) !important;
          color: #d4d4d8 !important;
        }
        .notif-dismiss:hover { opacity: 1 !important; color: #ef4444 !important; }
        div:hover .notif-dismiss { opacity: 0.6 !important; }
        @keyframes agentBadgePulse {
          0%, 100% { box-shadow: 0 0 12px rgba(35,205,202,0.2); border-color: rgba(35,205,202,0.4); }
          50% { box-shadow: 0 0 24px rgba(35,205,202,0.5); border-color: rgba(35,205,202,0.75); }
        }
        @keyframes agentDotPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.75); }
        }
      `}} />
    </header>
  );
}
