const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../server');

const tableMap = {
  routineAusfuehrung: 'routineRuns',
  arbeitszyklenArchiv: 'workCyclesArchive',
  arbeitszyklen: 'workCycles',
  traceEreignisse: 'traceEvents',
  expertConfigHistory: 'agentConfigHistory',
  expertenSkills: 'agentSkills',
  aktivitaetslog: 'activityLog',
  kostenbuchungen: 'costEntries',
  chatNachrichten: 'chatMessages',
  genehmigungen: 'approvals',
  kommentare: 'comments',
  einstellungen: 'settings',
  routinen: 'routines',
  projekte: 'projects',
  benutzer: 'users',
  ziele: 'goals',
  aufgaben: 'tasks',
  unternehmen: 'companies',
  experten: 'agents',
};

const fieldMap = {
  '\\.titel\\b': '.title',
  '\\.beschreibung\\b': '.description',
  '\\.erstelltAm\\b': '.createdAt',
  '\\.aktualisiertAm\\b': '.updatedAt',
  '\\.abgeschlossenAm\\b': '.completedAt',
  '\\.zugewiesenAn\\b': '.assignedTo',
  '\\.prioritaet\\b': '.priority',
  '\\.verbindungsTyp\\b': '.connectionType',
  '\\.verbindungsConfig\\b': '.connectionConfig',
  '\\.kostenCent\\b': '.costCent',
  '\\.nachricht\\b': '.message',
  '\\.absenderTyp\\b': '.senderType',
  '\\.expertId\\b': '.agentId',
  '\\.unternehmenId\\b': '.companyId',
  '\\.aufgabeId\\b': '.taskId',
  '\\.schluessel\\b': '.key',
  '\\.wert\\b': '.value',
  '\\.typ\\b': '.type',
  '\\.rolle\\b': '.role',
  '\\.faehigkeiten\\b': '.skills',
  '\\.avatarFarbe\\b': '.avatarColor',
  '\\.zyklusAktiv\\b': '.autoCycleActive',
  '\\.zyklusIntervallSek\\b': '.autoCycleIntervalSec',
  '\\.budgetMonatCent\\b': '.monthlyBudgetCent',
  '\\.verbrauchtMonatCent\\b': '.monthlySpendCent',
  '\\.ziel\\b': '.goal',
  '\\.ebene\\b': '.level',
  '\\.fortschritt\\b': '.progress',
  '\\.eigentuemerExpertId\\b': '.ownerAgentId',
  '\\.veranstalterExpertId\\b': '.organizerAgentId',
  '\\.teilnehmerIds\\b': '.participantIds',
  '\\.ergebnis\\b': '.result',
  '\\.entschiedenAm\\b': '.decidedAt',
  '\\.entscheidungsnotiz\\b': '.decisionNote',
  '\\.angefordertVon\\b': '.requestedBy',
  '\\.erstelltVon\\b': '.createdBy',
  '\\.gestartetAm\\b': '.startedAt',
  '\\.beendetAm\\b': '.endedAt',
  '\\.abgebrochenAm\\b': '.cancelledAt',
  '\\.befehl\\b': '.command',
  '\\.ausgabe\\b': '.output',
  '\\.fehler\\b': '.error',
  '\\.anbieter\\b': '.provider',
  '\\.modell\\b': '.model',
  '\\.zeitpunkt\\b': '.timestamp',
  '\\.akteurTyp\\b': '.actorType',
  '\\.akteurId\\b': '.actorId',
  '\\.akteurName\\b': '.actorName',
  '\\.aktion\\b': '.action',
  '\\.entitaetTyp\\b': '.entityType',
  '\\.entitaetId\\b': '.entityId',
  '\\.archivDatum\\b': '.archiveDate',
  '\\.zyklusAnzahl\\b': '.cycleCount',
  '\\.erfolgreichAnzahl\\b': '.successCount',
  '\\.fehlgeschlagenAnzahl\\b': '.failedCount',
  '\\.abgebrochenAnzahl\\b': '.cancelledCount',
  '\\.durchschnittDauerMs\\b': '.avgDurationMs',
  '\\.gesamtInputTokens\\b': '.totalInputTokens',
  '\\.gesamtOutputTokens\\b': '.totalOutputTokens',
  '\\.gesamtKostenCent\\b': '.totalCostCent',
  '\\.modelleJson\\b': '.modelsJson',
  '\\.variablen\\b': '.variables',
  '\\.zuletztAusgefuehrtAm\\b': '.lastExecutedAt',
  '\\.zuletztEnqueuedAm\\b': '.lastEnqueuedAt',
  '\\.aktiv\\b': '.active',
  '\\.naechsterAusfuehrungAm\\b': '.nextExecutionAt',
  '\\.zuletztGefeuertAm\\b': '.lastFiredAt',
  '\\.quelle\\b': '.source',
  '\\.gelesen\\b': '.read',
  '\\.inhalt\\b': '.content',
  '\\.antworten\\b': '.responses',
  '\\.groeßeBytes\\b': '.sizeBytes',
  '\\.passwortHash\\b': '.passwordHash',
  '\\.letzterZyklus\\b': '.lastCycle',
  '\\.nachrichtenCount\\b': '.messageCount',
  '\\.projektId\\b': '.projectId',
  '\\.zielId\\b': '.goalId',
};

function replaceInLine(line) {
  let changed = false;

  // Only process lines that reference schema imports or use table/field names
  // Table names in imports
  for (const [oldName, newName] of Object.entries(tableMap)) {
    const regex = new RegExp('\\b' + oldName + '\\b', 'g');
    if (regex.test(line)) {
      line = line.replace(regex, newName);
      changed = true;
    }
  }

  // Field names
  for (const [pattern, replacement] of Object.entries(fieldMap)) {
    const regex = new RegExp(pattern, 'g');
    if (regex.test(line)) {
      line = line.replace(regex, replacement);
      changed = true;
    }
  }

  return { line, changed };
}

function walk(dir, callback) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        walk(fullPath, callback);
      }
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      callback(fullPath);
    }
  }
}

let updatedCount = 0;
let totalFiles = 0;

walk(ROOT, (filePath) => {
  totalFiles++;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  let fileChanged = false;

  for (let i = 0; i < lines.length; i++) {
    const result = replaceInLine(lines[i]);
    if (result.changed) {
      lines[i] = result.line;
      fileChanged = true;
    }
  }

  if (fileChanged) {
    fs.writeFileSync(filePath, lines.join('\n'));
    updatedCount++;
    console.log('Updated:', path.relative(ROOT, filePath));
  }
});

console.log(`\nDone: ${updatedCount}/${totalFiles} files updated`);
