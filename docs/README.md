# VethanCon Desk

Internal ticket desk for VethanCon. These documents are the product, the visual system, and the API. The app is the Next.js project next to this folder.

Brand source: [vethancon.com](https://www.vethancon.com/).

Staff accounts, the starting password, and which database is in use: [deployment.md](deployment.md).

Local PostgreSQL, then the same app on a VPS: [postgres.md](postgres.md).

A walkthrough of the app, the desks, and the flows is in [guide.md](guide.md).

## Read in this order

1. [guide.md](guide.md) — what the app is, the desks, and how a ticket moves
2. [product.md](product.md) — departments, roles, tickets, who may do what
3. [design-system.md](design-system.md) — tokens, type, the skill lock, layout, sound
4. [architecture.md](architecture.md) — Next.js, Postgres, WebSocket, email
5. [api.md](api.md) — what each route is for
6. [openapi.yaml](openapi.yaml) — the contract
7. [realtime.md](realtime.md) — socket events and sounds
8. [email.md](email.md) — receipts, the template, and reply-by-email left off

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
