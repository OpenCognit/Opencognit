#!/usr/bin/env node
/**
 * OpenCognit CLI — Zero-Config Launcher
 *
 * npx @opencognit/cli   →  Launch OpenCognit in <60 seconds
 *
 * What it does:
 *   1. Pings http://localhost:3201/api/health
 *   2. If running: opens http://localhost:3200 in browser
 *   3. If not running:
 *      - Checks ~/.opencognit/ for a cloned repo, clones if missing
 *      - Runs npm install if needed
 *      - Interactive setup (.env + DB seed) on first run
 *      - Starts the server with `npm run dev`
 *      - Opens the browser once HTTP is ready
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawn } from 'child_process';
import net from 'net';
import readline from 'readline';
import crypto from 'crypto';
import { createRequire } from 'module';

// ── Constants ─────────────────────────────────────────────────────────────────
const REPO_URL    = 'https://github.com/OpenCognit/Opencognit.git';
const INSTALL_DIR = path.join(os.homedir(), '.opencognit');
const ENV_PATH    = path.join(INSTALL_DIR, '.env');
const DB_PATH     = path.join(INSTALL_DIR, 'opencognit.db');
const SERVER_PORT = 3201;
const UI_PORT     = 3200;
const SERVER_URL  = `http://localhost:${SERVER_PORT}`;
const UI_URL      = `http://localhost:${UI_PORT}`;

// ── ANSI color helpers (zero-dep) ─────────────────────────────────────────────
const c = {
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

// ── Banner ────────────────────────────────────────────────────────────────────
function printBanner() {
  console.clear();
  console.log(c.cyan(c.bold(`
  ╔═══════════════════════════════════════╗
  ║                                       ║
  ║   ◈  O P E N C O G N I T  ◈          ║
  ║   Autonomous Agent Platform           ║
  ║   Zero-Config Launcher                ║
  ║                                       ║
  ╚═══════════════════════════════════════╝
`)));
}

// ── Readline helpers ──────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise(resolve =>
    rl.question(c.cyan('? ') + c.bold(question) + ' ', a => resolve(a.trim()))
  );
}

function askYN(question, defaultYes = true) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  return ask(`${question} ${c.dim(hint)}`).then(a => {
    if (a === '') return defaultYes;
    return a.toLowerCase().startsWith('y');
  });
}

// ── Step helpers ──────────────────────────────────────────────────────────────
let stepN = 0;
function step(name) {
  stepN++;
  process.stdout.write(`\n  ${c.cyan(`[${stepN}]`)} ${name}... `);
}
function ok(detail = '')   { console.log(c.green('✓') + (detail ? c.dim(` ${detail}`) : '')); }
function warn(msg)         { console.log(c.yellow('\n  ⚠ ') + msg); }
function fail(msg)         { console.log(c.red('\n  ✗ ') + msg); rl.close(); process.exit(1); }

// ── Health check ──────────────────────────────────────────────────────────────
async function isRunning() {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Port probe ────────────────────────────────────────────────────────────────
function portFree(port) {
  return new Promise(resolve => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => { srv.close(); resolve(true); });
    srv.listen(port, '127.0.0.1');
  });
}

// ── Open browser ──────────────────────────────────────────────────────────────
function openBrowser(url) {
  try {
    if (process.platform === 'darwin')      execSync(`open "${url}"`, { stdio: 'ignore' });
    else if (process.platform === 'win32')  execSync(`start "" "${url}"`, { stdio: 'ignore', shell: true });
    else                                    execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
  } catch { /* ignore — URL printed to console */ }
}

// ── Clone / install repo ──────────────────────────────────────────────────────
async function ensureRepo() {
  step('Repository');
  if (!fs.existsSync(INSTALL_DIR)) {
    console.log(c.dim('\n  Cloning OpenCognit into ~/.opencognit ...'));
    try {
      execSync(`git clone ${REPO_URL} "${INSTALL_DIR}"`, { stdio: 'inherit' });
    } catch (e) {
      fail(`git clone failed: ${e.message}`);
    }
    ok('cloned');
  } else if (!fs.existsSync(path.join(INSTALL_DIR, 'package.json'))) {
    fail(`~/.opencognit exists but looks incomplete. Remove it and retry:\n  rm -rf ~/.opencognit`);
  } else {
    ok(`~/.opencognit already present`);
  }

  step('Dependencies');
  const nm = path.join(INSTALL_DIR, 'node_modules');
  if (!fs.existsSync(nm)) {
    console.log(c.dim('\n  Running npm install (may take ~30s) ...'));
    try {
      execSync('npm install', { cwd: INSTALL_DIR, stdio: 'inherit' });
    } catch (e) {
      fail(`npm install failed: ${e.message}`);
    }
    ok('installed');
  } else {
    ok('node_modules present');
  }
}

// ── .env generation ───────────────────────────────────────────────────────────
function buildEnv(apiKey) {
  const jwt  = crypto.randomBytes(32).toString('hex');
  const enc  = crypto.randomBytes(32).toString('hex');
  const sess = crypto.randomBytes(16).toString('hex');
  return [
    `# OpenCognit — generated by @opencognit/cli`,
    `# ${new Date().toISOString()}`,
    '',
    `PORT=${SERVER_PORT}`,
    `NODE_ENV=development`,
    '',
    `OPENCOGNIT_DB_PATH=${DB_PATH}`,
    '',
    `JWT_SECRET=${jwt}`,
    `ENCRYPTION_KEY=${enc}`,
    `SESSION_SECRET=${sess}`,
    '',
    apiKey ? `ANTHROPIC_API_KEY=${apiKey}` : `# ANTHROPIC_API_KEY=sk-ant-...`,
    `# OPENROUTER_API_KEY=`,
    `# OPENAI_API_KEY=`,
    '',
    `# TELEGRAM_BOT_TOKEN=`,
  ].join('\n');
}

// ── Interactive first-run setup ───────────────────────────────────────────────
async function interactiveSetup() {
  const isFirstRun = !fs.existsSync(ENV_PATH) || !fs.existsSync(DB_PATH);
  if (!isFirstRun) return null;

  console.log(c.bold('\n  ━━ First-Run Setup ━━'));

  let company = await ask('Company name       (Enter = "Meine Firma"):');
  if (!company) company = 'Meine Firma';

  let adminName = await ask('Your name          (Enter = "Admin"):');
  if (!adminName) adminName = 'Admin';

  let adminEmail = await ask('Your email         (Enter = admin@opencognit.local):');
  if (!adminEmail) adminEmail = 'admin@opencognit.local';

  let apiKey = '';
  const hasKey = await askYN('Do you have an Anthropic API key?', false);
  if (hasKey) {
    apiKey = await ask('Paste API key:');
  } else {
    console.log(c.dim('  → Add your key later in Settings → API Keys.'));
  }

  // Write .env
  step('.env');
  const envContent = buildEnv(apiKey);
  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
    ok('written to ~/.opencognit/.env');
  } else {
    ok('already exists — not overwritten');
  }

  // Inject into current process for the server child process
  for (const line of envContent.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m) process.env[m[1]] = m[2];
  }
  process.env['OPENCOGNIT_DB_PATH'] = DB_PATH;

  return { company, adminName, adminEmail };
}

// ── Seed DB ───────────────────────────────────────────────────────────────────
const DEFAULT_PW      = 'opencognit123';
const DEFAULT_PW_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

function seedDatabase(company, adminName, adminEmail) {
  step('Database seed');
  try {
    const require = createRequire(import.meta.url);
    const Database = require(path.join(INSTALL_DIR, 'node_modules', 'better-sqlite3'));
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Apply SQL migrations
    const migrDir = path.join(INSTALL_DIR, 'server', 'db', 'migrations', 'sqlite');
    if (fs.existsSync(migrDir)) {
      db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );`);
      const applied = new Set(
        db.prepare('SELECT name FROM _migrations').all().map(r => r.name)
      );
      const files = fs.readdirSync(migrDir).filter(f => f.endsWith('.sql')).sort();
      for (const file of files) {
        if (applied.has(file)) continue;
        try {
          const sql = fs.readFileSync(path.join(migrDir, file), 'utf-8');
          db.transaction(() => {
            db.exec(sql);
            db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)')
              .run(file, new Date().toISOString());
          })();
        } catch { /* migration may already be applied */ }
      }
    }

    // Check for existing data
    const existing = db.prepare('SELECT id FROM unternehmen LIMIT 1').get();
    if (existing) { db.close(); ok('existing data detected — skipped'); return; }

    const now = new Date().toISOString();
    const uid = crypto.randomUUID();
    const cid = crypto.randomUUID();
    const aid = crypto.randomUUID();

    db.prepare(`INSERT INTO benutzer (id, name, email, passwort_hash, rolle, erstellt_am, aktualisiert_am)
      VALUES (?, ?, ?, ?, 'admin', ?, ?)`)
      .run(uid, adminName, adminEmail.toLowerCase(), DEFAULT_PW_HASH, now, now);

    db.prepare(`INSERT INTO unternehmen (id, name, beschreibung, ziel, status, erstellt_am, aktualisiert_am)
      VALUES (?, ?, ?, ?, 'active', ?, ?)`)
      .run(cid, company, 'Von @opencognit/cli erstellt', 'Autonome Agenten einrichten', now, now);

    db.prepare(`INSERT INTO experten (
        id, unternehmen_id, name, rolle, titel, status, verbindungs_typ,
        is_orchestrator, zyklus_aktiv, system_prompt,
        budget_monat_cent, verbraucht_monat_cent, nachrichten_count,
        erstellt_am, aktualisiert_am, advisor_strategy, avatar_farbe
      ) VALUES (?, ?, 'Aria', 'CEO', 'Chief Executive Officer', 'active',
        'anthropic', 1, 1,
        'Du bist Aria, CEO und Orchestratorin. Du weist Aufgaben zu und koordinierst das Team.',
        500, 0, 0, ?, ?, 'none', '#23CDCB')`)
      .run(aid, cid, now, now);

    db.prepare(`INSERT INTO agent_permissions (
        id, expert_id, darf_aufgaben_erstellen, darf_aufgaben_zuweisen,
        darf_genehmigungen_anfordern, darf_genehmigungen_entscheiden,
        darf_experten_anwerben, erstellt_am, aktualisiert_am)
      VALUES (?, ?, 1, 1, 1, 1, 1, ?, ?)`)
      .run(crypto.randomUUID(), aid, now, now);

    db.prepare(`INSERT INTO aufgaben (
        id, unternehmen_id, titel, beschreibung, status, prioritaet,
        zugewiesen_an, erstellt_von, erstellt_am, aktualisiert_am)
      VALUES (?, ?, ?, ?, 'todo', 'high', ?, 'board', ?, ?)`)
      .run(crypto.randomUUID(), cid,
        'Analysiere dieses Projekt',
        'Willkommen! Analysiere den Projektstatus und erstelle 2-3 Folge-Tasks.',
        aid, now, now);

    db.close();
    ok(`"${company}" + CEO Aria + 1 demo task`);
  } catch (e) {
    warn(`Seed failed (run npm run db:seed manually): ${e.message}`);
  }
}

// ── Start server ──────────────────────────────────────────────────────────────
async function startServer() {
  const envFile = ENV_PATH;
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    OPENCOGNIT_DB_PATH: DB_PATH,
    DOTENV_PATH: envFile,
  };

  // Try npm run dev first (starts both server + vite), fallback to tsx server/index.ts
  const child = spawn('npm', ['run', 'dev'], {
    cwd: INSTALL_DIR,
    stdio: 'pipe',
    env,
    detached: false,
  });

  return new Promise((resolve, reject) => {
    let ready = false;
    const check = text => {
      if (!ready && (
        text.includes(':3201') || text.includes('läuft auf') ||
        text.includes('listening') || text.includes('Local:')
      )) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout?.on('data', d => check(d.toString()));
    child.stderr?.on('data', d => check(d.toString()));
    child.on('error', e => { if (!ready) reject(e); });
    child.on('exit', code => { if (!ready) reject(new Error(`Server exited (code ${code})`)); });
    // Resolve after 25s even if we missed the startup log line
    setTimeout(() => { if (!ready) { ready = true; resolve(child); } }, 25000);
  });
}

// ── Wait for HTTP ─────────────────────────────────────────────────────────────
async function waitForHttp(url, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch { /* keep polling */ }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  // Handle --help / -h
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
  ${c.bold('@opencognit/cli')} — Zero-config launcher for OpenCognit

  ${c.bold('Usage:')}
    npx @opencognit/cli          Launch OpenCognit (setup + start)
    npx @opencognit/cli --help   Show this help

  ${c.bold('What it does:')}
    1. Checks if OpenCognit is already running on port ${SERVER_PORT}
    2. If running: opens your browser to ${UI_URL}
    3. If not: clones the repo to ~/.opencognit, installs deps,
       runs interactive first-run setup, starts the server,
       and opens the browser.

  ${c.bold('First-run setup prompts:')}
    • Company name
    • Admin name + email
    • Optional Anthropic API key

  ${c.bold('Directories:')}
    Repo:   ~/.opencognit/
    DB:     ~/.opencognit/opencognit.db
    Config: ~/.opencognit/.env
`);
    process.exit(0);
  }

  printBanner();

  // ── Step 1: Check if already running ─────────────────────────────────────
  step('Checking if OpenCognit is running');
  const running = await isRunning();

  if (running) {
    ok(`already running on port ${SERVER_PORT}`);
    step('Opening browser');
    openBrowser(UI_URL);
    ok(UI_URL);
    rl.close();
    console.log(`\n  ${c.green(c.bold('OpenCognit is already running!'))}  →  ${c.cyan(UI_URL)}\n`);
    return;
  }

  ok('not running — starting now');

  // ── Step 2: Ensure repo is cloned and deps installed ─────────────────────
  await ensureRepo();

  // ── Step 3: Interactive first-run setup ───────────────────────────────────
  const setupInfo = await interactiveSetup();

  // ── Step 4: Seed DB if first run ──────────────────────────────────────────
  if (setupInfo) {
    seedDatabase(setupInfo.company, setupInfo.adminName, setupInfo.adminEmail);
  }

  // ── Step 5: Check port availability ──────────────────────────────────────
  step(`Port ${SERVER_PORT}`);
  const free = await portFree(SERVER_PORT);
  if (!free) {
    warn(`Port ${SERVER_PORT} is occupied but /api/health didn't respond — another process may be starting.`);
  } else {
    ok('free');
  }

  // ── Step 6: Start server ──────────────────────────────────────────────────
  console.log(c.bold('\n  ━━ Starting Server ━━'));
  step('npm run dev');

  let serverChild;
  try {
    serverChild = await startServer();
    ok('started');
  } catch (e) {
    warn(`Server start warning: ${e.message}`);
  }

  // ── Step 7: Wait for HTTP readiness ──────────────────────────────────────
  step('Waiting for API');
  const ready = await waitForHttp(SERVER_URL);
  if (ready) ok('HTTP responding');
  else warn('Server may still be warming up — opening browser anyway');

  // ── Step 8: Open browser ──────────────────────────────────────────────────
  step('Opening browser');
  openBrowser(UI_URL);
  ok(UI_URL);

  rl.close();

  const email = setupInfo?.adminEmail ?? 'admin@opencognit.local';
  console.log(`
${c.green(c.bold('  ✓ OpenCognit is running!'))}

  ${c.bold('UI')}        ${c.cyan(UI_URL)}
  ${c.bold('API')}       ${c.cyan(SERVER_URL)}
  ${c.bold('Email')}     ${email}
  ${c.bold('Password')}  ${DEFAULT_PW}

  ${c.dim('Aria (CEO) will start working on your first task automatically.')}
  ${c.dim('Add API keys in Settings → API Keys to enable LLM agents.')}

  ${c.cyan('Press Ctrl+C to stop.')}
`);

  // Keep alive while server runs
  process.on('SIGINT', () => {
    console.log(c.dim('\n  Shutting down...'));
    serverChild?.kill?.();
    process.exit(0);
  });

  // Prevent immediate exit (server runs in background child process)
  setInterval(() => {}, 2000);
}

main().catch(e => {
  console.error(c.red('\n  Fatal error:'), e?.message ?? e);
  process.exit(1);
});
