import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './compile.mjs';

const { MicrophoneCheck } = await loadSource('microphone-check');
const originalNavigator = globalThis.navigator;
const originalContext = globalThis.AudioContext;
let check;
afterEach(() => { check?.stop(); Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator }); globalThis.AudioContext = originalContext; });

function setup({ amplitude = .06, microphone } = {}) {
  const track = { label: 'Test microphone', stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: microphone || (async () => stream) } } });
  let context;
  globalThis.AudioContext = class {
    constructor() { context = this; }
    async resume() {}
    async close() { this.closed = true; }
    createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(data) { data.fill(amplitude); }, disconnect() {} }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  };
  const events = { levels: [], errors: [], complete: [] };
  check = new MicrophoneCheck({ onListening: device => { events.device = device; }, onLevel: level => events.levels.push(level), onComplete: result => events.complete.push(result), onError: error => events.errors.push(error) });
  return { check, stream, track, events, context: () => context };
}

test('local microphone check measures sound and automatically releases the microphone and audio context', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const context = setup();
  await context.check.start();
  for (let i = 0; i < 75; i++) t.mock.timers.tick(80);
  assert.equal(context.events.device, 'Test microphone');
  assert.ok(context.events.levels.some(level => level > 0));
  assert.deepEqual(context.events.complete, [true]);
  assert.equal(context.track.stopped, true);
  assert.equal(context.context().closed, true);
});

test('silent audio does not produce a false successful microphone check', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const context = setup({ amplitude: 0 });
  await context.check.start();
  for (let i = 0; i < 75; i++) t.mock.timers.tick(80);
  assert.deepEqual(context.events.complete, [false]);
  assert.ok(context.events.levels.every(level => level === 0));
  assert.equal(context.track.stopped, true);
});

test('cancelling a pending permission request closes a stream that arrives later', async () => {
  let resolveMicrophone;
  const context = setup({ microphone: () => new Promise(resolve => { resolveMicrophone = resolve; }) });
  const pending = context.check.start();
  await Promise.resolve();
  context.check.stop();
  resolveMicrophone(context.stream); await pending;
  assert.equal(context.track.stopped, true);
  assert.equal(context.context().closed, true);
  assert.equal(context.events.device, undefined);
  assert.deepEqual(context.events.complete, []);
});

test('microphone permission errors are recoverable and release audio resources', async () => {
  const context = setup({ microphone: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  await context.check.start();
  assert.match(context.events.errors[0], /Microphone access was blocked/);
  assert.equal(context.context().closed, true);
  assert.deepEqual(context.events.complete, []);
});
