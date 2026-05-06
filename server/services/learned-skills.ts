// Learned Skills — auto-extracted recipes from successful work cycles.
// Hermes-inspired skill compounding, but cross-agent (company-wide) instead of single-agent.
//
// Flow:
//  1. After a task transitions to 'done' AND the critic approved AND the run succeeded,
//     we extract a learned skill from { task, output, files_changed, agent }.
//  2. Extraction is currently heuristic (deterministic, no LLM cost). The schema reserves
//     extractedBy='llm' for a future opt-in path that uses the orchestrator's LLM to
//     polish the recipe.
//  3. On the next task, the heartbeat context-builder retrieves the top-N matching
//     learned skills via keyword overlap and injects them into the agent's prompt.
//  4. When a skill is injected, useCount/lastUsedAt are bumped so the UI can sort by
//     popularity and the user can prune stale ones.

import { db } from '../db/client.js';
import { learnedSkills, tasks, agents, workCycles, taskCheckpoints } from '../db/schema.js';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// ── Keyword extraction ───────────────────────────────────────────────────────
// Strip very short / very common words; keep meaningful tokens for retrieval.
const STOPWORDS = new Set([
  // EN
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'has', 'are', 'was',
  'were', 'will', 'would', 'should', 'could', 'into', 'task', 'tasks', 'about',
  'when', 'then', 'than', 'them', 'they', 'their', 'there', 'where', 'which',
  'while', 'after', 'before', 'over', 'such', 'some', 'each', 'also', 'just',
  'make', 'made', 'use', 'using', 'used', 'need', 'needs', 'work', 'works',
  // DE
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einer',
  'und', 'oder', 'aber', 'auch', 'aus', 'bei', 'für', 'mit', 'von', 'zu',
  'ist', 'sind', 'war', 'waren', 'wird', 'werden', 'wurde', 'soll', 'sollte',
  'kann', 'könnte', 'muss', 'müssen', 'noch', 'nicht', 'nur', 'doch', 'sehr',
  'aufgabe', 'aufgaben', 'task', 'arbeit', 'tun', 'mache', 'machen',
]);

function extractKeywords(text: string, max = 12): string[] {
  if (!text) return [];
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 4 && !STOPWORDS.has(t));
  // Frequency-rank, then keep top-N unique
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

// ── Heuristic extraction ─────────────────────────────────────────────────────
function buildHeuristicSkill(args: {
  taskTitle: string;
  taskDescription: string | null;
  output: string | null;
  filesChanged: string[];
  agentName: string | null;
}): { title: string; pattern: string; recipe: string; keywords: string[] } | null {
  const { taskTitle, taskDescription, output, filesChanged, agentName } = args;
  if (!taskTitle || taskTitle.length < 4) return null;

  const desc = taskDescription || '';
  const out = (output || '').slice(0, 1500);
  const fileBlock = filesChanged.length > 0
    ? `\n\nFiles touched:\n${filesChanged.slice(0, 10).map(f => `  - ${f}`).join('\n')}`
    : '';

  const title = taskTitle.length > 80 ? taskTitle.slice(0, 77) + '…' : taskTitle;
  const pattern = desc
    ? desc.slice(0, 240).replace(/\s+/g, ' ').trim()
    : `Tasks similar to "${taskTitle}"`;
  const recipe = (out
    ? `Previous successful approach (by ${agentName || 'an agent'}):\n\n${out}`
    : `${agentName || 'An agent'} completed this task successfully.`) + fileBlock;

  const kw = extractKeywords(`${taskTitle} ${desc} ${filesChanged.join(' ')}`);
  return { title, pattern, recipe, keywords: kw };
}

// ── Dedup ────────────────────────────────────────────────────────────────────
// If a near-duplicate skill already exists (≥3 keyword overlap), bump its
// confidence + useCount instead of inserting a separate row. Prevents the table
// from filling up with copies of the same recurring task.
function findDuplicate(companyId: string, keywords: string[]): { id: string; confidence: number } | null {
  if (keywords.length < 3) return null;
  const candidates = db.select({
    id: learnedSkills.id,
    keywords: learnedSkills.keywords,
    confidence: learnedSkills.confidence,
  }).from(learnedSkills)
    .where(and(eq(learnedSkills.companyId, companyId), eq(learnedSkills.isDisabled, false)))
    .all();

  for (const c of candidates) {
    let existing: string[] = [];
    try { existing = JSON.parse(c.keywords || '[]'); } catch {}
    const overlap = keywords.filter(k => existing.includes(k)).length;
    if (overlap >= 3) return { id: c.id, confidence: c.confidence };
  }
  return null;
}

// ── Public: extract and store ────────────────────────────────────────────────
export async function extractAndStoreLearnedSkill(opts: {
  runId: string;
  taskId: string;
  agentId: string;
  companyId: string;
}): Promise<{ created: boolean; updated?: boolean; skillId?: string; reason?: string }> {
  const { runId, taskId, agentId, companyId } = opts;

  // Fetch source data
  const taskRow = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!taskRow) return { created: false, reason: 'task_not_found' };

  const runRow = db.select().from(workCycles).where(eq(workCycles.id, runId)).get();
  const agentRow = db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId)).get();

  // Files changed: from latest checkpoint of this run (if any)
  let filesChanged: string[] = [];
  const checkpoint = db.select({ filesChanged: taskCheckpoints.filesChanged })
    .from(taskCheckpoints)
    .where(eq(taskCheckpoints.runId, runId))
    .orderBy(desc(taskCheckpoints.createdAt))
    .limit(1)
    .get();
  if (checkpoint?.filesChanged) {
    try { filesChanged = JSON.parse(checkpoint.filesChanged); } catch {}
  }

  const built = buildHeuristicSkill({
    taskTitle: taskRow.title,
    taskDescription: taskRow.description,
    output: runRow?.output ?? null,
    filesChanged,
    agentName: agentRow?.name ?? null,
  });
  if (!built) return { created: false, reason: 'extract_failed' };

  // Dedup
  const dup = findDuplicate(companyId, built.keywords);
  if (dup) {
    const newConfidence = Math.min(100, dup.confidence + 5);
    db.update(learnedSkills)
      .set({ confidence: newConfidence, updatedAt: new Date().toISOString() })
      .where(eq(learnedSkills.id, dup.id))
      .run();
    return { created: false, updated: true, skillId: dup.id };
  }

  // Insert
  const id = uuid();
  const now = new Date().toISOString();
  db.insert(learnedSkills).values({
    id,
    companyId,
    sourceAgentId: agentId,
    sourceTaskId: taskId,
    sourceRunId: runId,
    title: built.title,
    pattern: built.pattern,
    recipe: built.recipe,
    keywords: JSON.stringify(built.keywords),
    confidence: 50,
    useCount: 0,
    isPinned: false,
    isDisabled: false,
    extractedBy: 'heuristic',
    createdAt: now,
    updatedAt: now,
  }).run();
  return { created: true, skillId: id };
}

// ── Public: retrieve relevant skills for a new task ──────────────────────────
export function findRelevantLearnedSkills(opts: {
  companyId: string;
  taskTitle: string;
  taskDescription: string | null;
  limit?: number;
}): Array<{ id: string; title: string; pattern: string; recipe: string; useCount: number }> {
  const { companyId, taskTitle, taskDescription, limit = 3 } = opts;
  const queryText = `${taskTitle || ''} ${taskDescription || ''}`;
  const queryKeywords = new Set(extractKeywords(queryText));
  if (queryKeywords.size === 0) return [];

  const candidates = db.select().from(learnedSkills)
    .where(and(eq(learnedSkills.companyId, companyId), eq(learnedSkills.isDisabled, false)))
    .all();

  const scored = candidates.map(c => {
    let kws: string[] = [];
    try { kws = JSON.parse(c.keywords || '[]'); } catch {}
    const overlap = kws.filter(k => queryKeywords.has(k)).length;
    // Pinned skills get a strong boost; confidence/use_count tiebreak.
    const score = overlap * 100 + (c.isPinned ? 500 : 0) + Math.min(c.useCount, 20) + c.confidence / 10;
    return { c, overlap, score };
  });

  return scored
    .filter(s => s.overlap >= 2 || s.c.isPinned)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => ({
      id: s.c.id,
      title: s.c.title,
      pattern: s.c.pattern,
      recipe: s.c.recipe,
      useCount: s.c.useCount,
    }));
}

/** Mark a learned skill as having just been used (bumps useCount + lastUsedAt). */
export function markLearnedSkillsUsed(skillIds: string[]): void {
  if (skillIds.length === 0) return;
  const now = new Date().toISOString();
  db.update(learnedSkills)
    .set({
      useCount: sql`${learnedSkills.useCount} + 1`,
      lastUsedAt: now,
      updatedAt: now,
    })
    .where(inArray(learnedSkills.id, skillIds))
    .run();
}

/** Format injected skills as a context block for the agent prompt. */
export function formatLearnedSkillsForPrompt(
  skills: ReturnType<typeof findRelevantLearnedSkills>,
  isEn: boolean,
): string {
  if (skills.length === 0) return '';
  const header = isEn
    ? '\n\n--- Reusable Patterns From Previous Successful Tasks ---\n'
    : '\n\n--- Wiederverwendbare Muster aus früheren erfolgreichen Tasks ---\n';
  const body = skills.map((s, i) => {
    const tag = isEn ? `Pattern ${i + 1}` : `Muster ${i + 1}`;
    const usedHint = s.useCount > 0
      ? (isEn ? ` (used ${s.useCount}× before)` : ` (${s.useCount}× verwendet)`)
      : '';
    return `${tag}: ${s.title}${usedHint}\n  When: ${s.pattern}\n  Recipe:\n${s.recipe.split('\n').map(l => '    ' + l).join('\n').slice(0, 1200)}`;
  }).join('\n\n');
  return header + body;
}
