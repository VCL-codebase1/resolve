# Desk design system

One visual system for the internal VethanCon desk. It is taken from the live site at [vethancon.com](https://www.vethancon.com/), then tightened so small text and buttons pass WCAG 2.2 AA. The product is a tool people use every day. It should feel quiet, exact, and finished. It should not look like a template, and it should not look like several templates at once.

## Skill lock

Eight skills are in force. They are locked by role. They are not layered on the same surface.

| Skill | Role in Desk |
| --- | --- |
| Apple design | Content structure, type hierarchy, navigation model, 44px targets, accessibility order, plain writing |
| Premium | Spacing rhythm, one accent, hairline edges, polished empty and loading states |
| Taste (design-taste-frontend) | Anti-slop rules: one system, one job per screen, no generic dashboard, no purple, no gradient mesh, no stock illustration |
| Liquid Glass foundations | Glass is the navigation layer only. Regular material. Never on lists, threads, or page backgrounds |
| Liquid Glass best practices | Where glass is allowed, contrast, tint, and the ban on stacked glass |
| Glassmorphism | CSS recipe for that single glass layer. It is not a second style |
| Claymorphism | Locked out. See the rejection below |
| Neumorphism | Locked out. See the rejection below |

Claymorphism and neumorphism each say not to mix visual metaphors, and not to ship low-contrast controls. Their default type (Montserrat, Poppins, Space Mono) and their default palettes are not the VethanCon site. Puffy clay and extruded shadows also fail the brief: minimal, not basic, not slop. Those two skills stay in this document so a later build does not reopen them. They do not appear in components.

Glass follows Apple’s rule, which the liquid-glass skills repeat: liquid glass floats above content. It is the sidebar, the toolbar, the mobile tab bar, the composer sheet, the outreach sheet, and the notification stack. The ticket list and the thread sit in a thicker standard material, the content pane, so text stays readable. The window behind both is a soft color wash. The glass samples that wash, which is the photochromic part of the material.

## Brand source

Measured from the production stylesheet on vethancon.com, November 2026.

- Display and UI: Plus Jakarta Sans
- Identifiers, ticket numbers, timestamps: Geist Mono
- Brand blue: `#087fe8`
- Signal cyan: `#12c4ce`
- Navy ink: `#081634`
- Wash: `#eaf6ff`

Skill font defaults (Inter, Montserrat, Space Mono, JetBrains Mono) lose to the site. Do not introduce them.

## Color

`#087fe8` on white is 4.03:1. That passes for large text and for non-text UI marks. It fails for body text and for white labels on a filled button. The action blue is the same hue, deepened, so links and buttons clear 4.5:1.

`#12c4ce` on white is 2.14:1. It is a signal, never a text color on a light surface. On navy it is 8.35:1, so it may label a live state inside a dark chip.

| Token | Hex | Use |
| --- | --- | --- |
| `ink` | `#081634` | Text, wordmark. 17.9:1 on white |
| `ink-soft` | `#111827` | Secondary text. 17.7:1 on white |
| `brand` | `#087fe8` | Marks, focus ring, large headings only |
| `action` | `#0557a0` | Links, filled buttons. 7.3:1 with white |
| `action-press` | `#044886` | Pressed fill |
| `signal` | `#12c4ce` | Live dot, unread tick. Not body text |
| `canvas` | `#F4F7FB` | Page background |
| `surface` | `#FFFFFF` | Lists, thread, sheets content |
| `wash` | `#EAF6FF` | Selected row, quiet highlight |
| `line` | `#E5E7EB` | Hairline borders |
| `line-strong` | `#D0D5DD` | Dividers that must read on canvas |
| `muted` | `#667085` | Meta text. Check against white before using under 14px; prefer `ink-soft` if a pair fails |
| `urgent` | `#9A3412` | Urgent label on `#FFF7ED` |
| `waiting` | `#92400E` | Waiting label on `#FFFBEB` |
| `resolved` | `#047857` | Resolved label on `#ECFDF5` |
| `danger` | `#B42318` | Destructive text and error borders |

Status chips use the quiet pairs above. They do not use filled brand blue. Urgent is a word and a small mark, not a red page.

Focus ring: 2px `brand` outside a 2px white gap. Visible on canvas and on white. Never remove it.

Dark mode is out of this version. Do not invent a second palette in components.

## Type

Plus Jakarta Sans for everything a person reads. Geist Mono for ticket ids (`VC-1042`), timestamps, and email addresses in receipts.

| Style | Size / line | Weight | Tracking |
| --- | --- | --- | --- |
| Title | 28 / 34 | 600 | -0.02em |
| Section | 20 / 26 | 600 | -0.015em |
| Body | 16 / 24 | 450 | 0 |
| Label | 14 / 20 | 550 | 0 |
| Meta | 13 / 18 | 450 | 0 |
| Ticket id | 13 / 18 | 500 | 0.01em, mono |

Titles sit once per screen. Do not stack a title, a subtitle, and a description that repeat the same fact. On a phone, the title may drop to 24 / 30. Do not go below 16 for body.

Weight 450 is the variable-font text weight. If a cut of the font only has 400 and 500, use 400 for body and 500 for labels.

## Space, radius, elevation

Spacing scale: 4, 8, 12, 16, 24, 32. Nothing else, except a 44px minimum hit target and a 20px page inset on phones (16px only if the line length would otherwise break).

Radius follows the window, the way a macOS pane does. 28px for the content well and sheets, 22px for the sidebar and the mobile tab bar, 18px for the toolbar and stat cards, 14px for sidebar rows, capsules for the primary button. Inner corners stay smaller than the pane that holds them.

The window background is a wash of navy, brand blue, and signal cyan. Glass and the content pane float on it with one soft shadow and a 1px light edge. Ticket rows inside the pane stay flat to that surface. They separate with a hairline, not with their own shadow.

## Glass layer

One recipe, used only on the surfaces listed in the skill lock.

```css
.glass {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.52));
  backdrop-filter: blur(28px) saturate(1.6);
  border: 1px solid rgba(255, 255, 255, 0.72);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 10px 28px rgba(8, 22, 52, 0.1);
}
```

The content pane uses the same highlight and a thicker white fill (`rgba(255, 255, 255, 0.9)`, blur 18px). It is a standard material, not a second liquid-glass layer.

Rules:

- Regular glass, not clear. The desk has no full-bleed photography under the chrome.
- Tint only the primary action inside the glass (the New control), with `action`. Do not tint the whole bar.
- Text on glass is `ink`. If the page behind the bar is busy, add a 1px `line` along the content edge. Do not add a second blur layer.
- If `backdrop-filter` is missing, or the person has asked for reduced transparency, fall back to solid white. Do not approximate glass with a gradient alone.
- Do not put liquid glass on the ticket list, the message body, or attachment rows. Those live in the content pane.
- Do not stack a glass menu on a glass sheet. A menu opens from the bar; a sheet replaces the bar’s overlay, it does not sit on top of another glass panel.

## Layout

Mobile is the layout. Desktop is the same screens with the list and the thread side by side.

Phone, under 760px:

- Top bar: wordmark, mute, account. Glass.
- Body: one screen. Inbox, queue, alerts, monitor, or the composer.
- Bottom bar: Inbox, Queue, New, Alerts. Admins also get Monitor. Glass. New is the tinted action. Each item except New carries its section badge.
- A ticket opens full screen. Back returns to the list and keeps scroll.
- The composer is a sheet from the bottom, content solid, grab area in the glass bar of the sheet.

Desktop, 760px and up:

- Left column, 360px: the same list. In Monitor, this column is the sections (Raised, Pending, Resolved, Closed, then each department).
- Right column: the thread, or the tickets in the selected section. Empty state names the section.
- No bottom bar. New sits in the glass top bar. Monitor sits in that bar for admins only.
- The monitor is the same list pattern. It is not a third column of charts.

Page inset is 20px on the phone and 24px on the desktop thread. The list may run edge to edge, with 16px of text inset.

Hit targets are at least 44 by 44. Meta text can be 13px. The control around it cannot.

## Components

Each component has a rest state, a pressed or selected state, a focus state, and a disabled state. Disabled is `ink` at 40% opacity, not a new gray.

**Top bar.** Glass. Wordmark “Desk” in ink, 16px, weight 600. Mute is an icon button. Account is the person’s first name, not an avatar collage.

**Tab bar.** Icon plus a word. Selected item is ink. Unselected is muted. Members and leads see Inbox, Queue, New, Alerts. Admins also see Monitor. New has no badge.

**Section badge.** A count on Inbox, Queue, Alerts, Monitor, and on every row inside Monitor (Raised, Pending, Resolved, Closed, and each department). Mono, 12px, at least 18px tall, 1px `line`, `wash` fill, `ink` text. Cap the visible number at `99+`. The hit target is the whole tab or row, not the badge. Alerts uses `signal` for the digits when the count is above zero, because that count is unread. The other badges stay ink. A zero count hides the badge. Do not put a badge on mute, account, or New.

**List row.** Solid surface. Ticket id in mono, title in body, one line of the target department and the relative time in meta. Unread: a 6px signal dot at the leading edge, and the title at weight 600. Selected on desktop: `wash` fill, no shadow. Do not show priority as a colored stripe down the row. Priority is a word when it is high or urgent. Normal is unspoken.

**Thread.** Solid. Title, then a single meta line: `VC-1042 · Sales → Exhibition · Open`. Messages are stacked with 24px between them. The requester’s note and later replies use the same type. A quiet meta line under each note names the person, the department, and the time. Do not use chat bubbles.

**Composer sheet.** Title field, target department, priority, note. One primary button: “Raise ticket” or “Reply”. Cancel is a text button. The sheet content is white. Only the sheet’s top edge is glass.

**Buttons.** Filled action for the one primary act on the screen. White label, 10px radius, 44px tall. Secondary is a text button in `action`, no border. Destructive (“Close ticket”) is a text button in `danger`, and it asks once.

**Inputs.** 44px, 10px radius, 1px `line`, white fill. Focus replaces the border with `brand`. Error replaces it with `danger` and puts one sentence under the field. Placeholder text is an example, not a label. The label is always visible.

**Status.** A word in a quiet chip: Open, In progress, Waiting, Resolved, Closed. Urgent priority uses the urgent pair and the word “Urgent”. Do not combine a chip, an icon, and a tooltip that all say the same thing.

**Receipts.** On the ticket, a short list: who was copied, and whether the message was queued, sent, or failed. Mono for addresses. This is a record, not a marketing module.

**Monitor row.** Solid. The section name, then the badge at the trailing edge. A department row with an unresolved count above zero also shows “Reach out” as a text button. That opens a sheet: one note field, one button, “Send to {Department}”. Departments at zero do not show the button.

**Empty.** One sentence and one action. Inbox with nothing in it: “Nothing waiting on you.” Queue: “The queue is clear.” A monitor section with nothing in it: “Nothing in this list.” No illustration.

**Loading.** A single hairline sweep on the list, or the last known rows at rest. No skeleton cards, no spinners in the middle of a sentence.

**Notification stack.** Glass, under the top bar, max two visible. Each note is one sentence: “Ada in Sales raised VC-1042 to Exhibition.” It leaves on its own after a few seconds or on dismiss. It is not a second inbox. The Alerts screen holds the record.

## Motion

Durations: 160ms for color and press, 220ms for a sheet, 280ms for the notification. Easing: `cubic-bezier(0.2, 0, 0, 1)` for enter, `cubic-bezier(0.4, 0, 1, 1)` for leave. No bounce, no overshoot, no parallax.

`prefers-reduced-motion: reduce` sets every duration to 0. State still changes. The notification appears in place.

Sound is not motion. Reduced motion does not mute the desk. Mute is its own control.

## Sound

Three original tones, synthesized in the app. Do not ship a stock notification file, and do not imitate a social network.

| Key | When | Character |
| --- | --- | --- |
| `raise` | A ticket is raised to a department you belong to or watch | Short, higher, one note |
| `reply` | Someone replies on a ticket you are on | Two soft notes, lower than raise |
| `status` | Assign or status change on a ticket you follow | One drier note |

Rules:

- Play only after the person has tapped or typed once in the session. Browsers block sound before that.
- Do not play a tone for an action the current person just took.
- Do not play if mute is on. Mute persists on the device.
- One tone at a time. If two events arrive together, play the newer one.
- Keep the level low. A tone is a tap on glass, not an alarm.
- Urgent does not get a louder or repeating sound. Urgency is visible in the row.

## Writing

Short, specific, calm. Name the department and the ticket id. “Raised to Exhibition” is enough. Do not write “Awesome!”, “Oops!”, or “You’re all set.”

Buttons are verbs: Raise ticket, Reply, Assign, Resolve, Close, Send to Exhibition. Empty states say what is true, then stop.

Errors say what failed and what to do: “That reply did not send. It is still in the thread. Try again.” Do not blame the person, and do not show a stack trace.

## Rejected

Do not reintroduce these during the build:

- Clay surfaces, puffy shadows, inner highlights, or a playful 3D look
- Neumorphic extruded controls, monochrome shadow pairs, or inset grooves
- Glass on content, stacked glass, full-screen blur, or a glass background
- Inter, Montserrat, Poppins, Space Mono, or a second brand blue
- Purple accents, gradient text, gradient meshes, blob backgrounds
- Cash, revenue, or finance dashboards. Account/Finance is a ticket queue
- Sparkline dashboards, avatar stacks, chat bubbles
- Admin monitor may show four count cards: Raised, Pending, Resolved, Closed. Numbers of tickets only
- Badges on mute, account, New, or decorative icons. Section counts are the only badges
- Confetti and toast piles
- Dark mode, until a later document defines it
