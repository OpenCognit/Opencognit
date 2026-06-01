<div align="center">

<img width="2000" height="600" alt="x_banner" src="https://github.com/user-attachments/assets/186b7ef0-c1a9-415d-9225-72ff028bcdb0" />

# OpenCognit

**Build Your Zero Human Company.**

The AI agent orchestration OS — CEO orchestrator, persistent memory, real execution, atomic budgets. Self-hosted. No cloud lock-in.

[![Commercial License](https://img.shields.io/badge/license-Commercial-gold)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org)
[![GitHub Stars](https://img.shields.io/github/stars/OpenCognit/opencognit?style=social)](https://github.com/OpenCognit/opencognit/stargazers)

[🚀 Get OpenCognit Pro](https://opencognit.cloud) · [📖 Docs](https://opencognit.cloud/docs) 

[![Star History Chart](https://api.star-history.com/svg?repos=OpenCognit/opencognit&type=Date)](https://star-history.com/#OpenCognit/opencognit&Date)

</div>

---

## ⚠️ License Change Notice

> **This repository contains OpenCognit Community Edition v0.9.0, the final AGPL-3.0 release.**
>
> As of June 2026, OpenCognit is no longer open source. Active development continues under a **commercial license** as **OpenCognit Pro**.
>
> The Community Edition remains available under AGPL-3.0 but is **no longer maintained**. Security patches and new features are exclusive to Pro.
>
> [Read the full announcement →](https://opencognit.cloud/blog/license-change)

---

## What is OpenCognit?

OpenCognit is an **AI agent orchestration OS** — not a chatbot, not a single-agent wrapper. It runs a **virtual company** of autonomous AI agents that work together without you watching.

You set a goal. The CEO agent breaks it down, assigns tasks to specialists, reviews their work with a built-in Critic loop, and escalates blockers — while you sleep.

```
You → Goal → CEO Agent → Dev Agent → Writer Agent → Researcher Agent
                 ↑               ↓              ↓
          Persistent Memory ←── Critic ←── Results ←────┘
```

---

## OpenCognit Pro vs Community Edition

| Feature | Community Edition (AGPL) | OpenCognit Pro |
|---------|-------------------------|----------------|
| **License** | AGPL-3.0 | Commercial |
| **Active Development** | ❌ Archived | ✅ Continuous |
| **Security Patches** | ❌ None | ✅ Monthly |
| **Docker Sandbox** | ❌ Blocklist only | ✅ Mandatory isolation |
| **PostgreSQL Support** | ⚠️ Experimental | ✅ Production-ready |
| **Audit Logging** | ❌ | ✅ Full compliance trail |
| **Per-Tenant Rate Limiting** | ❌ | ✅ |
| **SSO / SAML** | ❌ | ✅ Enterprise |
| **Support** | ❌ | ✅ Email + Priority |
| **Price** | Free | From €29/mo |

---

## Core Features

- **CEO Orchestrator** — Extended Thinking before delegation
- **Persistent Memory** — MemPalace + Semantic + SOUL documents per agent
- **Critic Loop** — Every output reviewed before "done"
- **Atomic Budgets** — Hard limits enforced at the cent level
- **Task DAG** — Dependencies auto-resolve, downstream tasks unlock
- **War Room** — Live agent grid with real-time execution traces
- **Org Chart** — Agent hierarchies, roles, and peer meetings
- **Plugin System** — Custom adapters, widgets, API endpoints
- **MCP Server** — Use OpenCognit from Cursor, Claude Code, Windsurf
- **CLI Executor** — Live bash streaming with SSE

---

## Quick Start (Community Edition)

> ⚠️ The Community Edition is provided as-is without support or updates.

```bash
# 1. Clone
git clone https://github.com/OpenCognit/opencognit.git
cd opencognit

# 2. Setup
bash setup.sh

# 3. Run
npm run dev
```

The UI opens at `http://localhost:3200`. The API runs on `http://localhost:3201`.

---

## Get OpenCognit Pro

**OpenCognit Pro** is the actively developed, commercially licensed version with enterprise security, priority support, and regular updates.

### Pricing

| Plan | Price | Includes |
|------|-------|----------|
| **Solo** | €29/mo | 10 agents, 1 company, email support |
| **Team** | €99/mo | Unlimited agents, 5 companies, SSO, priority support |
| **Enterprise** | Custom | Unlimited everything, SAML, on-premise, SLA |

👉 **[Start Free Trial →](https://opencognit.cloud)**

---

## Architecture

```
┌─────────────────────────────────────────┐
│           React 19 + Vite 6             │
│     Glassmorphism UI, Dark Mode         │
└─────────────┬───────────────────────────┘
              │ REST / SSE / WebSocket
┌─────────────▼───────────────────────────┐
│      Express 5 + SQLite/PostgreSQL      │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐  │
│  │  CEO    │ │ Critic  │ │  Memory  │  │
│  │Orchestr.│ │  Loop   │ │  Palace  │  │
│  └─────────┘ └─────────┘ └──────────┘  │
│  ┌─────────┐ ┌─────────┐ ┌──────────┐  │
│  │  Task   │ │ Budget  │ │  Agent   │  │
│  │   DAG   │ │ Control │ │ Registry │  │
│  └─────────┘ └─────────┘ └──────────┘  │
└─────────────────────────────────────────┘
              │ Adapters (Anthropic, OpenAI, Ollama, ...)
┌─────────────▼───────────────────────────┐
│     LLM Providers + Local Models        │
└─────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, Tailwind CSS, Framer Motion |
| Backend | Express 5, TypeScript strict, ESM |
| Database | SQLite (WAL) / PostgreSQL |
| ORM | Drizzle ORM |
| Auth | BetterAuth + JWT fallback |
| Real-time | WebSocket + Server-Sent Events |
| Validation | Zod |
| Testing | Vitest + Playwright |

---

## Why the license change?

OpenCognit started as an AGPL project to push the boundaries of autonomous AI agents. After 6 months of development, the reality is clear:

- **AGPL blocks enterprise adoption** — legal teams reject it
- **No sustainable funding** — 30 stars don't pay server bills
- **Competitors** (Paperclip, CrewAI) have 1000× more resources with MIT/Apache

To keep building OpenCognit into a **production-grade product**, we need a sustainable model. The Community Edition remains free and open (AGPL). Pro funds continued development.

[Read the full reasoning →](https://opencognit.cloud/blog/license-change)

---

## Community

- 🐦 [X / Twitter](https://x.com/opencognit)
  

---

## License

This repository contains OpenCognit **Community Edition v0.9.0**, licensed under [AGPL-3.0](LICENSE-AGPL).

**OpenCognit Pro** is licensed under the [OpenCognit Commercial License Agreement](LICENSE).

Copyright © 2026 Panto. All rights reserved.
