import { useState, Fragment as Frag } from 'react';
import {
  Sparkles, FolderOpen, ChevronRight, ChevronLeft,
  Loader2, CheckCircle2, AlertCircle, Bot, Folder,
  ListTodo, Zap, ArrowRight, X, GripVertical, Flag,
} from 'lucide-react';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';
import { authFetch } from '../utils/api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlanProject {
  name: string;
  beschreibung: string;
  prioritaet: 'critical' | 'high' | 'medium' | 'low';
  farbe: string;
  subDir: string;
  startFirst?: boolean;
}

interface PlanAgent {
  name: string;
  rolle: string;
  faehigkeiten: string;
  systemPrompt: string;
  soul: string;
  skills: string[];
  projektName: string;
  zyklusIntervallSek: number;
  istOrchestrator: boolean;
}

interface PlanTask {
  titel: string;
  beschreibung: string;
  prioritaet: string;
  projektName: string;
  agentName: string;
}

interface PlanRoutine {
  name: string;
  beschreibung: string;
  cron: string;
  agentName: string;
}

interface BootstrapPlan {
  companyGoal: string;
  projekte: PlanProject[];
  agenten: PlanAgent[];
  tasks: PlanTask[];
  routinen: PlanRoutine[];
}

const PRIO_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#23CDCB',
  low: '#94a3b8',
};

// ── Step Indicator ────────────────────────────────────────────────────────────

function StepDot({ step, current, label }: { step: number; current: number; label: string }) {
  const done = current > step;
  const active = current === step;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 700, transition: 'all 0.3s',
        background: done ? '#23CDCB' : active ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.06)',
        border: `2px solid ${done ? '#23CDCB' : active ? '#23CDCB' : 'rgba(255,255,255,0.1)'}`,
        color: done ? '#000' : active ? '#23CDCB' : '#475569',
      }}>
        {done ? <CheckCircle2 size={14} /> : step}
      </div>
      <span style={{ fontSize: 10, color: active ? '#23CDCB' : '#475569', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

function StepLine({ done }: { done: boolean }) {
  return (
    <div style={{
      flex: 1, height: 2, marginBottom: 20,
      background: done ? '#23CDCB' : 'rgba(255,255,255,0.08)',
      transition: 'background 0.3s',
    }} />
  );
}

// ── Main Wizard ───────────────────────────────────────────────────────────────

export function SetupWizard({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const de = language === 'de';

  const [step, setStep] = useState(1);
  const [description, setDescription] = useState('');
  const [workDir, setWorkDir] = useState('');
  const [dirValid, setDirValid] = useState<boolean | null>(null);
  const [plan, setPlan] = useState<BootstrapPlan | null>(null);
  const [planSource, setPlanSource] = useState<'ai' | 'default'>('ai');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [execError, setExecError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [created, setCreated] = useState<any>(null);

  // Priority ordering (drag-to-reorder placeholder — using up/down buttons)
  const [projektOrder, setProjektOrder] = useState<PlanProject[]>([]);
  const [startProjekt, setStartProjekt] = useState<string>('');

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.75rem 1rem',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '12px', color: '#ffffff',
    fontSize: '0.875rem', outline: 'none',
    boxSizing: 'border-box', colorScheme: 'dark',
    resize: 'vertical' as any,
  };

  const btnPrimary: React.CSSProperties = {
    padding: '0.75rem 1.5rem', borderRadius: '12px',
    background: 'rgba(35,205,202,0.9)', border: '1px solid rgba(35,205,202,0.4)',
    color: '#000', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '0.5rem',
  };

  const btnSecondary: React.CSSProperties = {
    padding: '0.75rem 1.5rem', borderRadius: '12px',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
    color: '#94a3b8', fontWeight: 500, fontSize: '0.875rem', cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: '0.5rem',
  };

  const validateDir = async () => {
    if (!workDir.trim() || !workDir.startsWith('/')) { setDirValid(false); return; }
    setDirValid(true);
  };

  const runAnalysis = async () => {
    if (!description.trim() || !workDir.trim()) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const resp = await authFetch('/api/bootstrap/plan', {
        method: 'POST',
        body: JSON.stringify({
          businessDescription: description,
          workDir,
          language,
          unternehmenId: aktivesUnternehmen?.id,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setPlan(data.plan);
      setPlanSource(data.source);
      const ordered = [...(data.plan.projekte || [])];
      setProjektOrder(ordered);
      // Default start project = the one with startFirst: true
      const starter = ordered.find((p: PlanProject) => p.startFirst);
      setStartProjekt(starter?.name || ordered[0]?.name || '');
      setStep(4);
    } catch (e: any) {
      setAnalyzeError(e.message || 'Fehler bei der Analyse');
    } finally {
      setAnalyzing(false);
    }
  };

  const moveProject = (idx: number, dir: -1 | 1) => {
    const next = [...projektOrder];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    setProjektOrder(next);
  };

  const execute = async () => {
    if (!plan || !aktivesUnternehmen) return;
    setExecuting(true);
    setExecError(null);
    try {
      // Rebuild plan with new project order (priority: first = critical, etc.)
      const prioMap: string[] = ['critical', 'high', 'medium', 'low'];
      const reorderedPlan = {
        ...plan,
        projekte: projektOrder.map((p, i) => ({
          ...p,
          prioritaet: prioMap[Math.min(i, 3)] as any,
        })),
      };
      const resp = await authFetch('/api/bootstrap/execute', {
        method: 'POST',
        body: JSON.stringify({
          plan: reorderedPlan,
          unternehmenId: aktivesUnternehmen.id,
          workDir,
          startProjektName: startProjekt,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setCreated(data.created);
      setDone(true);
      setStep(5);
    } catch (e: any) {
      setExecError(e.message || 'Fehler beim Erstellen');
    } finally {
      setExecuting(false);
    }
  };

  const STEPS = [
    de ? 'Beschreiben' : 'Describe',
    de ? 'Verzeichnis' : 'Directory',
    de ? 'Analyse' : 'Analysis',
    de ? 'Überprüfen' : 'Review',
    de ? 'Fertig' : 'Done',
  ];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
    }}>
      <div style={{
        background: 'rgba(8,8,18,0.95)', backdropFilter: 'blur(40px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '24px', padding: '2rem',
        width: '100%', maxWidth: '680px', maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 40px 100px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)',
        position: 'relative',
      }}>
        {/* Close */}
        <button onClick={onClose} style={{
          position: 'absolute', top: 16, right: 16,
          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8, padding: '4px 8px', cursor: 'pointer', color: '#71717a',
        }}><X size={14} /></button>

        {/* Header */}
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(35,205,202,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={18} style={{ color: '#23CDCB' }} />
            </div>
            <div>
              <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#fff' }}>
                {de ? 'CEO Setup-Assistent' : 'CEO Setup Assistant'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#475569' }}>
                {de ? 'Beschreibe dein Vorhaben — der CEO richtet alles ein' : 'Describe your goal — the CEO sets everything up'}
              </div>
            </div>
          </div>

          {/* Step indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: '1rem' }}>
            {STEPS.map((label, i) => (
              <Frag key={i}>
                <StepDot step={i + 1} current={step} label={label} />
                {i < STEPS.length - 1 && <StepLine done={step > i + 1} />}
              </Frag>
            ))}
          </div>
        </div>

        {/* ── Step 1: Describe ── */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#a1a1aa', marginBottom: '0.5rem' }}>
                {de ? 'Was möchtest du aufbauen oder erreichen?' : 'What do you want to build or achieve?'}
              </label>
              <textarea
                style={{ ...inputStyle, minHeight: 140 }}
                placeholder={de
                  ? 'Bsp: Ich baue eine SaaS-Plattform für Zeitmanagement. Der CEO soll ein Team aus Entwicklern, einem Marketing-Agenten und einem Support-Agenten einrichten. Tech-Stack: React + Node.js. Zielgruppe: Freelancer und kleine Teams...'
                  : 'E.g.: I\'m building a SaaS platform for time management. CEO should set up a team of developers, a marketing agent and a support agent. Tech stack: React + Node.js. Target: freelancers and small teams...'}
                value={description}
                onChange={e => setDescription(e.target.value)}
                autoFocus
              />
              <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: 4 }}>
                {de ? 'Je mehr Details, desto besser der Plan. Erwähne Technologien, Rollen, Ziele.' : 'More details = better plan. Mention technologies, roles, goals.'}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                style={{ ...btnPrimary, opacity: description.trim().length < 20 ? 0.4 : 1 }}
                disabled={description.trim().length < 20}
                onClick={() => setStep(2)}
              >
                {de ? 'Weiter' : 'Next'} <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Working Directory ── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: '#a1a1aa', marginBottom: '0.5rem' }}>
                <FolderOpen size={12} />
                {de ? 'Arbeitsverzeichnis für Projekte' : 'Working directory for projects'}
              </label>
              <input
                style={inputStyle}
                placeholder={de ? '/home/deinname/projekte/mein-startup' : '/home/yourname/projects/my-startup'}
                value={workDir}
                onChange={e => { setWorkDir(e.target.value); setDirValid(null); }}
                onBlur={validateDir}
              />
              {dirValid === false && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ef4444', fontSize: '0.75rem', marginTop: 4 }}>
                  <AlertCircle size={12} /> {de ? 'Absoluter Pfad erforderlich (beginnt mit /)' : 'Absolute path required (starts with /)'}
                </div>
              )}
              {dirValid === true && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#22c55e', fontSize: '0.75rem', marginTop: 4 }}>
                  <CheckCircle2 size={12} /> {de ? 'Pfad gültig — CEO erstellt hier Projektordner' : 'Path valid — CEO creates project folders here'}
                </div>
              )}
            </div>

            <div style={{ background: 'rgba(35,205,202,0.05)', border: '1px solid rgba(35,205,202,0.15)', borderRadius: 12, padding: '0.875rem' }}>
              <div style={{ fontSize: '0.75rem', color: '#23CDCB', fontWeight: 600, marginBottom: 6 }}>
                {de ? 'Was passiert mit diesem Ordner?' : 'What happens with this folder?'}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.5 }}>
                {de
                  ? 'Der CEO erstellt pro Projekt einen Unterordner. Agenten speichern ihre Arbeit dort. Deine bestehenden Dateien werden nicht verändert.'
                  : 'CEO creates one subfolder per project. Agents save their work there. Your existing files are not changed.'}
              </div>
              <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: '0.7rem', color: '#475569' }}>
                {workDir || '/dein/pfad'}/
                <br />
                {'  '}├── projekt-1/
                <br />
                {'  '}├── projekt-2/
                <br />
                {'  '}└── ...
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <button style={btnSecondary} onClick={() => setStep(1)}><ChevronLeft size={16} /> {de ? 'Zurück' : 'Back'}</button>
              <button
                style={{ ...btnPrimary, opacity: !workDir.trim().startsWith('/') ? 0.4 : 1 }}
                disabled={!workDir.trim().startsWith('/')}
                onClick={() => { validateDir(); setStep(3); setTimeout(runAnalysis, 100); }}
              >
                {de ? 'CEO analysiert' : 'CEO analyzes'} <Sparkles size={16} />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Analyzing ── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', padding: '2rem 0' }}>
            {analyzing ? (
              <>
                <div style={{
                  width: 72, height: 72, borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(35,205,202,0.2) 0%, transparent 70%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '2px solid rgba(35,205,202,0.3)',
                  animation: 'pulse 2s ease-in-out infinite',
                }}>
                  <Sparkles size={32} style={{ color: '#23CDCB' }} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: 6 }}>
                    {de ? 'CEO analysiert...' : 'CEO analyzing...'}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#475569' }}>
                    {de ? 'Plant Projekte, Agenten, Tasks und Routinen' : 'Planning projects, agents, tasks and routines'}
                  </div>
                </div>
                <Loader2 size={20} style={{ color: '#23CDCB', animation: 'spin 1s linear infinite' }} />
              </>
            ) : analyzeError ? (
              <div style={{ textAlign: 'center' }}>
                <AlertCircle size={40} style={{ color: '#ef4444', marginBottom: 12 }} />
                <div style={{ color: '#ef4444', fontSize: '0.875rem', marginBottom: 12 }}>{analyzeError}</div>
                <button style={btnPrimary} onClick={runAnalysis}>{de ? 'Nochmal versuchen' : 'Try again'}</button>
              </div>
            ) : null}
          </div>
        )}

        {/* ── Step 4: Review & Prioritize ── */}
        {step === 4 && plan && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {planSource === 'default' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.625rem 0.875rem', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, fontSize: '0.75rem', color: '#f59e0b' }}>
                <AlertCircle size={12} />
                {de ? 'Kein API-Key gefunden — Basis-Plan erstellt. Füge einen API-Key in den Einstellungen hinzu für einen individuellen Plan.' : 'No API key found — basic plan created. Add an API key in settings for a custom plan.'}
              </div>
            )}

            {/* Company Goal */}
            <div style={{ background: 'rgba(35,205,202,0.06)', border: '1px solid rgba(35,205,202,0.15)', borderRadius: 12, padding: '0.875rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#23CDCB', marginBottom: 4 }}>
                {de ? 'Unternehmensziel' : 'Company Goal'}
              </div>
              <div style={{ fontSize: '0.875rem', color: '#e2e8f0' }}>{plan.companyGoal}</div>
            </div>

            {/* Projects — reorderable */}
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Folder size={11} /> {de ? 'Projekte (Priorität durch Reihenfolge)' : 'Projects (priority by order)'}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {projektOrder.map((p, i) => (
                  <div key={p.name} style={{
                    background: startProjekt === p.name ? 'rgba(35,205,202,0.08)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${startProjekt === p.name ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.07)'}`,
                    borderRadius: 10, padding: '0.625rem 0.75rem',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    {/* Priority badge */}
                    <div style={{ fontSize: '0.625rem', fontWeight: 800, color: PRIO_COLORS[['critical','high','medium','low'][Math.min(i,3)]], width: 48, textAlign: 'center', textTransform: 'uppercase' }}>
                      {['critical','high','medium','low'][Math.min(i,3)]}
                    </div>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: p.farbe || '#23CDCB', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff', marginBottom: 2 }}>{p.name}</div>
                      <div style={{ fontSize: '0.7rem', color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        📁 {workDir}/{p.subDir}
                      </div>
                    </div>
                    {/* Start selector */}
                    <button
                      onClick={() => setStartProjekt(p.name)}
                      title={de ? 'Als erstes starten' : 'Start first'}
                      style={{
                        padding: '3px 8px', borderRadius: 6, fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer',
                        background: startProjekt === p.name ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${startProjekt === p.name ? '#23CDCB' : 'rgba(255,255,255,0.08)'}`,
                        color: startProjekt === p.name ? '#23CDCB' : '#475569',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}
                    >
                      <Flag size={10} /> {de ? 'Start' : 'Start'}
                    </button>
                    {/* Move up/down */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <button onClick={() => moveProject(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? '#2d2d3a' : '#64748b', padding: 0, lineHeight: 1 }}>▲</button>
                      <button onClick={() => moveProject(i, 1)} disabled={i === projektOrder.length - 1} style={{ background: 'none', border: 'none', cursor: i === projektOrder.length - 1 ? 'default' : 'pointer', color: i === projektOrder.length - 1 ? '#2d2d3a' : '#64748b', padding: 0, lineHeight: 1 }}>▼</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Agents summary */}
            <div>
              <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#475569', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Bot size={11} /> {de ? `${plan.agenten.length} Agenten werden erstellt` : `${plan.agenten.length} agents will be created`}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {plan.agenten.map(a => (
                  <div key={a.name} style={{
                    padding: '4px 10px', borderRadius: 20, fontSize: '0.75rem',
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    color: '#94a3b8',
                  }}>
                    {a.name} <span style={{ color: '#475569' }}>· {a.rolle}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {[
                { icon: <ListTodo size={14} />, value: plan.tasks.length, label: de ? 'Start-Tasks' : 'Start Tasks' },
                { icon: <Zap size={14} />, value: plan.routinen.length, label: de ? 'Routinen' : 'Routines' },
                { icon: <Folder size={14} />, value: plan.projekte.length, label: de ? 'Projektordner' : 'Project folders' },
              ].map(({ icon, value, label }) => (
                <div key={label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '0.625rem', textAlign: 'center' }}>
                  <div style={{ color: '#23CDCB', marginBottom: 2 }}>{icon}</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff' }}>{value}</div>
                  <div style={{ fontSize: '0.65rem', color: '#475569' }}>{label}</div>
                </div>
              ))}
            </div>

            {execError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.625rem 0.875rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, fontSize: '0.75rem', color: '#ef4444' }}>
                <AlertCircle size={12} /> {execError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <button style={btnSecondary} onClick={() => setStep(1)}><ChevronLeft size={16} /> {de ? 'Neu beschreiben' : 'Redescribe'}</button>
              <button style={btnPrimary} onClick={execute} disabled={executing}>
                {executing ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={16} />}
                {de ? 'Alles erstellen' : 'Create everything'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 5: Done ── */}
        {step === 5 && created && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem', padding: '1rem 0' }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(34,197,94,0.2) 0%, transparent 70%)',
              border: '2px solid rgba(34,197,94,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CheckCircle2 size={36} style={{ color: '#22c55e' }} />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '1.125rem', fontWeight: 800, color: '#fff', marginBottom: 6 }}>
                {de ? 'Alles bereit!' : 'All set!'}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                {de ? 'Dein Team wurde eingerichtet. Die Agenten sind bereit.' : 'Your team is set up. Agents are ready.'}
              </div>
            </div>

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { icon: <Folder size={14} />, count: created.projekte?.length, label: de ? 'Projekte erstellt' : 'Projects created', color: '#23CDCB' },
                { icon: <Bot size={14} />, count: created.agenten?.length, label: de ? 'Agenten konfiguriert' : 'Agents configured', color: '#a78bfa' },
                { icon: <ListTodo size={14} />, count: created.tasks?.length, label: de ? 'Tasks angelegt' : 'Tasks created', color: '#22c55e' },
                { icon: <Zap size={14} />, count: created.routinen?.length, label: de ? 'Routinen aktiv' : 'Routines active', color: '#f59e0b' },
              ].map(({ icon, count, label, color }) => count > 0 ? (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0.5rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: 8 }}>
                  <div style={{ color }}>{icon}</div>
                  <div style={{ flex: 1, fontSize: '0.8125rem', color: '#94a3b8' }}>{label}</div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 700, color }}>{count}</div>
                </div>
              ) : null)}
            </div>

            {created.soulFiles?.length > 0 && (
              <div style={{ width: '100%', background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)', borderRadius: 10, padding: '0.625rem 0.875rem' }}>
                <div style={{ fontSize: '0.7rem', color: '#a78bfa', fontWeight: 600, marginBottom: 4 }}>
                  ✨ Soul-Dateien gespeichert
                </div>
                {created.soulFiles.map((f: string) => (
                  <div key={f} style={{ fontSize: '0.65rem', color: '#475569', fontFamily: 'monospace' }}>{f}</div>
                ))}
              </div>
            )}

            <button style={{ ...btnPrimary, width: '100%', justifyContent: 'center' }} onClick={onDone}>
              {de ? 'Zum Dashboard' : 'Go to Dashboard'} <ArrowRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
