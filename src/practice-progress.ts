import { feedbackCriteria, MAX_CALL_SECONDS, practiceContacts, practiceLevels, practiceScenarios, validFeedback } from '../shared/practice.mjs';
import type { Feedback } from './practice-client';

export type Attempt = { id: string; contactId?: string; scenario: string; mode: 'voice'; date: string; seconds: number; feedback: Feedback };
export type PracticeRecord = { history: Attempt[]; totalCalls: number; totalScore: number; bestScore: number; contactScores: Record<string, number>; example?: true };
export const PRACTICE_STORAGE_KEY = 'targetone-practice-v2';
const LEGACY_KEY = 'targetone-practice-v1';
// Keep older five-minute calls readable after shortening new practice calls.
const MAX_SAVED_CALL_SECONDS = 300;
const HISTORY_LIMIT = 6;
export const callScore = (feedback: Feedback) => feedback.criteria.reduce((sum, item) => sum + item.score, 0);
export const emptyPractice = (): PracticeRecord => ({ history: [], totalCalls: 0, totalScore: 0, bestScore: 0, contactScores: {} });

function validAttempt(item: Attempt) {
  return item && typeof item.id === 'string' && practiceScenarios.some(scenario => scenario.id === item.scenario)
    && (!item.contactId || practiceContacts.some(contact => contact.id === item.contactId && contact.scenario === item.scenario))
    && item.mode === 'voice' && typeof item.date === 'string' && Number.isFinite(Date.parse(item.date))
    && Number.isFinite(item.seconds) && item.seconds >= 0 && item.seconds <= MAX_SAVED_CALL_SECONDS && validFeedback(item.feedback);
}

export function recordAttempt(record: PracticeRecord, attempt: Attempt): PracticeRecord {
  if (!validAttempt(attempt) || record.history.some(item => item.id === attempt.id)) return record;
  // Real coaching starts its own record; example scores must not count toward it.
  if (record.example) record = emptyPractice();
  const points = callScore(attempt.feedback);
  return {
    history: [attempt, ...record.history].slice(0, HISTORY_LIMIT),
    totalCalls: record.totalCalls + 1, totalScore: record.totalScore + points, bestScore: Math.max(record.bestScore, points),
    contactScores: attempt.contactId ? { ...record.contactScores, [attempt.contactId]: Math.max(record.contactScores[attempt.contactId] ?? 0, points) } : record.contactScores,
  };
}

export function examplePractice(): PracticeRecord {
  const ratings = [[5, 5, 5, 5], [4, 3, 3, 4], [4, 4, 5, 4], [5, 5, 5, 5], [4, 4, 3, 4], [5, 4, 5, 4]];
  const createdAt = Date.now();
  const record = practiceContacts.slice(0, ratings.length).reduce((current, contact, index) => recordAttempt(current, {
    id: `example-${contact.id}`, contactId: contact.id, scenario: contact.scenario, mode: 'voice',
    date: new Date(createdAt - (ratings.length - index) * 30 * 60_000).toISOString(), seconds: MAX_CALL_SECONDS,
    feedback: {
      summary: `Example conversation with ${contact.name}: a clear introduction, a question about their workflow, and an agreed follow-up.`,
      nextAttempt: ratings[index].every(value => value === 5) ? 'Keep the same structure and adapt your questions to the next company.' : 'Ask one more follow-up question before suggesting a next step.',
      criteria: feedbackCriteria.map((name, criterion) => ({ name, score: ratings[index][criterion], evidence: [
        'Introduced the purpose of the call and asked permission to continue.',
        'Asked an open question about the team’s current workflow.',
        'Acknowledged the response before moving the conversation forward.',
        'Suggested a relevant follow-up and confirmed the next action.',
      ][criterion] })),
    },
  }), emptyPractice());
  return { ...record, example: true };
}

export function loadPractice(): PracticeRecord {
  try {
    const stored = localStorage.getItem(PRACTICE_STORAGE_KEY);
    if (!stored) {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]');
      const migrated = Array.isArray(legacy) ? legacy.filter(validAttempt).slice(0, HISTORY_LIMIT).reverse().reduce(recordAttempt, emptyPractice()) : emptyPractice();
      return migrated.totalCalls ? migrated : examplePractice();
    }
    const value = JSON.parse(stored);
    if (!value || !Number.isSafeInteger(value.totalCalls) || value.totalCalls < 0
      || !Number.isSafeInteger(value.totalScore) || value.totalScore < 0 || value.totalScore > value.totalCalls * 20
      || !Number.isInteger(value.bestScore) || value.bestScore < 0 || value.bestScore > 20
      || !value.contactScores || typeof value.contactScores !== 'object' || !Array.isArray(value.history)) return emptyPractice();
    const contactScores = Object.fromEntries(practiceContacts.filter(contact => Number.isInteger(value.contactScores[contact.id]) && value.contactScores[contact.id] >= 0 && value.contactScores[contact.id] <= 20).map(contact => [contact.id, value.contactScores[contact.id]]));
    return { totalCalls: value.totalCalls, totalScore: value.totalScore, bestScore: value.bestScore, contactScores, history: value.history.filter(validAttempt).slice(0, HISTORY_LIMIT), ...(value.example === true ? { example: true as const } : {}) };
  } catch { return emptyPractice(); }
}

export function savePractice(record: PracticeRecord) {
  localStorage.setItem(PRACTICE_STORAGE_KEY, JSON.stringify(record));
  localStorage.removeItem(LEGACY_KEY);
}

export function practiceProgress(record: PracticeRecord) {
  const finished = (id: string) => Object.hasOwn(record.contactScores, id);
  const level = practiceLevels.find(item => practiceContacts.some(contact => contact.level === item.number && !finished(contact.id))) || practiceLevels[practiceLevels.length - 1];
  const remaining = practiceContacts.filter(contact => contact.level === level.number && !finished(contact.id)).length;
  const nextContact = practiceContacts.find(contact => contact.level === level.number && !finished(contact.id)) || practiceContacts.find(contact => contact.level === level.number)!;
  return { level, remaining, nextContact, completed: practiceContacts.filter(contact => finished(contact.id)).length,
    average: record.totalCalls ? Math.round(record.totalScore / record.totalCalls * 5) : null,
    best: record.totalCalls ? record.bestScore * 5 : null };
}
