"use client";

import { use } from "react";
import { Thread } from "@/components/thread";

export default function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <Thread id={id} />;
}
