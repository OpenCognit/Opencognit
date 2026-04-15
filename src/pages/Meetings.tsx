import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Users, Clock, CheckCircle2, Loader2, MessageSquare,
  ChevronDown, ChevronUp, Search, X, Send,
  Plus, Check, ListTodo, AtSign, Eye, BarChart2, Trash2,
} from 'lucide-react';
import { authFetch } from '../utils/api';
import { useCompany } from '../hooks/useCompany';
import { useTranslation } from '../i18n/index';
import { PageHelp } from '../components/PageHelp';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Teilnehmer {
  id: string;
  name: string;
  avatarFarbe: string;
  hatGeantwortet: boolean;
  antwort: string | null;
  isBoard?: boolean;
  modellLabel?: string;
}

interface Meeting {
  id: string;
  titel: string;
  status: 'running' | 'completed' | 'cancelled';
  erstelltAm: string;
  abgeschlossenAm: string | null;
  ergebnis: string | null;
  veranstalter: { id: string; name: string; avatarFarbe: string } | null;
  teilnehmer: Teilnehmer[];
}

// ── Demo data ─────────────────────────────────────────────────────────────────

function makeDemoMeetings(m: ReturnType<typeof useTranslation>['t']['meetings']): Meeting[] {
  return [
    {
      id: 'demo-1',
      titel: 'How should we approach the API migration?',
      status: 'running',
      erstelltAm: new Date(Date.now() - 4 * 60000).toISOString(),
      abgeschlossenAm: null,
      ergebnis: null,
      veranstalter: { id: 'ceo', name: 'CEO', avatarFarbe: '#23CDCB' },
      teilnehmer: [
        {
          id: 't1', name: 'Alex Dev', avatarFarbe: '#6366f1', hatGeantwortet: true,
          antwort: "I'd start with a Strangler Fig pattern — keep old endpoints running in parallel, introduce new ones gradually. No big bang, easy to roll back.",
        },
        {
          id: 't2', name: 'Sara Ops', avatarFarbe: '#f59e0b', hatGeantwortet: true,
          antwort: "From the infra side: definitely use feature flags. I can adjust the CI/CD pipeline so we can switch between old/new API per flag without redeploying.",
        },
        {
          id: 't3', name: 'Max Backend', avatarFarbe: '#10b981', hatGeantwortet: false,
          antwort: null,
        },
      ],
    },
    {
      id: 'demo-2',
      titel: 'Sprint retrospective: what went wrong this week?',
      status: 'completed',
      erstelltAm: new Date(Date.now() - 2 * 60 * 60000).toISOString(),
      abgeschlossenAm: new Date(Date.now() - 90 * 60000).toISOString(),
      ergebnis: "The main problem was misaligned types between frontend and backend. Alex and Max will adopt a shared Zod schema as single source of truth starting next week. Sara will add an automated schema validator to the pipeline. Short check-in next Friday to see if it's working.",
      veranstalter: { id: 'ceo', name: 'CEO', avatarFarbe: '#23CDCB' },
      teilnehmer: [
        {
          id: 't1', name: 'Alex Dev', avatarFarbe: '#6366f1', hatGeantwortet: true,
          antwort: "API types didn't match the frontend. I lost 3h debugging until I realized the backend was sending snake_case and I expected camelCase.",
        },
        {
          id: 't2', name: 'Sara Ops', avatarFarbe: '#f59e0b', hatGeantwortet: true,
          antwort: "Deploy failed twice due to missing env variable mapping. Adding it to the pre-deploy checklist now.",
        },
        {
          id: 't3', name: 'Max Backend', avatarFarbe: '#10b981', hatGeantwortet: true,
          antwort: "I worked too long on the auth middleware without getting feedback. Next time I'll open a draft PR earlier.",
        },
      ],
    },
    {
      id: 'demo-3',
      titel: 'Do we need a dedicated QA agent?',
      status: 'completed',
      erstelltAm: new Date(Date.now() - 24 * 60 * 60000).toISOString(),
      abgeschlossenAm: new Date(Date.now() - 23 * 60 * 60000).toISOString(),
      ergebnis: "Team consensus: yes, a QA agent makes sense once we have >10 active tasks in parallel. I'll submit a hiring request. Until then, Alex handles manual testing for critical features.",
      veranstalter: { id: 'ceo', name: 'CEO', avatarFarbe: '#23CDCB' },
      teilnehmer: [
        {
          id: 't1', name: 'Alex Dev', avatarFarbe: '#6366f1', hatGeantwortet: true,
          antwort: "Definitely yes. I'm currently spending 30% of my time on manual testing which I shouldn't be doing.",
        },
        {
          id: 't2', name: 'Sara Ops', avatarFarbe: '#f59e0b', hatGeantwortet: true,
          antwort: "Cost-wise: only worth it at ~15 tasks/week. We're at 8 right now.",
        },
        {
          id: 't3', name: 'Max Backend', avatarFarbe: '#10b981', hatGeantwortet: true,
          antwort: "I'm in favor but would wait until we have a concrete QA backlog of 20+ items.",
        },
      ],
    },
  ];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Avatar({ name, farbe, size = 30 }: { name: string; farbe?: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: farbe || '#23CDCB',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.36, fontWeight: 700, color: '#0f111a',
      flexShrink: 0,
    }}>
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function StatusBadge({ status, m }: { status: Meeting['status']; m: ReturnType<typeof useTranslation>['t']['meetings'] }) {
  const cfg = {
    running:   { label: m.statusRunning,   color: '#23CDCB', bg: 'rgba(35,205,203,0.10)' },
    completed: { label: m.statusCompleted, color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
    cancelled: { label: m.statusCancelled, color: '#6b7280', bg: 'rgba(107,114,128,0.10)' },
  }[status];
  return (
    <span style={{
      padding: '3px 11px', borderRadius: 20, fontSize: 11.5, fontWeight: 600,
      color: cfg.color, background: cfg.bg, letterSpacing: '0.04em', flexShrink: 0,
    }}>
      {cfg.label}
    </span>
  );
}

function formatDate(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ── MeetingCard ───────────────────────────────────────────────────────────────

function MeetingCard({
  meeting, onCancel, onComplete, onDelete, m,
}: {
  meeting: Meeting;
  onCancel: (id: string) => void;
  onComplete: (id: string, titel: string) => void;
  onDelete: (id: string) => void;
  m: ReturnType<typeof useTranslation>['t']['meetings'];
}) {
  const { aktivesUnternehmen } = useCompany();
  const [expanded, setExpanded] = useState(meeting.status === 'running');
  const [msg, setMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [mentionMenu, setMentionMenu] = useState<{ open: boolean; query: string; agents: Teilnehmer[] }>({ open: false, query: '', agents: [] });
  const [creatingTask, setCreatingTask] = useState<string | null>(null); // agent id while creating
  const [typingAgents, setTypingAgents] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear typing timer on unmount to prevent state updates on unmounted component
  useEffect(() => () => { if (typingTimerRef.current) clearTimeout(typingTimerRef.current); }, []);

  const agentTeilnehmer = meeting.teilnehmer.filter(t => !t.isBoard);
  const answered = agentTeilnehmer.filter(t => t.hatGeantwortet).length;
  const total = agentTeilnehmer.length;
  const progress = total > 0 ? (answered / total) * 100 : 0;
  const isRunning = meeting.status === 'running';
  const boardEntry = meeting.teilnehmer.find(t => t.isBoard);
  const accentColor = isRunning ? '#23CDCB' : meeting.status === 'completed' ? '#10b981' : '#4b5563';

  // Remove agents from "typing" list once they've actually replied
  useEffect(() => {
    if (typingAgents.length === 0) return;
    const stillTyping = typingAgents.filter(id => !agentTeilnehmer.find(t => t.id === id)?.hatGeantwortet);
    if (stillTyping.length !== typingAgents.length) setTypingAgents(stillTyping);
  }, [meeting.teilnehmer]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendMessage() {
    if (!msg.trim() || sending || meeting.id.startsWith('demo')) return;
    setSending(true);
    // Detect which agents will be triggered
    const mentionMatches = [...msg.matchAll(/@([\w\s]+?)(?=\s|@|$)/g)].map(m => m[1].trim().toLowerCase());
    const toWake = mentionMatches.length > 0
      ? agentTeilnehmer.filter(t => mentionMatches.some(n => t.name.toLowerCase().includes(n)))
      : agentTeilnehmer.filter(t => !t.hatGeantwortet);
    try {
      const r = await authFetch(`/api/meetings/${meeting.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nachricht: msg.trim() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Fehler beim Senden');
      setMsg('');
      setMentionMenu({ open: false, query: '', agents: [] });
      if (toWake.length > 0) {
        setTypingAgents(toWake.map(a => a.id));
        if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
        typingTimerRef.current = setTimeout(() => setTypingAgents([]), 45000);
      }
    } catch (err: any) {
      console.error('[Meeting] sendMessage error:', err?.message);
    } finally {
      setSending(false);
    }
  }

  function handleMsgChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setMsg(val);
    const match = val.match(/@([\w\s]*)$/);
    if (match) {
      const query = match[1].toLowerCase();
      const filtered = agentTeilnehmer.filter(a => a.name.toLowerCase().includes(query));
      setMentionMenu({ open: filtered.length > 0, query, agents: filtered });
    } else if (mentionMenu.open) {
      setMentionMenu(prev => ({ ...prev, open: false }));
    }
  }

  function insertMention(agent: Teilnehmer) {
    const atIdx = msg.lastIndexOf('@');
    const newMsg = msg.slice(0, atIdx) + `@${agent.name} `;
    setMsg(newMsg);
    setMentionMenu({ open: false, query: '', agents: [] });
    inputRef.current?.focus();
  }

  async function createTaskFromAnswer(agent: Teilnehmer) {
    if (!aktivesUnternehmen || !agent.antwort || creatingTask) return;
    setCreatingTask(agent.id);
    try {
      const r = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/aufgaben`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titel: `${meeting.titel.slice(0, 70)} → ${agent.name}`,
          beschreibung: agent.antwort,
          zugewiesenAn: agent.id,
          prioritaet: 'medium',
        }),
      });
      if (!r.ok) throw new Error('Fehler beim Erstellen der Aufgabe');
    } catch (err: any) {
      console.error('[Meeting] createTask error:', err?.message);
    } finally {
      setCreatingTask(null);
    }
  }

  function handleKey(e: React.KeyboardEvent) {
    if (mentionMenu.open && e.key === 'Escape') { e.preventDefault(); setMentionMenu({ open: false, query: '', agents: [] }); return; }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  return (
    <div style={{
      borderRadius: '20px', overflow: 'hidden',
      backgroundColor: 'rgba(255,255,255,0.02)',
      border: `1px solid ${isRunning ? 'rgba(35,205,203,0.2)' : 'rgba(255,255,255,0.08)'}`,
      backdropFilter: 'blur(20px)',
      boxShadow: isRunning ? '0 4px 24px rgba(35,205,203,0.07)' : '0 4px 12px rgba(0,0,0,0.3)',
      transition: 'border-color 0.2s',
    }}>

      {/* ── Header ── */}
      <div
        style={{ padding: '16px 20px', display: 'flex', gap: 14, alignItems: 'flex-start', cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{
          width: 40, height: 40, borderRadius: 12, flexShrink: 0,
          background: isRunning ? 'rgba(35,205,203,0.10)' : 'rgba(255,255,255,0.04)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: accentColor,
        }}>
          {isRunning
            ? <Loader2 size={19} style={{ animation: 'spin 1.2s linear infinite' }} />
            : <MessageSquare size={19} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{
              fontWeight: 700, fontSize: 15, color: '#f1f5f9',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 460,
            }}>
              {meeting.titel}
            </span>
            <StatusBadge status={meeting.status} m={m} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: '#64748b', flexWrap: 'wrap' }}>
            {meeting.veranstalter && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Avatar name={meeting.veranstalter.name} farbe={meeting.veranstalter.avatarFarbe} size={16} />
                {meeting.veranstalter.name}
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={12} /> {formatDate(meeting.erstelltAm)}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Users size={12} /> {answered}/{total} {m.participants}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          {isRunning && !meeting.id.startsWith('demo') && (
            <>
              <button
                onClick={e => { e.stopPropagation(); onComplete(meeting.id, meeting.titel); }}
                style={{
                  background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                  color: '#10b981', borderRadius: 8, padding: '4px 12px', fontSize: 12,
                  cursor: 'pointer', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                <CheckCircle2 size={12} /> Abschließen
              </button>
              <button
                onClick={e => { e.stopPropagation(); onCancel(meeting.id); }}
                style={{
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.18)',
                  color: '#ef4444', borderRadius: 8, padding: '4px 12px', fontSize: 12,
                  cursor: 'pointer', fontWeight: 500,
                }}
              >
                {m.cancel}
              </button>
            </>
          )}
          {!isRunning && !meeting.id.startsWith('demo') && (
            <button
              onClick={e => { e.stopPropagation(); if (window.confirm(m.deleteConfirm)) onDelete(meeting.id); }}
              title={m.deleteMeeting}
              style={{
                background: 'none', border: 'none', color: '#475569',
                cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4,
                borderRadius: 6, transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
            >
              <Trash2 size={14} />
            </button>
          )}
          <div style={{ color: '#475569', display: 'flex' }}>
            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          </div>
        </div>
      </div>

      {/* ── Progress bar ── */}
      {isRunning && (
        <div style={{ height: 3, background: 'rgba(255,255,255,0.04)', margin: '0 20px' }}>
          <div style={{
            height: '100%', width: `${progress}%`,
            background: 'linear-gradient(90deg, rgba(35,205,203,0.4), #23CDCB)',
            borderRadius: '0 2px 2px 0', transition: 'width 0.6s ease',
          }} />
        </div>
      )}

      {/* ── Expanded body ── */}
      {expanded && (
        <div style={{ padding: '14px 20px 20px', borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 6 }}>

          {/* Agent answers */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {agentTeilnehmer.map(t => {
              const isTyping = typingAgents.includes(t.id) && !t.hatGeantwortet;
              return (
                <div key={t.id} style={{
                  borderRadius: '12px',
                  backgroundColor: t.hatGeantwortet
                    ? 'rgba(34,197,94,0.04)'
                    : isTyping ? 'rgba(35,205,203,0.03)' : 'rgba(255,255,255,0.01)',
                  border: `1px solid ${t.hatGeantwortet
                    ? 'rgba(34,197,94,0.12)'
                    : isTyping ? 'rgba(35,205,203,0.18)' : 'rgba(255,255,255,0.04)'}`,
                  padding: '0.75rem 1rem',
                  transition: 'border-color 0.3s, background-color 0.3s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: t.antwort ? 9 : 0 }}>
                    <Avatar name={t.name} farbe={t.avatarFarbe} size={26} />
                    <span style={{ fontWeight: 600, fontSize: 13.5, color: '#e2e8f0' }}>{t.name}</span>
                    {t.modellLabel && (
                      <span style={{
                        fontSize: 10.5, color: '#475569', fontWeight: 500,
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: 5, padding: '1px 6px', letterSpacing: '0.02em',
                      }}>
                        {t.modellLabel}
                      </span>
                    )}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {t.hatGeantwortet ? (
                        <>
                          {isRunning && (
                            <button
                              onClick={() => createTaskFromAnswer(t)}
                              disabled={!!creatingTask}
                              title="Als Aufgabe erstellen"
                              style={{
                                display: 'flex', alignItems: 'center', gap: 4,
                                background: creatingTask === t.id ? 'rgba(35,205,203,0.12)' : 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                color: creatingTask === t.id ? '#23CDCB' : '#64748b',
                                borderRadius: 7, padding: '3px 9px', fontSize: 11.5,
                                cursor: creatingTask ? 'default' : 'pointer',
                                fontWeight: 500, transition: 'all 0.15s',
                              }}
                            >
                              {creatingTask === t.id
                                ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Erstelle…</>
                                : <><ListTodo size={11} /> Task</>
                              }
                            </button>
                          )}
                          <CheckCircle2 size={15} color="#10b981" />
                        </>
                      ) : isTyping ? (
                        <span style={{ fontSize: 11.5, color: '#23CDCB', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Loader2 size={13} style={{ animation: 'spin 0.8s linear infinite' }} />
                          tippt…
                        </span>
                      ) : (
                        <span style={{ fontSize: 11.5, color: '#475569', display: 'flex', alignItems: 'center', gap: 5 }}>
                          <Loader2 size={13} style={{ animation: 'spin 1.2s linear infinite' }} />
                          {m.waitingLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  {t.antwort && (
                    <p style={{
                      margin: 0, fontSize: 13.5, color: 'rgba(148,163,184,0.9)',
                      lineHeight: 1.7, borderLeft: '2px solid rgba(16,185,129,0.3)',
                      paddingLeft: 12, marginLeft: 5,
                    }}>
                      {t.antwort}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Board's own entry (if already posted) */}
          {boardEntry?.antwort && (
            <div style={{
              marginTop: '0.625rem', borderRadius: '12px',
              backgroundColor: 'rgba(99,102,241,0.05)',
              border: '1px solid rgba(99,102,241,0.15)',
              padding: '0.75rem 1rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
                <Avatar name="DU" farbe="#6366f1" size={26} />
                <span style={{ fontWeight: 600, fontSize: 13.5, color: '#e2e8f0' }}>{m.boardName}</span>
                <CheckCircle2 size={15} color="#6366f1" style={{ marginLeft: 'auto' }} />
              </div>
              <p style={{
                margin: 0, fontSize: 13.5, color: 'rgba(148,163,184,0.9)',
                lineHeight: 1.7, borderLeft: '2px solid rgba(99,102,241,0.3)',
                paddingLeft: 12, marginLeft: 5,
              }}>
                {boardEntry.antwort}
              </p>
            </div>
          )}

          {/* ── Board chat input ── */}
          {isRunning && (
            <div style={{
              marginTop: '0.875rem',
              borderRadius: '12px',
              backgroundColor: 'rgba(255,255,255,0.01)',
              border: '1px solid rgba(255,255,255,0.06)',
              padding: '1rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <Avatar name="DU" farbe="#6366f1" size={30} />
                <div style={{ flex: 1, position: 'relative' }}>
                  {/* @mention dropdown */}
                  {mentionMenu.open && (
                    <div style={{
                      position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
                      background: 'rgba(15,17,30,0.98)', border: '1px solid rgba(35,205,203,0.3)',
                      borderRadius: 10, overflow: 'hidden', zIndex: 200,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                      minWidth: 180,
                    }}>
                      <div style={{ padding: '6px 10px 4px', fontSize: 10.5, color: '#23CDCB', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                        <AtSign size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                        Erwähnen
                      </div>
                      {mentionMenu.agents.map(a => (
                        <div
                          key={a.id}
                          onMouseDown={e => { e.preventDefault(); insertMention(a); }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '7px 12px', cursor: 'pointer',
                            borderTop: '1px solid rgba(255,255,255,0.04)',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(35,205,203,0.08)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <Avatar name={a.name} farbe={a.avatarFarbe} size={20} />
                          <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 500 }}>{a.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={inputRef}
                    value={msg}
                    onChange={handleMsgChange}
                    onKeyDown={handleKey}
                    placeholder={meeting.id.startsWith('demo') ? `${m.chatPlaceholder} (demo only)` : m.chatPlaceholder}
                    rows={2}
                    style={{
                      width: '100%', boxSizing: 'border-box',
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 8, color: '#e2e8f0', fontSize: 13.5, lineHeight: 1.6,
                      padding: '8px 12px', resize: 'none', outline: 'none',
                      fontFamily: 'inherit',
                    }}
                    disabled={sending || meeting.id.startsWith('demo')}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 7 }}>
                    <span style={{ fontSize: 11.5, color: '#334155' }}>
                      <AtSign size={10} style={{ verticalAlign: 'middle', opacity: 0.5 }} /> Agent erwähnen · {m.chatHint}
                    </span>
                    <button
                      onClick={sendMessage}
                      disabled={!msg.trim() || sending || meeting.id.startsWith('demo')}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: msg.trim() && !sending && !meeting.id.startsWith('demo')
                          ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${msg.trim() && !sending ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.07)'}`,
                        color: msg.trim() && !sending ? '#818cf8' : '#475569',
                        borderRadius: 8, padding: '6px 14px', fontSize: 12.5,
                        cursor: msg.trim() && !sending && !meeting.id.startsWith('demo') ? 'pointer' : 'default',
                        fontWeight: 600, transition: 'all 0.15s',
                      }}
                    >
                      {sending
                        ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> {m.chatSending}</>
                        : <><Send size={13} /> {m.chatSend}</>
                      }
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CEO synthesis */}
          {meeting.ergebnis ? (
            <div style={{
              marginTop: '0.875rem', borderRadius: '12px',
              backgroundColor: 'rgba(35,205,202,0.05)',
              border: '1px solid rgba(35,205,202,0.15)',
              padding: '1rem 1.25rem',
            }}>
              <div style={{
                fontSize: 10.5, fontWeight: 700, color: '#23CDCB',
                letterSpacing: '0.09em', marginBottom: 8,
              }}>
                {m.ceoSummary}
              </div>
              <p style={{ margin: 0, fontSize: 14, color: '#cbd5e1', lineHeight: 1.75 }}>
                {meeting.ergebnis}
              </p>
            </div>
          ) : meeting.status === 'completed' && (
            <div style={{
              marginTop: 14, borderRadius: 12,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.05)',
              padding: '12px 16px',
              color: '#475569', fontSize: 13, fontStyle: 'italic',
            }}>
              {m.pendingSummary}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Call Meeting Modal ────────────────────────────────────────────────────────

interface Agent { id: string; name: string; avatarFarbe: string; rolle?: string; status?: string; }

function CallMeetingModal({
  unternehmenId,
  onCreated,
  onClose,
  m,
}: {
  unternehmenId: string;
  onCreated: () => void;
  onClose: () => void;
  m: ReturnType<typeof useTranslation>['t']['meetings'];
}) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [titel, setTitel] = useState('');
  const [veranstalter, setVeranstalter] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    authFetch(`/api/unternehmen/${unternehmenId}/experten`)
      .then(r => r.json())
      .then((data: Agent[]) => {
        const active = data.filter(a => !['terminated', 'paused'].includes(a.status || ''));
        setAgents(active);
        if (active.length > 0) setVeranstalter(active[0].id);
      })
      .catch(() => {})
      .finally(() => setLoadingAgents(false));
  }, [unternehmenId]);

  const toggleAgent = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleCreate = async () => {
    if (!titel.trim()) { setErr('Bitte Thema eingeben'); return; }
    if (!veranstalter) { setErr('Bitte Veranstalter wählen'); return; }
    if (selected.length === 0) { setErr('Mindestens einen Teilnehmer wählen'); return; }
    setCreating(true); setErr('');
    try {
      const r = await authFetch(`/api/unternehmen/${unternehmenId}/meetings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titel: titel.trim(), veranstalterExpertId: veranstalter, teilnehmerIds: selected }),
      });
      if (!r.ok) { const d = await r.json(); setErr(d.error || 'Fehler'); setCreating(false); return; }
      onCreated();
    } catch (e: any) {
      setErr(e.message || 'Fehler');
      setCreating(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 520, borderRadius: '20px',
        background: 'rgba(15,17,30,0.97)', border: '1px solid rgba(255,255,255,0.1)',
        padding: '1.75rem', boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>
            Meeting einberufen
          </h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', display: 'flex' }}>
            <X size={18} />
          </button>
        </div>

        {/* Topic */}
        <label style={{ display: 'block', marginBottom: '1.25rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.375rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Thema / Frage
          </span>
          <textarea
            value={titel}
            onChange={e => setTitel(e.target.value)}
            placeholder="z.B. Wie sollen wir die API-Migration angehen?"
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '0.75rem',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', color: '#f1f5f9', fontSize: '0.9375rem', resize: 'vertical',
              fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
            }}
          />
        </label>

        {/* Organizer */}
        <label style={{ display: 'block', marginBottom: '1.25rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.375rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Veranstalter
          </span>
          <select
            value={veranstalter}
            onChange={e => setVeranstalter(e.target.value)}
            style={{
              width: '100%', padding: '0.625rem 0.75rem',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', color: '#f1f5f9', fontSize: '0.875rem',
              fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
            }}
          >
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.rolle ? ` (${a.rolle})` : ''}</option>)}
          </select>
        </label>

        {/* Participants */}
        <div style={{ marginBottom: '1.25rem' }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.5rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            Teilnehmer ({selected.length} gewählt)
          </span>
          {loadingAgents ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
              <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: '#23CDCB' }} />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', maxHeight: 200, overflow: 'auto' }}>
              {agents.filter(a => a.id !== veranstalter).map(a => {
                const isSelected = selected.includes(a.id);
                return (
                  <div
                    key={a.id}
                    onClick={() => toggleAgent(a.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.5rem 0.75rem', borderRadius: '10px', cursor: 'pointer',
                      background: isSelected ? 'rgba(35,205,202,0.06)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${isSelected ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.06)'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: '8px', flexShrink: 0,
                      background: a.avatarFarbe + '20', border: `1px solid ${a.avatarFarbe}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.6875rem', fontWeight: 700, color: a.avatarFarbe,
                    }}>
                      {a.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e2e8f0' }}>{a.name}</div>
                      {a.rolle && <div style={{ fontSize: '0.6875rem', color: '#475569' }}>{a.rolle}</div>}
                    </div>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      background: isSelected ? '#23CDCB' : 'rgba(255,255,255,0.06)',
                      border: `1px solid ${isSelected ? '#23CDCB' : 'rgba(255,255,255,0.12)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {isSelected && <Check size={10} color="#0a0a0f" />}
                    </div>
                  </div>
                );
              })}
              {agents.filter(a => a.id !== veranstalter).length === 0 && (
                <p style={{ color: '#475569', fontSize: '0.8125rem', textAlign: 'center', padding: '1rem 0' }}>
                  Keine weiteren aktiven Agenten verfügbar
                </p>
              )}
            </div>
          )}
        </div>

        {err && (
          <p style={{ fontSize: '0.8125rem', color: '#ef4444', marginBottom: '0.75rem', padding: '0.5rem 0.75rem', background: 'rgba(239,68,68,0.08)', borderRadius: '8px' }}>
            {err}
          </p>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '0.625rem 1.25rem', borderRadius: '10px', cursor: 'pointer', fontSize: '0.875rem',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b',
          }}>
            Abbrechen
          </button>
          <button onClick={handleCreate} disabled={creating} style={{
            padding: '0.625rem 1.25rem', borderRadius: '10px', cursor: creating ? 'wait' : 'pointer',
            fontSize: '0.875rem', fontWeight: 700,
            background: creating ? 'rgba(35,205,202,0.08)' : 'rgba(35,205,202,0.1)',
            border: '1px solid rgba(35,205,202,0.3)', color: '#23CDCB',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            {creating
              ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Wird erstellt…</>
              : <><Plus size={14} /> Meeting starten</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Complete Meeting Modal ─────────────────────────────────────────────────────

function CompleteModal({
  meetingId,
  titel,
  onCompleted,
  onClose,
}: {
  meetingId: string;
  titel: string;
  onCompleted: () => void;
  onClose: () => void;
}) {
  const [ergebnis, setErgebnis] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const r = await authFetch(`/api/meetings/${meetingId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ergebnis }),
      });
      if (!r.ok) throw new Error('Fehler beim Abschließen');
      onCompleted();
    } catch (err: any) {
      console.error('[Meeting] complete error:', err?.message);
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9998,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem',
    }} onClick={onClose}>
      <div style={{
        width: '100%', maxWidth: 480, borderRadius: '20px',
        background: 'rgba(15,17,30,0.97)', border: '1px solid rgba(255,255,255,0.1)',
        padding: '1.75rem', boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9', margin: 0 }}>Meeting abschließen</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', display: 'flex' }}><X size={16} /></button>
        </div>
        <p style={{ fontSize: '0.8125rem', color: '#64748b', marginBottom: '1rem' }}>
          <em>"{titel}"</em>
        </p>
        <label>
          <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', display: 'block', marginBottom: '0.375rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            CEO-Synthese / Ergebnis (optional)
          </span>
          <textarea
            value={ergebnis}
            onChange={e => setErgebnis(e.target.value)}
            placeholder="Fasst die Diskussion zusammen und gibt eine Entscheidung oder nächste Schritte vor…"
            rows={4}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '0.75rem',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', color: '#f1f5f9', fontSize: '0.875rem', resize: 'vertical',
              fontFamily: 'inherit', outline: 'none', lineHeight: 1.5,
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1.25rem' }}>
          <button onClick={onClose} style={{ padding: '0.625rem 1.25rem', borderRadius: '10px', cursor: 'pointer', fontSize: '0.875rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b' }}>
            Abbrechen
          </button>
          <button onClick={save} disabled={saving} style={{
            padding: '0.625rem 1.25rem', borderRadius: '10px', cursor: saving ? 'wait' : 'pointer',
            fontSize: '0.875rem', fontWeight: 700,
            background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981',
            display: 'flex', alignItems: 'center', gap: '0.5rem',
          }}>
            {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={13} />}
            {saving ? 'Wird gespeichert…' : 'Abschließen'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function StatsBar({ meetings, m }: { meetings: Meeting[]; m: ReturnType<typeof useTranslation>['t']['meetings'] }) {
  const total     = meetings.length;
  const running   = meetings.filter(x => x.status === 'running').length;
  const completed = meetings.filter(x => x.status === 'completed').length;
  const thisWeek  = meetings.filter(x => Date.now() - new Date(x.erstelltAm).getTime() < 7 * 864e5).length;

  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 28, flexWrap: 'wrap' }}>
      {[
        { label: m.statTotal,     value: total,     color: '#64748b' },
        { label: m.statActive,    value: running,   color: '#23CDCB' },
        { label: m.statCompleted, value: completed, color: '#10b981' },
        { label: m.statThisWeek,  value: thisWeek,  color: '#6366f1' },
      ].map(s => (
        <div key={s.label} style={{
          borderRadius: '12px',
          backgroundColor: 'rgba(255,255,255,0.02)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.08)',
          padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: 3,
          minWidth: 100,
        }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</span>
          <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Meetings() {
  const { aktivesUnternehmen } = useCompany();
  const { t, language } = useTranslation();
  const m = t.meetings;

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'completed' | 'cancelled'>('all');
  const [showDemo, setShowDemo] = useState(false);
  const [showCallModal, setShowCallModal] = useState(false);
  const [completeTarget, setCompleteTarget] = useState<{ id: string; titel: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const DEMO_MEETINGS = makeDemoMeetings(m);
  const displayMeetings = showDemo ? DEMO_MEETINGS : meetings;

  const fetchMeetings = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    try {
      const r = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/meetings`);
      const data = await r.json();
      if (Array.isArray(data)) setMeetings(data);
    } catch {}
    setLoading(false);
  }, [aktivesUnternehmen?.id]);

  const cancelMeeting = async (id: string) => {
    await authFetch(`/api/meetings/${id}/cancel`, { method: 'POST' }).catch(() => {});
    fetchMeetings();
  };

  const deleteMeeting = async (id: string) => {
    await authFetch(`/api/meetings/${id}`, { method: 'DELETE' }).catch(() => {});
    setMeetings(prev => prev.filter(x => x.id !== id));
  };

  const clearArchive = async () => {
    if (!window.confirm(m.deleteArchiveConfirm)) return;
    const archived = meetings.filter(x => x.status !== 'running');
    await Promise.all(archived.map(x => authFetch(`/api/meetings/${x.id}`, { method: 'DELETE' }).catch(() => {})));
    setMeetings(prev => prev.filter(x => x.status === 'running'));
  };

  useEffect(() => { fetchMeetings(); }, [fetchMeetings]);

  useEffect(() => {
    if (!aktivesUnternehmen) return;
    const _mTok = localStorage.getItem('opencognit_token') || '';
    const wsUrl = (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host + '/ws' + (_mTok ? `?token=${_mTok}` : '');
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.data?.unternehmenId !== aktivesUnternehmen.id) return;
        if (msg.type === 'meeting_created' || msg.type === 'meeting_updated') fetchMeetings();
      } catch {}
    };
    return () => { ws.close(); wsRef.current = null; };
  }, [aktivesUnternehmen?.id, fetchMeetings]);

  const filtered = displayMeetings.filter(x => {
    if (filter !== 'all' && x.status !== filter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      x.titel.toLowerCase().includes(q) ||
      x.veranstalter?.name.toLowerCase().includes(q) ||
      x.teilnehmer.some(p => p.name.toLowerCase().includes(q)) ||
      x.ergebnis?.toLowerCase().includes(q)
    );
  });

  const running = filtered.filter(x => x.status === 'running');
  const done    = filtered.filter(x => x.status !== 'running');

  if (!aktivesUnternehmen) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
      Please select a company.
    </div>
  );

  return (
    <div>

      {/* Header */}
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{
            fontSize: 28, fontWeight: 800, margin: 0,
            background: 'linear-gradient(135deg, #23CDCB, #6366f1)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            {m.title}
          </h1>
          <p style={{ marginTop: 6, color: '#475569', fontSize: 14 }}>
            {m.subtitle}
          </p>
        </div>
        <button
          onClick={() => setShowCallModal(true)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '0.625rem 1.125rem', borderRadius: '12px',
            background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.25)',
            color: '#23CDCB', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer',
          }}
        >
          <Plus size={15} /> Meeting einberufen
        </button>
      </div>

      <PageHelp id="meetings" lang={language} />

      {!loading && displayMeetings.length > 0 && <StatsBar meetings={displayMeetings} m={m} />}

      {/* Search + filter */}
      {!loading && displayMeetings.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#475569', pointerEvents: 'none' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={m.searchPlaceholder}
              style={{
                width: '100%', boxSizing: 'border-box',
                paddingLeft: '2.25rem', paddingRight: search ? '2.25rem' : '0.875rem',
                paddingTop: '0.5625rem', paddingBottom: '0.5625rem',
                backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '10px', color: '#f8fafc', fontSize: '0.875rem', outline: 'none',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex',
              }}>
                <X size={13} />
              </button>
            )}
          </div>

          {([
            ['all', m.filterAll], ['running', m.filterActive],
            ['completed', m.filterDone], ['cancelled', m.filterCancelled],
          ] as const).map(([f, label]) => {
            const active = filter === f;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '0.4375rem 1rem', borderRadius: '9999px', fontSize: '0.8125rem', fontWeight: 600,
                  border: `1px solid ${active ? '#23CDCB' : 'rgba(255,255,255,0.08)'}`,
                  backgroundColor: active ? 'rgba(35,205,202,0.1)' : 'rgba(255,255,255,0.02)',
                  color: active ? '#23CDCB' : '#64748b',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Demo banner */}
      {showDemo && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)',
          borderRadius: '10px', padding: '0.625rem 1.125rem', marginBottom: '1.25rem', gap: '0.625rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Eye size={14} color="#6366f1" />
            <span style={{ fontSize: 13, color: '#a5b4fc', fontWeight: 500 }}>{m.demoBanner}</span>
          </div>
          <button
            onClick={() => setShowDemo(false)}
            style={{
              background: 'none', border: '1px solid rgba(99,102,241,0.3)',
              color: '#6366f1', borderRadius: 7, padding: '4px 12px',
              fontSize: 12, cursor: 'pointer', fontWeight: 500,
            }}
          >
            {m.demoClose}
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
          <Loader2 size={30} color="#23CDCB" style={{ animation: 'spin 1s linear infinite' }} />
        </div>
      ) : meetings.length === 0 && !showDemo ? (
        <div style={{
          textAlign: 'center', padding: '4rem 2rem',
          borderRadius: '20px', border: '1px dashed rgba(255,255,255,0.07)',
          backgroundColor: 'rgba(255,255,255,0.01)',
        }}>
          <MessageSquare size={44} color="rgba(35,205,203,0.22)" style={{ marginBottom: 16 }} />
          <p style={{ color: '#475569', fontSize: 15, margin: 0, fontWeight: 600 }}>{m.noMeetings}</p>
          <p style={{ color: '#334155', fontSize: 13, marginTop: 8, maxWidth: 380, margin: '8px auto 0' }}>
            {m.noMeetingsHint}
          </p>
          <button
            onClick={() => setShowDemo(true)}
            style={{
              marginTop: 22, display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
              color: '#818cf8', borderRadius: 10, padding: '9px 20px',
              fontSize: 13, cursor: 'pointer', fontWeight: 600,
            }}
          >
            <Eye size={15} /> {m.noMeetingsDemo}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px 20px', color: '#475569', fontSize: 14 }}>
          {m.noResults}
        </div>
      ) : (
        <>
          {running.length > 0 && (
            <section style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <Loader2 size={14} color="#23CDCB" style={{ animation: 'spin 1.2s linear infinite' }} />
                <span style={{ fontWeight: 700, fontSize: 12, color: '#23CDCB', letterSpacing: '0.07em' }}>
                  {m.sectionActive} ({running.length})
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {running.map(x => <MeetingCard key={x.id} meeting={x} onCancel={cancelMeeting} onComplete={(id, titel) => setCompleteTarget({ id, titel })} onDelete={() => {}} m={m} />)}
              </div>
            </section>
          )}

          {done.length > 0 && (
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <BarChart2 size={14} color="#475569" />
                <span style={{ fontWeight: 700, fontSize: 12, color: '#475569', letterSpacing: '0.07em' }}>
                  {m.sectionArchive} ({done.length})
                </span>
                {!showDemo && (
                  <button
                    onClick={clearArchive}
                    title={m.deleteArchive}
                    style={{
                      marginLeft: 'auto', background: 'none', border: 'none',
                      color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center',
                      gap: 5, fontSize: 11, fontWeight: 600, padding: '2px 8px',
                      borderRadius: 6, transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                  >
                    <Trash2 size={12} /> {m.deleteArchive}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {done.map(x => <MeetingCard key={x.id} meeting={x} onCancel={cancelMeeting} onComplete={() => {}} onDelete={deleteMeeting} m={m} />)}
              </div>
            </section>
          )}
        </>
      )}

      {showCallModal && aktivesUnternehmen && (
        <CallMeetingModal
          unternehmenId={aktivesUnternehmen.id}
          onCreated={() => { setShowCallModal(false); fetchMeetings(); }}
          onClose={() => setShowCallModal(false)}
          m={m}
        />
      )}

      {completeTarget && (
        <CompleteModal
          meetingId={completeTarget.id}
          titel={completeTarget.titel}
          onCompleted={() => { setCompleteTarget(null); fetchMeetings(); }}
          onClose={() => setCompleteTarget(null)}
        />
      )}

      <style>{`
        textarea::placeholder, input::placeholder { color: #475569; }
        textarea:focus { border-color: rgba(99,102,241,0.4) !important; }
      `}</style>
    </div>
  );
}
