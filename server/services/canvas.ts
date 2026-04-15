// Canvas/A2UI Service — Agent-gesteuerte UI auf Endgeräten
//
// Ermöglicht Agenten, dynamische Inhalte auf verbundenen Device Nodes anzuzeigen:
// - canvas.present: URL oder HTML in einem WebView anzeigen
// - canvas.snapshot: Screenshot des aktuellen Canvas aufnehmen
// - canvas.eval: JavaScript im WebView ausführen
// - canvas.navigate: Navigation (back, forward, reload)
// - canvas.clear: Canvas schließen
//
// Kommunikation läuft über den bestehenden NodeManager (WebSocket node.invoke).

import { nodeManager, type DeviceNode } from './nodeManager.js';

// ─── Canvas Actions ─────────────────────────────────────────────────────────

export interface CanvasOptions {
  /** Breite des Canvas-Fensters (Pixel) */
  width?: number;
  /** Höhe des Canvas-Fensters (Pixel) */
  height?: number;
  /** Position X */
  x?: number;
  /** Position Y */
  y?: number;
}

/**
 * Zeigt eine URL oder HTML-Inhalt auf einem Device Node an.
 */
export async function canvasPresent(
  nodeId: string,
  content: { url?: string; html?: string },
  options?: CanvasOptions
): Promise<any> {
  if (!content.url && !content.html) {
    throw new Error('canvas.present braucht entweder url oder html');
  }

  return nodeManager.invokeNode(nodeId, 'canvas.present', {
    url: content.url,
    html: content.html,
    width: options?.width || 800,
    height: options?.height || 600,
    x: options?.x,
    y: options?.y,
  });
}

/**
 * Macht einen Screenshot des aktuellen Canvas auf einem Device Node.
 * Gibt ein Base64-encodiertes Bild zurück.
 */
export async function canvasSnapshot(nodeId: string): Promise<{ image: string; format: string }> {
  const result = await nodeManager.invokeNode(nodeId, 'canvas.snapshot', {});
  return {
    image: result?.image || result?.base64 || '',
    format: result?.format || 'png',
  };
}

/**
 * Führt JavaScript im WebView des Canvas aus.
 * Gibt das Ergebnis der Evaluation zurück.
 */
export async function canvasEval(nodeId: string, script: string): Promise<any> {
  return nodeManager.invokeNode(nodeId, 'canvas.eval', { script });
}

/**
 * Navigation im Canvas (back, forward, reload, goto URL).
 */
export async function canvasNavigate(
  nodeId: string,
  action: 'back' | 'forward' | 'reload' | 'goto',
  url?: string
): Promise<any> {
  return nodeManager.invokeNode(nodeId, 'canvas.navigate', { action, url });
}

/**
 * Schließt den Canvas auf einem Device Node.
 */
export async function canvasClear(nodeId: string): Promise<any> {
  return nodeManager.invokeNode(nodeId, 'canvas.clear', {});
}

// ─── A2UI Protocol (Agent-to-UI) ────────────────────────────────────────────
// A2UI JSONL Protokoll v0.8 — Agent-gesteuerte UI.
// Ermöglicht Agenten, strukturierte UI-Elemente zu senden.

export interface A2UIElement {
  type: 'text' | 'heading' | 'button' | 'input' | 'image' | 'list' | 'card' | 'divider' | 'progress';
  props: Record<string, any>;
}

/**
 * Rendert A2UI-Elemente als HTML und zeigt sie auf dem Device an.
 */
export async function canvasRenderA2UI(nodeId: string, elements: A2UIElement[], options?: CanvasOptions): Promise<any> {
  const html = renderA2UIToHtml(elements);
  return canvasPresent(nodeId, { html }, options);
}

function renderA2UIToHtml(elements: A2UIElement[]): string {
  const body = elements.map(el => {
    switch (el.type) {
      case 'heading':
        const level = el.props.level || 1;
        return `<h${level} style="color:#fff;margin:0.5em 0">${escHtml(el.props.text || '')}</h${level}>`;
      case 'text':
        return `<p style="color:#a1a1aa;margin:0.25em 0;line-height:1.6">${escHtml(el.props.text || '')}</p>`;
      case 'button':
        return `<button onclick="window.__a2ui_action('${escHtml(el.props.action || '')}')" style="padding:0.5rem 1rem;background:#23CDCB;color:#000;border:none;border-radius:8px;cursor:pointer;font-weight:600;margin:0.25em 0">${escHtml(el.props.label || 'Button')}</button>`;
      case 'input':
        return `<input placeholder="${escHtml(el.props.placeholder || '')}" style="width:100%;padding:0.5rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;margin:0.25em 0" />`;
      case 'image':
        return `<img src="${escHtml(el.props.src || '')}" alt="${escHtml(el.props.alt || '')}" style="max-width:100%;border-radius:8px;margin:0.5em 0" />`;
      case 'list':
        const items = (el.props.items || []) as string[];
        return `<ul style="color:#d4d4d8;padding-left:1.5em;margin:0.25em 0">${items.map(i => `<li>${escHtml(i)}</li>`).join('')}</ul>`;
      case 'card':
        return `<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:1rem;margin:0.5em 0"><strong style="color:#fff">${escHtml(el.props.title || '')}</strong><p style="color:#a1a1aa;margin-top:0.25em">${escHtml(el.props.content || '')}</p></div>`;
      case 'divider':
        return '<hr style="border:none;border-top:1px solid rgba(255,255,255,0.08);margin:0.75em 0" />';
      case 'progress':
        const pct = Math.min(100, Math.max(0, el.props.value || 0));
        return `<div style="background:rgba(255,255,255,0.08);border-radius:4px;height:8px;margin:0.5em 0;overflow:hidden"><div style="width:${pct}%;height:100%;background:#23CDCB;border-radius:4px"></div></div>`;
      default:
        return '';
    }
  }).join('\n');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;padding:1.5rem;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0a0a14;min-height:100vh}</style>
<script>window.__a2ui_action=function(a){window.parent?.postMessage({type:'a2ui:action',action:a},'*')}</script>
</head><body>${body}</body></html>`;
}

function escHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
