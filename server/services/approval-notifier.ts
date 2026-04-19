// Human-in-the-Loop Approval Notifier
//
// Polls for new pending approvals that haven't been pushed to Telegram yet,
// and sends them with inline Approve/Reject buttons. The existing callback
// handlers in messaging.ts (ap:/rj: prefixes) already action the buttons.

import { db } from '../db/client.js';
import { genehmigungen, einstellungen } from '../db/schema.js';
import { and, eq, isNull } from 'drizzle-orm';
import { decryptSetting } from '../utils/crypto.js';

const POLL_INTERVAL_MS = 20_000;

function getBotConfig(unternehmenId: string): { token: string; chatId: string } | null {
  const all = db.select().from(einstellungen).all();
  const tokenRow = all.find(s => s.schluessel === 'telegram_bot_token' && s.unternehmenId === unternehmenId);
  const chatRow  = all.find(s => s.schluessel === 'telegram_chat_id'   && s.unternehmenId === unternehmenId);
  if (!tokenRow?.wert || !chatRow?.wert) return null;
  const token = decryptSetting('telegram_bot_token', tokenRow.wert);
  if (!token) return null;
  return { token, chatId: chatRow.wert };
}

async function sendApprovalMessage(cfg: { token: string; chatId: string }, approval: any): Promise<number | null> {
  const short = approval.id.slice(0, 6);
  const typeLabel: Record<string, string> = {
    hire_expert: '🧑‍💼 Hire Expert',
    approve_strategy: '🎯 Strategy',
    budget_change: '💰 Budget',
    agent_action: '🤖 Agent Action',
  };
  const lines = [
    `*${typeLabel[approval.typ] || 'Approval'}*`,
    ``,
    `📋 ${approval.titel}`,
  ];
  if (approval.beschreibung) lines.push('', `_${String(approval.beschreibung).slice(0, 400)}_`);
  lines.push('', `ID: \`${short}\``);

  const body = {
    chat_id: cfg.chatId,
    text: lines.join('\n'),
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Genehmigen', callback_data: `ap:${short}` },
        { text: '❌ Ablehnen',   callback_data: `rj:${short}` },
      ]],
    },
  };

  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // retry without markdown if formatting rejected
      const plain = { ...body, text: lines.join('\n').replace(/[_*`]/g, ''), parse_mode: undefined };
      const res2 = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(plain),
      });
      if (!res2.ok) return null;
      const d = await res2.json() as any;
      return d?.result?.message_id ?? null;
    }
    const d = await res.json() as any;
    return d?.result?.message_id ?? null;
  } catch (e) {
    console.error('[ApprovalNotifier] send failed:', (e as any)?.message);
    return null;
  }
}

async function tick() {
  let pending: any[] = [];
  try {
    pending = db.select().from(genehmigungen)
      .where(and(eq(genehmigungen.status, 'pending'), isNull(genehmigungen.notifiedAt)))
      .limit(25).all();
  } catch {
    return; // table/columns may not exist in very old DBs
  }
  if (pending.length === 0) return;

  // group by unternehmen to share bot config
  const byCompany = new Map<string, any[]>();
  for (const p of pending) {
    const arr = byCompany.get(p.unternehmenId) || [];
    arr.push(p);
    byCompany.set(p.unternehmenId, arr);
  }

  for (const [companyId, approvals] of byCompany) {
    const cfg = getBotConfig(companyId);
    if (!cfg) {
      // No Telegram configured — mark as notified so we don't re-poll forever
      const now = new Date().toISOString();
      for (const a of approvals) {
        db.update(genehmigungen)
          .set({ notifiedAt: now })
          .where(eq(genehmigungen.id, a.id)).run();
      }
      continue;
    }

    for (const a of approvals) {
      const msgId = await sendApprovalMessage(cfg, a);
      const now = new Date().toISOString();
      db.update(genehmigungen).set({
        notifiedAt: now,
        telegramChatId: msgId ? cfg.chatId : null,
        telegramMessageId: msgId,
      }).where(eq(genehmigungen.id, a.id)).run();
    }
  }
}

let timer: NodeJS.Timeout | null = null;

export function startApprovalNotifier() {
  if (timer) return;
  // first tick after 5s to let server finish booting
  setTimeout(() => {
    tick().catch(e => console.error('[ApprovalNotifier] tick failed:', e?.message));
    timer = setInterval(() => {
      tick().catch(e => console.error('[ApprovalNotifier] tick failed:', e?.message));
    }, POLL_INTERVAL_MS);
  }, 5000);
  console.log('[ApprovalNotifier] started (poll every ' + (POLL_INTERVAL_MS / 1000) + 's)');
}

export function stopApprovalNotifier() {
  if (timer) { clearInterval(timer); timer = null; }
}
