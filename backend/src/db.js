import pg from "pg";
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export async function query(text, params) { return pool.query(text, params); }
