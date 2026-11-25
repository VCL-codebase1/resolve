"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DeskProvider, useDesk } from "./provider";
import { api, badgeText } from "./api";
import { Composer } from "./composer";
import { Logo, ThemeToggle } from "./brand";
import { Spinner } from "./spinner";
import { ToastList } from "./toasts";

function Tab({ href, label, count, alert }: { href: string; label: string; count: number; alert?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`) || (href === "/inbox" && pathname.startsWith("/tickets"));
  return (
    <Link href={href} className={`flex h-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-[18px] px-0.5 text-[11px] ${active ? "bg-wash font-semibold text-ink" : "text-muted"}`}>
      <span className="flex h-4 items-center">
        {count > 0 ? <span className={alert ? "badge badge-alert" : "badge"}>{badgeText(count)}</span> : null}
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

function NavLink({ href, label, count, alert }: { href: string; label: string; count: number; alert?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/inbox" && pathname.startsWith(`${href}/`)) || (href === "/inbox" && pathname.startsWith("/tickets"));
  return (
    <Link
      href={href}
      className={`flex min-h-11 items-center justify-between gap-3 rounded-[14px] px-3 text-[14px] ${active ? "bg-wash font-semibold text-ink" : "text-ink-soft"}`}
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
  const { me, badges, departments, muted, setMuted, setComposer, notes, dismiss, toast } = useDesk();
  const router = useRouter();
  const [profile, setProfile] = useState(false);
  const [knownRole, setKnownRole] = useState<string | null>(null);
  const department = departments.find((item) => item.slug === me?.departmentSlug)?.name;
  const roleName = me?.role ?? knownRole;
  const isAdmin = roleName === "admin";
  const isLead = roleName === "lead";
  const monitor = isAdmin ? (badges.monitor?.raised ?? 0) + (badges.monitor?.pending ?? 0) : 0;
  const role = roleName === "admin" ? "Superadmin" : roleName === "lead" ? "Head" : roleName ? "Staff" : "";

  useEffect(() => {
    setKnownRole(sessionStorage.getItem("desk-role"));
  }, []);

  useEffect(() => {
    if (!me) return;
    sessionStorage.setItem("desk-role", me.role);
    setKnownRole(me.role);
  }, [me]);

  async function signOut() {
    try {
      await api("/auth/logout", { method: "POST" });
      sessionStorage.removeItem("desk-role");
      router.replace("/");
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : "Could not sign out.", "error");
    }
  }

  return (
    <div className="stage min-h-dvh p-0 text-ink min-[880px]:flex min-[880px]:gap-3 min-[880px]:p-3">
      <aside className="glass sticky top-3 hidden h-[calc(100dvh-1.5rem)] w-[248px] shrink-0 flex-col rounded-[22px] px-3 py-4 min-[880px]:flex">
        <Link href={isAdmin ? "/monitor" : "/inbox"} className="px-1 py-1">
          <Logo className="h-11 w-auto" />
        </Link>
        <button type="button" className="mx-1 mt-4 flex items-center gap-3 rounded-[14px] px-2 py-2 text-left" onClick={() => setProfile(true)}>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-wash text-[13px] font-semibold text-action">
            {me ? initials(me.name) : <Spinner className="size-4 text-action" label="Loading profile" />}
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
          {isAdmin ? <NavLink href="/monitor" label="Monitor" count={monitor} /> : null}
          {isAdmin ? <NavLink href="/directory" label="Directory" count={0} /> : null}
          {isLead ? <NavLink href="/directory" label="People" count={0} /> : null}
        </nav>
        <div className="mt-auto flex flex-col gap-1">
          <ThemeToggle />
          <button type="button" className="h-11 rounded-[14px] px-3 text-left text-[14px] text-ink-soft" onClick={() => setMuted(!muted)}>
            {muted ? "Sound off" : "Sound on"}
          </button>
          <button type="button" className="h-11 rounded-[14px] px-3 text-left text-[14px] text-action" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-0 min-[880px]:gap-3">
        <header className="glass sticky top-0 z-30 flex h-16 w-full shrink-0 items-center gap-2 rounded-none border-b border-white/40 px-3 min-[880px]:h-[4.5rem] min-[880px]:rounded-[18px] min-[880px]:border-0 min-[880px]:px-5">
          <Link href={isAdmin ? "/monitor" : "/inbox"} className="min-w-0 shrink min-[880px]:hidden">
            <Logo className="h-auto w-24 min-[400px]:w-32" />
          </Link>
          <p className="hidden min-w-0 items-center truncate text-[14px] text-muted min-[880px]:flex">
            {me ? (
              <>
                {department} · {role}
              </>
            ) : (
              <Spinner className="size-4 text-muted" label="Loading your desk" />
            )}
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-1 min-[400px]:gap-2">
            <span className="min-[880px]:hidden">
              <ThemeToggle />
            </span>
            <button
              type="button"
              aria-label="Your profile"
              className="flex size-10 items-center justify-center rounded-full bg-wash text-[13px] font-semibold text-action"
              onClick={() => setProfile(true)}
            >
              {me ? initials(me.name) : <Spinner className="size-4 text-action" label="Loading profile" />}
            </button>
            <button type="button" className="h-11 rounded-full bg-action px-3 min-[400px]:px-4 text-[14px] font-semibold text-white" onClick={() => setComposer(true)}>
              New ticket
            </button>
          </div>
        </header>
        <ToastList notes={notes} dismiss={dismiss} />
        <div className="pane min-h-[calc(100dvh-4rem)] overflow-hidden rounded-none min-[880px]:min-h-0 min-[880px]:flex-1 min-[880px]:rounded-[22px]">
          <div className="h-full overflow-auto pb-28 min-[880px]:pb-6">{children}</div>
        </div>
      </div>
      <nav className="glass fixed inset-x-3 bottom-3 z-30 rounded-[22px] p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] min-[880px]:hidden">
        <div className={`grid h-14 ${isAdmin ? "grid-cols-5" : isLead ? "grid-cols-4" : "grid-cols-3"}`}>
          <Tab href="/inbox" label="Inbox" count={badges.inbox} />
          <Tab href="/queue" label="Queue" count={badges.queue} />
          <Tab href="/alerts" label="Alerts" count={badges.alerts} alert />
          {isAdmin ? <Tab href="/monitor" label="Monitor" count={monitor} /> : null}
          {isAdmin ? <Tab href="/directory" label="Directory" count={0} /> : null}
          {isLead ? <Tab href="/directory" label="People" count={0} /> : null}
        </div>
      </nav>
      {profile && me ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(8,22,52,0.28)] min-[760px]:items-center" onClick={() => setProfile(false)}>
          <section onClick={(event) => event.stopPropagation()} className="pane max-h-[90dvh] w-full overflow-y-auto rounded-t-[28px] px-6 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] min-[760px]:max-w-sm min-[760px]:rounded-[28px]">
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
