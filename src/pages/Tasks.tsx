import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, LayoutGrid, List, GanttChartSquare, Loader2, Sparkles, Zap, Lock, Search, X as XIcon, Trash2, CheckSquare2, Square, UserCheck, ArrowRight, Download } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { StatusBadge } from '../components/StatusBadge';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { zeitRelativ } from '../utils/i18n';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import { apiAufgaben, apiExperten, type Aufgabe, type Experte } from '../api/client';
import { TaskModal } from '../components/TaskModal';
import { TaskDetailDrawer } from '../components/TaskDetailDrawer';
import { TimelineView } from '../components/TaskTimeline';
import { WorkflowLaunchModal } from '../components/WorkflowLaunchModal';
import { authFetch } from '../utils/api';
import { GlassCard } from '../components/GlassCard';

export function Tasks() {
  const i18n = useI18n();
  const location = useLocation();
  const [ansicht, setAnsicht] = useState<'kanban' | 'liste' | 'timeline'>('kanban');
  const [showNeueAufgabeModal, setShowNeueAufgabeModal] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);
  const [selectedAufgabeId, setSelectedAufgabeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterPriority, setFilterPriority] = useState<string>('');
  const [filterAgent, setFilterAgent] = useState<string>('');
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', i18n.t.nav.aufgaben]);

  const getKanbanSpalten = () => [
    { key: 'backlog', label: i18n.t.status.backlog, color: '#71717a' },
    { key: 'todo', label: i18n.t.status.todo, color: '#3b82f6' },
    { key: 'in_progress', label: i18n.t.status.in_progress, color: '#23CDCB' },
    { key: 'in_review', label: i18n.t.status.in_review, color: '#eab308' },
    { key: 'done', label: i18n.t.status.done, color: '#22c55e' },
  ];

  const { data: alleAufgaben, loading: loadingA, reload: reloadAufgaben } = useApi<Aufgabe[]>(
    () => apiAufgaben.liste(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );
  const { data: alleExperten, loading: loadingM } = useApi<Experte[]>(
    () => apiExperten.liste(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );

  // DnD state
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // Real-time WebSocket updates — reload tasks when agents start/complete work
  useEffect(() => {
    if (!aktivesUnternehmen) return;
    const token = localStorage.getItem('opencognit_token');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.hostname}:3201/ws${token ? `?token=${token}` : ''}`);
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.unternehmenId && msg.unternehmenId !== aktivesUnternehmen.id) return;
        if (['task_started', 'task_completed', 'task_updated'].includes(msg.type)) {
          reloadAufgaben();
        }
      } catch {}
    };
    return () => ws.close();
  }, [aktivesUnternehmen?.id]);

  // Auto-open task drawer from navigation state (e.g., from command palette search)
  useEffect(() => {
    if (location.state?.openTaskId && alleAufgaben) {
      setSelectedAufgabeId(location.state.openTaskId);
    }
  }, [location.state?.openTaskId, alleAufgaben]);

  // Page-level keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      if (isInput || e.metaKey || e.ctrlKey) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowNeueAufgabeModal(true); }
      if (e.key === '1') { e.preventDefault(); setAnsicht('kanban'); }
      if (e.key === '2') { e.preventDefault(); setAnsicht('liste'); }
      if (e.key === '3') { e.preventDefault(); setAnsicht('timeline'); }
      if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('input[placeholder*="such"]')?.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Kanban column pagination — how many cards to show per column
  const [columnLimit, setColumnLimit] = useState<Record<string, number>>({});
  const COLUMN_PAGE_SIZE = 30;

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchLoading, setBatchLoading] = useState(false);
  const lastClickedRef = useRef<string | null>(null);

  // Clear selection when filters change
  useEffect(() => { setSelectedIds(new Set()); }, [search, filterStatus, filterPriority, filterAgent]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    lastClickedRef.current = null;
  }, []);

  const batchUpdate = useCallback(async (fields: Record<string, unknown>) => {
    if (!selectedIds.size) return;
    setBatchLoading(true);
    try {
      await Promise.all([...selectedIds].map(id =>
        authFetch(`/api/aufgaben/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields),
        })
      ));
      clearSelection();
      reloadAufgaben();
    } finally {
      setBatchLoading(false);
    }
  }, [selectedIds, clearSelection]);

  const batchDelete = useCallback(async () => {
    if (!selectedIds.size) return;
    if (!confirm(`${selectedIds.size} ${i18n.language === 'de' ? 'Aufgaben löschen?' : 'tasks delete?'}`)) return;
    setBatchLoading(true);
    try {
      await Promise.all([...selectedIds].map(id =>
        authFetch(`/api/aufgaben/${id}`, { method: 'DELETE' })
      ));
      clearSelection();
      reloadAufgaben();
    } finally {
      setBatchLoading(false);
    }
  }, [selectedIds, clearSelection, i18n.language]);

  const toggleMaximizer = async (aufgabeId: string, current: boolean) => {
    await authFetch(`/api/aufgaben/${aufgabeId}`, {
      method: 'PATCH',
      body: JSON.stringify({ isMaximizerMode: !current }),
    });
    reloadAufgaben();
  };

  const deleteTask = async (aufgabeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(i18n.language === 'de' ? 'Aufgabe löschen?' : 'Delete this task?')) return;
    await authFetch(`/api/aufgaben/${aufgabeId}`, { method: 'DELETE' });
    if (selectedAufgabeId === aufgabeId) setSelectedAufgabeId(null);
    reloadAufgaben();
  };


  const handleDrop = async (targetStatus: string) => {
    if (!draggedId || !dragOverCol) return;
    const aufgabe = alleAufgaben?.find(a => a.id === draggedId);
    if (!aufgabe || aufgabe.status === targetStatus) {
      setDraggedId(null);
      setDragOverCol(null);
      return;
    }
    // Optimistic update via local reload (PATCH then reload)
    await authFetch(`/api/aufgaben/${draggedId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: targetStatus }),
    });
    setDraggedId(null);
    setDragOverCol(null);
    reloadAufgaben();
  };

  // These must all be declared before any early returns to satisfy Rules of Hooks
  const findExpert = useCallback(
    (id: string | null) => id ? alleExperten?.find(m => m.id === id) : null,
    [alleExperten]
  );

  const selectedAufgabe = useMemo(
    () => alleAufgaben?.find(a => a.id === selectedAufgabeId) ?? null,
    [alleAufgaben, selectedAufgabeId]
  );

  const filteredAufgaben = useMemo(() => {
    if (!alleAufgaben) return [];
    let list = alleAufgaben;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a =>
        a.titel.toLowerCase().includes(q) ||
        (a.beschreibung ?? '').toLowerCase().includes(q)
      );
    }
    if (filterStatus) list = list.filter(a => a.status === filterStatus);
    if (filterPriority) list = list.filter(a => a.prioritaet === filterPriority);
    if (filterAgent === '__unassigned') list = list.filter(a => !a.zugewiesenAn);
    else if (filterAgent) list = list.filter(a => a.zugewiesenAn === filterAgent);
    return list;
  }, [alleAufgaben, search, filterStatus, filterPriority, filterAgent]);

  const hasFilters = !!(search || filterStatus || filterPriority || filterAgent);

  const toggleSelect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (e.shiftKey && lastClickedRef.current) {
        const ids = filteredAufgaben.map(a => a.id);
        const fromIdx = ids.indexOf(lastClickedRef.current);
        const toIdx = ids.indexOf(id);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [lo, hi] = [Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx)];
          const adding = !prev.has(id);
          ids.slice(lo, hi + 1).forEach(rid => adding ? next.add(rid) : next.delete(rid));
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      lastClickedRef.current = id;
      return next;
    });
  }, [filteredAufgaben]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filteredAufgaben.map(a => a.id)));
  }, [filteredAufgaben]);

  const exportCsv = useCallback(() => {
    const list = selectedIds.size > 0
      ? filteredAufgaben.filter(a => selectedIds.has(a.id))
      : filteredAufgaben;
    if (list.length === 0) return;
    const header = ['ID', 'Titel', 'Status', 'Priorität', 'Agent', 'Erstellt', 'Abgeschlossen'];
    const rows = list.map(a => [
      a.id,
      `"${a.titel.replace(/"/g, '""')}"`,
      a.status,
      a.prioritaet,
      findExpert(a.zugewiesenAn)?.name ?? '',
      a.erstelltAm ? new Date(a.erstelltAm).toLocaleDateString() : '',
      a.abgeschlossenAm ? new Date(a.abgeschlossenAm).toLocaleDateString() : '',
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tasks-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }, [filteredAufgaben, selectedIds, findExpert]);

  if (!aktivesUnternehmen) return null;
  const loading = loadingA || loadingM;

  if (loading || !alleAufgaben || !alleExperten) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#23CDCB' }} />
      </div>
    );
  }

  return (
    <>
      <div>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '2rem',
            flexWrap: 'wrap',
            gap: '1rem',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <Sparkles size={20} style={{ color: '#23CDCB' }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#23CDCB', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {aktivesUnternehmen.name}
                </span>
              </div>
              <h1 style={{
                fontSize: '2rem',
                fontWeight: 700,
                background: 'linear-gradient(to bottom right, #23CDCB 0%, #ffffff 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>{i18n.t.aufgaben.title}</h1>
              <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.25rem' }}>{i18n.t.aufgaben.subtitle}</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div style={{ display: 'flex', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', overflow: 'hidden' }}>
                <button
                  onClick={() => setAnsicht('kanban')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 0.875rem',
                    backgroundColor: ansicht === 'kanban' ? 'rgba(35, 205, 202, 0.1)' : 'transparent',
                    border: 'none',
                    color: ansicht === 'kanban' ? '#23CDCB' : '#71717a',
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <LayoutGrid size={14} /> Kanban
                </button>
                <button
                  onClick={() => setAnsicht('liste')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 0.875rem',
                    backgroundColor: ansicht === 'liste' ? 'rgba(35, 205, 202, 0.1)' : 'transparent',
                    border: 'none',
                    color: ansicht === 'liste' ? '#23CDCB' : '#71717a',
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <List size={14} /> Liste
                </button>
                <button
                  onClick={() => setAnsicht('timeline')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 0.875rem',
                    backgroundColor: ansicht === 'timeline' ? 'rgba(35, 205, 202, 0.1)' : 'transparent',
                    border: 'none',
                    color: ansicht === 'timeline' ? '#23CDCB' : '#71717a',
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <GanttChartSquare size={14} /> Timeline
                </button>
              </div>
              <button
                onClick={exportCsv}
                title={i18n.language === 'de' ? 'Als CSV exportieren' : 'Export as CSV'}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.75rem 1rem',
                  backgroundColor: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px', color: '#71717a',
                  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; e.currentTarget.style.color = '#d4d4d8'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = '#71717a'; }}
              >
                <Download size={15} />
                CSV
              </button>
              <button
                onClick={() => setShowWorkflowModal(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.75rem 1rem',
                  backgroundColor: 'rgba(168,85,247,0.08)',
                  border: '1px solid rgba(168,85,247,0.2)',
                  borderRadius: '12px',
                  color: '#a855f7',
                  fontWeight: 600, fontSize: '0.875rem', cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(168,85,247,0.14)'; }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(168,85,247,0.08)'; }}
              >
                <Sparkles size={14} /> Workflow
              </button>
              <button
                onClick={() => setShowNeueAufgabeModal(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem 1.25rem',
                  backgroundColor: 'rgba(35, 205, 202, 0.1)',
                  border: '1px solid rgba(35, 205, 202, 0.2)',
                  borderRadius: '12px',
                  color: '#23CDCB',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <Plus size={16} /> {i18n.t.aufgaben.neueAufgabe}
              </button>

              {showWorkflowModal && (
                <WorkflowLaunchModal
                  open={showWorkflowModal}
                  onClose={() => setShowWorkflowModal(false)}
                  onLaunched={() => { reloadAufgaben(); }}
                />
              )}

              {showNeueAufgabeModal && (
                <TaskModal
                  isOpen={showNeueAufgabeModal}
                  onClose={() => setShowNeueAufgabeModal(false)}
                  onSaved={() => {
                    setShowNeueAufgabeModal(false);
                    reloadAufgaben();
                  }}
                  experten={alleExperten || []}
                />
              )}
            </div>
          </div>

          {/* Search + Filter bar */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.625rem',
            marginBottom: '1.5rem', flexWrap: 'wrap',
          }}>
            {/* Search input */}
            <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 180 }}>
              <Search size={14} style={{
                position: 'absolute', left: '0.75rem', top: '50%',
                transform: 'translateY(-50%)', color: '#52525b', pointerEvents: 'none',
              }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={i18n.language === 'de' ? 'Aufgaben suchen…' : 'Search tasks…'}
                style={{
                  width: '100%',
                  paddingLeft: '2.25rem',
                  paddingRight: search ? '2.25rem' : '0.75rem',
                  paddingTop: '0.5rem',
                  paddingBottom: '0.5rem',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '10px',
                  color: '#e4e4e7',
                  fontSize: '0.875rem',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(35,205,202,0.4)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  style={{
                    position: 'absolute', right: '0.625rem', top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#52525b',
                    padding: 2, display: 'flex', alignItems: 'center',
                  }}
                >
                  <XIcon size={13} />
                </button>
              )}
            </div>

            {/* Status filter */}
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                background: filterStatus ? 'rgba(35,205,202,0.08)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${filterStatus ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '10px', color: filterStatus ? '#23CDCB' : '#71717a',
                fontSize: '0.8125rem', cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="">{i18n.language === 'de' ? 'Alle Status' : 'All Status'}</option>
              <option value="backlog">{i18n.t.status.backlog}</option>
              <option value="todo">{i18n.t.status.todo}</option>
              <option value="in_progress">{i18n.t.status.in_progress}</option>
              <option value="in_review">{i18n.t.status.in_review}</option>
              <option value="done">{i18n.t.status.done}</option>
              <option value="blocked">{i18n.t.status.blocked}</option>
            </select>

            {/* Priority filter */}
            <select
              value={filterPriority}
              onChange={e => setFilterPriority(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                background: filterPriority ? 'rgba(35,205,202,0.08)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${filterPriority ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '10px', color: filterPriority ? '#23CDCB' : '#71717a',
                fontSize: '0.8125rem', cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="">{i18n.language === 'de' ? 'Alle Prioritäten' : 'All Priorities'}</option>
              <option value="critical">{i18n.t.priority.critical}</option>
              <option value="high">{i18n.t.priority.high}</option>
              <option value="medium">{i18n.t.priority.medium}</option>
              <option value="low">{i18n.t.priority.low}</option>
            </select>

            {/* Agent filter */}
            <select
              value={filterAgent}
              onChange={e => setFilterAgent(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                background: filterAgent ? 'rgba(35,205,202,0.08)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${filterAgent ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.08)'}`,
                borderRadius: '10px', color: filterAgent ? '#23CDCB' : '#71717a',
                fontSize: '0.8125rem', cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="">{i18n.language === 'de' ? 'Alle Agenten' : 'All Agents'}</option>
              <option value="__unassigned">{i18n.language === 'de' ? 'Nicht zugewiesen' : 'Unassigned'}</option>
              {(alleExperten || []).map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>

            {/* Clear filters */}
            {hasFilters && (
              <button
                onClick={() => { setSearch(''); setFilterStatus(''); setFilterPriority(''); setFilterAgent(''); }}
                style={{
                  padding: '0.5rem 0.875rem',
                  background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)',
                  borderRadius: '10px', color: '#ef4444',
                  fontSize: '0.8125rem', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '0.375rem',
                }}
              >
                <XIcon size={13} />
                {i18n.language === 'de' ? 'Filter löschen' : 'Clear filters'}
              </button>
            )}

            {/* Result count + select-all toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
              {hasFilters && (
                <span style={{ fontSize: '0.8125rem', color: '#52525b' }}>
                  {filteredAufgaben.length} {i18n.language === 'de' ? 'Ergebnisse' : 'results'}
                </span>
              )}
              {filteredAufgaben.length > 0 && (
                <button
                  onClick={selectedIds.size === filteredAufgaben.length ? clearSelection : selectAll}
                  style={{
                    padding: '0.4rem 0.75rem',
                    background: selectedIds.size > 0 ? 'rgba(35,205,202,0.08)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${selectedIds.size > 0 ? 'rgba(35,205,202,0.25)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: '10px', color: selectedIds.size > 0 ? '#23CDCB' : '#71717a',
                    fontSize: '0.8125rem', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: '0.375rem', whiteSpace: 'nowrap',
                  }}
                >
                  {selectedIds.size === filteredAufgaben.length && filteredAufgaben.length > 0
                    ? <CheckSquare2 size={13} />
                    : <Square size={13} />
                  }
                  {selectedIds.size > 0
                    ? `${selectedIds.size} ${i18n.language === 'de' ? 'ausgewählt' : 'selected'}`
                    : i18n.language === 'de' ? 'Alle wählen' : 'Select all'
                  }
                </button>
              )}
            </div>
          </div>

          <PageHelp id="tasks" lang={i18n.language} />

          {/* Kanban View */}
          {ansicht === 'kanban' ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '1.25rem',
              animation: 'fadeInUp 0.5s ease-out',
            }}>
              {getKanbanSpalten().map((spalte) => {
                const spaltenAufgaben = filteredAufgaben.filter(a => a.status === spalte.key);
                const limit = columnLimit[spalte.key] ?? COLUMN_PAGE_SIZE;
                const visibleAufgaben = spaltenAufgaben.slice(0, limit);
                const hiddenCount = spaltenAufgaben.length - visibleAufgaben.length;
                const isDragTarget = dragOverCol === spalte.key;
                return (
                  <GlassCard
                    key={spalte.key}
                    onDragOver={e => { e.preventDefault(); setDragOverCol(spalte.key); }}
                    onDragLeave={() => setDragOverCol(null)}
                    onDrop={() => handleDrop(spalte.key)}
                    active={isDragTarget}
                    accent={spalte.color}
                    style={{ padding: '1rem' }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '0.75rem',
                      paddingBottom: '0.75rem',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          background: spalte.color,
                          boxShadow: isDragTarget ? `0 0 8px ${spalte.color}` : 'none',
                        }} />
                        <span style={{ fontSize: '0.875rem', fontWeight: 600, color: isDragTarget ? '#ffffff' : '#d4d4d8' }}>{spalte.label}</span>
                      </div>
                      <span style={{
                        padding: '0.25rem 0.625rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        color: '#71717a',
                      }}>{spaltenAufgaben.length}</span>
                    </div>
                    <div className="kanban-column-body">
                      {visibleAufgaben.map((a) => {
                        const expert = findExpert(a.zugewiesenAn);
                        const isBeingDragged = draggedId === a.id;
                        const isChecked = selectedIds.has(a.id);
                        return (
                          <GlassCard
                            key={a.id}
                            className="kanban-card"
                            noBlur
                            draggable
                            onDragStart={e => { setDraggedId(a.id); e.dataTransfer.effectAllowed = 'move'; }}
                            onDragEnd={() => { setDraggedId(null); setDragOverCol(null); }}
                            onClick={() => !draggedId && selectedIds.size === 0 && setSelectedAufgabeId(a.id)}
                            active={isChecked || isBeingDragged}
                            style={{
                              padding: '0.875rem',
                              borderRadius: '14px',
                              cursor: 'grab',
                              opacity: isBeingDragged ? 0.5 : 1,
                              userSelect: 'none',
                              flexShrink: 0,
                            }}
                          >
                            {/* Checkbox overlay */}
                            <button
                              onClick={e => toggleSelect(a.id, e)}
                              style={{
                                position: 'absolute', top: '0.5rem', right: '0.5rem',
                                background: isChecked ? '#23CDCB' : 'rgba(255,255,255,0.06)',
                                border: `1px solid ${isChecked ? '#23CDCB' : 'rgba(255,255,255,0.12)'}`,
                                borderRadius: '6px', width: 20, height: 20, cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: isChecked ? '#000' : '#52525b',
                                transition: 'all 0.15s', flexShrink: 0, padding: 0,
                                opacity: isChecked || selectedIds.size > 0 ? 1 : 0,
                              }}
                              className="card-checkbox"
                            >
                              {isChecked && <CheckSquare2 size={12} />}
                            </button>
                            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: a.status === 'blocked' ? '#71717a' : '#ffffff', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.375rem', paddingRight: '1.5rem' }}>
                              {a.status === 'blocked' && <Lock size={12} style={{ color: '#ef4444', flexShrink: 0 }} />}
                              {a.titel}
                            </div>
                            {a.blockedBy && (
                              <div style={{
                                fontSize: '0.6875rem', color: '#ef4444', marginBottom: '0.375rem',
                                padding: '0.2rem 0.5rem', borderRadius: '4px',
                                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)',
                                display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                              }}>
                                <Lock size={10} /> {i18n.language === 'de' ? 'Blockiert' : 'Blocked'}
                              </div>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                                <span style={{
                                  padding: '0.25rem 0.5rem',
                                  backgroundColor: a.prioritaet === 'critical' ? 'rgba(239, 68, 68, 0.1)' :
                                    a.prioritaet === 'high' ? 'rgba(234, 179, 8, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                                  border: `1px solid ${a.prioritaet === 'critical' ? '#ef4444' : a.prioritaet === 'high' ? '#eab308' : 'rgba(255, 255, 255, 0.1)'}`,
                                  borderRadius: '6px',
                                  fontSize: '0.6875rem',
                                  color: a.prioritaet === 'critical' ? '#ef4444' : a.prioritaet === 'high' ? '#eab308' : '#71717a',
                                }}>
                                  {i18n.t.priority[a.prioritaet]}
                                </span>
                                <button
                                  title={a.isMaximizerMode
                                    ? (i18n.language === 'de' ? 'Maximizer Mode — Budget & Approvals deaktiviert (klicken zum deaktivieren)' : 'Maximizer Mode — bypasses budget limits & approval gates (click to disable)')
                                    : (i18n.language === 'de' ? 'Maximizer Mode aktivieren — ignoriert Budget-Limits & Freigaben' : 'Enable Maximizer Mode — bypasses budget limits & approval requirements')}
                                  onClick={(e) => { e.stopPropagation(); toggleMaximizer(a.id, !!a.isMaximizerMode); }}
                                  style={{
                                    padding: '0.2rem 0.4rem',
                                    borderRadius: '6px',
                                    border: `1px solid ${a.isMaximizerMode ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.08)'}`,
                                    background: a.isMaximizerMode ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                                    cursor: 'pointer',
                                    display: 'flex', alignItems: 'center',
                                    color: a.isMaximizerMode ? '#ef4444' : '#52525b',
                                    transition: 'all 0.2s',
                                    ...(a.isMaximizerMode ? { boxShadow: '0 0 8px rgba(239, 68, 68, 0.3)' } : {}),
                                  }}
                                >
                                  <Zap size={12} fill={a.isMaximizerMode ? '#ef4444' : 'none'} />
                                </button>
                              </div>
                              {expert && (
                                <div style={{
                                  width: '24px',
                                  height: '24px',
                                  borderRadius: '8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '0.625rem',
                                  fontWeight: 600,
                                  background: expert.avatarFarbe + '22',
                                  color: expert.avatarFarbe,
                                }} title={expert.name}>
                                  {expert.avatar}
                                </div>
                              )}
                              {/* Delete button — visible on hover via CSS */}
                              <button
                                className="card-delete-btn"
                                title={i18n.language === 'de' ? 'Aufgabe löschen' : 'Delete task'}
                                onClick={(e) => deleteTask(a.id, e)}
                                style={{
                                  padding: '0.2rem 0.3rem', borderRadius: '6px',
                                  border: '1px solid rgba(239,68,68,0.2)', background: 'transparent',
                                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                                  color: '#52525b', transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#52525b'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'; }}
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          </GlassCard>
                        );
                      })}
                      {hiddenCount > 0 && (
                        <button
                          onClick={() => setColumnLimit(prev => ({ ...prev, [spalte.key]: (prev[spalte.key] ?? COLUMN_PAGE_SIZE) + COLUMN_PAGE_SIZE }))}
                          style={{
                            width: '100%', padding: '0.5rem',
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '10px',
                            color: '#71717a', fontSize: '0.8125rem', cursor: 'pointer',
                            transition: 'color 0.15s, border-color 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#d4d4d8'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                        >
                          + {hiddenCount} {i18n.language === 'de' ? 'weitere' : 'more'}
                        </button>
                      )}
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          ) : ansicht === 'liste' ? (
            /* List View */
            <GlassCard style={{
              overflow: 'hidden',
              animation: 'fadeInUp 0.5s ease-out',
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                    <th style={{ padding: '0.75rem', width: 40 }}>
                      <button
                        onClick={selectedIds.size === filteredAufgaben.length ? clearSelection : selectAll}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: selectedIds.size > 0 ? '#23CDCB' : '#52525b', display: 'flex', padding: 2 }}
                      >
                        {selectedIds.size === filteredAufgaben.length && filteredAufgaben.length > 0 ? <CheckSquare2 size={15} /> : <Square size={15} />}
                      </button>
                    </th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{i18n.t.aufgaben.title}</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{i18n.t.experten.status}</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{i18n.t.aufgaben.prioritaet}</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{i18n.t.aufgaben.zugewiesen}</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{i18n.language === 'de' ? 'Erstellt' : 'Created'}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAufgaben.map((a) => {
                    const expert = findExpert(a.zugewiesenAn);
                    const rowChecked = selectedIds.has(a.id);
                    return (
                      <tr
                        key={a.id}
                        onClick={() => selectedIds.size === 0 && setSelectedAufgabeId(a.id)}
                        style={{
                          borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          backgroundColor: rowChecked ? 'rgba(35,205,202,0.05)' : 'transparent',
                        }}
                        onMouseEnter={(e) => {
                          if (!rowChecked) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'rgba(35, 205, 202, 0.05)';
                        }}
                        onMouseLeave={(e) => {
                          if (!rowChecked) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = 'transparent';
                        }}
                      >
                        <td style={{ padding: '0.75rem', width: 40 }} onClick={e => e.stopPropagation()}>
                          <button
                            onClick={e => toggleSelect(a.id, e)}
                            style={{
                              background: rowChecked ? '#23CDCB' : 'none', border: `1px solid ${rowChecked ? '#23CDCB' : 'rgba(255,255,255,0.12)'}`,
                              borderRadius: '6px', width: 20, height: 20, cursor: 'pointer', padding: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: rowChecked ? '#000' : '#52525b', transition: 'all 0.15s',
                            }}
                          >
                            {rowChecked && <CheckSquare2 size={12} />}
                          </button>
                        </td>
                        <td style={{ padding: '1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#ffffff' }}>{a.titel}</span>
                            {a.isMaximizerMode && (
                              <span style={{
                                padding: '0.125rem 0.375rem', borderRadius: '4px',
                                background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)',
                                color: '#ef4444', fontSize: '0.625rem', fontWeight: 700,
                                display: 'flex', alignItems: 'center', gap: '0.2rem',
                                boxShadow: '0 0 6px rgba(239, 68, 68, 0.2)',
                              }}>
                                <Zap size={10} fill="#ef4444" /> MAX
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '1rem' }}><StatusBadge status={a.status} /></td>
                        <td style={{ padding: '1rem' }}>
                          <span style={{
                            padding: '0.25rem 0.5rem',
                            backgroundColor: a.prioritaet === 'critical' ? 'rgba(239, 68, 68, 0.1)' :
                              a.prioritaet === 'high' ? 'rgba(234, 179, 8, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                            border: `1px solid ${a.prioritaet === 'critical' ? '#ef4444' : a.prioritaet === 'high' ? '#eab308' : 'rgba(255, 255, 255, 0.1)'}`,
                            borderRadius: '6px',
                            fontSize: '0.75rem',
                            color: a.prioritaet === 'critical' ? '#ef4444' : a.prioritaet === 'high' ? '#eab308' : '#71717a',
                          }}>
                            {i18n.t.priority[a.prioritaet]}
                          </span>
                        </td>
                        <td style={{ padding: '1rem' }}>
                          {expert ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <div style={{
                                width: '24px',
                                height: '24px',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.625rem',
                                fontWeight: 600,
                                background: expert.avatarFarbe + '22',
                                color: expert.avatarFarbe,
                              }}>{expert.avatar}</div>
                              <span style={{ fontSize: '0.8125rem', color: '#d4d4d8' }}>{expert.name}</span>
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.8125rem', color: '#71717a' }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '1rem', fontSize: '0.8125rem', color: '#71717a' }}>{zeitRelativ(a.erstelltAm, i18n.t)}</td>
                        <td style={{ padding: '0.5rem 1rem' }}>
                          <button
                            title={i18n.language === 'de' ? 'Aufgabe löschen' : 'Delete task'}
                            onClick={(e) => deleteTask(a.id, e)}
                            style={{
                              padding: '0.25rem 0.5rem', borderRadius: '8px',
                              border: '1px solid rgba(239,68,68,0.2)', background: 'transparent',
                              cursor: 'pointer', color: '#52525b', transition: 'all 0.15s',
                              display: 'flex', alignItems: 'center',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.12)'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#52525b'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'; }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </GlassCard>
          ) : (
            /* Timeline / Gantt View */
            <TimelineView
              aufgaben={filteredAufgaben}
              experten={alleExperten || []}
              lang={i18n.language}
              onSelect={id => setSelectedAufgabeId(id)}
              i18n={i18n.t}
            />
          )}


      </div>

      {/* Floating Batch Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '2rem',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          background: 'rgba(10, 10, 20, 0.96)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          border: '1px solid rgba(35, 205, 202, 0.25)',
          borderRadius: '20px',
          padding: '0.75rem 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.875rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 0 30px rgba(35,205,202,0.08)',
          animation: 'slideUp 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
          whiteSpace: 'nowrap',
        }}>
          {/* Count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{
              width: 28, height: 28, borderRadius: '8px',
              background: 'rgba(35,205,202,0.15)', border: '1px solid rgba(35,205,202,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.75rem', fontWeight: 700, color: '#23CDCB',
            }}>{selectedIds.size}</div>
            <span style={{ fontSize: '0.8125rem', color: '#a1a1aa', fontWeight: 500 }}>
              {i18n.language === 'de' ? 'ausgewählt' : 'selected'}
            </span>
          </div>

          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />

          {/* Status change */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <ArrowRight size={12} style={{ color: '#52525b' }} />
            <select
              disabled={batchLoading}
              onChange={e => { if (e.target.value) batchUpdate({ status: e.target.value }); e.target.value = ''; }}
              defaultValue=""
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px', color: '#d4d4d8', padding: '0.375rem 0.625rem',
                fontSize: '0.8125rem', cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="" disabled>{i18n.language === 'de' ? 'Status…' : 'Status…'}</option>
              <option value="backlog">{i18n.t.status.backlog}</option>
              <option value="todo">{i18n.t.status.todo}</option>
              <option value="in_progress">{i18n.t.status.in_progress}</option>
              <option value="in_review">{i18n.t.status.in_review}</option>
              <option value="done">{i18n.t.status.done}</option>
              <option value="blocked">{i18n.t.status.blocked}</option>
            </select>
          </div>

          {/* Priority change */}
          <select
            disabled={batchLoading}
            onChange={e => { if (e.target.value) batchUpdate({ prioritaet: e.target.value }); e.target.value = ''; }}
            defaultValue=""
            style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', color: '#d4d4d8', padding: '0.375rem 0.625rem',
              fontSize: '0.8125rem', cursor: 'pointer', outline: 'none',
            }}
          >
            <option value="" disabled>{i18n.language === 'de' ? 'Priorität…' : 'Priority…'}</option>
            <option value="critical">{i18n.t.priority.critical}</option>
            <option value="high">{i18n.t.priority.high}</option>
            <option value="medium">{i18n.t.priority.medium}</option>
            <option value="low">{i18n.t.priority.low}</option>
          </select>

          {/* Assign agent */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <UserCheck size={14} style={{ color: '#52525b' }} />
            <select
              disabled={batchLoading}
              onChange={e => { if (e.target.value) batchUpdate({ zugewiesenAn: e.target.value === '__none' ? null : e.target.value }); e.target.value = ''; }}
              defaultValue=""
              style={{
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '10px', color: '#d4d4d8', padding: '0.375rem 0.625rem',
                fontSize: '0.8125rem', cursor: 'pointer', outline: 'none',
              }}
            >
              <option value="" disabled>{i18n.language === 'de' ? 'Agent…' : 'Agent…'}</option>
              <option value="__none">{i18n.language === 'de' ? 'Nicht zuweisen' : 'Unassign'}</option>
              {(alleExperten || []).map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>

          <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.1)' }} />

          {/* Delete */}
          <button
            onClick={batchDelete}
            disabled={batchLoading}
            style={{
              padding: '0.375rem 0.75rem',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '10px', color: '#ef4444',
              fontSize: '0.8125rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.375rem',
              opacity: batchLoading ? 0.5 : 1,
            }}
          >
            <Trash2 size={13} />
            {i18n.language === 'de' ? 'Löschen' : 'Delete'}
          </button>

          {/* Cancel */}
          <button
            onClick={clearSelection}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#52525b', padding: '0.25rem',
              display: 'flex', alignItems: 'center', transition: 'color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = '#d4d4d8'}
            onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
          >
            <XIcon size={16} />
          </button>

          {batchLoading && (
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: '#23CDCB' }} />
          )}
        </div>
      )}

      {/* Task Detail Drawer */}
      {selectedAufgabe && aktivesUnternehmen && (
        <TaskDetailDrawer
          aufgabe={selectedAufgabe}
          experten={alleExperten || []}
          alleAufgaben={alleAufgaben || []}
          unternehmenId={aktivesUnternehmen.id}
          onClose={() => setSelectedAufgabeId(null)}
          onChanged={() => {
            reloadAufgaben();
            // Refresh the selected task from the updated list
          }}
        />
      )}
    </>
  );
}
