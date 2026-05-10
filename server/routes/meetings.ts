// =============================================================================
// Agent meetings routes — extracted from server/index.ts as part of the
// `refactor/server-routes-split` work.
//
// Multi-agent coordination: a board user opens a "meeting" with selected
// agents, each agent gets pinged via the chat + scheduler, and responses
// land back on the meeting record.
// =============================================================================

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { eq, and } from 'drizzle-orm';

import { db } from '../db/client.js';
import { agentMeetings, agents, chatMessages } from '../db/schema.js';
import { scheduler } from '../scheduler.js';
import { logAktivitaet } from '../services/activity-log.js';
import { appEvents } from '../events.js';
import { authMiddleware, requireCompanyAccess, requireResourceAccess } from '../middleware/auth.js';

const router = Router();
const now = () => new Date().toISOString();
const broadcast = (type: string, data: any) => appEvents.emit('broadcast', { type, data });

router.get('/api/companies/:id/meetings', authMiddleware, requireCompanyAccess(), (req, res) => {
  try {
    const meetings = db.select().from(agentMeetings)
      .where(eq(agentMeetings.companyId, req.params.id as string))
      .all()
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));

    // Enrich with participant names
    const all_agents = db.select({ id: agents.id, name: agents.name, avatarFarbe: agents.avatarColor, verbindungsTyp: agents.connectionType, verbindungsConfig: agents.connectionConfig })
      .from(agents).where(eq(agents.companyId, req.params.id as string)).all();

    function deriveModelLabel(verbindungsTyp: string, verbindungsConfig: string | null): string {
      try {
        const cfg = JSON.parse(verbindungsConfig || '{}');
        if (cfg.model) return cfg.model.split('/').pop()?.split(':')[0] || cfg.model;
      } catch {}
      const labels: Record<string, string> = {
        anthropic: 'Claude', openai: 'GPT-4o', openrouter: 'OpenRouter',
        ollama: 'Ollama', groq: 'Groq', gemini: 'Gemini', custom: 'Custom',
        ceo: 'CEO', 'claude-code': 'Claude Code',
      };
      return labels[verbindungsTyp] || verbindungsTyp;
    }

    const agentMap = Object.fromEntries((all_agents as any[]).map(a => [a.id, {
      ...a,
      modellLabel: deriveModelLabel(a.connectionType, a.connectionConfig),
    }]));

    const enriched = meetings.map((m: any) => {
      let teilnehmerIds: string[] = [];
      let antworten: Record<string, string> = {};
      try { teilnehmerIds = JSON.parse(m.participantIds || '[]'); } catch {}
      try { antworten = JSON.parse(m.responses || '{}'); } catch {}
      return {
        ...m,
        veranstalter: agentMap[m.organizerAgentId] || null,
        teilnehmer: teilnehmerIds.map(id => {
          if (id === '__board__') return {
            id: '__board__', name: 'Du (Board)', avatarFarbe: '#6366f1', isBoard: true,
            hatGeantwortet: !!antworten[id], antwort: antworten[id] || null,
          };
          const agent = agentMap[id] || { id, name: id };
          return { ...agent, hatGeantwortet: !!antworten[id], antwort: antworten[id] || null };
        }),
      };
    });

    res.json(enriched);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/meetings/:id', authMiddleware, requireResourceAccess('meeting'), (req, res) => {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).get() as any;
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });

    const all_agents = db.select({ id: agents.id, name: agents.name, avatarFarbe: agents.avatarColor })
      .from(agents).where(eq(agents.companyId, meeting.companyId)).all();
    const agentMap = Object.fromEntries((all_agents as any[]).map(a => [a.id, a]));
    let teilnehmerIds: string[] = [];
    let antworten: Record<string, string> = {};
    try { teilnehmerIds = JSON.parse(meeting.participantIds || '[]'); } catch {}
    try { antworten = JSON.parse(meeting.responses || '{}'); } catch {}

    res.json({
      ...meeting,
      veranstalter: agentMap[meeting.organizerAgentId] || null,
      teilnehmer: teilnehmerIds.map(id => {
        if (id === '__board__') return {
          id: '__board__', name: 'Du (Board)', avatarFarbe: '#6366f1', isBoard: true,
          hatGeantwortet: !!antworten[id], antwort: antworten[id] || null,
        };
        return { ...(agentMap[id] || { id, name: id }), hatGeantwortet: !!antworten[id], antwort: antworten[id] || null };
      }),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/meetings/:id/message', authMiddleware, requireResourceAccess('meeting'), async (req, res) => {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).get() as any;
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.status !== 'running') return res.status(400).json({ error: 'Meeting is not active' });

    const { nachricht } = req.body;
    if (!nachricht?.trim()) return res.status(400).json({ error: 'Message missing' });

    const BOARD_KEY = '__board__';
    let teilnehmerIds: string[] = [];
    let antworten: Record<string, string> = {};
    try { teilnehmerIds = JSON.parse(meeting.participantIds || '[]'); } catch {}
    try { antworten = JSON.parse(meeting.responses || '{}'); } catch {}

    // Append board message (allow multiple messages via timestamp key)
    const boardMsgKey = `${BOARD_KEY}_${Date.now()}`;
    if (!teilnehmerIds.includes(BOARD_KEY)) teilnehmerIds.push(BOARD_KEY);
    antworten[boardMsgKey] = nachricht.trim();
    antworten[BOARD_KEY] = nachricht.trim(); // latest board message always at __board__

    db.update(agentMeetings).set({
      participantIds: JSON.stringify(teilnehmerIds),
      responses: JSON.stringify(antworten),
    }).where(eq(agentMeetings.id, req.params.id as string)).run();

    broadcast('meeting_updated', { unternehmenId: meeting.companyId, meetingId: req.params.id });
    res.json({ success: true });

    // ── Trigger @mentioned agents, or all unanswered participants ─────────
    const agentParticipants = teilnehmerIds
      .filter(id => id !== BOARD_KEY && !id.startsWith('__board__'))
      .map(id => db.select().from(agents).where(eq(agents.id, id)).get())
      .filter(Boolean) as any[];

    // Detect @mentions: "@Name" anywhere in message
    const mentioned = agentParticipants.filter(a =>
      new RegExp(`@${a.name.split(' ')[0]}`, 'i').test(nachricht),
    );
    const toTrigger = mentioned.length > 0
      ? mentioned
      : agentParticipants.filter(a => !antworten[a.id]); // unanswered only

    console.log(`[Meeting] Board message → waking ${toTrigger.length} agents: ${toTrigger.map((a: any) => a.name).join(', ')}`);
    toTrigger.forEach((agent: any, idx: number) => {
      setTimeout(async () => {
        try {
          console.log(`[Meeting] Triggering ${agent.name} (${agent.id}) for meeting ${req.params.id}`);
          // Send board message into this agent's chat
          const boardMsg = {
            id: uuid(), companyId: meeting.companyId,
            agentId: agent.id, vonExpertId: null, threadId: req.params.id,
            senderType: 'board' as const,
            message: `[Meeting Board]: ${nachricht.trim()}`,
            read: false, createdAt: now(),
          };
          db.insert(chatMessages).values(boardMsg).run();
          broadcast('chat_message', boardMsg);
          await scheduler.triggerZyklus(agent.id, meeting.companyId, 'manual', undefined, req.params.id as string);
          console.log(`[Meeting] ${agent.name} cycle done`);
        } catch (e: any) {
          console.error(`[Meeting] triggerZyklus error for agent ${agent.id} (${agent.name}):`, e?.message);
        }
      }, idx * 600);
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/meetings/:id/cancel', authMiddleware, requireResourceAccess('meeting'), (req, res) => {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).get() as any;
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.status !== 'running') return res.status(400).json({ error: 'Meeting is not active' });
    db.update(agentMeetings).set({ status: 'cancelled', completedAt: now() }).where(eq(agentMeetings.id, req.params.id as string)).run();
    broadcast('meeting_updated', { unternehmenId: meeting.companyId, meetingId: req.params.id, status: 'cancelled' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/companies/:id/meetings', authMiddleware, requireCompanyAccess(), (req, res) => {
  try {
    const unternehmenId = req.params.id as string;
    const { titel, veranstalterExpertId, teilnehmerIds } = req.body as {
      titel: string; veranstalterExpertId: string; teilnehmerIds: string[];
    };

    if (!titel?.trim()) return res.status(400).json({ error: 'Title missing' });
    if (!veranstalterExpertId) return res.status(400).json({ error: 'Organizer missing' });
    if (!Array.isArray(teilnehmerIds) || teilnehmerIds.length === 0) {
      return res.status(400).json({ error: 'At least one participant required' });
    }

    // Validate veranstalter belongs to company
    const veranstalter = db.select().from(agents)
      .where(and(eq(agents.id, veranstalterExpertId), eq(agents.companyId, unternehmenId))).get();
    if (!veranstalter) return res.status(404).json({ error: 'Organizer agent not found' });

    const meetingId = uuid();
    // Always include __board__ as a participant so the board can reply
    const alleTeilnehmer = [...new Set([...teilnehmerIds.filter(id => id !== veranstalterExpertId), '__board__'])];

    db.insert(agentMeetings).values({
      id: meetingId,
      companyId: unternehmenId,
      title: titel.trim(),
      organizerAgentId: veranstalterExpertId,
      participantIds: JSON.stringify(alleTeilnehmer),
      responses: '{}',
      status: 'running',
      createdAt: now(),
    }).run();

    logAktivitaet(unternehmenId, 'agent', veranstalterExpertId, (veranstalter as any).name, `hat ein Meeting gestartet: "${titel.trim()}"`, 'experte', meetingId);
    broadcast('meeting_created', { unternehmenId, meetingId });
    res.status(201).json({ id: meetingId });

    // ── Wake up each agent participant (non-blocking, staggered) ──────────
    const agentTeilnehmer = alleTeilnehmer.filter(id => id !== '__board__');
    agentTeilnehmer.forEach((teilnehmerId, idx) => {
      setTimeout(async () => {
        try {
          // Send the meeting question as a chat message to this agent
          const frageMsg = {
            id: uuid(), companyId: unternehmenId,
            agentId: teilnehmerId,
            vonExpertId: veranstalterExpertId,
            threadId: meetingId,
            senderType: 'agent' as const,
            absenderName: (veranstalter as any).name,
            message: `📋 **Meeting einberufen**\n\nThema: "${titel.trim()}"\n\nBitte antworte kurz und direkt.`,
            read: false, createdAt: now(),
          };
          db.insert(chatMessages).values(frageMsg).run();
          broadcast('chat_message', frageMsg);
          await scheduler.triggerZyklus(teilnehmerId, unternehmenId, 'manual', veranstalterExpertId, meetingId);
        } catch (e) {
          console.error(`[Meeting] Failed to wake agent ${teilnehmerId}:`, e);
        }
      }, idx * 800);
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/meetings/:id/complete', authMiddleware, requireResourceAccess('meeting'), (req, res) => {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).get() as any;
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const { ergebnis } = req.body as { ergebnis: string };
    db.update(agentMeetings).set({
      status: 'completed',
      result: ergebnis?.trim() || null,
      completedAt: now(),
    }).where(eq(agentMeetings.id, req.params.id as string)).run();
    broadcast('meeting_updated', { unternehmenId: meeting.companyId, meetingId: req.params.id, status: 'completed' });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/meetings/:id', authMiddleware, requireResourceAccess('meeting'), (req, res) => {
  try {
    const meeting = db.select().from(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).get() as any;
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    if (meeting.status === 'running') return res.status(400).json({ error: 'Running meetings cannot be deleted' });
    db.delete(agentMeetings).where(eq(agentMeetings.id, req.params.id as string)).run();
    broadcast('meeting_deleted', { unternehmenId: meeting.companyId, meetingId: req.params.id });
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
