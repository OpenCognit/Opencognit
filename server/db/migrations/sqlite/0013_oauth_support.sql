-- OAuth Provider Support
ALTER TABLE benutzer ADD COLUMN oauth_provider TEXT;
ALTER TABLE benutzer ADD COLUMN oauth_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_benutzer_oauth ON benutzer (oauth_provider, oauth_id)
  WHERE oauth_provider IS NOT NULL AND oauth_id IS NOT NULL;
