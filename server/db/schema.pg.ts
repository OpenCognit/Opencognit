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
