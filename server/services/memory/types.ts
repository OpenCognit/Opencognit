// =============================================================================
// MemoryService — unified API for agent memory.
//
// Inspired by Cognee's `remember / recall / forget / improve` shape, but
// implemented as a thin facade over our existing services (palace_*,
// learnedSkills, semantic-memory). The point isn't to introduce a new
// memory backend — it's to give consumers ONE entry point so they don't
// have to know which underlying store holds what.
// =============================================================================

// ── Recall ───────────────────────────────────────────────────────────────────

export interface RecallParams {
  /** The agent doing the recall (used for palace + per-agent skills). */
  agentId: string;
  /** Company scope (used for cross-agent learned skills + KG). */
  companyId: string;
  /**
   * Free-text query used to rank/filter memory entries. Typically the task
   * title + description, but could be any natural-language anchor.
   */
  query: string;
  /**
   * Pre-tokenized keywords. If omitted, derived from `query`. Provided for
   * the legacy palace-memory path which expects a pre-built keyword list.
   */
  keywords?: string[];
  /** Restrict which backends contribute. Defaults: all true. */
  scope?: {
    palace?: boolean;
    learnedSkills?: boolean;
    semantic?: boolean;
  };
  /** Per-source limits. */
  limits?: {
    learnedSkills?: number;
  };
}

export interface RecallResult {
  /**
   * Combined Markdown block, ready to drop into a system prompt. Empty
   * string when no source produced anything.
   */
  contextMarkdown: string;
  /** What each source contributed — useful for observability + debugging. */
  sources: {
    palaceContext: boolean;
    learnedSkills: number;
  };
}

// ── Remember ─────────────────────────────────────────────────────────────────

export interface RememberParams {
  agentId: string;
  companyId: string;
  /** Raw agent output / message — extractor decides what to keep. */
  output: string;
  /** Human-readable title for the source event (task title, meeting title…). */
  title: string;
  taskId?: string;
  runId?: string;
  /**
   * What kind of event triggered this. Affects which extractor runs:
   * - 'task_done'      → autoSaveInsights + queue learned-skill extraction
   * - 'meeting_result' → saveMeetingResult fan-out
   * - 'manual'         → just store, no extraction
   */
  kind: 'task_done' | 'meeting_result' | 'manual';
}

// ── Forget ───────────────────────────────────────────────────────────────────

export type ForgetTarget =
  | { type: 'learnedSkill'; id: string }
  | { type: 'palaceDrawer'; id: string }
  | { type: 'palaceDiary'; id: string }
  | { type: 'kgFact'; id: string };

// ── Improve ──────────────────────────────────────────────────────────────────

export interface ImproveParams {
  companyId: string;
  /** Limit the consolidation pass to specific subsystems. Defaults: all. */
  scope?: {
    wings?: boolean;
    learnedSkills?: boolean;
  };
}

export interface ImproveResult {
  consolidatedWings: number;
  /** Reserved for future learned-skill dedup pass. */
  deduplicatedSkills: number;
}
