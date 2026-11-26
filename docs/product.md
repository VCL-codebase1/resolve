# Desk product

Desk is the internal ticket desk for VethanCon staff. A person in one department raises a ticket to another department, the thread stays in one place, and everyone who should know gets a live notification and an email receipt.

This document is the behavior. Routes and payloads are in [api.md](api.md) and [openapi.yaml](openapi.yaml). Visual rules are in [design-system.md](design-system.md).

## Departments

The queues are fixed. Slugs are stable and used in the API.

| Name | Slug |
| --- | --- |
| IT / Software | `it-software` |
| Business Operations | `business-operations` |
| HR / Admin | `hr-admin` |
| Account / Finance | `account-finance` |
| Sales | `sales` |
| Business Development | `business-development` |
| Exhibition | `exhibition` |
| Creative Marketing / Customer Service | `creative-marketing` |
| Logistic / Warehouse | `logistic-warehouse` |

Each department has a name, a slug, and a list of people who receive the department copy of a receipt. That list is the department leads plus anyone marked as a queue recipient. It is not the entire department unless an admin sets it that way.

A person has one home department. They may also watch other departments. Watching adds that department’s new tickets to their alerts. It does not let them assign or close those tickets unless they are a lead or an admin.

## People and roles

| Role | Can |
| --- | --- |
| `member` | Raise a ticket, reply on tickets they raised, were assigned, or watch, read their home queue, begin or complete tickets aimed at their home department, and create tasks assigned only to themselves |
| `lead` | Everything a member can, plus assign, change any status, close, and manage watchers on tickets aimed at their home department; assign tasks and steps, review their tasks and see team reports within it |
| `admin` | Everything a lead can, in every department, plus the monitor, create people, edit department receipt lists, reach out to a department about unresolved tickets, assign any non-admin to a task, review or cancel any task, and run all reminders |

Signing in uses a work email and a password, or the **Sign in with vcglone** button. Both create the same Desk session. There is no public sign-up: an admin creates password accounts, and a first vcglone sign-in creates the account and syncs its role and department ([sso.md](sso.md)). Google and Microsoft sign-in are not offered.

A person can be active or disabled. A disabled person cannot sign in. Their name stays on old tickets.

## Ticket

A ticket is one request from a person to a department.

| Field | Rule |
| --- | --- |
| Id | Human id `VC-` plus a number, starting at `VC-1001`. The number never resets |
| Title | Required. One line, 120 characters |
| Body | Required. The first note. Plain text, paragraphs allowed, 8,000 characters |
| Requester | The signed-in person. Cannot be changed |
| Source department | The requester’s home department at the time of creation. Stored on the ticket so a later move does not rewrite history |
| Target department | Required. May be the same as the source department |
| Assignee | Empty until a lead or admin in the target department assigns someone in that department |
| Priority | `low`, `normal`, `high`, `urgent`. Default `normal` |
| Status | `open`, `in_progress`, `waiting`, `resolved`, `closed` |
| Watchers | People following the thread beyond the requester and assignee |

Status meaning:

- **Open.** Raised, not picked up.
- **In progress.** Someone in the target department is on it. A receiver clicks **Begin work**, which claims an unassigned ticket and assigns it to them, then moves it here. Assigning someone also sets the status to `in_progress` if it was `open`.
- **Waiting.** The target department needs something from the requester or from a third person. The thread should say what.
- **Resolved / completed.** The receiver clicks **Mark completed**. The requester can still reply. A reply sets it back to `open`.
- **Closed.** Finished and locked. No new replies. Only a lead or admin can close, and only from `resolved`. Closing is not a delete. Nothing is deleted.

Priority can change until the ticket is closed. The requester can set it at creation. After that, a lead or admin in the target department changes it.

## Who can do what

| Action | Who |
| --- | --- |
| Create | Any active person |
| Read | Requester, assignee, watchers, members of the source or target department, admins |
| Reply | Requester, assignee, watchers, members of the target department, admins. Not after `closed` |
| Begin work (claim and in progress) | Any member of the target department, or admin |
| Mark completed (resolve) | The assignee, a lead of the target department, or admin |
| Assign, other status changes, priority, close | Lead of the target department, or admin |
| Add or remove a watcher | Those same leads and admins, and the requester for themselves |
| Close | Lead of the target department, or admin, from `resolved` only |
| Monitor every ticket | Admin |
| Reach out to a department | Admin, and only when that department has unresolved tickets |

Members of the source department can read a ticket their department raised. They reply only if they are the requester, a watcher, or an admin.

Unresolved means `open`, `in_progress`, or `waiting`. Resolved and closed tickets are not unresolved.

## Tasks

A task is one piece of assigned work. Unlike a ticket, it starts with an assignee rather than a request to a department.

| Field | Rule |
| --- | --- |
| Id | Human id `TSK-` plus a number, starting at `TSK-1001`. The sequence never resets |
| Name | Required, 3–160 characters |
| Description | Required, 5–10000 characters |
| Expected outcome | Optional, 1–5000 characters |
| Assignee | The person doing the work. Members may assign only themselves, leads within their department, admins anyone who is not an admin |
| Assigned by | The person who created the task |
| Priority | `low`, `medium`, `high`, `urgent`. Default `medium` |
| Status | `assigned`, `in_progress`, `blocked`, `in_review`, `changes_requested`, `completed`, `cancelled` |
| Start at | Optional scheduled start |
| Due at | Required, at least 15 minutes in the future |
| Reminder offsets | Minutes before due: at most 6 values from 0 to 43200, default `[1440, 120, 0]` |
| Evidence | Links and files attached to the task |
| Steps | Optional delegated steps |

A step has a title, assignee, due time and required flag, and may name a receiving department and head. Step statuses are `assigned`, `in_progress`, `blocked`, `completed`, `cancelled`. Step assignees must be active non-admins; when a receiving department is set, the assignee must belong to it. A lead or admin may reassign a step to someone who passes the same rule, and the step goes back to `assigned`.

Status meaning:

- **Assigned.** The task has an owner and has not started.
- **In progress.** The assignee started it. `start` also works from `changes_requested` and keeps the original start time.
- **Blocked.** The assignee recorded a reason. `resume` returns it to in progress.
- **In review.** Submitted work waiting for a reviewer. A member who self-assigned completes directly; a lead or admin who self-assigned goes here.
- **Changes requested.** A reviewer sent the work back with a comment; the assignee can start again and resubmit.
- **Completed.** Resolved-like completion. Tasks do not reopen like tickets.
- **Cancelled.** A reviewer stopped the task, stored the reason as the review comment, and cancelled open steps.

Reviewers are admins, the lead who assigned the task, and the head of the assignee’s department. They approve, request changes, cancel, and change the assignee, priority or due time. Only the assignee starts, blocks, resumes and submits, and submission requires every required step to be completed.

Evidence is links plus PNG, JPEG, WEBP or PDF files up to 5 MB each, 10 files at most, served from a private download route. The task detail also holds comments and an activity timeline. Files are stored by key, not as bytes in Postgres.

Task reports filter by scope (mine, team, organization), period (daily, weekly, monthly), date, person and department, with Africa/Lagos day and week (Monday) and calendar-month boundaries. They count assigned, due, completed, on-time, overdue, active and blocked work, completion and on-time rates, and average completion hours, plus interdepartmental handoff counts, response hours and completion hours. CSV, PDF and handoffs CSV exports use the same filters. Reminders are delivered idempotently for scheduled starts, due offsets, overdue days and managers who delegated: signed-in people get theirs from `GET /notifications/status`, and an admin triggers all of them with `POST /tasks/reminders/run` for cron or manual use.

## Screens

The design system defines how they look. This is what they contain. Every section shows a count badge. The number is the work still sitting in that section, not a decoration.

**Inbox.** Tickets you raised, tickets assigned to you, and tickets you watch, newest activity first. Filter by status. This is the home screen for members and leads. Badge: unresolved tickets in this list.

**Queue.** The work aimed at your home department. Leads live here. Members can read it. A department you only watch does not appear as a queue. It appears in Alerts. Badge: unresolved tickets in the queue.

**Ticket.** Title, meta line, status, priority, assignee, a stage-by-stage progress timeline, the thread, the reply field, and the receipt list for this ticket. The timeline shows who raised, claimed, started, completed, reopened or closed it, with times. Attachments sit under the note they belong to.

**Tasks.** Assigned work, newest activity first. Scope (assigned to me, my department, everyone for admins), status and priority filters sit alongside a department filter for leads and admins, and search by name, number or person. The badge counts active tasks needing you. **New task** opens a composer with the task fields, reminder offsets, links and, for leads and admins, delegated steps. Tasks is in the sidebar on desktop and in the bottom bar on a phone.

**Task detail.** The task fields and stage times, action buttons for the assignee and reviewers, delegated steps with their own actions, evidence links and files, comments, and the activity timeline.

**Task reports.** Filters for scope, period, date, person and department. Cards show assigned, due, completed, on-time, overdue, active, completion rate and average hours; tables cover status, the created/completed trend, people, departments, task details and interdepartmental handoffs. CSV, PDF and handoffs CSV export the same view. Admins also see due/delivered reminder counts and **Run delivery**. The reports page calls the reminder status route when it loads.

**Alerts.** Notifications for this person, newest first. Each row opens the ticket, or the queue when the row is an admin outreach. Marking the screen as read clears the Alerts badge. It does not delete the rows. Badge: unread notifications.

**Composer.** A sheet, not a separate product. Fields: title, target department, priority, note, optional files. Submit creates the ticket, plays nothing for the author, and opens the new ticket.

**Monitor.** Admins only. Hidden from members and leads. A list, not a chart.

| Section | What it lists | Badge |
| --- | --- | --- |
| Raised | Status `open` | Count of those tickets |
| Pending | Status `in_progress` or `waiting` | Count of those tickets |
| Resolved | Status `resolved` | Count of those tickets |
| Closed | Status `closed` | Count of those tickets |
| Each department | That department as the target, unresolved first | Unresolved count |

Opening a section shows the tickets, newest activity first, then the same thread used everywhere else. An admin can assign, reply, and change status from that thread, under the same rules as a lead.

The ticket monitor stays a list. Task reports are where the charts and cross-department task analytics live.

## Reaching a department

From a department row in the monitor, an admin can reach out when the unresolved count is above zero. The control is absent when the count is zero.

The admin writes a short note. Desk sends it to that department’s queue recipients:

- An alert: “{Admin} asked {Department} about {n} unresolved tickets.”
- The same email template as a ticket receipt. The note is the admin’s text. The link opens that department’s queue.
- A receipt on the outreach record, with the same `queued` / `sent` / `failed` states.

The outreach does not create a ticket and does not change any status. It stores the admin, the department, the note, the unresolved count, and the ticket ids that were unresolved at that moment. The list of ids does not change if someone resolves a ticket later.

A department can be contacted again. The history is on the department row, newest first.

## Notifications

An event creates one notification per recipient. Recipients are the requester, the assignee, the watchers, and the target department’s queue recipients, excluding the actor.

| Event | Sound key | Sentence shape |
| --- | --- | --- |
| Ticket raised | `raise` | “{Name} in {Source} raised {id} to {Target}.” |
| Reply | `reply` | “{Name} replied on {id}.” |
| Assigned | `status` | “{Name} assigned {id} to {Assignee}.” |
| Status changed | `status` | “{Name} marked {id} {status}.” |
| Admin outreach | `status` | “{Admin} asked {Department} about {n} unresolved tickets.” |
| Task created or updated | `status` | “{Name} created {taskId}.” / “{Name} updated {taskId}.” |
| Task started, blocked, resumed, submitted or cancelled | `status` | “{Name} started/blocked/resumed/submitted/cancelled {taskId}.” |
| Review, comment or step action | `status` | “{Name} approved {taskId}.” / “{Name} commented on {taskId}.” / “{Name} completed a delegated step.” |
| Task reminder | `status` | “{Name} is due in 120 minutes.” / “{Name} is overdue.” |

The person who caused the event does not get a notification or a sound for it. They still see the thread update in place. An outreach notifies the department’s queue recipients, not the admin who sent it. Task alerts use `status`, carry a null `ticketId`, and store the `taskId` on the notification so the alert opens the task; their socket frame also puts the `taskId` in `ticketEvent`.

Section badges come from `GET /badges` and from the `badges.updated` socket frame. Opening a ticket from an alert marks that notification read. “Mark all read” clears the Alerts badge. The Inbox, Queue, and Monitor badges follow the ticket counts, not the read state. The Tasks badge counts active tasks assigned to you, plus tasks you delegated that are in review.

Live delivery is the WebSocket in [realtime.md](realtime.md). The Alerts screen also loads from the API, so a missed socket event is recovered on the next visit.

## Email receipts

Every raise, reply, assignment, and status change sends one email per recipient list, not one email per person with a different body. The message is the same. Recipients are on the To line if they are the requester or assignee, and on Cc if they are queue recipients or watchers. Addresses are deduped. The actor is omitted.

The ticket stores a receipt for that send: the event, the message id, the addresses, and the state `queued`, `sent`, or `failed`. The thread shows that list. Nodemailer moves `queued` to `sent` when the SMTP server accepts the message, or to `failed` when the send throws. `sent` means the server took it. It does not mean someone opened it. Do not show “delivered” for `queued`.

The email itself is specified in [email.md](email.md).

Replying to the email does not enter the thread in this version. The template says so, and it links back to the ticket. The headers and the inbound route are specified so reply-by-email can be turned on later without a new ticket model. Until then, the inbound route stays off.

## Attachments

A note may include files. Allowed types: PNG, JPEG, WEBP, PDF. Maximum 10 MB each, 5 files per note. The file name is shown. The type is sniffed, not trusted from the extension alone. Other types are refused with a plain error.

## Out of this version

- Reply-by-email that writes into the thread
- Sign in with Google or Microsoft
- Dark mode
- Public or customer-facing tickets
- Custom departments, custom fields, and SLAs. Tasks have due dates and reminders; tickets do not
- Editing or deleting a note after it is sent
- Merging tickets
