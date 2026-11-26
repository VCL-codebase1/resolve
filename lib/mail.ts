import { readFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer from "nodemailer";

const dir = join(process.cwd(), "docs", "email");
let htmlTemplate = "";
let textTemplate = "";

function templates() {
  if (!htmlTemplate) {
    htmlTemplate = readFileSync(join(dir, "ticket.html"), "utf8");
    textTemplate = readFileSync(join(dir, "ticket.txt"), "utf8");
  }
  return { htmlTemplate, textTemplate };
}

function fill(template: string, tokens: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => tokens[key] ?? "");
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function noteHtml(note: string) {
  const cut = note.length > 1200 ? `${note.slice(0, 1200)}…` : note;
  return cut
    .split(/\n\n+/)
    .map(
      (part) =>
        `<p style="margin:0 0 12px 0;">${escapeHtml(part).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

export type MailInput = {
  event: string;
  subject: string;
  to: string[];
  cc: string[];
  ticketId?: string;
  title: string;
  eventLabel: string;
  meta: string;
  actorName: string;
  actorDepartment: string;
  note: string;
  ticketUrl: string;
  assigneeName?: string;
  statusLabel?: string;
  departmentName?: string;
  unresolvedCount?: string;
  providerMessageId: string;
};

export function renderMail(input: MailInput) {
  const { htmlTemplate, textTemplate } = templates();
  const copied = [...input.to, ...input.cc];
  const shared = {
    ticketId: input.ticketId ?? "",
    title: input.title,
    eventLabel: input.eventLabel,
    meta: input.meta,
    actorName: input.actorName,
    actorDepartment: input.actorDepartment,
    ticketUrl: input.ticketUrl,
    assigneeName: input.assigneeName ?? "",
    statusLabel: input.statusLabel ?? "",
    departmentName: input.departmentName ?? "",
    unresolvedCount: input.unresolvedCount ?? "",
  };
  let html = fill(htmlTemplate, {
    ...shared,
    title: escapeHtml(input.title),
    eventLabel: escapeHtml(input.eventLabel),
    meta: escapeHtml(input.meta),
    actorName: escapeHtml(input.actorName),
    actorDepartment: escapeHtml(input.actorDepartment),
    note: noteHtml(input.note),
    copied: copied.map(escapeHtml).join("<br>"),
  });
  if (!input.ticketId) html = html.replace(" · ", " ");
  const text = fill(textTemplate, {
    ...shared,
    note: input.note.length > 1200 ? `${input.note.slice(0, 1200)}…` : input.note,
    copied: copied.join("\n"),
  });
  return { html, text };
}

let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;
let transporterKey = "";

function mailer() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const key = JSON.stringify([host, port, user, pass, secure]);
  if (!transporter || transporterKey !== key) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
    transporterKey = key;
  }
  return transporter;
}

export async function deliver(input: MailInput) {
  const { html, text } = renderMail(input);
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`Email ${input.event} to ${input.to.join(", ")} cc ${input.cc.join(", ")}: ${input.subject}`);
    return input.providerMessageId;
  }
  const info = await mailer()!.sendMail({
    from: process.env.EMAIL_FROM || "Desk <desk@vethancon.com>",
    to: input.to,
    cc: input.cc,
    subject: input.subject,
    html,
    text,
    replyTo: "Desk <noreply@desk.vethancon.com>",
    messageId: `<${input.providerMessageId}@desk.vethancon.com>`,
    headers: {
      "X-Desk-Ticket": input.ticketId || "",
      "X-Desk-Event": input.event,
    },
  });
  return info.messageId || input.providerMessageId;
}
