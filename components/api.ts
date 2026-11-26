export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, { ...init, headers, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "No connection. Check the network and try again.");
  }
  if (response.status === 204) return undefined as T;
  const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok) throw new ApiError(response.status, data.error?.message || "Request failed.");
  return data as T;
}

export function said(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export type Me = {
  id: string;
  email: string;
  name: string;
  role: "member" | "lead" | "admin";
  departmentSlug: string;
  watches: string[];
  active: boolean;
};

export type Person = {
  id: string;
  name: string;
  role: string;
  departmentSlug: string;
  active: boolean;
  email?: string;
};

export type Ticket = {
  id: string;
  title: string;
  status: "open" | "in_progress" | "waiting" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  requester: Person;
  sourceDepartment: string;
  targetDepartment: string;
  assignee: Person | null;
  createdAt: string;
  updatedAt: string;
};

export type Attachment = { id: string; messageId: string; name: string; mediaType: string; size: number };

export type Message = {
  id: string;
  ticketId: string;
  author: Person;
  body: string;
  createdAt: string;
  attachments: Attachment[];
};

export type TicketEvent = {
  id: string;
  type: string;
  fromStatus: string | null;
  toStatus: string;
  actor: Person | null;
  createdAt: string;
};

export type TicketDetail = Ticket & { messages: Message[]; watchers: Person[]; events: TicketEvent[] };

export type Badges = {
  inbox: number;
  queue: number;
  alerts: number;
  monitor?: { raised: number; pending: number; resolved: number; closed: number };
};

export type Department = { slug: string; name: string; recipients: Person[] };

export type Notice = {
  id: string;
  type: string;
  ticketId: string | null;
  departmentSlug?: string;
  sentence: string;
  sound: "raise" | "reply" | "status";
  read: boolean;
  createdAt: string;
  actor: Person;
};

export type Receipt = {
  id: string;
  state: "queued" | "sent" | "failed";
  to: string[];
  cc: string[];
  event: string;
  createdAt: string;
};

export const STATUS_LABEL = {
  open: "Open",
  in_progress: "In progress",
  waiting: "Waiting",
  resolved: "Resolved",
  closed: "Closed",
} as const;

export const EVENT_LABEL: Record<string, string> = {
  created: "Raised",
  assigned: "Assigned",
  unassigned: "Unassigned",
  started: "Work started",
  waiting: "Waiting on requester",
  resolved: "Completed",
  reopened: "Reopened",
  closed: "Closed",
};

export function stageHint(status: string) {
  if (status === "open") return "Waiting for the receiving team to begin work.";
  if (status === "in_progress") return "The receiving team is working on this ticket.";
  if (status === "waiting") return "The receiving team needs something before it can continue.";
  if (status === "resolved") return "Work completed. Reply if you need anything else.";
  return "This ticket is finished and locked.";
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(iso));
}

export function badgeText(count: number) {
  if (count > 99) return "99+";
  return String(count);
}
