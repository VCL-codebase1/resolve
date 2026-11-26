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
| `member` | Raise a ticket, reply on tickets they raised, were assigned, or watch, read their home queue, and begin or complete tickets aimed at their home department |
| `lead` | Everything a member can, plus assign, change any status, close, and manage watchers on tickets aimed at their home department |
| `admin` | Everything a lead can, in every department, plus the monitor, create people, edit department receipt lists, and reach out to a department about unresolved tickets |

Signing in uses a work email and a password. There is no public sign-up. An admin creates the account. The first version does not use Google or Microsoft sign-in. That can be added later without changing the ticket model.

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

## Screens

The design system defines how they look. This is what they contain. Every section shows a count badge. The number is the work still sitting in that section, not a decoration.

**Inbox.** Tickets you raised, tickets assigned to you, and tickets you watch, newest activity first. Filter by status. This is the home screen for members and leads. Badge: unresolved tickets in this list.

**Queue.** The work aimed at your home department. Leads live here. Members can read it. A department you only watch does not appear as a queue. It appears in Alerts. Badge: unresolved tickets in the queue.

**Ticket.** Title, meta line, status, priority, assignee, a stage-by-stage progress timeline, the thread, the reply field, and the receipt list for this ticket. The timeline shows who raised, claimed, started, completed, reopened or closed it, with times. Attachments sit under the note they belong to.

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

There are no charts and no cross-department analytics beyond these counts.

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

The person who caused the event does not get a notification or a sound for it. They still see the thread update in place. An outreach notifies the department’s queue recipients, not the admin who sent it.

Section badges come from `GET /badges` and from the `badges.updated` socket frame. Opening a ticket from an alert marks that notification read. “Mark all read” clears the Alerts badge. The Inbox, Queue, and Monitor badges follow the ticket counts, not the read state.

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
- Custom departments, custom fields, SLAs, and due dates
- Editing or deleting a note after it is sent
- Merging tickets
