import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import ts from 'typescript';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

// Exercise the real React UI with controlled media events. jsdom does not
// decode audio; the browser's played ranges are supplied for each scenario.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/calls/' });
for (const name of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(callback, 0);
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
const calls = JSON.parse(await readFile(new URL('../src/calls.json', import.meta.url), 'utf8'));
const first = calls[0];
const mediaPrototype = dom.window.HTMLMediaElement.prototype;
Object.defineProperties(mediaPrototype, {
  duration: { configurable: true, get() { return calls.find(call => `/calls${call.audio}` === this.getAttribute('src'))?.duration || 0; } },
  paused: { configurable: true, get() { return this.testPaused !== false; } },
  played: { configurable: true, get() {
    const ranges = (this.testPlayed || []).map(range => [...range]);
    return { length: ranges.length, start: i => ranges[i][0], end: i => ranges[i][1] };
  } },
});
mediaPrototype.play = function () {
  this.testPaused = false;
  this.dispatchEvent(new dom.window.Event('play'));
  return Promise.resolve();
};
mediaPrototype.pause = function () {
  if (this.paused) return;
  this.testPaused = true;
  this.dispatchEvent(new dom.window.Event('pause'));
};

const { createRoot } = await import('react-dom/client');
const source = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  // Vite substitutes this value when building for the GitHub Pages subpath.
  .replaceAll('import.meta.env.BASE_URL', JSON.stringify('/calls/'))
  .replace(/from ['"]\.\/calls\.json['"];/, "from './calls.json' with { type: 'json' };");
const temporaryModule = resolve(`src/.app-test-${process.pid}.mjs`);
let App;
try {
  await writeFile(temporaryModule, compiled);
  App = (await import(pathToFileURL(temporaryModule).href)).default;
} finally {
  await unlink(temporaryModule);
}

let root;
async function interact(callback) {
  await act(async () => { await callback(); await new Promise(resolve => setTimeout(resolve, 5)); });
}
async function mount(progress = {}, preserve = false) {
  if (!preserve) localStorage.setItem('targetone-training-v1', JSON.stringify({ activeId: first.id, progress }));
  root = createRoot(document.getElementById('root'));
  await interact(() => root.render(React.createElement(React.StrictMode, null, React.createElement(App))));
}
async function unmount() {
  if (root) await interact(() => root.unmount());
  root = null;
}
afterEach(unmount);
after(() => dom.window.close());

function saved() { return JSON.parse(localStorage.getItem('targetone-training-v1')); }
function button(label) {
  const result = [...document.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || element.textContent.trim() === label);
  assert.ok(result, `Button exists: ${label}`);
  return result;
}
async function finish(ranges = [[0, first.duration]]) {
  const audio = document.querySelector('audio');
  await interact(async () => {
    await audio.play();
    audio.testPlayed = ranges;
    audio.currentTime = first.duration;
    audio.testPaused = true;
    // Reproduce a pause followed by ended without an intervening timeupdate.
    audio.dispatchEvent(new dom.window.Event('pause'));
    audio.dispatchEvent(new dom.window.Event('ended'));
  });
}
async function answer(correct = true) {
  if (document.querySelector('.quiz-expand-all')?.textContent.includes('Expand all')) {
    await interact(() => button('Expand all').click());
  }
  await interact(() => {
    first.questions.forEach((question, index) => {
      const value = correct ? question.correct : (question.correct + 1) % question.options.length;
      document.querySelector(`input[name="question-${first.id}-${index}"][value="${value}"]`).click();
    });
    const takeaway = document.getElementById('takeaway');
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(takeaway, 'Ask a clarifying question before offering a solution.');
    takeaway.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}
async function submit() {
  await interact(() => document.querySelector('#quiz-panel form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
}

test('every recording resolves under the GitHub Pages project path', async () => {
  await mount();
  for (const [index, call] of calls.entries()) {
    assert.equal(document.querySelector('audio').src, `http://localhost/calls${call.audio}`);
    if (index < calls.length - 1) await interact(() => button('Next demo').click());
  }
});

test('finishing playback opens the questionnaire, accepts answers, and restores the result', async () => {
  await mount();
  document.querySelector('audio').playbackRate = 2;
  await finish();
  assert.equal(document.getElementById('quiz-tab').getAttribute('aria-selected'), 'true');
  assert.ok(document.querySelector('#quiz-panel form'));
  assert.equal(document.activeElement, document.querySelector('.questionnaire-heading h3'));
  await answer();
  await submit();
  assert.equal(saved().progress[first.id].completed, true);
  assert.equal(saved().progress[first.id].bestScore, 100);
  assert.match(document.querySelector('.quiz-result').textContent, /Demo complete/);
  assert.equal(document.querySelectorAll('.answer-review-card .review-badge.is-correct').length, first.questions.length);
  assert.ok([...document.querySelectorAll('.answer-review-card .task-body')].every(body => body.hidden));
  await interact(() => document.getElementById('quiz-task-0-heading').click());
  assert.equal(document.getElementById('quiz-task-0-body').hidden, false);
  assert.equal(document.querySelector('#quiz-task-0-body .answer-feedback').textContent, first.questions[0].explanation);

  await unmount();
  await mount({}, true);
  await interact(() => document.getElementById('quiz-tab').click());
  assert.match(document.querySelector('.quiz-result').textContent, /100%/);
  assert.equal(document.getElementById('takeaway').value, 'Ask a clarifying question before offering a solution.');
  assert.ok([...document.querySelectorAll('#quiz-panel input')].every(input => input.disabled));
  await interact(() => button('Continue to next demo').click());
  assert.equal(saved().activeId, calls[1].id);
  assert.equal(document.getElementById('listen-tab').getAttribute('aria-selected'), 'true');
});

test('listening across reloads merges played ranges and unlocks on the final event', async () => {
  await mount();
  const audio = document.querySelector('audio');
  const half = first.duration / 2;
  await interact(async () => {
    await audio.play();
    audio.testPlayed = [[0, half]];
    audio.currentTime = half;
    audio.pause();
  });
  assert.deepEqual(saved().progress[first.id].coverage, [[0, half]]);
  await unmount();
  await mount({}, true);
  await interact(() => document.querySelector('audio').dispatchEvent(new dom.window.Event('loadedmetadata')));
  assert.equal(document.querySelector('audio').currentTime, half);
  await finish([[half, first.duration]]);
  assert.deepEqual(saved().progress[first.id].coverage, [[0, first.duration]]);
  assert.ok(document.querySelector('#quiz-panel form'));
});

test('seeking to the end gives a clear resume action without crediting skipped audio', async () => {
  await mount();
  await finish([[0, 5], [first.duration - 1, first.duration]]);
  assert.equal(document.getElementById('listen-tab').getAttribute('aria-selected'), 'true');
  assert.match(document.querySelector('.lesson-action').textContent, /Finish the parts you haven’t heard/);
  assert.equal(document.querySelector('#quiz-panel form'), null);
  await interact(() => button('Continue listening').click());
  assert.equal(document.querySelector('audio').currentTime, 5);
  assert.equal(document.querySelector('audio').paused, false);
  await finish([[5, first.duration]]);
  assert.ok(document.querySelector('#quiz-panel form'), JSON.stringify({ progress: saved().progress[first.id], activeId: saved().activeId, tab: document.getElementById('quiz-tab').getAttribute('aria-selected'), panel: document.querySelector('.quiz-locked')?.textContent }));
});

test('incomplete answers get focused validation and a failed attempt can be retried', async () => {
  await mount();
  await finish();
  await interact(() => document.getElementById('quiz-task-0-heading').click());
  assert.equal(document.getElementById('quiz-task-0-body').hidden, true);
  await submit();
  assert.match(document.querySelector('.form-error').textContent, /question 1/);
  assert.equal(document.getElementById('quiz-task-0-body').hidden, false);
  assert.equal(document.activeElement.name, `question-${first.id}-0`);
  await answer(false);
  await submit();
  assert.equal(saved().progress[first.id].completed, false);
  assert.match(document.querySelector('.quiz-result').textContent, /Review your answers/);
  assert.equal(document.querySelectorAll('.answer-review-card .review-badge.needs-review').length, first.questions.length);
  await interact(() => button('Retry missed questions').click());
  assert.equal(document.querySelector('.answer-review-card'), null);
  await answer();
  await submit();
  assert.equal(saved().progress[first.id].bestScore, 100);
  assert.equal(saved().progress[first.id].completed, true);
});

test('task navigation preserves answers and reveals a missing takeaway on submit', async () => {
  await mount();
  await finish();
  assert.match(document.querySelector('.task-list-heading').textContent, /4 tasks remaining/);
  for (let index = 0; index < first.questions.length; index++) {
    assert.equal(document.getElementById(`quiz-task-${index}-body`).hidden, false);
    await interact(() => document.querySelector(`input[name="question-${first.id}-${index}"][value="${first.questions[index].correct}"]`).click());
    await interact(() => document.querySelector(`#quiz-task-${index}-body .task-next`).click());
    assert.equal(document.getElementById(`quiz-task-${index}-body`).hidden, true);
    assert.equal(document.activeElement.id, `quiz-task-${index + 1}-heading`);
  }
  assert.match(document.querySelector('.task-list-heading').textContent, /1 task remaining/);
  await interact(() => button('Expand all').click());
  await interact(() => button('Collapse all').click());
  assert.ok([...document.querySelectorAll('.task-body')].every(body => body.hidden));
  await submit();
  assert.match(document.querySelector('.form-error').textContent, /written takeaway/);
  assert.equal(document.getElementById('quiz-task-3-body').hidden, false);
  assert.equal(document.activeElement.id, 'takeaway');
  assert.deepEqual(saved().progress[first.id].answers, first.questions.map(question => question.correct));
});

test('previously submitted questionnaires stay available with incomplete legacy listening data', async () => {
  await mount({ [first.id]: { coverage: [[0, 1]], answers: first.questions.map(question => question.correct), reflection: 'Saved takeaway.', bestScore: 100, completed: true, submitted: true } });
  await interact(() => document.getElementById('quiz-tab').click());
  assert.ok(document.querySelector('#quiz-panel form'));
  assert.match(document.querySelector('.quiz-result').textContent, /Demo complete/);
});
