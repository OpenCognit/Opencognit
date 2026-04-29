import { useState, useEffect, useRef, useCallback, useTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send, ChevronDown, User, Loader2, AlertCircle,
  Brain, ChevronRight, Paperclip, X, ImageIcon,
  Plus, History, Trash2, Sparkles, FileText, Copy
} from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';

/* ─── Pure inline styles ─ no tailwind dependency for visuals ─────────── */

const C = {
  bg: '#0a0a0a',
  surface: 'rgba(255,255,255,0.03)',
  surfaceHover: 'rgba(255,255,255,0.06)',
  border: 'rgba(255,255,255,0.06)',
  borderHover: 'rgba(255,255,255,0.12)',
  gold: '#c5a059',
  goldDim: 'rgba(197,160,89,0.15)',
  goldGlow: 'rgba(197,160,89,0.25)',
  text: '#e8e4dc',
  textMuted: '#7a7268',
  textDim: '#3a342c',
  success: '#7cb97a',
  white: '#ffffff',
};

const round = (r: number) => ({ borderRadius: r });
const flex = (dir: 'row' | 'column' = 'row', opts?: { center?: boolean; between?: boolean; end?: boolean; wrap?: boolean }) => ({
  display: 'flex', flexDirection: dir,
  ...(opts?.center ? { alignItems: 'center', justifyContent: 'center' } : {}),
  ...(opts?.between ? { alignItems: 'center', justifyContent: 'space-between' } : {}),
  ...(opts?.end ? { alignItems: 'flex-end' } : {}),
  ...(opts?.wrap ? { flexWrap: 'wrap' as const } : {}),
});

// ── helpers ───────────────────────────────────────────────────────────────────

function authHeaders(extra: Record<string, string> = {}) {
  const token = localStorage.getItem('opencognit_token');
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString('en-US', { weekday: 'long' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const STORAGE_KEY = 'opencognit_chat_sessions';

function loadSessions(agentId: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as Record<string, ChatSession[]>)[agentId] ?? [];
  } catch { return []; }
}

function saveSessions(agentId: string, sessions: ChatSession[]) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const all = raw ? JSON.parse(raw) as Record<string, ChatSession[]> : {};
    all[agentId] = sessions.slice(0, 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch { /* quota */ }
}

// ── types ─────────────────────────────────────────────────────────────────────

interface Agent {
  id: string; name: string; rolle: string;
  avatar: string; avatarFarbe: string;
  isOrchestrator?: boolean; status: string;
}

interface PendingImage {
  data: string; mimeType: string; name: string; previewUrl: string;
}

interface Message {
  id: string; role: 'user' | 'agent' | 'system';
  text: string; thinking?: string;
  images?: string[]; streaming?: boolean; time: string;
}

interface ChatSession {
  id: string; title: string; createdAt: string; messages: Message[];
}

interface Cmd {
  icon: React.ReactNode; label: string; desc: string; prefix: string;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Dots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginLeft: 6, gap: 3 }}>
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          style={{ width: 5, height: 5, borderRadius: 9999, background: C.gold }}
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

function ThinkingBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8, border: `1px solid ${C.goldDim}`, background: 'rgba(197,160,89,0.02)', ...round(10) }}>
      <button onClick={() => setOpen(!open)} style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', color: C.gold, cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
        <Brain size={12} />
        <span>{streaming ? 'Thinking…' : 'Chain of thought'}</span>
        {streaming && <motion.span style={{ width: 6, height: 6, borderRadius: 9999, background: C.gold, marginLeft: 4 }} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }} />}
        <ChevronRight size={12} style={{ marginLeft: 'auto', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div style={{ padding: '8px 14px', borderTop: `1px solid ${C.goldDim}`, fontSize: 12, color: C.textMuted, fontFamily: 'var(--font-mono)', lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 300, overflowY: 'auto' }}>
          {text}
        </div>
      )}
    </div>
  );
}

// ── FileCard: rendered inline for [FILE]path[/FILE] markers ───────────────────

function FileCard({ relPath, unternehmenId }: { relPath: string; unternehmenId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ content: string; size: number; binary: boolean; absPath: string } | null>(null);
  const [err, setErr] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (data || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(relPath)}`, {
        headers: authHeaders({ 'x-unternehmen-id': unternehmenId }),
      });
      const j = await res.json();
      if (!res.ok) setErr(j.error || 'error');
      else setData(j);
    } catch { setErr('network'); }
    finally { setLoading(false); }
  };

  const toggle = () => { if (!open) load(); setOpen(!open); };
  const fmtSize = (n: number) => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n/1024).toFixed(1)} KB` : `${(n/1024/1024).toFixed(2)} MB`;
  const copyPath = (e: React.MouseEvent) => { e.stopPropagation(); navigator.clipboard.writeText(data?.absPath || relPath); };

  return (
    <div style={{ margin: '10px 0', border: `1px solid ${C.goldDim}`, background: 'rgba(197,160,89,0.03)', ...round(10), overflow: 'hidden' }}>
      <button onClick={toggle} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', background: 'transparent', border: 'none', color: C.text, cursor: 'pointer', fontSize: 13, textAlign: 'left' }}>
        <FileText size={14} style={{ color: C.gold, flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{relPath}</span>
        {data && <span style={{ fontSize: 10, color: C.textMuted, fontFamily: 'var(--font-mono)' }}>{fmtSize(data.size)}</span>}
        <button onClick={copyPath} title="Pfad kopieren" style={{ background: 'none', border: 'none', padding: 2, color: C.textMuted, cursor: 'pointer', display: 'flex' }}><Copy size={11} /></button>
        <ChevronRight size={13} style={{ color: C.gold, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${C.goldDim}`, padding: '10px 12px', maxHeight: 360, overflowY: 'auto' }}>
          {loading && <div style={{ color: C.textMuted, fontSize: 12 }}>Loading…</div>}
          {err && <div style={{ color: '#e0856b', fontSize: 12 }}>❌ {err}</div>}
          {data && data.binary && <div style={{ color: C.textMuted, fontSize: 12, fontStyle: 'italic' }}>Binärdatei — Vorschau nicht verfügbar</div>}
          {data && !data.binary && (
            <pre style={{ margin: 0, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>{data.content}</pre>
          )}
        </div>
      )}
    </div>
  );
}

const FILE_RE = /\[FILE\]([^\[\n]+?)\[\/FILE\]/g;

function renderTextWithFiles(text: string, unternehmenId: string) {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  FILE_RE.lastIndex = 0;
  while ((m = FILE_RE.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(<span key={`t-${key++}`}>{text.slice(lastIdx, m.index)}</span>);
    parts.push(<FileCard key={`f-${key++}`} relPath={m[1].trim()} unternehmenId={unternehmenId} />);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(<span key={`t-${key++}`}>{text.slice(lastIdx)}</span>);
  return parts.length ? parts : text;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function newSession(): ChatSession {
  return { id: `s-${Date.now()}`, title: 'New chat', createdAt: new Date().toISOString(), messages: [] };
}

export function Chat() {
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const de = language === 'de';

  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSession, setCurrentSession] = useState<ChatSession>(newSession);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => setMousePos({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', h);
    return () => window.removeEventListener('mousemove', h);
  }, []);

  useEffect(() => {
    if (!aktivesUnternehmen) return;
    fetch(`/api/unternehmen/${aktivesUnternehmen.id}/experten`, { credentials: 'include', headers: authHeaders() })
      .then(r => r.json())
      .then((data: Agent[]) => {
        const ceos = data.filter(a => a.isOrchestrator);
        setAgents(ceos);
        if (ceos[0]) setSelectedAgent(ceos[0]);
      })
      .catch(() => {})
      .finally(() => setLoadingAgents(false));
  }, [aktivesUnternehmen?.id]);

  useEffect(() => {
    if (!selectedAgent || !aktivesUnternehmen) return;
    abortRef.current?.abort();
    setStreaming(false);
    if (currentSession.messages.some(m => m.role !== 'system')) {
      saveSessions(selectedAgent.id, [currentSession, ...sessions.filter(s => s.id !== currentSession.id)]);
    }
    const agentSessions = loadSessions(selectedAgent.id);
    setSessions(agentSessions);
    const fresh = newSession();
    setCurrentSession(fresh);

    const welcomeMsg: Message = { id: 'welcome', role: 'system', text: de ? `Du chattest mit ${selectedAgent.name}` : `Chatting with ${selectedAgent.name}`, time: new Date().toISOString() };
    setMessages([welcomeMsg]);

    // Load server-side chat history so messages survive refresh
    fetch(`/api/experten/${selectedAgent.id}/chat`, {
      credentials: 'include',
      headers: authHeaders({ 'x-unternehmen-id': aktivesUnternehmen.id }),
    })
      .then(r => r.json())
      .then((data: any[]) => {
        if (!Array.isArray(data) || data.length === 0) return;
        const serverMsgs: Message[] = data.map(m => ({
          id: m.id,
          role: m.senderType === 'board' ? 'user' : m.senderType === 'agent' ? 'agent' : 'system',
          text: m.message || '',
          time: m.createdAt || new Date().toISOString(),
        }));
        const next = [welcomeMsg, ...serverMsgs];
        setMessages(next);
        setCurrentSession(prev => ({ ...prev, messages: next }));
      })
      .catch(() => {});
  }, [selectedAgent?.id, aktivesUnternehmen?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streaming]);
  useEffect(() => { setCurrentSession(prev => ({ ...prev, messages })); }, [messages]);

  const persistSession = useCallback((msgs: Message[], session: ChatSession, agentId: string) => {
    const userMsgs = msgs.filter(m => m.role === 'user');
    if (!userMsgs.length) return;
    const title = userMsgs[0].text.slice(0, 48) || 'Chat';
    const updated: ChatSession = { ...session, title, messages: msgs };
    setCurrentSession(updated);
    setSessions(prev => {
      const next = [updated, ...prev.filter(s => s.id !== updated.id)];
      saveSessions(agentId, next);
      return next;
    });
  }, []);

  const startNewChat = useCallback(() => {
    if (!selectedAgent) return;
    if (currentSession.messages.some(m => m.role !== 'system')) {
      setSessions(prev => { const next = [currentSession, ...prev.filter(s => s.id !== currentSession.id)]; saveSessions(selectedAgent.id, next); return next; });
    }
    const fresh = newSession();
    setCurrentSession(fresh);
    setMessages([{ id: 'welcome', role: 'system', text: de ? `Du chattest mit ${selectedAgent.name}` : `Chatting with ${selectedAgent.name}`, time: new Date().toISOString() }]);
    setInput(''); setPendingImage(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [selectedAgent, currentSession, de]);

  const loadSession = useCallback((session: ChatSession) => {
    abortRef.current?.abort(); setStreaming(false);
    setCurrentSession(session); setMessages(session.messages);
  }, []);

  const deleteSession = useCallback((id: string) => {
    if (!selectedAgent) return;
    setSessions(prev => { const next = prev.filter(s => s.id !== id); saveSessions(selectedAgent.id, next); return next; });
    if (currentSession.id === id) startNewChat();
  }, [selectedAgent, currentSession.id, startNewChat]);

  const setValue = (v: string) => {
    setInput(v);
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 200) + 'px';
    }
  };

  const pickImage = () => fileRef.current?.click();

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const data = await fileToBase64(file);
    setPendingImage({ data, mimeType: file.type, name: file.name, previewUrl: URL.createObjectURL(file) });
  };

  const send = useCallback(async () => {
    const txt = input.trim();
    if ((!txt && !pendingImage) || streaming || !selectedAgent || !aktivesUnternehmen) return;
    setInput(''); if (inputRef.current) inputRef.current.style.height = '60px';
    const img = pendingImage; setPendingImage(null);
    startTransition(() => setStreaming(true));

    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', text: txt, images: img ? [img.previewUrl] : undefined, time: new Date().toISOString() };
    const agentMsgId = `a-${Date.now()}`;
    const agentPlaceholder: Message = { id: agentMsgId, role: 'agent', text: '', thinking: '', streaming: true, time: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg, agentPlaceholder]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`/api/experten/${selectedAgent.id}/chat/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders({ 'Content-Type': 'application/json', 'x-unternehmen-id': aktivesUnternehmen.id }),
        body: JSON.stringify({ nachricht: txt, ...(img ? { image: { data: img.data, mimeType: img.mimeType } } : {}) }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error('stream_error');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === 'thinking_start' || ev.type === 'thinking_delta') {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, thinking: (m.thinking ?? '') + (ev.chunk ?? '') } : m));
            } else if (ev.type === 'text_delta') {
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, text: m.text + (ev.chunk ?? '') } : m));
            } else if (ev.type === 'done') {
              const final = ev.reply ?? '';
              setMessages(prev => {
                const next = prev.map(m => m.id === agentMsgId ? { ...m, text: final || m.text, streaming: false } : m);
                persistSession(next, currentSession, selectedAgent.id);
                return next;
              });
            } else if (ev.type === 'error') {
              const errMsg = ev.error === 'no_api_key'
                ? '⚠️ No API key configured.'
                : `❌ ${(ev.message || ev.error || 'Error generating reply').toString().slice(0, 300)}`;
              setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, text: errMsg, streaming: false } : m));
            }
          } catch { /* bad SSE */ }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return;
      setMessages(prev => prev.map(m => m.id === agentMsgId ? { ...m, text: '❌ Connection error.', streaming: false } : m));
    } finally {
      setStreaming(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [input, pendingImage, streaming, selectedAgent, aktivesUnternehmen, currentSession, persistSession]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loadingAgents) return (
    <div style={{ flex: 1, ...flex('column', { center: true }), gap: 12, color: C.textMuted }}>
      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{de ? 'Lade Agenten…' : 'Loading agents…'}</span>
    </div>
  );

  if (!agents.length) return (
    <div style={{ flex: 1, ...flex('column', { center: true }), gap: 12, color: C.textMuted }}>
      <AlertCircle size={32} />
      <span style={{ fontSize: 14 }}>{de ? 'Keine Agenten konfiguriert.' : 'No agents configured.'}</span>
    </div>
  );

  const visibleMessages = messages.filter(m => m.role !== 'system');
  const hasMessages = visibleMessages.length > 0;

  return (
    <div style={{ ...flex('column'), height: '100%', background: C.bg, position: 'relative', overflow: 'hidden' }} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f); }}>
      {/* Hidden file input */}
      <input ref={fileRef} id="chat-file" name="chat-file" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />

      {/* Ambient blobs */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '5%', left: '20%', width: 500, height: 500, borderRadius: 9999, background: 'rgba(197,160,89,0.04)', filter: 'blur(120px)' }} />
        <div style={{ position: 'absolute', bottom: '10%', right: '15%', width: 400, height: 400, borderRadius: 9999, background: 'rgba(160,120,56,0.03)', filter: 'blur(100px)' }} />
      </div>

      {/* Top bar */}
      <div style={{ flexShrink: 0, ...flex('row', { between: true }), padding: '14px 24px', borderBottom: `1px solid ${C.border}`, background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(24px)', position: 'relative', zIndex: 10 }}>
        <div style={{ ...flex('row'), gap: 12, alignItems: 'center' }}>
          {/* CEO badge — Chat.tsx is CEO-only; per-agent chats live in the ExpertChatDrawer */}
          <div style={{ ...flex('row'), gap: 10, padding: '8px 14px', background: C.goldDim, border: `1px solid ${C.goldGlow}`, ...round(10) }}>
            {selectedAgent ? (
              <>
                <div style={{ width: 28, height: 28, ...flex('row', { center: true }), fontSize: 12, fontWeight: 700, flexShrink: 0, ...round(8), background: `${selectedAgent.avatarFarbe}22`, border: `1px solid ${selectedAgent.avatarFarbe}44`, color: selectedAgent.avatarFarbe }}>
                  {selectedAgent.avatar || selectedAgent.name.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ ...flex('row'), gap: 6, alignItems: 'center' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{selectedAgent.name}</div>
                    <span style={{ fontSize: 7, fontWeight: 800, padding: '2px 6px', color: C.gold, background: C.goldDim, border: `1px solid ${C.goldGlow}`, letterSpacing: '0.08em', ...round(4) }}>CEO</span>
                  </div>
                  <div style={{ fontSize: 10, color: C.textMuted }}>{de ? 'Command Center' : 'Command Center'}</div>
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, color: C.textMuted, fontFamily: 'var(--font-mono)' }}>
                {loadingAgents ? '…' : (de ? 'Kein CEO konfiguriert' : 'No CEO configured')}
              </div>
            )}
          </div>
        </div>

        <div style={{ ...flex('row'), gap: 8, alignItems: 'center' }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ ...flex('row', { center: true }), gap: 6, padding: '6px 12px', background: sidebarOpen ? C.goldDim : C.surface, border: `1px solid ${sidebarOpen ? C.goldGlow : C.border}`, color: sidebarOpen ? C.gold : C.textMuted, cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', transition: 'all 0.15s', ...round(8) }}>
            <History size={12} /><span>{sessions.length || ''}</span>
          </button>
          <button onClick={startNewChat} style={{ ...flex('row', { center: true }), gap: 6, padding: '6px 12px', background: C.surface, border: `1px solid ${C.border}`, color: C.textMuted, cursor: 'pointer', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', transition: 'all 0.15s', ...round(8) }}>
            <Plus size={12} /><span>{de ? 'Neu' : 'New'}</span>
          </button>
          <div style={{ ...flex('row'), gap: 6, alignItems: 'center', marginLeft: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: 9999, background: selectedAgent?.status === 'running' ? C.gold : selectedAgent?.status === 'active' ? C.success : '#3a342c', boxShadow: selectedAgent?.status === 'running' ? `0 0 6px ${C.gold}` : 'none' }} />
            <span style={{ fontSize: 10, color: C.textMuted, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>{selectedAgent?.status?.toUpperCase()}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ ...flex('row'), flex: 1, overflow: 'hidden', position: 'relative', zIndex: 10 }}>
        {/* History sidebar */}
        <AnimatePresence>
          {sidebarOpen && selectedAgent && (
            <motion.div initial={{ width: 0, opacity: 0 }} animate={{ width: 260, opacity: 1 }} exit={{ width: 0, opacity: 0 }} transition={{ duration: 0.2 }}
              style={{ flexShrink: 0, borderRight: `1px solid ${C.border}`, background: 'rgba(5,5,5,0.95)', ...flex('column'), overflow: 'hidden', minWidth: 0 }}>
              <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, ...flex('row', { between: true }), flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: C.gold, letterSpacing: '0.15em', textTransform: 'uppercase' }}>History</div>
                  <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{selectedAgent.name}</div>
                </div>
                <div style={{ ...flex('row'), gap: 6, alignItems: 'center' }}>
                  {sessions.length > 0 && (
                    <button
                      onClick={async () => {
                        if (!selectedAgent || !aktivesUnternehmen) return;
                        if (!confirm(de ? 'Gesamten Chat-Verlauf löschen?' : 'Delete entire chat history?')) return;
                        try {
                          await fetch(`/api/experten/${selectedAgent.id}/chat`, {
                            method: 'DELETE',
                            credentials: 'include',
                            headers: authHeaders({ 'x-unternehmen-id': aktivesUnternehmen.id }),
                          });
                          saveSessions(selectedAgent.id, []);
                          setSessions([]);
                          startNewChat();
                        } catch {}
                      }}
                      title={de ? 'Alles löschen' : 'Clear all'}
                      style={{ background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  <button onClick={() => setSidebarOpen(false)} style={{ background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer', padding: 4 }}><X size={14} /></button>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'rgba(197,180,150,0.1) transparent' }}>
                {sessions.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', color: C.textDim, fontSize: 11, fontFamily: 'var(--font-mono)' }}>No history yet</div>
                ) : (() => {
                  const grouped: { label: string; items: ChatSession[] }[] = [];
                  for (const s of sessions) {
                    const label = fmtDate(s.createdAt);
                    const g = grouped.find(x => x.label === label);
                    if (g) g.items.push(s); else grouped.push({ label, items: [s] });
                  }
                  return grouped.map(g => (
                    <div key={g.label}>
                      <div style={{ padding: '14px 18px 4px', fontSize: 9, fontFamily: 'var(--font-mono)', color: C.textDim, letterSpacing: '0.15em', textTransform: 'uppercase' }}>{g.label}</div>
                      {g.items.map(s => (
                        <div key={s.id} style={{ ...flex('row'), alignItems: 'center', padding: '0 8px', transition: 'all 0.15s', borderLeft: s.id === currentSession.id ? `2px solid ${C.gold}` : '2px solid transparent', background: s.id === currentSession.id ? C.goldDim : 'transparent' }}>
                          <button onClick={() => loadSession(s)} style={{ flex: 1, padding: '10px 10px', textAlign: 'left', background: 'transparent', border: 'none', cursor: 'pointer', overflow: 'hidden', minWidth: 0 }}>
                            <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: s.id === currentSession.id ? C.gold : C.textMuted, fontWeight: s.id === currentSession.id ? 600 : 400 }}>{s.title}</div>
                            <div style={{ fontSize: 9, color: C.textDim, fontFamily: 'var(--font-mono)', marginTop: 2 }}>{fmtTime(s.createdAt)} · {s.messages.filter(m => m.role !== 'system').length} msgs</div>
                          </button>
                          <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }} style={{ background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer', padding: 6, opacity: 0.5, transition: 'opacity 0.15s' }} onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'} onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.5'}>
                            <Trash2 size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  ));
                })()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main chat */}
        <div style={{ ...flex('column'), flex: 1, overflow: 'hidden' }} onClick={() => setPickerOpen(false)}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: 4, scrollbarWidth: 'thin', scrollbarColor: 'rgba(197,180,150,0.1) transparent' }}>
            {!hasMessages && (
              <motion.div style={{ flex: 1, ...flex('column', { center: true }), gap: 40, paddingBottom: 40 }} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
                <div style={{ ...flex('column', { center: true }), gap: 14 }}>
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} style={{ textAlign: 'center' }}>
                    <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.03em', background: 'linear-gradient(180deg, rgba(232,228,220,0.95), rgba(232,228,220,0.4))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', lineHeight: 1.2 }}>
                      {de ? 'CEO Command Center' : 'CEO Command Center'}
                    </h1>
                    <motion.div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(197,160,89,0.35), transparent)', marginTop: 16 }} initial={{ width: 0, opacity: 0 }} animate={{ width: '100%', opacity: 1 }} transition={{ delay: 0.5, duration: 0.8 }} />
                  </motion.div>
                  <motion.p style={{ fontSize: 15, color: 'rgba(255,255,255,0.3)', textAlign: 'center', maxWidth: 520 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>
                    {de
                      ? 'Sprich direkt mit deinem CEO. Er erstellt Agenten, vergibt Tasks und zeigt dir Ergebnisse.'
                      : 'Talk directly to your CEO. They create agents, assign tasks and show you results.'}
                  </motion.p>
                </div>

                <div style={{ ...flex('row', { center: true, wrap: true }), gap: 10, maxWidth: 640 }}>
                  {(de ? [
                    'Bau mir ein Social-Media-Team das täglich postet',
                    'Erstelle ein Content-Team: Researcher, Autor, Editor',
                    'Was macht mein Team gerade?',
                    'Richte einen Research-Agenten für tägliche News ein',
                  ] : [
                    'Build me a social media team that posts daily',
                    'Create a content team: researcher, writer, editor',
                    "What's my team working on right now?",
                    'Set up a research agent for daily news summaries',
                  ]).map((suggestion, i) => (
                    <motion.button key={suggestion} onClick={() => { setValue(suggestion); setTimeout(() => inputRef.current?.focus(), 50); }}
                      style={{ ...flex('row', { center: true }), gap: 8, padding: '10px 16px', background: C.surface, border: `1px solid ${C.border}`, color: 'rgba(255,255,255,0.55)', fontSize: 13, cursor: 'pointer', transition: 'all 0.15s', ...round(10) }}
                      whileHover={{ scale: 1.02, borderColor: C.goldGlow, background: C.surfaceHover, color: 'rgba(255,255,255,0.85)' }}
                      whileTap={{ scale: 0.98 }}
                      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
                      <Sparkles size={12} style={{ color: 'rgba(197,160,89,0.7)' }} />
                      <span>{suggestion}</span>
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {messages.map(msg => {
              if (msg.role === 'system') return null;
              const isUser = msg.role === 'user';
              return (
                <motion.div key={msg.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} style={{ ...flex('row'), alignItems: 'flex-end', gap: 10, marginBottom: 10, flexDirection: isUser ? 'row-reverse' : 'row' }}>
                  <div style={{ width: 30, height: 30, ...flex('row', { center: true }), fontSize: 12, fontWeight: 700, flexShrink: 0, ...round(8), background: isUser ? 'rgba(197,160,89,0.12)' : `${selectedAgent?.avatarFarbe}22`, border: `1px solid ${isUser ? 'rgba(197,160,89,0.3)' : (selectedAgent?.avatarFarbe || C.gold) + '44'}`, color: isUser ? C.gold : selectedAgent?.avatarFarbe }}>
                    {isUser ? <User size={14} /> : (selectedAgent?.avatar || selectedAgent?.name.slice(0, 2).toUpperCase())}
                  </div>
                  <div style={{ ...flex('column'), gap: 4, maxWidth: '75%', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                    {!isUser && (msg.thinking || msg.streaming) && <ThinkingBlock text={msg.thinking ?? ''} streaming={msg.streaming && !msg.text} />}
                    {isUser && msg.images?.map((src, i) => (
                      <img key={i} src={src} alt="" style={{ maxWidth: 240, maxHeight: 200, objectFit: 'cover', border: `1px solid ${C.goldDim}`, marginBottom: 4, ...round(10) }} />
                    ))}
                    {(msg.text || msg.streaming) && (
                      <div style={{ padding: '12px 16px', background: isUser ? 'rgba(197,160,89,0.08)' : C.surface, border: `1px solid ${isUser ? 'rgba(197,160,89,0.15)' : C.border}`, color: C.text, fontSize: 15, lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...round(14), maxWidth: '100%' }}>
                        {!isUser && aktivesUnternehmen ? renderTextWithFiles(msg.text, aktivesUnternehmen.id) : msg.text}
                        {msg.streaming && !msg.text && (
                          <div style={{ ...flex('row'), alignItems: 'center', gap: 4, padding: '6px 0' }}>
                            {[0, 1, 2].map(i => <motion.div key={i} style={{ width: 6, height: 6, background: C.gold, borderRadius: 9999 }} animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1, 0.8] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />)}
                          </div>
                        )}
                        {msg.streaming && msg.text && (
                          <motion.span style={{ display: 'inline-block', width: 2, height: '1.1em', background: C.gold, marginLeft: 4, verticalAlign: 'text-bottom' }} animate={{ opacity: [1, 0] }} transition={{ duration: 0.7, repeat: Infinity, repeatType: 'reverse' }} />
                        )}
                      </div>
                    )}
                    <div style={{ ...flex('row'), alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 10, color: C.textDim, fontFamily: 'var(--font-mono)' }}>{fmtTime(msg.time)}</span>
                      {msg.id !== 'welcome' && (
                        <button
                          onClick={async () => {
                            if (!selectedAgent || !aktivesUnternehmen) return;
                            const isServerMsg = !msg.id.startsWith('u-') && !msg.id.startsWith('a-');
                            if (isServerMsg && !confirm(de ? 'Nachricht löschen?' : 'Delete message?')) return;
                            if (isServerMsg) {
                              try {
                                await fetch(`/api/experten/${selectedAgent.id}/chat/messages/${msg.id}`, {
                                  method: 'DELETE',
                                  credentials: 'include',
                                  headers: authHeaders({ 'x-unternehmen-id': aktivesUnternehmen.id }),
                                });
                              } catch {}
                            }
                            setMessages(prev => prev.filter(m => m.id !== msg.id));
                            setCurrentSession(prev => ({ ...prev, messages: prev.messages.filter(m => m.id !== msg.id) }));
                          }}
                          title={de ? 'Löschen' : 'Delete'}
                          style={{ background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer', padding: 2, fontSize: 10, lineHeight: 1, opacity: 0.35, transition: 'opacity 0.15s' }}
                          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = '1'}
                          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = '0.35'}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ flexShrink: 0, padding: '10px 24px 24px' }}>
            <motion.div style={{ position: 'relative', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, boxShadow: '0 8px 32px rgba(0,0,0,0.4)', backdropFilter: 'blur(40px)', ...round(18) }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <div style={{ padding: '18px 20px 10px' }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => { setInput(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 200) + 'px'; }}
                  onKeyDown={handleKey}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  placeholder={de ? `Nachricht an ${selectedAgent?.name ?? 'Agent'}…` : `Message ${selectedAgent?.name ?? 'agent'}…`}
                  style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', color: C.text, fontSize: 15, lineHeight: 1.6, resize: 'none', minHeight: 56, maxHeight: 200, overflowY: 'auto', scrollbarWidth: 'thin', fontFamily: 'inherit' }}
                />
              </div>

              <AnimatePresence>
                {pendingImage && (
                  <motion.div style={{ padding: '0 20px 10px', ...flex('row'), gap: 8 }} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                    <motion.div style={{ ...flex('row'), alignItems: 'center', gap: 8, fontSize: 12, background: C.surface, padding: '6px 14px', color: 'rgba(255,255,255,0.55)', border: `1px solid ${C.border}`, ...round(10) }} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
                      <img src={pendingImage.previewUrl} alt="" style={{ width: 36, height: 36, objectFit: 'cover', ...round(6) }} />
                      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingImage.name}</span>
                      <button onClick={() => setPendingImage(null)} style={{ color: 'rgba(255,255,255,0.3)', background: 'transparent', border: 'none', cursor: 'pointer', marginLeft: 4 }}><X size={13} /></button>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div style={{ padding: '10px 16px 12px', borderTop: `1px solid ${C.border}`, ...flex('row', { between: true }), alignItems: 'center', gap: 12 }}>
                <div style={{ ...flex('row'), alignItems: 'center', gap: 4 }}>
                  <motion.button type="button" onClick={pickImage} whileTap={{ scale: 0.92 }} style={{ padding: 8, ...round(10), background: 'transparent', border: 'none', cursor: 'pointer', color: pendingImage ? C.gold : 'rgba(255,255,255,0.3)', transition: 'color 0.15s', display: 'flex', alignItems: 'center' }}>
                    {pendingImage ? <ImageIcon size={16} /> : <Paperclip size={16} />}
                  </motion.button>
                </div>
                <div style={{ ...flex('row'), alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)' }}>Enter to send · Shift↵ new line</span>
                  <motion.button type="button" onClick={send} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }} disabled={(!input.trim() && !pendingImage) || streaming}
                    style={{ ...flex('row', { center: true }), gap: 6, padding: '8px 18px', fontSize: 14, fontWeight: 600, ...round(10), transition: 'all 0.15s', cursor: (input.trim() || pendingImage) && !streaming ? 'pointer' : 'default', background: (input.trim() || pendingImage) && !streaming ? C.white : 'rgba(255,255,255,0.05)', color: (input.trim() || pendingImage) && !streaming ? '#0a0a0a' : 'rgba(255,255,255,0.25)', boxShadow: (input.trim() || pendingImage) && !streaming ? '0 4px 20px rgba(255,255,255,0.08)' : 'none' }}>
                    {streaming ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={15} />}
                    <span>{de ? 'Senden' : 'Send'}</span>
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Thinking toast */}
      <AnimatePresence>
        {streaming && (
          <motion.div style={{ position: 'absolute', bottom: 120, left: '50%', transform: 'translateX(-50%)', background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}`, padding: '10px 18px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 50, ...round(9999), backdropFilter: 'blur(24px)' }} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }}>
            <div style={{ ...flex('row'), alignItems: 'center', gap: 12 }}>
              <div style={{ width: 30, height: 30, ...flex('row', { center: true }), fontSize: 11, fontWeight: 700, color: C.gold, background: C.goldDim, border: `1px solid ${C.goldGlow}`, ...round(9999) }}>
                {selectedAgent?.avatar || selectedAgent?.name.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ ...flex('row'), alignItems: 'center', gap: 8, fontSize: 14, color: 'rgba(255,255,255,0.55)' }}>
                <span>{de ? 'Denkt…' : 'Thinking'}</span>
                <Dots />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mouse spotlight */}
      {inputFocused && (
        <motion.div style={{ position: 'fixed', width: '40rem', height: '40rem', borderRadius: 9999, pointerEvents: 'none', zIndex: 0, background: C.gold, opacity: 0.012, filter: 'blur(96px)' }} animate={{ x: mousePos.x - 320, y: mousePos.y - 320 }} transition={{ type: 'spring', damping: 25, stiffness: 150, mass: 0.5 }} />
      )}
    </div>
  );
}
