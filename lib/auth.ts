import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { q } from "./db";
import type { DepartmentSlug, Role } from "./labels";

export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  departmentSlug: DepartmentSlug;
  active: boolean;
};

const attempts = new Map<string, { n: number; reset: number }>();

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function cookieValue(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string, maxAge: number) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `desk_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}

function mapUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    role: row.role as Role,
    departmentSlug: row.department_slug as DepartmentSlug,
    active: Boolean(row.active),
  };
}

export async function userById(id: string) {
  const rows = await q(`SELECT id, email, name, role, department_slug, active FROM users WHERE id = $1`, [id]);
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function userFromToken(token: string | null) {
  if (!token) return null;
  const rows = await q(
    `SELECT u.id, u.email, u.name, u.role, u.department_slug, u.active
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active = true`,
    [hashToken(token)],
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function userFromRequest(request: Request) {
  return userFromToken(cookieValue(request.headers.get("cookie"), "desk_session"));
}

export function rateLimit(key: string) {
  const now = Date.now();
  const hit = attempts.get(key);
  if (!hit || hit.reset < now) {
    attempts.set(key, { n: 1, reset: now + 10 * 60 * 1000 });
    return 0;
  }
  hit.n += 1;
  if (hit.n > 10) return Math.ceil((hit.reset - now) / 1000);
  return 0;
}

export async function checkPassword(email: string, password: string) {
  const rows = await q<{ password_hash: string; id: string; active: boolean }>(
    `SELECT id, password_hash, active FROM users WHERE lower(email) = lower($1)`,
    [email],
  );
  const row = rows[0];
  if (!row || !row.active) return null;
  const ok = await verify(row.password_hash, password);
  return ok ? userById(String(row.id)) : null;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`, [
    hashToken(token),
    userId,
    expires.toISOString(),
  ]);
  return token;
}

export async function destroySession(token: string | null) {
  if (!token) return;
  await q(`DELETE FROM sessions WHERE token_hash = $1`, [hashToken(token)]);
}

export async function hashPassword(password: string) {
  return hash(password);
}

export function sameSecret(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
