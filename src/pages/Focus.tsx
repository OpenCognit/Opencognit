import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Zap, CheckCircle2, AlertTriangle, Clock, Users, ArrowRight,
  Play, Pause, RotateCcw, Target, TrendingUp, Shield, ChevronRight,
  Sparkles, Coffee, Sun, Moon, Sunset, RefreshCw, MessagesSquare,
  Plus, X as XIcon, Flag, BellOff, Bell, Settings, Timer
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';
import { authFetch } from '../utils/api';
import { StandupPanel } from '../components/StandupPanel';
import { PageHelp } from '../components/PageHelp';

// ─── Types ───────────────────────────────────────────────────────────────────

interface HumanAction {
  id: string;
  titel: string;
  status: string;
  prioritaet: string;
  reason: 'blocked' | 'needs_review' | 'unassigned' | 'high_priority';
  agentName: string | null;
  agentAvatar: string | null;
  agentFarbe: string | null;
}

interface ActiveAgent {
  id: string;
  name: string;
  rolle: string;
  avatar: string;
  avatarFarbe: string;
  status: string;
  currentTask: { id: string; titel: string; prioritaet: string } | null;
}

interface CompletedTask {
  id: string;
  titel: string;
  agentName: string | null;
  abgeschlossenAm: string;
}

interface FocusData {
  human_actions: HumanAction[];
  ai_active: ActiveAgent[];
  completed_today: CompletedTask[];
  pending_approvals: number;
  velocity: { today: number; week_avg: number };
  stats: { in_progress: number; total_open: number; agents: number };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const REASON_CFG: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  blocked:       { label: 'Blocked', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', icon: <AlertTriangle size={12} /> },
  needs_review:  { label: 'Review', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', icon: <Shield size={12} /> },
  unassigned:    { label: 'No Agent', color: '#9b87c8', bg: 'rgba(155,135,200,0.08)', icon: <Users size={12} /> },
  high_priority: { label: 'High', color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', icon: <Zap size={12} /> },
};

const PRIORITY_GLOW: Record<string, string> = {
  critical: '0 0 12px rgba(239,68,68,0.3)',
  high: '0 0 12px rgba(245,158,11,0.2)',
  medium: 'none',
  low: 'none',
};

function greeting(): { text: string; icon: React.ReactNode } {
  const h = new Date().getHours();
  if (h < 5)  return { text: 'Working late?', icon: <Moon size={18} style={{ color: '#a78bfa' }} /> };
  if (h < 12) return { text: 'Good morning', icon: <Sun size={18} style={{ color: '#fbbf24' }} /> };
  if (h < 17) return { text: 'Good afternoon', icon: <Coffee size={18} style={{ color: '#c5a059' }} /> };
  if (h < 21) return { text: 'Good evening', icon: <Sunset size={18} style={{ color: '#f97316' }} /> };
  return { text: 'Burning the midnight oil?', icon: <Moon size={18} style={{ color: '#a78bfa' }} /> };
}

// ─── localStorage keys ───────────────────────────────────────────────────────

const LS_TIMER = 'focus_timer_state';

interface TimerState {
  seconds: number;
  running: boolean;
  mode: 'focus' | 'break';
  sessions: number;
  savedAt: number; // Date.now() when saved
  workDuration: number; // in seconds
  breakDuration: number; // in seconds
}

function loadTimerState(): TimerState | null {
  try {
    const raw = localStorage.getItem(LS_TIMER);
    if (!raw) return null;
    const state: TimerState = JSON.parse(raw);
    // Adjust for elapsed time if timer was running
    if (state.running) {
      const elapsed = Math.floor((Date.now() - state.savedAt) / 1000);
      state.seconds = Math.max(0, state.seconds - elapsed);
    }
    return state;
  } catch {
    return null;
  }
}

function saveTimerState(state: TimerState) {
  localStorage.setItem(LS_TIMER, JSON.stringify({ ...state, savedAt: Date.now() }));
}

// ─── Pomodoro Timer ───────────────────────────────────────────────────────────

const DEFAULT_WORK = 25 * 60;
const DEFAULT_BREAK = 5 * 60;

interface PomodoroTimerProps {
  onFocusStart?: (durationMinutes: number) => void;
  onFocusEnd?: () => void;
}

function PomodoroTimer({ onFocusStart, onFocusEnd }: PomodoroTimerProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [workMins, setWorkMins] = useState(25);
  const [breakMins, setBreakMins] = useState(5);

  const workSecs = workMins * 60;
  const breakSecs = breakMins * 60;

  // Load from localStorage on mount
  const initialState = loadTimerState();
  const [seconds, setSeconds] = useState(() => initialState?.seconds ?? workSecs);
  const [running, setRunning] = useState(() => initialState?.running ?? false);
  const [mode, setMode] = useState<'focus' | 'break'>(() => initialState?.mode ?? 'focus');
  const [sessions, setSessions] = useState(() => initialState?.sessions ?? 0);

  const intervalRef = useRef<number | null>(null);
  const hasNotified = useRef(false);

  // Sync workMins/breakMins from localStorage
  useEffect(() => {
    if (initialState) {
      setWorkMins(Math.round((initialState.workDuration ?? DEFAULT_WORK) / 60));
      setBreakMins(Math.round((initialState.breakDuration ?? DEFAULT_BREAK) / 60));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist timer state to localStorage whenever it changes
  useEffect(() => {
    const state: TimerState = {
      seconds,
      running,
      mode,
      sessions,
      savedAt: Date.now(),
      workDuration: workSecs,
      breakDuration: breakSecs,
    };
    saveTimerState(state);
  }, [seconds, running, mode, sessions, workSecs, breakSecs]);

  // Timer countdown logic
  useEffect(() => {
    if (running) {
      hasNotified.current = false;
      intervalRef.current = window.setInterval(() => {
        setSeconds(s => {
          if (s <= 1) {
            if (!hasNotified.current) {
              hasNotified.current = true;
              // Play a subtle audio cue if available
              try {
                const ctx = new AudioContext();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = 880;
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
                osc.start();
                osc.stop(ctx.currentTime + 0.8);
              } catch {}
            }
            setRunning(false);
            setMode(prev => {
              if (prev === 'focus') {
                setSessions(n => n + 1);
                onFocusEnd?.();
                return 'break';
              } else {
                return 'focus';
              }
            });
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, onFocusEnd]);

  const handleStartPause = () => {
    if (!running && mode === 'focus' && (seconds === workSecs || seconds === 0)) {
      // Starting a fresh focus session — auto-enable focus mode
      const dur = seconds === 0 ? workMins : Math.ceil(seconds / 60);
      onFocusStart?.(dur);
      if (seconds === 0) setSeconds(workSecs);
    } else if (!running && mode === 'break' && seconds === 0) {
      setSeconds(breakSecs);
    }
    setRunning(r => !r);
  };

  const handleReset = () => {
    setRunning(false);
    setMode('focus');
    setSeconds(workSecs);
    setSessions(0);
    onFocusEnd?.();
  };

  const total = mode === 'focus' ? workSecs : breakSecs;
  const effectiveSeconds = seconds === 0 ? total : seconds;
  const mins = String(Math.floor(effectiveSeconds / 60)).padStart(2, '0');
  const secs = String(effectiveSeconds % 60).padStart(2, '0');
  const pct = seconds === 0 ? 0 : 1 - seconds / total;

  // SVG circle progress
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;

  const timerColor = mode === 'focus' ? '#c5a059' : '#22c55e';
  const modeLabel = mode === 'focus' ? 'Focus Session' : 'Short Break';

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)',
      border: `1px solid ${mode === 'focus' ? 'rgba(197,160,89,0.12)' : 'rgba(34,197,94,0.12)'}`,
      borderRadius: 0,
      padding: '1.5rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '1rem',
      position: 'relative',
    }}>
      {/* Settings toggle */}
      <button
        onClick={() => setShowSettings(s => !s)}
        style={{
          position: 'absolute', top: '0.75rem', right: '0.75rem',
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#3f3f46', padding: 4, display: 'flex',
          transition: 'color 0.2s',
        }}
        onMouseEnter={e => e.currentTarget.style.color = '#71717a'}
        onMouseLeave={e => e.currentTarget.style.color = '#3f3f46'}
        title="Timer settings"
      >
        <Settings size={14} />
      </button>

      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: timerColor, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
        <Timer size={13} /> {modeLabel}
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div style={{
          width: '100%', background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)', borderRadius: 0,
          padding: '0.875rem', display: 'flex', flexDirection: 'column', gap: '0.5rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.75rem', color: '#71717a', flex: 1 }}>Work</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <button onClick={() => { if (workMins > 5) { setWorkMins(m => m - 5); setSeconds((workMins - 5) * 60); setRunning(false); } }} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 0, color: '#a1a1aa', cursor: 'pointer', width: 22, height: 22, fontSize: '0.875rem' }}>−</button>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#c5a059', width: 36, textAlign: 'center' }}>{workMins}m</span>
              <button onClick={() => { if (workMins < 90) { setWorkMins(m => m + 5); setSeconds((workMins + 5) * 60); setRunning(false); } }} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 0, color: '#a1a1aa', cursor: 'pointer', width: 22, height: 22, fontSize: '0.875rem' }}>+</button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <label style={{ fontSize: '0.75rem', color: '#71717a', flex: 1 }}>Break</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
              <button onClick={() => { if (breakMins > 1) setBreakMins(m => m - 1); }} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 0, color: '#a1a1aa', cursor: 'pointer', width: 22, height: 22, fontSize: '0.875rem' }}>−</button>
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#22c55e', width: 36, textAlign: 'center' }}>{breakMins}m</span>
              <button onClick={() => { if (breakMins < 30) setBreakMins(m => m + 1); }} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 0, color: '#a1a1aa', cursor: 'pointer', width: 22, height: 22, fontSize: '0.875rem' }}>+</button>
            </div>
          </div>
        </div>
      )}

      {/* Circle Timer */}
      <div style={{ position: 'relative', width: 116, height: 116 }}>
        <svg width="116" height="116" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="58" cy="58" r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="5" />
          <circle
            cx="58" cy="58" r={r} fill="none"
            stroke={timerColor}
            strokeWidth="5"
            strokeDasharray={`${dash} ${circ}`}
            strokeLinecap="round"
            style={{
              filter: running ? `drop-shadow(0 0 8px ${timerColor})` : 'none',
              transition: running ? 'stroke-dasharray 0.9s linear' : 'none',
            }}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontFamily: 'monospace', fontSize: '1.5rem', fontWeight: 800, color: '#f4f4f5', lineHeight: 1 }}>
            {mins}:{secs}
          </span>
          {running && (
            <span style={{ fontSize: '0.5625rem', color: timerColor, marginTop: 3, letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 700 }}>
              running
            </span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button
          onClick={handleStartPause}
          style={{
            padding: '0.5rem 1.5rem', borderRadius: 0, border: 'none', cursor: 'pointer',
            background: running ? 'rgba(239,68,68,0.1)' : `rgba(197,160,89,0.12)`,
            color: running ? '#ef4444' : '#c5a059',
            fontWeight: 700, fontSize: '0.8125rem',
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            transition: 'all 0.2s',
            boxShadow: running ? 'none' : '0 0 16px rgba(197,160,89,0.15)',
          }}
        >
          {running ? <><Pause size={14} /> Pause</> : <><Play size={14} /> {seconds === 0 || seconds === total ? 'Start' : 'Resume'}</>}
        </button>
        <button
          onClick={handleReset}
          style={{
            padding: '0.5rem 0.75rem', borderRadius: 0, border: 'none', cursor: 'pointer',
            background: 'rgba(255,255,255,0.04)', color: '#52525b',
            display: 'flex', alignItems: 'center',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#a1a1aa'}
          onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
          title="Reset"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      {/* Session dots */}
      {sessions > 0 && (
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <span style={{ fontSize: '0.625rem', color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sessions</span>
          {Array.from({ length: Math.min(sessions, 8) }).map((_, i) => (
            <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#c5a059', opacity: 0.7 }} />
          ))}
          {sessions > 8 && <span style={{ fontSize: '0.6875rem', color: '#52525b' }}>+{sessions - 8}</span>}
        </div>
      )}

      {/* Mode label when finished */}
      {seconds === 0 && !running && (
        <div style={{
          fontSize: '0.75rem', color: mode === 'focus' ? '#22c55e' : '#c5a059',
          fontWeight: 700, textAlign: 'center',
          padding: '0.375rem 0.75rem', borderRadius: 0,
          background: mode === 'focus' ? 'rgba(34,197,94,0.08)' : 'rgba(197,160,89,0.08)',
        }}>
          {mode === 'focus' ? 'Session complete! Take a break.' : 'Break over! Ready to focus?'}
        </div>
      )}
    </div>
  );
}

// ─── Focus Mode Toggle ────────────────────────────────────────────────────────

interface FocusModeState {
  active: boolean;
  until: string | null;
}

interface FocusModeToggleProps {
  unternehmenId: string;
  focusMode: FocusModeState;
  onToggle: (newState: FocusModeState) => void;
  pendingDurationMins?: number;
}

function FocusModeToggle({ unternehmenId, focusMode, onToggle, pendingDurationMins }: FocusModeToggleProps) {
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    setLoading(true);
    try {
      const newActive = !focusMode.active;
      const body: Record<string, unknown> = { active: newActive };
      if (newActive && pendingDurationMins) body.durationMinutes = pendingDurationMins;

      const res = await authFetch(`/api/unternehmen/${unternehmenId}/focus-mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        onToggle(data);
      }
    } catch {}
    finally { setLoading(false); }
  };

  const timeLeft = focusMode.active && focusMode.until
    ? Math.max(0, Math.floor((new Date(focusMode.until).getTime() - Date.now()) / 60000))
    : null;

  return (
    <div style={{
      padding: '1rem 1.25rem',
      borderRadius: 0,
      background: focusMode.active
        ? 'rgba(197,160,89,0.06)'
        : 'rgba(255,255,255,0.02)',
      border: `1px solid ${focusMode.active ? 'rgba(197,160,89,0.2)' : 'rgba(255,255,255,0.06)'}`,
      transition: 'all 0.3s',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 0, flexShrink: 0,
          background: focusMode.active ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: focusMode.active ? '#c5a059' : '#52525b',
          transition: 'all 0.3s',
        }}>
          {focusMode.active ? <BellOff size={16} /> : <Bell size={16} />}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: focusMode.active ? '#c5a059' : '#a1a1aa' }}>
            {focusMode.active ? 'Focus Mode Active' : 'Focus Mode'}
          </div>
          <div style={{ fontSize: '0.6875rem', color: '#52525b', marginTop: 2 }}>
            {focusMode.active
              ? `Agent notifications suppressed${timeLeft !== null ? ` · ${timeLeft}m left` : ''}`
              : 'Suppress agent chat messages while working'}
          </div>
        </div>

        <button
          onClick={toggle}
          disabled={loading}
          style={{
            padding: '0.375rem 0.875rem',
            borderRadius: 0,
            border: `1px solid ${focusMode.active ? 'rgba(239,68,68,0.3)' : 'rgba(197,160,89,0.3)'}`,
            background: focusMode.active ? 'rgba(239,68,68,0.08)' : 'rgba(197,160,89,0.08)',
            color: focusMode.active ? '#ef4444' : '#c5a059',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontSize: '0.75rem', fontWeight: 700,
            transition: 'all 0.2s',
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? '…' : focusMode.active ? 'Disable' : 'Enable'}
        </button>
      </div>
    </div>
  );
}

// ─── Action Card ─────────────────────────────────────────────────────────────

function ActionCard({ action, onClick, isFocused, onFocusToggle }: {
  action: HumanAction;
  onClick: () => void;
  isFocused: boolean;
  onFocusToggle: () => void;
}) {
  const cfg = REASON_CFG[action.reason] ?? REASON_CFG.high_priority;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '0.875rem 1rem',
        borderRadius: 0,
        background: isFocused
          ? 'rgba(197,160,89,0.06)'
          : hovered ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${isFocused ? 'rgba(197,160,89,0.25)' : hovered ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'}`,
        transition: 'all 0.2s',
        boxShadow: isFocused ? '0 0 16px rgba(197,160,89,0.12)' : hovered ? PRIORITY_GLOW[action.prioritaet] : 'none',
        display: 'flex', flexDirection: 'column', gap: '0.5rem',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span
          onClick={onClick}
          style={{
            fontSize: '0.875rem', fontWeight: 600, color: '#e4e4e7',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            cursor: 'pointer',
          }}
        >
          {action.titel}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); onFocusToggle(); }}
            title={isFocused ? 'Remove focus' : 'Focus on this task'}
            style={{
              background: isFocused ? 'rgba(197,160,89,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${isFocused ? 'rgba(197,160,89,0.3)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 0, cursor: 'pointer',
              color: isFocused ? '#c5a059' : '#52525b',
              padding: '0.2rem 0.375rem',
              fontSize: '0.625rem', fontWeight: 700,
              letterSpacing: '0.04em', textTransform: 'uppercase',
              transition: 'all 0.15s',
            }}
          >
            {isFocused ? 'Focused' : 'Focus'}
          </button>
          <ChevronRight size={14} style={{ color: '#52525b', cursor: 'pointer' }} onClick={onClick} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{
          padding: '0.1rem 0.5rem', borderRadius: 0,
          background: cfg.bg, color: cfg.color,
          fontSize: '0.6875rem', fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 3,
        }}>
          {cfg.icon} {cfg.label}
        </span>
        {action.agentName && (
          <span style={{ fontSize: '0.6875rem', color: '#71717a' }}>
            {action.agentAvatar} {action.agentName}
          </span>
        )}
        {!action.agentName && action.reason === 'unassigned' && (
          <span style={{ fontSize: '0.6875rem', color: '#9b87c8', fontStyle: 'italic' }}>
            Needs agent assignment
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Agent Pulse Card ─────────────────────────────────────────────────────────

function AgentPulseCard({ agent, dimmed }: { agent: ActiveAgent; dimmed?: boolean }) {
  return (
    <div style={{
      padding: '0.75rem',
      borderRadius: 0,
      background: 'rgba(197,160,89,0.03)',
      border: '1px solid rgba(197,160,89,0.1)',
      display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
      opacity: dimmed ? 0.35 : 1,
      transition: 'opacity 0.3s',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 0, flexShrink: 0,
        background: agent.avatarFarbe || '#c5a059',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1rem',
        boxShadow: dimmed ? 'none' : '0 0 10px rgba(197,160,89,0.2)',
        position: 'relative',
      }}>
        {agent.avatar || agent.name[0]}
        <div style={{
          position: 'absolute', bottom: 0, right: 0,
          width: 8, height: 8, borderRadius: '50%',
          background: dimmed ? '#3f3f46' : agent.status === 'running' ? '#c5a059' : '#22c55e',
          border: '2px solid #0a0a0f',
          animation: (!dimmed && agent.status === 'running') ? 'pulse 2s ease-in-out infinite' : 'none',
        }} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#f4f4f5' }}>{agent.name}</div>
        <div style={{ fontSize: '0.6875rem', color: '#71717a', marginBottom: '0.25rem' }}>{agent.rolle}</div>
        {dimmed ? (
          <div style={{ fontSize: '0.75rem', color: '#3f3f46', fontStyle: 'italic' }}>Silenced (Focus Mode)</div>
        ) : agent.currentTask ? (
          <div style={{ fontSize: '0.75rem', color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <span style={{ color: '#c5a059' }}>⚡ </span>{agent.currentTask.titel}
          </div>
        ) : (
          <div style={{ fontSize: '0.75rem', color: '#3f3f46', fontStyle: 'italic' }}>Standing by</div>
        )}
      </div>
    </div>
  );
}

// ─── Daily Goals ─────────────────────────────────────────────────────────────

interface DailyGoal { id: string; text: string; done: boolean; }

const GOALS_KEY = (date: string) => `focus_goals_${date}`;
const TODAY = new Date().toDateString();

function DailyGoals() {
  const [goals, setGoals] = useState<DailyGoal[]>(() => {
    try { return JSON.parse(localStorage.getItem(GOALS_KEY(TODAY)) ?? '[]'); }
    catch { return []; }
  });
  const [input, setInput] = useState('');
  const [allDone, setAllDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const save = (g: DailyGoal[]) => {
    setGoals(g);
    localStorage.setItem(GOALS_KEY(TODAY), JSON.stringify(g));
  };

  useEffect(() => {
    if (goals.length > 0 && goals.every(g => g.done)) {
      setAllDone(true);
    } else {
      setAllDone(false);
    }
  }, [goals]);

  function addGoal() {
    if (!input.trim() || goals.length >= 3) return;
    save([...goals, { id: Math.random().toString(36).slice(2), text: input.trim(), done: false }]);
    setInput('');
    inputRef.current?.focus();
  }

  function toggleGoal(id: string) {
    save(goals.map(g => g.id === id ? { ...g, done: !g.done } : g));
  }

  function removeGoal(id: string) {
    save(goals.filter(g => g.id !== id));
  }

  const doneCount = goals.filter(g => g.done).length;

  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <span style={{
          width: 26, height: 26, borderRadius: 0, background: 'rgba(245,158,11,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b',
        }}>
          <Flag size={14} />
        </span>
        <h2 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: '#f4f4f5' }}>
          Today's Goals
        </h2>
        {goals.length > 0 && (
          <span style={{
            padding: '0.1rem 0.5rem', borderRadius: 0,
            background: allDone ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.1)',
            color: allDone ? '#22c55e' : '#f59e0b',
            fontSize: '0.6875rem', fontWeight: 800,
          }}>
            {doneCount}/{goals.length} {allDone ? '🎉' : ''}
          </span>
        )}
      </div>

      {/* All done celebration */}
      {allDone && goals.length > 0 && (
        <div style={{
          padding: '0.875rem 1rem', borderRadius: 0, marginBottom: '0.75rem',
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)',
          textAlign: 'center', animation: 'pulse 2s ease-in-out',
        }}>
          <div style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>🎉</div>
          <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: '#22c55e' }}>All goals completed!</div>
          <div style={{ fontSize: '0.75rem', color: '#52525b', marginTop: 2 }}>Outstanding work today.</div>
        </div>
      )}

      {/* Goal list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', marginBottom: '0.625rem' }}>
        {goals.map(goal => (
          <div key={goal.id} style={{
            display: 'flex', alignItems: 'center', gap: '0.625rem',
            padding: '0.5rem 0.75rem', borderRadius: 0,
            background: goal.done ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${goal.done ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)'}`,
            transition: 'all 0.2s',
          }}>
            <button
              onClick={() => toggleGoal(goal.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, flexShrink: 0, display: 'flex' }}
            >
              {goal.done
                ? <CheckCircle2 size={16} style={{ color: '#22c55e' }} />
                : <div style={{ width: 16, height: 16, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.2)' }} />
              }
            </button>
            <span style={{
              flex: 1, fontSize: '0.8125rem',
              color: goal.done ? '#52525b' : '#d4d4d8',
              textDecoration: goal.done ? 'line-through' : 'none',
              transition: 'all 0.2s',
            }}>
              {goal.text}
            </span>
            <button
              onClick={() => removeGoal(goal.id)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3f3f46', padding: 2, flexShrink: 0, display: 'flex', opacity: 0.6 }}
              onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
              onMouseLeave={e => e.currentTarget.style.color = '#3f3f46'}
            >
              <XIcon size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Add goal input */}
      {goals.length < 3 && (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addGoal()}
            placeholder={goals.length === 0 ? 'What do you want to achieve today?' : 'Add another goal…'}
            style={{
              flex: 1, padding: '0.5rem 0.75rem',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 0, fontSize: '0.8125rem', color: '#d4d4d8',
              outline: 'none',
            }}
            onFocus={e => e.target.style.borderColor = 'rgba(245,158,11,0.3)'}
            onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.07)'}
          />
          <button
            onClick={addGoal}
            disabled={!input.trim()}
            style={{
              padding: '0.5rem 0.75rem', borderRadius: 0, border: 'none',
              background: input.trim() ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.03)',
              color: input.trim() ? '#f59e0b' : '#3f3f46',
              cursor: input.trim() ? 'pointer' : 'not-allowed',
              display: 'flex', alignItems: 'center', transition: 'all 0.15s',
            }}
          >
            <Plus size={14} />
          </button>
        </div>
      )}
      {goals.length >= 3 && (
        <p style={{ fontSize: '0.6875rem', color: '#3f3f46', margin: '0.25rem 0 0' }}>
          3 goals max — focus on what matters most.
        </p>
      )}
    </section>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Focus() {
  useBreadcrumbs(['Focus Mode']);
  const { aktivesUnternehmen } = useCompany();
  const { language } = useI18n();
  const navigate = useNavigate();

  const [data, setData] = useState<FocusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [standupOpen, setStandupOpen] = useState(false);
  const [focusMode, setFocusMode] = useState<FocusModeState>({ active: false, until: null });
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);

  // Timer duration for focus mode sync (in minutes, updated when timer starts)
  const [pendingTimerMins, setPendingTimerMins] = useState(25);

  const { text: greetText, icon: greetIcon } = greeting();

  const load = useCallback(async () => {
    if (!aktivesUnternehmen) return;
    try {
      const [focusRes, modeRes] = await Promise.all([
        authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/focus`),
        authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/focus-mode`),
      ]);
      if (focusRes.ok) {
        const json = await focusRes.json();
        setData(json);
        setLastRefresh(new Date());
      }
      if (modeRes.ok) {
        const modeJson = await modeRes.json();
        setFocusMode(modeJson);
      }
    } catch {}
    finally { setLoading(false); }
  }, [aktivesUnternehmen?.id]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  // Refresh on tab focus
  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [load]);

  // When focus mode is enabled from the timer starting, also sync server state
  const handleTimerFocusStart = useCallback(async (durationMinutes: number) => {
    if (!aktivesUnternehmen || focusMode.active) return;
    setPendingTimerMins(durationMinutes);
    try {
      const res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/focus-mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true, durationMinutes }),
      });
      if (res.ok) {
        const data = await res.json();
        setFocusMode(data);
      }
    } catch {}
  }, [aktivesUnternehmen?.id, focusMode.active]);

  const handleTimerFocusEnd = useCallback(async () => {
    if (!aktivesUnternehmen || !focusMode.active) return;
    try {
      const res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/focus-mode`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: false }),
      });
      if (res.ok) {
        const data = await res.json();
        setFocusMode(data);
      }
    } catch {}
  }, [aktivesUnternehmen?.id, focusMode.active]);

  if (!aktivesUnternehmen) return null;

  const now = new Date();
  const locale = language === 'de' ? 'de-DE' : 'en-US';
  const timeStr = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1200, margin: '0 auto' }}>

      {/* ── Focus Mode Banner (when active) ──────────────────────────────────── */}
      {focusMode.active && (
        <div style={{
          marginBottom: '1.5rem',
          padding: '0.75rem 1.25rem',
          borderRadius: 0,
          background: 'rgba(197,160,89,0.06)',
          border: '1px solid rgba(197,160,89,0.2)',
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          backdropFilter: 'blur(8px)',
        }}>
          <BellOff size={16} style={{ color: '#c5a059', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: '0.875rem', fontWeight: 700, color: '#c5a059' }}>Focus Mode Active</span>
            <span style={{ fontSize: '0.8125rem', color: '#52525b', marginLeft: '0.5rem' }}>
              — Agent notifications are suppressed. You won't be interrupted.
              {focusMode.until && (
                <span style={{ color: '#3f3f46' }}> Ends at {new Date(focusMode.until).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}.</span>
              )}
            </span>
          </div>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.375rem' }}>
              {greetIcon}
              <h1 style={{
                fontSize: '1.75rem', fontWeight: 800, margin: 0,
                background: 'linear-gradient(135deg, #f4f4f5, #a1a1aa)',
                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              }}>
                {greetText}
              </h1>
            </div>
            <p style={{ color: '#52525b', fontSize: '0.875rem', margin: 0 }}>
              {dateStr} · {timeStr}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <span style={{ fontSize: '0.75rem', color: '#3f3f46' }}>
              {language === 'de' ? 'Aktualisiert' : 'Refreshed'} {lastRefresh.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
            </span>
            <button
              onClick={() => setStandupOpen(true)}
              style={{
                padding: '0.375rem 0.75rem', borderRadius: 0,
                background: 'rgba(155,135,200,0.08)', border: '1px solid rgba(155,135,200,0.2)',
                color: '#9b87c8', cursor: 'pointer', fontSize: '0.75rem',
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                fontWeight: 600, transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(155,135,200,0.14)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(155,135,200,0.08)'; }}
            >
              <MessagesSquare size={13} /> Standup
            </button>
            <button
              onClick={load}
              style={{
                padding: '0.375rem 0.75rem', borderRadius: 0,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
                color: '#71717a', cursor: 'pointer', fontSize: '0.75rem',
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#c5a059'; e.currentTarget.style.borderColor = 'rgba(197,160,89,0.3)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <PageHelp id="focus" lang={language} />

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', color: '#52525b', fontSize: '0.875rem' }}>
          <Zap size={20} style={{ marginRight: '0.625rem', animation: 'spin 1.5s linear infinite', color: '#c5a059' }} />
          Loading your focus data…
        </div>
      ) : data && (
        <>
          {/* ── Stat pills ────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
            {[
              { label: 'Open Tasks', value: data.stats.total_open, color: '#94a3b8', icon: <Target size={14} /> },
              { label: 'In Progress', value: data.stats.in_progress, color: '#c5a059', icon: <Zap size={14} /> },
              { label: 'Done Today', value: data.velocity.today, color: '#22c55e', icon: <CheckCircle2 size={14} /> },
              { label: 'Agents Active', value: data.stats.agents, color: '#9b87c8', icon: <Users size={14} /> },
              ...(data.pending_approvals > 0 ? [{ label: 'Approvals', value: data.pending_approvals, color: '#ef4444', icon: <Shield size={14} /> }] : []),
            ].map(stat => (
              <div key={stat.label} style={{
                padding: '0.5rem 1rem', borderRadius: 0,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                display: 'flex', alignItems: 'center', gap: '0.5rem',
              }}>
                <span style={{ color: stat.color }}>{stat.icon}</span>
                <span style={{ fontSize: '1.125rem', fontWeight: 800, color: '#f4f4f5' }}>{stat.value}</span>
                <span style={{ fontSize: '0.75rem', color: '#71717a' }}>{stat.label}</span>
              </div>
            ))}

            {data.velocity.week_avg > 0 && (
              <div style={{
                padding: '0.5rem 1rem', borderRadius: 0,
                background: 'rgba(197,160,89,0.04)',
                border: '1px solid rgba(197,160,89,0.12)',
                display: 'flex', alignItems: 'center', gap: '0.5rem',
              }}>
                <TrendingUp size={14} style={{ color: '#c5a059' }} />
                <span style={{ fontSize: '0.75rem', color: '#71717a' }}>
                  Avg <strong style={{ color: '#c5a059' }}>{data.velocity.week_avg}/day</strong> this week
                </span>
              </div>
            )}
          </div>

          {/* ── Main Grid ─────────────────────────────────────────────────────── */}
          <div className="focus-grid">

            {/* LEFT COLUMN */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

              {/* Daily Goals */}
              <DailyGoals />

              {/* Action Required */}
              <section>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.875rem' }}>
                  <h2 style={{
                    margin: 0, fontSize: '0.9375rem', fontWeight: 700,
                    display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f4f4f5',
                  }}>
                    <span style={{
                      width: 26, height: 26, borderRadius: 0, background: 'rgba(239,68,68,0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444',
                    }}>
                      <AlertTriangle size={14} />
                    </span>
                    Action Required
                    {data.human_actions.length > 0 && (
                      <span style={{
                        padding: '0.1rem 0.5rem', borderRadius: 0,
                        background: 'rgba(239,68,68,0.15)', color: '#ef4444',
                        fontSize: '0.6875rem', fontWeight: 800,
                      }}>{data.human_actions.length}</span>
                    )}
                  </h2>
                  <button
                    onClick={() => navigate('/tasks')}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#52525b', fontSize: '0.75rem',
                      display: 'flex', alignItems: 'center', gap: 4,
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#c5a059'}
                    onMouseLeave={e => e.currentTarget.style.color = '#52525b'}
                  >
                    View all <ArrowRight size={12} />
                  </button>
                </div>

                {focusedTaskId && (
                  <div style={{
                    padding: '0.5rem 0.875rem', marginBottom: '0.625rem', borderRadius: 0,
                    background: 'rgba(197,160,89,0.05)', border: '1px solid rgba(197,160,89,0.15)',
                    fontSize: '0.75rem', color: '#c5a059',
                    display: 'flex', alignItems: 'center', gap: '0.375rem',
                  }}>
                    <Target size={12} />
                    Focusing on one task — other tasks are dimmed. Click "Focused" to clear.
                  </div>
                )}

                {data.human_actions.length === 0 ? (
                  <div style={{
                    padding: '2rem', borderRadius: 0, textAlign: 'center',
                    background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.1)',
                  }}>
                    <CheckCircle2 size={28} style={{ color: '#22c55e', margin: '0 auto 0.625rem', display: 'block' }} />
                    <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.9375rem' }}>All clear!</div>
                    <div style={{ color: '#52525b', fontSize: '0.8125rem', marginTop: 4 }}>
                      No tasks need your attention right now.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {data.human_actions.map(action => (
                      <div
                        key={action.id}
                        style={{
                          opacity: focusedTaskId && focusedTaskId !== action.id ? 0.35 : 1,
                          transition: 'opacity 0.3s',
                        }}
                      >
                        <ActionCard
                          action={action}
                          isFocused={focusedTaskId === action.id}
                          onClick={() => navigate('/tasks', { state: { openTaskId: action.id } })}
                          onFocusToggle={() => setFocusedTaskId(prev => prev === action.id ? null : action.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Pending Approvals Banner */}
              {data.pending_approvals > 0 && (
                <div
                  onClick={() => navigate('/approvals')}
                  style={{
                    padding: '1rem 1.25rem', borderRadius: 0,
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.2)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.1)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.06)'; }}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: 0,
                    background: 'rgba(239,68,68,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ef4444',
                  }}>
                    <Shield size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: '#f4f4f5', fontSize: '0.875rem' }}>
                      {data.pending_approvals} pending approval{data.pending_approvals !== 1 ? 's' : ''}
                    </div>
                    <div style={{ color: '#71717a', fontSize: '0.75rem' }}>
                      Agents waiting for your decision
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: '#52525b' }} />
                </div>
              )}

              {/* Completed Today */}
              {data.completed_today.length > 0 && (
                <section>
                  <h2 style={{
                    margin: '0 0 0.875rem', fontSize: '0.9375rem', fontWeight: 700,
                    display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f4f4f5',
                  }}>
                    <span style={{
                      width: 26, height: 26, borderRadius: 0, background: 'rgba(34,197,94,0.12)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#22c55e',
                    }}>
                      <CheckCircle2 size={14} />
                    </span>
                    Today's Wins
                    <span style={{
                      padding: '0.1rem 0.5rem', borderRadius: 0,
                      background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                      fontSize: '0.6875rem', fontWeight: 800,
                    }}>{data.completed_today.length}</span>
                  </h2>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    {data.completed_today.map(task => (
                      <div key={task.id} style={{
                        padding: '0.625rem 0.875rem', borderRadius: 0,
                        background: 'rgba(34,197,94,0.03)', border: '1px solid rgba(34,197,94,0.07)',
                        display: 'flex', alignItems: 'center', gap: '0.625rem',
                      }}>
                        <CheckCircle2 size={14} style={{ color: '#22c55e', flexShrink: 0 }} />
                        <span style={{ fontSize: '0.8125rem', color: '#a1a1aa', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {task.titel}
                        </span>
                        {task.agentName && (
                          <span style={{ fontSize: '0.6875rem', color: '#3f3f46', flexShrink: 0 }}>
                            by {task.agentName}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            {/* RIGHT COLUMN */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

              {/* Pomodoro Timer */}
              <PomodoroTimer
                onFocusStart={handleTimerFocusStart}
                onFocusEnd={handleTimerFocusEnd}
              />

              {/* Focus Mode Toggle */}
              <FocusModeToggle
                unternehmenId={aktivesUnternehmen.id}
                focusMode={focusMode}
                onToggle={setFocusMode}
                pendingDurationMins={pendingTimerMins}
              />

              {/* AI Team Active */}
              <section>
                <h2 style={{
                  margin: '0 0 0.875rem', fontSize: '0.9375rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f4f4f5',
                }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: 0, background: 'rgba(197,160,89,0.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c5a059',
                  }}>
                    <Sparkles size={14} />
                  </span>
                  AI Team
                  {data.ai_active.length > 0 && (
                    <span style={{
                      padding: '0.1rem 0.5rem', borderRadius: 0,
                      background: focusMode.active ? 'rgba(197,160,89,0.06)' : 'rgba(197,160,89,0.12)',
                      color: focusMode.active ? '#52525b' : '#c5a059',
                      fontSize: '0.6875rem', fontWeight: 800,
                    }}>
                      {data.ai_active.length} {focusMode.active ? 'silenced' : 'active'}
                    </span>
                  )}
                </h2>

                {data.ai_active.length === 0 ? (
                  <div style={{
                    padding: '1.5rem', borderRadius: 0, textAlign: 'center',
                    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <Clock size={22} style={{ color: '#3f3f46', margin: '0 auto 0.5rem', display: 'block' }} />
                    <div style={{ color: '#52525b', fontSize: '0.8125rem' }}>Agents standing by</div>
                    <button
                      onClick={() => navigate('/experts')}
                      style={{
                        marginTop: '0.75rem', padding: '0.375rem 0.875rem',
                        borderRadius: 0, border: '1px solid rgba(255,255,255,0.06)',
                        background: 'rgba(255,255,255,0.03)', color: '#71717a',
                        cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600,
                        transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = '#c5a059'; e.currentTarget.style.borderColor = 'rgba(197,160,89,0.3)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
                    >
                      Manage agents
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {data.ai_active.map(agent => (
                      <AgentPulseCard key={agent.id} agent={agent} dimmed={focusMode.active} />
                    ))}
                  </div>
                )}
              </section>

              {/* Quick Navigation */}
              <section>
                <h2 style={{
                  margin: '0 0 0.75rem', fontSize: '0.9375rem', fontWeight: 700, color: '#f4f4f5',
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                }}>
                  <span style={{ width: 26, height: 26, borderRadius: 0, background: 'rgba(155,135,200,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9b87c8' }}>
                    <Zap size={14} />
                  </span>
                  Quick Jump
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  {[
                    { label: 'New Task', icon: '➕', path: '/tasks', hint: 'Assign to an agent' },
                    { label: 'Live Room', icon: '🎯', path: '/war-room', hint: 'Live agent view' },
                    { label: 'Goals', icon: '🏆', path: '/goals', hint: 'Track objectives' },
                    { label: 'Performance', icon: '📈', path: '/performance', hint: 'Agent metrics' },
                  ].map(item => (
                    <button
                      key={item.path}
                      onClick={() => navigate(item.path)}
                      style={{
                        padding: '0.625rem 0.875rem', borderRadius: 0,
                        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                        cursor: 'pointer', textAlign: 'left',
                        display: 'flex', alignItems: 'center', gap: '0.625rem',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.05)'; }}
                    >
                      <span style={{ fontSize: '1rem' }}>{item.icon}</span>
                      <div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#e4e4e7' }}>{item.label}</div>
                        <div style={{ fontSize: '0.6875rem', color: '#52525b' }}>{item.hint}</div>
                      </div>
                      <ChevronRight size={13} style={{ marginLeft: 'auto', color: '#3f3f46' }} />
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </>
      )}

      <StandupPanel open={standupOpen} onClose={() => setStandupOpen(false)} />

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .focus-grid {
          display: grid;
          grid-template-columns: minmax(0,1fr) 320px;
          gap: 1.5rem;
          align-items: start;
        }
        @media (max-width: 900px) {
          .focus-grid {
            grid-template-columns: 1fr;
          }
        }
      `}} />
    </div>
  );
}
