-- Add invite token support to company_memberships
-- SQLite does not allow ADD COLUMN with UNIQUE constraint, so we add the column first and create a unique index separately.
ALTER TABLE company_memberships ADD COLUMN invite_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS membership_token_idx ON company_memberships(invite_token);
