import { useState, useEffect } from 'react';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { Clock, Plus, Play, Pause, Trash2, Settings, Activity, Zap } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { Select } from '../components/Select';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useToast } from '../components/ToastProvider';

interface Routine {
  id: string;
  unternehmenId: string;
  titel: string;
  beschreibung: string | null;
  zugewiesenAn: string | null;
  prioritaet: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'paused';
  concurrencyPolicy: string;
  catchUpPolicy: string;
  variablen: string | null;
  zuletztAusgefuehrtAm: string | null;
  zuletztEnqueuedAm: string | null;
  erstelltAm: string;
  aktualisiertAm: string;
}

interface Trigger {
  id: string;
  routineId: string;
  kind: 'schedule' | 'webhook' | 'api';
  aktiv: boolean;
  cronExpression: string | null;
  timezone: string | null;
  naechsterAusfuehrungAm: string | null;
  zuletztGefeuertAm: string | null;
}

interface Experte {
  id: string;
  name: string;
  rolle: string;
}

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('opencognit_token');
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export function Routines() {
  const i18n = useI18n();
  const { language } = i18n;
  const de = language === 'de';
  const toast = useToast();
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', i18n.t.nav.routinen]);
  const [routinen, setRoutinen] = useState<Routine[]>([]);
  const [experten, setExperten] = useState<Experte[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedRoutine, setSelectedRoutine] = useState<Routine | null>(null);
  const [triggers, setTriggers] = useState<Record<string, Trigger[]>>({});

  // Form state
  const [formData, setFormData] = useState({
    titel: '',
    beschreibung: '',
    zugewiesenAn: '',
    prioritaet: 'medium',
  });

  useEffect(() => {
    if (aktivesUnternehmen) {
      loadRoutinen();
      loadExperten();
    }
  }, [aktivesUnternehmen]);

  async function loadRoutinen() {
    if (!aktivesUnternehmen) return;
    try {
      const data = await fetchApi<Routine[]>(`/api/unternehmen/${aktivesUnternehmen.id}/routinen`);
      setRoutinen(data);

      // Load triggers for each routine
      const triggersMap: Record<string, Trigger[]> = {};
      for (const routine of data) {
        const routineTriggers = await fetchApi<Trigger[]>(`/api/routinen/${routine.id}/triggers`);
        triggersMap[routine.id] = routineTriggers;
      }
      setTriggers(triggersMap);
    } catch (error) {
      console.error('Failed to load routinen:', error);
    } finally {
      setLoading(false);
    }
  }

  async function loadExperten() {
    if (!aktivesUnternehmen) return;
    try {
      const data = await fetchApi<Experte[]>(`/api/unternehmen/${aktivesUnternehmen.id}/experten`);
      setExperten(data);
    } catch (error) {
      console.error('Failed to load experten:', error);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const isEdit = !!selectedRoutine;
    try {
      if (isEdit) {
        await fetchApi(`/api/routinen/${selectedRoutine!.id}`, {
          method: 'PATCH',
          body: JSON.stringify(formData),
        });
      } else {
        await fetchApi(`/api/unternehmen/${aktivesUnternehmen!.id}/routinen`, {
          method: 'POST',
          body: JSON.stringify(formData),
        });
      }
      setShowModal(false);
      setSelectedRoutine(null);
      setFormData({ titel: '', beschreibung: '', zugewiesenAn: '', prioritaet: 'medium' });
      loadRoutinen();
      toast.success(
        isEdit
          ? (de ? 'Routine aktualisiert' : 'Routine updated')
          : (de ? 'Routine erstellt' : 'Routine created'),
        formData.titel || undefined,
      );
    } catch (error) {
      toast.error(de ? 'Fehler beim Speichern' : 'Save failed', (error as Error).message);
    }
  }

  async function deleteRoutine(id: string, titel?: string) {
    if (!confirm(i18n.t.routinen.confirmDelete)) return;
    try {
      await fetchApi(`/api/routinen/${id}`, { method: 'DELETE' });
      loadRoutinen();
      toast.info(de ? 'Routine gelöscht' : 'Routine deleted', titel);
    } catch (error) {
      toast.error(de ? 'Fehler beim Löschen' : 'Delete failed', (error as Error).message);
    }
  }

  async function toggleRoutineStatus(routine: Routine) {
    const nextStatus = routine.status === 'active' ? 'paused' : 'active';
    try {
      await fetchApi(`/api/routinen/${routine.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: nextStatus }),
      });
      loadRoutinen();
      toast.info(
        nextStatus === 'active'
          ? (de ? `${routine.titel} aktiviert` : `${routine.titel} activated`)
          : (de ? `${routine.titel} pausiert` : `${routine.titel} paused`),
      );
    } catch (error) {
      toast.error(de ? 'Fehler' : 'Error', (error as Error).message);
    }
  }

  async function triggerManual(routine: Routine) {
    try {
      await fetchApi(`/api/routinen/${routine.id}/trigger`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      loadRoutinen();
      toast.agent(
        de ? `${routine.titel} gestartet` : `${routine.titel} triggered`,
        de ? 'Routine wird ausgeführt…' : 'Routine is being executed…',
      );
    } catch (error) {
      toast.error(de ? 'Fehler beim Auslösen' : 'Trigger failed', (error as Error).message);
    }
  }

  function openNewRoutineModal() {
    setSelectedRoutine(null);
    setFormData({ titel: '', beschreibung: '', zugewiesenAn: '', prioritaet: 'medium' });
    setShowModal(true);
  }

  function openEditModal(routine: Routine) {
    setSelectedRoutine(routine);
    setFormData({
      titel: routine.titel,
      beschreibung: routine.beschreibung || '',
      zugewiesenAn: routine.zugewiesenAn || '',
      prioritaet: routine.prioritaet,
    });
    setShowModal(true);
  }

  function formatCronHuman(cron: string): string {
    const parts = cron.split(' ');
    if (parts.length !== 5) return cron;

    const [min, hour, dom, month, dow] = parts;
    const texts: string[] = [];
    const r = i18n.t.routinen;

    if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      return r.cronEveryMinute;
    }
    if (min === '0' && hour === '9' && dom === '*' && month === '*' && dow === '*') {
      return r.cronDaily;
    }
    if (min === '0' && hour === '0' && dom === '*' && month === '*' && dow === '1') {
      return r.cronWeekly;
    }
    if (min.includes('/')) {
      texts.push(r.cronMinutes.replace('{minutes}', min.split('/')[1]));
    } else if (min !== '*') {
      texts.push(r.cronMinute.replace('{minute}', min));
    }
    if (hour.includes('/')) {
      texts.push(r.cronHours.replace('{hours}', hour.split('/')[1]));
    } else if (hour !== '*') {
      texts.push(r.cronHour.replace('{hour}', hour));
    }
    if (dow !== '*') {
      const days = [r.cronDay.sunday, r.cronDay.monday, r.cronDay.tuesday, r.cronDay.wednesday, r.cronDay.thursday, r.cronDay.friday, r.cronDay.saturday];
      texts.push(days[parseInt(dow)] ?? dow);
    }

    return texts.join(', ') || cron;
  }

  function getPrioritaetColor(p: string) {
    switch (p) {
      case 'critical': return '#ef4444';
      case 'high': return '#f97316';
      case 'medium': return '#eab308';
      case 'low': return '#22c55e';
      default: return '#71717a';
    }
  }

  if (!aktivesUnternehmen) {
    return (
      <div style={styles.container}>
        <p style={styles.noSelection}>{i18n.t.routinen.noCompanySelected}</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>{i18n.t.routinen.title}</h1>
          <p style={styles.subtitle}>{i18n.t.routinen.subtitle}</p>
        </div>
        <button style={styles.primaryButton} onClick={openNewRoutineModal}>
          <Plus size={18} />
          <span>{i18n.t.routinen.createNew}</span>
        </button>
      </div>

      <PageHelp id="routines" lang={i18n.language} />

      {/* Stats */}
      <div style={styles.statsGrid}>
        <div style={styles.statCard}>
          <div style={{ ...styles.statIcon, background: 'rgba(35, 205, 202, 0.15)' }}>
            <Activity size={20} color="#23CDCB" />
          </div>
          <div>
            <div style={styles.statValue}>{routinen.filter(r => r.status === 'active').length}</div>
            <div style={styles.statLabel}>{i18n.t.routinen.activeRoutines}</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statIcon, background: 'rgba(234, 179, 8, 0.15)' }}>
            <Clock size={20} color="#eab308" />
          </div>
          <div>
            <div style={styles.statValue}>{Object.values(triggers).flat().filter((t: Trigger) => t.aktiv).length}</div>
            <div style={styles.statLabel}>{i18n.t.routinen.activeTriggers}</div>
          </div>
        </div>
        <div style={styles.statCard}>
          <div style={{ ...styles.statIcon, background: 'rgba(35, 205, 202, 0.15)' }}>
            <Zap size={20} color="#23CDCB" />
          </div>
          <div>
            <div style={styles.statValue}>{routinen.length}</div>
            <div style={styles.statLabel}>{i18n.t.routinen.totalRoutines}</div>
          </div>
        </div>
      </div>

      {/* Routinen List */}
      <div style={styles.card}>
        <div style={styles.tableHeader}>
          <span style={{ ...styles.tableCell, flex: 2 }}>{i18n.t.routinen.routine}</span>
          <span style={styles.tableCell}>{i18n.t.routinen.agent}</span>
          <span style={styles.tableCell}>{i18n.t.routinen.trigger}</span>
          <span style={styles.tableCell}>{i18n.t.routinen.priority}</span>
          <span style={styles.tableCell}>{i18n.t.routinen.status}</span>
          <span style={{ ...styles.tableCell, textAlign: 'right' }}>{i18n.t.routinen.actions}</span>
        </div>

        {loading ? (
          <div style={styles.loading}>{i18n.t.routinen.loadingRoutines}</div>
        ) : routinen.length === 0 ? (
          <div style={styles.empty}>
            <Settings size={48} color="#3f3f46" />
            <p style={styles.emptyText}>{i18n.t.routinen.noRoutines}</p>
            <p style={styles.emptySubtext}>{i18n.t.routinen.noRoutinesSubtext}</p>
          </div>
        ) : (
          <div style={styles.tableBody}>
            {routinen.map((routine) => (
              <div key={routine.id} style={styles.tableRow}>
                <div style={{ ...styles.tableCell, flex: 2 }}>
                  <div style={styles.routineName}>{routine.titel}</div>
                  {routine.beschreibung && (
                    <div style={styles.routineDesc}>{routine.beschreibung}</div>
                  )}
                </div>
                <div style={styles.tableCell}>
                  {experten.find(e => e.id === routine.zugewiesenAn)?.name || i18n.t.routinen.noAgent}
                </div>
                <div style={styles.tableCell}>
                  {triggers[routine.id]?.map((t: Trigger, i: number) => (
                    <div key={t.id} style={styles.triggerBadge}>
                      {t.kind === 'schedule' && t.cronExpression ? (
                        <span title={t.cronExpression}>
                          {formatCronHuman(t.cronExpression)}
                        </span>
                      ) : (
                        <span>{t.kind}</span>
                      )}
                      {!t.aktiv && <span style={styles.inactiveBadge}> ({i18n.language === 'de' ? 'inaktiv' : 'inactive'})</span>}
                    </div>
                  )) || i18n.t.routinen.noTriggers}
                </div>
                <div style={styles.tableCell}>
                  <span
                    style={{
                      ...styles.priorityBadge,
                      background: getPrioritaetColor(routine.prioritaet),
                    }}
                  >
                    {routine.prioritaet}
                  </span>
                </div>
                <div style={styles.tableCell}>
                  <span
                    style={{
                      ...styles.statusBadge,
                      background: routine.status === 'active'
                        ? 'rgba(34, 197, 94, 0.15)'
                        : 'rgba(113, 113, 122, 0.15)',
                      color: routine.status === 'active' ? '#22c55e' : '#71717a',
                    }}
                  >
                    {routine.status}
                  </span>
                </div>
                <div style={{ ...styles.tableCell, display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                  <button
                    style={styles.iconButton}
                    onClick={() => toggleRoutineStatus(routine)}
                    title={routine.status === 'active' ? i18n.t.actions.pausieren : i18n.t.actions.fortsetzen}
                  >
                    {routine.status === 'active' ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <button
                    style={styles.iconButton}
                    onClick={() => triggerManual(routine)}
                    title="Manuell ausführen"
                  >
                    <Zap size={16} />
                  </button>
                  <button
                    style={styles.iconButton}
                    onClick={() => openEditModal(routine)}
                    title={i18n.t.actions.bearbeiten}
                  >
                    <Settings size={16} />
                  </button>
                  <button
                    style={{ ...styles.iconButton, ...styles.deleteButton }}
                    onClick={() => deleteRoutine(routine.id, routine.titel)}
                    title={i18n.t.actions.loeschen}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
        }} onClick={() => setShowModal(false)}>
          <div
            style={{
              background: 'var(--color-bg-secondary)',
              border: '1px solid var(--color-border)',
              borderRadius: '16px',
              padding: '2rem',
              width: '100%',
              maxWidth: '500px',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
              backdropFilter: 'blur(10px)',
              position: 'relative',
              zIndex: 1001,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{
              fontSize: '1.25rem',
              fontWeight: 700,
              color: '#ffffff',
              marginBottom: '1.5rem',
            }}>
              {selectedRoutine ? i18n.t.routinen.modalEdit : i18n.t.routinen.modalCreate}
            </h2>
            <form onSubmit={handleSubmit}>
              <div style={{
                marginBottom: '1.25rem',
              }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                  marginBottom: '0.5rem',
                }}>{i18n.t.routinen.formTitle}</label>
                <input
                  type="text"
                  value={formData.titel}
                  onChange={(e) => setFormData({ ...formData, titel: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    background: 'var(--color-bg-input)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '10px',
                    color: 'var(--color-text-primary)',
                    fontSize: '0.875rem',
                    outline: 'none',
                    transition: 'border-color 0.2s',
                  }}
                  placeholder={i18n.t.routinen.formTitlePlaceholder}
                  required
                />
              </div>
              <div style={{
                marginBottom: '1.25rem',
              }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                  marginBottom: '0.5rem',
                }}>{i18n.t.routinen.formDescription}</label>
                <textarea
                  value={formData.beschreibung}
                  onChange={(e) => setFormData({ ...formData, beschreibung: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    background: 'var(--color-bg-input)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '10px',
                    color: 'var(--color-text-primary)',
                    fontSize: '0.875rem',
                    outline: 'none',
                    minHeight: '80px',
                    resize: 'vertical',
                  }}
                  placeholder={i18n.t.routinen.formDescriptionPlaceholder}
                />
              </div>
              <div style={{
                marginBottom: '1.25rem',
              }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                  marginBottom: '0.5rem',
                }}>{i18n.t.routinen.formAssignedTo}</label>
                <Select
                  value={formData.zugewiesenAn}
                  onChange={v => setFormData({ ...formData, zugewiesenAn: v })}
                  options={[
                    { value: '', label: i18n.t.routinen.noAgent },
                    ...experten.map(e => ({ value: e.id, label: `${e.name} (${e.rolle})` })),
                  ]}
                />
              </div>
              <div style={{
                marginBottom: '1.25rem',
              }}>
                <label style={{
                  display: 'block',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--color-text-secondary)',
                  marginBottom: '0.5rem',
                }}>{i18n.t.routinen.formPriority}</label>
                <Select
                  value={formData.prioritaet}
                  onChange={v => setFormData({ ...formData, prioritaet: v })}
                  options={[
                    { value: 'low', label: i18n.t.priority.low },
                    { value: 'medium', label: i18n.t.priority.medium },
                    { value: 'high', label: i18n.t.priority.high },
                    { value: 'critical', label: i18n.t.priority.critical },
                  ]}
                />
              </div>
              <div style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '0.75rem',
                marginTop: '1.5rem',
              }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  style={{
                    padding: '0.75rem 1.25rem',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '10px',
                    color: 'var(--color-text-secondary)',
                    fontWeight: 500,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {i18n.t.routinen.buttonCancel}
                </button>
                <button
                  type="submit"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.75rem 1.25rem',
                    background: 'linear-gradient(135deg, rgba(35, 205, 202, 0.2), rgba(35, 205, 202, 0.1))',
                    border: '1px solid rgba(35, 205, 202, 0.3)',
                    borderRadius: '10px',
                    color: '#23CDCB',
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {selectedRoutine ? i18n.t.actions.speichern : i18n.t.routinen.buttonCreate}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'relative',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '2rem',
    position: 'relative',
    zIndex: 1,
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 700,
    background: 'linear-gradient(to right, #23CDCB, #ffffff)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    marginBottom: '0.5rem',
  },
  subtitle: {
    color: '#71717a',
    fontSize: '0.9375rem',
  },
  primaryButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem 1.25rem',
    background: 'linear-gradient(135deg, rgba(35, 205, 202, 0.2), rgba(35, 205, 202, 0.1))',
    border: '1px solid rgba(35, 205, 202, 0.3)',
    borderRadius: '10px',
    color: '#23CDCB',
    fontWeight: 600,
    fontSize: '0.875rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  secondaryButton: {
    padding: '0.75rem 1.25rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
    color: '#a1a1aa',
    fontWeight: 500,
    fontSize: '0.875rem',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '1rem',
    marginBottom: '2rem',
    position: 'relative',
    zIndex: 1,
  },
  statCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1.25rem',
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '12px',
    backdropFilter: 'blur(10px)',
  },
  statIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: '10px',
  },
  statValue: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#ffffff',
  },
  statLabel: {
    fontSize: '0.8125rem',
    color: '#71717a',
  },
  card: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '12px',
    backdropFilter: 'blur(10px)',
    position: 'relative',
    zIndex: 1,
  },
  tableHeader: {
    display: 'flex',
    padding: '1rem 1.25rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#71717a',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
  },
  tableCell: {
    flex: 1,
    color: '#a1a1aa',
    fontSize: '0.875rem',
  },
  tableBody: {
    padding: '0.5rem',
  },
  tableRow: {
    display: 'flex',
    padding: '1rem 1.25rem',
    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
    transition: 'background 0.2s',
  },
  routineName: {
    fontWeight: 600,
    color: '#ffffff',
    marginBottom: '0.25rem',
  },
  routineDesc: {
    fontSize: '0.8125rem',
    color: '#71717a',
  },
  triggerBadge: {
    display: 'inline-block',
    padding: '0.25rem 0.625rem',
    background: 'rgba(35, 205, 202, 0.1)',
    border: '1px solid rgba(35, 205, 202, 0.2)',
    borderRadius: '6px',
    fontSize: '0.75rem',
    color: '#23CDCB',
    marginBottom: '0.25rem',
  },
  inactiveBadge: {
    color: '#71717a',
  },
  priorityBadge: {
    display: 'inline-block',
    padding: '0.25rem 0.625rem',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'capitalize',
  },
  statusBadge: {
    display: 'inline-block',
    padding: '0.25rem 0.625rem',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'capitalize',
  },
  iconButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '8px',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    color: '#a1a1aa',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  deleteButton: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.2)',
    color: '#ef4444',
  },
  loading: {
    padding: '3rem',
    textAlign: 'center',
    color: '#71717a',
  },
  empty: {
    padding: '4rem 2rem',
    textAlign: 'center',
  },
  emptyText: {
    color: '#a1a1aa',
    fontSize: '1.125rem',
    marginTop: '1rem',
  },
  emptySubtext: {
    color: '#71717a',
    fontSize: '0.875rem',
    marginTop: '0.5rem',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: 'linear-gradient(135deg, rgba(30, 30, 40, 0.95), rgba(15, 15, 25, 0.95))',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '16px',
    padding: '2rem',
    width: '100%',
    maxWidth: '500px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  modalTitle: {
    fontSize: '1.25rem',
    fontWeight: 700,
    color: '#ffffff',
    marginBottom: '1.5rem',
  },
  formGroup: {
    marginBottom: '1.25rem',
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#a1a1aa',
    marginBottom: '0.5rem',
  },
  input: {
    width: '100%',
    padding: '0.75rem 1rem',
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '10px',
    color: '#ffffff',
    fontSize: '0.875rem',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.75rem',
    marginTop: '1.5rem',
  },
  noSelection: {
    color: '#71717a',
    textAlign: 'center',
    marginTop: '4rem',
  },
};
