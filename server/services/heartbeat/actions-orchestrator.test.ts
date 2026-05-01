import { describe, it, expect, beforeEach } from 'vitest';
import { processOrchestratorActions } from './actions-orchestrator.js';
import { db } from '../../db/client.js';
import { tasks, agents, companies, comments } from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';

const now = () => new Date().toISOString();

describe('CEO mark_done verification gate', () => {
  let companyId: string;
  let orchestratorId: string;
  let taskId: string;
  const workspaceRoot = path.join(process.cwd(), 'data', 'workspaces');

  beforeEach(() => {
    companyId = uuid();
    orchestratorId = uuid();
    taskId = uuid();

    db.insert(companies).values({
      id: companyId, name: 'Test Co', status: 'active',
      createdAt: now(), updatedAt: now(),
    }).run();

    db.insert(agents).values({
      id: orchestratorId, companyId, name: 'CEO', role: 'CEO',
      status: 'active', isOrchestrator: true,
      connectionType: 'anthropic', createdAt: now(), updatedAt: now(),
    }).run();

    db.insert(tasks).values({
      id: taskId, companyId,
      title: 'Build landing page',
      description: 'Create HTML and CSS',
      status: 'in_progress',
      priority: 'high',
      assignedTo: orchestratorId,
      workspacePath: path.join(workspaceRoot, taskId),
      createdAt: now(), updatedAt: now(),
    }).run();

    // Clean up workspace from previous test
    const wsPath = path.join(workspaceRoot, taskId);
    if (fs.existsSync(wsPath)) {
      fs.rmSync(wsPath, { recursive: true, force: true });
    }
  });

  it('BLOCKS mark_done when workspace is empty', async () => {
    // Workspace exists but is empty
    const wsPath = path.join(workspaceRoot, taskId);
    fs.mkdirSync(wsPath, { recursive: true });

    const output = `\`\`\`json\n{"actions": [{"type": "mark_done", "taskId": "${taskId}"}]}\n\`\`\``;
    const result = await processOrchestratorActions(taskId, orchestratorId, companyId, output);

    expect(result.done).toBe(false);
    expect(result.actionSummary[0]).toContain('BLOCKED');

    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get() as any;
    expect(task.status).toBe('in_progress');

    const comment = db.select().from(comments).where(eq(comments.taskId, taskId)).get() as any;
    expect(comment).toBeTruthy();
    expect(comment.content).toContain('Verifikation blockiert');
  });

  it('BLOCKS mark_done for dev tasks without workspace', async () => {
    // No workspace at all
    const output = `\`\`\`json\n{"actions": [{"type": "mark_done", "taskId": "${taskId}"}]}\n\`\`\``;
    const result = await processOrchestratorActions(taskId, orchestratorId, companyId, output);

    expect(result.done).toBe(false);
    expect(result.actionSummary[0]).toContain('BLOCKED');

    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get() as any;
    expect(task.status).toBe('in_progress');
  });

  it('ALLOWS mark_done when workspace has files → goes to in_review', async () => {
    // Create workspace with actual files
    const wsPath = path.join(workspaceRoot, taskId);
    fs.mkdirSync(wsPath, { recursive: true });
    fs.writeFileSync(path.join(wsPath, 'index.html'), '<html>Hello</html>');

    const output = `\`\`\`json\n{"actions": [{"type": "mark_done", "taskId": "${taskId}"}]}\n\`\`\``;
    const result = await processOrchestratorActions(taskId, orchestratorId, companyId, output);

    expect(result.done).toBe(true); // currentTaskMarkedDone is true
    expect(result.actionSummary[0]).toContain('mark_done');
    expect(result.actionSummary[0]).not.toContain('BLOCKED');

    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get() as any;
    expect(task.status).toBe('in_review');
  });

  it('ALLOWS mark_done for non-dev tasks without workspace → goes to in_review', async () => {
    // Update task to non-dev title
    db.update(tasks).set({ title: 'Review proposal', updatedAt: now() }).where(eq(tasks.id, taskId)).run();

    const output = `\`\`\`json\n{"actions": [{"type": "mark_done", "taskId": "${taskId}"}]}\n\`\`\``;
    const result = await processOrchestratorActions(taskId, orchestratorId, companyId, output);

    expect(result.done).toBe(true);

    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get() as any;
    expect(task.status).toBe('in_review');
  });

  it('approve_task moves in_review → done', async () => {
    // Set task to in_review first
    db.update(tasks).set({ status: 'in_review', updatedAt: now() }).where(eq(tasks.id, taskId)).run();

    const output = `\`\`\`json\n{"actions": [{"type": "approve_task", "taskId": "${taskId}"}]}\n\`\`\``;
    const result = await processOrchestratorActions(taskId, orchestratorId, companyId, output);

    expect(result.actionSummary[0]).toContain('approve_task');

    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get() as any;
    expect(task.status).toBe('done');
  });

  it('reject_task moves in_review → in_progress', async () => {
    // Set task to in_review first
    db.update(tasks).set({ status: 'in_review', updatedAt: now() }).where(eq(tasks.id, taskId)).run();

    const output = `\`\`\`json\n{"actions": [{"type": "reject_task", "taskId": "${taskId}", "reason": "Tests fehlen"}]}\n\`\`\``;
    const result = await processOrchestratorActions(taskId, orchestratorId, companyId, output);

    expect(result.actionSummary[0]).toContain('reject_task');

    const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get() as any;
    expect(task.status).toBe('in_progress');
  });
});
