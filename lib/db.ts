import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

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
    .replace(/^\s*--.*$/gm, "")
    .split(/;\s*(?:\n|$)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const migrations = [
  { version: 1, file: "schema.sql" },
  { version: 2, file: "migrations/002_sso.sql" },
  { version: 3, file: "migrations/003_sso_repair.sql" },
  { version: 4, file: "migrations/004_ticket_events.sql" },
];

async function migrate(db: Db) {
  await db.tx(async () => {
    // Serialize schema setup across app instances connected to PostgreSQL.
    await db.query("SELECT pg_advisory_xact_lock(7219441)");
    await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY)");
    for (const migration of migrations) {
      const applied = await db.query("SELECT 1 FROM schema_migrations WHERE version = $1", [migration.version]);
      if (applied.length) continue;
      const sql = readFileSync(join(root, migration.file), "utf8");
      for (const statement of statements(sql)) {
        // Complete databases created before version tracking, including interrupted setup.
        const resumable = /^CREATE (TABLE|INDEX|SEQUENCE) (?!IF NOT EXISTS )/.test(statement)
          ? statement.replace(/^CREATE (TABLE|INDEX|SEQUENCE) /, "CREATE $1 IF NOT EXISTS ")
          : statement;
        await db.query(resumable);
      }
      await db.query("INSERT INTO schema_migrations (version) VALUES ($1)", [migration.version]);
    }
  });
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
  if (!slot.__deskReady) {
    slot.__deskReady = (async () => {
      const db = slot.__deskDb ?? await open();
      slot.__deskDb = db;
      await migrate(db);
    })().catch((error) => {
      slot.__deskReady = undefined;
      throw error;
    });
  }
  await slot.__deskReady;
  return slot.__deskDb!;
}

export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  const db = await getDb();
  return db.query<T>(sql, params);
}

export async function tx<T>(fn: () => Promise<T>) {
  const db = await getDb();
  return db.tx(fn);
}
