CREATE TABLE departments (
  slug text PRIMARY KEY,
  name text NOT NULL,
  position int NOT NULL
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text,
  sso_subject text,
  identity_provider text,
  role text NOT NULL CHECK (role IN ('member', 'lead', 'admin')),
  department_slug text NOT NULL REFERENCES departments (slug),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_sso_subject_key ON users (sso_subject) WHERE sso_subject IS NOT NULL;

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

CREATE TABLE ticket_events (
  id uuid PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ticket_events_ticket ON ticket_events (ticket_id, created_at);

CREATE SEQUENCE task_no START 1001;

CREATE TABLE tasks (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  expected_outcome text,
  assignee_id uuid NOT NULL REFERENCES users (id),
  assigned_by_id uuid NOT NULL REFERENCES users (id),
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')) DEFAULT 'medium',
  status text NOT NULL CHECK (status IN ('assigned', 'in_progress', 'blocked', 'in_review', 'changes_requested', 'completed', 'cancelled')) DEFAULT 'assigned',
  start_at timestamptz,
  due_at timestamptz NOT NULL,
  reminder_offsets int[] NOT NULL DEFAULT '{1440,120,0}',
  blocked_reason text,
  submission_note text,
  review_comment text,
  started_at timestamptz,
  blocked_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tasks_assignee ON tasks (assignee_id, status);
CREATE INDEX tasks_assigner ON tasks (assigned_by_id, status);
CREATE INDEX tasks_status_due ON tasks (status, due_at);
CREATE INDEX tasks_due ON tasks (due_at);

CREATE TABLE task_steps (
  id uuid PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  position int NOT NULL,
  required boolean NOT NULL DEFAULT true,
  assignee_id uuid NOT NULL REFERENCES users (id),
  assigned_by_id uuid NOT NULL REFERENCES users (id),
  source_department text REFERENCES departments (slug) ON DELETE SET NULL,
  target_department text REFERENCES departments (slug) ON DELETE SET NULL,
  target_lead_id uuid REFERENCES users (id) ON DELETE SET NULL,
  interdepartmental boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('assigned', 'in_progress', 'blocked', 'completed', 'cancelled')) DEFAULT 'assigned',
  due_at timestamptz NOT NULL,
  started_at timestamptz,
  blocked_at timestamptz,
  blocked_reason text,
  completed_at timestamptz,
  completion_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_steps_task ON task_steps (task_id, position);
CREATE INDEX task_steps_assignee ON task_steps (assignee_id, status, due_at);
CREATE INDEX task_steps_lead ON task_steps (target_lead_id, status, due_at);
CREATE INDEX task_steps_source ON task_steps (source_department, created_at);
CREATE INDEX task_steps_target ON task_steps (target_department, created_at);
CREATE INDEX task_steps_exchange ON task_steps (interdepartmental, status, due_at);

CREATE TABLE task_resources (
  id uuid PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  uploader_id uuid NOT NULL REFERENCES users (id),
  type text NOT NULL CHECK (type IN ('link', 'file')),
  title text NOT NULL,
  url text,
  file_name text,
  media_type text,
  size int,
  storage_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_resources_task ON task_resources (task_id);
CREATE INDEX task_resources_uploader ON task_resources (uploader_id);

CREATE TABLE task_comments (
  id uuid PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_comments_task ON task_comments (task_id, created_at);
CREATE INDEX task_comments_author ON task_comments (author_id);

CREATE TABLE task_activities (
  id uuid PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action text NOT NULL,
  message text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_activities_task ON task_activities (task_id, created_at);
CREATE INDEX task_activities_actor ON task_activities (actor_id);

CREATE TABLE task_reminder_deliveries (
  id uuid PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id, kind, scheduled_for)
);

CREATE INDEX task_reminders_user ON task_reminder_deliveries (user_id, sent_at);
CREATE INDEX task_reminders_task ON task_reminder_deliveries (task_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type text NOT NULL,
  ticket_id text,
  task_id text REFERENCES tasks (id) ON DELETE SET NULL,
  department_slug text,
  sentence text NOT NULL,
  sound text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  actor_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);

CREATE INDEX notifications_task ON notifications (task_id, created_at DESC);

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

CREATE TABLE sso_assertions (
  jti_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);
