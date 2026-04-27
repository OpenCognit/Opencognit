import { useState } from 'react';
import { Building2, Plus, ArrowRight, Loader2, Sparkles, AlertCircle, Trash2 } from 'lucide-react';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { StatusBadge } from '../components/StatusBadge';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { apiUnternehmen } from '../api/client';

function NewCompanyModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const i18n = useI18n();
  const [name, setName] = useState('');
  const [ziel, setZiel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiUnternehmen.erstellen({ name: name.trim(), ziel: ziel.trim() || undefined });
      onSaved();
    } catch (e: any) {
      setError(e.message || (i18n.language === 'de' ? 'Fehler beim Erstellen' : 'Error creating company'));
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.625rem 0.875rem',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 0, color: '#ffffff',
    fontSize: '0.875rem', outline: 'none', boxSizing: 'border-box',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'rgba(12, 12, 20, 0.75)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 0,
          padding: '1.75rem', width: '100%', maxWidth: '460px',
          boxShadow: '0 30px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <h2 style={{ margin: '0 0 1.25rem', fontSize: '1.125rem', fontWeight: 700, color: '#ffffff' }}>
          {i18n.t.unternehmen.neuesUnternehmen}
        </h2>

        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.75rem', borderRadius: 0, marginBottom: '1rem',
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#ef4444', fontSize: '0.8125rem',
          }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#a1a1aa', marginBottom: '0.375rem' }}>
              {i18n.t.unternehmen.formName}
            </label>
            <input
              style={inputStyle}
              placeholder={i18n.t.unternehmen.formNamePlaceholder}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoFocus
            />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#a1a1aa', marginBottom: '0.375rem' }}>
              {i18n.t.unternehmen.formZiel}
            </label>
            <input
              style={inputStyle}
              placeholder={i18n.t.unternehmen.formZielPlaceholder}
              value={ziel}
              onChange={e => setZiel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '0.625rem 1.25rem', borderRadius: 0,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
              color: '#a1a1aa', cursor: 'pointer', fontSize: '0.875rem',
            }}
          >
            {i18n.t.actions.abbrechen}
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || saving}
            style={{
              padding: '0.625rem 1.25rem', borderRadius: 0,
              background: !name.trim() || saving ? 'rgba(197,160,89,0.3)' : 'rgba(197,160,89,0.9)',
              border: '1px solid rgba(197,160,89,0.3)',
              color: '#ffffff', cursor: !name.trim() || saving ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.5rem',
            }}
          >
            {saving && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {i18n.t.actions.erstellen}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Companies() {
  const i18n = useI18n();
  useBreadcrumbs([i18n.t.nav.unternehmen]);
  const lang = i18n.language;
  const { unternehmen, loading, aktivesUnternehmen, setAktivesUnternehmenId, reload } = useCompany();
  const [showModal, setShowModal] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleSaved = () => {
    setShowModal(false);
    reload?.();
  };

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    const confirmed = window.confirm(
      lang === 'de'
        ? `Unternehmen "${name}" wirklich löschen? Alle Daten (Experten, Aufgaben, Projekte) werden permanent entfernt.`
        : `Really delete company "${name}"? All data (experts, tasks, projects) will be permanently removed.`
    );
    if (!confirmed) return;
    setDeletingId(id);
    try {
      await apiUnternehmen.loeschen(id);
      // If deleted company was the active one, clear it
      if (aktivesUnternehmen?.id === id) setAktivesUnternehmenId('');
      reload?.();
    } catch (err: any) {
      alert(lang === 'de' ? `Fehler beim Löschen: ${err.message}` : `Delete failed: ${err.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  const openCompany = (id: string) => {
    setAktivesUnternehmenId(id);
    window.location.href = '/experts';
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#c5a059' }} />
      </div>
    );
  }

  return (
    <div>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <Sparkles size={20} style={{ color: '#c5a059' }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#c5a059', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {i18n.t.nav.unternehmen}
              </span>
            </div>
            <h1 style={{
              fontSize: '2rem', fontWeight: 700,
              background: 'linear-gradient(to bottom right, #c5a059 0%, #ffffff 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>{i18n.t.unternehmen.title}</h1>
            <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.25rem' }}>{i18n.t.unternehmen.subtitle}</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.75rem 1.25rem',
              backgroundColor: 'rgba(197, 160, 89, 0.1)', border: '1px solid rgba(197, 160, 89, 0.2)',
              borderRadius: 0, color: '#c5a059', fontWeight: 600,
              fontSize: '0.875rem', cursor: 'pointer', transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'rgba(197,160,89,0.2)'; }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'rgba(197,160,89,0.1)'; }}
          >
            <Plus size={16} /> {i18n.t.unternehmen.neuesUnternehmen}
          </button>
        </div>

        {/* Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: '1.25rem' }}>
          {unternehmen.map((f, i) => (
            <div
              key={f.id}
              onClick={() => openCompany(f.id)}
              style={{
                padding: '1.5rem',
                backgroundColor: 'rgba(255, 255, 255, 0.02)',
                backdropFilter: 'blur(20px)', borderRadius: 0,
                border: '1px solid rgba(255, 255, 255, 0.08)',
                cursor: 'pointer', transition: 'all 0.2s',
                animation: `fadeInUp 0.5s ease-out ${Math.min(i, 4) * 0.1}s both`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.transform = 'translateY(-4px)';
                e.currentTarget.style.borderColor = 'rgba(197, 160, 89, 0.3)';
                e.currentTarget.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.3)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: f.status === 'active' ? 'rgba(197, 160, 89, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                  color: f.status === 'active' ? '#c5a059' : '#71717a',
                }}>
                  <Building2 size={20} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{f.name}</span>
                    <StatusBadge status={f.status} />
                  </div>
                  {f.beschreibung && (
                    <div style={{ fontSize: '0.875rem', color: '#71717a' }}>{f.beschreibung}</div>
                  )}
                </div>
              </div>

              {f.ziel && (
                <div style={{
                  background: 'rgba(255, 255, 255, 0.03)', borderRadius: 0,
                  padding: '0.75rem', marginBottom: '1rem',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}>
                  <div style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '0.25rem' }}>🎯 {i18n.t.unternehmen.ziel}</div>
                  <div style={{ fontSize: '0.875rem', color: '#d4d4d8', fontWeight: 500 }}>{f.ziel}</div>
                </div>
              )}

              <div style={{
                paddingTop: '0.75rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: '0.8125rem', color: '#71717a' }}>
                  {i18n.t.unternehmen.erstellt}: {new Date(f.erstelltAm).toLocaleDateString(i18n.language === 'de' ? 'de-DE' : 'en-GB')}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(e, f.id, f.name); }}
                    disabled={deletingId === f.id}
                    title={lang === 'de' ? 'Unternehmen löschen' : 'Delete company'}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 30, height: 30, borderRadius: 0,
                      background: 'transparent',
                      border: '1px solid rgba(239,68,68,0.2)',
                      color: '#64748b', cursor: 'pointer', transition: 'all 0.15s',
                      opacity: deletingId === f.id ? 0.5 : 1,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.4)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'; }}
                  >
                    {deletingId === f.id
                      ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                      : <Trash2 size={13} />}
                  </button>
                  <button
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.25rem',
                      padding: '0.5rem 0.75rem', backgroundColor: 'transparent',
                      border: 'none', borderRadius: 0,
                      color: '#c5a059', fontWeight: 500, fontSize: '0.8125rem', cursor: 'pointer',
                    }}
                  >
                    {i18n.t.unternehmen.oeffnen} <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* New Company Card */}
          <div
            onClick={() => setShowModal(true)}
            style={{
              padding: '1.5rem', backgroundColor: 'rgba(255, 255, 255, 0.02)',
              backdropFilter: 'blur(20px)', borderRadius: 0,
              border: '2px dashed rgba(197, 160, 89, 0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', minHeight: 200, transition: 'all 0.2s',
              animation: `fadeInUp 0.5s ease-out 0.4s both`,
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#c5a059';
              e.currentTarget.style.backgroundColor = 'rgba(197, 160, 89, 0.05)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'rgba(197, 160, 89, 0.3)';
              e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.02)';
            }}
          >
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: '48px', height: '48px', borderRadius: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 0.75rem',
                background: 'rgba(197, 160, 89, 0.1)', color: '#c5a059',
              }}>
                <Plus size={24} />
              </div>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#c5a059', marginBottom: '0.25rem' }}>
                {i18n.t.unternehmen.neuesUnternehmen}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#71717a' }}>
                {i18n.t.unternehmen.neuesUnternehmenSubtext}
              </div>
            </div>
          </div>
      </div>

      {showModal && (
        <NewCompanyModal onClose={() => setShowModal(false)} onSaved={handleSaved} />
      )}
    </div>
  );
}
