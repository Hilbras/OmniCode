import { readdirSync } from 'node:fs';

import { MiniDbMemoryStore } from '#/storage/miniDbMemoryStore';

const dir = process.argv[2];
if (dir === undefined) {
  process.exit(2);
}

const store = await MiniDbMemoryStore.open({ dir });
await store.commit([
  { op: 'set', key: 'm:held-by-child', value: { id: 'held-by-child', content: 'written by the child process' } },
]);
process.stdout.write(`${JSON.stringify({ ready: true, readOnly: store.readOnly, pid: process.pid })}\n`);
process.stdout.write(`HELD ${readdirSync(dir).join(',')}\n`);

const keepAlive = setInterval(() => {
  /* holds the event loop open so the store keeps its lock */
}, 1_000);

const release = new Promise<void>((resolve) => {
  process.once('SIGTERM', () => {
    resolve();
  });
  process.once('SIGINT', () => {
    resolve();
  });
});

await release;
clearInterval(keepAlive);
await store.close();
process.exit(0);