import { useState, useRef, useCallback, useEffect } from 'react';
import { MessageSquare, X, Send, Sparkles, Loader2, ChevronDown } from 'lucide-react';
import { authFetch } from '../utils/api';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  source?: 'ai' | 'template';
}

const SUGGESTIONS_DE = [
  'Was blockiert uns gerade?',
  'Welche Agenten sind aktiv?',
  'Was wurde heute erledigt?',
  'Wie hoch sind die Kosten?',
];

const SUGGESTIONS_EN = [
  "What's blocking us?",
  'Which agents are active?',
  "What was done today?",
  "How are our costs?",
];

// ─── Main Component ───────────────────────────────────────────────────────────

export function WorkspaceAssistant() {
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const isDE = language === 'de';

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const suggestions = isDE ? SUGGESTIONS_DE : SUGGESTIONS_EN;

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      if (messages.length === 0) {
        // Welcome message
        setMessages([{
          id: 'welcome',
          role: 'assistant',
          text: isDE
            ? `Hallo! Ich bin dein OpenCognit-Assistent. Frag mich alles über deinen Workspace — Agenten, Tasks, Kosten, Ziele oder was du gerade wissen möchtest.`
            : `Hi! I'm your OpenCognit assistant. Ask me anything about your workspace — agents, tasks, costs, goals, or whatever's on your mind.`,
          source: 'template',
        }]);
      }
    }
  }, [open]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const ask = useCallback(async (question: string) => {
    if (!question.trim() || !aktivesUnternehmen || loading) return;

    const userMsg: Message = { id: Date.now().toString(), role: 'user', text: question.trim() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/ask`, {
        method: 'POST',
        body: JSON.stringify({ question: question.trim(), language }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '-a',
        role: 'assistant',
        text: data.answer || (isDE ? 'Keine Antwort erhalten.' : 'No answer received.'),
        source: data.source,
      }]);
    } catch {
      setMessages(prev => [...prev, {
        id: Date.now().toString() + '-e',
        role: 'assistant',
        text: isDE ? 'Entschuldigung, ich konnte die Anfrage nicht bearbeiten.' : 'Sorry, I could not process that.',
        source: 'template',
      }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [aktivesUnternehmen?.id, language, loading]);

  if (!aktivesUnternehmen) return null;

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          position: 'fixed', bottom: '1.5rem', right: '1.5rem',
          width: 52, height: 52, borderRadius: '50%',
          background: open ? 'rgba(35,205,202,0.2)' : 'rgba(35,205,202,0.12)',
          border: '1px solid rgba(35,205,202,0.4)',
          boxShadow: `0 8px 32px rgba(35,205,202,0.25)${open ? ', 0 0 0 4px rgba(35,205,202,0.08)' : ''}`,
          color: '#23CDCB',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9000,
          transition: 'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',
          transform: open ? 'scale(0.92)' : 'scale(1)',
        }}
        title={isDE ? 'KI-Assistent' : 'AI Assistant'}
      >
        {open ? <ChevronDown size={22} /> : <MessageSquare size={22} />}
      </button>

      {/* Chat Popup */}
      {open && (
        <div
          style={{
            position: 'fixed', bottom: '5.5rem', right: '1.5rem',
            width: 340, maxHeight: 480,
            background: 'rgba(10,10,18,0.98)',
            backdropFilter: 'blur(40px)',
            WebkitBackdropFilter: 'blur(40px)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 18,
            boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)',
            display: 'flex', flexDirection: 'column',
            zIndex: 9000,
            animation: 'assistantPop 0.25s cubic-bezier(0.34,1.56,0.64,1)',
            overflow: 'hidden',
          }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{
            padding: '0.875rem 1rem',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', alignItems: 'center', gap: '0.625rem',
            flexShrink: 0,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 9,
              background: 'rgba(35,205,202,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#23CDCB',
            }}>
              <Sparkles size={14} />
            </div>
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 800, color: '#f4f4f5' }}>
                {isDE ? 'OpenCognit Assistent' : 'OpenCognit Assistant'}
              </div>
              <div style={{ fontSize: '0.625rem', color: '#52525b' }}>
                {isDE ? 'Frag mich alles über deinen Workspace' : 'Ask me anything about your workspace'}
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#52525b', padding: 4, display: 'flex' }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {messages.map(msg => (
              <div key={msg.id} style={{
                display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                gap: '0.5rem', alignItems: 'flex-end',
              }}>
                {msg.role === 'assistant' && (
                  <div style={{
                    width: 22, height: 22, borderRadius: 7, flexShrink: 0,
                    background: 'rgba(35,205,202,0.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#23CDCB',
                  }}>
                    <Sparkles size={11} />
                  </div>
                )}
                <div style={{
                  maxWidth: '85%',
                  padding: '0.5rem 0.75rem',
                  borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                  background: msg.role === 'user' ? 'rgba(35,205,202,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${msg.role === 'user' ? 'rgba(35,205,202,0.25)' : 'rgba(255,255,255,0.06)'}`,
                  fontSize: '0.8125rem',
                  color: msg.role === 'user' ? '#23CDCB' : '#d4d4d8',
                  lineHeight: 1.5,
                }}>
                  {msg.text}
                  {msg.source === 'ai' && msg.role === 'assistant' && (
                    <span style={{
                      display: 'block', fontSize: '0.5625rem', color: '#23CDCB',
                      marginTop: 3, letterSpacing: '0.05em',
                    }}>✦ AI</span>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                <div style={{ width: 22, height: 22, borderRadius: 7, background: 'rgba(35,205,202,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#23CDCB', flexShrink: 0 }}>
                  <Sparkles size={11} />
                </div>
                <div style={{
                  padding: '0.5rem 0.875rem', borderRadius: '14px 14px 14px 4px',
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
                  display: 'flex', gap: 4, alignItems: 'center',
                }}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 5, height: 5, borderRadius: '50%', background: '#23CDCB',
                      animation: `typingDot 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Suggestions (only when no messages yet besides welcome) */}
          {messages.length <= 1 && (
            <div style={{ padding: '0 0.75rem', display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  style={{
                    padding: '0.25rem 0.625rem', borderRadius: 999,
                    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                    color: '#71717a', cursor: 'pointer', fontSize: '0.6875rem',
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(35,205,202,0.3)'; e.currentTarget.style.color = '#23CDCB'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#71717a'; }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{
            padding: '0.625rem',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex', gap: '0.5rem',
            flexShrink: 0,
          }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && !loading && ask(input)}
              placeholder={isDE ? 'Frage stellen…' : 'Ask anything…'}
              style={{
                flex: 1, padding: '0.5rem 0.75rem',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10, fontSize: '0.8125rem', color: '#f4f4f5',
                outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = 'rgba(35,205,202,0.35)'}
              onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
            />
            <button
              onClick={() => ask(input)}
              disabled={!input.trim() || loading}
              style={{
                width: 36, height: 36, borderRadius: 10, border: 'none',
                background: input.trim() && !loading ? 'rgba(35,205,202,0.15)' : 'rgba(255,255,255,0.04)',
                color: input.trim() && !loading ? '#23CDCB' : '#3f3f46',
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.15s', flexShrink: 0,
              }}
            >
              {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
            </button>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes assistantPop {
          from { opacity: 0; transform: scale(0.9) translateY(16px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes typingDot {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-4px); opacity: 1; }
        }
      ` }} />
    </>
  );
}
