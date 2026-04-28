// Adapter Types - Gemeinsame Schnittstellen für alle Agent Adapters

export interface AdapterConfig {
  agentId: string;
  companyId: string;
  runId: string;
  timeoutMs?: number;
  /** Isolated working directory for this task — agents write files here */
  workspacePath?: string;
  /** Custom system prompt for this agent (overrides default) */
  systemPrompt?: string;
  /** Agent's connection type (openrouter, anthropic, claude-code, bash, http, openclaw, etc.) */
  connectionType?: string;
  /** Parsed connectionConfig JSON — passed through to adapters that need it (e.g. openclaw) */
  connectionConfig?: Record<string, unknown>;
  /** Global default model for LLM adapters without a specific model configured */
  globalDefaultModel?: string;
}

export interface AdapterExecutionResult {
  success: boolean;
  output: string;
  exitCode?: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  durationMs: number;
  sessionIdBefore?: string;
  sessionIdAfter?: string;
  error?: string;
}

export interface AdapterTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
}

export interface CompanyGoal {
  id: string;
  title: string;
  description: string | null;
  progress: number;
  status: string;
  openTasks: number;
  doneTasks: number;
}

export interface AdapterContext {
  task: AdapterTask;
  previousComments: Array<{
    id: string;
    content: string;
    senderType: 'agent' | 'board';
    createdAt: string;
  }>;
  companyContext: {
    name: string;
    goal: string | null;
    /** Active strategic goals with live progress */
    goals?: CompanyGoal[];
  };
  /** Context of the project this task belongs to (if any) */
  projektContext?: {
    name: string;
    description: string | null;
    workDir: string | null;
  };
  agentContext: {
    name: string;
    role: string;
    skills: string | null;
    /** Memory-Kontext (optional, wird beim Wake-Up geladen) */
    memory?: string;
    /** Letzte strategische Entscheidung des CEO (vorheriger Planungszyklus) — roter Faden */
    lastDecision?: string;
    /** Letzte Chat-Nachrichten zwischen Board und diesem Agent (Kontinuität zwischen Chat und autonomer Ausführung) */
    boardCommunication?: string;
  };
  /**
   * Rich situational context assembled specifically for OpenClaw agents.
   * Only populated when verbindungsTyp === 'openclaw'.
   */
  openclawEnrichment?: {
    /** Last 3 completed task outputs by this agent */
    recentOutputs: Array<{ taskTitle: string; output: string; completedAt: string }>;
    /** Other open tasks in the same project (so the agent sees the full scope) */
    projectSiblingTasks: Array<{ id: string; title: string; status: string; assignedTo: string | null }>;
    /** Relevant Knowledge Graph facts from OpenCognit matching the current task */
    kgFacts: Array<{ subject: string; predicate: string; object: string }>;
    /** Team members currently active/running on related work */
    activeColleagues: Array<{ name: string; role: string; currentTask: string }>;
  };
}

export interface Adapter {
  /**
   * Name des Adapters (z.B. "bash", "http", "claude-code")
   */
  name: string;

  /**
   * Prüft ob dieser Adapter für die gegebene Aufgabe zuständig ist
   */
  canHandle(task: AdapterTask): boolean;

  /**
   * Führt die Aufgabe aus und gibt das Ergebnis zurück
   */
  execute(task: AdapterTask, context: AdapterContext, config: AdapterConfig): Promise<AdapterExecutionResult>;

  /**
   * Initialisiert den Adapter (z.B. Session wiederherstellen)
   */
  initialize?(config: AdapterConfig): Promise<void>;

  /**
   * Bereinigt Ressourcen (Session speichern, etc.)
   */
  cleanup?(config: AdapterConfig): Promise<void>;
}

export type AdapterType = 'bash' | 'http' | 'claude-code' | 'cursor' | 'codex';

// ──── Expert Chat / Scheduler Adapters ────────────────────────────────────────

export interface AdapterRunOptions {
  agentId: string;
  expertName: string;
  companyId: string;
  companyName: string;
  role: string;
  skills: string;
  prompt: string;
  tasks: string[];
  teamContext: string;
  teamMembers?: Array<{ id: string; name: string; role: string }>;
  chatMessages?: string[];
  apiKey: string;
  apiBaseUrl: string;
  connectionType?: string;
  connectionConfig?: string | null;
  timeoutMs?: number;
  /** Global default model to use when agent has no specific model configured */
  globalDefaultModel?: string;
  /** Workspace directory for bash tool execution */
  workspacePath?: string;
  /** Active strategic goals with live progress */
  goals?: CompanyGoal[];
}

export interface AdapterRunResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    costCent: number;
  };
}

export interface ExpertAdapter {
  name: string;
  description: string;
  isAvailable(): Promise<boolean>;
  run(options: AdapterRunOptions): Promise<AdapterRunResult>;
}
