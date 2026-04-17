// Heartbeat Critic — LLM-based output reviewer + advisor plan/correction

import { db } from '../../db/client.js';
import { experten, einstellungen, kommentare } from '../../db/schema.js';
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
  unternehmenId: string,
  tasks: any[]
): Promise<string> {
  try {
    // Get advisor details
    const advisor = db.select().from(experten).where(eq(experten.id, advisorId)).get();
    const executor = db.select().from(experten).where(eq(experten.id, executorId)).get();

    if (!advisor || !executor) return "Gehe strukturiert vor.";

    const taskSummary = tasks.map(t => `- ${t.titel} (${t.prioritaet})`).join('\n');

    const prompt = `Du bist der ADVISOR (Architekt/Lead) für den Agenten ${executor.name} (${executor.rolle}).
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
        titel: 'Strategic Planning',
        beschreibung: prompt,
        status: 'todo',
        prioritaet: 'high'
    }, {
        task: { id: 'advisor-call', titel: 'Strategic Planning', beschreibung: null, status: 'todo', prioritaet: 'high' },
        previousComments: [],
        companyContext: { name: 'Advisor Session', ziel: null },
        agentContext: { name: advisor.name, rolle: advisor.rolle, faehigkeiten: advisor.faehigkeiten }
    }, {
        expertId: advisorId,
        unternehmenId,
        runId: 'advisor-' + uuid(),
        verbindungsTyp: advisor.verbindungsTyp,
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
  unternehmenId: string,
  taskTitel: string,
  output: string,
  error?: string | null
): Promise<string> {
  try {
    const advisor = db.select().from(experten).where(eq(experten.id, advisorId)).get();
    const executor = db.select().from(experten).where(eq(experten.id, executorId)).get();

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
        titel: 'Error Analysis',
        beschreibung: prompt,
        status: 'todo',
        prioritaet: 'high'
    }, {
        task: { id: 'advisor-correction', titel: 'Error Analysis', beschreibung: null, status: 'todo', prioritaet: 'high' },
        previousComments: [],
        companyContext: { name: 'Advisor Session', ziel: null },
        agentContext: { name: advisor.name, rolle: advisor.rolle, faehigkeiten: advisor.faehigkeiten }
    }, {
        expertId: advisorId,
        unternehmenId,
        runId: 'advisor-corr-' + uuid(),
        verbindungsTyp: advisor.verbindungsTyp,
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
  expertId: string,
  unternehmenId: string,
): Promise<{ approved: boolean; feedback: string; escalate?: boolean }> {
  // Check existing critic feedback count
  const existingCriticFeedback = await db.select({ inhalt: kommentare.inhalt })
    .from(kommentare)
    .where(eq(kommentare.aufgabeId, taskId));
  const criticCount = existingCriticFeedback.filter((c: any) =>
    c.inhalt?.includes('Critic Review')
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
  const agentConn = db.select({ verbindungsTyp: experten.verbindungsTyp })
    .from(experten).where(eq(experten.id, expertId)).get() as any;

  const customKey  = db.select({ wert: einstellungen.wert }).from(einstellungen).where(eq(einstellungen.schluessel, 'custom_api_key')).get();
  const customBase = db.select({ wert: einstellungen.wert }).from(einstellungen).where(eq(einstellungen.schluessel, 'custom_api_base_url')).get();
  const anthropicKey = db.select({ wert: einstellungen.wert }).from(einstellungen).where(eq(einstellungen.schluessel, 'anthropic_api_key')).get();
  const orKey      = db.select({ wert: einstellungen.wert }).from(einstellungen).where(eq(einstellungen.schluessel, 'openrouter_api_key')).get();

  try {
    let responseText = '';

    // Option 1: Custom API (Poe / any OpenAI-compatible endpoint) — primary for most setups
    if (!responseText && customKey?.wert && customBase?.wert) {
      try {
        const apiBase = customBase.wert.replace(/\/$/, '');
        // Use a fast/cheap model if available, fall back to gpt-4o-mini
        const criticModel = 'gpt-4o-mini';
        const res = await fetch(`${apiBase}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${customKey.wert}` },
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
    if (!responseText && agentConn?.verbindungsTyp === 'claude-code') {
      try {
        const { runClaudeDirectChat } = await import('../../adapters/claude-code.js');
        responseText = await runClaudeDirectChat(criticPrompt, expertId);
      } catch { responseText = ''; }
    }

    // Option 3: Anthropic direct
    if (!responseText && anthropicKey?.wert) {
      const key = decryptSetting('anthropic_api_key', anthropicKey.wert);
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
    if (!responseText && orKey?.wert) {
      const key = decryptSetting('openrouter_api_key', orKey.wert);
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
