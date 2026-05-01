import { db } from '../server/db/client.js';
import { companies, agents, tasks, projects, chatMessages, settings, goals, agentWakeupRequests } from '../server/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { wakeupService } from '../server/services/wakeup.js';

const now = new Date().toISOString();

async function main() {
  console.log('🧪 CEO-Chat & Proactive E2E Test startet...\n');

  // ── Setup: Company + CEO + Dev Agent ──
  const companyId = uuid();
  const ceoId = uuid();
  const devId = uuid();

  db.insert(companies).values({
    id: companyId, name: 'ChatTest Corp',
    description: 'Chat E2E Test',
    createdAt: now, updatedAt: now,
  }).run();

  db.insert(agents).values([
    { id: ceoId, companyId, name: 'CEO Chat', role: 'orchestrator', connectionType: 'openrouter', model: 'gpt-4o-mini', status: 'aktiv', soul: '{}', createdAt: now, updatedAt: now },
    { id: devId, companyId, name: 'Dev Chat', role: 'developer', connectionType: 'bash', model: 'bash', status: 'aktiv', soul: '{}', createdAt: now, updatedAt: now },
  ]).run();

  // Dummy API-Key
  db.insert(settings).values({
    id: uuid(), companyId, key: 'openrouter_api_key',
    value: 'sk-dummy-test-key-12345',
    updatedAt: now,
  }).run();

  // ── Test A: Chat-Nachricht → CEO-Zyklus triggern ──
  console.log('📋 Test A: CEO Chat-Flow (User → CEO → Actions)');

  db.insert(chatMessages).values({
    id: uuid(), companyId,
    agentId: ceoId,
    senderType: 'board',
    message: 'Wir brauchen eine Landing Page. Erstelle ein Projekt dafür.',
    read: false,
    createdAt: now,
  }).run();
  console.log('  ✅ Chat-Nachricht gespeichert');

  await wakeupService.wakeup(ceoId, companyId, {
    source: 'chat',
    triggerDetail: 'new_message',
    reason: 'Neue Nachricht vom User',
  });
  console.log('  ✅ CEO-Wakeup queued (Chat-Modus)');

  const wups = db.select().from(agentWakeupRequests)
    .where(and(eq(agentWakeupRequests.agentId, ceoId), eq(agentWakeupRequests.companyId, companyId)))
    .all();
  console.log('  ✅ CEO Wakeup-Requests in DB:', wups.length);

  // ── Test B: Proactive-Modus simulieren ──
  console.log('\n📋 Test B: CEO Proactive-Modus (alle Tasks erledigt)');

  const goalId = uuid();
  db.insert(goals).values({
    id: goalId, companyId,
    title: 'Landing Page Launch',
    description: 'Eine Landing Page live schalten',
    status: 'active', progress: 100,
    createdAt: now, updatedAt: now,
  }).run();

  db.insert(tasks).values({
    id: uuid(), companyId, title: 'Recherche',
    description: 'Markt recherchiert', status: 'done',
    assignedTo: devId, completedAt: now,
    createdAt: now, updatedAt: now,
  }).run();

  await wakeupService.wakeup(ceoId, companyId, {
    source: 'automation',
    triggerDetail: 'periodic_check',
    reason: 'Alle Tasks erledigt — prüfe proaktiv neue Strategie',
  });
  console.log('  ✅ Proactive-Wakeup queued');

  // ── Test C: Assign-Modus simulieren ──
  console.log('\n📋 Test C: CEO Assign-Modus (unzugewiesener Task)');

  db.insert(tasks).values({
    id: uuid(), companyId,
    title: 'CSS Framework auswählen',
    description: 'Tailwind vs Bootstrap vergleichen',
    status: 'todo', priority: 'high',
    assignedTo: null,
    createdAt: now, updatedAt: now,
  }).run();

  await wakeupService.wakeup(ceoId, companyId, {
    source: 'automation',
    triggerDetail: 'unassigned_task',
    reason: `Neuer unzugewiesener Task: CSS Framework auswählen`,
  });
  console.log('  ✅ Assign-Wakeup queued');

  // ── Test D: API-Endpoint Health Check ──
  console.log('\n📋 Test D: API-Endpoint Verfügbarkeit');
  try {
    const health = await fetch('http://localhost:3203/api/health').then(r => r.json());
    console.log('  ✅ API Health:', health.status, health.version);
  } catch { console.log('  ⚠️ API nicht erreichbar (Server läuft nicht auf 3203)'); }

  // ── Test E: Echter CEO-Adapter-Lauf mit Dummy-Key (Fehlerhandling) ──
  console.log('\n📋 Test E: CEO-Adapter Fehlerhandling (Dummy API-Key)');
  try {
    const { runAdapter } = await import('../server/adapters/llm-wrapper.js');
    const result = await runAdapter({
      expertId: ceoId,
      companyId,
      taskId: uuid(),
      taskTitle: 'Test Analyse',
      taskDescription: 'Analysiere den aktuellen Status',
      mode: 'assign',
      workspaceFiles: [],
      activeMeetings: [],
      unassignedTasks: [],
      recentActivity: [],
      goals: [],
      teamContext: [],
      instructions: 'Test',
      messageHistory: [],
      temperature: 0.7,
      maxTokens: 1000,
    });
    console.log('  ⚠️ CEO-Adapter lieferte Ergebnis (unerwartet mit Dummy-Key):', result.output?.slice(0, 50));
  } catch (err: any) {
    if (err.message?.includes('API') || err.message?.includes('401') || err.message?.includes('auth') || err.message?.includes('key')) {
      console.log('  ✅ CEO-Adapter lehnt Dummy-Key korrekt ab:', err.message.slice(0, 60));
    } else {
      console.log('  ⚠️ CEO-Adapter Fehler:', err.message.slice(0, 80));
    }
  }

  // Cleanup
  console.log('\n🧹 Cleanup...');
  (db as any).run('PRAGMA foreign_keys = OFF');
  db.delete(chatMessages).where(eq(chatMessages.companyId, companyId)).run();
  db.delete(tasks).where(eq(tasks.companyId, companyId)).run();
  db.delete(goals).where(eq(goals.companyId, companyId)).run();
  db.delete(settings).where(eq(settings.companyId, companyId)).run();
  db.delete(agents).where(eq(agents.companyId, companyId)).run();
  db.delete(companies).where(eq(companies.id, companyId)).run();
  db.delete(agentWakeupRequests).where(eq(agentWakeupRequests.companyId, companyId)).run();
  (db as any).run('PRAGMA foreign_keys = ON');

  console.log('\n🎉 CEO-Chat & Proactive E2E Tests abgeschlossen!');
}

main().catch(e => { console.error(e); process.exit(1); });
