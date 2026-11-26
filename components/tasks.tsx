"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  formatDateTime,
  relativeTime,
  said,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  taskClosed,
  type Department,
  type Task,
  type TaskPage,
} from "./api";
import { Dialog } from "./dialog";
import { useDesk } from "./provider";
import { PendingLabel, Spinner, SpinnerBlock } from "./spinner";

type StepDraft = {
  title: string;
  description: string;
  assigneeId: string;
  dueAt: string;
  targetDepartment: string;
  targetLeadId: string;
  required: boolean;
};

const statusFilters = [
  ["", "All"],
  ["assigned", "Assigned"],
  ["in_progress", "In progress"],
  ["blocked", "Blocked"],
  ["in_review", "In review"],
  ["changes_requested", "Changes requested"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
  ["overdue", "Overdue"],
] as const;

const chip: Record<Task["status"], string> = {
  assigned: "bg-wash text-action",
  in_progress: "bg-wash text-ink",
  blocked: "bg-waiting-bg text-waiting",
  in_review: "bg-resolved-bg text-resolved",
  changes_requested: "bg-waiting-bg text-waiting",
  completed: "bg-resolved-bg text-resolved",
  cancelled: "bg-canvas text-muted",
};

function localInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function TaskList() {
  const { me, departments, live, badges, toast } = useDesk();
  const [items, setItems] = useState<Task[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"mine" | "team" | "organization">("mine");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [department, setDepartment] = useState("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [more, setMore] = useState<{ key: string; cursor: string } | null>(null);
  const [compose, setCompose] = useState(false);
  const filterKey = `${debounced}|${status}|${priority}|${department}|${scope}|${live}`;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const cursor = more && more.key === filterKey ? more.cursor : undefined;
    const params = new URLSearchParams({ limit: "20", scope });
    if (debounced) params.set("q", debounced);
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (department) params.set("department", department);
    if (cursor) params.set("cursor", cursor);
    let ignore = false;
    if (cursor) setLoadingMore(true);
    else {
      setLoading(true);
      setLoadingMore(false);
    }
    api<TaskPage>(`/tasks?${params.toString()}`)
      .then((body) => {
        if (ignore) return;
        setItems((current) => (cursor ? [...(current ?? []), ...body.items] : body.items));
        setNext(body.nextCursor);
        setError("");
      })
      .catch((reason: unknown) => {
        if (ignore) return;
        setError(said(reason, "That task list could not be loaded."));
      })
      .finally(() => {
        if (ignore) return;
        setLoading(false);
        setLoadingMore(false);
      });
    return () => {
      ignore = true;
    };
  }, [filterKey, more, debounced, status, priority, department, scope]);

  const scopes: { value: "mine" | "team" | "organization"; label: string }[] = [
    { value: "mine", label: "Assigned to me" },
    ...(me?.role === "lead" || me?.role === "admin" ? [{ value: "team" as const, label: "My department" }] : []),
    ...(me?.role === "admin" ? [{ value: "organization" as const, label: "Everyone" }] : []),
  ];

  return (
    <>
      <section>
        <header className="border-b border-line px-4 py-5 min-[880px]:px-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">Tasks</h1>
              <p className="mt-1 max-w-[68ch] text-[15px] leading-6 text-ink-soft">
                Assigned work, delegated steps and review. Leads assign within their department; admins can assign across it.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/tasks/reports" className="inline-flex h-11 items-center rounded-[10px] border border-line px-3 text-[14px] text-ink-soft">
                Reports
              </Link>
              <button type="button" onClick={() => setCompose(true)} className="h-11 rounded-[10px] bg-action px-4 text-[14px] font-semibold text-white">
                New task
              </button>
            </div>
          </div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search tasks"
            placeholder="Search task name or number"
            className="mt-4 h-11 w-full rounded-[10px] border border-line bg-surface px-3 text-[14px] min-[560px]:max-w-md"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              aria-label="Filter by priority"
              className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[13px]"
            >
              <option value="">All priorities</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            {me?.role === "lead" || me?.role === "admin" ? (
              <select
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                aria-label="Filter by department"
                className="h-10 rounded-[10px] border border-line bg-surface px-3 text-[13px]"
              >
                <option value="">All departments</option>
                {(me.role === "admin" ? departments : departments.filter((item) => item.slug === me.departmentSlug)).map((item) => (
                  <option key={item.slug} value={item.slug}>{item.name}</option>
                ))}
              </select>
            ) : null}
          </div>
          <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 min-[880px]:mx-0 min-[880px]:px-0">
            {scopes.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setScope(item.value)}
                className={`h-9 shrink-0 rounded-full px-3 text-[13px] ${scope === item.value ? "bg-action text-white" : "border border-line text-ink-soft"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 min-[880px]:mx-0 min-[880px]:px-0">
            {statusFilters.map(([value, label]) => (
              <button
                key={value || "all"}
                type="button"
                onClick={() => setStatus(value)}
                className={`h-9 shrink-0 rounded-full px-3 text-[13px] ${status === value ? "border border-action bg-wash font-medium text-action" : "border border-line text-ink-soft"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        {error ? <p className="px-4 py-6 text-[15px] text-danger min-[880px]:px-8">{error}</p> : null}
        {loading && items === null && !error ? <SpinnerBlock label="Loading tasks" /> : null}
        {items && items.length === 0 ? (
          <p className="px-4 py-10 text-[15px] leading-6 text-ink-soft min-[880px]:px-8">No tasks in this view yet.</p>
        ) : null}
        <ul className={loading && items ? "opacity-60" : ""} aria-busy={loading}>
          {items?.map((task) => (
            <li key={task.id} className="border-b border-line">
              <Link href={`/tasks/${task.id}`} className="flex items-start gap-3 px-4 py-3.5 min-[880px]:px-8 hover:bg-wash">
                <span className={`mt-0.5 shrink-0 rounded-md px-2 py-1 text-[12px] font-medium ${chip[task.status]}`}>
                  {TASK_STATUS_LABEL[task.status]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words [overflow-wrap:anywhere] text-[15px] font-medium leading-5">{task.name}</span>
                  <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 [overflow-wrap:anywhere] text-[13px] leading-5 text-muted">
                    <span className="font-mono">{task.id}</span>
                    <span>{task.assignee.name}</span>
                    <span>{TASK_PRIORITY_LABEL[task.priority]}</span>
                    <span className={task.overdue ? "text-danger" : ""}>
                      {task.overdue ? "Overdue" : "Due"} {formatDateTime(task.dueAt)}
                    </span>
                    <span>{relativeTime(task.updatedAt)}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {next ? (
          <div className="px-4 py-4 min-[880px]:px-8">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => setMore({ key: filterKey, cursor: next })}
              className="inline-flex h-11 items-center gap-2 text-[14px] text-action disabled:opacity-60"
            >
              {loadingMore ? <Spinner className="size-4 text-current" label="Loading more tasks" /> : null}
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </section>
      <aside className="hidden border-l border-line px-5 py-6 min-[1100px]:block">
        <p className="text-[13px] font-medium text-muted">This desk</p>
        <p className="mt-2 text-[16px] font-semibold">{me?.name}</p>
        <dl className="mt-6 border-t border-line text-[14px]">
          <div className="flex justify-between border-b border-line py-3">
            <dt>Tasks needing you</dt>
            <dd className="font-mono">{badges.tasks ?? 0}</dd>
          </div>
          <div className="flex justify-between border-b border-line py-3">
            <dt>Alerts</dt>
            <dd className="font-mono">{badges.alerts}</dd>
          </div>
        </dl>
        <Link href="/tasks/reports" className="mt-6 inline-flex h-11 items-center text-[14px] text-action">
          Open task reports →
        </Link>
      </aside>
      {compose ? <TaskComposer onClose={() => setCompose(false)} /> : null}
    </>
  );
}

export function TaskComposer({ onClose, onCreated }: { onClose: () => void; onCreated?: (task: Task) => void }) {
  const { me, departments, refresh, toast } = useDesk();
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [links, setLinks] = useState("");
  const [reminders, setReminders] = useState<number[]>([1440, 120, 0]);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const canDelegate = me?.role === "lead" || me?.role === "admin";

  const people = departments.flatMap((department) => department.recipients);
  const assignable = people.filter(
    (person) =>
      person.active &&
      person.role !== "admin" &&
      (me?.role === "member" ? person.id === me.id : me?.role === "lead" ? person.departmentSlug === me.departmentSlug : true),
  );

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((current) => current.map((step, position) => (position === index ? { ...step, ...patch } : step)));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const payload = {
        name: form.get("name"),
        description: form.get("description"),
        expectedOutcome: form.get("expectedOutcome"),
        assigneeId: form.get("assigneeId") || me?.id,
        priority: form.get("priority"),
        startAt: form.get("startAt") ? new Date(String(form.get("startAt"))).toISOString() : null,
        dueAt: new Date(String(form.get("dueAt"))).toISOString(),
        reminderOffsets: reminders,
        resourceLinks: links
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
        steps: canDelegate
          ? steps.map((step) => ({
              title: step.title,
              description: step.description || null,
              assigneeId: step.assigneeId,
              dueAt: new Date(step.dueAt).toISOString(),
              required: step.required,
              targetDepartment: step.targetDepartment || null,
              targetLeadId: step.targetLeadId || null,
            }))
          : [],
      };
      const task = await api<Task>("/tasks", { method: "POST", body: JSON.stringify(payload) });
      refresh();
      toast("Task created.");
      if (onCreated) onCreated(task);
      else {
        onClose();
        router.push(`/tasks/${task.id}`);
      }
    } catch (reason) {
      const message = said(reason, "That task could not be created.");
      setError(message);
      toast(message, "error");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog titleId="new-task-title" onClose={() => { if (!pending) onClose(); }}>
      <form onSubmit={onSubmit}>
        <div className="sticky top-0 z-10 flex h-16 items-center justify-between border-b border-line bg-surface px-5">
          <h2 id="new-task-title" className="text-lg font-semibold">New task</h2>
          <button type="button" disabled={pending} className="h-11 px-2 text-[14px] text-action disabled:opacity-40" onClick={onClose}>
            Cancel
          </button>
        </div>
        <div className="flex flex-col gap-4 px-5 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Task name
            <input name="name" autoFocus required maxLength={160} className="h-11 rounded-[10px] border border-line bg-surface px-3 font-normal outline-none" />
          </label>
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Description
            <textarea name="description" required rows={4} maxLength={10000} className="rounded-[10px] border border-line bg-surface px-3 py-2 font-normal" />
          </label>
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Expected outcome
            <textarea name="expectedOutcome" rows={2} maxLength={5000} className="rounded-[10px] border border-line bg-surface px-3 py-2 font-normal" />
          </label>
          <div className="grid gap-4 min-[560px]:grid-cols-2">
            <label className="flex flex-col gap-1 text-[14px] font-medium">
              Assignee
              <select name="assigneeId" defaultValue={me?.id || ""} className="h-11 rounded-[10px] border border-line bg-surface px-3 font-normal">
                {assignable.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name} · {person.departmentSlug}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[14px] font-medium">
              Priority
              <select name="priority" defaultValue="medium" className="h-11 rounded-[10px] border border-line bg-surface px-3 font-normal">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[14px] font-medium">
              Start
              <input name="startAt" type="datetime-local" className="h-11 rounded-[10px] border border-line bg-surface px-3 font-normal" />
            </label>
            <label className="flex flex-col gap-1 text-[14px] font-medium">
              Due
              <input name="dueAt" type="datetime-local" required defaultValue={localInput(new Date(Date.now() + 86400000))} className="h-11 rounded-[10px] border border-line bg-surface px-3 font-normal" />
            </label>
          </div>
          <fieldset className="rounded-[10px] border border-line p-3">
            <legend className="px-1 text-[14px] font-medium">Reminders</legend>
            <div className="flex flex-wrap gap-3 text-[14px]">
              {[
                [1440, "1 day before"],
                [120, "2 hours before"],
                [0, "At due time"],
              ].map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 font-normal">
                  <input
                    type="checkbox"
                    checked={reminders.includes(Number(value))}
                    onChange={(event) =>
                      setReminders((current) =>
                        event.target.checked ? [...new Set([...current, Number(value)])] : current.filter((item) => item !== Number(value)),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1 text-[14px] font-medium">
            Reference links
            <textarea value={links} onChange={(event) => setLinks(event.target.value)} rows={2} placeholder="One link per line" className="rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px] font-normal" />
          </label>

          {canDelegate ? (
            <section className="rounded-[14px] border border-line p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-[15px] font-semibold">Delegated steps</h3>
                <button
                  type="button"
                  onClick={() =>
                    setSteps((current) => [
                      ...current,
                      {
                        title: "",
                        description: "",
                        assigneeId: assignable[0]?.id || "",
                        dueAt: localInput(new Date(Date.now() + 86400000)),
                        targetDepartment: "",
                        targetLeadId: "",
                        required: true,
                      },
                    ])
                  }
                  className="h-10 px-2 text-[14px] text-action"
                >
                  + Add step
                </button>
              </div>
              {steps.length === 0 ? <p className="mt-2 text-[13px] text-muted">Steps may be handed to another department’s head.</p> : null}
              {steps.map((step, index) => {
                const stepPeople = departments
                  .filter((department) => !step.targetDepartment || department.slug === step.targetDepartment)
                  .flatMap((department) => department.recipients)
                  .filter((person) => person.active && person.role !== "admin");
                const leads = departments
                  .filter((department) => department.slug === step.targetDepartment)
                  .flatMap((department) => department.recipients)
                  .filter((person) => person.active && person.role === "lead");
                return (
                  <div key={index} className="mt-3 rounded-[10px] border border-line p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-muted">Step {index + 1}</p>
                      <button type="button" onClick={() => setSteps((current) => current.filter((_, position) => position !== index))} className="h-8 px-2 text-[13px] text-danger">
                        Remove
                      </button>
                    </div>
                    <label className="mt-2 flex flex-col gap-1 text-[14px] font-medium">
                      Title
                      <input required value={step.title} onChange={(event) => updateStep(index, { title: event.target.value })} className="h-11 rounded-[10px] border border-line bg-surface px-3 font-normal" />
                    </label>
                    <div className="mt-2 grid gap-2 min-[560px]:grid-cols-2">
                      <label className="flex flex-col gap-1 text-[13px] font-medium">
                        Assignee
                        <select value={step.assigneeId} onChange={(event) => updateStep(index, { assigneeId: event.target.value })} className="h-11 rounded-[10px] border border-line bg-surface px-2 text-[13px] font-normal">
                          {stepPeople.map((person) => (
                            <option key={person.id} value={person.id}>{person.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-[13px] font-medium">
                        Due
                        <input type="datetime-local" required value={step.dueAt} onChange={(event) => updateStep(index, { dueAt: event.target.value })} className="h-11 rounded-[10px] border border-line bg-surface px-2 text-[13px] font-normal" />
                      </label>
                      <label className="flex flex-col gap-1 text-[13px] font-medium">
                        Receiving department
                        <select value={step.targetDepartment} onChange={(event) => updateStep(index, { targetDepartment: event.target.value, targetLeadId: "" })} className="h-11 rounded-[10px] border border-line bg-surface px-2 text-[13px] font-normal">
                          <option value="">Same department</option>
                          {departments.map((department) => (
                            <option key={department.slug} value={department.slug}>{department.name}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-[13px] font-medium">
                        Receiving head
                        <select value={step.targetLeadId} onChange={(event) => updateStep(index, { targetLeadId: event.target.value })} className="h-11 rounded-[10px] border border-line bg-surface px-2 text-[13px] font-normal">
                          <option value="">Not specified</option>
                          {leads.map((person) => (
                            <option key={person.id} value={person.id}>{person.name}</option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-[13px] font-normal">
                      <input type="checkbox" checked={step.required} onChange={(event) => updateStep(index, { required: event.target.checked })} />
                      Required before submission
                    </label>
                  </div>
                );
              })}
            </section>
          ) : null}

          {error ? <p className="text-[14px] text-danger">{error}</p> : null}
          <button type="submit" disabled={pending || assignable.length === 0} className="h-11 rounded-[10px] bg-action text-[14px] font-semibold text-white disabled:opacity-40">
            <PendingLabel pending={pending} idle="Create task" busy="Creating…" />
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function TaskAvatar({ name }: { name: string }) {
  return <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-wash text-[11px] font-semibold text-action">{initials(name)}</span>;
}

export function ClosedChip({ task }: { task: Task }) {
  if (!taskClosed(task.status)) return null;
  return <span className="rounded-md bg-canvas px-2 py-1 text-[12px] text-muted">Closed</span>;
}
