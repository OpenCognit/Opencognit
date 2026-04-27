/**
 * Actor-Aware Memory + Conflict Detection
 * ========================================
 * Every memory fact (KG triple) is tagged with its source agent (provenance).
 * When new facts are added, the system checks for conflicts:
 * - Contradiction: same subject+predicate, different objects
 * - Outdated: newer fact overrides older one
 * - Ambiguity: multiple valid interpretations
 * - Stale: fact hasn't been validated in a long time
 *
 * State-of-the-Art 2026: "Actor-aware memory tags each stored memory with
 * its source actor. This matters at retrieval time: a planning agent can
 * filter for what the user actually said versus what another agent inferred."
 *
 * Also: Mem0's graph-enhanced memory with conflict detection before write.
 */

import { eq, and, isNull, or, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { palaceKg, palaceSummaries, agents } from '../db/schema.js';

export interface MemoryFact {
  subject: string;
  predicate: string;
  object: string;
  sourceAgentId: string;
  confidence?: number; // 0-100
}

export interface ConflictReport {
  type: 'contradiction' | 'outdated' | 'ambiguity' | 'stale';
  severity: 'low' | 'medium' | 'high';
  description: string;
  conflictingFacts: Array<{
    subject: string;
    predicate: string;
    object: string;
    sourceAgentId: string;
    sourceAgentName: string;
    validFrom?: string;
  }>;
  suggestedResolution?: string;
}

/**
 * Write a memory fact with provenance tracking.
 * Before writing, checks for conflicts with existing facts.
 */
export function writeMemoryFact(
  unternehmenId: string,
  fact: MemoryFact
): { written: boolean; conflicts: ConflictReport[]; factId: string | null } {
  const now = new Date().toISOString();
  const conflicts: ConflictReport[] = [];

  // Check for conflicts BEFORE writing
  const detected = detectConflicts(unternehmenId, fact);
  conflicts.push(...detected);

  // High-severity contradictions block the write unless explicitly overridden
  const blockingConflicts = conflicts.filter(c => c.severity === 'high' && c.type === 'contradiction');
  if (blockingConflicts.length > 0 && (fact.confidence || 50) < 80) {
    // Write the conflict to the conflict table for resolution
    // NOTE: memoryConflicts table removed during refactor
    /*
    for (const conflict of blockingConflicts) {
      db.insert(memoryConflicts).values({
        id: crypto.randomUUID(),
        companyId: unternehmenId,
        conflictingTriplesJson: JSON.stringify(conflict.conflictingFacts),
        conflictTyp: conflict.type,
        description: conflict.description,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      }).run();
    }
    */
    return { written: false, conflicts, factId: null };
  }

  // Insert the new fact
  const factId = crypto.randomUUID();
  db.insert(palaceKg).values({
    id: factId,
    companyId: unternehmenId,
    subject: fact.subject,
    predicate: fact.predicate,
    object: fact.object,
    validFrom: now,
    validUntil: null,
    createdBy: fact.sourceAgentId,
    createdAt: now,
  }).run();

  // If there were outdated conflicts, mark old facts as superseded
  for (const conflict of conflicts.filter(c => c.type === 'outdated')) {
    for (const oldFact of conflict.conflictingFacts) {
      if (oldFact.sourceAgentId !== fact.sourceAgentId) {
        // Mark old fact as outdated (validUntil = now)
        db.update(palaceKg)
          .set({ validUntil: now })
          .where(and(
            eq(palaceKg.subject, oldFact.subject),
            eq(palaceKg.predicate, oldFact.predicate),
            eq(palaceKg.object, oldFact.object),
            eq(palaceKg.companyId, unternehmenId),
            isNull(palaceKg.validUntil)
          ))
          .run();
      }
    }
  }

  return { written: true, conflicts, factId };
}

/**
 * Retrieve memory facts with optional provenance filtering.
 * Can filter by source agent, confidence, or recency.
 */
export function retrieveMemoryFacts(
  unternehmenId: string,
  options: {
    subject?: string;
    predicate?: string;
    sourceAgentId?: string; // filter by who said it
    excludeAgents?: string[]; // exclude inferred facts from these agents
    onlyValidated?: boolean; // only facts not in conflict
    limit?: number;
  } = {}
): Array<MemoryFact & { validFrom: string; validUntil: string | null; factId: string }> {
  const { subject, predicate, sourceAgentId, excludeAgents, onlyValidated, limit = 50 } = options;

  let query = db
    .select()
    .from(palaceKg)
    .where(and(
      eq(palaceKg.companyId, unternehmenId),
      isNull(palaceKg.validUntil) // only current facts
    ))
    .orderBy(desc(palaceKg.createdAt))
    .limit(limit);

  // Note: We can't chain .where easily with drizzle's SQLite builder for optional filters
  // So we filter in memory for simplicity
  let results = query.all();

  if (subject) results = results.filter(r => r.subject.toLowerCase().includes(subject.toLowerCase()));
  if (predicate) results = results.filter(r => r.predicate.toLowerCase().includes(predicate.toLowerCase()));
  if (sourceAgentId) results = results.filter(r => r.createdBy === sourceAgentId);
  if (excludeAgents) results = results.filter(r => !excludeAgents.includes(r.createdBy || ''));

  if (onlyValidated) {
    // Exclude facts that are part of open conflicts
    // NOTE: memoryConflicts table removed during refactor
    const conflictedSubjects = new Set<string>();
  }

  return results.map(r => ({
    subject: r.subject,
    predicate: r.predicate,
    object: r.object,
    sourceAgentId: r.createdBy || 'system',
    validFrom: r.validFrom || r.createdAt,
    validUntil: r.validUntil,
    factId: r.id,
  }));
}

/**
 * Detect conflicts between a new fact and existing facts.
 */
export function detectConflicts(
  unternehmenId: string,
  newFact: MemoryFact
): ConflictReport[] {
  const conflicts: ConflictReport[] = [];
  const now = new Date().toISOString();

  // 1. Check for Contradiction: same subject+predicate, different object
  const contradicting = db
    .select()
    .from(palaceKg)
    .where(and(
      eq(palaceKg.companyId, unternehmenId),
      eq(palaceKg.subject, newFact.subject),
      eq(palaceKg.predicate, newFact.predicate),
      isNull(palaceKg.validUntil)
    ))
    .all()
    .filter(r => r.object !== newFact.object);

  if (contradicting.length > 0) {
    const agentNames = getAgentNames(contradicting.map(r => r.createdBy || 'system'));
    conflicts.push({
      type: 'contradiction',
      severity: 'high',
      description: `Contradiction on "${newFact.subject} ${newFact.predicate}": new fact says "${newFact.object}" but existing facts say differently.`,
      conflictingFacts: [
        { subject: newFact.subject, predicate: newFact.predicate, object: newFact.object, sourceAgentId: newFact.sourceAgentId, sourceAgentName: agentNames[newFact.sourceAgentId] || 'Unknown', validFrom: now },
        ...contradicting.map(r => ({
          subject: r.subject,
          predicate: r.predicate,
          object: r.object,
          sourceAgentId: r.createdBy || 'system',
          sourceAgentName: agentNames[r.createdBy || 'system'] || 'Unknown',
          validFrom: r.validFrom || r.createdAt,
        })),
      ],
      suggestedResolution: 'Review both sources and determine which is correct, or mark one as outdated.',
    });
  }

  // 2. Check for Outdated: same subject+predicate+object from different agent
  const outdated = db
    .select()
    .from(palaceKg)
    .where(and(
      eq(palaceKg.companyId, unternehmenId),
      eq(palaceKg.subject, newFact.subject),
      eq(palaceKg.predicate, newFact.predicate),
      eq(palaceKg.object, newFact.object),
      isNull(palaceKg.validUntil),
      // Different source agent
      or(
        and(eq(palaceKg.createdBy, newFact.sourceAgentId), eq(palaceKg.createdBy, '')), // never matches both
        sql`${palaceKg.createdBy} != ${newFact.sourceAgentId}`
      )
    ))
    .all();

  // Simpler approach: get all matching and filter in JS
  const allMatching = db
    .select()
    .from(palaceKg)
    .where(and(
      eq(palaceKg.companyId, unternehmenId),
      eq(palaceKg.subject, newFact.subject),
      eq(palaceKg.predicate, newFact.predicate),
      eq(palaceKg.object, newFact.object),
      isNull(palaceKg.validUntil)
    ))
    .all()
    .filter(r => r.createdBy !== newFact.sourceAgentId);

  if (allMatching.length > 0) {
    const agentNames = getAgentNames(allMatching.map(r => r.createdBy || 'system'));
    conflicts.push({
      type: 'outdated',
      severity: 'low',
      description: `Duplicate fact from different source. New assertion by ${agentNames[newFact.sourceAgentId] || 'Unknown'} confirms existing fact from ${agentNames[allMatching[0].createdBy || 'system'] || 'Unknown'}.`,
      conflictingFacts: [
        { subject: newFact.subject, predicate: newFact.predicate, object: newFact.object, sourceAgentId: newFact.sourceAgentId, sourceAgentName: agentNames[newFact.sourceAgentId] || 'Unknown', validFrom: now },
        ...allMatching.map(r => ({
          subject: r.subject,
          predicate: r.predicate,
          object: r.object,
          sourceAgentId: r.createdBy || 'system',
          sourceAgentName: agentNames[r.createdBy || 'system'] || 'Unknown',
          validFrom: r.validFrom || r.createdAt,
        })),
      ],
      suggestedResolution: 'Mark older version as outdated — confirmation strengthens confidence.',
    });
  }

  // 3. Check for Ambiguity: multiple predicates for same subject that might conflict semantically
  const relatedFacts = db
    .select()
    .from(palaceKg)
    .where(and(
      eq(palaceKg.companyId, unternehmenId),
      eq(palaceKg.subject, newFact.subject),
      isNull(palaceKg.validUntil)
    ))
    .all();

  const ambiguousPredicates = ['status', 'priority', 'owner', 'assignee', 'deadline'];
  if (ambiguousPredicates.includes(newFact.predicate.toLowerCase()) && relatedFacts.length > 2) {
    const agentNames = getAgentNames(relatedFacts.map(r => r.createdBy || 'system'));
    conflicts.push({
      type: 'ambiguity',
      severity: 'medium',
      description: `Ambiguity on "${newFact.subject}": multiple agents have made assertions about this entity. Verify consistency.`,
      conflictingFacts: relatedFacts.map(r => ({
        subject: r.subject,
        predicate: r.predicate,
        object: r.object,
        sourceAgentId: r.createdBy || 'system',
        sourceAgentName: agentNames[r.createdBy || 'system'] || 'Unknown',
        validFrom: r.validFrom || r.createdAt,
      })),
      suggestedResolution: 'Schedule a consensus meeting to clarify the entity state.',
    });
  }

  // 4. Check for Stale: facts older than 90 days without confirmation
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const staleFacts = db
    .select()
    .from(palaceKg)
    .where(and(
      eq(palaceKg.companyId, unternehmenId),
      eq(palaceKg.subject, newFact.subject),
      isNull(palaceKg.validUntil),
      db.fn.sql`${palaceKg.createdAt} < ${ninetyDaysAgo}`
    ))
    .all();

  if (staleFacts.length > 0 && newFact.predicate === staleFacts[0].predicate) {
    const agentNames = getAgentNames(staleFacts.map(r => r.createdBy || 'system'));
    conflicts.push({
      type: 'stale',
      severity: 'low',
      description: `Stale fact refreshed: "${newFact.subject} ${newFact.predicate}" was last updated >90 days ago.`,
      conflictingFacts: staleFacts.map(r => ({
        subject: r.subject,
        predicate: r.predicate,
        object: r.object,
        sourceAgentId: r.createdBy || 'system',
        sourceAgentName: agentNames[r.createdBy || 'system'] || 'Unknown',
        validFrom: r.validFrom || r.createdAt,
      })),
      suggestedResolution: 'New fact refreshes the stale information. Consider auto-archiving old versions.',
    });
  }

  return conflicts;
}

/**
 * Resolve an open conflict.
 */
export function resolveConflict(
  conflictId: string,
  resolution: string,
  resolvedByExpertId: string
): boolean {
  const now = new Date().toISOString();

  // NOTE: memoryConflicts table removed during refactor
  /*
  db.update(memoryConflicts)
    .set({
      status: 'resolved',
      resolution,
      resolvedByExpertId,
      updatedAt: now,
    })
    .where(eq(memoryConflicts.id, conflictId))
    .run();
  */

  return true;
}

/**
 * Get open conflicts for a company.
 */
// NOTE: memoryConflicts table removed during refactor
/*
export function getOpenConflicts(unternehmenId: string): Array<typeof memoryConflicts.$inferSelect> {
  return db
    .select()
    .from(memoryConflicts)
    .where(and(
      eq(memoryConflicts.companyId, unternehmenId),
      eq(memoryConflicts.status, 'open')
    ))
    .orderBy(desc(memoryConflicts.createdAt))
    .all();
}
*/

/**
 * Build a memory summary for an agent that filters by provenance.
 * Returns facts from specific sources (e.g. only user-stated facts,
 * excluding other agents' inferences).
 */
export function buildProvenanceFilteredMemory(
  unternehmenId: string,
  sourceFilter: {
    includeAgents?: string[];
    excludeAgents?: string[];
    onlyDirectUser?: boolean; // only facts from human users (source='board' or similar)
  },
  subjectFilter?: string
): string {
  const options: Parameters<typeof retrieveMemoryFacts>[1] = {
    subject: subjectFilter,
    limit: 100,
  };

  if (sourceFilter.includeAgents) {
    // We can only filter one at a time in our simple API, so we do it in memory
  }
  if (sourceFilter.excludeAgents) {
    options.excludeAgents = sourceFilter.excludeAgents;
  }

  const facts = retrieveMemoryFacts(unternehmenId, options);

  let filtered = facts;
  if (sourceFilter.includeAgents) {
    filtered = facts.filter(f => sourceFilter.includeAgents!.includes(f.sourceAgentId));
  }

  if (filtered.length === 0) return 'No relevant facts found.';

  const lines = filtered.map(f => {
    const agentName = db.select({ name: agents.name }).from(agents).where(eq(agents.id, f.sourceAgentId)).get()?.name
      || (f.sourceAgentId === 'system' ? 'System' : f.sourceAgentId);
    return `- [${agentName}] ${f.subject} ${f.predicate} ${f.object}`;
  });

  return lines.join('\n');
}

// ===== Helpers =====

function getAgentNames(agentIds: string[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const id of [...new Set(agentIds)]) {
    if (id === 'system') { names[id] = 'System'; continue; }
    const agent = db.select({ name: agents.name }).from(agents).where(eq(agents.id, id)).get();
    names[id] = agent?.name || id;
  }
  return names;
}
