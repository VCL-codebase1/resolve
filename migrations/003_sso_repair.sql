-- Repair databases where migration 2 was recorded as applied but its final
-- statement was skipped by the SQL comment parser.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_subject text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_provider text;
CREATE UNIQUE INDEX IF NOT EXISTS users_sso_subject_key ON users (sso_subject) WHERE sso_subject IS NOT NULL;
CREATE TABLE IF NOT EXISTS sso_assertions (
  jti_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);
