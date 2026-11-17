# Email

Receipts for raise, reply, assign, status change, and an admin writing to a department about unresolved tickets. People reply in Desk. Reply-by-email is specified here and switched off, which is the choice recorded for this version.

The HTML is [email/ticket.html](email/ticket.html). The plain-text part is [email/ticket.txt](email/ticket.txt). Both use the same `{{tokens}}`. Send them as a multipart alternative. The HTML does not require images. The wordmark is text.

## When a receipt goes out

One email per event, not one email per person with a different body.

| Event | Subject |
| --- | --- |
| `ticket.raised` | `{{ticketId}} {{title}}` |
| `ticket.replied` | `Re: {{ticketId}} {{title}}` |
| `ticket.assigned` | `{{ticketId}} assigned to {{assigneeName}}` |
| `ticket.status_changed` | `{{ticketId}} marked {{statusLabel}}` |
| `department.outreach` | `{{departmentName}} · {{unresolvedCount}} unresolved` |

`To` is the requester and the assignee, when they exist and are not the actor. `Cc` is the target department’s queue recipients and the ticket watchers. Drop duplicates. Drop the actor. If that leaves nobody, do not send, and do not write a receipt.

Write the receipt row as `queued` before the provider call. Store `providerMessageId` when the provider accepts it, and use that same value as the email `Message-ID`. A webhook may move the row to `sent` or `failed`. See `POST /webhooks/email` in [api.md](api.md).

## Tokens

| Token | Example | Notes |
| --- | --- | --- |
| `{{ticketId}}` | `VC-1042` | Human id |
| `{{title}}` | `Booth power for Scientifika` | Escaped in HTML |
| `{{eventLabel}}` | `Raised to Exhibition` | One line under the wordmark |
| `{{meta}}` | `Sales → Exhibition · Open` | Source, target, status |
| `{{actorName}}` | `Ada` | Who just acted |
| `{{actorDepartment}}` | `Sales` | Their department name, not the slug |
| `{{note}}` | The latest note | Plain text. In HTML, escape, then turn blank lines into paragraphs. Cap the visible note at 1,200 characters and end with “…” if it was cut |
| `{{ticketUrl}}` | `https://desk.vethancon.com/tickets/VC-1042` | The only link |
| `{{copied}}` | One address per line in text; rows in HTML | Everyone on To and Cc, after dedupe |
| `{{assigneeName}}` | `Ife` | Assign subject only. Use “no one” if the assignee was cleared |
| `{{statusLabel}}` | `Resolved` | Words, not the enum: Open, In progress, Waiting, Resolved, Closed |
| `{{departmentName}}` | `Exhibition` | Outreach subject and body |
| `{{unresolvedCount}}` | `4` | Unresolved tickets in that department at send time |

For an outreach, `{{title}}` is “Unresolved tickets”, `{{eventLabel}}` is “From Desk”, `{{meta}}` is the department name and the count, `{{note}}` is the admin’s text, and `{{ticketUrl}}` opens that department’s queue. `{{ticketId}}` is omitted. The copied list is the queue recipients.

The host in `ticketUrl` comes from configuration. Do not hard-code it in the renderer beyond the sample in the template.

## Visual

The template follows the design system, translated for mail clients that ignore most CSS.

- Page wash `#F4F7FB`, card `#FFFFFF`, ink `#081634`, line `#E5E7EB`
- The button is `#0557A0` with white type, the action blue, not `#087FE8`
- Plus Jakarta Sans is named first, then Arial. Mail clients that lack it fall down the stack. Do not load a remote font
- One column, 560px, 20px of padding, left aligned
- One button: “Open in Desk”
- The copied list is a record, in a mono stack (`Geist Mono`, `ui-monospace`, Consolas)
- No hero image, no social icons, no second button

## Headers

Set these on every receipt so a later inbound parser can thread them.

| Header | Value |
| --- | --- |
| `Message-ID` | `<{{providerMessageId}}@desk.vethancon.com>` |
| `Reply-To` | `Desk <noreply@desk.vethancon.com>` while inbound is off |
| `X-Desk-Ticket` | `{{ticketId}}` |
| `X-Desk-Event` | The event name |

When reply-by-email is switched on, `Reply-To` becomes `ticket+{{token}}@desk.vethancon.com`. `{{token}}` is random, at least 128 bits, stored hashed against the ticket, and rotated if it leaks. Do not put the ticket id in the local part. The `Message-ID` of each receipt is the value a later reply must carry in `In-Reply-To`.

Until that switch, the footer in both parts says: “Reply in Desk. A reply to this email is not added to the ticket.”

## Inbound, when it is turned on

`POST /api/v1/inbound/email` stays 501 until an admin enables the switch in configuration. The body it will accept is `InboundEmail` in the OpenAPI file.

Accept a reply only when all of these hold:

1. The signature check used for `/webhooks/email` passes.
2. `token` matches a live ticket token.
3. `from` is the work email of an active person who is allowed to reply on that ticket, under the rules in [product.md](product.md).
4. `inReplyTo` matches a `providerMessageId` on a receipt for that same ticket. If it does not, reject. Do not guess from the subject.
5. `text` is the new writing only. The parser strips the quoted receipt and the footer line before the length check. Empty text is rejected.
6. The ticket is not `closed`.

A rejection does not create a message. It sends nothing back, to avoid mail loops. The attempt is logged with the reason and no note body.

A success creates a normal message, with the author set to that person, and runs the same notification and receipt path as a reply typed in the app. The new receipt goes out to the other participants, not back to the sender.

## Failure

If the provider call throws, the receipt stays `failed` or moves from `queued` to `failed`, and the ticket write still stands. Mail is not a condition of saving the note. The receipt list shows `failed`. The person can see who was supposed to be copied. There is no automatic retry storm: one retry after five minutes, then stop.
