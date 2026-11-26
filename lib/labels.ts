export const DEPARTMENT_SLUGS = [
  "it-software",
  "business-operations",
  "hr-admin",
  "account-finance",
  "sales",
  "business-development",
  "exhibition",
  "creative-marketing",
  "logistic-warehouse",
] as const;

export type DepartmentSlug = (typeof DEPARTMENT_SLUGS)[number];

export const DEPARTMENT_NAMES: Record<DepartmentSlug, string> = {
  "it-software": "IT / Software",
  "business-operations": "Business Operations",
  "hr-admin": "HR / Admin",
  "account-finance": "Account / Finance",
  sales: "Sales",
  "business-development": "Business Development",
  exhibition: "Exhibition",
  "creative-marketing": "Creative Marketing / Customer Service",
  "logistic-warehouse": "Logistic / Warehouse",
};

export const ROLES = ["member", "lead", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const STATUSES = ["open", "in_progress", "waiting", "resolved", "closed"] as const;
export type Status = (typeof STATUSES)[number];

export const PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  resolved: "Resolved",
  closed: "Closed",
};

export function isSlug(value: string): value is DepartmentSlug {
  return (DEPARTMENT_SLUGS as readonly string[]).includes(value);
}

export function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

export function isPriority(value: string): value is Priority {
  return (PRIORITIES as readonly string[]).includes(value);
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function unresolved(status: Status) {
  return status === "open" || status === "in_progress" || status === "waiting";
}

export const TASK_STATUSES = [
  "assigned",
  "in_progress",
  "blocked",
  "in_review",
  "changes_requested",
  "completed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STEP_STATUSES = ["assigned", "in_progress", "blocked", "completed", "cancelled"] as const;
export type TaskStepStatus = (typeof TASK_STEP_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_RESOURCE_TYPES = ["link", "file"] as const;
export type TaskResourceType = (typeof TASK_RESOURCE_TYPES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  blocked: "Blocked",
  in_review: "In review",
  changes_requested: "Changes requested",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const TASK_STEP_STATUS_LABEL: Record<TaskStepStatus, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export function isTaskStepStatus(value: string): value is TaskStepStatus {
  return (TASK_STEP_STATUSES as readonly string[]).includes(value);
}

export function isTaskPriority(value: string): value is TaskPriority {
  return (TASK_PRIORITIES as readonly string[]).includes(value);
}

export function isTaskResourceType(value: string): value is TaskResourceType {
  return (TASK_RESOURCE_TYPES as readonly string[]).includes(value);
}

export function taskClosed(status: TaskStatus) {
  return status === "completed" || status === "cancelled";
}

export function taskActive(status: TaskStatus) {
  return !taskClosed(status);
}
