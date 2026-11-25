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

## Seeded staff

Demo accounts and sample tickets are created only when `SEED_DEMO=true`. Production requires an explicit custom `SEED_PASSWORD` of at least 10 characters. For local demos, the fallback password is:

`Desk-staff-1`

For production, leave `SEED_DEMO=false` and create your administrator with `npm run db:admin`, using `ADMIN_EMAIL`, `ADMIN_NAME`, and a unique `ADMIN_PASSWORD` of at least 10 characters. The command refuses to overwrite existing accounts.

Existing databases retain their accounts and passwords. Changing `SEED_PASSWORD` affects newly created demo accounts only. Reset existing passwords through Directory.

Schema setup runs transactionally and records completed versions. On first upgrade it completes missing objects from interrupted setup while preserving existing data.

| Name | Email | Role | Department | What they see |
| --- | --- | --- | --- | --- |
| Amaka Okonkwo | admin@vethancon.com | Admin | IT / Software | Every ticket, the monitor, directory, and outreach |
| Chinedu Adeyemi | chinedu@vethancon.com | Lead | IT / Software | IT queue, can assign and close those tickets |
| Ngozi Bello | ngozi@vethancon.com | Lead | Business Operations | That department’s queue |
| Halima Yusuf | halima@vethancon.com | Lead | HR / Admin | That department’s queue |
| Emeka Nwosu | emeka@vethancon.com | Lead | Account / Finance | That department’s queue |
| Funke Adewale | funke@vethancon.com | Lead | Sales | Sales queue |
| Tunde Bakare | tunde@vethancon.com | Member | Sales | His own tickets and the Sales queue, read only for other people’s items |
| Ibrahim Lawal | ibrahim@vethancon.com | Lead | Business Development | That department’s queue |
| Chioma Eze | chioma@vethancon.com | Lead | Exhibition | Exhibition queue |
| Zainab Mohammed | zainab@vethancon.com | Lead | Creative Marketing / Customer Service | That department’s queue |
| Segun Okafor | segun@vethancon.com | Lead | Logistic / Warehouse | That department’s queue |
| Kemi Adebayo | kemi@vethancon.com | Member | IT / Software | Her own tickets and the IT queue |
| Bola Akin | bola@vethancon.com | Member | Business Operations | That department |
| Aisha Bello | aisha@vethancon.com | Member | HR / Admin | That department |
| Yusuf Danjuma | yusuf@vethancon.com | Member | Account / Finance | That department |
| Seyi Ogun | seyi@vethancon.com | Member | Business Development | That department |
| Nneka Umeh | nneka@vethancon.com | Member | Exhibition | That department |
| Femi Cole | femi@vethancon.com | Member | Creative Marketing / Customer Service | That department |
| Hassan Musa | hassan@vethancon.com | Member | Logistic / Warehouse | That department |

Leads and Amaka are also the people copied on their department’s email receipts.

An admin adds later staff from Directory inside the desk. There is no public sign-up.
