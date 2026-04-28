-- Company memberships for multi-user authorization
CREATE TABLE IF NOT EXISTS company_memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES unternehmen(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner', 'admin', 'member')),
  invited_at TIMESTAMP,
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, company_id)
);

CREATE INDEX IF NOT EXISTS membership_user_idx ON company_memberships(user_id);
CREATE INDEX IF NOT EXISTS membership_company_idx ON company_memberships(company_id);
