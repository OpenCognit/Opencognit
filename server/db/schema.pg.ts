import { pgTable, text, integer, boolean } from 'drizzle-orm/pg-core';

// ===== Benutzer =====
export const benutzer = pgTable('benutzer', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwortHash: text('passwort_hash').notNull(),
  rolle: text('rolle').notNull().default('mitglied'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Unternehmen =====
export const unternehmen = pgTable('unternehmen', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  beschreibung: text('beschreibung'),
  ziel: text('ziel'),
  status: text('status').notNull().default('active'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Experten =====
export const experten = pgTable('experten', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  name: text('name').notNull(),
  rolle: text('rolle').notNull(),
  titel: text('titel'),
  status: text('status').notNull().default('idle'),
  reportsTo: text('reports_to').references((): any => experten.id),
  faehigkeiten: text('faehigkeiten'),
  verbindungsTyp: text('verbindungs_typ').notNull().default('claude'),
  verbindungsConfig: text('verbindungs_config'),
  avatar: text('avatar'),
  avatarFarbe: text('avatar_farbe').notNull().default('#23CDCA'),
  budgetMonatCent: integer('budget_monat_cent').notNull().default(0),
  verbrauchtMonatCent: integer('verbraucht_monat_cent').notNull().default(0),
  letzterZyklus: text('letzter_zyklus'),
  zyklusIntervallSek: integer('zyklus_intervall_sek').default(300),
  zyklusAktiv: boolean('zyklus_aktiv').default(false),
  systemPrompt: text('system_prompt'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Aufgaben =====
export const aufgaben = pgTable('aufgaben', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  titel: text('titel').notNull(),
  beschreibung: text('beschreibung'),
  status: text('status').notNull().default('backlog'),
  prioritaet: text('prioritaet').notNull().default('medium'),
  zugewiesenAn: text('zugewiesen_an').references(() => experten.id),
  erstelltVon: text('erstellt_von'),
  parentId: text('parent_id').references((): any => aufgaben.id),
  projektId: text('projekt_id'),
  zielId: text('ziel_id'),
  executionRunId: text('execution_run_id'),
  executionAgentNameKey: text('execution_agent_name_key'),
  executionLockedAt: text('execution_locked_at'),
  blockedBy: text('blocked_by'),
  workspacePath: text('workspace_path'),
  gestartetAm: text('gestartet_am'),
  abgeschlossenAm: text('abgeschlossen_am'),
  abgebrochenAm: text('abgebrochen_am'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Kommentare =====
export const kommentare = pgTable('kommentare', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  aufgabeId: text('aufgabe_id').notNull().references(() => aufgaben.id),
  autorExpertId: text('autor_expert_id').references(() => experten.id),
  autorTyp: text('autor_typ').notNull().default('board'),
  inhalt: text('inhalt').notNull(),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Chat-Nachrichten =====
export const chatNachrichten = pgTable('chat_nachrichten', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  absenderTyp: text('absender_typ').notNull(),
  nachricht: text('nachricht').notNull(),
  gelesen: boolean('gelesen').notNull().default(false),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Genehmigungen =====
export const genehmigungen = pgTable('genehmigungen', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  typ: text('typ').notNull(),
  titel: text('titel').notNull(),
  beschreibung: text('beschreibung'),
  angefordertVon: text('angefordert_von'),
  status: text('status').notNull().default('pending'),
  payload: text('payload'),
  entscheidungsnotiz: text('entscheidungsnotiz'),
  entschiedenAm: text('entschieden_am'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Kostenbuchungen =====
export const kostenbuchungen = pgTable('kostenbuchungen', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  aufgabeId: text('aufgabe_id').references(() => aufgaben.id),
  anbieter: text('anbieter').notNull(),
  modell: text('modell').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  kostenCent: integer('kosten_cent').notNull(),
  zeitpunkt: text('zeitpunkt').notNull(),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Aktivitätsprotokoll =====
export const aktivitaetslog = pgTable('aktivitaetslog', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  akteurTyp: text('akteur_typ').notNull(),
  akteurId: text('akteur_id').notNull(),
  akteurName: text('akteur_name'),
  aktion: text('aktion').notNull(),
  entitaetTyp: text('entitaet_typ').notNull(),
  entitaetId: text('entitaet_id').notNull(),
  details: text('details'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Arbeitszyklen =====
export const arbeitszyklen = pgTable('arbeitszyklen', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  quelle: text('quelle').notNull().default('manual'),
  status: text('status').notNull().default('queued'),
  befehl: text('befehl'),
  ausgabe: text('ausgabe'),
  fehler: text('fehler'),
  gestartetAm: text('gestartet_am'),
  beendetAm: text('beendet_am'),
  erstelltAm: text('erstellt_am').notNull(),
  invocationSource: text('invocation_source'),
  triggerDetail: text('trigger_detail'),
  exitCode: integer('exit_code'),
  usageJson: text('usage_json'),
  resultJson: text('result_json'),
  sessionIdBefore: text('session_id_before'),
  sessionIdAfter: text('session_id_after'),
  contextSnapshot: text('context_snapshot'),
  retryOfRunId: text('retry_of_run_id').references((): any => arbeitszyklen.id),
});

// ===== Ziele =====
export const ziele = pgTable('ziele', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  titel: text('titel').notNull(),
  beschreibung: text('beschreibung'),
  ebene: text('ebene').notNull().default('company'),
  parentId: text('parent_id').references((): any => ziele.id),
  eigentuemerExpertId: text('eigentuemer_expert_id').references(() => experten.id),
  status: text('status').notNull().default('planned'),
  fortschritt: integer('fortschritt').notNull().default(0),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Einstellungen =====
export const einstellungen = pgTable('einstellungen', {
  schluessel: text('schluessel').primaryKey(),
  wert: text('wert').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Agent Wakeup Requests =====
export const agentWakeupRequests = pgTable('agent_wakeup_requests', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  source: text('source').notNull(),
  triggerDetail: text('trigger_detail'),
  reason: text('reason').notNull(),
  payload: text('payload'),
  status: text('status').notNull().default('queued'),
  coalescedCount: integer('coalesced_count').notNull().default(0),
  runId: text('run_id').references((): any => arbeitszyklen.id),
  contextSnapshot: text('context_snapshot'),
  requestedAt: text('requested_at').notNull(),
  claimedAt: text('claimed_at'),
  finishedAt: text('finished_at'),
});

// ===== Routinen =====
export const routinen = pgTable('routinen', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  titel: text('titel').notNull(),
  beschreibung: text('beschreibung'),
  zugewiesenAn: text('zugewiesen_an').references(() => experten.id),
  prioritaet: text('prioritaet').notNull().default('medium'),
  status: text('status').notNull().default('active'),
  concurrencyPolicy: text('concurrency_policy').notNull().default('coalesce_if_active'),
  catchUpPolicy: text('catch_up_policy').notNull().default('skip_missed'),
  variablen: text('variablen'),
  zuletztAusgefuehrtAm: text('zuletzt_ausgefuehrt_am'),
  zuletztEnqueuedAm: text('zuletzt_enqueued_am'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Routine Trigger =====
export const routineTrigger = pgTable('routine_trigger', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  routineId: text('routine_id').notNull().references(() => routinen.id),
  kind: text('kind').notNull(),
  aktiv: boolean('aktiv').notNull().default(true),
  cronExpression: text('cron_expression'),
  timezone: text('timezone').default('UTC'),
  naechsterAusfuehrungAm: text('naechster_ausfuehrung_am'),
  zuletztGefeuertAm: text('zuletzt_gefeuert_am'),
  publicId: text('public_id'),
  secretId: text('secret_id'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Work Products =====
export const workProducts = pgTable('work_products', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  aufgabeId: text('aufgabe_id').notNull().references(() => aufgaben.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  runId: text('run_id').references(() => arbeitszyklen.id),
  typ: text('typ').notNull().default('file'),
  name: text('name').notNull(),
  pfad: text('pfad'),
  inhalt: text('inhalt'),
  groeßeBytes: integer('groesse_bytes'),
  mimeTyp: text('mime_typ'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Projekte =====
export const projekte = pgTable('projekte', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  name: text('name').notNull(),
  beschreibung: text('beschreibung'),
  status: text('status').notNull().default('aktiv'),
  prioritaet: text('prioritaet').notNull().default('medium'),
  zielId: text('ziel_id').references(() => ziele.id),
  eigentuemerId: text('eigentuemer_id').references(() => experten.id),
  farbe: text('farbe').notNull().default('#23CDCB'),
  deadline: text('deadline'),
  fortschritt: integer('fortschritt').notNull().default(0),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Agent Permissions =====
export const agentPermissions = pgTable('agent_permissions', {
  id: text('id').primaryKey(),
  expertId: text('expert_id').notNull().references(() => experten.id).unique(),
  darfAufgabenErstellen: boolean('darf_aufgaben_erstellen').notNull().default(true),
  darfAufgabenZuweisen: boolean('darf_aufgaben_zuweisen').notNull().default(false),
  darfGenehmigungAnfordern: boolean('darf_genehmigungen_anfordern').notNull().default(true),
  darfGenehmigungEntscheiden: boolean('darf_genehmigungen_entscheiden').notNull().default(false),
  darfExpertenAnwerben: boolean('darf_experten_anwerben').notNull().default(false),
  budgetLimitCent: integer('budget_limit_cent'),
  erlaubtePfade: text('erlaubte_pfade'),
  erlaubteDomains: text('erlaubte_domains'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Routine Ausführungen =====
export const routineAusfuehrung = pgTable('routine_ausfuehrung', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  routineId: text('routine_id').notNull().references(() => routinen.id),
  triggerId: text('trigger_id').references(() => routineTrigger.id),
  quelle: text('quelle').notNull(),
  status: text('status').notNull().default('received'),
  payload: text('payload'),
  aufgabeId: text('aufgabe_id').references(() => aufgaben.id),
  erstelltAm: text('erstellt_am').notNull(),
  abgeschlossenAm: text('abgeschlossen_am'),
});

// ===== Agent Meetings =====
export const agentMeetings = pgTable('agenten_meetings', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  titel: text('titel').notNull(),
  veranstalterExpertId: text('veranstalter_expert_id').notNull().references(() => experten.id),
  teilnehmerIds: text('teilnehmer_ids').notNull(),
  antworten: text('antworten').default('{}'),
  status: text('status').notNull().default('running'),
  ergebnis: text('ergebnis'),
  erstelltAm: text('erstellt_am').notNull(),
  abgeschlossenAm: text('abgeschlossen_am'),
});

// ===== Trace Ereignisse =====
export const traceEreignisse = pgTable('trace_ereignisse', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  runId: text('run_id'),
  typ: text('typ').notNull(),
  titel: text('titel').notNull(),
  details: text('details'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Skill Library =====
export const skillsLibrary = pgTable('skills_library', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  name: text('name').notNull(),
  beschreibung: text('beschreibung'),
  inhalt: text('inhalt').notNull(),
  tags: text('tags'),
  erstelltVon: text('erstellt_von'),
  konfidenz: integer('konfidenz').notNull().default(50),
  nutzungen: integer('nutzungen').notNull().default(0),
  erfolge: integer('erfolge').notNull().default(0),
  quelle: text('quelle').notNull().default('manuell'),
  remoteRef: text('remote_ref'),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Expert <-> Skill Library =====
export const expertenSkills = pgTable('experten_skills', {
  id: text('id').primaryKey(),
  expertId: text('expert_id').notNull().references(() => experten.id),
  skillId: text('skill_id').notNull().references(() => skillsLibrary.id),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Palace: Wings =====
export const palaceWings = pgTable('palace_wings', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  expertId: text('expert_id').notNull().references(() => experten.id),
  name: text('name').notNull(),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Palace: Drawers =====
export const palaceDrawers = pgTable('palace_drawers', {
  id: text('id').primaryKey(),
  wingId: text('wing_id').notNull().references(() => palaceWings.id),
  room: text('room').notNull(),
  inhalt: text('inhalt').notNull(),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Palace: Diary =====
export const palaceDiary = pgTable('palace_diary', {
  id: text('id').primaryKey(),
  wingId: text('wing_id').notNull().references(() => palaceWings.id),
  datum: text('datum').notNull(),
  thought: text('thought'),
  action: text('action'),
  knowledge: text('knowledge'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Palace: Knowledge Graph =====
export const palaceKg = pgTable('palace_kg', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  subject: text('subject').notNull(),
  predicate: text('predicate').notNull(),
  object: text('object').notNull(),
  validFrom: text('valid_from'),
  validUntil: text('valid_until'),
  erstelltVon: text('erstellt_von'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Palace: Summaries =====
export const palaceSummaries = pgTable('palace_summaries', {
  id: text('id').primaryKey(),
  expertId: text('expert_id').notNull().references(() => experten.id),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  inhalt: text('inhalt').notNull(),
  version: integer('version').notNull().default(1),
  komprimierteTurns: integer('komprimierte_turns').notNull().default(0),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Budget Policies =====
export const budgetPolicies = pgTable('budget_policies', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  scope: text('scope').notNull(),
  scopeId: text('scope_id').notNull(),
  limitCent: integer('limit_cent').notNull(),
  fenster: text('fenster').notNull().default('monatlich'),
  warnProzent: integer('warn_prozent').notNull().default(80),
  hardStop: boolean('hard_stop').notNull().default(true),
  aktiv: boolean('aktiv').notNull().default(true),
  erstelltAm: text('erstellt_am').notNull(),
  aktualisiertAm: text('aktualisiert_am').notNull(),
});

// ===== Budget Incidents =====
export const budgetIncidents = pgTable('budget_incidents', {
  id: text('id').primaryKey(),
  policyId: text('policy_id').notNull().references(() => budgetPolicies.id),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  typ: text('typ').notNull(),
  beobachteterBetrag: integer('beobachteter_betrag').notNull(),
  limitBetrag: integer('limit_betrag').notNull(),
  status: text('status').notNull().default('offen'),
  behobeneAm: text('behoben_am'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Execution Workspaces =====
export const executionWorkspaces = pgTable('execution_workspaces', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  aufgabeId: text('aufgabe_id').references(() => aufgaben.id),
  expertId: text('expert_id').references(() => experten.id),
  pfad: text('pfad').notNull(),
  branchName: text('branch_name'),
  basePfad: text('base_pfad'),
  abgeleitetVon: text('abgeleitet_von').references((): any => executionWorkspaces.id),
  status: text('status').notNull().default('offen'),
  metadaten: text('metadaten'),
  geoeffnetAm: text('geoeffnet_am').notNull(),
  geschlossenAm: text('geschlossen_am'),
  aufgeraeumtAm: text('aufgeraeumt_am'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== Issue Relations =====
export const issueRelations = pgTable('issue_relations', {
  id: text('id').primaryKey(),
  quellId: text('quell_id').notNull().references(() => aufgaben.id),
  zielId: text('ziel_id').notNull().references(() => aufgaben.id),
  typ: text('typ').notNull().default('blocks'),
  erstelltVon: text('erstellt_von'),
  erstelltAm: text('erstellt_am').notNull(),
});

// ===== OpenClaw Gateway Tokens =====
export const openclawTokens = pgTable('openclaw_tokens', {
  id: text('id').primaryKey(),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  token: text('token').notNull().unique(),
  beschreibung: text('beschreibung'),
  erstelltAm: text('erstellt_am').notNull(),
  letzterJoin: text('letzter_join'),
});

// ===== CEO Decision Log =====
export const ceoDecisionLog = pgTable('ceo_decision_log', {
  id: text('id').primaryKey(),
  expertId: text('expert_id').notNull().references(() => experten.id),
  unternehmenId: text('unternehmen_id').notNull().references(() => unternehmen.id),
  runId: text('run_id').notNull(),
  erstelltAm: text('erstellt_am').notNull(),
  focusSummary: text('focus_summary').notNull(),
  actionsJson: text('actions_json').notNull(),
  goalsSnapshot: text('goals_snapshot'),
  pendingTaskCount: integer('pending_task_count').notNull().default(0),
  teamSummary: text('team_summary'),
});

// ===== Expert Config History =====
export const expertConfigHistory = pgTable('expert_config_history', {
  id: text('id').primaryKey(),
  expertId: text('expert_id').notNull().references(() => experten.id),
  changedAt: text('changed_at').notNull(),
  changedBy: text('changed_by'),
  configJson: text('config_json').notNull(),
  note: text('note'),
});
