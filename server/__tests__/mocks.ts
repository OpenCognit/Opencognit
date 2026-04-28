import { db } from '../db/client.js';
import { v4 as uuid } from 'uuid';
import {
  user,
  companies,
  agents,
  tasks,
  companyMemberships,
} from '../db/schema.js';

const now = () => new Date().toISOString();

// ─── Test Data Factories ───────────────────────────────────────────────────

export function createTestUser(overrides: Partial<typeof user.$inferInsert> = {}) {
  const id = uuid();
  db.insert(user).values({
    id,
    name: overrides.name || 'Test User',
    email: overrides.email || `test-${id.slice(0, 8)}@example.com`,
    emailVerified: overrides.emailVerified ?? false,
    createdAt: overrides.createdAt || new Date(),
    updatedAt: overrides.updatedAt || new Date(),
    ...overrides,
  }).run();
  return id;
}

export function createTestCompany(overrides: Partial<typeof companies.$inferInsert> = {}) {
  const id = uuid();
  db.insert(companies).values({
    id,
    name: overrides.name || 'Test Company',
    description: overrides.description || 'A test company',
    status: overrides.status || 'active',
    createdAt: overrides.createdAt || now(),
    updatedAt: overrides.updatedAt || now(),
    ...overrides,
  }).run();
  return id;
}

export function createTestAgent(
  companyId: string,
  overrides: Partial<typeof agents.$inferInsert> = {},
) {
  const id = uuid();
  db.insert(agents).values({
    id,
    companyId,
    name: overrides.name || 'Test Agent',
    role: overrides.role || 'Tester',
    status: overrides.status || 'idle',
    connectionType: overrides.connectionType || 'openrouter',
    avatarColor: overrides.avatarColor || '#23CDCA',
    monthlyBudgetCent: overrides.monthlyBudgetCent ?? 0,
    monthlySpendCent: overrides.monthlySpendCent ?? 0,
    createdAt: overrides.createdAt || now(),
    updatedAt: overrides.updatedAt || now(),
    ...overrides,
  }).run();
  return id;
}

export function createTestTask(
  companyId: string,
  overrides: Partial<typeof tasks.$inferInsert> = {},
) {
  const id = uuid();
  db.insert(tasks).values({
    id,
    companyId,
    title: overrides.title || 'Test Task',
    description: overrides.description || '',
    status: overrides.status || 'backlog',
    priority: overrides.priority || 'medium',
    createdAt: overrides.createdAt || now(),
    updatedAt: overrides.updatedAt || now(),
    ...overrides,
  }).run();
  return id;
}

export function createTestMembership(
  userId: string,
  companyId: string,
  role: 'owner' | 'admin' | 'member' = 'member',
) {
  const id = uuid();
  db.insert(companyMemberships).values({
    id,
    userId,
    companyId,
    role,
    joinedAt: now(),
  }).run();
  return id;
}

// ─── Helper: Create a fully wired test scenario ────────────────────────────

export interface TestScenario {
  userId: string;
  companyId: string;
  agentId: string;
  taskId: string;
}

export function createTestScenario(overrides: {
  user?: Partial<typeof user.$inferInsert>;
  company?: Partial<typeof companies.$inferInsert>;
  agent?: Partial<typeof agents.$inferInsert>;
  task?: Partial<typeof tasks.$inferInsert>;
  membershipRole?: 'owner' | 'admin' | 'member';
} = {}): TestScenario {
  const userId = createTestUser(overrides.user);
  const companyId = createTestCompany(overrides.company);
  createTestMembership(userId, companyId, overrides.membershipRole || 'owner');
  const agentId = createTestAgent(companyId, overrides.agent);
  const taskId = createTestTask(companyId, overrides.task);
  return { userId, companyId, agentId, taskId };
}
