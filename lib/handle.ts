import { createHmac, randomUUID } from "node:crypto";
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
import { q, tx } from "./db";
import { STATUS_LABEL, isPriority, isRole, isStatus, type DepartmentSlug, type Priority, type Status } from "./labels";
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
    author: personFromAliases(row, "author", includeEmail),
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
  const body: Record<string, unknown> = {
    inbox: Number(inbox[0]?.n ?? 0),
    queue: Number(queue[0]?.n ?? 0),
    alerts: Number(alerts[0]?.n ?? 0),
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
  departmentSlug?: string | null;
  ticketEvent: Record<string, unknown> | null;
}) {
  const at = new Date().toISOString();
  const actor = person(options.actor, false);
  for (const userId of options.recipients) {
    const id = randomUUID();
    await q(
      `INSERT INTO notifications (id, user_id, type, ticket_id, department_slug, sentence, sound, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, userId, options.type, options.ticketId, options.departmentSlug ?? null, options.sentence, options.sound, options.actor.id],
    );
    publish([userId], {
      type: "notification.created",
      notificationId: id,
      notificationType: options.type,
      ticketId: options.ticketId,
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
  void deliver(payload)
    .then((providerMessageId) => q(`UPDATE receipts SET state = 'sent', provider_message_id = $2 WHERE id = $1`, [receiptId, providerMessageId]))
    .catch((error: unknown) => {
      console.error(error);
      return q(`UPDATE receipts SET state = 'failed' WHERE id = $1`, [receiptId]);
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

export async function handle(method: string, path: string[], request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const key = `${method} ${path.join("/")}`;

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
      await q(
        `UPDATE tickets SET status = $2, priority = $3, assignee_id = $4, updated_at = now() WHERE id = $1`,
        [row.id, status, priority, assigneeId],
      );
      const next = await ticketRow(String(row.id));
      if (!next) throw new HttpError(404, "not_found", "That ticket does not exist.");
      const assignedChanged = String(row.assignee_id ?? "") !== String(assigneeId ?? "");
      const statusChanged = row.status !== status;
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
