import { loadConfig } from '../server/config.mjs';
import { Resources } from '../server/resources.mjs';
const resources = await new Resources(loadConfig()).init();
let last = '';
resources.on('status', (s) => {
  const next = `${s.phase} ${s.current} ${s.done}/${s.total}`;
  if (next !== last) {
    console.log(next);
    last = next;
  }
});
await resources.sync(process.argv.includes('--force'), true);
console.log(JSON.stringify(resources.status, null, 2));
resources.meta.close();
process.exitCode = resources.status.ready ? 0 : 1;
