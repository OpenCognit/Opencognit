// Heartbeat Actions Worker — bash execution, JSON actions, work products for worker agents

import { db } from '../../db/client.js';
import { kommentare } from '../../db/schema.js';
import { v4 as uuid } from 'uuid';
import { recordWorkProducts } from './dependencies.js';

/**
 * Parses agent output for actions like bash scripts or JSON requests
 * and executes them autonomously.
 */
export async function processWorkerActions(
  taskId: string,
  expertId: string,
  unternehmenId: string,
  runId: string,
  output: string,
  workspacePath?: string
) {
  // 1. Check for bash blocks
  const bashMatch = output.match(/```(?:bash|sh|shell)?\n([\s\S]*?)```/);
  if (bashMatch) {
    const code = bashMatch[1].trim();
    console.log(`  ⚡ Executing autonomous bash action for ${expertId}...`);

    const bashAdapter = (await import('../../adapters/bash.js')).createBashAdapter();
    const res = await bashAdapter.execute(
      { id: taskId, titel: 'Autonomous Action', beschreibung: code, status: 'in_progress', prioritaet: 'medium' },
      {} as any,
      { expertId, unternehmenId, runId, workspacePath }
    );

    // Log the action result
    await db.insert(kommentare).values({
      id: uuid(),
      unternehmenId,
      aufgabeId: taskId,
      autorExpertId: expertId,
      autorTyp: 'agent',
      inhalt: `### 🛠️ AUTONOME AKTION AUSGEFÜHRT\n\n**Befehl:**\n\`\`\`bash\n${code}\n\`\`\`\n\n**Ergebnis:**\n\`\`\`\n${res.output || res.error}\n\`\`\``,
      erstelltAm: new Date().toISOString(),
    });

    // Record any newly created files
    await recordWorkProducts(taskId, expertId, unternehmenId, runId, workspacePath ?? null);
  }

  // 2. Check for JSON actions (e.g. create_task, hire_agent)
  // Here we leverage the CEO's parsing logic if needed, or implement worker-specific ones.
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/) || output.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      // Support status updates from workers
      if (parsed.action === 'update_task_status' || (parsed.actions && parsed.actions.some((a: any) => a.type === 'update_task_status'))) {
         // Logic to handle worker status decisions
         console.log(`  📝 Worker ${expertId} requested status update.`);
      }
    } catch (e) {
      // Ignore invalid JSON
    }
  }
}
