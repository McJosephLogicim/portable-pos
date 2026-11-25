import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";
import { databaseTlsOptions } from "../src/server/database-tls";

async function main() {
  const deployment = process.argv.includes("--deployment");
  const migrationUrl = process.env.DATABASE_MIGRATION_URL;
  const url = migrationUrl || (!deployment && process.env.DATABASE_URL);

  if (!url) {
    if (
      deployment &&
      process.env.VERCEL_ENV === "preview" &&
      !process.env.DATABASE_URL
    ) {
      console.log("Preview has no database. Skipping migrations.");
      return;
    }
    throw new Error("Set DATABASE_MIGRATION_URL for this environment.");
  }

  const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
  const db = postgres(url, {
    ...databaseTlsOptions(),
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  try {
    const applied = await db.begin(async (tx) => {
      await tx`set local lock_timeout = '15s'`;
      await tx`set local statement_timeout = '90s'`;
      // Hold the lock across the journal read, schema updates, and commit.
      await tx`select pg_advisory_xact_lock(1908174776, 1)`;
      const [metadata] = await tx`
        select to_regclass('drizzle.__drizzle_migrations') as table_name
      `;
      if (!metadata.table_name) {
        await tx`create schema if not exists drizzle`;
        await tx`
          create table drizzle.__drizzle_migrations (
            id serial primary key,
            hash text not null,
            created_at bigint not null
          )
        `;
      }

      const history = await tx<{ hash: string; created_at: string }[]>`
        select hash, created_at
        from drizzle.__drizzle_migrations
        order by created_at, id
      `;
      if (
        history.some(
          (row, index) =>
            !migrations[index] ||
            Number(row.created_at) !== migrations[index].folderMillis ||
            row.hash !== migrations[index].hash,
        )
      ) {
        throw new Error("The database migration history differs from this checkout.");
      }

      const pending = migrations.slice(history.length);
      for (const migration of pending) {
        for (const statement of migration.sql) {
          if (statement.trim()) await tx.unsafe(statement);
        }
        await tx`
          insert into drizzle.__drizzle_migrations (hash, created_at)
          values (${migration.hash}, ${migration.folderMillis})
        `;
      }
      return pending.length;
    });
    console.log(`Applied ${applied} database migration(s).`);
  } finally {
    await db.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  if (error instanceof postgres.PostgresError) {
    console.error(`Database migration failed (PostgreSQL ${error.code}).`);
  } else if (error instanceof Error && !("code" in error)) {
    console.error(error.message);
  } else {
    console.error("Could not connect to the migration database.");
  }
  process.exitCode = 1;
});
