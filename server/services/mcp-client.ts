/**
 * MCP (Model Context Protocol) Client
 * =====================================
 * Standardized tool discovery and invocation for agents.
 * MCP is the industry standard for agent-to-tool communication (2026).
 *
 * This client allows agents to:
 * - Discover available tools from MCP servers
 * - Invoke tools through a unified interface
 * - Cache tool schemas for performance
 *
 * Protocol: https://modelcontextprotocol.io
 */

import { db } from '../db/client.js';

export interface MCPTool {
  name: string;
  description: string;
  parameters: object;
}

interface MCPDiscoveryResponse {
  tools?: MCPTool[];
}

export interface MCPServerConfig {
  name: string;
  url: string;
  auth?: { type: 'bearer' | 'api-key'; token: string };
  tools?: MCPTool[];
}

const toolCache = new Map<string, { tools: MCPTool[]; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Discover tools from an MCP server.
 */
export async function discoverTools(serverUrl: string, auth?: MCPServerConfig['auth']): Promise<MCPTool[]> {
  const cacheKey = `${serverUrl}`;
  const cached = toolCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.tools as any;
  }

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth?.type === 'bearer') headers['Authorization'] = `Bearer ${auth.token}`;
    if (auth?.type === 'api-key') headers['X-API-Key'] = auth.token;

    // MCP discovery endpoint (standardized)
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/mcp/discover`, {
      method: 'GET',
      headers,
    });

    if (!res.ok) {
      // Fallback: try /tools endpoint
      const fallbackRes = await fetch(`${serverUrl.replace(/\/+$/, '')}/tools`, { headers });
      if (!fallbackRes.ok) throw new Error(`MCP discovery failed: ${res.status}`);
      const data = await fallbackRes.json() as MCPDiscoveryResponse | MCPTool[];
      const tools = Array.isArray(data) ? data : (data.tools || []);
      toolCache.set(cacheKey, { tools, cachedAt: Date.now() });
      return tools;
    }

    const data = await res.json() as MCPDiscoveryResponse;
    const tools = data.tools || [];
    toolCache.set(cacheKey, { tools, cachedAt: Date.now() });
    return tools;
  } catch (err: any) {
    console.warn(`  ⚠️ MCP discovery failed for ${serverUrl}:`, err.message);
    return [];
  }
}

/**
 * Invoke an MCP tool.
 */
export async function invokeTool(
  serverUrl: string,
  toolName: string,
  params: Record<string, any>,
  auth?: MCPServerConfig['auth']
): Promise<{ success: boolean; result: any; error?: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (auth?.type === 'bearer') headers['Authorization'] = `Bearer ${auth.token}`;
    if (auth?.type === 'api-key') headers['X-API-Key'] = auth.token;

    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/mcp/invoke`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool: toolName, params }),
    });

    if (!res.ok) {
      // Fallback: try /tools/{name}/invoke
      const fallbackRes = await fetch(`${serverUrl.replace(/\/+$/, '')}/tools/${encodeURIComponent(toolName)}/invoke`, {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });
      if (!fallbackRes.ok) throw new Error(`Tool invocation failed: ${res.status}`);
      const data = await fallbackRes.json();
      return { success: true, result: data };
    }

    const data = await res.json();
    return { success: true, result: data };
  } catch (err: any) {
    console.warn(`  ⚠️ MCP tool invocation failed (${toolName}):`, err.message);
    return { success: false, result: null, error: err.message };
  }
}

/**
 * Get cached tools for a server.
 */
export function getCachedTools(serverUrl: string): MCPTool[] | null {
  const cached = toolCache.get(serverUrl);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.tools as any;
  }
  return null;
}

/**
 * Clear tool cache.
 */
export function clearToolCache(): void {
  toolCache.clear();
}

/**
 * Format MCP tools as a prompt-ready tool description.
 */
export function formatToolsAsPrompt(tools: MCPTool[]): string {
  if (tools.length === 0) return 'No tools available.';
  const lines = tools.map(t => `- ${t.name}: ${t.description}`);
  return `Available tools:\n${lines.join('\n')}`;
}

/**
 * Built-in MCP server configs (popular services).
 */
export const BUILTIN_MCP_SERVERS: MCPServerConfig[] = [
  {
    name: 'filesystem',
    url: 'http://localhost:3001',
    auth: undefined,
  },
  {
    name: 'sqlite',
    url: 'http://localhost:3002',
    auth: undefined,
  },
  {
    name: 'github',
    url: 'https://api.github.com',
    auth: undefined, // Requires GITHUB_TOKEN env var
  },
];
