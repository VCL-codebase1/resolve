"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DeskProvider, useDesk } from "./provider";
import { api, badgeText } from "./api";
import { Composer } from "./composer";

function Tab({ href, label, count, alert }: { href: string; label: string; count: number; alert?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`) || (href === "/inbox" && pathname.startsWith("/tickets"));
  return (
    <Link href={href} className={`flex h-full items-center justify-center gap-1 rounded-full px-1 text-[12px] ${active ? "bg-white/80 font-semibold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]" : "text-muted"}`}>
      <span>{label}</span>
      {count > 0 ? <span className={alert ? "badge badge-alert" : "badge"}>{badgeText(count)}</span> : null}
    </Link>
  );
}

function NavLink({ href, label, count, alert }: { href: string; label: string; count: number; alert?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/inbox" && pathname.startsWith(`${href}/`)) || (href === "/inbox" && pathname.startsWith("/tickets"));
  return (
    <Link
      href={href}
      className={`flex min-h-11 items-center justify-between gap-3 rounded-[14px] px-3 text-[14px] ${active ? "bg-white/75 font-semibold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_4px_12px_rgba(8,22,52,0.05)]" : "text-ink-soft"}`}
    >
      <span>{label}</span>
      {count > 0 ? <span className={alert ? "badge badge-alert" : "badge"}>{badgeText(count)}</span> : null}
    </Link>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "D";
}

function Chrome({ children }: { children: React.ReactNode }) {
  const { me, badges, departments, muted, setMuted, setComposer, notes, dismiss } = useDesk();
  const router = useRouter();
  const [profile, setProfile] = useState(false);
  const department = departments.find((item) => item.slug === me?.departmentSlug)?.name;
  const monitor = me?.role === "admin" ? (badges.monitor?.raised ?? 0) + (badges.monitor?.pending ?? 0) : 0;
  const role = me?.role === "admin" ? "Admin" : me?.role === "lead" ? "Head" : "Staff";

  async function signOut() {
    await api("/auth/logout", { method: "POST" });
    router.replace("/");
  }

  return (
    <div className="stage min-h-dvh p-2 text-ink min-[880px]:flex min-[880px]:gap-3 min-[880px]:p-3">
      <aside className="glass sticky top-3 hidden h-[calc(100dvh-1.5rem)] w-[248px] shrink-0 flex-col rounded-[22px] px-3 py-4 min-[880px]:flex">
        <Link href="/inbox" className="px-3 text-[16px] font-semibold">
          Desk
        </Link>
        <button type="button" className="mx-1 mt-4 flex items-center gap-3 rounded-[14px] px-2 py-2 text-left" onClick={() => setProfile(true)}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-wash text-[13px] font-semibold text-action">
            {initials(me?.name || "")}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-semibold">{me?.name}</span>
            <span className="mt-0.5 block truncate text-[13px] text-muted">{role}</span>
          </span>
        </button>
        <nav className="mt-4 flex flex-col gap-1">
          <NavLink href="/inbox" label="Inbox" count={badges.inbox} />
          <NavLink href="/queue" label="Queue" count={badges.queue} />
          <NavLink href="/alerts" label="Alerts" count={badges.alerts} alert />
          {me?.role === "admin" ? <NavLink href="/monitor" label="Monitor" count={monitor} /> : null}
          {me?.role === "admin" ? <NavLink href="/directory" label="Directory" count={0} /> : null}
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          <button type="button" className="h-11 rounded-[14px] px-3 text-left text-[14px] text-ink-soft" onClick={() => setMuted(!muted)}>
            {muted ? "Sound off" : "Sound on"}
          </button>
          <button type="button" className="h-11 rounded-[14px] px-3 text-left text-[14px] text-action" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-2 min-[880px]:gap-3">
        <header className="glass sticky top-2 z-30 flex h-14 shrink-0 items-center gap-3 rounded-[18px] px-4 min-[880px]:top-3">
          <p className="text-[15px] font-semibold min-[880px]:hidden">Desk</p>
          <p className="hidden min-w-0 truncate text-[14px] text-muted min-[880px]:block">
            {department} · {role}
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Your profile"
              className="flex size-10 items-center justify-center rounded-full bg-wash text-[13px] font-semibold text-action"
              onClick={() => setProfile(true)}
            >
              {initials(me?.name || "")}
            </button>
            <button type="button" className="h-10 rounded-full bg-action px-4 text-[14px] font-semibold text-white" onClick={() => setComposer(true)}>
              New ticket
            </button>
          </div>
        </header>
        <div className="pointer-events-none fixed inset-x-3 top-20 z-40 flex flex-col items-center gap-2 min-[880px]:left-[280px]">
          {notes.slice(0, 2).map((note) => (
            <button key={note.id} type="button" className="glass pointer-events-auto w-full max-w-lg rounded-[18px] px-4 py-3 text-left text-[14px]" onClick={() => dismiss(note.id)}>
              {note.sentence}
            </button>
          ))}
        </div>
        <div className="pane min-h-[calc(100dvh-7.5rem)] overflow-hidden rounded-[22px] min-[880px]:min-h-0 min-[880px]:flex-1">
          <div className="h-full overflow-auto pb-28 min-[880px]:pb-6">{children}</div>
        </div>
      </div>
      <nav className="glass fixed inset-x-3 bottom-3 z-30 rounded-[22px] p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] min-[880px]:hidden">
        <div className={`grid h-12 ${me?.role === "admin" ? "grid-cols-4" : "grid-cols-3"}`}>
          <Tab href="/inbox" label="Inbox" count={badges.inbox} />
          <Tab href="/queue" label="Queue" count={badges.queue} />
          <Tab href="/alerts" label="Alerts" count={badges.alerts} alert />
          {me?.role === "admin" ? <Tab href="/monitor" label="Monitor" count={monitor} /> : null}
        </div>
      </nav>
      {profile && me ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(8,22,52,0.28)] min-[760px]:items-center" onClick={() => setProfile(false)}>
          <section onClick={(event) => event.stopPropagation()} className="pane w-full rounded-t-[28px] px-6 py-6 min-[760px]:max-w-sm min-[760px]:rounded-[28px]">
            <div className="flex items-center gap-4">
              <span className="flex size-14 items-center justify-center rounded-full bg-action text-[18px] font-semibold text-white">
                {initials(me.name)}
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-[18px] font-semibold">{me.name}</h2>
                <p className="truncate text-[14px] text-muted">{me.email}</p>
              </div>
            </div>
            <dl className="mt-5 border-t border-line text-[14px]">
              <div className="flex justify-between gap-4 border-b border-line py-3">
                <dt className="text-muted">Role</dt>
                <dd>{role}</dd>
              </div>
              <div className="flex justify-between gap-4 py-3">
                <dt className="text-muted">Department</dt>
                <dd className="text-right">{department || "Not set"}</dd>
              </div>
            </dl>
            <button type="button" className="mt-4 h-11 text-[14px] text-action" onClick={() => void signOut()}>
              Sign out
            </button>
          </section>
        </div>
      ) : null}
      <Composer />
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <DeskProvider>
      <Chrome>{children}</Chrome>
    </DeskProvider>
  );
}
