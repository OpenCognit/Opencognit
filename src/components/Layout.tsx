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
            color: isActive ? '#23CDCB' : '#52525b',
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
            borderRadius: '20px 20px 0 0', padding: '1rem 1rem calc(1rem + env(safe-area-inset-bottom))',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <span style={{ fontWeight: 700, color: '#fff', fontSize: '1rem' }}>Navigation</span>
              <button onClick={() => setDrawerOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#71717a' }}>
                <X size={20} />
              </button>
            </div>
            {[
              { to: '/focus', label: 'Focus Mode' },
              { to: '/intelligence', label: 'Intelligence' },
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
                display: 'block', padding: '0.75rem 1rem', borderRadius: '10px',
                textDecoration: 'none', marginBottom: '0.25rem',
                background: isActive ? 'rgba(35,205,202,0.08)' : 'transparent',
                color: isActive ? '#23CDCB' : '#a1a1aa',
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
          background: 'rgba(35, 205, 202, 0.35)',
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
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!aktivesUnternehmen) return;
    const token = localStorage.getItem('opencognit_token');
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.hostname}:3201/ws${token ? `?token=${token}` : ''}`);
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.unternehmenId && msg.unternehmenId !== aktivesUnternehmen.id) return;

        switch (msg.type) {
          case 'task_completed':
            toast.agent(
              msg.agentName ? `${msg.agentName} hat Aufgabe erledigt` : 'Aufgabe abgeschlossen',
              msg.taskTitel || undefined,
              () => navigate('/tasks'),
            );
            break;
          case 'task_started':
            toast.toast({
              type: 'agent',
              title: msg.agentName ? `⚡ ${msg.agentName} arbeitet jetzt` : '⚡ Agent gestartet',
              message: msg.taskTitel || undefined,
              duration: 10000,
              onClick: () => navigate('/war-room'),
            });
            break;
          case 'approval_needed':
            toast.warning(
              'Genehmigung erforderlich',
              msg.taskTitel || 'Ein Agent wartet auf Freigabe',
              () => navigate('/approvals'),
            );
            break;
          case 'goal_achieved':
            toast.success(
              msg.zielTitel ? `Ziel erreicht: ${msg.zielTitel}` : 'Ziel erreicht!',
              'Alle verknüpften Aufgaben wurden abgeschlossen.',
              () => navigate('/goals'),
            );
            break;
          case 'budget_warning':
            toast.warning(
              'Budget-Warnung',
              msg.message || 'Ein Agent nähert sich dem Budget-Limit',
              () => navigate('/costs'),
            );
            break;
          case 'expert_deleted':
            toast.info(
              msg.name ? `${msg.name} entlassen` : 'Agent entlassen',
              undefined,
              () => navigate('/experts'),
            );
            break;
          case 'tasks_unblocked': {
            const n = msg.taskIds?.length || 0;
            if (n > 0) toast.info(
              `${n} Aufgabe${n > 1 ? 'n' : ''} entsperrt`,
              'Blockierte Aufgaben sind wieder verfügbar',
              () => navigate('/tasks'),
            );
            break;
          }
          case 'meeting_created':
            toast.agent(
              'Meeting gestartet',
              msg.titel || 'Agenten halten eine Besprechung',
              () => navigate('/meetings'),
            );
            break;
          case 'meeting_updated':
            if (msg.status === 'completed') {
              toast.success(
                'Meeting abgeschlossen',
                msg.titel || undefined,
                () => navigate('/meetings'),
              );
            }
            break;
          case 'agents_imported': {
            const count = msg.agentsCreated || 0;
            if (count > 0) toast.success(
              `${count} Agent${count > 1 ? 'en' : ''} importiert`,
              msg.templateName || undefined,
              () => navigate('/experts'),
            );
            break;
          }
          case 'routine_executed':
            toast.info(
              msg.routineTitel || 'Routine ausgeführt',
              msg.result || undefined,
              () => navigate('/routines'),
            );
            break;
          case 'task_escalated':
            toast.warning(
              `🚨 Task eskaliert`,
              msg.taskTitel
                ? `"${msg.taskTitel}" ist ${msg.failureCount}× fehlgeschlagen${msg.orchestratorName ? ` → ${msg.orchestratorName} informiert` : ''}`
                : 'Ein Task wurde nach wiederholten Fehlern eskaliert',
              () => navigate('/tasks'),
            );
            break;
        }
      } catch {}
    };

    return () => { ws.close(); wsRef.current = null; };
  }, [aktivesUnternehmen?.id]);
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
