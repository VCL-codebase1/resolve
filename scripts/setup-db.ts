import { getDb, q } from "../lib/db";

const db = await getDb();
void db;
const departments = await q<{ n: number }>(`SELECT count(*)::int AS n FROM departments`);
const users = await q<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
console.log(`Migration finished. ${departments[0]?.n ?? 0} departments, ${users[0]?.n ?? 0} users.`);
process.exit(0);
