// LLM Adapter Wrapper - Bridge zwischen altem ExpertAdapter Interface und neuem Adapter Interface

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import { getAdapter } from './index.js';
import type { ExpertAdapter, AdapterRunOptions } from './types.js';
import { db } from '../db/client.js';
import { settings, agents, companies } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { decryptSetting } from '../utils/crypto.js';
import { CHECKPOINT_PROMPT_BLOCK } from '../services/heartbeat/checkpoint.js';

export class LLMWrapperAdapter implements Adapter {
  public readonly name: string;
  private expertAdapter: ExpertAdapter;
  private connectionType: string;

  constructor(connectionType: string, name: string) {
    this.connectionType = connectionType;
    this.name = name;
    const adapter = getAdapter(connectionType);
    if (!adapter) {
      throw new Error(`Adapter not found: ${connectionType}`);
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
    const apiKey = await this.getApiKey(config.companyId, this.connectionType, config.agentId);
    const customBaseUrl = this.connectionType === 'custom'
      ? await this.getCustomBaseUrl(config.agentId)
      : undefined;

    // Build prompt from context
    const prompt = this.buildPrompt(task, context);

    // Get expert details for adapter
    const expert = db.select().from(agents).where(eq(agents.id, config.agentId)).get();
    const unternehmenData = db.select().from(companies).where(eq(companies.id, config.companyId)).get();

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
        agentId: config.agentId,
        expertName: expert.name,
        companyId: config.companyId,
        companyName: unternehmenData.name,
        role: expert.role,
        skills: expert.skills || '',
        prompt,
        tasks: [`${task.title}: ${task.description || ''}`],
        teamContext: '',
        chatMessages: context.previousComments.map(c => `[${c.senderType}]: ${c.content}`),
        apiKey,
        apiBaseUrl: customBaseUrl || process.env.VITE_API_BASE_URL || 'http://localhost:3201',
        connectionConfig: expert.connectionConfig,
        workspacePath: config.workspacePath,
        goals: context.companyContext.goals,
      });

      return {
        success: result.success,
        output: result.output,
        exitCode: result.success ? 0 : 1,
        inputTokens: result.tokenUsage?.inputTokens || 0,
        outputTokens: result.tokenUsage?.outputTokens || 0,
        costCents: result.tokenUsage?.costCent || 0,
        durationMs: result.duration,
        error: result.error,
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

  private async getApiKey(unternehmenId: string, verbindungsTyp: string, expertId?: string): Promise<string> {
    if (verbindungsTyp === 'openrouter') {
      const e = db.select().from(settings).where(eq(settings.key, 'openrouter_api_key')).get();
      return e ? decryptSetting('openrouter_api_key', e.value) : '';
    }
    if (verbindungsTyp === 'claude' || verbindungsTyp === 'anthropic') {
      const e = db.select().from(settings).where(eq(settings.key, 'anthropic_api_key')).get();
      return e ? decryptSetting('anthropic_api_key', e.value) : '';
    }
    if (verbindungsTyp === 'openai') {
      const e = db.select().from(settings).where(eq(settings.key, 'openai_api_key')).get();
      return e ? decryptSetting('openai_api_key', e.value) : '';
    }
    if (verbindungsTyp === 'ollama') {
      const e = db.select().from(settings).where(eq(settings.key, 'ollama_base_url')).get();
      return e ? e.value : 'http://localhost:11434';
    }
    if (verbindungsTyp === 'custom') {
      // Check if agent has a named connection (connectionId in verbindungsConfig)
      if (expertId) {
        const expert = db.select().from(agents).where(eq(agents.id, expertId)).get();
        const connId = (() => { try { return JSON.parse(expert?.connectionConfig || '{}').connectionId || ''; } catch { return ''; } })();
        if (connId) {
          const connsRow = db.select().from(settings).where(eq(settings.key, 'custom_connections')).get();
          if (connsRow?.value) {
            try {
              const conns: { id: string; apiKey: string }[] = JSON.parse(decryptSetting('custom_connections', connsRow.value));
              const match = conns.find(c => c.id === connId);
              if (match?.apiKey) return match.apiKey;
            } catch {}
          }
        }
      }
      // Fallback to global custom_api_key
      const e = db.select().from(settings).where(eq(settings.key, 'custom_api_key')).get();
      return e ? decryptSetting('custom_api_key', e.value) : '';
    }
    if (verbindungsTyp === 'poe') {
      const e = db.select().from(settings).where(eq(settings.key, 'poe_api_key')).get();
      return e ? decryptSetting('poe_api_key', e.value) : '';
    }
    if (verbindungsTyp === 'google') {
      const e = db.select().from(settings).where(eq(settings.key, 'google_api_key')).get();
      return e ? decryptSetting('google_api_key', e.value) : '';
    }
    if (verbindungsTyp === 'moonshot') {
      const e = db.select().from(settings).where(eq(settings.key, 'moonshot_api_key')).get();
      return e ? decryptSetting('moonshot_api_key', e.value) : '';
    }
    return '';
  }

  private async getCustomBaseUrl(expertId?: string): Promise<string> {
    // Check if agent has a named connection with a baseUrl
    if (expertId) {
      const expert = db.select().from(agents).where(eq(agents.id, expertId)).get();
      // Per-agent baseUrl override takes priority
      const agentBaseUrl = (() => { try { return JSON.parse(expert?.connectionConfig || '{}').baseUrl || ''; } catch { return ''; } })();
      if (agentBaseUrl) return agentBaseUrl;
      // Named connection baseUrl
      const connId = (() => { try { return JSON.parse(expert?.connectionConfig || '{}').connectionId || ''; } catch { return ''; } })();
      if (connId) {
        const connsRow = db.select().from(settings).where(eq(settings.key, 'custom_connections')).get();
        if (connsRow?.value) {
          try {
            const conns: { id: string; baseUrl: string }[] = JSON.parse(decryptSetting('custom_connections', connsRow.value));
            const match = conns.find(c => c.id === connId);
            if (match?.baseUrl) return match.baseUrl;
          } catch {}
        }
      }
    }
    // Fallback to global custom_api_base_url
    const e = db.select().from(settings).where(eq(settings.key, 'custom_api_base_url')).get();
    return e?.value || '';
  }

  private buildPrompt(task: AdapterTask, context: AdapterContext): string {
    const parts: string[] = [];
    const ac = context.agentContext as any;

    parts.push(`[UNTERNEHMEN]\nName: ${context.companyContext.name}`);
    if (context.companyContext.goal) {
      parts.push(`Ziel: ${context.companyContext.goal}`);
    }
    if (context.companyContext.goals && context.companyContext.goals.length > 0) {
      parts.push('Strategische Ziele:');
      for (const g of context.companyContext.goals) {
        const pct = g.progress;
        const tasks = g.openTasks + g.doneTasks > 0 ? ` [${g.doneTasks}/${g.openTasks + g.doneTasks} done]` : '';
        parts.push(`  • ${g.title} (${g.id}) — ${pct}%${tasks}`);
      }
    }
    parts.push('');

    // Project context (injected when task belongs to a project)
    if (context.projektContext) {
      parts.push(`[PROJEKT: ${context.projektContext.name}]`);
      if (context.projektContext.description) {
        parts.push(context.projektContext.description);
      }
      if (context.projektContext.workDir) {
        parts.push(`Arbeitsverzeichnis: ${context.projektContext.workDir}`);
      }
      parts.push('');
    }

    parts.push(`[AGENT]\nName: ${context.agentContext.name}\nRolle: ${context.agentContext.role}`);
    if (context.agentContext.skills) {
      parts.push(`Fähigkeiten: ${context.agentContext.skills}`);
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
        parts.push(`  • ${m.name} (ID: ${m.id}) — ${m.role} [${m.status}]`);
      }
    }

    if (ac.offeneTasks && ac.offeneTasks.length > 0) {
      parts.push('');
      parts.push('[OFFENE AUFGABEN]');
      for (const t of ac.offeneTasks) {
        const assignee = t.assignedTo ? `→ ${t.assignedTo}` : '→ nicht zugewiesen';
        parts.push(`  • [${t.priority}] ${t.title} (ID: ${t.id}) [${t.status}] ${assignee}`);
      }
    }

    if (ac.aktionsFormat) {
      parts.push('');
      parts.push(ac.aktionsFormat);
    }
    // ───────────────────────────────────────────────────────────────────

    parts.push('');
    parts.push(`[AUFGABE]\nTitel: ${task.title}`);
    if (task.description) {
      parts.push(`Beschreibung:\n${task.description}`);
    }
    parts.push('');

    if (context.previousComments.length > 0) {
      parts.push('[VERLAUF]');
      for (const comment of context.previousComments) {
        parts.push(`[${comment.senderType}]: ${comment.content}`);
      }
      parts.push('');
    }

    parts.push(CHECKPOINT_PROMPT_BLOCK);

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
    'poe': 'poe-wrapper',
    'google': 'google-wrapper',
    'moonshot': 'moonshot-wrapper',
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
