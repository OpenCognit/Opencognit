# OpenCognit Architektur

## Überblick

OpenCognit ist eine Open-Source-Plattform zur Verwaltung autonomer KI-Agenten — entwickelt für den deutschsprachigen Raum mit Fokus auf Einfachheit und vollständigem Self-Hosting. Keine Cloud-Abhängigkeiten, keine versteckten Kosten.

## Aktuelle Architektur (Stand: April 2026)

### UI-Komponenten
- **LoginPage** (`src/components/ui/login-page.tsx`) - Modernes Login mit Inline-Styles
  - Split-Layout: Formular links, Gradient-Hintergrund rechts (Desktop)
  - Vollständig dunkles Theme (#09090b)
  - Password-Visibility Toggle
  - Toggle zwischen Anmelden/Registrieren
- **GradientMesh** (`src/components/ui/gradient-mesh.tsx`) - WebGL-basierter animierter Hintergrund (OGL)
- **Shadcn/UI Komponenten** - Button, Input, Label, Separator, Field-System
- **Layout-Komponenten** - Sidebar, TopBar, Dashboard-Layout

### State Management
- **TanStack Query** - Server State Management
- **Query Keys** - Strukturierte API-Cache-Keys (`lib/queryKeys.ts`)
- **useMutation** - Für Auth-Flows mit automatischem Query-Invalidation
- **Context API** - AuthContext, UnternehmenContext

### Auth-Flow
- JWT-basierte Authentifizierung mit localStorage
- Token-Speicherung unter `opencognit_token`
- Auto-Reload nach erfolgreichem Login/Registrierung
- Password-Visibility Toggle mit Eye-Icon

## Technische Entscheidungen

| Aspekt | Entscheidung | Begründung |
|--------|-------------|------------|
| **Auth** | JWT (localStorage) | Einfachheit, kein Session-Store nötig |
| **DB** | SQLite + Drizzle | Zero-Config Self-Hosting, kein Cloud-DB |
| **UI-Framework** | Radix UI + Tailwind | Zugänglich, composable, keine Lock-in |
| **Build** | Single Package | Reduzierter Overhead für Einzelentwickler |
| **Sprache** | Deutsch + Englisch (i18n) | Primäre Zielgruppe DACH-Raum |
| **Login-Design** | Gradient-Mesh + Clean Form | Modern, professionell, schnell |

## Projektstruktur

```
OpenCognit/
├── src/
│   ├── api/
│   │   └── client.ts          # API-Client mit JWT-Auth
│   ├── components/
│   │   ├── ui/
│   │   │   ├── login-page.tsx # Haupt-Login-Komponente
│   │   │   ├── gradient-mesh.tsx # WebGL Hintergrund
│   │   │   ├── button.tsx     # Shadcn Button
│   │   │   ├── input.tsx      # Shadcn Input
│   │   │   ├── label.tsx      # Shadcn Label
│   │   │   ├── separator.tsx  # Shadcn Separator
│   │   │   ├── field.tsx      # Shadcn Field-System
│   │   │   └── github-icon.tsx # GitHub Icon
│   │   ├── AsciiArtAnimation.tsx
│   │   ├── Layout.tsx
│   │   ├── Sidebar.tsx
│   │   ├── TopBar.tsx
│   │   └── OnboardingWizard.tsx
│   ├── hooks/
│   │   ├── useAuth.tsx        # Auth mit TanStack Query
│   │   ├── useSystemStatus.ts
│   │   └── useUnternehmen.tsx
│   ├── lib/
│   │   ├── queryKeys.ts       # TanStack Query Keys
│   │   └── utils.ts           # cn() Helper
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Unternehmen.tsx
│   │   ├── Experten.tsx
│   │   ├── Aufgaben.tsx
│   │   ├── Organigramm.tsx
│   │   ├── Kosten.tsx
│   │   ├── Genehmigungen.tsx
│   │   ├── Aktivitaet.tsx
│   │   └── Einstellungen.tsx
│   ├── App.tsx
│   ├── main.tsx               # QueryClient Provider
│   └── index.css              # Tailwind + CSS-Variablen
├── server/
│   ├── index.ts               # Express API + JWT
│   ├── db/
│   │   ├── client.ts          # SQLite + Drizzle
│   │   ├── schema.ts          # Datenbank-Schema
│   │   └── seed.ts            # Seed-Daten
│   └── scheduler.ts           # Zyklus-Scheduler
└── public/
    └── loginscreen.png
```

## Roadmap

### Phase 1: Basis ✅
- [x] Login mit Inline-Styles
- [x] TanStack Query Integration
- [x] Gradient-Mesh Hintergrund
- [x] Shadcn/UI Komponenten
- [x] Agent-Adapter System (Claude, Ollama, OpenRouter, HTTP, Bash)
- [x] Heartbeat-Service (Arbeitszyklen mit Budget-Tracking)
- [x] Issues mit Checkout-System
- [x] Live-Agent-Chat (Real-Time über WebSocket)

### Phase 2: Agent-Orchestrierung ✅
- [x] CEO-Adapter mit automatischer Delegation
- [x] Task-Zerlegung (Parent/Child Tasks)
- [x] Issue-Execution-Lock (verhindert parallele Arbeit am selben Issue)
- [x] Org-Chart UI (visuelle Hierarchie)
- [x] Hire-on-Demand mit Board-Approval

### Phase 3: Polish ✅
- [x] Command-Palette (cmdk) - ⌘K Navigation
- [x] Radix UI Components (Dialog, Command)
- [x] Bessere Fehlerbehandlung (ErrorBoundary, Toast, Retry)
- [x] Deutsche & Englische Sprachunterstützung (i18n Context)

## API-Endpoints

```
# Auth
POST   /api/auth/anmelden      # Login (JWT)
POST   /api/auth/registrieren  # Registrierung (JWT)
GET    /api/auth/ich           # Aktueller User

# System
GET    /api/health             # Health Check
GET    /api/system/status      # System Status

# Unternehmen
GET    /api/unternehmen        # Liste aller Unternehmen
POST   /api/unternehmen        # Neues Unternehmen erstellen
GET    /api/unternehmen/:id    # Details
PATCH  /api/unternehmen/:id    # Aktualisieren

# Experten (Agenten)
GET    /api/unternehmen/:id/experten  # Alle Experten
POST   /api/unternehmen/:id/experten  # Neuer Experte
GET    /api/experten/:id              # Experte Details
POST   /api/experten/:id/pausieren    # Pausieren
POST   /api/experten/:id/fortsetzen   # Fortsetzen
DELETE /api/experten/:id              # Löschen

# Aufgaben
GET    /api/unternehmen/:id/aufgaben  # Alle Aufgaben
POST   /api/unternehmen/:id/aufgaben  # Neue Aufgabe
GET    /api/aufgaben/:id              # Details
POST   /api/aufgaben/:id/checkout     # Aufgabe checkout

# Dashboard
GET    /api/unternehmen/:id/dashboard # Dashboard Daten
GET    /api/unternehmen/:id/kosten/zusammenfassung # Kosten

# Aktivitäten
GET    /api/unternehmen/:id/aktivitaet # Aktivitäts-Feed
```

## Entwicklung

```bash
npm run dev         # Dev Server (UI + API)
npm run build       # Production Build
npm run preview     # Production Preview
```

### Server-Ports
- UI: `http://localhost:3200`
- API: `http://localhost:3201`
- WebSocket: `ws://localhost:3201/ws`

## Design-Tokens

Alle CSS-Variablen sind in `src/index.css` definiert:

```css
/* Light Mode */
:root {
  --background: hsl(0, 0%, 100%);
  --foreground: hsl(0, 0%, 0%);
  --primary: hsl(221, 83%, 53%);
  --muted-foreground: hsl(215, 16%, 47%);
  --border: hsl(220, 20%, 90%);
  --ring: hsl(221, 83%, 53%);
}

/* Dark Mode */
.dark {
  --background: hsl(222, 94%, 5%);
  --foreground: hsl(0, 0%, 100%);
  --primary: hsl(217, 91%, 53%);
  --muted-foreground: hsl(215, 20%, 65%);
  --border: hsl(217, 33%, 17%);
  --input: hsl(217, 33%, 17%);
}
```

## Dependencies

### Runtime
- `react` / `react-dom` - UI Framework
- `react-router-dom` - Routing
- `@tanstack/react-query` - Server State
- `motion` - Animationen
- `lucide-react` - Icons
- `express` - Server
- `drizzle-orm` - ORM
- `better-sqlite3` - Datenbank
- `jsonwebtoken` - JWT Auth
- `bcryptjs` - Passwort-Hashing

### Development
- `typescript` - Typing
- `vite` - Build Tool
- `tailwindcss` - Styling
- `drizzle-kit` - DB Migrations

## Design-Entscheidungen

1. **Split-Layout Login** - Gradient-Mesh + sauberes Formular wirkt sofort professionell
2. **TanStack Query** - Deutlich weniger Boilerplate als manuelle Fetch-Hooks
3. **Zentrale Query Keys** - Verhindert Cache-Typos, erleichtert Invalidierung
4. **Inline-Styles für kritische Layouts** - Zuverlässiger als Tailwind bei komplexen Breakpoints
5. **Einfachheit über Komplexität** - Fokus auf das Wesentliche statt Enterprise-Feature-Bloat
