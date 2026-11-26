# VethanCon Desk

Internal ticket desk for VethanCon. These documents are the product, the visual system, and the API. The app is the Next.js project next to this folder.

Brand source: [vethancon.com](https://www.vethancon.com/).

Superadmin setup and database configuration: [deployment.md](deployment.md).

Signing in with a vcglone account: [sso.md](sso.md).

Local PostgreSQL, then the same app on a VPS: [postgres.md](postgres.md).

A walkthrough of the app, the desks, and the flows is in [guide.md](guide.md).

Usability checks for every staff and admin flow: [testing.md](testing.md).

## Read in this order

1. [guide.md](guide.md) — what the app is, the desks, and how a ticket moves
2. [testing.md](testing.md) — usability testing for all flows
3. [product.md](product.md) — departments, roles, tickets, who may do what
4. [design-system.md](design-system.md) — tokens, type, the skill lock, layout, sound
5. [architecture.md](architecture.md) — Next.js, Postgres, WebSocket, email
6. [api.md](api.md) — what each route is for
7. [openapi.yaml](openapi.yaml) — the contract
8. [realtime.md](realtime.md) — socket events and sounds
9. [email.md](email.md) — receipts, the template, and reply-by-email left off
10. [postgres.md](postgres.md) — Supabase / local Postgres and `npm run db:migrate`
11. [deployment.md](deployment.md) — superadmin setup and database configuration
12. [sso.md](sso.md) — sign in with an existing vcglone account

The email template is [email/ticket.html](email/ticket.html) with the plain-text twin [email/ticket.txt](email/ticket.txt).

## Locked decisions

- One Next.js app for screens and API. Tailwind for the interface. Postgres for the data. WebSocket on the same Node process.
- Nine departments, fixed slugs, listed in the product doc.
- Colors and type from the live site. Action blue `#0557a0` is the site blue deepened so buttons and links pass WCAG AA. Brand blue `#087fe8` stays for marks and focus.
- Glass is navigation only. Claymorphism and neumorphism are locked out.
- Email sends receipts and shows them on the ticket. People reply in the app. Reply-by-email is specified and switched off.
- Admins have a monitor: Raised, Pending, Resolved, Closed, and each department. Every section carries a count badge. An admin can write to a department that still has unresolved tickets. That note is an alert and an email. It does not open a new ticket.


## Extra Configs

- To turn on mailbox, make sure  `SMTP_HOST` is set
- Reply-by-email (`POST /api/v1/inbound/email`)
