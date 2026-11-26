import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { after } from "next/server";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPassword,
  cookieValue,
  createSession,
  destroySession,
  hashPassword,
  sameSecret,
  sessionCookie,
  userById,
  userFromRequest,
  rateLimit,
  type User,
} from "./auth";
import {
  consumeAssertion,
  signState,
  ssoConfig,
  ssoReady,
  userFromAssertion,
  verifyAssertion,
  verifyState,
  type SsoDoor,
} from "./sso";
import { q, tx } from "./db";
import {
  STATUS_LABEL,
  TASK_PRIORITY_LABEL,
  TASK_STEP_STATUS_LABEL,
  TASK_STATUS_LABEL,
  isPriority,
  isRole,
  isStatus,
  isTaskPriority,
  isTaskStatus,
  taskActive,
  taskClosed,
  type DepartmentSlug,
  type Priority,
  type Status,
  type TaskPriority,
  type TaskStatus,
  type TaskStepStatus,
} from "./labels";
import { readStoredFile, storeFile } from "./files";
import { deliver, type MailInput } from "./mail";
import { publish } from "./realtime";

const uploads = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "uploads");

async function departmentName(slug: string) {
  const rows = await q<{ name: string }>(`SELECT name FROM departments WHERE slug = $1`, [slug]);
  return rows[0]?.name ?? null;
}

async function requireDepartment(slug: string) {
  const name = await departmentName(slug);
  if (!name) throw new HttpError(422, "validation", "Choose a department.", { departmentslug: "Choose a department." });
  return name;
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message);
  }
}

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers });
}

function fail(error: HttpError) {
  return json(
    { error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } },
    error.status,
  );
}

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function origin() {
  return (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
}

function person(row: User, includeEmail: boolean) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    departmentSlug: row.departmentSlug,
    active: row.active,
    ...(includeEmail ? { email: row.email } : {}),
  };
}

function personFromAliases(row: Record<string, unknown>, prefix: string, includeEmail: boolean) {
  const id = row[`${prefix}_id`];
  if (!id) return null;
  return person(
    {
      id: String(id),
      name: String(row[`${prefix}_name`]),
      role: row[`${prefix}_role`] as User["role"],
      departmentSlug: row[`${prefix}_department`] as DepartmentSlug,
      active: Boolean(row[`${prefix}_active`]),
      email: String(row[`${prefix}_email`] ?? ""),
    },
    includeEmail,
  );
}

const ticketSelect = `
  SELECT t.id, t.title, t.status, t.priority, t.source_department, t.target_department,
         t.created_at, t.updated_at,
         ru.id AS requester_id, ru.name AS requester_name, ru.role AS requester_role,
         ru.department_slug AS requester_department, ru.active AS requester_active, ru.email AS requester_email,
         au.id AS assignee_id, au.name AS assignee_name, au.role AS assignee_role,
         au.department_slug AS assignee_department, au.active AS assignee_active, au.email AS assignee_email
  FROM tickets t
  JOIN users ru ON ru.id = t.requester_id
  LEFT JOIN users au ON au.id = t.assignee_id
`;

function mapTicket(row: Record<string, unknown>, includeEmail: boolean) {
  return {
    id: String(row.id),
    title: String(row.title),
    status: row.status as Status,
    priority: row.priority as Priority,
    requester: personFromAliases(row, "requester", includeEmail),
    sourceDepartment: row.source_department as DepartmentSlug,
    targetDepartment: row.target_department as DepartmentSlug,
    assignee: personFromAliases(row, "assignee", includeEmail),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function watchesOf(userId: string) {
  const rows = await q<{ department_slug: string }>(
    `SELECT department_slug FROM department_watches WHERE user_id = $1 ORDER BY department_slug`,
    [userId],
  );
  return rows.map((row) => row.department_slug);
}

async function me(user: User) {
  return {
    ...person(user, true),
    email: user.email,
    watches: await watchesOf(user.id),
    active: user.active,
  };
}

async function requireUser(request: Request) {
  const user = await userFromRequest(request);
  if (!user) throw new HttpError(401, "unauthorized", "Sign in to continue.");
  return user;
}

function requireAdmin(user: User) {
  if (user.role !== "admin") throw new HttpError(403, "forbidden", "Only a superadmin can do that.");
}

function requireSuperadminHome(role: string, department: string) {
  if (role === "admin" && department !== "it-software") {
    throw new HttpError(422, "validation", "A superadmin has to be in IT / Software.", {
      departmentSlug: "A superadmin has to be in IT / Software.",
    });
  }
}

async function keepOneSuperadmin(id: string) {
  const rows = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active = true AND id <> $1`,
    [id],
  );
  if (Number(rows[0]?.n ?? 0) < 1) throw new HttpError(422, "validation", "Keep at least one superadmin.");
}

async function ticketRow(id: string) {
  const rows = await q(`${ticketSelect} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

async function canRead(user: User, row: Record<string, unknown>) {
  if (user.role === "admin") return true;
  if (user.id === row.requester_id || user.id === row.assignee_id) return true;
  if (user.departmentSlug === row.source_department || user.departmentSlug === row.target_department) return true;
  const watch = await q(`SELECT 1 FROM watchers WHERE ticket_id = $1 AND user_id = $2`, [row.id, user.id]);
  return watch.length > 0;
}

async function canReply(user: User, row: Record<string, unknown>) {
  if (user.role === "admin") return true;
  if (user.id === row.requester_id || user.id === row.assignee_id) return true;
  if (user.departmentSlug === row.target_department) return true;
  const watch = await q(`SELECT 1 FROM watchers WHERE ticket_id = $1 AND user_id = $2`, [row.id, user.id]);
  return watch.length > 0;
}

function canManage(user: User, target: string) {
  return user.role === "admin" || (user.role === "lead" && user.departmentSlug === target);
}

function canReceive(user: User, target: string) {
  return user.role === "admin" || user.departmentSlug === target;
}

async function recordEvent(input: {
  ticketId: string;
  type: string;
  fromStatus?: Status | null;
  toStatus: Status;
  actorId: string;
}) {
  await q(
    `INSERT INTO ticket_events (id, ticket_id, type, from_status, to_status, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), input.ticketId, input.type, input.fromStatus ?? null, input.toStatus, input.actorId],
  );
}

function statusEventType(from: Status, to: Status) {
  if (to === "in_progress") return "started";
  if (to === "waiting") return "waiting";
  if (to === "resolved") return "resolved";
  if (to === "closed") return "closed";
  if (to === "open") return from === "resolved" || from === "closed" ? "reopened" : "opened";
  return "status";
}

async function eventsFor(ticketId: string, includeEmail: boolean) {
  const rows = await q(
    `SELECT e.id, e.type, e.from_status, e.to_status, e.created_at,
            u.id AS actor_id, u.name AS actor_name, u.role AS actor_role,
            u.department_slug AS actor_department, u.active AS actor_active, u.email AS actor_email
     FROM ticket_events e JOIN users u ON u.id = e.actor_id
     WHERE e.ticket_id = $1 ORDER BY e.created_at ASC, e.id ASC`,
    [ticketId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    type: String(row.type),
    fromStatus: (row.from_status as Status | null) ?? null,
    toStatus: row.to_status as Status,
    actor: personFromAliases(row, "actor", includeEmail),
    createdAt: iso(row.created_at),
  }));
}

const TASK_ACTIVE_STATUSES: TaskStatus[] = ["assigned", "in_progress", "blocked", "in_review", "changes_requested"];

const taskSelect = `
  SELECT t.id, t.assigned_by_id, t.name, t.description, t.expected_outcome, t.priority, t.status,
         t.start_at, t.due_at, t.reminder_offsets, t.blocked_reason, t.submission_note,
         t.review_comment, t.started_at, t.blocked_at, t.submitted_at, t.approved_at,
         t.completed_at, t.cancelled_at, t.created_at, t.updated_at,
         a.id AS assignee_id, a.name AS assignee_name, a.role AS assignee_role,
         a.department_slug AS assignee_department, a.active AS assignee_active, a.email AS assignee_email,
         b.id AS assigner_id, b.name AS assigner_name, b.role AS assigner_role,
         b.department_slug AS assigner_department, b.active AS assigner_active, b.email AS assigner_email
  FROM tasks t
  JOIN users a ON a.id = t.assignee_id
  JOIN users b ON b.id = t.assigned_by_id
`;

function mapTask(row: Record<string, unknown>, includeEmail: boolean) {
  const status = row.status as TaskStatus;
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description),
    expectedOutcome: row.expected_outcome === null || row.expected_outcome === undefined ? null : String(row.expected_outcome),
    assignee: personFromAliases(row, "assignee", includeEmail)!,
    assignedBy: personFromAliases(row, "assigner", includeEmail)!,
    priority: row.priority as TaskPriority,
    status,
    startAt: row.start_at ? iso(row.start_at) : null,
    dueAt: iso(row.due_at),
    reminderOffsets: Array.isArray(row.reminder_offsets) ? row.reminder_offsets.map((value) => Number(value)) : [],
    blockedReason: row.blocked_reason === null || row.blocked_reason === undefined ? null : String(row.blocked_reason),
    submissionNote: row.submission_note === null || row.submission_note === undefined ? null : String(row.submission_note),
    reviewComment: row.review_comment === null || row.review_comment === undefined ? null : String(row.review_comment),
    startedAt: row.started_at ? iso(row.started_at) : null,
    blockedAt: row.blocked_at ? iso(row.blocked_at) : null,
    submittedAt: row.submitted_at ? iso(row.submitted_at) : null,
    approvedAt: row.approved_at ? iso(row.approved_at) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    overdue: taskActive(status) && new Date(iso(row.due_at)).getTime() < Date.now(),
  };
}

async function taskRow(id: string) {
  if (!/^TSK-[1-9][0-9]*$/.test(id)) return null;
  const rows = await q(`${taskSelect} WHERE t.id = $1`, [id]);
  return rows[0] ?? null;
}

async function requireTask(user: User, id: string) {
  const row = await taskRow(id);
  if (!row || !(await canAccessTask(user, row))) throw new HttpError(404, "not_found", "That task does not exist.");
  return row;
}

async function canAccessTask(user: User, row: Record<string, unknown>) {
  if (user.role === "admin") return true;
  if (user.id === row.assignee_id || user.id === row.assigned_by_id) return true;
  const steps = await q(
    `SELECT s.assignee_id, s.target_lead_id, u.department_slug AS assignee_department
     FROM task_steps s JOIN users u ON u.id = s.assignee_id WHERE s.task_id = $1`,
    [row.id],
  );
  if (steps.some((step) => step.assignee_id === user.id || step.target_lead_id === user.id)) return true;
  if (user.role === "lead") {
    if (steps.some((step) => step.assignee_department === user.departmentSlug)) return true;
    const assignee = await userById(String(row.assignee_id));
    if (assignee?.departmentSlug === user.departmentSlug) return true;
  }
  return false;
}

async function canReviewTask(user: User, row: Record<string, unknown>) {
  if (user.role === "admin") return true;
  if (user.role !== "lead") return false;
  if (row.assigned_by_id === user.id) return true;
  const assignee = await userById(String(row.assignee_id));
  return assignee?.departmentSlug === user.departmentSlug;
}

async function canAssignTaskTo(actor: User, targetId: string) {
  const target = await userById(targetId);
  if (!target || !target.active) {
    throw new HttpError(422, "validation", "Choose an active person.", { assigneeId: "Choose an active person." });
  }
  if (target.role === "admin") {
    throw new HttpError(422, "validation", "A superadmin cannot be assigned work.", { assigneeId: "A superadmin cannot be assigned work." });
  }
  if (actor.role === "member" && target.id !== actor.id) {
    throw new HttpError(403, "forbidden", "You can only assign a task to yourself.");
  }
  if (actor.role === "lead" && target.departmentSlug !== actor.departmentSlug) {
    throw new HttpError(403, "forbidden", "Choose someone in your department.");
  }
  return target;
}

async function canAssignStepTo(actor: User, targetId: string) {
  const target = await userById(targetId);
  if (!target || !target.active) throw new HttpError(422, "validation", "Choose an active step assignee.", { assigneeId: "Choose an active step assignee." });
  if (target.role === "admin") throw new HttpError(422, "validation", "A superadmin cannot be assigned a step.", { assigneeId: "A superadmin cannot be assigned a step." });
  if (actor.role === "member" && target.id !== actor.id) throw new HttpError(403, "forbidden", "You can only assign a step to yourself.");
  return target;
}

async function taskAudience(taskId: string, actorId: string) {
  const rows = await q<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u WHERE u.active = true AND u.id <> $2 AND (
       u.id = (SELECT assignee_id FROM tasks WHERE id = $1)
       OR u.id = (SELECT assigned_by_id FROM tasks WHERE id = $1)
       OR u.id IN (SELECT assignee_id FROM task_steps WHERE task_id = $1)
       OR u.id IN (SELECT target_lead_id FROM task_steps WHERE task_id = $1)
     )`,
    [taskId, actorId],
  );
  return rows.map((row) => String(row.id));
}

async function taskNotify(taskId: string, actor: User, action: string, sentence: string, recipients?: string[]) {
  const audience = recipients ?? (await taskAudience(taskId, actor.id));
  await notify({
    recipients: audience,
    readers: audience,
    actor,
    type: `task.${action}`,
    sound: "status",
    sentence,
    ticketId: null,
    taskId,
    ticketEvent: { type: `task.${action}`, taskId, action },
  });
}

async function recordTaskActivity(
  taskId: string,
  actorId: string | null,
  action: string,
  message: string,
  metadata?: Record<string, unknown>,
) {
  await q(
    `INSERT INTO task_activities (id, task_id, actor_id, action, message, metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [randomUUID(), taskId, actorId, action, message, metadata ? JSON.stringify(metadata) : null],
  );
}

const taskStepSelect = `
  SELECT s.*,
         a.id AS assignee_id, a.name AS assignee_name, a.role AS assignee_role,
         a.department_slug AS assignee_department, a.active AS assignee_active, a.email AS assignee_email,
         b.id AS assigner_id, b.name AS assigner_name, b.role AS assigner_role,
         b.department_slug AS assigner_department, b.active AS assigner_active, b.email AS assigner_email,
         l.id AS lead_id, l.name AS lead_name, l.role AS lead_role,
         l.department_slug AS lead_department, l.active AS lead_active, l.email AS lead_email
  FROM task_steps s
  JOIN users a ON a.id = s.assignee_id
  JOIN users b ON b.id = s.assigned_by_id
  LEFT JOIN users l ON l.id = s.target_lead_id
`;

function mapTaskStep(row: Record<string, unknown>, includeEmail: boolean) {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    title: String(row.title),
    description: row.description === null || row.description === undefined ? null : String(row.description),
    position: Number(row.position),
    required: Boolean(row.required),
    assignee: personFromAliases(row, "assignee", includeEmail)!,
    assignedBy: personFromAliases(row, "assigner", includeEmail)!,
    sourceDepartment: row.source_department ? String(row.source_department) : null,
    targetDepartment: row.target_department ? String(row.target_department) : null,
    targetLead: personFromAliases(row, "lead", includeEmail),
    interdepartmental: Boolean(row.interdepartmental),
    status: row.status as TaskStepStatus,
    dueAt: iso(row.due_at),
    startedAt: row.started_at ? iso(row.started_at) : null,
    blockedAt: row.blocked_at ? iso(row.blocked_at) : null,
    blockedReason: row.blocked_reason ? String(row.blocked_reason) : null,
    completedAt: row.completed_at ? iso(row.completed_at) : null,
    completionNote: row.completion_note ? String(row.completion_note) : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

async function taskStepRow(id: string) {
  const rows = await q(`${taskStepSelect} WHERE s.id = $1`, [id]);
  return rows[0] ?? null;
}

async function canAccessStep(user: User, row: Record<string, unknown>) {
  if (user.role === "admin") return true;
  if (user.id === row.assignee_id || user.id === row.assigned_by_id || user.id === row.target_lead_id) return true;
  const task = await taskRow(String(row.task_id));
  return task ? canAccessTask(user, task) : false;
}

async function requireStep(user: User, id: string) {
  const row = await taskStepRow(id);
  if (!row || !(await canAccessStep(user, row))) throw new HttpError(404, "not_found", "That task step does not exist.");
  return row;
}

async function taskStepsFor(taskId: string, includeEmail: boolean) {
  const rows = await q(`${taskStepSelect} WHERE s.task_id = $1 ORDER BY s.position ASC, s.created_at ASC`, [taskId]);
  return rows.map((row) => mapTaskStep(row, includeEmail));
}

async function taskResourcesFor(taskId: string, includeEmail: boolean) {
  const rows = await q(
    `SELECT r.*, u.id AS uploader_id, u.name AS uploader_name, u.role AS uploader_role,
            u.department_slug AS uploader_department, u.active AS uploader_active, u.email AS uploader_email
     FROM task_resources r JOIN users u ON u.id = r.uploader_id
     WHERE r.task_id = $1 ORDER BY r.created_at ASC, r.id ASC`,
    [taskId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    taskId: String(row.task_id),
    uploader: personFromAliases(row, "uploader", includeEmail)!,
    type: row.type as "link" | "file",
    title: String(row.title),
    url: row.url ? String(row.url) : null,
    fileName: row.file_name ? String(row.file_name) : null,
    mediaType: row.media_type ? String(row.media_type) : null,
    size: row.size === null || row.size === undefined ? null : Number(row.size),
    createdAt: iso(row.created_at),
  }));
}

async function taskCommentsFor(taskId: string, includeEmail: boolean) {
  const rows = await q(
    `SELECT c.*, u.id AS author_id, u.name AS author_name, u.role AS author_role,
            u.department_slug AS author_department, u.active AS author_active, u.email AS author_email
     FROM task_comments c JOIN users u ON u.id = c.author_id
     WHERE c.task_id = $1 ORDER BY c.created_at ASC, c.id ASC`,
    [taskId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    taskId: String(row.task_id),
    author: personFromAliases(row, "author", includeEmail)!,
    body: String(row.body),
    createdAt: iso(row.created_at),
  }));
}

async function taskActivitiesFor(taskId: string, includeEmail: boolean) {
  const rows = await q(
    `SELECT v.*, u.id AS actor_id, u.name AS actor_name, u.role AS actor_role,
            u.department_slug AS actor_department, u.active AS actor_active, u.email AS actor_email
     FROM task_activities v LEFT JOIN users u ON u.id = v.actor_id
     WHERE v.task_id = $1 ORDER BY v.created_at ASC, v.id ASC`,
    [taskId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    taskId: String(row.task_id),
    actor: personFromAliases(row, "actor", includeEmail),
    action: String(row.action),
    message: String(row.message),
    metadata: row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : null,
    createdAt: iso(row.created_at),
  }));
}

async function taskDetail(row: Record<string, unknown>, includeEmail: boolean) {
  const id = String(row.id);
  return {
    ...mapTask(row, includeEmail),
    steps: await taskStepsFor(id, includeEmail),
    resources: await taskResourcesFor(id, includeEmail),
    comments: await taskCommentsFor(id, includeEmail),
    activities: await taskActivitiesFor(id, includeEmail),
  };
}

async function listTasks(user: User, url: URL) {
  const includeEmail = user.role === "admin";
  const scope = url.searchParams.get("scope") || "mine";
  if (scope === "organization" && user.role !== "admin") throw new HttpError(403, "forbidden", "Only an admin can see every task.");
  if (scope === "team" && user.role === "member") throw new HttpError(403, "forbidden", "Only a head or admin can see a team’s tasks.");

  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, ...values: unknown[]) => {
    let next = clause;
    for (const value of values) {
      params.push(value);
      next = next.replace("?", `$${params.length}`);
    }
    where.push(next);
  };

  if (scope === "mine") {
    add(
      `(t.assignee_id = ? OR t.assigned_by_id = ?
        OR EXISTS (SELECT 1 FROM task_steps s WHERE s.task_id = t.id AND s.assignee_id = ?))`,
      user.id,
      user.id,
      user.id,
    );
  } else if (scope === "team") {
    add(
      `((SELECT department_slug FROM users WHERE id = t.assignee_id) = ?
        OR t.assigned_by_id = ?
        OR EXISTS (SELECT 1 FROM task_steps s WHERE s.task_id = t.id AND s.target_lead_id = ?))`,
      user.departmentSlug,
      user.id,
      user.id,
    );
  }

  const status = url.searchParams.get("status");
  if (status === "overdue") {
    add(`t.status IN (${TASK_ACTIVE_STATUSES.map(() => "?").join(",")}) AND t.due_at < now()`, ...TASK_ACTIVE_STATUSES);
  } else if (status) {
    if (!isTaskStatus(status)) throw new HttpError(422, "validation", "That status is not valid.", { status: "That status is not valid." });
    add(`t.status = ?`, status);
  }

  const priority = url.searchParams.get("priority");
  if (priority) {
    if (!isTaskPriority(priority)) throw new HttpError(422, "validation", "That priority is not valid.", { priority: "That priority is not valid." });
    add(`t.priority = ?`, priority);
  }

  const department = url.searchParams.get("department");
  if (department) {
    if (!(await departmentName(department))) throw new HttpError(422, "validation", "That department is not valid.");
    if (user.role !== "admin" && department !== user.departmentSlug) throw new HttpError(403, "forbidden", "You cannot filter to that department.");
    add(
      `((SELECT department_slug FROM users WHERE id = t.assignee_id) = ?
        OR EXISTS (SELECT 1 FROM task_steps s WHERE s.task_id = t.id AND s.target_department = ?))`,
      department,
      department,
    );
  }

  const query = url.searchParams.get("q")?.trim();
  if (query) {
    const needle = `%${query}%`;
    add(
      `(t.name ILIKE ? OR t.description ILIKE ? OR t.id ILIKE ?
        OR EXISTS (SELECT 1 FROM users u JOIN task_steps s ON s.assignee_id = u.id
                   WHERE s.task_id = t.id AND (u.name ILIKE ? OR s.title ILIKE ?))
        OR EXISTS (SELECT 1 FROM users u WHERE u.id = t.assignee_id AND u.name ILIKE ?))`,
      needle,
      needle,
      needle,
      needle,
      needle,
      needle,
    );
  }

  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    const decoded = decodeCursor(cursor);
    add(`(t.updated_at, t.id) < (?::timestamptz, ?)`, decoded.time, decoded.id);
  }

  const limit = pageLimit(url);
  params.push(limit + 1);
  const rows = await q(
    `${taskSelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.updated_at DESC, t.id DESC LIMIT $${params.length}`,
    params,
  );
  const extra = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => mapTask(row, includeEmail));
  const last = rows[Math.min(rows.length, limit) - 1];
  return {
    items,
    nextCursor: extra && last ? encodeCursor(iso(last.updated_at), String(last.id)) : null,
  };
}

async function messagesFor(ticketId: string, includeEmail: boolean) {
  const rows = await q(
    `SELECT m.id, m.ticket_id, m.body, m.created_at,
            u.id AS author_id, u.name AS author_name, u.role AS author_role,
            u.department_slug AS author_department, u.active AS author_active, u.email AS author_email
     FROM messages m JOIN users u ON u.id = m.author_id
     WHERE m.ticket_id = $1 ORDER BY m.created_at ASC, m.id ASC`,
    [ticketId],
  );
  const files = await q(
    `SELECT a.id, a.message_id, a.name, a.media_type, a.size
     FROM attachments a JOIN messages m ON m.id = a.message_id
     WHERE m.ticket_id = $1`,
    [ticketId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    ticketId: String(row.ticket_id),
    author: personFromAliases(row, "author", includeEmail)!,
    body: String(row.body),
    createdAt: iso(row.created_at),
    attachments: files
      .filter((file) => file.message_id === row.id)
      .map((file) => ({
        id: String(file.id),
        messageId: String(file.message_id),
        name: String(file.name),
        mediaType: String(file.media_type),
        size: Number(file.size),
      })),
  }));
}

async function watcherPeople(ticketId: string, includeEmail: boolean) {
  const rows = await q<Record<string, unknown>>(
    `SELECT u.id, u.email, u.name, u.role, u.department_slug, u.active
     FROM watchers w JOIN users u ON u.id = w.user_id
     WHERE w.ticket_id = $1 ORDER BY u.name`,
    [ticketId],
  );
  return rows.map((row) =>
    person(
      {
        id: String(row.id),
        email: String(row.email),
        name: String(row.name),
        role: row.role as User["role"],
        departmentSlug: row.department_slug as DepartmentSlug,
        active: Boolean(row.active),
      },
      includeEmail,
    ),
  );
}

async function detail(row: Record<string, unknown>, includeEmail: boolean) {
  const id = String(row.id);
  return {
    ...mapTicket(row, includeEmail),
    messages: await messagesFor(id, includeEmail),
    watchers: await watcherPeople(id, includeEmail),
    events: await eventsFor(id, includeEmail),
  };
}

function encodeCursor(time: string, id: string) {
  return Buffer.from(`${time}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string) {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const cut = raw.indexOf("|");
  if (cut < 0) throw new HttpError(422, "validation", "That page cursor is not valid.");
  const time = raw.slice(0, cut);
  const id = raw.slice(cut + 1);
  if (Number.isNaN(new Date(time).getTime()) || !id) {
    throw new HttpError(422, "validation", "That page cursor is not valid.");
  }
  return { time, id };
}

async function badgesFor(user: User) {
  const unresolved = `('open','in_progress','waiting')`;
  const inbox = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM tickets t
     WHERE t.status IN ${unresolved}
       AND (t.requester_id = $1 OR t.assignee_id = $1
            OR EXISTS (SELECT 1 FROM watchers w WHERE w.ticket_id = t.id AND w.user_id = $1))`,
    [user.id],
  );
  const queue = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM tickets WHERE target_department = $1 AND status IN ${unresolved}`,
    [user.departmentSlug],
  );
  const alerts = await q<{ n: number }>(
    `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read = false`,
    [user.id],
  );
  const tasks = await q<{ n: number }>(
    `SELECT count(DISTINCT t.id)::int AS n FROM tasks t
     WHERE t.status IN ('assigned','in_progress','blocked','in_review','changes_requested')
       AND (t.assignee_id = $1 OR (t.status = 'in_review' AND t.assigned_by_id = $1))`,
    [user.id],
  );
  const body: Record<string, unknown> = {
    inbox: Number(inbox[0]?.n ?? 0),
    queue: Number(queue[0]?.n ?? 0),
    alerts: Number(alerts[0]?.n ?? 0),
    tasks: Number(tasks[0]?.n ?? 0),
  };
  if (user.role === "admin") body.monitor = await monitorCounts();
  return body;
}

async function monitorCounts() {
  const rows = await q<{ status: Status; n: number }>(`SELECT status, count(*)::int AS n FROM tickets GROUP BY status`);
  const n = (status: Status) => Number(rows.find((row) => row.status === status)?.n ?? 0);
  return {
    raised: n("open"),
    pending: n("in_progress") + n("waiting"),
    resolved: n("resolved"),
    closed: n("closed"),
  };
}

async function adminIds() {
  const rows = await q<{ id: string }>(`SELECT id FROM users WHERE role = 'admin' AND active = true`);
  return rows.map((row) => String(row.id));
}

async function readerIds(row: Record<string, unknown>) {
  const rows = await q<{ id: string }>(
    `SELECT id FROM users WHERE active = true AND (
       role = 'admin'
       OR department_slug = $1
       OR department_slug = $2
       OR id = $3
       OR id = $4
       OR id IN (SELECT user_id FROM watchers WHERE ticket_id = $5)
     )`,
    [row.source_department, row.target_department, row.requester_id, row.assignee_id, row.id],
  );
  return rows.map((item) => String(item.id));
}

async function recipientIds(row: Record<string, unknown>, actorId: string) {
  const rows = await q<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u
     WHERE u.active = true AND u.id <> $1 AND (
       u.id = $2 OR u.id = $3
       OR u.id IN (SELECT user_id FROM watchers WHERE ticket_id = $4)
       OR u.id IN (SELECT user_id FROM department_recipients WHERE department_slug = $5)
     )`,
    [actorId, row.requester_id, row.assignee_id, row.id, row.target_department],
  );
  return rows.map((item) => String(item.id));
}

async function pushBadges(userIds: string[]) {
  for (const id of [...new Set(userIds)]) {
    const user = await userById(id);
    if (!user) continue;
    publish([id], { type: "badges.updated", badges: await badgesFor(user), at: new Date().toISOString() });
  }
}

async function notify(options: {
  recipients: string[];
  readers: string[];
  actor: User;
  type: string;
  sound: "raise" | "reply" | "status";
  sentence: string;
  ticketId: string | null;
  taskId?: string | null;
  departmentSlug?: string | null;
  ticketEvent: Record<string, unknown> | null;
}) {
  const at = new Date().toISOString();
  const actor = person(options.actor, false);
  for (const userId of options.recipients) {
    const id = randomUUID();
    await q(
      `INSERT INTO notifications (id, user_id, type, ticket_id, task_id, department_slug, sentence, sound, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, userId, options.type, options.ticketId, options.taskId ?? null, options.departmentSlug ?? null, options.sentence, options.sound, options.actor.id],
    );
    publish([userId], {
      type: "notification.created",
      notificationId: id,
      notificationType: options.type,
      ticketId: options.ticketId,
      taskId: options.taskId ?? undefined,
      departmentSlug: options.departmentSlug ?? undefined,
      sound: options.sound,
      sentence: options.sentence,
      actor,
      at,
    });
  }
  if (options.ticketEvent) {
    publish(options.readers, { ...options.ticketEvent, actor, at });
  }
  await pushBadges([...options.recipients, options.actor.id, ...(await adminIds())]);
}

async function queueRecipientIds(slug: string) {
  const rows = await q<{ user_id: string }>(
    `SELECT user_id FROM department_recipients WHERE department_slug = $1`,
    [slug],
  );
  return rows.map((row) => String(row.user_id));
}

async function sendMail(input: Omit<MailInput, "providerMessageId" | "to" | "cc"> & { toIds: string[]; ccIds: string[]; ticketIdForRow: string | null; outreachId: string | null }) {
  const toUsers = await loadUsers(input.toIds);
  const ccUsers = await loadUsers(input.ccIds);
  const to: string[] = [];
  for (const user of toUsers) if (!to.includes(user.email)) to.push(user.email);
  const cc: string[] = [];
  for (const user of ccUsers) if (!to.includes(user.email) && !cc.includes(user.email)) cc.push(user.email);
  if (to.length === 0 && cc.length === 0) return null;
  const receiptId = randomUUID();
  await q(
    `INSERT INTO receipts (id, ticket_id, outreach_id, event, to_addresses, cc_addresses, state)
     VALUES ($1, $2, $3, $4, $5::text[], $6::text[], 'queued')`,
    [receiptId, input.ticketIdForRow, input.outreachId, input.event, to, cc],
  );
  const payload = { ...input, to, cc, providerMessageId: receiptId };
  after(async () => {
    try {
      const providerMessageId = await deliver(payload);
      await q(`UPDATE receipts SET state = 'sent', provider_message_id = $2 WHERE id = $1`, [receiptId, providerMessageId]);
    } catch (error: unknown) {
      console.error(error);
      await q(`UPDATE receipts SET state = 'failed' WHERE id = $1`, [receiptId]);
    }
  });
  return receiptId;
}

async function loadUsers(ids: string[]) {
  const users: User[] = [];
  for (const id of [...new Set(ids)]) {
    const user = await userById(id);
    if (user && user.active) users.push(user);
  }
  return users;
}

async function mailTicket(row: Record<string, unknown>, actor: User, event: MailInput["event"], note: string, subject: string, eventLabel: string) {
  const recipients = await recipientIds(row, actor.id);
  const toIds = [row.requester_id, row.assignee_id].map((id) => (id ? String(id) : "")).filter((id) => id && id !== actor.id);
  const watcherRows = await q<{ user_id: string }>(`SELECT user_id FROM watchers WHERE ticket_id = $1`, [row.id]);
  const queueIds = await queueRecipientIds(String(row.target_department));
  const ccIds = [...watcherRows.map((item) => String(item.user_id)), ...queueIds].filter((id) => id !== actor.id && !toIds.includes(id));
  const target = (await departmentName(String(row.target_department))) || String(row.target_department);
  const source = (await departmentName(String(row.source_department))) || String(row.source_department);
  await sendMail({
    event,
    subject,
    title: String(row.title),
    eventLabel,
    meta: `${source} → ${target} · ${STATUS_LABEL[row.status as Status]}`,
    actorName: actor.name,
    actorDepartment: (await departmentName(actor.departmentSlug)) || actor.departmentSlug,
    note,
    ticketUrl: `${origin()}/tickets/${row.id}`,
    ticketId: String(row.id),
    statusLabel: STATUS_LABEL[row.status as Status],
    toIds: toIds.filter((id) => recipients.includes(id) || id !== actor.id),
    ccIds,
    ticketIdForRow: String(row.id),
    outreachId: null,
  });
}

function pageLimit(url: URL, max = 100, fallback = 30) {
  const raw = Number(url.searchParams.get("limit") || fallback);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(max, Math.floor(raw));
}

async function listTickets(user: User, url: URL, forced?: { bucket?: string; admin?: boolean }) {
  const includeEmail = user.role === "admin";
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, ...values: unknown[]) => {
    let next = clause;
    for (const value of values) {
      params.push(value);
      next = next.replace("?", `$${params.length}`);
    }
    where.push(next);
  };

  if (forced?.bucket) {
    if (forced.bucket === "raised") add(`t.status = ?`, "open");
    else if (forced.bucket === "pending") add(`t.status IN (?, ?)`, "in_progress", "waiting");
    else if (forced.bucket === "resolved") add(`t.status = ?`, "resolved");
    else if (forced.bucket === "closed") add(`t.status = ?`, "closed");
    else throw new HttpError(422, "validation", "Choose a section.", { bucket: "Choose a section." });
  } else {
    const scope = url.searchParams.get("scope") || "mine";
    if (scope === "all") {
      if (user.role !== "admin") throw new HttpError(403, "forbidden", "Only an admin can see every ticket.");
    } else if (scope === "queue") {
      add(`t.target_department = ?`, user.departmentSlug);
    } else if (scope === "watching") {
      add(
        `t.target_department IN (SELECT department_slug FROM department_watches WHERE user_id = ?)
         AND NOT (t.requester_id = ? OR t.assignee_id = ?
           OR EXISTS (SELECT 1 FROM watchers w WHERE w.ticket_id = t.id AND w.user_id = ?))`,
        user.id,
        user.id,
        user.id,
        user.id,
      );
    } else if (scope === "mine") {
      add(
        `(t.requester_id = ? OR t.assignee_id = ?
          OR EXISTS (SELECT 1 FROM watchers w WHERE w.ticket_id = t.id AND w.user_id = ?))`,
        user.id,
        user.id,
        user.id,
      );
    } else {
      throw new HttpError(422, "validation", "That list is not valid.", { scope: "That list is not valid." });
    }
    const status = url.searchParams.get("status");
    if (status) {
      if (!isStatus(status)) throw new HttpError(422, "validation", "That status is not valid.", { status: "That status is not valid." });
      add(`t.status = ?`, status);
    }
  }

  const department = url.searchParams.get("department");
  if (department) {
    if (!(await departmentName(department))) throw new HttpError(422, "validation", "That department is not valid.");
    if (user.role !== "admin" && department !== user.departmentSlug) {
      const watches = await watchesOf(user.id);
      if (!watches.includes(department)) throw new HttpError(403, "forbidden", "You cannot filter to that department.");
    }
    add(`t.target_department = ?`, department);
  }

  const query = url.searchParams.get("q")?.trim();
  if (query) add(`(t.title ILIKE ? OR t.id ILIKE ?)`, `%${query}%`, `%${query}%`);

  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    const decoded = decodeCursor(cursor);
    add(`(t.updated_at, t.id) < (?::timestamptz, ?)`, decoded.time, decoded.id);
  }
  const limit = pageLimit(url);
  params.push(limit + 1);
  const rows = await q(
    `${ticketSelect} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY t.updated_at DESC, t.id DESC LIMIT $${params.length}`,
    params,
  );
  const extra = rows.length > limit;
  const items = rows.slice(0, limit).map((row) => mapTicket(row, includeEmail));
  const last = rows[Math.min(rows.length, limit) - 1];
  return {
    items,
    nextCursor: extra && last ? encodeCursor(iso(last.updated_at), String(last.id)) : null,
  };
}

function textField(value: unknown, name: string, min: number, max: number) {
  if (typeof value !== "string") throw new HttpError(422, "validation", `${name} is required.`, { [name.toLowerCase()]: `${name} is required.` });
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    const message = min === 1 ? `${name} is required.` : `${name} must be at least ${min} characters.`;
    throw new HttpError(422, "validation", message, { [name.toLowerCase()]: message });
  }
  return trimmed;
}

function emailField(value: unknown) {
  const email = textField(value, "Email", 3, 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(422, "validation", "Enter a work email.", { email: "Enter a work email." });
  }
  return email;
}

async function readJson(request: Request) {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(422, "validation", "The body is not valid JSON.");
  }
}

function sniff(bytes: Buffer) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

async function departmentPayload(slug: string, includeEmail: boolean) {
  const rows = await q<Record<string, unknown>>(
    `SELECT u.id, u.email, u.name, u.role, u.department_slug, u.active
     FROM department_recipients r JOIN users u ON u.id = r.user_id
     WHERE r.department_slug = $1 ORDER BY u.name`,
    [slug],
  );
  return {
    slug,
    name: (await departmentName(slug)) || slug,
    recipients: rows.map((row) =>
      person(
        {
          id: String(row.id),
          email: String(row.email),
          name: String(row.name),
          role: row.role as User["role"],
          departmentSlug: row.department_slug as DepartmentSlug,
          active: Boolean(row.active),
        },
        includeEmail,
      ),
    ),
  };
}

function mapReceipt(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    ticketId: row.ticket_id ? String(row.ticket_id) : null,
    outreachId: row.outreach_id ? String(row.outreach_id) : null,
    event: String(row.event),
    providerMessageId: row.provider_message_id ? String(row.provider_message_id) : null,
    to: asList(row.to_addresses),
    cc: asList(row.cc_addresses),
    state: String(row.state),
    createdAt: iso(row.created_at),
  };
}

function asList(value: unknown) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    const trimmed = value.replace(/^{|}$/g, "");
    return trimmed ? trimmed.split(",").map((item) => item.replace(/^"|"$/g, "")) : [];
  }
  return [];
}

const SSO_STATE_COOKIE = "desk_sso_state";
const SSO_STATE_PATH = "/api/v1/auth/sso";
const SSO_SESSION_SECONDS = 60 * 60 * 24 * 30;

function ssoStateCookie(value: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SSO_STATE_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=${SSO_STATE_PATH}; Max-Age=${maxAge}${secure}`;
}

function ssoLoginRedirect(door: SsoDoor, error?: string, clearState = false) {
  const path = door === "admin" ? "/admin" : "/login";
  const location = error ? `${path}?error=${encodeURIComponent(error)}` : path;
  const headers: Record<string, string> = { Location: location };
  if (clearState) headers["Set-Cookie"] = ssoStateCookie("", 0);
  return new Response(null, { status: 303, headers });
}

function ssoStart(request: Request) {
  const url = new URL(request.url);
  const door: SsoDoor = url.searchParams.get("door") === "admin" ? "admin" : "staff";
  const config = ssoConfig();
  if (!ssoReady()) return ssoLoginRedirect(door, "sso-unavailable", true);
  const redirectUri = process.env.SSO_REDIRECT_URI || `${process.env.APP_ORIGIN || url.origin}/api/v1/auth/sso/callback`;
  const state = randomBytes(24).toString("base64url");
  const target = new URL("/api/sso/authorize", config.vcgloneUrl);
  target.searchParams.set("client_id", config.clientId);
  target.searchParams.set("redirect_uri", redirectUri);
  target.searchParams.set("state", state);
  return new Response(null, {
    status: 303,
    headers: {
      Location: target.toString(),
      "Set-Cookie": ssoStateCookie(`${state}.${door}.${signState(state, door)}`, 600),
    },
  });
}

async function ssoCallback(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  if (!ssoReady()) return ssoLoginRedirect("staff", "sso-unavailable", true);
  const stored = verifyState(cookieValue(request.headers.get("cookie"), SSO_STATE_COOKIE));
  const door: SsoDoor = stored?.door ?? "staff";
  if (!stored || !sameSecret(state, stored.state)) return ssoLoginRedirect(door, "sso-expired", true);

  try {
    const claims = verifyAssertion(url.searchParams.get("assertion") || "");
    if (claims.employmentStatus !== "ACTIVE") return ssoLoginRedirect(door, "sso-inactive", true);
    await consumeAssertion(claims.jti, claims.exp);
    const user = await userFromAssertion(claims);
    if (!user) return ssoLoginRedirect(door, "sso-no-account", true);
    if (!user.active) return ssoLoginRedirect(door, "sso-disabled", true);
    if (door === "admin" && user.role !== "admin") return ssoLoginRedirect(door, "sso-not-admin", true);
    if (door === "staff" && user.role === "admin") return ssoLoginRedirect(door, "sso-use-admin", true);

    const token = await createSession(user.id);
    return new Response(null, {
      status: 303,
      headers: {
        Location: user.role === "admin" ? "/monitor" : "/inbox",
        "Set-Cookie": `${sessionCookie(token, SSO_SESSION_SECONDS)}, ${ssoStateCookie("", 0)}`,
      },
    });
  } catch (error) {
    console.error("SSO callback failed", error);
    return ssoLoginRedirect(door, "sso-failed", true);
  }
}

function parseTaskDate(value: unknown, field: string, required = true) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new HttpError(422, "validation", `${field} is required.`, { [field.toLowerCase()]: `${field} is required.` });
    return null;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(422, "validation", `${field} is not a valid date.`, { [field.toLowerCase()]: `${field} is not a valid date.` });
  }
  return date;
}

function parseReminderOffsets(value: unknown) {
  if (value === undefined || value === null) return [1440, 120, 0];
  if (!Array.isArray(value)) throw new HttpError(422, "validation", "Choose valid reminders.", { reminderOffsets: "Choose valid reminders." });
  const numbers = value.map((item) => Number(item));
  if (numbers.some((item) => !Number.isFinite(item) || item < 0 || item > 43200)) {
    throw new HttpError(422, "validation", "Choose valid reminders.", { reminderOffsets: "Choose valid reminders." });
  }
  return [...new Set(numbers)].slice(0, 6);
}

function parseTaskLinks(value: unknown) {
  if (value === undefined || value === null || value === "") return [] as string[];
  let raw = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new HttpError(422, "validation", "Links must be a list.", { resourceLinks: "Links must be a list." });
    }
  }
  if (!Array.isArray(raw)) throw new HttpError(422, "validation", "Links must be a list.", { resourceLinks: "Links must be a list." });
  const links: string[] = [];
  for (const item of raw) {
    const text = String(item || "").trim();
    if (!text) continue;
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new HttpError(422, "validation", "Links must be complete addresses.", { resourceLinks: "Links must be complete addresses." });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(422, "validation", "Links must use http or https.", { resourceLinks: "Links must use http or https." });
    links.push(text);
  }
  return links.slice(0, 30);
}

async function addTaskLinkResources(taskId: string, uploaderId: string, links: string[]) {
  for (const url of links) {
    let title = url;
    try {
      title = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      title = "Link";
    }
    await q(
      `INSERT INTO task_resources (id, task_id, uploader_id, type, title, url) VALUES ($1,$2,$3,'link',$4,$5)`,
      [randomUUID(), taskId, uploaderId, title.slice(0, 180), url],
    );
  }
}

async function deliverTaskReminder(taskId: string, userId: string, kind: string, scheduledFor: Date, sentence: string) {
  return tx(async () => {
    const id = randomUUID();
    const inserted = await q(
      `INSERT INTO task_reminder_deliveries (id, task_id, user_id, kind, scheduled_for)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (task_id, user_id, kind, scheduled_for) DO NOTHING RETURNING id`,
      [id, taskId, userId, kind, scheduledFor],
    );
    if (!inserted.length) return false;
    const actor = await userById(userId);
    if (actor) {
      await notify({
        recipients: [userId],
        readers: [userId],
        actor,
        type: "task.reminder",
        sound: "status",
        sentence,
        ticketId: null,
        taskId,
        ticketEvent: { type: "task.reminder", taskId, kind },
      });
    }
    return true;
  });
}

async function ensureTaskRemindersForUser(user: User) {
  const rows = await q(
    `SELECT t.id, t.name, t.start_at, t.due_at, t.reminder_offsets, t.assignee_id, t.assigned_by_id, t.status
     FROM tasks t WHERE t.status IN ('assigned','in_progress','blocked','in_review','changes_requested')
       AND (t.assignee_id = $1 OR t.assigned_by_id = $1)`,
    [user.id],
  );
  let delivered = 0;
  const now = Date.now();
  const lagosDate = new Date(now + 3600000).toISOString().slice(0, 10);
  for (const row of rows) {
    const isAssignee = row.assignee_id === user.id;
    if (isAssignee && row.start_at) {
      const start = new Date(iso(row.start_at));
      if (now >= start.getTime()) {
        if (await deliverTaskReminder(String(row.id), user.id, "START", start, `${row.name} is ready to start.`)) delivered += 1;
      }
    }
    if (isAssignee) {
      const due = new Date(iso(row.due_at));
      const offsets = (Array.isArray(row.reminder_offsets) ? row.reminder_offsets.map((value) => Number(value)) : [])
        .filter((offset) => Number.isFinite(offset) && offset >= 0)
        .sort((a, b) => a - b);
      const eligible = offsets.find((offset) => now >= due.getTime() - offset * 60000);
      if (eligible !== undefined) {
        const scheduled = new Date(due.getTime() - eligible * 60000);
        const kind = eligible === 0 ? "DUE" : `DUE_${eligible}`;
        const sentence = eligible === 0 ? `${row.name} is due now.` : `${row.name} is due in ${eligible} minutes.`;
        if (await deliverTaskReminder(String(row.id), user.id, kind, scheduled, sentence)) delivered += 1;
      }
      if (now > due.getTime()) {
        if (await deliverTaskReminder(String(row.id), user.id, `OVERDUE_${lagosDate}`, due, `${row.name} is overdue.`)) delivered += 1;
      }
    }
    if ((user.role === "lead" || user.role === "admin") && row.assigned_by_id === user.id && now > new Date(iso(row.due_at)).getTime()) {
      const due = new Date(iso(row.due_at));
      if (await deliverTaskReminder(String(row.id), user.id, `MANAGER_OVERDUE_${lagosDate}`, due, `A task you delegated, ${row.name}, is overdue.`)) delivered += 1;
    }
  }
  return delivered;
}

async function runTaskReminders() {
  const rows = await q<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u JOIN tasks t ON t.assignee_id = u.id OR t.assigned_by_id = u.id
     WHERE u.active = true AND t.status IN ('assigned','in_progress','blocked','in_review','changes_requested')`,
  );
  let delivered = 0;
  for (const row of rows) {
    const user = await userById(String(row.id));
    if (user) delivered += await ensureTaskRemindersForUser(user);
  }
  return delivered;
}

function lagosDate(date: Date) {
  return new Date(date.getTime() + 3600000).toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function taskReportRange(period: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    throw new HttpError(422, "validation", "Choose a valid date.", { date: "Choose a valid date." });
  }
  let fromDate = date;
  let toDate = shiftDate(date, 1);
  if (period === "weekly") {
    const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    fromDate = shiftDate(date, -((day + 6) % 7));
    toDate = shiftDate(fromDate, 7);
  } else if (period === "monthly") {
    fromDate = `${date.slice(0, 7)}-01`;
    const month = new Date(`${fromDate}T00:00:00.000Z`);
    month.setUTCMonth(month.getUTCMonth() + 1);
    toDate = month.toISOString().slice(0, 10);
  }
  const from = new Date(`${fromDate}T00:00:00.000+01:00`);
  const to = new Date(`${toDate}T00:00:00.000+01:00`);
  return { from, to, period, date: fromDate };
}

function appendTaskReportRange(where: string[], params: unknown[], range: ReturnType<typeof taskReportRange>) {
  const from = params.length + 1;
  params.push(range.from);
  const to = params.length + 1;
  params.push(range.to);
  where.push(
    `t.created_at < $${to} AND ((t.due_at >= $${from} AND t.due_at < $${to})
      OR (t.created_at >= $${from} AND t.created_at < $${to})
      OR (t.completed_at >= $${from} AND t.completed_at < $${to})
      OR t.status IN ('assigned','in_progress','blocked','in_review','changes_requested'))`,
  );
}

function appendTaskStepReportRange(where: string[], params: unknown[], range: ReturnType<typeof taskReportRange>) {
  const from = params.length + 1;
  params.push(range.from);
  const to = params.length + 1;
  params.push(range.to);
  where.push(
    `s.created_at < $${to} AND ((s.due_at >= $${from} AND s.due_at < $${to})
      OR (s.created_at >= $${from} AND s.created_at < $${to})
      OR (s.completed_at >= $${from} AND s.completed_at < $${to})
      OR s.status IN ('assigned','in_progress','blocked'))`,
  );
}

async function taskReportScope(user: User, scope: string, employeeId: string, departmentId: string) {
  if (scope !== "mine" && scope !== "team" && scope !== "organization") throw new HttpError(422, "validation", "Choose a report scope.", { scope: "Choose a report scope." });
  if (scope === "organization" && user.role !== "admin") throw new HttpError(403, "forbidden", "Only an admin can see the whole organization.");
  if (scope === "team" && user.role === "member") throw new HttpError(403, "forbidden", "Only a head or admin can see a team report.");
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, ...values: unknown[]) => {
    let next = clause;
    for (const value of values) {
      params.push(value);
      next = next.replace("?", `$${params.length}`);
    }
    where.push(next);
  };
  if (scope === "mine") {
    add(
      `(t.assignee_id = ? OR t.assigned_by_id = ?
        OR EXISTS (SELECT 1 FROM task_steps s WHERE s.task_id = t.id AND s.assignee_id = ?))`,
      user.id,
      user.id,
      user.id,
    );
  } else if (scope === "team") {
    add(
      `((SELECT department_slug FROM users WHERE id = t.assignee_id) = ?
        OR t.assigned_by_id = ?
        OR EXISTS (SELECT 1 FROM task_steps s WHERE s.task_id = t.id AND s.target_lead_id = ?))`,
      user.departmentSlug,
      user.id,
      user.id,
    );
  }
  if (employeeId && user.role !== "member") {
    const target = await userById(employeeId);
    if (!target) throw new HttpError(422, "validation", "That person does not exist.", { employeeId: "That person does not exist." });
    add(`t.assignee_id = ?`, employeeId);
  }
  if (departmentId && user.role !== "member") {
    if (!(await departmentName(departmentId))) throw new HttpError(422, "validation", "That department does not exist.", { departmentId: "That department does not exist." });
    add(
      `((SELECT department_slug FROM users WHERE id = t.assignee_id) = ?
        OR EXISTS (SELECT 1 FROM task_steps s WHERE s.task_id = t.id AND s.target_department = ?))`,
      departmentId,
      departmentId,
    );
  }
  return { scope: scope as "mine" | "team" | "organization", where, params };
}

function taskStepReportScope(user: User, scope: "mine" | "team" | "organization", employeeId: string, departmentId: string) {
  const where: string[] = ["s.interdepartmental = true"];
  const params: unknown[] = [];
  const add = (clause: string, ...values: unknown[]) => {
    let next = clause;
    for (const value of values) {
      params.push(value);
      next = next.replace("?", `$${params.length}`);
    }
    where.push(next);
  };
  if (scope === "mine") {
    add(`s.assignee_id = ?`, user.id);
  } else if (scope === "team") {
    add(
      `(s.assigned_by_id = ? OR s.target_lead_id = ?
        OR (SELECT department_slug FROM users WHERE id = s.assignee_id) = ?)`,
      user.id,
      user.id,
      user.departmentSlug,
    );
  }
  if (employeeId && user.role !== "member") add(`s.assignee_id = ?`, employeeId);
  if (departmentId && user.role !== "member") add(`s.target_department = ?`, departmentId);
  return { where, params };
}

async function getTaskReportData(user: User, url: URL) {
  const period = url.searchParams.get("period") || "daily";
  if (period !== "daily" && period !== "weekly" && period !== "monthly") throw new HttpError(422, "validation", "Choose a period.", { period: "Choose a period." });
  const date = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  const range = taskReportRange(period, date);
  const scoped = await taskReportScope(user, url.searchParams.get("scope") || "mine", url.searchParams.get("employeeId") || "", url.searchParams.get("departmentId") || "");
  const employeeId = url.searchParams.get("employeeId") || "";
  const departmentId = url.searchParams.get("departmentId") || "";
  const params = [...scoped.params];
  const where = [...scoped.where];
  appendTaskReportRange(where, params, range);
  const rows = await q(`${taskSelect} WHERE ${where.join(" AND ")} ORDER BY t.due_at ASC`, params);
  const tasks = rows.map((row) => mapTask(row, user.role === "admin"));
  const inRange = (value: string | null) => Boolean(value && new Date(value) >= range.from && new Date(value) < range.to);
  const average = (values: number[]) =>
    values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;

  const created = tasks.filter((task) => inRange(task.createdAt));
  const completed = tasks.filter((task) => inRange(task.completedAt));
  const onTime = completed.filter((task) => task.completedAt && new Date(task.completedAt) <= new Date(task.dueAt));
  const due = tasks.filter((task) => inRange(task.dueAt) && task.status !== "cancelled");
  const completedDue = due.filter((task) => task.completedAt && new Date(task.completedAt) < range.to);
  const completionHours = completed
    .map((task) => {
      if (!task.completedAt) return null;
      return Math.max(0, (new Date(task.completedAt).getTime() - new Date(task.startedAt || task.createdAt).getTime()) / 3600000);
    })
    .filter((value): value is number => value !== null);
  const metrics = {
    total: tasks.length,
    assigned: created.length,
    due: due.length,
    completed: completed.length,
    completedOnTime: onTime.length,
    overdue: tasks.filter((task) => task.overdue).length,
    active: tasks.filter((task) => taskActive(task.status)).length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    completionRate: due.length ? Math.round((completedDue.length / due.length) * 100) : 0,
    onTimeRate: completed.length ? Math.round((onTime.length / completed.length) * 100) : 0,
    averageCompletionHours: average(completionHours),
  };

  const statusData = Object.entries(TASK_STATUS_LABEL).map(([status]) => ({
    status: status as TaskStatus,
    count: tasks.filter((task) => task.status === status).length,
  }));

  const buckets = period === "daily" ? 7 : period === "weekly" ? 4 : 12;
  const trend = Array.from({ length: buckets }, (_, index) => {
    const start = new Date(range.from.getTime() - (buckets - 1 - index) * (period === "monthly" ? 7 : 1) * 86400000);
    const end = new Date(start.getTime() + (period === "monthly" ? 7 : 1) * 86400000);
    return {
      label: lagosDate(start),
      created: created.filter((task) => new Date(task.createdAt) >= start && new Date(task.createdAt) < end).length,
      completed: completed.filter((task) => task.completedAt && new Date(task.completedAt) >= start && new Date(task.completedAt) < end).length,
    };
  });

  const peopleMap = new Map<string, {
    id: string; name: string; department: string; total: number; assigned: number;
    completed: number; onTime: number; overdue: number; hours: number;
  }>();
  const departmentMap = new Map<string, {
    slug: string; name: string; members: number; total: number; assigned: number;
    completed: number; onTime: number; overdue: number;
  }>();
  for (const task of tasks) {
    const person = task.assignee;
    if (!peopleMap.has(person.id)) {
      peopleMap.set(person.id, {
        id: person.id, name: person.name, department: person.departmentSlug,
        total: 0, assigned: 0, completed: 0, onTime: 0, overdue: 0, hours: 0,
      });
    }
    const entry = peopleMap.get(person.id)!;
    entry.total += 1;
    if (inRange(task.createdAt)) entry.assigned += 1;
    if (inRange(task.completedAt)) {
      entry.completed += 1;
      if (task.completedAt && new Date(task.completedAt) <= new Date(task.dueAt)) entry.onTime += 1;
      if (task.completedAt) {
        entry.hours += Math.max(0, (new Date(task.completedAt).getTime() - new Date(task.startedAt || task.createdAt).getTime()) / 3600000);
      }
    }
    if (task.overdue) entry.overdue += 1;

    const slug = person.departmentSlug;
    if (!departmentMap.has(slug)) {
      departmentMap.set(slug, {
        slug, name: (await departmentName(slug)) || slug, members: 0,
        total: 0, assigned: 0, completed: 0, onTime: 0, overdue: 0,
      });
    }
    const department = departmentMap.get(slug)!;
    department.total += 1;
    if (inRange(task.createdAt)) department.assigned += 1;
    if (inRange(task.completedAt)) {
      department.completed += 1;
      if (task.completedAt && new Date(task.completedAt) <= new Date(task.dueAt)) department.onTime += 1;
    }
    if (task.overdue) department.overdue += 1;
  }
  for (const person of peopleMap.values()) {
    const department = departmentMap.get(person.department);
    if (department) department.members += 1;
  }
  const people = [...peopleMap.values()].map((entry) => ({
    ...entry,
    onTimeRate: entry.completed ? Math.round((entry.onTime / entry.completed) * 100) : 0,
    averageCompletionHours: entry.completed ? Math.round((entry.hours / entry.completed) * 10) / 10 : 0,
  })).sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
  const departments = [...departmentMap.values()].map((entry) => ({
    ...entry,
    onTimeRate: entry.completed ? Math.round((entry.onTime / entry.completed) * 100) : 0,
  })).sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));

  const stepScope = taskStepReportScope(user, scoped.scope, employeeId, departmentId);
  const stepParams = [...stepScope.params];
  const stepWhere = [...stepScope.where];
  appendTaskStepReportRange(stepWhere, stepParams, range);
  const stepRows = await q(
    `${taskStepSelect.replace("FROM task_steps s", "FROM task_steps s JOIN tasks t ON t.id = s.task_id")} WHERE ${stepWhere.join(" AND ")} ORDER BY s.due_at ASC`,
    stepParams,
  );
  const delegatedSteps = stepRows.map((row) => mapTaskStep(row, user.role === "admin"));
  const stepCompleted = delegatedSteps.filter((step) => inRange(step.completedAt));
  const stepOnTime = stepCompleted.filter((step) => step.completedAt && new Date(step.completedAt) <= new Date(step.dueAt));
  const dueSteps = delegatedSteps.filter((step) => inRange(step.dueAt) && step.status !== "cancelled");
  const completedDueSteps = dueSteps.filter((step) => step.completedAt && new Date(step.completedAt) < range.to);
  const responseHours = delegatedSteps
    .filter((step) => step.startedAt)
    .map((step) => Math.max(0, (new Date(step.startedAt!).getTime() - new Date(step.createdAt).getTime()) / 3600000));
  const stepHours = stepCompleted
    .map((step) => {
      if (!step.completedAt) return null;
      return Math.max(0, (new Date(step.completedAt).getTime() - new Date(step.startedAt || step.createdAt).getTime()) / 3600000);
    })
    .filter((value): value is number => value !== null);
  const delegationMetrics = {
    total: delegatedSteps.length,
    interdepartmental: delegatedSteps.filter((step) => step.interdepartmental).length,
    active: delegatedSteps.filter((step) => step.status === "assigned" || step.status === "in_progress").length,
    blocked: delegatedSteps.filter((step) => step.status === "blocked").length,
    overdue: delegatedSteps.filter((step) => (step.status === "assigned" || step.status === "in_progress" || step.status === "blocked") && new Date(step.dueAt).getTime() < Date.now()).length,
    completed: stepCompleted.length,
    completionRate: dueSteps.length ? Math.round((completedDueSteps.length / dueSteps.length) * 100) : 0,
    onTimeRate: stepCompleted.length ? Math.round((stepOnTime.length / stepCompleted.length) * 100) : 0,
    averageResponseHours: average(responseHours),
    averageCompletionHours: average(stepHours),
    averageHours: average(stepHours),
  };

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), period, date: range.date },
    scope: scoped.scope,
    metrics,
    trend,
    statusData,
    people,
    departments,
    tasks,
    delegatedSteps,
    delegationMetrics,
  };
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvResponse(rows: unknown[][], filename: string) {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, no-store",
    },
  });
}

async function taskReportPdf(report: Awaited<ReturnType<typeof getTaskReportData>>, actor: User) {
  const nodeModule = process.getBuiltinModule("module");
  const requirePdf = nodeModule.createRequire(`${process.cwd()}/package.json`);
  const PDFDocument = requirePdf("pdfkit") as typeof import("pdfkit");
  const doc = new PDFDocument({ margin: 44, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const title = report.scope === "organization" ? "Task performance — organization" : report.scope === "team" ? "Task performance — team" : "My task performance";
  doc.fontSize(20).text("VethanCon Desk", { align: "left" });
  doc.moveDown(0.3).fontSize(12).fillColor("#5c6470").text(title);
  doc.text(`${report.range.period} ending ${report.range.date} · ${actor.name} · generated ${new Date().toISOString().slice(0, 10)}`);
  doc.moveDown().fillColor("#111827").fontSize(14).text("Summary");
  doc.fontSize(10).text(
    `Total ${report.metrics.total}  ·  Completed ${report.metrics.completed}  ·  On time ${report.metrics.completedOnTime}  ·  Overdue ${report.metrics.overdue}  ·  Completion ${report.metrics.completionRate}%`,
  );
  doc.moveDown().fontSize(14).text("Tasks");
  const table = [
    ["ID", "Task", "Assignee", "Status", "Due", "Completed"],
    ...report.tasks.map((task) => [
      task.id,
      task.name.slice(0, 44),
      task.assignee.name.slice(0, 24),
      TASK_STATUS_LABEL[task.status],
      task.dueAt.slice(0, 10),
      task.completedAt ? task.completedAt.slice(0, 10) : "—",
    ]),
  ];
  for (const row of table) {
    doc.fontSize(row === table[0] ? 10 : 9).text(row.join("   |   "), { continued: false });
  }
  doc.moveDown().fontSize(14).text("Interdepartmental handoffs");
  doc.fontSize(10).text(`Total ${report.delegationMetrics.total} · Completed ${report.delegationMetrics.completed} · Average hours ${report.delegationMetrics.averageHours}`);
  doc.end();
  return done;
}

type PreparedTaskStep = {
  title: string;
  description: string | null;
  position: number;
  required: boolean;
  assigneeId: string;
  assignedById: string;
  sourceDepartment: DepartmentSlug;
  targetDepartment: DepartmentSlug | null;
  targetLeadId: string | null;
  interdepartmental: boolean;
  dueAt: Date;
};

async function prepareTaskSteps(actor: User, raw: unknown, maxDue: Date) {
  if (raw === undefined || raw === null) return [] as PreparedTaskStep[];
  if (!Array.isArray(raw)) throw new HttpError(422, "validation", "Steps must be a list.", { steps: "Steps must be a list." });
  if (raw.length > 30) throw new HttpError(422, "validation", "A task can have at most 30 steps.", { steps: "A task can have at most 30 steps." });
  const steps: PreparedTaskStep[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const item = raw[index];
    if (!item || typeof item !== "object") throw new HttpError(422, "validation", "Each step needs a title and assignee.");
    const input = item as Record<string, unknown>;
    const title = textField(input.title, "Step title", 3, 160);
    const description = input.description === undefined || input.description === null || input.description === ""
      ? null
      : textField(input.description, "Step description", 1, 2000);
    const assignee = await canAssignStepTo(actor, String(input.assigneeId || actor.id));
    const dueAt = parseTaskDate(input.dueAt, "Step due");
    if (!dueAt || dueAt.getTime() > maxDue.getTime()) {
      throw new HttpError(422, "validation", "A step cannot be due after the task.", { dueAt: "A step cannot be due after the task." });
    }
    const targetDepartment = input.targetDepartment ? String(input.targetDepartment) : null;
    if (targetDepartment && !(await departmentName(targetDepartment))) {
      throw new HttpError(422, "validation", "Choose a valid receiving department.", { targetDepartment: "Choose a valid receiving department." });
    }
    if (targetDepartment && assignee.departmentSlug !== targetDepartment) {
      throw new HttpError(422, "validation", "The step assignee must belong to the receiving department.", { assigneeId: "The step assignee must belong to the receiving department." });
    }
    let targetLeadId: string | null = null;
    if (input.targetLeadId) {
      const lead = await userById(String(input.targetLeadId));
      if (!lead || !lead.active || lead.role !== "lead" || (targetDepartment && lead.departmentSlug !== targetDepartment)) {
        throw new HttpError(422, "validation", "Choose an active head for that department.", { targetLeadId: "Choose an active head for that department." });
      }
      targetLeadId = lead.id;
    }
    steps.push({
      title,
      description,
      position: Number.isFinite(Number(input.position)) ? Number(input.position) : index + 1,
      required: input.required !== false,
      assigneeId: assignee.id,
      assignedById: actor.id,
      sourceDepartment: actor.departmentSlug as DepartmentSlug,
      targetDepartment: targetDepartment as DepartmentSlug | null,
      targetLeadId,
      interdepartmental: Boolean(targetDepartment && targetDepartment !== actor.departmentSlug),
      dueAt,
    });
  }
  return steps;
}

async function insertTaskSteps(taskId: string, steps: PreparedTaskStep[]) {
  for (const step of steps) {
    await q(
      `INSERT INTO task_steps
         (id, task_id, title, description, position, required, assignee_id, assigned_by_id,
          source_department, target_department, target_lead_id, interdepartmental, status, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'assigned',$13)`,
      [
        randomUUID(),
        taskId,
        step.title,
        step.description,
        step.position,
        step.required,
        step.assigneeId,
        step.assignedById,
        step.sourceDepartment,
        step.targetDepartment,
        step.targetLeadId,
        step.interdepartmental,
        step.dueAt,
      ],
    );
  }
}

export async function handle(method: string, path: string[], request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const key = `${method} ${path.join("/")}`;

    if (key === "GET auth/sso/start") return ssoStart(request);

    if (key === "GET auth/sso/callback") return await ssoCallback(request);

    if (key === "POST auth/login") {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
      const body = await readJson(request);
      const email = emailField(body.email);
      const password = typeof body.password === "string" ? body.password : "";
      if (!password) throw new HttpError(422, "validation", "Password is required.", { password: "Password is required." });
      const wait = Math.max(rateLimit(`email:${email}`), rateLimit(`ip:${ip}`));
      if (wait > 0) {
        return json(
          { error: { code: "rate_limited", message: "Too many attempts. Wait and try again." } },
          429,
          { "Retry-After": String(wait) },
        );
      }
      const user = await checkPassword(email, password);
      if (!user) return json({ error: { code: "unauthorized", message: "Email or password is wrong." } }, 401);
      const token = await createSession(user.id);
      return json(await me(user), 200, { "Set-Cookie": sessionCookie(token, 60 * 60 * 24 * 30) });
    }

    if (key === "POST auth/logout") {
      const user = await requireUser(request);
      void user;
      await destroySession(cookieValue(request.headers.get("cookie"), "desk_session"));
      return new Response(null, { status: 204, headers: { "Set-Cookie": sessionCookie("", 0) } });
    }

    if (key === "GET me") return json(await me(await requireUser(request)));

    if (key === "GET badges") return json(await badgesFor(await requireUser(request)));

    if (key === "GET departments") {
      const user = await requireUser(request);
      const includeEmail = user.role === "admin";
      const rows = await q<Record<string, unknown>>(
        `SELECT d.slug, d.name,
                u.id AS user_id, u.email, u.name AS user_name, u.role, u.department_slug, u.active
         FROM departments d
         LEFT JOIN department_recipients r ON r.department_slug = d.slug
         LEFT JOIN users u ON u.id = r.user_id
         ORDER BY d.position, d.slug, u.name`,
      );
      const items: { slug: string; name: string; recipients: ReturnType<typeof person>[] }[] = [];
      const index = new Map<string, (typeof items)[number]>();
      for (const row of rows) {
        const slug = String(row.slug);
        let item = index.get(slug);
        if (!item) {
          item = { slug, name: String(row.name), recipients: [] };
          index.set(slug, item);
          items.push(item);
        }
        if (!row.user_id) continue;
        item.recipients.push(
          person(
            {
              id: String(row.user_id),
              email: String(row.email ?? ""),
              name: String(row.user_name),
              role: row.role as User["role"],
              departmentSlug: row.department_slug as DepartmentSlug,
              active: Boolean(row.active),
            },
            includeEmail,
          ),
        );
      }
      return json({ items });
    }

    if (key === "POST departments") {
      const user = await requireUser(request);
      requireAdmin(user);
      const body = await readJson(request);
      const name = textField(body.name, "Name", 1, 80);
      const slug = slugify(name);
      if (!slug) throw new HttpError(422, "validation", "Use letters or numbers in the name.");
      const taken = await q(`SELECT 1 FROM departments WHERE slug = $1`, [slug]);
      if (taken.length) return json({ error: { code: "conflict", message: "A department with that name already exists." } }, 409);
      const position = await q<{ n: number }>(`SELECT coalesce(max(position), 0)::int + 1 AS n FROM departments`);
      await q(`INSERT INTO departments (slug, name, position) VALUES ($1, $2, $3)`, [slug, name, Number(position[0]?.n || 1)]);
      return json(await departmentPayload(slug, true), 201);
    }

    if (method === "GET" && path[0] === "departments" && path.length === 2) {
      const user = await requireUser(request);
      if (!(await departmentName(path[1]))) throw new HttpError(404, "not_found", "That department does not exist.");
      return json(await departmentPayload(path[1], user.role === "admin"));
    }

    if (key === "GET people") {
      const user = await requireUser(request);
      let department = url.searchParams.get("department");
      if (user.role !== "admin" && !department) department = user.departmentSlug;
      if (department && !(await departmentName(department))) throw new HttpError(422, "validation", "That department is not valid.");
      const query = url.searchParams.get("q")?.trim() || "";
      const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset") || 0) || 0));
      const limit = pageLimit(url, 50, 12);
      const where: string[] = [];
      const params: unknown[] = [];
      if (department) {
        params.push(department);
        where.push(`department_slug = $${params.length}`);
      }
      if (query) {
        params.push(`%${query}%`);
        where.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length})`);
      }
      const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const counted = await q<{ n: number }>(`SELECT count(*)::int AS n FROM users ${clause}`, params);
      const rows = await q(
        `SELECT id, email, name, role, department_slug, active FROM users ${clause} ORDER BY name LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return json({
        total: Number(counted[0]?.n ?? 0),
        items: rows.map((row) =>
          person(
            {
              id: String(row.id),
              email: String(row.email),
              name: String(row.name),
              role: row.role as User["role"],
              departmentSlug: row.department_slug as DepartmentSlug,
              active: Boolean(row.active),
            },
            user.role === "admin" || (user.role === "lead" && department === user.departmentSlug),
          ),
        ),
      });
    }

    if (key === "POST people") {
      const user = await requireUser(request);
      requireAdmin(user);
      const body = await readJson(request);
      const name = textField(body.name, "Name", 1, 80);
      const email = emailField(body.email);
      const password = textField(body.password, "Password", 10, 200);
      if (!isRole(String(body.role))) throw new HttpError(422, "validation", "Choose a role.", { role: "Choose a role." });
      const departmentSlug = body.role === "admin" ? "it-software" : String(body.departmentSlug);
      requireSuperadminHome(String(body.role), departmentSlug);
      await requireDepartment(departmentSlug);
      const taken = await q(`SELECT 1 FROM users WHERE lower(email) = lower($1)`, [email]);
      if (taken.length) return json({ error: { code: "conflict", message: "That email is already in use." } }, 409);
      const id = randomUUID();
      await q(
        `INSERT INTO users (id, email, name, password_hash, role, department_slug, active) VALUES ($1,$2,$3,$4,$5,$6,true)`,
        [id, email, name, await hashPassword(password), body.role, departmentSlug],
      );
      if (body.queueRecipient === true) {
        await q(`INSERT INTO department_recipients (department_slug, user_id) VALUES ($1, $2)`, [departmentSlug, id]);
      }
      if (Array.isArray(body.watches)) {
        for (const slug of body.watches) {
          if (!(await departmentName(String(slug)))) throw new HttpError(422, "validation", "One of those departments is not valid.");
          await q(`INSERT INTO department_watches (user_id, department_slug) VALUES ($1, $2)`, [id, slug]);
        }
      }
      const created = await userById(id);
      return json(person(created as User, true), 201);
    }

    if (method === "PATCH" && path[0] === "people" && path.length === 2) {
      const user = await requireUser(request);
      requireAdmin(user);
      const current = await userById(path[1]);
      if (!current) throw new HttpError(404, "not_found", "That person does not exist.");
      const body = await readJson(request);
      const name = body.name === undefined ? current.name : textField(body.name, "Name", 1, 80);
      const email = body.email === undefined ? current.email : emailField(body.email);
      const role = body.role === undefined ? current.role : body.role;
      const department = body.departmentSlug === undefined ? current.departmentSlug : body.departmentSlug;
      const active = body.active === undefined ? current.active : Boolean(body.active);
      if (!isRole(String(role))) throw new HttpError(422, "validation", "Choose a role.", { role: "Choose a role." });
      const nextDepartment = role === "admin" ? "it-software" : String(department);
      requireSuperadminHome(String(role), nextDepartment);
      if (current.role === "admin" && (role !== "admin" || active !== true)) await keepOneSuperadmin(current.id);
      await requireDepartment(nextDepartment);
      const taken = await q(`SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2`, [email, current.id]);
      if (taken.length) return json({ error: { code: "conflict", message: "That email is already in use." } }, 409);
      if (body.password !== undefined) {
        const password = textField(body.password, "Password", 10, 200);
        await q(
          `UPDATE users SET name = $2, email = $3, role = $4, department_slug = $5, active = $6, password_hash = $7 WHERE id = $1`,
          [current.id, name, email, role, nextDepartment, active, await hashPassword(password)],
        );
        const door = String(role) === "admin" ? "/admin" : "/login";
        await sendMail({
          event: "account.password_changed",
          subject: "Your desk password was changed",
          title: "Your password was changed",
          eventLabel: "Password changed",
          meta: "The new password is not in this email",
          actorName: user.name,
          actorDepartment: (await departmentName(user.departmentSlug)) || user.departmentSlug,
          note: `${user.name} set a new password for your desk account. Sign in with the password they gave you. If you did not expect this, contact an admin.`,
          ticketId: "Account",
          ticketUrl: `${origin()}${door}`,
          toIds: [current.id],
          ccIds: [],
          ticketIdForRow: null,
          outreachId: null,
        });
      } else {
        await q(`UPDATE users SET name = $2, email = $3, role = $4, department_slug = $5, active = $6 WHERE id = $1`, [
          current.id,
          name,
          email,
          role,
          nextDepartment,
          active,
        ]);
      }
      if (nextDepartment !== current.departmentSlug) {
        await q(`DELETE FROM department_recipients WHERE user_id = $1`, [current.id]);
      }
      if (body.queueRecipient !== undefined) {
        await q(`DELETE FROM department_recipients WHERE user_id = $1 AND department_slug = $2`, [current.id, nextDepartment]);
        if (body.queueRecipient === true) {
          await q(`INSERT INTO department_recipients (department_slug, user_id) VALUES ($1, $2)`, [nextDepartment, current.id]);
        }
      }
      if (Array.isArray(body.watches)) {
        await q(`DELETE FROM department_watches WHERE user_id = $1`, [current.id]);
        for (const slug of body.watches) {
          if (!(await departmentName(String(slug)))) throw new HttpError(422, "validation", "One of those departments is not valid.");
          await q(`INSERT INTO department_watches (user_id, department_slug) VALUES ($1, $2)`, [current.id, slug]);
        }
      }
      return json(person((await userById(current.id)) as User, true));
    }

    if (method === "DELETE" && path[0] === "people" && path.length === 2) {
      const user = await requireUser(request);
      requireAdmin(user);
      const current = await userById(path[1]);
      if (!current) throw new HttpError(404, "not_found", "That person does not exist.");
      if (current.id === user.id) throw new HttpError(422, "validation", "You cannot delete your own account.");
      if (current.role === "admin") await keepOneSuperadmin(current.id);
      const used = await q<{ n: number }>(
        `SELECT (
           (SELECT count(*) FROM tickets WHERE requester_id = $1 OR assignee_id = $1) +
           (SELECT count(*) FROM messages WHERE author_id = $1) +
           (SELECT count(*) FROM ticket_events WHERE actor_id = $1) +
           (SELECT count(*) FROM notifications WHERE actor_id = $1) +
           (SELECT count(*) FROM outreaches WHERE actor_id = $1)
         )::int AS n`,
        [current.id],
      );
      if (Number(used[0]?.n ?? 0) > 0) {
        await q(`UPDATE users SET active = false WHERE id = $1`, [current.id]);
        await q(`DELETE FROM sessions WHERE user_id = $1`, [current.id]);
        return json({ removed: false, disabled: true, person: person((await userById(current.id)) as User, true) });
      }
      await q(`DELETE FROM department_recipients WHERE user_id = $1`, [current.id]);
      await q(`DELETE FROM sessions WHERE user_id = $1`, [current.id]);
      await q(`DELETE FROM users WHERE id = $1`, [current.id]);
      return json({ removed: true, disabled: false });
    }

    if (key === "GET tickets") return json(await listTickets(await requireUser(request), url));

    if (key === "POST tickets") {
      const user = await requireUser(request);
      const body = await readJson(request);
      const title = textField(body.title, "Title", 1, 120);
      const note = textField(body.body, "Note", 1, 8000);
      const targetName = await requireDepartment(String(body.targetDepartment));
      const priority = body.priority === undefined ? "normal" : body.priority;
      if (!isPriority(String(priority))) throw new HttpError(422, "validation", "Choose a priority.", { priority: "Choose a priority." });
      const messageId = randomUUID();
      const ticketId = await tx(async () => {
        const seq = await q<{ id: string }>(`SELECT 'VC-' || nextval('ticket_no') AS id`);
        const id = String(seq[0].id);
        await q(
          `INSERT INTO tickets (id, title, status, priority, requester_id, source_department, target_department)
           VALUES ($1, $2, 'open', $3, $4, $5, $6)`,
          [id, title, priority, user.id, user.departmentSlug, body.targetDepartment],
        );
        await q(`INSERT INTO messages (id, ticket_id, author_id, body) VALUES ($1, $2, $3, $4)`, [messageId, id, user.id, note]);
        await recordEvent({ ticketId: id, type: "created", toStatus: "open", actorId: user.id });
        return id;
      });
      const row = await ticketRow(ticketId);
      if (!row) throw new HttpError(500, "error", "The ticket was not saved.");
      const sourceName = (await departmentName(user.departmentSlug)) || user.departmentSlug;
      const sentence = `${user.name} in ${sourceName} raised ${ticketId} to ${targetName}.`;
      await notify({
        recipients: await recipientIds(row, user.id),
        readers: await readerIds(row),
        actor: user,
        type: "ticket.raised",
        sound: "raise",
        sentence,
        ticketId,
        ticketEvent: {
          type: "ticket.raised",
          ticketId,
          sound: "raise",
          sentence,
          sourceDepartment: user.departmentSlug,
          targetDepartment: body.targetDepartment,
          title,
        },
      });
      await mailTicket(row, user, "ticket.raised", note, `${ticketId} ${title}`, `Raised to ${targetName}`);
      return json(await detail(row, user.role === "admin"), 201);
    }

    if (method === "GET" && path[0] === "tickets" && path.length === 2) {
      const user = await requireUser(request);
      if (!/^VC-[1-9][0-9]*$/.test(path[1])) throw new HttpError(404, "not_found", "That ticket does not exist.");
      const row = await ticketRow(path[1]);
      if (!row || !(await canRead(user, row))) throw new HttpError(404, "not_found", "That ticket does not exist.");
      return json(await detail(row, user.role === "admin"));
    }

    if (method === "PATCH" && path[0] === "tickets" && path.length === 2) {
      const user = await requireUser(request);
      const row = await ticketRow(path[1]);
      if (!row || !(await canRead(user, row))) throw new HttpError(404, "not_found", "That ticket does not exist.");
      if (!canManage(user, String(row.target_department))) throw new HttpError(403, "forbidden", "You cannot change this ticket.");
      const body = await readJson(request);
      if (body.status === undefined && body.priority === undefined && body.assigneeId === undefined) {
        throw new HttpError(422, "validation", "Nothing to change.");
      }
      let status = row.status as Status;
      let priority = row.priority as Priority;
      let assigneeId = row.assignee_id ? String(row.assignee_id) : null;
      let assigneeUser: User | null = assigneeId ? await userById(assigneeId) : null;
      if (body.priority !== undefined) {
        if (!isPriority(String(body.priority))) throw new HttpError(422, "validation", "Choose a priority.", { priority: "Choose a priority." });
        priority = body.priority as Priority;
      }
      if (body.assigneeId !== undefined) {
        if (body.assigneeId === null) {
          assigneeId = null;
          assigneeUser = null;
        } else if (typeof body.assigneeId !== "string") {
          throw new HttpError(422, "validation", "Choose a person.", { assigneeid: "Choose a person." });
        } else {
          const next = await userById(body.assigneeId);
          if (!next || !next.active || next.departmentSlug !== row.target_department) {
            throw new HttpError(422, "validation", "Assign someone in the target department.", { assigneeid: "Assign someone in the target department." });
          }
          assigneeId = next.id;
          assigneeUser = next;
          if (status === "open" && body.status === undefined) status = "in_progress";
        }
      }
      if (body.status !== undefined) {
        if (!isStatus(String(body.status))) throw new HttpError(422, "validation", "That status is not valid.", { status: "That status is not valid." });
        if (body.status === "closed" && row.status !== "resolved") {
          return json({ error: { code: "conflict", message: "Resolve the ticket before closing it." } }, 409);
        }
        status = body.status as Status;
      }
      const assignedChanged = String(row.assignee_id ?? "") !== String(assigneeId ?? "");
      const statusChanged = row.status !== status;
      await tx(async () => {
        await q(
          `UPDATE tickets SET status = $2, priority = $3, assignee_id = $4, updated_at = now() WHERE id = $1`,
          [row.id, status, priority, assigneeId],
        );
        if (assignedChanged) {
          await recordEvent({
            ticketId: String(row.id),
            type: assigneeId ? "assigned" : "unassigned",
            fromStatus: row.status as Status,
            toStatus: status,
            actorId: user.id,
          });
        }
        if (statusChanged) {
          await recordEvent({
            ticketId: String(row.id),
            type: statusEventType(row.status as Status, status),
            fromStatus: row.status as Status,
            toStatus: status,
            actorId: user.id,
          });
        }
      });
      const next = await ticketRow(String(row.id));
      if (!next) throw new HttpError(404, "not_found", "That ticket does not exist.");
      if (assignedChanged) {
        const name = assigneeUser ? assigneeUser.name : "no one";
        const sentence = `${user.name} assigned ${row.id} to ${name}.`;
        await notify({
          recipients: await recipientIds(next, user.id),
          readers: await readerIds(next),
          actor: user,
          type: "ticket.assigned",
          sound: "status",
          sentence,
          ticketId: String(row.id),
          ticketEvent: { type: "ticket.assigned", ticketId: String(row.id), assignee: personFromAliases(next, "assignee", false), status },
        });
        await mailTicket(next, user, "ticket.assigned", sentence, `${row.id} assigned to ${name}`, "Assigned");
      }
      if (statusChanged && !assignedChanged) {
        const sentence = `${user.name} marked ${row.id} ${STATUS_LABEL[status]}.`;
        await notify({
          recipients: await recipientIds(next, user.id),
          readers: await readerIds(next),
          actor: user,
          type: "ticket.status_changed",
          sound: "status",
          sentence,
          ticketId: String(row.id),
          ticketEvent: { type: "ticket.status_changed", ticketId: String(row.id), status, priority },
        });
        await mailTicket(next, user, "ticket.status_changed", sentence, `${row.id} marked ${STATUS_LABEL[status]}`, `Marked ${STATUS_LABEL[status]}`);
      } else if (statusChanged && assignedChanged && body.status !== undefined) {
        const sentence = `${user.name} marked ${row.id} ${STATUS_LABEL[status]}.`;
        await notify({
          recipients: await recipientIds(next, user.id),
          readers: await readerIds(next),
          actor: user,
          type: "ticket.status_changed",
          sound: "status",
          sentence,
          ticketId: String(row.id),
          ticketEvent: { type: "ticket.status_changed", ticketId: String(row.id), status, priority },
        });
      }
      if (!assignedChanged && !statusChanged && priority !== row.priority) {
        await pushBadges(await readerIds(next));
        publish(await readerIds(next), {
          type: "ticket.status_changed",
          ticketId: String(row.id),
          status,
          priority,
          actor: person(user, false),
          at: new Date().toISOString(),
        });
      }
      return json(await detail(next, user.role === "admin"));
    }

    // A receiver starts work. An unassigned ticket is claimed by the person
    // who clicks Begin; an assigned ticket can only be started by its assignee
    // or by a lead/admin of the receiving department.
    if (method === "POST" && path[0] === "tickets" && path[2] === "begin" && path.length === 3) {
      const user = await requireUser(request);
      const row = await ticketRow(path[1]);
      if (!row || !(await canRead(user, row))) throw new HttpError(404, "not_found", "That ticket does not exist.");
      const target = String(row.target_department);
      if (!canReceive(user, target)) throw new HttpError(403, "forbidden", "Only the receiving department can begin this ticket.");
      if (row.status === "closed") return json({ error: { code: "conflict", message: "This ticket is closed." } }, 409);
      if (row.status !== "open" && row.status !== "waiting") {
        return json({ error: { code: "conflict", message: "Work on this ticket has already started." } }, 409);
      }
      if (row.assignee_id && row.assignee_id !== user.id && !canManage(user, target)) {
        throw new HttpError(403, "forbidden", "Only the assignee can begin this ticket.");
      }
      const claiming = !row.assignee_id;
      await tx(async () => {
        await q(`UPDATE tickets SET assignee_id = $1, status = 'in_progress', updated_at = now() WHERE id = $2`, [user.id, row.id]);
        if (claiming) {
          await recordEvent({
            ticketId: String(row.id),
            type: "assigned",
            fromStatus: row.status as Status,
            toStatus: "in_progress",
            actorId: user.id,
          });
        }
        await recordEvent({
          ticketId: String(row.id),
          type: "started",
          fromStatus: row.status as Status,
          toStatus: "in_progress",
          actorId: user.id,
        });
      });
      const next = await ticketRow(String(row.id));
      if (!next) throw new HttpError(404, "not_found", "That ticket does not exist.");
      const sentence = claiming
        ? `${user.name} picked up ${row.id} and started work.`
        : `${user.name} started work on ${row.id}.`;
      await notify({
        recipients: await recipientIds(next, user.id),
        readers: await readerIds(next),
        actor: user,
        type: "ticket.status_changed",
        sound: "status",
        sentence,
        ticketId: String(row.id),
        ticketEvent: { type: "ticket.status_changed", ticketId: String(row.id), status: "in_progress", stage: "started" },
      });
      await mailTicket(next, user, "ticket.status_changed", sentence, `${row.id} work started`, "Work started");
      return json(await detail(next, user.role === "admin"));
    }

    // A receiver marks the work complete. The requester can still reply and
    // reopen it; only a lead/admin can then close it.
    if (method === "POST" && path[0] === "tickets" && path[2] === "complete" && path.length === 3) {
      const user = await requireUser(request);
      const row = await ticketRow(path[1]);
      if (!row || !(await canRead(user, row))) throw new HttpError(404, "not_found", "That ticket does not exist.");
      if (row.assignee_id !== user.id && !canManage(user, String(row.target_department))) {
        throw new HttpError(403, "forbidden", "Only the assignee or a lead can complete this ticket.");
      }
      if (row.status === "closed") return json({ error: { code: "conflict", message: "This ticket is closed." } }, 409);
      if (row.status === "resolved") return json(await detail(row, user.role === "admin"));
      await tx(async () => {
        await q(`UPDATE tickets SET status = 'resolved', updated_at = now() WHERE id = $1`, [row.id]);
        await recordEvent({
          ticketId: String(row.id),
          type: "resolved",
          fromStatus: row.status as Status,
          toStatus: "resolved",
          actorId: user.id,
        });
      });
      const next = await ticketRow(String(row.id));
      if (!next) throw new HttpError(404, "not_found", "That ticket does not exist.");
      const sentence = `${user.name} completed ${row.id}.`;
      await notify({
        recipients: await recipientIds(next, user.id),
        readers: await readerIds(next),
        actor: user,
        type: "ticket.status_changed",
        sound: "status",
        sentence,
        ticketId: String(row.id),
        ticketEvent: { type: "ticket.status_changed", ticketId: String(row.id), status: "resolved", stage: "completed" },
      });
      await mailTicket(next, user, "ticket.status_changed", sentence, `${row.id} completed`, "Completed");
      return json(await detail(next, user.role === "admin"));
    }

    if (method === "POST" && path[0] === "tickets" && path[2] === "messages" && path.length === 3) {
      const user = await requireUser(request);
      const row = await ticketRow(path[1]);
      if (!row || !(await canRead(user, row))) throw new HttpError(404, "not_found", "That ticket does not exist.");
      if (!(await canReply(user, row))) throw new HttpError(403, "forbidden", "You cannot reply on this ticket.");
      if (row.status === "closed") return json({ error: { code: "conflict", message: "This ticket is closed." } }, 409);
      const body = await readJson(request);
      const note = textField(body.body, "Note", 1, 8000);
      const messageId = randomUUID();
      const nextStatus = row.status === "resolved" ? "open" : row.status;
      await tx(async () => {
        await q(`INSERT INTO messages (id, ticket_id, author_id, body) VALUES ($1, $2, $3, $4)`, [messageId, row.id, user.id, note]);
        await q(`UPDATE tickets SET status = $2, updated_at = now() WHERE id = $1`, [row.id, nextStatus]);
        if (nextStatus !== row.status) {
          await recordEvent({
            ticketId: String(row.id),
            type: "reopened",
            fromStatus: row.status as Status,
            toStatus: nextStatus as Status,
            actorId: user.id,
          });
        }
      });
      const next = await ticketRow(String(row.id));
      if (!next) throw new HttpError(404, "not_found", "That ticket does not exist.");
      const sentence = `${user.name} replied on ${row.id}.`;
      await notify({
        recipients: await recipientIds(next, user.id),
        readers: await readerIds(next),
        actor: user,
        type: "ticket.replied",
        sound: "reply",
        sentence,
        ticketId: String(row.id),
        ticketEvent: { type: "ticket.replied", ticketId: String(row.id), messageId, body: note, status: nextStatus },
      });
      await mailTicket(next, user, "ticket.replied", note, `Re: ${row.id} ${row.title}`, "Reply");
      const created = (await messagesFor(String(row.id), user.role === "admin")).find((item) => item.id === messageId);
      return json(created, 201);
    }

    if (method === "POST" && path[0] === "tickets" && path[2] === "watchers" && path.length === 3) {
      const user = await requireUser(request);
      const row = await ticketRow(path[1]);
      if (!row || !(await canRead(user, row))) throw new HttpError(404, "not_found", "That ticket does not exist.");
      const body = await readJson(request);
      const userId = typeof body.userId === "string" ? body.userId : "";
      const self = user.id === row.requester_id && userId === user.id;
      if (!self && !canManage(user, String(row.target_department))) throw new HttpError(403, "forbidden", "You cannot add a watcher.");
      const target = await userById(userId);
      if (!target || !target.active) throw new HttpError(422, "validation", "Choose an active person.", { userid: "Choose an active person." });
      await q(`INSERT INTO watchers (ticket_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [row.id, target.id]);
      return json({ watchers: await watcherPeople(String(row.id), user.role === "admin") });
    }

    if (method === "DELETE" && path[0] === "tickets" && path[2] === "watchers" && path.length === 4) {
      const user = await requireUser(request);
      const row = await ticketRow(path[1]);
      if (!row || !(await canRead(user, row))) throw new HttpError(404, "not_found", "That ticket does not exist.");
      const self = user.id === row.requester_id && path[3] === user.id;
      if (!self && !canManage(user, String(row.target_department))) throw new HttpError(403, "forbidden", "You cannot remove that watcher.");
      await q(`DELETE FROM watchers WHERE ticket_id = $1 AND user_id = $2`, [row.id, path[3]]);
      return new Response(null, { status: 204 });
    }

    if (method === "POST" && path[0] === "tickets" && path[2] === "attachments" && path.length === 3) {
      const user = await requireUser(request);
      const row = await ticketRow(path[1]);
      if (!row || !(await canRead(user, row))) throw new HttpError(404, "not_found", "That ticket does not exist.");
      if (row.status === "closed") return json({ error: { code: "conflict", message: "This ticket is closed." } }, 409);
      const form = await request.formData();
      const messageId = String(form.get("messageId") || "");
      const file = form.get("file");
      if (!(file instanceof File) || !messageId) throw new HttpError(422, "validation", "Choose a file.");
      const message = await q(`SELECT id, author_id FROM messages WHERE id = $1 AND ticket_id = $2`, [messageId, row.id]);
      if (!message[0]) throw new HttpError(404, "not_found", "That note does not exist.");
      if (String(message[0].author_id) !== user.id) throw new HttpError(403, "forbidden", "You can attach a file to your own note.");
      const count = await q<{ n: number }>(`SELECT count(*)::int AS n FROM attachments WHERE message_id = $1`, [messageId]);
      if (Number(count[0]?.n) >= 5) return json({ error: { code: "conflict", message: "That note already has 5 files." } }, 409);
      if (file.size > 10 * 1024 * 1024) return json({ error: { code: "payload_too_large", message: "Files must be 10 MB or smaller." } }, 413);
      const bytes = Buffer.from(await file.arrayBuffer());
      const mediaType = sniff(bytes);
      if (!mediaType) return json({ error: { code: "unsupported", message: "Use a PNG, JPEG, WEBP, or PDF." } }, 415);
      const id = randomUUID();
      const name = file.name.replace(/[/\\]/g, "").slice(0, 180) || "file";
      let storageKey: string = id;
      try {
        storageKey = await storeFile(id, bytes, mediaType, name, uploads);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The file was not stored.";
        throw new HttpError(502, "error", message);
      }
      await q(
        `INSERT INTO attachments (id, message_id, name, media_type, size, storage_key) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, messageId, name, mediaType, bytes.length, storageKey],
      );
      return json({ id, messageId, name, mediaType, size: bytes.length }, 201);
    }

    if (method === "GET" && path[0] === "attachments" && path.length === 2) {
      const user = await requireUser(request);
      const rows = await q(
        `SELECT a.name, a.media_type, a.storage_key, m.ticket_id
         FROM attachments a JOIN messages m ON m.id = a.message_id WHERE a.id = $1`,
        [path[1]],
      );
      const file = rows[0];
      if (!file) throw new HttpError(404, "not_found", "That file does not exist.");
      const row = await ticketRow(String(file.ticket_id));
      if (!row || !(await canRead(user, row))) throw new HttpError(404, "not_found", "That file does not exist.");
      const stored = await readStoredFile(String(file.storage_key), uploads);
      if (!stored) throw new HttpError(404, "not_found", "That file does not exist.");
      const disposition = String(file.media_type).startsWith("image/") ? "inline" : "attachment";
      return new Response(new Uint8Array(stored.bytes), {
        headers: {
          "Content-Type": String(file.media_type),
          "Content-Disposition": `${disposition}; filename="${String(file.name).replace(/"/g, "")}"`,
        },
      });
    }

    if (key === "GET notifications") {
      const user = await requireUser(request);
      const where = [`user_id = $1`];
      const params: unknown[] = [user.id];
      if (url.searchParams.get("unread") === "true") where.push(`read = false`);
      const query = url.searchParams.get("q")?.trim();
      if (query) {
        params.push(`%${query}%`);
        where.push(`n.sentence ILIKE $${params.length}`);
      }
      const cursor = url.searchParams.get("cursor");
      if (cursor) {
        const decoded = decodeCursor(cursor);
        params.push(decoded.time, decoded.id);
        where.push(`(n.created_at, n.id) < ($${params.length - 1}::timestamptz, $${params.length})`);
      }
      const limit = pageLimit(url);
      params.push(limit + 1);
      const rows = await q(
        `SELECT n.*, u.name AS actor_name, u.role AS actor_role, u.department_slug AS actor_department, u.active AS actor_active, u.email AS actor_email
         FROM notifications n JOIN users u ON u.id = n.actor_id
         WHERE ${where.join(" AND ")}
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT $${params.length}`,
        params,
      );
      const extra = rows.length > limit;
      const items = rows.slice(0, limit).map((row) => ({
        id: String(row.id),
        type: String(row.type),
        ticketId: row.ticket_id ? String(row.ticket_id) : null,
        taskId: row.task_id ? String(row.task_id) : undefined,
        departmentSlug: row.department_slug ? String(row.department_slug) : undefined,
        sentence: String(row.sentence),
        sound: String(row.sound),
        read: Boolean(row.read),
        createdAt: iso(row.created_at),
        actor: personFromAliases(row, "actor", false),
      }));
      const last = rows[Math.min(rows.length, limit) - 1];
      return json({ items, nextCursor: extra && last ? encodeCursor(iso(last.created_at), String(last.id)) : null });
    }

    if (key === "POST notifications/read") {
      const user = await requireUser(request);
      const body = request.headers.get("content-length") === "0" ? {} : await readJson(request).catch(() => ({}));
      const ids = Array.isArray((body as { ids?: unknown }).ids) ? ((body as { ids: unknown[] }).ids as unknown[]) : null;
      if (!ids || ids.length === 0) {
        await q(`UPDATE notifications SET read = true WHERE user_id = $1 AND read = false`, [user.id]);
      } else {
        for (const id of ids) {
          if (typeof id === "string") await q(`UPDATE notifications SET read = true WHERE user_id = $1 AND id = $2`, [user.id, id]);
        }
      }
      await pushBadges([user.id]);
      return new Response(null, { status: 204 });
    }

    if (method === "GET" && path[0] === "tickets" && path[2] === "receipts" && path.length === 3) {
      const user = await requireUser(request);
      const row = await ticketRow(path[1]);
      if (!row || !(await canRead(user, row))) throw new HttpError(404, "not_found", "That ticket does not exist.");
      const receipts = await q(`SELECT * FROM receipts WHERE ticket_id = $1 ORDER BY created_at ASC`, [path[1]]);
      return json({ items: receipts.map(mapReceipt) });
    }

    if (key === "GET admin/summary") {
      const user = await requireUser(request);
      requireAdmin(user);
      const counts = await monitorCounts();
      const grouped = await q<{ target_department: string; status: Status; n: number }>(
        `SELECT target_department, status, count(*)::int AS n FROM tickets GROUP BY target_department, status`,
      );
      const listed = await q<{ slug: string; name: string }>(`SELECT slug, name FROM departments ORDER BY position, slug`);
      const departments = listed.map((item) => {
        const n = (status: Status) => Number(grouped.find((row) => row.target_department === item.slug && row.status === status)?.n ?? 0);
        const raised = n("open");
        const pending = n("in_progress") + n("waiting");
        return {
          slug: item.slug,
          name: item.name,
          raised,
          pending,
          resolved: n("resolved"),
          closed: n("closed"),
          unresolved: raised + pending,
        };
      });
      return json({ ...counts, departments });
    }

    if (key === "GET admin/tickets") {
      const user = await requireUser(request);
      requireAdmin(user);
      const bucket = url.searchParams.get("bucket") || "";
      return json(await listTickets(user, url, { bucket }));
    }

    if (key === "GET admin/outreach") {
      const user = await requireUser(request);
      requireAdmin(user);
      const where: string[] = [];
      const params: unknown[] = [];
      const department = url.searchParams.get("department");
      if (department) {
        if (!(await departmentName(department))) throw new HttpError(422, "validation", "That department is not valid.");
        params.push(department);
        where.push(`o.department_slug = $${params.length}`);
      }
      const cursor = url.searchParams.get("cursor");
      if (cursor) {
        const decoded = decodeCursor(cursor);
        params.push(decoded.time, decoded.id);
        where.push(`(o.created_at, o.id) < ($${params.length - 1}::timestamptz, $${params.length})`);
      }
      const limit = pageLimit(url);
      params.push(limit + 1);
      const rows = await q(
        `SELECT o.*, u.name AS actor_name, u.role AS actor_role, u.department_slug AS actor_department,
                u.active AS actor_active, u.email AS actor_email
         FROM outreaches o JOIN users u ON u.id = o.actor_id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT $${params.length}`,
        params,
      );
      const extra = rows.length > limit;
      const items = [];
      for (const row of rows.slice(0, limit)) items.push(await mapOutreach(row));
      const last = rows[Math.min(rows.length, limit) - 1];
      return json({ items, nextCursor: extra && last ? encodeCursor(iso(last.created_at), String(last.id)) : null });
    }

    if (key === "POST admin/outreach") {
      const user = await requireUser(request);
      requireAdmin(user);
      const body = await readJson(request);
      const slug = String(body.departmentSlug);
      const departmentLabel = await requireDepartment(slug);
      const note = textField(body.note, "Note", 1, 2000);
      const openRows = await q<{ id: string }>(
        `SELECT id FROM tickets WHERE target_department = $1 AND status IN ('open','in_progress','waiting') ORDER BY updated_at DESC`,
        [slug],
      );
      if (openRows.length === 0) {
        return json({ error: { code: "conflict", message: "That department has no unresolved tickets." } }, 409);
      }
      const id = randomUUID();
      const ticketIds = openRows.map((row) => String(row.id));
      await q(
        `INSERT INTO outreaches (id, actor_id, department_slug, note, unresolved_count, ticket_ids)
         VALUES ($1, $2, $3, $4, $5, $6::text[])`,
        [id, user.id, slug, note, ticketIds.length, ticketIds],
      );
      const recipients = (await queueRecipientIds(slug)).filter((item) => item !== user.id);
      const sentence = `${user.name} asked ${departmentLabel} about ${ticketIds.length} unresolved tickets.`;
      await notify({
        recipients,
        readers: [],
        actor: user,
        type: "department.outreach",
        sound: "status",
        sentence,
        ticketId: null,
        departmentSlug: slug,
        ticketEvent: null,
      });
      const receiptId = await sendMail({
        event: "department.outreach",
        subject: `${departmentLabel} · ${ticketIds.length} unresolved`,
        title: "Unresolved tickets",
        eventLabel: "From Desk",
        meta: `${departmentLabel} · ${ticketIds.length} unresolved`,
        actorName: user.name,
        actorDepartment: (await departmentName(user.departmentSlug)) || user.departmentSlug,
        note,
        ticketUrl: `${origin()}/queue`,
        departmentName: departmentLabel,
        unresolvedCount: String(ticketIds.length),
        toIds: [],
        ccIds: recipients,
        ticketIdForRow: null,
        outreachId: id,
      });
      const saved = await q(
        `SELECT o.*, u.name AS actor_name, u.role AS actor_role, u.department_slug AS actor_department,
                u.active AS actor_active, u.email AS actor_email
         FROM outreaches o JOIN users u ON u.id = o.actor_id WHERE o.id = $1`,
        [id],
      );
      const outreach = await mapOutreach(saved[0]);
      if (!outreach.receipt && receiptId) {
        const receipt = await q(`SELECT * FROM receipts WHERE id = $1`, [receiptId]);
        outreach.receipt = receipt[0] ? mapReceipt(receipt[0]) : null;
      }
      return json(outreach, 201);
    }

    if (key === "POST webhooks/email") {
      const raw = await request.text();
      const secret = process.env.EMAIL_WEBHOOK_SECRET || "";
      const signature = request.headers.get("x-desk-signature") || "";
      const digest = secret ? createHmac("sha256", secret).update(raw).digest("hex") : "";
      if (!secret || !sameSecret(digest, signature)) {
        return json({ error: { code: "unauthorized", message: "The signature does not match." } }, 401);
      }
      const body = JSON.parse(raw) as { providerMessageId?: string; state?: string };
      if ((body.state !== "sent" && body.state !== "failed") || !body.providerMessageId) {
        throw new HttpError(422, "validation", "The delivery update is not valid.");
      }
      await q(`UPDATE receipts SET state = $2 WHERE provider_message_id = $1`, [body.providerMessageId, body.state]);
      return new Response(null, { status: 204 });
    }

    if (key === "POST inbound/email") {
      return json(
        { error: { code: "inbound_disabled", message: "Reply by email is not switched on. Open the ticket in Desk." } },
        501,
      );
    }

    if (key === "GET tasks") return json(await listTasks(await requireUser(request), url));

    if (method === "POST" && path[0] === "tasks" && path.length === 1) {
      const user = await requireUser(request);
      const body = await readJson(request);
      const name = textField(body.name, "Name", 3, 160);
      const description = textField(body.description, "Description", 5, 10000);
      const expectedOutcome = body.expectedOutcome === undefined || body.expectedOutcome === null || body.expectedOutcome === ""
        ? null
        : textField(body.expectedOutcome, "Expected outcome", 1, 5000);
      const assignee = await canAssignTaskTo(user, String(body.assigneeId || ""));
      const priority = body.priority === undefined ? "medium" : body.priority;
      if (!isTaskPriority(String(priority))) throw new HttpError(422, "validation", "Choose a priority.", { priority: "Choose a priority." });
      const startAt = parseTaskDate(body.startAt, "Start", false);
      const dueAt = parseTaskDate(body.dueAt, "Due");
      if (!dueAt || dueAt.getTime() <= Date.now() + 15 * 60000) {
        throw new HttpError(422, "validation", "Choose a due time at least 15 minutes from now.", { dueAt: "Choose a due time at least 15 minutes from now." });
      }
      const reminderOffsets = parseReminderOffsets(body.reminderOffsets);
      const links = parseTaskLinks(body.resourceLinks);
      if (user.role === "member" && body.steps && Array.isArray(body.steps) && body.steps.length > 0) {
        throw new HttpError(403, "forbidden", "Only a head or admin can add delegated steps.");
      }
      const steps = await prepareTaskSteps(user, body.steps, dueAt);
      const id = await tx(async () => {
        const seq = await q<{ id: string }>(`SELECT 'TSK-' || nextval('task_no') AS id`);
        const taskId = String(seq[0].id);
        await q(
          `INSERT INTO tasks
             (id, name, description, expected_outcome, assignee_id, assigned_by_id, priority, status,
              start_at, due_at, reminder_offsets)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'assigned',$8,$9,$10::int[])`,
          [taskId, name, description, expectedOutcome, assignee.id, user.id, String(priority), startAt, dueAt, reminderOffsets],
        );
        await insertTaskSteps(taskId, steps);
        await addTaskLinkResources(taskId, user.id, links);
        await recordTaskActivity(taskId, user.id, "CREATED", `${user.name} created ${taskId}.`, { priority: String(priority), steps: steps.length });
        return taskId;
      });
      const row = await requireTask(user, id);
      await taskNotify(id, user, "created", `${user.name} created ${id}.`);
      return json(await taskDetail(row, user.role === "admin"), 201);
    }

    if (method === "GET" && path[0] === "tasks" && path.length === 2) {
      const user = await requireUser(request);
      return json(await taskDetail(await requireTask(user, path[1]), user.role === "admin"));
    }

    if (method === "PATCH" && path[0] === "tasks" && path.length === 2) {
      const user = await requireUser(request);
      const row = await requireTask(user, path[1]);
      if (taskClosed(row.status as TaskStatus)) return json({ error: { code: "conflict", message: "That task is closed." } }, 409);
      if (!(await canReviewTask(user, row))) throw new HttpError(403, "forbidden", "You cannot change this task.");
      const body = await readJson(request);
      if (body.assigneeId === undefined && body.priority === undefined && body.dueAt === undefined) throw new HttpError(422, "validation", "Nothing to change.");
      let assigneeId = String(row.assignee_id);
      const assigneeChanged = body.assigneeId !== undefined && body.assigneeId !== assigneeId;
      if (assigneeChanged) assigneeId = (await canAssignTaskTo(user, String(body.assigneeId))).id;
      let priority = row.priority as TaskPriority;
      if (body.priority !== undefined) {
        if (!isTaskPriority(String(body.priority))) throw new HttpError(422, "validation", "Choose a priority.", { priority: "Choose a priority." });
        priority = body.priority as TaskPriority;
      }
      let dueAt = new Date(iso(row.due_at));
      const dueChanged = body.dueAt !== undefined;
      if (dueChanged) {
        const next = parseTaskDate(body.dueAt, "Due");
        if (!next || next.getTime() <= Date.now() + 15 * 60000) throw new HttpError(422, "validation", "Choose a valid future due time.", { dueAt: "Choose a valid future due time." });
        dueAt = next;
      }
      if ((assigneeChanged || dueChanged) && !body.reason) throw new HttpError(422, "validation", "Give a reason for that change.", { reason: "Give a reason for that change." });
      const reason = body.reason ? textField(body.reason, "Reason", 1, 500) : null;
      await tx(async () => {
        await q(`UPDATE tasks SET assignee_id = $2, priority = $3, due_at = $4, updated_at = now() WHERE id = $1`, [row.id, assigneeId, String(priority), dueAt]);
        await recordTaskActivity(String(row.id), user.id, "UPDATED", `${user.name} updated ${row.id}.`, {
          assigneeChanged,
          dueChanged,
          reason,
        });
      });
      const next = await requireTask(user, String(row.id));
      await taskNotify(String(row.id), user, "updated", `${user.name} updated ${row.id}.`);
      return json(await taskDetail(next, user.role === "admin"));
    }

    if (key === "GET notifications/status") {
      const user = await requireUser(request);
      const due = await ensureTaskRemindersForUser(user);
      const rows = await q<{ n: number }>(
        `SELECT count(*)::int AS n FROM tasks
         WHERE status IN ('assigned','in_progress','blocked','in_review','changes_requested')
           AND (assignee_id = $1 OR assigned_by_id = $1) AND due_at <= now()`,
        [user.id],
      );
      return json({ ok: true, due: Number(rows[0]?.n ?? 0), delivered: due, at: new Date().toISOString() });
    }

    if (method === "POST" && path[0] === "tasks" && path[1] === "reminders" && path[2] === "run" && path.length === 3) {
      const user = await requireUser(request);
      requireAdmin(user);
      const delivered = await runTaskReminders();
      return json({ ok: true, delivered, at: new Date().toISOString() });
    }

    if (key === "GET reports/tasks/data") {
      const user = await requireUser(request);
      return json(await getTaskReportData(user, url));
    }

    if (key === "GET reports/tasks") {
      const user = await requireUser(request);
      const report = await getTaskReportData(user, url);
      return csvResponse(
        [
          ["ID", "Task", "Assignee", "Department", "Priority", "Status", "Due", "Started", "Submitted", "Completed", "On time", "Hours", "Blocked reason", "Review comment"],
          ...report.tasks.map((task) => [
            task.id,
            task.name,
            task.assignee.name,
            task.assignee.departmentSlug,
            TASK_PRIORITY_LABEL[task.priority],
            task.overdue ? "OVERDUE" : TASK_STATUS_LABEL[task.status],
            task.dueAt,
            task.startedAt || "",
            task.submittedAt || "",
            task.completedAt || "",
            task.completedAt && new Date(task.completedAt) <= new Date(task.dueAt) ? "yes" : "no",
            task.startedAt && task.completedAt ? Math.round((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 3600) : "",
            task.blockedReason || "",
            task.reviewComment || "",
          ]),
        ],
        `task-report-${report.range.period}-${report.range.date}.csv`,
      );
    }

    if (key === "GET reports/tasks/pdf") {
      const user = await requireUser(request);
      const report = await getTaskReportData(user, url);
      const pdf = await taskReportPdf(report, user);
      return new Response(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": `attachment; filename="task-report-${report.range.period}-${report.range.date}.pdf"`,
          "cache-control": "private, no-store",
        },
      });
    }

    if (key === "GET reports/task-steps") {
      const user = await requireUser(request);
      const report = await getTaskReportData(user, url);
      return csvResponse(
        [
          ["Task", "Step", "Source department", "Receiving department", "Receiving head", "Assignee", "Status", "Due", "Started", "Completed", "Response hours", "Completion hours"],
          ...report.delegatedSteps.map((step) => [
            step.taskId,
            step.title,
            step.sourceDepartment || "",
            step.targetDepartment || "",
            step.targetLead?.name || "",
            step.assignee.name,
            TASK_STEP_STATUS_LABEL[step.status],
            step.dueAt,
            step.startedAt || "",
            step.completedAt || "",
            step.startedAt ? Math.round((new Date(step.startedAt).getTime() - new Date(step.createdAt).getTime()) / 3600000) : "",
            step.startedAt && step.completedAt ? Math.round((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 3600000) : "",
          ]),
        ],
        `interdepartmental-task-steps-${report.range.period}-${report.range.date}.csv`,
      );
    }

    if (method === "POST" && path[0] === "tasks" && path[2] === "start" && path.length === 3) {
      const user = await requireUser(request);
      const row = await requireTask(user, path[1]);
      if (String(row.assignee_id) !== user.id) throw new HttpError(403, "forbidden", "Only the assignee can start this task.");
      if (row.status === "in_progress") return json(await taskDetail(row, user.role === "admin"));
      if (row.status !== "assigned" && row.status !== "changes_requested") {
        return json({ error: { code: "conflict", message: "This task cannot be started." } }, 409);
      }
      await tx(async () => {
        await q(`UPDATE tasks SET status = 'in_progress', started_at = COALESCE(started_at, now()), blocked_at = null, blocked_reason = null, updated_at = now() WHERE id = $1`, [row.id]);
        await recordTaskActivity(String(row.id), user.id, "STARTED", `${user.name} started work.`);
      });
      const next = await requireTask(user, String(row.id));
      await taskNotify(String(row.id), user, "started", `${user.name} started ${row.id}.`);
      return json(await taskDetail(next, user.role === "admin"));
    }

    if (method === "POST" && path[0] === "tasks" && path[2] === "block" && path.length === 3) {
      const user = await requireUser(request);
      const row = await requireTask(user, path[1]);
      if (String(row.assignee_id) !== user.id) throw new HttpError(403, "forbidden", "Only the assignee can block this task.");
      if (row.status !== "assigned" && row.status !== "in_progress" && row.status !== "changes_requested") {
        return json({ error: { code: "conflict", message: "This task cannot be blocked." } }, 409);
      }
      const body = await readJson(request);
      const reason = textField(body.reason, "Reason", 1, 1000);
      await tx(async () => {
        await q(`UPDATE tasks SET status = 'blocked', blocked_at = now(), blocked_reason = $2, updated_at = now() WHERE id = $1`, [row.id, reason]);
        await recordTaskActivity(String(row.id), user.id, "BLOCKED", `${user.name} blocked this task: ${reason}`, { reason });
      });
      const next = await requireTask(user, String(row.id));
      await taskNotify(String(row.id), user, "blocked", `${user.name} blocked ${row.id}: ${reason}`);
      return json(await taskDetail(next, user.role === "admin"));
    }

    if (method === "POST" && path[0] === "tasks" && path[2] === "resume" && path.length === 3) {
      const user = await requireUser(request);
      const row = await requireTask(user, path[1]);
      if (String(row.assignee_id) !== user.id) throw new HttpError(403, "forbidden", "Only the assignee can resume this task.");
      if (row.status !== "blocked") return json({ error: { code: "conflict", message: "Only a blocked task can be resumed." } }, 409);
      await tx(async () => {
        await q(`UPDATE tasks SET status = 'in_progress', blocked_at = null, blocked_reason = null, updated_at = now() WHERE id = $1`, [row.id]);
        await recordTaskActivity(String(row.id), user.id, "RESUMED", `${user.name} resumed work.`);
      });
      const next = await requireTask(user, String(row.id));
      await taskNotify(String(row.id), user, "resumed", `${user.name} resumed ${row.id}.`);
      return json(await taskDetail(next, user.role === "admin"));
    }

    if (method === "POST" && path[0] === "tasks" && path[2] === "submit" && path.length === 3) {
      const user = await requireUser(request);
      const row = await requireTask(user, path[1]);
      if (String(row.assignee_id) !== user.id) throw new HttpError(403, "forbidden", "Only the assignee can submit this task.");
      if (row.status !== "in_progress" && row.status !== "changes_requested") {
        return json({ error: { code: "conflict", message: "This task cannot be submitted." } }, 409);
      }
      const body = await readJson(request);
      const note = body.note ? textField(body.note, "Note", 1, 5000) : null;
      const steps = await taskStepsFor(String(row.id), false);
      if (steps.some((step) => step.required && step.status !== "completed")) {
        throw new HttpError(422, "validation", "Finish every required step before submitting.");
      }
      const assigneeUser = await userById(String(row.assignee_id));
      const selfManaged = String(row.assignee_id) === String(row.assigned_by_id) && assigneeUser?.role === "member";
      const nextStatus: TaskStatus = selfManaged ? "completed" : "in_review";
      await tx(async () => {
        await q(
          `UPDATE tasks SET status = $2, submission_note = $3, submitted_at = now(),
             approved_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END,
             completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END,
             updated_at = now()
           WHERE id = $1`,
          [row.id, nextStatus, note],
        );
        await recordTaskActivity(String(row.id), user.id, selfManaged ? "COMPLETED" : "SUBMITTED", selfManaged ? `${user.name} completed ${row.id}.` : `${user.name} submitted ${row.id} for review.`, { note });
      });
      const next = await requireTask(user, String(row.id));
      await taskNotify(String(row.id), user, selfManaged ? "completed" : "submitted", selfManaged ? `${user.name} completed ${row.id}.` : `${user.name} submitted ${row.id} for review.`);
      return json(await taskDetail(next, user.role === "admin"));
    }

    if (method === "POST" && path[0] === "tasks" && path[2] === "approve" && path.length === 3) {
      const user = await requireUser(request);
      const row = await requireTask(user, path[1]);
      if (!(await canReviewTask(user, row))) throw new HttpError(403, "forbidden", "You cannot review this task.");
      if (row.status !== "in_review") return json({ error: { code: "conflict", message: "Only a task in review can be approved." } }, 409);
      const body = await readJson(request);
      const comment = body.comment ? textField(body.comment, "Comment", 1, 5000) : null;
      await tx(async () => {
        await q(
          `UPDATE tasks SET status = 'completed', review_comment = $2, approved_at = now(), completed_at = now(), updated_at = now() WHERE id = $1`,
          [row.id, comment],
        );
        await recordTaskActivity(String(row.id), user.id, "APPROVED", `${user.name} approved ${row.id}.`, { comment });
      });
      const next = await requireTask(user, String(row.id));
      await taskNotify(String(row.id), user, "approved", `${user.name} approved ${row.id}.`);
      return json(await taskDetail(next, user.role === "admin"));
    }

    if (method === "POST" && path[0] === "tasks" && path[2] === "request-changes" && path.length === 3) {
      const user = await requireUser(request);
      const row = await requireTask(user, path[1]);
      if (!(await canReviewTask(user, row))) throw new HttpError(403, "forbidden", "You cannot review this task.");
      if (row.status !== "in_review") return json({ error: { code: "conflict", message: "Only a task in review can be sent back." } }, 409);
      const body = await readJson(request);
      const comment = textField(body.comment, "Comment", 1, 5000);
      await tx(async () => {
        await q(`UPDATE tasks SET status = 'changes_requested', review_comment = $2, updated_at = now() WHERE id = $1`, [row.id, comment]);
        await recordTaskActivity(String(row.id), user.id, "CHANGES_REQUESTED", `${user.name} requested changes on ${row.id}.`, { comment });
      });
      const next = await requireTask(user, String(row.id));
      await taskNotify(String(row.id), user, "changes_requested", `${user.name} requested changes on ${row.id}.`);
      return json(await taskDetail(next, user.role === "admin"));
    }

    if (method === "POST" && path[0] === "tasks" && path[2] === "cancel" && path.length === 3) {
      const user = await requireUser(request);
      const row = await requireTask(user, path[1]);
      if (!(await canReviewTask(user, row))) throw new HttpError(403, "forbidden", "You cannot cancel this task.");
      if (taskClosed(row.status as TaskStatus)) return json({ error: { code: "conflict", message: "That task is already closed." } }, 409);
      const body = await readJson(request);
      const reason = textField(body.reason, "Reason", 1, 1000);
      await tx(async () => {
        await q(`UPDATE tasks SET status = 'cancelled', cancelled_at = now(), review_comment = $2, updated_at = now() WHERE id = $1`, [row.id, reason]);
        await q(`UPDATE task_steps SET status = 'cancelled', updated_at = now() WHERE task_id = $1 AND status IN ('assigned','in_progress','blocked')`, [row.id]);
        await recordTaskActivity(String(row.id), user.id, "CANCELLED", `${user.name} cancelled ${row.id}.`, { reason });
      });
      const next = await requireTask(user, String(row.id));
      await taskNotify(String(row.id), user, "cancelled", `${user.name} cancelled ${row.id}.`);
      return json(await taskDetail(next, user.role === "admin"));
    }

    if (method === "POST" && path[0] === "tasks" && path[2] === "comments" && path.length === 3) {
      const user = await requireUser(request);
      const row = await requireTask(user, path[1]);
      const body = await readJson(request);
      const note = textField(body.body, "Comment", 1, 5000);
      await tx(async () => {
        await q(`INSERT INTO task_comments (id, task_id, author_id, body) VALUES ($1,$2,$3,$4)`, [randomUUID(), row.id, user.id, note]);
        await recordTaskActivity(String(row.id), user.id, "COMMENTED", `${user.name} added a comment.`);
      });
      await taskNotify(String(row.id), user, "commented", `${user.name} commented on ${row.id}.`);
      return json(await taskDetail(await requireTask(user, String(row.id)), user.role === "admin"), 201);
    }

    if (method === "POST" && path[0] === "tasks" && path[2] === "resources" && path.length === 3) {
      const user = await requireUser(request);
      const row = await requireTask(user, path[1]);
      if (taskClosed(row.status as TaskStatus)) return json({ error: { code: "conflict", message: "That task is closed." } }, 409);
      const form = await request.formData();
      const links = parseTaskLinks(form.get("links"));
      const files = form.getAll("files").filter((item): item is File => item instanceof File);
      if (files.length > 10) return json({ error: { code: "validation", message: "Attach at most 10 files." } }, 422);
      await addTaskLinkResources(String(row.id), user.id, links);
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) return json({ error: { code: "payload_too_large", message: "Files must be 5 MB or smaller." } }, 413);
        const bytes = Buffer.from(await file.arrayBuffer());
        const mediaType = sniff(bytes);
        if (!mediaType) return json({ error: { code: "unsupported", message: "Use a PNG, JPEG, WEBP, or PDF." } }, 415);
        const id = randomUUID();
        const name = file.name.replace(/[/\\]/g, "").slice(0, 180) || "file";
        const storageKey = await storeFile(id, bytes, mediaType, name, uploads);
        await q(
          `INSERT INTO task_resources (id, task_id, uploader_id, type, title, file_name, media_type, size, storage_key)
           VALUES ($1,$2,$3,'file',$4,$5,$6,$7,$8)`,
          [id, row.id, user.id, name, name, mediaType, bytes.length, storageKey],
        );
      }
      if (links.length || files.length) {
        await recordTaskActivity(String(row.id), user.id, "RESOURCE_ADDED", `${user.name} added ${links.length + files.length} resource(s).`);
        await taskNotify(String(row.id), user, "resource_added", `${user.name} added evidence to ${row.id}.`);
      }
      return json(await taskDetail(await requireTask(user, String(row.id)), user.role === "admin"));
    }

    if (method === "GET" && path[0] === "tasks" && path[1] === "resources" && path.length === 3) {
      const user = await requireUser(request);
      const rows = await q(
        `SELECT r.type, r.title, r.file_name, r.media_type, r.storage_key, r.task_id
         FROM task_resources r WHERE r.id = $1`,
        [path[2]],
      );
      const resource = rows[0];
      if (!resource || resource.type !== "file") throw new HttpError(404, "not_found", "That file does not exist.");
      await requireTask(user, String(resource.task_id));
      const stored = await readStoredFile(String(resource.storage_key), uploads);
      if (!stored) throw new HttpError(404, "not_found", "That file does not exist.");
      const name = String(resource.file_name || resource.title).replace(/["\r\n]/g, "");
      const mediaType = String(resource.media_type || stored.mediaType || "application/octet-stream");
      return new Response(new Uint8Array(stored.bytes), {
        headers: {
          "content-type": mediaType,
          "content-disposition": `attachment; filename="${name}"`,
          "cache-control": "private, max-age=300",
        },
      });
    }

    if (method === "POST" && path[0] === "tasks" && path[2] === "steps" && path.length === 3) {
      const user = await requireUser(request);
      if (user.role === "member") throw new HttpError(403, "forbidden", "Only a head or admin can add delegated steps.");
      const row = await requireTask(user, path[1]);
      if (taskClosed(row.status as TaskStatus)) return json({ error: { code: "conflict", message: "That task is closed." } }, 409);
      const body = await readJson(request);
      const raw = body.step !== undefined ? [body.step] : body.steps;
      const steps = await prepareTaskSteps(user, raw, new Date(iso(row.due_at)));
      if (!steps.length) throw new HttpError(422, "validation", "Add at least one step.");
      await tx(async () => {
        await insertTaskSteps(String(row.id), steps);
        await recordTaskActivity(String(row.id), user.id, "STEP_ADDED", `${user.name} added ${steps.length} step(s).`);
      });
      await taskNotify(String(row.id), user, "step_added", `${user.name} added steps to ${row.id}.`);
      return json(await taskDetail(await requireTask(user, String(row.id)), user.role === "admin"));
    }

    if (method === "POST" && path[0] === "task-steps" && path[2] === "start" && path.length === 3) {
      const user = await requireUser(request);
      const step = await requireStep(user, path[1]);
      if (String(step.assignee_id) !== user.id) throw new HttpError(403, "forbidden", "Only the step assignee can start it.");
      if (step.status === "in_progress") return json(await taskDetail(await requireTask(user, String(step.task_id)), user.role === "admin"));
      if (step.status !== "assigned") return json({ error: { code: "conflict", message: "That step cannot be started." } }, 409);
      await tx(async () => {
        await q(`UPDATE task_steps SET status = 'in_progress', started_at = now(), updated_at = now() WHERE id = $1`, [step.id]);
        await recordTaskActivity(String(step.task_id), user.id, "STEP_STARTED", `${user.name} started step “${step.title}”.`);
      });
      await taskNotify(String(step.task_id), user, "step_started", `${user.name} started a delegated step.`);
      return json(await taskDetail(await requireTask(user, String(step.task_id)), user.role === "admin"));
    }

    if (method === "POST" && path[0] === "task-steps" && path[2] === "block" && path.length === 3) {
      const user = await requireUser(request);
      const step = await requireStep(user, path[1]);
      if (String(step.assignee_id) !== user.id) throw new HttpError(403, "forbidden", "Only the step assignee can block it.");
      if (step.status !== "assigned" && step.status !== "in_progress") return json({ error: { code: "conflict", message: "That step cannot be blocked." } }, 409);
      const body = await readJson(request);
      const reason = textField(body.reason, "Reason", 1, 1000);
      await tx(async () => {
        await q(`UPDATE task_steps SET status = 'blocked', blocked_at = now(), blocked_reason = $2, updated_at = now() WHERE id = $1`, [step.id, reason]);
        await recordTaskActivity(String(step.task_id), user.id, "STEP_BLOCKED", `${user.name} blocked step “${step.title}”: ${reason}`, { reason });
      });
      await taskNotify(String(step.task_id), user, "step_blocked", `${user.name} blocked a delegated step.`);
      return json(await taskDetail(await requireTask(user, String(step.task_id)), user.role === "admin"));
    }

    if (method === "POST" && path[0] === "task-steps" && path[2] === "resume" && path.length === 3) {
      const user = await requireUser(request);
      const step = await requireStep(user, path[1]);
      if (String(step.assignee_id) !== user.id) throw new HttpError(403, "forbidden", "Only the step assignee can resume it.");
      if (step.status !== "blocked") return json({ error: { code: "conflict", message: "Only a blocked step can be resumed." } }, 409);
      await tx(async () => {
        await q(`UPDATE task_steps SET status = 'in_progress', blocked_at = null, blocked_reason = null, updated_at = now() WHERE id = $1`, [step.id]);
        await recordTaskActivity(String(step.task_id), user.id, "STEP_RESUMED", `${user.name} resumed step “${step.title}”.`);
      });
      await taskNotify(String(step.task_id), user, "step_resumed", `${user.name} resumed a delegated step.`);
      return json(await taskDetail(await requireTask(user, String(step.task_id)), user.role === "admin"));
    }

    if (method === "POST" && path[0] === "task-steps" && path[2] === "complete" && path.length === 3) {
      const user = await requireUser(request);
      const step = await requireStep(user, path[1]);
      if (String(step.assignee_id) !== user.id) throw new HttpError(403, "forbidden", "Only the step assignee can complete it.");
      if (step.status !== "in_progress") return json({ error: { code: "conflict", message: "Start the step before completing it." } }, 409);
      const body = await readJson(request);
      const note = body.note ? textField(body.note, "Note", 1, 5000) : null;
      await tx(async () => {
        await q(`UPDATE task_steps SET status = 'completed', completed_at = now(), completion_note = $2, updated_at = now() WHERE id = $1`, [step.id, note]);
        await recordTaskActivity(String(step.task_id), user.id, "STEP_COMPLETED", `${user.name} completed step “${step.title}”.`, { note });
      });
      await taskNotify(String(step.task_id), user, "step_completed", `${user.name} completed a delegated step.`);
      return json(await taskDetail(await requireTask(user, String(step.task_id)), user.role === "admin"));
    }

    if (method === "POST" && path[0] === "task-steps" && path[2] === "reassign" && path.length === 3) {
      const user = await requireUser(request);
      const step = await requireStep(user, path[1]);
      const allowed = user.role === "admin" || step.assigned_by_id === user.id || step.target_lead_id === user.id;
      if (!allowed) throw new HttpError(403, "forbidden", "You cannot reassign this step.");
      if (step.status === "completed" || step.status === "cancelled") return json({ error: { code: "conflict", message: "That step is closed." } }, 409);
      const body = await readJson(request);
      const assignee = await canAssignStepTo(user, String(body.assigneeId || ""));
      const targetDepartment = step.target_department ? String(step.target_department) : null;
      if (targetDepartment && assignee.departmentSlug !== targetDepartment) {
        throw new HttpError(422, "validation", "The replacement must belong to the receiving department.", { assigneeId: "The replacement must belong to the receiving department." });
      }
      await tx(async () => {
        await q(
          `UPDATE task_steps SET assignee_id = $2, target_department = $3, status = 'assigned',
             started_at = null, blocked_at = null, blocked_reason = null, completed_at = null,
             completion_note = null, updated_at = now() WHERE id = $1`,
          [step.id, assignee.id, targetDepartment ?? assignee.departmentSlug],
        );
        await recordTaskActivity(String(step.task_id), user.id, "STEP_REASSIGNED", `${user.name} reassigned step “${step.title}” to ${assignee.name}.`, { assigneeId: assignee.id });
      });
      await taskNotify(String(step.task_id), user, "step_reassigned", `${user.name} reassigned a delegated step.`);
      return json(await taskDetail(await requireTask(user, String(step.task_id)), user.role === "admin"));
    }

    return json({ error: { code: "not_found", message: "That route does not exist." } }, 404);
  } catch (error) {
    if (error instanceof HttpError) return fail(error);
    console.error(error);
    return json({ error: { code: "error", message: "Something went wrong. Try again." } }, 500);
  }
}

async function mapOutreach(row: Record<string, unknown>) {
  const receiptRows = await q(`SELECT * FROM receipts WHERE outreach_id = $1 ORDER BY created_at DESC LIMIT 1`, [row.id]);
  return {
    id: String(row.id),
    departmentSlug: String(row.department_slug),
    note: String(row.note),
    unresolvedCount: Number(row.unresolved_count),
    ticketIds: asList(row.ticket_ids),
    createdAt: iso(row.created_at),
    actor: personFromAliases(row, "actor", true),
    receipt: receiptRows[0] ? mapReceipt(receiptRows[0]) : null,
  };
}
