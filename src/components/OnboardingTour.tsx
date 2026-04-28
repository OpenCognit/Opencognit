import { useState, useEffect, useCallback } from 'react';
import { ArrowRight, X, MessageSquare, LayoutDashboard, Building2, Users, BookOpen, ShieldCheck, Wallet, GitBranch, Brain, Layers, Key, Bot, FolderOpen, ListTodo, Zap, Target, CalendarDays, Activity, BarChart2, Store, Puzzle, Cpu, Rocket, ChevronLeft } from 'lucide-react';
import { useI18n } from '../i18n';

const STORAGE_KEY = 'oc_onboarding_tour_done';

interface TourStep {
  id: string;
  target?: string;
  icon: React.ElementType;
  label: string;
  title: string;
  description: string;
  group?: string;
}

function getSteps(de: boolean): TourStep[] {
  return [
    // ── Welcome ──────────────────────────────────────────────────────────────
    {
      id: 'welcome',
      icon: Rocket,
      label: de ? 'Willkommen' : 'Welcome',
      title: de ? 'Willkommen bei OpenCognit' : 'Welcome to OpenCognit',
      description: de
        ? 'Dein Kommandozentrum für autonome KI-Teams. Diese Tour zeigt dir alle Bereiche — du kannst sie jederzeit in den Settings wiederholen.'
        : 'Your command center for autonomous AI teams. This tour covers every area — you can replay it anytime in Settings.',
    },

    // ── Operations ───────────────────────────────────────────────────────────
    {
      id: 'chat',
      target: 'chat',
      icon: MessageSquare,
      group: 'Operations',
      label: 'Chat',
      title: de ? 'Chat — Direkt mit Agenten sprechen' : 'Chat — Talk directly to agents',
      description: de
        ? 'Schreibe deinem CEO oder jedem anderen Agenten direkt. Der CEO richtet auf Wunsch das ganze Team ein, erstellt Tasks und konfiguriert Routinen — einfach per Nachricht.'
        : 'Message your CEO or any agent directly. The CEO can set up your entire team, create tasks and configure routines — all via message.',
    },
    {
      id: 'dashboard',
      target: 'dashboard',
      icon: LayoutDashboard,
      group: 'Operations',
      label: 'Dashboard',
      title: de ? 'Dashboard — Echtzeit-Überblick' : 'Dashboard — Real-time overview',
      description: de
        ? 'Aktive Agenten, offene Tasks, Budget-Stand und Alerts auf einen Blick. Klickbare KPI-Kacheln führen direkt in den jeweiligen Bereich.'
        : 'Active agents, open tasks, budget status and alerts at a glance. Clickable KPI tiles lead directly to each section.',
    },
    {
      id: 'war-room',
      target: 'war-room',
      icon: LayoutDashboard,
      group: 'Operations',
      label: 'War Room',
      title: de ? 'War Room — Live-Monitor' : 'War Room — Live monitor',
      description: de
        ? 'Vollbild-Kommandozentrale: sieh in Echtzeit was jeder Agent gerade tut, jeden Token, jede Aktion. Ideal für die aktive Steuerung laufender Kampagnen.'
        : 'Full-screen command center: watch every agent action in real time, every token, every decision. Ideal for actively managing live operations.',
    },
    {
      id: 'companies',
      target: 'companies',
      icon: Building2,
      group: 'Operations',
      label: de ? 'Companies' : 'Companies',
      title: de ? 'Companies — Mehrere Workspaces' : 'Companies — Multiple workspaces',
      description: de
        ? 'Verwalte mehrere Unternehmen oder Projekte als getrennte Workspaces — jedes mit eigenen Agenten, Tasks, Budget und API-Keys.'
        : 'Manage multiple companies or projects as separate workspaces — each with its own agents, tasks, budget and API keys.',
    },
    {
      id: 'experts',
      target: 'experts',
      icon: Users,
      group: 'Operations',
      label: de ? 'Agents' : 'Agents',
      title: de ? 'Agents — Dein KI-Team' : 'Agents — Your AI team',
      description: de
        ? 'Erstelle Agenten mit Rollen, Skills, SOUL-Dokumenten und eigenem Heartbeat-Intervall. Jeder Agent hat persistentes Gedächtnis und arbeitet autonom im Hintergrund.'
        : 'Create agents with roles, skills, SOUL documents and their own heartbeat interval. Each agent has persistent memory and works autonomously in the background.',
    },
    {
      id: 'skill-library',
      target: 'skill-library',
      icon: BookOpen,
      group: 'Operations',
      label: de ? 'Skill Library' : 'Skill Library',
      title: de ? 'Skill Library — Wissensbausteine' : 'Skill Library — Knowledge blocks',
      description: de
        ? 'Definiere wiederverwendbare Skills (Code, Research, Writing…) und weise sie Agenten zu. Skills fließen automatisch in den Agenten-Kontext bei der Aufgabenausführung ein.'
        : 'Define reusable skills (Code, Research, Writing…) and assign them to agents. Skills flow automatically into the agent context during task execution.',
    },
    {
      id: 'approvals',
      target: 'approvals',
      icon: ShieldCheck,
      group: 'Operations',
      label: 'Approvals',
      title: de ? 'Approvals — Human in the Loop' : 'Approvals — Human in the loop',
      description: de
        ? 'Agenten die Grenzen erreichen oder qualitativ scheitern eskalieren zur manuellen Prüfung. Du genehmigst, blockierst oder kommentierst — der Agent arbeitet danach weiter.'
        : 'Agents that hit limits or fail quality checks escalate for manual review. You approve, block or comment — the agent continues after.',
    },
    {
      id: 'costs',
      target: 'costs',
      icon: Wallet,
      group: 'Operations',
      label: de ? 'Costs & Budget' : 'Costs & Budget',
      title: de ? 'Costs & Budget — Cent-genaue Kontrolle' : 'Costs & Budget — Cent-precise control',
      description: de
        ? 'Jeder Agent hat ein monatliches Budget. Überschreitungen stoppen den Agenten automatisch. Sieh Kosten aufgeschlüsselt nach Modell, Provider und Zeitraum.'
        : 'Every agent has a monthly budget. Overruns stop the agent automatically. View costs broken down by model, provider and time period.',
    },
    {
      id: 'org-chart',
      target: 'org-chart',
      icon: GitBranch,
      group: 'Operations',
      label: 'Organigram',
      title: de ? 'Organigramm — Team-Hierarchie' : 'Org Chart — Team hierarchy',
      description: de
        ? 'Visualisiert dein KI-Team als Organigramm. CEO delegiert an Manager, Manager an Worker — die Hierarchie steuert, wer wessen Arbeit reviewed.'
        : 'Visualizes your AI team as an org chart. CEO delegates to managers, managers to workers — the hierarchy controls who reviews whose work.',
    },
    {
      id: 'knowledge',
      target: 'knowledge',
      icon: Brain,
      group: 'Operations',
      label: 'Knowledge',
      title: de ? 'Knowledge — Unternehmenswissen' : 'Knowledge — Company knowledge',
      description: de
        ? 'Hinterlege Dokumente, Richtlinien und Kontext den alle Agenten kennen sollen. Wird automatisch in jeden Agenten-Prompt injiziert.'
        : 'Store documents, guidelines and context that all agents should know. Automatically injected into every agent prompt.',
    },
    {
      id: 'semantic-memory',
      target: 'semantic-memory',
      icon: Layers,
      group: 'Operations',
      label: 'Semantic Memory',
      title: de ? 'Semantic Memory — KI-Gedächtnis' : 'Semantic Memory — AI memory',
      description: de
        ? 'Agenten speichern Fakten als Embeddings. Andere Agenten finden relevantes Wissen per Ähnlichkeitssuche — auch wenn sie andere Worte verwenden.'
        : 'Agents store facts as embeddings. Other agents find relevant knowledge via similarity search — even if they use different words.',
    },

    // ── Setup ────────────────────────────────────────────────────────────────
    {
      id: 'settings',
      target: 'settings',
      icon: Key,
      group: 'Setup',
      label: de ? '1. API Keys & Settings' : '1. API Keys & Settings',
      title: de ? 'Settings — API Keys einrichten' : 'Settings — Configure API keys',
      description: de
        ? 'Trage hier deine API-Keys ein (Anthropic, OpenRouter, OpenAI, Moonshot, Poe…). Ohne Key können Agenten nicht antworten. Keys werden verschlüsselt gespeichert.'
        : 'Enter your API keys here (Anthropic, OpenRouter, OpenAI, Moonshot, Poe…). Without a key agents cannot respond. Keys are encrypted at rest.',
    },
    {
      id: 'create-agents',
      target: 'experts',
      icon: Bot,
      group: 'Setup',
      label: de ? '2. Agenten erstellen' : '2. Create agents',
      title: de ? 'Agenten erstellen' : 'Create agents',
      description: de
        ? 'Erstelle mindestens einen CEO-Agenten (Typ: CEO, Orchestrator aktiviert). Er koordiniert alle anderen. Weitere Agenten für Code, Research, Writing etc. folgen.'
        : 'Create at least one CEO agent (Type: CEO, Orchestrator enabled). It coordinates all others. Add further agents for Code, Research, Writing etc.',
    },
    {
      id: 'create-projects',
      target: 'projects',
      icon: FolderOpen,
      group: 'Setup',
      label: de ? '3. Projekte anlegen' : '3. Create projects',
      title: de ? 'Projekte anlegen' : 'Create projects',
      description: de
        ? 'Gruppiere verwandte Tasks unter einem Projekt. Projekte haben eigene Ziele, Fortschrittsanzeige und einen zuständigen Agenten als Projektleiter.'
        : 'Group related tasks under a project. Projects have their own goals, progress display and a responsible agent as project lead.',
    },
    {
      id: 'create-tasks',
      target: 'tasks',
      icon: ListTodo,
      group: 'Setup',
      label: de ? '4. Tasks erstellen' : '4. Create tasks',
      title: de ? 'Tasks erstellen' : 'Create tasks',
      description: de
        ? 'Erstelle Tasks und weise sie Agenten zu. Der Heartbeat-Service weckt Agenten automatisch auf und arbeitet Tasks ab — du musst nichts manuell starten.'
        : 'Create tasks and assign them to agents. The heartbeat service wakes agents automatically and processes tasks — you don\'t need to trigger anything manually.',
    },
    {
      id: 'routines',
      target: 'routines',
      icon: Zap,
      group: 'Setup',
      label: de ? '5. Routinen einrichten' : '5. Set up routines',
      title: de ? 'Routinen — Automatisierungen' : 'Routines — Automations',
      description: de
        ? 'Plane wiederkehrende Aufgaben per Cron (täglich 8 Uhr, wöchentlich Mo…). Routinen erstellen automatisch Tasks und wecken den zuständigen Agenten.'
        : 'Schedule recurring tasks via cron (daily 8am, weekly Mon…). Routines automatically create tasks and wake the responsible agent.',
    },

    // ── More ─────────────────────────────────────────────────────────────────
    {
      id: 'goals',
      target: 'goals',
      icon: Target,
      group: 'More',
      label: 'Goals',
      title: de ? 'Goals — OKR-Hierarchie' : 'Goals — OKR hierarchy',
      description: de
        ? '4-stufige Zielhierarchie (Vision → Jahres → Quartal → Sprint). Tasks sind mit Zielen verknüpft — Fortschritt zieht automatisch durch die Ebenen.'
        : '4-level goal hierarchy (Vision → Annual → Quarter → Sprint). Tasks link to goals — progress flows automatically up the levels.',
    },
    {
      id: 'meetings',
      target: 'meetings',
      icon: CalendarDays,
      group: 'More',
      label: 'Meetings',
      title: de ? 'Meetings — Agenten-Abstimmung' : 'Meetings — Agent sync',
      description: de
        ? 'Agenten können Meetings einberufen, Ergebnisse teilen und gemeinsam Entscheidungen treffen. Protokolle werden automatisch gespeichert.'
        : 'Agents can call meetings, share results and make decisions together. Minutes are saved automatically.',
    },
    {
      id: 'activity',
      target: 'activity',
      icon: Activity,
      group: 'More',
      label: 'Activity',
      title: de ? 'Activity — 28-Tage-Verlauf' : 'Activity — 28-day history',
      description: de
        ? 'Vollständiger Aktivitätsfeed: welcher Agent hat was wann getan. Heatmap, Filter nach Agent/Typ und durchsuchbare Timeline.'
        : 'Complete activity feed: which agent did what when. Heatmap, filter by agent/type and searchable timeline.',
    },
    {
      id: 'weekly-report',
      target: 'weekly-report',
      icon: BarChart2,
      group: 'More',
      label: 'Weekly Report',
      title: de ? 'Weekly Report — KI-Wochenbericht' : 'Weekly Report — AI weekly summary',
      description: de
        ? 'Automatisch generierter Wochenbericht: erledigte Tasks, Kosten, Fortschritt zu Zielen, Ausblick. Kann per E-Mail oder Telegram verschickt werden.'
        : 'Automatically generated weekly report: completed tasks, costs, goal progress, outlook. Can be sent via email or Telegram.',
    },
    {
      id: 'cognithub',
      target: 'cognithub',
      icon: Store,
      group: 'More',
      label: 'CognitHub',
      title: de ? 'CognitHub — Blueprints & Vorlagen' : 'CognitHub — Blueprints & templates',
      description: de
        ? 'Importiere vorgefertigte Company-Blueprints (Dev Studio, Research Lab, Product Company…) mit kompletten Agenten-Teams, Zielen und Routinen — ein Klick, sofort einsatzbereit.'
        : 'Import pre-built company blueprints (Dev Studio, Research Lab, Product Company…) with complete agent teams, goals and routines — one click, immediately ready.',
    },
    {
      id: 'plugins',
      target: 'plugins',
      icon: Puzzle,
      group: 'More',
      label: 'Plugins',
      title: de ? 'Plugins — Erweiterungen' : 'Plugins — Extensions',
      description: de
        ? 'Installiere Plugins die neue Provider, Dashboard-Widgets oder API-Endpunkte hinzufügen. Builtin: Analytics, Ollama Extended. Community-Plugins folgen.'
        : 'Install plugins that add new providers, dashboard widgets or API endpoints. Built-in: Analytics, Ollama Extended. Community plugins coming.',
    },
    {
      id: 'workers',
      target: 'workers',
      icon: Cpu,
      group: 'More',
      label: 'Worker Nodes',
      title: de ? 'Worker Nodes — Multi-Node-Execution' : 'Worker Nodes — Multi-node execution',
      description: de
        ? 'Verteile Agenten-Ausführungen auf mehrere Maschinen. Jeder Worker-Node meldet sich am Master an und bearbeitet Tasks parallel — skaliert auf beliebig viele Rechner.'
        : 'Distribute agent executions across multiple machines. Each worker node connects to the master and processes tasks in parallel — scales to any number of machines.',
    },

    // ── Done ─────────────────────────────────────────────────────────────────
    {
      id: 'done',
      icon: Rocket,
      label: de ? 'Los geht\'s' : 'Let\'s go',
      title: de ? 'Du kennst jetzt alles 🚀' : 'You know it all now 🚀',
      description: de
        ? 'Starte mit Settings → API Key eintragen → CEO-Agent erstellen → erste Nachricht im Chat. Du kannst diese Tour jederzeit über Settings → General wiederholen.'
        : 'Start with Settings → add API key → create CEO agent → first message in Chat. You can replay this tour anytime via Settings → General.',
    },
  ];
}

interface Rect { top: number; left: number; width: number; height: number; }

const GROUPS = ['Operations', 'Setup', 'More'];

export function OnboardingTour() {
  const { language } = useI18n();
  const de = language === 'de';
  const STEPS = getSteps(de);

  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const t = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(t);
    }
  }, []);

  const complete = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setVisible(false);
  }, []);

  const current = STEPS[step];
  const isCentered = !current?.target;

  useEffect(() => {
    if (!visible || isCentered) { setTargetRect(null); setTooltipStyle({}); return; }
    const measure = () => {
      const el = document.querySelector(`[data-tour-step="${current.target}"]`);
      if (!el) { setTargetRect(null); setTooltipStyle({}); return; }
      const r = el.getBoundingClientRect();
      const pad = 6;
      setTargetRect({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
      const tooltipW = 340;
      const spaceRight = window.innerWidth - r.right;
      if (spaceRight > tooltipW + 20) {
        setTooltipStyle({ top: Math.max(12, r.top - 8), left: r.right + 16, width: tooltipW });
      } else {
        setTooltipStyle({ top: r.bottom + 12, left: Math.max(12, Math.min(r.left, window.innerWidth - tooltipW - 12)), width: tooltipW });
      }
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [visible, step, isCentered, current?.target]);

  const goNext = () => {
    if (step >= STEPS.length - 1) { complete(); return; }
    setAnimating(true);
    setTimeout(() => { setStep(s => s + 1); setAnimating(false); }, 160);
  };
  const goBack = () => {
    if (step <= 0) return;
    setAnimating(true);
    setTimeout(() => { setStep(s => s - 1); setAnimating(false); }, 160);
  };
  const goToStep = (i: number) => {
    if (i === step) return;
    setAnimating(true);
    setTimeout(() => { setStep(i); setAnimating(false); }, 160);
  };

  if (!visible) return null;

  const progress = step / (STEPS.length - 1);
  const group = current.group;

  const navDots = (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', margin: '12px 0 16px' }}>
      {STEPS.map((s, i) => (
        <button
          key={s.id}
          onClick={() => goToStep(i)}
          title={s.label}
          style={{
            width: i === step ? 20 : 6, height: 6,
            background: i === step ? '#c5a059' : i < step ? 'rgba(197,160,89,0.4)' : 'rgba(255,255,255,0.1)',
            border: 'none', cursor: 'pointer', padding: 0,
            transition: 'all 0.25s',
          }}
        />
      ))}
    </div>
  );

  const tooltipContent = (
    <div style={{
      background: '#0e0c09', border: '1px solid rgba(197,160,89,0.2)',
      boxShadow: '0 16px 48px rgba(0,0,0,0.8)',
      padding: '18px 20px', width: 340,
      opacity: animating ? 0 : 1, transition: 'opacity 0.16s',
      position: 'relative',
    }}>
      {/* Gold top line */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #c5a059, transparent)' }} />

      {/* Progress bar */}
      <div style={{ height: 2, background: 'rgba(197,160,89,0.1)', marginBottom: 14 }}>
        <div style={{ height: '100%', width: `${progress * 100}%`, background: '#c5a059', transition: 'width 0.4s ease' }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {group && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'rgba(197,160,89,0.5)', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{group}</span>}
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#52463a', textTransform: 'uppercase', fontFamily: 'var(--font-mono)' }}>{step + 1}/{STEPS.length}</span>
        </div>
        <button onClick={complete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3a342c', padding: 2, display: 'flex' }}>
          <X size={13} />
        </button>
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#f5f0e8', margin: '0 0 7px', lineHeight: 1.3 }}>{current.title}</h3>
      <p style={{ fontSize: 12.5, color: '#7a7268', lineHeight: 1.65, margin: '0 0 14px' }}>{current.description}</p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={complete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3a342c', fontSize: 11, fontWeight: 500 }}>
          {de ? 'Überspringen' : 'Skip'}
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          {step > 0 && (
            <button onClick={goBack} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(197,160,89,0.1)', color: '#7a7268', cursor: 'pointer', fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <ChevronLeft size={11} /> {de ? 'Zurück' : 'Back'}
            </button>
          )}
          <button onClick={goNext} style={{ padding: '6px 16px', background: 'rgba(197,160,89,0.14)', border: '1px solid rgba(197,160,89,0.35)', color: '#c5a059', cursor: 'pointer', fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 5 }}>
            {step === STEPS.length - 1 ? (de ? 'Los geht\'s' : 'Let\'s go') : (de ? 'Weiter' : 'Next')} <ArrowRight size={11} />
          </button>
        </div>
      </div>
    </div>
  );

  const centeredModal = (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{
        pointerEvents: 'auto', width: 460, maxWidth: 'calc(100vw - 32px)',
        background: '#0e0c09', border: '1px solid rgba(197,160,89,0.2)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.85)',
        padding: '32px 32px 26px', position: 'relative',
        opacity: animating ? 0 : 1, transition: 'opacity 0.16s',
        textAlign: 'center',
      }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #c5a059, transparent)' }} />

        <div style={{ width: 56, height: 56, margin: '0 auto 18px', background: 'rgba(197,160,89,0.08)', border: '1px solid rgba(197,160,89,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <current.icon size={24} style={{ color: '#c5a059' }} />
        </div>

        <h2 style={{ fontSize: 19, fontWeight: 800, color: '#f5f0e8', margin: '0 0 10px', lineHeight: 1.3 }}>{current.title}</h2>
        <p style={{ fontSize: 13.5, color: '#7a7268', lineHeight: 1.7, margin: '0 0 4px' }}>{current.description}</p>

        {navDots}

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <button onClick={goNext} style={{ padding: '10px 28px', background: 'rgba(197,160,89,0.14)', border: '1px solid rgba(197,160,89,0.4)', color: '#c5a059', cursor: 'pointer', fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8, letterSpacing: '0.04em' }}>
            {step === 0 ? (de ? 'Tour starten' : 'Start tour') : (de ? 'Los geht\'s!' : 'Let\'s go!')}
            <ArrowRight size={13} />
          </button>
          {step === 0 && (
            <button onClick={complete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3a342c', fontSize: 11 }}>
              {de ? 'Überspringen' : 'Skip tour'}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
      {/* Overlay */}
      {targetRect ? (
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs>
            <mask id="oc-tour-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect x={targetRect.left} y={targetRect.top} width={targetRect.width} height={targetRect.height} fill="black" />
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0,0,0,0.75)" mask="url(#oc-tour-mask)" />
        </svg>
      ) : (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)' }} />
      )}

      {/* Highlight ring */}
      {targetRect && (
        <div style={{
          position: 'absolute',
          top: targetRect.top, left: targetRect.left,
          width: targetRect.width, height: targetRect.height,
          border: '2px solid rgba(197,160,89,0.6)',
          boxShadow: '0 0 0 4px rgba(197,160,89,0.08), 0 0 24px rgba(197,160,89,0.2)',
          pointerEvents: 'none', transition: 'all 0.3s ease',
        }} />
      )}

      {isCentered
        ? centeredModal
        : <div style={{ position: 'absolute', ...tooltipStyle, pointerEvents: 'auto' }}>{tooltipContent}</div>
      }
    </div>
  );
}

export function resetOnboardingTour() {
  localStorage.removeItem(STORAGE_KEY);
}
