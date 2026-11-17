"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, badgeText, type Person } from "./api";
import { WorkList } from "./lists";
import { useDesk } from "./provider";

type Summary = {
  raised: number;
  pending: number;
  resolved: number;
  closed: number;
  departments: { slug: string; name: string; unresolved: number }[];
};

const sections = [
  ["raised", "Raised", "Open, not picked up"],
  ["pending", "Pending", "In progress or waiting"],
  ["resolved", "Resolved", "Done, not closed"],
  ["closed", "Closed", "Finished"],
] as const;

export function Monitor() {
  const { me, badges, refresh } = useDesk();
  const params = useSearchParams();
  const bucket = params.get("bucket") || "raised";
  const department = params.get("department") || "";
  const [summary, setSummary] = useState<Summary | null>(null);
  const [reach, setReach] = useState<{ slug: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (me && me.role !== "admin") return;
    api<Summary>("/admin/summary")
      .then(setSummary)
      .catch((reason: Error) => setError(reason.message));
  }, [me, badges]);

  if (me && me.role !== "admin") {
    return <p className="px-4 py-8 text-[15px] min-[880px]:px-8">The monitor is for admins. Your tickets are in the inbox.</p>;
  }

  const counts: Record<string, number> = {
    raised: summary?.raised ?? badges.monitor?.raised ?? 0,
    pending: summary?.pending ?? badges.monitor?.pending ?? 0,
    resolved: summary?.resolved ?? badges.monitor?.resolved ?? 0,
    closed: summary?.closed ?? badges.monitor?.closed ?? 0,
  };

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!reach) return;
    setPending(true);
    setError("");
    try {
      await api("/admin/outreach", {
        method: "POST",
        body: JSON.stringify({ departmentSlug: reach.slug, note }),
      });
      setReach(null);
      setNote("");
      refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That note did not send.");
    } finally {
      setPending(false);
    }
  }

  const title = department
    ? summary?.departments.find((item) => item.slug === department)?.name || "Department"
    : sections.find((item) => item[0] === bucket)?.[1] || "Raised";

  return (
    <div>
      <header className="border-b border-line px-4 py-5 min-[880px]:px-8">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">Monitor</h1>
          <Link href="/directory" className="text-[14px] text-action">
            Directory
          </Link>
        </div>
        <p className="mt-1 max-w-[62ch] text-[15px] leading-6 text-ink-soft">
          Raised is still open. Pending is in progress or waiting. Resolved is done and not closed yet.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 min-[760px]:grid-cols-4">
          {sections.map(([key, name, hint]) => (
            <Link
              key={key}
              href={`/monitor?bucket=${key}`}
              className={`lift rounded-[18px] px-4 py-3 ${bucket === key && !department ? "ring-2 ring-ink" : ""}`}
            >
              <p className="text-[13px] text-muted">{name}</p>
              <p className="mt-2 font-mono text-[28px] font-medium leading-none tracking-tight">{counts[key]}</p>
              <p className="mt-2 text-[12px] leading-4 text-muted">{hint}</p>
            </Link>
          ))}
        </div>
      </header>
      <section className="border-b border-line">
        <h2 className="px-4 pt-5 text-[16px] font-semibold min-[880px]:px-8">Departments</h2>
        <ul className="mt-2">
          {summary?.departments.map((item) => (
            <li key={item.slug} className="flex items-center gap-3 border-t border-line px-4 py-3 min-[880px]:px-8">
              <Link href={`/monitor?bucket=pending&department=${item.slug}`} className="min-w-0 flex-1">
                <span className="block text-[15px]">{item.name}</span>
                <span className="text-[13px] text-muted">{item.unresolved === 0 ? "Clear" : `${item.unresolved} unresolved`}</span>
              </Link>
              {item.unresolved > 0 ? <span className="badge">{badgeText(item.unresolved)}</span> : null}
              {item.unresolved > 0 ? (
                <button type="button" className="h-11 shrink-0 text-[14px] text-action" onClick={() => setReach(item)}>
                  Reach out
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {error ? <p className="px-4 py-3 text-[14px] text-danger min-[880px]:px-8">{error}</p> : null}
      </section>
      <WorkList embedded bucket={bucket} department={department || undefined} title={title} lede="Tickets in this section, newest activity first." />
      {reach ? (
        <div className="fixed inset-0 z-50 flex items-end bg-[rgba(8,22,52,0.35)] min-[880px]:items-center min-[880px]:justify-center" onClick={() => setReach(null)}>
          <form onClick={(event) => event.stopPropagation()} onSubmit={send} className="glass w-full rounded-t-[28px] p-5 min-[880px]:max-w-lg min-[880px]:rounded-[28px]">
            <h2 className="text-[18px] font-semibold">Send to {reach.name}</h2>
            <p className="mt-1 text-[14px] text-ink-soft">Queue recipients get an alert and an email. This does not open a new ticket.</p>
            <textarea required value={note} onChange={(event) => setNote(event.target.value)} rows={5} maxLength={2000} className="mt-4 w-full rounded-[10px] border border-line px-3 py-2" />
            <div className="mt-4 flex gap-3">
              <button type="submit" disabled={pending} className="h-11 rounded-[10px] bg-action px-4 text-[14px] font-semibold text-white disabled:opacity-40">
                {pending ? "Sending…" : `Send to ${reach.name}`}
              </button>
              <button type="button" className="h-11 text-[14px] text-action" onClick={() => setReach(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

export function Directory() {
  const { me, departments } = useDesk();
  const router = useRouter();
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (me && me.role !== "admin") return;
    api<{ items: Person[] }>("/people")
      .then((body) => setPeople(body.items))
      .catch((reason: Error) => setError(reason.message));
  }, [me]);

  if (me && me.role !== "admin") return <p className="px-4 py-8 min-[880px]:px-8">The directory is for admins.</p>;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      await api("/people", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          password: form.get("password"),
          role: form.get("role"),
          departmentSlug: form.get("departmentSlug"),
          queueRecipient: form.get("queueRecipient") === "on",
        }),
      });
      const body = await api<{ items: Person[] }>("/people");
      setPeople(body.items);
      event.currentTarget.reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That person was not added.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <header className="border-b border-line px-4 py-5 min-[880px]:px-8">
        <button type="button" className="text-[14px] text-action" onClick={() => router.push("/monitor")}>
          Monitor
        </button>
        <h1 className="mt-2 text-[22px] font-semibold">Directory</h1>
        <p className="mt-1 text-[15px] text-ink-soft">Everyone who can sign in. Add a person here. There is no public sign-up.</p>
      </header>
      <ul>
        {people.map((person) => (
          <li key={person.id} className="flex items-baseline justify-between gap-4 border-b border-line px-4 py-3 min-[880px]:px-8">
            <span className="text-[15px]">
              {person.name}
              {!person.active ? " · Disabled" : ""}
            </span>
            <span className="text-right text-[13px] text-muted">
              {person.role} · {departments.find((item) => item.slug === person.departmentSlug)?.name}
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="grid max-w-md gap-3 px-4 py-6 min-[880px]:px-8">
        <h2 className="text-[18px] font-semibold">Add a person</h2>
        <input name="name" required placeholder="Name" className="h-11 rounded-[10px] border border-line px-3" />
        <input name="email" type="email" required placeholder="Work email" className="h-11 rounded-[10px] border border-line px-3" />
        <input name="password" required minLength={10} placeholder="Password, at least 10 characters" className="h-11 rounded-[10px] border border-line px-3" />
        <select name="role" className="h-11 rounded-[10px] border border-line px-3" defaultValue="member">
          <option value="member">Member</option>
          <option value="lead">Lead</option>
          <option value="admin">Admin</option>
        </select>
        <select name="departmentSlug" className="h-11 rounded-[10px] border border-line px-3" defaultValue={departments[0]?.slug}>
          {departments.map((department) => (
            <option key={department.slug} value={department.slug}>
              {department.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[14px]">
          <input name="queueRecipient" type="checkbox" />
          Copy them on the department queue
        </label>
        {error ? <p className="text-[14px] text-danger">{error}</p> : null}
        <button type="submit" disabled={pending} className="h-11 rounded-[10px] bg-action text-[14px] font-semibold text-white disabled:opacity-40">
          {pending ? "Adding…" : "Add person"}
        </button>
      </form>
    </section>
  );
}
