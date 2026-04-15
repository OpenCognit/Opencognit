// Adapter Types - Gemeinsame Schnittstellen für alle Agent Adapters

export interface AdapterConfig {
  expertId: string;
  unternehmenId: string;
  runId: string;
  timeoutMs?: number;
  /** Isolated working directory for this task — agents write files here */
  workspacePath?: string;
  /** Custom system prompt for this agent (overrides default) */
  systemPrompt?: string;
  /** Agent's connection type (openrouter, anthropic, claude-code, bash, http, etc.) */
  verbindungsTyp?: string;
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
  titel: string;
  beschreibung: string | null;
  status: string;
  prioritaet: string;
}

export interface CompanyGoal {
  id: string;
  titel: string;
  beschreibung: string | null;
  fortschritt: number;
  status: string;
  openTasks: number;
  doneTasks: number;
}

export interface AdapterContext {
  task: AdapterTask;
  previousComments: Array<{
    id: string;
    inhalt: string;
    autorTyp: 'agent' | 'board';
    erstelltAm: string;
  }>;
  companyContext: {
    name: string;
    ziel: string | null;
    /** Active strategic goals with live progress */
    goals?: CompanyGoal[];
  };
  agentContext: {
    name: string;
    rolle: string;
    faehigkeiten: string | null;
    /** Memory-Kontext (optional, wird beim Wake-Up geladen) */
    gedaechtnis?: string;
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
  expertId: string;
  expertName: string;
  unternehmenId: string;
  unternehmenName: string;
  rolle: string;
  faehigkeiten: string;
  prompt: string;
  aufgaben: string[];
  teamKontext: string;
  teamMitglieder?: Array<{ id: string; name: string; rolle: string }>;
  chatNachrichten?: string[];
  apiKey: string;
  apiBaseUrl: string;
  verbindungsTyp?: string;
  verbindungsConfig?: string | null;
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
  ausgabe: string;
  fehler?: string;
  dauer: number;
  tokenVerbrauch?: {
    inputTokens: number;
    outputTokens: number;
    kostenCent: number;
  };
}

export interface ExpertAdapter {
  name: string;
  beschreibung: string;
  isAvailable(): Promise<boolean>;
  run(options: AdapterRunOptions): Promise<AdapterRunResult>;
}
