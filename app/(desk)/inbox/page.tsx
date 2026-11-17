"use client";

import { WorkList } from "@/components/lists";

export default function InboxPage() {
  return <WorkList scope="mine" title="Inbox" lede="Tickets you raised, were assigned, or watch. This is your staff desk." />;
}
