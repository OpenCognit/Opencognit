// =============================================================================
// MemoryService — implementation.
//
// This is a thin facade over the existing memory subsystems:
//   - palace_*  (per-agent wing/drawer/diary memory)  → memory-auto.ts
//   - learnedSkills (cross-agent recipes)              → learned-skills.ts
//   - memory consolidation (improve)                   → memory-consolidation.ts
//
// We don't move logic here yet — the goal of this PR is to give consumers
// ONE entry point. The wrapped functions stay exported from their original
// modules so anything we haven't migrated yet keeps working.
// =============================================================================

import { db } from '../../db/client.js';
import {
  palaceWings, palaceDrawers, palaceDiary, palaceKg, learnedSkills,
} from '../../db/schema.js';
import { eq } from 'drizzle-orm';

import {
  loadRelevantMemory,
  autoSaveInsights,
  saveMeetingResult,
} from '../memory-auto.js';
import {
  findRelevantLearnedSkills,
  formatLearnedSkillsForPrompt,
  markLearnedSkillsUsed,
  extractAndStoreLearnedSkill,
} from '../learned-skills.js';
import { consolidateAll } from '../memory-consolidation.js';

import type {
  RecallParams, RecallResult,
  RememberParams,
  ForgetTarget,
  ImproveParams, ImproveResult,
} from './types.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function deriveKeywords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 4);
}

// ── Public API ──────────────────────────────────────────────────────────────

export const memoryService = {
  /**
   * Recall — combines palace memory + learned skills into one ready-to-inject
   * Markdown block. Auto-routes between sources unless caller restricts via
   * `scope`.
   */
  async recall(params: RecallParams): Promise<RecallResult> {
    const {
      agentId, companyId, query,
      keywords = deriveKeywords(query),
      scope = {},
      limits = {},
    } = params;
    const wantPalace        = scope.palace        ?? true;
    const wantLearnedSkills = scope.learnedSkills ?? true;
    const learnedLimit      = limits.learnedSkills ?? 3;

    const blocks: string[] = [];
    const sources = { palaceContext: false, learnedSkills: 0 };

    // 1. Palace memory (per-agent personal store)
    if (wantPalace) {
      try {
        const palaceMd = loadRelevantMemory(agentId, keywords);
        if (palaceMd && palaceMd.trim()) {
          blocks.push(palaceMd);
          sources.palaceContext = true;
        }
      } catch (e: any) {
        console.warn(`[memory.recall] palace load failed: ${e?.message}`);
      }
    }

    // 2. Learned skills (cross-agent reusable recipes)
    if (wantLearnedSkills) {
      try {
        // findRelevantLearnedSkills expects task title + description; fall back
        // to the raw query string when caller didn't split them up.
        const relevant = findRelevantLearnedSkills({
          companyId,
          taskTitle: query,
          taskDescription: null,
          limit: learnedLimit,
        });
        if (relevant.length > 0) {
          blocks.push(formatLearnedSkillsForPrompt(relevant, false));
          markLearnedSkillsUsed(relevant.map(s => s.id));
          sources.learnedSkills = relevant.length;
        }
      } catch (e: any) {
        console.warn(`[memory.recall] learned-skills retrieval failed: ${e?.message}`);
      }
    }

    return {
      contextMarkdown: blocks.join('\n\n'),
      sources,
    };
  },

  /**
   * Remember — capture the result of an event. Fire-and-forget; never throws.
   *
   * For `task_done` we additionally queue an async learned-skill extraction
   * so the heartbeat critical path stays fast.
   */
  async remember(params: RememberParams): Promise<void> {
    const { agentId, companyId, output, title, taskId, runId, kind } = params;

    try {
      if (kind === 'task_done' || kind === 'manual') {
        await autoSaveInsights(agentId, companyId, output, title);
      }
    } catch (e: any) {
      console.warn(`[memory.remember] autoSaveInsights failed: ${e?.message}`);
    }

    // Background learned-skill extraction (don't block the caller)
    if (kind === 'task_done' && taskId && runId) {
      extractAndStoreLearnedSkill({ runId, taskId, agentId, companyId })
        .catch(e => console.warn(`[memory.remember] learned-skill extract failed: ${e?.message}`));
    }
  },

  /**
   * Remember-meeting variant — fans out the result to every participant's wing.
   * Kept as a separate method because the legacy signature is markedly
   * different (per-participant payload structure).
   */
  async rememberMeeting(opts: {
    meetingId: string;
    question: string;
    responses: Record<string, string>;
    participantIds: string[];
    organizerAgentId: string;
    companyId: string;
  }): Promise<void> {
    try {
      await saveMeetingResult(
        opts.meetingId,
        opts.question,
        opts.responses,
        opts.participantIds,
        opts.organizerAgentId,
        opts.companyId,
      );
    } catch (e: any) {
      console.warn(`[memory.rememberMeeting] failed: ${e?.message}`);
    }
  },

  /**
   * Forget — remove a single memory entry by type + id. Idempotent.
   */
  async forget(target: ForgetTarget): Promise<void> {
    try {
      switch (target.type) {
        case 'learnedSkill':
          db.delete(learnedSkills).where(eq(learnedSkills.id, target.id)).run();
          return;
        case 'palaceDrawer':
          db.delete(palaceDrawers).where(eq(palaceDrawers.id, target.id)).run();
          return;
        case 'palaceDiary':
          db.delete(palaceDiary).where(eq(palaceDiary.id, target.id)).run();
          return;
        case 'kgFact':
          db.delete(palaceKg).where(eq(palaceKg.id, target.id)).run();
          return;
      }
    } catch (e: any) {
      console.warn(`[memory.forget] ${target.type}/${target.id} failed: ${e?.message}`);
    }
  },

  /**
   * Improve — periodic background consolidation (per-wing summarization).
   * Designed to be called from the cron service, NOT from the heartbeat path.
   */
  async improve(params: ImproveParams): Promise<ImproveResult> {
    const { companyId, scope = {} } = params;
    const wantWings = scope.wings ?? true;

    let consolidatedWings = 0;
    if (wantWings) {
      // Count wings touched by counting wings that exist for this company —
      // consolidateAll iterates internally and only consolidates when needed.
      const wingCount = db.select().from(palaceWings)
        .where(eq(palaceWings.companyId, companyId)).all().length;
      try {
        await consolidateAll(companyId);
        consolidatedWings = wingCount;
      } catch (e: any) {
        console.warn(`[memory.improve] consolidateAll failed: ${e?.message}`);
      }
    }

    // learned-skills dedup pass is intentionally a no-op for this PR; will land
    // in the next memory PR alongside an explicit dedup heuristic.
    return { consolidatedWings, deduplicatedSkills: 0 };
  },
} as const;

export type MemoryService = typeof memoryService;
