# Deploying Desk

Local accounts and the database live here. They do not appear on the website.

## Run it

From the project folder:

```bash
npm install
npm run dev
```

The app listens on port 3000 unless `PORT` is set. Open the URL it prints. The public page is `/`. Staff sign in at `/login`.

## Database

Desk uses Postgres. The local install and the VPS path, including the driver and the fact that there is no ORM, are in [postgres.md](postgres.md).

| How you start it | Where the data is |
| --- | --- |
| `DATABASE_URL` is unset | Embedded Postgres, stored in `data/pglite` on this machine. Nothing else is running. The folder is not committed. |
| `DATABASE_URL` is set | That Postgres server. Apply [schema.sql](../schema.sql) first. The embedded file is not used. |

There is no cash ledger and no finance dashboard. Account / Finance is one of the nine ticket queues.

Copy `.env.example` to `.env` when you point it at a real server. Set `APP_ORIGIN` to the public URL so email links are right. `SMTP_HOST` and `EMAIL_FROM` turn on real mail through Nodemailer. Without `SMTP_HOST`, receipts are still saved and printed in the server log.

Reply-by-email stays off. `POST /api/v1/inbound/email` returns 501.

## Seeded staff

These people exist only after a fresh database is created. Every one of them uses the same starting password:

`Desk-staff-1`

Change `SEED_PASSWORD` before this app is reachable by anyone outside the machine, and change the accounts after the first sign-in. The password is not shown on the landing page or the sign-in page.

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
