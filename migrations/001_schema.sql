CREATE TABLE departments (
  slug text PRIMARY KEY,
  name text NOT NULL,
  position int NOT NULL
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('member', 'lead', 'admin')),
  department_slug text NOT NULL REFERENCES departments (slug),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE department_recipients (
  department_slug text NOT NULL REFERENCES departments (slug),
  user_id uuid NOT NULL REFERENCES users (id),
  PRIMARY KEY (department_slug, user_id)
);

CREATE TABLE department_watches (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  department_slug text NOT NULL REFERENCES departments (slug),
  PRIMARY KEY (user_id, department_slug)
);

CREATE SEQUENCE ticket_no START 1001;

CREATE TABLE tickets (
  id text PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
  priority text NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  requester_id uuid NOT NULL REFERENCES users (id),
  source_department text NOT NULL REFERENCES departments (slug),
  target_department text NOT NULL REFERENCES departments (slug),
  assignee_id uuid REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tickets_updated ON tickets (updated_at DESC, id DESC);
CREATE INDEX tickets_target ON tickets (target_department, status);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES tickets (id),
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_ticket ON messages (ticket_id, created_at);

CREATE TABLE attachments (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES messages (id),
  name text NOT NULL,
  media_type text NOT NULL,
  size int NOT NULL,
  storage_key text NOT NULL
);

CREATE TABLE watchers (
  ticket_id text NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type text NOT NULL,
  ticket_id text,
  department_slug text,
  sentence text NOT NULL,
  sound text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  actor_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

CREATE TABLE outreaches (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users (id),
  department_slug text NOT NULL REFERENCES departments (slug),
  note text NOT NULL,
  unresolved_count int NOT NULL,
  ticket_ids text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE receipts (
  id uuid PRIMARY KEY,
  ticket_id text,
  outreach_id uuid REFERENCES outreaches (id),
  event text NOT NULL,
  provider_message_id text,
  to_addresses text[] NOT NULL,
  cc_addresses text[] NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'sent', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX receipts_ticket ON receipts (ticket_id, created_at);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
