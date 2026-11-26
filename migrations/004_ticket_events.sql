-- Structured stage history so ticket issuers can see how work progressed.
CREATE TABLE IF NOT EXISTS ticket_events (
  id uuid PRIMARY KEY,
  ticket_id text NOT NULL REFERENCES tickets (id) ON DELETE CASCADE,
  type text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ticket_events_ticket ON ticket_events (ticket_id, created_at);
