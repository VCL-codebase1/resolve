# Realtime

Live updates for an open Desk session. The event names match the notification types in [api.md](api.md), including `task.*`. Sound keys match [design-system.md](design-system.md).

## Socket

`GET /ws`, upgraded to a WebSocket on the same host as the app. The browser sends the `desk_session` cookie on the handshake. A missing or dead session closes the socket with code `4401` before any event.

One socket per tab. The server does not fan a tab’s own writes back as notifications. Thread updates for a ticket that this tab has open still arrive, so the reply shows up, but `notification.created` is omitted for the actor. See [Who hears it](#who-hears-it).

The first frame from the server is:

```json
{ "type": "ready" }
```

The client sends `{ "type": "ping" }` every 25 seconds. The server answers `{ "type": "pong" }`. If two pings go unanswered, the client closes and reconnects.

Reconnect with backoff: 1s, 2s, 4s, then 8s, and stay at 8s. On `ready` after a reconnect, the client refetches `GET /badges`, `GET /notifications?unread=true`, and, if a ticket is open, `GET /tickets/{id}`. An admin also refetches `GET /admin/summary` if the monitor is open. The socket is not a log. Missed frames are recovered from the API.

## Events

Every event is one JSON object with `type`, `ticketId`, `actor`, `at`, and the fields below. `actor` is a person object: `id`, `name`, `role`, `departmentSlug`, `active`. `ticketId` may be null: it is null on `department.outreach` and on every `task.*` frame. Task frames carry the work id in `ticketEvent`: `{ type: "task.<action>", taskId, action }`. Task alerts use sound `status`.

| `type` | Extra fields | What the client does |
| --- | --- | --- |
| `ticket.raised` | `sound`, `sentence`, `sourceDepartment`, `targetDepartment`, `title` | If that list is on screen, insert the row. Do not play sound from this frame |
| `ticket.replied` | `messageId`, `body`, `status` | If this ticket is open, append the message. `status` is the ticket status after the reply |
| `ticket.assigned` | `assignee` (person or null), `status` | If this ticket is open, update the assignee and status |
| `ticket.status_changed` | `status`, `priority` | If this ticket is open, update both |
| `notification.created` | `notificationId`, `sound`, `sentence`, `notificationType` | Prepend the alert, show the glass note, play `sound` |
| `task.created`, `task.updated`, `task.commented`, `task.resource_added` | `ticketEvent` | Refresh the task list or detail if open. No sound from this frame |
| `task.started`, `task.blocked`, `task.resumed`, `task.submitted`, `task.approved`, `task.changes_requested`, `task.completed`, `task.cancelled`, `task.reminder` | `ticketEvent` | Refresh the open task view. Sound comes only from `notification.created` |
| `task.step_added`, `task.step_started`, `task.step_blocked`, `task.step_resumed`, `task.step_completed`, `task.step_reassigned` | `ticketEvent` | Refresh steps on the open task detail |
| `badges.updated` | `badges` | Replace the section badges. No sound, no glass note |

`notificationType` repeats the underlying event: `ticket.raised`, `ticket.replied`, `ticket.assigned`, `ticket.status_changed`, `department.outreach`, or one of the `task.*` types above. The client provider refreshes task views on any `task.*` frame, as it does for `ticket.*` frames.

`badges` is the same object as `GET /badges`, now including `tasks`. `ticketId` may be absent on `badges.updated`. On `department.outreach`, `ticketId` is null and `departmentSlug` is set. On `task.*` frames, `ticketId` is also null and the `ticketEvent` object carries `taskId` and `action`. `notification.created` carries `taskId` for task alerts, and the notification API returns it too. Opening an outreach alert goes to the department queue; opening a task alert goes to `/tasks/{taskId}`.

`sound` is `raise`, `reply`, or `status`. Task frames always use `status`.

Example, the frame that makes a sound:

```json
{
  "type": "notification.created",
  "notificationId": "6c2a1c4e-1b2d-4e5f-9a10-0b1c2d3e4f50",
  "notificationType": "ticket.raised",
  "ticketId": "VC-1042",
  "sound": "raise",
  "sentence": "Ada in Sales raised VC-1042 to Exhibition.",
  "actor": {
    "id": "2f6e1a40-0c1a-4b2e-8d11-9a8b7c6d5e4f",
    "name": "Ada",
    "role": "member",
    "departmentSlug": "sales",
    "active": true
  },
  "at": "2026-11-15T07:04:00Z"
}
```

Sentences are built on the server, using the shapes in [product.md](product.md). The client does not assemble them.

## Who hears it

Recipients of a ticket event are the requester, the assignee, ticket watchers, and the target department’s queue recipients, excluding the actor. An outreach goes only to that department’s queue recipients. Recipients of a task event are the task assignee, the assigner, step assignees and receiving heads, excluding the actor.

`badges.updated` goes to anyone whose inbox, queue, task, or alert count changed, and to every admin when any company-wide monitor count changes. The actor’s own counts still update. The actor does not get a notification frame for their own action.

| Event | `ticket.*` or `task.*` frame | `notification.created` |
| --- | --- | --- |
| Someone else acted | Yes, if this socket’s user may read the work | Yes |
| You just acted | Yes, on your open ticket or task, so the screen stays in step | No |

Queue recipients who are not otherwise allowed to read the ticket still receive the notification. Opening it is allowed, because being copied means they can read it. The read rule in the product doc includes members of the target department, and queue recipients are members of that department.

## Sound

Play `sound` only from `notification.created`. Playing it again from `ticket.raised` or `ticket.replied` would double the tone.

The rest of the rules live in the design system: after a first tap or keypress, not for your own action, not when muted, one tone at a time, no louder tone for urgent, and mute stored on the device. Reduced motion does not mute.

## SSE fallback

Not a v1 route. Documented so a later serverless host does not invent a second event model.

`GET /api/v1/notifications/stream` would send the same JSON objects, one per SSE `data:` line, with the session cookie. The client would still refetch on reconnect. `ticket.*`, `task.*` and `notification.created` frames stay as they are. Do not add this route while the desk runs as one Node process with `/ws`.
