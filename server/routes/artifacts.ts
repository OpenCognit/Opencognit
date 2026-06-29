import { Router } from 'express';
import { db } from '../db/client.js';
import { artifactStore } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { requireAuth, requireEntityAccess, AuthRequest } from '../middleware/auth.js';
import { getArtifactStorage } from '../services/artifact-storage.js';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const storage = getArtifactStorage();

// ─── Multer config (in-memory, size-limited) ──────────────────────────────────
const MAX_SIZE = parseInt(process.env.ARTIFACT_MAX_SIZE_BYTES || (100 * 1024 * 1024).toString(), 10);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCompanyId(req: AuthRequest): string {
  return req.resolvedCompanyId || req.companyId || '';
}

// ─── POST /api/artifacts — Create/upload artifact ─────────────────────────────
router.post('/', requireAuth, upload.single('file'), async (req: AuthRequest, res) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: 'company_id is required' });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'file is required' });
      return;
    }

    const artifactId = uuidv4();
    const { storagePath, checksum } = await storage.write(
      artifactId,
      companyId,
      file.buffer,
      file.originalname,
    );

    const now = new Date().toISOString();
    const row = {
      id: artifactId,
      unternehmen_id: companyId,
      projekt_id: req.body.project_id || null,
      aufgabe_id: req.body.task_id || null,
      expert_id: req.body.agent_id || null,
      run_id: req.body.run_id || null,
      name: file.originalname,
      mime_type: file.mimetype,
      size_bytes: file.size,
      checksum_sha256: checksum,
      storage_path: storagePath,
      manifest_ref: req.body.manifest_ref || null,
      manifest_version: req.body.manifest_version || null,
      source_ref: req.body.source_ref || null,
      source_hash: req.body.source_hash || null,
      retention_policy: req.body.retention_policy || 'permanent',
      retention_ttl_days: req.body.retention_ttl_days ? parseInt(req.body.retention_ttl_days, 10) : null,
      erstellt_am: now,
      aktualisiert_am: now,
    };

    db.insert(artifactStore).values(row as any).run();

    res.status(201).json({
      id: artifactId,
      name: file.originalname,
      mime_type: file.mimetype,
      size_bytes: file.size,
      checksum_sha256: checksum,
      storage_path: storagePath,
      status: 'active',
      erstellt_am: now,
    });
  } catch (err: any) {
    console.error('Artifact upload failed:', err.message);
    res.status(500).json({ error: err.message || 'Upload failed' });
  }
});

// ─── GET /api/artifacts — List/query artifacts ────────────────────────────────
router.get('/', requireAuth, async (req: AuthRequest, res) => {
  const companyId = req.query.company_id as string || getCompanyId(req);
  if (!companyId) {
    res.status(400).json({ error: 'company_id is required' });
    return;
  }

  const conditions = [eq(artifactStore.companyId, companyId)];

  if (req.query.task_id) conditions.push(eq(artifactStore.taskId, req.query.task_id as string));
  if (req.query.project_id) conditions.push(eq(artifactStore.projectId, req.query.project_id as string));
  if (req.query.status) conditions.push(eq(artifactStore.status, req.query.status as string));

  const rows = db.select()
    .from(artifactStore)
    .where(and(...conditions))
    .orderBy(desc(artifactStore.createdAt))
    .all();

  res.json(rows);
});

// ─── GET /api/artifacts/:id — Metadata ────────────────────────────────────────
router.get('/:id', requireAuth, requireEntityAccess('artifact', 'id'), async (req: AuthRequest, res) => {
  const row = db.select().from(artifactStore).where(eq(artifactStore.id, req.params.id)).get();
  if (!row) {
    res.status(404).json({ error: 'Artifact not found' });
    return;
  }
  res.json(row);
});

// ─── GET /api/artifacts/:id/content — Download/stream content ─────────────────
router.get('/:id/content', requireAuth, requireEntityAccess('artifact', 'id'), async (req: AuthRequest, res) => {
  const row = db.select().from(artifactStore).where(eq(artifactStore.id, req.params.id)).get();
  if (!row) {
    res.status(404).json({ error: 'Artifact not found' });
    return;
  }

  try {
    const buffer = await storage.read(row.storagePath);
    res.setHeader('Content-Type', row.mimeType);
    res.setHeader('Content-Length', row.sizeBytes);
    res.setHeader('Content-Disposition', `inline; filename="${row.name}"`);
    res.send(buffer);
  } catch (err: any) {
    console.error('Artifact read failed:', err.message);
    res.status(500).json({ error: 'Failed to read artifact' });
  }
});

// ─── DELETE /api/artifacts/:id — Soft delete ──────────────────────────────────
router.delete('/:id', requireAuth, requireEntityAccess('artifact', 'id'), async (req: AuthRequest, res) => {
  const row = db.select().from(artifactStore).where(eq(artifactStore.id, req.params.id)).get();
  if (!row) {
    res.status(404).json({ error: 'Artifact not found' });
    return;
  }

  const now = new Date().toISOString();
  db.update(artifactStore)
    .set({ status: 'deleted', deletedAt: now, updatedAt: now } as any)
    .where(eq(artifactStore.id, req.params.id))
    .run();

  res.json({ id: row.id, status: 'deleted', deleted_at: now });
});

export default router;
