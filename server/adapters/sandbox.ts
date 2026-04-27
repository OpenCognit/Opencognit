// Sandbox Layer for Bash Adapter
// Provides defense-in-depth for shell command execution.
//
// Security levels (auto-detected at runtime):
//   LEVEL_DOCKER    — Docker container with --network none, read-only rootfs,
//                     volume-mount only workspace. Best isolation.
//   LEVEL_SYSTEMD   — systemd-run --user --scope with memory/CPU limits.
//                     Moderate isolation (no fs/net isolation).
//   LEVEL_EXEC      — Direct child_process.exec with hardened security checks.
//                     Minimum isolation — relies on blocklists + path guards.
//
// NOTE: For production deployments, install Docker and set USE_DOCKER_SANDBOX=1
//       to get true container isolation.

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface SandboxResult {
  success: boolean;
  output: string;
  exitCode: number;
  durationMs: number;
  sandboxLevel: 'docker' | 'systemd' | 'exec';
  error?: string;
}

export interface SandboxOptions {
  command: string;
  cwd: string;
  timeoutMs: number;
  env: Record<string, string | undefined>;
  blockedCommands?: string[];
  allowedCommands?: string[];
  maxOutputSize?: number; // bytes, default 10MB
}

// ── Runtime capability detection ─────────────────────────────────────────────

let dockerAvailable: boolean | null = null;
let systemdAvailable: boolean | null = null;

async function detectDocker(): Promise<boolean> {
  if (dockerAvailable !== null) return dockerAvailable;
  try {
    await execAsync('docker version --format "{{.Server.Version}}"', { timeout: 3000 });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}

async function detectSystemd(): Promise<boolean> {
  if (systemdAvailable !== null) return systemdAvailable;
  try {
    await execAsync('systemd-run --user --scope true', { timeout: 3000 });
    systemdAvailable = true;
  } catch {
    systemdAvailable = false;
  }
  return systemdAvailable;
}

// ── Security validation ─────────────────────────────────────────────────────

const DEFAULT_BLOCKED = [
  'rm -rf /', 'rm -rf /*', 'mkfs', 'dd if=/dev/zero', 'dd if=/dev/random',
  'dd if=/dev/urandom', ':(){ :|:& };:', 'chmod 777 /', 'chmod -R 777 /',
  '> /dev/sda', '> /dev/hda', 'mv / /dev/null', 'wget', 'curl',
  'nc -l', 'ncat -l', 'python -m http.server', 'python3 -m http.server',
  'nc -e', 'ncat -e', 'bash -i', 'sh -i', 'telnet', 'ssh ', 'scp ',
  'rsync --daemon', 'ftp ', 'sftp ', 'tftp ', 'socat ', 'eval(',
  '`curl', '`wget', '$(curl', '$(wget', 'fetch(', 'axios.get(',
  // Path traversal attempts
  '../etc/passwd', '../.env', '../../.env', '../../../.env',
  '/etc/passwd', '/etc/shadow', '/root/', '/home/',
];

const DANGEROUS_PATTERNS = [
  /;\s*rm\s+-rf\s+\//,
  /\|\s*bash\s+-i/,
  /\|\s*sh\s+-i/,
  /curl\s+.*\|\s*(bash|sh|zsh)/,
  /wget\s+.*\|\s*(bash|sh|zsh)/,
  /\b(base64|eval)\s*\(\s*[`$]/,
  /python\d*\s+-c\s+.*import\s+os/,
  /python\d*\s+-c\s+.*subprocess/,
  /node\s+-e\s+.*require\s*\(\s*['"]child_process/,
];

function validateCommand(opts: SandboxOptions): { ok: true } | { ok: false; reason: string } {
  const cmd = opts.command.trim();

  // 1. Empty check
  if (!cmd) return { ok: false, reason: 'Leeres Kommando' };

  // 2. Custom blocked commands
  const blocked = [...DEFAULT_BLOCKED, ...(opts.blockedCommands || [])];
  for (const b of blocked) {
    if (cmd.toLowerCase().includes(b.toLowerCase())) {
      return { ok: false, reason: `Kommando enthält blockiertes Muster: "${b}"` };
    }
  }

  // 3. Dangerous regex patterns
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(cmd)) {
      return { ok: false, reason: `Kommando matched gefährliches Muster: ${pattern.source}` };
    }
  }

  // 4. Whitelist mode (if configured)
  if (opts.allowedCommands && opts.allowedCommands.length > 0) {
    const firstToken = cmd.split(/\s+/)[0];
    const allowed = opts.allowedCommands.some(a =>
      cmd.startsWith(a) || firstToken === a
    );
    if (!allowed) {
      return { ok: false, reason: `Kommando "${firstToken}" ist nicht in der erlaubten Liste` };
    }
  }

  // 5. Path traversal check — commands must not reference files outside cwd
  // This is a heuristic; we reject absolute paths that don't start with cwd
  // or contain .. sequences
  const normalizedCwd = path.resolve(opts.cwd);
  const absolutePathMatches = cmd.match(/(?:\s|^)(\/[^\s;|&<>\"'`]+)/g) || [];
  for (const match of absolutePathMatches) {
    const p = match.trim();
    if (!p.startsWith(normalizedCwd) && !p.startsWith('/tmp') && !p.startsWith('/dev/null')) {
      return { ok: false, reason: `Absoluter Pfad außerhalb Workspace blockiert: ${p}` };
    }
  }
  if (/\.\.[\/\\]/.test(cmd) || /\.\.$/.test(cmd)) {
    return { ok: false, reason: 'Path-Traversal (../) im Kommando blockiert' };
  }

  // 6. Network indicator check (warn-level, not block — for exec mode)
  const networkIndicators = ['curl ', 'wget ', 'nc ', 'ncat ', 'python -m http.server',
    'python3 -m http.server', 'node -e', 'ruby -e'];
  const hasNetwork = networkIndicators.some(n => cmd.toLowerCase().includes(n.toLowerCase()));
  if (hasNetwork) {
    // We don't block here, but we log. The caller can decide to enforce.
    console.warn(`[sandbox] WARN: Kommando enthält Netzwerk-Indikator: ${cmd.slice(0, 80)}`);
  }

  return { ok: true };
}

// ── Sanitize environment ────────────────────────────────────────────────────

const SENSITIVE_ENV_KEYS = [
  'JWT_SECRET', 'OPENCOGNIT_ENCRYPTION_KEY', 'DB_PASSWORD', 'DATABASE_URL',
  'API_KEY', 'SECRET', 'PASSWORD', 'TOKEN', 'PRIVATE_KEY', 'AWS_',
  'GCP_', 'AZURE_', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY',
];

function sanitizeEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    // Strip sensitive keys
    const isSensitive = SENSITIVE_ENV_KEYS.some(s =>
      key.toUpperCase().includes(s) || key.toUpperCase().startsWith(s)
    );
    if (!isSensitive) {
      result[key] = value;
    }
  }
  // Add minimal safe env
  result['PATH'] = process.env.PATH || '/usr/bin:/bin';
  result['HOME'] = '/tmp';
  result['TMPDIR'] = '/tmp';
  result['LANG'] = process.env.LANG || 'C.UTF-8';
  return result;
}

// ── Docker sandbox ──────────────────────────────────────────────────────────

async function runDocker(opts: SandboxOptions): Promise<SandboxResult> {
  const startTime = Date.now();
  const normalizedCwd = path.resolve(opts.cwd);

  // Ensure cwd exists inside container
  if (!fs.existsSync(normalizedCwd)) {
    return {
      success: false,
      output: '',
      exitCode: 1,
      durationMs: Date.now() - startTime,
      sandboxLevel: 'docker',
      error: `Workspace ${normalizedCwd} existiert nicht`,
    };
  }

  const containerName = `opencognit-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const safeEnv = sanitizeEnv(opts.env);
  const envArgs = Object.entries(safeEnv)
    .map(([k, v]) => `-e ${k}=${v}`)
    .join(' ');

  // Use alpine by default, but allow override via OPENCOGNIT_SANDBOX_IMAGE
  const image = process.env.OPENCOGNIT_SANDBOX_IMAGE || 'alpine:latest';

  const dockerCmd = [
    'docker', 'run', '--rm',
    '--name', containerName,
    '--network', 'none',           // No network access
    '--read-only',                 // Read-only rootfs
    '--tmpfs', '/tmp:noexec,nosuid,size=100m',
    '-v', `${normalizedCwd}:/workspace:rw`,
    '-w', '/workspace',
    envArgs,
    image,
    'sh', '-c', opts.command,
  ].join(' ');

  try {
    const { stdout, stderr } = await execAsync(dockerCmd, {
      timeout: opts.timeoutMs,
      env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
      maxBuffer: opts.maxOutputSize || 10 * 1024 * 1024,
    });
    return {
      success: true,
      output: stdout || stderr || 'OK',
      exitCode: 0,
      durationMs: Date.now() - startTime,
      sandboxLevel: 'docker',
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stderr || error.stdout || error.message,
      exitCode: error.exitCode || 1,
      durationMs: Date.now() - startTime,
      sandboxLevel: 'docker',
      error: error.message,
    };
  }
}

// ── systemd-run sandbox ─────────────────────────────────────────────────────

async function runSystemd(opts: SandboxOptions): Promise<SandboxResult> {
  const startTime = Date.now();
  const safeEnv = sanitizeEnv(opts.env);

  const systemdCmd = [
    'systemd-run',
    '--user', '--scope',
    '--property=MemoryMax=512M',
    '--property=CPUQuota=50%',
    '--property=TasksMax=50',
    '--collect',
    '--wait',
    '--',
    '/bin/sh', '-c', opts.command,
  ];

  return new Promise((resolve) => {
    const child = spawn(systemdCmd[0], systemdCmd.slice(1), {
      cwd: opts.cwd,
      env: { ...process.env, ...safeEnv },
      timeout: opts.timeoutMs,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => { stdout += data; });
    child.stderr?.on('data', (data) => { stderr += data; });

    child.on('error', (err) => {
      resolve({
        success: false,
        output: stderr || '',
        exitCode: 1,
        durationMs: Date.now() - startTime,
        sandboxLevel: 'systemd',
        error: err.message,
      });
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout || stderr || 'OK',
        exitCode: code ?? 1,
        durationMs: Date.now() - startTime,
        sandboxLevel: 'systemd',
      });
    });
  });
}

// ── Hardened exec fallback ──────────────────────────────────────────────────

async function runExec(opts: SandboxOptions): Promise<SandboxResult> {
  const startTime = Date.now();
  const safeEnv = sanitizeEnv(opts.env);

  try {
    const { stdout, stderr } = await execAsync(opts.command, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      env: safeEnv,
      maxBuffer: opts.maxOutputSize || 10 * 1024 * 1024,
    });
    return {
      success: true,
      output: stdout || stderr || 'OK',
      exitCode: 0,
      durationMs: Date.now() - startTime,
      sandboxLevel: 'exec',
    };
  } catch (error: any) {
    return {
      success: false,
      output: error.stderr || error.stdout || error.message,
      exitCode: error.exitCode || 1,
      durationMs: Date.now() - startTime,
      sandboxLevel: 'exec',
      error: error.message,
    };
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function runInSandbox(opts: SandboxOptions): Promise<SandboxResult> {
  // 1. Always validate first
  const validation = validateCommand(opts);
  if (validation.ok === false) {
    return {
      success: false,
      output: `🛡️ Sandbox-Block: ${validation.reason}`,
      exitCode: 1,
      durationMs: 0,
      sandboxLevel: 'exec',
      error: validation.reason,
    };
  }

  // 2. Auto-detect best available sandbox
  const useDocker = process.env.USE_DOCKER_SANDBOX === '1' || process.env.USE_DOCKER_SANDBOX === 'true';
  const useSystemd = process.env.USE_SYSTEMD_SANDBOX === '1' || process.env.USE_SYSTEMD_SANDBOX === 'true';

  if (useDocker && await detectDocker()) {
    return runDocker(opts);
  }

  if (useSystemd && await detectSystemd()) {
    return runSystemd(opts);
  }

  // 3. Default: hardened exec with full validation
  console.log(`[sandbox] WARN: Keine Container-Isolation verfügbar. Führe mit hartenden exec-Prüfungen aus. Installiere Docker für echte Isolation.`);
  return runExec(opts);
}

/**
 * Returns the best available sandbox level for this system.
 */
export async function getSandboxLevel(): Promise<'docker' | 'systemd' | 'exec'> {
  if (await detectDocker()) return 'docker';
  if (await detectSystemd()) return 'systemd';
  return 'exec';
}

/**
 * Check if a specific sandbox level is available.
 */
export async function isSandboxLevelAvailable(level: 'docker' | 'systemd' | 'exec'): Promise<boolean> {
  if (level === 'docker') return detectDocker();
  if (level === 'systemd') return detectSystemd();
  return true; // exec always available
}
