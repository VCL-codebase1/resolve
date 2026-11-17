"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, relativeTime, type Notice } from "./api";
import { useDesk } from "./provider";

export function Alerts() {
  const { live, refresh } = useDesk();
  const [items, setItems] = useState<Notice[] | null>(null);

  useEffect(() => {
    api<{ items: Notice[] }>("/notifications")
      .then((body) => setItems(body.items))
      .catch(() => setItems([]));
  }, [live]);

  async function open(item: Notice) {
    if (!item.read) {
      await api("/notifications/read", { method: "POST", body: JSON.stringify({ ids: [item.id] }) });
      refresh();
    }
  }

  return (
    <section>
      <div className="flex items-baseline justify-between border-b border-line px-4 py-5 min-[880px]:px-8">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">Alerts</h1>
          <p className="mt-1 text-[15px] text-ink-soft">Live notices for tickets you follow.</p>
        </div>
        <button
          type="button"
          className="h-11 text-[14px] text-action"
          onClick={() => {
            void api("/notifications/read", { method: "POST", body: JSON.stringify({ ids: [] }) }).then(refresh);
          }}
        >
          Mark all read
        </button>
      </div>
      {items && items.length === 0 ? <p className="px-5 py-8 text-[16px]">No alerts.</p> : null}
      <ul>
        {items?.map((item) => (
          <li key={item.id} className="border-b border-line">
            <Link href={item.ticketId ? `/tickets/${item.ticketId}` : "/queue"} onClick={() => void open(item)} className="block border-b border-line px-4 py-4 min-[880px]:px-8">
              <p className={item.read ? "text-[16px]" : "text-[16px] font-semibold"}>{item.sentence}</p>
              <p className="mt-1 text-[13px] text-muted">{relativeTime(item.createdAt)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
