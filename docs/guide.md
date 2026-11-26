# Desk

Desk is the internal ticket desk for VethanCon. A person in one department raises a request to another. The thread, the assignment, and the email receipts stay on that ticket. It is not a customer portal, and it is not a finance dashboard. Account / Finance is one of the nine queues.

The app is the Next.js project next to this folder. Open it at the URL the server prints. The public page is `/`. Staff sign in at `/login`. Admins sign in at `/admin`. Accounts and the database are in [deployment.md](deployment.md). They are not printed on the website. A checklist for trying every flow is in [testing.md](testing.md).

## The two desks

Everyone who signs in lands in the same window. What they can open depends on their role.

**Staff desk.** Inbox, Queue, and Alerts. A member sees the tickets they raised, were assigned, or watch, and can read the queue for their home department. A lead of that department can assign someone, move the status, and close the ticket once it is resolved.

**Admin desk.** The staff desk, plus Monitor and Directory. Monitor counts raised, pending, resolved, and closed tickets across the company, and lists each department’s unresolved work. Directory is where an admin adds a person. There is no public sign-up.

The sidebar names the person, the role, and the home department, so the two desks are obvious. Tasks and Task reports sit below Alerts. On a phone the same sections sit in a bar along the bottom, with Tasks as a tab; admins also get Monitor.

## Departments

The queues are fixed. A person has one home department. They may also watch another department, which adds that department’s new tickets to their alerts. Watching does not let them assign or close those tickets.

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

Each department has a list of people who are copied on its email receipts. That list is the leads, plus anyone an admin marks as a queue recipient.

## How a ticket moves

1. **Raise.** From New ticket, the person writes a title and a note, picks the department that should do the work, and sets a priority. Desk gives the ticket a number, `VC-1001` and up. The number never resets. The author’s home department is stored on the ticket, so a later move does not rewrite history.
2. **Notify.** The requester, the assignee, the watchers, and the target department’s queue recipients are told, except the person who just acted. They get an in-app alert. If the desk is open, a short sound plays for that alert. An email receipt is queued for the same people.
3. **Pick up.** The target department sees the ticket in Queue. A receiver clicks **Begin work**: an unassigned ticket is claimed by that person, and the status becomes in progress. A lead can still assign someone explicitly.
4. **Reply.** Anyone who can read the ticket and is allowed to write adds a note. A file may ride along: PNG, JPEG, WEBP, or PDF, up to 10 MB, five files on a note. The type is checked from the file itself.
5. **Complete, then close.** The assignee clicks **Mark completed**, which resolves the ticket. A reply on a completed ticket reopens it. Close is only available from resolved, and a closed ticket accepts no more replies or files. Nothing is deleted.
6. **Track progress.** The person who raised the ticket sees a stage timeline on the ticket: raised, assigned, work started, waiting, completed, reopened and closed, with who acted and when.

Statuses:

| Status | Meaning |
| --- | --- |
| Open | Raised, not picked up |
| In progress | Someone in the target department is on it |
| Waiting | The department needs something before it can continue |
| Resolved | The work is done, and the thread can still reopen |
| Closed | Finished and locked |

Unresolved means open, in progress, or waiting. Priority is low, normal, high, or urgent.

Who can do what is the short version of [product.md](product.md). Members raise and follow. Leads run their own queue. Admins can do that in every department.

## How a task moves

1. **Assign.** From **New task**, the person writes a name and description, picks an assignee and due time, and sets a priority. Members may assign only themselves, leads within their department, and admins anyone who is not an admin. Desk gives the task a `TSK-` number, starting at `TSK-1001`, that never resets. Optional fields are the expected outcome, a start time, reminder offsets, links and delegated steps. Due must be at least 15 minutes away.
2. **Start and work.** Only the assignee starts the task. Starting works from Assigned or Changes requested and keeps the original start time. The assignee can block it with a reason and resume it back to In progress.
3. **Delegate.** Leads and admins can add steps with their own assignee and due time. A step may name a receiving department and head; its assignee must belong to that department. Step assignees start, block, resume and complete their own step. The assigning head, receiving head or admin can reassign a step, which resets it to Assigned.
4. **Submit and review.** When every required step is complete, the assignee submits. A member who self-assigned completes directly; a lead or admin who self-assigned sends the task to In review. A reviewer is an admin, the lead who assigned the task, or the head of the assignee’s department. The reviewer approves it to Completed or requests changes with a comment, so the assignee can start and submit again. Reviewers can cancel any non-closed task with a reason; open steps are cancelled with it. Completed is like resolved: tasks do not reopen.
5. **Evidence and discussion.** Links and PNG, JPEG, WEBP or PDF files up to 5 MB each, 10 files at most, sit on the task with comments and an activity timeline. Files are served only to people who can read the task.
6. **Reports and reminders.** Task reports cover assigned, due, completed, on-time, overdue and handoff work by person, department and period, with CSV, PDF and handoffs CSV exports. Reminders for starts, due offsets, overdue days and managers who delegated arrive through the reminder status route; an admin can run all of them from Task reports for cron or manual use.

| Status | Meaning |
| --- | --- |
| Assigned | Has an owner, not started |
| In progress | The assignee started work |
| Blocked | The assignee recorded a reason |
| In review | Submitted, waiting for a reviewer |
| Changes requested | Sent back with a comment |
| Completed | Done, like resolved; no reopen |
| Cancelled | Stopped by a reviewer |

Steps use Assigned, In progress, Blocked, Completed and Cancelled. Task priority is low, medium, high or urgent, with medium as the default. Reminder offsets are minutes before due, at most six values from 0 to 43200.

## What each screen is for

**Home.** A public page. It explains the three steps, the staff desk, the admin monitor, and the nine queues. If you are already signed in, the button opens your desk.

**Sign in.** Work email and password, or **Sign in with vcglone** for an existing vcglone account ([sso.md](sso.md)). A wrong password and a disabled account get the same answer, so the form does not reveal which accounts exist.

**Inbox.** Tickets you raised, were assigned, or watch. The badge is the unresolved count in that list.

**Queue.** Everything aimed at your home department. Leads work from here. Members can read it. A department you only watch does not become a second queue. Those tickets show up in Alerts.

**Ticket.** The title, the two departments, the status, the assignee, a progress timeline, the thread, the reply box, and the receipt list. Receivers get Begin work and Mark completed. Leads and admins also get assign, in progress, waiting, resolve, and close.

**Tasks.** Assigned work, newest activity first. Search by name, number or person, with scope, status, priority and department filters. **New task** opens the composer with assignment, due time, reminders, links and, for leads and admins, delegated steps. The badge counts active tasks needing you.

**Task detail.** The task fields and stage times, action buttons for the assignee and reviewers, delegated steps with their own actions, evidence links and files, comments, and the activity timeline. Only the assignee starts, blocks, resumes and submits; reviewers approve, request changes and cancel.

**Task reports.** Metrics and tables for completion, on-time delivery, overdue work and interdepartmental handoffs for a chosen scope, period and date. CSV, PDF and handoffs CSV download the same view. Admins see reminder counts and **Run delivery**.

**Alerts.** Live notices. Opening one marks it read and jumps to the ticket, or to the queue when the notice is an admin outreach. Mark all read clears the badge. It does not delete the rows.

**Monitor.** Four count cards: Raised, Pending, Resolved, Closed. Under them, each department with its unresolved count. A department that still has open work has Reach out. The note goes to that queue as an alert and an email. It does not open a new ticket and it does not change any status.

**Directory.** Departments and people. Admins create departments, add staff, mark a head, and set a new password when someone forgets theirs.

## What happens off the screen

**Live updates.** The browser keeps a WebSocket on `/ws`. A raise, a reply, an assignment, or a status change arrives as an event; task actions arrive as `task.*` events and refresh open task views. The sound plays only from a notification that is not your own action, and only after you have used the page once. Muting is a control in the sidebar. Badge counts update without a sound. The contract is in [realtime.md](realtime.md).

**Email.** Each of those events also writes a receipt on the ticket: queued, then sent or failed. Nodemailer sends it when `SMTP_HOST` is set. Without that, the receipt is still saved and the message is printed in the server log. The template and the SMTP settings are in [email.md](email.md). Replying to the email does not enter the thread. That route exists and returns “not implemented,” so it can be switched on later without a new ticket model.

**Files.** Attachments live on disk under `data/uploads` and are served only to someone who can read the ticket.

## Where the data lives

Postgres. If `DATABASE_URL` is unset, Desk uses an embedded Postgres in `data/pglite` on this machine. If `DATABASE_URL` is set, it uses that server and ignores the embedded file. The schema is [schema.sql](../schema.sql). Details and superadmin setup are in [deployment.md](deployment.md).

## How the pieces fit

One Node process serves the pages, the API under `/api/v1`, and the WebSocket. The API contract is [openapi.yaml](openapi.yaml), with a prose version in [api.md](api.md). Visual rules are in [design-system.md](design-system.md). The decision record is [architecture.md](architecture.md).

Still off: reply-by-email, Google or Microsoft sign-in (vcglone SSO works), and any customer-facing tickets. Light and dark are available from the theme control. Mail needs a real `SMTP_HOST` to leave the machine
