import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, AudioLines, Bookmark, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleHelp, ClipboardCheck, Clock3, Headphones, Info, LockKeyhole, MapPin, Pause, Play, RotateCcw, RotateCw, Search, SlidersHorizontal, Sparkles, Star, Target, Timer, TrendingUp, Trophy, Volume2, VolumeX, X } from 'lucide-react';
import callData from './calls.json';
import { canTakeQuiz, firstUnplayedPosition, gradeQuiz, listenedSeconds, mergePlayedRanges, sanitizeProgress } from './progress.mjs';

type Call = (typeof callData)[number] & { duration: number; audio: string; transcript: { speaker: string; text: string; at: number }[] };
type Progress = { coverage: number[][]; bookmark: boolean; position: number; checked: number[]; answers: number[]; reflection: string; confidence: number; bestScore?: number; completed: boolean; submitted?: boolean };
type Saved = { activeId?: string; progress: Record<string, Progress> };
type Filter = 'all' | 'todo' | 'completed' | 'saved';
const calls = callData as Call[];
const EMPTY: Progress = { coverage: [], bookmark: false, position: 0, checked: [], answers: [], reflection: '', confidence: 0, completed: false };
const STORAGE_KEY = 'targetone-training-v1';
const managers = [...new Set(calls.map(c => c.manager))];
const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, '0')}s`;
const managerClass = (manager: string) => manager.startsWith('Zee') ? 'zee' : manager.startsWith('Edrin') ? 'edrin' : 'will';

function StatSparkline({ values, color, label, maximum }: { values: number[]; color: string; label: string; maximum?: number }) {
  const gradientId = useId();
  const points = values.length > 1 ? values : [values[0] || 0, values[0] || 0];
  const ceiling = maximum || Math.max(1, ...points);
  const line = points.map((value, i) => `${i ? 'L' : 'M'}${2 + i / (points.length - 1) * 96},${62 - value / ceiling * 54}`).join(' ');

  return <div className="stat-chart" title={label}>
    <svg viewBox="0 0 100 66" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".15" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L98,66 L2,66 Z`} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
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
  const [sort, setSort] = useState('rating');
  const [minRating, setMinRating] = useState(0);
  const [minDuration, setMinDuration] = useState(0);
  const [tab, setTab] = useState<'listen' | 'quiz'>('listen');
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [playbackEnded, setPlaybackEnded] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState(false);
  const [formError, setFormError] = useState('');
  const [expandedTasks, setExpandedTasks] = useState<number[]>([0]);
  const audio = useRef<HTMLAudioElement>(null);
  const detail = useRef<HTMLElement>(null);
  const guide = useRef<HTMLDialogElement>(null);
  const quizHeading = useRef<HTMLHeadingElement>(null);
  const playOnLoad = useRef(false);
  const active = calls.find(c => c.id === activeId)!;
  const index = calls.findIndex(c => c.id === activeId);
  const current = progress[activeId] || EMPTY;
  const completed = calls.filter(c => progress[c.id]?.completed).length;
  const bookmarked = calls.filter(c => progress[c.id]?.bookmark).length;
  const totalListened = calls.reduce((total, c) => total + listenedSeconds(progress[c.id]?.coverage), 0);
  const scores = calls.map(c => progress[c.id]?.bestScore).filter((s): s is number => s !== undefined);
  const average = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const coveragePercent = Math.min(100, Math.floor(listenedSeconds(current.coverage) / active.duration * 100));
  const quizUnlocked = canTakeQuiz(current, active.duration);
  const listeningRemaining = Math.max(0, Math.ceil(active.duration * 0.9 - listenedSeconds(current.coverage)));
  const submitted = Boolean(current.submitted);
  const result = gradeQuiz(active.questions, current.answers);
  const totalDuration = calls.reduce((sum, call) => sum + call.duration, 0);
  const listenedPercent = Math.min(100, Math.round(totalListened / totalDuration * 100));
  // Sparklines summarize real course data; no fabricated weekly history.
  const completedSeries = [0];
  const listenedSeries = [0];
  const bookmarkedSeries = [0];
  for (const call of calls) {
    completedSeries.push(completedSeries[completedSeries.length - 1] + Number(Boolean(progress[call.id]?.completed)));
    listenedSeries.push(listenedSeries[listenedSeries.length - 1] + listenedSeconds(progress[call.id]?.coverage));
    bookmarkedSeries.push(bookmarkedSeries[bookmarkedSeries.length - 1] + Number(Boolean(progress[call.id]?.bookmark)));
  }
  const answered = active.questions.filter((_, i) => current.answers[i] >= 0).length + (current.reflection.trim() ? 1 : 0);
  const totalTasks = active.questions.length + 1;
  const activeLine = active.transcript.reduce((last, line, i) => line.at <= time ? i : last, -1);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeId, progress })); setSaveError(false); }
    catch { setSaveError(true); }
  }, [activeId, progress]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 2800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function update(id: string, patch: Partial<Progress>) {
    setProgress(previous => ({ ...previous, [id]: { ...EMPTY, ...previous[id], ...patch } }));
  }

  function selectCall(id: string, autoplay = false) {
    setTab('listen');
    setFormError('');
    if (id === activeId) {
      if (autoplay) void audio.current?.play().catch(() => setNotice('Press play to start the recording.'));
    } else {
      setExpandedTasks([0]);
      audio.current?.pause();
      setPlaying(false);
      setPlaybackEnded(false);
      setAudioError(false);
      setTime(0);
      playOnLoad.current = autoplay;
      setActiveId(id);
    }
    if (window.innerWidth < 900) detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleBookmark(id: string) {
    const next = !progress[id]?.bookmark;
    update(id, { bookmark: next });
    setNotice(next ? 'Call added to your bookmarks' : 'Bookmark removed');
  }

  function startTraining() {
    const next = calls.find(c => !progress[c.id]?.completed) || calls[0];
    const readyForQuiz = canTakeQuiz(progress[next.id], next.duration);
    selectCall(next.id, !readyForQuiz);
    if (readyForQuiz) openQuiz();
    detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function togglePlay() {
    if (!audio.current) return;
    if (playing) audio.current.pause();
    else {
      try { setPlaybackEnded(false); await audio.current.play(); }
      catch { setAudioError(true); }
    }
  }

  function seek(position: number) {
    if (!audio.current || !Number.isFinite(audio.current.duration)) return;
    recordPlayback(audio.current);
    const next = Math.max(0, Math.min(active.duration, position));
    audio.current.currentTime = next;
    setPlaybackEnded(false);
    setTime(next);
    update(activeId, { position: next });
  }

  function recordPlayback(element: HTMLAudioElement) {
    if (element !== audio.current) return current;
    const position = element.currentTime;
    // Snapshot mutable media properties before scheduling a React state update.
    const played = element.played;
    const ranges = Array.from({ length: played.length }, (_, i) => [played.start(i), played.end(i)]);
    setTime(position);
    setProgress(all => {
      const saved = all[activeId] || EMPTY;
      return { ...all, [activeId]: { ...saved, position, coverage: mergePlayedRanges(saved.coverage, ranges, active.duration) } };
    });
    return { ...current, position, coverage: mergePlayedRanges(current.coverage, ranges, active.duration) };
  }

  function onPlaybackEnded(element: HTMLAudioElement) {
    if (element !== audio.current) return;
    const saved = recordPlayback(element);
    setPlaying(false);
    setPlaybackEnded(true);
    if (canTakeQuiz(saved, active.duration) && !saved.completed) openQuiz();
  }

  function continueListening() {
    if (playbackEnded || time >= active.duration - 0.5) seek(firstUnplayedPosition(current.coverage, active.duration));
    setTab('listen');
    if (!playing) void togglePlay();
  }

  function openQuiz() {
    audio.current?.pause();
    setTab('quiz');
    setFormError('');
    requestAnimationFrame(() => {
      quizHeading.current?.focus({ preventScroll: true });
      quizHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function submitQuiz(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!quizUnlocked) return;
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
    const grade = gradeQuiz(active.questions, current.answers);
    setExpandedTasks([]);
    update(activeId, { submitted: true, bestScore: Math.max(current.bestScore ?? 0, grade.score), completed: current.completed || grade.passed });
    setFormError('');
    requestAnimationFrame(() => quizHeading.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
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
    detail.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const visibleCalls = calls.filter(call => {
    const p = progress[call.id] || EMPTY;
    const matchesQuery = `${call.title} ${call.manager} ${call.specialty} ${call.topic}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && call.rating >= minRating && call.duration >= minDuration && (manager === 'all' || call.manager === manager) && (filter === 'all' || (filter === 'todo' && !p.completed) || (filter === 'completed' && p.completed) || (filter === 'saved' && p.bookmark));
  }).sort((a, b) => sort === 'rating' ? b.rating - a.rating : sort === 'shortest' ? a.duration - b.duration : sort === 'longest' ? b.duration - a.duration : calls.indexOf(a) - calls.indexOf(b));

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
        <div className="heading-actions"><button className="text-button guide-button" onClick={() => guide.current?.showModal()}><CircleHelp size={16} />How it works</button><button className="button button-dark start-training-button" onClick={startTraining}><span className="start-play-icon" aria-hidden="true"><Play size={7} fill="currentColor" strokeWidth={0} /></span>{completed === 10 ? 'Revisit training' : totalListened > 0 ? 'Continue training' : 'Start training'}</button></div>
      </section>

      {completed === 10 && <div className="course-complete" role="status"><Trophy size={25} /><div><strong>You’re ready for your next conversation.</strong><p>All 10 demos completed. Your quiz average is {average}%. Revisit any call whenever you need a refresher.</p></div><span>10 / 10<CheckCheck size={18} /></span></div>}

      <section className="stats-grid" aria-label="Your training statistics">
        <div className="stat-card">
          <h2 className="stat-label">Demos completed</h2>
          <div className="stat-content"><div className="stat-copy">
            <div className="stat-value-row"><div className="stat-value">{completed}<span> / 10</span></div><span className="stat-badge" aria-label={`${completed * 10}% of course completed`}><CircleCheck size={10} />{completed * 10}%</span></div>
            <p className="stat-caption">of your training course</p>
          </div><StatSparkline values={completedSeries} color="#a020e8" label="Cumulative completed demos in course order" /></div>
        </div>
        <div className="stat-card">
          <h2 className="stat-label">Time listened</h2>
          <div className="stat-content"><div className="stat-copy">
            <div className="stat-value-row"><div className="stat-value">{Math.floor(totalListened / 60)}<span>m </span>{Math.floor(totalListened % 60)}<span>s</span></div><span className="stat-badge stat-badge-orange" aria-label={`${listenedPercent}% of recordings listened`}><Headphones size={10} />{listenedPercent}%</span></div>
            <p className="stat-caption">of {Math.ceil(totalDuration / 60)} minutes of learning</p>
          </div><StatSparkline values={listenedSeries} color="#ee7900" label="Cumulative listening time in course order" /></div>
        </div>
        <div className="stat-card">
          <h2 className="stat-label">Quiz average</h2>
          <div className="stat-content"><div className="stat-copy">
            <div className="stat-value-row"><div className="stat-value">{average === null ? '—' : average}<span>{average !== null ? '%' : ''}</span></div>{scores.length > 0 && <span className="stat-badge"><ClipboardCheck size={10} />{scores.length} {scores.length === 1 ? 'quiz' : 'quizzes'}</span>}</div>
            <p className="stat-caption">{scores.length ? 'across your answered demos' : 'Complete your first quiz'}</p>
          </div><StatSparkline values={scores} maximum={100} color="#a020e8" label={scores.length ? 'Best quiz scores in course order' : 'No quiz scores yet'} /></div>
        </div>
        <div className="stat-card">
          <h2 className="stat-label">Bookmarked calls</h2>
          <div className="stat-content"><div className="stat-copy">
            <div className="stat-value-row"><div className="stat-value">{bookmarked}</div>{bookmarked > 0 && <span className="stat-badge"><Bookmark size={10} />Saved</span>}</div>
            <button className="stat-link" onClick={() => setFilter(filter === 'saved' ? 'all' : 'saved')}>{filter === 'saved' ? 'Back to all calls' : 'View your saved calls'}<ArrowRight size={11} /></button>
          </div><StatSparkline values={bookmarkedSeries} color="#a020e8" label="Cumulative bookmarked calls in course order" /></div>
        </div>
      </section>

      <div className="learning-strip">
        <span className="learning-note"><span className="learning-icon"><Sparkles size={16} strokeWidth={1.5} /></span>A little listening. A lot of learning.</span>
        <div className="learning-extras">
          <div className="learning-steps"><span><i>1</i>Listen to the call</span><ChevronRight size={12} /><span><i>2</i>Complete the questionnaire</span><ChevronRight size={12} /><span><i>3</i>Build your confidence</span></div>
          <button className="learning-guide" aria-label="How training works" title="How training works" onClick={() => guide.current?.showModal()}><Sparkles size={14} strokeWidth={1.5} /></button>
        </div>
      </div>

      <div className="learning-layout">
        <aside className="library" aria-label="Training call library">
          <div className="library-section-heading"><h2>Call library</h2><span>{completed} of {calls.length} completed</span></div>
          <div className="library-tools">
            <label className="search-box">
              <Search size={16} />
              <input aria-label="Search training calls" placeholder="Search target, manager or topic…" value={query} onChange={e => setQuery(e.target.value)} />
              {query && <button aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button>}
            </label>
            <div className="filter-pills library-filters" role="group" aria-label="Filter by review status">
              {([['all', 'All'], ['todo', 'To review'], ['completed', 'Reviewed'], ['saved', 'Bookmarked']] as const).map(([value, label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={filter === value ? 'selected' : ''}>{label}</button>)}
            </div>
            <details className="library-extra-filters">
              <summary><span><SlidersHorizontal size={13} />More filters</span><span>{Number(manager !== 'all') + Number(minRating > 0) + Number(minDuration > 0) || ''}<ChevronDown size={13} /></span></summary>
            <div className="filter-pills manager-filters" role="group" aria-label="Filter by manager">
              <button className={manager === 'all' ? 'selected' : ''} aria-pressed={manager === 'all'} onClick={() => setManager('all')}>All managers</button>
              {[...managers].sort((a, b) => ['zee', 'will', 'edrin'].indexOf(managerClass(a)) - ['zee', 'will', 'edrin'].indexOf(managerClass(b))).map(name => <button key={name} className={manager === name ? 'selected' : ''} aria-pressed={manager === name} onClick={() => setManager(name)}>{name}<span className="filter-count">{calls.filter(call => call.manager === name).length}</span></button>)}
            </div>
            <div className="library-criteria">
              <div className="filter-pills" role="group" aria-label="Filter by rating">
                {([[0, 'Any rating'], [8, '8+'], [6, '6+']] as const).map(([value, label]) => <button key={value} className={minRating === value ? 'selected' : ''} aria-pressed={minRating === value} onClick={() => setMinRating(value)}>{label}</button>)}
              </div>
              <div className="filter-pills" role="group" aria-label="Filter by recording length">
                {([[0, 'Any length'], [60, '1m+'], [180, '3m+']] as const).map(([value, label]) => <button key={value} className={minDuration === value ? 'selected' : ''} aria-pressed={minDuration === value} onClick={() => setMinDuration(value)}>{label}</button>)}
              </div>
            </div>
            </details>
            <div className="library-sort-row">
              <label className="select-wrap"><select aria-label="Sort calls" value={sort} onChange={e => setSort(e.target.value)}><option value="rating">Best examples first</option><option value="course">Course order</option><option value="longest">Longest first</option><option value="shortest">Shortest first</option></select><ChevronDown size={13} /></label>
              <span className="library-result-count" role="status">{visibleCalls.length} of {calls.length}</span>
            </div>
          </div>

          <div className="call-list" aria-label="Calls">
            {visibleCalls.length ? visibleCalls.map(call => {
              const p = progress[call.id] || EMPTY;
              const selected = call.id === activeId;
              return <div className={`call-item ${selected ? 'active' : ''} ${p.completed ? 'is-complete' : ''}`} key={call.id}>
                <button className="call-select" aria-current={selected ? 'true' : undefined} onClick={() => selectCall(call.id)}>
                  <div className="call-item-title"><span className="call-number">{calls.indexOf(call) + 1}</span><strong>{call.title}</strong></div>
                  <div className="call-description"><i className={`manager-dot ${managerClass(call.manager)}`} /><strong>{call.manager}</strong><span className="call-meta-dot">·</span><span className="call-specialty">{call.specialty}</span></div>
                  <div className="call-item-meta"><span><Clock3 size={12} />{call.date}</span><span><Timer size={12} />{formatDuration(call.duration)}</span><span className={`call-rating ${call.rating >= 8 ? 'high-rating' : call.rating >= 6 ? 'mid-rating' : 'low-rating'}`} aria-label={`Manager rating ${call.rating.toFixed(1)} out of 10`}><TrendingUp size={12} />{call.rating.toFixed(1)}</span></div>
                </button>
                {p.completed && <span className="call-completed" role="img" aria-label="Demo completed" title="Demo completed"><CircleCheck size={13} fill="#16b34b" stroke="#fff" strokeWidth={2.5} /></span>}
                <button className={`call-bookmark ${p.bookmark ? 'is-saved' : ''}`} aria-label={`${p.bookmark ? 'Unbookmark' : 'Bookmark'} ${call.title}`} aria-pressed={p.bookmark} onClick={() => toggleBookmark(call.id)}><Bookmark size={14} fill={p.bookmark ? 'currentColor' : 'none'} /></button>
              </div>;
            }) : <div className="empty-state"><Search size={25} /><strong>No calls found</strong><p>{minDuration || minRating || query || manager !== 'all' ? 'Try a different search or filter.' : filter === 'saved' ? 'Bookmark a call to keep it here.' : filter === 'completed' ? 'Your completed demos will appear here.' : 'Try a different search or filter.'}</p><button className="text-button" onClick={() => { setQuery(''); setFilter('all'); setManager('all'); setMinRating(0); setMinDuration(0); }}>Show all calls<ArrowRight size={13} /></button></div>}
          </div>
        </aside>

        <section className="call-detail" ref={detail} aria-label="Selected training call">
          <div className="detail-header"><div className="detail-kicker"><span>Demo {String(index + 1).padStart(2, '0')} <span className="muted">/ 10</span></span><span className="kicker-dot">·</span><span className="lesson-level">{active.level}</span><span className={`lesson-status ${current.completed ? 'done' : ''}`}>{current.completed ? <><CircleCheck size={12} />Completed</> : quizUnlocked ? <><ClipboardCheck size={12} />Questionnaire ready</> : coveragePercent > 0 ? <><span className="live-dot" />In progress</> : <><span className="live-dot" />Not started</>}</span></div><div className="detail-title-row"><div><h2>{active.title}</h2><p className="detail-subtitle">{active.topic}</p></div><div className="rating-block" title="Illustrative manager rating for this sample call"><div className="rating-score"><Star size={15} strokeWidth={1.6} /><strong>{active.rating.toFixed(1)}</strong><span>/ 10</span></div><span>Manager rating</span></div></div><div className="call-information"><span className={`manager-avatar ${managerClass(active.manager)}`}>{active.manager[0]}</span><strong>{active.manager}</strong><span className="metadata-separator" /><span className="specialty-tag">{active.specialty}</span><span className="location"><MapPin size={12} />{active.location}</span></div></div>

          <div className="lesson-tabs" role="tablist" aria-label="Demo learning steps">
            <button id="listen-tab" role="tab" aria-selected={tab === 'listen'} aria-controls="listen-panel" tabIndex={tab === 'listen' ? 0 : -1} className={tab === 'listen' ? 'active' : ''} onClick={() => setTab('listen')} onKeyDown={event => { if (event.key === 'ArrowRight') { event.preventDefault(); setTab('quiz'); document.getElementById('quiz-tab')?.focus(); } }}>
              <span className={`step-number ${quizUnlocked ? 'done' : ''}`}>{quizUnlocked ? <Check size={12} /> : '1'}</span>Listen to the call
            </button>
            <button id="quiz-tab" role="tab" aria-selected={tab === 'quiz'} aria-controls="quiz-panel" tabIndex={tab === 'quiz' ? 0 : -1} className={tab === 'quiz' ? 'active' : ''} onClick={openQuiz} onKeyDown={event => { if (event.key === 'ArrowLeft') { event.preventDefault(); setTab('listen'); document.getElementById('listen-tab')?.focus(); } }}>
              <span className={`step-number ${current.completed ? 'done' : ''}`}>{current.completed ? <Check size={12} /> : '2'}</span>Questionnaire
              {!quizUnlocked ? <LockKeyhole size={12} className="tab-lock" /> : !current.completed && <span className="tab-ready">Ready</span>}
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
                  if (playOnLoad.current) {
                    playOnLoad.current = false;
                    void audio.current.play().catch(() => setNotice('Press play to start the recording.'));
                  }
                }}
                onPlay={() => { setPlaying(true); setPlaybackEnded(false); }}
                onPause={event => { recordPlayback(event.currentTarget); setPlaying(false); }}
                onEnded={event => onPlaybackEnded(event.currentTarget)}
                onSeeked={event => recordPlayback(event.currentTarget)}
                onTimeUpdate={event => recordPlayback(event.currentTarget)}
                onError={() => { setAudioError(true); setPlaying(false); }}
              />
              <div className="waveform-row">
                <button className="play-button" aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={togglePlay}>{playing ? <Pause size={14} fill="currentColor" strokeWidth={1.5} /> : <Play size={14} fill="currentColor" strokeWidth={1.5} className="play-icon" />}</button>
                <span className="player-timestamp" aria-label="Elapsed time">{formatTime(time)}</span>
                <div className="waveform"><svg viewBox="0 0 576 32" preserveAspectRatio="none" aria-hidden="true">{Array.from({ length: 96 }, (_, i) => { const height = 4 + Math.abs(Math.sin(i * 2.37 + index) * Math.cos(i * 0.41)) * 24; return <rect key={i} x={i * 6 + 1} y={(32 - height) / 2} width="2.5" height={height} rx="1.25" fill={i / 96 < time / active.duration ? '#555557' : '#c8c8ca'} />; })}</svg><input type="range" aria-label="Seek recording" aria-valuetext={`${formatTime(time)} of ${formatTime(active.duration)}`} min={0} max={active.duration} step={0.1} value={time} onChange={e => seek(Number(e.target.value))} /></div>
                <span className="player-timestamp player-duration" aria-label="Recording duration">{formatTime(active.duration)}</span>
                <button className="stop-button" aria-label="Stop playback and return to start" title="Stop and return to start" onClick={() => { playOnLoad.current = false; audio.current?.pause(); seek(0); }}><X size={15} strokeWidth={1.6} /></button>
              </div>
            </div>
            <div className="player-controls"><div className="transport"><button aria-label="Rewind 10 seconds" onClick={() => seek(time - 10)}><RotateCcw size={16} /><span>10</span></button><button aria-label="Forward 10 seconds" onClick={() => seek(time + 10)}><RotateCw size={16} /><span>10</span></button></div><div className="audio-options"><label className="speed-select"><select aria-label="Playback speed" value={speed} onChange={e => { const value = Number(e.target.value); setSpeed(value); if (audio.current) { recordPlayback(audio.current); audio.current.playbackRate = value; } }}><option value="0.75">0.75×</option><option value="1">1× speed</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select><ChevronDown size={11} /></label><span className="control-divider" /><button className="volume-button" aria-label={muted ? 'Unmute recording' : 'Mute recording'} aria-pressed={muted} onClick={() => { setMuted(!muted); if (audio.current) audio.current.muted = !muted; }}>{muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button></div></div>
            {audioError ? <div className="audio-error" role="alert"><Info size={14} /><span>The recording couldn’t play.</span><button onClick={() => { setAudioError(false); audio.current?.load(); }}>Reload audio</button></div> : <div className="audio-footnote"><span><Info size={11} />Sample recording · Fictional conversation</span><span className={quizUnlocked ? 'green' : ''}>{quizUnlocked ? <><CircleCheck size={12} />Listening complete</> : `${coveragePercent}% listened`}</span></div>}

            {tab === 'listen' ? <div id="listen-panel" role="tabpanel" aria-labelledby="listen-tab">
              <section className={`lesson-action ${quizUnlocked ? 'ready' : ''}`} aria-label="Next training step">
                <div className="lesson-action-copy">
                  <span className="lesson-action-label">{current.completed ? 'DEMO COMPLETE' : quizUnlocked ? 'NEXT · QUESTIONNAIRE' : 'STEP 1 OF 2 · LISTEN'}</span>
                  <h3>{current.completed ? 'Ready for your next call' : quizUnlocked ? 'Put what you heard into practice' : playing ? 'Listen for the techniques below' : playbackEnded ? 'Finish the parts you haven’t heard' : 'Start with the recording'}</h3>
                  <p>{current.completed ? `Best score: ${current.bestScore}%. Your answers and takeaway are saved.` : quizUnlocked ? '3 questions and a short takeaway. About 2 minutes.' : playbackEnded ? `${listeningRemaining}s of listening left to unlock your questions.` : 'Listen to 90% to unlock the questions. Your place is saved.'}</p>
                  {!quizUnlocked && <div className="listening-meter" role="progressbar" aria-label="Listening progress" aria-valuenow={coveragePercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${coveragePercent}%` }} /></div>}
                </div>
                <div className="lesson-action-buttons">
                  {current.completed ? <><button className="button button-dark" onClick={nextCall}>Next demo<ArrowRight size={14} /></button><button className="text-button" onClick={openQuiz}>Review answers</button></> : quizUnlocked ? <button className="button button-dark" onClick={openQuiz}>{submitted ? 'Review answers' : 'Take questionnaire'}<ArrowRight size={14} /></button> : <button className="button button-light" onClick={continueListening} disabled={playing}><Headphones size={14} />{playing ? 'Listening…' : coveragePercent > 0 ? 'Continue listening' : 'Play recording'}</button>}
                </div>
              </section>

              <section className="objectives-section"><div className="section-title"><h3>What to listen for</h3><span>{current.checked.length} / {active.objectives.length}</span></div><div className="objective-list">{active.objectives.map((objective, i) => <label key={`${active.id}-${i}`} className={current.checked.includes(i) ? 'checked' : ''}><input type="checkbox" checked={current.checked.includes(i)} onChange={() => update(activeId, { checked: current.checked.includes(i) ? current.checked.filter(item => item !== i) : [...current.checked, i] })} /><span className="custom-checkbox"><Check size={11} strokeWidth={3} /></span>{objective}</label>)}</div></section>

              <details className="coaching-section" key={`coaching-${active.id}`}><summary><h3>Coaching notes</h3><span>{active.summary.length} observations<ChevronDown size={15} /></span></summary><ul>{active.summary.map((item, i) => <li key={item}><span>{String(i + 1).padStart(2, '0')}</span>{item}</li>)}</ul></details>

              <section className="transcript-section"><button className="transcript-heading" onClick={() => setTranscriptOpen(!transcriptOpen)} aria-expanded={transcriptOpen} aria-controls="transcript-content"><h3>Call transcript</h3><span>Click a timestamp to jump<ChevronDown size={15} className={transcriptOpen ? 'rotated' : ''} /></span></button>{transcriptOpen && <div className="transcript-rows" id="transcript-content">{active.transcript.map((line, i) => <button className={`transcript-line ${activeLine === i ? 'current-line' : ''} ${i % 2 === 0 ? 'manager-line' : ''}`} key={`${active.id}-${i}`} onClick={() => seek(line.at)} aria-label={`Jump to ${formatTime(line.at)}, ${line.speaker}: ${line.text}`}><span className="transcript-person"><strong>{line.speaker}</strong><span>{activeLine === i && playing ? <AudioLines size={10} /> : null}{formatTime(line.at)}</span></span><span className="transcript-text">{line.text}</span></button>)}</div>}</section>


            </div> : <div id="quiz-panel" role="tabpanel" aria-labelledby="quiz-tab">
              <div className="questionnaire-heading">
                <div><span className="questionnaire-eyebrow">CALL REVIEW</span><h3 ref={quizHeading} tabIndex={-1}>Questionnaire</h3><p>{active.questions.length} questions and a written takeaway.<br />Answer at least {Math.ceil(active.questions.length * 2 / 3)} questions correctly to complete this demo.</p></div>
                {quizUnlocked && <button type="button" className="quiz-expand-all" onClick={() => setExpandedTasks(expandedTasks.length === totalTasks ? [] : Array.from({ length: totalTasks }, (_, i) => i))}>{expandedTasks.length === totalTasks ? 'Collapse all' : 'Expand all'}<ChevronDown size={13} className={expandedTasks.length === totalTasks ? 'is-expanded' : ''} /></button>}
              </div>
              {!quizUnlocked ? <div className="quiz-locked"><span><LockKeyhole size={28} /></span><h3>Listen to unlock the questionnaire</h3><p>Listen to at least 90% of the recording above, then come back to reflect on what you learned.</p><div className="locked-progress"><div style={{ width: `${coveragePercent}%` }} /></div><small>{coveragePercent}% of this call listened</small><button className="button button-dark" onClick={continueListening}><Headphones size={15} />Continue listening</button></div> : <form onSubmit={submitQuiz}>
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
                <details className="confidence-details" key={`confidence-${activeId}`}>
                  <summary>How confident do you feel?<span>Optional<ChevronDown size={14} /></span></summary>
                  <section className="confidence-section"><div><strong>How confident would you feel handling this call?</strong><span>Just for you · Not scored</span></div><div className="confidence-options">{[1, 2, 3, 4, 5].map(value => <button type="button" key={value} aria-label={`Confidence ${value} of 5`} aria-pressed={current.confidence === value} className={current.confidence === value ? 'selected' : ''} onClick={() => update(activeId, { confidence: value })}>{value}</button>)}</div><div className="confidence-labels"><span>Still practicing</span><span>Ready to try</span></div></section>
                </details>
                {formError && <p className="form-error" role="alert"><Info size={15} />{formError}</p>}
                <div className="quiz-actions">{submitted ? <><button type="button" className="text-button" onClick={retryQuiz}><RotateCcw size={14} />{result.score < 100 ? 'Retry missed questions' : 'Review answers again'}</button>{result.passed && <button type="button" className="button button-dark" onClick={nextCall}>{completed === 10 ? 'Explore the calls' : 'Continue to next demo'}<ArrowRight size={15} /></button>}</> : <><span>{answered === totalTasks ? 'All set. Submit when you’re ready.' : `${answered} of ${totalTasks} answered`}</span><button type="submit" className="button button-dark">Submit questionnaire<ArrowRight size={15} /></button></>}</div>
              </form>}
            </div>}
          </div>
          <footer className="detail-footer"><button className={`text-button bookmark-footer ${current.bookmark ? 'green' : ''}`} onClick={() => toggleBookmark(activeId)}><Bookmark size={15} fill={current.bookmark ? 'currentColor' : 'none'} />{current.bookmark ? 'Bookmarked' : 'Bookmark call'}</button><div className="previous-next"><button aria-label="Previous demo" disabled={index === 0} onClick={() => selectCall(calls[index - 1].id)}><ChevronLeft size={15} /><span>Previous</span></button><span>{index + 1} / 10</span><button aria-label="Next demo" disabled={index === calls.length - 1} onClick={() => selectCall(calls[index + 1].id)}><span>Next demo</span><ChevronRight size={15} /></button></div></footer>
        </section>
      </div>
      <footer className="page-footer"><span><Target size={14} />Better conversations start with practice.</span><span><span className="local-save-dot" />{saveError ? 'Browser storage unavailable. Keep this tab open to preserve progress.' : 'Progress saved on this browser'}</span></footer>
    </main>

    {notice && <div className="toast" role="status"><CircleCheck size={16} />{notice}</div>}
    <dialog className="guide-dialog" ref={guide} onClick={event => { if (event.target === event.currentTarget) guide.current?.close(); }}><button className="dialog-close" aria-label="Close course guide" onClick={() => guide.current?.close()}><X size={20} /></button><span className="guide-illustration"><Headphones size={32} /></span><span className="section-eyebrow">YOUR FIRST 10 CONVERSATIONS</span><h2>Listen. Reflect. Get ready.</h2><p className="guide-intro">A little practice before the real thing. Work through the demos at your own pace.</p><ol><li><span>01</span><div><strong>Listen with intention</strong><p>Play each demo, follow the transcript, and notice the techniques the manager uses. Listen to 90% to unlock the questions.</p></div></li><li><span>02</span><div><strong>Make the learning stick</strong><p>Answer three questions and write a takeaway. Get at least two answers right to complete the demo. You can retry anytime.</p></div></li><li><span>03</span><div><strong>Build your own approach</strong><p>Complete all 10 demos and bookmark calls you want to revisit. Your progress and notes stay in this browser.</p></div></li></ol><div className="guide-note"><Info size={16} /><span>This preview uses fictional, voice-generated sample conversations. Replace them with your team’s recordings for live onboarding.</span></div><button className="button button-dark" onClick={() => { guide.current?.close(); startTraining(); }}>Let’s get started<ArrowRight size={15} /></button></dialog>
  </>;
}
