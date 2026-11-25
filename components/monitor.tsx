"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, badgeText, type Department, type Person } from "./api";
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
  const [total, setTotal] = useState(0);
  const [catalog, setCatalog] = useState(departments);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<"" | "department" | "person">("");
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 8;

  useEffect(() => {
    if (departments.length) setCatalog(departments);
  }, [departments]);

  useEffect(() => {
    api<{ items: Department[] }>("/departments")
      .then((body) => setCatalog(body.items))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setPage(0);
  }, [debounced, departmentFilter]);

  async function loadPeople(nextPage = page) {
    const params = new URLSearchParams();
    params.set("limit", String(pageSize));
    params.set("offset", String(nextPage * pageSize));
    if (debounced) params.set("q", debounced);
    if (departmentFilter) params.set("department", departmentFilter);
    const body = await api<{ items: Person[]; total: number }>(`/people?${params.toString()}`);
    setPeople(body.items);
    setTotal(body.total);
  }

  useEffect(() => {
    if (me && me.role !== "admin") return;
    const params = new URLSearchParams();
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));
    if (debounced) params.set("q", debounced);
    if (departmentFilter) params.set("department", departmentFilter);
    let ignore = false;
    api<{ items: Person[]; total: number }>(`/people?${params.toString()}`)
      .then((body) => {
        if (ignore) return;
        setPeople(body.items);
        setTotal(body.total);
      })
      .catch((reason: Error) => {
        if (!ignore) setError(reason.message);
      });
    return () => {
      ignore = true;
    };
  }, [me, page, debounced, departmentFilter]);

  if (me && me.role !== "admin") return <p className="px-4 py-8 min-[880px]:px-8">The directory is for admins.</p>;

  async function addDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending("department");
    setError("");
    setNotice("");
    try {
      const created = await api<Department>("/departments", { method: "POST", body: JSON.stringify({ name: data.get("name") }) });
      setCatalog((current) => [...current.filter((item) => item.slug !== created.slug), created]);
      form.reset();
      setNotice("Department added.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That department was not added.");
    } finally {
      setPending("");
    }
  }

  async function addPerson(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending("person");
    setError("");
    setNotice("");
    try {
      await api("/people", {
        method: "POST",
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          password: data.get("password"),
          role: data.get("role"),
          departmentSlug: data.get("departmentSlug"),
          queueRecipient: data.get("role") === "lead" || data.get("queueRecipient") === "on",
        }),
      });
      await loadPeople(0);
      setPage(0);
      form.reset();
      setNotice("Person added.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That person was not added.");
    } finally {
      setPending("");
    }
  }

  async function makeHead(person: Person) {
    setError("");
    try {
      await api(`/people/${person.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: "lead", queueRecipient: true }),
      });
      await loadPeople(page);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That person was not made head.");
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>, person: Person) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    try {
      await api(`/people/${person.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password: form.get("password") }),
      });
      setResetFor(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The password was not changed.");
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const roleLabel = (role: string) => (role === "lead" ? "Head" : role === "admin" ? "Admin" : "Staff");

  return (
    <section>
      <header className="border-b border-line px-4 py-5 min-[880px]:px-8">
        <button type="button" className="text-[14px] text-action" onClick={() => router.push("/monitor")}>
          Monitor
        </button>
        <h1 className="mt-2 text-[22px] font-semibold">Directory</h1>
        <p className="mt-1 text-[15px] text-ink-soft">Departments, heads, and staff. There is no public sign-up.</p>
      </header>
      <div className="grid gap-6 border-b border-line px-4 py-5 min-[880px]:grid-cols-2 min-[880px]:px-8">
        <form onSubmit={addDepartment} className="lift grid gap-3 rounded-[22px] p-4">
          <h2 className="text-[16px] font-semibold">New department</h2>
          <input name="name" required placeholder="Department name" className="h-11 rounded-[10px] border border-line bg-white px-3" />
          <button type="submit" disabled={pending === "department"} className="h-11 rounded-[10px] bg-action text-[14px] font-semibold text-white disabled:opacity-40">
            {pending === "department" ? "Saving…" : "Add department"}
          </button>
        </form>
        <form onSubmit={addPerson} className="lift grid gap-3 rounded-[22px] p-4">
          <h2 className="text-[16px] font-semibold">Add a person</h2>
          <input name="name" required placeholder="Name" className="h-11 rounded-[10px] border border-line bg-white px-3" />
          <input name="email" type="email" required placeholder="Work email" className="h-11 rounded-[10px] border border-line bg-white px-3" />
          <input name="password" required minLength={10} placeholder="Password, at least 10 characters" className="h-11 rounded-[10px] border border-line bg-white px-3" />
          <select name="role" className="h-11 rounded-[10px] border border-line bg-white px-3" defaultValue="member">
            <option value="member">Member</option>
            <option value="lead">Department head</option>
            <option value="admin">Admin</option>
          </select>
          <select name="departmentSlug" className="h-11 rounded-[10px] border border-line bg-white px-3" defaultValue={catalog[0]?.slug}>
            {catalog.map((department) => (
              <option key={department.slug} value={department.slug}>
                {department.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-[14px]">
            <input name="queueRecipient" type="checkbox" />
            Copy them on the department queue
          </label>
          <button type="submit" disabled={pending === "person"} className="h-11 rounded-[10px] bg-action text-[14px] font-semibold text-white disabled:opacity-40">
            {pending === "person" ? "Saving…" : "Add person"}
          </button>
        </form>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4 min-[880px]:px-8">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name or email"
          className="h-11 min-w-56 flex-1 rounded-[10px] border border-line bg-white px-3 text-[14px]"
        />
        <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="h-11 rounded-[10px] border border-line bg-white px-3 text-[14px]">
          <option value="">All departments</option>
          {catalog.map((department) => (
            <option key={department.slug} value={department.slug}>
              {department.name}
            </option>
          ))}
        </select>
        <p className="text-[13px] text-muted">{total === 1 ? "1 person" : `${total} people`}</p>
      </div>
      {notice ? <p className="px-4 pt-4 text-[14px] text-action min-[880px]:px-8">{notice}</p> : null}
      {error ? <p className="px-4 pt-4 text-[14px] text-danger min-[880px]:px-8">{error}</p> : null}
      <ul>
        {people.map((person) => (
          <li key={person.id} className="border-b border-line px-4 py-3 min-[880px]:px-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <span className="text-[15px]">
                {person.name}
                {person.email ? ` · ${person.email}` : ""}
                {!person.active ? " · Disabled" : ""}
              </span>
              <span className="text-[13px] text-muted">
                {roleLabel(person.role)} · {catalog.find((item) => item.slug === person.departmentSlug)?.name || person.departmentSlug}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-3">
              {person.role !== "lead" && person.role !== "admin" ? (
                <button type="button" className="text-[14px] text-action" onClick={() => makeHead(person)}>
                  Make department head
                </button>
              ) : null}
              <button type="button" className="text-[14px] text-action" onClick={() => setResetFor(resetFor === person.id ? null : person.id)}>
                Set a new password
              </button>
            </div>
            {resetFor === person.id ? (
              <form onSubmit={(event) => resetPassword(event, person)} className="mt-2 flex flex-wrap gap-2">
                <input name="password" required minLength={10} type="text" placeholder="New password, at least 10 characters" className="h-11 min-w-64 flex-1 rounded-[10px] border border-line bg-white px-3" />
                <button type="submit" className="h-11 rounded-[10px] bg-action px-4 text-[14px] font-semibold text-white">
                  Save password
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {people.length === 0 ? <p className="px-4 py-8 text-[15px] text-ink-soft min-[880px]:px-8">No one matches this search.</p> : null}
      <div className="flex items-center justify-between px-4 py-4 min-[880px]:px-8">
        <button type="button" className="h-11 text-[14px] text-action disabled:opacity-40" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>
          Previous
        </button>
        <p className="text-[13px] text-muted">
          Page {page + 1} of {pages}
        </p>
        <button type="button" className="h-11 text-[14px] text-action disabled:opacity-40" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)}>
          Next
        </button>
      </div>
    </section>
  );
}
