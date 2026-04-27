/**
 * Autonomous Company Bootstrap
 * =============================
 * The CEO interviews the user and automatically builds the entire company:
 * - Creates agents based on the business goal
 * - Sets up projects and initial tasks
 * - Configures workspace structure
 * - Assigns roles and hierarchy
 *
 * Usage flow:
 * 1. User enters API key
 * 2. CEO agent is created automatically
 * 3. User chats with CEO: "I want to build a SaaS for dentists"
 * 4. CEO analyzes, asks clarifying questions
 * 5. CEO creates team, projects, tasks
 * 6. Company starts working autonomously
 */

import { db } from '../db/client.js';
import { companies, agents, tasks, projects, goals } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { createAgentFromTemplate, linkAgentHierarchy, getAvailableRoles, ROLE_TEMPLATES } from './agent-factory.js';
import { ensureCompanyWorkspace } from './company-workspace.js';
import { wakeupService } from './wakeup.js';

export interface BootstrapConfig {
  companyId: string;
  userGoal: string;
  apiKey?: string;
  apiProvider?: string;
  preferredLanguage?: 'de' | 'en';
}

export interface BootstrapResult {
  success: boolean;
  ceoId: string | null;
  createdAgents: Array<{ id: string; name: string; role: string }>;
  createdProjects: Array<{ id: string; name: string }>;
  createdTasks: Array<{ id: string; title: string }>;
  createdGoals: Array<{ id: string; title: string }>;
  error?: string;
}

/**
 * Analyze the user's goal and determine which roles are needed.
 * This is a rule-based analyzer (no LLM call needed for basic detection).
 */
export function analyzeGoalForRoles(goal: string): string[] {
  const g = goal.toLowerCase();
  const roles = new Set<string>();

  // Always need a CEO
  roles.add('ceo');

  // Tech-related keywords → CTO + Developer
  const techKeywords = ['app', 'saas', 'software', 'web', 'platform', 'api', 'code', 'development', 'website', 'portal', 'tool'];
  if (techKeywords.some(k => g.includes(k))) {
    roles.add('cto');
    roles.add('developer');
  }

  // Design-related keywords → Designer
  const designKeywords = ['design', 'ui', 'ux', 'brand', 'logo', 'interface', 'frontend', 'visual'];
  if (designKeywords.some(k => g.includes(k))) {
    roles.add('designer');
  }

  // Marketing-related keywords → Marketing + Content
  const marketingKeywords = ['marketing', 'sales', 'growth', 'seo', 'content', 'social media', 'ads', 'launch', 'promote'];
  if (marketingKeywords.some(k => g.includes(k))) {
    roles.add('marketing');
    roles.add('content');
  }

  // Quality/Testing keywords → QA
  const qaKeywords = ['test', 'quality', 'qa', 'bug', 'automation'];
  if (qaKeywords.some(k => g.includes(k))) {
    roles.add('qa');
  }

  // Data/Analytics keywords → Analyst
  const dataKeywords = ['analytics', 'data', 'metrics', 'report', 'dashboard', 'kpi'];
  if (dataKeywords.some(k => g.includes(k))) {
    roles.add('analyst');
  }

  // Complex projects get more developers
  if (g.includes('e-commerce') || g.includes('marketplace') || g.includes('enterprise')) {
    // Will add a second developer later
  }

  return Array.from(roles);
}

/**
 * Main bootstrap function. Creates the entire company structure.
 */
export function bootstrapCompany(config: BootstrapConfig): BootstrapResult {
  const { companyId: companyId, userGoal, apiProvider = 'openrouter', preferredLanguage = 'de' } = config;
  const now = new Date().toISOString();

  const result: BootstrapResult = {
    success: false,
    ceoId: null,
    createdAgents: [],
    createdProjects: [],
    createdTasks: [],
    createdGoals: [],
  };

  try {
    // Ensure workspace exists
    const company = db.select().from(companies).where(eq(companies.id, companyId)).get();
    if (!company) {
      result.error = 'Company not found';
      return result;
    }
    ensureCompanyWorkspace(company.workDir || './data/companies/' + companyId);

    // Analyze which roles are needed
    const roleKeys = analyzeGoalForRoles(userGoal);
    console.log(`🚀 Bootstrap: Analyzing goal "${userGoal.slice(0, 60)}..." → Roles: ${roleKeys.join(', ')}`);

    // Create CEO first (always needed)
    const ceo = createAgentFromTemplate(companyId, 'ceo', 1, {
      connectionType: apiProvider as any,
      connectionConfig: config.apiKey ? JSON.stringify({ apiKey: config.apiKey }) : undefined,
    } as any);
    result.ceoId = ceo.id;
    result.createdAgents.push({ id: ceo.id, name: ceo.name, role: ceo.role });

    // Create other agents
    const allAgents = [ceo];
    for (const roleKey of roleKeys) {
      if (roleKey === 'ceo') continue; // Already created
      const existing = db.select().from(agents)
        .where(and(eq(agents.companyId, companyId), eq(agents.role, ROLE_TEMPLATES[roleKey].role)))
        .get();
      if (existing) continue; // Skip if already exists

      const agent = createAgentFromTemplate(companyId, roleKey);
      result.createdAgents.push({ id: agent.id, name: agent.name, role: agent.role });
      allAgents.push(agent);
    }

    // Link hierarchy (reportsTo)
    linkAgentHierarchy(allAgents.map(a => ({ id: a.id, role: a.role })));

    // Create initial project based on goal
    const projectName = extractProjectName(userGoal);
    const projectId = crypto.randomUUID();
    db.insert(projects).values({
      id: projectId,
      companyId,
      name: projectName,
      description: `Automatisch erstellt aus Ziel: "${userGoal}"`,
      status: 'aktiv',
      priority: 'high',
      ownerAgentId: ceo.id,
      progress: 0,
      createdAt: now,
      updatedAt: now,
    }).run();
    result.createdProjects.push({ id: projectId, name: projectName });

    // Create company goal
    const goalId = crypto.randomUUID();
    db.insert(goals).values({
      id: goalId,
      companyId,
      title: preferredLanguage === 'de' ? `Company-Ziel: ${projectName}` : `Company Goal: ${projectName}`,
      description: userGoal,
      level: 'company',
      status: 'active',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    }).run();
    result.createdGoals.push({ id: goalId, title: projectName });

    // Create initial tasks based on goal type
    const initialTasks = generateInitialTasks(userGoal, projectId, ceo.id, companyId, preferredLanguage);
    for (const task of initialTasks) {
      db.insert(tasks).values(task).run();
      result.createdTasks.push({ id: task.id, title: task.title });
    }

    // Wakeup CEO to start planning
    wakeupService.wakeup(ceo.id, companyId, {
      source: 'automation',
      triggerDetail: 'system',
      reason: preferredLanguage === 'de'
        ? `Company bootstrap complete. ${result.createdAgents.length} agents created. Please review the team and start planning.`
        : `Company bootstrap complete. ${result.createdAgents.length} agents created. Please review the team and start planning.`,
      payload: { projectId, goalId },
    }).catch(() => {});

    result.success = true;
    console.log(`✅ Bootstrap complete: ${result.createdAgents.length} agents, ${result.createdProjects.length} projects, ${result.createdTasks.length} tasks`);

    return result;
  } catch (err: any) {
    result.error = err.message;
    console.error('Bootstrap Error:', err);
    return result;
  }
}

/**
 * Generate initial tasks based on the user's goal.
 */
function generateInitialTasks(
  goal: string,
  projectId: string,
  ceoId: string,
  companyId: string,
  lang: 'de' | 'en'
): Array<typeof tasks.$inferInsert> {
  const now = new Date().toISOString();
  const g = goal.toLowerCase();
  const isTech = ['app', 'saas', 'software', 'web', 'platform'].some(k => g.includes(k));

  if (lang === 'de') {
    const taskRows: any[] = [
      {
        id: crypto.randomUUID(),
        companyId,
        title: 'Projekt-Setup und Anforderungsanalyse',
        description: `Analysiere das Ziel: "${goal}". Definiere: Zielgruppe, Kernfunktionen, Technologie-Stack, MVP-Scope.`,
        status: 'todo',
        priority: 'critical',
        assignedTo: ceoId,
        projectId: projectId,
        createdBy: ceoId,
        createdAt: now,
        updatedAt: now,
      },
    ];

    if (isTech) {
      taskRows.push(
        {
          id: crypto.randomUUID(),
          companyId,
          title: 'Technische Architektur definieren',
          description: 'Definiere Tech-Stack, Datenbank-Schema, API-Design, Deployment-Strategie.',
          status: 'backlog',
          priority: 'high',
          assignedTo: null,
          projectId: projectId,
          createdBy: ceoId,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: crypto.randomUUID(),
          companyId,
          title: 'MVP Feature-Liste priorisieren',
          description: 'Liste alle Features auf, priorisiere nach User-Value + Aufwand. Definiere MVP-Cutoff.',
          status: 'backlog',
          priority: 'high',
          assignedTo: null,
          projectId: projectId,
          createdBy: ceoId,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: crypto.randomUUID(),
          companyId,
          title: 'UI/UX Design Konzept erstellen',
          description: 'Erstelle Wireframes und Design-System für das MVP.',
          status: 'backlog',
          priority: 'medium',
          assignedTo: null,
          projectId: projectId,
          createdBy: ceoId,
          createdAt: now,
          updatedAt: now,
        }
      );
    }

    taskRows.push({
      id: crypto.randomUUID(),
      companyId,
      title: 'Go-to-Market Strategie entwickeln',
      description: 'Definiere Zielgruppe, Marketing-Kanäle, Launch-Plan, Pricing-Strategie.',
      status: 'backlog',
      priority: 'medium',
      assignedTo: null,
      projectId: projectId,
      createdBy: ceoId,
      createdAt: now,
      updatedAt: now,
    });

    return taskRows;
  } else {
    // English version
    const taskRows: any[] = [
      {
        id: crypto.randomUUID(),
        companyId,
        title: 'Project Setup and Requirements Analysis',
        description: `Analyze the goal: "${goal}". Define: Target audience, core features, tech stack, MVP scope.`,
        status: 'todo',
        priority: 'critical',
        assignedTo: ceoId,
        projectId: projectId,
        createdBy: ceoId,
        createdAt: now,
        updatedAt: now,
      },
    ];

    if (isTech) {
      taskRows.push(
        {
          id: crypto.randomUUID(),
          companyId,
          title: 'Define Technical Architecture',
          description: 'Define tech stack, database schema, API design, deployment strategy.',
          status: 'backlog',
          priority: 'high',
          assignedTo: null,
          projectId: projectId,
          createdBy: ceoId,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: crypto.randomUUID(),
          companyId,
          title: 'Prioritize MVP Feature List',
          description: 'List all features, prioritize by user value + effort. Define MVP cutoff.',
          status: 'backlog',
          priority: 'high',
          assignedTo: null,
          projectId: projectId,
          createdBy: ceoId,
          createdAt: now,
          updatedAt: now,
        }
      );
    }

    return taskRows;
  }
}

/**
 * Extract a project name from the user's goal.
 */
function extractProjectName(goal: string): string {
  // Simple heuristic: take first 5 words or up to first punctuation
  const cleaned = goal.replace(/^(i want to|i need to|ich will|ich möchte)\s*/i, '');
  const words = cleaned.split(/\s+/).slice(0, 6);
  let name = words.join(' ');
  // Capitalize first letter of each word
  name = name.replace(/\b\w/g, l => l.toUpperCase());
  return name.length > 50 ? name.slice(0, 50) + '...' : name;
}

/**
 * Check if a company has been bootstrapped (has agents).
 */
export function isCompanyBootstrapped(companyId: string): boolean {
  const count = db.select().from(agents).where(eq(agents.companyId, companyId)).all().length;
  return count > 0;
}
