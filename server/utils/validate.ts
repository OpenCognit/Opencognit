// =============================================================================
// validate(schema, req, res) — small helper that runs a Zod schema against
// req.body, sends a 400 with the schema-flattened errors on failure
// (returning null), or returns the parsed object on success.
//
// Extracted from server/index.ts so route modules don't have to depend on
// the index module just for validation.
// =============================================================================

import type express from 'express';
import { z } from 'zod';

/** Validates req.body against schema. Returns parsed data or sends 400 and returns null. */
export function validate<T>(
  schema: z.ZodType<T>,
  req: express.Request,
  res: express.Response,
): T | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid input', details: result.error.flatten() });
    return null;
  }
  return result.data;
}
