import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './compile.mjs';
const { PracticeVoice, updateTranscript } = await loadSource('practice-client');
const originalFetch = globalThis.fetch;
const originalNavigator = globalThis.navigator;
const originalPeer = globalThis.RTCPeerConnection;
let active;
afterEach(() => { active?.stop(); active = null; globalThis.fetch = originalFetch; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator }); globalThis.RTCPeerConnection = originalPeer; });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function setup({ getUserMedia, request } = {}) {
  const track = { enabled: true, stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const calls = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: getUserMedia || (async () => stream) } } });
  let peer;
  globalThis.RTCPeerConnection = class {
    constructor() { peer = this; this.connectionState = 'new'; this.channel = { readyState: 'open', send: value => calls.push(JSON.parse(value)), close() { this.closed = true; this.onclose?.(); } }; }
    addTrack() {}
    createDataChannel() { return this.channel; }
    async createOffer() { return { sdp: 'v=0\r\noffer' }; }
    async setLocalDescription() {}
    async setRemoteDescription(answer) { this.answer = answer; }
    close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
  };
  globalThis.fetch = request || (async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return Response.json(url.endsWith('/session') ? { sdp: 'v=0\r\nanswer', sessionId: 'session-1' } : { ended: true }); });
  const events = [], errors = [];
  let connected = 0;
  const audio = { pause() { this.paused = true; }, srcObject: null, play: async () => {} };
  active = new PracticeVoice({ scenario: 'objection', code: 'access-code', audio, onConnected: () => connected++, onEvent: event => events.push(event), onError: error => errors.push(error), onAudioBlocked() {} });
  return { voice: active, track, stream, calls, errors, events, audio, peer: () => peer, connected: () => connected };
}

test('voice connects only when the channel opens, greets once, mutes and releases all resources', async () => {
  const context = setup();
  await context.voice.start();
  assert.equal(context.connected(), 0);
  const peer = context.peer();
  assert.equal(peer.answer.sdp, 'v=0\r\nanswer');
  peer.channel.onopen();
  assert.equal(context.connected(), 1);
  assert.deepEqual(context.calls[1], { type: 'response.create' });
  context.voice.setMuted(true); assert.equal(context.track.enabled, false);
  context.voice.setMuted(false); assert.equal(context.track.enabled, true);
  peer.channel.onmessage({ data: JSON.stringify({ type: 'input_audio_buffer.speech_started' }) });
  assert.equal(context.events[0].type, 'input_audio_buffer.speech_started');
  context.voice.stop(); await tick();
  assert.equal(context.track.stopped, true);
  assert.equal(peer.connectionState, 'closed');
  assert.equal(peer.channel.closed, true);
  assert.equal(context.audio.paused, true);
  assert.equal(context.calls.at(-1).url, '/api/practice/end');
  assert.deepEqual(context.errors, []);
});

test('permission denial gives a useful error without creating a session', async () => {
  const context = setup({ getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); } });
  await context.voice.start();
  assert.match(context.errors[0], /Microphone access was blocked/);
  assert.equal(context.calls.length, 0);
  assert.equal(context.peer(), undefined);
});

test('cancel while microphone permission is pending stops a late stream', async () => {
  let resolveMic;
  const context = setup({ getUserMedia: () => new Promise(resolve => { resolveMic = resolve; }) });
  const pending = context.voice.start();
  context.voice.stop();
  resolveMic(context.stream);
  await pending;
  assert.equal(context.track.stopped, true);
  assert.equal(context.peer(), undefined);
  assert.deepEqual(context.errors, []);
});

test('cancel during session setup hangs up the late session and never reconnects', async () => {
  let resolveSession;
  const requests = [];
  const context = setup({ request: (url, options) => {
    requests.push({ url, options });
    return url.endsWith('/session') ? new Promise(resolve => { resolveSession = resolve; }) : Promise.resolve(Response.json({ ended: true }));
  } });
  const pending = context.voice.start(); await tick();
  context.voice.stop();
  resolveSession(Response.json({ sdp: 'v=0\r\nanswer', sessionId: 'late-session' }));
  await pending; await tick();
  assert.equal(context.track.stopped, true);
  assert.equal(context.peer().answer, undefined);
  assert.equal(requests.at(-1).url, '/api/practice/end');
  assert.deepEqual(JSON.parse(requests.at(-1).options.body), { sessionId: 'late-session' });
});

test('provider and connection failures close the microphone and do not echo provider details', async () => {
  const context = setup(); await context.voice.start();
  context.peer().channel.onmessage({ data: JSON.stringify({ type: 'error', error: { message: 'private provider error' } }) });
  assert.equal(context.track.stopped, true);
  assert.match(context.errors[0], /interrupted/);
  assert.doesNotMatch(context.errors[0], /private provider/);
  context.peer().channel.onmessage({ data: JSON.stringify({ type: 'input_audio_buffer.speech_started' }) });
  assert.equal(context.events.length, 0);
});

test('out-of-order transcript completion keeps conversational order and deduplicates final events', () => {
  let lines = [];
  const event = value => { lines = updateTranscript(lines, value); };
  event({ type: 'conversation.item.added', item: { id: 'user-1', type: 'message', role: 'user' } });
  event({ type: 'conversation.item.added', item: { id: 'ai-1', type: 'message', role: 'assistant' } });
  event({ type: 'response.output_audio_transcript.delta', item_id: 'ai-1', delta: 'I have ' });
  event({ type: 'response.output_audio_transcript.delta', item_id: 'ai-1', delta: 'a minute.' });
  event({ type: 'response.output_audio_transcript.done', item_id: 'ai-1', transcript: 'I have a minute.' });
  event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'user-1', transcript: 'Is now a good time?' });
  event({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'user-1', transcript: 'Is now a good time?' });
  assert.deepEqual(lines.map(({ role, text }) => ({ role, text })), [{ role: 'user', text: 'Is now a good time?' }, { role: 'assistant', text: 'I have a minute.' }]);
  assert.ok(lines.every(line => !line.pending));
});

test('finishing mid-speech stops microphone capture immediately and waits for the final transcript', async () => {
  const context = setup(); await context.voice.start();
  const emit = message => context.peer().channel.onmessage({ data: JSON.stringify(message) });
  emit({ type: 'input_audio_buffer.speech_started', item_id: 'last-turn' });
  const finishing = context.voice.finish();
  assert.equal(context.track.stopped, true);
  assert.equal(context.audio.paused, true);
  assert.equal(context.peer().channel.closed, undefined);
  assert.deepEqual(context.calls.at(-1), { type: 'input_audio_buffer.commit' });
  emit({ type: 'input_audio_buffer.committed', item_id: 'last-turn' });
  emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'last-turn', transcript: 'How about Tuesday?' });
  await finishing;
  assert.equal(context.events.at(-1).transcript, 'How about Tuesday?');
  assert.equal(context.peer().channel.closed, true);
  assert.equal(context.calls.at(-1).url, '/api/practice/end');
});

test('an unfinished transcription has a bounded timeout and produces an incomplete-transcript notice', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const context = setup(); await context.voice.start();
  context.peer().channel.onmessage({ data: JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'pending-turn' }) });
  const finishing = context.voice.finish();
  t.mock.timers.tick(2000);
  await finishing;
  assert.equal(context.events.at(-1).type, 'practice.transcript.incomplete');
  assert.equal(context.peer().channel.closed, true);
  assert.deepEqual(context.errors, []);
});
