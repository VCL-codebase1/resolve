"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { DeskProvider, useDesk } from "./provider";
import { api, badgeText } from "./api";
import { Composer } from "./composer";
import { Dialog } from "./dialog";
import { Logo, ThemeToggle } from "./brand";
import { Spinner } from "./spinner";
import { ToastList } from "./toasts";

const navigationIcons: Record<string, string> = {
  "/inbox": "M3 4h18v16H3z M3 13h5l2 3h4l2-3h5",
  "/queue": "M4 6h16M4 12h16M4 18h16",
  "/alerts": "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  "/monitor": "M3 3v18h18M7 16v-4M12 16V8M17 16V5",
  "/tasks": "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  "/directory": "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M20 21v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 3.13a4 4 0 0 1 0 7.75",
};

function Tab({ href, label, count, alert }: { href: string; label: string; count: number; alert?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`) || (href === "/inbox" && pathname.startsWith("/tickets"));
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[11px] leading-4 ${active ? "bg-wash font-semibold text-action" : "text-muted"}`}>
      <span className="relative flex h-6 w-8 items-center justify-center">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={navigationIcons[href]} />
        </svg>
        {count > 0 ? <span className={`absolute -right-2 -top-1 ${alert ? "badge badge-alert" : "badge"}`}>{badgeText(count)}</span> : null}
      </span>
      <span>{label}</span>
    </Link>
  );
}

function NavLink({ href, label, count, alert }: { href: string; label: string; count: number; alert?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/inbox" && pathname.startsWith(`${href}/`)) || (href === "/inbox" && pathname.startsWith("/tickets"));
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
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
    <div className="stage flex h-dvh flex-col overflow-hidden p-0 text-ink min-[880px]:flex-row min-[880px]:gap-3 min-[880px]:p-3">
      <aside className="glass sticky top-3 hidden h-[calc(100dvh-1.5rem)] w-[248px] shrink-0 flex-col rounded-[22px] px-3 py-4 min-[880px]:flex">
        <Link href={isAdmin ? "/monitor" : "/inbox"} className="flex h-12 items-center px-2">
          <Logo className="w-44" />
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
          <NavLink href="/tasks" label="Tasks" count={badges.tasks ?? 0} />
          <NavLink href="/tasks/reports" label="Task reports" count={0} />
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0 min-[880px]:gap-3">
        <header className="glass z-30 flex h-[calc(4rem+env(safe-area-inset-top))] w-full shrink-0 items-center gap-2 rounded-none border-b border-white/40 px-3 pt-[env(safe-area-inset-top)] min-[880px]:pt-0 min-[880px]:h-[4.5rem] min-[880px]:rounded-[18px] min-[880px]:border-0 min-[880px]:px-5">
          <Link href={isAdmin ? "/monitor" : "/inbox"} className="min-w-0 shrink min-[880px]:hidden">
            <Logo className="w-32 min-[400px]:w-40" />
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
            <button
              type="button"
              aria-label="Your profile"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-wash text-[13px] font-semibold text-action"
              onClick={() => setProfile(true)}
            >
              {me ? initials(me.name) : <Spinner className="size-4 text-action" label="Loading profile" />}
            </button>
            <button type="button" className="h-11 whitespace-nowrap rounded-xl bg-action px-3 min-[400px]:px-4 text-[14px] font-semibold text-white" onClick={() => setComposer(true)}>
              New ticket
            </button>
          </div>
        </header>
        <ToastList notes={notes} dismiss={dismiss} />
        <div className="pane min-h-0 flex-1 overflow-hidden rounded-none min-[880px]:rounded-[22px]">
          <div className="h-full overflow-y-auto overscroll-contain pb-[calc(5rem+env(safe-area-inset-bottom))] min-[880px]:pb-6">{children}</div>
        </div>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-2 pt-1 pb-[env(safe-area-inset-bottom)] min-[880px]:hidden">
        <div className={`grid h-16 ${isAdmin ? "grid-cols-6" : isLead ? "grid-cols-5" : "grid-cols-4"}`}>
          <Tab href="/inbox" label="Inbox" count={badges.inbox} />
          <Tab href="/queue" label="Queue" count={badges.queue} />
          <Tab href="/alerts" label="Alerts" count={badges.alerts} alert />
          <Tab href="/tasks" label="Tasks" count={badges.tasks ?? 0} />
          {isAdmin ? <Tab href="/monitor" label="Monitor" count={monitor} /> : null}
          {isAdmin ? <Tab href="/directory" label="Directory" count={0} /> : null}
          {isLead ? <Tab href="/directory" label="People" count={0} /> : null}
        </div>
      </nav>
      {profile && me ? (
        <Dialog titleId="profile-title" onClose={() => setProfile(false)}>
          <section className="px-6 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <div className="mb-5 flex items-center justify-between">
              <h2 id="profile-title" className="text-lg font-semibold">Your profile</h2>
              <button type="button" className="h-11 px-2 text-sm text-action" onClick={() => setProfile(false)}>Close</button>
            </div>
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
            <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
              <span className="text-sm text-muted">Appearance</span>
              <ThemeToggle />
            </div>
            <button type="button" className="h-11 text-sm text-action" onClick={() => setMuted(!muted)}>{muted ? "Turn sound on" : "Turn sound off"}</button>
            <button type="button" className="mt-3 block h-11 w-full rounded-xl border border-line text-sm text-action" onClick={() => void signOut()}>
              Sign out
            </button>
          </section>
        </Dialog>
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
