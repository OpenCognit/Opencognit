import { useState, useEffect, useMemo, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useApprovalNotifier } from '../hooks/useApprovalCount';
import { CommandPalette } from './CommandPalette';
import { KeyboardShortcutPanel } from './KeyboardShortcutPanel';
import { WorkspaceAssistant } from './WorkspaceAssistant';
import { LayoutDashboard, Building2, Users, ListTodo, Settings, X, Menu } from 'lucide-react';
import { useI18n } from '../i18n';
import { useToast } from './ToastProvider';
import { useCompany } from '../hooks/useCompany';

function MobileNav() {
  const { t } = useI18n();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, []);

  const bottomItems = [
    { to: '/', icon: LayoutDashboard, label: 'Home' },
    { to: '/companies', icon: Building2, label: 'Companies' },
    { to: '/experts', icon: Users, label: 'Agents' },
    { to: '/tasks', icon: ListTodo, label: 'Tasks' },
    { to: '/settings', icon: Settings, label: 'Settings' },
  ];

  return (
    <>
      {/* Bottom Tab Bar */}
      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
        display: 'flex', alignItems: 'stretch',
        background: 'rgba(10,10,12,0.95)', backdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}>
        {bottomItems.map(item => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} style={({ isActive }) => ({
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 3, padding: '0.5rem 0.25rem',
            textDecoration: 'none', transition: 'all 0.2s',
            color: isActive ? '#c5a059' : '#52525b',
            fontSize: '0.6rem', fontWeight: 600,
          })}>
            <item.icon size={20} />
            {item.label}
          </NavLink>
        ))}
        <button onClick={() => setDrawerOpen(true)} style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 3, padding: '0.5rem 0.25rem',
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#52525b', fontSize: '0.6rem', fontWeight: 600,
        }}>
          <Menu size={20} />
          More
        </button>
      </nav>

      {/* Full-Screen Drawer for more nav items */}
      {drawerOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 300,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
        }} onClick={() => setDrawerOpen(false)}>
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            background: 'rgba(10,10,12,0.98)', borderTop: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '0', padding: '1rem 1rem calc(1rem + env(safe-area-inset-bottom))',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span style={{ fontWeight: 700, color: '#fff', fontSize: '1rem' }}>Navigation</span>
              <button onClick={() => setDrawerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#71717a' }}>
                <X size={20} />
              </button>
            </div>
            {[
              { to: '/focus', label: 'Focus Mode' },
              { to: '/company-knowledge', label: 'Knowledge' },
              { to: '/goals', label: 'Goals' },
              { to: '/projects', label: 'Projects' },
              { to: '/meetings', label: 'Meetings' },
              { to: '/routines', label: 'Routines' },
              { to: '/skill-library', label: 'Skill Library' },
              { to: '/org-chart', label: 'Org Chart' },
              { to: '/costs', label: 'Costs' },
              { to: '/approvals', label: 'Approvals' },
              { to: '/activity', label: 'Activity' },
            ].map(item => (
              <NavLink key={item.to} to={item.to} onClick={() => setDrawerOpen(false)} style={({ isActive }) => ({
                display: 'block', padding: '0.75rem 1rem', borderRadius: 0,
                textDecoration: 'none', marginBottom: '0.25rem',
                background: isActive ? 'rgba(197,160,89,0.08)' : 'transparent',
                color: isActive ? '#c5a059' : '#a1a1aa',
                fontWeight: 600, fontSize: '0.875rem',
              })}>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// Shared background decoration rendered once for all pages
function GlobalBackground() {
  const particles = useMemo(() => Array.from({ length: 18 }, () => ({
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    size: 2 + Math.random() * 3,
    delay: Math.random() * 5,
    duration: 7 + Math.random() * 6,
  })), []);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="global-grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="rgba(56, 189, 248, 0.06)" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#global-grid)" />
      </svg>
      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute',
          width: `${p.size}px`, height: `${p.size}px`,
          background: 'rgba(197, 160, 89, 0.35)',
          borderRadius: '50%',
          top: p.top, left: p.left,
          animation: `float ${p.duration}s ease-in-out infinite`,
          animationDelay: `${p.delay}s`,
        }} />
      ))}
    </div>
  );
}

function useAgentNotifications() {
  const toast = useToast();
  const navigate = useNavigate();
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const de = language === 'de';
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!aktivesUnternehmen) return;
    const token = localStorage.getItem('opencognit_token');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws${token ? `?token=${token}` : ''}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.unternehmenId && msg.unternehmenId !== aktivesUnternehmen.id) return;

        switch (msg.type) {
          case 'task_completed':
            toast.agent(
              msg.agentName
                ? (de ? `✅ ${msg.agentName} hat Aufgabe erledigt` : `✅ ${msg.agentName} completed a task`)
                : (de ? '✅ Aufgabe abgeschlossen' : '✅ Task completed'),
              msg.taskTitel || undefined,
              () => navigate('/tasks'),
            );
            break;
          case 'task_started':
            toast.toast({
              type: 'agent',
              title: msg.agentName
                ? (de ? `⚡ ${msg.agentName} arbeitet jetzt` : `⚡ ${msg.agentName} is working now`)
                : (de ? '⚡ Agent gestartet' : '⚡ Agent started'),
              message: msg.taskTitel || undefined,
              duration: 10000,
              onClick: () => navigate('/war-room'),
            });
            break;
          case 'task_updated': {
            const statusLabels: Record<string, string> = {
              done: de ? '✅ Erledigt' : '✅ Done',
              in_progress: de ? '🔄 In Bearbeitung' : '🔄 In Progress',
              todo: de ? '📋 Todo' : '📋 Todo',
              blocked: de ? '🚫 Blockiert' : '🚫 Blocked',
              cancelled: de ? '❌ Abgebrochen' : '❌ Cancelled',
            };
            const statusLabel = statusLabels[msg.status] || msg.status;
            toast.info(
              de ? `Task aktualisiert: ${statusLabel}` : `Task updated: ${statusLabel}`,
              msg.taskTitel || undefined,
              () => navigate('/tasks'),
            );
            break;
          }
          case 'task_deleted':
            toast.info(
              de ? '🗑️ Task gelöscht' : '🗑️ Task deleted',
              msg.taskTitel || undefined,
              () => navigate('/tasks'),
            );
            break;
          case 'approval_needed':
            toast.warning(
              de ? '⚖️ Genehmigung erforderlich' : '⚖️ Approval required',
              msg.taskTitel || (de ? 'Ein Agent wartet auf Freigabe' : 'An agent is waiting for approval'),
              () => navigate('/approvals'),
            );
            break;
          case 'approval_requested': {
            const approvalTitel = msg.data?.titel || msg.titel;
            const approvalTyp = msg.data?.typ || msg.typ;
            const typeLabels: Record<string, string> = {
              hire_expert: de ? '🧑‍💼 Neueinstellung' : '🧑‍💼 Hiring',
              approve_strategy: de ? '🎯 Strategie' : '🎯 Strategy',
              budget_change: de ? '💰 Budget' : '💰 Budget',
              agent_action: de ? '🤖 Agent-Aktion' : '🤖 Agent Action',
            };
            toast.warning(
              `${typeLabels[approvalTyp] || (de ? '⚖️ Genehmigung' : '⚖️ Approval')}: ${approvalTitel || (de ? 'Freigabe angefordert' : 'Approval requested')}`,
              msg.data?.beschreibung || msg.beschreibung || (de ? 'Zum Genehmigen klicken' : 'Click to review'),
              () => navigate('/approvals'),
            );
            break;
          }
          case 'approval_updated': {
            const isApproved = msg.data?.status === 'approved' || msg.status === 'approved';
            const approvalTitle = msg.data?.titel || msg.titel;
            if (isApproved) {
              toast.success(
                de ? '✅ Genehmigt' : '✅ Approved',
                approvalTitle || (de ? 'Die Freigabe wurde erteilt' : 'Approval has been granted'),
                () => navigate('/approvals'),
              );
            } else {
              toast.info(
                de ? '❌ Abgelehnt' : '❌ Rejected',
                approvalTitle || (de ? 'Die Freigabe wurde abgelehnt' : 'Approval was rejected'),
                () => navigate('/approvals'),
              );
            }
            break;
          }
          case 'goal_achieved':
            toast.success(
              msg.zielTitel
                ? (de ? `🎯 Ziel erreicht: ${msg.zielTitel}` : `🎯 Goal achieved: ${msg.zielTitel}`)
                : (de ? '🎯 Ziel erreicht!' : '🎯 Goal achieved!'),
              de ? 'Alle verknüpften Aufgaben wurden abgeschlossen.' : 'All linked tasks have been completed.',
              () => navigate('/goals'),
            );
            break;
          case 'budget_warning':
            toast.warning(
              de ? '💰 Budget-Warnung' : '💰 Budget warning',
              msg.message || (de ? 'Ein Agent nähert sich dem Budget-Limit' : 'An agent is approaching the budget limit'),
              () => navigate('/costs'),
            );
            break;
          case 'expert_deleted':
            toast.info(
              msg.name
                ? (de ? `🗑️ ${msg.name} entlassen` : `🗑️ ${msg.name} dismissed`)
                : (de ? '🗑️ Agent entlassen' : '🗑️ Agent dismissed'),
              undefined,
              () => navigate('/experts'),
            );
            break;
          case 'expert_created': {
            const expertName = msg.data?.name || msg.name;
            toast.success(
              de ? `🤖 Agent erstellt: ${expertName}` : `🤖 Agent created: ${expertName}`,
              msg.data?.rolle || msg.rolle || undefined,
              () => navigate('/experts'),
            );
            break;
          }
          case 'tasks_unblocked': {
            const n = msg.taskIds?.length || 0;
            if (n > 0) toast.info(
              de ? `🔓 ${n} Aufgabe${n > 1 ? 'n' : ''} entsperrt` : `🔓 ${n} task${n > 1 ? 's' : ''} unblocked`,
              de ? 'Blockierte Aufgaben sind wieder verfügbar' : 'Blocked tasks are available again',
              () => navigate('/tasks'),
            );
            break;
          }
          case 'meeting_created':
            toast.agent(
              de ? '💬 Meeting gestartet' : '💬 Meeting started',
              msg.titel || (de ? 'Agenten halten eine Besprechung' : 'Agents are holding a meeting'),
              () => navigate('/meetings'),
            );
            break;
          case 'meeting_updated':
            if (msg.status === 'completed') {
              toast.success(
                de ? '💬 Meeting abgeschlossen' : '💬 Meeting completed',
                msg.titel || undefined,
                () => navigate('/meetings'),
              );
            } else if (msg.status === 'cancelled') {
              toast.info(
                de ? '💬 Meeting abgebrochen' : '💬 Meeting cancelled',
                msg.titel || undefined,
                () => navigate('/meetings'),
              );
            }
            break;
          case 'meeting_deleted':
            toast.info(
              de ? '🗑️ Meeting gelöscht' : '🗑️ Meeting deleted',
              msg.titel || undefined,
              () => navigate('/meetings'),
            );
            break;
          case 'agents_imported': {
            const count = msg.agentsCreated || 0;
            if (count > 0) toast.success(
              de ? `📥 ${count} Agent${count > 1 ? 'en' : ''} importiert` : `📥 ${count} agent${count > 1 ? 's' : ''} imported`,
              msg.templateName || undefined,
              () => navigate('/experts'),
            );
            break;
          }
          case 'company_imported': {
            const imported = msg.agentsImported || 0;
            toast.success(
              de ? '📥 Import abgeschlossen' : '📥 Import completed',
              imported > 0
                ? (de ? `${imported} Agenten importiert` : `${imported} agents imported`)
                : undefined,
              () => navigate('/experts'),
            );
            break;
          }
          case 'routine_executed':
            toast.info(
              de ? '⏰ Routine ausgeführt' : '⏰ Routine executed',
              msg.routineTitel || msg.result || undefined,
              () => navigate('/routines'),
            );
            break;
          case 'memory_cleared':
            toast.info(
              de ? '🧠 Memory gelöscht' : '🧠 Memory cleared',
              msg.expertName || (de ? 'Der Agent hat sein Kurzzeitgedächtnis zurückgesetzt' : 'The agent reset its short-term memory'),
              () => navigate('/experts'),
            );
            break;
          case 'task_escalated':
            toast.warning(
              de ? `🚨 Task eskaliert` : `🚨 Task escalated`,
              msg.taskTitel
                ? (de
                    ? `"${msg.taskTitel}" ist ${msg.failureCount}× fehlgeschlagen${msg.orchestratorName ? ` → ${msg.orchestratorName} informiert` : ''}`
                    : `"${msg.taskTitel}" failed ${msg.failureCount}×${msg.orchestratorName ? ` → ${msg.orchestratorName} notified` : ''}`)
                : (de ? 'Ein Task wurde nach wiederholten Fehlern eskaliert' : 'A task was escalated after repeated failures'),
              () => navigate('/tasks'),
            );
            break;
        }
      } catch {}
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CLOSING) {
        ws.close();
      }
      wsRef.current = null;
    };
  }, [aktivesUnternehmen?.id, de]);
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useApprovalNotifier();
  useAgentNotifications();

  const [commandOpen, setCommandOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Global "?" shortcut to open keyboard shortcuts panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '?' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setShortcutsOpen(p => !p);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="app-layout" style={{ position: 'relative' }}>
      <GlobalBackground />
      {!isMobile && (
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} onSearchClick={() => setCommandOpen(true)} />
      )}
      <main
        className="app-main"
        style={{
          marginLeft: isMobile ? 0 : (collapsed ? '80px' : '280px'),
          paddingBottom: isMobile ? '72px' : 0,
          position: 'relative',
        }}
      >
        <TopBar onSearchClick={() => setCommandOpen(true)} />
        <div className="app-content">
          <Outlet />
        </div>
      </main>
      {isMobile && <MobileNav />}
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      <KeyboardShortcutPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {!isMobile && <WorkspaceAssistant />}
    </div>
  );
}
