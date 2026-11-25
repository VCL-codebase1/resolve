"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LottieSvg } from "lottie-react";
import mark from "@/public/resolve-mark.json";
import { api, type Me } from "./api";
import { Logo, ThemeToggle } from "./brand";
import { Spinner } from "./spinner";

const steps = [
  ["01", "Raise", "Write the request and name the department that should do the work."],
  ["02", "Pick up", "That queue assigns someone. Replies stay on the same thread."],
  ["03", "Close", "Mark it resolved, then closed. The receipt list shows who was emailed."],
];

export function Landing() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    api<Me>("/me").then(setMe).catch(() => setMe(null));
    const nodes = document.querySelectorAll("[data-reveal]");
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) entry.target.classList.add("slide-in");
      }
    }, { threshold: 0.2 });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const enter = me ? (me.role === "admin" ? "/monitor" : "/inbox") : "/login";

  return (
    <div className="stage min-h-dvh text-ink">
      <header className="glass fixed inset-x-0 top-0 z-20 flex h-[calc(4rem+env(safe-area-inset-top))] w-full items-center justify-between gap-3 border-b border-white/50 px-4 pt-[env(safe-area-inset-top)] min-[840px]:h-24 min-[840px]:pt-0 min-[840px]:px-10">
        <Link href="/" className="min-w-0 shrink">
          <Logo className="w-28 min-[400px]:w-40 min-[840px]:w-56" />
        </Link>
        <div className="flex shrink-0 items-center gap-2 min-[840px]:gap-3">
          <ThemeToggle />
          <Link href="/admin" className="hidden h-11 items-center text-[14px] text-action min-[480px]:inline-flex">
            Admin
          </Link>
          {me === undefined ? (
            <span className="inline-flex h-11 rounded-xl items-center bg-action px-4 text-[14px] font-semibold text-white min-[840px]:px-5">
              <Spinner className="size-4 text-white" label="Checking your session" />
            </span>
          ) : (
            <Link href={enter} className="inline-flex h-11 rounded-xl items-center bg-action px-4 text-[14px] font-semibold text-white min-[840px]:px-5">
              {me ? "Open" : "Sign in"}
            </Link>
          )}
        </div>
      </header>

      <section className="flex min-h-dvh items-center px-4 pb-12 pt-24 min-[840px]:px-10 min-[840px]:pb-16 min-[840px]:pt-36">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-8 min-[840px]:grid-cols-[minmax(0,1fr)_380px] min-[840px]:gap-x-12">
          <div className="min-w-0">
            <p className="rise flex items-center gap-2 text-[13px] font-medium text-action">
              <span className="live-dot inline-block size-1.5 rounded-full bg-signal" aria-hidden />
              VethanCon
            </p>
            <h1 className="rise rise-2 mt-4 max-w-[12ch] text-[32px] font-semibold leading-[1.08] tracking-tight min-[480px]:text-[40px] min-[840px]:text-[64px] min-[840px]:leading-[1.05]">
              Tickets between departments.
            </h1>
            <p className="rise rise-3 mt-4 max-w-[42ch] text-[15px] leading-7 text-ink-soft min-[840px]:mt-5 min-[840px]:text-[18px]">
              Someone in one department raises a request to another. The thread, the assignment, and the email receipts stay on that ticket.
            </p>
            <div className="rise rise-4 mt-6 flex flex-col gap-3 min-[480px]:mt-8 min-[480px]:flex-row min-[480px]:flex-wrap min-[480px]:items-center min-[480px]:gap-4">
              {me === undefined ? (
                <span className="inline-flex h-11 rounded-xl w-full items-center justify-center bg-action px-5 text-[15px] font-semibold text-white min-[480px]:w-auto">
                  <Spinner className="size-4 text-white" label="Checking your session" />
                </span>
              ) : (
                <Link href={enter} className="inline-flex h-11 rounded-xl w-full items-center justify-center bg-action px-5 text-[15px] font-semibold text-white min-[480px]:w-auto">
                  {me ? "Continue to your desk" : "Staff sign in"}
                </Link>
              )}
              <Link href="/admin" className="inline-flex h-11 rounded-xl items-center justify-center text-[15px] text-action min-[480px]:hidden">
                Admin sign in
              </Link>
            </div>
          </div>

          <div className="flex justify-center" aria-hidden="true">
            <LottieSvg src={mark} loop autoplay className="h-44 w-44 min-[480px]:h-56 min-[480px]:w-56 min-[840px]:h-80 min-[840px]:w-80" />
          </div>
        </div>
      </section>

      <main className="pane mx-3 mb-4 rounded-[22px] px-4 pb-12 pt-2 min-[480px]:mx-4 min-[480px]:rounded-[28px] min-[480px]:px-5 min-[480px]:pb-16 min-[840px]:mx-6">
        <div className="mx-auto max-w-6xl">
          <section className="grid gap-3 py-6 min-[560px]:gap-4 min-[560px]:py-8 min-[840px]:grid-cols-3">
            {steps.map(([index, title, copy]) => (
              <article
                key={title}
                data-reveal
                className="lift rounded-[28px] border border-white/80 p-5 shadow-[0_18px_40px_rgba(12,77,162,0.08)]"
              >
                <p className="font-mono text-[12px] text-muted">{index}</p>
                <h2 className="mt-1 text-[16px] font-semibold">{title}</h2>
                <p className="mt-1 text-[14px] leading-6 text-ink-soft">{copy}</p>
              </article>
            ))}
          </section>


        </div>
      </main>
    </div>
  );
}
