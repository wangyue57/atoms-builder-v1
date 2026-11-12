import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { PoolClient } from "pg";

export function createApplicationPool(
  databaseUrl = process.env.DATABASE_URL,
): pg.Pool {
  if (!databaseUrl)
    throw new Error(
      "DATABASE_URL is required; application persistence has no memory fallback",
    );
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 5_000,
  });
  pool.on("error", () => {
    console.error(
      "PostgreSQL idle connection failed; subsequent requests will reconnect",
    );
  });
  return pool;
}

export async function transaction<T>(
  pool: pg.Pool,
  action: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await action(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function migrateApplicationPool(
  pool: pg.Pool,
  directory = fileURLToPath(new URL("../../../migrations/", import.meta.url)),
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock(72102201)");
    await client.query(
      "create table if not exists application_migrations (version integer primary key, name text not null, checksum text not null, applied_at timestamptz not null default now())",
    );
    const files = (await readdir(directory))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    for (const name of files) {
      const version = Number(name.slice(0, 4));
      const sql = await readFile(resolve(directory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const prior = await client.query<{ checksum: string }>(
        "select checksum from application_migrations where version=$1",
        [version],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].checksum !== checksum)
          throw new Error(`Migration checksum changed: ${name}`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          "insert into application_migrations(version,name,checksum) values($1,$2,$3)",
          [version, name, checksum],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
  } finally {
    await client
      .query("select pg_advisory_unlock(72102201)")
      .catch(() => undefined);
    client.release();
  }
}

export async function migrateApplicationDatabase(
  databaseUrl: string,
): Promise<void> {
  const pool = createApplicationPool(databaseUrl);
  try {
    await migrateApplicationPool(pool);
  } finally {
    await pool.end();
  }
}
