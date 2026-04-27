import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Building2, Users, CheckSquare, GitGraph,
  DollarSign, FileCheck, Activity, Settings, Globe,
  Search, FolderOpen, Clock, X, Brain, Target, MessagesSquare, BookOpen,
  Zap, Loader2, CheckCircle2, Trophy, MonitorPlay, ListTodo, User, Flag,
} from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';
import { authFetch } from '../utils/api';

interface SearchEntity {
  id: string;
  label: string;
  sublabel?: string;
  group: string;
  icon: React.ElementType;
  color: string;
  onSelect: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#eab308', medium: '#c5a059', low: '#71717a',
};
const STATUS_COLORS: Record<string, string> = {
  backlog: '#71717a', todo: '#3b82f6', in_progress: '#c5a059',
  in_review: '#eab308', done: '#22c55e', blocked: '#ef4444',
};

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { unternehmenListe, aktivesUnternehmen, wechselUnternehmen } = useCompany();
  const { t, language, setLanguage } = useI18n();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Quick Task mode: triggered when query starts with ">"
  const isQuickTask = query.startsWith('>');
  const taskTitle = query.slice(1).trimStart();
  const [taskState, setTaskState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [taskResult, setTaskResult] = useState<{ agentName: string; taskId: string } | null>(null);

  // Global search data (fetched once when palette opens with a company)
  const [searchData, setSearchData] = useState<{ aufgaben: any[]; experten: any[]; ziele: any[] } | null>(null);
  const [loadingSearch, setLoadingSearch] = useState(false);

  const navItems = [
    { label: t.nav.dashboard, href: '/', icon: LayoutDashboard, group: 'Navigation' },
    { label: t.nav.unternehmen, href: '/companies', icon: Building2, group: 'Navigation' },
    { label: t.nav.experten, href: '/experts', icon: Users, group: 'Navigation' },
    { label: language === 'de' ? 'Wissensbasis' : 'Knowledge', href: '/company-knowledge', icon: Brain, group: 'Navigation' },
    { label: t.nav.ziele, href: '/goals', icon: Target, group: 'Navigation' },
    { label: t.nav.projekte, href: '/projects', icon: FolderOpen, group: 'Navigation' },
    { label: t.nav.aufgaben, href: '/tasks', icon: CheckSquare, group: 'Navigation' },
    { label: t.nav.routinen, href: '/routines', icon: Clock, group: 'Navigation' },
    { label: t.nav.meetings, href: '/meetings', icon: MessagesSquare, group: 'Navigation' },
    { label: t.nav.skillLibrary, href: '/skill-library', icon: BookOpen, group: 'Navigation' },
    { label: t.nav.organigramm, href: '/org-chart', icon: GitGraph, group: 'Navigation' },
    { label: t.nav.kosten, href: '/costs', icon: DollarSign, group: 'Navigation' },
    { label: t.nav.genehmigungen, href: '/approvals', icon: FileCheck, group: 'Navigation' },
    { label: t.nav.aktivitaet, href: '/activity', icon: Activity, group: 'Navigation' },
    { label: language === 'de' ? 'Performance' : 'Performance', href: '/performance', icon: Trophy, group: 'Navigation' },
    { label: language === 'de' ? 'Live Room' : 'Live Room', href: '/war-room', icon: MonitorPlay, group: 'Navigation' },
    { label: t.nav.einstellungen, href: '/settings', icon: Settings, group: 'Navigation' },
  ];

  const companyItems = (unternehmenListe ?? []).map(u => ({
    label: u.name,
    href: null as string | null,
    icon: Building2,
    group: language === 'de' ? 'Unternehmen wechseln' : 'Switch Company',
    onSelect: () => { wechselUnternehmen(u.id); onOpenChange(false); },
    isActive: aktivesUnternehmen?.id === u.id,
  }));

  const langAction = {
    label: language === 'de' ? '🇬🇧 Switch to English' : '🇩🇪 Wechsel zu Deutsch',
    href: null as string | null,
    icon: Globe,
    group: language === 'de' ? 'Aktionen' : 'Actions',
    onSelect: () => { setLanguage(language === 'de' ? 'en' : 'de'); onOpenChange(false); },
    isActive: false,
  };

  // Entity search results (tasks, agents, goals)
  const entityResults = useMemo((): SearchEntity[] => {
    if (!query.trim() || query.trim().length < 2 || isQuickTask || !searchData) return [];
    const q = query.toLowerCase();

    const results: SearchEntity[] = [];

    // Tasks
    searchData.aufgaben
      .filter(a => a.titel?.toLowerCase().includes(q) || (a.beschreibung ?? '').toLowerCase().includes(q))
      .slice(0, 5)
      .forEach(a => {
        const statusColor = STATUS_COLORS[a.status] ?? '#71717a';
        results.push({
          id: a.id,
          label: a.titel,
          sublabel: `${a.status} · ${a.prioritaet}`,
          group: language === 'de' ? 'Aufgaben' : 'Tasks',
          icon: ListTodo,
          color: PRIORITY_COLORS[a.prioritaet] ?? '#c5a059',
          onSelect: () => { navigate('/tasks', { state: { openTaskId: a.id } }); onOpenChange(false); },
        });
      });

    // Agents
    searchData.experten
      .filter(e => e.name?.toLowerCase().includes(q) || e.rolle?.toLowerCase().includes(q))
      .slice(0, 4)
      .forEach(e => {
        results.push({
          id: e.id,
          label: e.name,
          sublabel: e.rolle,
          group: language === 'de' ? 'Agenten' : 'Agents',
          icon: User,
          color: e.avatarFarbe || '#c5a059',
          onSelect: () => { navigate('/experts'); onOpenChange(false); },
        });
      });

    // Goals
    searchData.ziele
      .filter(z => z.titel?.toLowerCase().includes(q) || (z.beschreibung ?? '').toLowerCase().includes(q))
      .slice(0, 3)
      .forEach(z => {
        results.push({
          id: z.id,
          label: z.titel,
          sublabel: `${z.ebene} · ${z.fortschritt ?? 0}%`,
          group: language === 'de' ? 'Ziele' : 'Goals',
          icon: Target,
          color: '#9b87c8',
          onSelect: () => { navigate('/goals'); onOpenChange(false); },
        });
      });

    return results;
  }, [query, isQuickTask, searchData, language]);

  const allItems = useMemo(() => {
    const base = [
      langAction,
      ...navItems.map(item => ({ ...item, onSelect: () => { navigate(item.href); onOpenChange(false); }, isActive: false })),
      ...companyItems,
    ];
    if (!query.trim()) return base;
    const q = query.toLowerCase();
    return base.filter(item => item.label.toLowerCase().includes(q));
  }, [query, language, unternehmenListe, aktivesUnternehmen]);

  // Group items
  const grouped = useMemo(() => {
    const map = new Map<string, typeof allItems>();
    for (const item of allItems) {
      if (!map.has(item.group)) map.set(item.group, []);
      map.get(item.group)!.push(item);
    }
    return map;
  }, [allItems]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTaskState('idle');
      setTaskResult(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Fetch entity data for global search when palette opens
  useEffect(() => {
    if (!open || !aktivesUnternehmen || searchData || loadingSearch) return;
    setLoadingSearch(true);
    Promise.all([
      authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/aufgaben`).then(r => r.json()).catch(() => []),
      authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/experten`).then(r => r.json()).catch(() => []),
      authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/ziele`).then(r => r.json()).catch(() => []),
    ]).then(([aufgaben, experten, ziele]) => {
      setSearchData({
        aufgaben: Array.isArray(aufgaben) ? aufgaben : [],
        experten: Array.isArray(experten) ? experten : [],
        ziele: Array.isArray(ziele) ? ziele : [],
      });
    }).finally(() => setLoadingSearch(false));
  }, [open, aktivesUnternehmen?.id]);

  // Clear search data when company changes
  useEffect(() => {
    setSearchData(null);
  }, [aktivesUnternehmen?.id]);

  const handleQuickTask = async () => {
    if (!aktivesUnternehmen || !taskTitle.trim() || taskState !== 'idle') return;
    setTaskState('loading');
    try {
      // Create task
      const createRes = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/aufgaben`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titel: taskTitle.trim(),
          prioritaet: 'medium',
          status: 'todo',
        }),
      });
      if (!createRes.ok) throw new Error('Task creation failed');
      const task = await createRes.json();

      // Match best agent
      const matchRes = await authFetch('/api/aufgaben/match-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titel: taskTitle.trim(), unternehmenId: aktivesUnternehmen.id }),
      });
      if (matchRes.ok) {
        const { match } = await matchRes.json();
        if (match?.agentId) {
          // Assign task to matched agent
          await authFetch(`/api/aufgaben/${task.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zugewiesenAn: match.agentId }),
          });
          // Trigger agent wakeup so it picks up the task immediately
          authFetch(`/api/experten/${match.agentId}/wakeup`, { method: 'POST' }).catch(() => {});
          setTaskResult({ agentName: match.agentName || match.agentId, taskId: task.id });
        }
      }
      setTaskState('done');
      setTimeout(() => onOpenChange(false), 1500);
    } catch {
      setTaskState('error');
    }
  };

  // Global ⌘K shortcut
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
      if (!open) return;
      if (e.key === 'Escape') { onOpenChange(false); }
      if (e.key === 'ArrowDown' && !isQuickTask) { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, allItems.length - 1)); }
      if (e.key === 'ArrowUp' && !isQuickTask) { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (isQuickTask) handleQuickTask();
        else allItems[selectedIndex]?.onSelect();
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onOpenChange, allItems, selectedIndex]);

  if (!open) return null;

  let flatIndex = 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        zIndex: 9999,
      }}
      onClick={() => onOpenChange(false)}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          margin: '0 1rem',
          background: 'rgba(10, 10, 20, 0.95)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 0,
          overflow: 'hidden',
          boxShadow: '0 40px 100px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.08)',
          animation: 'slideDown 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          padding: '0.875rem 1rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}>
          <Search size={18} style={{ color: '#c5a059', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }}
            placeholder={language === 'de' ? 'Tippe einen Befehl oder suche...' : 'Type a command or search...'}
            style={{
              flex: 1,
              background: 'none',
              border: 'none',
              outline: 'none',
              color: '#ffffff',
              fontSize: '0.9375rem',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => onOpenChange(false)}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 0,
              color: '#71717a',
              cursor: 'pointer',
              padding: '2px 6px',
              fontSize: '11px',
              fontFamily: 'monospace',
              display: 'flex',
              alignItems: 'center',
              gap: '2px',
            }}
          >
            <X size={12} />
            <span>Esc</span>
          </button>
        </div>

        {/* Quick Task Panel */}
        {isQuickTask && (
          <div style={{
            padding: '1.25rem 1rem',
            background: 'rgba(197,160,89,0.04)',
            borderBottom: '1px solid rgba(197,160,89,0.12)',
          }}>
            {taskState === 'idle' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <Zap size={14} style={{ color: '#c5a059' }} />
                  <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#c5a059' }}>
                    {language === 'de' ? 'Sofort-Aufgabe' : 'Quick Task'}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#475569' }}>
                    {language === 'de' ? '— Drücke Enter zum Erstellen & Zuweisen' : '— Press Enter to create & assign'}
                  </span>
                </div>
                {taskTitle.trim() ? (
                  <div style={{
                    padding: '0.625rem 0.875rem', borderRadius: 0,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(197,160,89,0.2)',
                    fontSize: '0.9375rem', color: '#f1f5f9', fontWeight: 500,
                  }}>
                    {taskTitle}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8125rem', color: '#334155' }}>
                    {language === 'de' ? 'Aufgabe eingeben…' : 'Type your task…'}
                  </div>
                )}
              </div>
            )}
            {taskState === 'loading' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#c5a059' }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  {language === 'de' ? 'Erstelle Aufgabe & suche besten Agenten…' : 'Creating task & matching best agent…'}
                </span>
              </div>
            )}
            {taskState === 'done' && taskResult && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#22c55e' }}>
                <CheckCircle2 size={16} />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  {language === 'de'
                    ? `Aufgabe erstellt & ${taskResult.agentName} zugewiesen`
                    : `Task created & assigned to ${taskResult.agentName}`}
                </span>
              </div>
            )}
            {taskState === 'done' && !taskResult && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#22c55e' }}>
                <CheckCircle2 size={16} />
                <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  {language === 'de' ? 'Aufgabe erstellt!' : 'Task created!'}
                </span>
              </div>
            )}
            {taskState === 'error' && (
              <div style={{ fontSize: '0.875rem', color: '#ef4444' }}>
                {language === 'de' ? 'Fehler beim Erstellen der Aufgabe.' : 'Failed to create task.'}
              </div>
            )}
          </div>
        )}

        {/* Results */}
        <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
          {/* Entity search results */}
          {!isQuickTask && entityResults.length > 0 && (
            <>
              {Array.from(new Set(entityResults.map(r => r.group))).map(group => (
                <div key={group}>
                  <div style={{
                    padding: '0.5rem 1rem 0.25rem',
                    fontSize: '0.6875rem', fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '0.06em', color: '#52525b',
                  }}>
                    {group}
                  </div>
                  {entityResults.filter(r => r.group === group).map(item => (
                    <button
                      key={item.id}
                      onClick={item.onSelect}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.625rem 1rem',
                        background: 'transparent', border: 'none',
                        cursor: 'pointer', textAlign: 'left', transition: 'background 0.1s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(197,160,89,0.07)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{
                        width: 28, height: 28, borderRadius: 0, flexShrink: 0,
                        background: item.color + '18',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <item.icon size={14} style={{ color: item.color }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.875rem', color: '#f1f5f9', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.label}
                        </div>
                        {item.sublabel && (
                          <div style={{ fontSize: '0.6875rem', color: '#52525b', marginTop: 1 }}>
                            {item.sublabel}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
              {/* Separator before navigation results */}
              {allItems.length > 0 && (
                <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0.25rem 0' }} />
              )}
            </>
          )}

          {loadingSearch && !searchData && query.length >= 2 && !isQuickTask && (
            <div style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#52525b', fontSize: '0.8125rem' }}>
              <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
              {language === 'de' ? 'Suche…' : 'Searching…'}
            </div>
          )}

          {!isQuickTask && allItems.length === 0 && entityResults.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#71717a', fontSize: '0.875rem' }}>
              {language === 'de' ? 'Keine Ergebnisse gefunden.' : 'No results found.'}
            </div>
          ) : isQuickTask ? null : (
            Array.from(grouped.entries()).map(([group, items]) => (
              <div key={group}>
                <div style={{
                  padding: '0.5rem 1rem 0.25rem',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#52525b',
                }}>
                  {group}
                </div>
                {items.map(item => {
                  const idx = flatIndex++;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={item.label + group}
                      onClick={item.onSelect}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        padding: '0.625rem 1rem',
                        background: isSelected ? 'rgba(197, 160, 89, 0.1)' : 'transparent',
                        borderTop: 'none',
                        borderRight: 'none',
                        borderBottom: 'none',
                        borderLeft: isSelected ? '2px solid #c5a059' : '2px solid transparent',
                        cursor: 'pointer',
                        color: isSelected ? '#c5a059' : (item.isActive ? '#22c55e' : '#d4d4d8'),
                        fontSize: '0.875rem',
                        textAlign: 'left',
                        transition: 'background 0.1s',
                      }}
                    >
                      <item.icon size={16} style={{ flexShrink: 0, opacity: 0.8 }} />
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {item.isActive && (
                        <span style={{
                          fontSize: '0.6875rem',
                          padding: '2px 6px',
                          borderRadius: 0,
                          background: 'rgba(34, 197, 94, 0.15)',
                          color: '#22c55e',
                          border: '1px solid rgba(34, 197, 94, 0.3)',
                        }}>
                          {language === 'de' ? 'Aktiv' : 'Active'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.5rem 1rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex',
          gap: '1rem',
          fontSize: '0.6875rem',
          color: '#52525b',
          flexWrap: 'wrap',
        }}>
          <span><kbd style={{ fontFamily: 'monospace' }}>↑↓</kbd> {language === 'de' ? 'navigieren' : 'navigate'}</span>
          <span><kbd style={{ fontFamily: 'monospace' }}>↵</kbd> {language === 'de' ? 'öffnen' : 'open'}</span>
          <span><kbd style={{ fontFamily: 'monospace' }}>Esc</kbd> {language === 'de' ? 'schließen' : 'close'}</span>
          <span style={{ marginLeft: 'auto', color: '#334155' }}>
            <kbd style={{ fontFamily: 'monospace', color: '#c5a059' }}>&gt;</kbd>
            {' '}{language === 'de' ? 'Sofort-Aufgabe' : 'Quick Task'}
          </span>
        </div>
      </div>

    </div>
  );
}
