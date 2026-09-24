import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, Clock3, Delete, Headphones, LoaderCircle, LockKeyhole, Mic, MicOff, Phone, PhoneOff, RotateCcw, Volume1, Volume2, WifiOff, X } from 'lucide-react';
import MicrophoneCheckPanel from './MicrophoneCheck';
import { MAX_CALL_SECONDS, practiceContacts, practiceLevels, practiceScenarios, validFeedback } from '../shared/practice.mjs';
import { PracticeVoice, practiceError, practiceRequest, updateTranscript, type Feedback, type PracticeConfig, type TranscriptLine } from './practice-client';
import { callScore as score, loadPractice, practiceProgress, recordAttempt, savePractice, type Attempt, type PracticeRecord } from './practice-progress';
import { StatBars, ScoreSparkline, ScoreGauge } from './Stats';

type Status = 'idle' | 'connecting' | 'active' | 'ending' | 'ended';
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const dialKeys = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];

function LevelEmoji({ level }: { level: number }) {
  return <span className="practice-level-emoji" aria-hidden="true">{practiceLevels[level - 1].emoji}</span>;
}

function practiceRating(value?: number) {
  if (value === undefined) return { tone: 'unscored' as const, label: 'Not scored' };
  if (value >= 90) return { tone: 'high' as const, label: 'Excellent' };
  if (value >= 70) return { tone: 'medium' as const, label: 'Good progress' };
  return { tone: 'low' as const, label: 'Needs practice' };
}

function PracticeScoreLabel({ value }: { value?: number }) {
  const rating = practiceRating(value);
  return <span className={`practice-score-label score-${rating.tone}`}>{rating.label}</span>;
}

function FeedbackCard({ feedback }: { feedback: Feedback }) {
  return <div className="practice-feedback">
    <div className="practice-feedback-heading"><div><span className="journey-eyebrow">YOUR CALL REVIEW</span><h3>One conversation better.</h3></div><PracticeScoreLabel value={score(feedback) * 5} /></div>
    <p>{feedback.summary}</p>
    <div className="practice-criteria">{feedback.criteria.map(item => <div key={item.name}><div><strong>{item.name}</strong><span>{item.score} / 5</span></div><div className={`practice-score-track score-${practiceRating(item.score * 20).tone}`} aria-hidden="true"><span style={{ width: `${item.score * 20}%` }} /></div><p>{item.evidence}</p></div>)}</div>
    <div className="practice-next"><span className="journey-eyebrow">TRY THIS NEXT TIME</span><p>{feedback.nextAttempt}</p></div>
    <p className="practice-caption">AI coaching based on the available transcript. This is practice feedback, not a certification.</p>
  </div>;
}

export default function PracticePage({ onReview }: { onReview: () => void }) {
  const [record, setRecord] = useState<PracticeRecord>(loadPractice);
  const progress = practiceProgress(record);
  const currentLevelTotal = progress.level.callsRequired;
  const currentLevelCompleted = currentLevelTotal - progress.remaining;
  const [viewLevel, setViewLevel] = useState(() => progress.level.number);
  const [dialNumber, setDialNumber] = useState(() => progress.nextContact.extension);
  const [numberFromList, setNumberFromList] = useState(true);
  const dialContact = practiceContacts.find(item => item.extension === dialNumber);
  const contact = dialContact || practiceContacts[0];
  const scenario = { ...practiceScenarios.find(item => item.id === contact.scenario)!, name: contact.name };
  const levelContacts = practiceContacts.filter(item => item.level === viewLevel);
  const viewedLevel = practiceLevels[viewLevel - 1];
  const levelCompleted = levelContacts.filter(item => Object.hasOwn(record.contactScores, item.id)).length;
  const levelRemaining = levelContacts.length - levelCompleted;
  const canDial = Boolean(dialContact && dialContact.level <= progress.level.number);
  const dialLevelContacts = practiceContacts.filter(item => item.level === (dialContact?.level ?? viewLevel));
  const dialContactIndex = dialLevelContacts.findIndex(item => item.id === dialContact?.id);
  const [status, setStatus] = useState<Status>('idle');
  const [config, setConfig] = useState<PracticeConfig | null>(null);
  const [configVersion, setConfigVersion] = useState(0);
  const [configFailed, setConfigFailed] = useState(false);
  const [checkingMic, setCheckingMic] = useState(false);
  const [connectionPhase, setConnectionPhase] = useState<'microphone' | 'partner' | 'connecting'>('microphone');
  const [reconnecting, setReconnecting] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [speaking, setSpeaking] = useState<'user' | 'assistant' | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [storageError, setStorageError] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const contactList = useRef<HTMLOListElement>(null);
  const activeContact = useRef<HTMLLIElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const roomHeading = useRef<HTMLHeadingElement>(null);
  const voice = useRef<PracticeVoice | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const started = useRef(0);
  const endedSeconds = useRef(0);
  const attemptId = useRef('');
  const linesRef = useRef<TranscriptLine[]>([]);
  const mounted = useRef(false);
  const ending = useRef(false);
  const inCall = status === 'active' || status === 'connecting' || status === 'ending';
  const locked = inCall || busy;
  const voiceSupported = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof globalThis.RTCPeerConnection === 'function';

  function changeLines(next: TranscriptLine[]) { linesRef.current = next; setLines(next); }
  function stopResources() { voice.current?.stop(); voice.current = null; request.current?.abort(); request.current = null; }

  useEffect(() => {
    if (!record.example) return;
    try { savePractice(record); setStorageError(false); } catch { setStorageError(true); }
  }, [record]);

  useEffect(() => {
    mounted.current = true;
    const stopOnExit = () => { generation.current++; stopResources(); setBusy(false); setStatus('ended'); setSpeaking(null); setAudioBlocked(false); };
    window.addEventListener('pagehide', stopOnExit);
    return () => { mounted.current = false; generation.current++; stopResources(); window.removeEventListener('pagehide', stopOnExit); };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setConfig(null); setConfigFailed(false);
    void practiceRequest<PracticeConfig>('config', undefined, { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) setConfig(value);
    }).catch(() => { if (!abort.signal.aborted) { setConfigFailed(true); setConfig({ available: false, accessCodeRequired: false, maxCallSeconds: MAX_CALL_SECONDS }); } });
    return () => abort.abort();
  }, [configVersion]);

  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines, showTranscript]);

  useEffect(() => {
    if (audio.current) audio.current.volume = volume / 100;
  }, [volume]);

  useEffect(() => {
    const list = contactList.current;
    const item = activeContact.current;
    if (!list) return;
    if (!item) { list.scrollTop = 0; return; }
    const listBounds = list.getBoundingClientRect();
    const itemBounds = item.getBoundingClientRect();
    // Keep the selected company visible without moving the page.
    if (itemBounds.top < listBounds.top) list.scrollTop += itemBounds.top - listBounds.top - 6;
    else if (itemBounds.bottom > listBounds.bottom) list.scrollTop += itemBounds.bottom - listBounds.bottom + 6;
  }, [dialContact?.id, viewLevel]);

  useEffect(() => {
    if (status !== 'active') return;
    const timer = setInterval(() => {
      const elapsed = Math.min(MAX_CALL_SECONDS, Math.floor((Date.now() - started.current) / 1000));
      setSeconds(elapsed);
      if (elapsed >= MAX_CALL_SECONDS) { setNotice(`Your ${MAX_CALL_SECONDS}-second practice is complete.`); void endAttempt(); }
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  function resetAttempt() {
    generation.current++;
    stopResources();
    setStatus('idle'); setBusy(false); setError(''); setNotice(''); setFeedback(null);
    setSeconds(0); setMuted(false); setSpeaking(null); setAudioBlocked(false); changeLines([]);
    setReconnecting(false); setShowTranscript(false); setConnectionPhase('microphone');
    started.current = 0; endedSeconds.current = 0; ending.current = false;
  }

  function selectContact(item: typeof contact) {
    if (locked || checkingMic || item.level > progress.level.number) return;
    resetAttempt(); setDialNumber(item.extension); setNumberFromList(true); setViewLevel(item.level);
  }

  function selectLevel(number: number) {
    const companies = practiceContacts.filter(item => item.level === number);
    const next = companies.find(item => !Object.hasOwn(record.contactScores, item.id)) || companies[0];
    if (next) selectContact(next);
  }

  function editNumber(value: string) {
    setDialNumber(value.replace(/[^0-9*#]/g, '').slice(0, 3)); setNumberFromList(false);
  }

  function persist(next: PracticeRecord) {
    setRecord(next);
    try { savePractice(next); setStorageError(false); } catch { setStorageError(true); }
  }

  function startAttempt() {
    if (locked || checkingMic || !config?.available || !canDial || !voiceSupported || (config.accessCodeRequired && !code.trim())) return;
    resetAttempt();
    const currentGeneration = generation.current;
    attemptId.current = crypto.randomUUID();
    setStatus('connecting');
    const isCurrent = () => mounted.current && generation.current === currentGeneration;
    const call = new PracticeVoice({
      scenario: scenario.id, contactId: contact.id, code, audio: audio.current!,
      onConnected: () => { if (isCurrent()) { started.current = Date.now(); setStatus('active'); requestAnimationFrame(() => roomHeading.current?.focus({ preventScroll: true })); } },
      onPhase: phase => { if (isCurrent()) setConnectionPhase(phase); },
      onNetworkState: state => { if (isCurrent()) setReconnecting(state === 'reconnecting'); },
      onEvent: event => {
        if (!isCurrent()) return;
        changeLines(updateTranscript(linesRef.current, event));
        if (event.type === 'practice.transcript.incomplete') setNotice('The last part of the transcript did not arrive in time. Your feedback uses the words captured so far.');
        if (ending.current) return;
        if (event.type === 'input_audio_buffer.speech_started') setSpeaking('user');
        if (event.type === 'input_audio_buffer.speech_stopped') setSpeaking(null);
        if (event.type === 'output_audio_buffer.started') setSpeaking('assistant');
        if (event.type === 'output_audio_buffer.stopped' || event.type === 'output_audio_buffer.cleared') setSpeaking(null);
        if (event.type === 'conversation.item.input_audio_transcription.failed') setNotice('Part of your speech could not be transcribed. Feedback may be incomplete.');
      },
      onError: message => { if (isCurrent()) { endedSeconds.current = started.current ? Math.min(MAX_CALL_SECONDS, Math.floor((Date.now() - started.current) / 1000)) : 0; setSeconds(endedSeconds.current); setError(message); setStatus(linesRef.current.length ? 'ended' : 'idle'); setSpeaking(null); setAudioBlocked(false); } },
      onAudioBlocked: () => { if (isCurrent()) setAudioBlocked(true); },
    });
    voice.current = call;
    void call.start();
  }

  async function getFeedback() {
    const messages = linesRef.current.filter(line => line.text.trim() && !line.pending).map(({ role, text }) => ({ role, text }));
    if (!messages.some(line => line.role === 'user')) return;
    const currentGeneration = generation.current;
    const abort = request.current = new AbortController();
    setBusy(true); setError('');
    try {
      const result = await practiceRequest<{ feedback: Feedback }>('feedback', { scenario: scenario.id, contactId: contact.id, messages }, { code, signal: abort.signal });
      if (!mounted.current || generation.current !== currentGeneration) return;
      if (!validFeedback(result.feedback)) throw new Error('Feedback could not be read. Please try again.');
      setFeedback(result.feedback);
      const attempt: Attempt = { id: attemptId.current, contactId: contact.id, scenario: scenario.id, mode: 'voice', date: new Date().toISOString(), seconds: endedSeconds.current, feedback: result.feedback };
      // Store coaching summaries only; call audio and transcripts are not saved.
      persist(recordAttempt(record, attempt));
    } catch (error) { if (mounted.current && generation.current === currentGeneration) setError(practiceError(error)); }
    finally { if (mounted.current && generation.current === currentGeneration) setBusy(false); }
  }

  async function endAttempt() {
    if (ending.current) return;
    ending.current = true;
    const currentGeneration = generation.current;
    setStatus('ending'); setSpeaking(null); setAudioBlocked(false); setReconnecting(false);
    endedSeconds.current = Math.min(MAX_CALL_SECONDS, Math.max(0, Math.floor((Date.now() - started.current) / 1000)));
    setSeconds(endedSeconds.current);
    await voice.current?.finish();
    if (!mounted.current || generation.current !== currentGeneration) return;
    voice.current = null; setStatus('ended');
    requestAnimationFrame(() => reviewHeading.current?.focus());
    void getFeedback();
  }

  function leave() { generation.current++; stopResources(); onReview(); }
  const liveLabel = reconnecting ? 'Reconnecting your call…' : muted ? 'Microphone muted' : speaking === 'assistant' ? `${scenario.name} is speaking` : speaking === 'user' ? 'Listening to you' : 'Your turn · Speak naturally';
  const hasUserSpeech = lines.some(line => line.role === 'user' && line.text.trim() && !line.pending);
  const connectionCopy = connectionPhase === 'microphone' ? ['Allow your microphone', 'Look for the microphone prompt in your browser.'] : connectionPhase === 'partner' ? ['Getting your partner ready', `We’re preparing ${scenario.name} for your conversation.`] : ['Connecting your audio', 'You’ll hear your partner say hello in a moment.'];
  const serviceLabel = !config ? 'Checking call availability' : config.available ? 'Ready to connect' : configFailed ? 'Call service unavailable' : 'Calling needs to be enabled';

  return <main id="main" className={`page-shell journey-page practice-page ${inCall ? 'is-in-call' : ''} ${status === 'ended' ? 'is-reviewing' : ''}`}>
    <div className="breadcrumbs"><button type="button" onClick={leave}>Training Calls</button><ChevronRight size={12} /><span>AI call practice</span></div>
    <header className="practice-heading">
      <div><h1 id="practice-title" data-journey-heading tabIndex={-1}>AI call practice</h1><p>Practice with AI partners at fictional companies. Build your confidence, one level at a time.</p></div>
      {record.example && <span className="practice-example-label" title="Saved sample results. Your first scored AI call starts your own progress.">Sample progress · 6 calls</span>}
    </header>
    <section className="training-stats practice-stats" aria-label="Your practice stats" tabIndex={0}>
      <article className="stat-card stat-completion practice-stat stat-level" aria-labelledby="practice-level-label">
        <div className="stat-card-body">
          <div className="stat-progress-heading"><strong><LevelEmoji level={progress.level.number} />Level {String(progress.level.number).padStart(2, '0')}</strong><span className="stat-percent-badge">{Math.round(currentLevelCompleted / currentLevelTotal * 100)}%</span></div>
          <p className="stat-progress-copy">{progress.completed === practiceContacts.length ? 'All levels completed.' : progress.level.title}<br />{currentLevelCompleted} of {currentLevelTotal} calls in this level.</p>
          <StatBars value={currentLevelCompleted} total={currentLevelTotal} label="Current practice level completion" gradient />
        </div>
        <h2 className="stat-label" id="practice-level-label">Current level</h2>
      </article>
      <article className="stat-card stat-scores practice-stat stat-average" aria-labelledby="practice-average-label">
        <div className="stat-card-body">
          <p className={`stat-value ${progress.average === null ? 'is-empty' : ''}`}>{progress.average === null ? '—' : <>{progress.average}<span>%</span></>}</p>
          <p className="stat-context">{record.totalCalls ? `Across ${record.totalCalls} scored ${record.totalCalls === 1 ? 'call' : 'calls'}` : 'Finish a call to see your score'}</p>
          <ScoreSparkline values={practiceContacts.map(item => record.contactScores[item.id] === undefined ? undefined : record.contactScores[item.id] * 5)} itemLabels={practiceContacts.map(item => item.company)} label="Best practice scores in company order." emptyLabel="No practice scores yet" />
        </div>
        <h2 className="stat-label" id="practice-average-label">Average score</h2>
      </article>
      <article className="stat-card stat-answers practice-stat stat-calls" aria-labelledby="practice-calls-label">
        <div className="stat-card-body">
          <p className="stat-value">{progress.completed}<span> / {practiceContacts.length}</span></p>
          <p className="stat-context"><span className="stat-highlight">{practiceContacts.length - progress.completed}</span>{practiceContacts.length - progress.completed === 1 ? 'call remaining' : 'calls remaining'}</p>
          <StatBars value={progress.completed} total={practiceContacts.length} label="Practice calls completed" segments={30} />
        </div>
        <h2 className="stat-label" id="practice-calls-label">Calls completed</h2>
      </article>
      <article className="stat-card stat-demo-score practice-stat stat-best" aria-labelledby="practice-best-label">
        <div className="stat-card-body"><ScoreGauge score={progress.best ?? undefined} caption="Best call · out of 100" ariaLabel={progress.best === null ? 'No practice score yet' : `Personal best practice score: ${progress.best} out of 100. ${practiceRating(progress.best).label}.`} colorTone={practiceRating(progress.best ?? undefined).tone} statusLabel={practiceRating(progress.best ?? undefined).label} /></div>
        <h2 className="stat-label" id="practice-best-label">Personal best</h2>
      </article>
    </section>
    <div className="practice-layout">
      <section className="practice-directory" aria-labelledby="directory-title">
        <div className="directory-heading"><h2 id="directory-title">The call list</h2><span className="directory-count">Level {viewLevel} · {viewedLevel.callsRequired} calls</span></div>
        <div className="practice-level-tabs" aria-label="Practice levels">{practiceLevels.map(item => <button key={item.number} type="button" aria-pressed={viewLevel === item.number} disabled={locked || checkingMic || item.number > progress.level.number} onClick={() => selectLevel(item.number)} aria-label={`Level ${item.number}: ${item.title}${item.number > progress.level.number ? ' (locked)' : ''}`} title={`${item.callsRequired} calls to complete`}>
          <span className="practice-level-marker" aria-hidden="true"><LevelEmoji level={item.number} />{item.number > progress.level.number && <LockKeyhole size={9} className="practice-level-lock" />}</span>Level {item.number}<small>{item.callsRequired}</small>
        </button>)}</div>
        <div className="directory-level-intro"><h3><LevelEmoji level={viewLevel} />{viewedLevel.title}</h3><p>{viewedLevel.description}</p></div>
        <div className="call-list-panel">
          <p className="library-queue-heading" role="status">{levelRemaining ? <CircleDashed size={14} /> : <CircleCheck size={14} />}<span>{levelRemaining ? `${levelRemaining} ${levelRemaining === 1 ? 'call' : 'calls'} remaining` : 'All calls completed'}</span></p>
          <ol className="call-list practice-contact-list" aria-label={`Level ${viewLevel} companies`} ref={contactList}>{levelContacts.map(item => {
            const completed = Object.hasOwn(record.contactScores, item.id);
            const selected = dialContact?.id === item.id;
            return <li key={item.id} className={`call-item ${selected ? 'active' : ''} ${completed ? 'is-complete' : ''}`} ref={selected ? activeContact : null}>
              <button type="button" className="call-select practice-contact" aria-pressed={selected} aria-label={`Select ${item.company}, extension ${item.extension}`} disabled={locked || checkingMic} onClick={() => selectContact(item)}>
                <span className="call-lesson-icon" aria-hidden="true"><Phone size={13} fill="currentColor" strokeWidth={1.6} /></span>
                <span className="call-row-copy">
                  <span className="call-item-title"><strong>{item.company}</strong><span className="call-duration">Ext. {item.extension}</span></span>
                  <span className="call-description">AI partner · {item.specialty}</span>
                  {completed && <span className="call-row-state" title="Best call score"><PracticeScoreLabel value={record.contactScores[item.id] * 5} /></span>}
                </span>
                <ChevronRight size={14} className="call-row-chevron" aria-hidden="true" />
              </button>
            </li>;
          })}</ol>
        </div>
        <div className="directory-progress"><div><strong>{levelCompleted} of {levelContacts.length} calls completed</strong><span>{Math.round(levelCompleted / levelContacts.length * 100)}%</span></div><div className="directory-progress-track" role="progressbar" aria-label={`Level ${viewLevel} completion`} aria-valuemin={0} aria-valuemax={levelContacts.length} aria-valuenow={levelCompleted}><span style={{ width: `${levelCompleted / levelContacts.length * 100}%` }} /></div><p>Finish a scored call with each company to {viewLevel < 3 ? 'unlock the next level' : 'complete your practice'}. Repeats improve your score.</p></div>
        <p className="directory-disclosure"><Bot size={13} />Fictional companies · AI calls only</p>
      </section>
      <section className="practice-workspace" aria-label="Practice workspace">
        {dialContact ? <>
          <header className="practice-company-overview">
            <div className="practice-case-meta"><span><LevelEmoji level={contact.level} />{canDial ? `Level ${contact.level} · ${practiceLevels[contact.level - 1].title}` : `Level ${contact.level} · Locked`}</span><span>Call {String(dialContactIndex + 1).padStart(2, '0')} <span>of {dialLevelContacts.length}</span></span></div>
            <h2 id="practice-company-title">{contact.company}</h2>
            <p className="practice-company-subtitle">{contact.specialty}<span aria-hidden="true">·</span>Fictional company</p>
            <div className="practice-company-reference"><span>Extension <strong>{contact.extension}</strong></span><span>Best score <PracticeScoreLabel value={Object.hasOwn(record.contactScores, contact.id) ? record.contactScores[contact.id] * 5 : undefined} /></span></div>
          </header>
          <section className="practice-partner-strip" aria-labelledby="practice-ai-partner-title">
            <span className="practice-partner-symbol" aria-hidden="true"><Headphones size={18} strokeWidth={1.7} /></span>
            <div><h3 id="practice-ai-partner-title">{contact.name} <span>AI</span></h3><p>{scenario.role}</p></div>
            <span className="practice-partner-format">Quick voice practice<small>{MAX_CALL_SECONDS} seconds</small></span>
          </section>
          {feedback ? <FeedbackCard feedback={feedback} /> : <section className="practice-business-data" aria-labelledby="practice-business-title">
            <h3 id="practice-business-title">Business details</h3>
            <dl className="practice-business-fields">
              <div><dt>Address</dt><dd><address>{contact.address}<span>{contact.locality}</span></address></dd></div>
              <div><dt>Website</dt><dd>{contact.website}</dd></div>
              <div><dt>Practice line</dt><dd className="practice-business-line"><span>Ext. {contact.extension}</span><span>AI voice call</span></dd></div>
            </dl>
          </section>}
        </> : <div className="practice-workspace-empty"><span><Bot size={34} /></span><h2>Choose your AI practice partner</h2><p>Select a fictional company from the call list or enter its practice extension in the dialer.</p></div>}
        {(status === 'active' || status === 'ending' || status === 'ended' || lines.length > 0) && <section className="practice-conversation" aria-labelledby="conversation-title">
          <h2 id="conversation-title"><button type="button" className="practice-transcript-toggle" aria-expanded={showTranscript} aria-controls="practice-transcript-panel" onClick={() => setShowTranscript(value => !value)}><span><span>{status === 'active' ? 'Live transcript' : 'Your conversation'}</span><small>{lines.filter(line => line.text.trim()).length} turns captured</small></span><ChevronDown size={17} /></button></h2>
          <div id="practice-transcript-panel" hidden={!showTranscript}>
            <div className="practice-transcript" ref={transcript} role="log" aria-label="Practice conversation" aria-live="polite" aria-relevant="additions text">{lines.length ? lines.map(line => <div key={line.id} className={`practice-message from-${line.role}`}><span>{line.role === 'user' ? 'You' : `${scenario.name} · AI`}</span><p>{line.text || (status === 'ended' ? 'Transcript unavailable' : 'Listening…')}</p></div>) : <p className="practice-transcript-empty">Your words will appear here as you speak.</p>}</div>
            <p className="practice-caption">Transcripts can miss or mishear words. This transcript is cleared when you leave or start again.</p>
          </div>
        </section>}
      </section>
      <div className="practice-room">
        <section className={`practice-dialer ${status === 'active' ? 'is-live' : status === 'idle' ? 'is-idle' : ''} ${reconnecting ? 'is-reconnecting' : ''}`} aria-labelledby="practice-partner-title">
          <div className="practice-dialer-navigation">
            <button type="button" aria-label="Previous AI partner" disabled={locked || checkingMic || !canDial || dialContactIndex <= 0} onClick={() => selectContact(dialLevelContacts[dialContactIndex - 1])}><ChevronLeft size={18} /></button>
            <h2 id="practice-partner-title" ref={roomHeading} tabIndex={-1}>{dialContact ? contact.company : 'AI practice dialer'}</h2>
            <button type="button" aria-label="Next AI partner" disabled={locked || checkingMic || !canDial || dialContactIndex >= dialLevelContacts.length - 1} onClick={() => selectContact(dialLevelContacts[dialContactIndex + 1])}><ChevronRight size={18} /></button>
          </div>
          {status !== 'idle' && <>
          <div className="practice-dialer-top"><span><Phone size={13} />{status === 'active' ? 'Practice in progress' : status === 'ended' ? 'Call ended' : 'Your dialer'}</span><span className="practice-ai-label"><Clock3 size={11} />{MAX_CALL_SECONDS} SEC</span></div>
          <div className="practice-partner">
            <div className={`practice-avatar ${status === 'active' && speaking === 'assistant' && !reconnecting ? 'is-speaking' : ''}`} aria-hidden="true"><Bot size={28} /><span><Phone size={14} /></span></div>
            <span className="journey-eyebrow">{dialContact && <LevelEmoji level={contact.level} />}{dialContact ? `LEVEL ${contact.level} · AI PRACTICE PARTNER` : 'YOUR NEXT CONVERSATION'}</span>
            <h3>{scenario.name} · AI</h3>
            {status === 'active' ? <div className="practice-live-display"><time>{timeLabel(Math.max(0, MAX_CALL_SECONDS - seconds))}</time><span>remaining · {MAX_CALL_SECONDS}-second call</span><div className={`practice-speech ${speaking && !muted && !reconnecting ? 'is-speaking' : ''}`} aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 90}ms` }} />)}</div><p className="practice-live-label" role="status">{liveLabel}</p></div> : <p>{dialContact ? `${scenario.name} · ${scenario.role}` : 'Choose a company or enter its extension.'}</p>}
          </div>
          </>}
          {status === 'idle' && <div className="practice-dialer-idle">
            <div className="practice-dialer-ready"><h3>Ready to practice</h3><p><Bot size={12} />Voice call with an AI partner</p></div>
            <div className="practice-line-settings">
              <span className="practice-line-label">Your practice line</span>
              <div className={`practice-line-status ${config?.available ? 'is-ready' : ''}`}>
                {!config ? <LoaderCircle size={13} className="practice-spinner" /> : config.available ? <CircleCheck size={13} /> : <WifiOff size={13} />}
                <span role="status">{serviceLabel}</span>
                {config && !config.available && <button type="button" aria-label="Retry connection" title="Retry connection" onClick={() => setConfigVersion(value => value + 1)}><RotateCcw size={13} /></button>}
              </div>
              <details className="practice-audio-settings">
                <summary><Volume2 size={14} aria-hidden="true" /><span>Speaker volume</span><span className="practice-volume-value">{volume}%</span><ChevronDown size={12} aria-hidden="true" /></summary>
                <div className="practice-volume-panel">
                  <div className="practice-volume-heading"><label htmlFor="practice-volume">Volume</label><output htmlFor="practice-volume">{volume}%</output></div>
                  <div className="practice-volume-slider"><Volume1 size={14} aria-hidden="true" /><input id="practice-volume" type="range" min="0" max="100" step="5" value={volume} aria-valuetext={`${volume}%`} style={{ backgroundSize: `${volume}% 3px, 100% 3px` }} onChange={event => setVolume(Number(event.target.value))} /><Volume2 size={14} aria-hidden="true" /></div>
                </div>
              </details>
            </div>
            <div className="practice-number">
              <label htmlFor="practice-extension" className="sr-only">Practice extension</label>
              <div><span aria-hidden="true"><Phone size={11} />EXT.</span><input id="practice-extension" type="tel" inputMode="tel" autoComplete="off" value={dialNumber} maxLength={3} placeholder="Enter extension" disabled={checkingMic} onChange={event => editNumber(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); startAttempt(); } }} aria-describedby="dial-number-help" /><button type="button" aria-label="Clear number" title="Clear number" disabled={checkingMic || !dialNumber} onClick={() => editNumber('')}><X size={15} /></button></div>
            </div>
            <div className="practice-keypad" role="group" aria-label="Dial pad">{dialKeys.map(([digit, letters]) => <button key={digit} type="button" disabled={checkingMic} aria-label={`Dial ${digit}`} onClick={() => editNumber(numberFromList ? digit : dialNumber + digit)}><strong>{digit}</strong><span aria-hidden="true">{letters || '\u00a0'}</span></button>)}</div>
            {config?.accessCodeRequired && <label className="practice-access">Practice access code<input type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} placeholder="From your training manager" /></label>}
            <div className="practice-dial-buttons">
              <button type="button" className="practice-backspace" aria-label="Delete last digit" title="Delete last digit" disabled={checkingMic || !dialNumber} onClick={() => editNumber(dialNumber.slice(0, -1))}><Delete size={18} /></button>
              <button type="button" className="practice-start-call" aria-label="Start practice call" title={canDial ? `Call ${contact.name} · AI partner` : 'Start practice call'} onClick={startAttempt} disabled={!config?.available || (config.accessCodeRequired && !code.trim()) || !voiceSupported || checkingMic || !canDial} aria-describedby="dial-number-help practice-availability"><Phone size={18} fill="currentColor" /></button>
            </div>
            <p id="dial-number-help" className="practice-dial-help" role="status">{!dialContact ? dialNumber.length === 3 ? 'This extension isn’t in your practice list.' : 'Enter a three-digit extension from the call list.' : !canDial ? `Complete level ${progress.level.number} to unlock this company.` : contact.company}</p>
            <div className="practice-dial-footer">
              <details className="practice-mic-settings">
                <summary><span className="practice-mic-symbol" aria-hidden="true"><Mic size={14} strokeWidth={1.7} /></span><span>Microphone check</span><span className="practice-mic-duration">6 sec</span><ChevronDown size={12} aria-hidden="true" /></summary>
                <MicrophoneCheckPanel onBusyChange={setCheckingMic} />
              </details>
              <p id="practice-availability">{!config ? 'Checking availability…' : !config.available ? configFailed ? 'We couldn’t reach the call service. Retry the connection above.' : 'Calling is unavailable until the practice service is connected.' : !voiceSupported ? 'Open the secure site in a browser with microphone support to make a call.' : checkingMic ? 'Finish or stop your microphone check to start the call.' : `AI practice call · ${MAX_CALL_SECONDS} seconds`}</p>
              <p className="practice-disclosure">Audio and transcripts are processed by OpenAI. Use fictional details.</p>
            </div>
          </div>}
          {status !== 'idle' && <div className="practice-call-actions">
            {status === 'connecting' && <div className="practice-connecting">
              <LoaderCircle size={23} className="practice-spinner" /><h3 role="status">{connectionCopy[0]}</h3><p>{connectionCopy[1]}</p>
              <ol aria-label="Call connection progress">{(['microphone', 'partner', 'connecting'] as const).map((phase, index) => <li key={phase} className={connectionPhase === phase ? 'is-current' : ''}><span>{index + 1}</span>{['Microphone', 'Partner', 'Audio'][index]}</li>)}</ol>
              <button type="button" className="text-button" onClick={resetAttempt}>Cancel</button>
            </div>}
            {status === 'active' && <>
              {audioBlocked && <div className="practice-audio-prompt" role="alert"><p>Your browser needs a tap to play your partner’s voice.</p><button type="button" className="button" onClick={() => void audio.current?.play().then(() => setAudioBlocked(false)).catch(() => setError('Your browser blocked audio. Check its sound permissions.'))}><Volume2 size={16} />Enable partner audio</button></div>}
              <div className="practice-controls"><button type="button" className="button practice-mute" aria-pressed={muted} onClick={() => { voice.current?.setMuted(!muted); setMuted(!muted); }}>{muted ? <MicOff size={20} /> : <Mic size={20} />}{muted ? 'Unmute microphone' : 'Mute microphone'}</button><button type="button" className="button practice-end" onClick={() => void endAttempt()}><PhoneOff size={20} />End practice</button></div>
              <p>{reconnecting ? 'Hold on while we try to restore the connection.' : muted ? 'Your partner can’t hear you until you unmute.' : 'Take your time. Pauses are part of the conversation.'}</p>
            </>}
            {status === 'ending' && <div className="practice-connecting" role="status"><LoaderCircle size={22} className="practice-spinner" /><h3>Finishing your transcript</h3><p>Your microphone is off. We’re collecting the last words for your review.</p></div>}
            {status === 'ended' && <>
              <div className="practice-ended-mark"><Check size={19} /></div>
              <h3 ref={reviewHeading} tabIndex={-1}>Call complete · {timeLabel(seconds)}</h3>
              <p>{busy ? 'Your coach is reviewing the conversation…' : feedback ? 'Your review is ready in the workspace. Take one idea into your next call.' : hasUserSpeech ? 'Your microphone is off. Get feedback on the conversation you just had.' : 'No completed replies were captured. Try another conversation to get feedback.'}</p>
              <div className="practice-controls">{busy ? <span className="practice-status" role="status"><LoaderCircle size={16} className="practice-spinner" />Preparing your feedback</span> : <>{hasUserSpeech && !feedback && <button type="button" className="button button-dark" onClick={() => void getFeedback()}><RotateCcw size={15} />Get my feedback</button>}{feedback && progress.completed < practiceContacts.length && <button type="button" className="button button-dark" onClick={() => selectContact(progress.nextContact)}>Next company<ArrowRight size={15} /></button>}<button type="button" className="button" onClick={resetAttempt}><RotateCcw size={15} />Practice again</button></>}</div>
            </>}
          </div>}
          {error && <div className="practice-error" role="alert">{error}</div>}
          {notice && <p className="practice-notice" role="status">{notice}</p>}
          <audio ref={audio} autoPlay />
        </section>
      </div>
    </div>
    {storageError && <p className="practice-notice" role="status">Browser storage is unavailable. Your progress and coaching are available for this visit but could not be saved.</p>}
    <button type="button" className="text-button practice-back" onClick={leave}><ChevronLeft size={14} />Back to the demos</button>
  </main>;
}
