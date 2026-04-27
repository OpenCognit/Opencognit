import React, { useState, useEffect } from 'react';
import { Building2, Zap, CheckCircle2, Loader2, ChevronRight, ChevronLeft, AlertCircle } from 'lucide-react';
import { useI18n } from '../i18n';
import { authFetch } from '../utils/api';

// ─── Types ───────────────────────────────────────────────────────────────────

type ConnectType = 'claude-code' | 'kimi-cli' | 'openrouter' | 'anthropic';

interface CliStatus {
  installed: boolean;
  authenticated?: boolean;
  version?: string;
  loading?: boolean;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.75rem 1rem', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 0, color: '#fff', fontSize: '0.9rem', outline: 'none', transition: 'border-color 0.15s',
};

const focusHandlers = {
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'rgba(197,160,89,0.5)';
    e.target.style.boxShadow = '0 0 0 3px rgba(197,160,89,0.06)';
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.target.style.borderColor = 'rgba(255,255,255,0.08)';
    e.target.style.boxShadow = 'none';
  },
};

// ─── Step bar ────────────────────────────────────────────────────────────────

function StepBar({ current, labels }: { current: number; labels: [string, string] }) {
  const icons = [Building2, Zap];
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
      {labels.map((label, i) => {
        const Icon = icons[i];
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={i}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? 'rgba(197,160,89,0.18)' : active ? 'rgba(197,160,89,0.10)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? 'rgba(197,160,89,0.5)' : done ? 'rgba(197,160,89,0.25)' : 'rgba(255,255,255,0.07)'}`,
                transition: 'all 0.2s',
              }}>
                {done
                  ? <CheckCircle2 size={13} style={{ color: '#c5a059' }} />
                  : <Icon size={13} style={{ color: active ? '#c5a059' : '#3f3f46' }} />}
              </div>
              <span style={{
                fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase',
                color: active ? '#c5a059' : done ? '#52525b' : '#3f3f46', transition: 'color 0.2s',
              }}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div style={{ flex: 1, height: 1, margin: '0 0.875rem', background: i < current ? 'rgba(197,160,89,0.2)' : 'rgba(255,255,255,0.05)', transition: 'background 0.3s' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Connect option card ──────────────────────────────────────────────────────

interface ConnectOptionProps {
  id: ConnectType;
  icon: string;
  label: string;
  description: string;
  badge?: string;
  badgeColor?: string;
  statusText?: string;
  statusColor?: string;
  loading?: boolean;
  selected: boolean;
  onSelect: () => void;
}

function ConnectOption({ icon, label, description, badge, badgeColor, statusText, statusColor, loading, selected, onSelect }: ConnectOptionProps) {
  return (
    <button
      onClick={onSelect}
      style={{
        width: '100%', padding: '0.8rem 1rem', textAlign: 'left', cursor: 'pointer',
        background: selected ? 'rgba(197,160,89,0.07)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${selected ? 'rgba(197,160,89,0.35)' : 'rgba(255,255,255,0.06)'}`,
        borderRadius: 0, transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '0.875rem',
      }}
    >
      <span style={{ fontSize: '1.2rem', lineHeight: 1, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: 2 }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: selected ? '#e5e5e5' : '#a1a1aa' }}>{label}</span>
          {badge && (
            <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 5px', background: `${badgeColor || '#c5a059'}15`, color: badgeColor || '#c5a059', border: `1px solid ${badgeColor || '#c5a059'}30`, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {badge}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
            {loading && <Loader2 size={10} style={{ color: '#3f3f46', animation: 'spin 1s linear infinite' }} />}
            {statusText && !loading && <span style={{ fontSize: '0.65rem', color: statusColor || '#52525b' }}>{statusText}</span>}
          </div>
        </div>
        <span style={{ fontSize: '0.75rem', color: '#52525b', display: 'block', lineHeight: 1.4 }}>{description}</span>
      </div>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: selected ? '#c5a059' : 'transparent', flexShrink: 0, transition: 'background 0.15s' }} />
    </button>
  );
}

// ─── Main Wizard ─────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const { t, language } = useI18n();
  const o = t.onboarding;

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 0 state
  const [companyName, setCompanyName] = useState('');
  const [companyGoal, setCompanyGoal] = useState('');

  // Step 1 state
  const [connectType, setConnectType] = useState<ConnectType | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [cliStatus, setCliStatus] = useState<Record<string, CliStatus>>({
    'claude-code': { installed: false, loading: true },
    'kimi-cli': { installed: false, loading: true },
  });

  // Detect installed CLIs on mount
  useEffect(() => {
    authFetch('/api/system/cli-detect')
      .then(r => r.json())
      .then((data: any) => {
        const map: Record<string, CliStatus> = {};
        for (const t of data.tools ?? []) {
          map[t.name] = { installed: t.installed, authenticated: t.authenticated, version: t.version };
        }
        setCliStatus({
          'claude-code': { ...(map['claude-code'] ?? { installed: false }), loading: false },
          'kimi-cli': { ...(map['kimi-cli'] ?? { installed: false }), loading: false },
        });
        // Auto-select best option
        if (map['claude-code']?.authenticated) setConnectType('claude-code');
        else if (map['kimi-cli']?.authenticated) setConnectType('kimi-cli');
        else if (map['claude-code']?.installed) setConnectType('claude-code');
        else if (map['kimi-cli']?.installed) setConnectType('kimi-cli');
        else setConnectType('openrouter');
      })
      .catch(() => {
        setCliStatus({
          'claude-code': { installed: false, loading: false },
          'kimi-cli': { installed: false, loading: false },
        });
        setConnectType('openrouter');
      });
  }, []);

  // Helpers
  const cliStatusProps = (id: 'claude-code' | 'kimi-cli'): Pick<ConnectOptionProps, 'statusText' | 'statusColor' | 'loading'> => {
    const s = cliStatus[id];
    if (s?.loading) return { loading: true };
    if (!s?.installed) return { statusText: o.connectStatusNotFound, statusColor: '#52525b' };
    if (s.authenticated) return { statusText: o.connectStatusConnected, statusColor: '#22c55e' };
    return { statusText: o.connectStatusInstalled, statusColor: '#f59e0b' };
  };

  const canProceedStep0 = companyName.trim().length >= 1;
  const canProceedStep1 = (() => {
    if (!connectType) return false;
    if (connectType === 'openrouter' || connectType === 'anthropic') return apiKey.trim().length > 10;
    return !cliStatus[connectType]?.loading; // CLI: can proceed even if not installed
  })();

  const handleLaunch = async () => {
    if (!connectType) return;
    setLoading(true);
    setError(null);
    try {
      // 1. Create company
      const compRes = await authFetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: companyName.trim(), ziel: companyGoal.trim() || undefined }),
      });
      if (!compRes.ok) throw new Error(o.errorCreateCompany);
      const company = await compRes.json();

      // 2. Save API key if chosen
      if ((connectType === 'openrouter' || connectType === 'anthropic') && apiKey.trim()) {
        const keyName = connectType === 'openrouter' ? 'openrouter_api_key' : 'anthropic_api_key';
        await authFetch(`/api/settings/${keyName}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ unternehmenId: company.id, value: apiKey.trim() }),
        });
      }

      // 3. Create CEO agent
      const agentRes = await authFetch(`/api/companies/${company.id}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'CEO',
          rolle: 'Chief Executive Officer',
          verbindungsTyp: connectType,
          isOrchestrator: true,
          avatarFarbe: '#c5a059',
        }),
      });
      if (!agentRes.ok) throw new Error(o.errorCreateAgent);
      const agent = await agentRes.json();

      // 4. Hard-navigate to CEO chat (resets App state with new company)
      window.location.href = `/chat?agent=${agent.id}&company=${company.id}`;
    } catch (e: any) {
      setError(e.message || o.errorGeneric);
      setLoading(false);
    }
  };

  const isApiKeyMode = connectType === 'openrouter' || connectType === 'anthropic';
  const showCliWarning = (connectType === 'claude-code' || connectType === 'kimi-cli')
    && !cliStatus[connectType]?.loading
    && !cliStatus[connectType]?.installed;

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse 80% 50% at 50% -5%, rgba(197,160,89,0.07) 0%, transparent 65%), #09090b',
      padding: '1rem',
    }}>
      {/* Subtle dot grid */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }} />

      <div style={{
        width: '100%', maxWidth: 468, position: 'relative', zIndex: 1,
        background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)',
        padding: '2rem 2rem 1.5rem',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.5), 0 32px 64px rgba(0,0,0,0.5)',
      }}>

        {/* Brand header */}
        <div style={{ marginBottom: '1.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.375rem' }}>
            <div style={{ width: 22, height: 22, background: 'linear-gradient(135deg,#c5a059,#d4b06a)', borderRadius: 3, flexShrink: 0 }} />
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#c5a059', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              OpenCognit
            </span>
          </div>
          <p style={{ fontSize: '0.75rem', color: '#3f3f46', margin: 0 }}>{o.tagline}</p>
        </div>

        <StepBar current={step} labels={[o.stepWorkspace, o.stepConnect]} />

        {/* ─── Step 0: Workspace ─── */}
        {step === 0 && (
          <div key="step0">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: '0 0 0.375rem' }}>
              {o.workspaceTitle}
            </h2>
            <p style={{ fontSize: '0.8rem', color: '#71717a', margin: '0 0 1.5rem', lineHeight: 1.5 }}>
              {o.workspaceDesc}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#a1a1aa', marginBottom: '0.4rem', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                  {o.workspaceNameLabel} *
                </label>
                <input
                  autoFocus
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && canProceedStep0 && setStep(1)}
                  placeholder={o.workspaceNamePlaceholder}
                  style={inputStyle}
                  {...focusHandlers}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#52525b', marginBottom: '0.4rem', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                  {o.workspaceGoalLabel} <span style={{ fontWeight: 400, textTransform: 'none', fontSize: '0.68rem' }}>({o.workspaceGoalOptional})</span>
                </label>
                <textarea
                  value={companyGoal}
                  onChange={e => setCompanyGoal(e.target.value)}
                  placeholder={o.workspaceGoalPlaceholder}
                  rows={2}
                  style={{ ...inputStyle, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
                  {...focusHandlers}
                />
                {companyGoal.trim() && (
                  <p style={{ margin: '0.375rem 0 0', fontSize: '0.69rem', color: '#52525b', lineHeight: 1.4 }}>
                    {o.workspaceGoalHint}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Step 1: Connect CEO ─── */}
        {step === 1 && (
          <div key="step1">
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: '0 0 0.375rem' }}>
              {o.connectTitle}
            </h2>
            <p style={{ fontSize: '0.8rem', color: '#71717a', margin: '0 0 1.125rem', lineHeight: 1.5 }}>
              {o.connectDesc}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.875rem' }}>
              <ConnectOption
                id="claude-code"
                icon="⚡"
                label="Claude Code"
                description={o.connectClaudeDesc}
                badge={o.connectRecommended}
                {...cliStatusProps('claude-code')}
                selected={connectType === 'claude-code'}
                onSelect={() => { setConnectType('claude-code'); setApiKey(''); }}
              />
              <ConnectOption
                id="kimi-cli"
                icon="🌙"
                label="Kimi CLI"
                description={o.connectKimiDesc}
                {...cliStatusProps('kimi-cli')}
                selected={connectType === 'kimi-cli'}
                onSelect={() => { setConnectType('kimi-cli'); setApiKey(''); }}
              />
              <ConnectOption
                id="openrouter"
                icon="🔗"
                label="OpenRouter"
                description={o.connectOpenrouterDesc}
                badge="API"
                badgeColor="#818cf8"
                selected={connectType === 'openrouter'}
                onSelect={() => setConnectType('openrouter')}
              />
              <ConnectOption
                id="anthropic"
                icon="🤖"
                label="Anthropic"
                description={o.connectAnthropicDesc}
                badge="API"
                badgeColor="#818cf8"
                selected={connectType === 'anthropic'}
                onSelect={() => setConnectType('anthropic')}
              />
            </div>

            {/* API Key input */}
            {isApiKeyMode && (
              <div style={{ marginTop: '0.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 700, color: '#a1a1aa', marginBottom: '0.4rem', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                  {connectType === 'openrouter' ? 'OpenRouter API Key' : 'Anthropic API Key'} *
                </label>
                <input
                  autoFocus
                  type="password"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={connectType === 'openrouter' ? 'sk-or-...' : 'sk-ant-...'}
                  style={inputStyle}
                  {...focusHandlers}
                />
                <p style={{ margin: '0.375rem 0 0', fontSize: '0.69rem', color: '#52525b' }}>
                  {connectType === 'openrouter' ? o.connectOrKeyHint : o.connectAnthropicKeyHint}
                </p>
              </div>
            )}

            {/* CLI not installed notice */}
            {showCliWarning && (
              <div style={{ padding: '0.75rem 0.875rem', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.18)', fontSize: '0.78rem', color: '#d97706', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ marginBottom: 6 }}>
                    {o.connectCliNotInstalled(connectType === 'claude-code' ? 'Claude Code' : 'Kimi CLI')}
                    {' '}{o.connectCliInstallWith}
                  </div>
                  <code style={{ display: 'block', padding: '4px 8px', background: 'rgba(0,0,0,0.35)', fontFamily: 'monospace', fontSize: '0.72rem', color: '#e2e8f0', marginBottom: 6 }}>
                    {connectType === 'claude-code' ? 'npm install -g @anthropic-ai/claude-code' : 'pip install kimi-cli'}
                  </code>
                  <span style={{ fontSize: '0.68rem', color: '#78716c' }}>{o.connectCliSkipHint}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ marginTop: '1rem', padding: '0.7rem 0.875rem', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.8rem', color: '#fca5a5', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <AlertCircle size={13} style={{ flexShrink: 0 }} />
            {error}
          </div>
        )}

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.75rem' }}>
          {step > 0 ? (
            <button
              onClick={() => { setStep(s => s - 1); setError(null); }}
              style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', padding: '0.5rem 0.875rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.07)', color: '#71717a', fontSize: '0.8rem', cursor: 'pointer', borderRadius: 0 }}
            >
              <ChevronLeft size={13} /> {o.back}
            </button>
          ) : <span />}

          {step < 1 ? (
            <button
              disabled={!canProceedStep0}
              onClick={() => setStep(1)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.6rem 1.25rem', borderRadius: 0, fontSize: '0.875rem', fontWeight: 600,
                background: canProceedStep0 ? 'rgba(197,160,89,0.12)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${canProceedStep0 ? 'rgba(197,160,89,0.38)' : 'rgba(255,255,255,0.06)'}`,
                color: canProceedStep0 ? '#c5a059' : '#3f3f46',
                cursor: canProceedStep0 ? 'pointer' : 'not-allowed', transition: 'all 0.15s',
              }}
            >
              {o.continue} <ChevronRight size={13} />
            </button>
          ) : (
            <button
              disabled={!canProceedStep1 || loading}
              onClick={handleLaunch}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.6rem 1.25rem', borderRadius: 0, fontSize: '0.875rem', fontWeight: 600,
                background: (canProceedStep1 && !loading) ? 'rgba(197,160,89,0.12)' : 'rgba(255,255,255,0.02)',
                border: `1px solid ${(canProceedStep1 && !loading) ? 'rgba(197,160,89,0.38)' : 'rgba(255,255,255,0.06)'}`,
                color: (canProceedStep1 && !loading) ? '#c5a059' : '#3f3f46',
                cursor: (canProceedStep1 && !loading) ? 'pointer' : 'not-allowed', transition: 'all 0.15s',
              }}
            >
              {loading
                ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> {o.launching}</>
                : <>{o.launch} <ChevronRight size={13} /></>}
            </button>
          )}
        </div>

        {/* Footer hint */}
        <p style={{ textAlign: 'center', marginTop: '1.25rem', fontSize: '0.68rem', color: '#27272a', lineHeight: 1.4 }}>
          {o.footerHint}
        </p>

        {/* Language switcher */}
        <div style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>
          <select
            value={language}
            onChange={e => {
              // Use the i18n setLanguage via localStorage + reload
              localStorage.setItem('opencognit_language', e.target.value);
              window.location.reload();
            }}
            style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.07)', color: '#52525b', fontSize: '0.7rem', padding: '2px 4px', cursor: 'pointer', outline: 'none', borderRadius: 0 }}
          >
            <option value="en">EN</option>
            <option value="de">DE</option>
          </select>
        </div>
      </div>
    </div>
  );
}
