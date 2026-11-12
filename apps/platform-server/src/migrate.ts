import { migrateApplicationDatabase } from "@atoms-builder/persistence";

try {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await migrateApplicationDatabase(process.env.DATABASE_URL);
  console.log("Application database migrations are current");
} catch {
  console.error(
    "Database migration failed: check DATABASE_URL, connectivity and migration integrity",
  );
  process.exitCode = 1;
}
