import { useState } from 'react';
import {
  Plus, FolderOpen, Loader2, Trash2, ChevronDown, ChevronRight,
  Calendar, User, BarChart2, AlertCircle, Layout,
} from 'lucide-react';
import { WhiteboardPanel } from '../components/WhiteboardPanel';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { StatusBadge } from '../components/StatusBadge';
import { Select } from '../components/Select';
import { useI18n } from '../i18n';
import { PageHelp } from '../components/PageHelp';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import {
  apiProjekte, apiAufgaben, apiExperten,
  type Projekt, type Aufgabe, type Experte,
} from '../api/client';

// ===== Projekt Status Badge =====
function ProjektStatusBadge({ status }: { status: Projekt['status'] }) {
  const colorMap: Record<string, { bg: string; color: string }> = {
    aktiv:         { bg: 'rgba(34, 197, 94, 0.15)',  color: '#22c55e' },
    pausiert:      { bg: 'rgba(234, 179, 8, 0.15)',  color: '#eab308' },
    abgeschlossen: { bg: 'rgba(35, 205, 202, 0.15)', color: '#23CDCB' },
    archiviert:    { bg: 'rgba(113, 113, 122, 0.15)',color: '#71717a' },
  };
  const { bg, color } = colorMap[status] ?? colorMap.aktiv;
  const i18n = useI18n();
  const labelMap: Record<string, string> = {
    aktiv:         i18n.t.projekte.statusAktiv,
    pausiert:      i18n.t.projekte.statusPausiert,
    abgeschlossen: i18n.t.projekte.statusAbgeschlossen,
    archiviert:    i18n.t.projekte.statusArchiviert,
  };
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
      padding: '0.25rem 0.625rem', borderRadius: '20px',
      fontSize: '0.6875rem', fontWeight: 600,
      background: bg, color,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {labelMap[status] ?? status}
    </span>
  );
}

// ===== Fortschrittsbalken =====
function ProgressBar({ value, color }: { value: number; color: string }) {
  return (
    <div style={{
      height: '6px', borderRadius: '3px',
      background: 'rgba(255,255,255,0.07)', overflow: 'hidden',
    }}>
      <div style={{
        height: '100%', borderRadius: '3px',
        width: `${Math.min(100, Math.max(0, value))}%`,
        background: color,
        transition: 'width 0.5s ease',
      }} />
    </div>
  );
}

// ===== Projekt Erstellen Modal =====
interface ProjektModalProps {
  unternehmenId: string;
  experten: Experte[];
  onClose: () => void;
  onSaved: () => void;
}

function ProjektModal({ unternehmenId, experten, onClose, onSaved }: ProjektModalProps) {
  const i18n = useI18n();
  const [name, setName] = useState('');
  const [beschreibung, setBeschreibung] = useState('');
  const [status, setStatus] = useState<Projekt['status']>('aktiv');
  const [prioritaet, setPrioritaet] = useState<Projekt['prioritaet']>('medium');
  const [deadline, setDeadline] = useState('');
  const [eigentuemerId, setEigentuemerId] = useState('');
  const [farbe, setFarbe] = useState('#23CDCB');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const FARBEN = ['#23CDCB', '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#22c55e', '#ef4444', '#f97316'];

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiProjekte.erstellen(unternehmenId, {
        name: name.trim(),
        beschreibung: beschreibung.trim() || undefined,
        status,
        prioritaet,
        deadline: deadline || undefined,
        eigentuemerId: eigentuemerId || undefined,
        farbe,
      });
      onSaved();
    } catch (e: any) {
      setError(e.message || 'Fehler beim Erstellen');
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.625rem 0.75rem',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: '10px', color: '#ffffff',
    fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box',
    colorScheme: 'dark',
  };
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.75rem', fontWeight: 600,
    color: '#a1a1aa', marginBottom: '0.375rem',
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
    }} onClick={onClose}>
      <div style={{
        background: 'rgba(12, 12, 20, 0.75)',
        backdropFilter: 'blur(32px)',
        WebkitBackdropFilter: 'blur(32px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '24px', padding: '1.75rem',
        width: '100%', maxWidth: '520px',
        boxShadow: '0 30px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
      }} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.125rem', fontWeight: 700, color: '#ffffff' }}>
          {i18n.t.projekte.neuesProjektErstellen}
        </h2>

        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.75rem', borderRadius: '10px', marginBottom: '1rem',
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#ef4444', fontSize: '0.8125rem',
          }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {/* Name */}
          <div>
            <label style={labelStyle}>{i18n.t.projekte.formName}</label>
            <input
              style={inputStyle}
              placeholder={i18n.t.projekte.formNamePlaceholder}
              value={name} onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          {/* Beschreibung */}
          <div>
            <label style={labelStyle}>{i18n.t.projekte.formBeschreibung}</label>
            <textarea
              style={{ ...inputStyle, resize: 'vertical', minHeight: '80px' }}
              placeholder={i18n.t.projekte.formBeschreibungPlaceholder}
              value={beschreibung} onChange={e => setBeschreibung(e.target.value)}
            />
          </div>

          {/* Status + Priorität */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={labelStyle}>{i18n.t.projekte.formStatus}</label>
              <Select
                value={status}
                onChange={v => setStatus(v as Projekt['status'])}
                options={[
                  { value: 'aktiv', label: i18n.t.projekte.statusAktiv },
                  { value: 'pausiert', label: i18n.t.projekte.statusPausiert },
                  { value: 'abgeschlossen', label: i18n.t.projekte.statusAbgeschlossen },
                  { value: 'archiviert', label: i18n.t.projekte.statusArchiviert },
                ]}
              />
            </div>
            <div>
              <label style={labelStyle}>{i18n.t.projekte.formPrioritaet}</label>
              <Select
                value={prioritaet}
                onChange={v => setPrioritaet(v as Projekt['prioritaet'])}
                options={[
                  { value: 'critical', label: i18n.t.priority.critical },
                  { value: 'high', label: i18n.t.priority.high },
                  { value: 'medium', label: i18n.t.priority.medium },
                  { value: 'low', label: i18n.t.priority.low },
                ]}
              />
            </div>
          </div>

          {/* Deadline + Eigentümer */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={labelStyle}>{i18n.t.projekte.formDeadline}</label>
              <input
                type="date"
                style={{ ...inputStyle }}
                value={deadline} onChange={e => setDeadline(e.target.value)}
              />
            </div>
            <div>
              <label style={labelStyle}>{i18n.t.projekte.eigentuemer}</label>
              <Select
                value={eigentuemerId}
                onChange={setEigentuemerId}
                options={[
                  { value: '', label: i18n.t.projekte.keinEigentuemer },
                  ...experten.map(e => ({ value: e.id, label: e.name })),
                ]}
              />
            </div>
          </div>

          {/* Farbe */}
          <div>
            <label style={labelStyle}>{i18n.t.projekte.formFarbe}</label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {FARBEN.map(f => (
                <button
                  key={f} type="button"
                  onClick={() => setFarbe(f)}
                  style={{
                    width: 28, height: 28, borderRadius: '8px',
                    background: f, border: farbe === f ? '2px solid #ffffff' : '2px solid transparent',
                    cursor: 'pointer', transition: 'all 0.15s',
                    boxShadow: farbe === f ? `0 0 0 2px ${f}55` : 'none',
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.625rem 1.25rem', borderRadius: '10px',
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              color: '#a1a1aa', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500,
            }}
          >
            {i18n.t.actions.abbrechen}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            style={{
              padding: '0.625rem 1.25rem', borderRadius: '10px',
              background: !name.trim() || saving ? 'rgba(35,205,202,0.3)' : 'rgba(35,205,202,0.9)',
              border: '1px solid rgba(35,205,202,0.3)',
              color: '#ffffff', cursor: !name.trim() || saving ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}
          >
            {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            {i18n.t.actions.erstellen}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Haupt-Komponente =====
export function Projects() {
  const i18n = useI18n();
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', i18n.t.projekte.title]);
  const [showModal, setShowModal] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [whiteboardProjekt, setWhiteboardProjekt] = useState<{ id: string; name: string } | null>(null);

  const { data: projekte, loading: loadingP, reload: reloadProjekte } = useApi<Projekt[]>(
    () => apiProjekte.liste(aktivesUnternehmen!.id),
    [aktivesUnternehmen?.id],
  );
  const { data: alleAufgaben, loading: loadingA, reload: reloadAufgaben } = useApi<Aufgabe[]>(
    () => apiAufgaben.liste(aktivesUnternehmen!.id),
    [aktivesUnternehmen?.id],
  );
  const { data: alleExperten } = useApi<Experte[]>(
    () => apiExperten.liste(aktivesUnternehmen!.id),
    [aktivesUnternehmen?.id],
  );

  if (!aktivesUnternehmen) return null;

  const loading = loadingP || loadingA;

  if (loading || !projekte || !alleAufgaben) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#23CDCB' }} />
      </div>
    );
  }

  const experten = alleExperten ?? [];

  const findExperte = (id: string | null) => id ? experten.find(e => e.id === id) : null;

  const aufgabenPerProjekt = (projektId: string) =>
    alleAufgaben.filter(a => a.projektId === projektId);

  const aufgabenOhneProjekt = alleAufgaben.filter(a => !a.projektId);

  const toggleExpand = (id: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleDelete = async (id: string) => {
    if (!confirm(i18n.t.projekte.confirmDelete)) return;
    try {
      await apiProjekte.loeschen(id);
      reloadProjekte();
      reloadAufgaben();
    } catch {}
  };

  const handleSaved = () => {
    setShowModal(false);
    reloadProjekte();
  };

  const priorityColors: Record<string, string> = {
    critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e',
  };

  return (
    <div>
      <main>
          <PageHelp id="projects" lang={i18n.language} />

          {/* Header Actions */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1.5rem' }}>
            <button
              onClick={() => setShowModal(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.625rem 1.25rem', borderRadius: '12px',
                background: 'rgba(35,205,202,0.15)', border: '1px solid rgba(35,205,202,0.35)',
                color: '#23CDCB', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(35,205,202,0.25)';
                e.currentTarget.style.borderColor = 'rgba(35,205,202,0.6)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(35,205,202,0.15)';
                e.currentTarget.style.borderColor = 'rgba(35,205,202,0.35)';
              }}
            >
              <Plus size={16} />
              {i18n.t.projekte.neuesProjekt}
            </button>
          </div>

          {/* Stats Row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: i18n.t.projekte.statusAktiv, value: projekte.filter(p => p.status === 'aktiv').length, color: '#22c55e' },
              { label: i18n.t.projekte.statusPausiert, value: projekte.filter(p => p.status === 'pausiert').length, color: '#eab308' },
              { label: i18n.t.projekte.statusAbgeschlossen, value: projekte.filter(p => p.status === 'abgeschlossen').length, color: '#23CDCB' },
              { label: i18n.t.projekte.aufgaben, value: alleAufgaben.length, color: '#3b82f6' },
            ].map(stat => (
              <div key={stat.label} style={{
                padding: '1rem 1.25rem', borderRadius: '14px',
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                backdropFilter: 'blur(10px)',
              }}>
                <div style={{ fontSize: '1.75rem', fontWeight: 700, color: stat.color }}>{stat.value}</div>
                <div style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '0.25rem' }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Projekte Liste */}
          {projekte.length === 0 ? (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '5rem 2rem', textAlign: 'center',
              background: 'rgba(255,255,255,0.02)', border: '1px dashed rgba(255,255,255,0.12)',
              borderRadius: '20px',
            }}>
              <FolderOpen size={48} style={{ color: '#3f3f46', marginBottom: '1rem' }} />
              <div style={{ fontSize: '1rem', fontWeight: 600, color: '#71717a', marginBottom: '0.5rem' }}>
                {i18n.t.projekte.keineProjekte}
              </div>
              <div style={{ fontSize: '0.875rem', color: '#52525b' }}>
                {i18n.t.projekte.keineProjekteSubtext}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {projekte.map(projekt => {
                const aufgaben = aufgabenPerProjekt(projekt.id);
                const isExpanded = expandedProjects.has(projekt.id);
                const eigentuemer = findExperte(projekt.eigentuemerId);

                return (
                  <div key={projekt.id} style={{
                    borderRadius: '16px',
                    background: 'rgba(255,255,255,0.025)',
                    border: `1px solid ${projekt.farbe}22`,
                    backdropFilter: 'blur(10px)',
                    overflow: 'hidden',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = `${projekt.farbe}44`)}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = `${projekt.farbe}22`)}
                  >
                    {/* Projekt Header */}
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: '1rem',
                        padding: '1rem 1.25rem', cursor: 'pointer',
                        borderBottom: isExpanded ? '1px solid rgba(255,255,255,0.06)' : 'none',
                      }}
                      onClick={() => toggleExpand(projekt.id)}
                    >
                      {/* Farbe + Expand */}
                      <div style={{
                        width: 4, alignSelf: 'stretch', borderRadius: '2px',
                        background: projekt.farbe, flexShrink: 0,
                      }} />
                      <div style={{
                        color: '#71717a', transition: 'color 0.2s', flexShrink: 0,
                      }}>
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </div>

                      {/* Name + Badges */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.9375rem', fontWeight: 700, color: '#ffffff' }}>
                            {projekt.name}
                          </span>
                          <ProjektStatusBadge status={projekt.status} />
                          <span style={{
                            fontSize: '0.6875rem', fontWeight: 600, padding: '0.2rem 0.5rem',
                            borderRadius: '6px', background: `${priorityColors[projekt.prioritaet]}22`,
                            color: priorityColors[projekt.prioritaet],
                          }}>
                            {i18n.t.priority[projekt.prioritaet]}
                          </span>
                        </div>
                        {projekt.beschreibung && (
                          <div style={{ fontSize: '0.8125rem', color: '#71717a', marginTop: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {projekt.beschreibung}
                          </div>
                        )}
                      </div>

                      {/* Meta */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexShrink: 0 }}>
                        {/* Aufgaben-Anzahl */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: '#a1a1aa', fontSize: '0.8125rem' }}>
                          <BarChart2 size={14} />
                          <span>{aufgaben.length} {i18n.t.projekte.aufgaben}</span>
                        </div>

                        {/* Eigentümer */}
                        {eigentuemer && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: '#a1a1aa', fontSize: '0.8125rem' }}>
                            <User size={14} />
                            <span>{eigentuemer.name}</span>
                          </div>
                        )}

                        {/* Deadline */}
                        {projekt.deadline && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: '#a1a1aa', fontSize: '0.8125rem' }}>
                            <Calendar size={14} />
                            <span>{new Date(projekt.deadline).toLocaleDateString('de-DE')}</span>
                          </div>
                        )}

                        {/* Fortschritt */}
                        <div style={{ width: 80 }}>
                          <div style={{ fontSize: '0.6875rem', color: '#71717a', marginBottom: '0.25rem', textAlign: 'right' }}>
                            {projekt.fortschritt}%
                          </div>
                          <ProgressBar value={projekt.fortschritt} color={projekt.farbe} />
                        </div>

                        {/* Whiteboard */}
                        <button
                          onClick={e => { e.stopPropagation(); setWhiteboardProjekt({ id: projekt.id, name: projekt.name }); }}
                          style={{ padding: '0.375rem', borderRadius: '8px', background: 'transparent', border: 'none', color: '#334155', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#23CDCA'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(35,205,202,0.1)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = '#334155'; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                          title="Whiteboard"
                        >
                          <Layout size={15} />
                        </button>

                        {/* Delete */}
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(projekt.id); }}
                          style={{
                            padding: '0.375rem', borderRadius: '8px',
                            background: 'transparent', border: 'none',
                            color: '#52525b', cursor: 'pointer', transition: 'all 0.2s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#ef4444'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#52525b'; }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Aufgaben-Liste (expanded) */}
                    {isExpanded && (
                      <div style={{ padding: '0.75rem 1.25rem' }}>
                        {aufgaben.length === 0 ? (
                          <div style={{ padding: '1rem', textAlign: 'center', color: '#52525b', fontSize: '0.8125rem' }}>
                            {i18n.t.projekte.keineProjekte}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {aufgaben.map(a => {
                              const assignee = findExperte(a.zugewiesenAn);
                              return (
                                <div key={a.id} style={{
                                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                                  padding: '0.625rem 0.875rem', borderRadius: '10px',
                                  background: 'rgba(255,255,255,0.03)',
                                  border: '1px solid rgba(255,255,255,0.06)',
                                }}>
                                  <StatusBadge status={a.status} />
                                  <span style={{ flex: 1, fontSize: '0.8125rem', color: '#e4e4e7' }}>{a.titel}</span>
                                  <span style={{
                                    fontSize: '0.6875rem', fontWeight: 600,
                                    padding: '0.2rem 0.5rem', borderRadius: '6px',
                                    background: `${priorityColors[a.prioritaet]}22`,
                                    color: priorityColors[a.prioritaet],
                                  }}>
                                    {i18n.t.priority[a.prioritaet]}
                                  </span>
                                  {assignee && (
                                    <div style={{
                                      display: 'flex', alignItems: 'center', gap: '0.375rem',
                                      fontSize: '0.75rem', color: '#71717a',
                                    }}>
                                      <div style={{
                                        width: 20, height: 20, borderRadius: '6px',
                                        background: assignee.avatarFarbe + '33',
                                        border: `1px solid ${assignee.avatarFarbe}55`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '0.5625rem', fontWeight: 700, color: assignee.avatarFarbe,
                                      }}>
                                        {assignee.name.slice(0, 2).toUpperCase()}
                                      </div>
                                      {assignee.name}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Aufgaben ohne Projekt */}
              {aufgabenOhneProjekt.length > 0 && (
                <div style={{
                  borderRadius: '16px',
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  backdropFilter: 'blur(10px)',
                  overflow: 'hidden',
                }}>
                  <div
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '1rem 1.25rem', cursor: 'pointer',
                      borderBottom: expandedProjects.has('__no_project__') ? '1px solid rgba(255,255,255,0.06)' : 'none',
                    }}
                    onClick={() => toggleExpand('__no_project__')}
                  >
                    <div style={{ width: 4, alignSelf: 'stretch', borderRadius: '2px', background: '#52525b', flexShrink: 0 }} />
                    <div style={{ color: '#71717a', flexShrink: 0 }}>
                      {expandedProjects.has('__no_project__') ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </div>
                    <span style={{ flex: 1, fontSize: '0.9375rem', fontWeight: 600, color: '#a1a1aa' }}>
                      {i18n.t.projekte.ohneZuweisung}
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: '#71717a' }}>
                      {aufgabenOhneProjekt.length} {i18n.t.projekte.aufgaben}
                    </span>
                  </div>
                  {expandedProjects.has('__no_project__') && (
                    <div style={{ padding: '0.75rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {aufgabenOhneProjekt.map(a => {
                        const assignee = findExperte(a.zugewiesenAn);
                        const priorityColors2: Record<string, string> = {
                          critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e',
                        };
                        return (
                          <div key={a.id} style={{
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            padding: '0.625rem 0.875rem', borderRadius: '10px',
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.06)',
                          }}>
                            <StatusBadge status={a.status} />
                            <span style={{ flex: 1, fontSize: '0.8125rem', color: '#e4e4e7' }}>{a.titel}</span>
                            <span style={{
                              fontSize: '0.6875rem', fontWeight: 600,
                              padding: '0.2rem 0.5rem', borderRadius: '6px',
                              background: `${priorityColors2[a.prioritaet]}22`,
                              color: priorityColors2[a.prioritaet],
                            }}>
                              {i18n.t.priority[a.prioritaet]}
                            </span>
                            {assignee && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: '#71717a' }}>
                                <div style={{
                                  width: 20, height: 20, borderRadius: '6px',
                                  background: assignee.avatarFarbe + '33',
                                  border: `1px solid ${assignee.avatarFarbe}55`,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  fontSize: '0.5625rem', fontWeight: 700, color: assignee.avatarFarbe,
                                }}>
                                  {assignee.name.slice(0, 2).toUpperCase()}
                                </div>
                                {assignee.name}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
      </main>

      {/* Modal */}
      {showModal && aktivesUnternehmen && (
        <ProjektModal
          unternehmenId={aktivesUnternehmen.id}
          experten={experten}
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}

      {whiteboardProjekt && (
        <WhiteboardPanel
          projektId={whiteboardProjekt.id}
          projektName={whiteboardProjekt.name}
          expertenMap={Object.fromEntries(experten.map(e => [e.id, e.name]))}
          onClose={() => setWhiteboardProjekt(null)}
        />
      )}

    </div>
  );
}
