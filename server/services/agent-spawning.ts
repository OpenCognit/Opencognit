// Agent Spawning Service — Agents können andere Agents zur Laufzeit einstellen
// Task-Manager-Vorbild: hire_agent mit optionalem Board-Approval

import { db } from '../db/client.js';
import { agents, approvals, agentSkills, chatMessages } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export interface HireRequest {
  companyId: string;
  requestedBy: string; // agentId des einstellenden Agents
  name: string;
  role: string;
  skills?: string;
  connectionType?: string;
  budgetMonatCent?: number;
  reportsTo?: string; // agentId des Vorgesetzten (default: requestedBy)
  skillIds?: string[]; // Skills die zugewiesen werden sollen
  systemPrompt?: string;
  requireApproval?: boolean; // Board-Genehmigung erforderlich?
}

export interface HireResult {
  success: boolean;
  agentId?: string;
  approvalId?: string; // Wenn Genehmigung nötig
  error?: string;
}

/**
 * Agent-Hiring: Erstellt einen neuen Agenten (optional mit Board-Approval).
 */
export function hireAgent(request: HireRequest): HireResult {
  const now = new Date().toISOString();
  const {
    companyId, requestedBy, name, role,
    skills, connectionType, budgetMonatCent,
    reportsTo, skillIds, systemPrompt, requireApproval
  } = request;

  // Prüfe ob der anfragende Agent existiert
  const requester = db.select().from(agents).where(eq(agents.id, requestedBy)).get();
  if (!requester) return { success: false, error: 'Requesting agent not found' };

  // Wenn Board-Approval nötig: Genehmigung erstellen statt direkt einzustellen
  if (requireApproval) {
    const approvalId = uuid();
    db.insert(approvals).values({
      id: approvalId,
      companyId,
      type: 'hire_expert',
      title: `Agent einstellen: ${name}`,
      description: `${requester.name} möchte einen neuen Agenten einstellen: ${name} (${role})`,
      requestedBy,
      status: 'pending',
      payload: JSON.stringify({
        action: 'hire_agent',
        params: { name, role, skills, connectionType, budgetMonatCent, reportsTo, skillIds, systemPrompt }
      }),
      createdAt: now,
      updatedAt: now,
    }).run();

    return { success: true, approvalId };
  }

  // Direkte Einstellung (kein Approval nötig)
  const agentId = uuid();
  const config = JSON.stringify({ autonomyLevel: 'copilot' });

  db.insert(agents).values({
    id: agentId,
    companyId,
    name,
    role,
    skills: skills || null,
    connectionType: connectionType || 'openrouter',
    connectionConfig: config,
    avatar: null,
    avatarColor: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
    monthlyBudgetCent: budgetMonatCent || 1000,
    monthlySpendCent: 0,
    reportsTo: reportsTo || requestedBy,
    systemPrompt: systemPrompt || null,
    status: 'idle',
    messageCount: 0,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Skills zuweisen
  if (skillIds && skillIds.length > 0) {
    for (const skillId of skillIds) {
      db.insert(agentSkills).values({
        id: uuid(),
        agentId,
        skillId,
        createdAt: now,
      }).run();
    }
  }

  // Benachrichtigung an den anfragenden Agent
  db.insert(chatMessages).values({
    id: uuid(),
    companyId,
    agentId: requestedBy,
    senderType: 'system',
    message: `✅ Neuer Agent eingestellt: **${name}** (${role}). Reports to: ${requester.name}`,
    read: false,
    createdAt: now,
  }).run();

  console.log(`🤝 Agent Spawning: ${requester.name} hat ${name} (${role}) eingestellt`);

  return { success: true, agentId };
}
