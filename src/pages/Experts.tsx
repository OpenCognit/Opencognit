import { useState } from 'react';
import { Plus, ArrowRight, Loader2, MessageSquare, Sparkles, Zap, ZapOff, Settings2, Edit2, Crown, Package, Play } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { useNavigate } from 'react-router-dom';
import { StatusBadge } from '../components/StatusBadge';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { zeitRelativ } from '../utils/i18n';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import { apiExperten, type Experte as ExperteType } from '../api/client';
import { ExpertModal } from '../components/ExpertModal';
import { ExpertChatDrawer } from '../components/ExpertChatDrawer';
import { useToast } from '../components/ToastProvider';
import { GlassCard } from '../components/GlassCard';

const CLI_ADAPTERS = ['codex-cli', 'gemini-cli', 'claude-code'];

function authFetch(url: string, options: RequestInit = {}) {
  const token = localStorage.getItem('opencognit_token');
  return fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
}

function centZuEuro(cent: number): string {
  return (cent / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

const verbindungsLabels: Record<string, string> = {
  'claude-code': 'Claude CLI', claude: 'Claude CLI', codex: 'Codex CLI', cursor: 'Cursor', http: 'HTTP Webhook', bash: 'Bash Script', openrouter: 'OpenRouter', openai: 'OpenAI GPT', anthropic: 'Anthropic', ollama: 'Ollama (Lokal)', ceo: 'CEO Engine', custom: 'Custom API',
};

export function Experts() {
  const i18n = useI18n();
  const { language } = i18n;
  const de = language === 'de';
  const navigate = useNavigate();
  const toast = useToast();
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', i18n.t.nav.experten]);
  const { data: alleExperten, loading, reload } = useApi<ExperteType[]>(
    () => apiExperten.liste(aktivesUnternehmen!.id),
    [aktivesUnternehmen?.id]
  );
  const [showModal, setShowModal] = useState(false);
  const [editingExpert, setEditingExpert] = useState<ExperteType | null>(null);
  const [activeChatExpert, setActiveChatExpert] = useState<ExperteType | null>(null);
  const [wakingUp, setWakingUp] = useState<Set<string>>(new Set());

  const triggerWakeup = async (expertId: string) => {
    const expert = alleExperten?.find(e => e.id === expertId);
    setWakingUp(prev => new Set(prev).add(expertId));
    try {
      await authFetch(`/api/experten/${expertId}/wakeup`, { method: 'POST' });
      toast.agent(
        de ? `${expert?.name || 'Agent'} wird aufgeweckt` : `Waking up ${expert?.name || 'agent'}`,
        de ? 'Agent startet seinen Arbeitszyklus' : 'Agent is starting its work cycle',
      );
    } catch (e: any) {
      toast.error(de ? 'Wakeup fehlgeschlagen' : 'Wakeup failed', e.message);
    } finally {
      setTimeout(() => {
        setWakingUp(prev => { const s = new Set(prev); s.delete(expertId); return s; });
        reload();
      }, 1500);
    }
  };

  if (!aktivesUnternehmen) return null;

  if (loading || !alleExperten) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#23CDCB' }} />
      </div>
    );
  }

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
                <Sparkles size={20} style={{ color: '#23CDCB' }} />
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#23CDCB', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                  {aktivesUnternehmen.name}
                </span>
              </div>
              <h1 style={{
                fontSize: '2rem',
                fontWeight: 700,
                background: 'linear-gradient(to bottom right, #23CDCB 0%, #ffffff 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>{i18n.t.experten.title}</h1>
              <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.25rem' }}>{i18n.t.experten.subtitle}</p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.25rem',
                backgroundColor: 'rgba(35, 205, 202, 0.1)',
                border: '1px solid rgba(35, 205, 202, 0.2)',
                borderRadius: '12px',
                color: '#23CDCB',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <Plus size={16} /> {i18n.t.experten.neuerExperte}
            </button>
          </div>

          <PageHelp id="agents" lang={i18n.language} />

          {/* Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: '1.25rem',
          }}>
            {alleExperten.map((m, i) => {
              const budget = m.budgetMonatCent > 0 ? Math.round((m.verbrauchtMonatCent / m.budgetMonatCent) * 100) : 0;
              const manager = m.reportsTo ? alleExperten.find(x => x.id === m.reportsTo) : null;
              let modell = '';
              try {
                if (m.verbindungsConfig) {
                  const conf = JSON.parse(m.verbindungsConfig);
                  modell = conf.model || '';
                }
              } catch {}

              const isCEO = (() => {
                try {
                  const cfg = JSON.parse(m.verbindungsConfig || '{}');
                  return cfg.isOrchestrator === true;
                } catch { return false; }
              })();

              return (
                <GlassCard
                  key={m.id}
                  onClick={() => setActiveChatExpert(m)}
                  accent={isCEO ? '#FFD700' : '#23CDCB'}
                  style={{
                    padding: '1.5rem',
                    borderRadius: '24px',
                    animation: `fadeInUp 0.5s ease-out ${Math.min(i, 4) * 0.1}s both`,
                  }}
                >
                  {isCEO && (
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: 0,
                      width: '4px',
                      background: 'linear-gradient(to bottom, #FFD700, #FFA500)'
                    }} />
                  )}

                  {isCEO && (
                    <div style={{
                      position: 'absolute',
                      top: '0.75rem',
                      right: '3.25rem',
                      background: 'rgba(255, 215, 0, 0.1)',
                      border: '1px solid rgba(255, 215, 0, 0.2)',
                      padding: '4px 8px',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      zIndex: 10,
                      boxShadow: '0 4px 12px rgba(255, 215, 0, 0.1)'
                    }}>
                      <Crown size={12} color="#FFD700" />
                      <span style={{ fontSize: '10px', color: '#FFD700', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>CEO</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                    <div style={{
                      width: '48px',
                      height: '48px',
                      borderRadius: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.125rem',
                      fontWeight: 600,
                      background: m.avatarFarbe + '22',
                      color: m.avatarFarbe,
                    }}>
                      {m.avatar}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{m.name}</span>
                        <StatusBadge status={m.status} />
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditingExpert(m); }}
                          style={{
                            padding: '0.25rem',
                            background: 'none',
                            border: 'none',
                            color: '#71717a',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            marginLeft: 'auto',
                            transition: 'color 0.2s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.color = '#23CDCB'}
                          onMouseLeave={e => e.currentTarget.style.color = '#71717a'}
                          title={i18n.t.actions.bearbeiten}
                        >
                          <Settings2 size={14} />
                        </button>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.25rem' }}>
                        {(m.verbindungsTyp === 'ceo' || /ceo|geschäftsführer/i.test(m.rolle)) && (
                          <span style={{
                            padding: '0.125rem 0.5rem',
                            backgroundColor: 'rgba(251, 191, 36, 0.15)',
                            border: '1px solid rgba(251, 191, 36, 0.3)',
                            borderRadius: '9999px',
                            fontSize: '0.625rem',
                            fontWeight: 700,
                            color: '#fbbf24',
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                          }}>CEO</span>
                        )}
                        {CLI_ADAPTERS.includes(m.verbindungsTyp) && (
                          <span title={i18n.t.gedaechtnis.subscriptionBadge} style={{
                            padding: '0.125rem 0.5rem',
                            backgroundColor: 'rgba(168,85,247,0.15)',
                            border: '1px solid rgba(168,85,247,0.3)',
                            borderRadius: '9999px',
                            fontSize: '0.625rem',
                            fontWeight: 700,
                            color: '#a855f7',
                            letterSpacing: '0.05em',
                            textTransform: 'uppercase',
                          }}>🔑</span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.875rem', color: '#71717a' }}>{m.titel}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.8125rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: '#71717a' }}>{i18n.t.experten.rolle}</span>
                      <span style={{ color: '#d4d4d8' }}>{m.rolle}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: '#71717a' }}>{i18n.t.experten.verbindung}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'end' }}>
                        <span style={{
                          padding: '0.25rem 0.625rem',
                          backgroundColor: CLI_ADAPTERS.includes(m.verbindungsTyp) ? 'rgba(168,85,247,0.15)' : 'rgba(255, 255, 255, 0.05)',
                          border: CLI_ADAPTERS.includes(m.verbindungsTyp) ? '1px solid rgba(168,85,247,0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
                          borderRadius: '9999px',
                          fontSize: '0.75rem',
                          color: CLI_ADAPTERS.includes(m.verbindungsTyp) ? '#a855f7' : '#d4d4d8',
                          fontWeight: CLI_ADAPTERS.includes(m.verbindungsTyp) ? 600 : 400,
                        }}>{verbindungsLabels[m.verbindungsTyp] || m.verbindungsTyp}</span>
                        {modell && <span style={{ fontSize: '0.6875rem', color: '#71717a', marginTop: '0.25rem' }}>{modell}</span>}
                      </div>
                    </div>
                    {manager && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ color: '#71717a' }}>{i18n.language === 'de' ? 'Vorgesetzter' : 'Reports to'}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{
                            width: '24px',
                            height: '24px',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.625rem',
                            fontWeight: 600,
                            background: manager.avatarFarbe + '22',
                            color: manager.avatarFarbe,
                          }}>{manager.avatar}</div>
                          <span style={{ color: '#d4d4d8' }}>{manager.name}</span>
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: '#71717a' }}>{i18n.t.experten.letzterZyklus}</span>
                      <span style={{ color: '#d4d4d8' }}>{zeitRelativ(m.letzterZyklus, i18n.t)}</span>
                    </div>
                    {m.verbindungsTyp !== 'ollama' && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                          <span style={{ color: '#71717a' }}>{i18n.t.experten.budget}</span>
                          <span style={{ color: '#d4d4d8' }}>
                            {centZuEuro(m.verbrauchtMonatCent)} / {centZuEuro(m.budgetMonatCent)}
                            <span style={{
                              marginLeft: '0.5rem',
                              color: budget > 90 ? '#ef4444' : budget > 70 ? '#eab308' : '#71717a',
                              fontWeight: 600,
                            }}>({budget}%)</span>
                          </span>
                        </div>
                        <div style={{
                          height: '6px',
                          backgroundColor: 'rgba(255, 255, 255, 0.1)',
                          borderRadius: '3px',
                          overflow: 'hidden',
                        }}>
                          <div style={{
                            height: '100%',
                            width: `${budget}%`,
                            backgroundColor: budget > 90 ? '#ef4444' : budget > 70 ? '#eab308' : '#22c55e',
                            borderRadius: '3px',
                            transition: 'width 0.3s',
                          }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Autonomie-Switcher */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: '0.75rem',
                      padding: '0.625rem 0.875rem',
                      backgroundColor: m.zyklusAktiv
                        ? 'rgba(35, 205, 202, 0.06)'
                        : 'rgba(255, 255, 255, 0.02)',
                      border: `1px solid ${m.zyklusAktiv ? 'rgba(35, 205, 202, 0.2)' : 'rgba(255, 255, 255, 0.06)'}`,
                      borderRadius: '10px',
                      transition: 'all 0.2s',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        {m.zyklusAktiv
                          ? <Zap size={13} color="#23CDCB" />
                          : <ZapOff size={13} color="#71717a" />
                        }
                        <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: m.zyklusAktiv ? '#23CDCB' : '#a1a1aa' }}>
                          {m.zyklusAktiv ? i18n.t.experten.autonomAktiv : i18n.t.experten.autonomInaktiv}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.6875rem', color: '#52525b', paddingLeft: '1.25rem' }}>
                        {m.zyklusAktiv
                          ? i18n.t.experten.autonomAktivHint
                          : i18n.t.experten.autonomInaktivHint
                        }
                      </span>
                    </div>
                    {/* Toggle */}
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        await authFetch(`/api/mitarbeiter/${m.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ zyklusAktiv: !m.zyklusAktiv }),
                        });
                        reload();
                      }}
                      style={{
                        position: 'relative',
                        width: '38px',
                        height: '22px',
                        borderRadius: '11px',
                        backgroundColor: m.zyklusAktiv ? '#23CDCB' : 'rgba(255,255,255,0.1)',
                        border: 'none',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                        flexShrink: 0,
                      }}
                    >
                      <span style={{
                        position: 'absolute',
                        top: '3px',
                        left: m.zyklusAktiv ? '19px' : '3px',
                        width: '16px',
                        height: '16px',
                        borderRadius: '50%',
                        backgroundColor: '#ffffff',
                        transition: 'left 0.2s',
                        display: 'block',
                      }} />
                    </button>
                  </div>

                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '1rem',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                  }}>
                    <div style={{ fontSize: '0.75rem', color: '#71717a', maxWidth: '70%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.faehigkeiten}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setActiveChatExpert(m); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: '0.5rem 0.75rem',
                          backgroundColor: 'rgba(35, 205, 202, 0.08)',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#23CDCB',
                          fontWeight: 600,
                          fontSize: '0.8125rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(35, 205, 202, 0.15)'}
                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'rgba(35, 205, 202, 0.08)'}
                      >
                        <MessageSquare size={14} /> {i18n.language === 'de' ? 'Chatten' : 'Chat'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); triggerWakeup(m.id); }}
                        disabled={wakingUp.has(m.id)}
                        title={i18n.language === 'de' ? 'Jetzt ausführen' : 'Run now'}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: '0.5rem 0.75rem',
                          backgroundColor: wakingUp.has(m.id) ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                          border: `1px solid ${wakingUp.has(m.id) ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
                          borderRadius: '8px',
                          color: wakingUp.has(m.id) ? '#22c55e' : '#71717a',
                          fontWeight: 500,
                          fontSize: '0.8125rem',
                          cursor: wakingUp.has(m.id) ? 'default' : 'pointer',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => { if (!wakingUp.has(m.id)) { e.currentTarget.style.backgroundColor = 'rgba(34,197,94,0.1)'; e.currentTarget.style.color = '#22c55e'; } }}
                        onMouseLeave={e => { if (!wakingUp.has(m.id)) { e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.04)'; e.currentTarget.style.color = '#71717a'; } }}
                      >
                        {wakingUp.has(m.id)
                          ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                          : <Play size={14} />}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); navigate('/tasks'); }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: '0.5rem 0.75rem',
                          backgroundColor: 'transparent',
                          border: 'none',
                          borderRadius: '8px',
                          color: '#23CDCB',
                          fontWeight: 500,
                          fontSize: '0.8125rem',
                          cursor: 'pointer',
                        }}
                        title={i18n.language === 'de' ? 'Aufgaben anzeigen' : 'View tasks'}
                      >
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>

        <ExpertModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            reload();
          }}
        />

        {(activeChatExpert || editingExpert) && (
          <ExpertChatDrawer
            expert={(activeChatExpert || editingExpert)!}
            initialTab={editingExpert ? 'einstellungen' : 'überblick'}
            onClose={() => {
              setActiveChatExpert(null);
              setEditingExpert(null);
            }}
            onDeleted={() => { 
              setActiveChatExpert(null); 
              setEditingExpert(null);
              reload(); 
            }}
            onUpdated={() => reload()}
          />
        )}

      </div>
    </>
  );
}
