# Desk API

Human guide to the routes in [openapi.yaml](openapi.yaml). If a field disagrees with the YAML, the YAML wins and this page should be corrected.

Base path: `/api/v1`. The browser sends the `desk_session` cookie. Bodies are JSON unless a route says otherwise. Times are ISO-8601 in UTC. Ticket paths use the human id, `VC-1042`, and task paths use `TSK-1001`. User ids are UUIDs.

Errors share one shape:

```json
{ "error": { "code": "validation", "message": "Title is required.", "fields": { "title": "Title is required." } } }
```

`fields` is only present for `validation`. A missing ticket and a ticket the caller may not see both return `not_found`, so existence is not leaked.

## Auth

`POST /auth/login` with `email` and `password`. On success, sets `desk_session` (HttpOnly, Secure, SameSite=Lax) and returns the [current person](#current-person). A wrong password and a disabled account both return 401, `unauthorized`, “Email or password is wrong.” Too many tries return 429 with `Retry-After`.

`POST /auth/logout` revokes the session and clears the cookie. 204.

`GET /me` returns the signed-in person:

| Field | Meaning |
| --- | --- |
| `id`, `email`, `name` | The account |
| `role` | `member`, `lead`, or `admin` |
| `departmentSlug` | Home department |
| `watches` | Extra department slugs this person follows |
| `active` | Always `true` here. A disabled person cannot sign in |

## Auth SSO

`GET /auth/sso/start?door=staff|admin` starts sign-in with an existing vcglone account. Desk redirects to vcglone, checks the short-lived signed assertion, creates or syncs the Desk account, and sets the same `desk_session` cookie as password login. vcglone roles and departments map to Desk roles and queues; setup and the mapping are in [sso.md](sso.md). Password login stays enabled, and the door is still enforced: `/admin` requires an admin.

## Departments

`GET /departments` returns the nine departments in seed order. Each item is `{ slug, name, recipients }`. `recipients` are the people copied on that department’s queue mail.

`GET /departments/{slug}` is the same object for one slug. Unknown slug is 404.

Slugs: `it-software`, `business-operations`, `hr-admin`, `account-finance`, `sales`, `business-development`, `exhibition`, `creative-marketing`, `logistic-warehouse`.

## People

`GET /people` is the directory. Optional `department` slug and `limit` (default 100, max 200). Each person is `{ id, name, role, departmentSlug, active }`. Admins also receive `email`.

`POST /people` is admin only. Body: `name`, `email`, `password` (at least 10 characters), `role`, `departmentSlug`, optional `queueRecipient`, optional `watches`. Returns 201 and the person, including email. A duplicate email is 409.

`PATCH /people/{id}` is admin only. Any of those fields, plus `active`. Omitted fields stay. Setting `watches` replaces the list. Setting `queueRecipient` updates membership for the person’s home department.

## Tickets

### List

`GET /tickets`

| Query | Meaning |
| --- | --- |
| `scope` | `mine` (default), `queue`, `watching`, or `all` |
| `status` | One of `open`, `in_progress`, `waiting`, `resolved`, `closed` |
| `department` | Limit to this target department |
| `cursor` | From the previous page |
| `limit` | Default 30, max 100 |

`mine` is tickets you raised, are assigned, or watch as a person. `queue` is tickets aimed at your home department. `watching` is tickets aimed at a department in your `watches`, excluding anything already in `mine`. `all` is every ticket. Only an admin may use `all`. Anyone else gets 403.

A member may pass `department` only for their home department or one they watch. An admin may pass any slug. Anyone else gets 403.

`status` still accepts one value. The monitor’s Pending list is two statuses, so admins load it with `GET /admin/tickets?bucket=pending` rather than this route.

The page is `{ items, nextCursor }`, newest activity first. `nextCursor` is null on the last page. A list item has id, title, status, priority, requester, source and target departments, assignee (or null), `createdAt`, and `updatedAt`. It does not include the thread.

### Raise

`POST /tickets` with `title` (1–120), `body` (1–8000), `targetDepartment`, and optional `priority` (`low`, `normal`, `high`, `urgent`; default `normal`).

The server sets the requester and copies their home department onto the ticket as `sourceDepartment`. It creates the first message from `body`, records a `created` stage event, writes notifications and a receipt for the target queue, and returns 201 with the ticket detail. The author is not notified.

### Read and update

`GET /tickets/{id}` returns the list fields plus `messages`, `watchers`, and `events`. Each event has `id`, `type` (`created`, `assigned`, `unassigned`, `started`, `waiting`, `resolved`, `reopened`, `closed`, `opened`), `fromStatus`, `toStatus`, `actor`, and `createdAt`. Readable by the requester, the assignee, a watcher, a member of either department on the ticket, or an admin. Otherwise 404.

`PATCH /tickets/{id}` changes `status`, `priority`, or `assigneeId`. At least one is required. Caller is a lead of the target department, or an admin.

- The assignee must be an active member of the target department. `null` clears them and does not change status.
- Assigning someone while the ticket is `open` also sets `in_progress`.
- `closed` is allowed only from `resolved`. Anything else is 409.
- This route does not reopen a ticket. A reply does.

### Receiver actions

`POST /tickets/{id}/begin` with no body. Available to any member of the target department, or an admin. An unassigned ticket is claimed by the caller; an assigned ticket may only be started by its assignee or a lead/admin. Allowed from `open` or `waiting`; sets `in_progress`, assigns the caller when unassigned, records `assigned` and `started` events, and notifies the thread.

`POST /tickets/{id}/complete` with no body. Available to the assignee, a lead of the target department, or an admin. Allowed while the ticket is `open`, `in_progress`, or `waiting`; sets `resolved`, records a `resolved` event, and notifies the thread. It is idempotent on an already resolved ticket. The requester can still reply to reopen it; only a lead/admin can close it.

### Reply

`POST /tickets/{id}/messages` with `{ "body": "..." }`. Allowed for the requester, assignee, watchers, members of the target department, and admins. 409 if the ticket is `closed`. A reply on a `resolved` ticket sets it back to `open`. Returns the message, with `attachments: []` until files are added.

### Watchers

`POST /tickets/{id}/watchers` with `{ "userId": "..." }`. A lead of the target department, an admin, or the requester adding themselves. Returns `{ watchers }`.

`DELETE /tickets/{id}/watchers/{userId}` removes one. The requester may remove only themselves. 204.

### Files

`POST /tickets/{id}/attachments` is `multipart/form-data` with `file` and `messageId`. The caller must have written that message, and the ticket must not be closed. PNG, JPEG, WEBP, or PDF, sniffed from the bytes, up to 10 MB, up to 5 files on that message. 413 over size, 415 for a bad type, 409 when closed or over the count. Returns `{ id, messageId, name, mediaType, size }`.

`GET /attachments/{id}` streams the bytes. Same read rule as the ticket. Images are `Content-Disposition: inline`. PDFs are `attachment`.

## Tasks

Tasks are assigned work with a human id `TSK-1001`, `TSK-1002`, and so on, from a Postgres sequence that never resets. Task paths use that id. The detail adds steps, evidence, comments and activity to the task fields below.

### List

`GET /tasks`

| Query | Meaning |
| --- | --- |
| `scope` | `mine` (default), `team`, or `organization` |
| `status` | `assigned`, `in_progress`, `blocked`, `in_review`, `changes_requested`, `completed`, `cancelled`, or `overdue` |
| `priority` | `low`, `medium`, `high`, `urgent` |
| `department` | The assignee’s home department or a step’s receiving department |
| `q` | Task name, description or id; step title or assignee name; task assignee name |
| `cursor` | From the previous page |
| `limit` | Default 30, max 100 |

`mine` is work assigned to you, assigned by you, or handed to you as a step assignee. `team` is work in your home department, delegated by you, or handed to you as a receiving head; only a lead or admin may use it. `organization` is every task; only an admin may use it. A non-admin may pass `department` only for their home department. `overdue` means an active task past its due time.

The page is `{ items, nextCursor }`, newest activity first. An item has id, name, assignee, assignedBy, priority, status, `startAt`, `dueAt`, `reminderOffsets`, the stage timestamps, `createdAt`, `updatedAt`, and an `overdue` flag. It does not include steps or the thread.

### Create

`POST /tasks` takes `name` (3–160), `description` (5–10000), `assigneeId` and `dueAt`, plus optional `expectedOutcome` (1–5000), `startAt`, `priority` (`low`, `medium`, `high`, `urgent`; default `medium`), `reminderOffsets`, `resourceLinks` and `steps`. `dueAt` must be at least 15 minutes from now. `reminderOffsets` are minutes before due: at most 6 values from 0 to 43200, default `[1440, 120, 0]`. Links must be complete http or https addresses.

The assignee must be active and not an admin. Members may assign only themselves and cannot add steps. Leads may assign inside their department. Admins may assign anyone who is not an admin. A step needs a title, assignee and due time no later than the task’s; its assignee must be active and not an admin, and when a receiving department is set the assignee must belong to it and an optional receiving head must be an active lead there. At most 30 steps. Returns 201 with the task detail.

### Read and update

`GET /tasks/{id}` returns the task plus `steps`, `resources`, `comments` and `activities`. Readable by an admin, the assignee, the assigner, step assignees and receiving heads, and leads of a step assignee’s or the task assignee’s department. Otherwise 404.

`PATCH /tasks/{id}` is reviewer-only and takes `assigneeId`, `priority`, or `dueAt`; at least one is required. Changing the assignee or due time also needs a `reason`. A closed task returns 409.

### Actions

Every action is `POST /tasks/{id}/{action}` and returns the task detail.

| Action | Who | Rule |
| --- | --- | --- |
| `start` | Assignee | From `assigned` or `changes_requested`. Idempotent on `in_progress`, and the original `startedAt` is preserved when work restarts |
| `block` | Assignee | From `assigned`, `in_progress` or `changes_requested`. Body `reason` (1–1000) required |
| `resume` | Assignee | From `blocked`, back to `in_progress` |
| `submit` | Assignee | From `in_progress` or `changes_requested`. Every required step must be completed. Optional `note`. A member’s self-assigned task goes to `completed`; a lead’s or admin’s self-assignment goes to `in_review` |
| `approve` | Reviewer | From `in_review` to `completed`. Optional `comment` |
| `request-changes` | Reviewer | From `in_review` to `changes_requested`. `comment` (1–5000) required |
| `cancel` | Reviewer | Any non-closed task. `reason` (1–1000) required; stored as `reviewComment`, and open steps are cancelled |
| `comments` | Anyone who can read the task | Body `body` (1–5000). Returns 201 |

A reviewer is an admin, the lead who assigned the task, or the head of the assignee’s department. `completed` is resolved-like completion: tasks do not reopen the way a ticket does.

### Steps and evidence

`POST /tasks/{id}/steps` adds steps (lead or admin only, not on a closed task). `POST /task-steps/{id}/start`, `/block`, `/resume` and `/complete` are for the step assignee: start from `assigned` (idempotent on `in_progress`), block from `assigned` or `in_progress` with a `reason`, resume from `blocked`, complete from `in_progress` with an optional `note`. `POST /task-steps/{id}/reassign` is for the assigning head, the receiving head or an admin. The replacement must be active, not an admin, and in the receiving department when one is set; reassignment resets the step to `assigned` and clears its start, block and completion times. Step routes return the parent task detail.

`POST /tasks/{id}/resources` is `multipart/form-data` with `links` and repeated `files`. Files are PNG, JPEG, WEBP or PDF, sniffed from the bytes, up to 5 MB each and at most 10 per request. 413 over size, 415 for a bad type, 422 over the file count or for a bad link. A closed task refuses resources. `GET /tasks/{id}/resources/{resourceId}` streams a file only to someone who can read the task; files are stored by `storage_key`, not as bytes in Postgres.

## Task reports

`GET /reports/tasks/data` returns the report JSON. The CSV, PDF and handoffs routes below take the same query params.

| Query | Meaning |
| --- | --- |
| `scope` | `mine` (default), `team`, or `organization` (admin only) |
| `period` | `daily` (default), `weekly`, or `monthly` |
| `date` | `YYYY-MM-DD`, default today. Boundaries use Africa/Lagos: a day starts at 00:00+01:00, a week starts Monday, a month is the calendar month |
| `employeeId` | Filter to one assignee; ignored for members |
| `departmentId` | Filter to the assignee’s department; ignored for members |

A task is in the view when it was created, came due, or was completed in the range, or is still open. The JSON carries `range`, `scope`, `metrics`, `trend`, `statusData`, `people`, `departments`, `tasks`, `delegatedSteps` and `delegationMetrics`. `metrics` has `total`, `assigned` (created in range), `due`, `completed`, `completedOnTime`, `overdue`, `active`, `blocked`, `completionRate` (completed due work / due work), `onTimeRate` and `averageCompletionHours`. `delegationMetrics` has `total`, `interdepartmental`, `active`, `blocked`, `overdue`, `completed`, `completionRate`, `onTimeRate`, `averageResponseHours`, `averageCompletionHours` (also exposed as `averageHours`) and the counts behind the handoff table.

The step half uses step-level scope: `mine` is the step assignee, `team` is the step assigner, receiving head or assignee department, and `organization` is admin. Its `departmentId` matches the step’s receiving department.

| Export | Route |
| --- | --- |
| Task CSV | `GET /reports/tasks` |
| Task PDF | `GET /reports/tasks/pdf` |
| Handoffs CSV | `GET /reports/task-steps` |

All three return an attachment named for the period and date.

## Notifications

`GET /notifications` returns the caller’s rows, newest first. `unread=true` filters. Page shape matches tickets: `{ items, nextCursor }`.

Each item: `id`, `type` (`ticket.raised`, `ticket.replied`, `ticket.assigned`, `ticket.status_changed`, `department.outreach`, or a `task.*` type such as `task.created`, `task.started`, `task.submitted`, `task.completed`, `task.step_completed` or `task.reminder`), `ticketId` (null for an outreach or a task alert), `taskId` (set for a task alert), `departmentSlug` (set for an outreach), `sentence`, `sound` (`raise`, `reply`, or `status`; task alerts use `status`), `read`, `createdAt`, `actor`. Task socket frames also carry `ticketEvent` with `type`, `taskId` and `action`. See [realtime.md](realtime.md).

`POST /notifications/read` with `{ "ids": ["..."] }` marks those rows. An empty body, or `"ids": []`, marks all of the caller’s unread rows. 204. Ids that are not theirs are ignored.

Live copies of these rows arrive on the socket. See [realtime.md](realtime.md).

## Task reminders

`GET /notifications/status` delivers any reminders already due for the signed-in person and returns `{ ok, due, delivered, at }`. `due` counts active tasks assigned to or delegated by that person that are past due; `delivered` is the number of new reminders this call sent.

`POST /tasks/reminders/run` is admin only. It delivers every due reminder and returns `{ ok, delivered, at }`. No long-lived scheduler runs in the app: use this route from cron or a manual trigger, especially on a serverless host. The task reports screen calls the status route when it loads.

Reminders cover a scheduled `startAt` (`START`), the latest eligible due offset (`DUE` or `DUE_<minutes>`), an overdue notice keyed by Africa/Lagos day, and a manager overdue notice for leads and admins who delegated work. `task_reminder_deliveries` is unique on `(task_id, user_id, kind, scheduled_for)`; the notification and its idempotency row are written in one transaction, so repeated calls do not double-send.

## Badges

`GET /badges` returns the counts painted on every section for the signed-in person.

| Field | Meaning |
| --- | --- |
| `inbox` | Unresolved tickets in `scope=mine` |
| `queue` | Unresolved tickets aimed at the caller’s home department |
| `alerts` | Unread notifications |
| `tasks` | Active tasks assigned to the caller, plus tasks they delegated that are in review |
| `monitor` | Present only for admins. `{ raised, pending, resolved, closed }` |

Unresolved is `open`, `in_progress`, or `waiting`. A zero value is returned as `0`. The client hides the badge. The same object arrives on the socket as `badges.updated`.

## Admin monitor

These routes require `role=admin`. Everyone else gets 403.

`GET /admin/summary` is the monitor home. `raised`, `pending`, `resolved`, and `closed` are company-wide counts. `departments` is the nine departments, each with `slug`, `name`, `raised`, `pending`, `resolved`, `closed`, and `unresolved`.

`GET /admin/tickets` lists tickets for one monitor section. Query `bucket` is required: `raised`, `pending`, `resolved`, or `closed`. Optional `department` limits the target department. `cursor` and `limit` match `GET /tickets`. The page shape matches too.

| Bucket | Statuses |
| --- | --- |
| `raised` | `open` |
| `pending` | `in_progress`, `waiting` |
| `resolved` | `resolved` |
| `closed` | `closed` |

`POST /admin/outreach` with `departmentSlug` and `note` (1–2,000 characters). The department must have at least one unresolved ticket, or the route returns 409. On 201 it returns the outreach: `id`, `departmentSlug`, `note`, `unresolvedCount`, `ticketIds`, `createdAt`, the admin as `actor`, and the `receipt`. It notifies that department’s queue recipients, sends the receipt email, and does not open a ticket.

`GET /admin/outreach` lists those records, newest first. Optional `department` slug. Page shape `{ items, nextCursor }`.

## Receipts

`GET /tickets/{id}/receipts` returns `{ items }`, oldest first. Same read rule as the ticket.

Each receipt: `id`, `ticketId`, `event`, `providerMessageId` (null until the provider accepts it), `to`, `cc`, `state` (`queued`, `sent`, `failed`), `createdAt`.

`to` is the requester and the assignee, if they were not the actor. `cc` is queue recipients and watchers. Addresses are deduped. `sent` means the provider took the message. It does not mean someone opened it. The UI must not say “delivered” for `queued`.

## Email webhook

`POST /webhooks/email` does not use the session. The mail adapter verifies the provider’s own signature, then calls this route with `X-Desk-Signature` set to the hex HMAC-SHA256 of the raw body, keyed with the webhook secret.

Body: `{ "providerMessageId": "...", "state": "sent" }` or `"failed"` with an optional `reason`. A known receipt updates. An unknown id still returns 204, so retries stop. A bad signature is 401.

## Inbound email

`POST /inbound/email` is off. It returns 501:

```json
{ "error": { "code": "inbound_disabled", "message": "Reply by email is not switched on. Open the ticket in Desk." } }
```

It does not parse the body and it does not write a message. The YAML still describes `InboundEmail` (`token`, `from`, `text`, `messageId`, `inReplyTo`, `subject`) so the switch later does not invent a new shape. Rules for that day are in [email.md](email.md).
