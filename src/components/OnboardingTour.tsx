import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowRight, X, MessageSquare, LayoutDashboard, Swords, Users, ListTodo, Rocket } from 'lucide-react';
import { useI18n } from '../i18n';

const STORAGE_KEY = 'oc_onboarding_tour_done';

interface TourStep {
  id: string;
  target?: string;
  icon: React.ElementType;
  label: string;
  title: string;
  description: string;
}

function getSteps(de: boolean): TourStep[] {
  return [
    {
      id: 'welcome',
      icon: Rocket,
      label: de ? 'Willkommen' : 'Welcome',
      title: de ? 'Willkommen in deiner Zero-Human Company' : 'Welcome to your Zero-Human Company',
      description: de
        ? 'OpenCognit ist dein Kommandozentrum für autonome KI-Teams. In 30 Sekunden zeigen wir dir die wichtigsten Bereiche.'
        : 'OpenCognit is your command center for autonomous AI teams. Let us show you the key areas in 30 seconds.',
    },
    {
      id: 'chat',
      target: 'chat',
      icon: MessageSquare,
      label: 'Chat',
      title: de ? 'Direkt mit dem CEO chatten' : 'Chat directly with the CEO',
      description: de
        ? 'Dein CEO-Agent ist dein persönlicher KI-Assistent. Erkläre was du vorhast — er richtet Agenten ein, erstellt Tasks und konfiguriert das ganze System für dich.'
        : 'Your CEO agent is your personal AI assistant. Tell it what you need — it sets up agents, creates tasks, and configures the entire system for you.',
    },
    {
      id: 'dashboard',
      target: 'dashboard',
      icon: LayoutDashboard,
      label: 'Dashboard',
      title: de ? 'Echtzeit-Überblick' : 'Real-time overview',
      description: de
        ? 'Das Dashboard zeigt dir auf einen Blick: Agenten-Status, offene Tasks, Kosten und letzte Aktivitäten — alles live.'
        : 'The dashboard shows you at a glance: agent status, open tasks, costs and recent activity — all live.',
    },
    {
      id: 'war-room',
      target: 'war-room',
      icon: Swords,
      label: 'Live Room',
      title: de ? 'Live Room — Live-Monitor' : 'Live Room — Live monitor',
      description: de
        ? 'Sieh in Echtzeit was dein KI-Team gerade macht. Jede Aktion, jeder Token, jede Entscheidung — live im Feed.'
        : 'See in real-time what your AI team is doing. Every action, every token, every decision — live in the feed.',
    },
    {
      id: 'experts',
      target: 'experts',
      icon: Users,
      label: de ? 'Agenten' : 'Agents',
      title: de ? 'Dein KI-Team verwalten' : 'Manage your AI team',
      description: de
        ? 'Erstelle und konfiguriere Agenten mit verschiedenen Rollen, LLMs und Skills. Oder sag dem CEO einfach was du brauchst — er erledigt das für dich.'
        : 'Create and configure agents with different roles, LLMs and skills. Or just tell the CEO what you need — it handles it for you.',
    },
    {
      id: 'tasks',
      target: 'tasks',
      icon: ListTodo,
      label: de ? 'Tasks' : 'Tasks',
      title: de ? 'Aufgaben & Automatisierung' : 'Tasks & Automation',
      description: de
        ? 'Erstelle Tasks und weise sie Agenten zu. Der Heartbeat-Service sorgt dafür, dass Agenten automatisch arbeiten — ohne dass du etwas tun musst.'
        : 'Create tasks and assign them to agents. The heartbeat service ensures agents work automatically — without you having to do anything.',
    },
    {
      id: 'done',
      icon: Rocket,
      label: de ? 'Los geht\'s' : 'Let\'s go',
      title: de ? 'Du bist bereit 🚀' : 'You\'re ready 🚀',
      description: de
        ? 'Starte einfach im Chat: Erkläre deinem CEO was du aufbauen willst. Er konfiguriert das Team, setzt API Keys und richtet Routinen ein — alles per Nachricht.'
        : 'Just start in Chat: tell your CEO what you want to build. It configures the team, sets API keys and sets up routines — all via message.',
    },
  ];
}

interface Rect { top: number; left: number; width: number; height: number; }

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
    if (!visible || isCentered) {
      setTargetRect(null);
      setTooltipStyle({});
      return;
    }
    const measure = () => {
      const el = document.querySelector(`[data-tour-step="${current.target}"]`);
      if (!el) { setTargetRect(null); setTooltipStyle({}); return; }
      const r = el.getBoundingClientRect();
      const pad = 6;
      setTargetRect({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });

      const tooltipW = 320;
      const spaceRight = window.innerWidth - r.right;
      if (spaceRight > tooltipW + 20) {
        setTooltipStyle({ top: Math.max(12, r.top - 8), left: r.right + 16, width: tooltipW });
      } else {
        setTooltipStyle({ top: r.bottom + 12, left: Math.max(12, r.left), width: tooltipW });
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
    setTimeout(() => { setStep(s => s + 1); setAnimating(false); }, 180);
  };
  const goBack = () => {
    if (step <= 0) return;
    setAnimating(true);
    setTimeout(() => { setStep(s => s - 1); setAnimating(false); }, 180);
  };

  if (!visible) return null;

  const progress = step / (STEPS.length - 1);

  // SVG overlay
  const overlay = targetRect ? (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
      <defs>
        <mask id="oc-tour-mask">
          <rect width="100%" height="100%" fill="white" />
          <rect x={targetRect.left} y={targetRect.top} width={targetRect.width} height={targetRect.height} rx={0} fill="black" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.72)" mask="url(#oc-tour-mask)" />
    </svg>
  ) : (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.72)' }} />
  );

  const tooltipContent = (
    <div style={{
      background: '#0e0e0e',
      border: '1px solid rgba(197,180,150,0.18)',
      boxShadow: '0 12px 48px rgba(0,0,0,0.7)',
      padding: '20px 22px',
      width: 320,
      transition: 'opacity 0.18s',
      opacity: animating ? 0 : 1,
    }}>
      {/* Progress bar */}
      <div style={{ height: 2, background: 'rgba(197,180,150,0.1)', marginBottom: 16, position: 'relative' }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: `${progress * 100}%`,
          background: '#c5a059',
          transition: 'width 0.4s ease',
        }} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', color: '#c5a059', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
          {step + 1} / {STEPS.length}
        </span>
        <button onClick={complete} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3a342c', padding: 2, display: 'flex', alignItems: 'center' }}>
          <X size={14} />
        </button>
      </div>

      <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f5f0e8', margin: '0 0 8px', lineHeight: 1.3 }}>
        {current.title}
      </h3>
      <p style={{ fontSize: 13, color: '#7a7268', lineHeight: 1.6, margin: '0 0 18px' }}>
        {current.description}
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={complete} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#3a342c', fontSize: 12, fontWeight: 500,
        }}>
          {de ? 'Überspringen' : 'Skip'}
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          {step > 0 && (
            <button onClick={goBack} style={{
              padding: '7px 14px', background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(197,180,150,0.12)', color: '#7a7268',
              cursor: 'pointer', fontSize: 12, fontWeight: 700,
            }}>
              {de ? 'Zurück' : 'Back'}
            </button>
          )}
          <button onClick={goNext} style={{
            padding: '7px 18px',
            background: 'rgba(197,160,89,0.15)',
            border: '1px solid rgba(197,160,89,0.35)',
            color: '#c5a059', cursor: 'pointer',
            fontSize: 12, fontWeight: 800,
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'all 0.15s',
          }}>
            {step === STEPS.length - 1 ? (de ? 'Los geht\'s' : 'Let\'s go') : (de ? 'Weiter' : 'Next')}
            <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999 }}>
      {overlay}

      {/* Highlight ring */}
      {targetRect && (
        <div style={{
          position: 'absolute',
          top: targetRect.top, left: targetRect.left,
          width: targetRect.width, height: targetRect.height,
          border: '2px solid rgba(197,160,89,0.6)',
          boxShadow: '0 0 0 4px rgba(197,160,89,0.08), 0 0 24px rgba(197,160,89,0.2)',
          pointerEvents: 'none',
          transition: 'all 0.3s ease',
        }} />
      )}

      {isCentered ? (
        // Centered welcome/done modal
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <div style={{
            pointerEvents: 'auto',
            width: 440, maxWidth: 'calc(100vw - 32px)',
            background: '#0e0e0e',
            border: '1px solid rgba(197,180,150,0.18)',
            boxShadow: '0 20px 60px rgba(0,0,0,0.8)',
            padding: '36px 36px 28px',
            opacity: animating ? 0 : 1,
            transition: 'opacity 0.18s',
            textAlign: 'center',
          }}>
            {/* Gold top line */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, transparent, #c5a059, transparent)' }} />

            <div style={{
              width: 64, height: 64, margin: '0 auto 20px',
              background: 'rgba(197,160,89,0.1)',
              border: '1px solid rgba(197,160,89,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <current.icon size={28} style={{ color: '#c5a059' }} />
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#f5f0e8', margin: '0 0 10px', lineHeight: 1.3 }}>
              {current.title}
            </h2>
            <p style={{ fontSize: 14, color: '#7a7268', lineHeight: 1.7, margin: '0 0 28px' }}>
              {current.description}
            </p>

            {/* Progress dots */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 24 }}>
              {STEPS.map((_, i) => (
                <div key={i} style={{
                  height: 2,
                  width: i === step ? 24 : 8,
                  background: i === step ? '#c5a059' : i < step ? 'rgba(197,160,89,0.4)' : 'rgba(197,180,150,0.15)',
                  transition: 'all 0.3s',
                }} />
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <button onClick={goNext} style={{
                padding: '11px 32px',
                background: 'rgba(197,160,89,0.15)',
                border: '1px solid rgba(197,160,89,0.4)',
                color: '#c5a059', cursor: 'pointer',
                fontSize: 13, fontWeight: 800,
                display: 'flex', alignItems: 'center', gap: 8,
                transition: 'all 0.15s',
                letterSpacing: '0.04em',
              }}>
                {step === 0 ? (de ? 'Tour starten' : 'Start tour') : (de ? 'Los geht\'s!' : 'Let\'s go!')}
                <ArrowRight size={14} />
              </button>
              {step === 0 && (
                <button onClick={complete} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: '#3a342c', fontSize: 12,
                }}>
                  {de ? 'Überspringen' : 'Skip tour'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        // Positioned tooltip
        <div style={{ position: 'absolute', ...tooltipStyle, pointerEvents: 'auto' }}>
          {tooltipContent}
        </div>
      )}
    </div>
  );
}

export function resetOnboardingTour() {
  localStorage.removeItem(STORAGE_KEY);
}
