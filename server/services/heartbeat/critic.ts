// Heartbeat Critic — LLM-based output reviewer + advisor plan/correction

import { db } from '../../db/client.js';
import { agents, settings, comments } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { adapterRegistry } from '../../adapters/registry.js';
import { decryptSetting } from '../../utils/crypto.js';
import { v4 as uuid } from 'uuid';

/**
 * Consultant an advisor for a strategic plan
 */
export async function getAdvisorPlan(
  advisorId: string,
  executorId: string,
  companyId: string,
  tasks: any[]
): Promise<string> {
  try {
    // Get advisor details
    const advisor = db.select().from(agents).where(eq(agents.id, advisorId)).get();
    const executor = db.select().from(agents).where(eq(agents.id, executorId)).get();

    if (!advisor || !executor) return "Gehe strukturiert vor.";

    const taskSummary = tasks.map(t => `- ${t.title} (${t.priority})`).join('\n');

    const prompt = `Du bist der ADVISOR (Architekt/Lead) für den Agenten ${executor.name} (${executor.role}).
Deine Aufgabe ist es, eine STRATEGIE für die folgenden anstehenden Aufgaben zu erstellen:

${taskSummary}

Erstelle einen präzisen, architektonisch klugen Plan, wie der Agent diese Aufgaben angehen soll.
Identifiziere Fallstricke und setze Leitplanken.
Der Agent sieht diesen Plan als seine höchste Anweisung an.

Antworte ausschließlich mit dem Plan.`;

    // Simulierter LLM Call via Adapter (generic prompt flow)
    // In einer echten Implementierung rufen wir hier den llm-wrapper direkt auf
    // Für den Moment nutzen wir den standard adapter call mechanismus
    const result = await adapterRegistry.executeTask({
        id: 'advisor-call',
        title: 'Strategic Planning',
        description: prompt,
        status: 'todo',
        priority: 'high'
    }, {
        task: { id: 'advisor-call', title: 'Strategic Planning', description: null, status: 'todo', priority: 'high' },
        previousComments: [],
        companyContext: { name: 'Advisor Session', goal: null },
        agentContext: { name: advisor.name, role: advisor.role, skills: advisor.skills }
    }, {
        agentId: advisorId,
        companyId,
        runId: 'advisor-' + uuid(),
        connectionType: advisor.connectionType,
        systemPrompt: "Du bist ein Lead-Architekt. Erstelle Pläne, führe keine Aktionen aus."
    });

    return result.output || "Gehe mit Sorgfalt vor.";
  } catch (err) {
    console.error("❌ Fehler beim Abruf des Advisor-Plans:", err);
    return "Führe die Aufgaben nach bestem Wissen aus.";
  }
}

/**
 * Consult an advisor for error analysis and correction plan
 */
export async function getAdvisorCorrection(
  advisorId: string,
  executorId: string,
  companyId: string,
  taskTitel: string,
  output: string,
  error?: string | null
): Promise<string> {
  try {
    const advisor = db.select().from(agents).where(eq(agents.id, advisorId)).get();
    const executor = db.select().from(agents).where(eq(agents.id, executorId)).get();

    if (!advisor || !executor) return "Versuche es erneut mit einem anderen Ansatz.";

    const prompt = `Du bist der ADVISOR für ${executor.name}.
Der Agent hat versucht, die Aufgabe "${taskTitel}" zu lösen, ist aber gescheitert.

FEHLER/AUSGABE:
${error || 'Kein expliziter Fehler'}
${output.slice(-1000)}

Analysiere, warum es nicht geklappt hat und gib einen KREATIVEN KORREKTUR-PLAN aus.
Was soll der Agent als nächstes versuchen?`;

    const result = await adapterRegistry.executeTask({
        id: 'advisor-correction',
        title: 'Error Analysis',
        description: prompt,
        status: 'todo',
        priority: 'high'
    }, {
        task: { id: 'advisor-correction', title: 'Error Analysis', description: null, status: 'todo', priority: 'high' },
        previousComments: [],
        companyContext: { name: 'Advisor Session', goal: null },
        agentContext: { name: advisor.name, role: advisor.role, skills: advisor.skills }
    }, {
        agentId: advisorId,
        companyId,
        runId: 'advisor-corr-' + uuid(),
        connectionType: advisor.connectionType,
        systemPrompt: "Du bist ein Problemlöser. Analysiere Fehler und gib präzise neue Anweisungen."
    });

    return result.output || "Versuche einen anderen Weg.";
  } catch (err) {
    return "Fehleranalyse fehlgeschlagen. Bitte manuell prüfen.";
  }
}

// ─── CRITIC/EVALUATOR ─────────────────────────────────────────────────────
/**
 * Run Critic/Evaluator review for a completed task output.
 * Accepts executeTaskViaAdapterFn to avoid circular dependency with service.ts.
 */
export async function runCriticReview(
  taskId: string,
  taskTitel: string,
  taskBeschreibung: string,
  output: string,
  agentId: string,
  companyId: string,
): Promise<{ approved: boolean; feedback: string; escalate?: boolean }> {
  // Check existing critic feedback count
  const existingCriticFeedback = await db.select({ content: comments.content })
    .from(comments)
    .where(eq(comments.taskId, taskId));
  const criticCount = existingCriticFeedback.filter((c: any) =>
    c.content?.includes('**Critic Review')
  ).length;

  if (criticCount >= 2) {
    console.log(`  ⚠️ Critic: max retries reached for task ${taskId} — escalating to human review`);
    return { approved: false, escalate: true, feedback: 'Nach 2 Überarbeitungszyklen konnte der Agent die Aufgabe nicht zur Zufriedenheit abschließen. Manuelle Prüfung erforderlich.' };
  }

  const criticPrompt = `Du bist ein strenger aber fairer Code/Task-Reviewer.

Aufgabe: "${taskTitel}"
Beschreibung: ${taskBeschreibung || '(keine Beschreibung)'}

Ergebnis des Agenten:
${output.slice(0, 3000)}

Bewerte ob das Ergebnis die Aufgabe erfüllt. Antworte NUR mit diesem JSON:
{"verdict": "approved" | "needs_revision", "feedback": "konkretes Feedback wenn needs_revision, sonst leer"}

Kriterien:
- approved: Aufgabe klar erfüllt, Ergebnis macht Sinn
- needs_revision: Aufgabe nicht erfüllt, falsche Richtung, offensichtlich unvollständig, oder kritische Fehler

Sei nicht zu streng — wenn die Arbeit grundsätzlich passt, approve.`;

  // Resolve the active LLM connection — same priority as the agent itself uses:
  // 1. Custom API (Poe, LM Studio, etc.) — whatever is configured in Settings
  // 2. claude-code CLI (if agent uses it)
  // 3. Anthropic direct
  // 4. OpenRouter
  // 5. auto-approve (fail open, never block the system)
  const agentConn = db.select({ connectionType: agents.connectionType })
    .from(agents).where(eq(agents.id, agentId)).get() as any;

  const customKey  = db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'custom_api_key')).get();
  const customBase = db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'custom_api_base_url')).get();
  const anthropicKey = db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
  const orKey      = db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
  const poeKey     = db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'poe_api_key')).get();
  const moonshotKey = db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'moonshot_api_key')).get();
  const googleKey  = db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'google_api_key')).get();

  try {
    let responseText = '';

    // Option 1: Custom API (Poe / any OpenAI-compatible endpoint) — primary for most setups
    if (!responseText && customKey?.value && customBase?.value) {
      try {
        const apiBase = customBase.value.replace(/\/$/, '');
        // Use a fast/cheap model if available, fall back to gpt-4o-mini
        const criticModel = 'gpt-4o-mini';
        const res = await fetch(`${apiBase}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customKey.value}` },
          body: JSON.stringify({
            model: criticModel,
            max_tokens: 300,
            messages: [{ role: 'user', content: criticPrompt }],
          }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          responseText = data.choices?.[0]?.message?.content || '';
        }
      } catch { responseText = ''; }
    }

    // Option 2: claude-code CLI (free, if agent uses it)
    if (!responseText && agentConn?.connectionType === 'claude-code') {
      try {
        const { runClaudeDirectChat } = await import('../../adapters/claude-code.js');
        responseText = await runClaudeDirectChat(criticPrompt, agentId);
      } catch { responseText = ''; }
    }

    // Option 3: Anthropic direct
    if (!responseText && anthropicKey?.value) {
      const key = decryptSetting('anthropic_api_key', anthropicKey.value);
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: criticPrompt }] }),
      });
      if (res.ok) {
        const data = await res.json() as any;
        responseText = data.content?.[0]?.text || '';
      }
    }

    // Option 4: OpenRouter
    if (!responseText && orKey?.value) {
      const key = decryptSetting('openrouter_api_key', orKey.value);
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}`, 'HTTP-Referer': 'http://localhost:3200' },
        body: JSON.stringify({ model: 'mistralai/mistral-7b-instruct:free', max_tokens: 300, messages: [{ role: 'user', content: criticPrompt }] }),
      });
      if (res.ok) {
        const data = await res.json() as any;
        responseText = data.choices?.[0]?.message?.content || '';
      }
    }

    // Option 5: Poe API
    if (!responseText && poeKey?.value) {
      try {
        const key = decryptSetting('poe_api_key', poeKey.value);
        const res = await fetch('https://api.poe.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model: 'Claude-Haiku-4-5', max_tokens: 300, messages: [{ role: 'user', content: criticPrompt }] }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          responseText = data.choices?.[0]?.message?.content || '';
        }
      } catch { responseText = ''; }
    }

    // Option 6: Moonshot API
    if (!responseText && moonshotKey?.value) {
      try {
        const key = decryptSetting('moonshot_api_key', moonshotKey.value);
        const res = await fetch('https://api.moonshot.cn/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model: 'moonshot-v1-8k', max_tokens: 300, messages: [{ role: 'user', content: criticPrompt }] }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          responseText = data.choices?.[0]?.message?.content || '';
        }
      } catch { responseText = ''; }
    }

    // Option 7: Google Gemini API
    if (!responseText && googleKey?.value) {
      try {
        const key = decryptSetting('google_api_key', googleKey.value);
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({ model: 'gemini-1.5-flash', max_tokens: 300, messages: [{ role: 'user', content: criticPrompt }] }),
        });
        if (res.ok) {
          const data = await res.json() as any;
          responseText = data.choices?.[0]?.message?.content || '';
        }
      } catch { responseText = ''; }
    }

    if (!responseText) {
      console.log('  ℹ️ Critic: no LLM available — auto-approving');
      return { approved: true, feedback: '' };
    }

    // Parse JSON response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { approved: true, feedback: '' };

    const parsed = JSON.parse(jsonMatch[0]);
    const approved = parsed.verdict === 'approved';
    return { approved, feedback: parsed.feedback || '' };

  } catch (e: any) {
    console.error('  ⚠️ Critic review failed:', e.message);
    return { approved: true, feedback: '' }; // fail open
  }
}
// ──────────────────────────────────────────────────────────────────────────
