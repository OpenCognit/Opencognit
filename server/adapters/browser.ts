// Browser Automation Adapter — Hermes-inspired web automation via Playwright
//
// Supports: navigate, screenshot, click, type, extract text, evaluate JS, PDF export
//
// Konfiguration (verbindungsConfig JSON):
// {
//   "headless": true,
//   "viewport": { "width": 1280, "height": 720 },
//   "userAgent": "OpenCognit Browser Agent",
//   "timeoutMs": 30000,
//   "screenshotDir": "/tmp/opencognit-screenshots"
// }

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import { chromium, Browser, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export interface BrowserAdapterOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  userAgent?: string;
  timeoutMs?: number;
  screenshotDir?: string;
}

export class BrowserAdapter implements Adapter {
  public readonly name = 'browser';
  private browser: Browser | null = null;

  canHandle(task: AdapterTask): boolean {
    const text = `${task.title} ${task.description || ''}`.toLowerCase();
    const keywords = [
      'browser', 'webseite', 'website', 'screenshot', 'navigiere', 'navigate',
      'suche auf', 'search on', 'google', 'öffne url', 'open url', 'besuche',
      'klicke auf', 'click on', 'formular', 'form', 'extrahiere', 'scrape',
      'web', 'html', 'pdf', 'headless', 'playwright', 'puppeteer',
    ];
    return keywords.some(k => text.includes(k));
  }

  async execute(
    task: AdapterTask,
    _context: AdapterContext,
    config: AdapterConfig
  ): Promise<AdapterExecutionResult> {
    const startTime = Date.now();
    const cfg: BrowserAdapterOptions = (config.connectionConfig ?? {}) as BrowserAdapterOptions;
    const timeout = cfg.timeoutMs || 30000;
    const screenshotDir = cfg.screenshotDir || path.join(process.cwd(), 'data', 'screenshots');

    // Ensure screenshot directory exists
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    let page: Page | null = null;

    try {
      // Launch browser (or reuse if already open)
      if (!this.browser || !this.browser.isConnected()) {
        this.browser = await chromium.launch({
          headless: cfg.headless !== false,
        });
      }

      const context = await this.browser.newContext({
        viewport: cfg.viewport || { width: 1280, height: 720 },
        userAgent: cfg.userAgent || 'OpenCognit Browser Agent/1.0',
      });

      page = await context.newPage();
      page.setDefaultTimeout(timeout);

      const command = this.parseCommand(task);
      const results: string[] = [];

      for (const step of command.steps) {
        const stepResult = await this.executeStep(page, step, screenshotDir, timeout);
        results.push(stepResult);
      }

      await context.close();

      return {
        success: true,
        output: results.join('\n\n---\n\n'),
        exitCode: 0,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        durationMs: Date.now() - startTime,
      };

    } catch (e: any) {
      // Capture screenshot on error
      if (page) {
        try {
          const errorShot = path.join(screenshotDir, `error-${Date.now()}.png`);
          await page.screenshot({ path: errorShot, fullPage: true });
        } catch { /* ignore screenshot errors */ }
      }
      return err(`Browser-Fehler: ${e.message}`, startTime);
    }
  }

  private async executeStep(
    page: Page,
    step: BrowserStep,
    screenshotDir: string,
    timeout: number
  ): Promise<string> {
    switch (step.action) {
      case 'navigate': {
        if (!step.url) throw new Error('navigate: URL fehlt');
        const response = await page.goto(step.url, { waitUntil: 'networkidle', timeout });
        const status = response?.status() ?? 0;
        let output = `🌐 Navigiert zu ${step.url} (Status: ${status})\n`;
        output += `📄 Titel: ${await page.title()}\n`;
        output += `🔗 URL: ${page.url()}`;
        return output;
      }

      case 'screenshot': {
        const filename = step.filename || `screenshot-${Date.now()}.png`;
        const filepath = path.join(screenshotDir, filename);
        await page.screenshot({
          path: filepath,
          fullPage: step.fullPage ?? false,
        });
        return `📸 Screenshot gespeichert: ${filepath}`;
      }

      case 'click': {
        if (!step.selector) throw new Error('click: Selector fehlt');
        await page.click(step.selector);
        return `🖱️  Geklickt auf: ${step.selector}`;
      }

      case 'type': {
        if (!step.selector || step.text === undefined) throw new Error('type: Selector oder Text fehlt');
        await page.fill(step.selector, step.text);
        return `⌨️  Text eingegeben in ${step.selector}: "${step.text.slice(0, 50)}${step.text.length > 50 ? '...' : ''}"`;
      }

      case 'extract': {
        const selector = step.selector || 'body';
        const text = await page.locator(selector).textContent();
        const truncated = text?.slice(0, step.maxLength || 5000) || '(kein Text gefunden)';
        return `📄 Extrahierter Text von ${selector}:\n${truncated}${(text?.length || 0) > (step.maxLength || 5000) ? '\n... (gekürzt)' : ''}`;
      }

      case 'evaluate': {
        if (!step.script) throw new Error('evaluate: Script fehlt');
        const result = await page.evaluate((script) => {
          try {
            return eval(script);
          } catch (e: any) {
            return `Error: ${e.message}`;
          }
        }, step.script);
        return `⚡ JavaScript Ergebnis:\n${JSON.stringify(result, null, 2)}`;
      }

      case 'pdf': {
        const filename = step.filename || `page-${Date.now()}.pdf`;
        const filepath = path.join(screenshotDir, filename);
        await page.pdf({ path: filepath, format: 'A4' });
        return `📄 PDF gespeichert: ${filepath}`;
      }

      case 'wait': {
        const ms = step.ms || 1000;
        await page.waitForTimeout(ms);
        return `⏱️  Gewartet ${ms}ms`;
      }

      default:
        return `❓ Unbekannte Aktion: ${(step as any).action}`;
    }
  }

  private parseCommand(task: AdapterTask): { steps: BrowserStep[] } {
    const text = `${task.title}\n${task.description || ''}`;
    const steps: BrowserStep[] = [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Auto-detect common patterns
    const urlMatch = text.match(/(https?:\/\/[^\s\"]+)/);
    if (urlMatch) {
      steps.push({ action: 'navigate', url: urlMatch[1] });
    }

    if (text.toLowerCase().includes('screenshot') || text.toLowerCase().includes('bildschirmfoto')) {
      steps.push({ action: 'screenshot', fullPage: text.toLowerCase().includes('full page') || text.toLowerCase().includes('ganze seite') });
    }

    if (text.toLowerCase().includes('pdf')) {
      steps.push({ action: 'pdf' });
    }

    // Extract text if no specific action
    if (steps.length === 0 || text.toLowerCase().includes('extrahiere') || text.toLowerCase().includes('scrape')) {
      steps.push({ action: 'extract', maxLength: 10000 });
    }

    // If still no steps, default to navigate + extract
    if (steps.length === 0 && urlMatch) {
      steps.push({ action: 'extract', maxLength: 5000 });
    }

    return { steps };
  }
}

interface BrowserStep {
  action: 'navigate' | 'screenshot' | 'click' | 'type' | 'extract' | 'evaluate' | 'pdf' | 'wait';
  url?: string;
  selector?: string;
  text?: string;
  script?: string;
  filename?: string;
  fullPage?: boolean;
  maxLength?: number;
  ms?: number;
}

function err(message: string, startTime: number): AdapterExecutionResult {
  return {
    success: false,
    output: message,
    exitCode: 1,
    inputTokens: 0,
    outputTokens: 0,
    costCents: 0,
    durationMs: Date.now() - startTime,
    error: message,
  };
}

export const createBrowserAdapter = () => new BrowserAdapter();
