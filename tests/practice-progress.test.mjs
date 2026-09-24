import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './compile.mjs';
import { practiceContacts, practiceLevels, feedbackCriteria } from '../shared/practice.mjs';

const { emptyPractice, examplePractice, recordAttempt, practiceProgress, loadPractice, savePractice, PRACTICE_STORAGE_KEY } = await loadSource('practice-progress');
function attempt(contact, id, rating = 3) {
  return { id, contactId: contact.id, scenario: contact.scenario, mode: 'voice', date: '2026-09-24T10:00:00Z', seconds: 60, feedback: { summary: 'A useful conversation.', nextAttempt: 'Confirm the next step.', criteria: feedbackCriteria.map(name => ({ name, score: rating, evidence: 'A relevant question.' })) } };
}

test('levels have 10, 20 and 50 distinct, dialable company calls', () => {
  assert.deepEqual(practiceLevels.map(level => level.callsRequired), [10, 20, 50]);
  assert.equal(practiceContacts.length, 80);
  assert.equal(new Set(practiceContacts.map(contact => contact.id)).size, 80);
  assert.equal(new Set(practiceContacts.map(contact => contact.extension)).size, 80);
  for (const level of practiceLevels) {
    const contacts = practiceContacts.filter(contact => contact.level === level.number);
    assert.equal(contacts.length, level.callsRequired);
    assert.ok(contacts.every(contact => /^\d{3}$/.test(contact.extension) && contact.scenario === level.scenario));
  }
});

test('level 1 requires ten distinct calls; retries improve scores without skipping ahead', () => {
  let record = emptyPractice();
  const first = attempt(practiceContacts[0], 'first');
  record = recordAttempt(record, first);
  assert.equal(recordAttempt(record, first), record, 'A duplicate feedback response counts only once');
  record = recordAttempt(record, attempt(practiceContacts[0], 'retry', 4));
  assert.equal(record.totalCalls, 2);
  assert.equal(record.contactScores.cedar, 16);
  assert.equal(practiceProgress(record).completed, 1);
  assert.equal(practiceProgress(record).level.number, 1);
  assert.equal(practiceProgress(record).remaining, 9);
  assert.equal(practiceProgress(record).average, 70);
  for (const contact of practiceContacts.slice(1, 9)) record = recordAttempt(record, attempt(contact, contact.id));
  assert.equal(practiceProgress(record).level.number, 1);
  assert.equal(practiceProgress(record).remaining, 1);
  record = recordAttempt(record, attempt(practiceContacts[9], 'tenth'));
  assert.equal(practiceProgress(record).level.number, 2);
  assert.equal(practiceProgress(record).remaining, 20);
  assert.equal(practiceProgress(record).nextContact.extension, '201');
});

test('levels 2 and 3 require twenty and fifty calls and retain progress beyond recent history', () => {
  let record = practiceContacts.slice(0, 29).reduce((state, contact) => recordAttempt(state, attempt(contact, contact.id)), emptyPractice());
  assert.equal(practiceProgress(record).level.number, 2);
  assert.equal(practiceProgress(record).remaining, 1);
  record = recordAttempt(record, attempt(practiceContacts[29], 'level-two-last'));
  assert.equal(practiceProgress(record).level.number, 3);
  assert.equal(practiceProgress(record).remaining, 50);
  assert.equal(practiceProgress(record).nextContact.extension, '301');
  for (const contact of practiceContacts.slice(30, 79)) record = recordAttempt(record, attempt(contact, contact.id));
  assert.equal(practiceProgress(record).remaining, 1);
  assert.equal(practiceProgress(record).nextContact.extension, '350');
  record = recordAttempt(record, attempt(practiceContacts[79], 'level-three-last'));
  assert.equal(record.history.length, 6);
  assert.equal(record.totalCalls, 80);
  assert.equal(practiceProgress(record).completed, 80);
  assert.equal(practiceProgress(record).level.number, 3);
  assert.equal(practiceProgress(record).remaining, 0);
  assert.equal(practiceProgress({ ...record, history: [] }).completed, 80);
});

test('legacy summaries migrate without inventing completed company calls, and malformed storage is safe', t => {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  t.after(() => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; });
  const legacy = attempt(practiceContacts[0], 'legacy'); delete legacy.contactId;
  store.set('targetone-practice-v1', JSON.stringify([legacy]));
  const record = loadPractice();
  assert.equal(record.totalCalls, 1);
  assert.equal(practiceProgress(record).completed, 0);
  savePractice(record);
  assert.equal(store.has('targetone-practice-v1'), false);
  assert.deepEqual(loadPractice(), record);
  store.set(PRACTICE_STORAGE_KEY, '{invalid');
  assert.deepEqual(loadPractice(), emptyPractice());
  store.set(PRACTICE_STORAGE_KEY, JSON.stringify({ ...record, totalCalls: -1 }));
  assert.deepEqual(loadPractice(), emptyPractice());
});

test('sample progress has six varied calls, survives storage, and never mixes with real coaching', t => {
  const store = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  t.after(() => { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; });
  const sample = loadPractice();
  assert.equal(sample.example, true);
  assert.equal(sample.totalCalls, 6);
  assert.equal(sample.history.length, 6);
  assert.deepEqual(Object.values(sample.contactScores).map(points => points * 5), [100, 70, 85, 100, 75, 90]);
  assert.equal(practiceProgress(sample).average, 87);
  assert.equal(practiceProgress(sample).remaining, 4);
  assert.equal(practiceProgress(sample).nextContact.extension, '107');
  savePractice(sample);
  assert.deepEqual(loadPractice(), sample);
  savePractice({ ...sample, history: [] });
  assert.equal(loadPractice().history.length, 0, 'Cleared sample history is not reseeded');
  assert.equal(loadPractice().totalCalls, 6);
  const real = recordAttempt(examplePractice(), attempt(practiceContacts[6], 'real-call'));
  assert.equal(real.example, undefined);
  assert.equal(real.totalCalls, 1);
  assert.deepEqual(real.contactScores, { riverbend: 12 });
  savePractice(real);
  assert.deepEqual(loadPractice(), real, 'Real progress is never replaced by examples');
  savePractice(emptyPractice());
  assert.deepEqual(loadPractice(), emptyPractice(), 'An explicitly saved empty record is preserved');
});
