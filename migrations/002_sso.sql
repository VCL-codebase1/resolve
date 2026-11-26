-- Link Desk users to their vcglone identity. Password hashes stay in place so
-- existing password logins keep working during rollout.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_subject text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_provider text;

CREATE UNIQUE INDEX IF NOT EXISTS users_sso_subject_key ON users (sso_subject) WHERE sso_subject IS NOT NULL;

-- Short-lived one-time assertion ids prevent a captured login URL from being replayed.
CREATE TABLE IF NOT EXISTS sso_assertions (
  jti_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);
