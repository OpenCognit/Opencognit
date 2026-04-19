// Adapter Plugin Loader — lädt externe Adapter-Packages zur Laufzeit.
//
// Ablauf:
//   1. Durchsuche `<cwd>/plugins/adapters/*` nach Verzeichnissen mit plugin.json.
//   2. plugin.json muss enthalten: { name, version, main }  (main = relativer JS-Pfad).
//   3. Die main-Datei muss eine Factory exportieren:
//        export default function createAdapter(ctx) { return adapterInstance }
//      oder einen benannten Export `createAdapter`.
//   4. Der zurückgegebene Adapter muss das `Adapter`-Interface erfüllen.
//
// So kann die Community Adapter für neue LLMs/CLIs als separates Package liefern,
// ohne den Core zu ändern.

import fs from 'fs';
import path from 'path';
import type { Adapter } from './types.js';

export interface AdapterPluginManifest {
  name: string;
  version: string;
  main: string;
  description?: string;
  author?: string;
  canHandle?: string[]; // Hints (z.B. Keywords) — optional, nur für UI-Anzeige
}

export interface AdapterPluginContext {
  // Stabile API-Oberfläche, die Plugins nutzen dürfen. Klein halten!
  log: (msg: string) => void;
}

export interface LoadedAdapterPlugin {
  manifest: AdapterPluginManifest;
  adapter: Adapter;
  dir: string;
}

const DEFAULT_PLUGINS_DIR = () => path.join(process.cwd(), 'plugins', 'adapters');

function isValidAdapter(x: any): x is Adapter {
  return x && typeof x.name === 'string' && typeof x.canHandle === 'function' && typeof x.execute === 'function';
}

async function loadOne(dir: string): Promise<LoadedAdapterPlugin | null> {
  const manifestPath = path.join(dir, 'plugin.json');
  if (!fs.existsSync(manifestPath)) return null;

  let manifest: AdapterPluginManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (err: any) {
    console.warn(`[AdapterPlugin] ${dir}: plugin.json unlesbar — ${err?.message}`);
    return null;
  }

  if (!manifest.name || !manifest.main) {
    console.warn(`[AdapterPlugin] ${dir}: plugin.json unvollständig (name/main fehlt)`);
    return null;
  }

  const entryPath = path.resolve(dir, manifest.main);
  if (!fs.existsSync(entryPath)) {
    console.warn(`[AdapterPlugin] ${manifest.name}: main "${manifest.main}" nicht gefunden`);
    return null;
  }

  const ctx: AdapterPluginContext = {
    log: (msg) => console.log(`[Plugin:${manifest.name}] ${msg}`),
  };

  try {
    const mod = await import(/* @vite-ignore */ entryPath);
    const factory = mod.createAdapter || mod.default;
    if (typeof factory !== 'function') {
      console.warn(`[AdapterPlugin] ${manifest.name}: kein createAdapter/default-Export`);
      return null;
    }
    const adapter = await factory(ctx);
    if (!isValidAdapter(adapter)) {
      console.warn(`[AdapterPlugin] ${manifest.name}: Rückgabe erfüllt das Adapter-Interface nicht`);
      return null;
    }
    return { manifest, adapter, dir };
  } catch (err: any) {
    console.warn(`[AdapterPlugin] ${manifest.name}: Laden fehlgeschlagen — ${err?.message}`);
    return null;
  }
}

/**
 * Scannt den Plugin-Ordner und gibt alle lauffähigen Adapter-Plugins zurück.
 * Fehler einzelner Plugins blockieren NICHT den Start — sie werden nur geloggt.
 */
export async function loadAdapterPlugins(pluginsDir: string = DEFAULT_PLUGINS_DIR()): Promise<LoadedAdapterPlugin[]> {
  if (!fs.existsSync(pluginsDir)) return [];

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory()).map(e => path.join(pluginsDir, e.name));

  const loaded: LoadedAdapterPlugin[] = [];
  for (const d of dirs) {
    const plugin = await loadOne(d);
    if (plugin) loaded.push(plugin);
  }

  if (loaded.length > 0) {
    console.log(`🧩 ${loaded.length} Adapter-Plugin(s) geladen: ${loaded.map(p => p.manifest.name).join(', ')}`);
  }
  return loaded;
}
