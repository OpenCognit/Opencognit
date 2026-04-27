import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Loader2, ArrowLeft, Pencil, Calendar, User, BarChart2, FolderOpen,
} from 'lucide-react';
import {
  apiProjekte, apiExperten,
  type Projekt, type Aufgabe, type Experte, ApiError,
} from '../api/client';
import { GlassCard } from '../components/GlassCard';
import { StatusBadge } from '../components/StatusBadge';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useCompany } from '../hooks/useCompany';
import { useI18n } from '../i18n';

const priorityColors: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#22c55e',
};

const statusColors: Record<string, string> = {
  backlog: '#52525b', todo: '#3b82f6', in_progress: '#c5a059',
  in_review: '#eab308', done: '#22c55e', blocked: '#ef4444', cancelled: '#71717a',
};

type ProjectDetail = Projekt & { aufgaben: Aufgabe[] };

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const i18n = useI18n();
  const de = i18n.language === 'de';
  const { aktivesUnternehmen } = useCompany();

  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [experts, setExperts] = useState<Experte[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useBreadcrumbs([
    aktivesUnternehmen?.name ?? '',
    de ? 'Projekte' : 'Projects',
    project?.name ?? '',
  ]);

  useEffect(() => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load(projectId: string) {
      setLoading(true);
      setError(null);
      setNotFound(false);

      try {
        const proj = (await apiProjekte.details(projectId)) as ProjectDetail;
        if (cancelled) return;
        setProject(proj);

        const exps = await apiExperten.liste(proj.unternehmenId);
        if (cancelled) return;
        setExperts(exps);
      } catch (e: any) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setNotFound(true);
        } else {
          setError(e?.message || (de ? 'Unbekannter Fehler' : 'Unknown error'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load(id);
    return () => { cancelled = true; };
  }, [id, de]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#c5a059' }} />
      </div>
    );
  }

  if (notFound) {
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center', color: '#a1a1aa' }}>
        <FolderOpen size={48} style={{ marginBottom: 16, color: '#52525b' }} />
        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: '#ffffff', marginBottom: 8 }}>
          {de ? 'Projekt nicht gefunden' : 'Project not found'}
        </h2>
        <p style={{ marginBottom: 24 }}>{de ? 'Das angeforderte Projekt existiert nicht.' : 'The requested project does not exist.'}</p>
        <button
          onClick={() => navigate('/projects')}
          style={{
            padding: '0.5rem 1rem', borderRadius: 0, cursor: 'pointer',
            background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.3)',
            color: '#c5a059', fontWeight: 600, fontSize: '0.875rem',
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
          }}
        >
          <ArrowLeft size={14} />
          {de ? 'Zurück zu Projekten' : 'Back to Projects'}
        </button>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div style={{ padding: '48px 32px', textAlign: 'center', color: '#ef4444' }}>
        <p>{error || (de ? 'Fehler beim Laden des Projekts.' : 'Error loading project.')}</p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16, padding: '0.5rem 1rem', borderRadius: 0, cursor: 'pointer',
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: '#d4d4d8', fontSize: '0.875rem',
          }}
        >
          {de ? 'Erneut versuchen' : 'Retry'}
        </button>
      </div>
    );
  }

  const { status, prioritaet, deadline, fortschritt, beschreibung, eigentuemerId, farbe, aufgaben = [] } = project;

  const statusLabel = de
    ? status === 'aktiv' ? 'Aktiv' : status === 'pausiert' ? 'Pausiert' : status === 'abgeschlossen' ? 'Abgeschlossen' : 'Archiviert'
    : status === 'aktiv' ? 'Active' : status === 'pausiert' ? 'Paused' : status === 'abgeschlossen' ? 'Completed' : 'Archived';

  const owner = eigentuemerId ? experts.find(e => e.id === eigentuemerId) : null;

  const getAssignee = (task: Aufgabe) => {
    if (!task.zugewiesenAn) return null;
    return experts.find(e => e.id === task.zugewiesenAn) || null;
  };

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => navigate('/projects')}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.375rem 0.75rem', borderRadius: 0, cursor: 'pointer',
            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
            color: '#a1a1aa', fontSize: '0.8125rem', fontWeight: 500,
          }}
        >
          <ArrowLeft size={14} />
          {de ? 'Zurück' : 'Back'}
        </button>

        <div style={{ width: 4, minHeight: 36, background: farbe || '#c5a059', borderRadius: 0, flexShrink: 0 }} />

        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ffffff', margin: 0, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {project.name}
        </h1>

        <button
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.375rem 0.75rem', borderRadius: 0, cursor: 'pointer',
            background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.3)',
            color: '#c5a059', fontSize: '0.8125rem', fontWeight: 600,
          }}
          onClick={() => {/* TODO: edit project */}}
        >
          <Pencil size={14} />
          {de ? 'Bearbeiten' : 'Edit'}
        </button>
      </div>

      {/* Info cards row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <GlassCard style={{ padding: '0.875rem 1rem' }} noBlur>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            {de ? 'Status' : 'Status'}
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.25rem 0.5rem', borderRadius: 0, fontSize: '0.75rem', fontWeight: 600,
            background: status === 'aktiv' ? 'rgba(34,197,94,0.1)' : status === 'pausiert' ? 'rgba(234,179,8,0.1)' : 'rgba(255,255,255,0.05)',
            color: status === 'aktiv' ? '#22c55e' : status === 'pausiert' ? '#eab308' : '#a1a1aa',
            border: `1px solid ${status === 'aktiv' ? 'rgba(34,197,94,0.3)' : status === 'pausiert' ? 'rgba(234,179,8,0.3)' : 'rgba(255,255,255,0.1)'}`,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: status === 'aktiv' ? '#22c55e' : status === 'pausiert' ? '#eab308' : '#a1a1aa',
              display: 'inline-block',
            }} />
            {statusLabel}
          </span>
        </GlassCard>

        <GlassCard style={{ padding: '0.875rem 1rem' }} noBlur>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            {de ? 'Priorität' : 'Priority'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 600, color: priorityColors[prioritaet] || '#a1a1aa' }}>
            <span style={{ width: 8, height: 8, borderRadius: 0, background: priorityColors[prioritaet] || '#a1a1aa' }} />
            {prioritaet === 'critical' ? (de ? 'Kritisch' : 'Critical')
              : prioritaet === 'high' ? (de ? 'Hoch' : 'High')
              : prioritaet === 'medium' ? (de ? 'Mittel' : 'Medium')
              : (de ? 'Niedrig' : 'Low')}
          </div>
        </GlassCard>

        <GlassCard style={{ padding: '0.875rem 1rem' }} noBlur>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            {de ? 'Deadline' : 'Deadline'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: deadline ? '#d4d4d8' : '#52525b' }}>
            <Calendar size={13} />
            {deadline ? fmtDate(deadline) : (de ? 'Keine Deadline' : 'No deadline')}
          </div>
        </GlassCard>

        <GlassCard style={{ padding: '0.875rem 1rem' }} noBlur>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            {de ? 'Aufgaben' : 'Tasks'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: '#d4d4d8' }}>
            <BarChart2 size={13} />
            {aufgaben.length}
          </div>
        </GlassCard>

        <GlassCard style={{ padding: '0.875rem 1rem' }} noBlur>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            {de ? 'Fortschritt' : 'Progress'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 0, overflow: 'hidden' }}>
              <div style={{
                width: `${fortschritt}%`, height: '100%', background: fortschritt >= 100 ? '#22c55e' : '#c5a059',
                borderRadius: 0, transition: 'width 0.4s ease',
              }} />
            </div>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#ffffff', minWidth: 32, textAlign: 'right' }}>
              {fortschritt}%
            </span>
          </div>
        </GlassCard>
      </div>

      {/* Description */}
      {beschreibung && (
        <GlassCard style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            {de ? 'Beschreibung' : 'Description'}
          </div>
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#d4d4d8', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
            {beschreibung}
          </p>
        </GlassCard>
      )}

      {/* Owner */}
      {owner && (
        <GlassCard style={{ padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            {de ? 'Eigentümer' : 'Owner'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <div style={{
              width: 32, height: 32, borderRadius: 0,
              background: (owner.avatarFarbe || '#c5a059') + '20',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, color: owner.avatarFarbe || '#c5a059', fontWeight: 700, flexShrink: 0,
            }}>
              {owner.avatar || <User size={14} />}
            </div>
            <span style={{ fontSize: '0.875rem', fontWeight: 600, color: '#ffffff' }}>
              {owner.name}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#71717a' }}>
              {owner.rolle}
            </span>
          </div>
        </GlassCard>
      )}

      {/* Tasks */}
      <GlassCard style={{ padding: '1rem 1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <BarChart2 size={16} style={{ color: '#c5a059' }} />
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>
            {de ? 'Aufgaben' : 'Tasks'}
          </h2>
          <span style={{ fontSize: '0.75rem', color: '#71717a', marginLeft: 'auto' }}>
            {aufgaben.length}
          </span>
        </div>

        {aufgaben.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#52525b' }}>
            <FolderOpen size={32} style={{ marginBottom: 8, color: '#52525b' }} />
            <p style={{ margin: 0, fontSize: '0.875rem' }}>
              {de ? 'Keine Aufgaben in diesem Projekt.' : 'No tasks in this project.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {aufgaben.map(task => {
              const assignee = getAssignee(task);
              const due = task.dueDate;
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const dueDate = due ? new Date(due) : null;
              if (dueDate) dueDate.setHours(0, 0, 0, 0);
              const diffDays = dueDate ? Math.round((dueDate.getTime() - today.getTime()) / 86400000) : null;
              const isOverdue = diffDays !== null && diffDays < 0 && task.status !== 'done' && task.status !== 'cancelled';

              return (
                <div
                  key={task.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto auto auto auto',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.625rem 0.75rem',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 0,
                  }}
                >
                  <div style={{ minWidth: 0, overflow: 'hidden' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.titel}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: 0, background: priorityColors[task.prioritaet] || '#a1a1aa',
                    }} />
                    <span style={{ fontSize: '0.75rem', color: priorityColors[task.prioritaet] || '#a1a1aa', fontWeight: 600 }}>
                      {task.prioritaet === 'critical' ? (de ? 'Kritisch' : 'Critical')
                        : task.prioritaet === 'high' ? (de ? 'Hoch' : 'High')
                        : task.prioritaet === 'medium' ? (de ? 'Mittel' : 'Medium')
                        : (de ? 'Niedrig' : 'Low')}
                    </span>
                  </div>

                  <StatusBadge status={task.status} />

                  {assignee ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: 0,
                        background: (assignee.avatarFarbe || '#c5a059') + '20',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, color: assignee.avatarFarbe || '#c5a059', fontWeight: 700, flexShrink: 0,
                      }}>
                        {assignee.avatar || <User size={10} />}
                      </div>
                      <span style={{ fontSize: '0.75rem', color: '#a1a1aa', whiteSpace: 'nowrap' }}>
                        {assignee.name}
                      </span>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: '#52525b', whiteSpace: 'nowrap' }}>
                      {de ? 'Nicht zugewiesen' : 'Unassigned'}
                    </span>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', whiteSpace: 'nowrap' }}>
                    <Calendar size={11} style={{ color: isOverdue ? '#ef4444' : due ? '#71717a' : '#52525b' }} />
                    <span style={{ fontSize: '0.75rem', color: isOverdue ? '#ef4444' : due ? '#a1a1aa' : '#52525b', fontWeight: isOverdue ? 600 : 400 }}>
                      {due ? fmtDate(due) : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

export default ProjectDetail;
