import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer, preview } from 'vite';
import { practiceApiPlugin } from '../server/vite-practice.mjs';
import { feedbackCriteria } from '../shared/practice.mjs';

async function start(t, { key = '', fetchImpl, publicHost = false, previewMode = false, actualConfig = false } = {}) {
  const envDir = await mkdtemp(join(tmpdir(), 'calls-runtime-'));
  const prior = {};
  for (const name of ['OPENAI_API_KEY', 'PRACTICE_ACCESS_CODE', 'ALLOWED_ORIGINS', 'VITE_PRACTICE_API_URL']) {
    prior[name] = process.env[name]; delete process.env[name];
  }
  await writeFile(join(envDir, '.env.local'), `OPENAI_API_KEY=${key}\n`);
  // API preview tests must also run on a clean checkout before the app is built.
  const previewDist = join(envDir, 'dist');
  if (previewMode) {
    await mkdir(previewDist);
    await writeFile(join(previewDist, 'index.html'), '<!doctype html><title>Practice preview test</title>');
  }
  const config = {
    configFile: actualConfig ? resolve('vite.config.ts') : false,
    root: resolve('.'), envDir, logLevel: 'silent',
    ...(actualConfig ? {} : { base: '/calls/', plugins: [practiceApiPlugin({ fetchImpl })] }),
    server: { host: publicHost ? '0.0.0.0' : '127.0.0.1', port: 0, hmr: false },
    preview: { host: '127.0.0.1', port: 0 },
    ...(previewMode ? { build: { outDir: previewDist } } : {}),
    optimizeDeps: { noDiscovery: true, include: [] },
  };
  let server;
  t.after(async () => {
    if (server) {
      if (previewMode) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
      else await server.close();
    }
    for (const [name, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(envDir, { recursive: true, force: true });
  });
  server = previewMode ? await preview(config) : await createServer(config);
  if (!previewMode) await server.listen();
  const base = () => `http://127.0.0.1:${server.httpServer.address().port}`;
  const request = (action, body, headers = {}) => fetch(`${base()}/api/practice/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: base(), 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { server, base, envDir, request };
}

test('the real Vite config serves the API without a separate backend and loads the local key after restart', async t => {
  const runtime = await start(t, { actualConfig: true });
  let response = await runtime.request('config');
  assert.equal(response.status, 200, 'The frontend port must serve JSON rather than a failed proxy');
  assert.deepEqual(await response.json(), { available: false, accessCodeRequired: false, maxCallSeconds: 300 });
  const page = await fetch(`${runtime.base()}/calls/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /src\/main\.tsx/);
  await writeFile(join(runtime.envDir, '.env.local'), 'OPENAI_API_KEY=runtime-private-test-key\n');
  await runtime.server.restart();
  response = await runtime.request('config');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).available, true);
  const client = await fetch(`${runtime.base()}/calls/src/practice-client.ts`);
  assert.equal(client.status, 200);
  assert.doesNotMatch(await client.text(), /runtime-private-test-key/);
  // Request the actual fixture: a missing file under the repo root can return
  // the SPA's HTML with status 200 on a clean checkout without exposing secrets.
  const secretFile = await fetch(`${runtime.base()}/@fs/${join(runtime.envDir, '.env.local')}`);
  assert.notEqual(secretFile.status, 200);
});

test('voice setup, feedback, and hangup work through the actual HTTP boundary on the selected Vite port', async t => {
  const calls = [];
  const feedback = { summary: 'A clear opening.', nextAttempt: 'Ask one discovery question.', criteria: feedbackCriteria.map(name => ({ name, score: 3, evidence: 'You asked permission to continue.' })) };
  const runtime = await start(t, { key: 'private-test-key', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/responses')) return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(feedback) }] }] });
    return url.endsWith('/hangup') ? new Response(null) : new Response('v=0\r\nanswer', { headers: { location: '/v1/realtime/calls/rtc_runtime' } });
  } });
  assert.equal((await (await runtime.request('config')).json()).available, true);
  const response = await runtime.request('session', { scenario: 'introduction', sdp: 'v=0\r\noffer' });
  assert.equal(response.status, 200);
  const session = await response.json();
  assert.equal(session.sdp, 'v=0\r\nanswer');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer private-test-key');
  const review = await runtime.request('feedback', { scenario: 'introduction', messages: [{ role: 'user', text: 'Hi Sarah. Do you have a minute?' }] });
  assert.deepEqual(await review.json(), { feedback });
  assert.equal((await runtime.request('end', { sessionId: session.sessionId })).status, 200);
  assert.ok(calls.some(call => call.url.endsWith('/rtc_runtime/hangup')));
  assert.equal((await runtime.request('config', undefined, { Origin: 'https://untrusted.example' })).status, 403);
  const tooLarge = await runtime.request('feedback', { messages: ['x'.repeat(70000)] });
  assert.equal(tooLarge.status, 413);
  assert.match((await tooLarge.json()).error, /too long/);
});

test('exposing Vite on the network still requires production access controls', async t => {
  const runtime = await start(t, { key: 'private-test-key', publicHost: true });
  const response = await fetch(`${runtime.base()}/api/practice/config`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: false, accessCodeRequired: true, maxCallSeconds: 300 });
  const session = await fetch(`${runtime.base()}/api/practice/session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(session.status, 503);
});

test('local preview also serves the practice API without a second process', async t => {
  const runtime = await start(t, { key: 'private-test-key', previewMode: true, actualConfig: true });
  const response = await runtime.request('config');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: true, accessCodeRequired: false, maxCallSeconds: 300 });
});
