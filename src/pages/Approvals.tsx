import { useState, useEffect } from 'react';
import { Check, X, Clock, Loader2, Sparkles, ShieldCheck, Briefcase, MessageSquare, Terminal, ChevronDown } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { zeitRelativ } from '../utils/i18n';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import { apiGenehmigungen, apiExperten, type Genehmigung, type Experte } from '../api/client';
import { GlassCard } from '../components/GlassCard';

export function Approvals() {
  const i18n = useI18n();
  const [showAllDone, setShowAllDone] = useState(false);
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', i18n.t.nav.genehmigungen]);
  const typLabels: Record<string, string> = {
    hire_expert: i18n.t.genehmigungen.types.hire_expert,
    approve_strategy: i18n.t.genehmigungen.types.approve_strategy,
    budget_change: i18n.t.genehmigungen.types.budget_change,
    agent_action: i18n.t.genehmigungen.types.agent_action,
  };

  const payloadFieldLabel = (key: string): string => {
    const fields = i18n.t.genehmigungen.payloadFields as Record<string, string>;
    return fields[key] ?? key;
  };

  const formatPayloadValue = (key: string, val: unknown): string => {
    if (key === 'budgetMonatCent' && typeof val === 'number') {
      return `€${(val / 100).toFixed(2)}`;
    }
    return typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
  };

  const { data: alle, loading, reload } = useApi<Genehmigung[]>(
    () => apiGenehmigungen.liste(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );
  const { data: experts } = useApi<Experte[]>(
    () => apiExperten.liste(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );

  // Auto-reload when approval status changes (e.g. via Telegram)
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener('opencognit:approval-changed', handler);
    return () => window.removeEventListener('opencognit:approval-changed', handler);
  }, [reload]);

  if (!aktivesUnternehmen) return null;

  if (loading || !alle) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#c5a059' }} />
      </div>
    );
  }

  const findExpertName = (id: string | null) => {
    if (!id || !experts) return id || i18n.t.genehmigungen.unknown;
    return experts.find(a => a.id === id)?.name || id;
  };

  const pending = alle.filter(g => g.status === 'pending');
  const erledigt = alle.filter(g => g.status !== 'pending');

  const handleGenehmigen = async (id: string) => {
    const genehmigung = alle.find(g => g.id === id);

    if (genehmigung?.typ === 'hire_expert' && genehmigung.payload) {
      const { rolle, budgetMonatCent, faehigkeiten, verbindungsTyp } = genehmigung.payload;
      await apiExperten.erstellen(aktivesUnternehmen.id, {
        name: `New ${rolle}`,
        rolle,
        titel: rolle,
        faehigkeiten: faehigkeiten || '',
        verbindungsTyp: verbindungsTyp || 'claude',
        budgetMonatCent: budgetMonatCent || 50000,
        zyklusAktiv: true,
        zyklusIntervallSek: 300,
      });
    }

    await apiGenehmigungen.genehmigen(id);
    reload();
  };

  const handleAblehnen = async (id: string) => {
    await apiGenehmigungen.ablehnen(id);
    reload();
  };

  return (
    <>
      <div>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '2rem',
            flexWrap: 'wrap',
            gap: '1rem',
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <Sparkles size={20} style={{ color: '#c5a059' }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#c5a059', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {aktivesUnternehmen.name}
                </span>
              </div>
              <h1 style={{
                fontSize: '2rem',
                fontWeight: 700,
                background: 'linear-gradient(to bottom right, #c5a059 0%, #ffffff 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>{i18n.t.nav.genehmigungen}</h1>
              <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.25rem' }}>{i18n.t.genehmigungen.subtitle}</p>
            </div>
          </div>

          <PageHelp id="approvals" lang={i18n.language} />

          {/* Pending Approvals */}
          {pending.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                marginBottom: '1rem',
              }}>
                <ShieldCheck size={18} style={{ color: '#eab308' }} />
                <h2 style={{ fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {i18n.t.genehmigungen.open} ({pending.length})
                </h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {pending.map((g, i) => (
                  <GlassCard
                    key={g.id}
                    accent="#eab308"
                    style={{
                      padding: '1.5rem',
                      borderLeft: '3px solid #eab308',
                      animation: `fadeInUp 0.5s ease-out ${Math.min(i, 4) * 0.1}s both`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      <Clock size={14} style={{ color: '#eab308' }} />
                      <span style={{
                        padding: '0.25rem 0.625rem',
                        backgroundColor: 'rgba(234, 179, 8, 0.1)',
                        border: '1px solid rgba(234, 179, 8, 0.3)',
                        borderRadius: '9999px',
                        fontSize: '0.75rem',
                        color: '#eab308',
                      }}>
                        {(() => { const t = g.type ?? g.typ; return t ? (typLabels[t] || t) : '—'; })()}
                      </span>
                      <span style={{ fontSize: '0.8125rem', color: '#71717a' }}>
                        {i18n.t.genehmigungen.by} {findExpertName(g.requestedBy ?? g.angefordertVon ?? null)} · {zeitRelativ(g.createdAt ?? g.erstelltAm ?? '', i18n.t)}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff', marginBottom: '0.5rem' }}>{g.title ?? g.titel}</h3>
                    <p style={{ fontSize: '0.875rem', color: '#71717a', marginBottom: '1rem' }}>{g.description ?? g.beschreibung}</p>

                    {g.payload && Object.keys(g.payload).length > 0 && (
                      <div style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        borderRadius: 0,
                        padding: '1rem',
                        marginBottom: '1rem',
                      }}>
                        {g.typ === 'agent_action' && g.payload.action === 'create_task' ? (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.75rem', color: '#c5a059' }}>
                              <Briefcase size={16} />
                              <span style={{ fontSize: '0.8125rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {i18n.t.genehmigungen.createTask}
                              </span>
                            </div>
                            <div style={{ paddingLeft: '2rem' }}>
                              <div style={{ color: '#ffffff', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.25rem' }}>
                                {g.payload.params?.titel}
                              </div>
                              <div style={{ color: '#71717a', fontSize: '0.8125rem', lineHeight: 1.5 }}>
                                {g.payload.params?.beschreibung}
                              </div>
                            </div>
                          </>
                        ) : (
                          Object.entries(g.payload).map(([key, val]) => (
                            <div key={key} style={{
                              display: 'flex',
                              alignItems: 'flex-start',
                              justifyContent: 'space-between',
                              fontSize: '0.8125rem',
                              padding: '0.4rem 0',
                              borderBottom: '1px solid rgba(255,255,255,0.03)',
                              gap: '1rem'
                            }}>
                              <span style={{ color: '#71717a', fontWeight: 500, minWidth: '100px', flexShrink: 0 }}>
                                {key === 'action'
                                  ? <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><Terminal size={12} /> {payloadFieldLabel(key)}</div>
                                  : payloadFieldLabel(key)}
                              </span>
                              <span style={{ color: '#d4d4d8', flex: 1, textAlign: 'right', wordBreak: 'break-all', fontFamily: key === 'action' || key === 'params' ? 'monospace' : 'inherit' }}>
                                {formatPayloadValue(key, val)}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button
                        onClick={() => handleGenehmigen(g.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.625rem 1rem',
                          backgroundColor: 'rgba(197, 160, 89, 0.1)',
                          border: '1px solid rgba(197, 160, 89, 0.2)',
                          borderRadius: 0,
                          color: '#c5a059',
                          fontWeight: 600,
                          fontSize: '0.875rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        <Check size={16} /> {i18n.t.actions.genehmigen}
                      </button>
                      <button
                        onClick={() => handleAblehnen(g.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.625rem 1rem',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.2)',
                          borderRadius: 0,
                          color: '#ef4444',
                          fontWeight: 600,
                          fontSize: '0.875rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                      >
                        <X size={16} /> {i18n.t.actions.ablehnen}
                      </button>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}

          {/* Completed */}
          {erledigt.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Check size={18} style={{ color: '#22c55e' }} />
                  <h2 style={{ fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {i18n.t.genehmigungen.done} ({erledigt.length})
                  </h2>
                </div>
                {erledigt.length > 10 && (
                  <button
                    onClick={() => setShowAllDone(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: 'none', border: 'none', color: '#52525b', fontSize: '0.75rem', cursor: 'pointer' }}
                  >
                    {showAllDone ? (i18n.language === 'de' ? 'Weniger' : 'Show less') : (i18n.language === 'de' ? `Alle ${erledigt.length} anzeigen` : `Show all ${erledigt.length}`)}
                    <ChevronDown size={13} style={{ transform: showAllDone ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {(showAllDone ? erledigt : erledigt.slice(0, 10)).map((g) => (
                  <GlassCard
                    key={g.id}
                    accent={g.status === 'approved' ? '#22c55e' : '#ef4444'}
                    style={{
                      padding: '1rem 1.25rem',
                      borderRadius: 0,
                      borderLeft: `3px solid ${g.status === 'approved' ? '#22c55e' : '#ef4444'}`,
                      opacity: 0.7,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {g.status === 'approved' ? (
                        <Check size={14} style={{ color: '#22c55e' }} />
                      ) : (
                        <X size={14} style={{ color: '#ef4444' }} />
                      )}
                      <span style={{ fontSize: '0.875rem', fontWeight: 500, color: '#ffffff' }}>{g.title ?? g.titel ?? '—'}</span>
                      <span style={{ fontSize: '0.8125rem', color: '#71717a' }}>· {zeitRelativ(g.createdAt ?? g.erstelltAm ?? '', i18n.t)}</span>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}

          {pending.length === 0 && erledigt.length === 0 && (
            <GlassCard style={{ padding: '4rem 2rem', textAlign: 'center' }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem',
                background: 'rgba(197, 160, 89, 0.1)',
                color: '#c5a059',
              }}>
                <ShieldCheck size={32} />
              </div>
              <p style={{ fontSize: '1rem', fontWeight: 500, color: '#ffffff', marginBottom: '0.25rem' }}>{i18n.t.genehmigungen.noApprovals}</p>
              <p style={{ fontSize: '0.875rem', color: '#71717a' }}>{i18n.t.genehmigungen.noApprovalsHint}</p>
            </GlassCard>
          )}


      </div>
    </>
  );
}
