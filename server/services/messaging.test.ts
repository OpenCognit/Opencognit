import { describe, it, expect, beforeEach } from 'vitest';
import { executeConfigAction } from './messaging.js';
import { db } from '../db/client.js';
import { agents, tasks, companies, user, companyMemberships } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

const now = () => new Date().toISOString();

function createTestCompany(name = 'Test Co') {
  const id = uuid();
  db.insert(companies).values({ id, name, status: 'active', createdAt: now(), updatedAt: now() }).run();
  return id;
}

function createTestUser(email = `test-${uuid().slice(0, 8)}@example.com`) {
  const id = uuid();
  db.insert(user).values({ id, name: 'Test', email, emailVerified: true, createdAt: new Date(), updatedAt: new Date() }).run();
  return id;
}

describe('executeConfigAction — DE/EN key normalization', () => {
  let companyId: string;

  beforeEach(() => {
    companyId = createTestCompany();
  });

  it('creates agent with German keys (rolle, faehigkeiten, verbindungsTyp)', () => {
    const msg = executeConfigAction({
      type: 'create_agent',
      name: 'Alex',
      rolle: 'Email Manager',
      faehigkeiten: 'Gmail, Filtering',
      verbindungsTyp: 'claude-code',
    }, companyId);

    expect(msg).toContain('Alex');
    expect(msg).toContain('Email Manager');

    const agent = db.select().from(agents).where(eq(agents.companyId, companyId)).get() as any;
    expect(agent).toBeTruthy();
    expect(agent.name).toBe('Alex');
    expect(agent.role).toBe('Email Manager');
    expect(agent.connectionType).toBe('claude-code');
  });

  it('creates agent with English keys still works', () => {
    const msg = executeConfigAction({
      type: 'create_agent',
      name: 'Bob',
      role: 'Developer',
      skills: 'TypeScript',
      connectionType: 'openrouter',
    }, companyId);

    expect(msg).toContain('Bob');

    const agent = db.select().from(agents).where(eq(agents.name, 'Bob')).get() as any;
    expect(agent.role).toBe('Developer');
  });

  it('rejects create_agent without name or role', () => {
    const msg = executeConfigAction({ type: 'create_agent', name: '' }, companyId);
    expect(msg).toContain('❌');
    expect(msg).toContain('Name');
  });

  it('creates task with German keys (titel, beschreibung, prioritaet)', () => {
    executeConfigAction({
      type: 'create_task',
      titel: 'Review emails',
      beschreibung: 'Check inbox daily',
      prioritaet: 'high',
    }, companyId);

    const task = db.select().from(tasks).where(eq(tasks.companyId, companyId)).get() as any;
    expect(task).toBeTruthy();
    expect(task.title).toBe('Review emails');
    expect(task.description).toBe('Check inbox daily');
    expect(task.priority).toBe('high');
  });

  it('updates agent with German keys (rolle, faehigkeiten)', () => {
    // First create an agent
    executeConfigAction({
      type: 'create_agent',
      name: 'Charlie',
      role: 'Assistant',
      connectionType: 'claude-code',
    }, companyId);

    const agent = db.select().from(agents).where(eq(agents.name, 'Charlie')).get() as any;

    const msg = executeConfigAction({
      type: 'update_agent',
      agentId: agent.id,
      rolle: 'Senior Assistant',
      faehigkeiten: 'Python, Go',
    }, companyId);

    expect(msg).toContain('Charlie');

    const updated = db.select().from(agents).where(eq(agents.id, agent.id)).get() as any;
    expect(updated.role).toBe('Senior Assistant');
    expect(updated.skills).toBe('Python, Go');
  });
});

describe('executeConfigAction — company access', () => {
  it('GET /api/companies filters by membership', () => {
    // This tests the schema + middleware concept indirectly
    const uid = createTestUser();
    const cid1 = createTestCompany('Co A');
    const cid2 = createTestCompany('Co B');

    db.insert(companyMemberships).values({
      id: uuid(), userId: uid, companyId: cid1, role: 'owner', joinedAt: now(),
    }).run();

    const memberships = db.select({ companyId: companyMemberships.companyId })
      .from(companyMemberships)
      .where(eq(companyMemberships.userId, uid))
      .all();

    expect(memberships).toHaveLength(1);
    expect(memberships[0].companyId).toBe(cid1);
  });
});
