// =============================================================================
// Plugins + plugin-registry routes — extracted from server/index.ts as part
// of the `refactor/server-routes-split` work.
//
// /api/plugins/*           → manage installed plugin instances
// /api/plugin-registry/*   → browse/install/uninstall from a remote manifest
// =============================================================================

import { Router } from 'express';

import { pluginManager } from '../plugins/index.js';
import { authMiddleware, requireCompanyAccess } from '../middleware/auth.js';

const router = Router();

// =============================================
// PLUGIN REGISTRY — browse / install / uninstall
// =============================================

router.get('/api/plugin-registry', authMiddleware, async (req, res) => {
  try {
    const { fetchRegistry, listInstalled } = await import('../services/plugin-registry.js');
    const url = (req.query.url as string) || undefined;
    const manifest = await fetchRegistry(url);
    const installed = new Set(listInstalled().map(x => x.id));
    res.json({
      plugins: manifest.plugins.map(p => ({ ...p, installed: installed.has(p.id) })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/plugin-registry/installed', authMiddleware, async (_req, res) => {
  try {
    const { listInstalled } = await import('../services/plugin-registry.js');
    res.json({ installed: listInstalled() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/plugin-registry/install', authMiddleware, async (req, res) => {
  try {
    const entry = req.body;
    if (!entry || !entry.id || !entry.source) {
      return res.status(400).json({ error: 'entry with id and source required' });
    }
    const { installPlugin } = await import('../services/plugin-registry.js');
    const result = await installPlugin(entry);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/api/plugin-registry/uninstall', authMiddleware, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });
    const { uninstallPlugin } = await import('../services/plugin-registry.js');
    await uninstallPlugin(id);
    res.json({ uninstalled: id });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

// =============================================
// PLUGINS — manage installed plugin instances
// =============================================

router.get('/api/plugins', authMiddleware, requireCompanyAccess(['owner', 'admin']), async (_req, res) => {
  try {
    const plugins = await pluginManager.listPlugins();
    res.json(plugins);
  } catch (error) {
    console.error('Failed to list plugins:', error);
    res.status(500).json({ error: 'Failed to list plugins' });
  }
});

router.get('/api/plugins/:id', authMiddleware, requireCompanyAccess(['owner', 'admin']), async (req, res) => {
  const { id } = req.params;

  try {
    const plugin = pluginManager.getPlugin(id);

    if (!plugin) {
      return res.status(404).json({ error: 'Plugin not found' });
    }

    let configSchema = {};
    if (plugin.getConfigSchema) {
      configSchema = plugin.getConfigSchema();
    }

    let uiComponents = {};
    if (plugin.getUiComponents) {
      uiComponents = plugin.getUiComponents();
    }

    let assets: any[] = [];
    if (plugin.getAssets) {
      assets = plugin.getAssets();
    }

    res.json({
      metadata: plugin.metadata,
      configSchema,
      uiComponents,
      assets,
    });
  } catch (error) {
    console.error(`Failed to fetch plugin ${id}:`, error);
    res.status(500).json({ error: 'Failed to fetch plugin' });
  }
});

router.post('/api/plugins/:id/enable', authMiddleware, requireCompanyAccess(['owner', 'admin']), async (req, res) => {
  const { id } = req.params;
  try {
    await pluginManager.enablePlugin(id);
    res.json({ success: true, message: `Plugin ${id} wurde aktiviert` });
  } catch (error) {
    console.error(`Failed to enable plugin ${id}:`, error);
    res.status(500).json({ error: 'Failed to enable plugin' });
  }
});

router.post('/api/plugins/:id/disable', authMiddleware, requireCompanyAccess(['owner', 'admin']), async (req, res) => {
  const { id } = req.params;
  try {
    await pluginManager.disablePlugin(id);
    res.json({ success: true, message: `Plugin ${id} wurde deaktiviert` });
  } catch (error) {
    console.error(`Failed to disable plugin ${id}:`, error);
    res.status(500).json({ error: 'Failed to disable plugin' });
  }
});

router.post('/api/plugins/install', authMiddleware, requireCompanyAccess(['owner', 'admin']), async (req, res) => {
  const { source, location, version, force } = req.body;

  if (!source || !location) {
    return res.status(400).json({ error: 'source and location are required' });
  }

  try {
    const pluginId = await pluginManager.installPlugin(source, location, { version, force });
    res.json({ success: true, pluginId, message: 'Plugin installed' });
  } catch (error) {
    console.error('Plugin install failed:', error);
    res.status(500).json({ error: 'Plugin install failed' });
  }
});

export default router;
