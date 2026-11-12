import {
  ApplicationRepository,
  createApplicationPool,
  migrateApplicationPool,
} from "@atoms-builder/persistence";

export async function createApplicationResources() {
  const pool = createApplicationPool();
  try {
    await migrateApplicationPool(pool);
    const repository = new ApplicationRepository(pool);
    await repository.ready();
    return repository;
  } catch (error) {
    await pool.end();
    throw error;
  }
}
