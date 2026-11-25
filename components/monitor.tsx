"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ApiError, api, badgeText, said, type Department, type Person } from "./api";
import { WorkList } from "./lists";
import { Dialog } from "./dialog";
import { useDesk } from "./provider";
import { PendingLabel, Spinner, SpinnerBlock } from "./spinner";

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
  const { me, badges, refresh, toast } = useDesk();
  const params = useSearchParams();
  const bucket = params.get("bucket") || "raised";
  const department = params.get("department") || "";
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [reach, setReach] = useState<{ slug: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (me && me.role !== "admin") {
      setLoading(false);
      return;
    }
    let ignore = false;
    setLoading(true);
    api<Summary>("/admin/summary")
      .then((body) => {
        if (!ignore) setSummary(body);
      })
      .catch((reason: unknown) => {
        if (ignore) return;
        const message = said(reason, "The monitor could not be loaded.");
        setError(message);
        if (reason instanceof ApiError && reason.status === 0) toast(message, "error");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
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
      toast(`Note sent to ${reach.name}.`);
    } catch (reason) {
      const message = said(reason, "That note did not send.");
      setError(message);
      toast(message, "error");
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
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[22px] font-semibold tracking-tight">Monitor</h1>
          <span className="flex items-center gap-3">
            {loading && summary ? <Spinner className="size-4 text-action" label="Refreshing the monitor" /> : null}
            <Link href="/directory" className="text-[14px] text-action">
              Directory
            </Link>
          </span>
        </div>
        <p className="mt-1 max-w-[62ch] text-[15px] leading-6 text-ink-soft">
          Raised is still open. Pending is in progress or waiting. Resolved is done and not closed yet.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2 min-[480px]:gap-3 min-[760px]:grid-cols-4">
          {sections.map(([key, name, hint]) => (
            <Link
              key={key}
              href={`/monitor?bucket=${key}`}
              className={`lift rounded-[18px] px-4 py-3 ${bucket === key && !department ? "ring-2 ring-ink" : ""}`}
            >
              <p className="text-[13px] text-muted">{name}</p>
              <p className="mt-2 flex h-7 items-center font-mono text-[28px] font-medium leading-none tracking-tight">
                {summary === null && loading ? <Spinner className="size-6 text-action" label={`Loading ${name}`} /> : counts[key]}
              </p>
              <p className="mt-2 text-[12px] leading-4 text-muted">{hint}</p>
            </Link>
          ))}
        </div>
      </header>
      <section className="border-b border-line">
        <h2 className="px-4 pt-5 text-[16px] font-semibold min-[880px]:px-8">Departments</h2>
        {summary === null && loading ? <SpinnerBlock label="Loading departments" /> : null}
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
        <Dialog titleId="reach-title" onClose={() => { if (!pending) setReach(null); }}>
          <form onSubmit={send} className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
            <h2 id="reach-title" className="text-[18px] font-semibold">Send to {reach.name}</h2>
            <p className="mt-1 text-[14px] text-ink-soft">Queue recipients get an alert and an email. This does not open a new ticket.</p>
            <label htmlFor="reach-note" className="mt-4 block text-sm font-medium">Message</label>
            <textarea id="reach-note" autoFocus required value={note} onChange={(event) => setNote(event.target.value)} rows={5} maxLength={2000} className="mt-1 w-full rounded-[10px] border border-line px-3 py-2" />
            {error ? <p role="alert" className="mt-3 text-sm text-danger">{error}</p> : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="submit" disabled={pending} className="h-11 rounded-[10px] bg-action px-4 text-[14px] font-semibold text-white disabled:opacity-40">
                <PendingLabel pending={pending} idle="Send message" busy="Sending…" />
              </button>
              <button type="button" className="h-11 text-[14px] text-action" onClick={() => setReach(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

export function Directory() {
  const { me, departments, toast } = useDesk();
  const router = useRouter();
  const [people, setPeople] = useState<Person[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(true);
  const [total, setTotal] = useState(0);
  const [catalog, setCatalog] = useState(departments);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<"" | "department" | "person">("");
  const [createFor, setCreateFor] = useState<"department" | "person" | null>(null);
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
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
    setLoadingPeople(true);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(pageSize));
      params.set("offset", String(nextPage * pageSize));
    if (debounced) params.set("q", debounced);
    const department = me?.role === "lead" ? me.departmentSlug : departmentFilter;
    if (department) params.set("department", department);
    const body = await api<{ items: Person[]; total: number }>(`/people?${params.toString()}`);
      setPeople(body.items);
      setTotal(body.total);
    } finally {
      setLoadingPeople(false);
    }
  }

  useEffect(() => {
    if (!me || (me.role !== "admin" && me.role !== "lead")) return;
    const params = new URLSearchParams();
    params.set("limit", String(pageSize));
    params.set("offset", String(page * pageSize));
    if (debounced) params.set("q", debounced);
    const department = me.role === "lead" ? me.departmentSlug : departmentFilter;
    if (department) params.set("department", department);
    let ignore = false;
    setLoadingPeople(true);
    api<{ items: Person[]; total: number }>(`/people?${params.toString()}`)
      .then((body) => {
        if (ignore) return;
        setPeople(body.items);
        setTotal(body.total);
      })
      .catch((reason: unknown) => {
        if (ignore) return;
        const message = said(reason, "The directory could not be loaded.");
        setError(message);
        if (reason instanceof ApiError && reason.status === 0) toast(message, "error");
      })
      .finally(() => {
        if (!ignore) setLoadingPeople(false);
      });
    return () => {
      ignore = true;
    };
  }, [me, page, debounced, departmentFilter]);

  if (!me) return <SpinnerBlock label="Loading people" />;
  if (me.role !== "admin" && me.role !== "lead") {
    return <p className="px-4 py-8 min-[880px]:px-8">People are managed by a superadmin. Your tickets are in the inbox and the queue.</p>;
  }

  const superadmin = me?.role === "admin";

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
      setCreateFor(null);
      setNotice("Department added.");
      toast("Department added.");
    } catch (reason) {
      const message = said(reason, "That department was not added.");
      setError(message);
      toast(message, "error");
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
          departmentSlug: data.get("role") === "admin" ? "it-software" : data.get("departmentSlug"),
          queueRecipient: data.get("role") === "lead" || data.get("queueRecipient") === "on",
        }),
      });
      await loadPeople(0);
      setPage(0);
      form.reset();
      setCreateFor(null);
      setNotice("Person added.");
      toast("Person added.");
    } catch (reason) {
      const message = said(reason, "That person was not added.");
      setError(message);
      toast(message, "error");
    } finally {
      setPending("");
    }
  }

  async function makeHead(person: Person) {
    setError("");
    setBusy(`head:${person.id}`);
    try {
      await api(`/people/${person.id}`, {
        method: "PATCH",
        body: JSON.stringify({ role: "lead", queueRecipient: true }),
      });
      await loadPeople(page);
      toast(`${person.name} is now the department head.`);
    } catch (reason) {
      const message = said(reason, "That person was not made head.");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy("");
    }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>, person: Person) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError("");
    setBusy(`password:${person.id}`);
    try {
      await api(`/people/${person.id}`, {
        method: "PATCH",
        body: JSON.stringify({ password: form.get("password") }),
      });
      setResetFor(null);
      toast("Password saved.");
    } catch (reason) {
      const message = said(reason, "The password was not changed.");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy("");
    }
  }

  async function savePerson(event: FormEvent<HTMLFormElement>, person: Person) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const role = String(data.get("role"));
    setBusy(`edit:${person.id}`);
    setError("");
    try {
      await api(`/people/${person.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.get("name"),
          email: data.get("email"),
          role,
          departmentSlug: role === "admin" ? "it-software" : data.get("departmentSlug"),
          active: data.get("active") === "on",
        }),
      });
      setEditFor(null);
      await loadPeople(page);
      toast(`${person.name} was updated.`);
    } catch (reason) {
      const message = said(reason, "That person was not updated.");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy("");
    }
  }

  async function removePerson(person: Person) {
    if (!confirm(`Delete ${person.name}? If they are already on a ticket, the account is disabled instead.`)) return;
    setBusy(`delete:${person.id}`);
    setError("");
    try {
      const result = await api<{ removed: boolean; disabled: boolean }>(`/people/${person.id}`, { method: "DELETE" });
      setEditFor(null);
      setResetFor(null);
      await loadPeople(page);
      toast(result.removed ? `${person.name} was deleted.` : `${person.name} was disabled because they are on a ticket.`);
    } catch (reason) {
      const message = said(reason, "That person was not deleted.");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy("");
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const roleLabel = (role: string) => (role === "lead" ? "Head" : role === "admin" ? "Superadmin" : "Staff");

  return (
    <section>
      <header className="border-b border-line px-4 py-5 min-[880px]:px-8">
        {superadmin ? (
          <button type="button" className="text-[14px] text-action" onClick={() => router.push("/monitor")}>
            Monitor
          </button>
        ) : null}
        <h1 className="mt-2 text-[22px] font-semibold">{superadmin ? "Directory" : "People"}</h1>
        <p className="mt-1 max-w-[62ch] text-[15px] text-ink-soft">
          {superadmin
            ? "Manage people, roles, and department access."
            : "People in your department. Assign someone from a ticket in your queue."}
        </p>
        {superadmin ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="h-11 rounded-xl bg-action px-4 text-sm font-semibold text-white"
              onClick={() => {
                setError("");
                setCreateFor("person");
              }}
            >
              Add person
            </button>
            <button
              type="button"
              className="h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-action"
              onClick={() => {
                setError("");
                setCreateFor("department");
              }}
            >
              New department
            </button>
          </div>
        ) : null}
      </header>
      {superadmin && createFor ? (
        <Dialog titleId={`create-${createFor}-title`} onClose={() => { if (!pending) setCreateFor(null); }}>
        {createFor === "department" ? <form onSubmit={addDepartment} className="grid min-w-0 gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="sticky top-0 z-10 -mx-5 -mt-5 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
            <h2 id="create-department-title" className="text-lg font-semibold">New department</h2>
            <button type="button" disabled={pending !== ""} className="h-11 px-2 text-sm text-action" onClick={() => setCreateFor(null)}>
              Cancel
            </button>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            Department name
            <input name="name" required placeholder="Department name" className="h-11 rounded-[10px] border border-line bg-surface px-3" />
          </label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <button type="submit" disabled={pending === "department"} className="h-11 rounded-[10px] bg-action text-[14px] font-semibold text-white disabled:opacity-40">
            <PendingLabel pending={pending === "department"} idle="Add department" busy="Saving…" />
          </button>
        </form> : null}
        {createFor === "person" ? <form onSubmit={addPerson} className="grid min-w-0 gap-4 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="sticky top-0 z-10 -mx-5 -mt-5 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
            <h2 id="create-person-title" className="text-lg font-semibold">Add a person</h2>
            <button type="button" disabled={pending !== ""} className="h-11 px-2 text-sm text-action" onClick={() => setCreateFor(null)}>
              Cancel
            </button>
          </div>
          <label className="grid gap-1.5 text-sm font-medium">
            Name
            <input name="name" required placeholder="Name" className="h-11 rounded-[10px] border border-line bg-surface px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Work email
            <input name="email" type="email" required placeholder="Work email" className="h-11 rounded-[10px] border border-line bg-surface px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Password
            <input name="password" type="password" autoComplete="new-password" required minLength={10} placeholder="Password, at least 10 characters" className="h-11 rounded-[10px] border border-line bg-surface px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Role
            <select name="role" className="h-11 rounded-[10px] border border-line bg-surface px-3" defaultValue="member">
            <option value="member">Member</option>
            <option value="lead">Department head</option>
            <option value="admin">Superadmin</option>
          </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Department
            <select name="departmentSlug" className="h-11 rounded-[10px] border border-line bg-surface px-3" defaultValue={catalog[0]?.slug}>
            {catalog.map((department) => (
              <option key={department.slug} value={department.slug}>
                {department.name}
              </option>
            ))}
          </select>
          </label>
          <label className="flex items-center gap-2 text-[14px]">
            <input name="queueRecipient" type="checkbox" />
            Copy them on the department queue
          </label>
          <p className="text-[13px] leading-5 text-muted">Superadmin is only for IT / Software.</p>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <button type="submit" disabled={pending === "person"} className="h-11 rounded-[10px] bg-action text-[14px] font-semibold text-white disabled:opacity-40">
            <PendingLabel pending={pending === "person"} idle="Add person" busy="Saving…" />
          </button>
        </form> : null}
        </Dialog>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4 min-[880px]:px-8">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search people"
          placeholder="Search name or email"
          className="h-11 min-w-0 basis-full flex-1 min-[560px]:basis-56 rounded-[10px] border border-line bg-surface px-3 text-[14px]"
        />
        {superadmin ? (
          <select aria-label="Filter by department" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="h-11 w-full min-w-0 rounded-[10px] border border-line bg-surface px-3 text-[14px] min-[560px]:w-auto">
            <option value="">All departments</option>
            {catalog.map((department) => (
              <option key={department.slug} value={department.slug}>
                {department.name}
              </option>
            ))}
          </select>
        ) : null}
        {loadingPeople ? <Spinner className="size-4 text-action" label="Loading people" /> : <p className="text-[13px] text-muted">{total === 1 ? "1 person" : `${total} people`}</p>}
      </div>
      {notice ? <p className="px-4 pt-4 text-[14px] text-action min-[880px]:px-8">{notice}</p> : null}
      {error ? <p className="px-4 pt-4 text-[14px] text-danger min-[880px]:px-8">{error}</p> : null}
      {loadingPeople && people.length === 0 ? <SpinnerBlock label="Loading people" /> : null}
      <ul className={loadingPeople && people.length > 0 ? "opacity-60" : ""} aria-busy={loadingPeople}>
        {people.map((person) => (
          <li key={person.id} className="border-b border-line px-4 py-3 min-[880px]:px-8">
            <div className="flex flex-col gap-1 min-[560px]:flex-row min-[560px]:flex-wrap min-[560px]:items-baseline min-[560px]:justify-between min-[560px]:gap-3">
              <span className="min-w-0 break-words text-[15px] [overflow-wrap:anywhere]">
                {person.name}
                {person.email ? ` · ${person.email}` : ""}
                {!person.active ? " · Disabled" : ""}
              </span>
              <span className="text-[13px] text-muted">
                {roleLabel(person.role)} · {catalog.find((item) => item.slug === person.departmentSlug)?.name || person.departmentSlug}
              </span>
            </div>
            {superadmin ? (
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              <button type="button" className="min-h-11 text-[14px] text-action" onClick={() => setEditFor(editFor === person.id ? null : person.id)}>
                Edit
              </button>
              {person.role !== "lead" && person.role !== "admin" ? (
                <button type="button" disabled={busy === `head:${person.id}`} className="inline-flex items-center gap-2 text-[14px] text-action disabled:opacity-60" onClick={() => makeHead(person)}>
                  {busy === `head:${person.id}` ? <Spinner className="size-4 text-current" label="Saving" /> : null}
                  {busy === `head:${person.id}` ? "Saving…" : "Make department head"}
                </button>
              ) : null}
              <button type="button" className="min-h-11 text-[14px] text-action" onClick={() => setResetFor(resetFor === person.id ? null : person.id)}>
                Set a new password
              </button>
              {me?.id === person.id ? null : (
                <button type="button" disabled={busy === `delete:${person.id}`} className="inline-flex items-center gap-2 text-[14px] text-danger disabled:opacity-60" onClick={() => void removePerson(person)}>
                  {busy === `delete:${person.id}` ? <Spinner className="size-4 text-current" label="Deleting" /> : null}
                  {busy === `delete:${person.id}` ? "Deleting…" : "Delete"}
                </button>
              )}
            </div>
            ) : null}
            {editFor === person.id ? (
              <form onSubmit={(event) => savePerson(event, person)} className="mt-3 grid min-w-0 gap-2 min-[760px]:grid-cols-2">
                <input name="name" required defaultValue={person.name} className="h-11 rounded-[10px] border border-line bg-surface px-3" />
                <input name="email" type="email" required defaultValue={person.email || ""} className="h-11 rounded-[10px] border border-line bg-surface px-3" />
                <select name="role" defaultValue={person.role} className="h-11 rounded-[10px] border border-line bg-surface px-3">
                  <option value="member">Member</option>
                  <option value="lead">Department head</option>
                  <option value="admin">Superadmin</option>
                </select>
                <select name="departmentSlug" defaultValue={person.departmentSlug} className="h-11 rounded-[10px] border border-line bg-surface px-3">
                  {catalog.map((department) => (
                    <option key={department.slug} value={department.slug}>
                      {department.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-[14px]">
                  <input name="active" type="checkbox" defaultChecked={person.active} />
                  Active
                </label>
                <button type="submit" disabled={busy === `edit:${person.id}`} className="h-11 rounded-[10px] bg-action px-4 text-[14px] font-semibold text-white disabled:opacity-40">
                  <PendingLabel pending={busy === `edit:${person.id}`} idle="Save" busy="Saving…" />
                </button>
                <button type="button" className="h-11 px-3 text-sm text-action" onClick={() => setEditFor(null)}>Cancel</button>
              </form>
            ) : null}
            {resetFor === person.id ? (
              <form onSubmit={(event) => resetPassword(event, person)} className="mt-2 flex flex-wrap items-center gap-2">
                <input aria-label="New password" name="password" required minLength={10} type="password" autoComplete="new-password" placeholder="New password, at least 10 characters" className="h-11 min-w-0 basis-full flex-1 min-[560px]:basis-64 rounded-[10px] border border-line bg-surface px-3" />
                <button type="submit" disabled={busy === `password:${person.id}`} className="h-11 rounded-[10px] bg-action px-4 text-[14px] font-semibold text-white disabled:opacity-40">
                  <PendingLabel pending={busy === `password:${person.id}`} idle="Save password" busy="Saving…" />
                </button>
                <button type="button" className="h-11 px-3 text-sm text-action" onClick={() => setResetFor(null)}>Cancel</button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
      {!loadingPeople && people.length === 0 ? <p className="px-4 py-8 text-[15px] text-ink-soft min-[880px]:px-8">No one matches this search.</p> : null}
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
