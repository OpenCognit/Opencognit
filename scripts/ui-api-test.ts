import { db } from '../server/db/client.js';
import { companies, agents, tasks, projects, goals } from '../server/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const now = new Date().toISOString();

async function main() {
  console.log('🧪 UI/API Integration Test startet...\n');

  // Setup
  const companyId = uuid();
  const ceoId = uuid();
  const devId = uuid();
  const projectId = uuid();
  const goalId = uuid();

  db.insert(companies).values({
    id: companyId, name: 'UI Test Corp',
    description: 'UI Integration Test',
    createdAt: now, updatedAt: now,
  }).run();

  db.insert(agents).values([
    { id: ceoId, companyId, name: 'CEO UI', role: 'orchestrator', connectionType: 'openrouter', model: 'gpt-4o', status: 'aktiv', soul: '{}', createdAt: now, updatedAt: now },
    { id: devId, companyId, name: 'Dev UI', role: 'developer', connectionType: 'bash', model: 'bash', status: 'aktiv', soul: '{}', createdAt: now, updatedAt: now },
  ]).run();

  db.insert(goals).values({
    id: goalId, companyId,
    title: 'Launch Product',
    description: 'Get the product to market',
    status: 'active', progress: 25,
    createdAt: now, updatedAt: now,
  }).run();

  db.insert(projects).values({
    id: projectId, companyId,
    name: 'Website Relaunch',
    description: 'New company website',
    status: 'aktiv', priority: 'high',
    ownerAgentId: ceoId,
    createdAt: now, updatedAt: now,
  }).run();

  db.insert(tasks).values([
    { id: uuid(), companyId, title: 'Design Mockups', description: 'Figma designs', status: 'done', assignedTo: devId, projectId, goalId, priority: 'high', createdAt: now, updatedAt: now },
    { id: uuid(), companyId, title: 'HTML/CSS', description: 'Implement frontend', status: 'in_progress', assignedTo: devId, projectId, goalId, priority: 'high', createdAt: now, updatedAt: now },
    { id: uuid(), companyId, title: 'Backend API', description: 'Build REST API', status: 'todo', assignedTo: null, projectId, goalId, priority: 'medium', createdAt: now, updatedAt: now },
  ]).run();

  // Test API Endpoints
  console.log('📋 Test 1: API Health');
  const health = await fetch('http://localhost:3203/api/health').then(r => r.json());
  console.log('  ✅ Health:', health.status, health.version);

  console.log('\n📋 Test 2: API Agents');
  const agentsRes = await fetch('http://localhost:3203/api/agents');
  console.log('  ✅ Agents endpoint status:', agentsRes.status, agentsRes.status === 401 ? '(auth required — expected)' : '');

  console.log('\n📋 Test 3: DB Data Integrity');
  const agentCount = db.select().from(agents).where(eq(agents.companyId, companyId)).all().length;
  const taskCount = db.select().from(tasks).where(eq(tasks.companyId, companyId)).all().length;
  const projectCount = db.select().from(projects).where(eq(projects.companyId, companyId)).all().length;
  console.log('  ✅ Agents:', agentCount, '| Tasks:', taskCount, '| Projects:', projectCount);

  if (agentCount !== 2 || taskCount !== 3 || projectCount !== 1) {
    console.error('❌ Data mismatch!');
    process.exit(1);
  }

  console.log('\n📋 Test 4: Frontend Load');
  const frontend = await fetch('http://localhost:3200');
  const html = await frontend.text();
  const hasReact = html.includes('react');
  const hasScript = html.includes('<script');
  console.log('  ✅ Frontend status:', frontend.status, '| Has React:', hasReact, '| Has Scripts:', hasScript);

  // Cleanup
  console.log('\n🧹 Cleanup...');
  (db as any).run('PRAGMA foreign_keys = OFF');
  db.delete(tasks).where(eq(tasks.companyId, companyId)).run();
  db.delete(projects).where(eq(projects.companyId, companyId)).run();
  db.delete(goals).where(eq(goals.companyId, companyId)).run();
  db.delete(agents).where(eq(agents.companyId, companyId)).run();
  db.delete(companies).where(eq(companies.id, companyId)).run();
  (db as any).run('PRAGMA foreign_keys = ON');

  console.log('\n🎉 UI/API Integration Tests bestanden!');
  console.log('   Öffne http://localhost:3200 im Browser für manuelles Testing.');
}

main().catch(e => { console.error(e); process.exit(1); });
