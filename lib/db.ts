import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import { DEPARTMENT_NAMES, DEPARTMENT_SLUGS, type DepartmentSlug, type Role } from "./labels";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

type Runner = {
  unsafe: (text: string, params: unknown[]) => Promise<unknown>;
};

export type Query = <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>;

type Db = {
  query: Query;
  tx: <T>(fn: () => Promise<T>) => Promise<T>;
};

const runnerStore = new AsyncLocalStorage<Runner>();
const inTx = new AsyncLocalStorage<boolean>();
let chain: Promise<unknown> = Promise.resolve();

function lock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function globals() {
  return globalThis as { __deskDb?: Db; __deskReady?: Promise<void> };
}

function statements(sql: string) {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith("--"));
}

async function migrate(db: Db) {
  const existing = await db.query<{ name: string | null }>(`SELECT to_regclass('public.departments') AS name`);
  if (existing[0]?.name) return;
  const schema = readFileSync(join(root, "schema.sql"), "utf8");
  for (const statement of statements(schema)) {
    await db.query(statement);
  }
}

async function seed(db: Db) {
  for (let i = 0; i < DEPARTMENT_SLUGS.length; i++) {
    const slug = DEPARTMENT_SLUGS[i];
    await db.query(
      `INSERT INTO departments (slug, name, position) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING`,
      [slug, DEPARTMENT_NAMES[slug], i + 1],
    );
  }

  const password = process.env.SEED_PASSWORD || "Desk-staff-1";
  const passwordHash = await hash(password);
  const staff: { name: string; email: string; role: Role; dept: DepartmentSlug; queue: boolean }[] = [
    { name: "Amaka Okonkwo", email: "admin@vethancon.com", role: "admin", dept: "it-software", queue: true },
    { name: "Chinedu Adeyemi", email: "chinedu@vethancon.com", role: "lead", dept: "it-software", queue: true },
    { name: "Ngozi Bello", email: "ngozi@vethancon.com", role: "lead", dept: "business-operations", queue: true },
    { name: "Halima Yusuf", email: "halima@vethancon.com", role: "lead", dept: "hr-admin", queue: true },
    { name: "Emeka Nwosu", email: "emeka@vethancon.com", role: "lead", dept: "account-finance", queue: true },
    { name: "Funke Adewale", email: "funke@vethancon.com", role: "lead", dept: "sales", queue: true },
    { name: "Tunde Bakare", email: "tunde@vethancon.com", role: "member", dept: "sales", queue: false },
    { name: "Ibrahim Lawal", email: "ibrahim@vethancon.com", role: "lead", dept: "business-development", queue: true },
    { name: "Chioma Eze", email: "chioma@vethancon.com", role: "lead", dept: "exhibition", queue: true },
    { name: "Zainab Mohammed", email: "zainab@vethancon.com", role: "lead", dept: "creative-marketing", queue: true },
    { name: "Segun Okafor", email: "segun@vethancon.com", role: "lead", dept: "logistic-warehouse", queue: true },
    { name: "Kemi Adebayo", email: "kemi@vethancon.com", role: "member", dept: "it-software", queue: false },
    { name: "Bola Akin", email: "bola@vethancon.com", role: "member", dept: "business-operations", queue: false },
    { name: "Aisha Bello", email: "aisha@vethancon.com", role: "member", dept: "hr-admin", queue: false },
    { name: "Yusuf Danjuma", email: "yusuf@vethancon.com", role: "member", dept: "account-finance", queue: false },
    { name: "Seyi Ogun", email: "seyi@vethancon.com", role: "member", dept: "business-development", queue: false },
    { name: "Nneka Umeh", email: "nneka@vethancon.com", role: "member", dept: "exhibition", queue: false },
    { name: "Femi Cole", email: "femi@vethancon.com", role: "member", dept: "creative-marketing", queue: false },
    { name: "Hassan Musa", email: "hassan@vethancon.com", role: "member", dept: "logistic-warehouse", queue: false },
  ];

  for (const person of staff) {
    const existing = await db.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1)`, [person.email]);
    const id = existing[0] ? String(existing[0].id) : randomUUID();
    if (!existing[0]) {
      await db.query(
        `INSERT INTO users (id, email, name, password_hash, role, department_slug) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, person.email, person.name, passwordHash, person.role, person.dept],
      );
    }
    if (person.queue) {
      await db.query(
        `INSERT INTO department_recipients (department_slug, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [person.dept, id],
      );
    }
  }

  console.log(`Desk seeded. Accounts are listed in docs/deployment.md`);
}

async function seedSamples(db: Db) {
  const count = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM tickets`);
  if (Number(count[0]?.n) >= 6) return;
  const people = await db.query<{ id: string; email: string; department_slug: string }>(
    `SELECT id, email, department_slug FROM users`,
  );
  const byEmail = new Map(people.map((person) => [person.email, person]));
  const samples: { from: string; to: string; title: string; body: string; status: string; priority: string }[] = [
    {
      from: "tunde@vethancon.com",
      to: "exhibition",
      title: "Power drop for the Scientifika booth",
      body: "Stand B12 needs two 13A feeds before setup on Thursday. The floor plan is with Exhibition.",
      status: "open",
      priority: "high",
    },
    {
      from: "funke@vethancon.com",
      to: "logistic-warehouse",
      title: "Pull stock for the Yaba demo kits",
      body: "Please pick eight demo kits and hold them for Sales. We collect on Wednesday morning.",
      status: "in_progress",
      priority: "normal",
    },
    {
      from: "chioma@vethancon.com",
      to: "it-software",
      title: "Badge scanner keeps dropping the network",
      body: "The scanner at the registration desk loses Wi-Fi every few minutes. IT has the device label on the case.",
      status: "waiting",
      priority: "urgent",
    },
    {
      from: "halima@vethancon.com",
      to: "account-finance",
      title: "Confirm the March pension file",
      body: "HR has uploaded the pension schedule. Please confirm it matches the payroll run before Friday.",
      status: "open",
      priority: "normal",
    },
    {
      from: "zainab@vethancon.com",
      to: "sales",
      title: "Copy for the distributor one-pager",
      body: "Creative needs the three product lines Sales wants on the one-pager, and who signs it off.",
      status: "resolved",
      priority: "normal",
    },
    {
      from: "ibrahim@vethancon.com",
      to: "creative-marketing",
      title: "Leave-behind for the Friday partner meeting",
      body: "Business development meets a partner on Friday. A two-page leave-behind is enough. No new photography.",
      status: "open",
      priority: "high",
    },
    {
      from: "segun@vethancon.com",
      to: "account-finance",
      title: "Freight invoice for the last inbound pallet",
      body: "Warehouse has the carrier invoice. Please say which cost centre it should hit.",
      status: "closed",
      priority: "low",
    },
    {
      from: "ngozi@vethancon.com",
      to: "hr-admin",
      title: "Desk and access for the new operations hire",
      body: "They start Monday at Ogudu. HR needs a desk, an email, and a building pass.",
      status: "in_progress",
      priority: "normal",
    },
  ];
  for (const sample of samples) {
    const author = byEmail.get(sample.from);
    if (!author) continue;
    const existing = await db.query(`SELECT 1 FROM tickets WHERE title = $1`, [sample.title]);
    if (existing.length) continue;
    const seq = await db.query<{ id: string }>(`SELECT 'VC-' || nextval('ticket_no') AS id`);
    const id = String(seq[0].id);
    await db.query(
      `INSERT INTO tickets (id, title, status, priority, requester_id, source_department, target_department)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, sample.title, sample.status, sample.priority, author.id, author.department_slug, sample.to],
    );
    await db.query(`INSERT INTO messages (id, ticket_id, author_id, body) VALUES ($1, $2, $3, $4)`, [
      randomUUID(),
      id,
      author.id,
      sample.body,
    ]);
  }
}

async function open(): Promise<Db> {
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (url) {
    const postgres = (await import("postgres")).default;
    const sql = postgres(url, { max: 10 });
    const query: Query = async (text, params = []) => {
      const runner = runnerStore.getStore();
      const rows = runner ? await runner.unsafe(text, params) : await sql.unsafe(text, params as never[]);
      return rows as never;
    };
    return {
      query,
      tx: (fn) =>
        sql.begin((txSql) =>
          runnerStore.run(
            { unsafe: (text, params) => txSql.unsafe(text, params as never[]) as Promise<unknown> },
            fn,
          ),
        ) as Promise<never>,
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = join(root, "data", "pglite");
  mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  const queryNow: Query = async (text, params = []) => {
    const result = await pg.query(text, params);
    return result.rows as never;
  };
  const query: Query = (text, params) => (inTx.getStore() ? queryNow(text, params) : lock(() => queryNow(text, params)));
  return {
    query,
    tx: (fn) =>
      lock(() =>
        inTx.run(true, async () => {
          await pg.exec("BEGIN");
          try {
            const value = await fn();
            await pg.exec("COMMIT");
            return value;
          } catch (error) {
            await pg.exec("ROLLBACK");
            throw error;
          }
        }),
      ),
  };
}

export async function getDb() {
  const slot = globals();
  if (!slot.__deskDb) {
    slot.__deskDb = await open();
    slot.__deskReady = migrate(slot.__deskDb)
      .then(() => seed(slot.__deskDb as Db))
      .then(() => seedSamples(slot.__deskDb as Db));
  }
  await slot.__deskReady;
  return slot.__deskDb;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return db.query<T>(sql, params);
}

export async function tx<T>(fn: () => Promise<T>) {
  const db = await getDb();
  return db.tx(fn);
}
