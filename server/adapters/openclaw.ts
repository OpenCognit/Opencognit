/**
 * OpenClaw Gateway Adapter
 *
 * Delegates task execution to a remote OpenClaw agent via WebSocket.
 * OpenClaw is the server; OpenCognit connects to it per-task, sends a wake
 * payload, and waits for the result. The agent's full knowledge / memory
 * stays on the OpenClaw side — OpenCognit only orchestrates.
 *
 * verbindungsConfig (JSON in experten.verbindungs_config):
 * {
 *   "openclawGateway": true,
 *   "gatewayUrl":      "wss://user-server:3400",  // ws:// also allowed for LAN
 *   "token":           "<gateway-auth-token>",
 *   "openclawAgentId": "<agent-uuid-in-openclaw>"  // optional
 * }
 */

import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import type { Adapter, AdapterConfig, AdapterContext, AdapterExecutionResult, AdapterTask } from './types.js';

// ── Protocol ──────────────────────────────────────────────────────────────────

type RequestFrame = { type: 'req'; id: string; method: string; params?: unknown };
type ResponseFrame = { type: 'res'; id: string; ok: boolean; payload?: unknown; error?: { code?: string; message?: string } };
type EventFrame    = { type: 'event'; event: string; payload?: unknown };

function isResponse(v: unknown): v is ResponseFrame {
  return !!v && typeof v === 'object' && (v as any).type === 'res';
}
function isEvent(v: unknown): v is EventFrame {
  return !!v && typeof v === 'object' && (v as any).type === 'event';
}

// ── Simple WS client ──────────────────────────────────────────────────────────

class OpenClawWsClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout | null }>();
  private onEventCb: (frame: EventFrame) => void;

  constructor(onEvent: (frame: EventFrame) => void) {
    this.onEventCb = onEvent;
  }

  async connect(url: string, headers: Record<string, string>, timeoutMs: number): Promise<void> {
    this.ws = new WebSocket(url, { headers, maxPayload: 16 * 1024 * 1024 });
    const ws = this.ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('OpenClaw WS connect timeout')), timeoutMs);
      ws.once('open', () => { clearTimeout(timer); resolve(); });
      ws.once('error', (err) => { clearTimeout(timer); reject(err); });
      ws.once('close', (code, reason) => {
        clearTimeout(timer);
        reject(new Error(`OpenClaw WS closed before open: ${code} ${reason}`));
      });
    });

    ws.on('message', (data) => {
      let parsed: unknown;
      try { parsed = JSON.parse(typeof data === 'string' ? data : data.toString()); } catch { return; }

      if (isEvent(parsed)) {
        this.onEventCb(parsed);
        return;
      }
      if (isResponse(parsed)) {
        const pending = this.pending.get(parsed.id);
        if (!pending) return;
        if (pending.timer) clearTimeout(pending.timer);
        this.pending.delete(parsed.id);
        if (parsed.ok) {
          pending.resolve(parsed.payload ?? null);
        } else {
          const msg = parsed.error?.message ?? parsed.error?.code ?? 'OpenClaw gateway error';
          pending.reject(new Error(msg));
        }
      }
    });

    ws.on('close', (code, reason) => {
      const err = new Error(`OpenClaw WS closed: ${code} ${reason}`);
      for (const p of this.pending.values()) {
        if (p.timer) clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    });
  }

  request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('OpenClaw WS not connected'));
    }
    const id = randomUUID();
    const frame: RequestFrame = { type: 'req', id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`OpenClaw gateway timeout (${method})`));
          }, timeoutMs)
        : null;

      this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      this.ws!.send(JSON.stringify(frame));
    });
  }

  close() {
    this.ws?.close(1000, 'opencognit-done');
    this.ws = null;
  }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class OpenClawAdapter implements Adapter {
  public readonly name = 'openclaw';

  /** Never selected by content matching — always dispatched by verbindungsTyp */
  canHandle(_task: AdapterTask): boolean { return false; }

  async execute(
    task: AdapterTask,
    context: AdapterContext,
    config: AdapterConfig,
  ): Promise<AdapterExecutionResult> {
    const startTime = Date.now();
    const cfg = (config as any).verbindungsConfig ?? {};

    const gatewayUrl: string = cfg.gatewayUrl ?? '';
    const token: string      = cfg.token ?? '';
    const openclawAgentId: string | null = cfg.openclawAgentId ?? null;

    if (!gatewayUrl) {
      return err('OpenClaw adapter: gatewayUrl fehlt in verbindungsConfig', startTime);
    }
    if (!token) {
      return err('OpenClaw adapter: token fehlt in verbindungsConfig', startTime);
    }

    const timeoutMs     = config.timeoutMs ?? 10 * 60 * 1000;
    const connectMs     = Math.min(timeoutMs, 15_000);
    const waitTimeoutMs = timeoutMs;

    // ── Build wake payload ─────────────────────────────────────────────────────
    const e = context.openclawEnrichment;

    const messageParts: string[] = [
      `Aufgabe: ${task.titel}`,
      task.beschreibung ? `\nBeschreibung:\n${task.beschreibung}` : '',
      `\nPriorität: ${task.prioritaet}`,
      context.companyContext.ziel ? `\nUnternehmensziel: ${context.companyContext.ziel}` : '',
      context.agentContext.gedaechtnis ? `\n[GEDÄCHTNIS]\n${context.agentContext.gedaechtnis}` : '',
    ];

    // ── Enrichment: situational awareness ──────────────────────────────────────
    if (e) {
      if (e.recentOutputs.length > 0) {
        messageParts.push(
          `\n[MEINE LETZTEN ABGESCHLOSSENEN AUFGABEN]`,
          ...e.recentOutputs.map(r => `• ${r.taskTitel} (${r.completedAt.slice(0, 10)})\n  ${r.output.slice(0, 400)}`),
        );
      }
      if (e.projectSiblingTasks.length > 0) {
        messageParts.push(
          `\n[WEITERE AUFGABEN IN DIESEM PROJEKT]`,
          ...e.projectSiblingTasks.map(t =>
            `• [${t.status.toUpperCase()}] ${t.titel}${t.assignedTo ? ` → ${t.assignedTo}` : ' (unassigned)'}`
          ),
        );
      }
      if (e.kgFacts.length > 0) {
        messageParts.push(
          `\n[RELEVANTES WISSEN AUS OPENCOGNIT]`,
          ...e.kgFacts.map(f => `• ${f.subject} ${f.predicate} ${f.object}`),
        );
      }
      if (e.activeColleagues.length > 0) {
        messageParts.push(
          `\n[TEAM — GERADE AKTIV]`,
          ...e.activeColleagues.map(c => `• ${c.name} (${c.rolle}): arbeitet an „${c.currentTask}"`),
        );
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    const wakePayload: Record<string, unknown> = {
      runId:      config.runId,
      agentId:    config.expertId,
      companyId:  config.unternehmenId,
      taskId:     task.id,
      wakeReason: 'opencognit_task',
      message:    messageParts.filter(Boolean).join(''),
      sessionKey: `opencognit:task:${task.id}`,
      idempotencyKey: config.runId,
      opencognit: {
        runId:        config.runId,
        taskId:       task.id,
        agentId:      config.expertId,
        companyId:    config.unternehmenId,
        agentName:    context.agentContext.name,
        agentRolle:   context.agentContext.rolle,
        companyName:  context.companyContext.name,
        // Structured enrichment for OpenClaw systems that can parse it
        enrichment: e ?? null,
      },
    };

    if (openclawAgentId) wakePayload.agentId = openclawAgentId;

    // ── Connect ────────────────────────────────────────────────────────────────
    const assistantChunks: string[] = [];

    const onEvent = (frame: EventFrame) => {
      if (frame.event !== 'agent') return;
      const payload = (frame.payload as any) ?? {};
      if (payload.runId !== config.runId && payload.runId !== openclawAgentId) return;
      const data = payload.data ?? {};
      if (payload.stream === 'assistant') {
        if (data.delta) assistantChunks.push(data.delta);
        else if (data.text) assistantChunks.push(data.text);
      }
    };

    const client = new OpenClawWsClient(onEvent);

    try {
      const headers: Record<string, string> = {
        'x-openclaw-token': token,
        'Authorization': `Bearer ${token}`,
      };

      console.log(`[openclaw] Connecting to ${gatewayUrl} for task ${task.id}`);
      await client.connect(gatewayUrl, headers, connectMs);
      console.log(`[openclaw] Connected — sending agent wake`);

      // Send task to OpenClaw agent
      const accepted = await client.request<Record<string, unknown>>('agent', wakePayload, connectMs) as any;
      const acceptedStatus = (accepted?.status ?? '').toLowerCase();
      const acceptedRunId  = accepted?.runId ?? config.runId;

      console.log(`[openclaw] Agent accepted: runId=${acceptedRunId} status=${acceptedStatus}`);

      // If not immediately done — wait for completion
      let resultPayload: any = accepted;
      if (acceptedStatus !== 'ok') {
        console.log(`[openclaw] Waiting for completion (waitTimeoutMs=${waitTimeoutMs})`);
        resultPayload = await client.request<Record<string, unknown>>(
          'agent.wait',
          { runId: acceptedRunId, timeoutMs: waitTimeoutMs },
          waitTimeoutMs + connectMs,
        );
        const waitStatus = (resultPayload?.status ?? '').toLowerCase();
        if (waitStatus === 'timeout') {
          return err(`OpenClaw gateway run timed out after ${waitTimeoutMs}ms`, startTime);
        }
        if (waitStatus === 'error') {
          return err(resultPayload?.error ?? 'OpenClaw run failed', startTime);
        }
      }

      // Collect output
      const streamText   = assistantChunks.join('').trim();
      const payloadText  = extractText(resultPayload);
      const output       = streamText || payloadText || 'OpenClaw agent abgeschlossen (keine Textausgabe)';

      // Usage (if OpenClaw reports it)
      const usage = (resultPayload?.result as any)?.meta?.agentMeta?.usage ?? resultPayload?.usage ?? {};
      const inputTokens  = Number(usage.inputTokens  ?? 0);
      const outputTokens = Number(usage.outputTokens ?? 0);
      const costUsd      = Number((resultPayload?.result as any)?.meta?.agentMeta?.costUsd ?? resultPayload?.costUsd ?? 0);
      const costCents    = Math.round(costUsd * 100);

      console.log(`[openclaw] Task complete — ${output.length} chars, ${inputTokens}/${outputTokens} tokens`);

      return {
        success: true,
        output,
        exitCode: 0,
        inputTokens,
        outputTokens,
        costCents,
        durationMs: Date.now() - startTime,
      };

    } catch (e: any) {
      console.error(`[openclaw] Error: ${e.message}`);
      return err(e.message ?? 'OpenClaw adapter error', startTime);
    } finally {
      client.close();
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function err(message: string, startTime: number): AdapterExecutionResult {
  return { success: false, output: message, exitCode: 1, inputTokens: 0, outputTokens: 0, costCents: 0, durationMs: Date.now() - startTime, error: message };
}

function extractText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as any;
  const payloads = Array.isArray(p?.result?.payloads) ? p.result.payloads : [];
  const fromPayloads = payloads.map((e: any) => e?.text).filter(Boolean).join('\n\n');
  if (fromPayloads) return fromPayloads;
  return p?.result?.text ?? p?.result?.summary ?? p?.summary ?? p?.text ?? null;
}

export const createOpenClawAdapter = () => new OpenClawAdapter();
