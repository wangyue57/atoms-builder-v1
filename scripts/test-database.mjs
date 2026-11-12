import { spawn } from 'node:child_process';
import { loadEnvironment, rootDirectory } from './environment.mjs';

loadEnvironment();
const database = process.env.TEST_DATABASE_URL;
if (!database) throw new Error('TEST_DATABASE_URL is required. Run npm run setup first.');
if (database === process.env.DATABASE_URL) throw new Error('Tests must not use the application database.');
const [program, ...args] = process.argv.slice(2);
if (!program) throw new Error('A test command is required.');
const child = spawn(program, args, {
  cwd: rootDirectory,
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: database, TEST_DATABASE_URL: database },
});
process.exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
