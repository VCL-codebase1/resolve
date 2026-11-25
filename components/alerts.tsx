"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, api, relativeTime, said, type Notice } from "./api";
import { useDesk } from "./provider";
import { Spinner, SpinnerBlock } from "./spinner";

export function Alerts() {
  const { live, refresh, toast } = useDesk();
  const [items, setItems] = useState<Notice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [more, setMore] = useState<{ key: string; cursor: string } | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const filterKey = `${debounced}|${live}`;

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
    let ignore = false;
    if (cursor) setLoadingMore(true);
    else {
      setLoading(true);
      setLoadingMore(false);
    }
    api<{ items: Notice[]; nextCursor: string | null }>(`/notifications?${params.toString()}`)
      .then((body) => {
        if (ignore) return;
        setItems((current) => (cursor ? [...(current ?? []), ...body.items] : body.items));
        setNext(body.nextCursor);
      })
      .catch((reason: unknown) => {
        if (ignore) return;
        if (!cursor) setItems([]);
        if (reason instanceof ApiError && reason.status === 0) toast(said(reason, "Alerts could not be loaded."), "error");
      })
      .finally(() => {
        if (ignore) return;
        setLoading(false);
        setLoadingMore(false);
      });
    return () => {
      ignore = true;
    };
  }, [filterKey, more, debounced]);

  async function open(item: Notice) {
    if (!item.read) {
      try {
        await api("/notifications/read", { method: "POST", body: JSON.stringify({ ids: [item.id] }) });
        refresh();
      } catch (reason) {
        toast(said(reason, "That alert could not be marked read."), "error");
      }
    }
  }

  return (
    <section>
      <div className="flex flex-col gap-3 border-b border-line px-4 py-5 min-[560px]:flex-row min-[560px]:items-baseline min-[560px]:justify-between min-[880px]:px-8">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">Alerts</h1>
          <p className="mt-1 text-[15px] text-ink-soft">Live notices for tickets you follow.</p>
        </div>
        <div className="flex items-center gap-3">
          {loading ? <Spinner className="size-4 text-action" label="Loading alerts" /> : null}
          <button
            type="button"
            className="h-11 text-[14px] text-action"
            onClick={() => {
              void api("/notifications/read", { method: "POST", body: JSON.stringify({ ids: [] }) })
                .then(() => {
                  refresh();
                  toast("Alerts marked read.");
                })
                .catch((reason: unknown) => toast(said(reason, "Alerts could not be marked read."), "error"));
            }}
          >
            Mark all read
          </button>
        </div>
      </div>
      <div className="border-b border-line px-4 py-3 min-[880px]:px-8">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search alerts"
          placeholder="Search alerts"
          className="h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] min-[560px]:max-w-md"
        />
      </div>
      {loading && items === null ? <SpinnerBlock label="Loading alerts" /> : null}
      {!loading && items && items.length === 0 ? <p className="px-4 py-8 text-[16px] min-[880px]:px-8">No alerts.</p> : null}
      <ul className={loading && items ? "opacity-60" : ""} aria-busy={loading}>
        {items?.map((item) => (
          <li key={item.id} className="border-b border-line">
            <Link href={item.ticketId ? `/tickets/${item.ticketId}` : "/queue"} onClick={() => void open(item)} className="block px-4 py-4 min-[880px]:px-8">
              <p className={`break-words text-[15px] min-[480px]:text-[16px] ${item.read ? "" : "font-semibold"}`}>{item.sentence}</p>
              <p className="mt-1 text-[13px] text-muted">{relativeTime(item.createdAt)}</p>
            </Link>
          </li>
        ))}
      </ul>
      {next ? (
        <div className="px-4 py-4 min-[880px]:px-8">
          <button
            type="button"
            disabled={loadingMore}
            className="inline-flex h-11 items-center gap-2 text-[14px] text-action disabled:opacity-60"
            onClick={() => setMore({ key: filterKey, cursor: next })}
          >
            {loadingMore ? <Spinner className="size-4 text-current" label="Loading more alerts" /> : null}
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
