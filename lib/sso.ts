import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { hashToken, userById, type User } from "./auth";
import { q } from "./db";
import { DEPARTMENT_NAMES, isSlug, type DepartmentSlug, type Role } from "./labels";

export type SsoDoor = "staff" | "admin";

export type Assertion = {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  name: string;
  role: string;
  departmentId: string | null;
  departmentName?: string | null;
  employmentStatus: string;
  iat: number;
  exp: number;
  jti: string;
};

export function ssoConfig() {
  return {
    issuer: process.env.SSO_ISSUER || process.env.VCGLONE_URL || "",
    clientId: process.env.SSO_CLIENT_ID || "",
    secret: process.env.SSO_SHARED_SECRET || "",
    vcgloneUrl: process.env.VCGLONE_URL || process.env.SSO_ISSUER || "",
  };
}

export function ssoReady() {
  const { issuer, clientId, secret, vcgloneUrl } = ssoConfig();
  return Boolean(issuer && clientId && secret && vcgloneUrl);
}

function secretKey() {
  const { secret } = ssoConfig();
  if (!secret) throw new Error("SSO_SHARED_SECRET is not set");
  return secret;
}

export function signState(state: string, door: SsoDoor) {
  return createHmac("sha256", secretKey()).update(`${state}.${door}`).digest("base64url");
}

export function verifyState(value: string | null): { state: string; door: SsoDoor } | null {
  if (!value || !ssoConfig().secret) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [state, door, signature] = parts;
  if (door !== "staff" && door !== "admin") return null;
  const expected = signState(state, door);
  if (!sameText(signature, expected)) return null;
  return { state, door };
}

function sameText(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyAssertion(token: string): Assertion {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed assertion");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;

  const expected = createHmac("sha256", secretKey()).update(`${encodedHeader}.${encodedPayload}`).digest();
  const signature = Buffer.from(encodedSignature, "base64url");
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
    throw new Error("Bad assertion signature");
  }

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as { alg?: string; typ?: string };
  if (header.alg !== "HS256" || header.typ !== "JWT") throw new Error("Unexpected assertion algorithm");

  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as Assertion;
  const { issuer, clientId } = ssoConfig();
  if (!issuer || payload.iss !== issuer) throw new Error("Unexpected assertion issuer");
  if (!clientId || payload.aud !== clientId) throw new Error("Unexpected assertion audience");

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp <= now || payload.exp > now + 300) {
    throw new Error("Assertion expired or out of range");
  }
  if (!payload.sub || !payload.email || !payload.jti) throw new Error("Incomplete assertion");
  return payload;
}

export async function consumeAssertion(jti: string, expiresAt: number) {
  // A one-time assertion cannot be replayed after a callback is retried or leaked.
  await q(`DELETE FROM sso_assertions WHERE expires_at < now()`);
  const rows = await q<{ jti_hash: string }>(
    `INSERT INTO sso_assertions (jti_hash, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT DO NOTHING RETURNING jti_hash`,
    [hashToken(jti), expiresAt],
  );
  if (!rows.length) throw new Error("Assertion already used");
}

function deskRole(vcgloneRole: string): Role {
  if (vcgloneRole === "MANAGER") return "lead";
  if (vcgloneRole === "HR_ADMIN" || vcgloneRole === "SUPER_ADMIN") return "admin";
  return "member";
}

// vcglone department names -> Desk queue slugs. Names are normalized before lookup.
const VCGLONE_DEPARTMENT_MAP: Record<string, DepartmentSlug> = {
  "account-finance-admin": "account-finance",
  "business-development-training-centre": "business-development",
  "creative-marketing": "creative-marketing",
  "etcon-labs-team": "it-software",
  "exhibition-team": "exhibition",
  "human-resource": "hr-admin",
  "it-department": "it-software",
  logistics: "logistic-warehouse",
  "operations-team": "business-operations",
  "procument-and-customer-service": "creative-marketing",
  "sales-and-biz-development": "sales",
  "technical-sales": "sales",
};

function normalizeDepartmentName(name: string) {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function departmentOverrides(): Record<string, DepartmentSlug> {
  try {
    const parsed = JSON.parse(process.env.SSO_DEPARTMENT_MAP || "{}") as Record<string, string>;
    const result: Record<string, DepartmentSlug> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (isSlug(value)) result[normalizeDepartmentName(name)] = value;
    }
    return result;
  } catch {
    return {};
  }
}

function fallbackDepartment(): DepartmentSlug {
  const slug = process.env.SSO_DEFAULT_DEPARTMENT || "it-software";
  return isSlug(slug) ? slug : "it-software";
}

function deskDepartment(claims: Assertion): DepartmentSlug {
  const name = claims.departmentName;
  if (name) {
    const key = normalizeDepartmentName(name);
    const mapped = departmentOverrides()[key] ?? VCGLONE_DEPARTMENT_MAP[key] ?? (isSlug(key) ? key : undefined);
    if (mapped) return mapped;
  }
  return fallbackDepartment();
}

async function ensureDepartment(slug: DepartmentSlug) {
  await q(`INSERT INTO departments (slug, name, position) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`, [
    slug,
    DEPARTMENT_NAMES[slug],
  ]);
}

async function syncUser(id: string, claims: Assertion) {
  const slug = deskDepartment(claims);
  await ensureDepartment(slug);
  const current = await q<{ department_slug: string }>(`SELECT department_slug FROM users WHERE id = $1`, [id]);
  const previous = current[0]?.department_slug;
  await q(
    `UPDATE users
     SET name = $1, role = $2, department_slug = $3, sso_subject = COALESCE(sso_subject, $4), identity_provider = 'vcglone'
     WHERE id = $5`,
    [claims.name, deskRole(claims.role), slug, claims.sub, id],
  );
  const taken = await q(`SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2`, [claims.email, id]);
  if (!taken.length) await q(`UPDATE users SET email = $1 WHERE id = $2`, [claims.email, id]);
  if (previous && previous !== slug) {
    await q(`DELETE FROM department_recipients WHERE user_id = $1 AND department_slug = $2`, [id, previous]);
    await q(`INSERT INTO department_recipients (department_slug, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [slug, id]);
  }
}

export async function userFromAssertion(claims: Assertion): Promise<User | null> {
  const bySubject = await q<{ id: string }>(`SELECT id FROM users WHERE sso_subject = $1`, [claims.sub]);
  let id = bySubject[0]?.id;

  if (!id) {
    const byEmail = await q<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1)`, [claims.email]);
    id = byEmail[0]?.id;
  }

  if (!id) {
    const slug = deskDepartment(claims);
    // A fresh database has no queues yet; make the mapped queue usable on first login.
    await ensureDepartment(slug);
    const created = await q<{ id: string }>(
      `INSERT INTO users (id, email, name, role, department_slug, active, sso_subject, identity_provider)
       VALUES ($1,$2,$3,$4,$5,true,$6,'vcglone')
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [randomUUID(), claims.email, claims.name, deskRole(claims.role), slug, claims.sub],
    );
    id = created[0]?.id;
    if (!id) {
      const race = await q<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1)`, [claims.email]);
      id = race[0]?.id;
    }
  }

  if (!id) return null;
  await syncUser(String(id), claims);
  await q(
    `INSERT INTO department_recipients (department_slug, user_id)
     SELECT department_slug, $1 FROM users WHERE id = $1
     ON CONFLICT DO NOTHING`,
    [id],
  );
  return userById(String(id));
}
