# OpenCognit Roadmap v1 — From 16 Stars to Market Leader

> **Vision:** The most powerful, user-friendly, and extensible AI Agent OS.
> Compete with Paperclip, Hermes, AutoGen, CrewAI, and Dify.

---

## Phase 0: Foundation (Woche 1-2) — STOP THE BLEEDING

**Goal:** The codebase must compile, run, and not crash. Every feature works end-to-end.

| # | Task | Status |
|---|---|---|
| 0.1 | All code compiles without errors | ✅ Done |
| 0.2 | All code compiles without warnings | 🔄 In Progress |
| 0.3 | Every API route has a matching frontend call | 🔄 In Progress |
| 0.4 | i18n works without runtime errors | ✅ Done |
| 0.5 | Critic review works fairly | ✅ Done |
| 0.6 | Task-Execution works for all providers (Poe, Google, Moonshot, etc.) | ✅ Done |
| 0.7 | Tasks auto-assign to active project | ✅ Done |
| 0.8 | Blocked tasks visible in Kanban | ✅ Done |

---

## Phase 1: Codebase Internationalization (Woche 2-3)

**Goal:** 100% English codebase. UI stays DE/EN via i18n.

| # | Task | Impact |
|---|---|---|
| 1.1 | Rename all DB columns to English | Critical |
| 1.2 | Rename all API routes to English | Critical |
| 1.3 | Rename all variables/functions to English | Critical |
| 1.4 | Rename all files to English | Medium |
| 1.5 | Update i18n keys to English (UI text stays translated) | Medium |

**Files to refactor:**
- `server/db/schema.ts` — all German column names
- `server/index.ts` — all German route names
- `server/scheduler.ts` — all German variable names
- `server/services/*.ts` — all German function names
- `src/pages/*.tsx` — all German component names
- `src/i18n/*.ts` — all German translation keys → English keys, German values

---

## Phase 2: User Experience (Woche 3-4)

**Goal:** A new user can go from zero to running AI agents in under 5 minutes.

| # | Task | Impact |
|---|---|---|
| 2.1 | One-command setup (`npx opencognit onboard`) | Critical |
| 2.2 | Pre-built company templates (Clipmart-style) | High |
| 2.3 | Interactive first-run wizard | High |
| 2.4 | Auto-detect API keys from env vars | Medium |
| 2.5 | Default company + CEO agent on first login | Medium |

---

## Phase 3: Features That Matter (Woche 4-6)

**Goal:** Features that Paperclip/Hermes don't have.

| # | Feature | Why It Wins |
|---|---|---|
| 3.1 | **True Multi-Provider** — Seamlessly switch between Poe, Google, Anthropic, OpenRouter per agent | Paperclip only supports a few |
| 3.2 | **Built-in Critic Review** — Quality gate before tasks are marked done | No competitor has this |
| 3.3 | **Budget Forecasting** — ML-based prediction of monthly costs | No competitor has this |
| 3.4 | **Skill Library (RAG)** — Agents learn from markdown docs | MemPalace-like but integrated |
| 3.5 | **Palace Memory** — Wings, Rooms, Diary, Knowledge Graph | Unique to OpenCognit |
| 3.6 | **Plugin System** — External adapters via npm | Extensible architecture |
| 3.7 | **Multi-Platform Gateway** — Telegram, Discord, Slack, Email | Hermes has this, we need it too |
| 3.8 | **Browser Automation** — Agents can browse, click, fill forms | Hermes has this, we need it too |

---

## Phase 4: Community & Growth (Woche 6-8)

**Goal:** Get from 16 stars to 1000+ stars.

| # | Task | Impact |
|---|---|---|
| 4.1 | English README with demo video | Critical |
| 4.2 | Discord server | High |
| 4.3 | Contributing guide | High |
| 4.4 | Blog posts: "Why I built OpenCognit" | Medium |
| 4.5 | Launch on ProductHunt / HackerNews | High |
| 4.6 | YouTube tutorials | Medium |

---

## Competitive Matrix

| Feature | OpenCognit | Paperclip | Hermes | Dify | CrewAI |
|---|---|---|---|---|---|
| Self-hosted | ✅ | ✅ | ✅ | ✅ | ✅ |
| Multi-Provider | ✅ | ⚠️ | ⚠️ | ✅ | ⚠️ |
| Critic Review | ✅ | ❌ | ❌ | ❌ | ❌ |
| Budget Forecast | ✅ | ❌ | ❌ | ❌ | ❌ |
| Skill Library | ✅ | ⚠️ | ❌ | ✅ | ❌ |
| Palace Memory | ✅ | ❌ | ❌ | ❌ | ❌ |
| Plugin System | ✅ | ❌ | ❌ | ✅ | ❌ |
| Multi-Platform | 🔄 | ❌ | ✅ | ❌ | ❌ |
| Browser Auto | 🔄 | ❌ | ✅ | ❌ | ❌ |
| 1-Click Setup | 🔄 | ✅ | ❌ | ✅ | ❌ |
| Mobile UI | ❌ | ✅ | ❌ | ✅ | ❌ |

**Legend:** ✅ = Done, 🔄 = In Progress, ❌ = Not available, ⚠️ = Limited

---

## Why OpenCognit Will Win

1. **More Providers** — Poe, Google, Moonshot, Anthropic, OpenRouter, Ollama — all first-class
2. **Built-in Quality Control** — Critic Review prevents garbage output
3. **Financial Intelligence** — Budget forecasting, not just limits
4. **Memory Architecture** — Palace system is more sophisticated than simple RAG
5. **Extensible** — Plugin system allows anyone to add adapters

---

## Next Immediate Action

**Start Phase 1: Codebase Internationalization**
- Begin with DB schema → API routes → Services → Frontend
- Keep i18n system intact (UI stays DE/EN)
- Estimated time: 3-5 days of focused work

**Shall we start?** 🚀
