// Plugin Registry Client
//
// Fetches a remote registry manifest (JSON) and installs adapter plugins into
// `plugins/adapters/<id>/`. Install strategy: git clone (preferred, keeps history
// for updates) or tarball download (for HTTPS bundles). After install the
// adapter registry's `loadPlugins()` is re-run so new adapters are live without
// a server restart.

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { adapterRegistry } from '../adapters/registry.js';

export interface RegistryEntry {
  id: string;                  // folder-safe slug, unique per registry
  name: string;
  description?: string;
  version: string;
  author?: string;
  type: 'adapter';             // future: 'plugin', 'skill', 'template'
  /** Primary install source — https URL. */
  source: string;
  /** 'git' clones via git, 'tarball' downloads + extracts. Auto-detected from URL if omitted. */
  install?: 'git' | 'tarball';
  homepage?: string;
  tags?: string[];
  /** SHA-256 of tarball for integrity check (tarball installs only). */
  sha256?: string;
}

export interface RegistryManifest {
  registryVersion?: number;
  plugins: RegistryEntry[];
}

const DEFAULT_REGISTRY_URL =
  process.env.OPENCOGNIT_PLUGIN_REGISTRY ||
  'https://raw.githubusercontent.com/opencognit/plugin-registry/main/registry.json';

const PLUGINS_DIR = path.resolve(process.cwd(), 'plugins', 'adapters');

function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,48}$/i.test(id);
}

export async function fetchRegistry(url?: string): Promise<RegistryManifest> {
  const target = url || DEFAULT_REGISTRY_URL;
  const isDefault = !url;
  try {
    const res = await fetch(target, { headers: { accept: 'application/json' } });
    if (!res.ok) {
      if (isDefault) return { plugins: [] };
      throw new Error(`registry fetch failed: ${res.status}`);
    }
    const body = (await res.json()) as RegistryManifest;
    if (!body || !Array.isArray(body.plugins)) {
      if (isDefault) return { plugins: [] };
      throw new Error('malformed registry manifest');
    }
    return body;
  } catch (e) {
    if (isDefault) return { plugins: [] };
    throw e;
  }
}

export function listInstalled(): { id: string; plugin: any | null }[] {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  return fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const manifestPath = path.join(PLUGINS_DIR, d.name, 'plugin.json');
      let plugin: any = null;
      if (fs.existsSync(manifestPath)) {
        try { plugin = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
      }
      return { id: d.name, plugin };
    });
}

function run(cmd: string, args: string[], cwd?: string, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`${cmd} timed out`)); }, timeoutMs);
    proc.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}

async function installViaGit(entry: RegistryEntry, target: string): Promise<void> {
  await run('git', ['clone', '--depth=1', '--single-branch', entry.source, target]);
}

async function installViaTarball(entry: RegistryEntry, target: string): Promise<void> {
  fs.mkdirSync(target, { recursive: true });
  const tmpTgz = path.join(target, '_install.tar.gz');
  const res = await fetch(entry.source);
  if (!res.ok) throw new Error(`tarball download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (entry.sha256) {
    const { createHash } = await import('crypto');
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== entry.sha256) throw new Error(`sha256 mismatch: expected ${entry.sha256}, got ${actual}`);
  }
  fs.writeFileSync(tmpTgz, buf);
  await run('tar', ['-xzf', tmpTgz, '-C', target, '--strip-components=1']);
  fs.unlinkSync(tmpTgz);
}

function detectStrategy(entry: RegistryEntry): 'git' | 'tarball' {
  if (entry.install) return entry.install;
  if (entry.source.endsWith('.git') || entry.source.startsWith('git@')) return 'git';
  if (entry.source.endsWith('.tar.gz') || entry.source.endsWith('.tgz')) return 'tarball';
  return 'git';
}

export async function installPlugin(entry: RegistryEntry): Promise<{ installed: string; loadedAdapters: number }> {
  if (!isSafeId(entry.id)) throw new Error(`unsafe plugin id: ${entry.id}`);
  if (entry.type !== 'adapter') throw new Error(`unsupported plugin type: ${entry.type}`);

  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  const target = path.join(PLUGINS_DIR, entry.id);
  if (fs.existsSync(target)) throw new Error(`plugin already installed: ${entry.id}`);

  const strategy = detectStrategy(entry);
  try {
    if (strategy === 'git') await installViaGit(entry, target);
    else await installViaTarball(entry, target);
  } catch (err) {
    // Cleanup on failure
    try { fs.rmSync(target, { recursive: true, force: true }); } catch {}
    throw err;
  }

  // Verify plugin.json
  const manifestPath = path.join(target, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    fs.rmSync(target, { recursive: true, force: true });
    throw new Error('installed plugin is missing plugin.json');
  }

  // Hot-reload adapter plugins
  const loadedAdapters = await adapterRegistry.loadPlugins();
  return { installed: entry.id, loadedAdapters };
}

export async function uninstallPlugin(id: string): Promise<void> {
  if (!isSafeId(id)) throw new Error(`unsafe plugin id: ${id}`);
  const target = path.join(PLUGINS_DIR, id);
  if (!fs.existsSync(target)) throw new Error(`plugin not installed: ${id}`);
  fs.rmSync(target, { recursive: true, force: true });
  await adapterRegistry.loadPlugins();
}
