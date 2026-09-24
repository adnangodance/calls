import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { loadSource } from './compile.mjs';
import { feedbackCriteria } from '../shared/practice.mjs';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/calls/' });
for (const name of ['window', 'document', 'localStorage', 'HTMLElement']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
dom.window.HTMLMediaElement.prototype.pause = function () {};
dom.window.HTMLMediaElement.prototype.play = async function () {};
const { createRoot } = await import('react-dom/client');
const { default: PracticePage } = await loadSource('PracticePage');
const originalFetch = globalThis.fetch;
const originalNavigator = globalThis.navigator;
const originalPeer = globalThis.RTCPeerConnection;
const originalAudioContext = globalThis.AudioContext;
const feedback = { summary: 'You opened with permission and asked about their workflow.', nextAttempt: 'Confirm a specific time for the walkthrough.', criteria: feedbackCriteria.map(name => ({ name, score: 3, evidence: 'A useful opening question.' })) };
let root;
let peer;
let track;
const requests = [];
async function actOn(callback) { await act(async () => { await callback(); await new Promise(resolve => setTimeout(resolve, 5)); }); }
async function mount(handler, preserve = false) {
  if (!preserve) localStorage.clear();
  requests.length = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => {
    track = { enabled: true, stopped: false, label: 'Test microphone', stop() { this.stopped = true; }, addEventListener() {} };
    const currentTrack = track;
    return { getTracks: () => [currentTrack], getAudioTracks: () => [currentTrack] };
  } } } });
  globalThis.AudioContext = class {
    async resume() {}
    async close() {}
    createAnalyser() { return { fftSize: 1024, getFloatTimeDomainData(data) { data.fill(.08); }, disconnect() {} }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  };
  globalThis.RTCPeerConnection = class {
    constructor() { peer = this; this.channel = { readyState: 'open', send() {}, close() { this.onclose?.(); } }; }
    addTrack() {}
    createDataChannel() { return this.channel; }
    async createOffer() { return { sdp: 'v=0\r\noffer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { this.channel.onopen?.(); }
    close() { this.connectionState = 'closed'; this.onconnectionstatechange?.(); }
  };
  globalThis.fetch = async (url, options) => {
    const action = url.split('/').pop();
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ action, body, options });
    return handler?.(action, body, options) || Response.json(action === 'config' ? { available: true, accessCodeRequired: false, maxCallSeconds: 300 } : action === 'feedback' ? { feedback } : action === 'session' ? { sdp: 'v=0\r\nanswer', sessionId: 'voice-session' } : { ended: true });
  };
  root = createRoot(document.getElementById('root'));
  await actOn(() => root.render(React.createElement(React.StrictMode, null, React.createElement(PracticePage, { onReview() {} }))));
}
async function unmount() { if (root) await actOn(() => root.unmount()); root = null; }
afterEach(async () => { await unmount(); globalThis.fetch = originalFetch; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator }); globalThis.RTCPeerConnection = originalPeer; globalThis.AudioContext = originalAudioContext; });
after(() => dom.window.close());
function button(label) {
  const element = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === label || item.getAttribute('aria-label') === label);
  assert.ok(element, `Button exists: ${label}`); return element;
}
async function startCall() { await actOn(() => button('Start practice call').click()); }
async function captureConversation() {
  await actOn(() => {
    for (const event of [
      { type: 'response.output_audio_transcript.done', item_id: 'assistant-1', transcript: 'Hi, this is Sarah. I have a minute.' },
      { type: 'conversation.item.input_audio_transcription.completed', item_id: 'user-1', transcript: 'Hi Sarah. Can I ask about your workflow?' },
      { type: 'response.output_audio_transcript.done', item_id: 'assistant-2', transcript: 'Sure, what would you like to know?' },
    ]) peer.channel.onmessage({ data: JSON.stringify(event) });
  });
}

test('voice practice follows the selected scenario, produces feedback and saves summaries only', async () => {
  await mount();
  await actOn(() => document.querySelector('input[name="practice-scenario"][value="1"]').click());
  await startCall();
  assert.equal(requests.find(item => item.action === 'session').body.scenario, 'objection');
  assert.ok(document.querySelector('.scenario-options').disabled);
  await captureConversation();
  assert.equal(document.querySelectorAll('.practice-message').length, 3);
  await actOn(() => button('End practice').click());
  assert.equal(track.stopped, true);
  assert.match(document.querySelector('.practice-feedback').textContent, /12 \/ 20/);
  const saved = JSON.parse(localStorage.getItem('targetone-practice-v1'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].scenario, 'objection');
  assert.equal(saved[0].mode, 'voice');
  assert.equal(saved[0].messages, undefined);
  assert.equal(saved[0].transcript, undefined);
  assert.equal(localStorage.getItem('targetone-practice-v1').includes('Hi Sarah.'), false);
  await unmount(); await mount(undefined, true);
  assert.ok(document.getElementById('practice-history-title'));
  assert.equal(document.querySelector('.practice-conversation'), null);
  await actOn(() => button('Clear history').click());
  assert.equal(localStorage.getItem('targetone-practice-v1'), null);
});

test('microphone controls work during voice practice and unmount releases it', async () => {
  await mount(); await startCall();
  await actOn(() => button('Mute microphone').click());
  assert.equal(track.enabled, false);
  assert.equal(button('Unmute microphone').getAttribute('aria-pressed'), 'true');
  await actOn(() => button('Unmute microphone').click());
  assert.equal(track.enabled, true);
  await unmount();
  assert.equal(track.stopped, true);
});

test('failed feedback can be retried, and a silent attempt is never graded', async () => {
  let fail = true;
  await mount(action => action === 'feedback' && fail ? Response.json({ error: 'Review unavailable.' }, { status: 502 }) : undefined);
  await startCall(); await actOn(() => button('End practice').click());
  assert.match(document.querySelector('.practice-call-actions').textContent, /No completed replies/);
  assert.equal(requests.some(item => item.action === 'feedback'), false);
  await actOn(() => button('Practice again').click()); await startCall(); await captureConversation();
  await actOn(() => button('End practice').click());
  assert.match(document.querySelector('[role="alert"]').textContent, /Review unavailable/);
  fail = false; await actOn(() => button('Get my feedback').click());
  assert.equal(JSON.parse(localStorage.getItem('targetone-practice-v1')).length, 1);
});

test('cancelled or unmounted requests cannot revive a practice attempt', async () => {
  let resolveStart;
  await mount(action => action === 'session' ? new Promise(resolve => { resolveStart = resolve; }) : undefined);
  await startCall();
  assert.ok(button('Cancel'));
  await actOn(() => button('Cancel').click());
  await actOn(() => resolveStart(Response.json({ sdp: 'v=0\r\nanswer', sessionId: 'late-1' })));
  assert.equal(document.querySelector('.practice-message'), null);
  assert.ok(button('Start practice call'));
  await startCall();
  await unmount();
  await actOn(() => resolveStart(Response.json({ sdp: 'v=0\r\nanswer', sessionId: 'late-2' })));
  assert.equal(document.getElementById('root').textContent, '');
});

test('unconfigured service stays honest and availability can be rechecked', async () => {
  let available = false;
  await mount(action => action === 'config' ? Response.json({ available, accessCodeRequired: false }) : undefined);
  assert.equal(button('Start practice call').disabled, true);
  assert.match(document.getElementById('practice-availability').textContent, /practice service is connected/);
  available = true; await actOn(() => button('Retry connection').click());
  assert.equal(button('Start practice call').disabled, false);
});

test('access codes stay out of browser storage and the request body', async () => {
  await mount(action => action === 'config' ? Response.json({ available: true, accessCodeRequired: true }) : undefined);
  assert.equal(button('Start practice call').disabled, true);
  await actOn(() => {
    const input = document.querySelector('input[type="password"]');
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'my-private-code');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  await startCall();
  const session = requests.find(item => item.action === 'session');
  assert.equal(session.options.headers.Authorization, 'Bearer my-private-code');
  assert.equal(JSON.stringify(session.body).includes('my-private-code'), false);
  assert.equal(localStorage.length, 0);
});

test('microphone check works locally before calling is configured and releases the device', async () => {
  await mount(action => action === 'config' ? Response.json({ available: false, accessCodeRequired: false }) : undefined);
  assert.equal(button('Start practice call').disabled, true);
  await actOn(() => button('Check microphone').click());
  assert.ok(document.querySelector('[role="meter"]'));
  assert.equal(track.stopped, false);
  assert.equal(requests.some(item => item.action === 'session'), false);
  await actOn(() => button('Stop check').click());
  assert.equal(track.stopped, true);
  assert.equal(document.querySelector('[role="meter"]'), null);
});

test('a microphone check cannot compete with the call for the same device', async () => {
  await mount();
  await actOn(() => button('Check microphone').click());
  assert.equal(button('Start practice call').disabled, true);
  await actOn(() => button('Stop check').click());
  assert.equal(button('Start practice call').disabled, false);
  await startCall();
  assert.equal(track.stopped, false);
});

test('end call waits for the last transcript before automatically requesting coaching', async () => {
  await mount(); await startCall();
  await actOn(() => {
    peer.channel.onmessage({ data: JSON.stringify({ type: 'input_audio_buffer.speech_started', item_id: 'last-turn' }) });
    peer.channel.onmessage({ data: JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'last-turn' }) });
  });
  await actOn(() => button('End practice').click());
  assert.equal(track.stopped, true);
  assert.match(document.querySelector('.practice-call-actions').textContent, /Finishing your transcript/);
  assert.equal(requests.some(item => item.action === 'feedback'), false);
  await actOn(() => peer.channel.onmessage({ data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', item_id: 'last-turn', transcript: 'Could we meet next Tuesday?' }) }));
  assert.equal(requests.find(item => item.action === 'feedback').body.messages[0].text, 'Could we meet next Tuesday?');
  assert.ok(document.querySelector('.practice-feedback'));
});

test('the live transcript can be opened without interrupting the call', async () => {
  await mount(); await startCall(); await captureConversation();
  assert.equal(document.getElementById('practice-transcript-panel').hidden, true);
  await actOn(() => document.querySelector('.practice-transcript-toggle').click());
  assert.equal(document.getElementById('practice-transcript-panel').hidden, false);
  assert.equal(track.stopped, false);
});
