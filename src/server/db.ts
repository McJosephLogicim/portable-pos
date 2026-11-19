import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is missing");
  // Supavisor's transaction pool can assign a different connection per transaction.
  return drizzle(
    postgres(url, {
      prepare: false,
      max: 2,
      idle_timeout: 20,
      connect_timeout: 10,
    }),
  );
}

let database: ReturnType<typeof connect>;

export function getDb() {
  return (database ??= connect());
}

export type Transaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];
