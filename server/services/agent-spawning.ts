// Agent Spawning Service — Agents können andere Agents zur Laufzeit einstellen
// Task-Manager-Vorbild: hire_agent mit optionalem Board-Approval

import { db } from '../db/client.js';
import { experten, genehmigungen, expertenSkills, chatNachrichten } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

export interface HireRequest {
  unternehmenId: string;
  requestedBy: string; // expertId des einstellenden Agents
  name: string;
  rolle: string;
  faehigkeiten?: string;
  verbindungsTyp?: string;
  budgetMonatCent?: number;
  reportsTo?: string; // expertId des Vorgesetzten (default: requestedBy)
  skillIds?: string[]; // Skills die zugewiesen werden sollen
  systemPrompt?: string;
  requireApproval?: boolean; // Board-Genehmigung erforderlich?
}

export interface HireResult {
  success: boolean;
  expertId?: string;
  approvalId?: string; // Wenn Genehmigung nötig
  error?: string;
}

/**
 * Agent-Hiring: Erstellt einen neuen Agenten (optional mit Board-Approval).
 */
export function hireAgent(request: HireRequest): HireResult {
  const now = new Date().toISOString();
  const {
    unternehmenId, requestedBy, name, rolle,
    faehigkeiten, verbindungsTyp, budgetMonatCent,
    reportsTo, skillIds, systemPrompt, requireApproval
  } = request;

  // Prüfe ob der anfragende Agent existiert
  const requester = db.select().from(experten).where(eq(experten.id, requestedBy)).get();
  if (!requester) return { success: false, error: 'Anfragender Agent nicht gefunden' };

  // Wenn Board-Approval nötig: Genehmigung erstellen statt direkt einzustellen
  if (requireApproval) {
    const approvalId = uuid();
    db.insert(genehmigungen).values({
      id: approvalId,
      unternehmenId,
      typ: 'hire_expert',
      titel: `Agent einstellen: ${name}`,
      beschreibung: `${requester.name} möchte einen neuen Agenten einstellen: ${name} (${rolle})`,
      angefordertVon: requestedBy,
      status: 'pending',
      payload: JSON.stringify({
        action: 'hire_agent',
        params: { name, rolle, faehigkeiten, verbindungsTyp, budgetMonatCent, reportsTo, skillIds, systemPrompt }
      }),
      erstelltAm: now,
      aktualisiertAm: now,
    }).run();

    return { success: true, approvalId };
  }

  // Direkte Einstellung (kein Approval nötig)
  const expertId = uuid();
  const config = JSON.stringify({ autonomyLevel: 'copilot' });

  db.insert(experten).values({
    id: expertId,
    unternehmenId,
    name,
    rolle,
    faehigkeiten: faehigkeiten || null,
    verbindungsTyp: verbindungsTyp || 'openrouter',
    verbindungsConfig: config,
    avatar: null,
    avatarFarbe: `#${Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0')}`,
    budgetMonatCent: budgetMonatCent || 1000,
    verbrauchtMonatCent: 0,
    reportsTo: reportsTo || requestedBy,
    systemPrompt: systemPrompt || null,
    status: 'idle',
    nachrichtenCount: 0,
    erstelltAm: now,
    aktualisiertAm: now,
  }).run();

  // Skills zuweisen
  if (skillIds && skillIds.length > 0) {
    for (const skillId of skillIds) {
      db.insert(expertenSkills).values({
        id: uuid(),
        expertId,
        skillId,
        erstelltAm: now,
      }).run();
    }
  }

  // Benachrichtigung an den anfragenden Agent
  db.insert(chatNachrichten).values({
    id: uuid(),
    unternehmenId,
    expertId: requestedBy,
    absenderTyp: 'system',
    nachricht: `✅ Neuer Agent eingestellt: **${name}** (${rolle}). Reports to: ${requester.name}`,
    gelesen: false,
    erstelltAm: now,
  }).run();

  console.log(`🤝 Agent Spawning: ${requester.name} hat ${name} (${rolle}) eingestellt`);

  return { success: true, expertId };
}
