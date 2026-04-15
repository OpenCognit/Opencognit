// Clipmart Importer Service — Importiert komplette Firmen-Templates mit Agenten-Hierarchie
// Adaptiert das "Aqua-Hiring" Konzept für OpenCognit

import { db } from '../db/client.js';
import { experten, expertenSkills, skillsLibrary, routinen, routineTrigger } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';

// ─── Template-Definitionen ──────────────────────────────────────────────────

export interface ClipmartAgentDef {
  name: string;
  rolle: string;
  titel?: string;
  faehigkeiten?: string;
  verbindungsTyp?: string;
  avatar?: string;
  avatarFarbe?: string;
  budgetMonatCent?: number;
  zyklusIntervallSek?: number;
  zyklusAktiv?: boolean;
  isOrchestrator?: boolean;
  reportsToName?: string;
  skills?: ClipmartSkillRef[];
  systemPrompt?: string;
}

export interface ClipmartSkillRef {
  name: string;
  beschreibung: string;
  inhalt: string;
  tags?: string[];
  remoteSource?: string;
}

export interface ClipmartRoutineDef {
  titel: string;
  beschreibung?: string;
  assignedToName: string; // Agent-Name, wird bei Import aufgelöst
  cronExpression: string; // z.B. "0 9 * * *" = täglich 09:00
  timezone?: string;
  prioritaet?: 'critical' | 'high' | 'medium' | 'low';
}

export interface ClipmartTemplate {
  id: string;
  name: string;
  beschreibung: string;
  version: string;
  kategorie: 'automation' | 'team' | 'content' | 'dev' | 'research' | 'ecommerce' | 'integrations';
  icon: string;
  accentColor: string;
  tags: string[];
  agents: ClipmartAgentDef[];
  routinen?: ClipmartRoutineDef[];
  /** Konfigurationsfelder die der User ausfüllen muss (z.B. API Keys) */
  configFields?: Array<{ key: string; label: string; placeholder?: string; required: boolean; isSecret?: boolean }>;
}

// ─── Vorgefertigte Templates ────────────────────────────────────────────────

export const BUILTIN_TEMPLATES: ClipmartTemplate[] = [

  // ── AUTOMATIONS ────────────────────────────────────────────────────────────

  {
    id: 'social-media-daily',
    name: 'Social Media Daily Poster',
    beschreibung: 'Erstellt täglich automatisch Posts für X/Twitter, LinkedIn oder andere Plattformen und veröffentlicht sie über die API. Kein manuelles Eingreifen nötig.',
    version: '1.0.0',
    kategorie: 'automation',
    icon: '📱',
    accentColor: '#1d9bf0',
    tags: ['social media', 'automation', 'daily', 'content', 'x.com'],
    agents: [
      {
        name: 'Content Creator',
        rolle: 'Social Media Content Writer',
        titel: 'Content Spezialist',
        faehigkeiten: 'Copywriting, Social Media, Trending Topics, Hashtag Research, Engagement-Optimierung',
        verbindungsTyp: 'openrouter',
        avatar: '✍️',
        avatarFarbe: '#1d9bf0',
        budgetMonatCent: 0,
        zyklusIntervallSek: 86400,
        zyklusAktiv: false,
        systemPrompt: `Du bist ein Social Media Content Creator. Deine Aufgabe: Schreibe täglich einen hochwertigen Post für die zugewiesene Plattform.
Der Post soll authentisch, informativ und engagement-orientiert sein. Nutze aktuelle Trends und relevante Hashtags.
Schreibe den Post direkt — kein Vorgeplänkel. Format: Posttext + Hashtags.
Markiere den fertigen Post mit: POST_READY: [dein post hier]`,
        skills: [
          {
            name: 'Viral Copywriting',
            beschreibung: 'Posts die hohe Engagement-Rate erzielen',
            inhalt: '# Viral Copywriting\n\n## Formeln\n- Hook in Zeile 1 (Frage, konträre Aussage, Zahl)\n- Value im Körper\n- CTA am Ende\n\n## Regeln\n- Max 280 Zeichen für X\n- 3-5 relevante Hashtags\n- Ein Emoji pro Abschnitt max.\n- Keine corporate speak',
            tags: ['copywriting', 'social', 'viral'],
          }
        ]
      },
      {
        name: 'Social Poster',
        rolle: 'API Publisher',
        titel: 'Automatischer Publisher',
        faehigkeiten: 'API-Integration, HTTP Requests, Social Media APIs, Content Scheduling',
        verbindungsTyp: 'http',
        avatar: '🚀',
        avatarFarbe: '#22c55e',
        budgetMonatCent: 0,
        reportsToName: 'Content Creator',
        systemPrompt: `Du bist ein automatischer Publisher. Du empfängst fertige Posts vom Content Creator und veröffentlichst sie über die konfigurierte API.
Suche nach POST_READY: im Kontext und veröffentliche diesen Inhalt.`,
      }
    ],
    routinen: [
      {
        titel: 'Täglicher Social Media Post',
        beschreibung: 'Erstellt und veröffentlicht täglich um 09:00 Uhr einen neuen Post',
        assignedToName: 'Content Creator',
        cronExpression: '0 9 * * *',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      }
    ],
    configFields: [
      { key: 'platform', label: 'Plattform (x.com / linkedin / instagram)', placeholder: 'x.com', required: true },
      { key: 'topic', label: 'Thema / Nische', placeholder: 'z.B. Krypto, KI, Marketing', required: true },
      { key: 'apiKey', label: 'API Key (Bearer Token)', placeholder: 'Bearer xxx...', required: false, isSecret: true },
    ]
  },

  {
    id: 'newsletter-engine',
    name: 'Newsletter Engine',
    beschreibung: 'Recherchiert wöchentlich die wichtigsten Themen deiner Nische, schreibt einen professionellen Newsletter und versendet ihn automatisch.',
    version: '1.0.0',
    kategorie: 'automation',
    icon: '📧',
    accentColor: '#f59e0b',
    tags: ['newsletter', 'email', 'weekly', 'content', 'automation'],
    agents: [
      {
        name: 'News Researcher',
        rolle: 'Research Analyst',
        titel: 'Rechercheur',
        faehigkeiten: 'Web Research, Trend Analysis, Topic Curation, Source Evaluation',
        verbindungsTyp: 'openrouter',
        avatar: '🔍',
        avatarFarbe: '#f59e0b',
        budgetMonatCent: 0,
        systemPrompt: `Du bist ein Research Analyst. Jeden Montag recherchierst du die 5 wichtigsten News, Trends oder Erkenntnisse der Woche für das konfigurierte Thema.
Strukturiere deine Ausgabe als: TOP5_INSIGHTS: [nummerierte Liste mit Titel + 2-3 Sätze Erklärung]`,
        skills: [{
          name: 'Research & Curation',
          beschreibung: 'Systematische Recherche und Kuratierung relevanter Inhalte',
          inhalt: '# Research Methodik\n\n## Quellen\n- Aktuelle News (letzte 7 Tage priorisieren)\n- Akademische Papers für tiefe Insights\n- Social Media Diskussionen für Stimmung\n\n## Qualitätskriterien\n- Relevant für die Zielgruppe\n- Nicht schon bekannt/viral\n- Bietet echten Mehrwert',
          tags: ['research', 'curation', 'newsletter']
        }]
      },
      {
        name: 'Newsletter Writer',
        rolle: 'Content Writer',
        titel: 'Newsletter-Autor',
        faehigkeiten: 'Email Copywriting, Storytelling, Newsletter-Struktur, CTA-Optimierung',
        verbindungsTyp: 'openrouter',
        avatar: '✍️',
        avatarFarbe: '#a855f7',
        budgetMonatCent: 0,
        reportsToName: 'News Researcher',
        systemPrompt: `Du schreibst professionelle Newsletter auf Basis der Recherchen des News Researchers.
Format: Intro (2-3 Sätze) + 5 Abschnitte + Outro mit CTA.
Ton: informell aber professionell, wie von einem klugen Freund.
Markiere den fertigen Newsletter mit: NEWSLETTER_READY: [inhalt]`,
      }
    ],
    routinen: [
      {
        titel: 'Wöchentliche Recherche',
        beschreibung: 'Montags um 08:00 — Recherche der Woche',
        assignedToName: 'News Researcher',
        cronExpression: '0 8 * * 1',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      },
      {
        titel: 'Newsletter versenden',
        beschreibung: 'Montags um 10:00 — Newsletter schreiben und versenden',
        assignedToName: 'Newsletter Writer',
        cronExpression: '0 10 * * 1',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      }
    ],
    configFields: [
      { key: 'nische', label: 'Thema / Nische', placeholder: 'z.B. KI-Tools, FinTech, Health', required: true },
      { key: 'zielgruppe', label: 'Zielgruppe', placeholder: 'z.B. Gründer, Entwickler, Marketer', required: true },
      { key: 'newsletterName', label: 'Newsletter-Name', placeholder: 'z.B. The AI Weekly', required: false },
    ]
  },

  {
    id: 'crypto-monitor',
    name: 'Crypto Research Bot',
    beschreibung: 'Überwacht täglich Kryptomärkte, analysiert Trends und erstellt Reports. Sendet Alerts bei wichtigen Marktbewegungen.',
    version: '1.0.0',
    kategorie: 'research',
    icon: '📊',
    accentColor: '#f97316',
    tags: ['crypto', 'research', 'monitoring', 'daily', 'alerts'],
    agents: [
      {
        name: 'Market Analyst',
        rolle: 'Crypto Market Analyst',
        titel: 'Krypto-Analyst',
        faehigkeiten: 'Technical Analysis, On-Chain Metrics, Sentiment Analysis, DeFi Research, Market Reports',
        verbindungsTyp: 'openrouter',
        avatar: '📈',
        avatarFarbe: '#f97316',
        budgetMonatCent: 0,
        systemPrompt: `Du bist ein Krypto-Marktanalyst. Täglich analysierst du:
- Top 10 Coins: Preistrends, Volumen, Sentiment
- Wichtige On-Chain Metriken
- News die den Markt bewegen könnten
- DeFi Entwicklungen

Erstelle einen strukturierten Daily Report. Hebe bullische und bearische Signale klar hervor.
Format: DAILY_REPORT: [strukturierter report]`,
        skills: [{
          name: 'Crypto Analysis',
          beschreibung: 'Technical und Fundamental Analysis für Kryptomärkte',
          inhalt: '# Crypto Analysis Framework\n\n## Daily Checks\n- Price action (24h, 7d)\n- Volume Anomalien\n- Funding Rates\n- Fear & Greed Index\n\n## Signals\n- Bull: steigende Volumen, positive Funding, Whale Accumulation\n- Bear: fallende Volumen, negative Funding, Exchange Inflows',
          tags: ['crypto', 'analysis', 'defi']
        }]
      }
    ],
    routinen: [
      {
        titel: 'Täglicher Markt-Report',
        beschreibung: 'Jeden Morgen um 07:00 Uhr Marktanalyse',
        assignedToName: 'Market Analyst',
        cronExpression: '0 7 * * *',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      }
    ],
    configFields: [
      { key: 'coins', label: 'Fokus-Coins (kommagetrennt)', placeholder: 'BTC, ETH, SOL', required: false },
      { key: 'reportFormat', label: 'Report-Format', placeholder: 'kurz / detailliert', required: false },
    ]
  },

  // ── TEAMS ───────────────────────────────────────────────────────────────────

  {
    id: 'startup-team',
    name: 'Startup Team',
    beschreibung: 'Klassisches Startup-Team mit CEO, CTO und Growth Lead. Optimiert für schnelle Iteration und Wachstum.',
    version: '1.0.0',
    kategorie: 'team',
    icon: '🚀',
    accentColor: '#f59e0b',
    tags: ['startup', 'team', 'ceo', 'cto', 'growth'],
    agents: [
      {
        name: 'CEO',
        rolle: 'Chief Executive Officer',
        titel: 'Geschäftsführer',
        faehigkeiten: 'Strategie, Delegation, Hiring, Finanzplanung, Stakeholder-Kommunikation',
        verbindungsTyp: 'openrouter',
        avatar: '👔',
        avatarFarbe: '#f59e0b',
        budgetMonatCent: 0,
        isOrchestrator: true,
        systemPrompt: `Du bist der CEO eines agilen Startups. Koordiniere CTO und Growth Lead effizient.
Delegiere Aufgaben klar, triff finale Entscheidungen, und berichte dem User über Fortschritte.`,
        skills: [{
          name: 'Startup Strategy',
          beschreibung: 'Schnelle Iteration und Product-Market Fit',
          inhalt: '# Startup Strategy\n\n## Kernprinzipien\n- Ship fast, iterate faster\n- Talk to users every week\n- One metric that matters\n- Default alive > default dead',
          tags: ['strategy', 'startup']
        }]
      },
      {
        name: 'CTO',
        rolle: 'Chief Technology Officer',
        titel: 'Technischer Leiter',
        faehigkeiten: 'Software-Architektur, Code Review, DevOps, Security, Tech-Stack Entscheidungen',
        verbindungsTyp: 'openrouter',
        avatar: '💻',
        avatarFarbe: '#3b82f6',
        budgetMonatCent: 0,
        reportsToName: 'CEO',
        skills: [{
          name: 'Full-Stack Development',
          beschreibung: 'TypeScript, React, Node.js, PostgreSQL',
          inhalt: '# Full-Stack Dev\n\n## Stack\n- Frontend: React + TypeScript\n- Backend: Node.js + Express\n- DB: SQLite/PostgreSQL\n- Deploy: Docker + CI/CD',
          tags: ['development', 'typescript', 'react']
        }]
      },
      {
        name: 'Growth Lead',
        rolle: 'Head of Growth',
        titel: 'Wachstumsleiter',
        faehigkeiten: 'Marketing, Analytics, SEO, Content-Strategie, Social Media, Paid Ads',
        verbindungsTyp: 'openrouter',
        avatar: '📈',
        avatarFarbe: '#10b981',
        budgetMonatCent: 0,
        reportsToName: 'CEO',
        skills: [{
          name: 'Growth Hacking',
          beschreibung: 'Datengetriebene Wachstumsstrategien',
          inhalt: '# Growth Hacking\n\n## Playbook\n- A/B Testing für alles\n- Funnel-Analyse (AARRR)\n- Content + SEO als Flywheel\n- Community > Paid Ads',
          tags: ['marketing', 'growth', 'analytics']
        }]
      }
    ],
  },

  {
    id: 'dev-team',
    name: 'Dev Team',
    beschreibung: 'Vollständiges Entwickler-Team: Backend, Frontend, DevOps und QA. Ideal für Software-Projekte und SaaS-Produkte.',
    version: '1.0.0',
    kategorie: 'dev',
    icon: '⚙️',
    accentColor: '#3b82f6',
    tags: ['dev', 'engineering', 'backend', 'frontend', 'devops', 'qa'],
    agents: [
      {
        name: 'Tech Lead',
        rolle: 'Technical Lead',
        titel: 'Team-Lead Engineering',
        faehigkeiten: 'Architektur, Code Reviews, Sprint-Planning, Task-Breakdown, Technische Entscheidungen',
        verbindungsTyp: 'openrouter',
        avatar: '🧑‍💻',
        avatarFarbe: '#6366f1',
        budgetMonatCent: 0,
        isOrchestrator: true,
        systemPrompt: `Du bist der Tech Lead. Du planst und koordinierst das Entwicklungsteam.
Breche User-Anforderungen in konkrete Tasks auf. Weise sie dem richtigen Team-Mitglied zu.
Prüfe regelmäßig ob alle Tasks korrekt umgesetzt werden.`,
      },
      {
        name: 'Backend Dev',
        rolle: 'Backend Engineer',
        titel: 'Backend-Entwickler',
        faehigkeiten: 'Node.js, TypeScript, REST APIs, Datenbanken, Authentication, Performance',
        verbindungsTyp: 'openrouter',
        avatar: '⚡',
        avatarFarbe: '#3b82f6',
        budgetMonatCent: 0,
        reportsToName: 'Tech Lead',
        skills: [{
          name: 'Backend Engineering',
          beschreibung: 'Node.js, APIs, Datenbanken',
          inhalt: '# Backend Engineering\n\n## Standards\n- RESTful APIs mit OpenAPI Spec\n- JWT Auth + Refresh Tokens\n- Input Validation an allen Endpoints\n- Error Handling mit strukturierten Fehlern\n- Rate Limiting',
          tags: ['backend', 'nodejs', 'api']
        }]
      },
      {
        name: 'Frontend Dev',
        rolle: 'Frontend Engineer',
        titel: 'Frontend-Entwickler',
        faehigkeiten: 'React, TypeScript, CSS, UX, Responsive Design, Performance, Accessibility',
        verbindungsTyp: 'openrouter',
        avatar: '🎨',
        avatarFarbe: '#ec4899',
        budgetMonatCent: 0,
        reportsToName: 'Tech Lead',
        skills: [{
          name: 'Frontend Engineering',
          beschreibung: 'React, TypeScript, UX',
          inhalt: '# Frontend Engineering\n\n## Standards\n- React + TypeScript strict mode\n- Component-basierte Architektur\n- Mobile-first Responsive Design\n- Accessibility (WCAG 2.1 AA)\n- Web Vitals: LCP < 2.5s',
          tags: ['frontend', 'react', 'ux']
        }]
      },
      {
        name: 'DevOps',
        rolle: 'DevOps Engineer',
        titel: 'DevOps-Ingenieur',
        faehigkeiten: 'Docker, CI/CD, GitHub Actions, AWS/GCP, Monitoring, Security, Infrastructure',
        verbindungsTyp: 'openrouter',
        avatar: '🔧',
        avatarFarbe: '#f97316',
        budgetMonatCent: 0,
        reportsToName: 'Tech Lead',
        skills: [{
          name: 'DevOps & Infrastructure',
          beschreibung: 'Docker, CI/CD, Cloud',
          inhalt: '# DevOps\n\n## Stack\n- Docker + Docker Compose\n- GitHub Actions für CI/CD\n- Staging → Production Pipeline\n- Monitoring: Prometheus + Grafana\n- Security: SAST, dependency scanning',
          tags: ['devops', 'docker', 'cicd']
        }]
      }
    ],
  },

  {
    id: 'content-team',
    name: 'Content Marketing Team',
    beschreibung: 'SEO-Artikel, Blog-Posts, Social Media — vollautomatisch produziert und veröffentlicht. Mit Weekly-Content-Plan.',
    version: '1.0.0',
    kategorie: 'content',
    icon: '✍️',
    accentColor: '#a855f7',
    tags: ['content', 'seo', 'blog', 'social', 'marketing', 'weekly'],
    agents: [
      {
        name: 'Content Strategist',
        rolle: 'Content Strategy Lead',
        titel: 'Content-Stratege',
        faehigkeiten: 'Content Strategy, SEO, Keyword Research, Content Calendar, Audience Research',
        verbindungsTyp: 'openrouter',
        avatar: '📋',
        avatarFarbe: '#a855f7',
        budgetMonatCent: 0,
        isOrchestrator: true,
        systemPrompt: `Du bist der Content Strategist. Jeden Montag planst du den Content der Woche.
Erstelle einen konkreten Content-Plan: welche Artikel, welche Social Posts, welche Keywords.
Delegiere Artikel an den SEO Writer und Social Posts an den Social Media Manager.`,
      },
      {
        name: 'SEO Writer',
        rolle: 'SEO Content Writer',
        titel: 'SEO-Autor',
        faehigkeiten: 'SEO Copywriting, Keyword-Optimierung, Meta Tags, Internal Linking, E-E-A-T',
        verbindungsTyp: 'openrouter',
        avatar: '🔍',
        avatarFarbe: '#22c55e',
        budgetMonatCent: 0,
        reportsToName: 'Content Strategist',
        skills: [{
          name: 'SEO Writing',
          beschreibung: 'Artikel die ranken und konvertieren',
          inhalt: '# SEO Writing\n\n## Artikel-Struktur\n- H1 mit Keyword\n- Intro: Nutzerversprechen in 50 Worten\n- H2/H3 Struktur für Featured Snippets\n- LSI Keywords natürlich einbauen\n- CTA am Ende\n\n## Technisch\n- Meta Title: 55-60 Zeichen\n- Meta Description: 150-160 Zeichen\n- Alt Texts für alle Bilder',
          tags: ['seo', 'writing', 'content']
        }]
      },
      {
        name: 'Social Media Manager',
        rolle: 'Social Media Specialist',
        titel: 'Social Media Manager',
        faehigkeiten: 'Social Media Copywriting, Community Management, Trend Research, Engagement',
        verbindungsTyp: 'openrouter',
        avatar: '📱',
        avatarFarbe: '#1d9bf0',
        budgetMonatCent: 0,
        reportsToName: 'Content Strategist',
      }
    ],
    routinen: [
      {
        titel: 'Wöchentlicher Content-Plan',
        beschreibung: 'Jeden Montag um 08:00 — Content-Plan für die Woche erstellen',
        assignedToName: 'Content Strategist',
        cronExpression: '0 8 * * 1',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      }
    ],
    configFields: [
      { key: 'nische', label: 'Nische / Thema', placeholder: 'z.B. SaaS, Health Tech, E-Commerce', required: true },
      { key: 'zielgruppe', label: 'Zielgruppe', placeholder: 'z.B. CTOs, Gründer, Freelancer', required: true },
      { key: 'sprache', label: 'Sprache', placeholder: 'Deutsch / Englisch', required: false },
    ]
  },

  {
    id: 'game-studio',
    name: 'Indie Game Studio',
    beschreibung: 'Game-Development-Team: Creative Director, Tech Director und QA Lead. Für Spieleentwicklung und Game Design.',
    version: '1.0.0',
    kategorie: 'dev',
    icon: '🎮',
    accentColor: '#8b5cf6',
    tags: ['gamedev', 'indie', 'unity', 'unreal', 'game design'],
    agents: [
      {
        name: 'Creative Director',
        rolle: 'Creative Director',
        titel: 'Kreativdirektor',
        faehigkeiten: 'Game Design, Story Writing, Art Direction, Player Experience, Monetarisierung',
        verbindungsTyp: 'openrouter',
        avatar: '🎮',
        avatarFarbe: '#8b5cf6',
        budgetMonatCent: 0,
        isOrchestrator: true,
        skills: [{
          name: 'Game Design',
          beschreibung: 'Spielmechaniken, Level Design, Balancing',
          inhalt: '# Game Design\n\n## Core Loop\n- Engagement: Was hält den Spieler?\n- Progression: Was motiviert weiterzuspielen?\n- Mastery: Was fühlt sich befriedigend an?\n\n## Balancing\n- Playtest early, often\n- Daten > Meinungen',
          tags: ['gamedev', 'design', 'balancing']
        }]
      },
      {
        name: 'Tech Director',
        rolle: 'Technical Director',
        titel: 'Technischer Direktor',
        faehigkeiten: 'Game Engine, Rendering, Networking, Performance Optimization, Build Systems',
        verbindungsTyp: 'openrouter',
        avatar: '⚙️',
        avatarFarbe: '#06b6d4',
        budgetMonatCent: 0,
        reportsToName: 'Creative Director',
      },
      {
        name: 'QA Lead',
        rolle: 'Quality Assurance Lead',
        titel: 'QA-Leiter',
        faehigkeiten: 'Test-Automatisierung, Bug-Tracking, Regression Testing, Playtesting',
        verbindungsTyp: 'openrouter',
        avatar: '🔍',
        avatarFarbe: '#ef4444',
        budgetMonatCent: 0,
        reportsToName: 'Creative Director',
      }
    ],
  },

  // ── INTEGRATIONS ───────────────────────────────────────────────────────────

  {
    id: 'github-monitor',
    name: 'GitHub Monitor',
    beschreibung: 'Überwacht GitHub-Repositories auf neue Issues, Pull Requests und Releases. Sendet tägliche Zusammenfassungen und weckt dein Team bei kritischen Events.',
    version: '1.0.0',
    kategorie: 'integrations',
    icon: '🐙',
    accentColor: '#6e40c9',
    tags: ['github', 'devops', 'code review', 'issues', 'automation'],
    agents: [
      {
        name: 'GitHub Monitor',
        rolle: 'DevOps & Repository Monitor',
        titel: 'GitHub Agent',
        faehigkeiten: 'GitHub API, Code Review, Issue Tracking, Release Management, CI/CD',
        verbindungsTyp: 'openrouter',
        avatar: '🐙',
        avatarFarbe: '#6e40c9',
        budgetMonatCent: 0,
        zyklusAktiv: true,
        zyklusIntervallSek: 3600,
        systemPrompt: `Du bist ein GitHub-Monitor-Agent. Du überwachst das Repository {{repo}} via GitHub API.

Dein GitHub Token: {{github_token}}
Repository: {{repo}}

DEINE AUFGABEN:
1. Prüfe täglich neue Issues, PRs und Releases via:
   GET https://api.github.com/repos/{{repo}}/issues?state=open&sort=created&per_page=10
   Header: Authorization: Bearer {{github_token}}

2. Bei kritischen Issues (Label: "bug", "critical"): Sofort Aufgabe erstellen
3. Bei neuen PRs: Task für Code-Review erstellen
4. Täglich: Kurze Zusammenfassung ins Board posten

Nutze den http-Adapter für alle GitHub API Calls.`,
      }
    ],
    routinen: [
      {
        titel: 'GitHub Daily Report',
        beschreibung: 'Täglicher GitHub Activity Report',
        assignedToName: 'GitHub Monitor',
        cronExpression: '0 9 * * *',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      }
    ],
    configFields: [
      { key: 'github_token', label: 'GitHub Personal Access Token', placeholder: 'ghp_...', required: true, isSecret: true },
      { key: 'repo', label: 'Repository (owner/repo)', placeholder: 'microsoft/vscode', required: true },
    ],
  },

  {
    id: 'discord-bot',
    name: 'Discord Bot',
    beschreibung: 'Sendet automatisch Updates, Task-Zusammenfassungen und Team-Briefings in einen Discord-Channel via Webhook. Keine Bot-Installation nötig.',
    version: '1.0.0',
    kategorie: 'integrations',
    icon: '🎮',
    accentColor: '#5865f2',
    tags: ['discord', 'notifications', 'team', 'webhook', 'chat'],
    agents: [
      {
        name: 'Discord Notifier',
        rolle: 'Discord Communication Agent',
        titel: 'Discord Bot',
        faehigkeiten: 'Discord Webhooks, Team Communication, Notifications, Status Updates',
        verbindungsTyp: 'openrouter',
        avatar: '🎮',
        avatarFarbe: '#5865f2',
        budgetMonatCent: 0,
        zyklusAktiv: true,
        zyklusIntervallSek: 86400,
        systemPrompt: `Du bist ein Discord-Kommunikations-Agent. Du sendest Updates in den Discord-Channel via Webhook.

Discord Webhook URL: {{discord_webhook_url}}

DEINE AUFGABEN:
1. Sende täglich einen Team-Standup-Bericht via HTTP POST an die Webhook-URL
2. Format für Discord-Nachrichten (JSON):
   {"content": "...", "embeds": [{"title": "...", "description": "...", "color": 5793266}]}
3. Nutze folgende Aktionen:
   - Morgens (09:00): Tagesziele posten
   - Abends (18:00): Zusammenfassung was erledigt wurde
4. Bei neuen Tasks: sofort in Discord ankündigen

Sende immer via HTTP POST an: {{discord_webhook_url}}
Content-Type: application/json`,
      }
    ],
    routinen: [
      {
        titel: 'Discord Morning Briefing',
        beschreibung: 'Tägliches Morgen-Briefing in Discord',
        assignedToName: 'Discord Notifier',
        cronExpression: '0 9 * * 1-5',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      },
      {
        titel: 'Discord Evening Summary',
        beschreibung: 'Tägliche Abend-Zusammenfassung in Discord',
        assignedToName: 'Discord Notifier',
        cronExpression: '0 18 * * 1-5',
        timezone: 'Europe/Berlin',
        prioritaet: 'low',
      }
    ],
    configFields: [
      { key: 'discord_webhook_url', label: 'Discord Webhook URL', placeholder: 'https://discord.com/api/webhooks/...', required: true, isSecret: true },
    ],
  },

  {
    id: 'slack-notifier',
    name: 'Slack Notifier',
    beschreibung: 'Verbindet OpenCognit mit deinem Slack-Workspace. Sendet tägliche Reports, Task-Updates und Team-Briefings in beliebige Channels via Incoming Webhook.',
    version: '1.0.0',
    kategorie: 'integrations',
    icon: '💬',
    accentColor: '#4a154b',
    tags: ['slack', 'notifications', 'team', 'webhook', 'communication'],
    agents: [
      {
        name: 'Slack Agent',
        rolle: 'Slack Communication Manager',
        titel: 'Slack Bot',
        faehigkeiten: 'Slack API, Webhooks, Team Updates, Rich Formatting, Block Kit',
        verbindungsTyp: 'openrouter',
        avatar: '💬',
        avatarFarbe: '#4a154b',
        budgetMonatCent: 0,
        zyklusAktiv: true,
        zyklusIntervallSek: 86400,
        systemPrompt: `Du bist ein Slack-Kommunikations-Agent. Du sendest Updates in Slack via Webhook.

Slack Webhook URL: {{slack_webhook_url}}
Channel: {{slack_channel}}

DEINE AUFGABEN:
Sende Updates via HTTP POST an {{slack_webhook_url}}
Format (Slack Block Kit JSON):
{
  "text": "Kurze Beschreibung",
  "blocks": [
    {"type": "header", "text": {"type": "plain_text", "text": "Titel"}},
    {"type": "section", "text": {"type": "mrkdwn", "text": "*Inhalt* hier"}}
  ]
}

Routinen:
- Täglich 09:00: Daily Standup ins Slack
- Bei Task-Completion: Erfolgs-Meldung
- Wöchentlich Montag: Wochenplanung`,
      }
    ],
    routinen: [
      {
        titel: 'Slack Daily Standup',
        beschreibung: 'Täglicher Standup-Report in Slack',
        assignedToName: 'Slack Agent',
        cronExpression: '0 9 * * 1-5',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      }
    ],
    configFields: [
      { key: 'slack_webhook_url', label: 'Slack Incoming Webhook URL', placeholder: 'https://hooks.slack.com/services/...', required: true, isSecret: true },
      { key: 'slack_channel', label: 'Channel Name', placeholder: '#general', required: false },
    ],
  },

  {
    id: 'gmail-assistant',
    name: 'Gmail Assistant',
    beschreibung: 'KI-Agent der deine Gmail-Inbox überwacht, wichtige E-Mails zusammenfasst, Antworten vorbereitet und Tasks aus E-Mails erstellt — via Gmail API.',
    version: '1.0.0',
    kategorie: 'integrations',
    icon: '📧',
    accentColor: '#ea4335',
    tags: ['gmail', 'email', 'productivity', 'inbox', 'google'],
    agents: [
      {
        name: 'Gmail Assistant',
        rolle: 'Email & Communication Manager',
        titel: 'E-Mail Agent',
        faehigkeiten: 'Gmail API, Email Management, Inbox Zero, Antwort-Drafts, Priorisierung',
        verbindungsTyp: 'openrouter',
        avatar: '📧',
        avatarFarbe: '#ea4335',
        budgetMonatCent: 0,
        zyklusAktiv: true,
        zyklusIntervallSek: 3600,
        systemPrompt: `Du bist ein Gmail-Assistant-Agent. Du verwaltest E-Mails via Gmail API.

Gmail API Key: {{gmail_api_key}}

TÄGLICH:
1. Hole ungelesene E-Mails: GET https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread
   Authorization: Bearer {{gmail_api_key}}
2. Analysiere jede E-Mail auf Dringlichkeit
3. Erstelle Tasks für wichtige Action-Items
4. Markiere analysierte E-Mails als gelesen

PRIORISIERUNG:
- 🔴 Dringend: Antwort-Draft erstellen → Task für heute
- 🟡 Wichtig: Task erstellen → diese Woche
- 🟢 Info: Zusammenfassung → Wochenreport`,
      }
    ],
    routinen: [
      {
        titel: 'Gmail Inbox Check',
        beschreibung: 'Stündlicher E-Mail-Check und Task-Erstellung',
        assignedToName: 'Gmail Assistant',
        cronExpression: '0 * * * *',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      }
    ],
    configFields: [
      { key: 'gmail_api_key', label: 'Gmail OAuth Access Token', placeholder: 'ya29.a0...', required: true, isSecret: true },
    ],
  },

  {
    id: 'twitter-x-poster',
    name: 'Twitter / X Daily Poster',
    beschreibung: 'Erstellt und postet täglich Tweets via X API v2. Analysiert Trends, optimiert Hashtags und passt Content an deine Nische an. Kein manuelles Eingreifen nötig.',
    version: '1.0.0',
    kategorie: 'integrations',
    icon: '𝕏',
    accentColor: '#000000',
    tags: ['twitter', 'x', 'social media', 'automation', 'content'],
    agents: [
      {
        name: 'X/Twitter Agent',
        rolle: 'Social Media & Content Manager',
        titel: 'Twitter Specialist',
        faehigkeiten: 'X API, Tweet Writing, Trend Analysis, Hashtag Research, Engagement-Optimierung',
        verbindungsTyp: 'openrouter',
        avatar: '𝕏',
        avatarFarbe: '#000000',
        budgetMonatCent: 0,
        zyklusAktiv: true,
        zyklusIntervallSek: 86400,
        systemPrompt: `Du bist ein Twitter/X-Content-Agent. Du erstellst und postest täglich Tweets.

Thema/Nische: {{nische}}
X API Bearer Token: {{x_bearer_token}}
X API Key: {{x_api_key}}
X API Secret: {{x_api_secret}}
Access Token: {{x_access_token}}
Access Secret: {{x_access_secret}}

TÄGLICHE ROUTINE:
1. Analysiere aktuelle Trends in deiner Nische
2. Erstelle 1 starken Tweet (max. 280 Zeichen)
3. Poste via X API v2:
   POST https://api.twitter.com/2/tweets
   Authorization: OAuth 1.0a (oauth_consumer_key={{x_api_key}}, oauth_token={{x_access_token}}, ...)
   Body: {"text": "dein tweet"}
4. Optimiere: Hook in den ersten 10 Wörtern, relevante Hashtags, CTA

CONTENT-REGELN:
- Authentisch, nicht werbend
- Mehrwert für die Community
- Emojis sparsam einsetzen`,
      }
    ],
    routinen: [
      {
        titel: 'X/Twitter Daily Post',
        beschreibung: 'Täglicher Tweet in der besten Engagement-Zeit',
        assignedToName: 'X/Twitter Agent',
        cronExpression: '0 10 * * *',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      }
    ],
    configFields: [
      { key: 'nische', label: 'Thema / Nische', placeholder: 'z.B. KI, SaaS, Crypto, Fitness', required: true },
      { key: 'x_bearer_token', label: 'X Bearer Token', placeholder: 'AAAA...', required: true, isSecret: true },
      { key: 'x_api_key', label: 'X API Key (Consumer Key)', placeholder: '...', required: true, isSecret: true },
      { key: 'x_api_secret', label: 'X API Secret', placeholder: '...', required: true, isSecret: true },
      { key: 'x_access_token', label: 'Access Token', placeholder: '...', required: true, isSecret: true },
      { key: 'x_access_secret', label: 'Access Token Secret', placeholder: '...', required: true, isSecret: true },
    ],
  },

  {
    id: 'spotify-controller',
    name: 'Spotify DJ',
    beschreibung: 'KI-DJ der deine Spotify-Playlists automatisch verwaltet. Erstellt Stimmungs-Playlists, fügt neue Tracks hinzu und passt die Musik an Tageszeit und Aktivität an.',
    version: '1.0.0',
    kategorie: 'integrations',
    icon: '🎵',
    accentColor: '#1db954',
    tags: ['spotify', 'music', 'playlist', 'automation', 'lifestyle'],
    agents: [
      {
        name: 'Spotify DJ',
        rolle: 'Music & Playlist Manager',
        titel: 'Spotify Agent',
        faehigkeiten: 'Spotify API, Playlist Management, Music Curation, Mood Analysis',
        verbindungsTyp: 'openrouter',
        avatar: '🎵',
        avatarFarbe: '#1db954',
        budgetMonatCent: 0,
        zyklusAktiv: false,
        systemPrompt: `Du bist ein Spotify-DJ-Agent. Du verwaltest Playlists via Spotify Web API.

Spotify Access Token: {{spotify_access_token}}
Basis-URL: https://api.spotify.com/v1
Authorization: Bearer {{spotify_access_token}}

AUFGABEN:
- Playlist erstellen: POST /users/{user_id}/playlists
- Tracks hinzufügen: POST /playlists/{id}/tracks
- Aktuelle Playlists abrufen: GET /me/playlists
- Empfehlungen: GET /recommendations?seed_genres=...

STIMMUNGS-MAPPING:
- Morgen (06-09): energetisch, BPM 120+
- Arbeit (09-17): fokussiert, instrumentall, lo-fi
- Sport: hochenergetisch, BPM 140+
- Abend: entspannt, acoustic`,
      }
    ],
    configFields: [
      { key: 'spotify_access_token', label: 'Spotify OAuth Access Token', placeholder: 'BQC...', required: true, isSecret: true },
    ],
  },

  {
    id: 'hue-automation',
    name: 'Philips Hue Automation',
    beschreibung: 'KI-Agent der deine Philips Hue Lampen automatisch steuert — nach Tageszeit, Aktivität, Wetter oder Stimmung. Automatische Szenen ohne Alexa oder HomeKit.',
    version: '1.0.0',
    kategorie: 'integrations',
    icon: '💡',
    accentColor: '#f59e0b',
    tags: ['hue', 'smart home', 'lighting', 'automation', 'iot'],
    agents: [
      {
        name: 'Hue Controller',
        rolle: 'Smart Home & Lighting Automation',
        titel: 'Hue Agent',
        faehigkeiten: 'Philips Hue API, Smart Home, Lighting Scenes, Automation, IoT',
        verbindungsTyp: 'openrouter',
        avatar: '💡',
        avatarFarbe: '#f59e0b',
        budgetMonatCent: 0,
        zyklusAktiv: true,
        zyklusIntervallSek: 3600,
        systemPrompt: `Du bist ein Philips Hue Steuerungs-Agent. Du kontrollierst Lampen via Hue API.

Hue Bridge IP: {{hue_bridge_ip}}
Hue API Key: {{hue_api_key}}
Basis-URL: http://{{hue_bridge_ip}}/api/{{hue_api_key}}

AUFGABEN:
- Lichter abrufen: GET /lights
- Licht schalten: PUT /lights/{id}/state {"on": true/false}
- Helligkeit: PUT /lights/{id}/state {"bri": 0-254}
- Farbe (Hue): PUT /lights/{id}/state {"hue": 0-65535, "sat": 0-254}
- Szene aktivieren: PUT /groups/0/action {"scene": "scene_id"}

TAGES-AUTOMATISIERUNG:
- 07:00: Warmes Licht (2700K), 60% Helligkeit
- 09:00: Kühles Licht (4000K), 100% — Arbeiten
- 18:00: Warmes Licht (2200K), 40% — Entspannen
- 22:00: Sehr warm (1800K), 20% — Schlafen`,
      }
    ],
    routinen: [
      {
        titel: 'Hue Morning Scene',
        beschreibung: 'Morgenroutine — warmes Aufwachlicht',
        assignedToName: 'Hue Controller',
        cronExpression: '0 7 * * *',
        timezone: 'Europe/Berlin',
        prioritaet: 'low',
      },
      {
        titel: 'Hue Work Scene',
        beschreibung: 'Arbeits-Licht aktivieren',
        assignedToName: 'Hue Controller',
        cronExpression: '0 9 * * 1-5',
        timezone: 'Europe/Berlin',
        prioritaet: 'low',
      },
      {
        titel: 'Hue Evening Scene',
        beschreibung: 'Abend-Entspannungs-Licht',
        assignedToName: 'Hue Controller',
        cronExpression: '0 18 * * *',
        timezone: 'Europe/Berlin',
        prioritaet: 'low',
      }
    ],
    configFields: [
      { key: 'hue_bridge_ip', label: 'Hue Bridge IP-Adresse', placeholder: '192.168.1.100', required: true },
      { key: 'hue_api_key', label: 'Hue API Username/Key', placeholder: 'newdeveloper...', required: true, isSecret: true },
    ],
  },

  {
    id: 'browser-watcher',
    name: 'Browser & Web Watcher',
    beschreibung: 'Agent der Websites überwacht — Preisänderungen, neue Inhalte, Verfügbarkeit, Competitor-Monitoring. Benachrichtigt dich bei relevanten Änderungen.',
    version: '1.0.0',
    kategorie: 'integrations',
    icon: '🌐',
    accentColor: '#0ea5e9',
    tags: ['browser', 'monitoring', 'web scraping', 'price tracking', 'alerts'],
    agents: [
      {
        name: 'Web Watcher',
        rolle: 'Web Monitoring & Intelligence Agent',
        titel: 'Browser Agent',
        faehigkeiten: 'Web Scraping, HTTP Requests, Content Monitoring, Price Tracking, Competitor Analysis',
        verbindungsTyp: 'openrouter',
        avatar: '🌐',
        avatarFarbe: '#0ea5e9',
        budgetMonatCent: 0,
        zyklusAktiv: true,
        zyklusIntervallSek: 3600,
        systemPrompt: `Du bist ein Web-Monitoring-Agent. Du überwachst Websites auf Änderungen.

Zu überwachende URLs: {{watch_urls}}
Keyword-Alerts: {{keywords}}

AUFGABEN:
1. Prüfe jede URL via HTTP GET (bash-Adapter mit curl)
2. Vergleiche Content mit letztem Check (Memory)
3. Bei Änderungen/Keywords: Task erstellen + Benachrichtigung
4. Speichere letzten Zustand in Memory

BASH-COMMANDS die du nutzen kannst:
- curl -s "URL" | grep -i "keyword"
- curl -sI "URL" | grep -i "last-modified"
- curl -s "URL" | python3 -c "import sys; print(len(sys.stdin.read()))"

Nutze die bash-Action für alle Web-Requests.`,
      }
    ],
    routinen: [
      {
        titel: 'Web Monitoring Check',
        beschreibung: 'Stündliche Website-Überprüfung',
        assignedToName: 'Web Watcher',
        cronExpression: '0 * * * *',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      }
    ],
    configFields: [
      { key: 'watch_urls', label: 'URLs zum Überwachen (kommagetrennt)', placeholder: 'https://example.com, https://shop.com/product', required: true },
      { key: 'keywords', label: 'Alert-Keywords (kommagetrennt)', placeholder: 'verfügbar, in stock, -20%', required: false },
    ],
  },

];

// ─── Import-Logik ───────────────────────────────────────────────────────────

export interface ImportResult {
  success: boolean;
  templateName: string;
  agentsCreated: number;
  skillsCreated: number;
  routinenCreated: number;
  errors: string[];
}

export function importTemplate(
  unternehmenId: string,
  template: ClipmartTemplate,
  userConfig?: Record<string, string>,
): ImportResult {
  const result: ImportResult = {
    success: true,
    templateName: template.name,
    agentsCreated: 0,
    skillsCreated: 0,
    routinenCreated: 0,
    errors: [],
  };

  const now = new Date().toISOString();
  const agentIdMap = new Map<string, string>();

  // Phase 1: Agenten anlegen
  for (const agentDef of template.agents) {
    try {
      const agentId = uuid();
      agentIdMap.set(agentDef.name, agentId);

      let systemPrompt = agentDef.systemPrompt || null;
      // Inject user config into system prompt
      if (systemPrompt && userConfig) {
        for (const [key, val] of Object.entries(userConfig)) {
          systemPrompt = systemPrompt.replaceAll(`{{${key}}}`, val);
        }
      }

      const verbindungsConfig = JSON.stringify({
        autonomyLevel: agentDef.isOrchestrator ? 'teamplayer' : 'copilot',
        model: userConfig?.model || 'auto:free', // default to free auto-routing
      });

      db.insert(experten).values({
        id: agentId,
        unternehmenId,
        name: agentDef.name,
        rolle: agentDef.rolle,
        titel: agentDef.titel || null,
        faehigkeiten: agentDef.faehigkeiten || null,
        verbindungsTyp: agentDef.verbindungsTyp || 'openrouter',
        verbindungsConfig,
        avatar: agentDef.avatar || null,
        avatarFarbe: agentDef.avatarFarbe || '#23CDCA',
        budgetMonatCent: agentDef.budgetMonatCent ?? 0,
        verbrauchtMonatCent: 0,
        isOrchestrator: agentDef.isOrchestrator || false,
        zyklusIntervallSek: agentDef.zyklusIntervallSek || 300,
        zyklusAktiv: agentDef.zyklusAktiv ?? false,
        systemPrompt,
        status: 'idle',
        nachrichtenCount: 0,
        erstelltAm: now,
        aktualisiertAm: now,
      }).run();

      result.agentsCreated++;
    } catch (err: any) {
      result.errors.push(`Agent "${agentDef.name}": ${err.message}`);
      result.success = false;
    }
  }

  // Phase 2: reportsTo-Beziehungen
  for (const agentDef of template.agents) {
    if (agentDef.reportsToName) {
      const agentId = agentIdMap.get(agentDef.name);
      const reportsToId = agentIdMap.get(agentDef.reportsToName);
      if (agentId && reportsToId) {
        db.update(experten)
          .set({ reportsTo: reportsToId, aktualisiertAm: now })
          .where(eq(experten.id, agentId))
          .run();
      }
    }
  }

  // Phase 3: Skills
  for (const agentDef of template.agents) {
    const agentId = agentIdMap.get(agentDef.name);
    if (!agentId || !agentDef.skills) continue;

    for (const skillDef of agentDef.skills) {
      try {
        const skillId = uuid();
        const tags = [...(skillDef.tags || [])];
        if (skillDef.remoteSource) tags.push(`remote:${skillDef.remoteSource}`);

        db.insert(skillsLibrary).values({
          id: skillId,
          unternehmenId,
          name: skillDef.name,
          beschreibung: skillDef.beschreibung || null,
          inhalt: skillDef.inhalt,
          tags: JSON.stringify(tags),
          erstelltVon: 'clipmart',
          erstelltAm: now,
          aktualisiertAm: now,
        }).run();

        db.insert(expertenSkills).values({
          id: uuid(),
          expertId: agentId,
          skillId,
          erstelltAm: now,
        }).run();

        result.skillsCreated++;
      } catch (err: any) {
        result.errors.push(`Skill "${skillDef.name}": ${err.message}`);
      }
    }
  }

  // Phase 4: Routinen anlegen
  if (template.routinen) {
    for (const routineDef of template.routinen) {
      try {
        const agentId = agentIdMap.get(routineDef.assignedToName);
        const routineId = uuid();

        db.insert(routinen).values({
          id: routineId,
          unternehmenId,
          titel: routineDef.titel,
          beschreibung: routineDef.beschreibung || null,
          zugewiesenAn: agentId || null,
          prioritaet: routineDef.prioritaet || 'medium',
          status: 'active',
          concurrencyPolicy: 'skip_if_active',
          catchUpPolicy: 'skip_missed',
          variablen: userConfig ? JSON.stringify(userConfig) : null,
          erstelltAm: now,
          aktualisiertAm: now,
        }).run();

        // Cron-Trigger anlegen
        const triggerId = uuid();
        db.insert(routineTrigger).values({
          id: triggerId,
          unternehmenId,
          routineId,
          kind: 'schedule',
          aktiv: true,
          cronExpression: routineDef.cronExpression,
          timezone: routineDef.timezone || 'Europe/Berlin',
          erstelltAm: now,
        }).run();

        result.routinenCreated++;
      } catch (err: any) {
        result.errors.push(`Routine "${routineDef.titel}": ${err.message}`);
      }
    }
  }

  return result;
}

export function getAvailableTemplates() {
  return BUILTIN_TEMPLATES.map(t => ({
    id: t.id,
    name: t.name,
    beschreibung: t.beschreibung,
    version: t.version,
    kategorie: t.kategorie,
    icon: t.icon,
    accentColor: t.accentColor,
    tags: t.tags,
    agentCount: t.agents.length,
    routinenCount: t.routinen?.length || 0,
    configFields: t.configFields || [],
  }));
}

export function getTemplateById(id: string): ClipmartTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.id === id);
}

/** @deprecated use getTemplateById */
export function getTemplateByName(name: string): ClipmartTemplate | undefined {
  return BUILTIN_TEMPLATES.find(t => t.name === name);
}
