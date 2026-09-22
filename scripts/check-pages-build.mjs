import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const output = new URL('../dist/', import.meta.url);
const html = await readFile(new URL('index.html', output), 'utf8');
const assetPaths = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
assert.ok(assetPaths.some(path => path.endsWith('.js')), 'The page must load compiled JavaScript');
assert.ok(assetPaths.some(path => path.endsWith('.css')), 'The page must load compiled CSS');
assert.ok(!html.includes('/src/'), 'The deployment must not serve the development entry point');

for (const path of assetPaths) {
  assert.ok(path.startsWith('/calls/'), `Asset must use the Pages project path: ${path}`);
  assert.ok((await stat(new URL(path.slice('/calls/'.length), output))).isFile(), `Missing built asset: ${path}`);
}

const calls = JSON.parse(await readFile(new URL('../src/calls.json', import.meta.url), 'utf8'));
for (const call of calls) {
  const recording = await readFile(new URL(call.audio.replace(/^\//, ''), output));
  assert.equal(recording.toString('ascii', 0, 4), 'RIFF', `Missing WAV recording: ${call.audio}`);
  assert.equal(recording.toString('ascii', 8, 12), 'WAVE', `Invalid WAV recording: ${call.audio}`);
}

console.log(`Pages build verified: ${assetPaths.length} entry assets and ${calls.length} recordings.`);
