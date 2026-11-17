"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DEPARTMENT_NAMES, DEPARTMENT_SLUGS } from "@/lib/labels";
import { api, type Me } from "./api";

const steps = [
  ["01", "Raise", "Write the request and name the department that should do the work."],
  ["02", "Pick up", "That queue assigns someone. Replies stay on the same thread."],
  ["03", "Close", "Mark it resolved, then closed. The receipt list shows who was emailed."],
];

export function Landing() {
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<Me>("/me").then(setMe).catch(() => setMe(null));
  }, []);

  const enter = me ? (me.role === "admin" ? "/monitor" : "/inbox") : "/login";

  return (
    <div className="stage min-h-dvh text-ink">
      <header className="glass fixed inset-x-4 top-4 z-20 mx-auto flex h-14 max-w-6xl items-center justify-between rounded-[18px] px-4 min-[840px]:inset-x-6">
        <span className="text-[16px] font-semibold tracking-tight">Desk</span>
        <div className="flex items-center gap-4">
          <Link href="/admin" className="text-[14px] text-action">
            Admin
          </Link>
          <Link href={enter} className="inline-flex h-10 items-center bg-action px-4 text-[14px] font-semibold text-white">
            {me ? "Open desk" : "Sign in"}
          </Link>
        </div>
      </header>

      <section className="flex min-h-dvh items-center px-5 pb-16 pt-28 min-[840px]:px-8">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 min-[840px]:grid-cols-[minmax(0,1fr)_380px]">
          <div>
            <p className="rise flex items-center gap-2 text-[13px] font-medium text-action">
              <span className="live-dot inline-block size-1.5 rounded-full bg-signal" aria-hidden />
              VethanCon
            </p>
            <h1 className="rise rise-2 mt-4 max-w-[12ch] text-[40px] font-semibold leading-[1.05] tracking-tight min-[840px]:text-[64px]">
              Tickets between departments.
            </h1>
            <p className="rise rise-3 mt-5 max-w-[42ch] text-[16px] leading-7 text-ink-soft min-[840px]:text-[18px]">
              Someone in one department raises a request to another. The thread, the assignment, and the email receipts stay on that ticket.
            </p>
            <div className="rise rise-4 mt-8 flex flex-wrap items-center gap-4">
              <Link href={enter} className="inline-flex h-11 items-center bg-action px-5 text-[15px] font-semibold text-white">
                {me ? "Continue to your desk" : "Staff sign in"}
              </Link>
              <a href="#departments" className="inline-flex h-11 items-center text-[15px] text-action">
                Nine queues
              </a>
            </div>
          </div>

          <article className="drift lift overflow-hidden rounded-[22px]">
            <div className="flex items-center justify-between gap-3 border-b border-line bg-canvas px-4 py-2.5">
              <span className="font-mono text-[12px] text-muted">Example · VC-1042</span>
              <span className="rounded-md bg-wash px-2 py-0.5 text-[12px] font-medium text-action">Open</span>
            </div>
            <div className="px-4 py-4">
              <h2 className="text-[16px] font-semibold leading-6">Power drop for the Scientifika booth</h2>
              <p className="mt-1 text-[13px] text-muted">Sales → Exhibition · High</p>
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-[14px] leading-6">The booth drops when the hall lights come up. Can Exhibition take a look before Friday?</p>
                <p className="mt-1 text-[12px] text-muted">Tunde Bakare · Sales</p>
              </div>
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-[14px] leading-6">Spare circuit is on the floor. Picking this up now.</p>
                <p className="mt-1 text-[12px] text-muted">Chioma Eze · Exhibition</p>
              </div>
              <p className="mt-4 border-t border-line pt-3 font-mono text-[12px] text-muted">Receipt sent · exhibition queue</p>
            </div>
          </article>
        </div>
      </section>

      <main className="pane mx-4 mb-4 rounded-[28px] px-5 pb-16 pt-2 min-[840px]:mx-6">
        <div className="mx-auto max-w-6xl">
          <section className="grid border-b border-line min-[840px]:grid-cols-3">
            {steps.map(([index, title, copy]) => (
              <article
                key={title}
                className="border-b border-line py-6 min-[840px]:border-b-0 min-[840px]:px-5 min-[840px]:first:pl-0 min-[840px]:last:pr-0"
              >
                <p className="font-mono text-[12px] text-muted">{index}</p>
                <h2 className="mt-1 text-[16px] font-semibold">{title}</h2>
                <p className="mt-1 text-[14px] leading-6 text-ink-soft">{copy}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-4 border-b border-line py-8 min-[840px]:grid-cols-2">
            <article className="lift rounded-[22px] p-4">
              <h2 className="text-[16px] font-semibold">Staff desk</h2>
              <p className="mt-1 text-[14px] leading-6 text-ink-soft">Your tickets, and the queue for your department.</p>
              <ul className="mt-3 border-t border-line text-[14px]">
                <li className="flex justify-between gap-4 border-b border-line py-2.5">
                  <span>Inbox</span>
                  <span className="text-muted">Raised, assigned, or watched</span>
                </li>
                <li className="flex justify-between gap-4 border-b border-line py-2.5">
                  <span>Queue</span>
                  <span className="text-muted">Aimed at your department</span>
                </li>
                <li className="flex justify-between gap-4 py-2.5">
                  <span>Alerts</span>
                  <span className="text-muted">Replies and status changes</span>
                </li>
              </ul>
            </article>
            <article className="lift rounded-[22px] p-4">
              <h2 className="text-[16px] font-semibold">Admin monitor</h2>
              <p className="mt-1 text-[14px] leading-6 text-ink-soft">The same desk, plus a view across every queue.</p>
              <ul className="mt-3 border-t border-line text-[14px]">
                <li className="flex justify-between gap-4 border-b border-line py-2.5">
                  <span>Raised</span>
                  <span className="text-muted">Still open</span>
                </li>
                <li className="flex justify-between gap-4 border-b border-line py-2.5">
                  <span>Pending</span>
                  <span className="text-muted">In progress or waiting</span>
                </li>
                <li className="flex justify-between gap-4 border-b border-line py-2.5">
                  <span>Resolved / Closed</span>
                  <span className="text-muted">Finished work</span>
                </li>
                <li className="flex justify-between gap-4 py-2.5">
                  <span>Reach out</span>
                  <span className="text-muted">A note to a queue, not a new ticket</span>
                </li>
              </ul>
            </article>
          </section>

          <section id="departments" className="py-8">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-[16px] font-semibold">Queues</h2>
              <p className="text-[13px] text-muted">One home department each</p>
            </div>
            <ul className="mt-3 grid gap-2 min-[560px]:grid-cols-2 min-[840px]:grid-cols-3">
              {DEPARTMENT_SLUGS.map((slug) => (
                <li key={slug} className="lift rounded-[16px] px-3 py-2.5">
                  <p className="text-[14px] leading-5">{DEPARTMENT_NAMES[slug]}</p>
                  <p className="mt-0.5 font-mono text-[12px] text-muted">{slug}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
