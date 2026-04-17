// Heartbeat Utils — SOUL.md loader, trace helper, focus-mode check

import fs from 'fs';
import crypto from 'crypto';
import { appEvents } from '../../events.js';
import { db } from '../../db/client.js';
import { experten, einstellungen } from '../../db/schema.js';
import { eq, and } from 'drizzle-orm';

// ── SOUL.md Loader ────────────────────────────────────────────────────────────
// In-memory cache: soulPath → { content, version }
// Invalidated when file mtime changes (via soulVersion comparison).
export const soulCache = new Map<string, { content: string; version: string }>();

/**
 * Load a SOUL.md file and apply template variables.
 * Returns null if soulPath is not set or file doesn't exist.
 */
export function loadSoul(expert: { soulPath?: string | null; soulVersion?: string | null }, vars: Record<string, string>): string | null {
  if (!expert.soulPath) return null;
  const filePath = expert.soulPath;
  if (!fs.existsSync(filePath)) return null;

  try {
    // Compute current file version (mtime-based hash — cheap, no read needed)
    const mtime = fs.statSync(filePath).mtimeMs.toString();
    const version = crypto.createHash('md5').update(filePath + mtime).digest('hex').slice(0, 12);

    // Cache hit: return without re-reading
    const cached = soulCache.get(filePath);
    if (cached && cached.version === version) return cached.content;

    // Cache miss or file changed: re-read and apply template vars
    let raw = fs.readFileSync(filePath, 'utf-8');

    // Apply {{variable}} substitutions
    for (const [key, value] of Object.entries(vars)) {
      raw = raw.replaceAll(`{{${key}}}`, value);
    }

    soulCache.set(filePath, { content: raw, version });

    // Persist new version hash to DB asynchronously (non-blocking)
    setImmediate(() => {
      try {
        db.update(experten)
          .set({ soulVersion: version })
          .where(eq(experten.soulPath, filePath))
          .run();
      } catch (e: any) {
        console.warn(`⚠️ SOUL.md version persist fehlgeschlagen: ${e.message}`);
      }
    });

    return raw;
  } catch (e: any) {
    console.warn(`⚠️ SOUL.md konnte nicht geladen werden (${filePath}): ${e.message}`);
    return null;
  }
}
// ─────────────────────────────────────────────────────────────────────────────

export function trace(expertId: string, unternehmenId: string, typ: string, titel: string, details?: string, runId?: string) {
  appEvents.emit('trace', { expertId, unternehmenId, typ, titel, details, runId });
}

/**
 * Check if Focus Mode is currently active for a company.
 * Returns true if focus_mode_active = 'true' and not expired.
 */
export function isFocusModeActive(unternehmenId: string): boolean {
  const activeRow = db.select().from(einstellungen)
    .where(and(eq(einstellungen.schluessel, 'focus_mode_active'), eq(einstellungen.unternehmenId, unternehmenId)))
    .get();
  if (activeRow?.wert !== 'true') return false;

  const untilRow = db.select().from(einstellungen)
    .where(and(eq(einstellungen.schluessel, 'focus_mode_until'), eq(einstellungen.unternehmenId, unternehmenId)))
    .get();
  if (untilRow?.wert && new Date(untilRow.wert) < new Date()) return false;

  return true;
}
