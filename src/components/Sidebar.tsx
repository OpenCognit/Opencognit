import { useMemo, useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Users, ListTodo, Building2,
  Wallet, ShieldCheck, Activity,
  Settings, LogOut, Globe, Brain, Database,
  ChevronLeft, ChevronRight, ChevronDown, Clock, FolderOpen, MessagesSquare, Target, Zap, BarChart3, Package, GitBranch, BookOpen, MessageSquare,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { useAuth } from '../hooks/useAuth';
import { useApprovalCount } from '../hooks/useApprovalCount';

export function Sidebar({ collapsed, onToggle, onSearchClick }: { collapsed: boolean; onToggle: () => void; onSearchClick: () => void }) {
  useCompany();
  const { benutzer, abmelden } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const de = language === 'de';
  const approvalCount = useApprovalCount();
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  // New-user state: no agents created yet
  const [hasAgents, setHasAgents] = useState(() => localStorage.getItem('oc_has_agents') === '1');

  // Listen for localStorage changes from Dashboard (e.g. agent created in another tab or after reload)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'oc_has_agents') setHasAgents(e.newValue === '1');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Poll once per minute so Sidebar catches up when Dashboard updates the same tab
  useEffect(() => {
    const id = setInterval(() => {
      setHasAgents(localStorage.getItem('oc_has_agents') === '1');
    }, 60000);
    return () => clearInterval(id);
  }, []);

  // Collapsible sections state (persisted in localStorage)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('sidebar-collapsed-sections');
      // "Mehr"/"More" is collapsed by default
      return saved ? new Set(JSON.parse(saved)) : new Set(['Mehr', 'More']);
    } catch { return new Set(['Mehr', 'More']); }
  });

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      localStorage.setItem('sidebar-collapsed-sections', JSON.stringify([...next]));
      return next;
    });
  };

  // Generate random particle positions once
  const particles = useMemo(() => Array.from({ length: 15 }, () => ({
    top: `${Math.random() * 100}%`,
    left: `${Math.random() * 100}%`,
    size: 1.5 + Math.random() * 2.5,
    delay: Math.random() * 4,
    duration: 6 + Math.random() * 6,
  })), []);

  const navItems = [
    // ── Tägliche Nutzung ──
    { section: de ? 'Betrieb' : 'Operations', items: [
      { to: '/chat',          icon: MessageSquare,   label: 'Chat',               tourStep: 'chat' },
      { to: '/',              icon: LayoutDashboard, label: t.nav.dashboard,      tourStep: 'dashboard' },
      { to: '/companies',     icon: Building2,       label: t.nav.unternehmen },
      { to: '/experts',       icon: Users,           label: t.nav.experten,       tourStep: 'experts' },
      { to: '/skill-library', icon: BookOpen,        label: t.nav.skillLibrary },
      { to: '/approvals',     icon: ShieldCheck,     label: t.nav.genehmigungen },
      { to: '/costs',         icon: Wallet,          label: t.nav.kosten },
      { to: '/org-chart',     icon: GitBranch,       label: t.nav.organigramm },
      { to: '/company-knowledge', icon: Brain,       label: de ? 'Wissensbasis' : 'Knowledge' },
      { to: '/memory',        icon: Database,        label: de ? 'Semantic Memory' : 'Semantic Memory' },
    ]},
    // ── Setup-Reihenfolge: was zuerst gemacht werden muss ──
    { section: de ? 'Einrichten' : 'Setup', items: [
      { to: '/settings',     icon: Settings,       label: de ? '1. API Keys & Einstellungen' : '1. API Keys & Settings' },
      { to: '/experts',      icon: Users,          label: de ? '2. Agenten anlegen' : '2. Create Agents' },
      { to: '/projects',     icon: FolderOpen,     label: de ? '3. Projekte anlegen' : '3. Create Projects' },
      { to: '/tasks',        icon: ListTodo,       label: de ? '4. Aufgaben erstellen' : '4. Create Tasks', tourStep: 'tasks' },
      { to: '/routines',     icon: Clock,          label: de ? '5. Routinen einrichten' : '5. Set up Routines' },
    ]},
    // ── Alles weitere ──
    { section: de ? 'Mehr' : 'More', items: [
      { to: '/goals',        icon: Target,         label: t.nav.ziele },
      { to: '/meetings',     icon: MessagesSquare, label: t.nav.meetings },
      { to: '/activity',     icon: Activity,       label: t.nav.aktivitaet },
      { to: '/weekly-report',icon: BarChart3,      label: t.nav.weeklyReport },
      { to: '/clipmart',     icon: Package,        label: 'CognitHub' },
      { to: '/plugins',      icon: Package,        label: de ? 'Plugins' : 'Plugins' },
      { to: '/workers',      icon: GitBranch,      label: de ? 'Worker-Nodes' : 'Worker Nodes' },
    ]},
  ];

  return (
    <aside style={{
      width: collapsed ? '80px' : '280px',
      background: 'transparent',
      borderRight: '1px solid rgba(255, 255, 255, 0.06)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      position: 'fixed',
      left: 0,
      top: 0,
      zIndex: 100,
      overflow: 'hidden',
      transition: 'width 0.3s ease',
    }}>
      {/* Background Particles */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5 }} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="sidebar-dash-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(56, 189, 248, 0.06)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#sidebar-dash-grid)" />
        </svg>
        {particles.map((p, i) => (
          <div key={i} style={{
            position: 'absolute',
            width: `${p.size}px`,
            height: `${p.size}px`,
            background: 'rgba(197, 160, 89, 0.3)',
            borderRadius: '50%',
            top: p.top,
            left: p.left,
            animation: `sidebar-float ${p.duration}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
          }} />
        ))}
      </div>

      {/* Logo */}
      <div style={{
        padding: '1.5rem 1rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        position: 'relative',
        zIndex: 1,
      }}>
        {!collapsed && (
          <>
            <span style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: '#ffffff',
              letterSpacing: '-0.02em',
              background: 'linear-gradient(to right, #c5a059, #ffffff)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              whiteSpace: 'nowrap',
            }}>
              {t.app.name}
            </span>
            <img src="/opencognit.svg" alt="OpenCognit" style={{ width: 56, height: 56, objectFit: 'contain' }} />
          </>
        )}
        {collapsed && (
          <img src="/opencognit.svg" alt="OpenCognit" style={{ width: 48, height: 48, objectFit: 'contain' }} />
        )}
        <button
          onClick={onToggle}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '28px',
            height: '28px',
            borderRadius: 0,
            background: 'rgba(197, 160, 89, 0.1)',
            border: '1px solid rgba(197, 160, 89, 0.2)',
            color: '#c5a059',
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(197, 160, 89, 0.2)';
            e.currentTarget.style.borderColor = 'rgba(197, 160, 89, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(197, 160, 89, 0.1)';
            e.currentTarget.style.borderColor = 'rgba(197, 160, 89, 0.2)';
          }}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '1rem', overflowY: 'auto', position: 'relative', zIndex: 1 }}>
        {navItems.map((section) => {
          const isCollapsed = !collapsed && collapsedSections.has(section.section);
          const isSetupSection = section.section === 'Einrichten' || section.section === 'Setup';
          const setupHighlight = isSetupSection && !hasAgents;
          return (
          <div key={section.section} style={{ marginBottom: '1.25rem' }}>
            {!collapsed && (
              <button
                onClick={() => toggleSection(section.section)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  background: setupHighlight ? 'rgba(197,160,89,0.05)' : 'none',
                  border: setupHighlight ? '1px solid rgba(197,160,89,0.15)' : '1px solid transparent',
                  borderRadius: 0,
                  cursor: 'pointer',
                  padding: setupHighlight ? '0.3rem 0.5rem' : '0 0.5rem',
                  marginBottom: '0.5rem',
                  gap: '0.25rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  {setupHighlight && (
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: '#c5a059',
                      boxShadow: '0 0 6px #c5a059',
                      animation: 'sidebar-float 2s ease-in-out infinite',
                      flexShrink: 0,
                    }} />
                  )}
                  <span style={{
                    fontSize: '0.6875rem',
                    fontWeight: 600,
                    color: setupHighlight ? '#c5a059' : '#71717a',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}>{section.section}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  {setupHighlight && (
                    <span style={{
                      fontSize: '0.5625rem', fontWeight: 700,
                      color: '#c5a059', letterSpacing: '0.04em',
                      opacity: 0.75,
                    }}>
                      {de ? 'START' : 'START'}
                    </span>
                  )}
                  <ChevronDown
                    size={12}
                    style={{
                      color: setupHighlight ? '#c5a059' : '#71717a',
                      flexShrink: 0,
                      transition: 'transform 0.2s ease',
                      transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                    }}
                  />
                </div>
              </button>
            )}
            <div style={{
              overflow: 'hidden',
              maxHeight: isCollapsed ? '0px' : '1000px',
              transition: 'max-height 0.25s ease',
            }}>
            {section.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                end={item.to === '/'}
                title={collapsed ? item.label : undefined}
                {...((item as any).tourStep ? { 'data-tour-step': (item as any).tourStep } : {})}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: collapsed ? '0.625rem' : '0.625rem 0.75rem',
                  marginBottom: '0.25rem',
                  borderRadius: 0,
                  textDecoration: 'none',
                  transition: 'all 0.2s',
                  backdropFilter: 'blur(10px)',
                  justifyContent: collapsed ? 'center' : 'flex-start',
                  position: 'relative',
                }}
              >
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <item.icon size={18} style={{ color: 'inherit' }} />
                  {/* Collapsed mode: dot above icon */}
                  {item.to === '/approvals' && approvalCount > 0 && collapsed && (
                    <span style={{
                      position: 'absolute',
                      top: -4,
                      right: -4,
                      width: 8,
                      height: 8,
                      background: '#ef4444',
                      borderRadius: '50%',
                      border: '1.5px solid rgba(10,10,20,0.9)',
                      animation: 'approval-pulse 2s infinite',
                    }} />
                  )}
                </div>
                {!collapsed && <span style={{ fontSize: '0.8125rem', whiteSpace: 'nowrap', flex: 1 }}>{item.label}</span>}
                {/* Expanded mode: badge with count */}
                {item.to === '/approvals' && approvalCount > 0 && !collapsed && (
                  <span style={{
                    minWidth: 20,
                    height: 20,
                    padding: '0 5px',
                    background: '#ef4444',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                    animation: 'approval-pulse 2s infinite',
                    flexShrink: 0,
                  }}>
                    {approvalCount > 99 ? '99+' : approvalCount}
                  </span>
                )}
              </NavLink>
            ))}
            </div>
          </div>
          );
        })}
      </nav>

      {/* Bottom Section — order: User → Settings → Language */}
      <div style={{
        padding: collapsed ? '0.75rem' : '1rem',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        position: 'relative',
        zIndex: 1,
      }}>
        {/* User Profile */}
        {benutzer && (
          <div
            title={collapsed ? benutzer.name : undefined}
            style={{
              display: collapsed ? 'none' : 'flex',
              alignItems: 'center',
              gap: '0.625rem',
              padding: '0.625rem 0.75rem',
              background: 'rgba(197, 160, 89, 0.06)',
              border: '1px solid rgba(197, 160, 89, 0.2)',
              borderRadius: 0,
              marginTop: '0.25rem',
              backdropFilter: 'blur(10px)',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(197, 160, 89, 0.1)';
              e.currentTarget.style.borderColor = 'rgba(197, 160, 89, 0.3)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(197, 160, 89, 0.06)';
              e.currentTarget.style.borderColor = 'rgba(197, 160, 89, 0.2)';
            }}
          >
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.6875rem',
              fontWeight: 700,
              background: 'rgba(197, 160, 89, 0.15)',
              border: '1px solid rgba(197, 160, 89, 0.3)',
              color: '#c5a059',
              flexShrink: 0,
            }}>
              {benutzer.name.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1, overflow: 'hidden', minWidth: 0 }}>
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {benutzer.name}
              </div>
              <div style={{ fontSize: '0.625rem', color: '#71717a', fontWeight: 500 }}>
                {benutzer.rolle === 'admin' ? 'Administrator' : 'Mitglied'}
              </div>
            </div>
            <button
              onClick={abmelden}
              title="Abmelden"
              style={{
                padding: '0.375rem',
                background: 'transparent',
                border: 'none',
                borderRadius: 0,
                color: '#71717a',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s',
                flexShrink: 0,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)';
                e.currentTarget.style.color = '#ef4444';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = '#71717a';
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        )}

        {/* Settings link — always visible at bottom */}
        <NavLink
          to="/settings"
          title={collapsed ? (de ? 'Einstellungen' : 'Settings') : undefined}
          style={({ isActive }) => ({
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: collapsed ? '0.625rem' : '0.625rem 0.75rem',
            justifyContent: collapsed ? 'center' : 'flex-start',
            borderRadius: 0,
            textDecoration: 'none',
            transition: 'all 0.2s',
            background: isActive ? 'rgba(197, 160, 89, 0.12)' : 'rgba(255, 255, 255, 0.02)',
            border: isActive ? '1px solid rgba(197, 160, 89, 0.3)' : '1px solid rgba(255, 255, 255, 0.06)',
            color: isActive ? '#c5a059' : '#a1a1aa',
            backdropFilter: 'blur(10px)',
            width: collapsed ? '40px' : '100%',
          })}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)';
            (e.currentTarget as HTMLElement).style.borderColor = 'rgba(197,160,89,0.2)';
            (e.currentTarget as HTMLElement).style.color = '#c5a059';
          }}
          onMouseLeave={(e) => {
            const active = e.currentTarget.classList.contains('active');
            (e.currentTarget as HTMLElement).style.background = active ? 'rgba(197,160,89,0.12)' : 'rgba(255,255,255,0.02)';
            (e.currentTarget as HTMLElement).style.borderColor = active ? 'rgba(197,160,89,0.3)' : 'rgba(255,255,255,0.06)';
            (e.currentTarget as HTMLElement).style.color = active ? '#c5a059' : '#a1a1aa';
          }}
        >
          <Settings size={18} />
          {!collapsed && <span style={{ fontSize: '0.8125rem', fontWeight: 500 }}>{de ? 'Einstellungen' : 'Settings'}</span>}
        </NavLink>

        {/* Language Switch */}
        <button
          onClick={() => setLanguage(language === 'de' ? 'en' : 'de')}
          title={collapsed ? (language === 'de' ? 'Deutsch' : 'English') : undefined}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: collapsed ? '0.625rem' : '0.625rem 0.75rem',
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            borderRadius: 0,
            color: '#a1a1aa',
            cursor: 'pointer',
            transition: 'all 0.2s',
            width: collapsed ? '40px' : '100%',
            justifyContent: collapsed ? 'center' : 'space-between',
            backdropFilter: 'blur(10px)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
            e.currentTarget.style.borderColor = 'rgba(197, 160, 89, 0.2)';
            e.currentTarget.style.color = '#c5a059';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
            e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)';
            e.currentTarget.style.color = '#a1a1aa';
          }}
        >
          <Globe size={18} />
          {!collapsed && (
            <>
              <span style={{ flex: 1, fontSize: '0.8125rem', fontWeight: 500 }}>{language === 'de' ? 'Deutsch' : 'English'}</span>
              <span style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: 0,
                background: 'rgba(197, 160, 89, 0.1)',
                color: '#c5a059',
                border: '1px solid rgba(197, 160, 89, 0.2)',
              }}>
                {language === 'de' ? 'EN' : 'DE'}
              </span>
            </>
          )}
        </button>
      </div>

    </aside>
  );
}
