# Deploying Desk

Local accounts and the database live here. They do not appear on the website.

## Run it

From the project folder:

```bash
npm install
# Optional configuration
cp .env.example .env
npm run db:admin # Set ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD first
npm run dev
```

The app listens on port 3000 unless `PORT` is set. Open the URL it prints. The public page is `/`. Staff sign in at `/login`, and administrators sign in at `/admin`.

Requires Node.js 22.9 or newer. Run `node --version` to check your installed version. The scripts also run without a `.env` file and accept environment variables provided by the host.

## Database

Desk uses Postgres. The local install and the VPS path, including the driver and the fact that there is no ORM, are in [postgres.md](postgres.md).

| How you start it | Where the data is |
| --- | --- |
| `DATABASE_URL` is unset | Embedded Postgres, stored in `data/pglite` on this machine. Nothing else is running. The folder is not committed. |
| `DATABASE_URL` is set | That Postgres server. Apply [schema.sql](../schema.sql) first. The embedded file is not used. |

There is no cash ledger and no finance dashboard. Account / Finance is one of the nine ticket queues.

Copy `.env.example` to `.env` when you point it at a real server. Set `APP_ORIGIN` to the public URL so email links are right. `SMTP_HOST` and `EMAIL_FROM` turn on real mail through Nodemailer. Without `SMTP_HOST`, receipts are still saved and printed in the server log.

In Vercel, enter `SUPABASE_DB_URL` in the Name field and the connection URI beginning with `postgresql://` in the Value field. Save it for Production and redeploy to apply the change.

Reply-by-email stays off. `POST /api/v1/inbound/email` returns 501.

## Superadmin setup

Create the initial superadmin with `npm run db:admin`. Set `ADMIN_EMAIL`, `ADMIN_NAME`, and a unique `ADMIN_PASSWORD` of at least 10 characters. Sign in at `/admin`. The command refuses to overwrite an existing account and creates the required IT / Software department when needed.

Database initialization applies the schema without creating accounts, departments, or sample tickets. The superadmin creates departments and staff through Directory. Existing superadmin passwords are preserved during data cleanup.

Schema setup runs transactionally and records completed versions. On first upgrade it completes missing objects from interrupted setup while preserving existing data.
