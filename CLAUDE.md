# OpenCognit - Aktueller Status & To-Dos

---

## ⚠️ AGENT BOUNDARIES — PFLICHTLEKTÜRE VOR JEDER ÄNDERUNG

**Dieses Repo ist ausschließlich OpenCognit** — die Multi-Agent-Plattform.
Andere Projekte (Powerchain, etc.) haben hier **nichts verloren**.

### GESPERRTE DATEIEN — Agents dürfen diese NUR ändern wenn explizit angewiesen:
- `src/App.tsx` — Routing-Kern, keine neuen Routes ohne Auftrag
- `src/pages/LandingPage.tsx` — OpenCognit Landing, kein fremder Content
- `server/index.ts` — Haupt-API, keine neuen Endpoints ohne Auftrag
- `server/db/schema.ts` — DB-Schema, keine neuen Tabellen ohne Auftrag
- `package.json` / `package-lock.json` — keine neuen Dependencies ohne Auftrag

### VERBOTEN für Agents:
- Neue Seiten/Routen erstellen die nicht zu OpenCognit gehören
- Crypto/Blockchain/Token/Staking/Wallet Content irgendwo einbauen
- `.github/workflows/` anlegen oder ändern
- `deploy/` oder Infrastruktur-Configs anlegen
- Commits direkt auf `main` wenn es sich um größere Features handelt

### ERLAUBT ohne Rückfrage:
- Bugfixes in bestehenden Dateien
- Neue Services/Adapter unter `server/services/` oder `server/adapters/`
- Neue Seiten unter `src/pages/` die klar zu OpenCognit gehören (Agents, Tasks, Settings etc.)
- Tests

### Andere Projekte:
- Powerchain → `/home/panto/CODING/Project_Powerchain/`
- Nicht in OpenCognit einbauen, nicht referenzieren

---


## Phase 1: Autonome Agenten-Infrastruktur (ABGESCHLOSSEN ✅)

### Implementierte Backend-Komponenten:
- **Wakeup Service** (`server/services/wakeup.ts`) - Wakeup-Requests mit Coalescing
- **Heartbeat Runner** (`server/services/heartbeat.ts`) - Agent Wakeup-Ausführung, Inbox-Verarbeitung
- **Cron Scheduler** (`server/services/cron.ts`) - 5-Feld Cron-Parser, prüft alle 30s
- **Inbox Endpoint** (`GET /api/experten/:id/inbox`) - Holt zugewiesene Tasks
- **Task Checkout** (`POST /api/aufgaben/:id/checkout`) - Atomic Lock mit 30min Timeout
- **Routinen API** - CRUD für Routinen und Trigger

### API Endpoints:
```
GET  /api/experten/:id/inbox?unternehmenId=...
POST /api/aufgaben/:id/checkout (mit runId-Lock)
POST /api/aufgaben/:id/release
GET  /api/unternehmen/:id/routinen
POST /api/unternehmen/:id/routinen
GET/PATCH/DELETE /api/routinen/:id
GET/POST /api/routinen/:id/triggers
PATCH/DELETE /api/triggers/:id
GET  /api/routinen/:id/ausfuehrungen
POST /api/routinen/:id/trigger (manuell)
```

### Frontend:
- **Routinen Page** (`src/pages/Routinen.tsx`) - UI für Routinen-Verwaltung
- In Sidebar unter "Verwaltung" integriert

---

## Phase 2: Agent Adapters (ABGESCHLOSSEN ✅)

### Implementierte Adapter:
- **Bash Adapter** (`server/adapters/bash.ts`) - Shell-Kommandos
- **HTTP Adapter** (`server/adapters/http.ts`) - API Requests
- **Claude Code Adapter** (`server/adapters/claude-code.ts`) - CLI-Aufrufe mit Session-Persistence
- **Adapter Registry** (`server/adapters/registry.ts`) - Auto-select Adapter

### Heartbeat Integration:
- Führt Tasks automatisch via Adapter aus
- Speichert Ergebnis als Kommentar
- Trackt Token/Costs

---

## Phase 3: Skills & Matching (ABGESCHLOSSEN ✅)

### Skills Service (`server/services/skills.ts`):
- **10 vordefinierte Skills** in Kategorien:
  - Development: JavaScript, Python, API Design, Testing
  - DevOps: Docker, CI/CD
  - Data Science: Data Analysis
  - Content: Content Writing
  - Research: Research
  - Security: Security Audit

### API Endpoints:
```
GET  /api/skills - Alle verfügbaren Skills
GET  /api/skills/categories - Skill-Kategorien
GET  /api/experten/:id/skills - Skills eines Agenten
POST /api/experten/:id/skills - Skill zuweisen
DELETE /api/experten/:id/skills/:skillId - Skill entfernen
POST /api/aufgaben/match-agent - Besten Agenten für Task finden
```

### Features:
- Skill-Matching basierend auf Keywords
- Automatische Agenten-Empfehlung für Tasks
- proficiency-Level (0-100)

---

## Phase 4: Plugin Framework (ABGESCHLOSSEN ✅)

### Implementierte Komponenten:
- **Plugin Types** (`server/plugins/types.ts`) - PluginMetadata, Interface-Definitionen
- **Event Emitter** (`server/plugins/event-emitter.ts`) - Plugin-Kommunikation
- **Plugin Manager** (`server/plugins/plugin-manager.ts`) - Lifecycle & Registrierung
- **Plugin Loader** (`server/plugins/plugin-loader.ts`) - Laden aus verschiedenen Quellen
- **Abstract Plugin** (`server/plugins/abstract-plugin.ts`) - Basisklasse
- **Builtin Plugins**: Analytics-Plugin, Ollama-Extended-Plugin

### Features:
- Plugin-Lebenszyklus: initialize, start, stop, deactivate
- Event-System: emit, on, off, once
- Frontend-Integration: Dashboard-Widgets, Navigation, Settings-Pages
- API-Erweiterung: Plugins können eigene Endpoints registrieren
- isPremium-Flag für Monetarisierung

---

## Phase 5: Architektur-Stabilisierung (IN PROGRESS 🔄)

### Abgeschlossene Verbesserungen:
- **Critic Escalation** - Nach 2 Rejection-Zyklen: Task → `blocked`, markiert für Human Review (kein stilles Auto-Approve mehr)
- **Dual-Engine Unification** - Scheduler-Action `update_task_status→done` durchläuft jetzt den Critic-Gate (beide Ausführungspfade: Heartbeat + Scheduler haben Qualitätskontrolle)
- **LRU Conversation Memory** - In-Memory Gesprächsverlauf nutzt echte Last-Access-Time-Verdrängung (nicht Einfüge-Reihenfolge)
- **Session File TTL** - Claude-Code Session-Dateien werden automatisch nach 7 Tagen bereinigt
- **CLI Lock Safety** - Zwei separate Locks (agent vs. chat) mit 5-Min-Timeout — Telegram blockiert keine Agenten mehr, keine Deadlocks
- **DB Performance Indexes** - 9 neue Indexes auf Hot-Query-Spalten (Inbox, Status, Wakeup-Queue u.a.)

### Noch offen (Phase 5):
- (weitere Stabilisierungsthemen)

---

## Wichtige Dateien:
- DB Schema: `server/db/schema.ts`
- Services: `server/services/{wakeup,heartbeat,cron,skills}.ts`
- Adapters: `server/adapters/{types,bash,http,claude-code,registry}.ts`
- Server: `server/index.ts` (alle Endpoints)
- Frontend: `src/pages/Routinen.tsx`

## Design-System:
- Glassmorphism (backdrop-filter blur, semi-transparent backgrounds)
- Cyan-Partikel (#23CDCB) für Animationen
- Gradient Text für Überschriften
