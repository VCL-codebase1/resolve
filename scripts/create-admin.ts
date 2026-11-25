import { randomUUID } from "node:crypto";
import { hashPassword } from "../lib/auth";
import { q, tx } from "../lib/db";

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.ADMIN_NAME?.trim();
const password = process.env.ADMIN_PASSWORD;
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !password || password.length < 10 || password === "Desk-staff-1") {
  throw new Error("Set ADMIN_EMAIL, ADMIN_NAME, and a custom ADMIN_PASSWORD of at least 10 characters.");
}

const passwordHash = await hashPassword(password);
await tx(async () => {
  await q("SELECT pg_advisory_xact_lock(7219442)");
  const existing = await q("SELECT id FROM users WHERE lower(email) = $1", [email]);
  if (existing.length) throw new Error("An account with ADMIN_EMAIL already exists. Use Directory to manage it.");
  const id = randomUUID();
  await q(
    "INSERT INTO users (id, email, name, password_hash, role, department_slug) VALUES ($1,$2,$3,$4,'admin','it-software')",
    [id, email, name, passwordHash],
  );
  await q("INSERT INTO department_recipients (department_slug, user_id) VALUES ('it-software', $1)", [id]);
});
console.log("Administrator created. Sign in at /admin.");
process.exit(0);
