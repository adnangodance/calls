import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Clock3, Headphones, LoaderCircle, Mic, MicOff, Phone, PhoneOff, RotateCcw, Trash2, Volume2, WifiOff } from 'lucide-react';
import MicrophoneCheckPanel from './MicrophoneCheck';
import { MAX_CALL_SECONDS, practiceScenarios, validFeedback } from '../shared/practice.mjs';
import { PracticeVoice, practiceError, practiceRequest, updateTranscript, type Feedback, type PracticeConfig, type TranscriptLine } from './practice-client';

type Status = 'idle' | 'connecting' | 'active' | 'ending' | 'ended';
type Attempt = { id: string; scenario: string; mode: 'voice'; date: string; seconds: number; feedback: Feedback };
const HISTORY_KEY = 'targetone-practice-v1';
const timeLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const score = (feedback: Feedback) => feedback.criteria.reduce((sum, item) => sum + item.score, 0);

function readHistory(): Attempt[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && practiceScenarios.some(scenario => scenario.id === item.scenario)
      && item.mode === 'voice' && Number.isFinite(Date.parse(item.date)) && Number.isFinite(item.seconds)
      && item.seconds >= 0 && item.seconds <= MAX_CALL_SECONDS && validFeedback(item.feedback)).slice(0, 5) : [];
  } catch { return []; }
}

function FeedbackCard({ feedback }: { feedback: Feedback }) {
  return <div className="practice-feedback">
    <div className="practice-feedback-heading"><div><span className="journey-eyebrow">YOUR CALL REVIEW</span><h3>One conversation better.</h3></div><span className="practice-score">{score(feedback)}<small> / 20</small></span></div>
    <p>{feedback.summary}</p>
    <div className="practice-criteria">{feedback.criteria.map(item => <div key={item.name}><div><strong>{item.name}</strong><span>{item.score} / 5</span></div><div className="practice-score-track" aria-hidden="true"><span style={{ width: `${item.score * 20}%` }} /></div><p>{item.evidence}</p></div>)}</div>
    <div className="practice-next"><span className="journey-eyebrow">TRY THIS NEXT TIME</span><p>{feedback.nextAttempt}</p></div>
    <p className="practice-caption">AI coaching based on the available transcript. This is practice feedback, not a certification.</p>
  </div>;
}

export default function PracticePage({ onReview }: { onReview: () => void }) {
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const scenario = practiceScenarios[scenarioIndex];
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
  const [speaking, setSpeaking] = useState<'user' | 'assistant' | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [lines, setLines] = useState<TranscriptLine[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [history, setHistory] = useState<Attempt[]>(readHistory);
  const [storageError, setStorageError] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
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
    if (status !== 'active') return;
    const timer = setInterval(() => {
      const elapsed = Math.min(MAX_CALL_SECONDS, Math.floor((Date.now() - started.current) / 1000));
      setSeconds(elapsed);
      if (elapsed >= MAX_CALL_SECONDS) { setNotice('Your five-minute practice is complete.'); void endAttempt(); }
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

  function startAttempt() {
    if (locked || checkingMic || !config?.available) return;
    resetAttempt();
    const currentGeneration = generation.current;
    attemptId.current = crypto.randomUUID();
    setStatus('connecting');
    const isCurrent = () => mounted.current && generation.current === currentGeneration;
    const call = new PracticeVoice({
      scenario: scenario.id, code, audio: audio.current!,
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
      const result = await practiceRequest<{ feedback: Feedback }>('feedback', { scenario: scenario.id, messages }, { code, signal: abort.signal });
      if (!mounted.current || generation.current !== currentGeneration) return;
      if (!validFeedback(result.feedback)) throw new Error('Feedback could not be read. Please try again.');
      setFeedback(result.feedback);
      const attempt: Attempt = { id: attemptId.current, scenario: scenario.id, mode: 'voice', date: new Date().toISOString(), seconds: endedSeconds.current, feedback: result.feedback };
      // Store coaching summaries only; call audio and transcripts are not saved.
      const nextHistory = [attempt, ...history.filter(item => item.id !== attempt.id)].slice(0, 5);
      setHistory(nextHistory);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory)); setStorageError(false); } catch { setStorageError(true); }
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
      <div><span className="journey-eyebrow">YOUR NEXT CONVERSATION</span><h1 id="practice-title" data-journey-heading tabIndex={-1}>AI call practice</h1><p>Find your words before the real call. A short conversation, a little feedback, and a fresh start whenever you need one.</p></div>
      <span className="journey-passed"><CircleCheck size={14} />Demos passed</span>
    </header>
    <div className="practice-layout">
      <section className="practice-scenarios" aria-labelledby="scenario-title">
        <span className="journey-eyebrow">{inCall ? 'YOUR CALL BRIEF' : 'PICK A MOMENT TO PRACTICE'}</span>
        <h2 id="scenario-title">{inCall ? scenario.title : 'Choose your conversation'}</h2>
        <p>{inCall ? 'Keep these goals in mind. There’s no script to get right.' : 'Start with an introduction, or work on a trickier moment.'}</p>
        <fieldset className="scenario-options" disabled={locked} hidden={inCall}><legend className="sr-only">Practice scenario</legend>{practiceScenarios.map((item, index) => <label key={item.id} className={`scenario-option ${scenarioIndex === index ? 'is-selected' : ''}`}>
          <input type="radio" name="practice-scenario" value={index} checked={scenarioIndex === index} onChange={() => { resetAttempt(); setScenarioIndex(index); }} />
          <span className="scenario-symbol" aria-hidden="true">0{index + 1}</span><span><strong>{item.title}</strong><span>{item.subtitle}</span></span><span className="scenario-radio" aria-hidden="true">{scenarioIndex === index && <Check size={11} />}</span>
        </label>)}</fieldset>
        <div className="practice-goal"><span className="journey-eyebrow">A GOOD CALL GETS HERE</span><p>{scenario.goal}</p><ul className="practice-checklist">{scenario.checklist.map(item => <li key={item}><CircleCheck size={15} />{item}</li>)}</ul></div>
        <div className="practice-tip"><Headphones size={20} /><p><strong>Make yourself comfortable.</strong>Find a quiet spot and use headphones. Speak naturally, ask questions, and interrupt when you need to.</p></div>
      </section>
      <div className="practice-room">
        <section className={`practice-dialer ${status === 'active' ? 'is-live' : ''} ${reconnecting ? 'is-reconnecting' : ''}`} aria-labelledby="practice-partner-title">
          <div className="practice-dialer-top"><span><Clock3 size={13} />{status === 'active' ? 'Practice in progress' : status === 'ended' ? 'Call ended' : 'A 5-minute practice call'}</span><span className="practice-ai-label">AI PARTNER</span></div>
          <div className="practice-partner">
            <div className={`practice-avatar ${status === 'active' && speaking === 'assistant' && !reconnecting ? 'is-speaking' : ''}`} aria-hidden="true">{scenario.name.slice(0, 1)}<span><Phone size={14} /></span></div>
            <span className="journey-eyebrow">{scenario.name.toUpperCase()} · YOUR AI PRACTICE PARTNER</span>
            <h2 id="practice-partner-title" ref={roomHeading} tabIndex={-1}>{scenario.role}</h2>
            {status === 'active' ? <div className="practice-live-display"><time>{timeLabel(seconds)}</time><span>of 5:00</span><div className={`practice-speech ${speaking && !muted && !reconnecting ? 'is-speaking' : ''}`} aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 90}ms` }} />)}</div><p className="practice-live-label" role="status">{liveLabel}</p></div> : <p>{scenario.brief}</p>}
          </div>
          {status === 'idle' && <div className="practice-preflight">
            <div className={`practice-service ${config?.available ? 'is-ready' : 'is-unavailable'}`}>
              {!config ? <LoaderCircle size={17} className="practice-spinner" /> : config.available ? <CircleCheck size={17} /> : <WifiOff size={17} />}
              <div><strong role="status">{serviceLabel}</strong>{config && !config.available && <p>{configFailed ? 'We couldn’t reach the call service. Try again, or let your training manager know.' : 'Your training manager needs to connect the practice service. You can check your microphone while you wait.'}</p>}</div>
              {config && !config.available && <button type="button" className="text-button" onClick={() => setConfigVersion(value => value + 1)}><RotateCcw size={13} />Retry connection</button>}
            </div>
            <MicrophoneCheckPanel onBusyChange={setCheckingMic} />
          </div>}
          <div className="practice-call-actions">
            {status === 'idle' && <>
              {config?.accessCodeRequired && <label className="practice-access">Practice access code<input type="password" autoComplete="off" value={code} onChange={event => setCode(event.target.value)} placeholder="From your training manager" /></label>}
              <button type="button" className="button button-dark journey-primary" onClick={startAttempt} disabled={!config?.available || (config.accessCodeRequired && !code.trim()) || !voiceSupported || checkingMic} aria-describedby="practice-availability"><Phone size={16} />Start practice call<ArrowRight size={16} /></button>
              <p id="practice-availability">{!config ? 'Checking availability…' : !config.available ? 'Calling is unavailable until the practice service is connected.' : !voiceSupported ? 'Open the secure site in a browser with microphone support to make a call.' : checkingMic ? 'Finish or stop your microphone check to start the call.' : 'Your partner will say hello. Then it’s your turn.'}</p>
              <p className="practice-disclosure">You’re talking to AI. Call audio and transcripts are processed by OpenAI. Use fictional details.</p>
            </>}
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
              <p>{busy ? 'Your coach is reviewing the conversation…' : feedback ? 'Your review is ready below. Take one idea into your next call.' : hasUserSpeech ? 'Your microphone is off. Get feedback on the conversation you just had.' : 'No completed replies were captured. Try another conversation to get feedback.'}</p>
              <div className="practice-controls">{busy ? <span className="practice-status" role="status"><LoaderCircle size={16} className="practice-spinner" />Preparing your feedback</span> : <>{hasUserSpeech && !feedback && <button type="button" className="button button-dark" onClick={() => void getFeedback()}><RotateCcw size={15} />Get my feedback</button>}<button type="button" className="button button-dark" onClick={resetAttempt}><RotateCcw size={15} />Practice again</button></>}</div>
            </>}
          </div>
          {error && <div className="practice-error" role="alert">{error}</div>}
          {notice && <p className="practice-notice" role="status">{notice}</p>}
          <audio ref={audio} autoPlay />
        </section>
        {feedback && <FeedbackCard feedback={feedback} />}
        {(status === 'active' || status === 'ending' || status === 'ended' || lines.length > 0) && <section className="practice-conversation" aria-labelledby="conversation-title">
          <h2 id="conversation-title"><button type="button" className="practice-transcript-toggle" aria-expanded={showTranscript} aria-controls="practice-transcript-panel" onClick={() => setShowTranscript(value => !value)}><span><span>{status === 'active' ? 'Live transcript' : 'Your conversation'}</span><small>{lines.filter(line => line.text.trim()).length} turns captured</small></span><ChevronDown size={17} /></button></h2>
          <div id="practice-transcript-panel" hidden={!showTranscript}>
            <div className="practice-transcript" ref={transcript} role="log" aria-label="Practice conversation" aria-live="polite" aria-relevant="additions text">{lines.length ? lines.map(line => <div key={line.id} className={`practice-message from-${line.role}`}><span>{line.role === 'user' ? 'You' : `${scenario.name} · AI`}</span><p>{line.text || (status === 'ended' ? 'Transcript unavailable' : 'Listening…')}</p></div>) : <p className="practice-transcript-empty">Your words will appear here as you speak.</p>}</div>
            <p className="practice-caption">Transcripts can miss or mishear words. This transcript is cleared when you leave or start again.</p>
          </div>
        </section>}
      </div>
    </div>
    {history.length > 0 && !inCall && <section className="practice-history" aria-labelledby="practice-history-title"><div><div><span className="journey-eyebrow">KEEP BUILDING CONFIDENCE</span><h2 id="practice-history-title">Recent practice</h2></div><button type="button" className="text-button" disabled={busy} onClick={() => { try { localStorage.removeItem(HISTORY_KEY); setHistory([]); setStorageError(false); } catch { setStorageError(true); } }}><Trash2 size={13} />Clear history</button></div><p className="practice-caption">Your last five coaching summaries, saved on this browser. Audio and transcripts are not saved.</p>{history.map(attempt => <details key={attempt.id}><summary><span><strong>{practiceScenarios.find(item => item.id === attempt.scenario)?.title}</strong><span>{new Date(attempt.date).toLocaleDateString()} · Voice call · {timeLabel(attempt.seconds)}</span></span><span>{score(attempt.feedback)} / 20<ChevronDown size={15} /></span></summary><FeedbackCard feedback={attempt.feedback} /></details>)}</section>}
    {storageError && <p className="practice-notice" role="status">Browser storage is unavailable. Your coaching summary could not be saved or cleared.</p>}
    <button type="button" className="text-button practice-back" onClick={leave}><ChevronLeft size={14} />Back to the demos</button>
  </main>;
}
