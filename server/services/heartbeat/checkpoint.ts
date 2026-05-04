/**
 * Checkpoint Contract — Structured agent output tracking (Hermes-style)
 *
 * Injects a structured output format into agent prompts and parses the result
 * into the `checkpoints` table. Enables byte-verified review and structured handoffs.
 */

import { db } from '../../db/client.js';
import { taskCheckpoints } from '../../db/schema.js';
import crypto from 'crypto';

export const CHECKPOINT_PROMPT_BLOCK = `
────────────────────────────────────────
📋 CHECKPOINT VERPFLICHTUNG
────────────────────────────────────────

Am ENDE deiner Antwort MUSSST du einen strukturierten Checkpoint einfügen.
Dieser Checkpoint wird automatisch ausgewertet und bestimmt den nächsten Schritt.

Format (kopiere diesen Block und fülle ihn aus):

[CHECKPOINT]
{
  "state": "done",
  "files_changed": ["pfad/zur/datei.ts"],
  "commands_run": ["npm test", "git commit"],
  "result": "Zusammenfassung dessen, was erreicht wurde.",
  "blocker": null,
  "next_action": "Was soll als Nächstes passieren?"
}
[/CHECKPOINT]

Regeln:
- state MUSST einer dieser Werte sein: done, blocked, needs_input, handoff, in_progress
- files_changed: Liste aller Dateien, die du erstellt, geändert oder gelöscht hast (optional, [] wenn keine)
- commands_run: Liste aller Befehle, die du ausgeführt hast (optional, [] wenn keine)
- result: Klare Zusammenfassung des Ergebnisses (2-5 Sätze). Bei Fehler: Was ging schief und warum.
- blocker: Wenn state = blocked: Beschreibe präzise, was blockiert und was du brauchst. Sonst null.
- next_action: Konkrete Empfehlung für den nächsten Schritt (z.B. "Review durch CEO", "Weiterarbeit an Subtask X", "Input vom Board nötig wegen ...")

Der Checkpoint wird maschinell geparst. Halte dich EXAKT an das JSON-Format.
`;

export interface ParsedCheckpoint {
  state: 'done' | 'blocked' | 'needs_input' | 'handoff' | 'in_progress';
  filesChanged?: string[];
  commandsRun?: string[];
  result?: string;
  blocker?: string | null;
  nextAction?: string;
}

/**
 * Parse checkpoint JSON from agent output.
 * Looks for [CHECKPOINT] ... [/CHECKPOINT] block.
 */
export function parseCheckpoint(output: string): ParsedCheckpoint | null {
  const match = output.match(/\[CHECKPOINT\]\s*([\s\S]*?)\s*\[\/CHECKPOINT\]/i);
  if (!match) return null;

  const raw = match[1].trim();
  // Extract JSON from the block (handle markdown fences)
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw;

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    const validStates = ['done', 'blocked', 'needs_input', 'handoff', 'in_progress'] as const;
    const state = validStates.find(s => s === parsed.state) || 'in_progress';

    return {
      state,
      filesChanged: Array.isArray(parsed.files_changed) ? parsed.files_changed.filter((x): x is string => typeof x === 'string') : undefined,
      commandsRun: Array.isArray(parsed.commands_run) ? parsed.commands_run.filter((x): x is string => typeof x === 'string') : undefined,
      result: typeof parsed.result === 'string' ? parsed.result : undefined,
      blocker: parsed.blocker === null ? null : typeof parsed.blocker === 'string' ? parsed.blocker : undefined,
      nextAction: typeof parsed.next_action === 'string' ? parsed.next_action : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Persist a parsed checkpoint to the database.
 */
export async function saveCheckpoint(
  checkpoint: ParsedCheckpoint,
  meta: {
    companyId: string;
    agentId: string;
    taskId?: string;
    runId?: string;
    model?: string;
    tokens?: number;
    costCents?: number;
    durationMs?: number;
  }
): Promise<void> {
  await db.insert(taskCheckpoints).values({
    id: crypto.randomUUID(),
    companyId: meta.companyId,
    agentId: meta.agentId,
    taskId: meta.taskId || null,
    runId: meta.runId || null,
    stateLabel: checkpoint.state.toUpperCase() as 'DONE' | 'BLOCKED' | 'NEEDS_INPUT' | 'HANDOFF' | 'IN_PROGRESS',
    filesChanged: checkpoint.filesChanged ? JSON.stringify(checkpoint.filesChanged) : null,
    commandsRun: checkpoint.commandsRun ? JSON.stringify(checkpoint.commandsRun) : null,
    result: checkpoint.result || null,
    blocker: checkpoint.blocker ?? null,
    nextAction: checkpoint.nextAction || null,
    createdAt: new Date().toISOString(),
  });
}
