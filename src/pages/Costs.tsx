import { useState } from 'react';
import { Loader2, Sparkles, Wallet, Server, BarChart3, Shield, AlertTriangle, Plus, X } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { useApi } from '../hooks/useApi';
import { apiKosten, apiBudget, apiExperten, type KostenZusammenfassung, type ProviderKosten, type TimelineTag, type BudgetPolicy, type BudgetIncident, type Experte, type BudgetForecast } from '../api/client';
import { GlassCard } from '../components/GlassCard';

function centZuEuro(cent: number, currency: 'EUR' | 'USD' = 'EUR'): string {
  const locale = currency === 'USD' ? 'en-US' : 'de-DE';
  return (cent / 100).toLocaleString(locale, { style: 'currency', currency });
}

function formatBudget(cent: number): string {
  if (cent === 0) return '∞';
  return centZuEuro(cent);
}

const PROVIDER_FARBEN: Record<string, string> = {
  openrouter: '#9b87c8',
  anthropic: '#d97706',
  openai: '#10b981',
  ollama: '#06b6d4',
  'claude-code': '#f59e0b',
  'codex-cli': '#3b82f6',
  'gemini-cli': '#ef4444',
  'kimi-cli': '#8b5cf6',
  ceo: '#c5a059',
};

export function Costs() {
  const i18n = useI18n();
  const de = i18n.language === 'de';
  const { aktivesUnternehmen } = useCompany();
  useBreadcrumbs([aktivesUnternehmen?.name ?? '', i18n.t.nav.kosten]);

  const [tab, setTab] = useState<'agent' | 'provider' | 'timeline' | 'policies'>('agent');
  const [showNewPolicy, setShowNewPolicy] = useState(false);
  const [newPolicyScope, setNewPolicyScope] = useState<'company' | 'agent'>('agent');
  const [newPolicyScopeId, setNewPolicyScopeId] = useState('');
  const [newPolicyLimit, setNewPolicyLimit] = useState(50);
  const [newPolicyWarn, setNewPolicyWarn] = useState(80);

  const { data, loading } = useApi<KostenZusammenfassung>(
    () => apiKosten.zusammenfassung(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );
  const { data: providerData } = useApi<ProviderKosten[]>(
    () => apiKosten.nachProvider(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );
  const { data: timelineData } = useApi<TimelineTag[]>(
    () => apiKosten.timeline(aktivesUnternehmen!.id, 14), [aktivesUnternehmen?.id]
  );
  const { data: policies, reload: reloadPolicies } = useApi<BudgetPolicy[]>(
    () => apiBudget.policies(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );
  const { data: incidents } = useApi<BudgetIncident[]>(
    () => apiBudget.incidents(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );
  const { data: forecastData } = useApi<{ forecasts: BudgetForecast[] }>(
    () => apiBudget.forecast(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );
  const { data: alleExperten } = useApi<Experte[]>(
    () => apiExperten.liste(aktivesUnternehmen!.id), [aktivesUnternehmen?.id]
  );

  if (!aktivesUnternehmen) return null;
  if (loading || !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
        <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#c5a059' }} />
      </div>
    );
  }

  const maxTimeline = Math.max(...(timelineData || []).map(t => t.kostenCent), 1);

  return (
    <>
      <div>
          {/* Header */}
          <div style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <Sparkles size={20} style={{ color: '#c5a059' }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: '#c5a059', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {aktivesUnternehmen.name}
              </span>
            </div>
            <h1 style={{
              fontSize: '2rem', fontWeight: 700,
              background: 'linear-gradient(to bottom right, #c5a059 0%, #ffffff 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            }}>{i18n.t.kosten.title}</h1>
            <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.25rem' }}>{i18n.t.kosten.subtitle}</p>
          </div>

          <PageHelp id="costs" lang={i18n.language} />

          {/* Metric Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
            {[
              { label: i18n.t.kosten.monatsbudget, value: formatBudget(data.gesamtBudget), color: '#c5a059', sub: data.gesamtBudget === 0 ? (de ? 'Kein Limit' : 'No limit') : undefined },
              { label: i18n.t.kosten.verbraucht, value: centZuEuro(data.gesamtVerbraucht), color: '#eab308', pct: data.gesamtBudget > 0 ? data.gesamtProzent : undefined, sub: de ? '≈ USD: ' + centZuEuro(data.gesamtVerbraucht, 'USD') : '≈ EUR: ' + centZuEuro(data.gesamtVerbraucht) },
              { label: i18n.t.kosten.verbleibend, value: data.gesamtBudget === 0 ? '∞' : centZuEuro(data.gesamtBudget - data.gesamtVerbraucht), color: '#22c55e', sub: data.gesamtBudget === 0 ? (de ? 'Unbegrenzt' : 'Unlimited') : undefined },
            ].map((card, i) => (
              <GlassCard key={i} accent={card.color} style={{
                padding: '1.5rem',
                animation: `fadeInUp 0.5s ease-out ${i * 0.1}s both`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '0.8125rem', fontWeight: 500, color: '#d4d4d8' }}>{card.label}</span>
                  <div style={{ padding: '0.5rem', backgroundColor: card.color + '1a', borderRadius: 0 }}>
                    <Wallet size={18} style={{ color: card.color }} />
                  </div>
                </div>
                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: card.color === '#22c55e' ? '#22c55e' : '#ffffff', lineHeight: 1 }}>
                  {card.value}
                </div>
                {card.pct !== undefined && (
                  <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 0, marginTop: '0.75rem', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${card.pct}%`, backgroundColor: card.pct > 90 ? '#ef4444' : card.pct > 70 ? '#eab308' : '#22c55e', borderRadius: 0 }} />
                  </div>
                )}
                {(card as any).sub && (
                  <div style={{ fontSize: '0.75rem', color: '#52525b', marginTop: '0.5rem' }}>{(card as any).sub}</div>
                )}
              </GlassCard>
            ))}
          </div>

          {/* Tab Bar */}
          <div style={{ display: 'flex', gap: '0.375rem', marginBottom: '1.5rem' }}>
            {[
              { key: 'agent' as const, label: de ? 'Nach Agent' : 'By Agent', icon: Sparkles },
              { key: 'provider' as const, label: de ? 'Nach Provider' : 'By Provider', icon: Server },
              { key: 'timeline' as const, label: 'Timeline (14d)', icon: BarChart3 },
              { key: 'policies' as const, label: de ? 'Policies' : 'Policies', icon: Shield },
            ].map(t => (
              <button key={t.key} onClick={() => setTab(t.key)} style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.5rem 1rem', borderRadius: 0,
                background: tab === t.key ? 'rgba(197,160,89,0.1)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${tab === t.key ? 'rgba(197,160,89,0.3)' : 'rgba(255,255,255,0.06)'}`,
                color: tab === t.key ? '#c5a059' : '#71717a',
                cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600,
              }}>
                <t.icon size={15} /> {t.label}
              </button>
            ))}
          </div>

          {/* Agent Tab (existierend) */}
          {tab === 'agent' && (
            <GlassCard style={{ animation: 'fadeInUp 0.3s ease-out' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{de ? 'Agent' : 'Agent'}</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase' }}>{de ? 'Adapter' : 'Adapter'}</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase' }}>{de ? 'Verbraucht' : 'Spent'}</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase' }}>Budget</th>
                    <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: 600, color: '#71717a', textTransform: 'uppercase' }}>{de ? 'Auslastung' : 'Usage'}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.proExperte.map(m => (
                    <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <div style={{ width: 40, height: 40, borderRadius: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.875rem', fontWeight: 600, background: m.avatarFarbe + '22', color: m.avatarFarbe }}>{m.avatar}</div>
                          <div>
                            <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#fff' }}>{m.name}</div>
                            <div style={{ fontSize: '0.75rem', color: '#71717a' }}>{m.titel}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <span style={{ padding: '0.25rem 0.625rem', backgroundColor: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '9999px', fontSize: '0.75rem', color: '#d4d4d8' }}>{m.verbindungsTyp}</span>
                      </td>
                      <td style={{ padding: '1rem', fontSize: '0.875rem', fontWeight: 500, color: '#fff' }}>{centZuEuro(m.verbrauchtMonatCent)}</td>
                      <td style={{ padding: '1rem', fontSize: '0.8125rem', color: '#71717a' }}>
                        {m.budgetMonatCent === 0
                          ? <span style={{ color: '#22c55e', fontWeight: 500 }}>∞ {de ? 'Unbegrenzt' : 'Unlimited'}</span>
                          : <><span style={{ color: '#fff', fontWeight: 500 }}>{centZuEuro(m.budgetMonatCent)}</span><span style={{ fontSize: '0.7rem', marginLeft: 4, color: '#52525b' }}>≈ {centZuEuro(m.budgetMonatCent, 'USD')}</span></>
                        }
                      </td>
                      <td style={{ padding: '1rem', minWidth: 140 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ flex: 1, height: 6, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 0, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${m.prozent}%`, backgroundColor: m.prozent > 90 ? '#ef4444' : m.prozent > 70 ? '#eab308' : '#22c55e', borderRadius: 0 }} />
                          </div>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: m.prozent > 90 ? '#ef4444' : m.prozent > 70 ? '#eab308' : '#71717a', minWidth: 35, textAlign: 'right' }}>{m.prozent}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </GlassCard>
          )}

          {/* Provider Tab */}
          {tab === 'provider' && providerData && (
            <GlassCard style={{ padding: '1.5rem', animation: 'fadeInUp 0.3s ease-out' }}>
              {providerData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '3rem', color: '#52525b' }}>
                  {de ? 'Keine Kostendaten vorhanden' : 'No cost data available'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {providerData.map(p => {
                    const maxKosten = providerData[0]?.kosten || 1;
                    const pct = Math.round((p.kosten / maxKosten) * 100);
                    const farbe = PROVIDER_FARBEN[p.anbieter] || '#71717a';
                    return (
                      <div key={p.anbieter} style={{
                        display: 'flex', alignItems: 'center', gap: '1rem',
                        padding: '1rem', borderRadius: 0,
                        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                        transition: 'all 0.2s',
                      }}>
                        <div style={{
                          width: 40, height: 40, borderRadius: 0,
                          background: farbe + '1a', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Server size={18} style={{ color: farbe }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.375rem' }}>
                            <span style={{ fontWeight: 700, color: '#e4e4e7', fontSize: '0.9375rem' }}>{p.anbieter}</span>
                            <span style={{ fontWeight: 700, color: farbe }}>{centZuEuro(p.kosten)}</span>
                          </div>
                          <div style={{ height: 8, borderRadius: 0, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: farbe, borderRadius: 0, transition: 'width 0.5s' }} />
                          </div>
                          <div style={{ display: 'flex', gap: '1rem', marginTop: '0.375rem', fontSize: '0.75rem', color: '#52525b' }}>
                            <span>{p.buchungen} {de ? 'Buchungen' : 'entries'}</span>
                            <span>{(p.tokens / 1000).toFixed(1)}k Tokens</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </GlassCard>
          )}

          {/* Timeline Tab */}
          {tab === 'timeline' && timelineData && (
            <GlassCard style={{ padding: '1.5rem', animation: 'fadeInUp 0.3s ease-out' }}>
              <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#d4d4d8', marginBottom: '1rem' }}>
                {de ? 'Tageskosten der letzten 14 Tage' : 'Daily costs — last 14 days'}
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '200px', padding: '0 0.5rem' }}>
                {timelineData.map((t, i) => {
                  const h = maxTimeline > 0 ? Math.max(2, (t.kostenCent / maxTimeline) * 180) : 2;
                  const istHeute = t.datum === new Date().toISOString().split('T')[0];
                  return (
                    <div key={t.datum} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem' }}>
                      <span style={{ fontSize: '0.6rem', color: '#52525b', minHeight: '1rem' }}>
                        {t.kostenCent > 0 ? centZuEuro(t.kostenCent) : ''}
                      </span>
                      <div
                        title={`${t.datum}: ${centZuEuro(t.kostenCent)}`}
                        style={{
                          width: '100%', maxWidth: 40, height: h, borderRadius: '0',
                          background: istHeute
                            ? 'linear-gradient(to top, #c5a059, #06b6d4)'
                            : t.kostenCent > 0 ? 'rgba(197,160,89,0.4)' : 'rgba(255,255,255,0.05)',
                          transition: 'height 0.5s ease',
                        }}
                      />
                      <span style={{
                        fontSize: '0.6rem', color: istHeute ? '#c5a059' : '#3f3f46',
                        fontWeight: istHeute ? 700 : 400,
                      }}>
                        {t.datum.slice(8, 10)}.{t.datum.slice(5, 7)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          )}

          {/* Policies Tab */}
          {tab === 'policies' && (
            <>
            {/* Budget Forecast Card */}
            {forecastData && forecastData.forecasts.length > 0 && (
              <GlassCard style={{ padding: '1.5rem', marginBottom: '1rem', animation: 'fadeInUp 0.3s ease-out' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <BarChart3 size={18} color="#c5a059" />
                  <span style={{ fontWeight: 600, color: '#d4d4d8' }}>{de ? 'Budget-Forecast' : 'Budget Forecast'}</span>
                  <span style={{ fontSize: '0.75rem', color: '#71717a' }}>
                    {de ? '— Projektion basierend auf aktuellem Burn-Rate' : '— Projection based on current burn rate'}
                  </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem' }}>
                  {forecastData.forecasts.map(f => {
                    const color = f.triggered === 'hard' ? '#ef4444' : f.triggered === 'warn' ? '#f59e0b' : '#c5a059';
                    const hitDate = f.projectedHitAt ? new Date(f.projectedHitAt) : null;
                    const hitStr = hitDate ? hitDate.toLocaleDateString(de ? 'de-DE' : 'en-US', { day: '2-digit', month: 'short' }) : (de ? 'nie' : 'never');
                    const daysStr = f.daysToHit !== null ? `${f.daysToHit.toFixed(1)}d` : '—';
                    return (
                      <div key={f.policyId} style={{
                        padding: '0.875rem', borderRadius: 0,
                        background: 'rgba(255,255,255,0.03)', border: `1px solid ${color}33`,
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                          <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#d4d4d8' }}>
                            {f.scope === 'company' ? (de ? 'Firma' : 'Company') : f.scopeLabel}
                          </span>
                          <span style={{ fontSize: '0.6875rem', padding: '2px 8px', borderRadius: 0, background: `${color}22`, color, border: `1px solid ${color}44` }}>
                            {f.fenster === 'monatlich' ? (de ? 'monatlich' : 'monthly') : (de ? 'lifetime' : 'lifetime')}
                          </span>
                        </div>
                        <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 0, overflow: 'hidden', marginBottom: '0.5rem' }}>
                          <div style={{ width: `${Math.min(100, f.percentUsed)}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#a1a1aa' }}>
                          <span>{centZuEuro(f.spentCent)} / {centZuEuro(f.limitCent)}</span>
                          <span style={{ color: f.percentUsed >= 80 ? '#f59e0b' : '#71717a' }}>{f.percentUsed.toFixed(0)}%</span>
                        </div>
                        <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.75rem', color: '#a1a1aa' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                            <span>{de ? 'Burn-Rate' : 'Burn rate'}:</span>
                            <strong style={{ color: '#d4d4d8' }}>{centZuEuro(f.burnRateCentPerDay)}/{de ? 'Tag' : 'day'}</strong>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span>{de ? 'Limit erreicht' : 'Limit hit'}:</span>
                            <strong style={{ color: f.willExceedThisWindow ? '#ef4444' : '#22c55e' }}>
                              {hitStr} ({daysStr})
                            </strong>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </GlassCard>
            )}
            <GlassCard style={{ padding: '1.5rem', animation: 'fadeInUp 0.3s ease-out' }}>
              {/* Header + Neu-Button */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <span style={{ fontWeight: 600, color: '#d4d4d8' }}>{de ? 'Budget-Policies' : 'Budget Policies'}</span>
                <button onClick={() => setShowNewPolicy(!showNewPolicy)} style={{
                  display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.375rem 0.75rem',
                  borderRadius: 0, background: 'rgba(197,160,89,0.1)', border: '1px solid rgba(197,160,89,0.25)',
                  color: '#c5a059', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600,
                }}>
                  {showNewPolicy ? <X size={14} /> : <Plus size={14} />} {showNewPolicy ? (de ? 'Abbrechen' : 'Cancel') : (de ? 'Neue Policy' : 'New Policy')}
                </button>
              </div>

              {/* Neue Policy Form */}
              {showNewPolicy && (
                <div style={{
                  padding: '1rem', borderRadius: 0, background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)', marginBottom: '1rem',
                  display: 'flex', flexDirection: 'column', gap: '0.75rem',
                }}>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <select value={newPolicyScope} onChange={e => setNewPolicyScope(e.target.value as any)} style={{
                      padding: '0.5rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 0, color: '#e4e4e7', fontSize: '0.8125rem',
                    }}>
                      <option value="company">{de ? 'Firma' : 'Company'}</option>
                      <option value="agent">Agent</option>
                    </select>
                    {newPolicyScope === 'agent' && (
                      <select value={newPolicyScopeId} onChange={e => setNewPolicyScopeId(e.target.value)} style={{
                        flex: 1, padding: '0.5rem', background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0, color: '#e4e4e7', fontSize: '0.8125rem',
                      }}>
                        <option value="">{de ? 'Agent wählen...' : 'Select agent...'}</option>
                        {(alleExperten || []).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', minWidth: 80 }}>Limit (EUR)</label>
                    <input type="number" value={newPolicyLimit} onChange={e => setNewPolicyLimit(Number(e.target.value))} style={{
                      width: 100, padding: '0.5rem', background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0, color: '#e4e4e7', fontSize: '0.8125rem',
                    }} />
                    <label style={{ fontSize: '0.75rem', color: '#71717a' }}>{de ? 'Warnung bei' : 'Warn at'}</label>
                    <input type="number" value={newPolicyWarn} onChange={e => setNewPolicyWarn(Number(e.target.value))} style={{
                      width: 60, padding: '0.5rem', background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)', borderRadius: 0, color: '#e4e4e7', fontSize: '0.8125rem',
                    }} />
                    <span style={{ fontSize: '0.75rem', color: '#71717a' }}>%</span>
                  </div>
                  <button onClick={async () => {
                    const scopeId = newPolicyScope === 'company' ? aktivesUnternehmen!.id : newPolicyScopeId;
                    if (!scopeId) return;
                    await apiBudget.createPolicy(aktivesUnternehmen!.id, {
                      scope: newPolicyScope, scopeId, limitCent: newPolicyLimit * 100,
                      warnProzent: newPolicyWarn, hardStop: true,
                    });
                    setShowNewPolicy(false);
                    reloadPolicies();
                  }} style={{
                    alignSelf: 'flex-end', padding: '0.5rem 1rem', borderRadius: 0,
                    background: '#c5a059', border: 'none', color: '#000', fontWeight: 600,
                    cursor: 'pointer', fontSize: '0.8125rem',
                  }}>
                    {de ? 'Erstellen' : 'Create'}
                  </button>
                </div>
              )}

              {/* Policies Liste */}
              {(policies || []).length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: '#52525b', fontSize: '0.875rem' }}>
                  {de ? 'Keine Budget-Policies konfiguriert' : 'No budget policies configured'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {(policies || []).map(p => {
                    const pct = p.status?.prozent ?? 0;
                    const statusColor = p.status?.status === 'hard_stop' ? '#ef4444' : p.status?.status === 'warnung' ? '#eab308' : '#22c55e';
                    const agentName = p.scope === 'agent' ? (alleExperten || []).find(e => e.id === p.scopeId)?.name : aktivesUnternehmen?.name;
                    return (
                      <div key={p.id} style={{
                        display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.875rem',
                        borderRadius: 0, background: 'rgba(255,255,255,0.02)',
                        border: `1px solid ${p.status?.status === 'hard_stop' ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.05)'}`,
                      }}>
                        <Shield size={16} style={{ color: statusColor, flexShrink: 0 }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                            <span style={{ fontWeight: 600, color: '#e4e4e7', fontSize: '0.875rem' }}>{agentName || p.scopeId}</span>
                            <span style={{ fontSize: '0.6875rem', color: '#52525b', padding: '0.125rem 0.375rem', background: 'rgba(255,255,255,0.05)', borderRadius: 0 }}>
                              {p.scope} / {p.fenster}
                            </span>
                          </div>
                          <div style={{ height: 6, borderRadius: 0, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: statusColor, borderRadius: 0, transition: 'width 0.5s' }} />
                          </div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ fontSize: '0.875rem', fontWeight: 700, color: statusColor }}>{pct}%</div>
                          <div style={{ fontSize: '0.6875rem', color: '#52525b' }}>{centZuEuro(p.status?.verbrauchtCent || 0)} / {centZuEuro(p.limitCent)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Incidents */}
              {(incidents || []).filter(i => i.status === 'offen').length > 0 && (
                <div style={{ marginTop: '1.25rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', marginBottom: '0.75rem', color: '#ef4444', fontWeight: 600, fontSize: '0.875rem' }}>
                    <AlertTriangle size={14} /> {de ? 'Offene Incidents' : 'Open Incidents'} ({(incidents || []).filter(i => i.status === 'offen').length})
                  </div>
                  {(incidents || []).filter(i => i.status === 'offen').map(inc => (
                    <div key={inc.id} style={{
                      padding: '0.75rem', borderRadius: 0, marginBottom: '0.375rem',
                      background: inc.typ === 'hard_stop' ? 'rgba(239,68,68,0.08)' : 'rgba(234,179,8,0.08)',
                      border: `1px solid ${inc.typ === 'hard_stop' ? 'rgba(239,68,68,0.2)' : 'rgba(234,179,8,0.2)'}`,
                      fontSize: '0.8125rem',
                    }}>
                      <span style={{ fontWeight: 600, color: inc.typ === 'hard_stop' ? '#ef4444' : '#eab308' }}>
                        {inc.typ === 'hard_stop' ? 'HARD STOP' : 'WARNUNG'}
                      </span>
                      {' — '}{centZuEuro(inc.beobachteterBetrag)} / {centZuEuro(inc.limitBetrag)}
                      <span style={{ color: '#52525b', marginLeft: '0.5rem' }}>{new Date(inc.erstelltAm).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
            </>
          )}
      </div>
    </>
  );
}
