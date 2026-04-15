/**
 * Phase 8 — Company Export/Import
 *
 * Export: Full company snapshot as JSON, secrets scrubbed
 * Import: Re-map all IDs, insert into existing DB as a new company
 */

import { v4 as uuid } from 'uuid';
import { db } from '../db/client.js';
import {
  unternehmen, experten, aufgaben, projekte, ziele,
  routinen, routineTrigger, kommentare, genehmigungen,
  agentPermissions, aktivitaetslog, arbeitszyklen, agentWakeupRequests,
} from '../db/schema.js';
import { eq } from 'drizzle-orm';

const EXPORT_VERSION = '1.0';

// ===== Secret scrubbing =====
// Keys in verbindungsConfig whose values we strip
const SECRET_CONFIG_KEYS = new Set(['api_key', 'apiKey', 'token', 'secret', 'password', 'passwort', 'bearer']);

function scrubVerbindungsConfig(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const scrubbed: Record<string, any> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const keyLower = k.toLowerCase();
      const isSensitive = SECRET_CONFIG_KEYS.has(k) ||
        Array.from(SECRET_CONFIG_KEYS).some(s => keyLower.includes(s));
      scrubbed[k] = isSensitive ? '***SCRUBBED***' : v;
    }
    return JSON.stringify(scrubbed);
  } catch {
    // Not JSON — scrub entirely if it looks like a key
    if (raw.startsWith('sk-') || raw.startsWith('Bearer ') || raw.length > 100) {
      return '***SCRUBBED***';
    }
    return raw;
  }
}

// ===== Export =====
export interface CompanyExport {
  version: string;
  exportedAt: string;
  unternehmen: any;
  experten: any[];
  aufgaben: any[];
  projekte: any[];
  ziele: any[];
  routinen: any[];
  routineTrigger: any[];
  kommentare: any[];
  genehmigungen: any[];
  agentPermissions: any[];
  _meta: {
    counts: Record<string, number>;
    secretsScrubbed: boolean;
  };
}

export function exportCompany(unternehmenId: string): CompanyExport {
  const firma = db.select().from(unternehmen).where(eq(unternehmen.id, unternehmenId)).get();
  if (!firma) throw new Error('Unternehmen nicht gefunden');

  const expertenList = db.select().from(experten).where(eq(experten.unternehmenId, unternehmenId)).all();
  const aufgabenList = db.select().from(aufgaben).where(eq(aufgaben.unternehmenId, unternehmenId)).all();
  const projekteList = db.select().from(projekte).where(eq(projekte.unternehmenId, unternehmenId)).all();
  const zieleList = db.select().from(ziele).where(eq(ziele.unternehmenId, unternehmenId)).all();
  const routinenList = db.select().from(routinen).where(eq(routinen.unternehmenId, unternehmenId)).all();

  const routineIds = routinenList.map(r => r.id);
  const triggerList = routineIds.length > 0
    ? db.select().from(routineTrigger).where(eq(routineTrigger.unternehmenId, unternehmenId)).all()
    : [];

  const kommentareList = db.select().from(kommentare).where(eq(kommentare.unternehmenId, unternehmenId)).all();
  const genehmigungenList = db.select().from(genehmigungen).where(eq(genehmigungen.unternehmenId, unternehmenId)).all();

  const expertIds = expertenList.map(e => e.id);
  const permissionsList = expertIds.length > 0
    ? db.select().from(agentPermissions).all().filter(p => expertIds.includes(p.expertId))
    : [];

  // Scrub sensitive data from verbindungsConfig
  const cleanedExperten = expertenList.map(e => ({
    ...e,
    verbindungsConfig: scrubVerbindungsConfig(e.verbindungsConfig),
  }));

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    unternehmen: firma,
    experten: cleanedExperten,
    aufgaben: aufgabenList,
    projekte: projekteList,
    ziele: zieleList,
    routinen: routinenList,
    routineTrigger: triggerList,
    kommentare: kommentareList,
    genehmigungen: genehmigungenList,
    agentPermissions: permissionsList,
    _meta: {
      counts: {
        experten: expertenList.length,
        aufgaben: aufgabenList.length,
        projekte: projekteList.length,
        ziele: zieleList.length,
        routinen: routinenList.length,
        routineTrigger: triggerList.length,
        kommentare: kommentareList.length,
        genehmigungen: genehmigungenList.length,
        agentPermissions: permissionsList.length,
      },
      secretsScrubbed: true,
    },
  };
}

// ===== Import =====
export interface ImportResult {
  unternehmenId: string;
  unternehmenName: string;
  counts: Record<string, number>;
  warnings: string[];
}

export function importCompany(data: CompanyExport, newName?: string): ImportResult {
  const warnings: string[] = [];

  // Version check
  if (data.version !== EXPORT_VERSION) {
    warnings.push(`Export-Version ${data.version} weicht von aktueller Version ${EXPORT_VERSION} ab. Import wird trotzdem versucht.`);
  }

  // ID remapping: old ID -> new ID
  const idMap = new Map<string, string>();
  const remap = (id: string | null | undefined): string | null => {
    if (!id) return null;
    return idMap.get(id) ?? id;
  };
  const remapRequired = (id: string): string => {
    return idMap.get(id) ?? id;
  };

  const n = () => new Date().toISOString();

  // 1. Generate new ID for Unternehmen
  const newUnternehmenId = uuid();
  idMap.set(data.unternehmen.id, newUnternehmenId);

  const importedName = newName?.trim() || `${data.unternehmen.name} (Import)`;

  // 2. Generate new IDs for all Experten
  for (const e of data.experten) {
    idMap.set(e.id, uuid());
  }

  // 3. Generate new IDs for Aufgaben (need two-pass for parentId)
  for (const a of data.aufgaben) {
    idMap.set(a.id, uuid());
  }

  // 4. Generate new IDs for Projekte
  for (const p of data.projekte) {
    idMap.set(p.id, uuid());
  }

  // 5. Generate new IDs for Ziele
  for (const z of data.ziele) {
    idMap.set(z.id, uuid());
  }

  // 6. Generate new IDs for Routinen
  for (const r of data.routinen) {
    idMap.set(r.id, uuid());
  }

  // 7. Generate new IDs for Trigger
  for (const t of data.routineTrigger) {
    idMap.set(t.id, uuid());
  }

  // 8. Generate new IDs for Kommentare
  for (const k of data.kommentare) {
    idMap.set(k.id, uuid());
  }

  // 9. Generate new IDs for Genehmigungen
  for (const g of data.genehmigungen) {
    idMap.set(g.id, uuid());
  }

  // 10. Generate new IDs for AgentPermissions
  for (const p of data.agentPermissions) {
    idMap.set(p.id, uuid());
  }

  // ===== Insert =====
  // Insert Unternehmen
  db.insert(unternehmen).values({
    id: newUnternehmenId,
    name: importedName,
    beschreibung: data.unternehmen.beschreibung ?? null,
    ziel: data.unternehmen.ziel ?? null,
    status: data.unternehmen.status ?? 'active',
    erstelltAm: n(),
    aktualisiertAm: n(),
  }).run();

  // Insert Experten
  let importedExperten = 0;
  for (const e of data.experten) {
    try {
      db.insert(experten).values({
        id: remapRequired(e.id),
        unternehmenId: newUnternehmenId,
        name: e.name,
        rolle: e.rolle,
        titel: e.titel ?? null,
        status: 'idle', // reset status on import
        reportsTo: remap(e.reportsTo),
        faehigkeiten: e.faehigkeiten ?? null,
        verbindungsTyp: e.verbindungsTyp ?? 'claude',
        verbindungsConfig: e.verbindungsConfig?.includes('SCRUBBED') ? null : (e.verbindungsConfig ?? null),
        avatar: e.avatar ?? null,
        avatarFarbe: e.avatarFarbe ?? '#23CDCA',
        budgetMonatCent: e.budgetMonatCent ?? 0,
        verbrauchtMonatCent: 0, // reset on import
        letzterZyklus: null,
        zyklusIntervallSek: e.zyklusIntervallSek ?? 300,
        zyklusAktiv: false, // don't auto-start on import
        systemPrompt: e.systemPrompt ?? null,
        erstelltAm: n(),
        aktualisiertAm: n(),
      }).run();
      importedExperten++;
    } catch (err: any) {
      warnings.push(`Experte "${e.name}" konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Ziele (two-pass: first without parentId, then with)
  let importedZiele = 0;
  const zieleWithParent: any[] = [];
  for (const z of data.ziele) {
    const hasParent = !!z.parentId && data.ziele.some(p => p.id === z.parentId);
    if (hasParent) {
      zieleWithParent.push(z);
      continue;
    }
    try {
      db.insert(ziele).values({
        id: remapRequired(z.id),
        unternehmenId: newUnternehmenId,
        titel: z.titel,
        beschreibung: z.beschreibung ?? null,
        ebene: z.ebene ?? 'company',
        parentId: null,
        eigentuemerExpertId: remap(z.eigentuemerExpertId),
        status: z.status ?? 'planned',
        erstelltAm: n(),
        aktualisiertAm: n(),
      }).run();
      importedZiele++;
    } catch (err: any) {
      warnings.push(`Ziel "${z.titel}" konnte nicht importiert werden: ${err.message}`);
    }
  }
  for (const z of zieleWithParent) {
    try {
      db.insert(ziele).values({
        id: remapRequired(z.id),
        unternehmenId: newUnternehmenId,
        titel: z.titel,
        beschreibung: z.beschreibung ?? null,
        ebene: z.ebene ?? 'team',
        parentId: remap(z.parentId),
        eigentuemerExpertId: remap(z.eigentuemerExpertId),
        status: z.status ?? 'planned',
        erstelltAm: n(),
        aktualisiertAm: n(),
      }).run();
      importedZiele++;
    } catch (err: any) {
      warnings.push(`Ziel "${z.titel}" (mit Parent) konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Projekte
  let importedProjekte = 0;
  for (const p of data.projekte) {
    try {
      db.insert(projekte).values({
        id: remapRequired(p.id),
        unternehmenId: newUnternehmenId,
        name: p.name,
        beschreibung: p.beschreibung ?? null,
        status: p.status ?? 'aktiv',
        prioritaet: p.prioritaet ?? 'medium',
        zielId: remap(p.zielId),
        eigentuemerId: remap(p.eigentuemerId),
        farbe: p.farbe ?? '#23CDCB',
        deadline: p.deadline ?? null,
        fortschritt: p.fortschritt ?? 0,
        erstelltAm: n(),
        aktualisiertAm: n(),
      }).run();
      importedProjekte++;
    } catch (err: any) {
      warnings.push(`Projekt "${p.name}" konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Aufgaben (two-pass for parentId)
  let importedAufgaben = 0;
  const aufgabenWithParent: any[] = [];
  for (const a of data.aufgaben) {
    const hasParent = !!a.parentId && data.aufgaben.some(p => p.id === a.parentId);
    if (hasParent) {
      aufgabenWithParent.push(a);
      continue;
    }
    try {
      db.insert(aufgaben).values({
        id: remapRequired(a.id),
        unternehmenId: newUnternehmenId,
        titel: a.titel,
        beschreibung: a.beschreibung ?? null,
        status: a.status === 'in_progress' ? 'todo' : (a.status ?? 'backlog'), // reset running tasks
        prioritaet: a.prioritaet ?? 'medium',
        zugewiesenAn: remap(a.zugewiesenAn),
        erstelltVon: a.erstelltVon ?? null,
        parentId: null,
        projektId: remap(a.projektId),
        zielId: remap(a.zielId),
        executionRunId: null,
        executionAgentNameKey: null,
        executionLockedAt: null,
        blockedBy: null,
        workspacePath: null,
        gestartetAm: null,
        abgeschlossenAm: a.abgeschlossenAm ?? null,
        abgebrochenAm: a.abgebrochenAm ?? null,
        erstelltAm: n(),
        aktualisiertAm: n(),
      }).run();
      importedAufgaben++;
    } catch (err: any) {
      warnings.push(`Aufgabe "${a.titel}" konnte nicht importiert werden: ${err.message}`);
    }
  }
  for (const a of aufgabenWithParent) {
    try {
      db.insert(aufgaben).values({
        id: remapRequired(a.id),
        unternehmenId: newUnternehmenId,
        titel: a.titel,
        beschreibung: a.beschreibung ?? null,
        status: a.status === 'in_progress' ? 'todo' : (a.status ?? 'backlog'),
        prioritaet: a.prioritaet ?? 'medium',
        zugewiesenAn: remap(a.zugewiesenAn),
        erstelltVon: a.erstelltVon ?? null,
        parentId: remap(a.parentId),
        projektId: remap(a.projektId),
        zielId: remap(a.zielId),
        executionRunId: null,
        executionAgentNameKey: null,
        executionLockedAt: null,
        blockedBy: null,
        workspacePath: null,
        gestartetAm: null,
        abgeschlossenAm: a.abgeschlossenAm ?? null,
        abgebrochenAm: a.abgebrochenAm ?? null,
        erstelltAm: n(),
        aktualisiertAm: n(),
      }).run();
      importedAufgaben++;
    } catch (err: any) {
      warnings.push(`Aufgabe "${a.titel}" (mit Parent) konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Routinen
  let importedRoutinen = 0;
  for (const r of data.routinen) {
    try {
      db.insert(routinen).values({
        id: remapRequired(r.id),
        unternehmenId: newUnternehmenId,
        titel: r.titel,
        beschreibung: r.beschreibung ?? null,
        zugewiesenAn: remap(r.zugewiesenAn),
        prioritaet: r.prioritaet ?? 'medium',
        status: r.status ?? 'active',
        concurrencyPolicy: r.concurrencyPolicy ?? 'coalesce_if_active',
        catchUpPolicy: r.catchUpPolicy ?? 'skip_missed',
        variablen: r.variablen ?? null,
        zuletztAusgefuehrtAm: null,
        zuletztEnqueuedAm: null,
        erstelltAm: n(),
        aktualisiertAm: n(),
      }).run();
      importedRoutinen++;
    } catch (err: any) {
      warnings.push(`Routine "${r.titel}" konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Routine Trigger
  let importedTrigger = 0;
  for (const t of data.routineTrigger) {
    try {
      db.insert(routineTrigger).values({
        id: remapRequired(t.id),
        unternehmenId: newUnternehmenId,
        routineId: remapRequired(t.routineId),
        kind: t.kind,
        aktiv: t.aktiv ?? true,
        cronExpression: t.cronExpression ?? null,
        timezone: t.timezone ?? 'UTC',
        naechsterAusfuehrungAm: null, // will be recalculated by cron service
        zuletztGefeuertAm: null,
        publicId: t.publicId ?? null,
        secretId: null, // scrub webhook secrets
        erstelltAm: n(),
      }).run();
      importedTrigger++;
    } catch (err: any) {
      warnings.push(`Trigger konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Kommentare
  let importedKommentare = 0;
  for (const k of data.kommentare) {
    try {
      db.insert(kommentare).values({
        id: remapRequired(k.id),
        unternehmenId: newUnternehmenId,
        aufgabeId: remapRequired(k.aufgabeId),
        autorExpertId: remap(k.autorExpertId),
        autorTyp: k.autorTyp ?? 'board',
        inhalt: k.inhalt,
        erstelltAm: n(),
      }).run();
      importedKommentare++;
    } catch (err: any) {
      // Non-critical — kommentare may reference deleted aufgaben
      warnings.push(`Kommentar konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Genehmigungen
  let importedGenehmigungen = 0;
  for (const g of data.genehmigungen) {
    try {
      db.insert(genehmigungen).values({
        id: remapRequired(g.id),
        unternehmenId: newUnternehmenId,
        typ: g.typ,
        titel: g.titel,
        beschreibung: g.beschreibung ?? null,
        angefordertVon: g.angefordertVon ?? null,
        status: g.status ?? 'pending',
        payload: g.payload ?? null,
        entscheidungsnotiz: g.entscheidungsnotiz ?? null,
        entschiedenAm: g.entschiedenAm ?? null,
        erstelltAm: n(),
        aktualisiertAm: n(),
      }).run();
      importedGenehmigungen++;
    } catch (err: any) {
      warnings.push(`Genehmigung konnte nicht importiert werden: ${err.message}`);
    }
  }

  // Insert Agent Permissions
  let importedPermissions = 0;
  for (const p of data.agentPermissions) {
    try {
      db.insert(agentPermissions).values({
        id: remapRequired(p.id),
        expertId: remapRequired(p.expertId),
        darfAufgabenErstellen: p.darfAufgabenErstellen ?? true,
        darfAufgabenZuweisen: p.darfAufgabenZuweisen ?? false,
        darfGenehmigungAnfordern: p.darfGenehmigungAnfordern ?? true,
        darfGenehmigungEntscheiden: p.darfGenehmigungEntscheiden ?? false,
        darfExpertenAnwerben: p.darfExpertenAnwerben ?? false,
        budgetLimitCent: p.budgetLimitCent ?? null,
        erlaubtePfade: p.erlaubtePfade ?? null,
        erlaubteDomains: p.erlaubteDomains ?? null,
        erstelltAm: n(),
        aktualisiertAm: n(),
      }).run();
      importedPermissions++;
    } catch (err: any) {
      warnings.push(`Agent-Permission konnte nicht importiert werden: ${err.message}`);
    }
  }

  return {
    unternehmenId: newUnternehmenId,
    unternehmenName: importedName,
    counts: {
      experten: importedExperten,
      aufgaben: importedAufgaben,
      projekte: importedProjekte,
      ziele: importedZiele,
      routinen: importedRoutinen,
      routineTrigger: importedTrigger,
      kommentare: importedKommentare,
      genehmigungen: importedGenehmigungen,
      agentPermissions: importedPermissions,
    },
    warnings,
  };
}
