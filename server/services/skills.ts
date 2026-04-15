// Skills Service - Verwaltet Agenten-Fähigkeiten und Skill-Matching

import { db } from '../db/client.js';
import { experten, aufgaben, ziele } from '../db/schema.js';
import { eq, and, sql } from 'drizzle-orm';

export interface Skill {
  id: string;
  name: string;
  description: string;
  category: string;
  level: 'basic' | 'intermediate' | 'advanced' | 'expert';
  keywords: string[];
}

export interface AgentSkill {
  agentId: string;
  skillId: string;
  proficiency: number; // 0-100
  lastUsedAt: string | null;
}

export interface SkillMatch {
  skill: Skill;
  matchScore: number;
  agentId?: string;
  agentName?: string;
  proficiency?: number;
}

export class SkillsService {
  private skillsCache: Map<string, Skill> = new Map();

  /**
   * Get all available skills
   * Expanded library inspired by skills.sh — 80+ skills across 12 categories
   */
  async getAllSkills(): Promise<Skill[]> {
    const defaultSkills: Skill[] = [

      // ── Development: Core Languages ───────────────────────────────────────
      {
        id: 'skill-dev-js',
        name: 'JavaScript Development',
        description: 'JavaScript & TypeScript Entwicklung, Node.js, ES Modules, async/await',
        category: 'Development',
        level: 'advanced',
        keywords: ['javascript', 'typescript', 'js', 'ts', 'node', 'nodejs', 'npm', 'es6'],
      },
      {
        id: 'skill-dev-python',
        name: 'Python Development',
        description: 'Python Programmierung, Scripting, Automatisierung, Bibliotheken',
        category: 'Development',
        level: 'advanced',
        keywords: ['python', 'py', 'scripting', 'automation', 'pip', 'flask', 'fastapi', 'django'],
      },
      {
        id: 'skill-dev-go',
        name: 'Go Development',
        description: 'Go (Golang) für performante Backend-Dienste und CLI-Tools',
        category: 'Development',
        level: 'intermediate',
        keywords: ['go', 'golang', 'goroutine', 'backend', 'microservice'],
      },
      {
        id: 'skill-dev-rust',
        name: 'Rust Development',
        description: 'Rust für systemnahe, sichere und hochperformante Anwendungen',
        category: 'Development',
        level: 'advanced',
        keywords: ['rust', 'cargo', 'systems', 'performance', 'wasm', 'webassembly'],
      },
      {
        id: 'skill-dev-java',
        name: 'Java / Kotlin Development',
        description: 'Java und Kotlin für Enterprise-Apps, Spring Boot, Android',
        category: 'Development',
        level: 'intermediate',
        keywords: ['java', 'kotlin', 'spring', 'springboot', 'jvm', 'android', 'maven'],
      },
      {
        id: 'skill-dev-php',
        name: 'PHP Development',
        description: 'PHP Backend-Entwicklung, Laravel, WordPress, APIs',
        category: 'Development',
        level: 'intermediate',
        keywords: ['php', 'laravel', 'wordpress', 'composer', 'symfony'],
      },
      {
        id: 'skill-dev-csharp',
        name: 'C# / .NET Development',
        description: 'C# und .NET für Enterprise-Software, APIs und Desktopanwendungen',
        category: 'Development',
        level: 'intermediate',
        keywords: ['csharp', 'c#', 'dotnet', '.net', 'aspnet', 'azure', 'unity'],
      },
      {
        id: 'skill-dev-api',
        name: 'API Design',
        description: 'REST, GraphQL und gRPC API Design, OpenAPI/Swagger Dokumentation',
        category: 'Development',
        level: 'advanced',
        keywords: ['api', 'rest', 'restful', 'graphql', 'grpc', 'openapi', 'swagger', 'endpoint'],
      },
      {
        id: 'skill-dev-testing',
        name: 'Testing & QA',
        description: 'Unit, Integration und E2E Tests, TDD, Testautomatisierung',
        category: 'Development',
        level: 'intermediate',
        keywords: ['testing', 'qa', 'unit test', 'integration test', 'e2e', 'jest', 'vitest', 'pytest', 'quality'],
      },
      {
        id: 'skill-dev-refactoring',
        name: 'Code Refactoring',
        description: 'Code-Qualität verbessern, technische Schulden abbauen, Clean Code',
        category: 'Development',
        level: 'advanced',
        keywords: ['refactor', 'clean code', 'code quality', 'technical debt', 'review', 'pattern'],
      },

      // ── Frontend ──────────────────────────────────────────────────────────
      {
        id: 'skill-fe-react',
        name: 'React Development',
        description: 'React, Hooks, State Management (Zustand/Redux), Next.js, Komponenten-Architektur',
        category: 'Frontend',
        level: 'advanced',
        keywords: ['react', 'jsx', 'hooks', 'nextjs', 'next.js', 'redux', 'zustand', 'component'],
      },
      {
        id: 'skill-fe-vue',
        name: 'Vue.js Development',
        description: 'Vue 3, Composition API, Nuxt.js, Pinia State Management',
        category: 'Frontend',
        level: 'advanced',
        keywords: ['vue', 'vuejs', 'nuxt', 'pinia', 'composition api', 'vite'],
      },
      {
        id: 'skill-fe-svelte',
        name: 'Svelte / SvelteKit',
        description: 'Svelte und SvelteKit für performante, reaktive UIs ohne Virtual DOM',
        category: 'Frontend',
        level: 'intermediate',
        keywords: ['svelte', 'sveltekit', 'frontend', 'reactive'],
      },
      {
        id: 'skill-fe-reactnative',
        name: 'React Native / Expo',
        description: 'Cross-Platform Mobile Apps mit React Native und Expo',
        category: 'Frontend',
        level: 'advanced',
        keywords: ['react native', 'expo', 'mobile', 'ios', 'android', 'cross-platform', 'app'],
      },
      {
        id: 'skill-fe-swiftui',
        name: 'SwiftUI / iOS Development',
        description: 'Native iOS/macOS Apps mit SwiftUI und Swift',
        category: 'Frontend',
        level: 'intermediate',
        keywords: ['swiftui', 'swift', 'ios', 'macos', 'apple', 'xcode'],
      },
      {
        id: 'skill-fe-css',
        name: 'CSS & Styling',
        description: 'CSS, Tailwind, Sass, Animations, Responsive Design, Glassmorphism',
        category: 'Frontend',
        level: 'advanced',
        keywords: ['css', 'tailwind', 'sass', 'scss', 'styling', 'animation', 'responsive'],
      },
      {
        id: 'skill-fe-accessibility',
        name: 'Web Accessibility (a11y)',
        description: 'WCAG-konforme, barrierefreie Webanwendungen',
        category: 'Frontend',
        level: 'intermediate',
        keywords: ['accessibility', 'a11y', 'wcag', 'aria', 'screen reader', 'barrierefrei'],
      },
      {
        id: 'skill-fe-performance',
        name: 'Web Performance',
        description: 'Core Web Vitals, Lazy Loading, Bundle Optimization, Lighthouse',
        category: 'Frontend',
        level: 'advanced',
        keywords: ['performance', 'lighthouse', 'core web vitals', 'optimization', 'bundle', 'lazy loading'],
      },

      // ── Backend & Architecture ─────────────────────────────────────────────
      {
        id: 'skill-be-nestjs',
        name: 'NestJS',
        description: 'Enterprise Node.js Backend-Framework, Decorators, Dependency Injection',
        category: 'Backend',
        level: 'advanced',
        keywords: ['nestjs', 'nest', 'typescript backend', 'decorator', 'di', 'microservice'],
      },
      {
        id: 'skill-be-architecture',
        name: 'Software Architecture',
        description: 'System Design, Microservices, Event-Driven, DDD, CQRS, Clean Architecture',
        category: 'Backend',
        level: 'expert',
        keywords: ['architecture', 'system design', 'microservice', 'ddd', 'cqrs', 'event-driven', 'design pattern'],
      },
      {
        id: 'skill-be-realtime',
        name: 'Real-time Systems',
        description: 'WebSockets, Server-Sent Events, Pub/Sub, Message Queues (Redis, RabbitMQ)',
        category: 'Backend',
        level: 'advanced',
        keywords: ['websocket', 'realtime', 'sse', 'pubsub', 'rabbitmq', 'redis pub', 'socket.io'],
      },

      // ── DevOps & Cloud ─────────────────────────────────────────────────────
      {
        id: 'skill-devops-docker',
        name: 'Docker & Containerization',
        description: 'Docker, Docker Compose, Container-Optimierung und Multi-Stage Builds',
        category: 'DevOps',
        level: 'intermediate',
        keywords: ['docker', 'container', 'dockerfile', 'compose', 'registry', 'image'],
      },
      {
        id: 'skill-devops-kubernetes',
        name: 'Kubernetes (K8s)',
        description: 'Kubernetes Orchestrierung, Helm Charts, Deployment Strategien',
        category: 'DevOps',
        level: 'advanced',
        keywords: ['kubernetes', 'k8s', 'kubectl', 'helm', 'pod', 'deployment', 'service', 'ingress'],
      },
      {
        id: 'skill-devops-ci',
        name: 'CI/CD Pipelines',
        description: 'GitHub Actions, GitLab CI, Jenkins, automatisierte Test- und Deploy-Pipelines',
        category: 'DevOps',
        level: 'intermediate',
        keywords: ['ci/cd', 'cicd', 'github actions', 'gitlab ci', 'jenkins', 'pipeline', 'workflow'],
      },
      {
        id: 'skill-cloud-aws',
        name: 'AWS Cloud',
        description: 'Amazon Web Services: EC2, S3, Lambda, RDS, CloudFormation, IAM',
        category: 'DevOps',
        level: 'advanced',
        keywords: ['aws', 'amazon', 'ec2', 's3', 'lambda', 'cloudformation', 'iam', 'rds'],
      },
      {
        id: 'skill-cloud-azure',
        name: 'Microsoft Azure',
        description: 'Azure Cloud Services: AI, Compute, Storage, Kubernetes, Deployment',
        category: 'DevOps',
        level: 'advanced',
        keywords: ['azure', 'microsoft', 'azure ai', 'azure compute', 'azure storage', 'aks'],
      },
      {
        id: 'skill-cloud-gcp',
        name: 'Google Cloud Platform',
        description: 'GCP: Cloud Run, BigQuery, Firebase, Vertex AI, GKE',
        category: 'DevOps',
        level: 'intermediate',
        keywords: ['gcp', 'google cloud', 'cloud run', 'bigquery', 'vertex ai', 'gke'],
      },
      {
        id: 'skill-cloud-vercel',
        name: 'Vercel / Netlify Deployment',
        description: 'Edge Deployment, Serverless Functions, Preview Environments',
        category: 'DevOps',
        level: 'basic',
        keywords: ['vercel', 'netlify', 'deploy', 'serverless', 'edge', 'preview'],
      },
      {
        id: 'skill-cloud-firebase',
        name: 'Firebase',
        description: 'Firebase Auth, Firestore, Realtime DB, Cloud Functions, Hosting',
        category: 'DevOps',
        level: 'intermediate',
        keywords: ['firebase', 'firestore', 'auth', 'cloud functions', 'hosting', 'realtime database'],
      },
      {
        id: 'skill-cloud-monitoring',
        name: 'Monitoring & Observability',
        description: 'Logs, Metrics, Tracing, Grafana, Prometheus, Sentry, Datadog',
        category: 'DevOps',
        level: 'intermediate',
        keywords: ['monitoring', 'observability', 'grafana', 'prometheus', 'sentry', 'logging', 'tracing', 'datadog'],
      },

      // ── Database ───────────────────────────────────────────────────────────
      {
        id: 'skill-db-postgres',
        name: 'PostgreSQL',
        description: 'PostgreSQL Datenbankdesign, komplexe Queries, Performance-Optimierung',
        category: 'Database',
        level: 'advanced',
        keywords: ['postgresql', 'postgres', 'psql', 'sql', 'database', 'query', 'index'],
      },
      {
        id: 'skill-db-supabase',
        name: 'Supabase',
        description: 'Supabase als Backend-as-a-Service: Auth, Realtime, Storage, Edge Functions',
        category: 'Database',
        level: 'intermediate',
        keywords: ['supabase', 'postgres', 'realtime', 'rls', 'row level security', 'baas'],
      },
      {
        id: 'skill-db-mongodb',
        name: 'MongoDB / NoSQL',
        description: 'MongoDB, Mongoose, NoSQL Datenbankdesign, Aggregation Pipeline',
        category: 'Database',
        level: 'intermediate',
        keywords: ['mongodb', 'nosql', 'mongoose', 'document db', 'aggregation'],
      },
      {
        id: 'skill-db-redis',
        name: 'Redis / Caching',
        description: 'Redis für Caching, Session Storage, Rate Limiting, Pub/Sub',
        category: 'Database',
        level: 'intermediate',
        keywords: ['redis', 'cache', 'caching', 'session', 'rate limit', 'key-value'],
      },
      {
        id: 'skill-db-sqlite',
        name: 'SQLite / Drizzle ORM',
        description: 'Leichtgewichtige Datenbanken, Drizzle ORM, Turso, lokale Persistenz',
        category: 'Database',
        level: 'intermediate',
        keywords: ['sqlite', 'drizzle', 'orm', 'turso', 'local database', 'embedded db'],
      },
      {
        id: 'skill-db-design',
        name: 'Database Design & Migrations',
        description: 'Datenbankschema-Design, Normalisierung, Migrations-Strategien',
        category: 'Database',
        level: 'advanced',
        keywords: ['schema', 'migration', 'erd', 'normalization', 'relation', 'table design'],
      },

      // ── AI & Machine Learning ──────────────────────────────────────────────
      {
        id: 'skill-ai-prompt',
        name: 'Prompt Engineering',
        description: 'Effektive Prompts für LLMs, Few-Shot Learning, Chain-of-Thought',
        category: 'AI/ML',
        level: 'advanced',
        keywords: ['prompt', 'prompt engineering', 'llm', 'chain of thought', 'few-shot', 'gpt', 'claude'],
      },
      {
        id: 'skill-ai-rag',
        name: 'RAG & Vector Search',
        description: 'Retrieval-Augmented Generation, Embeddings, Vektordatenbanken (Pinecone, Weaviate)',
        category: 'AI/ML',
        level: 'advanced',
        keywords: ['rag', 'retrieval', 'embedding', 'vector', 'pinecone', 'weaviate', 'semantic search'],
      },
      {
        id: 'skill-ai-mlops',
        name: 'MLOps & Model Deployment',
        description: 'ML-Modelle deployen, fine-tunen und in Production bringen',
        category: 'AI/ML',
        level: 'advanced',
        keywords: ['mlops', 'model', 'fine-tuning', 'training', 'huggingface', 'deployment', 'inference'],
      },
      {
        id: 'skill-ai-agents',
        name: 'AI Agent Development',
        description: 'Autonome AI-Agenten, Tool-Use, Multi-Agent-Systeme, LangChain/LangGraph',
        category: 'AI/ML',
        level: 'expert',
        keywords: ['agent', 'autonomous', 'langchain', 'langgraph', 'tool use', 'function calling', 'mcp'],
      },
      {
        id: 'skill-ai-image',
        name: 'AI Image Generation',
        description: 'Stable Diffusion, DALL-E, Midjourney, ComfyUI, Bild-zu-Bild',
        category: 'AI/ML',
        level: 'intermediate',
        keywords: ['image generation', 'stable diffusion', 'dalle', 'midjourney', 'comfyui', 'flux', 'image ai'],
      },
      {
        id: 'skill-ai-video',
        name: 'AI Video Generation',
        description: 'KI-generierte Videos, Sora, Runway, Kling, Video-Editing mit AI',
        category: 'AI/ML',
        level: 'intermediate',
        keywords: ['video generation', 'ai video', 'sora', 'runway', 'kling', 'luma', 'video ai'],
      },
      {
        id: 'skill-ai-analysis',
        name: 'Data Science & ML',
        description: 'Machine Learning, statistische Modelle, Pandas, scikit-learn, PyTorch',
        category: 'AI/ML',
        level: 'advanced',
        keywords: ['machine learning', 'ml', 'sklearn', 'pytorch', 'tensorflow', 'pandas', 'numpy', 'statistics'],
      },

      // ── Security ───────────────────────────────────────────────────────────
      {
        id: 'skill-sec-audit',
        name: 'Security Audit',
        description: 'Sicherheitsanalyse, OWASP Top 10, Code-Reviews auf Vulnerabilities',
        category: 'Security',
        level: 'expert',
        keywords: ['security', 'audit', 'owasp', 'vulnerability', 'code review', 'cve'],
      },
      {
        id: 'skill-sec-pentest',
        name: 'Penetration Testing',
        description: 'Ethisches Hacking, Penetrationstests, Bug Bounty, CTF',
        category: 'Security',
        level: 'expert',
        keywords: ['pentest', 'penetration test', 'ethical hacking', 'bug bounty', 'ctf', 'exploit'],
      },
      {
        id: 'skill-sec-auth',
        name: 'Authentication & Authorization',
        description: 'OAuth2, JWT, SSO, RBAC, Zero Trust, Auth-Implementierungen',
        category: 'Security',
        level: 'advanced',
        keywords: ['auth', 'oauth', 'jwt', 'sso', 'rbac', 'authentication', 'authorization', 'better-auth'],
      },
      {
        id: 'skill-sec-crypto',
        name: 'Cryptography',
        description: 'Verschlüsselung, Hashing, TLS/SSL, Key Management',
        category: 'Security',
        level: 'advanced',
        keywords: ['crypto', 'encryption', 'hash', 'tls', 'ssl', 'key management', 'aes', 'rsa'],
      },
      {
        id: 'skill-sec-compliance',
        name: 'Compliance & DSGVO',
        description: 'DSGVO/GDPR, SOC2, ISO 27001, Datenschutz-Implementierung',
        category: 'Security',
        level: 'advanced',
        keywords: ['dsgvo', 'gdpr', 'compliance', 'datenschutz', 'soc2', 'iso 27001', 'privacy'],
      },

      // ── Design ─────────────────────────────────────────────────────────────
      {
        id: 'skill-design-ui',
        name: 'UI/UX Design',
        description: 'User Interface Design, Wireframing, Prototyping, Usability',
        category: 'Design',
        level: 'advanced',
        keywords: ['ui', 'ux', 'design', 'figma', 'wireframe', 'prototype', 'usability', 'user experience'],
      },
      {
        id: 'skill-design-system',
        name: 'Design Systems',
        description: 'Komponentenbibliotheken, Design Tokens, Storybook, shadcn/ui',
        category: 'Design',
        level: 'advanced',
        keywords: ['design system', 'component library', 'storybook', 'shadcn', 'token', 'style guide'],
      },
      {
        id: 'skill-design-brand',
        name: 'Brand Design',
        description: 'Corporate Identity, Logo, Farb- und Typografie-Systeme, Brand Guidelines',
        category: 'Design',
        level: 'intermediate',
        keywords: ['brand', 'logo', 'corporate identity', 'farbe', 'typografie', 'style guide', 'brand guideline'],
      },
      {
        id: 'skill-design-mobile',
        name: 'Mobile UI Design',
        description: 'Mobile-first Design, Touch-Interaktionen, iOS/Android Guidelines',
        category: 'Design',
        level: 'intermediate',
        keywords: ['mobile design', 'mobile ui', 'touch', 'ios design', 'android design', 'app design'],
      },
      {
        id: 'skill-design-animation',
        name: 'Motion & Animation',
        description: 'CSS Animationen, Framer Motion, Lottie, Micro-Interactions',
        category: 'Design',
        level: 'intermediate',
        keywords: ['animation', 'motion', 'framer motion', 'lottie', 'transition', 'micro-interaction'],
      },

      // ── Content & Marketing ────────────────────────────────────────────────
      {
        id: 'skill-marketing-seo',
        name: 'SEO Optimization',
        description: 'On-Page SEO, technisches SEO, Keyword-Recherche, Link Building',
        category: 'Marketing',
        level: 'advanced',
        keywords: ['seo', 'search engine', 'keyword', 'ranking', 'meta', 'sitemap', 'backlink'],
      },
      {
        id: 'skill-marketing-copy',
        name: 'Copywriting',
        description: 'Verkaufs- und Marketingtexte, Headlines, CTAs, Sales Pages',
        category: 'Marketing',
        level: 'advanced',
        keywords: ['copywriting', 'copy', 'sales', 'headline', 'cta', 'conversion', 'landing page'],
      },
      {
        id: 'skill-marketing-content',
        name: 'Content Strategy',
        description: 'Content-Planung, Redaktionsplan, Blog, Newsletter, Thought Leadership',
        category: 'Marketing',
        level: 'intermediate',
        keywords: ['content strategy', 'blog', 'newsletter', 'content plan', 'editorial', 'thought leadership'],
      },
      {
        id: 'skill-marketing-social',
        name: 'Social Media Marketing',
        description: 'LinkedIn, Instagram, X/Twitter, TikTok Content und Community Management',
        category: 'Marketing',
        level: 'intermediate',
        keywords: ['social media', 'linkedin', 'instagram', 'twitter', 'tiktok', 'community', 'posting'],
      },
      {
        id: 'skill-marketing-email',
        name: 'Email Marketing',
        description: 'Cold Email, Sequenzen, Newsletter, Öffnungsraten-Optimierung',
        category: 'Marketing',
        level: 'intermediate',
        keywords: ['email', 'newsletter', 'cold email', 'sequence', 'drip', 'open rate', 'campaign'],
      },
      {
        id: 'skill-marketing-ads',
        name: 'Paid Advertising',
        description: 'Google Ads, Meta Ads, LinkedIn Ads, Ad Creative, ROAS-Optimierung',
        category: 'Marketing',
        level: 'advanced',
        keywords: ['ads', 'google ads', 'meta ads', 'facebook ads', 'linkedin ads', 'roas', 'paid', 'campaign'],
      },
      {
        id: 'skill-marketing-psychology',
        name: 'Marketing Psychology',
        description: 'Behavioral Triggers, Social Proof, FOMO, Pricing Psychology, Conversion',
        category: 'Marketing',
        level: 'advanced',
        keywords: ['psychology', 'conversion', 'social proof', 'fomo', 'pricing', 'behavioral', 'persuasion'],
      },
      {
        id: 'skill-content-writing',
        name: 'Technical Writing',
        description: 'Dokumentation, API Docs, README, Tutorials, Whitepapers',
        category: 'Marketing',
        level: 'intermediate',
        keywords: ['writing', 'documentation', 'readme', 'tutorial', 'whitepaper', 'technical writing', 'docs'],
      },

      // ── Research & Analysis ────────────────────────────────────────────────
      {
        id: 'skill-research-web',
        name: 'Web Research',
        description: 'Tiefgehende Online-Recherche, Quellenvalidierung, Competitive Intelligence',
        category: 'Research',
        level: 'advanced',
        keywords: ['research', 'recherche', 'search', 'investigate', 'competitive', 'analyse', 'internet'],
      },
      {
        id: 'skill-research-market',
        name: 'Market Research',
        description: 'Marktanalyse, Wettbewerbsanalyse, Zielgruppenanalyse, TAM/SAM/SOM',
        category: 'Research',
        level: 'advanced',
        keywords: ['market research', 'market analysis', 'competitor', 'target audience', 'tam', 'sam', 'som'],
      },
      {
        id: 'skill-research-scraping',
        name: 'Web Scraping',
        description: 'Datenextraktion mit Playwright, Puppeteer, Firecrawl, BeautifulSoup',
        category: 'Research',
        level: 'intermediate',
        keywords: ['scraping', 'web scrape', 'playwright', 'puppeteer', 'firecrawl', 'beautifulsoup', 'crawl'],
      },
      {
        id: 'skill-research-data',
        name: 'Data Analysis',
        description: 'Datenanalyse, Visualisierung, Dashboards, Business Intelligence',
        category: 'Research',
        level: 'advanced',
        keywords: ['data analysis', 'visualization', 'dashboard', 'bi', 'business intelligence', 'excel', 'tableau'],
      },

      // ── Automation & Integrations ──────────────────────────────────────────
      {
        id: 'skill-auto-browser',
        name: 'Browser Automation',
        description: 'Playwright, Puppeteer, Selenium für Test- und Prozessautomatisierung',
        category: 'Automation',
        level: 'advanced',
        keywords: ['playwright', 'puppeteer', 'selenium', 'browser automation', 'headless', 'e2e', 'test'],
      },
      {
        id: 'skill-auto-zapier',
        name: 'Workflow Automation (Zapier / Make)',
        description: 'No-Code Automatisierung, Zapier, Make (Integromat), n8n Workflows',
        category: 'Automation',
        level: 'intermediate',
        keywords: ['zapier', 'make', 'integromat', 'n8n', 'workflow', 'automation', 'no-code'],
      },
      {
        id: 'skill-auto-shell',
        name: 'Shell Scripting & Bash',
        description: 'Bash/Shell-Scripting, Linux-Administration, Cron-Jobs, Automatisierung',
        category: 'Automation',
        level: 'intermediate',
        keywords: ['bash', 'shell', 'script', 'linux', 'cron', 'command line', 'cli', 'unix'],
      },
      {
        id: 'skill-auto-rpa',
        name: 'RPA (Robotic Process Automation)',
        description: 'Prozessautomatisierung, UiPath, Desktop-Automatisierung',
        category: 'Automation',
        level: 'intermediate',
        keywords: ['rpa', 'robotic process', 'uipath', 'automation anywhere', 'process automation'],
      },

      // ── Productivity & Collaboration ───────────────────────────────────────
      {
        id: 'skill-prod-gworkspace',
        name: 'Google Workspace',
        description: 'Google Docs, Sheets, Slides, Drive, Gmail, Calendar via API und Automatisierung',
        category: 'Productivity',
        level: 'intermediate',
        keywords: ['google workspace', 'google docs', 'google sheets', 'gmail', 'google drive', 'calendar', 'slides'],
      },
      {
        id: 'skill-prod-office',
        name: 'Microsoft Office / 365',
        description: 'Word, Excel, PowerPoint, Teams, SharePoint Automatisierung und Nutzung',
        category: 'Productivity',
        level: 'intermediate',
        keywords: ['microsoft', 'word', 'excel', 'powerpoint', 'teams', 'sharepoint', 'office', 'outlook'],
      },
      {
        id: 'skill-prod-notion',
        name: 'Notion / Obsidian',
        description: 'Wissensmanagement, Datenbanken, Templates, Second Brain',
        category: 'Productivity',
        level: 'basic',
        keywords: ['notion', 'obsidian', 'knowledge management', 'notes', 'second brain', 'wiki'],
      },
      {
        id: 'skill-prod-project',
        name: 'Project Management',
        description: 'Agile, Scrum, Kanban, Jira, Linear, Asana — Projektplanung und -steuerung',
        category: 'Productivity',
        level: 'intermediate',
        keywords: ['project management', 'agile', 'scrum', 'kanban', 'jira', 'linear', 'asana', 'sprint'],
      },

      // ── Business & Strategy ────────────────────────────────────────────────
      {
        id: 'skill-biz-strategy',
        name: 'Business Strategy',
        description: 'Strategieentwicklung, Business Model Canvas, OKRs, Marktpositionierung',
        category: 'Business',
        level: 'advanced',
        keywords: ['strategy', 'business model', 'okr', 'positioning', 'business plan', 'go-to-market'],
      },
      {
        id: 'skill-biz-finance',
        name: 'Financial Analysis',
        description: 'P&L Analyse, Budgetplanung, Cashflow, Unit Economics, SaaS Metriken',
        category: 'Business',
        level: 'advanced',
        keywords: ['finance', 'financial', 'budget', 'cashflow', 'mrr', 'arr', 'unit economics', 'revenue'],
      },
      {
        id: 'skill-biz-legal',
        name: 'Legal & Compliance',
        description: 'Vertragsanalyse, AGB, Datenschutz, Unternehmensrecht, IP',
        category: 'Business',
        level: 'intermediate',
        keywords: ['legal', 'contract', 'compliance', 'agb', 'datenschutz', 'recht', 'ip', 'patent'],
      },
      {
        id: 'skill-biz-hr',
        name: 'HR & Recruiting',
        description: 'Stellenausschreibungen, Interviews, Onboarding, Performance Management',
        category: 'Business',
        level: 'intermediate',
        keywords: ['hr', 'recruiting', 'hiring', 'interview', 'onboarding', 'job description', 'talent'],
      },
      {
        id: 'skill-biz-customer',
        name: 'Customer Success',
        description: 'Kundenkommunikation, Support, Churn-Reduktion, NPS, Feedback-Analyse',
        category: 'Business',
        level: 'intermediate',
        keywords: ['customer success', 'support', 'churn', 'nps', 'feedback', 'customer', 'retention'],
      },
    ];

    return defaultSkills;
  }

  /**
   * Get skills for a specific agent
   */
  async getAgentSkills(agentId: string): Promise<Skill[]> {
    const agent = await db.select()
      .from(experten)
      .where(eq(experten.id, agentId))
      .limit(1);

    if (agent.length === 0) return [];

    const agentData = agent[0];
    const skills: Skill[] = [];

    // Parse skills from agent's faehigkeiten field (JSON or comma-separated)
    if (agentData.faehigkeiten) {
      try {
        // Try JSON first
        const parsed = JSON.parse(agentData.faehigkeiten);
        if (Array.isArray(parsed)) {
          const allSkills = await this.getAllSkills();
          for (const skillName of parsed) {
            const matchingSkill = allSkills.find(s =>
              s.name.toLowerCase().includes(skillName.toLowerCase()) ||
              skillName.toLowerCase().includes(s.name.toLowerCase())
            );
            if (matchingSkill) {
              skills.push(matchingSkill);
            }
          }
        }
      } catch {
        // Fallback: comma-separated string
        const skillNames = agentData.faehigkeiten.split(',').map(s => s.trim());
        const allSkills = await this.getAllSkills();
        for (const skillName of skillNames) {
          const matchingSkill = allSkills.find(s =>
            s.name.toLowerCase().includes(skillName.toLowerCase())
          );
          if (matchingSkill) {
            skills.push(matchingSkill);
          }
        }
      }
    }

    return skills;
  }

  /**
   * Assign a skill to an agent
   */
  async assignSkillToAgent(
    agentId: string,
    skillId: string,
    proficiency: number = 50
  ): Promise<boolean> {
    const agent = await db.select()
      .from(experten)
      .where(eq(experten.id, agentId))
      .limit(1);

    if (agent.length === 0) return false;

    const allSkills = await this.getAllSkills();
    const skill = allSkills.find(s => s.id === skillId);
    if (!skill) return false;

    // Get current skills
    const currentSkills = await this.getAgentSkills(agentId);
    const currentSkillNames = currentSkills.map(s => s.name);

    // Add new skill if not already present
    if (!currentSkillNames.includes(skill.name)) {
      currentSkillNames.push(skill.name);
    }

    // Update agent
    await db.update(experten)
      .set({
        faehigkeiten: JSON.stringify(currentSkillNames),
        aktualisiertAm: new Date().toISOString(),
      })
      .where(eq(experten.id, agentId));

    return true;
  }

  /**
   * Remove a skill from an agent
   */
  async removeSkillFromAgent(agentId: string, skillId: string): Promise<boolean> {
    const currentSkills = await this.getAgentSkills(agentId);
    const skillToRemove = await this.getAllSkills().then(s => s.find(sk => sk.id === skillId));

    if (!skillToRemove) return false;

    const updatedSkills = currentSkills
      .filter(s => s.id !== skillId)
      .map(s => s.name);

    await db.update(experten)
      .set({
        faehigkeiten: updatedSkills.length > 0 ? JSON.stringify(updatedSkills) : null,
        aktualisiertAm: new Date().toISOString(),
      })
      .where(eq(experten.id, agentId));

    return true;
  }

  /**
   * Find best agent for a task based on skills
   */
  async findBestAgentForTask(
    unternehmenId: string,
    taskTitel: string,
    taskBeschreibung: string | null
  ): Promise<{ agentId: string; agentName: string; matchScore: number } | null> {
    const text = `${taskTitel} ${taskBeschreibung || ''}`.toLowerCase();
    const allSkills = await this.getAllSkills();

    // Find matching skills for the task
    const matchingSkills: SkillMatch[] = [];

    for (const skill of allSkills) {
      let score = 0;

      // Check keywords
      for (const keyword of skill.keywords) {
        if (text.includes(keyword.toLowerCase())) {
          score += 10;
        }
      }

      // Check skill name
      if (text.includes(skill.name.toLowerCase())) {
        score += 20;
      }

      // Check category
      if (text.includes(skill.category.toLowerCase())) {
        score += 15;
      }

      if (score > 0) {
        matchingSkills.push({
          skill,
          matchScore: Math.min(score, 100),
        });
      }
    }

    if (matchingSkills.length === 0) {
      return null;
    }

    // Find agents with matching skills
    const agents = await db.select({
      id: experten.id,
      name: experten.name,
      faehigkeiten: experten.faehigkeiten,
      status: experten.status,
    })
      .from(experten)
      .where(eq(experten.unternehmenId, unternehmenId));

    let bestMatch: { agentId: string; agentName: string; matchScore: number } | null = null;

    for (const agent of agents) {
      if (agent.status === 'terminated' || agent.status === 'paused') {
        continue;
      }

      let agentSkillNames: string[] = [];
      if (agent.faehigkeiten) {
        try {
          agentSkillNames = JSON.parse(agent.faehigkeiten);
        } catch {
          agentSkillNames = agent.faehigkeiten.split(',').map(s => s.trim());
        }
      }

      for (const skillMatch of matchingSkills) {
        if (agentSkillNames.some(s =>
          s.toLowerCase().includes(skillMatch.skill.name.toLowerCase()) ||
          skillMatch.skill.keywords.some(k => s.toLowerCase().includes(k))
        )) {
          const totalScore = skillMatch.matchScore;
          if (!bestMatch || totalScore > bestMatch.matchScore) {
            bestMatch = {
              agentId: agent.id,
              agentName: agent.name,
              matchScore: totalScore,
            };
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * Get skill categories
   */
  getSkillCategories(): string[] {
    return [
      'Development',
      'Frontend',
      'Backend',
      'DevOps',
      'Database',
      'AI/ML',
      'Security',
      'Design',
      'Marketing',
      'Research',
      'Automation',
      'Productivity',
      'Business',
    ];
  }
}

// Singleton instance
export const skillsService = new SkillsService();

// Convenience exports
export const getAllSkills = skillsService.getAllSkills.bind(skillsService);
export const getAgentSkills = skillsService.getAgentSkills.bind(skillsService);
export const assignSkillToAgent = skillsService.assignSkillToAgent.bind(skillsService);
export const removeSkillFromAgent = skillsService.removeSkillFromAgent.bind(skillsService);
export const findBestAgentForTask = skillsService.findBestAgentForTask.bind(skillsService);
