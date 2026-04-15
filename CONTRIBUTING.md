# Contributing to OpenCognit

Thanks for your interest in contributing!

## Getting Started

1. Fork the repo
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/opencognit.git`
3. Run setup: `bash setup.sh`
4. Create a branch: `git checkout -b feature/my-feature`
5. Make your changes
6. Check TypeScript: `node_modules/.bin/tsc --noEmit`
7. Open a pull request

## What We Welcome

- Bug fixes
- New agent adapters (new LLM provider, new runtime)
- UI improvements (glassmorphism design system, cyan accent `#23CDCB`)
- New channel plugins (Slack, Discord, WhatsApp)
- Documentation improvements
- Performance improvements

## Code Style

- TypeScript strict mode — no `any` unless unavoidable
- Glassmorphism UI: `backdrop-blur`, semi-transparent backgrounds, cyan particles `#23CDCB`
- German variable names for DB entities (historical — keep consistent): `aufgaben`, `experten`, `unternehmen`
- English for new service/adapter code

## Architecture Notes

- **Database**: SQLite via Drizzle ORM — schema in `server/db/schema.ts`
- **Agent cycle**: `scheduler.ts` → `heartbeat.ts` → `adapters/registry.ts` → individual adapter
- **CEO path**: `adapters/ceo.ts` handles orchestration (task creation, assignment, meetings)
- **Memory**: `services/memory-auto.ts` for pre/post-cycle auto-save

## Reporting Issues

Please open a GitHub Issue with:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version, OS
- Any relevant logs from `server.log`
