// Compatibility entry point. Playwright now owns server startup, cleanup and artifacts.
import { spawn } from 'node:child_process';

const child = spawn(process.execPath, ['node_modules/@playwright/test/cli.js', 'test'], {
  cwd: new URL('..', import.meta.url),
  stdio: 'inherit',
  env: process.env,
});
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => { process.exitCode = code ?? 1; });
