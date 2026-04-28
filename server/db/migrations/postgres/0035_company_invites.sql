-- Add invite token support to company_memberships
ALTER TABLE company_memberships ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS membership_token_idx ON company_memberships(invite_token);
