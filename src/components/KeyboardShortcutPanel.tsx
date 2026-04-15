import { useEffect } from 'react';
import { X, Keyboard } from 'lucide-react';
import { useI18n } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; label: string }[];
}

function Kbd({ k }: { k: string }) {
  const isText = k.length > 1;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: isText ? 'auto' : 24, height: 24,
      padding: isText ? '0 8px' : '0 4px',
      borderRadius: '6px',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderBottom: '2px solid rgba(255,255,255,0.08)',
      fontSize: '0.6875rem', fontWeight: 700, fontFamily: 'monospace',
      color: '#d4d4d8', letterSpacing: '0.02em',
    }}>
      {k}
    </span>
  );
}

export function KeyboardShortcutPanel({ open, onClose }: Props) {
  const { language } = useI18n();
  const de = language === 'de';

  const groups: ShortcutGroup[] = [
    {
      title: de ? 'Global' : 'Global',
      shortcuts: [
        { keys: ['⌘', 'K'], label: de ? 'Befehlspalette öffnen' : 'Open command palette' },
        { keys: ['?'], label: de ? 'Tastaturkürzel anzeigen' : 'Show keyboard shortcuts' },
        { keys: ['Esc'], label: de ? 'Modal / Drawer schließen' : 'Close modal / drawer' },
      ],
    },
    {
      title: de ? 'Aufgaben (Tasks)' : 'Tasks',
      shortcuts: [
        { keys: ['⌘', 'K', '>', '↵'], label: de ? 'Sofort-Aufgabe erstellen & zuweisen' : 'Quick-create & assign task' },
        { keys: ['N'], label: de ? 'Neue Aufgabe erstellen' : 'Create new task' },
        { keys: ['1'], label: de ? 'Kanban-Ansicht' : 'Kanban view' },
        { keys: ['2'], label: de ? 'Listen-Ansicht' : 'List view' },
        { keys: ['3'], label: de ? 'Timeline-Ansicht' : 'Timeline view' },
        { keys: ['/'], label: de ? 'Aufgaben suchen' : 'Search tasks' },
        { keys: ['Shift', 'Klick'], label: de ? 'Mehrere Aufgaben auswählen' : 'Multi-select tasks' },
        { keys: ['Del'], label: de ? 'Ausgewählte Aufgaben löschen' : 'Delete selected tasks' },
      ],
    },
    {
      title: de ? 'Aufgaben-Drawer' : 'Task Drawer',
      shortcuts: [
        { keys: ['Esc'], label: de ? 'Drawer schließen' : 'Close drawer' },
        { keys: ['⌘', '↵'], label: de ? 'Kommentar senden' : 'Send comment' },
      ],
    },
    {
      title: de ? 'Navigation' : 'Navigation',
      shortcuts: [
        { keys: ['↑', '↓'], label: de ? 'In Palette navigieren' : 'Navigate in palette' },
        { keys: ['↵'], label: de ? 'Auswahl bestätigen' : 'Confirm selection' },
      ],
    },
    {
      title: de ? 'Ansichten' : 'Views',
      shortcuts: [
        { keys: ['/focus'], label: de ? 'Focus Mode — Tagesplanung & Pomodoro' : 'Focus Mode — daily planner & Pomodoro' },
        { keys: ['/war-room'], label: de ? 'War Room — Echtzeit-Agenten-Übersicht (Fullscreen)' : 'War Room — live agent overview (fullscreen)' },
        { keys: ['/weekly-report'], label: de ? 'Wochenbericht — KI-Leistungsanalyse' : 'Weekly Report — AI performance digest' },
      ],
    },
  ];

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        backgroundColor: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9998, padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '560px',
          background: 'rgba(10,10,20,0.97)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '20px',
          overflow: 'hidden',
          boxShadow: '0 40px 100px rgba(0,0,0,0.8)',
          animation: 'slideDown 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
          maxHeight: '80vh', overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '10px',
              background: 'rgba(35,205,202,0.12)', border: '1px solid rgba(35,205,202,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Keyboard size={16} style={{ color: '#23CDCB' }} />
            </div>
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#f1f5f9' }}>
                {de ? 'Tastaturkürzel' : 'Keyboard Shortcuts'}
              </div>
              <div style={{ fontSize: '0.6875rem', color: '#52525b' }}>
                {de ? 'Drücke ? jederzeit um dieses Panel zu öffnen' : 'Press ? anytime to open this panel'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#52525b', padding: 4, display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Groups */}
        <div style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {groups.map((group, gi) => (
            <div key={gi}>
              <div style={{
                fontSize: '0.6875rem', fontWeight: 700, color: '#3f3f46',
                textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem',
              }}>
                {group.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {group.shortcuts.map((s, si) => (
                  <div key={si} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '0.4rem 0.625rem', borderRadius: '8px',
                    background: 'rgba(255,255,255,0.02)',
                    transition: 'background 0.1s',
                  }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  >
                    <span style={{ fontSize: '0.8125rem', color: '#a1a1aa' }}>{s.label}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                      {s.keys.map((k, ki) => (
                        <span key={ki} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Kbd k={k} />
                          {ki < s.keys.length - 1 && (
                            <span style={{ fontSize: '0.625rem', color: '#3f3f46' }}>+</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{
          padding: '0.75rem 1.5rem',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          fontSize: '0.6875rem', color: '#3f3f46', textAlign: 'center',
        }}>
          {de ? 'Tipp: ⌘K öffnet die Befehlspalette. Tippe > für eine Sofort-Aufgabe.' : 'Tip: ⌘K opens the command palette. Type > for a quick task.'}
        </div>
      </div>
    </div>
  );
}
