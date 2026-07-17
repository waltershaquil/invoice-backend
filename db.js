import pg from "pg";
import dotenv from "dotenv";

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const connectionString = process.env.DATABASE_URL || "postgresql://localhost/postgres";

// Enable SSL for hosted Postgres (Supabase/Neon). Avoid forcing SSL for localhost.
const useSsl = !/localhost|127\.0\.0\.1/.test(connectionString);
export const pool = new pg.Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

export async function query(text, params) {
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (err) {
    console.error("DB query error:", err.message || err);
    throw err;
  }
}

export default pool;
