import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, Clock3, Headphones, Info, MapPin, Pause, Play, RotateCcw, RotateCw, Search, Sparkles, Star, Target, Trophy, Volume2, VolumeX, X } from 'lucide-react';
import callData from './calls.json';
import { gradeQuiz, listenedSeconds, mergePlayedRanges, sanitizeProgress } from './progress.mjs';

type Call = (typeof callData)[number];
type Progress = { coverage: number[][]; position: number; answers: number[]; reflection: string; confidence: number; bestScore?: number; completed: boolean; submitted?: boolean };
type Saved = { activeId?: string; progress: Record<string, Progress> };
type Filter = 'all' | 'todo' | 'completed';
const calls = callData as Call[];
const EMPTY: Progress = { coverage: [], position: 0, answers: [], reflection: '', confidence: 0, completed: false };
const STORAGE_KEY = 'targetone-training-v1';
const managers = [...new Set(calls.map(c => c.manager))];
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`;
const managerClass = (manager: string) => manager.startsWith('Zee') ? 'zee' : manager.startsWith('Edrin') ? 'edrin' : 'will';

function StatBars({ value, total, label, segments = 40, gradient = false }: { value: number; total: number; label: string; segments?: number; gradient?: boolean }) {
  const filled = Math.round(value / total * segments);
  return <div className="stat-bars" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={value}>
    {Array.from({ length: segments }, (_, i) => <span key={i} className={i < filled ? 'is-filled' : ''} style={gradient && i < filled ? { backgroundColor: `hsl(${Math.round(i / Math.max(1, filled - 1) * 36)} 95% 58%)` } : undefined} />)}
  </div>;
}

function ScoreSparkline({ values }: { values: (number | undefined)[] }) {
  const point = (value: number, index: number) => ({ x: 4 + index / (values.length - 1) * 312, y: 34 - value / 100 * 28 });
  const path = values.map((value, i) => {
    if (value === undefined) return '';
    const { x, y } = point(value, i);
    return `${i > 0 && values[i - 1] !== undefined ? 'L' : 'M'}${x},${y}`;
  }).join(' ');
  const description = values.flatMap((value, i) => value === undefined ? [] : [`Demo ${i + 1}: ${value}%`]).join(', ');
  return <svg className="stat-sparkline" viewBox="0 0 320 40" preserveAspectRatio="none" role="img" aria-label={description ? `Best quiz scores in demo order. ${description}` : 'No quiz scores yet'}>
    <path className="stat-chart-baseline" d="M4,35 H316" />
    {values.map((_, i) => <path className="stat-chart-tick" key={i} d={`M${point(0, i).x},36 v3`} />)}
    <path className="stat-chart-line" d={path} />
    {values.map((value, i) => value === undefined ? null : <circle className="stat-chart-point" key={i} cx={point(value, i).x} cy={point(value, i).y} r="2.5" />)}
  </svg>;
}

function ScoreGauge({ score, demo }: { score?: number; demo: number }) {
  const gradientId = useId();
  const arc = 'M46.16 119.84 A62 62 0 1 1 133.84 119.84';
  const angle = (135 + (score ?? 0) * 2.7) * Math.PI / 180;
  const status = score === undefined ? 'unscored' : score >= 67 ? 'passed' : 'retry';
  return <div className={`score-gauge ${status}`} role="img" aria-label={score === undefined ? `Demo ${demo} has no quiz score yet` : `Best quiz score for demo ${demo}: ${score} out of 100. ${status === 'passed' ? 'Passed' : 'Try again'}.`}>
    <svg viewBox="0 0 180 130" aria-hidden="true">
      <defs><linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stopColor="#ffa928" /><stop offset="55%" stopColor="#ff713d" /><stop offset="100%" stopColor="#f44f82" /></linearGradient></defs>
      <path className="score-gauge-halo" d={arc} />
      <path className="score-gauge-track" d={arc} />
      <path className="score-gauge-fill" d={arc} pathLength="100" stroke={`url(#${gradientId})`} strokeDasharray={`${score ?? 0} 100`} />
      {score !== undefined && <circle className="score-gauge-marker" cx={90 + 62 * Math.cos(angle)} cy={76 + 62 * Math.sin(angle)} r="4" />}
    </svg>
    <div className="score-gauge-readout" aria-hidden="true"><span className="score-gauge-number">{score ?? '—'}</span><span className="score-gauge-caption">Best · Demo {String(demo).padStart(2, '0')}</span></div>
    <span className="score-gauge-status" aria-hidden="true">{status === 'unscored' ? 'Not scored' : status === 'passed' ? 'Passed' : 'Try again'}</span>
  </div>;
}

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
  const [tab, setTab] = useState<'listen' | 'quiz'>('quiz');
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
  const demoList = useRef<HTMLOListElement>(null);
  const activeDemo = useRef<HTMLLIElement>(null);
  const guide = useRef<HTMLDialogElement>(null);
  const quizHeading = useRef<HTMLHeadingElement>(null);
  const active = calls.find(c => c.id === activeId)!;
  const index = calls.findIndex(c => c.id === activeId);
  const current = progress[activeId] || EMPTY;
  const coveragePercent = Math.min(100, Math.floor(listenedSeconds(current.coverage) / active.duration * 100));
  const completed = calls.filter(c => progress[c.id]?.completed).length;
  const scores = calls.map(c => progress[c.id]?.bestScore).filter((s): s is number => s !== undefined);
  const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const totalQuestions = calls.reduce((total, call) => total + call.questions.length, 0);
  const answeredQuestions = calls.reduce((total, call) => total + call.questions.filter((_, i) => (progress[call.id]?.answers[i] ?? -1) >= 0).length, 0);
  const submitted = Boolean(current.submitted);
  const result = gradeQuiz(active.questions, current.answers);
  const answered = active.questions.filter((_, i) => current.answers[i] >= 0).length + (current.reflection.trim() ? 1 : 0);
  const totalTasks = active.questions.length + 1;

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeId, progress })); setSaveError(false); }
    catch { setSaveError(true); }
  }, [activeId, progress]);

  useEffect(() => {
    const list = demoList.current;
    const item = activeDemo.current;
    if (!list || !item) return;
    const listBounds = list.getBoundingClientRect();
    const itemBounds = item.getBoundingClientRect();
    // Reveal the selected row inside the library without moving the page.
    if (itemBounds.top < listBounds.top) list.scrollTop += itemBounds.top - listBounds.top - 6;
    else if (itemBounds.bottom > listBounds.bottom) list.scrollTop += itemBounds.bottom - listBounds.bottom + 6;
  }, [activeId, filter, manager, query]);

  function update(id: string, patch: Partial<Progress>) {
    setProgress(previous => ({ ...previous, [id]: { ...EMPTY, ...previous[id], ...patch } }));
  }

  function selectCall(id: string) {
    setTab('quiz');
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

  function openQuiz() {
    setTab('quiz');
    requestAnimationFrame(() => {
      quizHeading.current?.focus({ preventScroll: true });
      quizHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function startTraining() {
    const next = calls.find(call => !progress[call.id]?.completed) || calls[0];
    selectCall(next.id);
    openQuiz();
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
      <a className="brand" href="#main" aria-label="TargetOne home"><Target size={20} strokeWidth={1.8} /><span>Target<span className="brand-one">One</span></span></a>
      <nav className="workspace-nav" aria-label="Workspace">
        {['Routes', 'Users', 'AutoDialer', 'Analytics', 'Pipeline', 'Followup', 'Call History'].map(label => <span className="workspace-placeholder" key={label}>{label}</span>)}
        <a className="nav-active" href="#main" aria-current="page">Training Calls</a>
        <span className="workspace-placeholder secondary-nav">Customer Service</span>
      </nav>
      <div className="header-account"><span className="workspace-status"><i />Florida<ChevronDown size={11} /></span><span className="header-divider" /><span className="user-avatar">AG</span><span className="user-name">Adnan Goda</span></div>
    </header>

    <main id="main" className="page-shell">
      <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={12} /><span>Learning & development</span></div>
      <section className="page-heading" aria-labelledby="page-title">
        <div><div className="heading-title"><h1 id="page-title">Training Calls</h1><span className="course-badge">SALES ONBOARDING</span></div><p>Listen to the experts. Find your approach. Make your next call count.</p></div>
        <div className="heading-actions"><button className="button button-dark start-training-button" onClick={startTraining}><span className="start-play-icon" aria-hidden="true"><Play size={7} fill="currentColor" strokeWidth={0} /></span>{completed === 10 ? 'Revisit training' : answeredQuestions > 0 ? 'Continue training' : 'Start training'}</button></div>
      </section>


      <section className="training-stats" aria-label="Your training progress" tabIndex={0}>
        <article className="stat-card stat-completion" aria-labelledby="stat-completion-label">
          <div className="stat-card-body">
            <div className="stat-progress-heading"><strong>{completed === calls.length ? 'All complete!' : completed >= calls.length * .7 ? 'Almost there!' : completed > 0 ? 'Keep going!' : 'Get started'}</strong><span className="stat-percent-badge">{Math.round(completed / calls.length * 100)}%</span></div>
            <p className="stat-progress-copy">{completed} of {calls.length} demos complete.<br />{completed === calls.length ? 'Revisit any call to practice.' : completed > 0 ? 'Finish the rest at your own pace.' : 'Start with your first demo.'}</p>
            <StatBars value={completed} total={calls.length} label="Course completion" gradient />
          </div>
          <h2 className="stat-label" id="stat-completion-label"><CircleCheck size={15} />Demos completed</h2>
        </article>
        <article className="stat-card stat-scores" aria-labelledby="stat-scores-label">
          <div className="stat-card-body">
            <p className={`stat-value ${average === null ? 'is-empty' : ''}`}>{average === null ? '—' : <>{average}<span>%</span></>}</p>
            <p className="stat-context">{scores.length ? `Best scores across ${scores.length} ${scores.length === 1 ? 'demo' : 'demos'}` : 'Submit a quiz to see your score'}</p>
            <ScoreSparkline values={calls.map(call => progress[call.id]?.bestScore)} />
          </div>
          <h2 className="stat-label" id="stat-scores-label"><Target size={15} />Quiz average</h2>
        </article>
        <article className="stat-card stat-answers" aria-labelledby="stat-answers-label">
          <div className="stat-card-body">
            <p className="stat-value">{answeredQuestions}<span> / {totalQuestions}</span></p>
            <p className="stat-context"><span className="stat-highlight">{totalQuestions - answeredQuestions}</span>{totalQuestions - answeredQuestions === 1 ? 'question remaining' : 'questions remaining'}</p>
            <StatBars value={answeredQuestions} total={totalQuestions} label="Questions answered" segments={totalQuestions} />
          </div>
          <h2 className="stat-label" id="stat-answers-label"><CheckCheck size={15} />Questions answered</h2>
        </article>
        <article className="stat-card stat-demo-score" aria-labelledby="stat-demo-score-label">
          <div className="stat-card-body"><ScoreGauge score={current.bestScore} demo={index + 1} /></div>
          <h2 className="stat-label" id="stat-demo-score-label"><Trophy size={15} />Demo score</h2>
        </article>
      </section>
      {completed === calls.length && <div className="course-complete" role="status"><Trophy size={24} /><div><strong>All demos completed</strong><p>Revisit any call or review your answers whenever you need a refresher.</p></div></div>}

      <div className="learning-strip">
        <span className="learning-note"><span className="learning-icon"><Sparkles size={16} strokeWidth={1.5} /></span>A little listening. A lot of learning.</span>
        <div className="learning-extras">
          <div className="learning-steps"><span><i>1</i>Listen if helpful</span><ChevronRight size={12} /><span><i>2</i>Complete the questionnaire</span><ChevronRight size={12} /><span><i>3</i>Build your confidence</span></div>
          <button className="learning-guide" aria-label="How training works" title="How training works" onClick={() => guide.current?.showModal()}><Sparkles size={14} strokeWidth={1.5} /></button>
        </div>
      </div>

      <div className="learning-layout">
        <aside className="library" aria-label="Training call library">
          <div className="library-section-heading"><h2>Call library</h2><span>{calls.length} demos</span></div>
          <div className="library-tools">
            <label className="search-box">
              <Search size={16} />
              <input aria-label="Search training calls" placeholder="Search target, manager or topic…" value={query} onChange={e => setQuery(e.target.value)} />
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

          <div className="call-list-panel">
          <p className="library-queue-heading" role="status">{completed === calls.length ? <CircleCheck size={14} /> : <CircleDashed size={14} />}<span>{completed === calls.length ? 'All demos completed' : `${calls.length - completed} ${calls.length - completed === 1 ? 'demo' : 'demos'} remaining`}</span></p>
          <ol className="call-list" aria-label="Calls" ref={demoList}>
            {visibleCalls.length ? visibleCalls.map(call => {
              const p = progress[call.id] || EMPTY;
              const selected = call.id === activeId;
              const responses = call.questions.filter((_, i) => p.answers[i] >= 0).length + Number(Boolean(p.reflection.trim()));
              const responseTotal = call.questions.length + 1;
              const state = p.completed ? 'Completed' : p.submitted ? 'Review answers' : responses === responseTotal ? 'Ready to submit' : responses > 0 ? `${responses} of ${responseTotal} answered` : '';
              return <li className={`call-item ${selected ? 'active' : ''} ${p.completed ? 'is-complete' : ''}`} key={call.id} ref={selected ? activeDemo : null}>
                <button className="call-select" aria-current={selected ? 'true' : undefined} onClick={() => selectCall(call.id)}>
                  <span className={`call-step ${selected || responses > 0 ? 'has-progress' : ''} ${p.completed ? 'is-complete' : ''}`} aria-hidden="true">
                    <svg viewBox="0 0 24 24"><circle className="call-step-track" cx="12" cy="12" r="9" /><circle className="call-step-fill" cx="12" cy="12" r="9" pathLength="100" strokeDasharray={`${p.completed ? 100 : responses / responseTotal * 100} 100`} /></svg>
                    <span className="call-number">{calls.indexOf(call) + 1}</span>{p.completed && <Check size={11} strokeWidth={2.2} />}
                  </span>
                  <span className="call-row-copy">
                    <span className="call-item-title"><strong>{call.title}</strong><span className="call-duration"><Clock3 size={11} />{formatDuration(call.duration)}</span></span>
                    <span className="call-description">{call.topic}</span>
                    {(selected || state) && <span className="call-row-status">{selected && <span className="call-current-label">Current demo</span>}{state && <span className={`call-row-state ${p.completed ? 'complete' : p.submitted ? 'needs-review' : ''}`}>{state}</span>}</span>}
                  </span>
                  <ChevronRight size={14} className="call-row-chevron" aria-hidden="true" />
                </button>
              </li>;
            }) : <li className="empty-state"><Search size={25} /><strong>No calls found</strong><p>{query || manager !== 'all' ? 'Try a different search or filter.' : filter === 'completed' ? 'Your completed demos will appear here.' : 'All demos are complete. Revisit any call to practice.'}</p><button className="text-button" onClick={() => { setQuery(''); setFilter('all'); setManager('all'); }}>Show all calls<ArrowRight size={13} /></button></li>}
          </ol>
          </div>
        </aside>

        <section className="call-detail" ref={detail} aria-label="Selected training call">
          <div className="detail-header">
            <div className="detail-kicker"><span>Demo {String(index + 1).padStart(2, '0')} <span className="muted">/ {calls.length}</span></span><span className="kicker-dot">·</span><span className="lesson-level">{active.level}</span><span className={`lesson-status ${current.completed ? 'done' : ''}`}>{current.completed ? <><CircleCheck size={12} />Completed</> : answered > 0 ? 'In progress' : 'Not started'}</span></div>
            <div className="detail-title-row"><div><h2 id="call-title" tabIndex={-1}>{active.title}</h2><p className="detail-subtitle">{active.topic}</p></div><div className="rating-block" title="Illustrative manager rating for this sample call"><div className="rating-score"><Star size={15} strokeWidth={1.6} /><strong>{active.rating.toFixed(1)}</strong><span>/ 10</span></div><span>Manager rating</span></div></div>
            <div className="call-information"><span className={`manager-avatar ${managerClass(active.manager)}`}>{active.manager[0]}</span><strong>{active.manager}</strong><span className="metadata-separator" /><span className="specialty-tag">{active.specialty}</span><span className="location"><MapPin size={12} />{active.location}</span></div>
          </div>

          <div className="lesson-tabs" role="tablist" aria-label="Demo learning steps">
            <button id="listen-tab" role="tab" aria-selected={tab === 'listen'} aria-controls="listen-panel" tabIndex={tab === 'listen' ? 0 : -1} className={tab === 'listen' ? 'active' : ''} onClick={() => setTab('listen')} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setTab('quiz'); document.getElementById('quiz-tab')?.focus(); } }}>
              <span className={`step-number ${coveragePercent >= 100 ? 'done' : ''}`}>{coveragePercent >= 100 ? <Check size={12} /> : '1'}</span>Listen to the call
            </button>
            <button id="quiz-tab" role="tab" aria-selected={tab === 'quiz'} aria-controls="quiz-panel" tabIndex={tab === 'quiz' ? 0 : -1} className={tab === 'quiz' ? 'active' : ''} onClick={openQuiz} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setTab('listen'); document.getElementById('listen-tab')?.focus(); } }}>
              <span className={`step-number ${current.completed ? 'done' : ''}`}>{current.completed ? <Check size={12} /> : '2'}</span>Questionnaire
              {!current.completed && <span className="tab-ready">Ready</span>}
            </button>
          </div>

          <div className="detail-body">
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
                <div className="waveform"><svg viewBox="0 0 576 32" preserveAspectRatio="none" aria-hidden="true">{Array.from({ length: 96 }, (_, i) => { const height = 4 + Math.abs(Math.sin(i * 2.37 + index) * Math.cos(i * 0.41)) * 24; return <rect key={i} x={i * 6 + 1} y={(32 - height) / 2} width="2.5" height={height} rx="1.25" fill={i / 96 < time / active.duration ? '#555557' : '#c8c8ca'} />; })}</svg><input type="range" aria-label="Seek recording" aria-valuetext={`${formatTime(time)} of ${formatTime(active.duration)}`} min={0} max={active.duration} step={0.1} value={time} onChange={e => seek(Number(e.target.value))} /></div>
                <span className="player-timestamp player-duration" aria-label="Recording duration">{formatTime(active.duration)}</span>
                <button className="stop-button" aria-label="Stop playback and return to start" title="Stop and return to start" onClick={() => { audio.current?.pause(); seek(0); }}><X size={15} strokeWidth={1.6} /></button>
              </div>
            </div>
            <div className="player-controls"><div className="transport"><button aria-label="Rewind 10 seconds" onClick={() => seek(time - 10)}><RotateCcw size={16} /><span>10</span></button><button aria-label="Forward 10 seconds" onClick={() => seek(time + 10)}><RotateCw size={16} /><span>10</span></button></div><div className="audio-options"><label className="speed-select"><select aria-label="Playback speed" value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); if (audio.current) { recordPlayback(audio.current); audio.current.playbackRate = value; } }}><option value="0.75">0.75×</option><option value="1">1× speed</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><ChevronDown size={11} /></label><span className="control-divider" /><button className="volume-button" aria-label={muted ? 'Unmute recording' : 'Mute recording'} aria-pressed={muted} onClick={() => { setMuted(!muted); if (audio.current) audio.current.muted = !muted; }}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button></div></div>
            {audioError ? <div className="audio-error" role="alert"><Info size={14} /><span>The recording couldn’t play.</span><button onClick={() => { setAudioError(false); audio.current?.load(); }}>Reload audio</button></div> : <div className="audio-footnote"><span><Info size={11} />Sample recording · Fictional conversation</span><span>{coveragePercent}% listened · Optional</span></div>}

            <section id="listen-panel" role="tabpanel" aria-labelledby="listen-tab" hidden={tab !== 'listen'}>
              <section className="lesson-action ready" aria-label="Next training step">
                <div className="lesson-action-copy">
                  <span className="lesson-action-label">{current.completed ? 'DEMO COMPLETE' : 'OPTIONAL · CALL RECORDING'}</span>
                  <h3>{current.completed ? 'Ready for your next call' : 'Listen at your own pace'}</h3>
                  <p>{current.completed ? `Best score: ${current.bestScore}%. Your answers and takeaway are saved.` : 'Play any part of the recording for context. Your questionnaire is ready whenever you are.'}</p>
                </div>
                <div className="lesson-action-buttons">
                  {current.completed ? <><button className="button button-dark" onClick={nextCall}>Next demo<ArrowRight size={14} /></button><button className="text-button" onClick={openQuiz}>Review answers</button></> : <button className="button button-dark" onClick={openQuiz}>{submitted ? 'Review answers' : 'Take questionnaire'}<ArrowRight size={14} /></button>}
                </div>
              </section>
            </section>

            <section id="quiz-panel" role="tabpanel" aria-labelledby="quiz-tab" hidden={tab !== 'quiz'}>
              <div className="questionnaire-heading">
                <div><span className="questionnaire-eyebrow">CALL REVIEW</span><h3 id="questionnaire-title" ref={quizHeading} tabIndex={-1}>Questionnaire</h3><p>{active.questions.length} questions and a written takeaway.<br />Answer at least {Math.ceil(active.questions.length * 2 / 3)} questions correctly to complete this demo.</p></div>
                <button type="button" className="quiz-expand-all" onClick={() => setExpandedTasks(expandedTasks.length === totalTasks ? [] : Array.from({ length: totalTasks }, (_, i) => i))}>{expandedTasks.length === totalTasks ? 'Collapse all' : 'Expand all'}<ChevronDown size={13} className={expandedTasks.length === totalTasks ? 'is-expanded' : ''} /></button>
              </div>
              <form onSubmit={submitQuiz}>
                {submitted && <div className={`quiz-result review-summary ${result.passed ? 'passed' : 'retry'}`} role="status">
                  <ReviewRing label={result.score} progress={result.score} />
                  <div className="review-summary-copy"><strong>{result.passed ? 'Demo complete' : 'Review your answers'}</strong><p>{result.correct} of {result.total} correct · {result.score}% score</p><span>{result.passed ? 'Open any answer to revisit the feedback.' : 'Open the marked answers, then try again.'}</span></div>
                  {result.passed ? <span className="review-badge is-correct">Passed</span> : <button type="button" className="review-retry-button" onClick={retryQuiz}><RotateCcw size={14} aria-hidden="true" />Retry missed questions</button>}
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
                <details className="confidence-details" key={`confidence-${activeId}`}>
                  <summary>How confident do you feel?<span>Optional<ChevronDown size={14} /></span></summary>
                  <section className="confidence-section"><div><strong>How confident would you feel handling this call?</strong><span>Just for you · Not scored</span></div><div className="confidence-options">{[1, 2, 3, 4, 5].map(value => <button type="button" key={value} aria-label={`Confidence ${value} of 5`} aria-pressed={current.confidence === value} className={current.confidence === value ? 'selected' : ''} onClick={() => update(activeId, { confidence: value })}>{value}</button>)}</div><div className="confidence-labels"><span>Still practicing</span><span>Ready to try</span></div></section>
                </details>
                {formError && <p className="form-error" role="alert"><Info size={15} />{formError}</p>}
                {(!submitted || result.passed) && <div className="quiz-actions">{submitted ? <><button type="button" className="text-button" onClick={retryQuiz}><RotateCcw size={14} />{result.score < 100 ? 'Retry missed questions' : 'Review answers again'}</button><button type="button" className="button button-dark" onClick={nextCall}>{completed === calls.length ? 'Explore the calls' : 'Continue to next demo'}<ArrowRight size={15} /></button></> : <><span>{answered === totalTasks ? 'All set. Submit when you’re ready.' : `${answered} of ${totalTasks} answered`}</span><button type="submit" className="button button-dark">Submit questionnaire<ArrowRight size={15} /></button></>}</div>}
              </form>
            </section>
          </div>
          <footer className="detail-footer"><div className="previous-next"><button aria-label="Previous demo" disabled={index === 0} onClick={() => selectCall(calls[index - 1].id)}><ChevronLeft size={15} /><span>Previous</span></button><span>{index + 1} / {calls.length}</span><button aria-label="Next demo" disabled={index === calls.length - 1} onClick={() => selectCall(calls[index + 1].id)}><span>Next demo</span><ChevronRight size={15} /></button></div></footer>
        </section>
      </div>
      <footer className="page-footer"><span><Target size={14} />Better conversations start with practice.</span><span><span className="local-save-dot" />{saveError ? 'Browser storage unavailable. Keep this tab open to preserve progress.' : 'Progress saved on this browser'}</span></footer>
    </main>

    <dialog aria-labelledby="course-guide-title" className="guide-dialog" ref={guide} onClick={event => { if (event.target === event.currentTarget) guide.current?.close(); }}><button className="dialog-close" aria-label="Close course guide" onClick={() => guide.current?.close()}><X size={20} /></button><span className="guide-illustration"><Headphones size={32} /></span><span className="section-eyebrow">YOUR FIRST 10 CONVERSATIONS</span><h2 id="course-guide-title">Listen. Reflect. Get ready.</h2><p className="guide-intro">A little practice before the real thing. Work through the demos at your own pace.</p><ol><li><span>01</span><div><strong>Listen with intention</strong><p>Play each demo and notice the techniques the manager uses. Listening is optional; the questionnaire is available from the start.</p></div></li><li><span>02</span><div><strong>Make the learning stick</strong><p>Answer three questions and write a takeaway. Get at least two answers right to complete the demo. You can retry anytime.</p></div></li><li><span>03</span><div><strong>Build your own approach</strong><p>Complete all 10 demos and revisit any call for more practice. Your progress and notes stay in this browser.</p></div></li></ol><div className="guide-note"><Info size={16} /><span>This preview uses fictional, voice-generated sample conversations. Replace them with your team’s recordings for live onboarding.</span></div><button className="button button-dark" onClick={() => { guide.current?.close(); startTraining(); }}>Let’s get started<ArrowRight size={15} /></button></dialog>
  </>;
}
