// Claude Code Adapter - Ruft Claude Code CLI auf

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { resolveAgentWorkdir, SAFE_DEFAULT_WORKDIR } from './workspace-guard.js';
import { resolveCliPath } from './cli-paths.js';
import { CHECKPOINT_PROMPT_BLOCK } from '../services/heartbeat/checkpoint.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve data/sessions relative to the repo root (two levels up from server/adapters/)
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const execAsync = promisify(exec);

export interface ClaudeCodeAdapterOptions {
  claudePath?: string; // Pfad zur claude CLI
  maxTokens?: number;
  model?: string;
  systemPrompt?: string;
  workingDir?: string;
  maxExecutionTimeMs?: number;
}

interface SessionData {
  conversationHistory: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
  }>;
  context?: Record<string, any>;
}

// ── Global execution lock — serializes all claude-code agent runs (single subscription) ──
// Multiple agents share one Claude Pro/Max account → only one CLI call at a time.
// Chat calls (Telegram / direct chat) use a SEPARATE lock so they never block agents.
const AGENT_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 min max wait — prevents deadlock

let agentLockBusy = false;
const agentLockQueue: Array<{ resolve: () => void; timer: NodeJS.Timeout }> = [];

let chatLockBusy = false;
const chatLockQueue: Array<{ resolve: () => void; timer: NodeJS.Timeout }> = [];

function makeLock(busy: () => boolean, setBusy: (v: boolean) => void, queue: Array<{ resolve: () => void; timer: NodeJS.Timeout }>, label: string) {
  const acquire = (): Promise<void> => {
    if (!busy()) {
      setBusy(true);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = queue.findIndex(e => e.resolve === resolve);
        if (idx !== -1) queue.splice(idx, 1);
        console.error(`⚠️ [claude-code] ${label} lock timeout after ${AGENT_LOCK_TIMEOUT_MS / 1000}s — forcing release`);
        reject(new Error(`CLI lock timeout (${label})`));
      }, AGENT_LOCK_TIMEOUT_MS);
      queue.push({ resolve, timer });
    });
  };

  const release = (): void => {
    const next = queue.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve();
    } else {
      setBusy(false);
    }
  };

  return { acquire, release };
}

const agentLock = makeLock(
  () => agentLockBusy,
  (v) => { agentLockBusy = v; },
  agentLockQueue,
  'agent'
);

const chatLock = makeLock(
  () => chatLockBusy,
  (v) => { chatLockBusy = v; },
  chatLockQueue,
  'chat'
);

// Legacy names — adapter's execute() uses agent lock, runClaudeDirectChat uses chat lock
const acquireCliLock  = agentLock.acquire;
const releaseCliLock  = agentLock.release;
// ─────────────────────────────────────────────────────────────────────────────

export class ClaudeCodeAdapter implements Adapter {
  public readonly name = 'claude-code';
  private options: ClaudeCodeAdapterOptions;
  private sessionDir: string;

  constructor(options: ClaudeCodeAdapterOptions = {}) {
    this.options = {
      claudePath: options.claudePath || resolveCliPath('claude', undefined, 'claude'),
      maxTokens: options.maxTokens || 4096,
      model: options.model || 'claude-sonnet-4-6',
      systemPrompt: options.systemPrompt || this.getDefaultSystemPrompt(),
      workingDir: options.workingDir || SAFE_DEFAULT_WORKDIR,
      maxExecutionTimeMs: options.maxExecutionTimeMs || 10 * 60 * 1000, // 10 Minuten
    };
    this.sessionDir = path.join(REPO_ROOT, 'data', 'sessions');
    
    // Ensure session directory exists
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private getDefaultSystemPrompt(workspaceDir?: string): string {
    const workspaceLine = workspaceDir
      ? `\n\nWORKSPACE CONSTRAINT (mandatory): You may only read and write files inside your assigned workspace:\n  ${workspaceDir}\nDo NOT create files outside this directory. Use only relative paths or paths starting with this workspace root.`
      : '';
    return `You are an autonomous AI agent in the OpenCognit system.
Your tasks:
1. Carefully analyse the assigned task
2. Use available tools to solve it
3. Document your steps clearly
4. Report success or failure unambiguously

Respond in the language of the task (German if the task is in German, English if in English).${workspaceLine}`;
  }

  canHandle(task: AdapterTask): boolean {
    // Claude Code Adapter ist der "default" Adapter für komplexe Aufgaben
    // Er ist zuständig wenn kein anderer spezifischer Adapter passt
    const text = `${task.title} ${task.description || ''}`.toLowerCase();
    
    // Nicht zuständig für reine Bash/HTTP Tasks (die haben ihre eigenen Adapter)
    if (text.includes('bash') || text.includes('shell') || 
        text.includes('http') || text.includes('api ') || text.includes('webhook')) {
      return false;
    }

    // Zuständig für Analyse-, Coding-, Text-, Recherche-Aufgaben
    return text.includes('analys') || 
           text.includes('code') ||
           text.includes('schreibe') || 
           text.includes('erstelle') ||
           text.includes('prüfe') ||
           text.includes('suche') ||
           text.includes('research') ||
           text.includes('generate') ||
           text.includes('refactor') ||
           text.includes('test') ||
           text.includes('bug') ||
           text.includes('feature') ||
           text.includes('implement') ||
           true; // Default fallback - Claude Code kann fast alles
  }

  async execute(
    task: AdapterTask,
    context: AdapterContext,
    config: AdapterConfig
  ): Promise<AdapterExecutionResult> {
    const startTime = Date.now();
    const sessionId = `${config.companyId}-${config.agentId}-${config.runId}`;
    const sessionFile = path.join(this.sessionDir, `${sessionId}.json`);

    // Load previous session if exists
    let sessionData: SessionData | null = null;
    if (fs.existsSync(sessionFile)) {
      try {
        sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      } catch {
        sessionData = null;
      }
    }

    // Resolve workspace once — used for cwd and injected into the prompt
    const resolvedWorkdir = resolveAgentWorkdir(config.workspacePath, this.options.workingDir);

    // Build the prompt
    const prompt = this.buildPrompt(task, context, sessionData, resolvedWorkdir);

    // Write prompt to temp file — avoids shell injection and arg-length limits
    const tmpFile = path.join(this.sessionDir, `prompt_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt, 'utf-8');

    // ── Acquire global lock — only one claude CLI process at a time ──────────
    console.log(`⏳ [claude-code] Warte auf CLI-Lock für ${config.agentId}...`);
    await acquireCliLock();
    console.log(`🔒 [claude-code] CLI-Lock erworben für ${config.agentId}`);
    // ─────────────────────────────────────────────────────────────────────────

    try {
      // Claude Code non-interactive mode: -p reads from stdin, --output-format text = clean output
      const cmd = [
        `"${this.options.claudePath}"`,
        `-p`,
        `--model ${this.options.model}`,
        `--output-format text`,
        `--dangerously-skip-permissions`,
      ].join(' ') + ` < "${tmpFile}"`;

      // Ensure ~/.local/bin is in PATH so claude CLI is found regardless of how server was started
      const home = process.env.HOME || process.env.USERPROFILE || '';
      const localBin = `${home}/.local/bin`;
      const currentPath = process.env.PATH || '';
      const enrichedPath = currentPath.includes(localBin) ? currentPath : `${localBin}:${currentPath}`;

      const { stdout, stderr } = await execAsync(cmd, {
          shell: '/bin/sh',
          cwd: resolvedWorkdir,
          timeout: this.options.maxExecutionTimeMs,
          env: {
            ...process.env,
            PATH: enrichedPath,
            OPENCOGNIT_EXPERT_ID: config.agentId,
            OPENCOGNIT_UNTERNEHMEN_ID: config.companyId,
            OPENCOGNIT_RUN_ID: config.runId,
            OPENCOGNIT_WORKSPACE: resolvedWorkdir,
            CLAUDE_CODE_ENTRYPOINT: 'opencognit',
          },
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        }
      );

      const output = stdout?.trim() || stderr?.trim() || 'Keine Ausgabe';
      
      // Estimate tokens (rough approximation)
      const inputTokens = Math.ceil(prompt.length / 4);
      const outputTokens = Math.ceil(output.length / 4);
      
      // Estimate cost (Claude Sonnet: ~$0.30/1M input, ~$1.50/1M output)
      const costCents = Math.round((inputTokens * 0.00003) + (outputTokens * 0.00015));

      // Save session for continuity
      this.saveSession(sessionFile, prompt, output);
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }

      return {
        success: true,
        output,
        exitCode: 0,
        inputTokens,
        outputTokens,
        costCents,
        durationMs: Date.now() - startTime,
        sessionIdBefore: sessionData ? sessionId : undefined,
        sessionIdAfter: sessionId,
      };
    } catch (error: any) {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      // Save partial session even on error
      if (prompt) {
        this.saveSession(sessionFile, prompt, error.message || 'Error occurred');
      }

      return {
        success: false,
        output: error.stderr || error.stdout || error.message,
        exitCode: error.exitCode || 1,
        inputTokens: Math.ceil((prompt || '').length / 4),
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: error.message,
        sessionIdBefore: sessionData ? sessionId : undefined,
        sessionIdAfter: sessionId,
      };
    } finally {
      releaseCliLock();
      console.log(`🔓 [claude-code] CLI-Lock freigegeben für ${config.agentId}`);
    }
  }

  private buildPrompt(task: AdapterTask, context: AdapterContext, sessionData: SessionData | null, workspaceDir?: string): string {
    const parts: string[] = [];

    // System prompt (includes workspace constraint when available)
    const sysPrompt = workspaceDir
      ? this.getDefaultSystemPrompt(workspaceDir)
      : (this.options.systemPrompt ?? this.getDefaultSystemPrompt());
    parts.push(`[SYSTEM]\n${sysPrompt}\n`);

    // Company context
    parts.push(`[UNTERNEHMEN]\nName: ${context.companyContext.name}`);
    if (context.companyContext.goal) {
      parts.push(`Ziel: ${context.companyContext.goal}`);
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

    // Agent context
    parts.push(`[AGENT]\nName: ${context.agentContext.name}\nRolle: ${context.agentContext.role}`);
    if (context.agentContext.skills) {
      parts.push(`Fähigkeiten: ${context.agentContext.skills}`);
    }
    parts.push('');

    // Memory Kontext (persistentes Langzeit-Gedächtnis)
    if (context.agentContext.memory) {
      parts.push('[MEIN GEDÄCHTNIS — Memory Wing]');
      parts.push(context.agentContext.memory);
      parts.push('');
    }

    // 🧭 Letzte strategische Entscheidung — roter Faden für den CEO
    if ((context.agentContext as any).lastDecision) {
      parts.push('[DEINE LETZTE STRATEGISCHE ENTSCHEIDUNG]');
      parts.push((context.agentContext as any).lastDecision);
      parts.push('Baue darauf auf. Vermeide Widersprüche zu vorherigen Entscheidungen ohne explizite Begründung.');
      parts.push('');
    }

    // 💬 Letzte Chat-Nachrichten (Board ↔ Agent) — Kontinuität zwischen Chat und autonomer Ausführung
    if ((context.agentContext as any).boardCommunication) {
      parts.push('[LETZTE KOMMUNIKATION MIT DEM BOARD]');
      parts.push((context.agentContext as any).boardCommunication);
      parts.push('Beachte diesen Kontext bei deiner Arbeit — handle konsistent mit dem was im Chat besprochen wurde.');
      parts.push('');
    }

    // 🧠 Advisor Plan Integration
    if ((context.agentContext as any).advisorPlan) {
      parts.push((context.agentContext as any).advisorPlan);
      parts.push('');
    }

    // ── Orchestrator: Team + offene Tasks + Aktionsformat ──────────────
    const ac = context.agentContext as any;
    if (ac.team && ac.team.length > 0) {
      parts.push('[TEAM]');
      for (const m of ac.team) {
        parts.push(`  • ${m.name} (ID: ${m.id}) — ${m.role} [${m.status}]`);
      }
      parts.push('');
    }
    if (ac.offeneTasks && ac.offeneTasks.length > 0) {
      parts.push('[OFFENE AUFGABEN]');
      for (const t of ac.offeneTasks) {
        const assignee = t.assignedTo ? `→ ${t.assignedTo}` : '→ nicht zugewiesen';
        parts.push(`  • [${t.priority}] ${t.title} (ID: ${t.id}) [${t.status}] ${assignee}`);
      }
      parts.push('');
    }
    if (ac.aktionsFormat) {
      parts.push(ac.aktionsFormat);
      parts.push('');
    }
    // ───────────────────────────────────────────────────────────────────

    // Task
    parts.push(`[AUFGABE]\nTitel: ${task.title}`);
    if (task.description) {
      parts.push(`Beschreibung:\n${task.description}`);
    }
    if (task.priority) {
      parts.push(`Priorität: ${task.priority}`);
    }
    parts.push('');

    // Previous comments (conversation history)
    if (context.previousComments.length > 0) {
      parts.push('[VERLAUF]');
      for (const comment of context.previousComments) {
        parts.push(`[${comment.senderType}]: ${comment.content}`);
      }
      parts.push('');
    }

    // Previous session context
    if (sessionData && sessionData.conversationHistory.length > 0) {
      parts.push('[VORHERIGE KONVERSATION]');
      for (const msg of sessionData.conversationHistory.slice(-10)) {
        parts.push(`[${msg.role}]: ${msg.content}`);
      }
      parts.push('');
    }

    // Instructions with memory tag hint — must match format parsed by memory-auto.ts
    parts.push('[ANWEISUNG]\nBearbeite die obenstehende Aufgabe. Antworte strukturiert und klar.\n\nOptional: Nutze [REMEMBER:raum] Tags um Wissen dauerhaft zu speichern:\n[REMEMBER:projekt] laufendes Projekt, Ziele, Deadlines\n[REMEMBER:erkenntnisse] gelernte Fakten, API-Details, Lösungen\n[REMEMBER:entscheidungen] Entscheidungen und ihre Begründung\n[REMEMBER:kontakte] Ansprechpartner, Zugangsdaten\n[REMEMBER:fehler] bekannte Probleme und Workarounds\n[REMEMBER:kg] {"subject": "Ich", "predicate": "arbeite_an", "object": "Projektname"}\nDer Inhalt nach dem Tag wird direkt ins Langzeitgedächtnis gespeichert.');

    parts.push(CHECKPOINT_PROMPT_BLOCK);

    return parts.join('\n');
  }


  private saveSession(sessionFile: string, prompt: string, output: string): void {
    try {
      let sessionData: SessionData = {
        conversationHistory: [],
        context: {},
      };

      if (fs.existsSync(sessionFile)) {
        sessionData = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      }

      sessionData.conversationHistory.push(
        { role: 'user', content: prompt, timestamp: new Date().toISOString() },
        { role: 'assistant', content: output, timestamp: new Date().toISOString() }
      );

      // Keep last 50 messages to avoid huge files
      sessionData.conversationHistory = sessionData.conversationHistory.slice(-50);

      fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  }

  private escapeShell(str: string): string {
    return str.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
  }

  async cleanup(_config: AdapterConfig): Promise<void> {
    // Remove session files older than 7 days to prevent unbounded accumulation
    const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
    try {
      const files = fs.readdirSync(this.sessionDir);
      const cutoff = Date.now() - SESSION_TTL_MS;
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(this.sessionDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ [claude-code] Removed stale session file: ${file}`);
        }
      }
    } catch (e: any) {
      console.error('[claude-code] Session cleanup error:', e.message);
    }
  }
}

export const createClaudeCodeAdapter = (options?: ClaudeCodeAdapterOptions) => new ClaudeCodeAdapter(options);

/**
 * Runs a direct chat prompt through the Claude CLI.
 * Uses a SEPARATE chat lock (independent of the agent execution lock) so Telegram/
 * in-app chat never blocks or is blocked by autonomous agent task execution.
 * Used by the /chat/direct endpoint and Telegram chatWithLLM for claude-code agents.
 */
export async function runClaudeDirectChat(prompt: string, expertId: string): Promise<string> {
  const sessionDir = path.join(REPO_ROOT, 'data', 'sessions');
  if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

  const tmpFile = path.join(sessionDir, `chat_${Date.now()}_${expertId.slice(0, 8)}.txt`);
  fs.writeFileSync(tmpFile, prompt, 'utf-8');

  console.log(`⏳ [claude-code chat] Warte auf Chat-Lock für ${expertId}...`);
  await chatLock.acquire();
  console.log(`🔒 [claude-code chat] Chat-Lock erworben für ${expertId}`);

  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const localBin = `${home}/.local/bin`;
    const currentPath = process.env.PATH || '';
    const enrichedPath = currentPath.includes(localBin) ? currentPath : `${localBin}:${currentPath}`;

    const { stdout, stderr } = await execAsync(
      `${resolveCliPath('claude', undefined, 'claude')} -p --output-format text --dangerously-skip-permissions < "${tmpFile}"`,
      {
        shell: '/bin/sh',
        cwd: SAFE_DEFAULT_WORKDIR,
        timeout: 5 * 60 * 1000,
        env: {
          ...process.env,
          PATH: enrichedPath,
          OPENCOGNIT_EXPERT_ID: expertId,
          CLAUDE_CODE_ENTRYPOINT: 'opencognit_chat',
          OPENCOGNIT_WORKSPACE: SAFE_DEFAULT_WORKDIR,
        },
        maxBuffer: 5 * 1024 * 1024,
      }
    );

    return stdout?.trim() || stderr?.trim() || '(keine Antwort)';
  } finally {
    chatLock.release();
    console.log(`🔓 [claude-code chat] Chat-Lock freigegeben für ${expertId}`);
    try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}
