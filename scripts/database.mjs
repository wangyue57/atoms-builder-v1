import { spawnSync } from 'node:child_process';
import { initializeEnvironment, loadEnvironment, rootDirectory } from './environment.mjs';

initializeEnvironment();
loadEnvironment();
const command = process.argv[2] ?? 'up';

function run(program, args) {
  const result = spawnSync(program, args, { cwd: rootDirectory, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} exited with ${result.status}`);
}

async function initializeTestDatabase() {
  const { Client } = await import('pg');
  if (!process.env.TEST_DATABASE_URL || !process.env.DATABASE_URL) throw new Error('DATABASE_URL and TEST_DATABASE_URL are required.');
  const testURL = new URL(process.env.TEST_DATABASE_URL);
  const appURL = new URL(process.env.DATABASE_URL);
  const database = decodeURIComponent(testURL.pathname.slice(1));
  if (!/^[a-z][a-z0-9_]*$/.test(database) || (testURL.host === appURL.host && testURL.pathname === appURL.pathname)) {
    throw new Error('Test database must have its own safe name and cannot be the application database.');
  }
  const adminURL = new URL(process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL);
  if (!process.env.ADMIN_DATABASE_URL) {
    if (!process.env.POSTGRES_ADMIN_PASSWORD) throw new Error('POSTGRES_ADMIN_PASSWORD or ADMIN_DATABASE_URL is required to initialize test database.');
    adminURL.username = 'atoms_admin';
    adminURL.password = process.env.POSTGRES_ADMIN_PASSWORD;
    adminURL.pathname = '/postgres';
  }
  const client = new Client({ connectionString: adminURL.href });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_database where datname=$1', [database]);
    const owner = decodeURIComponent(testURL.username);
    if (!/^[a-z][a-z0-9_]*$/.test(owner)) throw new Error('Invalid test database owner.');
    if (!exists.rowCount) await client.query(`create database "${database}" owner "${owner}"`);
    console.log('Dedicated test database is ready. Application data was not reset.');
  } finally { await client.end(); }
}

try {
  if (command === 'up' || command === 'setup') run('docker', ['compose', 'up', '-d', '--wait', 'postgres']);
  else if (command === 'down') run('docker', ['compose', 'stop', 'postgres']);
  else if (command !== 'test-init') throw new Error(`Unknown database command: ${command}`);
  if (command === 'test-init' || command === 'setup') await initializeTestDatabase();
  if (command === 'setup') {
    run('npm', ['run', 'build:backend']);
    run('npm', ['run', 'db:migrate', '--workspace', '@atoms-builder/platform-server']);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database setup failed.');
  process.exitCode = 1;
}
