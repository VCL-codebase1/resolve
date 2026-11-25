"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api, relativeTime, said, STATUS_LABEL, type Department, type Person, type Receipt, type TicketDetail } from "./api";
import { useDesk } from "./provider";

const label = (departments: Department[], slug: string) => departments.find((item) => item.slug === slug)?.name || slug;

export function Thread({ id }: { id: string }) {
  const { live, departments, me, refresh, toast } = useDesk();
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api<TicketDetail>(`/tickets/${id}`)
      .then((body) => {
        setTicket(body);
        setError("");
        return api<{ items: Person[] }>(`/people?department=${body.targetDepartment}&limit=50`);
      })
      .then((body) => setPeople(body.items.filter((person) => person.active)))
      .catch((reason: unknown) => {
        const message = said(reason, "That ticket could not be loaded.");
        setError(message);
        toast(message, "error");
      });
    api<{ items: Receipt[] }>(`/tickets/${id}/receipts`)
      .then((body) => setReceipts(body.items))
      .catch(() => setReceipts([]));
  }, [id, live]);

  if (error) return <p className="px-5 py-8 text-[16px] text-danger">{error}</p>;
  if (!ticket) return <div className="mx-5 mt-6 h-px bg-line" />;

  const manage = me?.role === "admin" || (me?.role === "lead" && me.departmentSlug === ticket.targetDepartment);
  const closed = ticket.status === "closed";

  async function patch(body: Record<string, unknown>, done: string) {
    setError("");
    try {
      const next = await api<TicketDetail>(`/tickets/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      setTicket(next);
      refresh();
      toast(done);
    } catch (reason) {
      const message = said(reason, "That change did not save.");
      setError(message);
      toast(message, "error");
    }
  }

  async function onReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const note = String(form.get("body") || "");
    const file = form.get("file");
    setPending(true);
    setError("");
    try {
      const message = await api<{ id: string }>(`/tickets/${id}/messages`, {
        method: "POST",
        body: JSON.stringify({ body: note }),
      });
      if (file instanceof File && file.size > 0) {
        const upload = new FormData();
        upload.set("file", file);
        upload.set("messageId", message.id);
        await api(`/tickets/${id}/attachments`, { method: "POST", body: upload });
      }
      setReply("");
      refresh();
      toast("Reply sent.");
    } catch (reason) {
      const message = said(reason, "That reply did not send.");
      setError(message);
      toast(message, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <article>
      <header className="sticky top-0 z-10 border-b border-line bg-white/80 px-4 py-4 backdrop-blur min-[880px]:px-8">
        <Link href="/inbox" className="text-[14px] text-action">
          Inbox
        </Link>
        <h1 className="mt-2 text-[22px] font-semibold leading-7 tracking-tight">{ticket.title}</h1>
        <p className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[13px] leading-5 text-ink-soft">
          <span className="font-mono">{ticket.id}</span>
          <span>
            {label(departments, ticket.sourceDepartment)} → {label(departments, ticket.targetDepartment)}
          </span>
          <span>{STATUS_LABEL[ticket.status]}</span>
        </p>
      </header>
      <div className="mx-auto max-w-[680px] px-4 py-6 min-[880px]:px-8">
      {ticket.priority === "urgent" || ticket.priority === "high" ? (
        <p className={`mt-3 inline-flex rounded-md px-2 py-1 text-[13px] ${ticket.priority === "urgent" ? "bg-urgent-bg text-urgent" : "bg-waiting-bg text-waiting"}`}>
          {ticket.priority === "urgent" ? "Urgent" : "High"}
        </p>
      ) : null}
      {manage && !closed ? (
        <div className="mt-6 flex flex-wrap gap-2">
          <select
            value={ticket.assignee?.id || ""}
            onChange={(event) => patch({ assigneeId: event.target.value || null }, event.target.value ? "Ticket assigned." : "Ticket unassigned.")}
            className="h-11 rounded-[10px] border border-line bg-white px-3 text-[14px]"
          >
            <option value="">Unassigned</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          {ticket.status !== "in_progress" ? (
            <button type="button" className="h-11 px-3 text-[14px] text-action" onClick={() => patch({ status: "in_progress" }, "Marked in progress.")}>
              In progress
            </button>
          ) : null}
          {ticket.status !== "waiting" ? (
            <button type="button" className="h-11 px-3 text-[14px] text-action" onClick={() => patch({ status: "waiting" }, "Marked waiting.")}>
              Waiting
            </button>
          ) : null}
          {ticket.status !== "resolved" ? (
            <button type="button" className="h-11 px-3 text-[14px] text-action" onClick={() => patch({ status: "resolved" }, "Ticket resolved.")}>
              Resolve
            </button>
          ) : null}
          {ticket.status === "resolved" ? (
            <button
              type="button"
              className="h-11 px-3 text-[14px] text-danger"
              onClick={() => {
                if (confirm("Close this ticket?")) void patch({ status: "closed" }, "Ticket closed.");
              }}
            >
              Close
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="mt-8 flex flex-col gap-6">
        {ticket.messages.map((message) => (
          <section key={message.id}>
            <p className="whitespace-pre-wrap text-[16px] leading-6">{message.body}</p>
            <p className="mt-2 text-[13px] text-muted">
              {message.author.name} · {label(departments, message.author.departmentSlug)} · {relativeTime(message.createdAt)}
            </p>
            {message.attachments.length > 0 ? (
              <ul className="mt-2">
                {message.attachments.map((file) => (
                  <li key={file.id}>
                    <a className="text-[14px] text-action" href={`/api/v1/attachments/${file.id}`}>
                      {file.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
      {closed ? <p className="mt-8 text-[16px] text-ink-soft">This ticket is closed.</p> : (
        <form onSubmit={onReply} className="mt-8 flex flex-col gap-3">
          <label className="text-[14px] font-medium" htmlFor="reply">
            Reply
          </label>
          <textarea id="reply" name="body" required value={reply} onChange={(event) => setReply(event.target.value)} rows={4} className="rounded-[10px] border border-line bg-white px-3 py-2" />
          <input name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="max-w-full text-[14px]" />
          <button type="submit" disabled={pending} className="h-11 self-start rounded-[10px] bg-action px-4 text-[14px] font-semibold text-white disabled:opacity-40">
            {pending ? "Sending…" : "Reply"}
          </button>
        </form>
      )}
      {error ? <p className="mt-4 text-[14px] text-danger">{error}</p> : null}
      <section className="mt-10 border-t border-line pt-4 pb-8">
        <h2 className="text-[14px] font-semibold">Receipts</h2>
        {receipts.length === 0 ? <p className="mt-2 text-[13px] text-muted">No email has been sent yet.</p> : null}
        <ul className="mt-2 flex flex-col gap-2">
          {receipts.map((receipt) => (
            <li key={receipt.id} className="font-mono text-[13px] text-ink-soft">
              {receipt.state} · {[...receipt.to, ...receipt.cc].join(", ") || "no recipients"}
            </li>
          ))}
        </ul>
      </section>
      </div>
    </article>
  );
}
