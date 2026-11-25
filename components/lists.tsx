"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, api, relativeTime, said, STATUS_LABEL, type Department, type Ticket } from "./api";
import { useDesk } from "./provider";

const names = (departments: Department[], slug: string) => departments.find((item) => item.slug === slug)?.name || slug;

const filters = [
  ["", "All"],
  ["open", "Open"],
  ["in_progress", "In progress"],
  ["waiting", "Waiting"],
  ["resolved", "Resolved"],
  ["closed", "Closed"],
] as const;

const chip: Record<Ticket["status"], string> = {
  open: "bg-wash text-action",
  in_progress: "bg-wash text-ink",
  waiting: "bg-waiting-bg text-waiting",
  resolved: "bg-resolved-bg text-resolved",
  closed: "bg-canvas text-muted",
};

export function WorkList({
  scope,
  bucket,
  department,
  title,
  lede,
  embedded,
}: {
  scope?: "mine" | "queue";
  bucket?: string;
  department?: string;
  title: string;
  lede: string;
  embedded?: boolean;
}) {
  const { live, departments, me, badges, toast } = useDesk();
  const [items, setItems] = useState<Ticket[] | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [more, setMore] = useState<{ key: string; cursor: string } | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const filterKey = `${debounced}|${status}|${scope || ""}|${bucket || ""}|${department || ""}|${live}`;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const cursor = more && more.key === filterKey ? more.cursor : undefined;
    const params = new URLSearchParams();
    params.set("limit", "20");
    if (debounced) params.set("q", debounced);
    if (cursor) params.set("cursor", cursor);
    let path = "/tickets";
    if (bucket) {
      path = "/admin/tickets";
      params.set("bucket", bucket);
      if (department) params.set("department", department);
    } else if (scope) {
      params.set("scope", scope);
      if (status) params.set("status", status);
    }
    let ignore = false;
    api<{ items: Ticket[]; nextCursor: string | null }>(`${path}?${params.toString()}`)
      .then((body) => {
        if (ignore) return;
        setItems((current) => (cursor ? [...(current ?? []), ...body.items] : body.items));
        setNext(body.nextCursor);
        setError("");
      })
      .catch((reason: unknown) => {
        if (ignore) return;
        const message = said(reason, "That list could not be loaded.");
        setError(message);
        if (reason instanceof ApiError && reason.status === 0) toast(message, "error");
      });
    return () => {
      ignore = true;
    };
  }, [filterKey, more, debounced, status, scope, bucket, department]);

  const home = departments.find((item) => item.slug === me?.departmentSlug)?.name;

  return (
    <div className="min-[1100px]:grid min-[1100px]:grid-cols-[minmax(0,1fr)_280px]">
      <section>
        <header className={`border-b border-line px-4 min-[880px]:px-8 ${embedded ? "py-3" : "py-5"}`}>
          <div className="flex items-baseline justify-between gap-3">
            {embedded ? <h2 className="text-[16px] font-semibold">{title}</h2> : <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>}
            <p className="shrink-0 font-mono text-[13px] text-muted">{items ? items.length : ""}</p>
          </div>
          {embedded ? null : <p className="mt-1 max-w-[62ch] text-[15px] leading-6 text-ink-soft">{lede}</p>}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title or ticket number"
            className="mt-4 h-11 w-full max-w-md rounded-[10px] border border-line bg-white px-3 text-[14px]"
          />
          {!bucket ? (
            <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 min-[880px]:mx-0 min-[880px]:px-0">
              {filters.map(([value, label]) => (
                <button
                  key={value || "all"}
                  type="button"
                  onClick={() => setStatus(value)}
                  className={`h-9 shrink-0 rounded-full px-3 text-[13px] ${status === value ? "bg-ink text-white" : "border border-line text-ink-soft"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
        </header>
        {error ? <p className="px-4 py-6 text-[15px] text-danger min-[880px]:px-8">{error}</p> : null}
        {items === null && !error ? <p className="px-4 py-8 text-[15px] text-muted min-[880px]:px-8">Loading…</p> : null}
        {items && items.length === 0 ? (
          <p className="px-4 py-10 text-[15px] leading-6 text-ink-soft min-[880px]:px-8">
            {title === "Queue" ? "Nothing is waiting on this department." : "Nothing in this list."}
          </p>
        ) : null}
        <ul>
          {items?.map((ticket) => (
            <li key={ticket.id} className="border-b border-line">
              <Link href={`/tickets/${ticket.id}`} className="flex items-start gap-3 px-4 py-3 min-[880px]:px-8 hover:bg-wash">
                <span className={`mt-0.5 shrink-0 rounded-md px-2 py-1 text-[12px] font-medium ${chip[ticket.status]}`}>
                  {STATUS_LABEL[ticket.status]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium leading-5">{ticket.title}</span>
                  <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[13px] leading-5 text-muted">
                    <span className="font-mono">{ticket.id}</span>
                    <span>
                      {names(departments, ticket.sourceDepartment)} → {names(departments, ticket.targetDepartment)}
                    </span>
                    {ticket.priority === "high" || ticket.priority === "urgent" ? <span>{ticket.priority === "urgent" ? "Urgent" : "High"}</span> : null}
                    <span>{ticket.requester.name}</span>
                    <span>{relativeTime(ticket.updatedAt)}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {next ? (
          <div className="px-4 py-4 min-[880px]:px-8">
            <button type="button" className="h-11 text-[14px] text-action" onClick={() => setMore({ key: filterKey, cursor: next })}>
              Load more
            </button>
          </div>
        ) : null}
      </section>
      <aside className="hidden border-l border-line px-5 py-6 min-[1100px]:block">
        <p className="text-[13px] font-medium text-muted">This desk</p>
        <p className="mt-2 text-[16px] font-semibold">{me?.name}</p>
        <p className="mt-1 text-[14px] leading-5 text-ink-soft">{home}</p>
        <dl className="mt-6 border-t border-line text-[14px]">
          <div className="flex justify-between border-b border-line py-3">
            <dt>Inbox</dt>
            <dd className="font-mono">{badges.inbox}</dd>
          </div>
          <div className="flex justify-between border-b border-line py-3">
            <dt>Queue</dt>
            <dd className="font-mono">{badges.queue}</dd>
          </div>
          <div className="flex justify-between border-b border-line py-3">
            <dt>Alerts</dt>
            <dd className="font-mono">{badges.alerts}</dd>
          </div>
        </dl>
        {me?.role === "admin" ? (
          <Link href="/monitor" className="mt-4 inline-flex text-[14px] text-action">
            Open the monitor
          </Link>
        ) : (
          <p className="mt-4 text-[13px] leading-5 text-muted">Leads assign and close tickets in the queue. Members follow the ones they raised.</p>
        )}
      </aside>
    </div>
  );
}
