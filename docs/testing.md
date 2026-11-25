# Usability testing

How to run Desk and check every staff and admin flow. Superadmin setup is in [deployment.md](deployment.md). Architecture and mail are in [architecture.md](architecture.md) and [email.md](email.md).

## Before you start

1. Put a working Postgres URI in `SUPABASE_DB_URL` (or leave it unset to use embedded PGlite in `data/pglite`).
2. For Supabase, copy **Session pooler** from Project Settings → Database → Connect. The direct `db.*.supabase.co` host often does not resolve (`ENOTFOUND`).
3. Quote the URI if the password has `#` or `+`, or URL-encode those characters (`#` → `%23`, `+` → `%2B`) and add `?sslmode=require`.
4. Migrate, create a superadmin with `npm run db:admin`, then start:

```bash
npm run db:migrate
npm run build
npm start
```

Open `http://localhost:3000`. Create the staff accounts and departments used below through Directory in a test database. The names and email addresses below are example test fixtures that you create manually. Use their configured passwords.

| Who | Sign-in URL | Email |
| --- | --- | --- |
| Staff | `/login` | e.g. `tunde@vethancon.com` |
| Admin | `/admin` | `admin@vethancon.com` |

The API accepts either account on `/api/v1/auth/login`. The pages enforce the door: staff are signed out of `/admin`, admins are signed out of `/login`.

## Pass / fail

Mark each row. A flow passes only if the screen does what the Expected column says, with no error toast and a sensible badge update where noted.

### Public and theme

| # | Flow | Steps | Expected |
| --- | --- | --- | --- |
| 1 | Landing | Open `/` | Resolve logo in the header, hero copy, Lottie mark, staff CTA, Admin link |
| 2 | Scroll cards | Scroll to steps, staff/admin cards, queues | Sections slide in; cards read as soft elevated surfaces |
| 3 | Light / dark | Use Dark / Light on landing or after sign-in | Theme flips and survives a refresh |
| 4 | Staff door | From landing, Sign in | `/login` |
| 5 | Admin door | From landing, Admin | `/admin` |

### Auth

| # | Flow | Steps | Expected |
| --- | --- | --- | --- |
| 6 | Staff sign-in | `/login` as `tunde@vethancon.com` | Lands on Inbox |
| 7 | Admin blocked on staff door | `/login` as `admin@vethancon.com` | Message that admins use the admin page; no session left |
| 8 | Admin sign-in | `/admin` as `admin@vethancon.com` | Lands on Monitor |
| 9 | Staff blocked on admin door | `/admin` as Tunde | Message that the page is for admins |
| 10 | Wrong password | Any door, bad password | “Email or password is wrong.” Same for a disabled account |
| 11 | Profile | Open the initials mark | Name, email, role, department, Sign out |
| 12 | Sign out | Profile → Sign out | Returns to `/` |

### Staff ticket path

Use Tunde (Sales) and Chioma (Exhibition lead).

| # | Flow | Steps | Expected |
| --- | --- | --- | --- |
| 13 | Inbox empty or listed | Open Inbox | Only tickets Tunde raised, is assigned, or watches |
| 14 | Raise | New ticket → title, Exhibition, High, note → Raise | Ticket id `VC-…`, thread opens, Inbox badge can rise |
| 15 | Receipt on raise | Ticket → receipts | One `ticket.raised` row. `sent` if SMTP works or is unset (log path). `failed` if SMTP is set but unreachable |
| 16 | Queue for target | Chioma → Queue | New ticket visible for Exhibition |
| 17 | Assign | Chioma assigns herself | Status becomes In progress; assign receipt appears |
| 18 | Notification sound | Second browser as Tunde with sound on, after one click on the page | Alert toast and a short tone when Chioma acts (mute turns sound off only) |
| 19 | Reply | Chioma adds a note | Thread grows; `ticket.replied` receipt; Tunde gets an alert |
| 20 | Attachment | On raise or reply, attach a small PNG | File listed on the note; opening it shows the image. With Cloudinary set, storage is remote; without it, `data/uploads` |
| 21 | Waiting | Chioma sets Waiting | Status Waiting; status receipt |
| 22 | Resolve | Chioma sets Resolved | Status Resolved |
| 23 | Reopen by reply | Tunde replies on Resolved | Status returns to In progress |
| 24 | Close | Resolve again, then Close | Closed; reply and attach are refused |
| 25 | Alerts | Open Alerts, open one, Mark all read | Badge drops; rows stay in history |

### Admin path

| # | Flow | Steps | Expected |
| --- | --- | --- | --- |
| 26 | Monitor counts | `/monitor` | Raised / Pending / Resolved / Closed and each department unresolved count |
| 27 | Monitor drill-in | Open a count or department | Ticket list matches that bucket |
| 28 | Reach out | Department with unresolved work → note | Alert to queue recipients, outreach receipt, no new ticket |
| 29 | Reach out blocked | Department with zero unresolved | Conflict; no outreach |
| 30 | Directory list | `/directory` | People grouped by department |
| 31 | New department | Name e.g. Field Support | Appears in Directory and in New ticket targets |
| 32 | Add person | Name, email, password ≥ 10, role, department | Person can sign in at `/login` |
| 33 | Make head | Make department head | Role lead; copied on that queue |
| 34 | Reset password | Set a new password → sign in with it | Old password fails; new password works |

### Mail

| # | Flow | Steps | Expected |
| --- | --- | --- | --- |
| 35 | Log-only mail | Unset `SMTP_HOST`, raise a ticket | Server log line; receipt `sent` |
| 36 | Real SMTP | Valid `SMTP_HOST` / user / pass / `EMAIL_FROM`, raise a ticket | Inbox receives Resolve-branded HTML; receipt `sent` |
| 37 | Bad SMTP | `SMTP_HOST=smtp.example.com` | Receipt `failed`; ticket still saved |
| 38 | Events that mail | Raise, reply, assign, status, outreach | Each writes a receipt for that event |

### Realtime and chrome

| # | Flow | Steps | Expected |
| --- | --- | --- | --- |
| 39 | Live badges | Two sessions; raise toward the other’s queue | Badges move without refresh |
| 40 | Mute | Sound off, then trigger an alert | Toast may show; no tone |
| 41 | Mobile chrome | Narrow viewport | Bottom tabs; logo; profile; New ticket |

## Automated smoke (API)

With the production server on port 3000 and seed data present:

```bash
# staff login, raise, receipt, local attach (Cloudinary unset)
curl -s -c /tmp/desk.txt -H 'content-type: application/json' \
  -d '{"email":"tunde@vethancon.com","password":"<configured-test-password>"}' \
  http://127.0.0.1:3000/api/v1/auth/login

curl -s -b /tmp/desk.txt -H 'content-type: application/json' \
  -d '{"title":"Smoke","body":"Note","targetDepartment":"exhibition","priority":"normal"}' \
  http://127.0.0.1:3000/api/v1/tickets
```

Assign and status use `PATCH /api/v1/tickets/{id}`. Create person is `POST /api/v1/people`. Reset password is `PATCH /api/v1/people/{id}` with `password`. New department is `POST /api/v1/departments`.

## Last verified run

Date: 24 Nov 2026.

- Build: `npm run build` succeeded (Resolve landing, `/admin`, desk routes).
- Runtime: production `server.ts` on `http://localhost:3000` with embedded PGlite (Supabase URI was not reachable: `db.*.supabase.co` → `ENOTFOUND`; pooler → tenant/user not found until the Session URI from the dashboard is pasted).
- API flows passed: landing, admin/login pages, staff login, raise, raise receipt `sent` (SMTP unset), local PNG attach and download, admin login, monitor, directory, assign (`PATCH`), reply + receipt, waiting → resolved → closed, create department, create user, reset password + make head, login after reset, outreach, alerts, badges, inbox, queue, logout, inbound `501`.
- UI door checks for admin vs staff are enforced in the login forms, not in `/api/v1/auth/login`.

## Known traps

- `SUPABASE_DB_URL` missing `=` or an unquoted `#` in the password truncates the value.
- Fake `SMTP_HOST` or bad Cloudinary keys make receipts `failed` or uploads return “fetch failed”; unset them for local disk + log mail.
- `npm start` loads `.env`. Override with empty `SMTP_HOST=` / `CLOUDINARY_CLOUD_NAME=` when you want the log and disk fallbacks.
