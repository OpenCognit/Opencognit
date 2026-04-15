# @opencognit/cli

Zero-config launcher for [OpenCognit](https://github.com/OpenCognit/Opencognit) — the autonomous agent platform.

## Usage

```bash
npx @opencognit/cli
```

That's it. The CLI will:

1. **Check** if OpenCognit is already running (`http://localhost:3201/api/health`)
2. **If running** — open your browser to `http://localhost:3200`
3. **If not running**:
   - Clone the repo to `~/.opencognit/` (if not already there)
   - Install dependencies (`npm install`)
   - Run interactive first-run setup (company name, admin account, optional API key)
   - Write a `.env` with secure random secrets
   - Seed the database (migrations + CEO agent "Aria" + demo task)
   - Start the server (`npm run dev`)
   - Open the browser once the API responds

## First-Run Prompts

| Prompt | Default |
|--------|---------|
| Company name | `Meine Firma` |
| Your name | `Admin` |
| Your email | `admin@opencognit.local` |
| Anthropic API key | *(optional, add later in Settings)* |

Default login password: **`opencognit123`** — change it in Settings after first login.

## Directories

| Path | Purpose |
|------|---------|
| `~/.opencognit/` | Cloned repository |
| `~/.opencognit/.env` | Environment config (auto-generated) |
| `~/.opencognit/opencognit.db` | SQLite database |

## Requirements

- Node.js >= 20
- Git (for initial clone)
- npm

## Options

```
npx @opencognit/cli --help    Show help and exit
```
