"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  api,
  formatDateTime,
  said,
  TASK_PRIORITY_LABEL,
  TASK_STATUS_LABEL,
  TASK_STEP_STATUS_LABEL,
  type TaskReport,
  type TaskReminderStatus,
} from "./api";
import { useDesk } from "./provider";
import { SpinnerBlock } from "./spinner";

export function TaskReports() {
  const { me, departments, toast } = useDesk();
  const [scope, setScope] = useState<"mine" | "team" | "organization">("mine");
  const [period, setPeriod] = useState("daily");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [report, setReport] = useState<TaskReport | null>(null);
  const [reminders, setReminders] = useState<TaskReminderStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  const params = new URLSearchParams({ scope, period, date });
  if (employeeId && me?.role !== "member") params.set("employeeId", employeeId);
  if (departmentId && me?.role !== "member") params.set("departmentId", departmentId);
  const query = params.toString();

  useEffect(() => {
    let ignore = false;
    setBusy(true);
    Promise.all([
      api<TaskReport>(`/reports/tasks/data?${query}`),
      api<TaskReminderStatus>("/notifications/status"),
    ])
      .then(([body, status]) => {
        if (ignore) return;
        setReport(body);
        setReminders(status);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!ignore) setError(said(reason, "That report could not be loaded."));
      })
      .finally(() => {
        if (!ignore) setBusy(false);
      });
    return () => {
      ignore = true;
    };
  }, [query, reload]);

  async function runReminders() {
    setBusy(true);
    try {
      const result = await api<{ ok: true; delivered: number; at: string }>("/tasks/reminders/run", { method: "POST", body: "{}" });
      setReload((value) => value + 1);
      toast(`${result.delivered} reminder(s) delivered.`);
    } catch (reason) {
      const message = said(reason, "Reminders could not be delivered.");
      setError(message);
      toast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  const reportDepartments = me?.role === "admin" ? departments : departments.filter((item) => item.slug === me?.departmentSlug);
  const reportPeople = reportDepartments
    .filter((item) => !departmentId || item.slug === departmentId)
    .flatMap((item) => item.recipients)
    .filter((person) => person.active && person.role !== "admin");

  return (
    <section className="min-w-0">
      <header className="border-b border-line px-4 py-5 min-[880px]:px-8">
        <Link href="/tasks" className="inline-flex h-9 items-center text-[14px] text-action">← Tasks</Link>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight">Task reports</h1>
        <p className="mt-1 max-w-[70ch] text-[15px] leading-6 text-ink-soft">
          Completion, on-time delivery, overdue work and interdepartmental handoffs for the selected period.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[14px]">
            <option value="mine">Assigned to me</option>
            {me?.role === "lead" || me?.role === "admin" ? <option value="team">My department</option> : null}
            {me?.role === "admin" ? <option value="organization">Everyone</option> : null}
          </select>
          <select value={period} onChange={(event) => setPeriod(event.target.value)} className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[14px]">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[14px]" />
          {me?.role !== "member" ? (
            <>
              <select
                value={departmentId}
                onChange={(event) => { setDepartmentId(event.target.value); setEmployeeId(""); }}
                aria-label="Filter by department"
                className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[14px]"
              >
                <option value="">All departments</option>
                {reportDepartments.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}
              </select>
              <select
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
                aria-label="Filter by employee"
                className="h-11 rounded-[10px] border border-line bg-surface px-3 text-[14px]"
              >
                <option value="">All employees</option>
                {reportPeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </>
          ) : null}
          <a href={`/api/v1/reports/tasks?${query}`} className="inline-flex h-11 items-center rounded-[10px] border border-line px-3 text-[14px] text-ink-soft">CSV</a>
          <a href={`/api/v1/reports/tasks/pdf?${query}`} className="inline-flex h-11 items-center rounded-[10px] border border-line px-3 text-[14px] text-ink-soft">PDF</a>
          <a href={`/api/v1/reports/task-steps?${query}`} className="inline-flex h-11 items-center rounded-[10px] border border-line px-3 text-[14px] text-ink-soft">Handoffs CSV</a>
        </div>
      </header>

      {error ? <p className="px-4 py-4 text-[14px] text-danger min-[880px]:px-8">{error}</p> : null}
      {busy && !report ? <SpinnerBlock label="Loading report" /> : null}
      {!report ? null : (
        <div className="space-y-6 px-4 py-5 min-[880px]:px-8">
          <div className="grid gap-3 min-[560px]:grid-cols-2 min-[880px]:grid-cols-3">
            {[
              ["In view", report.metrics.total],
              ["Assigned", report.metrics.assigned],
              ["Due", report.metrics.due],
              ["Completed", report.metrics.completed],
              ["On time", report.metrics.completedOnTime],
              ["On-time rate", `${report.metrics.onTimeRate}%`],
              ["Overdue", report.metrics.overdue],
              ["Active", report.metrics.active],
              ["Completion rate", `${report.metrics.completionRate}%`],
              ["Average hours", report.metrics.averageCompletionHours],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-[14px] border border-line p-4">
                <p className="text-[13px] text-muted">{label}</p>
                <p className="mt-1 text-[24px] font-semibold">{value}</p>
              </div>
            ))}
          </div>

          <section className="rounded-[14px] border border-line p-4">
            <h2 className="text-[16px] font-semibold">Status breakdown</h2>
            <div className="mt-3 space-y-2">
              {report.statusData.map((item) => (
                <div key={item.status} className="flex items-center gap-3 text-[13px]">
                  <span className="w-32 shrink-0">{TASK_STATUS_LABEL[item.status]}</span>
                  <span className="h-2 flex-1 rounded-full bg-wash">
                    <span className="block h-2 rounded-full bg-action" style={{ width: `${report.metrics.total ? (item.count / report.metrics.total) * 100 : 0}%` }} />
                  </span>
                  <span className="w-8 shrink-0 text-right font-mono">{item.count}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[14px] border border-line p-4">
            <h2 className="text-[16px] font-semibold">Created and completed</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[13px]">
                <thead className="text-muted"><tr><th className="py-2">Date</th><th>Created</th><th>Completed</th></tr></thead>
                <tbody>
                  {report.trend.map((point) => (
                    <tr key={point.label} className="border-t border-line"><td className="py-2 font-mono">{point.label}</td><td>{point.created}</td><td>{point.completed}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[14px] border border-line p-4">
            <h2 className="text-[16px] font-semibold">People</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="text-muted"><tr><th className="py-2">Person</th><th>Department</th><th>In view</th><th>Assigned</th><th>Completed</th><th>On time</th><th>On-time rate</th><th>Overdue</th><th>Average hours</th></tr></thead>
                <tbody>
                  {report.people.map((person) => (
                    <tr key={person.id} className="border-t border-line">
                      <td className="py-2">{person.name}</td><td>{person.department}</td><td>{person.total}</td><td>{person.assigned}</td><td>{person.completed}</td><td>{person.onTime}</td><td>{person.onTimeRate}%</td><td>{person.overdue}</td><td>{person.averageCompletionHours.toFixed(1)}</td>
                    </tr>
                  ))}
                  {report.people.length === 0 ? <tr><td colSpan={9} className="py-4 text-muted">No tasks in this period.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[14px] border border-line p-4">
            <h2 className="text-[16px] font-semibold">Departments</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[620px] text-left text-[13px]">
                <thead className="text-muted"><tr><th className="py-2">Department</th><th>People</th><th>In view</th><th>Assigned</th><th>Completed</th><th>On time</th><th>On-time rate</th><th>Overdue</th></tr></thead>
                <tbody>
                  {report.departments.map((department) => (
                    <tr key={department.slug} className="border-t border-line">
                      <td className="py-2">{department.name}</td><td>{department.members}</td><td>{department.total}</td><td>{department.assigned}</td><td>{department.completed}</td><td>{department.onTime}</td><td>{department.onTimeRate}%</td><td>{department.overdue}</td>
                    </tr>
                  ))}
                  {report.departments.length === 0 ? <tr><td colSpan={8} className="py-4 text-muted">No departments in this period.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[14px] border border-line p-4">
            <h2 className="text-[16px] font-semibold">Task details</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[13px]">
                <thead className="text-muted"><tr><th className="py-2">Task</th><th>Name</th><th>Assignee</th><th>Priority</th><th>Status</th><th>Due</th><th>Completed</th></tr></thead>
                <tbody>
                  {report.tasks.map((task) => (
                    <tr key={task.id} className="border-t border-line">
                      <td className="py-2 font-mono">{task.id}</td>
                      <td><Link href={`/tasks/${task.id}`} className="text-action">{task.name}</Link></td>
                      <td>{task.assignee.name}</td>
                      <td>{TASK_PRIORITY_LABEL[task.priority]}</td>
                      <td>{TASK_STATUS_LABEL[task.status]}</td>
                      <td>{formatDateTime(task.dueAt)}</td>
                      <td>{task.completedAt ? formatDateTime(task.completedAt) : "—"}</td>
                    </tr>
                  ))}
                  {report.tasks.length === 0 ? <tr><td colSpan={7} className="py-4 text-muted">No tasks in this period.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[14px] border border-line p-4">
            <h2 className="text-[16px] font-semibold">Interdepartmental handoffs</h2>
            <p className="mt-1 text-[13px] text-muted">
              {report.delegationMetrics.total} steps · {report.delegationMetrics.completed} completed · {report.delegationMetrics.completionRate}% completion · {report.delegationMetrics.onTimeRate}% on time · {report.delegationMetrics.averageHours} average hours
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="text-muted"><tr><th className="py-2">Task</th><th>Step</th><th>From</th><th>To</th><th>Head</th><th>Assignee</th><th>Status</th><th>Due</th></tr></thead>
                <tbody>
                  {report.delegatedSteps.map((step) => (
                    <tr key={step.id} className="border-t border-line">
                      <td className="py-2 font-mono">{step.taskId}</td><td>{step.title}</td><td>{step.sourceDepartment || "—"}</td><td>{step.targetDepartment || "—"}</td><td>{step.targetLead?.name || "—"}</td><td>{step.assignee.name}</td><td>{TASK_STEP_STATUS_LABEL[step.status]}</td><td>{formatDateTime(step.dueAt)}</td>
                    </tr>
                  ))}
                  {report.delegatedSteps.length === 0 ? <tr><td colSpan={8} className="py-4 text-muted">No handoffs in this period.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-[14px] border border-line p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold">Reminders</h2>
                <p className="mt-1 text-[13px] text-muted">
                  {reminders ? `${reminders.due} due · ${reminders.delivered} delivered · checked ${new Date(reminders.at).toLocaleString()}` : "Checking…"}
                </p>
              </div>
              {me?.role === "admin" ? (
                <button type="button" disabled={busy} onClick={() => void runReminders()} className="h-11 rounded-[10px] bg-action px-4 text-[14px] font-semibold text-white disabled:opacity-40">Run delivery</button>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
