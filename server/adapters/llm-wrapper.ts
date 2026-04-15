// LLM Adapter Wrapper - Bridge zwischen altem ExpertAdapter Interface und neuem Adapter Interface

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import { getAdapter } from './index.js';
import type { ExpertAdapter, AdapterRunOptions } from './types.js';
import { db } from '../db/client.js';
import { einstellungen, experten, unternehmen } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decryptSetting } from '../utils/crypto.js';

export class LLMWrapperAdapter implements Adapter {
  public readonly name: string;
  private expertAdapter: ExpertAdapter;
  private verbindungsTyp: string;

  constructor(verbindungsTyp: string, name: string) {
    this.verbindungsTyp = verbindungsTyp;
    this.name = name;
    const adapter = getAdapter(verbindungsTyp);
    if (!adapter) {
      throw new Error(`Adapter not found: ${verbindungsTyp}`);
    }
    this.expertAdapter = adapter;
  }

  canHandle(task: AdapterTask): boolean {
    // LLM Wrapper kann ALLE Tasks bearbeiten (ist der Universal-Adapter)
    // Aber nur wenn der Agent diesen verbindungsTyp hat
    return true;
  }

  async execute(
    task: AdapterTask,
    context: AdapterContext,
    config: AdapterConfig
  ): Promise<AdapterExecutionResult> {
    const startTime = Date.now();

    // Get API key and optional base URL for this agent's verbindungsTyp
    const apiKey = await this.getApiKey(config.unternehmenId, this.verbindungsTyp);
    const customBaseUrl = this.verbindungsTyp === 'custom'
      ? await this.getCustomBaseUrl()
      : undefined;

    // Build prompt from context
    const prompt = this.buildPrompt(task, context);

    // Get expert details for adapter
    const expert = db.select().from(experten).where(eq(experten.id, config.expertId)).get();
    const unternehmenData = db.select().from(unternehmen).where(eq(unternehmen.id, config.unternehmenId)).get();

    if (!expert || !unternehmenData) {
      return {
        success: false,
        output: 'Expert or Unternehmen not found',
        exitCode: 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: 'Expert or Unternehmen not found',
      };
    }

    // Execute via old ExpertAdapter interface
    try {
      const result = await this.expertAdapter.run({
        expertId: config.expertId,
        expertName: expert.name,
        unternehmenId: config.unternehmenId,
        unternehmenName: unternehmenData.name,
        rolle: expert.rolle,
        faehigkeiten: expert.faehigkeiten || '',
        prompt,
        aufgaben: [`${task.titel}: ${task.beschreibung || ''}`],
        teamKontext: '',
        chatNachrichten: context.previousComments.map(c => `[${c.autorTyp}]: ${c.inhalt}`),
        apiKey,
        apiBaseUrl: customBaseUrl || process.env.VITE_API_BASE_URL || 'http://localhost:3201',
        verbindungsConfig: expert.verbindungsConfig,
        workspacePath: config.workspacePath,
        goals: context.companyContext.goals,
      });

      return {
        success: result.success,
        output: result.ausgabe,
        exitCode: result.success ? 0 : 1,
        inputTokens: result.tokenVerbrauch?.inputTokens || 0,
        outputTokens: result.tokenVerbrauch?.outputTokens || 0,
        costCents: result.tokenVerbrauch?.kostenCent || 0,
        durationMs: result.dauer,
        error: result.fehler,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        exitCode: 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  private async getApiKey(unternehmenId: string, verbindungsTyp: string): Promise<string> {
    if (verbindungsTyp === 'openrouter') {
      const e = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'openrouter_api_key')).get();
      return e ? decryptSetting('openrouter_api_key', e.wert) : '';
    }
    if (verbindungsTyp === 'claude' || verbindungsTyp === 'anthropic') {
      const e = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'anthropic_api_key')).get();
      return e ? decryptSetting('anthropic_api_key', e.wert) : '';
    }
    if (verbindungsTyp === 'openai') {
      const e = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'openai_api_key')).get();
      return e ? decryptSetting('openai_api_key', e.wert) : '';
    }
    if (verbindungsTyp === 'ollama') {
      const e = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'ollama_base_url')).get();
      return e ? e.wert : 'http://localhost:11434';
    }
    if (verbindungsTyp === 'custom') {
      const e = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'custom_api_key')).get();
      return e ? decryptSetting('custom_api_key', e.wert) : '';
    }
    return '';
  }

  private async getCustomBaseUrl(): Promise<string> {
    const e = db.select().from(einstellungen).where(eq(einstellungen.schluessel, 'custom_api_base_url')).get();
    return e?.wert || '';
  }

  private buildPrompt(task: AdapterTask, context: AdapterContext): string {
    const parts: string[] = [];
    const ac = context.agentContext as any;

    parts.push(`[UNTERNEHMEN]\nName: ${context.companyContext.name}`);
    if (context.companyContext.ziel) {
      parts.push(`Ziel: ${context.companyContext.ziel}`);
    }
    if (context.companyContext.goals && context.companyContext.goals.length > 0) {
      parts.push('Strategische Ziele:');
      for (const g of context.companyContext.goals) {
        const pct = g.fortschritt;
        const tasks = g.openTasks + g.doneTasks > 0 ? ` [${g.doneTasks}/${g.openTasks + g.doneTasks} done]` : '';
        parts.push(`  • ${g.titel} (${g.id}) — ${pct}%${tasks}`);
      }
    }
    parts.push('');

    parts.push(`[AGENT]\nName: ${context.agentContext.name}\nRolle: ${context.agentContext.rolle}`);
    if (context.agentContext.faehigkeiten) {
      parts.push(`Fähigkeiten: ${context.agentContext.faehigkeiten}`);
    }

    if (ac.advisorPlan) {
      parts.push('');
      parts.push(ac.advisorPlan);
    }

    // ── Orchestrator: Team + offene Tasks + Aktionsformat ──────────────
    if (ac.team && ac.team.length > 0) {
      parts.push('');
      parts.push('[TEAM]');
      for (const m of ac.team) {
        parts.push(`  • ${m.name} (ID: ${m.id}) — ${m.rolle} [${m.status}]`);
      }
    }

    if (ac.offeneTasks && ac.offeneTasks.length > 0) {
      parts.push('');
      parts.push('[OFFENE AUFGABEN]');
      for (const t of ac.offeneTasks) {
        const assignee = t.zugewiesenAn ? `→ ${t.zugewiesenAn}` : '→ nicht zugewiesen';
        parts.push(`  • [${t.prioritaet}] ${t.titel} (ID: ${t.id}) [${t.status}] ${assignee}`);
      }
    }

    if (ac.aktionsFormat) {
      parts.push('');
      parts.push(ac.aktionsFormat);
    }
    // ───────────────────────────────────────────────────────────────────

    parts.push('');
    parts.push(`[AUFGABE]\nTitel: ${task.titel}`);
    if (task.beschreibung) {
      parts.push(`Beschreibung:\n${task.beschreibung}`);
    }
    parts.push('');

    if (context.previousComments.length > 0) {
      parts.push('[VERLAUF]');
      for (const comment of context.previousComments) {
        parts.push(`[${comment.autorTyp}]: ${comment.inhalt}`);
      }
      parts.push('');
    }

    return parts.join('\n');
  }
}

// Factory für LLM Wrapper Adapter
export function createLLMWrapper(verbindungsTyp: string): LLMWrapperAdapter | null {
  const nameMap: Record<string, string> = {
    'openrouter': 'openrouter-wrapper',
    'anthropic': 'anthropic-wrapper',
    'claude': 'claude-wrapper',
    'openai': 'openai-wrapper',
    'ollama': 'ollama-wrapper',
    'ceo': 'ceo-wrapper',
    'custom': 'custom-wrapper',
    // CLI-Subscription-Adapter (werden direkt im Registry registriert, kein LLM-Wrapper nötig)
    // 'codex-cli' und 'gemini-cli' werden über AdapterRegistry.getAdapter() gefunden
  };

  const name = nameMap[verbindungsTyp];
  if (!name) return null;

  try {
    return new LLMWrapperAdapter(verbindungsTyp, name);
  } catch (error) {
    console.error(`Failed to create LLM wrapper for ${verbindungsTyp}:`, error);
    return null;
  }
}
