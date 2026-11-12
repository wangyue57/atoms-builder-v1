import { spawn, spawnSync } from 'node:child_process';
import { loadEnvironment, rootDirectory } from './environment.mjs';

loadEnvironment();
const mode = process.argv[2] ?? 'start';
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Run npm run setup before starting.');

if (mode === 'migrate') {
  const result = spawnSync('npm', ['run', 'db:migrate', '--workspace', '@atoms-builder/platform-server'], { cwd: rootDirectory, stdio: 'inherit', env: process.env });
  process.exit(result.status ?? 1);
}
if (!['dev', 'start'].includes(mode)) throw new Error(`Unknown application mode: ${mode}`);
const commands = mode === 'dev'
  ? [['run', 'dev', '--workspace', '@atoms-builder/platform-server'], ['run', 'dev:worker', '--workspace', '@atoms-builder/platform-server']]
  : [['apps/platform-server/dist/main.js'], ['apps/platform-server/dist/worker.js']];
const program = mode === 'dev' ? 'npm' : process.execPath;
const children = commands.map(args => spawn(program, args, { cwd: rootDirectory, stdio: 'inherit', env: process.env }));
let stopping = false;
let shutdownTimer;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    try {
      child.kill('SIGTERM');
    } catch { /* The child may have exited between the checks. */ }
  }
  shutdownTimer = setTimeout(() => {
    for (const child of children) {
      if (!child.pid) continue;
      try {
        child.kill('SIGKILL');
      } catch { /* Already closed. */ }
    }
  }, 4000);
}
for (const child of children) {
  child.once('error', error => { console.error(error.message); stop(1); });
  child.once('exit', code => {
    if (!stopping) stop(code ?? 1);
    if (children.every(process => process.exitCode !== null || process.signalCode !== null)) clearTimeout(shutdownTimer);
  });
}
process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());
