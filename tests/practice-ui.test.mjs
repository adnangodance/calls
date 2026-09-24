import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { JSDOM } from 'jsdom';
import { loadSource } from './compile.mjs';
import { feedbackCriteria, practiceContacts } from '../shared/practice.mjs';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/calls/' });
for (const name of ['window', 'document', 'localStorage', 'HTMLElement']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
dom.window.HTMLMediaElement.prototype.pause = function () {};
dom.window.HTMLMediaElement.prototype.play = async function () {};
const { createRoot } = await import('react-dom/client');
const { default: PracticePage } = await loadSource('PracticePage');
const { PRACTICE_STORAGE_KEY, emptyPractice, recordAttempt } = await loadSource('practice-progress');
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
async function mount(handler, preserve = false, initialRecord = emptyPractice()) {
  if (!preserve) localStorage.clear();
  if (!preserve && initialRecord) localStorage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(initialRecord));
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
    return handler?.(action, body, options) || Response.json(action === 'config' ? { available: true, accessCodeRequired: false, maxCallSeconds: 20 } : action === 'feedback' ? { feedback } : action === 'session' ? { sdp: 'v=0\r\nanswer', sessionId: 'voice-session' } : { ended: true });
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

test('six sample calls stay visible when returning to AI practice and yield to real results', async () => {
  await mount(undefined, false, null);
  assert.equal(document.querySelector('.practice-example-label').textContent, 'Sample progress · 6 calls');
  assert.equal(document.querySelector('.stat-average .stat-value').textContent, '87%');
  assert.equal(document.querySelector('.stat-best .score-gauge-number').textContent, '100');
  assert.equal(document.querySelector('.stat-calls [role="progressbar"]').getAttribute('aria-valuenow'), '6');
  assert.equal(document.querySelectorAll('.practice-contact-list .is-complete').length, 6);
  assert.equal(document.querySelector('.practice-directory .library-queue-heading').textContent, '4 calls remaining');
  assert.equal(document.getElementById('practice-extension').value, '107');
  assert.equal(document.querySelector('.practice-history'), null);
  assert.equal(document.querySelector('.practice-company-reference .score-unscored').textContent, 'Not scored');
  for (const [company, extension, tone, label] of [
    ['Cedar Family Care', '101', 'high', 'Excellent'],
    ['Willow Health', '102', 'medium', 'Good progress'],
    ['Pinecrest Family Health', '106', 'high', 'Excellent'],
  ]) {
    const contactButton = button(`Select ${company}, extension ${extension}`);
    assert.equal(contactButton.querySelector(`.practice-score-label.score-${tone}`).textContent, label);
    await actOn(() => contactButton.click());
    assert.equal(document.querySelector(`.practice-company-reference .score-${tone}`).textContent, label);
  }
  const saved = JSON.parse(localStorage.getItem(PRACTICE_STORAGE_KEY));
  await unmount(); await mount(undefined, true);
  assert.deepEqual(JSON.parse(localStorage.getItem(PRACTICE_STORAGE_KEY)), saved);
  assert.equal(document.querySelector('.practice-history'), null);
  await startCall(); await captureConversation(); await actOn(() => button('End practice').click());
  assert.equal(document.querySelector('.practice-example-label'), null);
  assert.equal(JSON.parse(localStorage.getItem(PRACTICE_STORAGE_KEY)).totalCalls, 1);
  assert.equal(document.querySelector('.stat-average .stat-value').textContent, '60%');
  assert.equal(document.querySelector('.practice-workspace .practice-feedback .score-low').textContent, 'Needs practice');
  assert.ok(document.querySelector('.stat-best .score-gauge.score-low'));
});

test('voice practice calls the selected company, updates stats, and saves summaries only', async () => {
  await mount();
  assert.equal(document.querySelectorAll('.practice-stats .stat-completion .stat-bars > span').length, 40);
  assert.equal(document.querySelectorAll('.practice-stats .stat-answers .stat-bars > span').length, 30);
  assert.equal(document.querySelectorAll('.stat-average .stat-chart-point').length, 0);
  assert.equal(document.querySelector('.stat-best .score-gauge-number').textContent, '—');
  assert.equal(document.querySelectorAll('.practice-contact-list .call-item').length, 10);
  assert.equal(document.querySelector('.practice-directory .library-queue-heading').textContent, '10 calls remaining');
  assert.equal(document.querySelector('.directory-progress [role="progressbar"]').getAttribute('aria-valuemax'), '10');
  await actOn(() => button('Select Willow Health, extension 102').click());
  await startCall();
  assert.equal(requests.find(item => item.action === 'session').body.scenario, 'introduction');
  assert.equal(requests.find(item => item.action === 'session').body.contactId, 'willow');
  assert.ok([...document.querySelectorAll('.practice-contact')].every(item => item.disabled));
  await captureConversation();
  assert.equal(document.querySelectorAll('.practice-message').length, 3);
  await actOn(() => button('End practice').click());
  assert.equal(track.stopped, true);
  assert.match(document.querySelector('.practice-feedback').textContent, /Needs practice/);
  const saved = JSON.parse(localStorage.getItem(PRACTICE_STORAGE_KEY));
  assert.equal(saved.history.length, 1);
  assert.equal(saved.history[0].contactId, 'willow');
  assert.equal(saved.history[0].mode, 'voice');
  assert.equal(saved.history[0].messages, undefined);
  assert.equal(saved.history[0].transcript, undefined);
  assert.equal(saved.totalCalls, 1);
  assert.equal(saved.contactScores.willow, 12);
  assert.equal(document.querySelector('.practice-directory .library-queue-heading').textContent, '9 calls remaining');
  assert.equal(document.querySelector('.stat-average .stat-value').textContent, '60%');
  assert.match(document.querySelector('.stat-average .stat-sparkline').getAttribute('aria-label'), /Willow Health: 60%/);
  assert.equal(document.querySelector('.stat-best .score-gauge-number').textContent, '60');
  assert.equal(document.querySelector('.stat-calls [role="progressbar"]').getAttribute('aria-valuenow'), '1');
  assert.equal(localStorage.getItem(PRACTICE_STORAGE_KEY).includes('Hi Sarah.'), false);
  await unmount(); await mount(undefined, true);
  assert.equal(document.getElementById('practice-history-title'), null);
  assert.equal(document.querySelector('.practice-conversation'), null);
  assert.deepEqual(JSON.parse(localStorage.getItem(PRACTICE_STORAGE_KEY)), saved);
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

test('each call counts down from twenty seconds, stops the microphone, and requests one review', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: Date.now() });
  await mount(); await startCall();
  assert.equal(document.querySelector('.practice-live-display time').textContent, '0:20');
  await captureConversation();
  await actOn(() => t.mock.timers.tick(19000));
  assert.equal(document.querySelector('.practice-live-display time').textContent, '0:01');
  assert.equal(track.stopped, false);
  await actOn(() => t.mock.timers.tick(1000));
  assert.equal(track.stopped, true);
  assert.match(document.querySelector('.practice-call-actions').textContent, /Call complete · 0:20/);
  assert.match(document.querySelector('.practice-notice').textContent, /20-second practice is complete/);
  assert.equal(JSON.parse(localStorage.getItem(PRACTICE_STORAGE_KEY)).history[0].seconds, 20);
  await actOn(() => t.mock.timers.tick(5000));
  assert.equal(requests.filter(item => item.action === 'feedback').length, 1);
  assert.equal(requests.filter(item => item.action === 'end').length, 1);
});

test('dialer audio settings change partner volume and preserve it for a call', async () => {
  await mount();
  await actOn(() => document.querySelector('.practice-audio-settings summary').click());
  assert.equal(document.querySelector('.practice-audio-settings').open, true);
  await actOn(() => {
    const input = document.getElementById('practice-volume');
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '35');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
  assert.equal(document.querySelector('.practice-volume-value').textContent, '35%');
  assert.equal(document.querySelector('audio').volume, .35);
  await startCall();
  assert.equal(document.querySelector('audio').volume, .35);
  await actOn(() => button('End practice').click());
  await actOn(() => button('Practice again').click());
  assert.equal(document.querySelector('.practice-volume-value').textContent, '35%');
});

test('company selection and dialer navigation keep business details and call target in sync', async () => {
  await mount();
  assert.equal(button('Previous AI partner').disabled, true);
  assert.equal(document.getElementById('practice-company-title').textContent, 'Cedar Family Care');
  assert.match(document.querySelector('.practice-business-data').textContent, /cedarfamilycare\.example/);
  await actOn(() => button('Next AI partner').click());
  assert.equal(document.getElementById('practice-extension').value, '102');
  assert.equal(document.getElementById('practice-company-title').textContent, 'Willow Health');
  assert.equal(document.getElementById('practice-ai-partner-title').textContent, 'Maya AI');
  const business = document.querySelector('.practice-business-data').textContent;
  assert.match(business, /132 Willow Lane/);
  assert.match(business, /willowhealth\.example/);
  assert.match(business, /Ext\. 102/);
  assert.doesNotMatch(business, /cedarfamilycare|Make your introduction/);
  assert.equal(button('Select Willow Health, extension 102').getAttribute('aria-pressed'), 'true');
  await actOn(() => button('Select Aspen Grove Health, extension 110').click());
  assert.equal(button('Next AI partner').disabled, true, 'Navigation stays within the current level');
  await actOn(() => button('Previous AI partner').click());
  assert.equal(document.getElementById('practice-company-title').textContent, 'Clover Hill Clinic');
  assert.equal(document.getElementById('practice-extension').value, '109');
  await actOn(() => button('Clear number').click());
  assert.equal(document.getElementById('practice-company-title'), null, 'An empty number does not show stale company details');
  assert.match(document.querySelector('.practice-workspace').textContent, /Choose your AI practice partner/);
  await actOn(() => button('Select Willow Health, extension 102').click());
  await startCall();
  assert.equal(requests.find(item => item.action === 'session').body.contactId, 'willow');
  assert.equal(button('Previous AI partner').disabled, true);
  assert.equal(button('Next AI partner').disabled, true);
  await captureConversation(); await actOn(() => button('End practice').click());
  assert.ok(document.querySelector('.practice-workspace .practice-feedback'), 'Coaching appears in the central workspace');
});

test('failed feedback can be retried, and a silent attempt is never graded', async () => {
  let fail = true;
  await mount(action => action === 'feedback' && fail ? Response.json({ error: 'Review unavailable.' }, { status: 502 }) : undefined);
  await startCall(); await actOn(() => button('End practice').click());
  assert.match(document.querySelector('.practice-call-actions').textContent, /No completed replies/);
  assert.equal(requests.some(item => item.action === 'feedback'), false);
  assert.match(document.querySelector('.stat-calls').textContent, /0 \/ 80/);
  await actOn(() => button('Practice again').click()); await startCall(); await captureConversation();
  await actOn(() => button('End practice').click());
  assert.match(document.querySelector('[role="alert"]').textContent, /Review unavailable/);
  fail = false; await actOn(() => button('Get my feedback').click());
  assert.equal(JSON.parse(localStorage.getItem(PRACTICE_STORAGE_KEY)).history.length, 1);
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
  assert.equal(localStorage.length, 1);
  assert.deepEqual(JSON.parse(localStorage.getItem(PRACTICE_STORAGE_KEY)), emptyPractice());
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

test('the dial pad selects real practice extensions and blocks unknown or locked companies', async () => {
  await mount();
  assert.equal(document.querySelectorAll('.practice-stat').length, 4);
  assert.equal(document.querySelectorAll('.practice-keypad button').length, 12);
  assert.equal(document.querySelector('input[name="practice-scenario"]'), null);
  assert.equal(button('Level 2: Build trust (locked)').disabled, true);
  for (const digit of ['2', '0', '1']) await actOn(() => button(`Dial ${digit}`).click());
  assert.equal(document.getElementById('practice-extension').value, '201');
  assert.equal(button('Start practice call').disabled, true);
  assert.match(document.getElementById('dial-number-help').textContent, /Complete level 1/);
  await actOn(() => button('Select Cedar Family Care, extension 101').click());
  for (const digit of ['9', '9', '9']) await actOn(() => button(`Dial ${digit}`).click());
  assert.equal(button('Start practice call').disabled, true);
  assert.match(document.getElementById('dial-number-help').textContent, /isn’t in your practice list/);
  await actOn(() => button('Delete last digit').click());
  assert.equal(document.getElementById('practice-extension').value, '99');
  await actOn(() => button('Clear number').click());
  assert.equal(document.getElementById('practice-extension').value, '');
  assert.equal(button('Start practice call').disabled, true);
  assert.equal(button('Delete last digit').disabled, true);
  assert.equal(button('Clear number').disabled, true);
  for (const digit of ['1', '0', '3']) await actOn(() => button(`Dial ${digit}`).click());
  assert.equal(document.getElementById('practice-partner-title').textContent, 'Brookside Clinic');
  assert.equal(requests.some(item => item.action === 'session'), false, 'Entering a number never starts a call');
  await startCall();
  assert.equal(requests.find(item => item.action === 'session').body.contactId, 'brookside');
  assert.equal(document.querySelector('.practice-keypad'), null);
});

test('a scored call unlocks the next level and next company without losing progress on reload', async () => {
  let seed = emptyPractice();
  for (const item of practiceContacts.slice(0, 9)) seed = recordAttempt(seed, { id: item.id, contactId: item.id, scenario: item.scenario, mode: 'voice', date: new Date().toISOString(), seconds: 40, feedback });
  await mount(undefined, false, seed);
  assert.equal(document.getElementById('practice-extension').value, '110');
  await startCall(); await captureConversation(); await actOn(() => button('End practice').click());
  assert.equal(document.querySelector('.stat-level .stat-progress-heading strong').textContent, '🤝Level 02');
  assert.equal(button('Level 2: Build trust').disabled, false);
  await actOn(() => button('Next company').click());
  assert.equal(document.getElementById('practice-extension').value, '201');
  assert.equal(document.getElementById('practice-partner-title').textContent, 'Northstar Medical');
  assert.equal(document.querySelectorAll('.practice-contact-list .call-item').length, 20);
  assert.equal(document.querySelector('.practice-directory .library-queue-heading').textContent, '20 calls remaining');
  assert.equal(document.querySelector('.directory-progress [role="progressbar"]').getAttribute('aria-valuemax'), '20');
  await actOn(() => button('Level 1: Break the ice').click());
  assert.equal(document.getElementById('practice-company-title').textContent, 'Cedar Family Care');
  assert.equal(document.getElementById('practice-extension').value, '101');
  await actOn(() => button('Level 2: Build trust').click());
  assert.equal(document.getElementById('practice-company-title').textContent, 'Northstar Medical');
  assert.equal(document.getElementById('practice-extension').value, '201');
  await unmount(); await mount(undefined, true);
  assert.equal(document.getElementById('practice-extension').value, '201');
  assert.match(document.querySelector('.stat-calls').textContent, /10 \/ 80/);
  await startCall();
  assert.equal(requests.find(item => item.action === 'session').body.scenario, 'objection');
});

test('the twentieth level 2 call unlocks the fifty-call level 3 queue', async () => {
  let seed = emptyPractice();
  for (const item of practiceContacts.slice(0, 29)) seed = recordAttempt(seed, { id: item.id, contactId: item.id, scenario: item.scenario, mode: 'voice', date: new Date().toISOString(), seconds: 40, feedback });
  await mount(undefined, false, seed);
  assert.equal(document.getElementById('practice-extension').value, '220');
  assert.equal(document.querySelector('.practice-directory .library-queue-heading').textContent, '1 call remaining');
  assert.equal(button('Level 3: Make it count (locked)').disabled, true);
  await startCall(); await captureConversation(); await actOn(() => button('End practice').click());
  await actOn(() => button('Next company').click());
  assert.equal(document.getElementById('practice-extension').value, '301');
  assert.equal(document.querySelectorAll('.practice-contact-list .call-item').length, 50);
  assert.equal(document.querySelector('.practice-directory .library-queue-heading').textContent, '50 calls remaining');
  assert.equal(document.querySelector('.directory-progress [role="progressbar"]').getAttribute('aria-valuemax'), '50');
  assert.match(document.querySelector('.stat-level .stat-progress-copy').textContent, /0 of 50 calls/);
  await startCall();
  assert.equal(requests.filter(item => item.action === 'session').at(-1).body.scenario, 'follow-up');
});
