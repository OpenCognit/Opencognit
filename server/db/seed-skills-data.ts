// =============================================================================
// Seed data for the skills library — bilingual (de/en) so a company can pick
// the variant that matches its UI language at seed time.
// Extracted from server/index.ts as part of the routes split refactor.
// =============================================================================

export type BilingualSkill = {
  name: string;
  tags: string[];
  de: { description: string; content: string };
  en: { description: string; content: string };
};

export const SEED_SKILLS: BilingualSkill[] = [
  // Development
  {
    name: 'JavaScript / TypeScript',
    tags: ['javascript', 'typescript', 'nodejs', 'js', 'ts'],
    de: {
      description: 'JS & TS Entwicklung, Node.js, moderne ES-Features',
      content: `# JavaScript / TypeScript\n\n## Fähigkeiten\n- Moderne JS/TS Entwicklung (ES2023+, async/await, Decorators)\n- Node.js Backend-Services, REST APIs\n- Typsichere Codebases mit TypeScript\n- Bundling mit Vite, esbuild, webpack\n- Package Management mit npm/pnpm/yarn\n\n## Typische Aufgaben\n- API-Endpunkte implementieren\n- Bibliotheken und Module erstellen\n- TypeScript-Typen definieren und refactoren\n- Performance-Optimierungen\n\n## Tools\ntsc, ts-node, tsx, eslint, prettier`,
    },
    en: {
      description: 'JS & TS development, Node.js, modern ES features',
      content: `# JavaScript / TypeScript\n\n## Capabilities\n- Modern JS/TS development (ES2023+, async/await, decorators)\n- Node.js backend services, REST APIs\n- Type-safe codebases with TypeScript\n- Bundling with Vite, esbuild, webpack\n- Package management with npm/pnpm/yarn\n\n## Typical tasks\n- Implement API endpoints\n- Build libraries and modules\n- Define and refactor TypeScript types\n- Performance optimization\n\n## Tools\ntsc, ts-node, tsx, eslint, prettier`,
    },
  },
  {
    name: 'Python',
    tags: ['python', 'fastapi', 'scripting', 'automation'],
    de: {
      description: 'Python Entwicklung, Scripting, Automatisierung',
      content: `# Python\n\n## Fähigkeiten\n- Python 3.x Entwicklung\n- Scripting und Automatisierung\n- Frameworks: FastAPI, Flask, Django\n- Datenverarbeitung mit pandas, numpy\n- Async-Programmierung (asyncio)\n\n## Typische Aufgaben\n- CLI-Tools und Skripte schreiben\n- REST APIs mit FastAPI bauen\n- Daten verarbeiten und transformieren\n- Automatisierungen erstellen\n\n## Tools\npip, poetry, pytest, black, mypy`,
    },
    en: {
      description: 'Python development, scripting, automation',
      content: `# Python\n\n## Capabilities\n- Python 3.x development\n- Scripting and automation\n- Frameworks: FastAPI, Flask, Django\n- Data processing with pandas, numpy\n- Async programming (asyncio)\n\n## Typical tasks\n- Write CLI tools and scripts\n- Build REST APIs with FastAPI\n- Process and transform data\n- Create automations\n\n## Tools\npip, poetry, pytest, black, mypy`,
    },
  },
  {
    name: 'Go (Golang)',
    tags: ['go', 'golang', 'backend', 'microservice'],
    de: {
      description: 'Performante Backend-Services und CLI-Tools mit Go',
      content: `# Go (Golang)\n\n## Fähigkeiten\n- Go für hochperformante Backend-Services\n- Goroutines und Channels für Concurrency\n- gRPC und Protocol Buffers\n- CLI-Tools mit cobra/urfave\n- Interfaces und Typsystem\n\n## Typische Aufgaben\n- Microservices entwickeln\n- CLI-Tools bauen\n- Concurrent Systeme entwerfen\n\n## Tools\ngo build, go test, golangci-lint, air`,
    },
    en: {
      description: 'High-performance backend services and CLI tools with Go',
      content: `# Go (Golang)\n\n## Capabilities\n- Go for high-performance backend services\n- Goroutines and channels for concurrency\n- gRPC and Protocol Buffers\n- CLI tools with cobra/urfave\n- Interfaces and type system\n\n## Typical tasks\n- Develop microservices\n- Build CLI tools\n- Design concurrent systems\n\n## Tools\ngo build, go test, golangci-lint, air`,
    },
  },
  {
    name: 'Rust',
    tags: ['rust', 'wasm', 'systems', 'performance'],
    de: {
      description: 'Systemnahe, sichere Hochleistungs-Programmierung',
      content: `# Rust\n\n## Fähigkeiten\n- Memory-sicheres Systems Programming\n- WebAssembly (WASM) Kompilierung\n- Async mit tokio\n- FFI und native Bindings\n- Zero-Cost Abstraktionen\n\n## Typische Aufgaben\n- Performance-kritische Komponenten\n- WASM-Module für Browser\n- CLI-Tools und native Apps\n\n## Tools\ncargo, rustfmt, clippy, wasm-pack`,
    },
    en: {
      description: 'Low-level, safe, high-performance programming',
      content: `# Rust\n\n## Capabilities\n- Memory-safe systems programming\n- WebAssembly (WASM) compilation\n- Async with tokio\n- FFI and native bindings\n- Zero-cost abstractions\n\n## Typical tasks\n- Performance-critical components\n- WASM modules for the browser\n- CLI tools and native apps\n\n## Tools\ncargo, rustfmt, clippy, wasm-pack`,
    },
  },
  {
    name: 'API Design',
    tags: ['api', 'rest', 'graphql', 'openapi', 'swagger'],
    de: {
      description: 'REST, GraphQL und gRPC API-Architektur',
      content: `# API Design\n\n## Fähigkeiten\n- RESTful API Design nach OpenAPI 3.x\n- GraphQL Schema Design, Resolver, Subscriptions\n- gRPC mit Protocol Buffers\n- API-Versionierung und Deprecation\n- Rate Limiting, Auth, Pagination\n\n## Best Practices\n- Resource-orientiertes Design\n- Konsistente Fehlerformate\n- Dokumentation mit Swagger/Redoc\n- Backward Compatibility\n\n## Tools\nOpenAPI, Swagger, Postman, Insomnia, GraphQL Playground`,
    },
    en: {
      description: 'REST, GraphQL, and gRPC API architecture',
      content: `# API Design\n\n## Capabilities\n- RESTful API design per OpenAPI 3.x\n- GraphQL schema design, resolvers, subscriptions\n- gRPC with Protocol Buffers\n- API versioning and deprecation\n- Rate limiting, auth, pagination\n\n## Best practices\n- Resource-oriented design\n- Consistent error formats\n- Documentation with Swagger/Redoc\n- Backward compatibility\n\n## Tools\nOpenAPI, Swagger, Postman, Insomnia, GraphQL Playground`,
    },
  },
  {
    name: 'Testing & QA',
    tags: ['testing', 'qa', 'tdd', 'playwright', 'jest'],
    de: {
      description: 'Unit, Integration und E2E Tests, TDD',
      content: `# Testing & QA\n\n## Fähigkeiten\n- Unit Tests (Jest, Vitest, pytest, go test)\n- Integration Tests mit echten DBs\n- E2E Tests mit Playwright/Cypress\n- TDD und BDD Ansätze\n- Test Coverage und Reporting\n\n## Typische Aufgaben\n- Testsuiten aufbauen\n- Flaky Tests debuggen\n- CI-Integration von Tests\n- Code Coverage erhöhen\n\n## Tools\nJest, Vitest, Playwright, pytest, supertest`,
    },
    en: {
      description: 'Unit, integration, and E2E tests, TDD',
      content: `# Testing & QA\n\n## Capabilities\n- Unit tests (Jest, Vitest, pytest, go test)\n- Integration tests with real DBs\n- E2E tests with Playwright/Cypress\n- TDD and BDD approaches\n- Test coverage and reporting\n\n## Typical tasks\n- Build test suites\n- Debug flaky tests\n- CI integration of tests\n- Increase code coverage\n\n## Tools\nJest, Vitest, Playwright, pytest, supertest`,
    },
  },
  {
    name: 'Code Refactoring',
    tags: ['refactoring', 'clean code', 'code quality', 'review'],
    de: {
      description: 'Clean Code, technische Schulden abbauen',
      content: `# Code Refactoring\n\n## Fähigkeiten\n- Design Pattern anwenden (SOLID, DRY, KISS)\n- Legacy Code modernisieren\n- Komplexität reduzieren\n- Typsicherheit einführen\n- Abhängigkeiten entwirren\n\n## Typische Aufgaben\n- Code Reviews durchführen\n- Spaghetti-Code strukturieren\n- Technische Schulden dokumentieren und abbauen\n\n## Metriken\nCyclomatic Complexity, Coupling, Cohesion, DRY-Score`,
    },
    en: {
      description: 'Clean code, paying down technical debt',
      content: `# Code Refactoring\n\n## Capabilities\n- Apply design patterns (SOLID, DRY, KISS)\n- Modernize legacy code\n- Reduce complexity\n- Introduce type safety\n- Untangle dependencies\n\n## Typical tasks\n- Conduct code reviews\n- Restructure spaghetti code\n- Document and pay down technical debt\n\n## Metrics\nCyclomatic complexity, coupling, cohesion, DRY score`,
    },
  },
  // Frontend
  {
    name: 'React / Next.js',
    tags: ['react', 'nextjs', 'jsx', 'hooks', 'ssr'],
    de: {
      description: 'React Entwicklung, Hooks, Next.js App Router',
      content: `# React / Next.js\n\n## Fähigkeiten\n- React 19, Server Components, Client Components\n- Next.js App Router, Server Actions\n- State Management: Zustand, Jotai, Redux Toolkit\n- React Query / SWR für Data Fetching\n- Performance: memo, useMemo, useCallback, lazy\n\n## Typische Aufgaben\n- Komponentenbibliotheken bauen\n- SSR/SSG Seiten implementieren\n- State-Architekturen designen\n\n## Tools\ncreate-next-app, Turbopack, React DevTools`,
    },
    en: {
      description: 'React development, hooks, Next.js App Router',
      content: `# React / Next.js\n\n## Capabilities\n- React 19, Server Components, Client Components\n- Next.js App Router, Server Actions\n- State management: Zustand, Jotai, Redux Toolkit\n- React Query / SWR for data fetching\n- Performance: memo, useMemo, useCallback, lazy\n\n## Typical tasks\n- Build component libraries\n- Implement SSR/SSG pages\n- Design state architectures\n\n## Tools\ncreate-next-app, Turbopack, React DevTools`,
    },
  },
  {
    name: 'Vue.js / Nuxt',
    tags: ['vue', 'nuxt', 'pinia', 'composition api'],
    de: {
      description: 'Vue 3 Composition API, Nuxt.js',
      content: `# Vue.js / Nuxt\n\n## Fähigkeiten\n- Vue 3 mit Composition API und \`<script setup>\`\n- Nuxt 3 für SSR/SSG\n- Pinia State Management\n- Vue Router\n- Vite als Build-Tool\n\n## Typische Aufgaben\n- SPAs und SSR-Apps bauen\n- Reactive Data Flows designen\n- Performance-Optimierung\n\n## Tools\nVue DevTools, Vite, Vitest, Nuxt Devtools`,
    },
    en: {
      description: 'Vue 3 Composition API, Nuxt.js',
      content: `# Vue.js / Nuxt\n\n## Capabilities\n- Vue 3 with Composition API and \`<script setup>\`\n- Nuxt 3 for SSR/SSG\n- Pinia state management\n- Vue Router\n- Vite as the build tool\n\n## Typical tasks\n- Build SPAs and SSR apps\n- Design reactive data flows\n- Performance optimization\n\n## Tools\nVue DevTools, Vite, Vitest, Nuxt Devtools`,
    },
  },
  {
    name: 'React Native / Expo',
    tags: ['react native', 'expo', 'mobile', 'ios', 'android'],
    de: {
      description: 'Cross-Platform Mobile Apps',
      content: `# React Native / Expo\n\n## Fähigkeiten\n- Expo SDK und Expo Router\n- Native Module und APIs (Kamera, GPS, Push)\n- React Native Animations (Reanimated 3)\n- OTA Updates mit EAS Update\n- App Store / Play Store Deployment\n\n## Typische Aufgaben\n- Mobile Apps von Grund auf bauen\n- Web-Code für Mobile portieren\n- Native Performance-Issues lösen\n\n## Tools\nExpo CLI, EAS CLI, Flipper, Metro`,
    },
    en: {
      description: 'Cross-platform mobile apps',
      content: `# React Native / Expo\n\n## Capabilities\n- Expo SDK and Expo Router\n- Native modules and APIs (camera, GPS, push)\n- React Native animations (Reanimated 3)\n- OTA updates with EAS Update\n- App Store / Play Store deployment\n\n## Typical tasks\n- Build mobile apps from scratch\n- Port web code to mobile\n- Solve native performance issues\n\n## Tools\nExpo CLI, EAS CLI, Flipper, Metro`,
    },
  },
  {
    name: 'CSS & Tailwind',
    tags: ['css', 'tailwind', 'styling', 'animation', 'responsive'],
    de: {
      description: 'Modern CSS, Tailwind, Animationen, Responsive Design',
      content: `# CSS & Tailwind\n\n## Fähigkeiten\n- Tailwind CSS v4 Utility-First\n- CSS Custom Properties und Themes\n- Glassmorphism, Neumorphism, moderne UI-Trends\n- Framer Motion Animationen\n- Container Queries, Grid, Flexbox\n- Dark Mode und Theme-Switching\n\n## Typische Aufgaben\n- Design-System implementieren\n- Responsive Layouts bauen\n- Animationen und Micro-Interactions\n\n## Tools\nTailwind CSS, PostCSS, shadcn/ui, Radix UI`,
    },
    en: {
      description: 'Modern CSS, Tailwind, animations, responsive design',
      content: `# CSS & Tailwind\n\n## Capabilities\n- Tailwind CSS v4 utility-first\n- CSS custom properties and themes\n- Glassmorphism, neumorphism, modern UI trends\n- Framer Motion animations\n- Container queries, grid, flexbox\n- Dark mode and theme switching\n\n## Typical tasks\n- Implement design systems\n- Build responsive layouts\n- Animations and micro-interactions\n\n## Tools\nTailwind CSS, PostCSS, shadcn/ui, Radix UI`,
    },
  },
  {
    name: 'Web Performance',
    tags: ['performance', 'lighthouse', 'core web vitals', 'optimization'],
    de: {
      description: 'Core Web Vitals, Bundle-Optimierung, Lighthouse',
      content: `# Web Performance\n\n## Fähigkeiten\n- Core Web Vitals (LCP, INP, CLS)\n- Bundle Size Analyse und Reduction\n- Image Optimization (AVIF, WebP, lazy loading)\n- Code Splitting und Dynamic Imports\n- Edge Caching und CDN-Strategien\n\n## Typische Aufgaben\n- Lighthouse Score verbessern\n- Bundle analysieren und optimieren\n- Critical Rendering Path optimieren\n\n## Tools\nLighthouse, WebPageTest, Bundle Analyzer, Sentry Performance`,
    },
    en: {
      description: 'Core Web Vitals, bundle optimization, Lighthouse',
      content: `# Web Performance\n\n## Capabilities\n- Core Web Vitals (LCP, INP, CLS)\n- Bundle size analysis and reduction\n- Image optimization (AVIF, WebP, lazy loading)\n- Code splitting and dynamic imports\n- Edge caching and CDN strategies\n\n## Typical tasks\n- Improve Lighthouse score\n- Analyze and optimize bundles\n- Optimize the critical rendering path\n\n## Tools\nLighthouse, WebPageTest, Bundle Analyzer, Sentry Performance`,
    },
  },
  // DevOps
  {
    name: 'Docker & Container',
    tags: ['docker', 'container', 'compose', 'dockerfile'],
    de: {
      description: 'Docker, Docker Compose, Multi-Stage Builds',
      content: `# Docker & Container\n\n## Fähigkeiten\n- Dockerfile schreiben (Multi-Stage, Layer-Caching)\n- Docker Compose für lokale Entwicklung\n- Container Security (rootless, scan)\n- Registry Management (Docker Hub, GHCR, ECR)\n- Health Checks und Graceful Shutdown\n\n## Typische Aufgaben\n- Services containerisieren\n- Compose-Stacks aufsetzen\n- Images optimieren (Größe, Security)\n\n## Tools\nDocker CLI, Docker Desktop, Dive, Trivy`,
    },
    en: {
      description: 'Docker, Docker Compose, multi-stage builds',
      content: `# Docker & Container\n\n## Capabilities\n- Write Dockerfiles (multi-stage, layer caching)\n- Docker Compose for local development\n- Container security (rootless, scan)\n- Registry management (Docker Hub, GHCR, ECR)\n- Health checks and graceful shutdown\n\n## Typical tasks\n- Containerize services\n- Set up Compose stacks\n- Optimize images (size, security)\n\n## Tools\nDocker CLI, Docker Desktop, Dive, Trivy`,
    },
  },
  {
    name: 'Kubernetes (K8s)',
    tags: ['kubernetes', 'k8s', 'helm', 'kubectl', 'deployment'],
    de: {
      description: 'K8s Orchestrierung, Helm, Deployment-Strategien',
      content: `# Kubernetes\n\n## Fähigkeiten\n- Deployments, Services, Ingress, ConfigMaps, Secrets\n- Helm Charts erstellen und verwalten\n- Horizontal Pod Autoscaler (HPA)\n- Rolling Updates und Canary Deployments\n- RBAC und Namespace-Isolation\n\n## Typische Aufgaben\n- Cluster aufsetzen und warten\n- Helm Charts schreiben\n- Debugging mit kubectl logs/exec\n\n## Tools\nkubectl, Helm, k9s, Lens, ArgoCD`,
    },
    en: {
      description: 'K8s orchestration, Helm, deployment strategies',
      content: `# Kubernetes\n\n## Capabilities\n- Deployments, Services, Ingress, ConfigMaps, Secrets\n- Create and manage Helm charts\n- Horizontal Pod Autoscaler (HPA)\n- Rolling updates and canary deployments\n- RBAC and namespace isolation\n\n## Typical tasks\n- Set up and maintain clusters\n- Write Helm charts\n- Debugging with kubectl logs/exec\n\n## Tools\nkubectl, Helm, k9s, Lens, ArgoCD`,
    },
  },
  {
    name: 'CI/CD Pipelines',
    tags: ['ci/cd', 'github actions', 'gitlab ci', 'pipeline', 'automation'],
    de: {
      description: 'GitHub Actions, GitLab CI, automatisiertes Deployment',
      content: `# CI/CD Pipelines\n\n## Fähigkeiten\n- GitHub Actions Workflows (matrix, cache, reusable)\n- GitLab CI/CD Pipelines\n- Test → Build → Deploy Automation\n- Secrets Management in Pipelines\n- Branch Strategies (GitFlow, trunk-based)\n\n## Typische Aufgaben\n- Pipeline für neues Projekt aufsetzen\n- Deployment-Prozess automatisieren\n- Pipeline-Performance optimieren\n\n## Tools\nGitHub Actions, GitLab CI, CircleCI, ArgoCD, Flux`,
    },
    en: {
      description: 'GitHub Actions, GitLab CI, automated deployment',
      content: `# CI/CD Pipelines\n\n## Capabilities\n- GitHub Actions workflows (matrix, cache, reusable)\n- GitLab CI/CD pipelines\n- Test → Build → Deploy automation\n- Secrets management in pipelines\n- Branch strategies (GitFlow, trunk-based)\n\n## Typical tasks\n- Set up a pipeline for a new project\n- Automate the deployment process\n- Optimize pipeline performance\n\n## Tools\nGitHub Actions, GitLab CI, CircleCI, ArgoCD, Flux`,
    },
  },
  {
    name: 'AWS Cloud',
    tags: ['aws', 'amazon', 'ec2', 's3', 'lambda', 'cloud'],
    de: {
      description: 'Amazon Web Services: EC2, S3, Lambda, ECS, RDS',
      content: `# AWS Cloud\n\n## Fähigkeiten\n- EC2, ECS, Lambda für Compute\n- S3, CloudFront für Storage/CDN\n- RDS, DynamoDB für Datenbanken\n- IAM, VPC, Security Groups\n- CloudFormation / CDK für Infrastructure as Code\n\n## Typische Aufgaben\n- Serverless Architekturen entwerfen\n- Kosten optimieren\n- Multi-Region Setups planen\n\n## Tools\nAWS CLI, CDK, SAM, Terraform`,
    },
    en: {
      description: 'Amazon Web Services: EC2, S3, Lambda, ECS, RDS',
      content: `# AWS Cloud\n\n## Capabilities\n- EC2, ECS, Lambda for compute\n- S3, CloudFront for storage/CDN\n- RDS, DynamoDB for databases\n- IAM, VPC, security groups\n- CloudFormation / CDK for infrastructure as code\n\n## Typical tasks\n- Design serverless architectures\n- Cost optimization\n- Plan multi-region setups\n\n## Tools\nAWS CLI, CDK, SAM, Terraform`,
    },
  },
  {
    name: 'Monitoring & Observability',
    tags: ['monitoring', 'observability', 'grafana', 'sentry', 'logging', 'tracing'],
    de: {
      description: 'Logs, Metrics, Tracing, Grafana, Sentry',
      content: `# Monitoring & Observability\n\n## Fähigkeiten\n- Strukturiertes Logging (JSON, Correlation IDs)\n- Metrics mit Prometheus + Grafana\n- Distributed Tracing (OpenTelemetry, Jaeger)\n- Error Tracking mit Sentry\n- Alerting und On-Call Runbooks\n\n## Typische Aufgaben\n- Observability-Stack aufsetzen\n- Dashboards für kritische Metriken bauen\n- SLOs und Alerting definieren\n\n## Tools\nGrafana, Prometheus, Sentry, Datadog, Loki`,
    },
    en: {
      description: 'Logs, metrics, tracing, Grafana, Sentry',
      content: `# Monitoring & Observability\n\n## Capabilities\n- Structured logging (JSON, correlation IDs)\n- Metrics with Prometheus + Grafana\n- Distributed tracing (OpenTelemetry, Jaeger)\n- Error tracking with Sentry\n- Alerting and on-call runbooks\n\n## Typical tasks\n- Set up an observability stack\n- Build dashboards for critical metrics\n- Define SLOs and alerting\n\n## Tools\nGrafana, Prometheus, Sentry, Datadog, Loki`,
    },
  },
  // Database
  {
    name: 'PostgreSQL',
    tags: ['postgresql', 'postgres', 'sql', 'database', 'query'],
    de: {
      description: 'PostgreSQL Design, komplexe Queries, Performance',
      content: `# PostgreSQL\n\n## Fähigkeiten\n- Schema Design und Normalisierung\n- Komplexe Queries (CTEs, Window Functions, JSONB)\n- Index-Strategien (B-Tree, GIN, Partial)\n- Query Plan Analyse mit EXPLAIN ANALYZE\n- Migrations mit Drizzle, Prisma, Flyway\n\n## Typische Aufgaben\n- Schema entwerfen und migrieren\n- Langsame Queries optimieren\n- Row-Level Security implementieren\n\n## Tools\npsql, pgAdmin, EXPLAIN, Drizzle ORM, Prisma`,
    },
    en: {
      description: 'PostgreSQL design, complex queries, performance',
      content: `# PostgreSQL\n\n## Capabilities\n- Schema design and normalization\n- Complex queries (CTEs, window functions, JSONB)\n- Index strategies (B-tree, GIN, partial)\n- Query plan analysis with EXPLAIN ANALYZE\n- Migrations with Drizzle, Prisma, Flyway\n\n## Typical tasks\n- Design and migrate schemas\n- Optimize slow queries\n- Implement row-level security\n\n## Tools\npsql, pgAdmin, EXPLAIN, Drizzle ORM, Prisma`,
    },
  },
  {
    name: 'Supabase',
    tags: ['supabase', 'postgres', 'auth', 'realtime', 'baas'],
    de: {
      description: 'Supabase BaaS: Auth, Realtime, Storage, Edge Functions',
      content: `# Supabase\n\n## Fähigkeiten\n- Supabase Auth (Social Login, Magic Link, MFA)\n- Row-Level Security (RLS) Policies\n- Realtime Subscriptions\n- Edge Functions (Deno)\n- Storage mit Buckets und Policies\n\n## Typische Aufgaben\n- Auth-System implementieren\n- RLS-Policies schreiben\n- Realtime Features bauen\n\n## Tools\nSupabase CLI, Supabase Studio, pg_graphql`,
    },
    en: {
      description: 'Supabase BaaS: auth, realtime, storage, edge functions',
      content: `# Supabase\n\n## Capabilities\n- Supabase Auth (social login, magic link, MFA)\n- Row-level security (RLS) policies\n- Realtime subscriptions\n- Edge functions (Deno)\n- Storage with buckets and policies\n\n## Typical tasks\n- Implement an auth system\n- Write RLS policies\n- Build realtime features\n\n## Tools\nSupabase CLI, Supabase Studio, pg_graphql`,
    },
  },
  {
    name: 'Redis / Caching',
    tags: ['redis', 'cache', 'session', 'rate limiting', 'pubsub'],
    de: {
      description: 'Redis für Caching, Sessions, Rate Limiting, Pub/Sub',
      content: `# Redis\n\n## Fähigkeiten\n- Caching-Strategien (Cache-Aside, Write-Through)\n- Session Storage\n- Rate Limiting mit Sliding Window\n- Pub/Sub und Message Queues\n- Redis Streams für Event Sourcing\n\n## Typische Aufgaben\n- API-Caching implementieren\n- Rate Limiter bauen\n- Pub/Sub für Notifications\n\n## Tools\nredis-cli, ioredis, BullMQ, Upstash`,
    },
    en: {
      description: 'Redis for caching, sessions, rate limiting, pub/sub',
      content: `# Redis\n\n## Capabilities\n- Caching strategies (cache-aside, write-through)\n- Session storage\n- Rate limiting with sliding window\n- Pub/sub and message queues\n- Redis Streams for event sourcing\n\n## Typical tasks\n- Implement API caching\n- Build rate limiters\n- Pub/sub for notifications\n\n## Tools\nredis-cli, ioredis, BullMQ, Upstash`,
    },
  },
  // AI/ML
  {
    name: 'Prompt Engineering',
    tags: ['prompt engineering', 'llm', 'claude', 'gpt', 'ai', 'chain of thought'],
    de: {
      description: 'Effektive Prompts für LLMs, Chain-of-Thought, Few-Shot',
      content: `# Prompt Engineering\n\n## Fähigkeiten\n- System Prompts und User Prompts strukturieren\n- Chain-of-Thought (CoT) Reasoning\n- Few-Shot und Zero-Shot Learning\n- Prompt-Templates und Variablen\n- Output-Formatierung (JSON, Markdown)\n- Jailbreak-Prävention und Safety\n\n## Typische Aufgaben\n- System Prompts für Agenten optimieren\n- Strukturierte Outputs erzwingen\n- Prompts für verschiedene LLMs anpassen\n\n## Models\nClaude (Anthropic), GPT-4o (OpenAI), Gemini (Google), Llama (Meta)`,
    },
    en: {
      description: 'Effective prompts for LLMs, chain-of-thought, few-shot',
      content: `# Prompt Engineering\n\n## Capabilities\n- Structure system and user prompts\n- Chain-of-thought (CoT) reasoning\n- Few-shot and zero-shot learning\n- Prompt templates and variables\n- Output formatting (JSON, Markdown)\n- Jailbreak prevention and safety\n\n## Typical tasks\n- Optimize system prompts for agents\n- Enforce structured outputs\n- Adapt prompts for different LLMs\n\n## Models\nClaude (Anthropic), GPT-4o (OpenAI), Gemini (Google), Llama (Meta)`,
    },
  },
  {
    name: 'RAG & Vector Search',
    tags: ['rag', 'vector search', 'embeddings', 'pinecone', 'semantic search'],
    de: {
      description: 'Retrieval-Augmented Generation, Embeddings, Vektordatenbanken',
      content: `# RAG & Vector Search\n\n## Fähigkeiten\n- Embedding-Modelle (text-embedding-3, nomic-embed)\n- Vektordatenbanken: Pinecone, Weaviate, pgvector, Chroma\n- Chunking-Strategien für Dokumente\n- Hybrid Search (BM25 + Vector)\n- Reranking mit Cross-Encoder\n\n## Typische Aufgaben\n- Knowledge Base aus Dokumenten bauen\n- Semantische Suche implementieren\n- RAG-Pipeline optimieren (Precision/Recall)\n\n## Tools\nLangChain, LlamaIndex, pgvector, Chroma`,
    },
    en: {
      description: 'Retrieval-augmented generation, embeddings, vector DBs',
      content: `# RAG & Vector Search\n\n## Capabilities\n- Embedding models (text-embedding-3, nomic-embed)\n- Vector databases: Pinecone, Weaviate, pgvector, Chroma\n- Chunking strategies for documents\n- Hybrid search (BM25 + vector)\n- Reranking with cross-encoders\n\n## Typical tasks\n- Build a knowledge base from documents\n- Implement semantic search\n- Optimize a RAG pipeline (precision/recall)\n\n## Tools\nLangChain, LlamaIndex, pgvector, Chroma`,
    },
  },
  {
    name: 'AI Agent Development',
    tags: ['agent', 'autonomous', 'tool use', 'multi-agent', 'mcp', 'langchain'],
    de: {
      description: 'Autonome Agenten, Tool-Use, Multi-Agent-Systeme',
      content: `# AI Agent Development\n\n## Fähigkeiten\n- Tool-Use / Function Calling implementieren\n- Multi-Agent-Orchestrierung (CrewAI, AutoGen, LangGraph)\n- MCP (Model Context Protocol) Server bauen\n- Memory: Short-term, Long-term, Episodic\n- Agent Loops und Reflection\n\n## Typische Aufgaben\n- Autonome Agenten mit Tools ausstatten\n- Multi-Agent-Workflows designen\n- Agenten-Outputs evaluieren und verbessern\n\n## Frameworks\nLangGraph, CrewAI, AutoGen, Claude Code SDK, OpenAI Assistants`,
    },
    en: {
      description: 'Autonomous agents, tool-use, multi-agent systems',
      content: `# AI Agent Development\n\n## Capabilities\n- Implement tool-use / function calling\n- Multi-agent orchestration (CrewAI, AutoGen, LangGraph)\n- Build MCP (Model Context Protocol) servers\n- Memory: short-term, long-term, episodic\n- Agent loops and reflection\n\n## Typical tasks\n- Equip autonomous agents with tools\n- Design multi-agent workflows\n- Evaluate and improve agent outputs\n\n## Frameworks\nLangGraph, CrewAI, AutoGen, Claude Code SDK, OpenAI Assistants`,
    },
  },
  {
    name: 'AI Image Generation',
    tags: ['image generation', 'stable diffusion', 'dalle', 'midjourney', 'flux', 'comfyui'],
    de: {
      description: 'Stable Diffusion, DALL-E, Midjourney, Flux',
      content: `# AI Image Generation\n\n## Fähigkeiten\n- Prompt-Engineering für Bildgenerierung\n- Stable Diffusion (SDXL, SD3, Flux)\n- ControlNet, LoRA, IP-Adapter\n- Inpainting und Outpainting\n- Batch-Generierung über API\n\n## Typische Aufgaben\n- Marketing-Assets generieren\n- Konzeptbilder und Mockups erstellen\n- Style-konsistente Bildserien produzieren\n\n## Tools\nComfyUI, A1111, Replicate API, DALL-E API, Midjourney`,
    },
    en: {
      description: 'Stable Diffusion, DALL-E, Midjourney, Flux',
      content: `# AI Image Generation\n\n## Capabilities\n- Prompt engineering for image generation\n- Stable Diffusion (SDXL, SD3, Flux)\n- ControlNet, LoRA, IP-Adapter\n- Inpainting and outpainting\n- Batch generation via API\n\n## Typical tasks\n- Generate marketing assets\n- Create concept art and mockups\n- Produce style-consistent image sets\n\n## Tools\nComfyUI, A1111, Replicate API, DALL-E API, Midjourney`,
    },
  },
  {
    name: 'Data Science & ML',
    tags: ['machine learning', 'data science', 'pandas', 'pytorch', 'sklearn', 'ml'],
    de: {
      description: 'Machine Learning, Pandas, scikit-learn, PyTorch',
      content: `# Data Science & Machine Learning\n\n## Fähigkeiten\n- Explorative Datenanalyse (EDA)\n- Feature Engineering\n- Klassifikation, Regression, Clustering\n- Deep Learning mit PyTorch/Keras\n- Modell-Evaluation und Hyperparameter-Tuning\n\n## Typische Aufgaben\n- Datensätze analysieren und visualisieren\n- ML-Modelle trainieren und evaluieren\n- Insights aus Daten extrahieren\n\n## Tools\npandas, numpy, scikit-learn, PyTorch, Jupyter, MLflow`,
    },
    en: {
      description: 'Machine learning, pandas, scikit-learn, PyTorch',
      content: `# Data Science & Machine Learning\n\n## Capabilities\n- Exploratory data analysis (EDA)\n- Feature engineering\n- Classification, regression, clustering\n- Deep learning with PyTorch/Keras\n- Model evaluation and hyperparameter tuning\n\n## Typical tasks\n- Analyze and visualize datasets\n- Train and evaluate ML models\n- Extract insights from data\n\n## Tools\npandas, numpy, scikit-learn, PyTorch, Jupyter, MLflow`,
    },
  },
  // Security
  {
    name: 'Security Audit',
    tags: ['security', 'audit', 'owasp', 'vulnerability', 'sast'],
    de: {
      description: 'OWASP Top 10, Code-Reviews, Vulnerability Assessment',
      content: `# Security Audit\n\n## Fähigkeiten\n- OWASP Top 10 Analyse und Behebung\n- Static Code Analysis (SAST)\n- Dependency Vulnerability Scanning\n- SQL Injection, XSS, CSRF Prevention\n- Secret Scanning und Leakage Prevention\n\n## Typische Aufgaben\n- Code auf Sicherheitslücken prüfen\n- Dependency-Report erstellen\n- Security-Checkliste abarbeiten\n\n## Tools\nSnyk, Semgrep, OWASP ZAP, Trivy, Bandit`,
    },
    en: {
      description: 'OWASP Top 10, code reviews, vulnerability assessment',
      content: `# Security Audit\n\n## Capabilities\n- OWASP Top 10 analysis and remediation\n- Static code analysis (SAST)\n- Dependency vulnerability scanning\n- SQL injection, XSS, CSRF prevention\n- Secret scanning and leakage prevention\n\n## Typical tasks\n- Audit code for security vulnerabilities\n- Produce a dependency report\n- Work through a security checklist\n\n## Tools\nSnyk, Semgrep, OWASP ZAP, Trivy, Bandit`,
    },
  },
  {
    name: 'Auth & Authorization',
    tags: ['auth', 'oauth', 'jwt', 'rbac', 'authentication', 'sso', 'better-auth'],
    de: {
      description: 'OAuth2, JWT, RBAC, SSO, better-auth',
      content: `# Authentication & Authorization\n\n## Fähigkeiten\n- OAuth2 / OIDC Flows (Authorization Code, PKCE)\n- JWT Handling (Signing, Expiry, Rotation)\n- RBAC und ABAC Implementierung\n- Session Management und Cookie Security\n- MFA (TOTP, WebAuthn/Passkeys)\n\n## Typische Aufgaben\n- Auth-System von Grund auf bauen\n- SSO integrieren (Google, GitHub, Microsoft)\n- Berechtigungssystem designen\n\n## Libraries\nbetter-auth, NextAuth.js, Clerk, Auth0, Supabase Auth`,
    },
    en: {
      description: 'OAuth2, JWT, RBAC, SSO, better-auth',
      content: `# Authentication & Authorization\n\n## Capabilities\n- OAuth2 / OIDC flows (authorization code, PKCE)\n- JWT handling (signing, expiry, rotation)\n- RBAC and ABAC implementation\n- Session management and cookie security\n- MFA (TOTP, WebAuthn/Passkeys)\n\n## Typical tasks\n- Build an auth system from scratch\n- Integrate SSO (Google, GitHub, Microsoft)\n- Design a permission system\n\n## Libraries\nbetter-auth, NextAuth.js, Clerk, Auth0, Supabase Auth`,
    },
  },
  {
    name: 'GDPR & Compliance',
    tags: ['gdpr', 'compliance', 'privacy', 'cookies', 'dsgvo'],
    de: {
      description: 'Datenschutz, GDPR, SOC2, Datenschutz-by-Design',
      content: `# DSGVO & Compliance\n\n## Fähigkeiten\n- DSGVO/GDPR Anforderungen umsetzen\n- Privacy-by-Design und Privacy-by-Default\n- Data Processing Agreements (DPA)\n- Cookie Consent und Opt-Out\n- Datenschutz-Folgenabschätzung (DSFA)\n\n## Typische Aufgaben\n- Datenschutzerklärung prüfen/erstellen\n- Cookie-Banner implementieren\n- Datenlöschprozesse einrichten\n\n## Tools\nCookiebot, OneTrust, iubenda`,
    },
    en: {
      description: 'Data protection, GDPR, SOC2, privacy-by-design',
      content: `# GDPR & Compliance\n\n## Capabilities\n- Meet GDPR requirements\n- Privacy-by-design and privacy-by-default\n- Data processing agreements (DPAs)\n- Cookie consent and opt-out\n- Data protection impact assessments (DPIAs)\n\n## Typical tasks\n- Review/create a privacy policy\n- Implement a cookie banner\n- Set up data deletion processes\n\n## Tools\nCookiebot, OneTrust, iubenda`,
    },
  },
  // Design
  {
    name: 'UI/UX Design',
    tags: ['ui', 'ux', 'figma', 'design', 'wireframe', 'usability'],
    de: {
      description: 'User Interface Design, Wireframing, Usability',
      content: `# UI/UX Design\n\n## Fähigkeiten\n- User Research und Personas\n- Wireframing und Prototyping (Figma)\n- Usability Testing und Heuristic Evaluation\n- Information Architecture\n- Design Handoff und Developer Collaboration\n\n## Typische Aufgaben\n- UX für neue Features konzipieren\n- Bestehende Flows optimieren\n- Design-Feedback strukturieren\n\n## Tools\nFigma, FigJam, Maze, Hotjar, FullStory`,
    },
    en: {
      description: 'User interface design, wireframing, usability',
      content: `# UI/UX Design\n\n## Capabilities\n- User research and personas\n- Wireframing and prototyping (Figma)\n- Usability testing and heuristic evaluation\n- Information architecture\n- Design handoff and developer collaboration\n\n## Typical tasks\n- Conceptualize UX for new features\n- Optimize existing flows\n- Structure design feedback\n\n## Tools\nFigma, FigJam, Maze, Hotjar, FullStory`,
    },
  },
  {
    name: 'Design Systems',
    tags: ['design system', 'component library', 'storybook', 'shadcn', 'tokens'],
    de: {
      description: 'Komponentenbibliotheken, Tokens, shadcn/ui, Storybook',
      content: `# Design Systems\n\n## Fähigkeiten\n- Design Token Architektur (Farbe, Spacing, Typo)\n- Komponentenbibliotheken in React/Vue\n- Storybook für Dokumentation\n- shadcn/ui, Radix UI als Basis\n- Theme-System und Dark Mode\n\n## Typische Aufgaben\n- Komponentensystem aufbauen\n- Design Tokens definieren\n- Storybook-Stories schreiben\n\n## Tools\nStorybook, shadcn/ui, Radix UI, Tailwind CSS, Style Dictionary`,
    },
    en: {
      description: 'Component libraries, tokens, shadcn/ui, Storybook',
      content: `# Design Systems\n\n## Capabilities\n- Design token architecture (color, spacing, typography)\n- Component libraries in React/Vue\n- Storybook for documentation\n- shadcn/ui, Radix UI as the foundation\n- Theme system and dark mode\n\n## Typical tasks\n- Build a component system\n- Define design tokens\n- Write Storybook stories\n\n## Tools\nStorybook, shadcn/ui, Radix UI, Tailwind CSS, Style Dictionary`,
    },
  },
  {
    name: 'Brand Design',
    tags: ['brand', 'logo', 'corporate identity', 'style guide', 'brand guidelines'],
    de: {
      description: 'Corporate Identity, Logo, Farb- und Typografie-Systeme',
      content: `# Brand Design\n\n## Fähigkeiten\n- Brand Identity Entwicklung\n- Logo Design und Varianten\n- Farbpaletten und Typografie-Systeme\n- Brand Guidelines erstellen\n- Anwendungsbeispiele (Mockups, Templates)\n\n## Typische Aufgaben\n- Brand-Refresh konzipieren\n- Style Guide dokumentieren\n- Assets für Web und Print erstellen\n\n## Tools\nFigma, Adobe Illustrator, Canva`,
    },
    en: {
      description: 'Corporate identity, logo, color and typography systems',
      content: `# Brand Design\n\n## Capabilities\n- Brand identity development\n- Logo design and variants\n- Color palettes and typography systems\n- Create brand guidelines\n- Application examples (mockups, templates)\n\n## Typical tasks\n- Conceptualize a brand refresh\n- Document a style guide\n- Create assets for web and print\n\n## Tools\nFigma, Adobe Illustrator, Canva`,
    },
  },
  // Marketing
  {
    name: 'SEO Optimization',
    tags: ['seo', 'search engine', 'keyword', 'google', 'ranking'],
    de: {
      description: 'On-Page SEO, technisches SEO, Keyword-Recherche',
      content: `# SEO Optimierung\n\n## Fähigkeiten\n- Technisches SEO (Core Web Vitals, Crawlbarkeit)\n- On-Page Optimierung (Meta, Headings, Schema.org)\n- Keyword-Recherche und Wettbewerbsanalyse\n- Backlink-Aufbau und Linkable Assets\n- Local SEO und Google Business Profile\n\n## Typische Aufgaben\n- SEO-Audit durchführen\n- Content für Target-Keywords optimieren\n- Technische Probleme beheben\n\n## Tools\nSemrush, Ahrefs, Google Search Console, Screaming Frog`,
    },
    en: {
      description: 'On-page SEO, technical SEO, keyword research',
      content: `# SEO Optimization\n\n## Capabilities\n- Technical SEO (Core Web Vitals, crawlability)\n- On-page optimization (meta, headings, Schema.org)\n- Keyword research and competitor analysis\n- Backlink building and linkable assets\n- Local SEO and Google Business Profile\n\n## Typical tasks\n- Conduct SEO audits\n- Optimize content for target keywords\n- Fix technical issues\n\n## Tools\nSemrush, Ahrefs, Google Search Console, Screaming Frog`,
    },
  },
  {
    name: 'Copywriting',
    tags: ['copywriting', 'conversion', 'landing page', 'cta', 'sales'],
    de: {
      description: 'Verkaufstexte, Headlines, CTAs, Landing Pages',
      content: `# Copywriting\n\n## Fähigkeiten\n- Persuasive Headlines und Hooks\n- AIDA und PAS Frameworks\n- Value Propositions formulieren\n- CTAs und Conversion-Optimierung\n- Tone of Voice entwickeln\n\n## Typische Aufgaben\n- Landing Page texten\n- Email-Sequenzen schreiben\n- Ad-Copy für Meta/Google entwickeln\n- Produktbeschreibungen optimieren\n\n## Frameworks\nAIDA, PAS, BAB, StoryBrand`,
    },
    en: {
      description: 'Sales copy, headlines, CTAs, landing pages',
      content: `# Copywriting\n\n## Capabilities\n- Persuasive headlines and hooks\n- AIDA and PAS frameworks\n- Craft value propositions\n- CTAs and conversion optimization\n- Develop tone of voice\n\n## Typical tasks\n- Write landing page copy\n- Write email sequences\n- Develop ad copy for Meta/Google\n- Optimize product descriptions\n\n## Frameworks\nAIDA, PAS, BAB, StoryBrand`,
    },
  },
  {
    name: 'Content Strategy',
    tags: ['content strategy', 'blog', 'newsletter', 'editorial', 'content'],
    de: {
      description: 'Content-Planung, Redaktionsplan, Blog, Newsletter',
      content: `# Content Strategy\n\n## Fähigkeiten\n- Content-Audit und Gap-Analyse\n- Redaktionsplan und Content-Kalender\n- Blog und Long-Form Content\n- Newsletter-Strategie\n- Thought Leadership und Personal Branding\n\n## Typische Aufgaben\n- Content-Strategie entwickeln\n- Artikel-Briefings erstellen\n- Content-Performance analysieren\n\n## Metriken\nOrganischer Traffic, Time on Page, Email-Öffnungsrate, Conversion Rate`,
    },
    en: {
      description: 'Content planning, editorial calendar, blog, newsletter',
      content: `# Content Strategy\n\n## Capabilities\n- Content audit and gap analysis\n- Editorial plan and content calendar\n- Blog and long-form content\n- Newsletter strategy\n- Thought leadership and personal branding\n\n## Typical tasks\n- Develop a content strategy\n- Create article briefs\n- Analyze content performance\n\n## Metrics\nOrganic traffic, time on page, email open rate, conversion rate`,
    },
  },
  {
    name: 'Social Media Marketing',
    tags: ['social media', 'linkedin', 'instagram', 'tiktok', 'community'],
    de: {
      description: 'LinkedIn, Instagram, X, TikTok Content und Growth',
      content: `# Social Media Marketing\n\n## Fähigkeiten\n- Plattform-spezifische Content-Strategien\n- LinkedIn B2B Content und Thought Leadership\n- Instagram und TikTok Visual Storytelling\n- Community Building und Engagement\n- Social Media Ads (Meta, LinkedIn)\n\n## Typische Aufgaben\n- Content-Kalender erstellen\n- Posts für verschiedene Plattformen texten\n- Hashtag-Strategien entwickeln\n- Performance-Reports erstellen\n\n## Tools\nBuffer, Hootsuite, Later, Canva, Capcut`,
    },
    en: {
      description: 'LinkedIn, Instagram, X, TikTok content and growth',
      content: `# Social Media Marketing\n\n## Capabilities\n- Platform-specific content strategies\n- LinkedIn B2B content and thought leadership\n- Instagram and TikTok visual storytelling\n- Community building and engagement\n- Social media ads (Meta, LinkedIn)\n\n## Typical tasks\n- Create content calendars\n- Write posts for different platforms\n- Develop hashtag strategies\n- Create performance reports\n\n## Tools\nBuffer, Hootsuite, Later, Canva, Capcut`,
    },
  },
  {
    name: 'Email Marketing',
    tags: ['email', 'newsletter', 'cold email', 'drip', 'deliverability'],
    de: {
      description: 'Newsletter, Cold Email, Sequenzen, Deliverability',
      content: `# Email Marketing\n\n## Fähigkeiten\n- Cold Email Campaigns und Personalisierung\n- Newsletter-Design und Copywriting\n- Drip-Sequenzen und Automation\n- Deliverability-Optimierung (SPF, DKIM, DMARC)\n- A/B Testing von Subject Lines und Content\n\n## Typische Aufgaben\n- Email-Sequenz schreiben\n- Newsletter-Template gestalten\n- Open- und Click-Rates verbessern\n\n## Tools\nMailchimp, Brevo, ConvertKit, Instantly, Apollo`,
    },
    en: {
      description: 'Newsletters, cold email, sequences, deliverability',
      content: `# Email Marketing\n\n## Capabilities\n- Cold email campaigns and personalization\n- Newsletter design and copywriting\n- Drip sequences and automation\n- Deliverability optimization (SPF, DKIM, DMARC)\n- A/B testing of subject lines and content\n\n## Typical tasks\n- Write email sequences\n- Design newsletter templates\n- Improve open and click rates\n\n## Tools\nMailchimp, Brevo, ConvertKit, Instantly, Apollo`,
    },
  },
  {
    name: 'Paid Advertising',
    tags: ['ads', 'google ads', 'meta ads', 'linkedin ads', 'roas', 'paid'],
    de: {
      description: 'Google Ads, Meta Ads, LinkedIn Ads, ROAS-Optimierung',
      content: `# Paid Advertising\n\n## Fähigkeiten\n- Google Ads (Search, Display, Performance Max)\n- Meta Ads (Facebook, Instagram Campaigns)\n- LinkedIn Ads für B2B\n- Audience-Segmentierung und Retargeting\n- ROAS-Optimierung und Budget-Allokation\n\n## Typische Aufgaben\n- Kampagnen aufsetzen und optimieren\n- Ad Creative und Copy entwickeln\n- Conversion Tracking einrichten\n\n## Tools\nGoogle Ads Manager, Meta Business Suite, LinkedIn Campaign Manager`,
    },
    en: {
      description: 'Google Ads, Meta Ads, LinkedIn Ads, ROAS optimization',
      content: `# Paid Advertising\n\n## Capabilities\n- Google Ads (Search, Display, Performance Max)\n- Meta Ads (Facebook, Instagram campaigns)\n- LinkedIn Ads for B2B\n- Audience segmentation and retargeting\n- ROAS optimization and budget allocation\n\n## Typical tasks\n- Set up and optimize campaigns\n- Develop ad creative and copy\n- Set up conversion tracking\n\n## Tools\nGoogle Ads Manager, Meta Business Suite, LinkedIn Campaign Manager`,
    },
  },
  // Research
  {
    name: 'Web Research',
    tags: ['research', 'web research', 'competitive intelligence', 'fact check'],
    de: {
      description: 'Tiefgehende Online-Recherche, Quellenvalidierung',
      content: `# Web Research\n\n## Fähigkeiten\n- Fortgeschrittene Google-Suche (Operatoren, Boolean)\n- Quellenvalidierung und Fact-Checking\n- Competitive Intelligence\n- Deep Web und Fachdatenbanken\n- Zusammenfassen und Strukturieren\n\n## Typische Aufgaben\n- Markt- und Wettbewerbsrecherche\n- Branchentrends identifizieren\n- Technologievergleiche erstellen\n- Fakten-Checks durchführen\n\n## Tools\nGoogle (Advanced), Perplexity, Consensus, Scholar, Statista`,
    },
    en: {
      description: 'Deep online research, source validation',
      content: `# Web Research\n\n## Capabilities\n- Advanced Google search (operators, boolean)\n- Source validation and fact-checking\n- Competitive intelligence\n- Deep web and specialized databases\n- Summarizing and structuring\n\n## Typical tasks\n- Market and competitor research\n- Identify industry trends\n- Create technology comparisons\n- Conduct fact-checks\n\n## Tools\nGoogle (Advanced), Perplexity, Consensus, Scholar, Statista`,
    },
  },
  {
    name: 'Market Research',
    tags: ['market research', 'competitor analysis', 'tam', 'buyer persona'],
    de: {
      description: 'Marktanalyse, Wettbewerbsanalyse, TAM/SAM/SOM',
      content: `# Market Research\n\n## Fähigkeiten\n- TAM/SAM/SOM Berechnung\n- Wettbewerbsmatrix und -analyse\n- Kundeninterviews und Surveys\n- Buyer Personas entwickeln\n- Preisstrategien und Benchmarking\n\n## Typische Aufgaben\n- Marktgröße schätzen\n- Wettbewerber analysieren\n- Zielgruppen-Interviews auswerten\n\n## Frameworks\nPorters Five Forces, SWOT, Jobs-to-be-Done, Blue Ocean`,
    },
    en: {
      description: 'Market analysis, competitor analysis, TAM/SAM/SOM',
      content: `# Market Research\n\n## Capabilities\n- TAM/SAM/SOM calculation\n- Competitor matrix and analysis\n- Customer interviews and surveys\n- Develop buyer personas\n- Pricing strategies and benchmarking\n\n## Typical tasks\n- Estimate market size\n- Analyze competitors\n- Evaluate target audience interviews\n\n## Frameworks\nPorter's Five Forces, SWOT, Jobs-to-be-Done, Blue Ocean`,
    },
  },
  {
    name: 'Web Scraping',
    tags: ['scraping', 'playwright', 'firecrawl', 'data extraction', 'crawl'],
    de: {
      description: 'Datenextraktion mit Playwright, Firecrawl',
      content: `# Web Scraping\n\n## Fähigkeiten\n- Browser Automation mit Playwright\n- API-basiertes Scraping mit Firecrawl\n- JavaScript-Rendering und Dynamic Content\n- Rate Limiting und Politeness\n- Daten-Pipeline und Strukturierung\n\n## Typische Aufgaben\n- Preise und Produkte tracken\n- Leads und Kontakte sammeln\n- Content für RAG extrahieren\n\n## Tools\nPlaywright, Puppeteer, Firecrawl, BeautifulSoup, Scrapy`,
    },
    en: {
      description: 'Data extraction with Playwright, Firecrawl',
      content: `# Web Scraping\n\n## Capabilities\n- Browser automation with Playwright\n- API-based scraping with Firecrawl\n- JavaScript rendering and dynamic content\n- Rate limiting and politeness\n- Data pipeline and structuring\n\n## Typical tasks\n- Track prices and products\n- Collect leads and contacts\n- Extract content for RAG\n\n## Tools\nPlaywright, Puppeteer, Firecrawl, BeautifulSoup, Scrapy`,
    },
  },
  // Automation
  {
    name: 'Browser Automation',
    tags: ['playwright', 'puppeteer', 'browser automation', 'e2e', 'headless'],
    de: {
      description: 'Playwright, Puppeteer für Test und Prozessautomatisierung',
      content: `# Browser Automation\n\n## Fähigkeiten\n- Playwright für Cross-Browser-Tests\n- Puppeteer für Chrome Automation\n- Screenshot und PDF-Generierung\n- Form-Filling und Navigation-Automation\n- Selector-Strategien (CSS, XPath, Role)\n\n## Typische Aufgaben\n- E2E-Testsuiten schreiben\n- Web-Workflows automatisieren\n- Screenshots für Monitoring\n\n## Tools\nPlaywright, Puppeteer, Selenium, browser-use`,
    },
    en: {
      description: 'Playwright, Puppeteer for test and process automation',
      content: `# Browser Automation\n\n## Capabilities\n- Playwright for cross-browser testing\n- Puppeteer for Chrome automation\n- Screenshot and PDF generation\n- Form filling and navigation automation\n- Selector strategies (CSS, XPath, role)\n\n## Typical tasks\n- Write E2E test suites\n- Automate web workflows\n- Screenshots for monitoring\n\n## Tools\nPlaywright, Puppeteer, Selenium, browser-use`,
    },
  },
  {
    name: 'Workflow Automation (n8n / Make)',
    tags: ['n8n', 'zapier', 'make', 'no-code', 'workflow', 'automation'],
    de: {
      description: 'No-Code Automatisierung, n8n, Zapier, Make',
      content: `# Workflow Automation\n\n## Fähigkeiten\n- n8n Self-Hosted Workflows\n- Zapier und Make (Integromat) Flows\n- Webhook-basierte Trigger\n- API-Integrationen ohne Code\n- Error Handling und Retry-Logik\n\n## Typische Aufgaben\n- Manuelle Prozesse automatisieren\n- App-Integrationen bauen\n- Notifications und Alerts einrichten\n\n## Tools\nn8n, Zapier, Make (Integromat), Pipedream, Activepieces`,
    },
    en: {
      description: 'No-code automation: n8n, Zapier, Make',
      content: `# Workflow Automation\n\n## Capabilities\n- n8n self-hosted workflows\n- Zapier and Make (Integromat) flows\n- Webhook-based triggers\n- API integrations without code\n- Error handling and retry logic\n\n## Typical tasks\n- Automate manual processes\n- Build app integrations\n- Set up notifications and alerts\n\n## Tools\nn8n, Zapier, Make (Integromat), Pipedream, Activepieces`,
    },
  },
  {
    name: 'Shell Scripting & Bash',
    tags: ['bash', 'shell', 'scripting', 'linux', 'cron', 'cli'],
    de: {
      description: 'Bash, Linux-Administration, Cron-Jobs',
      content: `# Shell Scripting & Bash\n\n## Fähigkeiten\n- Bash-Scripting (Variablen, Loops, Conditionals)\n- Linux System Administration\n- Cron-Jobs und scheduled Tasks\n- File und Prozess-Management\n- Pipe-Chains und Textverarbeitung (awk, sed, grep)\n\n## Typische Aufgaben\n- Deployment-Skripte schreiben\n- Cron-Jobs einrichten\n- Log-Analyse automatisieren\n\n## Tools\nbash, zsh, tmux, systemd, cron`,
    },
    en: {
      description: 'Bash, Linux administration, cron jobs',
      content: `# Shell Scripting & Bash\n\n## Capabilities\n- Bash scripting (variables, loops, conditionals)\n- Linux system administration\n- Cron jobs and scheduled tasks\n- File and process management\n- Pipe chains and text processing (awk, sed, grep)\n\n## Typical tasks\n- Write deployment scripts\n- Set up cron jobs\n- Automate log analysis\n\n## Tools\nbash, zsh, tmux, systemd, cron`,
    },
  },
  // Productivity
  {
    name: 'Google Workspace',
    tags: ['google workspace', 'google sheets', 'gmail', 'google docs', 'calendar'],
    de: {
      description: 'Google Docs, Sheets, Gmail, Calendar via API',
      content: `# Google Workspace\n\n## Fähigkeiten\n- Google Sheets: komplexe Formeln, Apps Script\n- Google Docs: Templates und Mail Merge\n- Gmail API: Emails automatisiert senden/lesen\n- Google Calendar API: Events managen\n- Drive API: Dateien organisieren\n\n## Typische Aufgaben\n- Reporting-Dashboards in Sheets bauen\n- Email-Automatisierung mit Gmail API\n- Docs-Templates für Dokumentation\n\n## Tools\nGoogle Apps Script, Google Workspace API, gspread (Python)`,
    },
    en: {
      description: 'Google Docs, Sheets, Gmail, Calendar via API',
      content: `# Google Workspace\n\n## Capabilities\n- Google Sheets: complex formulas, Apps Script\n- Google Docs: templates and mail merge\n- Gmail API: send/read emails programmatically\n- Google Calendar API: manage events\n- Drive API: organize files\n\n## Typical tasks\n- Build reporting dashboards in Sheets\n- Email automation with the Gmail API\n- Docs templates for documentation\n\n## Tools\nGoogle Apps Script, Google Workspace API, gspread (Python)`,
    },
  },
  {
    name: 'Project Management',
    tags: ['project management', 'agile', 'scrum', 'kanban', 'sprint', 'okr'],
    de: {
      description: 'Agile, Scrum, Kanban, Jira, Linear',
      content: `# Project Management\n\n## Fähigkeiten\n- Agile Methodik (Scrum, Kanban, SAFe)\n- Sprint Planning und Backlog Grooming\n- OKR Planung und Tracking\n- Stakeholder Management\n- Risk Assessment und Mitigation\n\n## Typische Aufgaben\n- Projektplan erstellen\n- Sprint planen und retrospektieren\n- Team-Koordination und Kommunikation\n\n## Tools\nLinear, Jira, Notion, Asana, ClickUp`,
    },
    en: {
      description: 'Agile, Scrum, Kanban, Jira, Linear',
      content: `# Project Management\n\n## Capabilities\n- Agile methodology (Scrum, Kanban, SAFe)\n- Sprint planning and backlog grooming\n- OKR planning and tracking\n- Stakeholder management\n- Risk assessment and mitigation\n\n## Typical tasks\n- Create project plans\n- Plan and retrospect sprints\n- Team coordination and communication\n\n## Tools\nLinear, Jira, Notion, Asana, ClickUp`,
    },
  },
  // Business
  {
    name: 'Business Strategy',
    tags: ['strategy', 'business model', 'okr', 'go-to-market', 'positioning'],
    de: {
      description: 'Strategieentwicklung, Business Model, OKRs, Go-to-Market',
      content: `# Business Strategy\n\n## Fähigkeiten\n- Business Model Canvas und Value Proposition\n- Go-to-Market Strategien\n- OKR Frameworks definieren\n- SWOT und Wettbewerbspositionierung\n- Pivot-Entscheidungen und Szenario-Planung\n\n## Typische Aufgaben\n- Strategiepapiere erstellen\n- OKRs formulieren\n- Business Case kalkulieren\n\n## Frameworks\nBusiness Model Canvas, Jobs-to-be-Done, Blue Ocean, OKRs`,
    },
    en: {
      description: 'Strategy development, business model, OKRs, go-to-market',
      content: `# Business Strategy\n\n## Capabilities\n- Business Model Canvas and value proposition\n- Go-to-market strategies\n- Define OKR frameworks\n- SWOT and competitive positioning\n- Pivot decisions and scenario planning\n\n## Typical tasks\n- Create strategy papers\n- Formulate OKRs\n- Calculate business cases\n\n## Frameworks\nBusiness Model Canvas, Jobs-to-be-Done, Blue Ocean, OKRs`,
    },
  },
  {
    name: 'Financial Analysis',
    tags: ['finance', 'financial', 'mrr', 'arr', 'saas metrics', 'unit economics'],
    de: {
      description: 'P&L, Budget, SaaS-Metriken, Unit Economics',
      content: `# Financial Analysis\n\n## Fähigkeiten\n- P&L Analyse und Reporting\n- SaaS-Metriken: MRR, ARR, Churn, LTV, CAC\n- Unit Economics und Break-Even-Analyse\n- Cashflow-Planung und Forecasting\n- Investitionsrechnung und ROI\n\n## Typische Aufgaben\n- Finanz-Dashboard erstellen\n- SaaS-Metriken tracken\n- Budget-Planungen entwickeln\n\n## Tools\nGoogle Sheets, Excel, Stripe Dashboard, Baremetrics`,
    },
    en: {
      description: 'P&L, budget, SaaS metrics, unit economics',
      content: `# Financial Analysis\n\n## Capabilities\n- P&L analysis and reporting\n- SaaS metrics: MRR, ARR, churn, LTV, CAC\n- Unit economics and break-even analysis\n- Cashflow planning and forecasting\n- Investment calculation and ROI\n\n## Typical tasks\n- Build a financial dashboard\n- Track SaaS metrics\n- Develop budget plans\n\n## Tools\nGoogle Sheets, Excel, Stripe Dashboard, Baremetrics`,
    },
  },
  {
    name: 'Customer Success',
    tags: ['customer success', 'churn', 'nps', 'onboarding', 'retention', 'support'],
    de: {
      description: 'Kundenbindung, Support, Churn-Reduktion, NPS',
      content: `# Customer Success\n\n## Fähigkeiten\n- Onboarding-Prozesse designen\n- Churn-Prävention und Early Warning Signs\n- NPS-Befragungen und Feedback-Analyse\n- Eskalations-Management\n- QBRs (Quarterly Business Reviews)\n\n## Typische Aufgaben\n- Onboarding-Materialien erstellen\n- Churning Customers identifizieren\n- Support-Prozesse verbessern\n\n## Tools\nIntercom, HubSpot, Gainsight, Zendesk`,
    },
    en: {
      description: 'Retention, support, churn reduction, NPS',
      content: `# Customer Success\n\n## Capabilities\n- Design onboarding processes\n- Churn prevention and early warning signs\n- NPS surveys and feedback analysis\n- Escalation management\n- QBRs (Quarterly Business Reviews)\n\n## Typical tasks\n- Create onboarding materials\n- Identify churning customers\n- Improve support processes\n\n## Tools\nIntercom, HubSpot, Gainsight, Zendesk`,
    },
  },
];
