// HTTP Adapter - Macht API Requests

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import { db } from '../db/client.js';
import { agentPermissions } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: any;
  timeoutMs?: number;
}

export interface HttpAdapterOptions {
  defaultTimeoutMs?: number;
  allowedDomains?: string[];
  blockedDomains?: string[];
  defaultHeaders?: Record<string, string>;
}

export class HttpAdapter implements Adapter {
  public readonly name = 'http';
  private options: HttpAdapterOptions;

  constructor(options: HttpAdapterOptions = {}) {
    this.options = {
      defaultTimeoutMs: options.defaultTimeoutMs || 30 * 1000,
      allowedDomains: options.allowedDomains || [],
      blockedDomains: options.blockedDomains || [],
      defaultHeaders: options.defaultHeaders || {},
    };
  }

  canHandle(task: AdapterTask): boolean {
    const text = `${task.titel} ${task.beschreibung || ''}`;
    // Only handle tasks that contain an actual HTTP URL or an explicit HTTP method + URL
    return /https?:\/\/[^\s]+/.test(text) ||
           /\b(GET|POST|PUT|PATCH|DELETE)\s+https?:\/\//.test(text);
  }

  async execute(
    task: AdapterTask,
    context: AdapterContext,
    config: AdapterConfig
  ): Promise<AdapterExecutionResult> {
    const startTime = Date.now();
    const request = this.parseRequest(task);

    if (!request) {
      return {
        success: false,
        output: 'Kein gültiger HTTP Request gefunden',
        exitCode: 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: 'No valid HTTP request found in task',
      };
    }

    // Security check (global blocklist)
    if (!this.isUrlAllowed(request.url)) {
      return {
        success: false,
        output: `URL blockiert: ${request.url}`,
        exitCode: 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: 'URL blocked by security policy',
      };
    }

    // Agent permission check — erlaubteDomains
    if (config.expertId) {
      try {
        const perms = db.select().from(agentPermissions)
          .where(eq(agentPermissions.expertId, config.expertId)).get();
        if (perms?.erlaubteDomains) {
          const allowed: string[] = JSON.parse(perms.erlaubteDomains);
          if (allowed.length > 0) {
            let hostname = '';
            try { hostname = new URL(request.url).hostname; } catch { hostname = request.url; }
            if (!allowed.some(d => hostname === d || hostname.endsWith(`.${d}`))) {
              return {
                success: false,
                output: `Zugriff verweigert: Domain '${hostname}' ist nicht in den erlaubten Domains`,
                exitCode: 1, inputTokens: 0, outputTokens: 0, costCents: 0,
                durationMs: Date.now() - startTime,
                error: 'Domain not in agentPermissions.erlaubteDomains',
              };
            }
          }
        }
      } catch { /* permission check fail-open */ }
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), request.timeoutMs || this.options.defaultTimeoutMs);

      const fetchOptions: RequestInit = {
        method: request.method,
        headers: {
          'Content-Type': 'application/json',
          ...this.options.defaultHeaders,
          ...request.headers,
        },
        signal: controller.signal,
      };

      if (request.body && request.method !== 'GET') {
        fetchOptions.body = JSON.stringify(request.body);
      }

      const response = await fetch(request.url, fetchOptions);
      clearTimeout(timeoutId);

      const responseText = await response.text();
      let output: string;

      try {
        const json = JSON.parse(responseText);
        output = JSON.stringify(json, null, 2);
      } catch {
        output = responseText;
      }

      const statusInfo = `HTTP ${response.status} ${response.statusText}\n\n`;

      return {
        success: response.ok,
        output: statusInfo + output,
        exitCode: response.ok ? 0 : 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.message,
        exitCode: 1,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  private parseRequest(task: AdapterTask): HttpRequest | null {
    const text = task.beschreibung || task.titel;

    // Try to parse JSON request
    try {
      const jsonMatch = text.match(/\{[\s\S]*"method"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          method: parsed.method || 'GET',
          url: parsed.url,
          headers: parsed.headers,
          body: parsed.body,
          timeoutMs: parsed.timeoutMs,
        };
      }
    } catch {
      // Ignore JSON parse errors
    }

    // Try to parse curl command
    const curlMatch = text.match(/curl\s+(?:-X\s+(\w+)\s+)?(?:-H\s+"([^"]+)"\s+)?(?:-d\s+'([^']+)'\s+)?(['"])(https?:\/\/[^'"]+)\4/);
    if (curlMatch) {
      return {
        method: (curlMatch[1] as 'GET' | 'POST' | 'PUT' | 'DELETE') || 'GET',
        url: curlMatch[5],
        headers: curlMatch[2] ? { 'Content-Type': curlMatch[2].split(':')[0] } : {},
        body: curlMatch[3] ? JSON.parse(curlMatch[3]) : undefined,
      };
    }

    // Simple URL extraction with method hint
    const urlMatch = text.match(/https?:\/\/[^\s'"]+/);
    if (urlMatch) {
      const method = text.toLowerCase().includes('post') ? 'POST' :
                     text.toLowerCase().includes('put') ? 'PUT' :
                     text.toLowerCase().includes('delete') ? 'DELETE' : 'GET';
      return {
        method,
        url: urlMatch[0],
      };
    }

    return null;
  }

  private isUrlAllowed(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    const hostname = parsed.hostname;

    // SSRF protection: block all internal/private IP ranges and localhost
    if (this.isInternalHost(hostname)) {
      return false;
    }

    // Check blocked domains
    for (const blocked of this.options.blockedDomains || []) {
      if (hostname.endsWith(blocked) || hostname === blocked) {
        return false;
      }
    }

    // If allowedDomains is specified, only allow those
    if (this.options.allowedDomains && this.options.allowedDomains.length > 0) {
      return this.options.allowedDomains.some(
        allowed => hostname.endsWith(allowed) || hostname === allowed
      );
    }

    return true;
  }

  private isInternalHost(hostname: string): boolean {
    // Block localhost variants
    if (hostname === 'localhost' || hostname === '::1' || hostname === '0.0.0.0') return true;
    // Block .local mDNS
    if (hostname.endsWith('.local')) return true;

    // Parse IPv4
    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const [, a, b, c] = ipv4.map(Number);
      // 127.0.0.0/8 — loopback
      if (a === 127) return true;
      // 10.0.0.0/8 — private
      if (a === 10) return true;
      // 172.16.0.0/12 — private
      if (a === 172 && b >= 16 && b <= 31) return true;
      // 192.168.0.0/16 — private
      if (a === 192 && b === 168) return true;
      // 169.254.0.0/16 — link-local / cloud metadata (AWS 169.254.169.254 etc.)
      if (a === 169 && b === 254) return true;
      // 100.64.0.0/10 — carrier-grade NAT
      if (a === 100 && b >= 64 && b <= 127) return true;
      // 0.0.0.0/8
      if (a === 0) return true;
    }

    // Block IPv6 loopback/private (basic check)
    const lower = hostname.toLowerCase();
    if (lower.startsWith('[') && (
      lower.startsWith('[::1]') ||
      lower.startsWith('[fc') ||
      lower.startsWith('[fd') ||
      lower.startsWith('[fe80')
    )) return true;

    return false;
  }
}

export const createHttpAdapter = (options?: HttpAdapterOptions) => new HttpAdapter(options);
