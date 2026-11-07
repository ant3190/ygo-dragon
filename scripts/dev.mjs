import { spawn } from 'node:child_process';
const env = { ...process.env, YGO_PORT: '18082', YGO_DEV: '1' };
const rpsPreview = env.YGO_PREVIEW_RPS === '1';
if (rpsPreview) env.YGO_AI_SERVER = 'ws://127.0.0.1:18090';
// Vite forwards HTTP API calls and WebSocket upgrades differently. Permit only
// the loopback development origins; production keeps its same-origin checks.
env.YGO_ALLOWED_ORIGINS ||=
  'http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:5173,http://localhost:5173';
if (!env.YGO_DATA_DIR)
  env.YGO_DATA_DIR = new URL('../../ygo-dragon-data', import.meta.url).pathname;
const children = [
  ...(rpsPreview
    ? [spawn(process.execPath, ['scripts/preview-rps.mjs'], { stdio: 'inherit', env })]
    : []),
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
