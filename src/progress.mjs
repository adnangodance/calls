// Track audio actually played, so seeking to the end does not complete a lesson.
export function mergeCoverage(ranges, start, end, duration) {
  if (![start, end, duration].every(Number.isFinite) || duration <= 0 || end <= start) return ranges;
  const next = [...ranges, [Math.max(0, start), Math.min(end, duration)]]
    .filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  return next.reduce((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1] + 0.08) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
    return merged;
  }, []);
}

export function listenedSeconds(ranges = []) {
  return ranges.reduce((total, [start, end]) => total + Math.max(0, end - start), 0);
}

// The browser records actual playback independently of timeupdate frequency,
// playback speed, buffering, and background-tab throttling.
export function mergePlayedRanges(coverage, played, duration) {
  return played.reduce((ranges, [start, end]) => mergeCoverage(ranges, start, end, duration), coverage || []);
}

export function gradeQuiz(questions, answers) {
  const correct = questions.reduce((total, question, index) => total + (answers[index] === question.correct ? 1 : 0), 0);
  return { correct, total: questions.length, score: Math.round(correct / questions.length * 100), passed: correct >= Math.ceil(questions.length * 2 / 3) };
}

// Treat persisted data as untrusted; malformed entries must not break the course.
export function sanitizeProgress(raw, calls) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result = {};
  for (const call of calls) {
    const saved = raw[call.id];
    if (!saved || typeof saved !== 'object') continue;
    result[call.id] = {
      coverage: Array.isArray(saved.coverage) ? saved.coverage.reduce((ranges, value) => {
        if (!Array.isArray(value) || value.length !== 2) return ranges;
        return mergeCoverage(ranges, value[0], value[1], call.duration);
      }, []) : [],
      position: Number.isFinite(saved.position) ? Math.max(0, Math.min(saved.position, call.duration)) : 0,
      answers: Array.isArray(saved.answers) ? call.questions.map((q, i) => Number.isInteger(saved.answers[i]) && saved.answers[i] >= 0 && saved.answers[i] < q.options.length ? saved.answers[i] : -1) : [],
      reflection: typeof saved.reflection === 'string' ? saved.reflection.slice(0, 5000) : '',
      bestScore: [0, 33, 67, 100].includes(saved.bestScore) ? saved.bestScore : undefined,
      completed: saved.completed === true && [67, 100].includes(saved.bestScore),
      submitted: saved.submitted === true && call.questions.every((q, i) => Number.isInteger(saved.answers?.[i]) && saved.answers[i] >= 0 && saved.answers[i] < q.options.length) && typeof saved.reflection === 'string' && saved.reflection.trim().length > 0,
    };
  }
  return result;
}
