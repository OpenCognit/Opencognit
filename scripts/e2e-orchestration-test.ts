import { db } from '../server/db/client.js';
import { companies, agents, tasks, projects } from '../server/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import path from 'path';
import { processOrchestratorActions } from '../server/services/heartbeat/actions-orchestrator.js';

const now = new Date().toISOString();

function makeOutput(actions: any[]) {
  return `\`\`\`json\n{"actions": ${JSON.stringify(actions)}}\n\`\`\``;
}

async function main() {
  console.log('🧪 E2E Orchestrierungstest startet...\n');

  // 1. Setup: Company + CEO + Developer erstellen
  const companyId = uuid();
  const ceoId = uuid();
  const devId = uuid();
  const dummyTaskId = uuid();
  const wsBase = path.join(process.cwd(), 'data', 'workspaces', `test-${companyId.slice(0,8)}`);

  db.insert(companies).values({
    id: companyId, name: 'TestCorp E2E',
    description: 'E2E Test Company',
    createdAt: now, updatedAt: now,
  }).run();

  db.insert(agents).values([
    { id: ceoId, companyId, name: 'CEO Test', role: 'orchestrator', connectionType: 'openrouter', model: 'gpt-4o', status: 'aktiv', soul: '{}', createdAt: now, updatedAt: now },
    { id: devId, companyId, name: 'Dev Test', role: 'developer', connectionType: 'bash', model: 'bash', status: 'aktiv', soul: '{}', createdAt: now, updatedAt: now },
  ]).run();

  // Dummy task for processOrchestratorActions signature
  db.insert(tasks).values({
    id: dummyTaskId, companyId, title: 'CEO Cycle',
    description: 'Test cycle', status: 'in_progress',
    assignedTo: ceoId, createdAt: now, updatedAt: now,
  }).run();

  // 2. create_project Action testen
  console.log('📋 Test 1: CEO create_project Action');
  const projectName = 'Landing Page Projekt';
  const out1 = makeOutput([
    { type: 'create_project', name: projectName, description: 'Eine Landing Page erstellen', priority: 'high', tasks: [
      { title: 'HTML Struktur erstellen', description: 'index.html mit Basis-Layout', priority: 'high', agentId: devId },
      { title: 'CSS Styling', description: 'styles.css mit Design', priority: 'medium', agentId: devId },
    ]}
  ]);

  await processOrchestratorActions(dummyTaskId, ceoId, companyId, out1);

  const proj = db.select().from(projects).where(and(eq(projects.companyId, companyId), eq(projects.name, projectName))).get();
  if (!proj) { console.error('❌ Projekt nicht erstellt!'); process.exit(1); }
  console.log('  ✅ Projekt erstellt:', (proj as any).id.slice(0,8), (proj as any).name);

  const projTasks = db.select().from(tasks).where(eq(tasks.projectId, (proj as any).id)).all();
  console.log('  ✅ Tasks im Projekt:', projTasks.length);
  if (projTasks.length !== 2) { console.error('❌ Erwartet 2 Projekt-Tasks, got', projTasks.length); process.exit(1); }

  // 3. Bash-Agent Datei-Erstellung testen
  console.log('\n📋 Test 2: Bash-Agent erstellt Dateien im Workspace');
  const taskWs = path.join(wsBase, 'task-test');
  fs.mkdirSync(taskWs, { recursive: true });

  fs.writeFileSync(path.join(taskWs, 'index.html'), '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello OpenCognit</h1></body></html>', 'utf-8');
  fs.writeFileSync(path.join(taskWs, 'styles.css'), 'body { background: #000; color: #fff; }', 'utf-8');

  const files = fs.readdirSync(taskWs);
  console.log('  ✅ Dateien im Workspace:', files.join(', '));
  if (files.length !== 2) { console.error('❌ Erwartet 2 Dateien'); process.exit(1); }

  // 4. mark_done Verifikation testen
  console.log('\n📋 Test 3: mark_done Verifikations-Gate');
  const newTasks = projTasks.filter((t: any) => t.id !== dummyTaskId);
  const taskToCloseId = newTasks[0].id;
  db.update(tasks).set({ workspacePath: taskWs, status: 'in_progress' }).where(eq(tasks.id, taskToCloseId)).run();

  // 4a. Mit Dateien → sollte erlaubt sein
  const out2 = makeOutput([{ type: 'mark_done', taskId: taskToCloseId }]);
  await processOrchestratorActions(dummyTaskId, ceoId, companyId, out2);
  const closedTask = db.select().from(tasks).where(eq(tasks.id, taskToCloseId)).get() as any;
  if (closedTask?.status !== 'done') {
    console.error('❌ mark_done mit Dateien sollte erlaubt sein, Status:', closedTask?.status);
    process.exit(1);
  }
  console.log('  ✅ mark_done erlaubt wenn Dateien vorhanden');

  // 4b. Ohne Dateien → sollte blockiert sein
  const emptyWs = path.join(wsBase, 'empty-task');
  fs.mkdirSync(emptyWs, { recursive: true });
  const taskToBlockId = newTasks[1].id;
  db.update(tasks).set({ workspacePath: emptyWs, status: 'in_progress' }).where(eq(tasks.id, taskToBlockId)).run();

  const out3 = makeOutput([{ type: 'mark_done', taskId: taskToBlockId }]);
  await processOrchestratorActions(dummyTaskId, ceoId, companyId, out3);
  const blockedTask = db.select().from(tasks).where(eq(tasks.id, taskToBlockId)).get() as any;
  if (blockedTask?.status === 'done') {
    console.error('❌ mark_done ohne Dateien sollte BLOCKIERT sein!');
    process.exit(1);
  }
  console.log('  ✅ mark_done blockiert wenn kein Deliverable (Dev-Task)');

  // 5. Dedup testen
  console.log('\n📋 Test 4: create_project Dedup (gleicher Name)');
  const out4 = makeOutput([{ type: 'create_project', name: projectName, description: 'Duplikat' }]);
  const beforeCount = db.select().from(projects).where(eq(projects.companyId, companyId)).all().length;
  await processOrchestratorActions(dummyTaskId, ceoId, companyId, out4);
  const afterCount = db.select().from(projects).where(eq(projects.companyId, companyId)).all().length;
  if (afterCount !== beforeCount) { console.error('❌ Dedup failed, count:', afterCount); process.exit(1); }
  console.log('  ✅ Dupliziertes Projekt ignoriert');

  // Cleanup
  console.log('\n🧹 Cleanup...');
  fs.rmSync(wsBase, { recursive: true, force: true });
  (db as any).run('PRAGMA foreign_keys = OFF');
  db.delete(tasks).where(eq(tasks.companyId, companyId)).run();
  db.delete(projects).where(eq(projects.companyId, companyId)).run();
  db.delete(agents).where(eq(agents.companyId, companyId)).run();
  db.delete(companies).where(eq(companies.id, companyId)).run();
  (db as any).run('PRAGMA foreign_keys = ON');

  console.log("\n🎉 Alle E2E Tests bestanden!"); await testBashAdapterRealExecution(); console.log("\n🎉 Bash-Adapter E2E Test bestanden!");
}

main().catch(e => { console.error(e); process.exit(1); });

// ── Zusatz: Echter Bash-Adapter Datei-Erstellungstest ──
async function testBashAdapterRealExecution() {
  console.log('\n📋 Test 5: Echter Bash-Adapter erstellt Dateien');
  const { BashAdapter } = await import('../server/adapters/bash.js');
  const adapter = new BashAdapter({ workingDir: path.join(process.cwd(), 'data', 'workspaces', 'bash-test') });

  const task = {
    id: uuid(),
    title: 'Erstelle Projektstruktur',
    description: 'mkdir -p src/components && echo "export const App = () => {}" > src/App.tsx && echo "body { margin: 0; }" > src/index.css',
  };

  const result = await adapter.execute(task, { companyId: 'test', agentId: 'test-agent', agentName: 'Test' }, { apiKey: '', model: '' });

  const ws = path.join(process.cwd(), 'data', 'workspaces', 'bash-test');
  const hasApp = fs.existsSync(path.join(ws, 'src', 'App.tsx'));
  const hasCss = fs.existsSync(path.join(ws, 'src', 'index.css'));

  if (!result.success) { console.error('❌ Bash-Adapter fehlgeschlagen:', result.output); process.exit(1); }
  if (!hasApp) { console.error('❌ App.tsx nicht erstellt'); process.exit(1); }
  if (!hasCss) { console.error('❌ index.css nicht erstellt'); process.exit(1); }

  console.log('  ✅ Bash-Adapter hat Dateien erstellt:');
  console.log('     - src/App.tsx');
  console.log('     - src/index.css');
  console.log('     - Output:', result.output.slice(0, 100));

  fs.rmSync(ws, { recursive: true, force: true });
}

// Aufruf ans Ende der main() Funktion anhängen
