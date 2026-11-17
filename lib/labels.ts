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
