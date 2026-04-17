import React, { useState, useMemo } from 'react';
import { Building2, Key, Users, Rocket, ChevronRight, ChevronLeft, Package, MessageSquare, Check, Sparkles, Bot, Loader2, Globe } from 'lucide-react';
import { useI18n } from '../i18n';
import { authFetch } from '../utils/api';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Template { name: string; beschreibung: string; version: string; agentCount: number; }

const STEPS = 6;

// ─── Hilfsfunktionen ────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '0.8rem 1rem', boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '12px', color: '#fff', fontSize: '0.9rem', outline: 'none',
  transition: 'all 0.2s',
};

const focus = {
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    e.target.style.borderColor = 'rgba(35,205,202,0.5)';
    e.target.style.boxShadow = '0 0 0 3px rgba(35,205,202,0.08)';
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    e.target.style.borderColor = 'rgba(255,255,255,0.08)';
    e.target.style.boxShadow = 'none';
  },
};

// ─── Wizard ─────────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const { t, language, setLanguage } = useI18n();
  const de = language === 'de';

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const particles = useMemo(() =>
    [...Array(30)].map((_, i) => ({
      id: i,
      size: 2 + Math.random() * 4,
      opacity: 0.15 + Math.random() * 0.4,
      top: Math.random() * 100,
      left: Math.random() * 100,
      glow: 4 + Math.random() * 6,
      duration: 6 + Math.random() * 8,
      delay: Math.random() * 5,
    }))
  , []);

  // Step 1: Goal description (pre-fills AI team generation in step 4)
  const [goalDescription, setGoalDescription] = useState('');

  // Step 2: Company
  const [companyName, setCompanyName] = useState('');
  const [companyGoal, setCompanyGoal] = useState('');
  const [companyDesc, setCompanyDesc] = useState('');
  const [workDir, setWorkDir] = useState('');

  // Step 3: API Keys
  const [keys, setKeys] = useState({ openrouter: '', anthropic: '', openai: '', ollama: 'http://localhost:11434', customBase: '', customKey: '' });
  const [llmTab, setLlmTab] = useState<'cloud' | 'local' | 'custom'>('cloud');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaDetecting, setOllamaDetecting] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<'idle' | 'found' | 'error'>('idle');
  const [selectedOllamaModel, setSelectedOllamaModel] = useState<string | null>(null);
  const hasKey = !!(keys.openrouter || keys.anthropic || keys.openai || keys.customKey || (ollamaStatus === 'found'));

  const detectOllama = async () => {
    setOllamaDetecting(true);
    setOllamaStatus('idle');
    try {
      const url = keys.ollama.trim() || 'http://localhost:11434';
      const res = await fetch(`${url}/api/tags`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const models: string[] = (data.models || []).map((m: any) => m.name);
      setOllamaModels(models);
      setOllamaStatus(models.length > 0 ? 'found' : 'error');
      if (!keys.ollama.trim()) setKeys(k => ({ ...k, ollama: url }));
    } catch {
      setOllamaStatus('error');
      setOllamaModels([]);
    } finally {
      setOllamaDetecting(false);
    }
  };

  // Step 4: Team
  const [teamMode, setTeamMode] = useState<'clipmart' | 'manual' | 'ai' | null>(null);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templatesError, setTemplatesError] = useState(false);

  // Step 4: AI Magic Setup — pre-filled from step 1 goal description
  const [aiDescription, setAiDescription] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiPlan, setAiPlan] = useState<any>(null);
  const [aiSource, setAiSource] = useState<'ai' | 'default' | null>(null);
  const [aiGenError, setAiGenError] = useState<string | null>(null);

  // Which LLM will be used for team generation — shown as info badge
  const generationModel = (() => {
    if (keys.openrouter) return { label: 'openrouter/auto', provider: 'OpenRouter' };
    if (keys.anthropic) return { label: 'claude-3-5-haiku', provider: 'Anthropic' };
    if (keys.openai) return { label: 'gpt-4o-mini', provider: 'OpenAI' };
    if (ollamaStatus === 'found' && selectedOllamaModel) return { label: selectedOllamaModel, provider: 'Ollama' };
    if (ollamaStatus === 'found' && !selectedOllamaModel) return { label: null, provider: 'Ollama (kein Modell gewählt)' };
    return null;
  })();

  const generateAiTeam = async () => {
    if (!aiDescription.trim() || aiGenerating) return;
    setAiGenerating(true);
    setAiGenError(null);
    setAiPlan(null);
    try {
      const res = await authFetch('/api/onboarding/generate-team', {
        method: 'POST',
        body: JSON.stringify({
          businessDescription: aiDescription,
          language,
          apiKeys: {
            openrouter: keys.openrouter,
            anthropic: keys.anthropic,
            openai: keys.openai,
            ollamaUrl: ollamaStatus === 'found' ? keys.ollama : '',
            ollamaModel: selectedOllamaModel || '',
          },
        }),
      });
      const data = await res.json();
      setAiPlan(data.team);
      setAiSource(data.source);
    } catch (e: any) {
      setAiGenError(e.message || 'Generation failed');
    }
    setAiGenerating(false);
  };

  // Step 5: Channels
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramBot, setTelegramBot] = useState<{ username: string; firstName: string } | null>(null);
  const [telegramVerifying, setTelegramVerifying] = useState(false);
  const [telegramVerifyError, setTelegramVerifyError] = useState<string | null>(null);
  const [telegramDetecting, setTelegramDetecting] = useState(false);

  const verifyTelegramToken = async () => {
    if (!telegramToken.trim() || telegramVerifying) return;
    setTelegramVerifying(true);
    setTelegramVerifyError(null);
    setTelegramBot(null);
    try {
      const res = await fetch(`https://api.telegram.org/bot${telegramToken.trim()}/getMe`);
      const data = await res.json();
      if (data.ok) {
        setTelegramBot({ username: data.result.username, firstName: data.result.first_name });
      } else {
        setTelegramVerifyError(data.description || 'Invalid token');
      }
    } catch {
      setTelegramVerifyError('Network error — check your connection');
    }
    setTelegramVerifying(false);
  };

  const detectTelegramChatId = async () => {
    if (!telegramToken.trim() || telegramDetecting) return;
    setTelegramDetecting(true);
    try {
      const res = await fetch(`https://api.telegram.org/bot${telegramToken.trim()}/getUpdates?limit=10`);
      const data = await res.json();
      if (data.ok && data.result?.length > 0) {
        const update = data.result[data.result.length - 1];
        const chatId = update.message?.chat?.id ?? update.channel_post?.chat?.id ?? update.my_chat_member?.chat?.id;
        if (chatId !== undefined) setTelegramChatId(String(chatId));
      }
    } catch { /* ignore */ }
    setTelegramDetecting(false);
  };

  const loadTemplates = async () => {
    if (templatesLoaded) return;
    setTemplatesError(false);
    try {
      const res = await authFetch('/api/clipmart/templates');
      const data = await res.json();
      setTemplates(data);
    } catch {
      setTemplatesError(true);
    }
    setTemplatesLoaded(true);
  };

  const next = () => {
    setError(null);
    // Pre-fill AI description from step 1 goal when entering step 4
    if (step === 3 && goalDescription.trim() && !aiDescription.trim()) {
      setAiDescription(goalDescription.trim());
    }
    if (step === 4 && !templatesLoaded) loadTemplates();
    setStep(s => Math.min(s + 1, STEPS));
  };
  const prev = () => { setError(null); setStep(s => Math.max(s - 1, 1)); };

  // ─── Finish: Alles erstellen ────────────────────────────────────────────

  const handleFinish = async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Firma erstellen (use goalDescription as fallback for company goal)
      const companyRes = await authFetch('/api/unternehmen', {
        method: 'POST',
        body: JSON.stringify({ name: companyName, beschreibung: companyDesc || null, ziel: companyGoal || goalDescription || null, workDir: workDir.trim() || null }),
      });
      if (!companyRes.ok) throw new Error(de ? 'Firma konnte nicht erstellt werden' : 'Could not create company');
      const company = await companyRes.json();

      // 2. API Keys speichern
      const keyMap: [string, string][] = [
        ['openrouter_api_key', keys.openrouter],
        ['anthropic_api_key', keys.anthropic],
        ['openai_api_key', keys.openai],
        ['ollama_base_url', keys.ollama],
        ['custom_api_key', keys.customKey],
        ['custom_api_base_url', keys.customBase],
      ];
      if (selectedOllamaModel) keyMap.push(['ollama_default_model', selectedOllamaModel]);
      for (const [k, v] of keyMap) {
        if (v.trim()) {
          await authFetch(`/api/einstellungen/${k}`, { method: 'PUT', body: JSON.stringify({ wert: v.trim() }) });
        }
      }

      // 3. Team importieren
      if (teamMode === 'clipmart' && selectedTemplate) {
        await authFetch(`/api/unternehmen/${company.id}/clipmart/import`, {
          method: 'POST',
          body: JSON.stringify({ templateName: selectedTemplate }),
        });
      }

      // 3b. AI Magic: Agenten aus Plan erstellen
      if (teamMode === 'ai' && aiPlan?.agents?.length > 0) {
        const colors = ['#23CDCA', '#7C3AED', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
        for (let i = 0; i < aiPlan.agents.length; i++) {
          const agent = aiPlan.agents[i];
          await authFetch(`/api/unternehmen/${company.id}/experten`, {
            method: 'POST',
            body: JSON.stringify({
              name: agent.name,
              rolle: agent.rolle,
              faehigkeiten: agent.faehigkeiten || '',
              verbindungsTyp: agent.verbindungsTyp || 'openrouter',
              verbindungsConfig: agent.verbindungsConfig || null,
              zyklusIntervallSek: agent.zyklusIntervallSek || 300,
              systemPrompt: agent.systemPromptHint || null,
              isOrchestrator: i === 0, // First agent = orchestrator
              avatarFarbe: colors[i % colors.length],
            }),
          });
        }
        // Update company goal if AI provided one
        if (aiPlan.companyGoal) {
          await authFetch(`/api/unternehmen/${company.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ ziel: aiPlan.companyGoal }),
          });
        }
      }

      // 4. Channels konfigurieren
      if (telegramToken.trim()) {
        await authFetch(`/api/einstellungen/telegram_bot_token`, {
          method: 'PUT', body: JSON.stringify({ wert: telegramToken.trim(), unternehmenId: company.id }),
        });
      }
      if (telegramChatId.trim()) {
        await authFetch(`/api/einstellungen/telegram_chat_id`, {
          method: 'PUT', body: JSON.stringify({ wert: telegramChatId.trim(), unternehmenId: company.id }),
        });
      }

      // Done — reload
      window.location.reload();
    } catch (e: any) {
      setError(e.message || 'Error');
      setLoading(false);
    }
  };

  // ─── Step Definitionen ──────────────────────────────────────────────────

  const steps = [
    { icon: Sparkles, label: de ? 'Willkommen' : 'Welcome' },
    { icon: Building2, label: de ? 'Firma' : 'Company' },
    { icon: Key, label: de ? 'API Keys' : 'API Keys' },
    { icon: Users, label: de ? 'Team' : 'Team' },
    { icon: MessageSquare, label: de ? 'Channels' : 'Channels' },
    { icon: Rocket, label: de ? 'Start' : 'Launch' },
  ];

  // Quick-start: skip the rest of onboarding, create minimal company and go
  const [skipping, setSkipping] = useState(false);
  const handleQuickStart = async () => {
    setSkipping(true);
    setError(null);
    try {
      const name = companyName.trim() || (de ? 'Mein Workspace' : 'My Workspace');
      const companyRes = await authFetch('/api/unternehmen', {
        method: 'POST',
        body: JSON.stringify({ name, beschreibung: null, ziel: goalDescription.trim() || null }),
      });
      if (!companyRes.ok) throw new Error(de ? 'Firma konnte nicht erstellt werden' : 'Could not create company');
      window.location.reload();
    } catch (e: any) {
      setError(e.message || 'Error');
      setSkipping(false);
    }
  };

  const canNext = () => {
    if (step === 1) return true; // goal description is optional
    if (step === 2) return companyName.trim().length > 0;
    if (step === 3) return true; // Keys optional
    if (step === 4) return (
      teamMode !== null &&
      (teamMode !== 'ai' || !!aiPlan) &&
      (teamMode !== 'clipmart' || !!selectedTemplate)
    );
    return true;
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#000', overflowY: 'auto',
    }}>
      {/* Particles */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        {particles.map((p) => (
          <div key={p.id} style={{
            position: 'absolute', width: p.size, height: p.size,
            background: `rgba(35,205,202,${p.opacity})`, borderRadius: '50%',
            top: `${p.top}%`, left: `${p.left}%`,
            boxShadow: `0 0 ${p.glow}px rgba(35,205,202,${p.opacity * 0.5})`,
            animation: `float ${p.duration}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
          }} />
        ))}
      </div>

      {/* Center wrapper — vertical centering with scroll fallback */}
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        minHeight: '100%', padding: '2rem 1rem', boxSizing: 'border-box',
      }}>

      {/* Language Toggle */}
      <button onClick={() => setLanguage(language === 'de' ? 'en' : 'de')} style={{
        position: 'fixed', top: '1.5rem', right: '1.5rem', zIndex: 100,
        padding: '0.4rem 0.85rem', borderRadius: '10px',
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        color: '#71717a', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: '0.375rem',
        backdropFilter: 'blur(10px)', transition: 'all 0.2s',
      }}>
        {language === 'de' ? '🇺🇸 EN' : '🇩🇪 DE'}
      </button>

      {/* Card */}
      <div style={{
        position: 'relative', zIndex: 10, width: '100%', maxWidth: 520,
        padding: '2rem',
      }}>
        {/* Step Indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem', marginBottom: '2rem' }}>
          {steps.map((s, i) => (
            <React.Fragment key={i}>
              <div style={{
                width: 32, height: 32, borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: i + 1 <= step ? 'rgba(35,205,202,0.15)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${i + 1 === step ? 'rgba(35,205,202,0.4)' : i + 1 < step ? 'rgba(35,205,202,0.2)' : 'rgba(255,255,255,0.06)'}`,
                transition: 'all 0.3s',
              }}>
                {i + 1 < step ? (
                  <Check size={14} style={{ color: '#23CDCB' }} />
                ) : (
                  <s.icon size={14} style={{ color: i + 1 === step ? '#23CDCB' : '#3f3f46' }} />
                )}
              </div>
              {i < steps.length - 1 && (
                <div style={{ width: 20, height: 1, background: i + 1 < step ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.06)' }} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Content Card */}
        <div style={{
          background: 'rgba(255,255,255,0.02)', backdropFilter: 'blur(24px)',
          borderRadius: '20px', border: '1px solid rgba(255,255,255,0.06)',
          padding: '2rem', boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
          minHeight: 320,
        }}>

          {/* STEP 1: Welcome + Goal */}
          {step === 1 && (
            <div>
              <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
                <img src="/opencognit.png" alt="OpenCognit" style={{ width: 64, height: 64, margin: '0 auto 0.875rem', display: 'block', filter: 'drop-shadow(0 0 20px rgba(35,205,202,0.2))' }} />
                <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fff', margin: '0 0 0.375rem' }}>
                  {de ? 'Willkommen bei OpenCognit' : 'Welcome to OpenCognit'}
                </h1>
                <p style={{ color: '#52525b', fontSize: '0.8125rem', lineHeight: 1.5, margin: 0 }}>
                  {de
                    ? 'Das Betriebssystem für autonome KI-Teams.'
                    : 'The operating system for autonomous AI teams.'}
                </p>
              </div>

              <div>
                <label style={{ fontSize: '0.875rem', fontWeight: 600, color: '#d4d4d8', display: 'block', marginBottom: '0.5rem' }}>
                  {de ? 'Was willst du mit OpenCognit erreichen?' : 'What do you want to achieve with OpenCognit?'}
                </label>
                <p style={{ fontSize: '0.75rem', color: '#52525b', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                  {de
                    ? 'Beschreibe in deinen eigenen Worten — Deutsch oder Englisch. Die KI konfiguriert dann automatisch passende Agenten.'
                    : 'Describe in your own words — German or English. The AI will automatically configure matching agents.'}
                </p>
                <textarea
                  value={goalDescription}
                  onChange={e => setGoalDescription(e.target.value)}
                  rows={5}
                  autoFocus
                  placeholder={de
                    ? 'z.B. "Ich baue einen Online-Shop für handgemachte Möbel und brauche Hilfe bei Marketing, Kundenbetreuung und Buchhaltung."'
                    : 'e.g. "I\'m building an online shop for handmade furniture and need help with marketing, customer support and accounting."'}
                  style={{ ...inputStyle, resize: 'none', lineHeight: 1.6 }}
                  {...focus}
                />
                {goalDescription.trim().length > 0 && (
                  <div style={{ marginTop: '0.625rem', display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.7rem', color: '#23CDCB' }}>
                    <Check size={12} />
                    {de ? 'Wird für die automatische Team-Konfiguration verwendet.' : 'Will be used for automatic team configuration.'}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: Company */}
          {step === 2 && (
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>
                {de ? 'Dein Unternehmen' : 'Your Company'}
              </h2>
              <p style={{ color: '#52525b', fontSize: '0.8125rem', marginBottom: '1.5rem' }}>
                {de ? 'Erstelle deine erste Firma. Du kannst später weitere hinzufügen.' : 'Create your first company. You can add more later.'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#a1a1aa', display: 'block', marginBottom: '0.4rem' }}>
                    {de ? 'Firmenname' : 'Company name'} *
                  </label>
                  <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder={de ? 'z.B. Mein Startup' : 'e.g. My Startup'} style={inputStyle} {...focus} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#a1a1aa', display: 'block', marginBottom: '0.4rem' }}>
                    {de ? 'Ziel / Mission' : 'Goal / Mission'}
                  </label>
                  <input value={companyGoal} onChange={e => setCompanyGoal(e.target.value)} placeholder={de ? 'z.B. SaaS-Produkt für Logistik bauen' : 'e.g. Build a SaaS product for logistics'} style={inputStyle} {...focus} />
                </div>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#a1a1aa', display: 'block', marginBottom: '0.4rem' }}>
                    {de ? 'Beschreibung' : 'Description'}
                  </label>
                  <textarea value={companyDesc} onChange={e => setCompanyDesc(e.target.value)} rows={3} placeholder={de ? 'Optional: Was macht dein Unternehmen?' : 'Optional: What does your company do?'} style={{ ...inputStyle, resize: 'vertical' }} {...focus} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <label style={{ fontSize: '0.75rem', fontWeight: 500, color: '#a1a1aa' }}>
                      {de ? 'Arbeitsverzeichnis' : 'Workspace Directory'}
                    </label>
                    <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(255,255,255,0.04)', color: '#3f3f46' }}>
                      {de ? 'OPTIONAL' : 'OPTIONAL'}
                    </span>
                  </div>
                  <input value={workDir} onChange={e => setWorkDir(e.target.value)}
                    placeholder={de ? '/home/user/mein-projekt' : '/home/user/my-project'}
                    style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.8125rem' }} {...focus} />
                  <p style={{ fontSize: '0.7rem', color: '#3f3f46', marginTop: '0.3rem', lineHeight: 1.5 }}>
                    {de
                      ? 'Absoluter Pfad zum Projektordner. Claude Code CLI Agenten arbeiten hier.'
                      : 'Absolute path to your project folder. Claude Code CLI agents will work here.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: API Keys */}
          {step === 3 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', margin: '0 0 0.25rem' }}>
                    {de ? 'LLM Verbindung' : 'LLM Connection'}
                  </h2>
                  <p style={{ color: '#52525b', fontSize: '0.8125rem', margin: 0 }}>
                    {de ? 'Optional — kann später in den Einstellungen ergänzt werden.' : 'Optional — can be added later in settings.'}
                  </p>
                </div>
                <span style={{ fontSize: '0.625rem', fontWeight: 700, padding: '0.2rem 0.5rem', borderRadius: '6px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80', whiteSpace: 'nowrap' }}>
                  {de ? 'OPTIONAL' : 'OPTIONAL'}
                </span>
              </div>

              {/* Tabs */}
              <div style={{ display: 'flex', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '3px', marginBottom: '1.25rem', border: '1px solid rgba(255,255,255,0.04)' }}>
                {([
                  { key: 'cloud', label: de ? '☁️ Cloud' : '☁️ Cloud' },
                  { key: 'local', label: de ? '💻 Lokal' : '💻 Local' },
                  { key: 'custom', label: de ? '🔌 Custom' : '🔌 Custom' },
                ] as const).map(tab => (
                  <button key={tab.key} type="button" onClick={() => setLlmTab(tab.key)} style={{
                    flex: 1, padding: '0.5rem', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, transition: 'all 0.2s',
                    background: llmTab === tab.key ? 'rgba(35,205,202,0.12)' : 'transparent',
                    color: llmTab === tab.key ? '#23CDCB' : '#52525b',
                  }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Cloud Tab */}
              {llmTab === 'cloud' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                  <div style={{ padding: '0.625rem 0.875rem', borderRadius: '10px', background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.12)', fontSize: '0.7rem', color: '#93c5fd', lineHeight: 1.5 }}>
                    ℹ️ {de
                      ? 'Claude Pro/Max-Abos geben keinen API-Zugang. API Keys bekommst du auf console.anthropic.com (getrennt vom Abo).'
                      : 'Claude Pro/Max subscriptions do not include API access. Get API keys at console.anthropic.com (separate from subscription).'}
                  </div>
                  {[
                    { key: 'openrouter' as const, label: 'OpenRouter', badge: de ? 'Empfohlen' : 'Recommended', badgeColor: '#a78bfa', hint: de ? '200+ Modelle, ein Key' : '200+ models, one key', placeholder: 'sk-or-v1-...' },
                    { key: 'anthropic' as const, label: 'Anthropic (Claude)', badge: '', badgeColor: '', hint: 'console.anthropic.com → API Keys', placeholder: 'sk-ant-api03-...' },
                    { key: 'openai' as const, label: 'OpenAI', badge: '', badgeColor: '', hint: 'platform.openai.com → API Keys', placeholder: 'sk-proj-...' },
                  ].map(p => (
                    <div key={p.key}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d8' }}>{p.label}</label>
                        {p.badge && <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(167,139,250,0.1)', color: p.badgeColor }}>{p.badge}</span>}
                        <span style={{ fontSize: '0.6rem', color: '#3f3f46', marginLeft: 'auto' }}>{p.hint}</span>
                      </div>
                      <input value={keys[p.key]} onChange={e => setKeys(k => ({ ...k, [p.key]: e.target.value }))}
                        placeholder={p.placeholder} type="password" autoComplete="new-password"
                        style={{ ...inputStyle, fontSize: '0.8125rem', fontFamily: 'monospace' }} {...focus} />
                    </div>
                  ))}
                </div>
              )}

              {/* Local / Ollama Tab */}
              {llmTab === 'local' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d8', display: 'block', marginBottom: '0.3rem' }}>
                      Ollama URL
                    </label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input value={keys.ollama} onChange={e => setKeys(k => ({ ...k, ollama: e.target.value }))}
                        placeholder="http://localhost:11434" type="text"
                        style={{ ...inputStyle, fontSize: '0.8125rem', fontFamily: 'monospace', flex: 1 }} {...focus} />
                      <button type="button" onClick={detectOllama} disabled={ollamaDetecting} style={{
                        padding: '0 1rem', borderRadius: '12px', border: '1px solid rgba(35,205,202,0.3)',
                        background: 'rgba(35,205,202,0.08)', color: '#23CDCB', cursor: ollamaDetecting ? 'not-allowed' : 'pointer',
                        fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', transition: 'all 0.2s',
                        opacity: ollamaDetecting ? 0.6 : 1,
                      }}>
                        {ollamaDetecting ? '...' : (de ? '🔍 Erkennen' : '🔍 Detect')}
                      </button>
                    </div>
                  </div>

                  {ollamaStatus === 'found' && ollamaModels.length > 0 && (
                    <div style={{ padding: '0.875rem', borderRadius: '12px', background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4ade80', marginBottom: '0.375rem' }}>
                        ✅ {ollamaModels.length} {de ? 'Modelle gefunden' : 'models found'}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: '#52525b', marginBottom: '0.625rem' }}>
                        {de ? 'Klicke ein Modell an um es als Standard zu setzen:' : 'Click a model to set it as default:'}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                        {ollamaModels.map(m => {
                          const selected = selectedOllamaModel === m;
                          return (
                            <button
                              key={m}
                              onClick={() => setSelectedOllamaModel(selected ? null : m)}
                              style={{
                                fontSize: '0.7rem', padding: '0.2rem 0.5rem', borderRadius: '6px', cursor: 'pointer',
                                background: selected ? 'rgba(35,205,202,0.2)' : 'rgba(34,197,94,0.08)',
                                border: `1px solid ${selected ? 'rgba(35,205,202,0.6)' : 'rgba(34,197,94,0.2)'}`,
                                color: selected ? '#23CDCB' : '#86efac',
                                fontFamily: 'monospace', fontWeight: selected ? 700 : 400,
                                transition: 'all 0.15s',
                              }}
                            >
                              {selected ? '✓ ' : ''}{m}
                            </button>
                          );
                        })}
                      </div>
                      {selectedOllamaModel && (
                        <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#23CDCB' }}>
                          {de ? `Standard-Modell: ${selectedOllamaModel}` : `Default model: ${selectedOllamaModel}`}
                        </div>
                      )}
                    </div>
                  )}

                  {ollamaStatus === 'error' && (
                    <div style={{ padding: '0.75rem', borderRadius: '10px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', fontSize: '0.75rem', color: '#fca5a5' }}>
                      ❌ {de ? 'Ollama nicht erreichbar. Läuft Ollama auf diesem Gerät?' : 'Ollama not reachable. Is Ollama running on this device?'}
                      <br /><span style={{ color: '#3f3f46', fontSize: '0.7rem' }}>ollama serve</span>
                    </div>
                  )}

                  {ollamaStatus === 'idle' && (
                    <div style={{ padding: '0.75rem', borderRadius: '10px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', fontSize: '0.75rem', color: '#52525b' }}>
                      {de ? '💡 Klicke "Erkennen" um lokale Modelle automatisch zu finden.' : '💡 Click "Detect" to automatically find local models.'}
                    </div>
                  )}
                </div>
              )}

              {/* Custom / OpenAI-compatible Tab */}
              {llmTab === 'custom' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                  <div style={{ padding: '0.625rem 0.875rem', borderRadius: '10px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.12)', fontSize: '0.7rem', color: '#fde68a', lineHeight: 1.5 }}>
                    🔌 {de
                      ? 'OpenAI-kompatible API — funktioniert mit LM Studio, vLLM, LocalAI, eigenen Proxies und mehr.'
                      : 'OpenAI-compatible API — works with LM Studio, vLLM, LocalAI, custom proxies, and more.'}
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d8', display: 'block', marginBottom: '0.3rem' }}>
                      Base URL
                    </label>
                    <input value={keys.customBase} onChange={e => setKeys(k => ({ ...k, customBase: e.target.value }))}
                      placeholder="http://localhost:1234/v1"
                      style={{ ...inputStyle, fontSize: '0.8125rem', fontFamily: 'monospace' }} {...focus} />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.75rem', fontWeight: 600, color: '#d4d4d8', display: 'block', marginBottom: '0.3rem' }}>
                      API Key <span style={{ color: '#3f3f46', fontWeight: 400 }}>({de ? 'optional' : 'optional'})</span>
                    </label>
                    <input value={keys.customKey} onChange={e => setKeys(k => ({ ...k, customKey: e.target.value }))}
                      placeholder="sk-..." type="password" autoComplete="new-password"
                      style={{ ...inputStyle, fontSize: '0.8125rem', fontFamily: 'monospace' }} {...focus} />
                  </div>
                </div>
              )}

              {!hasKey && (
                <div style={{ marginTop: '1rem', padding: '0.625rem 0.875rem', borderRadius: '10px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', fontSize: '0.7rem', color: '#3f3f46' }}>
                  {de ? '— Ohne LLM-Verbindung können Agenten nicht denken. Jederzeit nachholbar unter Einstellungen.' : '— Without an LLM connection agents cannot think. Configurable anytime in Settings.'}
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Team */}
          {step === 4 && (
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>
                {de ? 'Dein KI-Team' : 'Your AI Team'}
              </h2>
              <p style={{ color: '#52525b', fontSize: '0.8125rem', marginBottom: '1.5rem' }}>
                {de ? 'Starte mit einem fertigen Template oder erstelle Agenten manuell.' : 'Start with a ready-made template or create agents manually.'}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {/* Clipmart Option */}
                <button onClick={() => { setTeamMode('clipmart'); loadTemplates(); }} style={{
                  width: '100%', padding: '1.25rem', borderRadius: '14px', cursor: 'pointer',
                  background: teamMode === 'clipmart' ? 'rgba(35,205,202,0.08)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${teamMode === 'clipmart' ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  textAlign: 'left', transition: 'all 0.2s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '12px', background: 'rgba(139,92,246,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Package size={20} style={{ color: '#a78bfa' }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#e4e4e7', fontSize: '0.9375rem' }}>
                        Clipmart — {de ? 'Team-Templates' : 'Team Templates'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#52525b', marginTop: '0.125rem' }}>
                        {de ? 'Vorgefertigte Teams mit CEO, CTO, etc.' : 'Pre-built teams with CEO, CTO, etc.'}
                      </div>
                    </div>
                    {teamMode === 'clipmart' && <Check size={18} style={{ color: '#23CDCB', marginLeft: 'auto' }} />}
                  </div>
                </button>

                {/* Manual Option */}
                <button onClick={() => setTeamMode('manual')} style={{
                  width: '100%', padding: '1.25rem', borderRadius: '14px', cursor: 'pointer',
                  background: teamMode === 'manual' ? 'rgba(35,205,202,0.08)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${teamMode === 'manual' ? 'rgba(35,205,202,0.3)' : 'rgba(255,255,255,0.06)'}`,
                  textAlign: 'left', transition: 'all 0.2s',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '12px', background: 'rgba(35,205,202,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Bot size={20} style={{ color: '#23CDCB' }} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, color: '#e4e4e7', fontSize: '0.9375rem' }}>
                        {de ? 'Manuell starten' : 'Start manually'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#52525b', marginTop: '0.125rem' }}>
                        {de ? 'Später im Dashboard eigene Agenten erstellen' : 'Create your own agents later in the dashboard'}
                      </div>
                    </div>
                    {teamMode === 'manual' && <Check size={18} style={{ color: '#23CDCB', marginLeft: 'auto' }} />}
                  </div>
                </button>
                {teamMode === 'manual' && (
                  <div style={{ padding: '0.75rem 0.875rem', borderRadius: '10px', background: 'rgba(35,205,202,0.04)', border: '1px solid rgba(35,205,202,0.12)', fontSize: '0.75rem', color: '#71717a', lineHeight: 1.6 }}>
                    💡 {de
                      ? <>Tipp: Erstelle als ersten Agenten einen <strong style={{ color: '#23CDCB' }}>CEO</strong> — Connection Type <code style={{ background: 'rgba(255,255,255,0.06)', padding: '0.1em 0.3em', borderRadius: '4px' }}>ceo</code>, Orchestrator-Flag an. Er koordiniert dann dein ganzes Team.</>
                      : <>Tip: Create a <strong style={{ color: '#23CDCB' }}>CEO</strong> agent first — connection type <code style={{ background: 'rgba(255,255,255,0.06)', padding: '0.1em 0.3em', borderRadius: '4px' }}>ceo</code>, Orchestrator flag on. It will coordinate your whole team.</>}
                  </div>
                )}

                {/* AI Magic Option */}
                <button onClick={() => setTeamMode('ai')} style={{
                  width: '100%', padding: '1.25rem', borderRadius: '14px', cursor: 'pointer',
                  background: teamMode === 'ai' ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${teamMode === 'ai' ? 'rgba(168,85,247,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  textAlign: 'left', transition: 'all 0.2s',
                  boxShadow: teamMode === 'ai' ? '0 0 20px rgba(168,85,247,0.08)' : 'none',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '12px', background: 'rgba(168,85,247,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Sparkles size={20} style={{ color: '#a855f7' }} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 700, color: '#e4e4e7', fontSize: '0.9375rem' }}>
                          {de ? 'KI baut mein Team' : 'AI builds my team'}
                        </span>
                        <span style={{ fontSize: '0.55rem', fontWeight: 800, padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(168,85,247,0.15)', color: '#a855f7', letterSpacing: '0.08em' }}>
                          MAGIC
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#52525b', marginTop: '0.125rem' }}>
                        {de ? 'Beschreibe dein Ziel — KI erstellt passendes Team' : 'Describe your goal — AI creates the perfect team'}
                      </div>
                    </div>
                    {teamMode === 'ai' && <Check size={18} style={{ color: '#a855f7', marginLeft: 'auto' }} />}
                  </div>
                </button>
              </div>

              {/* AI Magic: Description + Generate */}
              {teamMode === 'ai' && (
                <div style={{ marginTop: '1rem' }}>

                  {/* No LLM connected warning */}
                  {!hasKey && (
                    <div style={{ marginBottom: '0.75rem', padding: '0.625rem 0.875rem', borderRadius: '10px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', fontSize: '0.75rem', color: '#fbbf24', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <span>⚠️</span>
                      <span>
                        {de
                          ? 'Kein LLM verbunden — das Team wird anhand von Keywords erstellt, nicht durch KI. Gehe zurück zu Schritt 3 um einen API Key oder Ollama zu konfigurieren.'
                          : 'No LLM connected — team will be built from keywords, not AI. Go back to Step 3 to configure an API key or Ollama.'}
                      </span>
                    </div>
                  )}

                  {/* Model info badge */}
                  {generationModel && (
                    <div style={{ marginBottom: '0.625rem', display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.7rem', color: '#71717a' }}>
                      <span>{de ? 'Generiert mit:' : 'Generating with:'}</span>
                      <span style={{ padding: '0.15rem 0.5rem', borderRadius: '5px', background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.2)', color: '#c084fc', fontFamily: 'monospace', fontWeight: 600 }}>
                        {generationModel.label ?? generationModel.provider}
                      </span>
                      {generationModel.label && <span style={{ color: '#3f3f46' }}>via {generationModel.provider}</span>}
                    </div>
                  )}

                  <textarea
                    value={aiDescription}
                    onChange={e => { setAiDescription(e.target.value); setAiPlan(null); }}
                    rows={3}
                    placeholder={de
                      ? 'z.B. "Wir bauen einen SaaS für Logistik. Brauche Unterstützung bei Marketing, Entwicklung und Kundenbetreuung."'
                      : 'e.g. "We\'re building a logistics SaaS. Need help with marketing, development and customer support."'}
                    style={{ ...inputStyle, resize: 'none', fontSize: '0.8125rem' }}
                    {...focus}
                  />
                  <button
                    type="button"
                    onClick={generateAiTeam}
                    disabled={!aiDescription.trim() || aiGenerating}
                    style={{
                      marginTop: '0.625rem', width: '100%', padding: '0.75rem',
                      borderRadius: '12px', border: 'none', cursor: aiDescription.trim() && !aiGenerating ? 'pointer' : 'not-allowed',
                      background: aiDescription.trim() && !aiGenerating ? 'linear-gradient(135deg, #7c3aed, #a855f7)' : 'rgba(255,255,255,0.04)',
                      color: aiDescription.trim() && !aiGenerating ? '#fff' : '#3f3f46',
                      fontWeight: 700, fontSize: '0.875rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                      transition: 'all 0.2s',
                      boxShadow: aiDescription.trim() && !aiGenerating ? '0 4px 15px rgba(168,85,247,0.3)' : 'none',
                    }}
                  >
                    {aiGenerating
                      ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> {de ? 'KI generiert Team…' : 'AI generating team…'}</>
                      : <><Sparkles size={14} /> {de ? 'Team generieren' : 'Generate team'}</>
                    }
                  </button>

                  {aiGenError && (
                    <div style={{ marginTop: '0.5rem', padding: '0.625rem', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.75rem', color: '#fca5a5' }}>
                      {aiGenError}
                    </div>
                  )}

                  {aiPlan?.agents && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#a855f7', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                        <Check size={11} />
                        {de ? `${aiPlan.agents.length} Agenten bereit` : `${aiPlan.agents.length} agents ready`}
                        {aiSource === 'default' && <span style={{ color: '#52525b', fontWeight: 500 }}>({de ? 'Standard-Vorlage' : 'default template'})</span>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                        {aiPlan.agents.map((a: any, i: number) => (
                          <div key={i} style={{
                            display: 'flex', alignItems: 'center', gap: '0.625rem',
                            padding: '0.5rem 0.75rem', borderRadius: '8px',
                            background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)',
                          }}>
                            <div style={{ width: 28, height: 28, borderRadius: '8px', background: 'rgba(168,85,247,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: '#a855f7', flexShrink: 0 }}>
                              {a.name?.slice(0, 2).toUpperCase()}
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#d4d4d8' }}>{a.name}</div>
                              <div style={{ fontSize: '0.7rem', color: '#52525b' }}>{a.rolle}</div>
                            </div>
                            {i === 0 && <span style={{ fontSize: '0.55rem', fontWeight: 700, padding: '0.1rem 0.4rem', borderRadius: '4px', background: 'rgba(35,205,202,0.1)', color: '#23CDCB', flexShrink: 0 }}>CEO</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Template Selection */}
              {teamMode === 'clipmart' && templatesError && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '10px', background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.15)', fontSize: '0.75rem', color: '#fca5a5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>{de ? 'Templates konnten nicht geladen werden.' : 'Could not load templates.'}</span>
                  <button onClick={() => { setTemplatesLoaded(false); setTemplatesError(false); loadTemplates(); }} style={{ background: 'none', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#fca5a5', cursor: 'pointer', fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>
                    {de ? 'Erneut versuchen' : 'Retry'}
                  </button>
                </div>
              )}
              {teamMode === 'clipmart' && templates.length > 0 && (
                <div style={{
                  marginTop: '1rem',
                  maxHeight: '260px', overflowY: 'auto', overflowX: 'hidden',
                  display: 'flex', flexDirection: 'column', gap: '0.5rem',
                  paddingRight: '0.25rem',
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'rgba(255,255,255,0.08) transparent',
                }}>
                  {templates.map(tpl => (
                    <button key={tpl.name} onClick={() => setSelectedTemplate(tpl.name)} style={{
                      width: '100%', padding: '0.875rem 1rem', borderRadius: '10px',
                      background: selectedTemplate === tpl.name ? 'rgba(139,92,246,0.1)' : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${selectedTemplate === tpl.name ? 'rgba(139,92,246,0.3)' : 'rgba(255,255,255,0.05)'}`,
                      textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s',
                      flexShrink: 0,
                    }}>
                      <div style={{ fontWeight: 600, color: '#d4d4d8', fontSize: '0.875rem' }}>{tpl.name}</div>
                      <div style={{ fontSize: '0.7rem', color: '#52525b', marginTop: '0.2rem' }}>
                        {tpl.beschreibung} — {tpl.agentCount} {de ? 'Agenten' : 'agents'}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 5: Channels */}
          {step === 5 && (
            <div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>
                {de ? 'Channels verbinden' : 'Connect Channels'}
              </h2>
              <p style={{ color: '#52525b', fontSize: '0.8125rem', marginBottom: '1.5rem' }}>
                {de ? 'Optional: Verbinde Messaging-Kanäle um mit Agenten von außen zu kommunizieren.' : 'Optional: Connect messaging channels to communicate with agents externally.'}
              </p>

              <div style={{ padding: '1rem', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>📨</span>
                  <span style={{ fontWeight: 700, color: '#d4d4d8', fontSize: '0.9375rem' }}>Telegram</span>
                  <span style={{ fontSize: '0.625rem', color: '#3f3f46', marginLeft: 'auto' }}>{de ? 'Weitere Channels in den Einstellungen' : 'More channels in settings'}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

                  {/* Token + Verify */}
                  <div>
                    <label style={{ fontSize: '0.75rem', color: '#71717a', display: 'block', marginBottom: '0.3rem' }}>Bot Token</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        value={telegramToken}
                        onChange={e => { setTelegramToken(e.target.value); setTelegramBot(null); setTelegramVerifyError(null); }}
                        placeholder="123456789:ABC-DEF..."
                        style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.8125rem', flex: 1 }}
                        {...focus}
                      />
                      <button
                        type="button"
                        onClick={verifyTelegramToken}
                        disabled={!telegramToken.trim() || telegramVerifying}
                        style={{
                          padding: '0 0.875rem', borderRadius: '10px', border: 'none', cursor: telegramToken.trim() ? 'pointer' : 'not-allowed',
                          background: telegramBot ? 'rgba(34,197,94,0.12)' : 'rgba(35,205,202,0.1)',
                          color: telegramBot ? '#4ade80' : '#23CDCB',
                          fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', transition: 'all 0.2s',
                          opacity: telegramVerifying ? 0.6 : 1,
                        }}
                      >
                        {telegramVerifying ? '...' : telegramBot ? '✓ OK' : (de ? 'Prüfen' : 'Verify')}
                      </button>
                    </div>
                    {telegramBot && (
                      <div style={{ marginTop: '0.375rem', fontSize: '0.7rem', color: '#4ade80' }}>
                        ✅ @{telegramBot.username} ({telegramBot.firstName})
                      </div>
                    )}
                    {telegramVerifyError && (
                      <div style={{ marginTop: '0.375rem', fontSize: '0.7rem', color: '#fca5a5' }}>
                        ❌ {telegramVerifyError}
                      </div>
                    )}
                  </div>

                  {/* Chat ID — only shown after token verified */}
                  {telegramBot && (
                    <div>
                      <label style={{ fontSize: '0.75rem', color: '#71717a', display: 'block', marginBottom: '0.3rem' }}>Chat ID</label>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                          value={telegramChatId}
                          onChange={e => setTelegramChatId(e.target.value)}
                          placeholder="-1001234567890"
                          style={{ ...inputStyle, fontFamily: 'monospace', fontSize: '0.8125rem', flex: 1 }}
                          {...focus}
                        />
                        <button
                          type="button"
                          onClick={detectTelegramChatId}
                          disabled={telegramDetecting}
                          style={{
                            padding: '0 0.875rem', borderRadius: '10px', border: 'none', cursor: 'pointer',
                            background: 'rgba(35,205,202,0.08)', color: '#23CDCB',
                            fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap', transition: 'all 0.2s',
                            opacity: telegramDetecting ? 0.6 : 1,
                          }}
                        >
                          {telegramDetecting ? '...' : '🔍 Detect'}
                        </button>
                      </div>
                      <div style={{ marginTop: '0.375rem', fontSize: '0.7rem', color: '#52525b' }}>
                        {de
                          ? `Schreibe /start an @${telegramBot.username}, dann klicke "Detect".`
                          : `Send /start to @${telegramBot.username}, then click "Detect".`}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <p style={{ marginTop: '1rem', fontSize: '0.75rem', color: '#3f3f46', textAlign: 'center' }}>
                {de ? 'Du kannst diesen Schritt überspringen und Channels später konfigurieren.' : 'You can skip this step and configure channels later.'}
              </p>
            </div>
          )}

          {/* STEP 6: Launch */}
          {step === 6 && (
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 64, height: 64, borderRadius: '16px',
                background: 'rgba(35,205,202,0.1)', border: '1px solid rgba(35,205,202,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 1.25rem',
              }}>
                <Rocket size={28} style={{ color: '#23CDCB' }} />
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', marginBottom: '0.5rem' }}>
                {de ? 'Bereit zum Start!' : 'Ready to launch!'}
              </h2>
              <p style={{ color: '#71717a', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                {de ? 'Hier ist deine Konfiguration:' : "Here's your configuration:"}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
                {[
                  { label: de ? 'Ziel' : 'Goal', value: goalDescription.length > 48 ? goalDescription.slice(0, 48) + '…' : goalDescription, done: !!goalDescription },
                  { label: de ? 'Firma' : 'Company', value: companyName, done: true },
                  { label: 'API Key', value: hasKey ? (keys.openrouter ? 'OpenRouter' : keys.anthropic ? 'Anthropic' : keys.openai ? 'OpenAI' : keys.customKey ? 'Custom API' : 'Ollama') : (de ? 'Keiner' : 'None'), done: hasKey },
                  { label: de ? 'Team' : 'Team', value: teamMode === 'clipmart' ? selectedTemplate || 'Template' : teamMode === 'ai' ? `✨ ${aiPlan?.agents?.length || 0} ${de ? 'Agenten (KI)' : 'agents (AI)'}` : (de ? 'Manuell' : 'Manual'), done: true },
                  { label: 'Telegram', value: telegramToken ? '✓' : (de ? 'Übersprungen' : 'Skipped'), done: !!telegramToken },
                ].map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.625rem 0.875rem', borderRadius: '8px',
                    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)',
                  }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '6px',
                      background: item.done ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.05)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {item.done && <Check size={12} style={{ color: '#22c55e' }} />}
                    </div>
                    <span style={{ fontSize: '0.8125rem', color: '#71717a', flex: 1 }}>{item.label}</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#d4d4d8' }}>{item.value}</span>
                  </div>
                ))}
              </div>

              {/* OpenClaw hint */}
              <div style={{ marginTop: '1rem', padding: '0.75rem 0.875rem', borderRadius: '10px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', fontSize: '0.75rem', color: '#52525b', lineHeight: 1.6 }}>
                🔌 {de
                  ? <><strong style={{ color: '#71717a' }}>OpenClaw-Agenten</strong> einbinden? Nach dem Start: Settings → OpenClaw Gateway → Token generieren, dann im OpenClaw-Agent als Gateway-URL eintragen.</>
                  : <><strong style={{ color: '#71717a' }}>Have OpenClaw agents?</strong> After launch: Settings → OpenClaw Gateway → generate token, then enter as the Gateway URL in your OpenClaw agent.</>}
              </div>

              {error && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', color: '#fca5a5', fontSize: '0.8125rem' }}>
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          {step > 1 ? (
            <button onClick={prev} style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.6rem 1.25rem', borderRadius: '10px',
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
              color: '#71717a', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500,
            }}>
              <ChevronLeft size={16} /> {de ? 'Zurück' : 'Back'}
            </button>
          ) : <div />}

          {step < STEPS ? (
            <button onClick={next} disabled={!canNext()} style={{
              display: 'flex', alignItems: 'center', gap: '0.375rem',
              padding: '0.6rem 1.5rem', borderRadius: '10px',
              background: canNext() ? 'linear-gradient(135deg, #23CDCB, #0ea5e9)' : 'rgba(255,255,255,0.05)',
              border: 'none',
              color: canNext() ? '#fff' : '#3f3f46',
              cursor: canNext() ? 'pointer' : 'not-allowed',
              fontSize: '0.875rem', fontWeight: 700,
              boxShadow: canNext() ? '0 4px 15px rgba(35,205,202,0.3)' : 'none',
              transition: 'all 0.2s',
            }}>
              {de ? 'Weiter' : 'Next'} <ChevronRight size={16} />
            </button>
          ) : (
            <button onClick={handleFinish} disabled={loading} style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.6rem 1.5rem', borderRadius: '10px',
              background: loading ? 'rgba(35,205,202,0.3)' : 'linear-gradient(135deg, #23CDCB, #0ea5e9)',
              border: 'none', color: '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem', fontWeight: 700,
              boxShadow: loading ? 'none' : '0 4px 15px rgba(35,205,202,0.3)',
            }}>
              {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> {de ? 'Wird erstellt...' : 'Creating...'}</> : <><Rocket size={16} /> {de ? 'Starten!' : 'Launch!'}</>}
            </button>
          )}
          </div>{/* end prev/next row */}

          {/* Skip setup link — shown on steps 1-5, hidden on final step */}
          {step < STEPS && (
            <div style={{ textAlign: 'center' }}>
              <button
                onClick={handleQuickStart}
                disabled={skipping}
                style={{
                  background: 'none', border: 'none', cursor: skipping ? 'not-allowed' : 'pointer',
                  color: '#3f3f46', fontSize: '0.75rem', padding: '0.25rem 0.5rem',
                  textDecoration: 'underline', textDecorationColor: 'rgba(63,63,70,0.4)',
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#71717a')}
                onMouseLeave={e => (e.currentTarget.style.color = '#3f3f46')}
              >
                {skipping
                  ? (de ? 'Wird erstellt…' : 'Creating…')
                  : (de ? 'Setup überspringen — später in Einstellungen konfigurieren' : 'Skip setup — configure later in Settings')}
              </button>
            </div>
          )}
        </div>
      </div>
      </div>{/* end center wrapper */}

    </div>
  );
}
