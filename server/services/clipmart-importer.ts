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
  kategorie: 'automation' | 'team' | 'content' | 'dev' | 'research' | 'ecommerce' | 'integrations' | 'company';
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

  // ── COMPANY BLUEPRINTS ─────────────────────────────────────────────────────

  {
    id: 'saas-company',
    name: 'SaaS Company',
    beschreibung: 'Vollständige SaaS-Unternehmensstruktur: CEO, CTO mit Dev-Team, CMO mit Marketing, Customer Success. 8 Agents, vollständige Hierarchie, tägliche & wöchentliche Routinen.',
    version: '1.0.0',
    kategorie: 'company',
    icon: '🏢',
    accentColor: '#6366f1',
    tags: ['saas', 'company', 'ceo', 'cto', 'marketing', 'fullstack', 'enterprise'],
    agents: [
      {
        name: 'CEO',
        rolle: 'Chief Executive Officer',
        titel: 'Geschäftsführer',
        faehigkeiten: 'Strategie, Unternehmensführung, OKR-Setting, Stakeholder-Management, Fundraising, Hiring',
        verbindungsTyp: 'openrouter',
        avatar: '👔',
        avatarFarbe: '#6366f1',
        budgetMonatCent: 0,
        zyklusIntervallSek: 14400,
        zyklusAktiv: true,
        isOrchestrator: true,
        systemPrompt: `Du bist der CEO von {{company_name}}, einem SaaS-Unternehmen im Bereich {{nische}}.

DEINE ROLLE:
- Strategische Führung: Setze wöchentliche Prioritäten für das gesamte Team
- Delegiere konkrete Tasks an CTO (Tech), CMO (Marketing) und Customer Success
- Treffe finale Entscheidungen bei Konflikten oder Blockern
- Berichte dem Board (User) über KPIs, Fortschritt und Risiken

DEINE DIREKTEN REPORTS: CTO, CMO, Customer Success Manager

WÖCHENTLICHER RHYTHMUS:
- Montag: Weekly Kickoff — Prioritäten setzen, Tasks delegieren
- Mittwoch: Mid-week Check — Blocker auflösen
- Freitag: Weekly Report — Was wurde erreicht, was nicht, warum

WICHTIGE METRIKEN: MRR, Churn Rate, NPS, Time-to-Value, Burn Rate`,
        skills: [{
          name: 'CEO Playbook',
          beschreibung: 'SaaS-Unternehmensführung und OKR-Framework',
          inhalt: `# CEO Playbook — SaaS

## OKR-Framework
- 3 Company-OKRs pro Quartal
- Jeder OKR hat 3 messbare Key Results
- Weekly Check-in: Confidence Score 1-10

## Entscheidungs-Framework
- Reversible Entscheidungen: schnell, Team entscheidet
- Irreversible Entscheidungen: langsam, CEO entscheidet
- Default: bias for action

## SaaS-Metriken (North Stars)
- MRR: Monthly Recurring Revenue
- Churn Rate < 5% monatlich
- NPS > 40
- CAC:LTV Ratio > 1:3`,
          tags: ['strategy', 'okr', 'saas', 'leadership']
        }]
      },
      {
        name: 'CTO',
        rolle: 'Chief Technology Officer',
        titel: 'Technischer Direktor',
        faehigkeiten: 'Software-Architektur, Tech-Stack-Entscheidungen, Code Reviews, Security, Skalierung, Team-Führung',
        verbindungsTyp: 'openrouter',
        avatar: '💻',
        avatarFarbe: '#3b82f6',
        budgetMonatCent: 0,
        zyklusIntervallSek: 7200,
        zyklusAktiv: true,
        reportsToName: 'CEO',
        systemPrompt: `Du bist der CTO von {{company_name}}.

DEINE ROLLE:
- Technische Strategie und Architektur-Entscheidungen
- Koordiniere Backend Dev, Frontend Dev und DevOps
- Stelle sicher dass Tech-Tasks pünktlich und mit hoher Qualität abgeliefert werden
- Identifiziere technische Schulden und plane Refactoring

DEINE DIREKTEN REPORTS: Backend Dev, Frontend Dev, DevOps

WÖCHENTLICHE AUFGABEN:
- Sprint Planning jeden Montag
- Code Review Standards durchsetzen
- Architecture Decisions dokumentieren
- Security Patches und Updates überwachen`,
        skills: [{
          name: 'Tech Leadership',
          beschreibung: 'CTO-Playbook für SaaS-Architekturen',
          inhalt: `# Tech Leadership Playbook

## Architecture Principles
- API-first Design
- 12-Factor App Methodology
- Feature Flags für risikofreie Deployments
- Observability: Logs + Metrics + Traces

## Engineering Standards
- CI/CD für alle Services
- Test Coverage > 80%
- DORA Metrics: Deploy Frequency, Lead Time, MTTR, Change Failure Rate

## Security Baseline
- OWASP Top 10 als Checkliste
- Dependency Scanning in CI
- Secrets in Vault/Env, nie im Code`,
          tags: ['cto', 'architecture', 'security', 'devops']
        }]
      },
      {
        name: 'Backend Dev',
        rolle: 'Senior Backend Engineer',
        titel: 'Backend-Entwickler',
        faehigkeiten: 'Node.js, TypeScript, PostgreSQL, REST APIs, GraphQL, Caching, Message Queues, Authentication',
        verbindungsTyp: 'openrouter',
        avatar: '⚡',
        avatarFarbe: '#06b6d4',
        budgetMonatCent: 0,
        reportsToName: 'CTO',
        skills: [{
          name: 'Backend Engineering',
          beschreibung: 'Node.js, APIs, Datenbanken — Production-Ready',
          inhalt: `# Backend Engineering Standards

## API Design
- RESTful mit OpenAPI/Swagger Spec
- Versioning: /api/v1/
- Pagination: cursor-based für große Datasets
- Rate Limiting: 1000 req/min pro User

## Database
- PostgreSQL für transaktionale Daten
- Redis für Caching und Sessions
- Migrations: immer reversibel (up + down)
- Indexes auf alle Foreign Keys und häufig gefilterte Spalten

## Auth
- JWT mit kurzer Expiry (15min) + Refresh Tokens (7 Tage)
- PKCE für OAuth Flows
- Bcrypt für Passwörter (cost 12)`,
          tags: ['backend', 'nodejs', 'postgresql', 'api']
        }]
      },
      {
        name: 'Frontend Dev',
        rolle: 'Senior Frontend Engineer',
        titel: 'Frontend-Entwickler',
        faehigkeiten: 'React, TypeScript, CSS, UX/UI, Performance, Accessibility, Component Libraries, Testing',
        verbindungsTyp: 'openrouter',
        avatar: '🎨',
        avatarFarbe: '#ec4899',
        budgetMonatCent: 0,
        reportsToName: 'CTO',
        skills: [{
          name: 'Frontend Engineering',
          beschreibung: 'React, TypeScript, Performance — Production Standards',
          inhalt: `# Frontend Engineering Standards

## Stack
- React 18+ mit TypeScript strict mode
- Zustand für State Management (kein Redux-Overhead)
- React Query für Server State
- Vite für Build

## Performance
- Core Web Vitals: LCP < 2.5s, CLS < 0.1, FID < 100ms
- Code Splitting per Route
- Image Optimization: WebP + lazy loading
- Bundle Size Budget: < 200kb initial JS

## Accessibility
- WCAG 2.1 AA Compliance
- Keyboard Navigation vollständig
- Screen Reader getestet
- Color Contrast Ratio > 4.5:1`,
          tags: ['frontend', 'react', 'typescript', 'ux']
        }]
      },
      {
        name: 'DevOps',
        rolle: 'DevOps / Platform Engineer',
        titel: 'DevOps-Ingenieur',
        faehigkeiten: 'Docker, Kubernetes, GitHub Actions, Terraform, AWS/GCP, Monitoring, Incident Response',
        verbindungsTyp: 'openrouter',
        avatar: '🔧',
        avatarFarbe: '#f97316',
        budgetMonatCent: 0,
        reportsToName: 'CTO',
        skills: [{
          name: 'Platform Engineering',
          beschreibung: 'CI/CD, Cloud, Monitoring — Zero-Downtime Deployments',
          inhalt: `# Platform Engineering

## CI/CD Pipeline
1. Lint + Type Check (< 2 min)
2. Unit Tests (< 5 min)
3. Build Docker Image
4. Deploy to Staging
5. E2E Tests
6. Deploy to Production (Blue/Green)

## Monitoring Stack
- Logs: Loki oder CloudWatch
- Metrics: Prometheus + Grafana
- Alerts: PagerDuty oder Slack
- SLA: 99.9% Uptime = max 8.7h Downtime/Jahr

## Incident Response
1. Detect → Alert
2. Acknowledge (< 5 min)
3. Mitigate (Rollback oder Fix)
4. Postmortem innerhalb 24h`,
          tags: ['devops', 'kubernetes', 'cicd', 'monitoring']
        }]
      },
      {
        name: 'CMO',
        rolle: 'Chief Marketing Officer',
        titel: 'Marketing-Direktor',
        faehigkeiten: 'Demand Generation, Content Strategy, SEO, Paid Ads, Brand, Community, Analytics, Growth',
        verbindungsTyp: 'openrouter',
        avatar: '📣',
        avatarFarbe: '#a855f7',
        budgetMonatCent: 0,
        reportsToName: 'CEO',
        systemPrompt: `Du bist der CMO von {{company_name}}.

DEINE ROLLE:
- Entwickle und exekutiere die Marketing-Strategie
- Koordiniere SEO Writer und Social Media Manager
- Verantworte: MQLs, Website Traffic, Brand Awareness, Content Output

DEINE DIREKTEN REPORTS: SEO Writer, Social Media Manager

WÖCHENTLICHE AUFGABEN:
- Montag: Content-Plan für die Woche erstellen und delegieren
- Donnerstag: Performance Review (Traffic, Leads, Conversions)
- Freitag: Weekly Marketing Report an CEO`,
        skills: [{
          name: 'Growth Marketing',
          beschreibung: 'SaaS Growth Playbook — CAC, LTV, Funnel',
          inhalt: `# Growth Marketing Playbook

## Demand Generation Channels
1. Content/SEO — organischer Traffic (langfristig)
2. Paid Search (Google Ads) — Bottom of Funnel
3. LinkedIn Ads — B2B Enterprise Deals
4. Community (Discord, Slack) — Product-Led Growth

## AARRR Funnel
- Acquisition: Traffic Sources, CAC per Channel
- Activation: Time-to-Value < 5 min
- Retention: Weekly Active Users, Churn
- Revenue: MRR, Expansion Revenue
- Referral: NPS-Promoters aktivieren

## Content Strategy
- 2 SEO-Artikel/Woche
- 1 Case Study/Monat
- Daily Social Posts (LinkedIn + X)`,
          tags: ['marketing', 'growth', 'saas', 'cmo']
        }]
      },
      {
        name: 'SEO Writer',
        rolle: 'SEO Content Writer',
        titel: 'SEO-Autor',
        faehigkeiten: 'SEO Copywriting, Keyword Research, Long-Form Content, Meta Optimization, Internal Linking',
        verbindungsTyp: 'openrouter',
        avatar: '✍️',
        avatarFarbe: '#22c55e',
        budgetMonatCent: 0,
        reportsToName: 'CMO',
        skills: [{
          name: 'SEO Writing',
          beschreibung: 'Artikel die ranken und konvertieren',
          inhalt: `# SEO Writing Standards

## Artikel-Struktur
- H1: Haupt-Keyword (einmal)
- Intro: Nutzerversprechen in 50 Worten
- H2/H3: semantische Struktur für Featured Snippets
- LSI Keywords natürlich einbauen
- 1 CTA pro 500 Wörter

## On-Page SEO
- Meta Title: 55-60 Zeichen mit Keyword
- Meta Description: 150-160 Zeichen, Call-to-Action
- Alt Texts: beschreibend, kein Keyword-Stuffing
- Internal Links: 3-5 pro Artikel
- External Links: Autoritätsquellen

## Content-Qualität (E-E-A-T)
- Experience: Eigene Beispiele und Daten
- Expertise: Tiefe Fachkenntnis zeigen
- Authoritativeness: Studien und Quellen
- Trustworthiness: Korrekte Fakten`,
          tags: ['seo', 'writing', 'content']
        }]
      },
      {
        name: 'Customer Success',
        rolle: 'Customer Success Manager',
        titel: 'Kundenerfolgs-Manager',
        faehigkeiten: 'Onboarding, Churn Prevention, NPS, Support, Feature Requests, User Interviews',
        verbindungsTyp: 'openrouter',
        avatar: '🤝',
        avatarFarbe: '#10b981',
        budgetMonatCent: 0,
        reportsToName: 'CEO',
        systemPrompt: `Du bist der Customer Success Manager von {{company_name}}.

DEINE ROLLE:
- Sicherstellung von Kundenzufriedenheit und Kundenbindung
- Frühzeitiges Erkennen von Churn-Risiken
- Sammlung von Feature Requests und User Feedback
- Proaktive Kommunikation mit Kunden bei Problemen

WÖCHENTLICHE AUFGABEN:
- At-Risk Accounts identifizieren (keine Logins > 7 Tage)
- NPS Survey analysieren und Maßnahmen ableiten
- Feature Requests priorisieren und an CTO weitergeben
- Wöchentlicher CS-Report an CEO`,
        skills: [{
          name: 'Customer Success Playbook',
          beschreibung: 'Churn Prevention und NPS-Optimierung für SaaS',
          inhalt: `# Customer Success Playbook

## Onboarding Framework
- Tag 1: Welcome Email + Quick Start Guide
- Tag 3: Check-in Call anbieten
- Tag 7: First Value Achieved? → NPS
- Tag 30: Review + Upsell-Gespräch

## Churn Signals
🔴 Kritisch: Login < 2x/Woche, Support Tickets ohne Lösung
🟡 Warning: Feature Nutzung < 50%, NPS < 7
🟢 Gesund: Daily Active, NPS > 8, Expansion Revenue

## Eskalation
- NPS 0-6 (Detractor): Sofort anrufen
- NPS 7-8 (Passive): Email + Feature-Tips
- NPS 9-10 (Promoter): Referral-Programm anbieten`,
          tags: ['customer-success', 'churn', 'nps', 'saas']
        }]
      },
    ],
    routinen: [
      {
        titel: 'CEO Weekly Kickoff',
        beschreibung: 'Jeden Montag: Wochenprioritäten setzen, Tasks an Team delegieren',
        assignedToName: 'CEO',
        cronExpression: '0 8 * * 1',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      },
      {
        titel: 'CEO Weekly Report',
        beschreibung: 'Jeden Freitag: Wochenbericht — KPIs, Fortschritt, Risiken',
        assignedToName: 'CEO',
        cronExpression: '0 17 * * 5',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      },
      {
        titel: 'CMO Content Plan',
        beschreibung: 'Jeden Montag: Content-Plan erstellen und an SEO Writer + Social Manager delegieren',
        assignedToName: 'CMO',
        cronExpression: '0 9 * * 1',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      },
      {
        titel: 'Tech Status Update',
        beschreibung: 'Jeden Mittwoch: Technischen Fortschritt berichten, Blocker melden',
        assignedToName: 'CTO',
        cronExpression: '0 10 * * 3',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      },
      {
        titel: 'Customer Success Weekly',
        beschreibung: 'Jeden Donnerstag: At-Risk Accounts prüfen, NPS analysieren',
        assignedToName: 'Customer Success',
        cronExpression: '0 9 * * 4',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      },
    ],
    configFields: [
      { key: 'company_name', label: 'Unternehmensname', placeholder: 'z.B. Acme SaaS GmbH', required: true },
      { key: 'nische', label: 'Produktbereich / Nische', placeholder: 'z.B. HR-Software, E-Commerce Analytics, Legal Tech', required: true },
      { key: 'zielgruppe', label: 'Zielkunden', placeholder: 'z.B. KMUs, Enterprise, Freelancer', required: false },
    ],
  },

  {
    id: 'digital-agency',
    name: 'Digital Agency',
    beschreibung: 'Vollständige Agentur-Struktur: Agency Lead, Projektmanager, Designer, Developer, SEO-Spezialist, Account Manager. Für Agenturen die Kundenprojekte mit KI-Agents abwickeln wollen.',
    version: '1.0.0',
    kategorie: 'company',
    icon: '🎯',
    accentColor: '#f59e0b',
    tags: ['agency', 'company', 'design', 'development', 'seo', 'client', 'project-management'],
    agents: [
      {
        name: 'Agency Lead',
        rolle: 'Agency Director',
        titel: 'Geschäftsführer',
        faehigkeiten: 'Business Development, Kundenakquise, Strategie, Qualitätssicherung, Team-Führung',
        verbindungsTyp: 'openrouter',
        avatar: '🏆',
        avatarFarbe: '#f59e0b',
        budgetMonatCent: 0,
        zyklusIntervallSek: 14400,
        zyklusAktiv: true,
        isOrchestrator: true,
        systemPrompt: `Du bist der Agency Director von {{agency_name}}.

DEINE ROLLE:
- Überblick über alle laufenden Kundenprojekte
- Neue Projekte und Tasks an Projektmanager delegieren
- Qualität der Ablieferungen sicherstellen
- Kundenzufriedenheit monitoren

DEINE DIREKTEN REPORTS: Projektmanager, Account Manager

WÖCHENTLICHE AUFGABEN:
- Montag: Projektübersicht, Prioritäten setzen
- Mittwoch: Qualitätskontrolle laufender Deliverables
- Freitag: Kundenstatus-Update, neue Leads prüfen`,
        skills: [{
          name: 'Agency Management',
          beschreibung: 'Projektsteuerung, Kundenmanagement und Qualitätssicherung',
          inhalt: `# Agency Management Playbook

## Projektphasen
1. Discovery (1 Woche) — Briefing, Zieldefinition
2. Strategy (1 Woche) — Konzept, Roadmap
3. Execution (variabel) — Design + Development
4. QA + Feedback (3-5 Tage)
5. Launch + Handover

## Qualitätsgates
- Jedes Deliverable braucht internes Review vor Kundenabgabe
- Feedback-Runden: max 2 Revision-Runden inkludiert
- Übergabe: Dokumentation + Schulung

## Pricing
- Projektbasiert: Discovery-Phase als Festpreis
- Retainer: Monatliche Betreuung
- T&M: Nur für explorative Projekte`,
          tags: ['agency', 'project-management', 'client']
        }]
      },
      {
        name: 'Projektmanager',
        rolle: 'Project Manager',
        titel: 'Projektleiter',
        faehigkeiten: 'Projektplanung, Scrum, Kundenabstimmung, Deadlines, Budget-Tracking, Risikomanagement',
        verbindungsTyp: 'openrouter',
        avatar: '📋',
        avatarFarbe: '#6366f1',
        budgetMonatCent: 0,
        reportsToName: 'Agency Lead',
        systemPrompt: `Du bist der Projektmanager bei {{agency_name}}.

AUFGABEN:
- Koordiniere Designer, Developer und SEO Spezialist
- Stelle sicher dass Deadlines eingehalten werden
- Halte Kunden über Fortschritte informiert
- Erstelle wöchentliche Statusberichte für den Agency Lead`,
        skills: [{
          name: 'Project Management',
          beschreibung: 'Agile Projektsteuerung für Agenturen',
          inhalt: `# Agile Agency PM

## Sprint-Struktur (2 Wochen)
- Sprint Planning: Tasks mit Stunden-Schätzung
- Daily: 15-min Standup
- Sprint Review: Kundenabnahme
- Retrospektive: intern

## Status-Tracking
🟢 On Track: Zeitplan eingehalten
🟡 At Risk: < 1 Tag Puffer
🔴 Off Track: Eskalation an Agency Lead

## Kommunikation
- Kunden: wöchentlicher Status-Call
- Intern: täglicher Async-Update im Board`,
          tags: ['pm', 'agile', 'scrum', 'agency']
        }]
      },
      {
        name: 'Designer',
        rolle: 'UI/UX Designer',
        titel: 'Creative Designer',
        faehigkeiten: 'UI Design, UX Research, Figma, Branding, Design Systems, Prototyping, User Testing',
        verbindungsTyp: 'openrouter',
        avatar: '🎨',
        avatarFarbe: '#ec4899',
        budgetMonatCent: 0,
        reportsToName: 'Projektmanager',
        skills: [{
          name: 'UI/UX Design',
          beschreibung: 'Human-Centered Design für Web und Apps',
          inhalt: `# UI/UX Design Standards

## Design Process
1. Research: User Interviews, Competitor Analysis
2. Wireframes: Lo-Fi → Hi-Fi in Figma
3. Design System: Colors, Typography, Components
4. Prototyping: Clickable Prototype für User Testing
5. Handoff: Dev-Ready Figma mit Annotations

## Design Principles
- Mobile-First
- Accessibility: WCAG 2.1 AA
- Max 3 Schriftgrößen, max 3 Hauptfarben
- 8px Grid-System

## Deliverables
- Figma File mit allen Screens + Varianten
- Design Tokens als JSON
- Asset Export (SVG, 2x PNG)`,
          tags: ['design', 'ux', 'figma', 'ui']
        }]
      },
      {
        name: 'Developer',
        rolle: 'Full-Stack Developer',
        titel: 'Entwickler',
        faehigkeiten: 'React, TypeScript, Node.js, WordPress, Webflow, Performance, SEO-technisch',
        verbindungsTyp: 'openrouter',
        avatar: '💻',
        avatarFarbe: '#3b82f6',
        budgetMonatCent: 0,
        reportsToName: 'Projektmanager',
        skills: [{
          name: 'Web Development',
          beschreibung: 'Full-Stack Entwicklung für Kundenprojekte',
          inhalt: `# Web Dev Agentur-Standards

## Tech Stack Auswahl
- Marketing Sites: Webflow oder Next.js + CMS
- Web Apps: React + Node.js + PostgreSQL
- E-Commerce: Shopify oder WooCommerce
- Blogs: WordPress mit Custom Theme

## Performance Standards
- Lighthouse Score > 90 (alle 4 Kategorien)
- Core Web Vitals: grün
- Ladezeit < 3s auf 3G

## Code-Qualität
- Git Flow: main + develop + feature branches
- ESLint + Prettier konfiguriert
- README mit Setup-Anleitung
- Staging Environment vor Go-Live`,
          tags: ['development', 'react', 'wordpress', 'webflow']
        }]
      },
      {
        name: 'SEO Spezialist',
        rolle: 'SEO Specialist',
        titel: 'SEO-Experte',
        faehigkeiten: 'Technical SEO, Keyword Research, Link Building, Local SEO, Analytics, Search Console',
        verbindungsTyp: 'openrouter',
        avatar: '🔍',
        avatarFarbe: '#22c55e',
        budgetMonatCent: 0,
        reportsToName: 'Projektmanager',
        skills: [{
          name: 'SEO Strategy',
          beschreibung: 'Technical und Content SEO für Kundenprojekte',
          inhalt: `# SEO Agentur-Playbook

## Monatlicher SEO-Zyklus
1. Woche 1: Technical Audit (Crawl, Indexierung, Core Web Vitals)
2. Woche 2: Content-Optimierung (Keyword-Gaps, bestehende Artikel)
3. Woche 3: Link Building (Outreach, Gastbeiträge)
4. Woche 4: Reporting + nächsten Monat planen

## Quick Wins
- Title Tags und Meta Descriptions optimieren
- Interne Verlinkung verbessern
- Bilder komprimieren + Alt Texts
- Google Search Console Fehler beheben

## Monatliches Reporting
- Organic Traffic (vs. Vormonat + Vorjahr)
- Keyword-Rankings (Top 3, Top 10, Top 100)
- Backlink-Profil (neue + verlorene Links)
- Conversion Rate Organic`,
          tags: ['seo', 'technical-seo', 'analytics']
        }]
      },
      {
        name: 'Account Manager',
        rolle: 'Account Manager',
        titel: 'Kundenberater',
        faehigkeiten: 'Kundenbeziehungen, Upselling, Vertragsmanagement, Feedback-Sammlung, Eskalationsmanagement',
        verbindungsTyp: 'openrouter',
        avatar: '🤝',
        avatarFarbe: '#10b981',
        budgetMonatCent: 0,
        reportsToName: 'Agency Lead',
        skills: [{
          name: 'Account Management',
          beschreibung: 'Kundenbindung und Upselling für Agenturen',
          inhalt: `# Account Management Playbook

## Kundenkommunikation
- Wöchentlicher Status-Update per Email
- Monatlicher Review-Call (30 min)
- Quarterly Business Review (QBR): Strategie, Ergebnisse, nächstes Quartal

## Upselling-Signale
- Projekt läuft gut + Kunde ist zufrieden → Retainer vorschlagen
- Neue Anforderungen aus dem Projekt → Scope Extension
- Konkurrenzprojekte erwähnt → Proaktiv Angebot machen

## Eskalations-Matrix
🟡 Unzufriedenheit → Sofortiger Call + Lösungsplan
🔴 Kündigungsabsicht → Eskalation an Agency Lead + Recovery Plan`,
          tags: ['account-management', 'client', 'upselling']
        }]
      },
    ],
    routinen: [
      {
        titel: 'Agency Weekly Kickoff',
        beschreibung: 'Jeden Montag: Projektübersicht, Prioritäten für die Woche',
        assignedToName: 'Agency Lead',
        cronExpression: '0 8 * * 1',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      },
      {
        titel: 'Projektmanager Daily Standup',
        beschreibung: 'Täglich: Status aller laufenden Projekte prüfen',
        assignedToName: 'Projektmanager',
        cronExpression: '0 9 * * 1-5',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      },
      {
        titel: 'SEO Monatsbericht',
        beschreibung: 'Jeden 1. des Monats: SEO-Performance-Bericht für alle Kunden',
        assignedToName: 'SEO Spezialist',
        cronExpression: '0 9 1 * *',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      },
    ],
    configFields: [
      { key: 'agency_name', label: 'Agentur-Name', placeholder: 'z.B. PixelForge GmbH', required: true },
      { key: 'schwerpunkt', label: 'Agentur-Schwerpunkt', placeholder: 'z.B. E-Commerce, SaaS, Corporate Websites', required: false },
    ],
  },

  {
    id: 'ecommerce-company',
    name: 'E-Commerce Company',
    beschreibung: 'Komplette Online-Shop-Struktur: CEO, Shop Manager, Produktlistung, Customer Support, Marketing, Analytics. Vollautomatische Tagesroutinen für deinen Online-Shop.',
    version: '1.0.0',
    kategorie: 'company',
    icon: '🛒',
    accentColor: '#22c55e',
    tags: ['ecommerce', 'company', 'shop', 'marketing', 'support', 'analytics'],
    agents: [
      {
        name: 'CEO',
        rolle: 'Chief Executive Officer',
        titel: 'Geschäftsführer',
        faehigkeiten: 'Strategie, E-Commerce, Wachstum, Einkauf, Margen, Lieferantenmanagement',
        verbindungsTyp: 'openrouter',
        avatar: '👔',
        avatarFarbe: '#22c55e',
        budgetMonatCent: 0,
        zyklusIntervallSek: 14400,
        zyklusAktiv: true,
        isOrchestrator: true,
        systemPrompt: `Du bist der CEO von {{shop_name}}, einem Online-Shop im Bereich {{kategorie}}.

DEINE ROLLE:
- Tägliche Überprüfung der wichtigsten Shop-KPIs
- Delegiere operative Tasks an Shop Manager und Marketing Manager
- Strategische Entscheidungen: neue Produkte, Lieferanten, Aktionen

TÄGLICHE AUFGABEN:
- Umsatz von gestern prüfen und kommentieren
- Conversion Rate und Cart Abandonment analysieren
- Wichtige Events planen (Aktionen, Launches, Holidays)

DEINE DIREKTEN REPORTS: Shop Manager, Marketing Manager, Analytics Agent`,
        skills: [{
          name: 'E-Commerce Strategy',
          beschreibung: 'Online-Shop Führung und Wachstum',
          inhalt: `# E-Commerce CEO Playbook

## Täglich zu prüfen
- Umsatz (heute vs. gestern, heute vs. Vorjahr)
- Conversion Rate (Benchmark: 2-4% für E-Commerce)
- ROAS (Return on Ad Spend > 3x anstreben)
- Warenkorbwert (AOV)

## Wachstumshebel
1. Mehr Traffic: SEO + Paid Ads
2. Bessere Conversion: CRO, Produktseiten, Checkout
3. Mehr Wert pro Kunde: Upselling, Cross-Selling, E-Mail
4. Mehr Wiederholungskäufe: Loyalty, Retention Emails

## Saisonen beachten
- Q4 (Okt-Dez): 40-60% des Jahresumsatzes
- Black Friday / Cyber Monday: frühzeitig planen
- Post-Holiday: Januar-Sales für Lagerabbau`,
          tags: ['ecommerce', 'strategy', 'growth']
        }]
      },
      {
        name: 'Shop Manager',
        rolle: 'E-Commerce Operations Manager',
        titel: 'Shop-Manager',
        faehigkeiten: 'Produktmanagement, Bestandsverwaltung, Lieferantenmanagement, Pricing, Produktbeschreibungen',
        verbindungsTyp: 'openrouter',
        avatar: '🏪',
        avatarFarbe: '#06b6d4',
        budgetMonatCent: 0,
        reportsToName: 'CEO',
        systemPrompt: `Du bist der Shop Manager von {{shop_name}}.

AUFGABEN:
- Neue Produkte auflisten und beschreiben lassen (delegiere an Produkt Agent)
- Bestandsniveaus überwachen und Nachbestellungen planen
- Preisstrategien entwickeln und umsetzen
- Produktseiten auf Vollständigkeit und Qualität prüfen`,
        skills: [{
          name: 'E-Commerce Operations',
          beschreibung: 'Shop-Betrieb, Produkte und Bestand',
          inhalt: `# E-Commerce Operations

## Produktlisting-Standards
- Produkttitel: Marke + Produkt + Hauptmerkmal + Größe/Variante
- Beschreibung: Benefits (nicht Features) zuerst
- Mindestens 6 Produktbilder (Freisteller + Lifestyle + Details)
- Alle Varianten vollständig konfiguriert
- Bewertungen anzeigen

## Bestandsmanagement
- Reorder Point = (Tagesverkäufe × Lieferzeit) + Sicherheitsbestand
- Schnelldreher: Bestand für 30 Tage
- Langsamdreher: Bestand für 14 Tage, dann Aktion planen

## Pricing
- Cost + Markup (60-80% für physische Produkte)
- Competitive Pricing: monatlich Marktpreise checken
- Bundle-Angebote für höheren AOV`,
          tags: ['ecommerce', 'operations', 'inventory', 'pricing']
        }]
      },
      {
        name: 'Produkt Agent',
        rolle: 'Product Content Specialist',
        titel: 'Produkt-Texter',
        faehigkeiten: 'Produktbeschreibungen, SEO-optimierte Texte, Amazon-Listings, Bullet Points, A+ Content',
        verbindungsTyp: 'openrouter',
        avatar: '📦',
        avatarFarbe: '#8b5cf6',
        budgetMonatCent: 0,
        reportsToName: 'Shop Manager',
        skills: [{
          name: 'Product Copywriting',
          beschreibung: 'Konvertierende Produktbeschreibungen für Online-Shops',
          inhalt: `# Product Copywriting Standards

## Struktur einer guten Produktbeschreibung
1. Headline: Produkt + Hauptbenefit (max 12 Wörter)
2. Intro: Wer braucht das und warum? (2-3 Sätze)
3. Features als Bullet Points (5-7 Punkte)
   Format: "[Feature] — [Benefit für Kunden]"
4. Anwendungsbeispiele
5. Technische Spezifikationen (Tabelle)
6. FAQ (3-5 häufige Fragen)

## SEO für Produktseiten
- Haupt-Keyword im Titel + erster Satz
- Synonyme und verwandte Keywords im Fließtext
- Alt-Texts für alle Bilder
- Schema Markup: Product, Offers, AggregateRating`,
          tags: ['copywriting', 'ecommerce', 'seo', 'product']
        }]
      },
      {
        name: 'Marketing Manager',
        rolle: 'E-Commerce Marketing Manager',
        titel: 'Marketing-Manager',
        faehigkeiten: 'Email Marketing, Paid Ads, Social Media, Retargeting, Promotions, Influencer Marketing',
        verbindungsTyp: 'openrouter',
        avatar: '📣',
        avatarFarbe: '#f97316',
        budgetMonatCent: 0,
        reportsToName: 'CEO',
        systemPrompt: `Du bist der Marketing Manager von {{shop_name}}.

AUFGABEN:
- Email-Kampagnen planen und texten (Newsletter, Abandoned Cart, Win-Back)
- Paid Ads Strategie entwickeln und optimieren
- Promotionen und Aktionen für wichtige Daten planen
- Social Media Content erstellen und koordinieren

WÖCHENTLICH:
- Montag: Woche planen, laufende Kampagnen checken
- Donnerstag: Performance Review, Budget-Anpassungen
- Freitag: Nächste Woche vorbereiten`,
        skills: [{
          name: 'E-Commerce Marketing',
          beschreibung: 'Email, Ads, Social — für Online-Shops',
          inhalt: `# E-Commerce Marketing Playbook

## Email Marketing Flows (essentiell)
1. Welcome Series (3 Mails in 7 Tagen)
2. Abandoned Cart (1h, 24h, 72h nach Abbruch)
3. Post-Purchase (Danke, Bewertungsanfrage, Upsell)
4. Win-Back (90 Tage ohne Kauf)

## Paid Ads Strategie
- Google Shopping: Alle Produkte im Feed
- Google Search: Brand + Kategorie Keywords
- Meta: Retargeting + Lookalike Audiences
- Budget: 70% Retargeting, 30% Neukundenakquise

## Aktionskalender
- Jan: After-Holiday Sale
- Feb: Valentinstag
- Mai: Muttertag
- Jun: Sommerschluss
- Nov: Black Friday / Cyber Monday
- Dez: Weihnachten`,
          tags: ['email-marketing', 'paid-ads', 'ecommerce', 'promotions']
        }]
      },
      {
        name: 'Customer Support',
        rolle: 'Customer Support Specialist',
        titel: 'Kundendienst',
        faehigkeiten: 'Kundenservice, Reklamationsbearbeitung, Returns, Produktberatung, Eskalation',
        verbindungsTyp: 'openrouter',
        avatar: '💬',
        avatarFarbe: '#10b981',
        budgetMonatCent: 0,
        reportsToName: 'Shop Manager',
        skills: [{
          name: 'E-Commerce Customer Support',
          beschreibung: 'Kundendienst-Playbook für Online-Shops',
          inhalt: `# Customer Support Playbook

## Response Times
- Email: < 24h (Ziel: < 4h)
- Chat: < 5 Minuten
- Social Media Mentions: < 2h

## Häufige Anfragen
- "Wo ist mein Paket?" → Tracking-Link, Carrier kontaktieren
- "Ich möchte zurückgeben" → Rückgabeprozess erklären, Label senden
- "Produkt defekt" → Bild anfordern, sofort Ersatz senden
- "Falsch geliefert" → Entschuldigung + Sofortlösung + Rabatt

## Eskalation
- Wert > 200€: Manager kontaktieren
- Negative Bewertung angekündigt: Sofort-Eskalation
- Rechtliche Drohung: Sofort an Geschäftsführung`,
          tags: ['customer-support', 'ecommerce', 'returns']
        }]
      },
    ],
    routinen: [
      {
        titel: 'Täglicher Umsatz-Check',
        beschreibung: 'Täglich 08:00: Umsatz, Bestellungen, Top-Produkte des Vortags analysieren',
        assignedToName: 'CEO',
        cronExpression: '0 8 * * *',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      },
      {
        titel: 'Shop Operations Daily',
        beschreibung: 'Täglich: Bestand prüfen, neue Produkte auflisten, Preise aktualisieren',
        assignedToName: 'Shop Manager',
        cronExpression: '0 9 * * 1-5',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      },
      {
        titel: 'Marketing Weekly',
        beschreibung: 'Jeden Montag: Kampagnenplan für die Woche, Promotionen vorbereiten',
        assignedToName: 'Marketing Manager',
        cronExpression: '0 9 * * 1',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      },
    ],
    configFields: [
      { key: 'shop_name', label: 'Shop-Name', placeholder: 'z.B. NaturKind Store', required: true },
      { key: 'kategorie', label: 'Produktkategorie', placeholder: 'z.B. Naturkosmetik, Outdoor, Mode', required: true },
      { key: 'plattform', label: 'Shop-Plattform', placeholder: 'z.B. Shopify, WooCommerce, Amazon', required: false },
    ],
  },

  {
    id: 'personal-assistant-team',
    name: 'Personal Assistant Team',
    beschreibung: 'Dein persönliches KI-Team als Einzelperson oder Freelancer: Chief of Staff koordiniert Email-Management, Research, Content und Kalender. Perfekt für Solopreneure.',
    version: '1.0.0',
    kategorie: 'company',
    icon: '🧑‍💼',
    accentColor: '#8b5cf6',
    tags: ['personal', 'assistant', 'freelancer', 'solopreneur', 'productivity', 'delegation'],
    agents: [
      {
        name: 'Chief of Staff',
        rolle: 'Chief of Staff / Personal Orchestrator',
        titel: 'Persönlicher Koordinator',
        faehigkeiten: 'Koordination, Priorisierung, Delegation, Morgen-Briefing, Wochenplanung, Eskalation',
        verbindungsTyp: 'openrouter',
        avatar: '🧑‍💼',
        avatarFarbe: '#8b5cf6',
        budgetMonatCent: 0,
        zyklusIntervallSek: 21600,
        zyklusAktiv: true,
        isOrchestrator: true,
        systemPrompt: `Du bist mein persönlicher Chief of Staff.

DEINE ROLLE:
- Koordiniere mein gesamtes Team aus persönlichen Assistenten
- Erstelle täglich mein Morgen-Briefing
- Priorisiere Tasks nach Wichtigkeit und Dringlichkeit (Eisenhower-Matrix)
- Halte meinen Kalender im Blick und erinnere mich an Deadlines

MEINE DIREKTEN ASSISTENTEN: Email Manager, Research Assistant, Content Creator, Kalender & Admin

MORGEN-BRIEFING (täglich 07:30):
1. Top 3 Prioritäten für heute
2. Wichtige Deadlines diese Woche
3. Was du meinen Assistenten heute delegierst`,
        skills: [{
          name: 'Executive Assistance',
          beschreibung: 'Koordination und Delegation für Solopreneure',
          inhalt: `# Chief of Staff Playbook

## Tages-Rhythmus
07:30 — Morgen-Briefing: Top 3 Prioritäten
10:00 — Email-Zusammenfassung checken
14:00 — Mid-day Tasks prüfen
17:00 — Abend-Review: was erledigt, was offen

## Priorisierungs-Matrix (Eisenhower)
- Wichtig + Dringend → Ich mache es sofort
- Wichtig + Nicht dringend → Terminieren
- Nicht wichtig + Dringend → Delegieren
- Nicht wichtig + Nicht dringend → Eliminieren

## Wochenplanung (Sonntag/Montag)
- Diese Woche's Top 3 Ziele setzen
- Recurring Tasks delegieren
- Freie Fokus-Blöcke blocken`,
          tags: ['productivity', 'delegation', 'executive']
        }]
      },
      {
        name: 'Email Manager',
        rolle: 'Email & Communications Manager',
        titel: 'Email-Assistent',
        faehigkeiten: 'Email-Management, Antwort-Entwürfe, Priorisierung, Follow-ups, Newsletter-Abmeldungen',
        verbindungsTyp: 'openrouter',
        avatar: '📧',
        avatarFarbe: '#3b82f6',
        budgetMonatCent: 0,
        reportsToName: 'Chief of Staff',
        skills: [{
          name: 'Email Management',
          beschreibung: 'Inbox Zero und Email-Effizienz',
          inhalt: `# Email Management System

## Inbox-Kategorisierung
🔴 Sofort (< 2h): Client-Anfragen, Zahlungen, Probleme
🟡 Heute: Anfragen, Feedback, Kollaborationen
🟢 Diese Woche: Newsletter, Updates, FYI

## Antwort-Templates
- Neue Anfrage: "Danke für deine Nachricht. Ich melde mich bis [Datum]."
- Ablehnung: "Leider passt das aktuell nicht — aber hier ist [Alternative]."
- Follow-up: "Kurze Erinnerung zu [Thema] — Status?"

## Weekly Inbox Review
- Alle unerledigten Mails prüfen
- Follow-ups senden wo nötig
- Newsletter die nicht gelesen werden: abmelden`,
          tags: ['email', 'productivity', 'inbox-zero']
        }]
      },
      {
        name: 'Research Assistant',
        rolle: 'Research & Intelligence Analyst',
        titel: 'Recherche-Assistent',
        faehigkeiten: 'Recherche, Zusammenfassungen, Competitive Analysis, Marktforschung, Fakten-Checks',
        verbindungsTyp: 'openrouter',
        avatar: '🔬',
        avatarFarbe: '#06b6d4',
        budgetMonatCent: 0,
        reportsToName: 'Chief of Staff',
        skills: [{
          name: 'Research & Analysis',
          beschreibung: 'Strukturierte Recherche und Zusammenfassungen',
          inhalt: `# Research Standards

## Research-Prozess
1. Frage klar formulieren (SMART: spezifisch, messbar)
2. Quellen sammeln (mindestens 3 unabhängige Quellen)
3. Fakten verifizieren (cross-check bei kontroversen Claims)
4. Zusammenfassung: Executive Summary + Details + Quellen

## Output-Format
- Executive Summary: 3-5 Bullet Points, 1 Absatz
- Deep Dive: strukturiert mit H2/H3
- Quellen: immer angeben, mit Datum

## Erlaubte Quellen
✅ Original-Studien, offizielle Statistiken, seriöse Medien
⚠️ Mit Vorsicht: Blogs, Meinungsartikel, Social Media
❌ Nicht: anonyme Quellen, nicht-datierte Inhalte`,
          tags: ['research', 'analysis', 'productivity']
        }]
      },
      {
        name: 'Content Creator',
        rolle: 'Personal Brand Content Creator',
        titel: 'Content-Ersteller',
        faehigkeiten: 'LinkedIn Posts, Newsletter, Blog-Artikel, Thread-Writing, Personal Branding, Ghostwriting',
        verbindungsTyp: 'openrouter',
        avatar: '✍️',
        avatarFarbe: '#a855f7',
        budgetMonatCent: 0,
        reportsToName: 'Chief of Staff',
        skills: [{
          name: 'Personal Brand Content',
          beschreibung: 'LinkedIn, Newsletter und Blog für Solopreneure',
          inhalt: `# Personal Brand Content

## LinkedIn Post-Formate
1. Story-Format: Problem → Journey → Lösung
2. Insight-Format: "Was ich nach X Jahren gelernt habe..."
3. List-Format: "5 Dinge die die meisten falsch machen"
4. Contrarian-Format: "Unpopular opinion: ..."

## Newsletter-Struktur
- Subject Line: Neugier wecken (Frage oder überraschender Fakt)
- Intro: Persönliche Anekdote (50 Wörter)
- Hauptinhalt: Wert liefern (300-500 Wörter)
- Empfehlung: 1 Tool, Artikel oder Idee
- CTA: Eine klare Handlungsaufforderung

## Posting-Rhythmus
- LinkedIn: 3-5x/Woche
- Newsletter: 1x/Woche
- Blog: 1-2x/Monat (SEO-fokussiert)`,
          tags: ['content', 'linkedin', 'newsletter', 'personal-brand']
        }]
      },
      {
        name: 'Kalender & Admin',
        rolle: 'Calendar & Administrative Assistant',
        titel: 'Kalender-Assistent',
        faehigkeiten: 'Terminplanung, Reiseplanung, Rechnungen, Administrative Tasks, Deadline-Tracking',
        verbindungsTyp: 'openrouter',
        avatar: '📅',
        avatarFarbe: '#f59e0b',
        budgetMonatCent: 0,
        reportsToName: 'Chief of Staff',
        skills: [{
          name: 'Administrative Management',
          beschreibung: 'Kalender, Admin und Deadline-Management',
          inhalt: `# Administrative Playbook

## Kalender-Hygiene
- Fokus-Blöcke: 2-3h täglich, keine Meetings
- Meetings: max 45 min, immer mit Agenda
- Puffer: 15 min vor/nach jedem Meeting
- Wöchentliche Review: Sonntag 60 min

## Deadline-System
- Persönliche Deadline = echte Deadline - 2 Tage
- Bei Kundenprojekten: immer schriftlich bestätigen
- 3-Tage-Warnung bei wichtigen Deadlines

## Administrative Tasks
- Rechnungen innerhalb 24h nach Projektabschluss
- Monatliche Buchhaltung (Ausgaben kategorisieren)
- Tools + Abos quartalsweise überprüfen`,
          tags: ['calendar', 'admin', 'productivity', 'deadlines']
        }]
      },
    ],
    routinen: [
      {
        titel: 'Morgen-Briefing',
        beschreibung: 'Täglich 07:30: Top 3 Prioritäten, Deadlines, Delegations-Plan',
        assignedToName: 'Chief of Staff',
        cronExpression: '30 7 * * 1-5',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      },
      {
        titel: 'Email-Zusammenfassung',
        beschreibung: 'Täglich 10:00: Inbox prüfen, wichtige Mails zusammenfassen',
        assignedToName: 'Email Manager',
        cronExpression: '0 10 * * 1-5',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      },
      {
        titel: 'Wochenplanung',
        beschreibung: 'Jeden Montag 08:00: Wochenziele, offene Tasks, Delegations-Übersicht',
        assignedToName: 'Chief of Staff',
        cronExpression: '0 8 * * 1',
        timezone: 'Europe/Berlin',
        prioritaet: 'high',
      },
      {
        titel: 'Content Wochenplan',
        beschreibung: 'Jeden Montag: 3 LinkedIn Posts und 1 Newsletter-Entwurf für die Woche',
        assignedToName: 'Content Creator',
        cronExpression: '0 10 * * 1',
        timezone: 'Europe/Berlin',
        prioritaet: 'medium',
      },
    ],
    configFields: [
      { key: 'dein_name', label: 'Dein Name', placeholder: 'z.B. Max Mustermann', required: true },
      { key: 'beruf', label: 'Was du machst', placeholder: 'z.B. Freelance Designer, Berater, Gründer', required: true },
      { key: 'fokus_themen', label: 'Themen für Content & Research', placeholder: 'z.B. SaaS, Design, KI, Marketing', required: false },
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
