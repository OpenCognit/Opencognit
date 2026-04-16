import { useState, useRef, useEffect } from 'react';
import { Save, RotateCcw, Globe, Shield, Bell, Database, Loader2, Key, Sparkles, Download, Upload, CheckCircle2, AlertCircle, Trash2, AlertTriangle, FolderOpen, Send, Terminal, RefreshCw, Zap } from 'lucide-react';
import { PageHelp } from '../components/PageHelp';
import { Select } from '../components/Select';
import { useI18n } from '../i18n';
import { useCompany } from '../hooks/useCompany';
import { useBreadcrumbs } from '../hooks/useBreadcrumbs';
import { useTheme } from '../hooks/useTheme';
import { useToast } from '../components/ToastProvider';

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

export function Settings() {
  const i18n = useI18n();
  const { theme, setTheme } = useTheme();
  const { aktivesUnternehmen } = useCompany();
  const toastCtx = useToast();
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingSection, setSavingSection] = useState<string | null>(null);
  const [savedSection, setSavedSection] = useState<string | null>(null);

  // Claude Code status
  const [claudeStatus, setClaudeStatus] = useState<{
    installed: boolean; version?: string; authenticated: boolean;
    subscriptionType?: string; tokenExpired?: boolean; expiresAt?: string;
    loading?: boolean; error?: string;
  }>({ installed: false, authenticated: false, loading: true });

  const checkClaudeStatus = () => {
    setClaudeStatus(s => ({ ...s, loading: true }));
    authFetch('/api/system/claude-status')
      .then(r => r.json())
      .then(data => setClaudeStatus({ ...data, loading: false }))
      .catch(e => setClaudeStatus({ installed: false, authenticated: false, loading: false, error: e.message }));
  };

  // Other CLI status (Gemini, Codex)
  const [cliStatus, setCliStatus] = useState<{
    gemini: { installed: boolean; version: string };
    codex: { installed: boolean; version: string };
  } | null>(null);

  useEffect(() => {
    checkClaudeStatus();
    authFetch('/api/system/cli-status')
      .then(r => r.json())
      .then(data => setCliStatus(data))
      .catch(() => {});
  }, []);

  // API Key state
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [ollamaUrl, setOllamaUrl] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customApiBaseUrl, setCustomApiBaseUrl] = useState('');
  const [defaultModel, setDefaultModel] = useState('openrouter/auto');
  const [orModels, setOrModels] = useState<{id: string; name: string}[]>([]);
  const [loadingOrModels, setLoadingOrModels] = useState(false);

  // Budget & approval controls
  const [budgetPauseThreshold, setBudgetPauseThreshold] = useState(95);
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [strategyApproval, setStrategyApproval] = useState(true);

  // Notification settings
  const [notifyApprovals, setNotifyApprovals] = useState(true);
  const [notifyBudget, setNotifyBudget] = useState(true);
  const [notifyWorkCycle, setNotifyWorkCycle] = useState(false);
  const [notifyErrors, setNotifyErrors] = useState(true);

  // Workspace / Project directory
  const [workDir, setWorkDir] = useState('');
  const [workDirStatus, setWorkDirStatus] = useState<null | { exists: boolean; writable: boolean; error?: string }>(null);
  const [checkingWorkDir, setCheckingWorkDir] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);
  
  // Telegram Integration
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [testSending, setTestSending] = useState(false);

  const checkWorkDir = async (dir: string) => {
    if (!aktivesUnternehmen || !dir.trim()) return;
    setCheckingWorkDir(true);
    setWorkDirStatus(null);
    try {
      const r = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/workspace/check?path=${encodeURIComponent(dir.trim())}`);
      const data = await r.json();
      setWorkDirStatus(data);
    } catch { setWorkDirStatus({ exists: false, writable: false, error: 'Verbindungsfehler' }); }
    finally { setCheckingWorkDir(false); }
  };

  const openFolder = async () => {
    if (!aktivesUnternehmen || !workDir.trim()) return;
    setOpeningFolder(true);
    try {
      await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/open-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workDir.trim() }),
      });
    } catch { /* ignore */ }
    finally { setOpeningFolder(false); }
  };

  const saveWorkDir = async () => {
    if (!aktivesUnternehmen) return;
    await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ workDir: workDir.trim() || '' }), // Send empty string to clear
    });
  };

  useEffect(() => {
    const uId = aktivesUnternehmen?.id || '';
    authFetch(`/api/einstellungen?unternehmenId=${uId}`)
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        setAnthropicKey(data.anthropic_api_key || '');
        setOpenaiKey(data.openai_api_key || '');
        setOpenrouterKey(data.openrouter_api_key || '');
        setDefaultModel(data.openrouter_default_model || 'openrouter/auto');
        setOllamaUrl(data.ollama_base_url || '');
        setCustomApiKey(data.custom_api_key || '');
        setCustomApiBaseUrl(data.custom_api_base_url || '');
        setBudgetPauseThreshold(Number(data.budget_pause_threshold) || 95);
        setApprovalRequired(data.approval_required !== 'false');
        setStrategyApproval(data.strategy_approval !== 'false');
        setNotifyApprovals(data.notify_approvals !== 'false');
        setNotifyBudget(data.notify_budget !== 'false');
        setNotifyWorkCycle(data.notify_work_cycle === 'true');
        setNotifyErrors(data.notify_errors !== 'false');
        setTelegramBotToken(data.telegram_bot_token || '');
        setTelegramChatId(data.telegram_chat_id || '');
      })
      .catch(() => {});
  }, [aktivesUnternehmen?.id]);

  useEffect(() => {
    if (aktivesUnternehmen) {
      authFetch(`/api/unternehmen/${aktivesUnternehmen.id}`)
        .then(r => r.json())
        .then((c: any) => { setWorkDir(c.workDir || ''); }) // Fix: set empty if null
        .catch(() => {});
    } else {
      setWorkDir('');
    }
  }, [aktivesUnternehmen?.id]);

  // Fetch OpenRouter models when API key is set
  useEffect(() => {
    if (!openrouterKey) {
      setOrModels([]);
      return;
    }
    setLoadingOrModels(true);
    fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Authorization': `Bearer ${openrouterKey}` },
    })
      .then(r => r.json())
      .then((data: any) => {
        const models: {id: string; name: string}[] = (data.data || [])
          .filter((m: any) => m.id && !m.id.endsWith(':free'))
          .map((m: any) => ({ id: m.id, name: m.name || m.id }))
          .sort((a: {id: string; name: string}, b: {id: string; name: string}) => a.name.localeCompare(b.name));
        setOrModels(models);
      })
      .catch(() => setOrModels([]))
      .finally(() => setLoadingOrModels(false));
  }, [openrouterKey]);

  // Reset/Danger Zone state
  const [resetConfirm, setResetConfirm] = useState<'company' | 'factory' | null>(null);
  const [resetting, setResetting] = useState(false);

  const handleCompanyReset = async () => {
    if (!aktivesUnternehmen) return;
    setResetting(true);
    try {
      const res = await authFetch(`/api/unternehmen/${aktivesUnternehmen.id}/reset`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Reset fehlgeschlagen');
      window.location.reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setResetting(false);
      setResetConfirm(null);
    }
  };

  const handleFactoryReset = async () => {
    setResetting(true);
    try {
      const res = await authFetch('/api/system/factory-reset', { method: 'DELETE' });
      if (!res.ok) throw new Error('Factory Reset fehlgeschlagen');
      localStorage.removeItem('opencognit_token');
      window.location.reload();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setResetting(false);
      setResetConfirm(null);
    }
  };

  // Export/Import state
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ name: string; counts: Record<string, number>; warnings: string[] } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importName, setImportName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (!aktivesUnternehmen) return;
    setExporting(true);
    try {
      const token = localStorage.getItem('opencognit_token');
      const res = await fetch(`/api/unternehmen/${aktivesUnternehmen.id}/export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export fehlgeschlagen: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1]
        ?? `opencognit-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        setImporting(true);
        setImportError(null);
        setImportResult(null);
        const token = localStorage.getItem('opencognit_token');
        // Preview zuerst
        const previewRes = await fetch(`/api/unternehmen/${aktivesUnternehmen!.id}/import/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(json),
        });
        const preview = await previewRes.json();

        // Import ausführen
        const res = await fetch(`/api/unternehmen/${aktivesUnternehmen!.id}/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ manifest: json, options: { collisionStrategy: 'skip', importTasks: true } }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `Import fehlgeschlagen: ${res.status}`);
        setImportResult({
          name: preview.unternehmenName || json.unternehmen?.name || 'Import',
          counts: { agenten: body.agentsImported, aufgaben: body.tasksImported },
          warnings: [...(body.errors || []), ...(preview.collisions || []).map((c: any) => `Collision: ${c.name} (${c.typ})`)],
        });
      } catch (err: any) {
        setImportError(err.message);
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const entries: [string, string][] = [
        ['anthropic_api_key', anthropicKey],
        ['openai_api_key', openaiKey],
        ['openrouter_api_key', openrouterKey],
        ['openrouter_default_model', defaultModel],
        ['ollama_base_url', ollamaUrl],
        ['custom_api_key', customApiKey],
        ['custom_api_base_url', customApiBaseUrl],
        ['budget_pause_threshold', String(budgetPauseThreshold)],
        ['approval_required', String(approvalRequired)],
        ['strategy_approval', String(strategyApproval)],
        ['notify_approvals', String(notifyApprovals)],
        ['notify_budget', String(notifyBudget)],
        ['notify_work_cycle', String(notifyWorkCycle)],
        ['notify_errors', String(notifyErrors)],
        ['telegram_bot_token', telegramBotToken],
        ['telegram_chat_id', telegramChatId],
      ];
      const uId = aktivesUnternehmen?.id || '';
      // Save all settings — check HTTP status for validation errors (e.g. invalid Telegram token)
      for (const [key, wert] of entries) {
        const r = await authFetch(`/api/einstellungen/${key}`, {
          method: 'PUT',
          body: JSON.stringify({ wert, unternehmenId: uId })
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as any;
          throw new Error(body.message || `Fehler beim Speichern von "${key}" (${r.status})`);
        }
      }
      await saveWorkDir();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toastCtx.success(i18n.t.einstellungen.saved, 'API Keys & Einstellungen gespeichert');
    } catch (e: any) {
      setSaveError(e.message || 'Fehler beim Speichern');
      toastCtx.error('Fehler beim Speichern', (e as any)?.message);
    } finally {
      setSaving(false);
    }
  };

  const saveSection = async (sectionId: string, entries: [string, string][], extraFn?: () => Promise<void>) => {
    if (savingSection) return;
    setSavingSection(sectionId);
    try {
      const uId = aktivesUnternehmen?.id || '';
      for (const [key, wert] of entries) {
        const r = await authFetch(`/api/einstellungen/${key}`, {
          method: 'PUT',
          body: JSON.stringify({ wert, unternehmenId: uId }),
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({})) as any;
          throw new Error(body.message || `Fehler beim Speichern von "${key}" (${r.status})`);
        }
      }
      if (extraFn) await extraFn();
      setSavedSection(sectionId);
      setTimeout(() => setSavedSection(s => s === sectionId ? null : s), 2500);
      toastCtx.success(i18n.t.einstellungen.saved, 'Einstellungen gespeichert');
    } catch (e: any) {
      toastCtx.error('Fehler beim Speichern', e.message);
    } finally {
      setSavingSection(null);
    }
  };

  // Reusable mini save button rendered at bottom of each card
  const SectionSaveBtn = ({ id, onClick }: { id: string; onClick: () => void }) => (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <button
        onClick={onClick}
        disabled={!!savingSection}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '0.4375rem 0.875rem', borderRadius: 10, cursor: savingSection ? 'not-allowed' : 'pointer',
          background: savedSection === id ? 'rgba(34,197,94,0.1)' : 'rgba(35,205,202,0.08)',
          border: `1px solid ${savedSection === id ? 'rgba(34,197,94,0.25)' : 'rgba(35,205,202,0.18)'}`,
          color: savedSection === id ? '#22c55e' : '#23CDCB',
          fontWeight: 600, fontSize: '0.8125rem', transition: 'all 0.2s',
          opacity: savingSection && savingSection !== id ? 0.5 : 1,
        }}
      >
        {savingSection === id
          ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Speichern...</>
          : savedSection === id
            ? <><CheckCircle2 size={13} /> Gespeichert</>
            : <><Save size={13} /> Speichern</>
        }
      </button>
    </div>
  );

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
                  {i18n.t.nav.einstellungen}
                </span>
              </div>
              <h1 style={{
                fontSize: '2rem',
                fontWeight: 700,
                background: 'linear-gradient(to bottom right, #23CDCB 0%, #ffffff 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>{i18n.t.einstellungen.title}</h1>
              <p style={{ fontSize: '0.875rem', color: '#71717a', marginTop: '0.25rem' }}>{i18n.t.einstellungen.subtitle}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.375rem' }}>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem 1.25rem',
                  backgroundColor: saved ? 'rgba(34, 197, 94, 0.1)' : 'rgba(35, 205, 202, 0.1)',
                  border: `1px solid ${saved ? 'rgba(34, 197, 94, 0.2)' : 'rgba(35, 205, 202, 0.2)'}`,
                  borderRadius: '12px',
                  color: saved ? '#22c55e' : '#23CDCB',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {saving
                  ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Speichern...</>
                  : saved
                    ? <><CheckCircle2 size={16} /> {i18n.t.einstellungen.saved}</>
                    : <><Save size={16} /> {i18n.language === 'de' ? 'Alle speichern' : 'Save all'}</>
                }
              </button>
              {saveError && <span style={{ fontSize: '0.75rem', color: '#ef4444' }}>{saveError}</span>}
            </div>
          </div>

          <PageHelp id="settings" lang={i18n.language} />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            {/* Allgemein */}
            <div className="glass-card" style={{
              padding: '1.5rem',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px) saturate(160%)',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.09)',
              animation: 'fadeInUp 0.5s ease-out', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <Globe size={18} style={{ color: '#23CDCB' }} />
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{i18n.t.einstellungen.sectionGeneral}</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#d4d4d8', marginBottom: '0.5rem' }}>
                    {i18n.t.einstellungen.language}
                  </label>
                  <Select
                    value={i18n.language}
                    onChange={v => i18n.setLanguage(v as 'de' | 'en')}
                    options={[
                      { value: 'de', label: '🇩🇪 Deutsch' },
                      { value: 'en', label: '🇬🇧 English' },
                    ]}
                    style={{ maxWidth: 300 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#d4d4d8', marginBottom: '0.5rem' }}>
                    {i18n.t.einstellungen.theme}
                  </label>
                  <Select
                    value={theme}
                    onChange={v => setTheme(v as 'dark' | 'light')}
                    options={[
                      { value: 'dark', label: i18n.t.einstellungen.darkMode },
                      { value: 'light', label: i18n.t.einstellungen.lightMode },
                    ]}
                    style={{ maxWidth: 300 }}
                  />
                </div>
              </div>
            </div>

            {/* Claude Code Status */}
            <div className="glass-card" style={{
              padding: '1.5rem',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px) saturate(160%)',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.09)',
              animation: 'fadeInUp 0.5s ease-out 0.05s both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <Terminal size={18} style={{ color: '#23CDCB' }} />
                  <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{i18n.language === 'de' ? 'Claude Code (Pro/Max-Abo)' : 'Claude Code (Pro/Max plan)'}</h2>
                </div>
                <button
                  type="button"
                  onClick={checkClaudeStatus}
                  disabled={claudeStatus.loading}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0.375rem 0.75rem', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.04)', color: '#94a3b8',
                    fontSize: '0.8125rem', cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={13} style={{ animation: claudeStatus.loading ? 'spin 1s linear infinite' : 'none' }} />
                  Aktualisieren
                </button>
              </div>

              {claudeStatus.loading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: '0.875rem' }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Prüfe Status...
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {/* Install status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {claudeStatus.installed ? (
                      <CheckCircle2 size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
                    ) : (
                      <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: '0.875rem', color: claudeStatus.installed ? '#d4d4d8' : '#ef4444' }}>
                      {claudeStatus.installed
                        ? `Claude Code CLI ${i18n.language === 'de' ? 'installiert' : 'installed'} — ${claudeStatus.version}`
                        : (i18n.language === 'de' ? 'Claude Code CLI nicht gefunden' : 'Claude Code CLI not found')}
                    </span>
                  </div>

                  {/* Auth status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {claudeStatus.authenticated ? (
                      <Zap size={16} style={{ color: '#23CDCB', flexShrink: 0 }} />
                    ) : (
                      <AlertCircle size={16} style={{ color: claudeStatus.tokenExpired ? '#f59e0b' : '#64748b', flexShrink: 0 }} />
                    )}
                    <span style={{ fontSize: '0.875rem', color: claudeStatus.authenticated ? '#d4d4d8' : '#94a3b8' }}>
                      {claudeStatus.authenticated
                        ? <>{i18n.language === 'de' ? 'Verbunden' : 'Connected'} · <span style={{
                            fontWeight: 700,
                            color: claudeStatus.subscriptionType === 'max' ? '#23CDCB'
                                 : claudeStatus.subscriptionType === 'pro' ? '#818cf8' : '#94a3b8',
                            textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: 1,
                          }}>{claudeStatus.subscriptionType}</span></>
                        : claudeStatus.tokenExpired
                          ? (i18n.language === 'de' ? 'Session abgelaufen — bitte neu einloggen' : 'Session expired — please log in again')
                          : (i18n.language === 'de' ? 'Nicht eingeloggt' : 'Not logged in')}
                    </span>
                  </div>

                  {/* Not installed / not logged in instructions */}
                  {!claudeStatus.installed && (
                    <div style={{
                      marginTop: 4, padding: '0.875rem 1rem',
                      background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
                      borderRadius: 10, fontSize: '0.8125rem', color: '#fca5a5',
                    }}>
                      <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{i18n.language === 'de' ? 'Installation:' : 'Installation:'}</p>
                      <code style={{ display: 'block', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.3)', borderRadius: 6, fontFamily: 'monospace', color: '#e2e8f0', marginBottom: 8 }}>
                        npm install -g @anthropic-ai/claude-code
                      </code>
                      <p style={{ margin: 0 }}>
                        {i18n.language === 'de'
                          ? <>Danach einmalig <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 6px', borderRadius: 4 }}>claude</code> im Terminal ausführen, um dich einzuloggen.</>
                          : <>Then run <code style={{ background: 'rgba(0,0,0,0.3)', padding: '1px 6px', borderRadius: 4 }}>claude</code> once in your terminal to log in.</>}
                      </p>
                    </div>
                  )}
                  {claudeStatus.installed && !claudeStatus.authenticated && (
                    <div style={{
                      marginTop: 4, padding: '0.875rem 1rem',
                      background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
                      borderRadius: 10, fontSize: '0.8125rem', color: '#fcd34d',
                    }}>
                      <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{i18n.language === 'de' ? 'Einmalig einloggen:' : 'Log in once:'}</p>
                      <code style={{ display: 'block', padding: '0.5rem 0.75rem', background: 'rgba(0,0,0,0.3)', borderRadius: 6, fontFamily: 'monospace', color: '#e2e8f0', marginBottom: 8 }}>claude</code>
                      <p style={{ margin: 0 }}>
                        {i18n.language === 'de'
                          ? 'Führe diesen Befehl in deinem Terminal aus. Es öffnet sich ein Browser um dich einzuloggen. Danach hier auf "Aktualisieren" klicken.'
                          : 'Run this command in your terminal. A browser will open to log you in. Then click "Refresh" here.'}
                      </p>
                    </div>
                  )}
                  {claudeStatus.authenticated && claudeStatus.subscriptionType !== 'max' && claudeStatus.subscriptionType !== 'pro' && (
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#71717a' }}>
                      {i18n.language === 'de'
                        ? '💡 Für Agenten-Aufgaben empfehlen wir das Pro/Max-Abo (kein API-Schlüssel nötig).'
                        : '💡 For agent tasks we recommend a Pro/Max plan (no API key needed).'}
                    </p>
                  )}
                  {claudeStatus.authenticated && (
                    <p style={{ margin: 0, fontSize: '0.8rem', color: '#71717a' }}>
                      {i18n.language === 'de'
                        ? 'Agenten mit Verbindungstyp "Claude Code CLI" nutzen automatisch diesen Account.'
                        : 'Agents with connection type "Claude Code CLI" automatically use this account.'}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Gemini CLI — only shown when installed */}
            {cliStatus?.gemini?.installed && (
              <div className="glass-card" style={{
                padding: '1.5rem',
                background: 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(24px) saturate(160%)',
                borderRadius: '20px',
                border: '1px solid rgba(255,255,255,0.09)',
                animation: 'fadeInUp 0.5s ease-out 0.15s both',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>✨</span>
                  <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>
                    {i18n.language === 'de' ? 'Gemini CLI' : 'Gemini CLI'}
                  </h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2 size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.875rem', color: '#d4d4d8' }}>
                    {i18n.language === 'de' ? 'Gemini CLI installiert' : 'Gemini CLI installed'} — {cliStatus.gemini.version}
                  </span>
                </div>
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: '#71717a' }}>
                  {i18n.language === 'de'
                    ? 'Agenten mit Verbindungstyp "Gemini CLI" nutzen automatisch diesen Account.'
                    : 'Agents with connection type "Gemini CLI" automatically use this account.'}
                </p>
              </div>
            )}

            {/* Codex CLI — only shown when installed */}
            {cliStatus?.codex?.installed && (
              <div className="glass-card" style={{
                padding: '1.5rem',
                background: 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(24px) saturate(160%)',
                borderRadius: '20px',
                border: '1px solid rgba(255,255,255,0.09)',
                animation: 'fadeInUp 0.5s ease-out 0.2s both',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>⚡</span>
                  <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>
                    {i18n.language === 'de' ? 'Codex CLI' : 'Codex CLI'}
                  </h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <CheckCircle2 size={16} style={{ color: '#22c55e', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.875rem', color: '#d4d4d8' }}>
                    {i18n.language === 'de' ? 'Codex CLI installiert' : 'Codex CLI installed'} — {cliStatus.codex.version}
                  </span>
                </div>
                <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: '#71717a' }}>
                  {i18n.language === 'de'
                    ? 'Agenten mit Verbindungstyp "Codex CLI" nutzen automatisch diesen Account.'
                    : 'Agents with connection type "Codex CLI" automatically use this account.'}
                </p>
              </div>
            )}

            {/* API Keys */}
            <div className="glass-card" style={{
              padding: '1.5rem',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px) saturate(160%)',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.09)',
              animation: 'fadeInUp 0.5s ease-out 0.1s both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <Key size={18} style={{ color: '#23CDCB' }} />
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{i18n.t.einstellungen.sectionApiKeys}</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {([
                  { label: 'Anthropic API Key', placeholder: 'sk-ant-api03-...', hint: i18n.t.einstellungen.anthropicHint, type: 'password', value: anthropicKey, onChange: setAnthropicKey },
                  { label: 'OpenAI API Key', placeholder: 'sk-proj-...', hint: i18n.t.einstellungen.openaiHint, type: 'password', value: openaiKey, onChange: setOpenaiKey },
                  { label: 'OpenRouter API Key', placeholder: 'sk-or-v1-...', hint: i18n.t.einstellungen.openrouterHint, type: 'password', value: openrouterKey, onChange: setOpenrouterKey },
                  { label: 'Ollama Base URL', placeholder: 'http://127.0.0.1:11434', hint: i18n.t.einstellungen.ollamaHint, type: 'text', value: ollamaUrl, onChange: setOllamaUrl },
                  { label: 'Custom API Key', placeholder: 'sk-...', hint: 'API Key für beliebige OpenAI-kompatible Anbieter (Groq, Mistral, Together.ai, LM Studio, …)', type: 'password', value: customApiKey, onChange: setCustomApiKey },
                  { label: 'Custom API Base URL', placeholder: 'https://api.groq.com/openai/v1', hint: 'Basis-URL des OpenAI-kompatiblen Endpunkts. Kann pro Agent in verbindungsConfig.baseUrl überschrieben werden.', type: 'text', value: customApiBaseUrl, onChange: setCustomApiBaseUrl },
                ] as const).map(({ label, placeholder, hint, type, value, onChange }) => (
                  <div key={label}>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#d4d4d8', marginBottom: '0.5rem' }}>
                      {label}
                      {value && <span style={{ marginLeft: '0.5rem', fontSize: '0.6875rem', color: '#22c55e', fontWeight: 600 }}>{i18n.t.einstellungen.apiKeySaved}</span>}
                    </label>
                    <input
                      type={type}
                      placeholder={placeholder}
                      value={value}
                      onChange={e => onChange(e.target.value)}
                      autoComplete="new-password"
                      style={{
                        maxWidth: 400,
                        width: '100%',
                        padding: '0.625rem 0.875rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        border: `1px solid ${value ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                        borderRadius: '12px',
                        color: '#ffffff',
                        fontSize: '0.875rem',
                      }}
                    />
                    <p style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '0.375rem' }}>{hint}</p>
                  </div>
                ))}

                {/* Standard-Modell (OpenRouter) — nur anzeigen wenn Key gesetzt */}
                {openrouterKey && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#d4d4d8', marginBottom: '0.5rem' }}>
                      Standard-Modell (OpenRouter)
                      {defaultModel && defaultModel !== 'openrouter/auto' && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.6875rem', color: '#22c55e', fontWeight: 600 }}>✓ Gesetzt</span>
                      )}
                    </label>
                    <select
                      value={defaultModel}
                      onChange={e => setDefaultModel(e.target.value)}
                      disabled={loadingOrModels}
                      style={{
                        maxWidth: 400,
                        width: '100%',
                        padding: '0.625rem 0.875rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        border: `1px solid ${defaultModel && defaultModel !== 'openrouter/auto' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(255, 255, 255, 0.1)'}`,
                        borderRadius: '12px',
                        color: '#ffffff',
                        fontSize: '0.875rem',
                        cursor: loadingOrModels ? 'wait' : 'pointer',
                        appearance: 'none' as const,
                        WebkitAppearance: 'none' as const,
                      }}
                    >
                      <option value="openrouter/auto" style={{ backgroundColor: '#18181b', color: '#ffffff' }}>
                        {loadingOrModels ? '⏳ Lade Modelle...' : '🤖 Auto Router (Standard)'}
                      </option>
                      {orModels.map(m => (
                        <option key={m.id} value={m.id} style={{ backgroundColor: '#18181b', color: '#ffffff' }}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <p style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '0.375rem' }}>
                      Wird verwendet wenn ein Agent kein spezifisches Modell konfiguriert hat.
                    </p>
                  </div>
                )}
              </div>
              <SectionSaveBtn id="api" onClick={() => saveSection('api', [
                ['anthropic_api_key', anthropicKey],
                ['openai_api_key', openaiKey],
                ['openrouter_api_key', openrouterKey],
                ['openrouter_default_model', defaultModel],
                ['ollama_base_url', ollamaUrl],
                ['custom_api_key', customApiKey],
                ['custom_api_base_url', customApiBaseUrl],
              ])} />
            </div>

            {/* Budget & Kontrolle */}
            <div className="glass-card" style={{
              padding: '1.5rem',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px) saturate(160%)',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.09)',
              animation: 'fadeInUp 0.5s ease-out 0.2s both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <Shield size={18} style={{ color: '#eab308' }} />
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{i18n.t.einstellungen.sectionBudget}</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#d4d4d8', marginBottom: '0.5rem' }}>
                    {i18n.t.einstellungen.budgetAutoPause}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input
                      type="range" min="50" max="100"
                      value={budgetPauseThreshold}
                      onChange={e => setBudgetPauseThreshold(Number(e.target.value))}
                      style={{ flex: 1, maxWidth: 300, cursor: 'pointer', accentColor: '#23CDCB' }}
                    />
                    <span style={{
                      padding: '0.25rem 0.625rem',
                      backgroundColor: 'rgba(35, 205, 202, 0.1)',
                      border: '1px solid rgba(35, 205, 202, 0.2)',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      color: '#23CDCB',
                      fontWeight: 600,
                      minWidth: '3rem',
                      textAlign: 'center',
                    }}>{budgetPauseThreshold}%</span>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '0.375rem' }}>
                    {i18n.t.einstellungen.budgetAutoPauseHint}
                  </p>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#d4d4d8', marginBottom: '0.5rem' }}>
                    {i18n.t.einstellungen.approvalRequired}
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={approvalRequired} onChange={e => setApprovalRequired(e.target.checked)} style={{ accentColor: '#23CDCB' }} />
                    <span style={{ fontSize: '0.875rem', color: '#d4d4d8' }}>{i18n.t.einstellungen.approvalRequiredHint}</span>
                  </label>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#d4d4d8', marginBottom: '0.5rem' }}>
                    {i18n.t.einstellungen.strategyApproval}
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={strategyApproval} onChange={e => setStrategyApproval(e.target.checked)} style={{ accentColor: '#23CDCB' }} />
                    <span style={{ fontSize: '0.875rem', color: '#d4d4d8' }}>{i18n.t.einstellungen.strategyApprovalHint}</span>
                  </label>
                </div>
              </div>
              <SectionSaveBtn id="budget" onClick={() => saveSection('budget', [
                ['budget_pause_threshold', String(budgetPauseThreshold)],
                ['approval_required', String(approvalRequired)],
                ['strategy_approval', String(strategyApproval)],
              ])} />
            </div>

            {/* Benachrichtigungen */}
            <div className="glass-card" style={{
              padding: '1.5rem',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px) saturate(160%)',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.09)',
              animation: 'fadeInUp 0.5s ease-out 0.3s both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <Bell size={18} style={{ color: '#3b82f6' }} />
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{i18n.t.einstellungen.sectionNotifications}</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {([
                  { key: 'notifyApprovals', value: notifyApprovals, setter: setNotifyApprovals },
                  { key: 'notifyBudget', value: notifyBudget, setter: setNotifyBudget },
                  { key: 'notifyWorkCycle', value: notifyWorkCycle, setter: setNotifyWorkCycle },
                  { key: 'notifyErrors', value: notifyErrors, setter: setNotifyErrors },
                ] as const).map(({ key, value, setter }) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="checkbox" checked={value} onChange={e => setter(e.target.checked)} style={{ accentColor: '#23CDCB' }} />
                    <span style={{ fontSize: '0.875rem', color: '#d4d4d8' }}>{i18n.t.einstellungen[key as keyof typeof i18n.t.einstellungen] as string}</span>
                  </label>
                ))}
              </div>
              <SectionSaveBtn id="notify" onClick={() => saveSection('notify', [
                ['notify_approvals', String(notifyApprovals)],
                ['notify_budget', String(notifyBudget)],
                ['notify_work_cycle', String(notifyWorkCycle)],
                ['notify_errors', String(notifyErrors)],
              ])} />
            </div>

            {/* Projekt-Arbeitsverzeichnis */}
            {aktivesUnternehmen && (
              <div className="glass-card" style={{
                padding: '1.5rem',
                background: 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(24px) saturate(160%)',
                borderRadius: '20px',
                border: workDirStatus?.writable ? '1px solid rgba(34,197,94,0.3)' : workDirStatus?.exists === false ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
                animation: 'fadeInUp 0.5s ease-out 0.35s both',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <FolderOpen size={18} style={{ color: '#f59e0b' }} />
                  <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>
                    {i18n.t.einstellungen.sectionWorkDir}
                  </h2>
                </div>
                <p style={{ fontSize: '0.8125rem', color: '#71717a', marginBottom: '1rem' }}>
                  {i18n.t.einstellungen.workDirDesc}
                </p>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    value={workDir}
                    onChange={e => { setWorkDir(e.target.value); setWorkDirStatus(null); }}
                    placeholder="/home/user/CODING/MyProject"
                    style={{
                      flex: 1,
                      padding: '0.625rem 0.875rem',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '10px',
                      fontSize: '0.875rem',
                      color: '#ffffff',
                      fontFamily: 'monospace',
                      outline: 'none',
                    }}
                    onKeyDown={e => e.key === 'Enter' && checkWorkDir(workDir)}
                  />
                  <button
                    onClick={() => checkWorkDir(workDir)}
                    disabled={checkingWorkDir || !workDir.trim()}
                    style={{
                      padding: '0.625rem 1rem',
                      background: 'rgba(245,158,11,0.1)',
                      border: '1px solid rgba(245,158,11,0.3)',
                      borderRadius: '10px',
                      color: '#f59e0b',
                      fontWeight: 600,
                      fontSize: '0.8125rem',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {checkingWorkDir ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : i18n.t.einstellungen.workDirCheck}
                  </button>
                  <button
                    onClick={openFolder}
                    disabled={openingFolder || !workDir.trim()}
                    title="Ordner im Dateimanager öffnen"
                    style={{
                      padding: '0.625rem 1rem',
                      background: 'rgba(35, 205, 203, 0.1)',
                      border: '1px solid rgba(35, 205, 203, 0.3)',
                      borderRadius: '10px',
                      color: '#23CDCB',
                      fontWeight: 600,
                      fontSize: '0.8125rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {openingFolder ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FolderOpen size={14} />}
                    Öffnen
                  </button>
                </div>
                {workDirStatus && (
                  <div style={{
                    marginTop: '0.625rem',
                    padding: '0.5rem 0.875rem',
                    borderRadius: '8px',
                    fontSize: '0.8125rem',
                    background: workDirStatus.writable ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                    color: workDirStatus.writable ? '#22c55e' : '#ef4444',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}>
                    {workDirStatus.writable ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    {workDirStatus.writable
                      ? i18n.t.einstellungen.workDirOk
                      : (workDirStatus.error || i18n.t.einstellungen.workDirFail)}
                  </div>
                )}
                <p style={{ fontSize: '0.75rem', color: '#52525b', marginTop: '0.75rem' }}>
                  {i18n.t.einstellungen.workDirHint}
                </p>
              <SectionSaveBtn id="workspace" onClick={() => saveSection('workspace', [], saveWorkDir)} />
              </div>
            )}

            {/* Integrationen */}
            <div className="glass-card" style={{
              padding: '1.5rem',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px) saturate(160%)',
              borderRadius: '20px',
              border: (telegramBotToken && telegramChatId) ? '1px solid rgba(0, 136, 204, 0.3)' : '1px solid rgba(255, 255, 255, 0.08)',
              animation: 'fadeInUp 0.5s ease-out 0.38s both',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Blue top glow */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: 'linear-gradient(90deg, transparent, #0088cc, transparent)' }} />
              
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div style={{ 
                    width: '32px', height: '32px', borderRadius: '8px', 
                    background: 'rgba(0, 136, 204, 0.1)', display: 'flex', 
                    alignItems: 'center', justifyContent: 'center' 
                  }}>
                    <Globe size={18} style={{ color: '#0088cc' }} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>
                      {i18n.t.einstellungen.sectionTelegram}
                    </h2>
                    <p style={{ fontSize: '0.75rem', color: '#71717a' }}>{i18n.t.einstellungen.telegramDesc}</p>
                  </div>
                </div>

                <button
                  onClick={async () => {
                    if (!aktivesUnternehmen || testSending) return;
                    setTestSending(true);
                    try {
                      const res = await authFetch('/api/test/telegram', {
                        method: 'POST',
                        body: JSON.stringify({ unternehmenId: aktivesUnternehmen.id })
                      });
                      if (res.ok) alert('✅ Test-Nachricht gesendet! Prüfe dein Telegram.');
                      else throw new Error('Senden fehlgeschlagen');
                    } catch (e: any) {
                      alert('❌ Fehler: ' + e.message);
                    } finally { setTestSending(false); }
                  }}
                  disabled={!telegramBotToken || !telegramChatId || testSending}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '10px',
                    background: 'rgba(0, 136, 204, 0.1)',
                    border: '1px solid rgba(0, 136, 204, 0.2)',
                    color: '#0088cc',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: (testSending || !telegramBotToken) ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'all 0.2s',
                    opacity: (!telegramBotToken || !telegramChatId) ? 0.5 : 1
                  }}
                >
                  {testSending ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                  {i18n.t.einstellungen.telegramTest}
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#d4d4d8', marginBottom: '0.5rem' }}>
                      Bot Token
                    </label>
                    <input
                      type="password"
                      placeholder="548239...:AAH_..."
                      value={telegramBotToken}
                      onChange={e => setTelegramBotToken(e.target.value)}
                      style={{
                        width: '100%', padding: '0.625rem 0.875rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', color: '#ffffff', fontSize: '0.875rem',
                        outline: 'none', transition: 'border-color 0.2s'
                      }}
                    />
                    <p style={{ fontSize: '0.725rem', color: '#71717a', marginTop: '0.5rem' }}>
                      Erstelle einen Bot über <a href="https://t.me/botfather" target="_blank" rel="noreferrer" style={{ color: '#0088cc', textDecoration: 'none' }}>@BotFather</a>.
                    </p>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, color: '#d4d4d8', marginBottom: '0.5rem' }}>
                      Chat ID
                    </label>
                    <input
                      placeholder="123456789"
                      value={telegramChatId}
                      onChange={e => setTelegramChatId(e.target.value)}
                      style={{
                        width: '100%', padding: '0.625rem 0.875rem',
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '12px', color: '#ffffff', fontSize: '0.875rem',
                        outline: 'none'
                      }}
                    />
                    <p style={{ fontSize: '0.725rem', color: '#71717a', marginTop: '0.5rem' }}>
                      Finde deine ID über <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" style={{ color: '#0088cc', textDecoration: 'none' }}>@userinfobot</a>.
                    </p>
                  </div>
                </div>

                {aktivesUnternehmen && (
                  <div style={{
                    padding: '1rem', borderRadius: '14px', 
                    background: 'linear-gradient(135deg, rgba(0,136,204,0.08) 0%, rgba(0,136,204,0.03) 100%)', 
                    border: '1px solid rgba(0,136,204,0.15)',
                    fontSize: '0.75rem', color: '#d4d4d8'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <AlertCircle size={14} style={{ color: '#0088cc' }} />
                      <strong style={{ color: '#ffffff' }}>Webhook URL (Optional)</strong>
                    </div>
                    <div style={{ 
                      background: 'rgba(0,0,0,0.2)', padding: '0.5rem', 
                      borderRadius: '8px', fontFamily: 'monospace', color: '#0088cc',
                      wordBreak: 'break-all', marginBottom: '0.5rem'
                    }}>
                      {window.location.origin}/api/webhooks/telegram/{aktivesUnternehmen.id}
                    </div>
                    <p style={{ fontSize: '0.6875rem', lineHeight: 1.4, color: '#71717a' }}>
                      Nutze diese URL zum Empfangen von Nachrichten, falls der Polling-Modus des Servers deaktiviert ist.
                    </p>
                  </div>
                )}

                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.75rem', borderRadius: '12px', background: 'rgba(35, 205, 202, 0.05)',
                  border: '1px solid rgba(35, 205, 202, 0.1)'
                }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 10px #22c55e' }} />
                  <span style={{ fontSize: '0.75rem', fontWeight: 500, color: '#d4d4d8' }}>
                    Gateway Status: <span style={{ color: '#22c55e' }}>Aktiv</span>
                  </span>
                </div>
              </div>
              <SectionSaveBtn id="telegram" onClick={() => saveSection('telegram', [
                ['telegram_bot_token', telegramBotToken],
                ['telegram_chat_id', telegramChatId],
              ])} />
            </div>

            {/* Datenbank */}
            <div className="glass-card" style={{
              padding: '1.5rem',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px) saturate(160%)',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.09)',
              animation: 'fadeInUp 0.5s ease-out 0.4s both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <Database size={18} style={{ color: '#22c55e' }} />
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>{i18n.t.einstellungen.sectionDatabase}</h2>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                  <span style={{ color: '#71717a' }}>{i18n.t.einstellungen.dbType}</span>
                  <span style={{
                    padding: '0.25rem 0.625rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    borderRadius: '9999px',
                    fontSize: '0.75rem',
                    color: '#d4d4d8',
                  }}>SQLite (Local)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                  <span style={{ color: '#71717a' }}>{i18n.t.einstellungen.dbPath}</span>
                  <code style={{ fontSize: '0.75rem', color: '#71717a' }}>data/opencognit.db</code>
                </div>
                {aktivesUnternehmen && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                    <span style={{ color: '#71717a' }}>{i18n.t.einstellungen.dbActiveCompany}</span>
                    <span style={{ color: '#d4d4d8' }}>{aktivesUnternehmen.name}</span>
                  </div>
                )}
                <div style={{ paddingTop: '0.75rem', marginTop: '0.75rem', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <button style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 0.875rem',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    border: '1px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: '12px',
                    color: '#ef4444',
                    fontWeight: 500,
                    fontSize: '0.8125rem',
                    cursor: 'pointer',
                  }}>
                    <RotateCcw size={14} /> {i18n.t.einstellungen.dbReset}
                  </button>
                  <p style={{ fontSize: '0.75rem', color: '#71717a', marginTop: '0.5rem' }}>
                    {i18n.t.einstellungen.dbResetHint}
                  </p>
                </div>
              </div>
            </div>

            {/* Export / Import */}
            <div className="glass-card" style={{
              padding: '1.5rem',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px) saturate(160%)',
              borderRadius: '20px',
              border: '1px solid rgba(255,255,255,0.09)',
              animation: 'fadeInUp 0.5s ease-out 0.45s both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <Download size={18} style={{ color: '#8b5cf6' }} />
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ffffff' }}>
                  {i18n.t.einstellungen.sectionExport ?? 'Export / Import'}
                </h2>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Export */}
                <div style={{
                  padding: '1rem 1.25rem', borderRadius: '14px',
                  background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.2)',
                }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#c4b5fd', marginBottom: '0.375rem' }}>
                    {i18n.t.einstellungen.exportTitle ?? 'Unternehmen exportieren'}
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '0.875rem' }}>
                    {i18n.t.einstellungen.exportHint ?? 'Exportiert alle Daten (Experten, Aufgaben, Projekte, Routinen) als JSON. API Keys werden nicht mitexportiert.'}
                  </p>
                  <button
                    onClick={handleExport}
                    disabled={exporting || !aktivesUnternehmen}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.5rem 1rem', borderRadius: '10px',
                      background: exporting ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.15)',
                      border: '1px solid rgba(139,92,246,0.3)',
                      color: '#c4b5fd', cursor: exporting ? 'not-allowed' : 'pointer',
                      fontSize: '0.8125rem', fontWeight: 600, transition: 'all 0.2s',
                    }}
                  >
                    {exporting
                      ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Exportiere...</>
                      : <><Download size={14} /> {i18n.t.einstellungen.exportButton ?? 'Als JSON herunterladen'}</>
                    }
                  </button>
                </div>

                {/* Import */}
                <div style={{
                  padding: '1rem 1.25rem', borderRadius: '14px',
                  background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)',
                }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#93c5fd', marginBottom: '0.375rem' }}>
                    {i18n.t.einstellungen.importTitle ?? 'Unternehmen importieren'}
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#71717a', marginBottom: '0.875rem' }}>
                    {i18n.t.einstellungen.importHint ?? 'Lädt eine JSON-Exportdatei und erstellt ein neues Unternehmen. Alle IDs werden neu vergeben.'}
                  </p>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                    <input
                      placeholder={i18n.t.einstellungen.importNamePlaceholder ?? 'Neuer Unternehmensname (optional)'}
                      value={importName}
                      onChange={e => setImportName(e.target.value)}
                      style={{
                        maxWidth: 360, padding: '0.5rem 0.75rem', borderRadius: '10px',
                        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#ffffff', fontSize: '0.875rem',
                      }}
                    />
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: 'none' }}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) handleImportFile(f);
                        }}
                      />
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={importing}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                          padding: '0.5rem 1rem', borderRadius: '10px',
                          background: importing ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.15)',
                          border: '1px solid rgba(59,130,246,0.3)',
                          color: '#93c5fd', cursor: importing ? 'not-allowed' : 'pointer',
                          fontSize: '0.8125rem', fontWeight: 600, transition: 'all 0.2s',
                        }}
                      >
                        {importing
                          ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Importiere...</>
                          : <><Upload size={14} /> {i18n.t.einstellungen.importButton ?? 'JSON-Datei auswählen'}</>
                        }
                      </button>
                    </div>
                  </div>

                  {/* Import Ergebnis */}
                  {importResult && (
                    <div style={{
                      marginTop: '0.875rem', padding: '0.875rem', borderRadius: '12px',
                      background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: '#22c55e', fontWeight: 600, fontSize: '0.8125rem' }}>
                        <CheckCircle2 size={14} />
                        {i18n.t.einstellungen.importSuccess ?? 'Import erfolgreich!'} — „{importResult.name}"
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#71717a' }}>
                        {Object.entries(importResult.counts)
                          .filter(([, v]) => v > 0)
                          .map(([k, v]) => `${v} ${k}`)
                          .join(' · ')}
                      </div>
                      {importResult.warnings.length > 0 && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#eab308' }}>
                          {importResult.warnings.length} Warnung(en): {importResult.warnings[0]}
                          {importResult.warnings.length > 1 && ` (+${importResult.warnings.length - 1} weitere)`}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Import Fehler */}
                  {importError && (
                    <div style={{
                      marginTop: '0.875rem', padding: '0.75rem', borderRadius: '10px',
                      background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                      display: 'flex', alignItems: 'flex-start', gap: '0.5rem',
                      color: '#ef4444', fontSize: '0.8125rem',
                    }}>
                      <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                      {importError}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="glass-card" style={{
              padding: '1.5rem',
              backgroundColor: 'rgba(239, 68, 68, 0.03)',
              backdropFilter: 'blur(24px) saturate(160%)',
              borderRadius: '20px',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              animation: 'fadeInUp 0.5s ease-out 0.55s both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                <AlertTriangle size={18} style={{ color: '#ef4444' }} />
                <h2 style={{ fontSize: '1rem', fontWeight: 600, color: '#ef4444' }}>Danger Zone</h2>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Company Reset */}
                <div style={{
                  padding: '1rem 1.25rem', borderRadius: '14px',
                  background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)',
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#fca5a5', marginBottom: '0.25rem' }}>
                      Unternehmen zurücksetzen
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#71717a', margin: 0 }}>
                      Löscht alle Agenten, Aufgaben, Zyklen und Kosten von „{aktivesUnternehmen?.name}". API Keys bleiben erhalten.
                    </p>
                  </div>
                  {resetConfirm === 'company' ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: '#fca5a5' }}>Sicher?</span>
                      <button
                        onClick={handleCompanyReset}
                        disabled={resetting}
                        style={{
                          padding: '0.375rem 0.75rem', borderRadius: '8px', cursor: 'pointer',
                          background: 'rgba(239,68,68,0.2)', border: '1px solid rgba(239,68,68,0.4)',
                          color: '#ef4444', fontSize: '0.75rem', fontWeight: 600,
                        }}
                      >
                        {resetting ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : 'Ja, zurücksetzen'}
                      </button>
                      <button
                        onClick={() => setResetConfirm(null)}
                        style={{
                          padding: '0.375rem 0.75rem', borderRadius: '8px', cursor: 'pointer',
                          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                          color: '#71717a', fontSize: '0.75rem',
                        }}
                      >Abbrechen</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setResetConfirm('company')}
                      disabled={!aktivesUnternehmen}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.375rem',
                        padding: '0.5rem 0.875rem', borderRadius: '10px', cursor: 'pointer',
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                        color: '#ef4444', fontSize: '0.8125rem', fontWeight: 600, whiteSpace: 'nowrap',
                      }}
                    >
                      <RotateCcw size={13} /> Zurücksetzen
                    </button>
                  )}
                </div>

                {/* Factory Reset */}
                <div style={{
                  padding: '1rem 1.25rem', borderRadius: '14px',
                  background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.25)',
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
                }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#fca5a5', marginBottom: '0.25rem' }}>
                      Komplett-Reset (Factory Reset)
                    </div>
                    <p style={{ fontSize: '0.75rem', color: '#71717a', margin: 0 }}>
                      Löscht alle Unternehmen, Agenten und Daten. Das Onboarding startet neu. Benutzer-Account und API Keys bleiben erhalten.
                    </p>
                  </div>
                  {resetConfirm === 'factory' ? (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: '#fca5a5' }}>Alles löschen?</span>
                      <button
                        onClick={handleFactoryReset}
                        disabled={resetting}
                        style={{
                          padding: '0.375rem 0.75rem', borderRadius: '8px', cursor: 'pointer',
                          background: 'rgba(239,68,68,0.25)', border: '1px solid rgba(239,68,68,0.5)',
                          color: '#ef4444', fontSize: '0.75rem', fontWeight: 700,
                        }}
                      >
                        {resetting ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : 'Ja, alles löschen'}
                      </button>
                      <button
                        onClick={() => setResetConfirm(null)}
                        style={{
                          padding: '0.375rem 0.75rem', borderRadius: '8px', cursor: 'pointer',
                          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                          color: '#71717a', fontSize: '0.75rem',
                        }}
                      >Abbrechen</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setResetConfirm('factory')}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.375rem',
                        padding: '0.5rem 0.875rem', borderRadius: '10px', cursor: 'pointer',
                        background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)',
                        color: '#ef4444', fontSize: '0.8125rem', fontWeight: 700, whiteSpace: 'nowrap',
                      }}
                    >
                      <Trash2 size={13} /> Factory Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Version */}
            <div className="glass-card" style={{
              padding: '1rem 1.5rem',
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(24px) saturate(160%)',
              borderRadius: '16px',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              opacity: 0.6,
              animation: 'fadeInUp 0.5s ease-out 0.5s both',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.8125rem' }}>
                <span style={{ color: '#71717a' }}>OpenCognit v0.1.0</span>
                <span style={{ color: '#71717a' }}>{i18n.t.einstellungen.madeWith}</span>
              </div>
            </div>
          </div>
      </div>
    </>
  );
}
