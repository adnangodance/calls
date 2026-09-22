import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCoverage, mergePlayedRanges, firstUnplayedPosition, listenedSeconds, canTakeQuiz, gradeQuiz, sanitizeProgress } from '../src/progress.mjs';

test('replaying audio does not count the same segment twice', () => {
  let ranges = mergeCoverage([], 0, 20, 100);
  ranges = mergeCoverage(ranges, 10, 30, 100);
  assert.deepEqual(ranges, [[0, 30]]);
  assert.equal(listenedSeconds(ranges), 30);
});

test('revisiting earlier audio fills gaps instead of losing listening progress', () => {
  assert.deepEqual(mergeCoverage([[0, 5], [95, 100]], 5, 95, 100), [[0, 100]]);
  assert.deepEqual(mergeCoverage([[40, 70]], 0, 40, 100), [[0, 70]]);
  const restored = sanitizeProgress({ call: { coverage: [[60, 100], [0, 60]] } }, [{ id: 'call', duration: 100, objectives: [], questions: [] }]);
  assert.deepEqual(restored.call.coverage, [[0, 100]]);
});

test('skipping to the end does not unlock the questionnaire', () => {
  const coverage = mergeCoverage([[0, 5]], 95, 100, 100);
  assert.equal(canTakeQuiz({ coverage }, 100), false);
  assert.equal(canTakeQuiz({ coverage: [[0, 90]] }, 100), true);
});

test('native played ranges merge with earlier sessions without double counting', () => {
  const coverage = mergePlayedRanges([[0, 40]], [[20, 60], [60, 100]], 100);
  assert.deepEqual(coverage, [[0, 100]]);
  assert.equal(canTakeQuiz({ coverage }, 100), true);
  assert.equal(firstUnplayedPosition([[0, 25], [80, 100]], 100), 25);
  assert.equal(firstUnplayedPosition([[50, 100]], 100), 0);
});

test('completed or submitted quizzes do not relock after restoring older progress', () => {
  assert.equal(canTakeQuiz({ completed: true, coverage: [] }, 100), true);
  assert.equal(canTakeQuiz({ submitted: true, coverage: [] }, 100), true);
  assert.equal(canTakeQuiz({ coverage: [[0, 5]] }, 100), false);
});

test('coverage is bounded to the recording and rejects invalid time values', () => {
  assert.deepEqual(mergeCoverage([], -5, 120, 100), [[0, 100]]);
  assert.deepEqual(mergeCoverage([], 0, NaN, 100), []);
  assert.equal(canTakeQuiz({}, 0), false);
});

test('quiz requires two correct answers and does not count unanswered questions', () => {
  const questions = [{ correct: 1 }, { correct: 0 }, { correct: 2 }];
  assert.deepEqual(gradeQuiz(questions, [1, 0, 1]), { correct: 2, total: 3, score: 67, passed: true });
  assert.equal(gradeQuiz(questions, [1, -1, -1]).passed, false);
  assert.equal(gradeQuiz(questions, [1, 0, 2]).score, 100);
});

test('malformed saved progress is safe to load', () => {
  const calls = [{ id: 'test', duration: 100, objectives: ['opening'], questions: [{ options: ['a', 'b'] }] }];
  assert.deepEqual(sanitizeProgress(null, calls), {});
  const cleaned = sanitizeProgress({ test: { coverage: [[0, 200], ['bad', 50], null], answers: [99], completed: true, bestScore: 12, reflection: {}, checked: [0, 50] } }, calls).test;
  assert.deepEqual(cleaned.coverage, [[0, 100]]);
  assert.deepEqual(cleaned.answers, [-1]);
  assert.equal(cleaned.completed, false);
  assert.equal(cleaned.reflection, '');
  assert.deepEqual(cleaned.checked, [0]);
});

test('submitted questionnaires retain feedback after reopening the app', () => {
  const calls = [{ id: 'test', duration: 100, objectives: [], questions: [{ options: ['a', 'b'] }] }];
  const saved = { answers: [1], reflection: 'Ask a clarifying question.', submitted: true, bestScore: 100, completed: true };
  const restored = sanitizeProgress(JSON.parse(JSON.stringify({ test: saved })), calls).test;
  assert.equal(restored.submitted, true);
  assert.equal(restored.completed, true);
  assert.deepEqual(restored.answers, [1]);
  assert.equal(restored.reflection, saved.reflection);
  assert.equal(sanitizeProgress({ test: { ...saved, answers: [] } }, calls).test.submitted, false);
  assert.equal(sanitizeProgress({ test: { ...saved, reflection: ' ' } }, calls).test.submitted, false);
  assert.equal(sanitizeProgress({ test: { ...saved, submitted: false } }, calls).test.submitted, false);
});
