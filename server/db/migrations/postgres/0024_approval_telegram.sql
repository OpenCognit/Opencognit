-- Human-in-the-Loop: track Telegram message ID for pending approvals
ALTER TABLE genehmigungen ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE genehmigungen ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;
ALTER TABLE genehmigungen ADD COLUMN IF NOT EXISTS notified_at TEXT;
CREATE INDEX IF NOT EXISTS idx_genehmigungen_notified ON genehmigungen(status, notified_at);
