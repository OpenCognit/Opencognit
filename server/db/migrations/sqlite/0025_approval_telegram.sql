-- Human-in-the-Loop: track Telegram message ID for pending approvals
-- so we can edit it (✅/❌) when user acts via inline buttons.
ALTER TABLE genehmigungen ADD COLUMN telegram_chat_id TEXT;
ALTER TABLE genehmigungen ADD COLUMN telegram_message_id INTEGER;
ALTER TABLE genehmigungen ADD COLUMN notified_at TEXT;
CREATE INDEX IF NOT EXISTS idx_genehmigungen_notified ON genehmigungen(status, notified_at);
