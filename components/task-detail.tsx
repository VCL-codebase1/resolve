"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  api,
  formatDateTime,
  relativeTime,
  said,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TASK_STEP_STATUS_LABEL,
  taskClosed,
  type Department,
  type TaskDetail,
  type TaskStep,
} from "./api";
import { useDesk } from "./provider";
import { PendingLabel, SpinnerBlock } from "./spinner";

function localInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function TaskDetailView() {
  const params = useParams<{ id: string }>();
  const id = String(params.id);
  const { me, departments, refresh, toast } = useDesk();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const [links, setLinks] = useState("");
  const [addingStep, setAddingStep] = useState(false);
  const [stepTitle, setStepTitle] = useState("");
  const [stepAssignee, setStepAssignee] = useState("");
  const [stepDue, setStepDue] = useState(localInput(new Date(Date.now() + 86400000)));
  const [stepDepartment, setStepDepartment] = useState("");
  const [stepLead, setStepLead] = useState("");
  const [stepRequired, setStepRequired] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let ignore = false;
    api<TaskDetail>(`/tasks/${id}`)
      .then((body) => {
        if (!ignore) {
          setTask(body);
          setError("");
        }
      })
      .catch((reason: unknown) => {
        if (!ignore) setError(said(reason, "That task could not be loaded."));
      });
    return () => {
      ignore = true;
    };
  }, [id, reload]);

  const people = departments.flatMap((department) => department.recipients).filter((person) => person.active && person.role !== "admin");
  const stepPeople = departments
    .filter((department) => !stepDepartment || department.slug === stepDepartment)
    .flatMap((department) => department.recipients)
    .filter((person) => person.active && person.role !== "admin");
  const leads = departments
    .filter((department) => department.slug === stepDepartment)
    .flatMap((department) => department.recipients)
    .filter((person) => person.active && person.role === "lead");

  const isAssignee = Boolean(task && me && task.assignee.id === me.id);
  const canReview = Boolean(
    task &&
      me &&
      (me.role === "admin" ||
        (me.role === "lead" && (task.assignedBy.id === me.id || task.assignee.departmentSlug === me.departmentSlug))),
  );
  const canDelegate = me?.role === "lead" || me?.role === "admin";
  const closed = task ? taskClosed(task.status) : false;

  async function act(action: string, body: Record<string, unknown> = {}, success = "Updated.") {
    if (!task) return;
    setBusy(action);
    setError("");
    try {
      const next = await api<TaskDetail>(`/tasks/${task.id}/${action}`, { method: "POST", body: JSON.stringify(body) });
      setTask(next);
      setNote("");
      refresh();
      toast(success);
    } catch (reason) {
      const message = said(reason, "That change could not be saved.");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy("");
    }
  }

  async function onEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task) return;
    const form = new FormData(event.currentTarget);
    const formLinks = links
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const upload = new FormData();
    if (formLinks.length) upload.set("links", JSON.stringify(formLinks));
    for (const file of form.getAll("files")) if (file instanceof File && file.size > 0) upload.append("files", file);
    setBusy("evidence");
    setError("");
    try {
      const next = await api<TaskDetail>(`/tasks/${task.id}/resources`, { method: "POST", body: upload });
      setTask(next);
      setLinks("");
      event.currentTarget.reset();
      refresh();
      toast("Evidence added.");
    } catch (reason) {
      const message = said(reason, "That evidence could not be added.");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy("");
    }
  }

  async function onComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task || !comment.trim()) return;
    const body = comment;
    setBusy("comment");
    try {
      const next = await api<TaskDetail>(`/tasks/${task.id}/comments`, { method: "POST", body: JSON.stringify({ body }) });
      setTask(next);
      setComment("");
      toast("Comment added.");
    } catch (reason) {
      const message = said(reason, "That comment could not be added.");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy("");
    }
  }

  async function onAddStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!task) return;
    setBusy("step");
    setError("");
    try {
      const next = await api<TaskDetail>(`/tasks/${task.id}/steps`, {
        method: "POST",
        body: JSON.stringify({
          step: {
            title: stepTitle,
            assigneeId: stepAssignee,
            dueAt: new Date(stepDue).toISOString(),
            required: stepRequired,
            targetDepartment: stepDepartment || null,
            targetLeadId: stepLead || null,
          },
        }),
      });
      setTask(next);
      setStepTitle("");
      setAddingStep(false);
      refresh();
      toast("Step added.");
    } catch (reason) {
      const message = said(reason, "That step could not be added.");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy("");
    }
  }

  async function onReassign(step: TaskStep, assigneeId: string) {
    if (!assigneeId || assigneeId === step.assignee.id) return;
    try {
      const next = await api<TaskDetail>(`/task-steps/${step.id}/reassign`, {
        method: "POST",
        body: JSON.stringify({ assigneeId }),
      });
      setTask(next);
      refresh();
      toast("Step reassigned.");
    } catch (reason) {
      const message = said(reason, "That step could not be reassigned.");
      setError(message);
      toast(message, "error");
    }
  }

  async function stepAction(step: TaskStep, action: "start" | "block" | "resume" | "complete") {
    const body = action === "block" ? { reason: note || "Blocked by the assignee." } : action === "complete" ? { note } : {};
    await actStep(step, action, body);
  }

  async function actStep(step: TaskStep, action: string, body: Record<string, unknown>) {
    if (!task) return;
    setBusy(`${step.id}:${action}`);
    setError("");
    try {
      const next = await api<TaskDetail>(`/task-steps/${step.id}/${action}`, { method: "POST", body: JSON.stringify(body) });
      setTask(next);
      setNote("");
      refresh();
      toast("Step updated.");
    } catch (reason) {
      const message = said(reason, "That step could not be updated.");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy("");
    }
  }

  if (error && !task) return <p className="px-4 py-10 text-[15px] text-danger min-[880px]:px-8">{error}</p>;
  if (!task) return <SpinnerBlock label="Loading task" />;

  return (
    <div className="min-[1100px]:grid min-[1100px]:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0">
        <header className="border-b border-line px-4 py-5 min-[880px]:px-8">
          <Link href="/tasks" className="inline-flex h-9 items-center text-[14px] text-action">← All tasks</Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-wash px-2 py-1 text-[12px] font-medium text-action">{TASK_STATUS_LABEL[task.status]}</span>
            <span className="rounded-md bg-canvas px-2 py-1 text-[12px] text-ink-soft">{TASK_PRIORITY_LABEL[task.priority]}</span>
            <span className="font-mono text-[13px] text-muted">{task.id}</span>
            {task.overdue ? <span className="rounded-md bg-waiting-bg px-2 py-1 text-[12px] text-waiting">Overdue</span> : null}
          </div>
          <h1 className="mt-2 break-words text-[22px] font-semibold leading-7 tracking-tight [overflow-wrap:anywhere]">{task.name}</h1>
          <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-6 text-ink-soft">{task.description}</p>
          {task.expectedOutcome ? (
            <p className="mt-3 rounded-[12px] bg-wash p-3 text-[14px] leading-5"><span className="font-medium">Expected outcome:</span> {task.expectedOutcome}</p>
          ) : null}
          {task.blockedReason ? <p className="mt-3 text-[14px] text-waiting"><span className="font-medium">Blocked:</span> {task.blockedReason}</p> : null}
          {task.reviewComment ? <p className="mt-3 text-[14px] text-ink-soft"><span className="font-medium">Review:</span> {task.reviewComment}</p> : null}
          <dl className="mt-4 grid gap-x-6 gap-y-2 text-[13px] min-[560px]:grid-cols-2">
            <div><dt className="inline text-muted">Assignee: </dt><dd className="inline">{task.assignee.name}</dd></div>
            <div><dt className="inline text-muted">Assigned by: </dt><dd className="inline">{task.assignedBy.name}</dd></div>
            <div><dt className="inline text-muted">Due: </dt><dd className="inline">{formatDateTime(task.dueAt)}</dd></div>
            <div><dt className="inline text-muted">Started: </dt><dd className="inline">{formatDateTime(task.startedAt)}</dd></div>
          </dl>
        </header>

        <section className="border-b border-line px-4 py-5 min-[880px]:px-8">
          <h2 className="text-[16px] font-semibold">Actions</h2>
          {error ? <p className="mt-2 text-[14px] text-danger">{error}</p> : null}
          <label className="mt-3 block text-[14px] font-medium">
            Note for the next action
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={5000} className="mt-1 w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px] font-normal" />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {isAssignee && !closed ? (
              <>
                {(task.status === "assigned" || task.status === "changes_requested") ? (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void act("start", {}, "Work started.")} className={actionClass}>
                    <PendingLabel pending={busy === "start"} idle="Start work" busy="Starting…" />
                  </button>
                ) : null}
                {(task.status === "assigned" || task.status === "in_progress" || task.status === "changes_requested") ? (
                  <button type="button" disabled={Boolean(busy) || !note.trim()} onClick={() => void act("block", { reason: note }, "Task blocked.")} className={actionClass}>
                    Block
                  </button>
                ) : null}
                {task.status === "blocked" ? (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void act("resume", {}, "Work resumed.")} className={actionClass}>
                    Resume
                  </button>
                ) : null}
                {(task.status === "in_progress" || task.status === "changes_requested") ? (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void act("submit", { note }, "Submitted for review.")} className={primaryClass}>
                    <PendingLabel pending={busy === "submit"} idle="Submit for review" busy="Submitting…" />
                  </button>
                ) : null}
              </>
            ) : null}
            {canReview && task.status === "in_review" ? (
              <>
                <button type="button" disabled={Boolean(busy)} onClick={() => void act("approve", { comment: note }, "Task approved.")} className={primaryClass}>
                  Approve
                </button>
                <button type="button" disabled={Boolean(busy) || !note.trim()} onClick={() => void act("request-changes", { comment: note }, "Changes requested.")} className={actionClass}>
                  Request changes
                </button>
              </>
            ) : null}
            {canReview && !closed ? (
              <button type="button" disabled={Boolean(busy) || !note.trim()} onClick={() => void act("cancel", { reason: note }, "Task cancelled.")} className={dangerClass}>
                Cancel task
              </button>
            ) : null}
            {!isAssignee && !canReview && !closed ? <p className="text-[14px] text-muted">Only the assignee and reviewers can move this task.</p> : null}
            {closed ? <p className="text-[14px] text-muted">This task is closed.</p> : null}
          </div>
        </section>

        <section className="border-b border-line px-4 py-5 min-[880px]:px-8">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[16px] font-semibold">Steps</h2>
            {canDelegate && !closed ? (
              <button type="button" onClick={() => setAddingStep((current) => !current)} className="h-10 px-2 text-[14px] text-action">
                {addingStep ? "Close" : "+ Add step"}
              </button>
            ) : null}
          </div>
          {addingStep ? (
            <form onSubmit={onAddStep} className="mt-3 rounded-[12px] border border-line p-3">
              <div className="grid gap-3 min-[560px]:grid-cols-2">
                <label className="flex flex-col gap-1 text-[13px] font-medium">
                  Title
                  <input required value={stepTitle} onChange={(event) => setStepTitle(event.target.value)} className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-normal" />
                </label>
                <label className="flex flex-col gap-1 text-[13px] font-medium">
                  Assignee
                  <select required value={stepAssignee} onChange={(event) => setStepAssignee(event.target.value)} className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-normal">
                    <option value="">Choose</option>
                    {stepPeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[13px] font-medium">
                  Due
                  <input required type="datetime-local" value={stepDue} onChange={(event) => setStepDue(event.target.value)} className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-normal" />
                </label>
                <label className="flex flex-col gap-1 text-[13px] font-medium">
                  Receiving department
                  <select value={stepDepartment} onChange={(event) => { setStepDepartment(event.target.value); setStepLead(""); }} className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-normal">
                    <option value="">Same department</option>
                    {departments.map((department) => <option key={department.slug} value={department.slug}>{department.name}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[13px] font-medium">
                  Receiving head
                  <select value={stepLead} onChange={(event) => setStepLead(event.target.value)} className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[13px] font-normal">
                    <option value="">Not specified</option>
                    {leads.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-[13px] font-normal">
                  <input type="checkbox" checked={stepRequired} onChange={(event) => setStepRequired(event.target.checked)} />
                  Required before submission
                </label>
              </div>
              <button type="submit" disabled={busy === "step"} className="mt-3 h-11 rounded-[10px] bg-action px-4 text-[14px] font-semibold text-white disabled:opacity-40">
                <PendingLabel pending={busy === "step"} idle="Add step" busy="Adding…" />
              </button>
            </form>
          ) : null}
          {task.steps.length === 0 ? <p className="mt-3 text-[14px] text-muted">No steps have been added.</p> : null}
          <ol className="mt-3 space-y-3">
            {task.steps.map((step, index) => {
              const mine = me?.id === step.assignee.id;
              const stepClosed = step.status === "completed" || step.status === "cancelled";
              const canReassign = me?.role === "admin" || step.assignedBy.id === me?.id || step.targetLead?.id === me?.id;
              const reassignPeople = step.targetDepartment
                ? people.filter((person) => person.departmentSlug === step.targetDepartment)
                : people;
              return (
                <li key={step.id} className="rounded-[12px] border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium">{index + 1}. {step.title}</p>
                      <p className="mt-1 flex flex-wrap gap-x-2 text-[13px] text-muted">
                        <span>{TASK_STEP_STATUS_LABEL[step.status]}</span>
                        <span>{step.assignee.name}</span>
                        <span>Due {formatDateTime(step.dueAt)}</span>
                        {step.interdepartmental ? <span>↗ {step.targetDepartment}{step.targetLead ? ` · ${step.targetLead.name}` : ""}</span> : null}
                        {step.required ? null : <span>Optional</span>}
                      </p>
                      {step.description ? <p className="mt-1 text-[13px] text-ink-soft">{step.description}</p> : null}
                      {step.blockedReason ? <p className="mt-1 text-[13px] text-waiting">Blocked: {step.blockedReason}</p> : null}
                      {step.completionNote ? <p className="mt-1 text-[13px] text-ink-soft">Note: {step.completionNote}</p> : null}
                    </div>
                  </div>
                  {mine && !stepClosed ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {step.status === "assigned" ? (
                        <button type="button" disabled={Boolean(busy)} onClick={() => void stepAction(step, "start")} className={actionClass}>Start</button>
                      ) : null}
                      {(step.status === "assigned" || step.status === "in_progress") ? (
                        <button type="button" disabled={Boolean(busy) || !note.trim()} onClick={() => void stepAction(step, "block")} className={actionClass}>Block</button>
                      ) : null}
                      {step.status === "blocked" ? (
                        <button type="button" disabled={Boolean(busy)} onClick={() => void stepAction(step, "resume")} className={actionClass}>Resume</button>
                      ) : null}
                      {step.status === "in_progress" ? (
                        <button type="button" disabled={Boolean(busy)} onClick={() => void stepAction(step, "complete")} className={primaryClass}>Complete</button>
                      ) : null}
                    </div>
                  ) : null}
                  {canReassign && !stepClosed ? (
                    <label className="mt-3 block text-[13px] text-muted">
                      Reassign
                      <select
                        value=""
                        onChange={(event) => void onReassign(step, event.target.value)}
                        className="mt-1 h-10 w-full rounded-[10px] border border-line bg-surface px-2 text-[13px] text-ink"
                      >
                        <option value="">Choose a person…</option>
                        {reassignPeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                      </select>
                    </label>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>

        <section className="border-b border-line px-4 py-5 min-[880px]:px-8">
          <h2 className="text-[16px] font-semibold">Evidence</h2>
          {task.resources.length === 0 ? <p className="mt-2 text-[14px] text-muted">No files or links yet.</p> : null}
          <ul className="mt-2 space-y-2">
            {task.resources.map((resource) => (
              <li key={resource.id} className="flex items-center gap-2 text-[14px]">
                <span className="rounded-md bg-wash px-2 py-1 text-[12px] text-action">{resource.type === "link" ? "Link" : "File"}</span>
                {resource.type === "link" && resource.url ? (
                  <a href={resource.url} target="_blank" rel="noreferrer" className="break-all text-action">{resource.title}</a>
                ) : (
                  <a href={`/api/v1/tasks/${task.id}/resources/${resource.id}`} className="break-all text-action">{resource.title}</a>
                )}
                <span className="ml-auto shrink-0 text-[12px] text-muted">{relativeTime(resource.createdAt)}</span>
              </li>
            ))}
          </ul>
          {!closed ? (
            <form onSubmit={onEvidence} className="mt-3 rounded-[12px] border border-line p-3">
              <label className="flex flex-col gap-1 text-[13px] font-medium">
                Links
                <textarea value={links} onChange={(event) => setLinks(event.target.value)} rows={2} placeholder="One link per line" className="rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] font-normal" />
              </label>
              <label className="mt-2 block text-[13px] font-medium">
                Files
                <input name="files" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" className="mt-1 block max-w-full text-[13px] font-normal" />
              </label>
              <button type="submit" disabled={Boolean(busy)} className="mt-3 h-11 rounded-[10px] border border-line px-4 text-[14px] text-ink-soft disabled:opacity-40">
                <PendingLabel pending={busy === "evidence"} idle="Add evidence" busy="Adding…" />
              </button>
            </form>
          ) : null}
        </section>

        <section className="border-b border-line px-4 py-5 min-[880px]:px-8">
          <h2 className="text-[16px] font-semibold">Discussion</h2>
          <div className="mt-3 space-y-3">
            {task.comments.map((item) => (
              <div key={item.id} className="rounded-[12px] bg-wash p-3">
                <p className="text-[13px] font-medium">{item.author.name} <span className="font-normal text-muted">· {relativeTime(item.createdAt)}</span></p>
                <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-5">{item.body}</p>
              </div>
            ))}
            {task.comments.length === 0 ? <p className="text-[14px] text-muted">No comments yet.</p> : null}
          </div>
          <form onSubmit={onComment} className="mt-3">
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} maxLength={5000} placeholder="Add a comment" className="w-full rounded-[10px] border border-line bg-surface px-3 py-2 text-[14px]" />
            <button type="submit" disabled={Boolean(busy) || !comment.trim()} className="mt-2 h-11 rounded-[10px] bg-action px-4 text-[14px] font-semibold text-white disabled:opacity-40">Comment</button>
          </form>
        </section>
      </section>

      <aside className="border-t border-line px-4 py-5 min-[880px]:px-6 min-[1100px]:border-l min-[1100px]:border-t-0">
        <h2 className="text-[15px] font-semibold">Progress</h2>
        <ol className="mt-3 space-y-3 border-l border-line pl-4">
          {[...task.activities].reverse().map((activity) => (
            <li key={activity.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-action" />
              <p className="text-[13px] font-medium">{activity.message}</p>
              <p className="text-[12px] text-muted">{formatDateTime(activity.createdAt)}</p>
            </li>
          ))}
        </ol>
        <dl className="mt-6 border-t border-line text-[13px]">
          <div className="flex justify-between gap-2 border-b border-line py-2"><dt className="text-muted">Submitted</dt><dd>{formatDateTime(task.submittedAt)}</dd></div>
          <div className="flex justify-between gap-2 border-b border-line py-2"><dt className="text-muted">Completed</dt><dd>{formatDateTime(task.completedAt)}</dd></div>
          <div className="flex justify-between gap-2 border-b border-line py-2"><dt className="text-muted">Reminders</dt><dd>{task.reminderOffsets.length}</dd></div>
        </dl>
      </aside>
    </div>
  );
}

const actionClass = "h-10 rounded-[10px] border border-line px-3 text-[14px] text-ink-soft disabled:opacity-40";
const primaryClass = "h-10 rounded-[10px] bg-action px-3 text-[14px] font-semibold text-white disabled:opacity-40";
const dangerClass = "h-10 rounded-[10px] border border-danger px-3 text-[14px] text-danger disabled:opacity-40";
