import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';

// ===== Benutzer =====
export const benutzer = sqliteTable('benutzer', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwortHash: text('passwort_hash').notNull(),
  rolle: text('rolle', { enum: ['admin', 'mitglied'] }).notNull().default('mitglied'),
  oauthProvider: text('oauth_provider'),
  oauthId: text('oauth_id'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Unternehmen (ehem. Firmen) =====
export const unternehmen = sqliteTable('unternehmen', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  beschreibung: text('beschreibung'),
  ziel: text('ziel'),
  workDir: text('work_dir'),  // absolute path to project workspace — inherited by all agents
  status: text('status', { enum: ['active', 'paused', 'archived'] }).notNull().default('active'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Experten (Agenten, ehem. Mitarbeiter) =====
export const experten = sqliteTable('experten', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  name: text('name').notNull(),
  rolle: text('rolle').notNull(),
  titel: text('titel'),
  status: text('status', { enum: ['active', 'paused', 'idle', 'running', 'error', 'terminated'] }).notNull().default('idle'),
  reportsTo: text('reports_to').references((): any => experten.id),
  faehigkeiten: text('faehigkeiten'),
  verbindungsTyp: text('verbindungs_typ', { enum: ['claude', 'claude-code', 'anthropic', 'openai', 'openrouter', 'ollama', 'ollama_cloud', 'codex', 'codex-cli', 'gemini-cli', 'cursor', 'http', 'bash', 'ceo', 'custom', 'openclaw'] }).notNull().default('openrouter'),
  verbindungsConfig: text('verbindungs_config'), // JSON string
  avatar: text('avatar'),
  avatarFarbe: text('avatar_farbe').notNull().default('#23CDCA'),
  budgetMonatCent: integer('budget_monat_cent').notNull().default(0),
  verbrauchtMonatCent: integer('verbraucht_monat_cent').notNull().default(0),
  letzterZyklus: text('letzter_zyklus'),
  zyklusIntervallSek: integer('zyklus_intervall_sek').default(300),
  zyklusAktiv: integer('zyklus_aktiv', { mode: 'boolean' }).default(false),
  isOrchestrator: integer('is_orchestrator', { mode: 'boolean' }).default(false),
  systemPrompt: text('system_prompt'),
  advisorId: text('advisor_id').references((): any => experten.id),
  advisorStrategy: text('advisor_strategy', { enum: ['none', 'planning', 'native'] }).notNull().default('none'),
  advisorConfig: text('advisor_config'), // JSON string
  // SOUL Document (Git-tracked agent identity)
  soulPath: text('soul_path'),    // absolute path to *.soul.md file (optional)
  soulVersion: text('soul_version'), // mtime-based hash or git-hash for cache invalidation
  nachrichtenCount: integer('nachrichten_count').notNull().default(0),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Aufgaben =====
export const aufgaben = sqliteTable('aufgaben', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  titel: text('titel').notNull(),
  beschreibung: text('beschreibung'),
  status: text('status', { enum: ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'] }).notNull().default('backlog'),
  prioritaet: text('prioritaet', { enum: ['critical', 'high', 'medium', 'low'] }).notNull().default('medium'),
  zugewiesenAn: text('zugewiesen_an').references(() => experten.id),
  erstelltVon: text('erstellt_von'), // expert ID or 'board'
  parentId: text('parent_id').references((): any => aufgaben.id),
  projektId: text('projekt_id'),
  zielId: text('ziel_id'),
  // Issue-Execution-Lock (verhindert parallele Ausführung am selben Issue)
  executionRunId: text('execution_run_id'), // FK zu arbeitszyklen.id
  executionAgentNameKey: text('execution_agent_name_key'), // normalized agent name
  executionLockedAt: text('execution_locked_at'),
  // Maximizer Mode: Budget-Limits ignorieren, Agent darf autonom eskalieren
  isMaximizerMode: integer('is_maximizer_mode', { mode: 'boolean' }).default(false),
  // Dependencies (für Task-Orchestrierung)
  blockedBy: text('blocked_by'),
  workspacePath: text('workspace_path'),
  gestartetAm: text('gestartet_am'),
  abgeschlossenAm: text('abgeschlossen_am'),
  abgebrochenAm: text('abgebrochen_am'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
}, (t) => ({
  idxZugewiesenAn:       index('aufgaben_zugewiesen_an_idx').on(t.zugewiesenAn),
  idxUnternehmenStatus:  index('aufgaben_unternehmen_status_idx').on(t.unternehmenId, t.status),
  idxExecutionLocked:    index('aufgaben_execution_locked_idx').on(t.executionLockedAt),
}));

// ===== Kommentare =====
export const kommentare = sqliteTable('kommentare', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  aufgabeId: text('aufgabe_id').notNull().references(() => aufgaben.id),
  autorExpertId: text('autor_expert_id').references(() => experten.id),
  autorTyp: text('autor_typ', { enum: ['agent', 'board'] }).notNull().default('board'),
  inhalt: text('inhalt').notNull(),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Chat-Nachrichten =====
export const chatNachrichten = sqliteTable('chat_nachrichten', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  vonExpertId: text('von_expert_id'), // sender expertId when agent→agent P2P
  threadId: text('thread_id'),        // meeting thread grouping
  absenderTyp: text('absender_typ', { enum: ['board', 'agent', 'system'] }).notNull(),
  nachricht: text('nachricht').notNull(),
  gelesen: integer('gelesen', { mode: 'boolean' }).notNull().default(false),
  erstelltAm: text('erstellt_am').notNull(),
}, (t) => ({
  idxExpertGelesen: index('chat_nachrichten_expert_gelesen_idx').on(t.expertId, t.gelesen),
  idxExpertAm:      index('chat_nachrichten_expert_am_idx').on(t.expertId, t.erstelltAm),
}));

// ===== Agenten-Meetings (Multi-Agent Koordination) =====
export const agentMeetings = sqliteTable('agenten_meetings', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  titel: text('titel').notNull(),
  veranstalterExpertId: text('veranstalter_expert_id').notNull().references(() => experten.id),
  teilnehmerIds: text('teilnehmer_ids').notNull(), // JSON array of expert IDs
  antworten: text('antworten').default('{}'),       // JSON map { expertId: "response" }
  status: text('status', { enum: ['running', 'completed', 'cancelled'] }).notNull().default('running'),
  ergebnis: text('ergebnis'),                       // final CEO synthesis
  erstelltAm: text('erstellt_am').notNull(),
  abgeschlossenAm: text('abgeschlossen_am'),
});

// ===== Genehmigungen =====
export const genehmigungen = sqliteTable('genehmigungen', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  typ: text('typ', { enum: ['hire_expert', 'approve_strategy', 'budget_change', 'agent_action'] }).notNull(),
  titel: text('titel').notNull(),
  beschreibung: text('beschreibung'),
  angefordertVon: text('angefordert_von'), // expert ID
  status: text('status', { enum: ['pending', 'approved', 'rejected', 'cancelled'] }).notNull().default('pending'),
  payload: text('payload'), // JSON string
  entscheidungsnotiz: text('entscheidungsnotiz'),
  entschiedenAm: text('entschieden_am'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
  telegramChatId: text('telegram_chat_id'),
  telegramMessageId: integer('telegram_message_id'),
  notifiedAt: text('notified_at'),
});

// ===== Kostenbuchungen =====
export const kostenbuchungen = sqliteTable('kostenbuchungen', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  aufgabeId: text('aufgabe_id').references(() => aufgaben.id),
  anbieter: text('anbieter').notNull(), // 'openai', 'anthropic', etc.
  modell: text('modell').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  kostenCent: integer('kosten_cent').notNull(),
  zeitpunkt: text('zeitpunkt').notNull(),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Aktivitätsprotokoll =====
export const aktivitaetslog = sqliteTable('aktivitaetslog', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  akteurTyp: text('akteur_typ', { enum: ['agent', 'board', 'system'] }).notNull(),
  akteurId: text('akteur_id').notNull(),
  akteurName: text('akteur_name'),
  aktion: text('aktion').notNull(),
  entitaetTyp: text('entitaet_typ').notNull(), // 'aufgabe', 'expert', 'unternehmen', etc.
  entitaetId: text('entitaet_id').notNull(),
  details: text('details'), // JSON string
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Arbeitszyklen (Heartbeat-Läufe) =====
export const arbeitszyklen = sqliteTable('arbeitszyklen', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  quelle: text('quelle', { enum: ['scheduler', 'manual', 'callback', 'assignment', 'automation'] }).notNull().default('manual'),
  status: text('status', { enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'deferred'] }).notNull().default('queued'),
  befehl: text('befehl'), // command that was run
  ausgabe: text('ausgabe'), // stdout/stderr
  fehler: text('fehler'),
  gestartetAm: text('gestartet_am'),
  beendetAm: text('beendet_am'),
  erstelltAm: text('erstellt_am').notNull(),
  // Heartbeat-specific fields (execution tracking)
  invocationSource: text('invocation_source'), // "on_demand", "timer", "assignment"
  triggerDetail: text('trigger_detail'), // "manual", "ping", "callback", "system"
  exitCode: integer('exit_code'),
  usageJson: text('usage_json'), // JSON: { inputTokens, outputTokens, costCents }
  resultJson: text('result_json'), // JSON: agent output
  sessionIdBefore: text('session_id_before'),
  sessionIdAfter: text('session_id_after'),
  contextSnapshot: text('context_snapshot'), // JSON: { issueId, wakeReason, etc. }
  retryOfRunId: text('retry_of_run_id').references((): any => arbeitszyklen.id),
});

// ===== Ziele =====
export const ziele = sqliteTable('ziele', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  titel: text('titel').notNull(),
  beschreibung: text('beschreibung'),
  ebene: text('ebene', { enum: ['company', 'team', 'agent', 'task'] }).notNull().default('company'),
  parentId: text('parent_id').references((): any => ziele.id),
  eigentuemerExpertId: text('eigentuemer_expert_id').references(() => experten.id),
  status: text('status', { enum: ['planned', 'active', 'achieved', 'cancelled'] }).notNull().default('planned'),
  fortschritt: integer('fortschritt').notNull().default(0),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Einstellungen =====
export const einstellungen = sqliteTable('einstellungen', {
  schluessel: text('schluessel').notNull(),
  unternehmenId: text('unternehmen_id').notNull().default(''), // '' = global
  wert: text('wert').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.schluessel, t.unternehmenId] }),
}));

// ===== Agent Wakeup Requests =====
export const agentWakeupRequests = sqliteTable('agent_wakeup_requests', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  source: text('source', { enum: ['timer', 'assignment', 'on_demand', 'automation'] }).notNull(),
  triggerDetail: text('trigger_detail'), // "manual", "ping", "callback", "system"
  reason: text('reason').notNull(), // why the wakeup was requested
  payload: text('payload'), // JSON: { issueId?, taskId?, wakeCommentId?, etc. }
  status: text('status', { enum: ['queued', 'claimed', 'completed', 'failed', 'deferred'] }).notNull().default('queued'),
  coalescedCount: integer('coalesced_count').notNull().default(0), // deduplication counter
  runId: text('run_id').references((): any => arbeitszyklen.id), // linked heartbeat run
  contextSnapshot: text('context_snapshot'), // JSON: { issueId?, source? }
  requestedAt: text('requested_at').notNull(),
  claimedAt: text('claimed_at'),
  finishedAt: text('finished_at'),
}, (t) => ({
  idxExpertStatus: index('wakeup_expert_status_idx').on(t.expertId, t.status),
  idxUnternehmenStatus: index('wakeup_unternehmen_status_idx').on(t.unternehmenId, t.status),
}));

// ===== Routines (wiederkehrende Aufgaben) =====
export const routinen = sqliteTable('routinen', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  titel: text('titel').notNull(),
  beschreibung: text('beschreibung'),
  zugewiesenAn: text('zugewiesen_an').references(() => experten.id),
  prioritaet: text('prioritaet', { enum: ['critical', 'high', 'medium', 'low'] }).notNull().default('medium'),
  status: text('status', { enum: ['active', 'paused'] }).notNull().default('active'),
  concurrencyPolicy: text('concurrency_policy', { enum: ['coalesce_if_active', 'skip_if_active', 'always_enqueue'] }).notNull().default('coalesce_if_active'),
  catchUpPolicy: text('catch_up_policy', { enum: ['skip_missed', 'catch_up'] }).notNull().default('skip_missed'),
  variablen: text('variablen'), // JSON: variable definitions
  zuletztAusgefuehrtAm: text('zuletzt_ausgefuehrt_am'),
  zuletztEnqueuedAm: text('zuletzt_enqueued_am'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Routine Trigger =====
export const routineTrigger = sqliteTable('routine_trigger', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  routineId: text('routine_id').notNull().references(() => routinen.id),
  kind: text('kind', { enum: ['schedule', 'webhook', 'api'] }).notNull(),
  aktiv: integer('aktiv', { mode: 'boolean' }).notNull().default(true),
  cronExpression: text('cron_expression'), // for schedule triggers
  timezone: text('timezone').default('UTC'),
  naechsterAusfuehrungAm: text('naechster_ausfuehrung_am'),
  zuletztGefeuertAm: text('zuletzt_gefeuert_am'),
  publicId: text('public_id'), // for webhook URLs
  secretId: text('secret_id'), // for webhook signing
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Routine Ausführungen =====
export const routineAusfuehrung = sqliteTable('routine_ausfuehrung', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  routineId: text('routine_id').notNull().references(() => routinen.id),
  triggerId: text('trigger_id').references(() => routineTrigger.id),
  quelle: text('quelle', { enum: ['schedule', 'manual', 'api', 'webhook'] }).notNull(),
  status: text('status', { enum: ['received', 'enqueued', 'completed', 'failed'] }).notNull().default('received'),
  payload: text('payload'), // JSON: trigger payload
  aufgabeId: text('aufgabe_id').references(() => aufgaben.id), // linked issue created
  erstelltAm: text('erstellt_am').notNull(),
  abgeschlossenAm: text('abgeschlossen_am'),
});

// ===== Work Products =====
export const workProducts = sqliteTable('work_products', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  aufgabeId: text('aufgabe_id').notNull().references(() => aufgaben.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  runId: text('run_id').references(() => arbeitszyklen.id),
  typ: text('typ').notNull().default('file'), // file, text, url, directory
  name: text('name').notNull(),
  pfad: text('pfad'),
  inhalt: text('inhalt'),
  groeßeBytes: integer('groesse_bytes'),
  mimeTyp: text('mime_typ'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Projekte =====
export const projekte = sqliteTable('projekte', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  name: text('name').notNull(),
  beschreibung: text('beschreibung'),
  status: text('status', { enum: ['aktiv', 'pausiert', 'abgeschlossen', 'archiviert'] }).notNull().default('aktiv'),
  prioritaet: text('prioritaet', { enum: ['low', 'medium', 'high', 'critical'] }).notNull().default('medium'),
  zielId: text('ziel_id').references(() => ziele.id),
  eigentuemerId: text('eigentuemer_id').references(() => experten.id),
  farbe: text('farbe').notNull().default('#23CDCB'),
  deadline: text('deadline'),
  fortschritt: integer('fortschritt').notNull().default(0),
  whiteboardState: text('whiteboard_state'), // JSON: shared project whiteboard for agents
  workDir: text('work_dir'),  // per-project workspace path — overrides unternehmen.workDir
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Agent Permissions =====
export const agentPermissions = sqliteTable('agent_permissions', {
  id: text('id').primaryKey(),
  expertId: text('expert_id').notNull().references(() => experten.id).unique(),
  darfAufgabenErstellen: integer('darf_aufgaben_erstellen', { mode: 'boolean' }).notNull().default(true),
  darfAufgabenZuweisen: integer('darf_aufgaben_zuweisen', { mode: 'boolean' }).notNull().default(false),
  darfGenehmigungAnfordern: integer('darf_genehmigungen_anfordern', { mode: 'boolean' }).notNull().default(true),
  darfGenehmigungEntscheiden: integer('darf_genehmigungen_entscheiden', { mode: 'boolean' }).notNull().default(false),
  darfExpertenAnwerben: integer('darf_experten_anwerben', { mode: 'boolean' }).notNull().default(false),
  budgetLimitCent: integer('budget_limit_cent'),     // NULL = Firmen-Budget gilt
  erlaubtePfade: text('erlaubte_pfade'),             // JSON array of allowed paths, NULL = none
  erlaubteDomains: text('erlaubte_domains'),         // JSON array of allowed domains, NULL = none
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Glass Agent: Trace Events (real-time agent execution log) =====
export const traceEreignisse = sqliteTable('trace_ereignisse', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  runId: text('run_id'), // linked to arbeitszyklen.id
  typ: text('typ').notNull(), // 'thinking' | 'action' | 'result' | 'error' | 'info'
  titel: text('titel').notNull(),
  details: text('details'), // optional extra text
  erstelltAm: text('erstellt_am').notNull(),
}, (t) => ({
  idxExpertAm: index('trace_expert_am_idx').on(t.expertId, t.erstelltAm),
  idxUnternehmenAm: index('trace_unternehmen_am_idx').on(t.unternehmenId, t.erstelltAm),
}));

// ===== Skill Library (RAG-lite: Markdown knowledge base per company) =====
export const skillsLibrary = sqliteTable('skills_library', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  name: text('name').notNull(),
  beschreibung: text('beschreibung'),
  inhalt: text('inhalt').notNull(), // Full markdown content
  tags: text('tags'), // JSON array of tags for keyword matching
  erstelltVon: text('erstellt_von'), // user id oder 'learning-loop' für auto-generierte
  // Learning Loop Felder
  konfidenz: integer('konfidenz').notNull().default(50), // 0-100, startet bei 50
  nutzungen: integer('nutzungen').notNull().default(0), // Wie oft der Skill verwendet wurde
  erfolge: integer('erfolge').notNull().default(0), // Erfolgreiche Nutzungen
  quelle: text('quelle', { enum: ['manuell', 'learning-loop', 'clipmart'] }).notNull().default('manuell'),
  remoteRef: text('remote_ref'), // Remote-Quelle (GitHub URL etc.)
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});


// ===== Expert <-> Skill Library (assignment) =====
export const expertenSkills = sqliteTable('experten_skills', {
  id: text('id').primaryKey(),
  expertId: text('expert_id').notNull().references(() => experten.id),
  skillId: text('skill_id').notNull().references(() => skillsLibrary.id),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Memory (nativer Gedächtnis-Palast — ersetzt Python MCP-Server) =====

// Wings: Jeder Agent hat einen isolierten Wing
export const palaceWings = sqliteTable('palace_wings', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  name: text('name').notNull(), // z.B. "ceo", "cto" (lowercase, underscored)
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// Drawers: Speichereinheiten innerhalb eines Wings
export const palaceDrawers = sqliteTable('palace_drawers', {
  id: text('id').primaryKey(),
  wingId: text('wing_id').notNull().references(() => palaceWings.id),
  room: text('room').notNull(), // z.B. "notizen", "chat_history", "task_results"
  inhalt: text('inhalt').notNull(),
  erstelltAm: text('erstellt_am').notNull(),
});

// Diary: AAAK-Tagebucheinträge pro Wing
export const palaceDiary = sqliteTable('palace_diary', {
  id: text('id').primaryKey(),
  wingId: text('wing_id').notNull().references(() => palaceWings.id),
  datum: text('datum').notNull(), // ISO date (YYYY-MM-DD)
  thought: text('thought'),
  action: text('action'),
  knowledge: text('knowledge'),
  erstelltAm: text('erstellt_am').notNull(),
});

// Knowledge Graph: Temporale Fakten (Subject-Predicate-Object Tripel)
export const palaceKg = sqliteTable('palace_kg', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  subject: text('subject').notNull(),
  predicate: text('predicate').notNull(),
  object: text('object').notNull(),
  validFrom: text('valid_from'), // ISO date — wann wurde dieser Fakt gültig
  validUntil: text('valid_until'), // ISO date — wann wurde er ungültig (NULL = noch gültig)
  erstelltVon: text('erstellt_von'), // expert_id oder 'system'
  erstelltAm: text('erstellt_am').notNull(),
}, (t) => ({
  idxSubjectValid: index('kg_subject_valid_idx').on(t.subject, t.validUntil),
  idxUnternehmenSubject: index('kg_unternehmen_subject_idx').on(t.unternehmenId, t.subject),
}));

// ===== Context Summaries (iterative Kompression) =====
export const palaceSummaries = sqliteTable('palace_summaries', {
  id: text('id').primaryKey(),
  expertId: text('expert_id').notNull().references(() => experten.id),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  inhalt: text('inhalt').notNull(), // Strukturierte Zusammenfassung (Goal, Progress, Decisions, etc.)
  version: integer('version').notNull().default(1), // Wird bei jedem Update inkrementiert
  komprimierteTurns: integer('komprimierte_turns').notNull().default(0),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Budget Policies (Scope-Hierarchie + Incidents) =====
export const budgetPolicies = sqliteTable('budget_policies', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  scope: text('scope', { enum: ['company', 'project', 'agent'] }).notNull(),
  scopeId: text('scope_id').notNull(), // unternehmenId, projektId oder expertId
  limitCent: integer('limit_cent').notNull(),
  fenster: text('fenster', { enum: ['monatlich', 'lifetime'] }).notNull().default('monatlich'),
  warnProzent: integer('warn_prozent').notNull().default(80),
  hardStop: integer('hard_stop', { mode: 'boolean' }).notNull().default(true),
  aktiv: integer('aktiv', { mode: 'boolean' }).notNull().default(true),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

export const budgetIncidents = sqliteTable('budget_incidents', {
  id: text('id').primaryKey(),
  policyId: text('policy_id').notNull().references(() => budgetPolicies.id),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  typ: text('typ', { enum: ['warnung', 'hard_stop'] }).notNull(),
  beobachteterBetrag: integer('beobachteter_betrag').notNull(), // in Cent
  limitBetrag: integer('limit_betrag').notNull(),
  status: text('status', { enum: ['offen', 'behoben', 'ignoriert'] }).notNull().default('offen'),
  behobeneAm: text('behoben_am'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Execution Workspaces (isolierte Task-Umgebungen) =====
export const executionWorkspaces = sqliteTable('execution_workspaces', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  aufgabeId: text('aufgabe_id').references(() => aufgaben.id),
  expertId: text('expert_id').references(() => experten.id),
  pfad: text('pfad').notNull(), // Absoluter Pfad zum Workspace-Verzeichnis
  branchName: text('branch_name'), // Git-Branch (wenn git-aware)
  basePfad: text('base_pfad'), // Basis-Verzeichnis von dem abgeleitet
  abgeleitetVon: text('abgeleitet_von').references((): any => executionWorkspaces.id),
  status: text('status', { enum: ['offen', 'aktiv', 'geschlossen', 'aufgeraeumt'] }).notNull().default('offen'),
  metadaten: text('metadaten'), // JSON für Erweiterbarkeit
  geoeffnetAm: text('geoeffnet_am').notNull(),
  geschlossenAm: text('geschlossen_am'),
  aufgeraeumtAm: text('aufgeraeumt_am'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Issue Relations (Blocking-Graph für Task-Dependencies) =====
export const issueRelations = sqliteTable('issue_relations', {
  id: text('id').primaryKey(),
  quellId: text('quell_id').notNull().references(() => aufgaben.id), // Die blockierende Aufgabe
  zielId: text('ziel_id').notNull().references(() => aufgaben.id),   // Die blockierte Aufgabe
  typ: text('typ', { enum: ['blocks'] }).notNull().default('blocks'),
  erstelltVon: text('erstellt_von'), // expertId oder 'board'
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== OpenClaw Gateway Tokens =====
// Per-company invite tokens that OpenClaw agents use to register themselves.
export const openclawTokens = sqliteTable('openclaw_tokens', {
  id:            text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  token:         text('token').notNull().unique(),
  beschreibung:  text('beschreibung'),
  erstelltAm:    text('erstellt_am').notNull(),
  letzterJoin:   text('letzter_join'),
});

// ===== Expert Config History (rollback snapshots) =====
// ===== CEO Decision Log — persistenter roter Faden für den Orchestrator =====
// Jeder Planungszyklus schreibt einen Eintrag; beim nächsten Zyklus wird der
// letzte Eintrag in den Kontext geladen → kein Amnesie-Problem mehr.
export const ceoDecisionLog = sqliteTable('ceo_decision_log', {
  id: text('id').primaryKey(),
  expertId: text('expert_id').notNull().references(() => experten.id),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  runId: text('run_id').notNull(),
  erstelltAm: text('erstellt_am').notNull(),
  // Structured decision snapshot
  focusSummary: text('focus_summary').notNull(),      // 1-2 sentences: what the CEO decided to focus on
  actionsJson: text('actions_json').notNull(),          // JSON array of actions taken this cycle
  goalsSnapshot: text('goals_snapshot'),               // JSON: goal titles + progress at decision time
  pendingTaskCount: integer('pending_task_count').notNull().default(0),
  teamSummary: text('team_summary'),                   // "Anna(3 tasks), Bob(1 task)"
}, (t) => ({
  idxCeoLog: index('ceo_decision_log_expert_idx').on(t.expertId, t.erstelltAm),
}));

export const expertConfigHistory = sqliteTable('expert_config_history', {
  id: text('id').primaryKey(),
  expertId: text('expert_id').notNull().references(() => experten.id),
  changedAt: text('changed_at').notNull(),
  changedBy: text('changed_by'), // userId or 'system'
  configJson: text('config_json').notNull(), // full snapshot of changed fields
  note: text('note'),
}, (t) => ({
  idxExpertHistory: index('expert_config_history_expert_idx').on(t.expertId, t.changedAt),
}));

// ===== Worker Nodes (Multi-Node Agent Worker Pool) =====
// Persistent registry of worker processes that can claim and run agent work.
// Workers authenticate via a shared token and send periodic heartbeats.
export const workerNodes = sqliteTable('worker_nodes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),                 // human-readable
  hostname: text('hostname'),
  capabilities: text('capabilities').notNull(), // JSON string array: ['claude-code','bash','ollama']
  tokenHash: text('token_hash').notNull(),      // sha256 of auth token
  status: text('status', { enum: ['online', 'offline', 'disabled'] }).notNull().default('online'),
  maxConcurrency: integer('max_concurrency').notNull().default(1),
  activeRuns: integer('active_runs').notNull().default(0),
  totalRuns: integer('total_runs').notNull().default(0),
  lastHeartbeatAt: text('last_heartbeat_at'),
  registriertAm: text('registriert_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
}, (t) => ({
  idxStatus: index('worker_nodes_status_idx').on(t.status, t.lastHeartbeatAt),
}));

// Export helper for all tables
export const allTables = {
  benutzer,
  unternehmen,
  experten,
  aufgaben,
  kommentare,
  chatNachrichten,
  agentMeetings,
  genehmigungen,
  kostenbuchungen,
  aktivitaetslog,
  arbeitszyklen,
  ziele,
  einstellungen,
  agentWakeupRequests,
  routinen,
  routineTrigger,
  routineAusfuehrung,
  workProducts,
  projekte,
  agentPermissions,
  traceEreignisse,
  skillsLibrary,
  expertenSkills,
  palaceWings,
  palaceDrawers,
  palaceDiary,
  palaceKg,
  palaceSummaries,
  budgetPolicies,
  budgetIncidents,
  executionWorkspaces,
  issueRelations,
  openclawTokens,
  expertConfigHistory,
  ceoDecisionLog,
  workerNodes,
};
