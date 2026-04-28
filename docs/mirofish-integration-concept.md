# Konzept: MiroFish-Architektur-Muster in OpenCognit

**Status:** Konzept | **Erstellt:** 2026-04-25 | **Autor:** AI-Architect

---

## 1. Executive Summary

MiroFish ist eine Multi-Agent-Prädiktions-Engine, die auf drei Kernideen aufbaut:
1. **Temporal Knowledge Graphs** — Fakten mit Zeitgültigkeit speichern
2. **Multi-Tier Retrieval** — Komplexe Queries in Sub-Queries zerlegen, über Graphen evidenzbasiert beantworten
3. **Graph-to-Agent Pipeline** — Agenten-Personas automatisch aus Wissensgraphen generieren

Dieses Dokument analysiert, welche dieser Muster in OpenCognit integriert werden können, um den CEO-Agenten (Orchestrator) von einem simplen Task-Router zu einem planungsfähigen System mit historischem Kontext zu verwandeln.

**Kern-Erkenntnis:** Nicht die Social-Media-Simulation (OASIS) ist relevant, sondern die **Memory-Intelligence-Layer** darüber.

---

## 2. Ausgangslage: OpenCognit heute

| Komponente | Aktueller Stand |
|---|---|
| **Memory** | Palace-System (Wings, Drawers, Diary, KG, Summaries) in SQLite |
| **Retrieval** | Keyword-basiertes RAG-lite auf Skills; einfache KG-Abfragen |
| **Agenten** | Handgefertigte Rollen (CEO, Dev, etc.) mit Skills-Zuweisung |
| **Execution** | WorkCycles, Wakeup, Heartbeat, Task-Assignment |
| **Resilienz** | Keine Fallbacks bei API-Fehlern; harte Crashes bei JSON-Parse-Fehlern |
| **Zeitdimension** | KG-Einträge haben `createdAt`, aber keine Gültigkeitszeiträume |

**Gaps, die MiroFish-Muster schließen könnten:**
- Der CEO-Agent hat keinen Zugriff auf *historische* Fakten mit Kontext
- Komplexe Anfragen ("Wer hat Erfahrung mit X UND hat an Y gearbeitet?") sind nicht möglich
- Agenten-Erstellung ist manuell — keine automatische Persona-Generierung aus Dokumenten
- Ein einziger API-Fehler kann einen ganzen WorkCycle blockieren

---

## 3. Die 4 Integrationsbereiche

### 3.1 Temporal Knowledge Graph

#### Was MiroFish macht
Zep Cloud speichert KG-Edges mit drei Zeitstempeln: `valid_at`, `invalid_at`, `expired_at`. Damit kann das System unterscheiden zwischen:
- Aktuellen Fakten (gültig jetzt)
- Historischen Fakten (waren mal gültig)
- Ungültigen Fakten (explizit widerlegt)

#### Was OpenCognit braucht
Die `palace_kg` Tabelle bekommt drei neue Spalten:

```sql
-- Erweiterung palace_kg
valid_from TEXT,      -- ISO-Date: ab wann gilt dieser Fakt
valid_until TEXT,     -- ISO-Date: bis wann gilt dieser Fakt (NULL = unbegrenzt)
replaced_by TEXT      -- ID eines neueren Fakts, der diesen ersetzt
```

#### Use-Cases
- **Architektur-Entscheidungen:** "Wir nutzen REST" (gültig 2024-01 bis 2025-03) → "Wir nutzen GraphQL" (gültig ab 2025-03)
- **Agent-Rollen:** "Anna war Frontend-Dev" (gültig bis 2025-06) → "Anna ist Tech-Lead" (gültig ab 2025-06)
- **Budget-Policies:** Policy-Änderungen sind zeitlich nachvollziehbar

#### Implementierung
1. Schema-Migration in `server/db/schema.ts`
2. Update `palaceKg` Insert-Logik (immer `valid_from = now()` setzen)
3. Neue Retrieval-Funktion `getFactsAtTime(subject, date)`
4. CEO-Agent bekommt Kontext: "Folgende Fakten waren zum Zeitpunkt der Entscheidung gültig: ..."

**Aufwand:** Mittel (2-3 Tage) | **Impact:** Hoch

---

### 3.2 InsightForge — Multi-Tier Retrieval

#### Was MiroFish macht
Drei Abstraktionsebenen:
1. **Quick Search** — Direkte semantische Suche (schnell, oberflächlich)
2. **Panorama Search** — Vollgraph-Ansicht inkl. historischer Edges (breit)
3. **InsightForge** — LLM zerlegt komplexe Query in Sub-Queries, sucht parallel, dedupliziert, verfolgt Beziehungsketten (tief)

#### Was OpenCognit braucht
Ein neuer Service `insightForge` (oder Erweiterung des bestehenden Skills-Service), der über alle Datenquellen hinweg suchen kann:

```typescript
interface InsightQuery {
  question: string;
  scope: 'agent' | 'company' | 'project' | 'global';
  agentId?: string;  // für agent-scoped Queries
  timeContext?: 'now' | 'history' | Date;
}

interface InsightResult {
  answer: string;
  sources: Source[];        // Palace-KG, Skills, Tasks, WorkCycles
  confidence: number;
  relatedAgents: string[];  // welche Agenten sind relevant?
}
```

#### Datenquellen (in Reihenfolge der Priorität)
1. **Palace KG** — Fakten über Entitäten (Subjekt-Prädikat-Objekt)
2. **Palace Summaries** — Kompimierte Kontext-Zusammenfassungen
3. **Skills Library** — Technische Fähigkeiten und Wissen
4. **Task-Historie** — Wer hat was gemacht, wann, mit welchem Ergebnis
5. **WorkCycles + Trace Events** — Gedankengänge und Entscheidungen der Agenten
6. **CEO Decision Log** — Frühere Planungsentscheidungen

#### Query-Decomposition-Beispiel
**User-Query:** *"Wer in unserem Team hat Erfahrung mit OAuth2 und könnte die Auth-API refactoren?"*

**Sub-Queries (LLM-generiert):**
1. "Welche Agenten haben OAuth2 in ihren Skills?" → Skills Library
2. "Welche Agenten haben an Tasks mit 'auth' oder 'OAuth' gearbeitet?" → Task-Historie
3. "Welche Agenten haben aktuell Kapazität?" → Task-Assignment + WorkCycles
4. "Gibt es Palace-KG-Einträge über Auth-API-Architektur?" → Palace KG

**Synthese:** Ranked List mit Begründung und Quellenangaben

#### Implementierung
```
server/services/insight-forge.ts
  ├── decomposeQuery(question) → SubQuery[]
  ├── executeSubQuery(query, sources) → RawResult[]
  ├── deduplicateAndRank(results) → ScoredResult[]
  ├── buildRelationshipChains(entity) → Chain[]
  └── synthesizeAnswer(results, originalQuestion) → InsightResult
```

**Aufwand:** Hoch (5-7 Tage) | **Impact:** Sehr hoch

---

### 3.3 Graph-to-Agent Pipeline

#### Was MiroFish macht
Aus Zep-Graph-Entitäten werden automatisch OASIS-kompatible Agenten-Profile generiert. Für jede Entität wird der Graph nach Nachbarschaftsfakten durchsucht, dann ein LLM-Prompt gebaut, der eine detaillierte Persona erzeugt (Bio, MBTI, Profession, Interessen).

#### Was OpenCognit braucht
Eine Funktion, die aus einem Dokument/Briefing automatisch Agenten erstellt:

```typescript
interface AgentGenerationInput {
  sourceText: string;        // Projekt-Briefing, Requirement-Doc, etc.
  companyId: string;
  count?: number;            // wie viele Agenten generieren?
  existingAgentIds?: string[]; // zum Deduplizieren
}

interface GeneratedAgent {
  name: string;
  role: string;
  title: string;
  skills: string[];          // Verweise auf Skills Library (oder neue erstellen)
  personality: string;       // für System-Prompt
  suggestedConnections: string[]; // Reports-To, Advisor-Beziehungen
  monthlyBudgetCent: number;
}
```

#### Workflow
1. **Text chunken** und in Palace KG extrahieren (Entitäten + Beziehungen)
2. **Entitäten klassifizieren** — Personen vs. Institutionen vs. Technologien
3. **Für jede Person-Entität:** Nachbarschaftsfakten aus KG lesen
4. **LLM-Prompt:** Generiere Agent-Profil aus Fakten
5. **Skills matchen** — Existiert Skill in Library? → Verlinken. Sonst → Skill-Vorschlag
6. **Agent in DB anlegen** + Skills zuweisen + Reports-To vorschlagen

#### Use-Cases
- **Neues Projekt:** User lädt Briefing hoch → System schlägt Team vor
- **Company Onboarding:** Aus einem Git-Repo oder Confluence-Space wird das Team automatisch gespiegelt
- **Gap-Analyse:** "Dieses Projekt braucht jemanden mit Kubernetes-Erfahrung" → System prüft, ob vorhanden

#### Implementierung
```
server/services/agent-generator.ts
  ├── extractEntitiesFromText(text) → Entity[]     // Nutzt Palace KG
  ├── enrichEntitiesWithFacts(entities) → EnrichedEntity[]
  ├── generateAgentProfiles(entities) → GeneratedAgent[]
  ├── matchSkillsToLibrary(skills) → MatchedSkill[]
  └── createAgentsWithApproval(generated, companyId) → Agent[]
```

**Aufwand:** Mittel (3-4 Tage) | **Impact:** Hoch

---

### 3.4 Graceful Degradation & Resilienz

#### Was MiroFish macht
- Zep API failt → lokale Keyword-Suche über alle Nodes/Edges
- LLM JSON truncated → automatische Klammer-Reparatur + Regex-Extraction
- Profile-Generation failt → rule-basiertes Fallback

#### Was OpenCognit braucht
Drei konkrete Resilienz-Schichten:

**A) LLM-Adapter-Fallback**
```typescript
// Aktuell: Ein Adapter, hard crash bei Fehler
// Ziel: Kette von Adaptern
const adapterChain = ['claude', 'openai', 'gemini', 'ollama'];
for (const adapter of adapterChain) {
  try { return await adapter.chat(messages); }
  catch (e) { logger.warn(`${adapter} failed, trying next...`); }
}
throw new Error('All LLM adapters exhausted');
```

**B) JSON-Parse-Reparatur**
```typescript
function robustJsonParse<T>(raw: string): T {
  try { return JSON.parse(raw); }
  catch {
    // Versuche 1: Klammern balancieren
    const fixed = balanceBrackets(raw);
    try { return JSON.parse(fixed); }
    catch {
      // Versuche 2: Regex-Extraction von Key-Value-Paaren
      return extractKeyValuesWithRegex(raw);
    }
  }
}
```

**C) Task-Retry mit Exponential Backoff**
```typescript
// Aktuell: Ein WorkCycle failt → Status 'error'
// Ziel: Automatisches Retry (max 3x), dann Escalation an CEO
async function runWithRetry(taskFn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try { return await taskFn(); }
    catch (e) {
      if (i === maxRetries - 1) throw e;
      await sleep(1000 * Math.pow(2, i)); // 1s, 2s, 4s
    }
  }
}
```

#### Implementierung
```
server/utils/resilience.ts
  ├── withFallback<T>(primary, fallback) → T
  ├── robustJsonParse<T>(raw) → T
  ├── withRetry<T>(fn, options) → T
  └── AdapterChain
```

**Aufwand:** Niedrig (1-2 Tage) | **Impact:** Mittel (Stabilität)

---

## 4. Implementierungsroadmap

### Phase 1: Fundament (Woche 1-2)
- [ ] Temporal KG Schema-Migration (`valid_from`, `valid_until`, `replaced_by`)
- [ ] Resilienz-Utilities (`robustJsonParse`, `withRetry`, AdapterChain)
- [ ] Alle LLM-Calls durch Resilienz-Layer schleusen

### Phase 2: Retrieval-Engine (Woche 3-4)
- [ ] `InsightForge`-Service implementieren
- [ ] Query-Decomposition mit LLM
- [ ] Multi-Source-Suche (Palace KG, Skills, Tasks, WorkCycles)
- [ ] CEO-Agent nutzt InsightForge für Planung

### Phase 3: Agenten-Generierung (Woche 5-6)
- [ ] `AgentGenerator`-Service
- [ ] Entitäts-Extraction aus Dokumenten
- [ ] LLM-basierte Profil-Generierung
- [ ] Skill-Matching mit Library
- [ ] Frontend: "Agenten aus Dokument generieren"-Button

### Phase 4: Polishing (Woche 7)
- [ ] Performance-Optimierung (caching, indexing)
- [ ] Testing
- [ ] Dokumentation

---

## 5. Technische Details

### 5.1 Schema-Änderungen

```typescript
// server/db/schema.ts — palace_kg Erweiterung
export const palaceKg = sqliteTable('palace_kg', {
  id: text('id').primaryKey(),
  companyId: text('unternehmen_id').notNull().references(() => companies.id),
  subject: text('subject').notNull(),
  predicate: text('predicate').notNull(),
  object: text('object').notNull(),
  validFrom: text('valid_from'),           // NEU
  validUntil: text('valid_until'),         // NEU
  replacedBy: text('replaced_by'),         // NEU — Referenz auf neuere KG-ID
  createdBy: text('erstellt_von'),
  createdAt: text('erstellt_am').notNull(),
}, (t) => ({
  idxSubjectValid: index('kg_subject_valid_idx').on(t.subject, t.validUntil),
  idxUnternehmenSubject: index('kg_unternehmen_subject_idx').on(t.companyId, t.subject),
  // NEU: Index für zeitliche Abfragen
  idxValidPeriod: index('kg_valid_period_idx').on(t.validFrom, t.validUntil),
}));
```

### 5.2 Neue Tabellen

```typescript
// NEU: Ergebnisse von InsightForge-Queries (für Audit + Caching)
export const insightQueries = sqliteTable('insight_queries', {
  id: text('id').primaryKey(),
  companyId: text('unternehmen_id').notNull(),
  query: text('query').notNull(),
  result: text('result').notNull(), // JSON
  sourcesUsed: text('sources_used'), // JSON array
  confidence: integer('confidence'), // 0-100
  createdAt: text('erstellt_am').notNull(),
});
```

### 5.3 Neue Services

```
server/services/
  ├── insight-forge.ts          # Multi-Tier Retrieval
  ├── agent-generator.ts        # Graph-to-Agent Pipeline
  └── resilience.ts             # Graceful Degradation Utilities
```

### 5.4 API-Endpunkte

```typescript
// NEU: InsightForge
app.post('/api/companies/:id/insight', (req, res) => {
  const { question, scope, timeContext } = req.body;
  const result = await insightForge.query({
    companyId: req.params.id,
    question,
    scope,
    timeContext,
  });
  res.json(result);
});

// NEU: Agent-Generierung
app.post('/api/companies/:id/agents/generate', (req, res) => {
  const { sourceText, count } = req.body;
  const generated = await agentGenerator.generate({
    companyId: req.params.id,
    sourceText,
    count,
  });
  res.json({ suggestions: generated }); // User muss bestätigen
});
```

---

## 6. Risiken & Alternativen

| Risiko | Wahrscheinlichkeit | Mitigation |
|---|---|---|
| **LLM-Kosten explodieren** bei InsightForge (mehrere Sub-Queries) | Mittel | Cache-Ergebnisse, Confidence-Threshold, nur bei CEO-Planung aktiv |
| **Temporal KG wird unübersichtlich** | Niedrig | Gültigkeitszeiträume optional, nur für explizite Versionen aktiv |
| **Agent-Generierung erzeugt Dubletten** | Mittel | Deduplizierung gegen existierende Agenten (Skill-Overlap > 80% → merge) |
| **Performance bei großem KG** | Mittel | SQLite-Indexe, optionale Pagination bei Graph-Traversal |

**Alternative:** Statt vollständiger InsightForge-Implementierung könnte man zuerst nur "Quick Search + Panorama" bauen und InsightForge als Premium-Feature für später aufheben.

---

## 7. Nächste Schritte

1. **Review dieses Konzepts** — Passt die Richtung?
2. **Priorisierung** — Soll mit Phase 1 (Temporal KG + Resilienz) begonnen werden?
3. **LLM-Budget-Klärung** — Ist der Kosten-Overhead von InsightForge akzeptabel?

---

## Anhang: Vergleichstabelle

| Aspekt | MiroFish | OpenCognit (aktuell) | OpenCognit (nach Integration) |
|---|---|---|---|
| **KG-Zeitdimension** | `valid_at`, `invalid_at`, `expired_at` | Nur `createdAt` | `valid_from`, `valid_until`, `replaced_by` |
| **Retrieval** | 3-Tier (Quick/Panorama/InsightForge) | Keyword-RAG-lite | 3-Tier über Palace + Skills + Tasks |
| **Agent-Generierung** | Automatisch aus Graph-Entitäten | Manuell | Halb-automatisch (Vorschläge) |
| **Resilienz** | Multi-Layer Fallbacks | Keine | Adapter-Chain, JSON-Repair, Retry |
| **Fokus** | Simulation & Prädiktion | Execution & Produktivität | Execution + kontextbewusste Planung |
