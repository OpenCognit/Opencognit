import { useState, useEffect, useRef } from 'react';
import {
  X, Send, Plus, Circle, CheckCircle2, Clock,
  Lock, Zap, MessageSquare, GitBranch, User, Flag,
  Calendar, AlertCircle, Loader2, Package, FileText,
  FileCode, Link, FolderOpen, Download, Eye, Sparkles, Check, ChevronDown
} from 'lucide-react';
import { useI18n } from '../i18n';
import { Select } from './Select';
import type { Aufgabe, Experte, Kommentar } from '../api/client';

interface WorkProduct {
  id: string;
  typ: 'file' | 'text' | 'url' | 'directory';
  name: string;
  pfad: string | null;
  inhalt: string | null;
  groeßeBytes: number | null;
  mimeTyp: string | null;
  expertId: string;
  erstelltAm: string;
}

function fileIcon(mimeTyp: string | null, typ: string): React.ReactNode {
  if (typ === 'url') return <Link size={14} />;
  if (typ === 'directory') return <FolderOpen size={14} />;
  if (!mimeTyp) return <FileText size={14} />;
  if (mimeTyp.startsWith('text/') || mimeTyp.includes('json') || mimeTyp.includes('xml'))
    return <FileCode size={14} />;
  return <FileText size={14} />;
}

function formatBytes(b: number | null) {
  if (!b) return null;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

function zeitRelativ(iso: string, de: boolean) {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return de ? 'gerade eben' : 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return de ? `vor ${m} Min.` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return de ? `vor ${h} Std.` : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return de ? `vor ${d} Tagen` : `${d}d ago`;
  return new Date(iso).toLocaleDateString(de ? 'de-DE' : 'en-US');
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#eab308',
  medium: '#c5a059',
  low: '#71717a',
};

const STATUS_COLORS: Record<string, string> = {
  backlog: '#71717a',
  todo: '#3b82f6',
  in_progress: '#c5a059',
  in_review: '#eab308',
  done: '#22c55e',
  blocked: '#ef4444',
  cancelled: '#52525b',
};

function StatusDot({ status }: { status: string }) {
  return (
    <span style={{
      display: 'inline-block',
      width: 8, height: 8,
      borderRadius: '50%',
      background: STATUS_COLORS[status] ?? '#71717a',
      flexShrink: 0,
    }} />
  );
}

interface TaskDetailDrawerProps {
  aufgabe: Aufgabe;
  experten: Experte[];
  alleAufgaben: Aufgabe[];
  onClose: () => void;
  onChanged: () => void;
  unternehmenId: string;
}

type Tab = 'overview' | 'subtasks' | 'comments' | 'results';

export function TaskDetailDrawer({
  aufgabe: initialAufgabe,
  experten,
  alleAufgaben,
  onClose,
  onChanged,
  unternehmenId,
}: TaskDetailDrawerProps) {
  const i18n = useI18n();
  const de = i18n.language === 'de';
  const [tab, setTab] = useState<Tab>('overview');
  const [aufgabe, setAufgabe] = useState<Aufgabe>(initialAufgabe);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [titel, setTitel] = useState(initialAufgabe.titel);
  const [beschreibung, setBeschreibung] = useState(initialAufgabe.beschreibung ?? '');

  // Comments
  const [kommentare, setKommentare] = useState<Kommentar[]>([]);
  const [loadingKommentare, setLoadingKommentare] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [sendingComment, setSendingComment] = useState(false);
  const commentsEndRef = useRef<HTMLDivElement>(null);

  // Sub-tasks
  const [showAddSub, setShowAddSub] = useState(false);
  const [subTitel, setSubTitel] = useState('');
  const [addingSubtask, setAddingSubtask] = useState(false);

  // Work products
  const [workProducts, setWorkProducts] = useState<WorkProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [previewProduct, setPreviewProduct] = useState<WorkProduct | null>(null);

  // AI decomposer
  const [decomposeLoading, setDecomposeLoading] = useState(false);
  const [decomposeSubtasks, setDecomposeSubtasks] = useState<string[] | null>(null);
  const [decomposeSource, setDecomposeSource] = useState<'ai' | 'template' | null>(null);
  const [selectedSubtasks, setSelectedSubtasks] = useState<Set<number>>(new Set());
  const [creatingSubtasks, setCreatingSubtasks] = useState(false);

  const subTasks = alleAufgaben.filter(a => a.parentId === aufgabe.id);

  // Load work products when switching to results tab
  useEffect(() => {
    if (tab !== 'results') return;
    setLoadingProducts(true);
    authFetch(`/api/aufgaben/${aufgabe.id}/work-products`)
      .then(r => r.json())
      .then(d => Array.isArray(d) && setWorkProducts(d))
      .catch(() => {})
      .finally(() => setLoadingProducts(false));
  }, [tab, aufgabe.id]);

  // Load comments when switching to comments tab
  useEffect(() => {
    if (tab !== 'comments') return;
    setLoadingKommentare(true);
    authFetch(`/api/aufgaben/${aufgabe.id}/kommentare`)
      .then(r => r.json())
      .then(d => Array.isArray(d) && setKommentare(d))
      .catch(() => {})
      .finally(() => setLoadingKommentare(false));
  }, [tab, aufgabe.id]);

  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [kommentare]);

  // Escape key closes drawer
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function patch(fields: Partial<Aufgabe>) {
    setSaving(true);
    try {
      const res = await authFetch(`/api/aufgaben/${aufgabe.id}`, {
        method: 'PATCH',
        body: JSON.stringify(fields),
      });
      if (res.ok) {
        const updated = await res.json();
        setAufgabe(updated);
        onChanged();
      }
    } finally {
      setSaving(false);
    }
  }

  async function saveTitel() {
    if (titel.trim() && titel !== aufgabe.titel) {
      await patch({ titel: titel.trim() } as any);
    }
  }

  async function saveBeschreibung() {
    const val = beschreibung.trim() || null;
    if (val !== aufgabe.beschreibung) {
      await patch({ beschreibung: val } as any);
    }
  }

  async function handleDecompose() {
    setDecomposeLoading(true);
    setDecomposeSubtasks(null);
    setSelectedSubtasks(new Set());
    try {
      const res = await authFetch(`/api/aufgaben/${aufgabe.id}/decompose`, {
        method: 'POST',
        body: JSON.stringify({ language: i18n.language }),
      });
      if (res.ok) {
        const data = await res.json();
        setDecomposeSubtasks(data.subtasks ?? []);
        setDecomposeSource(data.source);
        setSelectedSubtasks(new Set(data.subtasks.map((_: string, i: number) => i)));
      }
    } finally {
      setDecomposeLoading(false);
    }
  }

  async function createDecomposedSubtasks() {
    if (!decomposeSubtasks || selectedSubtasks.size === 0) return;
    setCreatingSubtasks(true);
    const toCreate = decomposeSubtasks.filter((_, i) => selectedSubtasks.has(i));
    try {
      await Promise.all(toCreate.map(title =>
        authFetch(`/api/unternehmen/${unternehmenId}/aufgaben`, {
          method: 'POST',
          body: JSON.stringify({
            titel: title,
            prioritaet: aufgabe.prioritaet,
            status: 'todo',
            zugewiesenAn: aufgabe.zugewiesenAn,
            parentId: aufgabe.id,
          }),
        })
      ));
      setDecomposeSubtasks(null);
      setDecomposeSource(null);
      setSelectedSubtasks(new Set());
      setTab('subtasks');
      onChanged();
    } finally {
      setCreatingSubtasks(false);
    }
  }

  async function sendComment() {
    if (!newComment.trim()) return;
    setSendingComment(true);
    try {
      const res = await authFetch(`/api/aufgaben/${aufgabe.id}/kommentare`, {
        method: 'POST',
        body: JSON.stringify({ inhalt: newComment.trim(), autorTyp: 'board' }),
      });
      if (res.ok) {
        const k = await res.json();
        setKommentare(prev => [...prev, k]);
        setNewComment('');
      }
    } finally {
      setSendingComment(false);
    }
  }

  async function addSubTask() {
    if (!subTitel.trim()) return;
    setAddingSubtask(true);
    try {
      await authFetch(`/api/unternehmen/${unternehmenId}/aufgaben`, {
        method: 'POST',
        body: JSON.stringify({
          titel: subTitel.trim(),
          parentId: aufgabe.id,
          prioritaet: 'medium',
          status: 'todo',
        }),
      });
      setSubTitel('');
      setShowAddSub(false);
      onChanged();
    } finally {
      setAddingSubtask(false);
    }
  }

  const assignedExpert = experten.find(e => e.id === aufgabe.zugewiesenAn);

  // Drawer animation classes
  const drawerStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    width: '480px',
    maxWidth: '100vw',
    background: 'linear-gradient(180deg, rgba(16,14,10,0.97) 0%, rgba(12,10,8,0.97) 100%)',
    backdropFilter: 'blur(40px)',
    WebkitBackdropFilter: 'blur(40px)',
    borderLeft: '1px solid rgba(197,160,89,0.15)',
    zIndex: 200,
    display: 'flex',
    flexDirection: 'column',
    animation: 'slideInRight 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
    boxShadow: '-20px 0 60px rgba(0,0,0,0.5)',
  };

  const fieldLabel: React.CSSProperties = {
    fontSize: '0.6875rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#52525b',
    marginBottom: '0.375rem',
    display: 'block',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.5rem 0.75rem',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 0,
    color: '#e4e4e7',
    fontSize: '0.875rem',
    outline: 'none',
    transition: 'border-color 0.2s',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 199,
          background: 'rgba(0,0,0,0.4)',
          animation: 'fadeIn 0.2s ease',
        }}
      />

      {/* Drawer */}
      <div style={drawerStyle}>
        {/* Header */}
        <div style={{
          padding: '1.25rem 1.5rem 0',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '1rem' }}>
            <StatusDot status={aufgabe.status} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <input
                value={titel}
                onChange={e => setTitel(e.target.value)}
                onBlur={saveTitel}
                onKeyDown={e => e.key === 'Enter' && (e.currentTarget.blur())}
                style={{
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  outline: 'none',
                  fontSize: '1.0625rem',
                  fontWeight: 700,
                  color: '#f4f4f5',
                  lineHeight: 1.3,
                  cursor: 'text',
                }}
              />
            </div>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#52525b', cursor: 'pointer', padding: '2px', flexShrink: 0 }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Priority + Maximizer badge row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <span style={{
              padding: '0.2rem 0.5rem',
              borderRadius: 0,
              fontSize: '0.6875rem',
              fontWeight: 600,
              background: PRIORITY_COLORS[aufgabe.prioritaet] + '22',
              border: `1px solid ${PRIORITY_COLORS[aufgabe.prioritaet]}44`,
              color: PRIORITY_COLORS[aufgabe.prioritaet],
            }}>
              <Flag size={10} style={{ display: 'inline', marginRight: 3 }} />
              {i18n.t.priority[aufgabe.prioritaet]}
            </span>
            {aufgabe.isMaximizerMode && (
              <span style={{
                padding: '0.2rem 0.5rem', borderRadius: 0,
                background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
                color: '#ef4444', fontSize: '0.6875rem', fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', gap: '3px',
              }}>
                <Zap size={10} fill="#ef4444" /> MAX
              </span>
            )}
            {aufgabe.blockedBy && (
              <span style={{
                padding: '0.2rem 0.5rem', borderRadius: 0,
                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                color: '#ef4444', fontSize: '0.6875rem', fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: '3px',
              }}>
                <Lock size={10} /> {de ? 'Blockiert' : 'Blocked'}
              </span>
            )}
            {saving && <Loader2 size={12} style={{ color: '#c5a059', animation: 'spin 1s linear infinite', marginLeft: 'auto' }} />}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 0 }}>
            {(['overview', 'subtasks', 'results', 'comments'] as Tab[]).map(t => {
              const labels: Record<Tab, string> = {
                overview: de ? 'Übersicht' : 'Overview',
                subtasks: de ? `Teilaufgaben (${subTasks.length})` : `Sub-tasks (${subTasks.length})`,
                results: de ? `Ergebnisse (${workProducts.length})` : `Results (${workProducts.length})`,
                comments: de ? `Kommentare` : `Comments`,
              };
              return (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    padding: '0.625rem 1rem',
                    background: 'none',
                    border: 'none',
                    borderBottom: t === tab ? '2px solid #c5a059' : '2px solid transparent',
                    color: t === tab ? '#c5a059' : '#71717a',
                    fontSize: '0.8125rem',
                    fontWeight: t === tab ? 600 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {labels[t]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>

          {/* ── OVERVIEW TAB ── */}
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

              {/* Description */}
              <div>
                <label style={fieldLabel}>{de ? 'Beschreibung' : 'Description'}</label>
                <textarea
                  value={beschreibung}
                  onChange={e => setBeschreibung(e.target.value)}
                  onBlur={saveBeschreibung}
                  rows={4}
                  placeholder={de ? 'Was muss gemacht werden?' : 'What needs to be done?'}
                  style={{
                    ...inputStyle,
                    resize: 'vertical',
                    minHeight: 80,
                    lineHeight: 1.6,
                  }}
                />
              </div>

              {/* Status + Priority grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.875rem' }}>
                <div>
                  <label style={fieldLabel}>Status</label>
                  <Select
                    value={aufgabe.status}
                    onChange={v => patch({ status: v as any })}
                    options={[
                      { value: 'backlog', label: i18n.t.status.backlog },
                      { value: 'todo', label: i18n.t.status.todo },
                      { value: 'in_progress', label: i18n.t.status.in_progress },
                      { value: 'in_review', label: i18n.t.status.in_review },
                      { value: 'done', label: i18n.t.status.done },
                      { value: 'blocked', label: i18n.t.status.blocked },
                      { value: 'cancelled', label: de ? 'Abgebrochen' : 'Cancelled' },
                    ]}
                  />
                </div>
                <div>
                  <label style={fieldLabel}>{de ? 'Priorität' : 'Priority'}</label>
                  <Select
                    value={aufgabe.prioritaet}
                    onChange={v => patch({ prioritaet: v as any })}
                    options={[
                      { value: 'low', label: i18n.t.priority.low },
                      { value: 'medium', label: i18n.t.priority.medium },
                      { value: 'high', label: i18n.t.priority.high },
                      { value: 'critical', label: i18n.t.priority.critical },
                    ]}
                  />
                </div>
              </div>

              {/* Assigned agent */}
              <div>
                <label style={fieldLabel}>
                  <User size={11} style={{ display: 'inline', marginRight: 4 }} />
                  {de ? 'Zugewiesen an' : 'Assigned to'}
                </label>
                {assignedExpert && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.625rem',
                    padding: '0.5rem 0.75rem',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 0,
                    marginBottom: '0.5rem',
                  }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: 0,
                      background: assignedExpert.avatarFarbe + '22',
                      color: assignedExpert.avatarFarbe,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.75rem', fontWeight: 600, flexShrink: 0,
                    }}>
                      {assignedExpert.avatar}
                    </div>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#f4f4f5' }}>{assignedExpert.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#71717a' }}>{assignedExpert.rolle}</div>
                    </div>
                  </div>
                )}
                <Select
                  value={aufgabe.zugewiesenAn ?? ''}
                  onChange={v => patch({ zugewiesenAn: v || null } as any)}
                  options={[
                    { value: '', label: de ? '— Niemanden zuweisen —' : '— Unassigned —' },
                    ...experten.map(e => ({ value: e.id, label: `${e.name} (${e.rolle})` })),
                  ]}
                />
              </div>

              {/* Maximizer toggle */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.75rem 1rem',
                background: aufgabe.isMaximizerMode ? 'rgba(239,68,68,0.06)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${aufgabe.isMaximizerMode ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: 0,
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.875rem', fontWeight: 600, color: aufgabe.isMaximizerMode ? '#ef4444' : '#d4d4d8' }}>
                    <Zap size={14} fill={aufgabe.isMaximizerMode ? '#ef4444' : 'none'} />
                    Maximizer Mode
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#71717a', marginTop: 2 }}>
                    {de ? 'Agent läuft bis Aufgabe fertig ist' : 'Agent runs until task is complete'}
                  </div>
                </div>
                <button
                  onClick={() => patch({ isMaximizerMode: !aufgabe.isMaximizerMode } as any)}
                  style={{
                    width: 40, height: 22, borderRadius: 0,
                    background: aufgabe.isMaximizerMode ? '#ef4444' : 'rgba(255,255,255,0.1)',
                    border: 'none', cursor: 'pointer', position: 'relative', transition: 'all 0.25s',
                    flexShrink: 0,
                  }}
                >
                  <span style={{
                    position: 'absolute', top: 3,
                    left: aufgabe.isMaximizerMode ? 21 : 3,
                    width: 16, height: 16, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.25s',
                  }} />
                </button>
              </div>

              {/* Meta info */}
              <div style={{
                padding: '0.875rem 1rem',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 0,
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Calendar size={13} style={{ color: '#52525b', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.75rem', color: '#71717a' }}>
                    {de ? 'Erstellt' : 'Created'}: {zeitRelativ(aufgabe.erstelltAm, de)}
                  </span>
                </div>
                {aufgabe.gestartetAm && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Clock size={13} style={{ color: '#c5a059', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.75rem', color: '#71717a' }}>
                      {de ? 'Gestartet' : 'Started'}: {zeitRelativ(aufgabe.gestartetAm, de)}
                    </span>
                  </div>
                )}
                {aufgabe.abgeschlossenAm && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle2 size={13} style={{ color: '#22c55e', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.75rem', color: '#71717a' }}>
                      {de ? 'Abgeschlossen' : 'Completed'}: {zeitRelativ(aufgabe.abgeschlossenAm, de)}
                    </span>
                  </div>
                )}
                {aufgabe.executionRunId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <AlertCircle size={13} style={{ color: '#eab308', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.75rem', color: '#71717a' }}>
                      {de ? 'Wird ausgeführt' : 'Executing'}: {aufgabe.executionAgentNameKey ?? '…'}
                    </span>
                  </div>
                )}
              </div>

              {/* ── AI Decomposer ── */}
              <div style={{
                padding: '0.875rem 1rem',
                background: 'rgba(197,160,89,0.03)',
                border: '1px solid rgba(197,160,89,0.1)',
                borderRadius: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: decomposeSubtasks ? '0.75rem' : 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Sparkles size={13} style={{ color: '#c5a059' }} />
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#a1a1aa' }}>
                      {de ? 'KI-Aufgabenzerlegung' : 'AI Task Breakdown'}
                    </span>
                    {decomposeSource === 'ai' && (
                      <span style={{
                        fontSize: '0.5625rem', padding: '0.1rem 0.4rem', borderRadius: 0,
                        background: 'rgba(197,160,89,0.1)', color: '#c5a059',
                        border: '1px solid rgba(197,160,89,0.2)', fontWeight: 700, textTransform: 'uppercase',
                      }}>AI</span>
                    )}
                  </div>
                  <button
                    onClick={handleDecompose}
                    disabled={decomposeLoading}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.375rem',
                      padding: '0.3rem 0.75rem', borderRadius: 0, cursor: decomposeLoading ? 'wait' : 'pointer',
                      background: 'rgba(197,160,89,0.08)', border: '1px solid rgba(197,160,89,0.2)',
                      color: '#c5a059', fontSize: '0.75rem', fontWeight: 600, opacity: decomposeLoading ? 0.7 : 1,
                    }}
                  >
                    {decomposeLoading
                      ? <><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> {de ? 'Analysiere…' : 'Analyzing…'}</>
                      : <><ChevronDown size={11} /> {de ? 'Aufteilen' : 'Break down'}</>
                    }
                  </button>
                </div>

                {decomposeSubtasks && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    {decomposeSubtasks.map((title, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedSubtasks(prev => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i); else next.add(i);
                          return next;
                        })}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.5rem',
                          padding: '0.5rem 0.625rem', borderRadius: 0,
                          background: selectedSubtasks.has(i) ? 'rgba(197,160,89,0.08)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${selectedSubtasks.has(i) ? 'rgba(197,160,89,0.25)' : 'rgba(255,255,255,0.07)'}`,
                          cursor: 'pointer', textAlign: 'left', color: selectedSubtasks.has(i) ? '#e4e4e7' : '#71717a',
                          transition: 'all 0.15s', width: '100%',
                        }}
                      >
                        <div style={{
                          width: 16, height: 16, borderRadius: 0, flexShrink: 0,
                          background: selectedSubtasks.has(i) ? '#c5a059' : 'rgba(255,255,255,0.06)',
                          border: `1px solid ${selectedSubtasks.has(i) ? '#c5a059' : 'rgba(255,255,255,0.12)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {selectedSubtasks.has(i) && <Check size={10} style={{ color: '#000' }} />}
                        </div>
                        <span style={{ fontSize: '0.8125rem', lineHeight: 1.4 }}>{title}</span>
                      </button>
                    ))}

                    {selectedSubtasks.size > 0 && (
                      <button
                        onClick={createDecomposedSubtasks}
                        disabled={creatingSubtasks}
                        style={{
                          marginTop: '0.25rem',
                          padding: '0.5rem 0.75rem',
                          background: 'rgba(197,160,89,0.12)', border: '1px solid rgba(197,160,89,0.3)',
                          borderRadius: 0, color: '#c5a059', fontSize: '0.8125rem', fontWeight: 700,
                          cursor: creatingSubtasks ? 'wait' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.375rem',
                          opacity: creatingSubtasks ? 0.7 : 1,
                        }}
                      >
                        {creatingSubtasks
                          ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> {de ? 'Erstelle…' : 'Creating…'}</>
                          : <><Plus size={12} /> {de ? `${selectedSubtasks.size} Teilaufgaben erstellen` : `Create ${selectedSubtasks.size} subtasks`}</>
                        }
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── SUBTASKS TAB ── */}
          {tab === 'subtasks' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {subTasks.length === 0 && !showAddSub && (
                <div style={{
                  textAlign: 'center', padding: '3rem 1rem',
                  color: '#52525b', fontSize: '0.875rem',
                }}>
                  <GitBranch size={32} style={{ margin: '0 auto 0.75rem', display: 'block', opacity: 0.4 }} />
                  {de ? 'Noch keine Teilaufgaben' : 'No sub-tasks yet'}
                </div>
              )}

              {subTasks.map(sub => {
                const subExpert = experten.find(e => e.id === sub.zugewiesenAn);
                return (
                  <div key={sub.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.625rem',
                    padding: '0.75rem 1rem',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    borderRadius: 0,
                  }}>
                    {sub.status === 'done'
                      ? <CheckCircle2 size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
                      : <Circle size={16} style={{ color: STATUS_COLORS[sub.status] ?? '#71717a', flexShrink: 0 }} />
                    }
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.875rem', fontWeight: 500,
                        color: sub.status === 'done' ? '#71717a' : '#e4e4e7',
                        textDecoration: sub.status === 'done' ? 'line-through' : 'none',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {sub.titel}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginTop: 2 }}>
                        <StatusDot status={sub.status} />
                        <span style={{ fontSize: '0.6875rem', color: '#52525b' }}>
                          {i18n.t.status[sub.status as keyof typeof i18n.t.status] ?? sub.status}
                        </span>
                        <span style={{ color: '#3f3f46', fontSize: '0.6875rem' }}>·</span>
                        <span style={{
                          fontSize: '0.6875rem',
                          color: PRIORITY_COLORS[sub.prioritaet],
                        }}>
                          {i18n.t.priority[sub.prioritaet]}
                        </span>
                      </div>
                    </div>
                    {subExpert && (
                      <div style={{
                        width: 24, height: 24, borderRadius: 0,
                        background: subExpert.avatarFarbe + '22',
                        color: subExpert.avatarFarbe,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.625rem', fontWeight: 700, flexShrink: 0,
                      }}>
                        {subExpert.avatar}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Add sub-task */}
              {showAddSub ? (
                <div style={{
                  padding: '0.875rem 1rem',
                  background: 'rgba(197,160,89,0.04)',
                  border: '1px solid rgba(197,160,89,0.15)',
                  borderRadius: 0,
                  display: 'flex', flexDirection: 'column', gap: '0.625rem',
                }}>
                  <input
                    autoFocus
                    value={subTitel}
                    onChange={e => setSubTitel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addSubTask(); if (e.key === 'Escape') setShowAddSub(false); }}
                    placeholder={de ? 'Teilaufgabe beschreiben…' : 'Describe sub-task…'}
                    style={{
                      ...inputStyle,
                      borderColor: 'rgba(197,160,89,0.2)',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => { setShowAddSub(false); setSubTitel(''); }}
                      style={{
                        padding: '0.375rem 0.75rem', borderRadius: 0,
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#71717a', fontSize: '0.8125rem', cursor: 'pointer',
                      }}
                    >
                      {de ? 'Abbrechen' : 'Cancel'}
                    </button>
                    <button
                      onClick={addSubTask}
                      disabled={!subTitel.trim() || addingSubtask}
                      style={{
                        padding: '0.375rem 0.875rem', borderRadius: 0,
                        background: 'rgba(197,160,89,0.12)', border: '1px solid rgba(197,160,89,0.25)',
                        color: '#c5a059', fontSize: '0.8125rem', fontWeight: 600,
                        cursor: subTitel.trim() ? 'pointer' : 'not-allowed',
                        opacity: subTitel.trim() ? 1 : 0.5,
                      }}
                    >
                      {addingSubtask ? '…' : (de ? 'Erstellen' : 'Create')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddSub(true)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.625rem 1rem',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px dashed rgba(255,255,255,0.1)',
                    borderRadius: 0,
                    color: '#71717a', fontSize: '0.8125rem', cursor: 'pointer',
                    transition: 'all 0.2s', width: '100%', textAlign: 'left',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(197,160,89,0.3)'; e.currentTarget.style.color = '#c5a059'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#71717a'; }}
                >
                  <Plus size={14} />
                  {de ? 'Teilaufgabe hinzufügen' : 'Add sub-task'}
                </button>
              )}
            </div>
          )}

          {/* ── RESULTS TAB ── */}
          {tab === 'results' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {loadingProducts && (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#52525b' }}>
                  <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }} />
                </div>
              )}

              {!loadingProducts && workProducts.length === 0 && (
                <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#52525b' }}>
                  <Package size={32} style={{ margin: '0 auto 0.75rem', display: 'block', opacity: 0.4 }} />
                  <div style={{ fontSize: '0.875rem' }}>
                    {de ? 'Noch keine Ergebnisse — warte bis der Agent die Aufgabe bearbeitet' : 'No results yet — wait for the agent to work on this task'}
                  </div>
                </div>
              )}

              {workProducts.map(wp => {
                const expert = experten.find(e => e.id === wp.expertId);
                const bytes = formatBytes(wp.groeßeBytes);
                const isPreviewing = previewProduct?.id === wp.id;
                return (
                  <div key={wp.id} style={{
                    borderRadius: 0,
                    border: isPreviewing ? '1px solid rgba(197,160,89,0.3)' : '1px solid rgba(255,255,255,0.07)',
                    background: isPreviewing ? 'rgba(197,160,89,0.04)' : 'rgba(255,255,255,0.03)',
                    overflow: 'hidden',
                  }}>
                    {/* File header */}
                    <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                      <span style={{ color: '#c5a059', flexShrink: 0 }}>
                        {fileIcon(wp.mimeTyp, wp.typ)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#e4e4e7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {wp.name}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', marginTop: 2, fontSize: '0.6875rem', color: '#52525b' }}>
                          {wp.pfad && <span style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{wp.pfad}</span>}
                          {bytes && <span>{bytes}</span>}
                          {wp.mimeTyp && <span>{wp.mimeTyp}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.375rem', flexShrink: 0 }}>
                        {wp.typ === 'url' && wp.pfad && (
                          <a href={wp.pfad} target="_blank" rel="noopener noreferrer" style={{
                            padding: '0.25rem 0.5rem', borderRadius: 0,
                            background: 'rgba(197,160,89,0.08)', border: '1px solid rgba(197,160,89,0.2)',
                            color: '#c5a059', fontSize: '0.75rem', textDecoration: 'none',
                            display: 'flex', alignItems: 'center', gap: 3,
                          }}>
                            <Link size={11} /> {de ? 'Öffnen' : 'Open'}
                          </a>
                        )}
                        {wp.inhalt && (
                          <button
                            onClick={() => setPreviewProduct(isPreviewing ? null : wp)}
                            style={{
                              padding: '0.25rem 0.5rem', borderRadius: 0,
                              background: isPreviewing ? 'rgba(197,160,89,0.12)' : 'rgba(255,255,255,0.05)',
                              border: `1px solid ${isPreviewing ? 'rgba(197,160,89,0.25)' : 'rgba(255,255,255,0.1)'}`,
                              color: isPreviewing ? '#c5a059' : '#71717a',
                              fontSize: '0.75rem', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', gap: 3,
                            }}
                          >
                            <Eye size={11} /> {isPreviewing ? (de ? 'Schließen' : 'Close') : (de ? 'Vorschau' : 'Preview')}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline preview */}
                    {isPreviewing && wp.inhalt && (
                      <div style={{
                        borderTop: '1px solid rgba(255,255,255,0.06)',
                        background: 'rgba(0,0,0,0.3)',
                        padding: '0.875rem 1rem',
                        maxHeight: 320,
                        overflowY: 'auto',
                      }}>
                        <pre style={{
                          margin: 0,
                          fontSize: '0.75rem',
                          lineHeight: 1.6,
                          color: '#a1a1aa',
                          fontFamily: 'monospace',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {wp.inhalt.length > 4000 ? wp.inhalt.slice(0, 4000) + '\n…' : wp.inhalt}
                        </pre>
                      </div>
                    )}

                    {/* Footer: agent + time */}
                    <div style={{
                      padding: '0.375rem 1rem',
                      borderTop: '1px solid rgba(255,255,255,0.04)',
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      fontSize: '0.6875rem', color: '#3f3f46',
                    }}>
                      {expert && (
                        <>
                          <div style={{
                            width: 16, height: 16, borderRadius: 0,
                            background: expert.avatarFarbe + '22', color: expert.avatarFarbe,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '0.5rem', fontWeight: 700,
                          }}>
                            {expert.avatar}
                          </div>
                          <span>{expert.name}</span>
                          <span>·</span>
                        </>
                      )}
                      <span>{zeitRelativ(wp.erstelltAm, de)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── COMMENTS TAB ── */}
          {tab === 'comments' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
              {loadingKommentare && (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#52525b' }}>
                  <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }} />
                </div>
              )}

              {!loadingKommentare && kommentare.length === 0 && (
                <div style={{
                  textAlign: 'center', padding: '3rem 1rem',
                  color: '#52525b', fontSize: '0.875rem',
                }}>
                  <MessageSquare size={32} style={{ margin: '0 auto 0.75rem', display: 'block', opacity: 0.4 }} />
                  {de ? 'Noch keine Kommentare' : 'No comments yet'}
                </div>
              )}

              {kommentare.map(k => {
                const expert = experten.find(e => e.id === k.autorExpertId);
                const isBoard = k.autorTyp === 'board';
                return (
                  <div key={k.id} style={{
                    display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
                  }}>
                    {/* Avatar */}
                    <div style={{
                      width: 28, height: 28, borderRadius: 0, flexShrink: 0,
                      background: isBoard ? 'rgba(155,135,200,0.2)' : (expert ? expert.avatarFarbe + '22' : 'rgba(197,160,89,0.1)'),
                      color: isBoard ? '#9b87c8' : (expert ? expert.avatarFarbe : '#c5a059'),
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '0.625rem', fontWeight: 700,
                    }}>
                      {isBoard ? 'CEO' : (expert?.avatar ?? '?')}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#d4d4d8' }}>
                          {isBoard ? (de ? 'CEO Board' : 'CEO Board') : (expert?.name ?? 'Agent')}
                        </span>
                        <span style={{ fontSize: '0.6875rem', color: '#52525b' }}>
                          {zeitRelativ(k.erstelltAm, de)}
                        </span>
                      </div>
                      <div style={{
                        fontSize: '0.8125rem', color: '#a1a1aa', lineHeight: 1.6,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      }}>
                        {k.inhalt}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={commentsEndRef} />
            </div>
          )}
        </div>

        {/* Footer: comment input shown on comments tab */}
        {tab === 'comments' && (
          <div style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}>
            <div style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-end' }}>
              <textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendComment();
                }}
                rows={2}
                placeholder={de ? 'Kommentar hinzufügen… (⌘↵ zum Senden)' : 'Add comment… (⌘↵ to send)'}
                style={{
                  ...inputStyle,
                  resize: 'none',
                  flex: 1,
                  lineHeight: 1.5,
                }}
              />
              <button
                onClick={sendComment}
                disabled={!newComment.trim() || sendingComment}
                style={{
                  padding: '0.5rem 0.75rem',
                  background: 'rgba(197,160,89,0.12)',
                  border: '1px solid rgba(197,160,89,0.25)',
                  borderRadius: 0,
                  color: '#c5a059', cursor: newComment.trim() ? 'pointer' : 'not-allowed',
                  opacity: newComment.trim() ? 1 : 0.4, flexShrink: 0,
                  transition: 'all 0.2s',
                  display: 'flex', alignItems: 'center',
                }}
              >
                {sendingComment ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
