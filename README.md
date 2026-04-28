<div align="center">

<img width="2000" height="600" alt="x_banner" src="https://github.com/user-attachments/assets/186b7ef0-c1a9-415d-9225-72ff028bcdb0" />

# OpenCognit

**Build Your Zero Human Company.**

The open-source AI agent OS — CEO orchestrator, persistent memory, real execution, atomic budgets. Self-hosted. No cloud lock-in. Free forever.

[![AGPL-3.0 License](https://img.shields.io/badge/license-AGPL--3.0-cyan)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-green)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org)
[![GitHub Stars](https://img.shields.io/github/stars/OpenCognit/opencognit?style=social)](https://github.com/OpenCognit/opencognit/stargazers)

[🚀 Quick Start](#quick-start) · [💬 Community](https://github.com/OpenCognit/opencognit/discussions) · [☕ Support](https://ko-fi.com/opencognit)

---

**If OpenCognit saves you time, a ⭐ star helps others find it.**

</div>

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

## Is OpenCognit right for you?

**Yes, if:**
- You want AI agents that actually *remember* — not just across a conversation, but across days and weeks
- Your CEO agent should reason about the company state before delegating, not just execute prompts
- You need a Critic loop — no silent "done" without quality review
- You want hard budget limits enforced at the cent level, not just estimates after the fact
- You need an org chart, not a pipeline — agents with roles, hierarchies, and peer meetings
- You're building something real and want the full control plane: Goals, Kanban, War Room, Activity Feed

**Probably not, if:**
- You just want to chain a few prompts together — use LangChain or a simple script
- You need a no-code drag-and-drop workflow builder — try n8n
- You only ever run one agent at a time

---

## Why OpenCognit?

| Problem | OpenCognit |
|---|---|
| Agents lose context on restart | Persistent Memory per agent (MemPalace + Semantic) |
| No quality control — agents ship anything | **Critic/Evaluator Loop**: every output reviewed before done |
| API costs run away overnight | Atomic Budgets: agents pause at your limit + forecast |
| Task context lost between agents | **Task-DAG**: blocker results flow downstream automatically |
| Sequential agent wakeups (slow) | **Parallel wakeups** via `Promise.all` + worker pool |
| Manual task orchestration | CEO Extended Thinking: Sonnet reasons before acting |
| No memory across sessions | SOUL documents + MemPalace + Semantic Memory per agent |
| Agents can't trust each other | **Trust & Reputation** scoring per agent pair |
| Scattered configs | Full UI: Org Chart, Goals, Kanban, War Room, Plugin Manager |

---

## Core Features

### 🧠 CEO Orchestrator with Extended Thinking
The CEO agent uses `claude-sonnet-4-6` with Anthropic's **Extended Thinking** — it reasons step-by-step before making decisions. It delegates tasks via native tool calls, calls team meetings, and requests board approval for hiring.

### 💾 Persistent Memory System (MemPalace)
Each agent has its own memory with **Rooms** (key-value), **Diary** (structured entries), and a **Knowledge Graph** (subject-predicate-object triplets). Agents tag important outputs with `[REMEMBER:room]` — parsed and saved automatically. Old memories consolidate into LLM-compressed summaries.

### 🔍 Semantic Memory
Facts are stored as embedding vectors. Agents find relevant knowledge via **cosine similarity** — even if they use different words. A Research Agent storing "Competitor X lowered prices by 20% in Q3" can be found when the CEO asks "What do we know about market pricing?"

### 🔁 Planner → Executor → Critic Loop
Every task result goes through a lightweight evaluator (Haiku) before being marked `done`. If insufficient, the agent retries — up to 2 times — before escalating to HITL (Human-in-the-Loop). No silent failures.

### 🤝 Trust & Reputation
Agents build trust scores with each other over time based on task outcomes, critic reviews, and peer feedback. The model router uses these scores to select the right agent for delegated subtasks.

### 🔗 Task DAG (Dependency Graph)
Define blocking relationships between tasks. When Task A completes, dependent tasks are automatically unlocked and their assigned agents are woken — no manual intervention. Cycles are detected and rejected at creation time.

### 🪪 SOUL Documents
Each agent gets a structured identity document — **IDENTITY, DECISION PRINCIPLES, CYCLE CHECKLIST, PERSONALITY** — generated by LLM or hand-crafted. Solves the "Memento Problem" where agents forget who they are across sessions.

### 🏗️ Plugin Framework
Extend OpenCognit without touching core code. Plugins can register API endpoints, inject Dashboard widgets, add sidebar navigation, and emit/receive events. Built-in: Analytics Plugin, extended Ollama provider.

### ⏱️ Configurable Heartbeat
Each agent wakes on its own schedule (5m, 15m, 1h, 24h, or custom cron). The heartbeat processes inbox tasks, runs adapters, tracks costs, feeds results back to the team, and handles HITL approval gates.

### 🏢 Full Control Plane
- **Dashboard** — Alert strip, Hero KPIs, live agent grid, system pulse
- **War Room** — full-screen mission control with animated counters
- **Meetings** — agents call peer meetings, synthesize results
- **Goals (OKR)** — 4-level hierarchy, progress tracking
- **Kanban** — tasks with Critic-reviewed outputs
- **Activity** — 28-day heatmap, filtered feed
- **Routines** — cron-based automations
- **Memory** — browsable agent MemPalace with Knowledge Graph viz
- **Semantic Search** — cross-agent knowledge retrieval
- **Worker Nodes** — multi-node execution pool management
- **Plugins** — install, enable, configure plugins from the UI
- **Telegram + Discord** — mobile interface with `/status`, `/tasks`, free-form chat

---

## Quick Start

### Option A — One-line installer (recommended)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/OpenCognit/opencognit/main/install.sh)
```

Interactive wizard: asks for project name + optional API key, clones the repo, installs deps, generates secrets, migrates DB, builds frontend. Done in under 2 minutes.

```bash
opencognit
# → http://localhost:3201
```

---

### Option B — Docker

```bash
git clone https://github.com/OpenCognit/opencognit.git
cd opencognit
docker compose up
# → http://localhost:3201
```

> **Data is persisted** in `./data/` — safe across restarts.

---

### Option C — Manual Setup

**Requirements:** Node.js ≥ 20

```bash
git clone https://github.com/OpenCognit/opencognit.git
cd opencognit
bash setup.sh   # installs deps, generates keys, migrates DB, builds frontend
npm start
# → http://localhost:3201
```

---

### First Steps After Setup

1. **Create your company** — name it, describe its goal
2. **Configure API keys** — Settings → add Anthropic or OpenRouter key
3. **Set default model** — Settings → Standard-Modell (all agents use this unless overridden)
4. **Add a CEO agent** — set connection type to `ceo`, enable Orchestrator flag
5. **Add worker agents** — give them roles, skills, heartbeat intervals
6. **Create your first goal** — CEO will start breaking it down autonomously

---

## Supported AI Providers

| Provider | Use Case |
|---|---|
| **Anthropic (Claude)** | CEO Extended Thinking, Critic Loop, SOUL generation |
| **OpenRouter** | Worker agents (100+ models, unified API) |
| **OpenAI** | GPT-4o, GPT-4o-mini, text-embedding-3-small |
| **Ollama** | Local models (Llama 3, Mistral, Qwen, etc.) |
| **Google (Gemini)** | Gemini Pro / Flash via API |
| **Moonshot / Kimi** | Kimi k1.5, Moonshot models |
| **Claude Code CLI** | Code execution with session persistence |
| **Gemini CLI** | Google models via CLI |
| **Codex CLI** | OpenAI Codex via CLI |
| **Poe** | Multi-model access via Poe API |
| **Bash** | Shell command execution |
| **HTTP** | External REST APIs |
| **Browser** | Web automation |
| **Email** | Email send/receive |
| **OpenClaw Gateway** | Connect existing OpenClaw agents with their full knowledge base |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        React 19 Frontend                          │
│  Dashboard · Agents · Tasks · Meetings · Goals · War Room        │
│  Memory Palace · Semantic Search · Plugins · Worker Nodes        │
└───────────────────────────┬──────────────────────────────────────┘
                            │ REST + WebSocket + SSE
┌───────────────────────────▼──────────────────────────────────────┐
│                      Express 5 API Server                         │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                 Heartbeat Engine (modular)                 │    │
│  │  context-builder · critic · budget · notifications        │    │
│  │  actions-orchestrator · actions-worker · dependencies     │    │
│  │  guardrails · self-healing · learning-loop · HITL         │    │
│  └──────────────────────────┬────────────────────────────────┘    │
│                             │                                     │
│  ┌─────────────┐  ┌─────────▼──────────┐  ┌──────────────────┐  │
│  │ Cron Sched  │  │  Adapter Registry   │  │  CEO Adapter     │  │
│  │ (30s tick)  │  │  Bash · HTTP        │  │  + Thinking      │  │
│  └─────────────┘  │  Claude Code · CLI  │  └──────────────────┘  │
│                   │  OpenRouter · LLM   │                         │
│                   │  Browser · Email    │                         │
│                   └─────────┬──────────┘                         │
│                             │                                     │
│  ┌──────────────────────────▼─────────────────────────────────┐  │
│  │                   Memory Layer                               │  │
│  │  MemPalace (Rooms · Diary · Knowledge Graph · Summaries)   │  │
│  │  Semantic Memory (Embeddings · FTS5 · Cosine Similarity)   │  │
│  │  Shared Memory · Actor-Aware Memory                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                             │                                     │
│  ┌──────────────────────────▼─────────────────────────────────┐  │
│  │                  Agent Intelligence                          │  │
│  │  Trust & Reputation · Consensus · Contract-Net Protocol    │  │
│  │  Self-Organization · Task-DAG Resolver · Model Router      │  │
│  │  Skill Embeddings · Agent Spawning · Background Review     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                             │                                     │
│  ┌──────────────────────────▼─────────────────────────────────┐  │
│  │                   Plugin Framework                           │  │
│  │  Plugin Manager · Event Emitter · Abstract Plugin           │  │
│  │  Builtin: Analytics · Ollama Extended                      │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────┐
│          SQLite / PostgreSQL (self-hosted, no cloud)              │
│  35+ tables: Agents · Tasks · Goals · Memory · Budget · etc.     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 6 |
| UI | Vintage professional dark design system, Lucide icons |
| Routing | React Router v7 |
| Backend | Express 5 (Node.js) |
| Database | SQLite via `better-sqlite3` + Drizzle ORM (PostgreSQL parity) |
| Auth | JWT + bcrypt + HMAC agent auth |
| Real-time | WebSocket + SSE |
| Language | TypeScript (strict, full-stack) |
| Testing | Vitest (70 unit tests) + Playwright (9 E2E tests) |
| Runtimes | Claude Code CLI · Gemini CLI · Codex CLI · Anthropic · OpenRouter · Ollama · OpenAI |

---

## Project Structure

```
opencognit/
├── server/
│   ├── index.ts                    # Express + all API endpoints
│   ├── db/
│   │   ├── schema.ts               # Drizzle schema (SQLite)
│   │   └── schema.pg.ts            # Drizzle schema (PostgreSQL, full parity)
│   ├── adapters/
│   │   ├── ceo.ts                  # CEO Orchestrator + Extended Thinking
│   │   ├── claude-code.ts          # Claude Code CLI adapter
│   │   ├── gemini-cli.ts           # Gemini CLI adapter
│   │   ├── codex-cli.ts            # Codex CLI adapter
│   │   ├── kimi-cli.ts             # Kimi/Moonshot CLI adapter
│   │   ├── browser.ts              # Web automation adapter
│   │   ├── sandbox.ts              # Sandboxed execution
│   │   ├── llm-wrapper.ts          # Unified LLM interface
│   │   └── registry.ts             # Adapter auto-selection
│   ├── services/
│   │   ├── heartbeat/              # Modular heartbeat engine
│   │   │   ├── service.ts          # HeartbeatServiceImpl (orchestrator)
│   │   │   ├── critic.ts           # Critic loop + HITL escalation
│   │   │   ├── context-builder.ts  # Memory/goal/workspace injection
│   │   │   ├── actions-orchestrator.ts
│   │   │   ├── actions-worker.ts
│   │   │   ├── dependencies.ts     # Task chaining + blocker scan
│   │   │   ├── notifications.ts    # CEO feedback loop + meetings
│   │   │   ├── budget.ts           # Budget enforcement
│   │   │   └── utils.ts
│   │   ├── semantic-memory.ts      # Embeddings + vector search
│   │   ├── trust-reputation.ts     # Agent trust scoring
│   │   ├── consensus.ts            # Multi-agent consensus protocol
│   │   ├── contract-net.ts         # Agent negotiation (CNP)
│   │   ├── self-organization.ts    # Autonomous team restructuring
│   │   ├── self-healing.ts         # Error recovery
│   │   ├── task-dag-resolver.ts    # Dependency graph + cycle detection
│   │   ├── model-router.ts         # Intelligent model selection
│   │   ├── worker-pool.ts          # Multi-node worker management
│   │   ├── budget-forecast.ts      # Budget projection
│   │   ├── guardrails.ts           # Safety constraints
│   │   ├── learning-loop.ts        # Agent performance improvement
│   │   ├── mcp-client.ts           # Model Context Protocol client
│   │   ├── memory.ts               # MemPalace core
│   │   ├── shared-memory.ts        # Cross-agent shared memory
│   │   ├── memory-auto.ts          # Auto-save + REMEMBER protocol
│   │   ├── cron.ts                 # Cron scheduler
│   │   ├── wakeup.ts               # Wakeup coalescing
│   │   └── messaging.ts            # Telegram + Discord + channels
│   ├── plugins/
│   │   ├── plugin-manager.ts       # Lifecycle + registration
│   │   ├── event-emitter.ts        # Plugin communication
│   │   ├── abstract-plugin.ts      # Base class
│   │   └── builtin/                # Built-in plugins
│   └── routes/
│       ├── webhooks.ts             # Telegram · Discord · Slack · Routines
│       └── semantic-memory.ts      # Semantic search endpoints
└── src/
    ├── pages/                      # 29 UI pages
    ├── components/                 # Shared components
    └── i18n/                       # DE + EN translations
```

---

## Self-Hosting

OpenCognit is **100% self-hosted**. Your data never leaves your machine:
- Database: SQLite file in `./data/`
- API keys: encrypted at rest
- No telemetry, no analytics, no external dependencies

The only outbound connections are the LLM API calls you configure.

---

## Roadmap

- [ ] Electron desktop app (one-click, no terminal)
- [ ] Agent marketplace (community plugins)
- [ ] Multi-tenant cloud deployment option
- [ ] Web-based IDE integration (Cursor / Windsurf)
- [ ] Mobile dashboard
- [ ] Agent OAuth delegation
- [ ] MCP server mode (expose agents as MCP tools)

---

## OpenCognit vs. Other AI Agent Frameworks

| | OpenCognit | AutoGPT | CrewAI | LangChain Agents | n8n AI |
|---|---|---|---|---|---|
| Multi-agent org chart | ✅ | ❌ | ✅ | ❌ | ❌ |
| CEO orchestrator | ✅ | ❌ | ❌ | ❌ | ❌ |
| Persistent per-agent memory | ✅ | ⚠️ | ❌ | ❌ | ❌ |
| Semantic memory (embeddings) | ✅ | ❌ | ❌ | ✅ | ❌ |
| Built-in Critic/QA loop | ✅ | ❌ | ❌ | ❌ | ❌ |
| Trust & reputation scoring | ✅ | ❌ | ❌ | ❌ | ❌ |
| Atomic budget per agent | ✅ | ❌ | ❌ | ❌ | ❌ |
| Task dependency graph (DAG) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Plugin framework | ✅ | ❌ | ❌ | ✅ | ✅ |
| Full UI (no code) | ✅ | ⚠️ | ❌ | ❌ | ✅ |
| Self-hosted, no cloud | ✅ | ✅ | ✅ | ✅ | ✅ |
| Local models (Ollama) | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| Claude Code CLI integration | ✅ | ❌ | ❌ | ❌ | ❌ |
| Free forever | ✅ | ✅ | ✅ | ✅ | ⚠️ |

> Looking for an **AutoGPT alternative**, **CrewAI alternative**, or **open-source multi-agent system**? OpenCognit adds a full org chart, persistent memory, semantic search, and a built-in quality loop on top.

---

## Contributing

Pull requests welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Support

OpenCognit is free and open-source. If it saves you time or helps your business, consider supporting development:

**[☕ Ko-fi](https://ko-fi.com/opencognit)**  
**[💖 GitHub Sponsors](https://github.com/sponsors/OpenCognit)**

Every contribution helps keep this project alive and actively maintained.

---

## License

AGPL-3.0 — see [LICENSE](./LICENSE)

---

<div align="center">
Built with TypeScript, React 19, Express 5 — and a lot of autonomous agents eating their own dogfood.
</div>
