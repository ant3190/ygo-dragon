import { spawn } from 'node:child_process';
const env = { ...process.env, YGO_PORT: '18082', YGO_DEV: '1' };
if (!env.YGO_DATA_DIR)
  env.YGO_DATA_DIR = new URL('../../ygo-dragon-data', import.meta.url).pathname;
const children = [
  spawn(process.execPath, ['server/index.mjs'], { stdio: 'inherit', env }),
  spawn('npm', ['run', 'dev:client', '--', ...process.argv.slice(2)], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((c) => c.kill('SIGTERM'));
  process.exitCode = code;
}
children.forEach((c) => c.on('exit', (code) => stop(code || 0)));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
