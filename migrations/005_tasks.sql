-- Task management: assigned work, interdepartmental steps, evidence, discussion,
-- stage activity and idempotent reminder deliveries. Roles and departments use
-- the Desk model: member=employee, lead=manager, admin=HR/super admin.
CREATE SEQUENCE IF NOT EXISTS task_no START 1001;

CREATE TABLE IF NOT EXISTS tasks (
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

CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks (assignee_id, status);
CREATE INDEX IF NOT EXISTS tasks_assigner ON tasks (assigned_by_id, status);
CREATE INDEX IF NOT EXISTS tasks_status_due ON tasks (status, due_at);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks (due_at);

CREATE TABLE IF NOT EXISTS task_steps (
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

CREATE INDEX IF NOT EXISTS task_steps_task ON task_steps (task_id, position);
CREATE INDEX IF NOT EXISTS task_steps_assignee ON task_steps (assignee_id, status, due_at);
CREATE INDEX IF NOT EXISTS task_steps_lead ON task_steps (target_lead_id, status, due_at);
CREATE INDEX IF NOT EXISTS task_steps_source ON task_steps (source_department, created_at);
CREATE INDEX IF NOT EXISTS task_steps_target ON task_steps (target_department, created_at);
CREATE INDEX IF NOT EXISTS task_steps_exchange ON task_steps (interdepartmental, status, due_at);

CREATE TABLE IF NOT EXISTS task_resources (
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

CREATE INDEX IF NOT EXISTS task_resources_task ON task_resources (task_id);
CREATE INDEX IF NOT EXISTS task_resources_uploader ON task_resources (uploader_id);

CREATE TABLE IF NOT EXISTS task_comments (
  id uuid PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_comments_task ON task_comments (task_id, created_at);
CREATE INDEX IF NOT EXISTS task_comments_author ON task_comments (author_id);

CREATE TABLE IF NOT EXISTS task_activities (
  id uuid PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action text NOT NULL,
  message text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_activities_task ON task_activities (task_id, created_at);
CREATE INDEX IF NOT EXISTS task_activities_actor ON task_activities (actor_id);

CREATE TABLE IF NOT EXISTS task_reminder_deliveries (
  id uuid PRIMARY KEY,
  task_id text NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, user_id, kind, scheduled_for)
);

CREATE INDEX IF NOT EXISTS task_reminders_user ON task_reminder_deliveries (user_id, sent_at);
CREATE INDEX IF NOT EXISTS task_reminders_task ON task_reminder_deliveries (task_id);
