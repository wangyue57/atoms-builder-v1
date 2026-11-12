import { existsSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
export const envFile = new URL('../.env', import.meta.url);

export function initializeEnvironment() {
  if (existsSync(envFile)) return;
  const password = randomBytes(24).toString('hex');
  const adminPassword = randomBytes(24).toString('hex');
  const content = [
    'COMPOSE_PROJECT_NAME=atoms-builder',
    'POSTGRES_DB=atoms', 'POSTGRES_USER=atoms',
    `POSTGRES_PASSWORD=${password}`, `POSTGRES_ADMIN_PASSWORD=${adminPassword}`,
    'POSTGRES_PORT=54329',
    `DATABASE_URL=postgresql://atoms:${password}@127.0.0.1:54329/atoms`,
    `TEST_DATABASE_URL=postgresql://atoms:${password}@127.0.0.1:54329/atoms_test`,
    'PORT=8787', 'HOST=127.0.0.1', 'APP_PORT=8787',
    'APP_ORIGIN=http://localhost:8787', 'COOKIE_SECURE=false',
    'DEEPSEEK_MODEL=deepseek-flash', 'APP_IMAGE=atoms-builder:local', '',
  ].join('\n');
  writeFileSync(envFile, content, { mode: 0o600, flag: 'wx' });
  console.log('Initialized ignored .env with unique database credentials.');
}

export function loadEnvironment() {
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
