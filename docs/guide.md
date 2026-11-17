# Desk

Desk is the internal ticket desk for VethanCon. A person in one department raises a request to another. The thread, the assignment, and the email receipts stay on that ticket. It is not a customer portal, and it is not a finance dashboard. Account / Finance is one of the nine queues.

The app is the Next.js project next to this folder. Open it at the URL the server prints. The public page is `/`. Staff sign in at `/login`. Accounts and the database are in [deployment.md](deployment.md). They are not printed on the website.

## The two desks

Everyone who signs in lands in the same window. What they can open depends on their role.

**Staff desk.** Inbox, Queue, and Alerts. A member sees the tickets they raised, were assigned, or watch, and can read the queue for their home department. A lead of that department can assign someone, move the status, and close the ticket once it is resolved.

**Admin desk.** The staff desk, plus Monitor and Directory. Monitor counts raised, pending, resolved, and closed tickets across the company, and lists each department’s unresolved work. Directory is where an admin adds a person. There is no public sign-up.

The sidebar names the person, the role, and the home department, so the two desks are obvious. On a phone the same sections sit in a bar along the bottom. Admins get a fourth tab, Monitor.

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
3. **Pick up.** The target department sees the ticket in Queue. A lead or an admin assigns someone in that department. Assigning an open ticket moves it to in progress.
4. **Reply.** Anyone who can read the ticket and is allowed to write adds a note. A file may ride along: PNG, JPEG, WEBP, or PDF, up to 10 MB, five files on a note. The type is checked from the file itself.
5. **Resolve, then close.** The lead or admin marks the work resolved. A reply on a resolved ticket reopens it. Close is only available from resolved, and a closed ticket accepts no more replies or files. Nothing is deleted.

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

## What each screen is for

**Home.** A public page. It explains the three steps, the staff desk, the admin monitor, and the nine queues. If you are already signed in, the button opens your desk.

**Sign in.** Work email and password. A wrong password and a disabled account get the same answer, so the form does not reveal which accounts exist.

**Inbox.** Tickets you raised, were assigned, or watch. The badge is the unresolved count in that list.

**Queue.** Everything aimed at your home department. Leads work from here. Members can read it. A department you only watch does not become a second queue. Those tickets show up in Alerts.

**Ticket.** The title, the two departments, the status, the thread, the reply box, and the receipt list. Leads and admins also get assign, in progress, waiting, resolve, and close.

**Alerts.** Live notices. Opening one marks it read and jumps to the ticket, or to the queue when the notice is an admin outreach. Mark all read clears the badge. It does not delete the rows.

**Monitor.** Four count cards: Raised, Pending, Resolved, Closed. Under them, each department with its unresolved count. A department that still has open work has Reach out. The note goes to that queue as an alert and an email. It does not open a new ticket and it does not change any status.

**Directory.** The people who can sign in, and a form to add one. Admins only.

## What happens off the screen

**Live updates.** The browser keeps a WebSocket on `/ws`. A raise, a reply, an assignment, or a status change arrives as an event. The sound plays only from a notification that is not your own action, and only after you have used the page once. Muting is a control in the sidebar. Badge counts update without a sound. The contract is in [realtime.md](realtime.md).

**Email.** Each of those events also writes a receipt on the ticket: queued, then sent or failed. With no mail provider configured, the receipt is still saved and the message is printed in the server log. The template is in [email.md](email.md). Replying to the email does not enter the thread. That route exists and returns “not implemented,” so it can be switched on later without a new ticket model.

**Files.** Attachments live on disk under `data/uploads` and are served only to someone who can read the ticket.

## Where the data lives

Postgres. If `DATABASE_URL` is unset, Desk uses an embedded Postgres in `data/pglite` on this machine. If `DATABASE_URL` is set, it uses that server and ignores the embedded file. The schema is [schema.sql](../schema.sql). Details, the seeded staff, and the starting password are in [deployment.md](deployment.md).

## How the pieces fit

One Node process serves the pages, the API under `/api/v1`, and the WebSocket. The API contract is [openapi.yaml](openapi.yaml), with a prose version in [api.md](api.md). Visual rules are in [design-system.md](design-system.md). The decision record is [architecture.md](architecture.md).

Still off: a real mailbox until a provider key is set, reply-by-email, Google or Microsoft sign-in, dark mode, and any customer-facing tickets.
