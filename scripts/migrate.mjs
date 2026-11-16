import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("database migrations applied");
} catch (e) {
  console.error("database migration failed:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
