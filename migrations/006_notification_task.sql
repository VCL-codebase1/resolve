-- Let task alerts open their task instead of falling back to the queue.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS task_id text REFERENCES tasks (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS notifications_task ON notifications (task_id, created_at DESC);
