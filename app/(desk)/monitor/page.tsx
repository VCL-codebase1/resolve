"use client";

import { Suspense } from "react";
import { Monitor } from "@/components/monitor";

export default function MonitorPage() {
  return (
    <Suspense fallback={<div className="mx-5 mt-6 h-px bg-line" />}>
      <Monitor />
    </Suspense>
  );
}
