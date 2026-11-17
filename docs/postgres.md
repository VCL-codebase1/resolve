# Postgres, local first, then a VPS

How to run Desk against a real PostgreSQL server on this machine, then move that same process to a VPS. Staff accounts and the starting password stay in [deployment.md](deployment.md). The product shape is in [architecture.md](architecture.md).

## What is actually running

Desk is one Node process. `server.ts` starts Next.js and a WebSocket server on the same port. Screens, `/api/v1`, and `/ws` all come from that process. There is no separate backend service.

There is no ORM. Prisma, Drizzle, and Knex are not in this project. `lib/db.ts` sends SQL text and `$1` parameters.

| `DATABASE_URL` | Driver | Where the rows live |
| --- | --- | --- |
| Unset | [PGlite](https://pglite.dev) (`@electric-sql/pglite`), Postgres compiled to WebAssembly inside the Node process | `data/pglite` on disk. Not committed. Fine for a first look. Not what you want on a VPS. |
| Set | [`postgres`](https://github.com/porsager/postgres) (postgres.js), a connection pool of 10 | The server named in the URL. This is the path below. |

On first start, if `public.departments` does not exist, the process reads [schema.sql](../schema.sql) and runs each statement. If `departments` is empty, it inserts the nine departments, the staff in [deployment.md](deployment.md), and a few sample tickets. A database that already has departments is left alone. You do not apply `schema.sql` by hand unless you want to inspect it first.

Passwords are Argon2id hashes (`@node-rs/argon2`) in `users.password_hash`. Sessions store a SHA-256 of the cookie token in `sessions.token_hash`. The cookie name is `desk_session`. In production (`NODE_ENV=production`) that cookie is marked `Secure`, so the browser will only send it over HTTPS.

Ticket numbers come from the Postgres sequence `ticket_no`, which starts at 1001, and are stored as `VC-1042` style text ids. Other ids are UUIDs generated in Node.

Email is optional. Nodemailer sends it when `SMTP_HOST` is set. Without that, receipts are still written and the server prints them. Reply-by-email stays off.

Run one Node process. Live updates are in-memory. A second process would not see the first process’s sockets.

## Environment

Copy `.env.example` to `.env`. The process does not load `.env` by itself. Export the variables in the shell, or use a process manager that reads the file.

| Variable | Local | VPS |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://desk:…@127.0.0.1:5432/desk` | Same shape, host `127.0.0.1` if Postgres is on that machine |
| `APP_ORIGIN` | `http://localhost:3000` | `https://desk.example.com` with no trailing slash. Email links use this. |
| `PORT` | `3000` if unset | `3000`, behind the reverse proxy |
| `NODE_ENV` | `development` for `npm run dev`, `production` for `npm start` | `production` |
| `SEED_PASSWORD` | Set before the first boot of an empty database | A long password. It is only used when the staff rows are created. |
| `SMTP_HOST` | Leave unset to log mail | Your mail server, for example `smtp.example.com` |
| `SMTP_PORT` | `587` | `587`, or `465` when `SMTP_SECURE=true` |
| `SMTP_USER` / `SMTP_PASS` | The mailbox login, if the server requires one | Same |
| `EMAIL_FROM` | `Desk <desk@vethancon.com>` | An address that server will send as |
| `EMAIL_WEBHOOK_SECRET` | Any local string | A long random string |

## Local PostgreSQL

Install Postgres 16 or newer. On a Mac with Homebrew:

```bash
brew install postgresql@16
brew services start postgresql@16
```

Create a database and a user that is not a superuser. Replace the password.

```bash
psql postgres -c "CREATE USER desk WITH PASSWORD 'choose-a-password';"
psql postgres -c "CREATE DATABASE desk OWNER desk;"
```

From the project folder:

```bash
npm install
export DATABASE_URL='postgres://desk:choose-a-password@127.0.0.1:5432/desk'
export APP_ORIGIN='http://localhost:3000'
export SEED_PASSWORD='choose-a-staff-password'
npm run dev
```

Open the URL the process prints. Sign in at `/login` with `admin@vethancon.com` and the value of `SEED_PASSWORD`. The other accounts are listed in [deployment.md](deployment.md).

Check that the app used this server and not the embedded file:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM users;"
```

You should see 11 users. `data/pglite` should stay empty or unused. If you previously ran the app without `DATABASE_URL`, that folder is a different database. Do not expect those rows to appear in Postgres.

`npm run dev` recompiles on save. For a production-shaped run on the same machine:

```bash
npm run build
NODE_ENV=production npm start
```

`npm start` fails if `.next` was never built.

Stop anything else already bound to port 3000 before starting. A different app on that port produces `EADDRINUSE`.

## Move it to a VPS

Use a small Linux VPS (Ubuntu 24.04 is a good default) with a public IPv4 address. Keep Postgres on the same machine and listening on `127.0.0.1` only. Do not publish port 5432.

1. Point a DNS name, such as `desk.example.com`, at the VPS.
2. Install Node.js 22 or newer, PostgreSQL, and Caddy or nginx.
3. Clone the repo, run `npm install`, and set the environment from the table above. `NODE_ENV=production`. `APP_ORIGIN` must be the `https` URL staff will open.
4. Create the role and database the same way as locally. The app creates tables and seed rows on first start.
5. Build, then run one process: `npm run build` and `NODE_ENV=production npm start`.
6. Put Caddy or nginx in front of port 3000. Terminate TLS there. Proxy HTTP and WebSocket (`/ws`) to `127.0.0.1:3000`.
7. Change every seeded password from Directory after the first sign-in. `SEED_PASSWORD` does not update existing rows.

Caddy, as `/etc/caddy/Caddyfile`:

```
desk.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

Caddy upgrades WebSocket requests without an extra block.

Keep the process up with systemd. `/etc/systemd/system/desk.service`:

```
[Service]
WorkingDirectory=/opt/desk
EnvironmentFile=/opt/desk/.env
ExecStart=/usr/bin/npm start
Restart=on-failure
User=desk

[Install]
WantedBy=multi-user.target
```

`.env` on the server should contain `NODE_ENV=production` as well as `DATABASE_URL`, `APP_ORIGIN`, `PORT=3000`, and `SEED_PASSWORD`. `npm start` sets `NODE_ENV` itself, so the file line is there for anything else that reads it.

```bash
sudo systemctl enable --now desk
```

Open only 22, 80, and 443. Staff use `https://desk.example.com`. The Node port stays on localhost.

## Backups

Dump the database, not `data/pglite`, once `DATABASE_URL` is set.

```bash
pg_dump "$DATABASE_URL" --format=custom --file=desk.dump
```

Restore onto an empty database with `pg_restore --no-owner --dbname=desk desk.dump`. Take a dump before each deploy that might change `schema.sql`. The app does not run versioned migrations. If `departments` already exists, a changed `schema.sql` is not applied. Alter an existing database yourself, then restart.

## Neon, for a hosted test database

Neon is Postgres. Desk uses it the same way as a database on this machine: set `DATABASE_URL` and start the app. An empty Neon database gets `schema.sql`, the nine departments, and the staff in [deployment.md](deployment.md) on first start. Every account uses `SEED_PASSWORD`, or `Desk-staff-1` if that variable is unset.

1. Create a project at [neon.tech](https://neon.tech) and copy the connection string. It looks like `postgres://user:password@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`.
2. From the project folder, point the app at it and start:

```bash
export DATABASE_URL='postgres://…?sslmode=require'
export APP_ORIGIN='http://localhost:3000'
export SEED_PASSWORD='choose-a-staff-password'
export NODE_ENV=production
npm run build
npm start
```

3. Open `http://localhost:3000/login` and sign in as `admin@vethancon.com` with `SEED_PASSWORD`.
4. In Neon’s SQL editor, `SELECT email, role, department_slug FROM users ORDER BY department_slug;` should list the seeded staff.

Do not commit the connection string. The embedded file in `data/pglite` is not used while `DATABASE_URL` is set. Seed rows are inserted only when `departments` is empty, so a second start does not duplicate them.

## What not to do

- Do not point a VPS at `data/pglite`. That file is a single-process embedded database.
- Do not run two Desk processes against one database until realtime is moved off in-process memory. See [architecture.md](architecture.md).
- Do not commit `.env`. It is gitignored.
- Do not leave `SEED_PASSWORD` at `Desk-staff-1` on a machine other people can reach.
