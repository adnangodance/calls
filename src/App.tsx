import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock3, Headphones, Info, MapPin, Pause, Play, RotateCcw, RotateCw, Search, Square, Target, Trophy, Volume2, VolumeX, X } from 'lucide-react';
import callData from './calls.json';
import { gradeQuiz, mergePlayedRanges, sanitizeProgress } from './progress.mjs';

type Call = (typeof callData)[number];
type Progress = { coverage: number[][]; position: number; answers: number[]; reflection: string; bestScore?: number; completed: boolean; submitted?: boolean };
type Saved = { activeId?: string; progress: Record<string, Progress> };
type Filter = 'all' | 'todo' | 'completed';
const calls = callData as Call[];
const EMPTY: Progress = { coverage: [], position: 0, answers: [], reflection: '', completed: false };
const STORAGE_KEY = 'targetone-training-v1';
const managers = [...new Set(calls.map(c => c.manager))];
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`;
const initials = (name: string) => name.split(' ').map(part => part[0]).slice(0, 2).join('');

function readSaved(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { activeId: saved.activeId, progress: sanitizeProgress(saved.progress, calls) as Record<string, Progress> };
  } catch { return { progress: {} }; }
}

function ReviewRing({ label, progress = 100 }: { label: React.ReactNode; progress?: number }) {
  return <span className="review-ring" aria-hidden="true">
    <svg viewBox="0 0 40 40"><circle className="review-ring-track" cx="20" cy="20" r="16" pathLength="100" /><circle className="review-ring-fill" cx="20" cy="20" r="16" pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, progress)) * .78} 100`} /></svg>
    <span>{label}</span>
  </span>;
}

function QuestionnaireTask({ id, number, title, description, status, meta, expanded, onToggle, children, reviewMode = false }: {
  id: string; number: number; title: string; description: string; status: 'todo' | 'answered' | 'correct' | 'review';
  meta: string; expanded: boolean; onToggle: () => void; children: React.ReactNode; reviewMode?: boolean;
}) {
  return <section className={`questionnaire-task ${expanded ? 'is-open' : ''} task-${status} ${reviewMode ? 'answer-review-card' : ''}`}>
    <h4 className="task-heading"><button type="button" id={`${id}-heading`} className="task-toggle" aria-expanded={expanded} aria-controls={`${id}-body`} onClick={onToggle}>
      {reviewMode ? <ReviewRing label={String(number).padStart(2, '0')} /> : <span className="task-status-icon" aria-hidden="true">{status === 'answered' || status === 'correct' ? <Check size={14} strokeWidth={2} /> : status === 'review' ? <span>!</span> : String(number).padStart(2, '0')}</span>}
      <span className="task-copy"><span className="task-title-line"><strong>{title}</strong>{!reviewMode && <span className="task-meta">{meta}</span>}</span><span className="task-description">{description}</span></span>
      {reviewMode && <span className={`review-badge ${status === 'correct' ? 'is-correct' : status === 'review' ? 'needs-review' : 'is-saved'}`}>{meta}</span>}
      <ChevronRight size={15} className="task-chevron" aria-hidden="true" />
    </button></h4>
    <div className="task-body" id={`${id}-body`} role="region" aria-labelledby={`${id}-heading`} hidden={!expanded}>{children}</div>
  </section>;
}

export default function App() {
  const [initial] = useState(readSaved);
  const [progress, setProgress] = useState<Record<string, Progress>>(initial.progress);
  const [activeId, setActiveId] = useState(calls.some(c => c.id === initial.activeId) ? initial.activeId! : calls[0].id);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [manager, setManager] = useState('all');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [formError, setFormError] = useState('');
  const [expandedTasks, setExpandedTasks] = useState<number[]>(() => {
    const saved = initial.progress[activeId];
    if (saved?.submitted) return [];
    const call = calls.find(item => item.id === activeId)!;
    const missing = call.questions.findIndex((_, i) => !(saved?.answers[i] >= 0));
    return [missing < 0 ? call.questions.length : missing];
  });
  const audio = useRef<HTMLAudioElement>(null);
  const detail = useRef<HTMLElement>(null);
  const quizHeading = useRef<HTMLHeadingElement>(null);
  const active = calls.find(c => c.id === activeId)!;
  const index = calls.findIndex(c => c.id === activeId);
  const current = progress[activeId] || EMPTY;
  const completed = calls.filter(c => progress[c.id]?.completed).length;
  const scores = calls.map(c => progress[c.id]?.bestScore).filter((s): s is number => s !== undefined);
  const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const submitted = Boolean(current.submitted);
  const result = gradeQuiz(active.questions, current.answers);
  const answered = active.questions.filter((_, i) => current.answers[i] >= 0).length + (current.reflection.trim() ? 1 : 0);
  const totalTasks = active.questions.length + 1;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeId, progress })); setSaveError(false); }
    catch { setSaveError(true); }
  }, [activeId, progress]);

  function update(id: string, patch: Partial<Progress>) {
    setProgress(previous => ({ ...previous, [id]: { ...EMPTY, ...previous[id], ...patch } }));
  }

  function selectCall(id: string) {
    requestAnimationFrame(() => {
      document.getElementById('call-title')?.focus({ preventScroll: true });
      detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    if (id === activeId) return;
    audio.current?.pause();
    setFormError('');
    setPlaying(false);
    setAudioError(false);
    setTime(0);
    const saved = progress[id];
    const call = calls.find(item => item.id === id)!;
    const firstUnanswered = call.questions.findIndex((_, i) => !(saved?.answers[i] >= 0));
    setExpandedTasks(saved?.submitted ? [] : [firstUnanswered < 0 ? call.questions.length : firstUnanswered]);
    setActiveId(id);
  }

  async function togglePlay() {
    if (!audio.current) return;
    if (playing) audio.current.pause();
    else {
      try { await audio.current.play(); }
      catch { setAudioError(true); }
    }
  }

  function seek(position: number) {
    if (!audio.current || !Number.isFinite(audio.current.duration)) return;
    recordPlayback(audio.current);
    const next = Math.max(0, Math.min(active.duration, position));
    audio.current.currentTime = next;
    setTime(next);
    update(activeId, { position: next });
  }

  function recordPlayback(element: HTMLAudioElement) {
    if (element !== audio.current) return;
    const position = element.currentTime;
    // Snapshot mutable media properties before scheduling a React state update.
    const played = element.played;
    const ranges = Array.from({ length: played.length }, (_, i) => [played.start(i), played.end(i)]);
    setTime(position);
    setProgress(all => {
      const saved = all[activeId] || EMPTY;
      return { ...all, [activeId]: { ...saved, position, coverage: mergePlayedRanges(saved.coverage, ranges, active.duration) } };
    });
  }

  function submitQuiz(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (answered !== active.questions.length + 1) {
      const missing = active.questions.findIndex((_, i) => current.answers[i] === undefined || current.answers[i] < 0);
      const missingTask = missing >= 0 ? missing : active.questions.length;
      setExpandedTasks(previous => previous.includes(missingTask) ? previous : [...previous, missingTask]);
      setFormError(missing >= 0 ? `Choose an answer for question ${missing + 1} before submitting.` : 'Add your written takeaway before submitting.');
      requestAnimationFrame(() => {
        const field = missing >= 0 ? document.querySelector<HTMLInputElement>(`input[name="question-${activeId}-${missing}"]`) : document.getElementById('takeaway');
        field?.focus({ preventScroll: true });
        (field?.closest('fieldset') || field)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }
    audio.current?.pause();
    const grade = gradeQuiz(active.questions, current.answers);
    setExpandedTasks([]);
    update(activeId, { submitted: true, bestScore: Math.max(current.bestScore ?? 0, grade.score), completed: current.completed || grade.passed });
    setFormError('');
    requestAnimationFrame(() => { quizHeading.current?.focus({ preventScroll: true }); quizHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  }

  function retryQuiz() {
    update(activeId, { submitted: false, answers: active.questions.map((q, i) => current.answers[i] === q.correct ? current.answers[i] : -1) });
    setFormError('');
    const firstMissed = active.questions.findIndex((q, i) => current.answers[i] !== q.correct);
    setExpandedTasks([Math.max(0, firstMissed)]);
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`input[name="question-${activeId}-${Math.max(0, firstMissed)}"]`)?.focus());
  }

  function toggleQuizTask(task: number) {
    setExpandedTasks(previous => previous.includes(task) ? previous.filter(item => item !== task) : [...previous, task]);
  }

  function nextCall() {
    const next = calls.slice(index + 1).find(c => !progress[c.id]?.completed) || calls.find(c => !progress[c.id]?.completed) || calls[(index + 1) % calls.length];
    selectCall(next.id);
  }

  const visibleCalls = calls.filter(call => {
    const p = progress[call.id] || EMPTY;
    const matchesQuery = `${call.title} ${call.manager} ${call.specialty} ${call.topic}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (manager === 'all' || call.manager === manager) && (filter === 'all' || (filter === 'todo' && !p.completed) || (filter === 'completed' && p.completed));
  });

  return <>
    <header className="app-header">
      <div className="app-header-inner">
        <a className="brand" href="#main" aria-label="TargetOne home"><span className="brand-mark"><Target size={21} strokeWidth={1.6} /></span><span>Target<span className="brand-one">One</span></span></a>
        <span className="app-section">Sales training</span>
      </div>
    </header>

    <main id="main" className="page-shell">
      <section className="page-heading" aria-labelledby="page-title">
        <div className="page-heading-copy"><h1 id="page-title">Training calls</h1><p>Listen for context. Practice at your own pace.</p><a className="browse-calls" href="#call-library">Browse demos<ChevronDown size={14} /></a></div>
        <section className="course-progress" aria-label="Your training progress">
          <div className="course-progress-copy"><span>Your progress</span><span><strong>{completed}</strong> / {calls.length}</span></div>
          <div className="course-progress-track" role="progressbar" aria-label="Course completion" aria-valuemin={0} aria-valuemax={calls.length} aria-valuenow={completed} aria-valuetext={`${completed} of ${calls.length} demos completed`}>{calls.map((call, i) => <span key={call.id} className={i < completed ? 'is-complete' : ''} />)}</div>
          <div className="course-progress-caption"><span>Demos completed</span>{average !== null && <span>Quiz average <strong>{average}%</strong></span>}</div>
        </section>
      </section>
      {completed === calls.length && <div className="course-complete" role="status"><Trophy size={24} /><div><strong>All demos completed</strong><p>Revisit any call or review your answers whenever you need a refresher.</p></div></div>}

      <div className="learning-layout">
        <aside id="call-library" className="library" aria-label="Training call library">
          <div className="library-section-heading"><h2>Call library</h2><span>{calls.length} demos</span></div>
          <div className="library-tools">
            <label className="search-box">
              <Search size={16} />
              <input aria-label="Search training calls" placeholder="Search calls…" value={query} onChange={e => setQuery(e.target.value)} />
              {query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}
            </label>
            <div className="filter-pills library-filters" role="group" aria-label="Filter by review status">
              {([['all', 'All'], ['todo', 'To do'], ['completed', 'Completed']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={filter === value ? 'selected' : ''}>{label}</button>)}
            </div>
            <div className="library-manager-row">
              <label className="select-wrap"><select aria-label="Filter by manager" value={manager} onChange={event => setManager(event.target.value)}><option value="all">All managers</option>{managers.map(name => <option key={name} value={name}>{name}</option>)}</select><ChevronDown size={13} /></label>
              <span className="library-result-count" role="status">{visibleCalls.length} {visibleCalls.length === 1 ? 'call' : 'calls'}</span>
            </div>
          </div>

          <div className="call-list" aria-label="Calls">
            {visibleCalls.length ? visibleCalls.map(call => {
              const p = progress[call.id] || EMPTY;
              const selected = call.id === activeId;
              return <div className={`call-item ${selected ? 'active' : ''} ${p.completed ? 'is-complete' : ''}`} key={call.id}>
                <button className="call-select" aria-current={selected ? 'true' : undefined} onClick={() => selectCall(call.id)}>
                  <div className="call-item-title"><span className="call-number">{String(calls.indexOf(call) + 1).padStart(2, '0')}</span><strong>{call.title}</strong><ChevronRight size={14} className="call-current-icon" aria-hidden="true" /></div>
                  <div className="call-description"><strong>{call.manager}</strong><span className="call-meta-dot">·</span><span className="call-specialty">{call.specialty}</span></div>
                  <div className="call-item-meta"><span><Clock3 size={12} />{formatDuration(call.duration)}</span>{p.completed ? <span className="call-progress-label complete"><CircleCheck size={12} />Completed</span> : (p.answers.some(answer => answer >= 0) || p.reflection.trim()) && <span className="call-progress-label">In progress</span>}</div>
                </button>
              </div>;
            }) : <div className="empty-state"><Search size={25} /><strong>No calls found</strong><p>{query || manager !== 'all' ? 'Try a different search or filter.' : filter === 'completed' ? 'Your completed demos will appear here.' : 'All demos are complete. Revisit any call to practice.'}</p><button className="text-button" onClick={() => { setQuery(''); setFilter('all'); setManager('all'); }}>Show all calls<ArrowRight size={13} /></button></div>}
          </div>
        </aside>

        <section className="call-detail" ref={detail} aria-label="Selected training call">
          <div className="detail-header">
            <div className="detail-kicker"><span>Demo {String(index + 1).padStart(2, '0')} <span className="muted">/ {calls.length}</span></span><span className="kicker-dot">·</span><span className="lesson-level">{active.level}</span><span className={`lesson-status ${current.completed ? 'done' : ''}`}>{current.completed ? <><CircleCheck size={12} />Completed</> : answered > 0 ? 'In progress' : 'Not started'}</span></div>
            <div className="detail-title-row"><div><h2 id="call-title" tabIndex={-1}>{active.title}</h2><p className="detail-subtitle">{active.topic}</p></div></div>
            <div className="call-information"><span className="manager-avatar" aria-hidden="true">{initials(active.manager)}</span><strong>{active.manager}</strong><span className="metadata-separator" /><span className="specialty-tag">{active.specialty}</span><span className="location"><MapPin size={13} />{active.location}</span></div>
          </div>

          <div className="detail-body">
            <section className="recording" aria-label="Optional call recording">
              <div className="recording-heading"><span><Headphones size={15} />Call recording</span><span>Optional listening</span></div>
              <div className={`audio-player ${playing ? 'is-playing' : ''}`}>
                <audio
                  key={active.id} ref={audio} src={`${import.meta.env.BASE_URL}${active.audio.replace(/^\//, '')}`} preload="metadata"
                  onLoadedMetadata={() => {
                    if (!audio.current) return;
                    audio.current.playbackRate = speed;
                    audio.current.muted = muted;
                    const resume = current.position < active.duration - 0.5 ? current.position : 0;
                    audio.current.currentTime = resume;
                    setTime(resume);
                  }}
                  onPlay={() => setPlaying(true)}
                  onPause={event => { recordPlayback(event.currentTarget); setPlaying(false); }}
                  onEnded={event => { recordPlayback(event.currentTarget); setPlaying(false); }}
                  onSeeked={event => recordPlayback(event.currentTarget)}
                  onTimeUpdate={event => recordPlayback(event.currentTarget)}
                  onError={() => { setAudioError(true); setPlaying(false); }}
                />
                <div className="waveform-row">
                  <button className="play-button" aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={togglePlay}>{playing ? <Pause size={14} fill="currentColor" strokeWidth={1.5} /> : <Play size={14} fill="currentColor" strokeWidth={1.5} className="play-icon" />}</button>
                  <span className="player-timestamp" aria-label="Elapsed time">{formatTime(time)}</span>
                  <div className="waveform"><svg viewBox="0 0 576 32" preserveAspectRatio="none" aria-hidden="true">{Array.from({ length: 96 }, (_, i) => { const height = 4 + Math.abs(Math.sin(i * 2.37 + index) * Math.cos(i * 0.41)) * 24; return <rect key={i} className={i / 96 < time / active.duration ? 'is-played' : ''} x={i * 6 + 1} y={(32 - height) / 2} width="2.5" height={height} rx="1.25" />; })}</svg><input type="range" aria-label="Seek recording" aria-valuetext={`${formatTime(time)} of ${formatTime(active.duration)}`} min={0} max={active.duration} step={0.1} value={time} onChange={e => seek(Number(e.target.value))} /></div>
                  <span className="player-timestamp player-duration" aria-label="Recording duration">{formatTime(active.duration)}</span>
                  <button className="stop-button" aria-label="Stop playback and return to start" title="Stop and return to start" onClick={() => { audio.current?.pause(); seek(0); }}><Square size={12} fill="currentColor" strokeWidth={1.6} /></button>
                </div>
              </div>
              <div className="player-controls"><div className="transport"><button aria-label="Rewind 10 seconds" onClick={() => seek(time - 10)}><RotateCcw size={16} /><span>10</span></button><button aria-label="Forward 10 seconds" onClick={() => seek(time + 10)}><RotateCw size={16} /><span>10</span></button></div><div className="audio-options"><label className="speed-select"><select aria-label="Playback speed" value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); if (audio.current) { recordPlayback(audio.current); audio.current.playbackRate = value; } }}><option value="0.75">0.75×</option><option value="1">1× speed</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><ChevronDown size={11} /></label><span className="control-divider" /><button className="volume-button" aria-label={muted ? 'Unmute recording' : 'Mute recording'} aria-pressed={muted} onClick={() => { setMuted(!muted); if (audio.current) audio.current.muted = !muted; }}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button></div></div>
              {audioError ? <div className="audio-error" role="alert"><Info size={14} /><span>The recording couldn’t play.</span><button onClick={() => { setAudioError(false); audio.current?.load(); }}>Reload audio</button></div> : <p className="audio-footnote">Sample recording · Fictional conversation</p>}
            </section>

            <section id="quiz-panel" aria-labelledby="questionnaire-title">
              <div className="questionnaire-heading">
                <div><h3 id="questionnaire-title" ref={quizHeading} tabIndex={-1}>Questionnaire</h3><p>{active.questions.length} questions · 1 written takeaway<span className="questionnaire-requirement">Get {Math.ceil(active.questions.length * 2 / 3)} of {active.questions.length} answers right to complete this demo.</span></p></div>
                <button type="button" className="quiz-expand-all" onClick={() => setExpandedTasks(expandedTasks.length === totalTasks ? [] : Array.from({ length: totalTasks }, (_, i) => i))}>{expandedTasks.length === totalTasks ? 'Collapse all' : 'Expand all'}<ChevronDown size={13} className={expandedTasks.length === totalTasks ? 'is-expanded' : ''} /></button>
              </div>
              <form onSubmit={submitQuiz}>
                {submitted && <div className={`quiz-result review-summary ${result.passed ? 'passed' : 'retry'}`} role="status">
                  <ReviewRing label={result.score} progress={result.score} />
                  <div className="review-summary-copy"><strong>{result.passed ? 'Demo complete' : 'Review your answers'}</strong><p>{result.correct} of {result.total} correct · {result.score}% score</p><span>{result.passed ? 'Open any answer to revisit the feedback.' : 'Open the marked answers, then try again.'}</span></div>
                  <span className={`review-badge ${result.passed ? 'is-correct' : result.correct === 0 ? 'needs-review' : 'needs-practice'}`}>{result.passed ? 'Passed' : 'Try again'}</span>
                </div>}
                <div className={`questionnaire-tasks ${submitted ? 'answer-review-list' : ''}`}>
                  <div className="task-list-heading">
                    <span aria-live="polite">{submitted ? 'Questionnaire submitted' : answered === totalTasks ? 'Ready to submit' : `${totalTasks - answered} ${totalTasks - answered === 1 ? 'task' : 'tasks'} remaining`}</span>
                    <span>{answered} / {totalTasks} answered</span>
                  </div>
                  {!submitted && <div className="questionnaire-progress" role="progressbar" aria-label="Questionnaire answers completed" aria-valuemin={0} aria-valuemax={totalTasks} aria-valuenow={answered}>{Array.from({ length: totalTasks }, (_, i) => <span key={i} className={(i < active.questions.length ? current.answers[i] >= 0 : Boolean(current.reflection.trim())) ? 'is-complete' : ''} />)}</div>}
                  {active.questions.map((question, questionIndex) => {
                    const isAnswered = current.answers[questionIndex] >= 0;
                    const isCorrect = current.answers[questionIndex] === question.correct;
                    return <QuestionnaireTask key={`${activeId}-${questionIndex}`} id={`quiz-task-${questionIndex}`} number={questionIndex + 1} title={`Question ${questionIndex + 1}`} description={question.prompt}
                      status={submitted ? isCorrect ? 'correct' : 'review' : isAnswered ? 'answered' : 'todo'}
                      reviewMode={submitted} meta={submitted ? isCorrect ? 'Correct' : 'Review' : isAnswered ? 'Answered' : 'Choose one answer'}
                      expanded={expandedTasks.includes(questionIndex)} onToggle={() => toggleQuizTask(questionIndex)}>
                      <fieldset className="question" aria-label={question.prompt}>
                        <div className="answer-options">{question.options.map((option, optionIndex) => {
                          const chosen = current.answers[questionIndex] === optionIndex;
                          const correct = question.correct === optionIndex;
                          return <label key={option} className={`answer-option ${chosen ? 'chosen' : ''} ${submitted && correct ? 'correct' : ''} ${submitted && chosen && !correct ? 'incorrect' : ''}`}>
                            <input type="radio" name={`question-${activeId}-${questionIndex}`} value={optionIndex} checked={chosen} disabled={submitted} onChange={() => { const answers = active.questions.map((_, i) => current.answers[i] ?? -1); answers[questionIndex] = optionIndex; update(activeId, { answers }); setFormError(''); }} />
                            <span className="answer-letter" aria-hidden="true">{String.fromCharCode(65 + optionIndex)}</span><span className="answer-text">{option}</span><span className="custom-radio" aria-hidden="true">{submitted && correct ? <Check size={11} /> : submitted && chosen && !correct ? <X size={11} /> : <i />}</span>
                          </label>;
                        })}</div>
                        {submitted && <p className={`answer-feedback ${isCorrect ? 'right' : 'wrong'}`}><Info size={13} />{question.explanation}</p>}
                      </fieldset>
                      {!submitted && <button type="button" className="task-next" onClick={() => { setExpandedTasks([questionIndex + 1]); requestAnimationFrame(() => document.getElementById(`quiz-task-${questionIndex + 1}-heading`)?.focus()); }}>{questionIndex === active.questions.length - 1 ? 'Add your takeaway' : 'Next question'}<ArrowRight size={12} /></button>}
                    </QuestionnaireTask>;
                  })}
                  <QuestionnaireTask id={`quiz-task-${active.questions.length}`} number={totalTasks} title="Your takeaway" description={submitted ? 'Your written reflection · Not scored' : active.reflection}
                    reviewMode={submitted} status={current.reflection.trim() ? 'answered' : 'todo'} meta={submitted ? 'Saved' : current.reflection.trim() ? 'Added · Not scored' : 'Required · Not scored'}
                    expanded={expandedTasks.includes(active.questions.length)} onToggle={() => toggleQuizTask(active.questions.length)}>
                    <div className="reflection-section">
                      <label htmlFor="takeaway">What will you try in your next conversation?</label>
                      <textarea id="takeaway" aria-describedby={`quiz-task-${active.questions.length}-heading`} value={current.reflection} onChange={e => { update(activeId, { reflection: e.target.value }); setFormError(''); }} placeholder="In my next conversation, I would…" maxLength={5000} readOnly={submitted} rows={4} />
                      <div className="reflection-caption"><span>For your own reflection</span><span>{current.reflection.length} / 5,000</span></div>
                    </div>
                  </QuestionnaireTask>
                </div>
                <p className="questionnaire-save-note"><CheckCheck size={13} />{saveError ? 'Available for this session' : 'Your answers are saved as you go'}</p>
                {formError && <p className="form-error" role="alert"><Info size={15} />{formError}</p>}
                <div className="quiz-actions">{submitted ? <><button type="button" className="text-button" onClick={retryQuiz}><RotateCcw size={14} />{result.score < 100 ? 'Retry missed questions' : 'Review answers again'}</button>{result.passed && <button type="button" className="button button-dark" onClick={nextCall}>{completed === calls.length ? 'Explore the calls' : 'Continue to next demo'}<ArrowRight size={15} /></button>}</> : <><span>{answered === totalTasks ? 'All set. Submit when you’re ready.' : `${answered} of ${totalTasks} answered`}</span><button type="submit" className="button button-dark">Submit questionnaire<ArrowRight size={15} /></button></>}</div>
              </form>
            </section>
          </div>
          <footer className="detail-footer"><div className="previous-next"><button aria-label="Previous demo" disabled={index === 0} onClick={() => selectCall(calls[index - 1].id)}><ChevronLeft size={15} /><span>Previous</span></button><span>{index + 1} / {calls.length}</span><button aria-label="Next demo" disabled={index === calls.length - 1} onClick={() => selectCall(calls[index + 1].id)}><span>Next demo</span><ChevronRight size={15} /></button></div></footer>
        </section>
      </div>
      <footer className="page-footer"><span><Target size={14} />Better conversations start with practice.</span><span><span className="local-save-dot" />{saveError ? 'Browser storage unavailable. Keep this tab open to preserve progress.' : 'Progress saved on this browser'}</span></footer>
    </main>

  </>;
}
