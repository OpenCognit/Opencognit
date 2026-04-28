// Email Adapter — Sendet und empfängt E-Mails via SMTP/IMAP
//
// Konfiguration (verbindungsConfig JSON):
// {
//   "smtpHost": "smtp.gmail.com",
//   "smtpPort": 587,
//   "smtpUser": "agent@example.com",
//   "smtpPass": "app-password",
//   "imapHost": "imap.gmail.com",      // optional
//   "imapPort": 993,                   // optional
//   "from": "OpenCognit Agent <agent@example.com>"
// }

import { Adapter, AdapterConfig, AdapterExecutionResult, AdapterTask, AdapterContext } from './types.js';
import nodemailer from 'nodemailer';
import Imap from 'imap';
import { simpleParser } from 'mailparser';

export interface EmailAdapterOptions {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  imapHost?: string;
  imapPort?: number;
  from?: string;
}

export class EmailAdapter implements Adapter {
  public readonly name = 'email';

  canHandle(task: AdapterTask): boolean {
    const text = `${task.title} ${task.description || ''}`.toLowerCase();
    return text.includes('email') ||
           text.includes('e-mail') ||
           text.includes('mail') ||
           text.includes('smtp') ||
           text.includes('imap') ||
           text.includes('sende nachricht') ||
           text.includes('send message') ||
           text.startsWith('schreibe ');
  }

  async execute(
    task: AdapterTask,
    _context: AdapterContext,
    config: AdapterConfig
  ): Promise<AdapterExecutionResult> {
    const startTime = Date.now();
    const cfg = (config.connectionConfig ?? {}) as EmailAdapterOptions;

    // No SMTP config → can't send
    if (!cfg.smtpHost || !cfg.smtpUser || !cfg.smtpPass) {
      return err('Email adapter: SMTP-Konfiguration fehlt (smtpHost, smtpUser, smtpPass)', startTime);
    }

    const command = this.extractCommand(task);

    try {
      // Create transporter
      const transporter = nodemailer.createTransport({
        host: cfg.smtpHost,
        port: cfg.smtpPort || 587,
        secure: (cfg.smtpPort || 587) === 465,
        auth: {
          user: cfg.smtpUser,
          pass: cfg.smtpPass,
        },
        tls: {
          rejectUnauthorized: false, // Allow self-signed certs in dev
        },
      });

      // Verify connection
      await transporter.verify();

      // Parse email task
      const parsed = this.parseEmailTask(task);

      if (parsed.action === 'send') {
        const info = await transporter.sendMail({
          from: cfg.from || cfg.smtpUser,
          to: parsed.to,
          subject: parsed.subject || task.title,
          text: parsed.body || task.description || '',
          html: parsed.html,
        });

        return {
          success: true,
          output: `E-Mail gesendet an ${parsed.to}\nMessage-ID: ${info.messageId}`,
          exitCode: 0,
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          durationMs: Date.now() - startTime,
        };
      }

      if (parsed.action === 'read' && cfg.imapHost) {
        const emails = await this.readEmails(cfg, parsed.limit || 5);
        return {
          success: true,
          output: emails.map((e, i) => `${i + 1}. [${e.date}] ${e.from}: ${e.subject}\n${e.text?.slice(0, 200)}...`).join('\n\n---\n\n'),
          exitCode: 0,
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          durationMs: Date.now() - startTime,
        };
      }

      return err('Unbekannte E-Mail-Aktion. Verwende "sende E-Mail an <email>" oder "lese E-Mails".', startTime);

    } catch (e: any) {
      return err(`E-Mail Fehler: ${e.message}`, startTime);
    }
  }

  private extractCommand(task: AdapterTask): string {
    return task.description || task.title;
  }

  private parseEmailTask(task: AdapterTask): {
    action: 'send' | 'read' | 'unknown';
    to?: string;
    subject?: string;
    body?: string;
    html?: string;
    limit?: number;
  } {
    const text = `${task.title} ${task.description || ''}`;
    const lower = text.toLowerCase();

    // Read action
    if (lower.includes('lese') || lower.includes('read') || lower.includes('empfange') || lower.includes('inbox')) {
      const limitMatch = text.match(/(\d+)\s*(?:emails?|nachrichten)/i);
      return { action: 'read', limit: limitMatch ? parseInt(limitMatch[1]) : 5 };
    }

    // Send action
    const toMatch = text.match(/(?:an|to)\s*[:\s]+([\w.-]+@[\w.-]+\.\w+)/i) ||
                    text.match(/([\w.-]+@[\w.-]+\.\w+)/);
    const subjectMatch = text.match(/(?:betreff|subject)\s*[:\s]+([^\n]+)/i);

    // Extract body from code blocks or after a separator
    let body = task.description || '';
    const codeBlock = body.match(/```(?:text)?\n([\s\S]*?)```/);
    if (codeBlock) body = codeBlock[1].trim();

    return {
      action: 'send',
      to: toMatch ? toMatch[1] : undefined,
      subject: subjectMatch ? subjectMatch[1].trim() : task.title,
      body: body || task.title,
    };
  }

  private readEmails(cfg: EmailAdapterOptions, limit: number): Promise<Array<{
    subject: string;
    from: string;
    date: string;
    text?: string;
  }>> {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: cfg.smtpUser!,
        password: cfg.smtpPass!,
        host: cfg.imapHost!,
        port: cfg.imapPort || 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
      });

      const emails: Array<{ subject: string; from: string; date: string; text?: string }> = [];

      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err, box) => {
          if (err) { imap.end(); return reject(err); }

          const fetch = imap.seq.fetch(`${Math.max(1, box.messages.total - limit + 1)}:*`, {
            bodies: '',
            struct: true,
          });

          fetch.on('message', (msg) => {
            let raw = '';
            msg.on('body', (stream) => {
              stream.on('data', (chunk) => { raw += chunk; });
            });
            msg.once('end', () => {
              simpleParser(raw, (parseErr, parsed) => {
                if (!parseErr) {
                  emails.push({
                    subject: parsed.subject || '(kein Betreff)',
                    from: parsed.from?.text || '(unbekannt)',
                    date: parsed.date?.toISOString() || '',
                    text: parsed.text || '',
                  });
                }
              });
            });
          });

          fetch.once('end', () => {
            imap.end();
            resolve(emails.reverse());
          });

          fetch.once('error', (fetchErr) => {
            imap.end();
            reject(fetchErr);
          });
        });
      });

      imap.once('error', (err) => reject(err));
      imap.connect();
    });
  }
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

export const createEmailAdapter = () => new EmailAdapter();
