// =============================================================================
// Skills routes — extracted from server/index.ts as part of the
// `refactor/server-routes-split` work.
//
// This router uses full /api/... paths and is mounted at '/' in index.ts,
// because skill-related endpoints span four URL prefixes that don't share
// a clean base path:
//   /api/skills           /api/skills-library
//   /api/learned-skills   /api/companies/:unternehmenId/{skills-library,learned-skills}
//   /api/tasks/match-agent
//
// Agent-scoped endpoints (/api/agents/:id/skills, /api/agents/:id/skills-library)
// stay in index.ts and will move with the future agents router.
// =============================================================================

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { eq, and, desc, inArray } from 'drizzle-orm';

import { db } from '../db/client.js';
import {
  skillsLibrary,
  agentSkills,
  agents,
  learnedSkills,
  companyMemberships,
} from '../db/schema.js';
import { skillsService } from '../services/skills.js';
import { getUiLanguage } from '../services/messaging.js';
import { SEED_SKILLS } from '../db/seed-skills-data.js';

import {
  authMiddleware,
  requireCompanyAccess,
  requireResourceAccess,
} from '../middleware/auth.js';

const router = Router();
const now = () => new Date().toISOString();

function mapSkillToDe(skill: any) {
  return {
    id: skill.id,
    unternehmenId: skill.companyId,
    name: skill.name,
    beschreibung: skill.description,
    inhalt: skill.content,
    tags: skill.tags,
    erstelltVon: skill.createdBy,
    konfidenz: skill.confidence,
    nutzungen: skill.uses,
    erfolge: skill.successes,
    quelle: skill.source,
    remoteRef: skill.remoteRef,
    erstelltAm: skill.createdAt,
    aktualisiertAm: skill.updatedAt,
  };
}

// =============================================================================
// SKILL CATALOG (built-in skills shipped with the platform)
// =============================================================================

router.get('/api/skills', async (_req, res) => {
  try {
    const skills = await skillsService.getAllSkills();
    res.json(skills);
  } catch (error) {
    console.error('Failed to get skills:', error);
    res.status(500).json({ error: 'Failed to get skills' });
  }
});

router.get('/api/skills/categories', (_req, res) => {
  res.json(skillsService.getSkillCategories());
});

// Skill-based agent matching for tasks
router.post('/api/tasks/match-agent', async (req, res) => {
  const { unternehmenId, titel, beschreibung } = req.body;
  if (!unternehmenId || !titel) {
    return res.status(400).json({ error: 'unternehmenId and titel are required' });
  }

  try {
    const match = await skillsService.findBestAgentForTask(
      unternehmenId,
      titel,
      beschreibung || null,
    );
    res.json({
      match,
      message: match
        ? `Best match: ${match.agentName} (${match.matchScore}% match)`
        : 'No matching agent found',
    });
  } catch (error) {
    console.error('Failed to match agent:', error);
    res.status(500).json({ error: 'Failed to match agent' });
  }
});

// =============================================================================
// SKILLS LIBRARY (per-company knowledge entries)
// =============================================================================

router.get(
  '/api/companies/:unternehmenId/skills-library',
  authMiddleware,
  requireCompanyAccess(),
  (req, res) => {
    const unternehmenId = req.params.unternehmenId as string;
    const skills = db.select().from(skillsLibrary)
      .where(eq(skillsLibrary.companyId, unternehmenId))
      .orderBy(desc(skillsLibrary.createdAt)).all();
    res.json(skills.map(mapSkillToDe));
  },
);

router.post(
  '/api/companies/:unternehmenId/skills-library',
  authMiddleware,
  requireCompanyAccess(),
  (req, res) => {
    const { name, beschreibung, inhalt, tags } = req.body;
    if (!name?.trim() || !inhalt?.trim()) return res.status(400).json({ error: 'name and inhalt required' });
    const id = uuid();
    const n = now();
    const companyId = req.params.unternehmenId as string;
    db.insert(skillsLibrary).values({
      id, companyId, name, description: beschreibung ?? null,
      content: inhalt, tags: tags ? JSON.stringify(tags) : null,
      createdBy: (req as any).user?.userId ?? null, createdAt: n, updatedAt: n,
    }).run();
    res.status(201).json({ id, name });
  },
);

router.get(
  '/api/skills-library/:id',
  authMiddleware,
  requireResourceAccess('skillsLibrary'),
  (req, res) => {
    const id = req.params.id as string;
    const skill = db.select().from(skillsLibrary).where(eq(skillsLibrary.id, id)).get();
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    res.json(mapSkillToDe(skill));
  },
);

router.patch(
  '/api/skills-library/:id',
  authMiddleware,
  requireResourceAccess('skillsLibrary'),
  (req, res) => {
    const { name, beschreibung, inhalt, tags } = req.body;
    const updates: any = { updatedAt: now() };
    if (name !== undefined) updates.name = name;
    if (beschreibung !== undefined) updates.description = beschreibung;
    if (inhalt !== undefined) updates.content = inhalt;
    if (tags !== undefined) updates.tags = JSON.stringify(tags);
    const id = req.params.id as string;
    db.update(skillsLibrary).set(updates).where(eq(skillsLibrary.id, id)).run();
    res.json({ ok: true });
  },
);

router.delete(
  '/api/skills-library/:id',
  authMiddleware,
  requireResourceAccess('skillsLibrary'),
  (req, res) => {
    const id = req.params.id as string;
    db.delete(agentSkills).where(eq(agentSkills.skillId, id)).run();
    db.delete(skillsLibrary).where(eq(skillsLibrary.id, id)).run();
    res.json({ ok: true });
  },
);

// ── Seed Standard Skill Library ──────────────────────────────────────────────
router.post(
  '/api/companies/:unternehmenId/skills-library/seed',
  authMiddleware,
  requireCompanyAccess(),
  (req, res) => {
    const unternehmenId = req.params.unternehmenId as string;
    const n = now();
    // Pick the variant that matches the company's UI language.
    // Names + tags stay language-agnostic (mostly proper nouns / tech terms).
    const lang = getUiLanguage(unternehmenId);

    const existing = db.select({ name: skillsLibrary.name })
      .from(skillsLibrary)
      .where(eq(skillsLibrary.companyId, unternehmenId))
      .all()
      .map((r: any) => r.name.toLowerCase());

    let added = 0;
    for (const skill of SEED_SKILLS) {
      if (existing.includes(skill.name.toLowerCase())) continue;
      const variant = skill[lang];
      db.insert(skillsLibrary).values({
        id: uuid(),
        companyId: unternehmenId,
        name: skill.name,
        description: variant.description,
        content: variant.content,
        tags: JSON.stringify(skill.tags),
        source: 'manuell' as const,
        confidence: 80,
        uses: 0,
        successes: 0,
        createdBy: null,
        createdAt: n,
        updatedAt: n,
      }).run();
      added++;
    }

    res.json({ ok: true, added, total: SEED_SKILLS.length, language: lang });
  },
);

// =============================================================================
// LEARNED SKILLS (auto-extracted from successful work cycles)
// =============================================================================

router.get(
  '/api/companies/:unternehmenId/learned-skills',
  authMiddleware,
  requireCompanyAccess(),
  (req, res) => {
    const companyId = req.params.unternehmenId as string;
    const includeDisabled = req.query.includeDisabled === '1';
    const rows = db.select().from(learnedSkills)
      .where(includeDisabled
        ? eq(learnedSkills.companyId, companyId)
        : and(eq(learnedSkills.companyId, companyId), eq(learnedSkills.isDisabled, false)))
      .orderBy(desc(learnedSkills.isPinned), desc(learnedSkills.useCount), desc(learnedSkills.createdAt))
      .all();

    // Enrich with source agent name
    const agentIds = Array.from(new Set(rows.map(r => r.sourceAgentId).filter(Boolean))) as string[];
    const agentRows = agentIds.length > 0
      ? db.select({ id: agents.id, name: agents.name })
          .from(agents).where(inArray(agents.id, agentIds)).all()
      : [];
    const agentNameById = new Map(agentRows.map(a => [a.id, a.name]));

    res.json(rows.map(r => ({
      ...r,
      keywords: (() => { try { return JSON.parse(r.keywords || '[]'); } catch { return []; } })(),
      sourceAgentName: r.sourceAgentId ? agentNameById.get(r.sourceAgentId) || null : null,
    })));
  },
);

router.patch('/api/learned-skills/:id', authMiddleware, (req, res) => {
  const id = req.params.id as string;
  const existing = db.select().from(learnedSkills).where(eq(learnedSkills.id, id)).get();
  if (!existing) return res.status(404).json({ error: 'Skill not found' });

  // Authorize via company membership
  const userId = (req as any).users?.userId;
  const membership = db.select().from(companyMemberships)
    .where(and(eq(companyMemberships.userId, userId), eq(companyMemberships.companyId, existing.companyId)))
    .get();
  if (!membership) return res.status(403).json({ error: 'No access' });

  const { title, pattern, recipe, isPinned, isDisabled } = req.body || {};
  const patch: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (typeof title === 'string' && title.length > 0 && title.length <= 200) patch.title = title;
  if (typeof pattern === 'string' && pattern.length > 0 && pattern.length <= 1000) patch.pattern = pattern;
  if (typeof recipe === 'string' && recipe.length > 0 && recipe.length <= 8000) patch.recipe = recipe;
  if (typeof isPinned === 'boolean') patch.isPinned = isPinned;
  if (typeof isDisabled === 'boolean') patch.isDisabled = isDisabled;

  db.update(learnedSkills).set(patch).where(eq(learnedSkills.id, id)).run();
  const updated = db.select().from(learnedSkills).where(eq(learnedSkills.id, id)).get();
  res.json(updated);
});

router.delete('/api/learned-skills/:id', authMiddleware, (req, res) => {
  const id = req.params.id as string;
  const existing = db.select().from(learnedSkills).where(eq(learnedSkills.id, id)).get();
  if (!existing) return res.status(404).json({ error: 'Skill not found' });
  const userId = (req as any).users?.userId;
  const membership = db.select().from(companyMemberships)
    .where(and(eq(companyMemberships.userId, userId), eq(companyMemberships.companyId, existing.companyId)))
    .get();
  if (!membership) return res.status(403).json({ error: 'No access' });
  db.delete(learnedSkills).where(eq(learnedSkills.id, id)).run();
  res.json({ ok: true });
});

export default router;
