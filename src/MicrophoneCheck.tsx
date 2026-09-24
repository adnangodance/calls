import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Mic, RotateCcw, Square } from 'lucide-react';
import { MicrophoneCheck } from './microphone-check';

export default function MicrophoneCheckPanel({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const [state, setState] = useState<'idle' | 'permission' | 'listening' | 'passed' | 'silent' | 'error'>('idle');
  const [device, setDevice] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const check = useRef<MicrophoneCheck | null>(null);
  const busy = state === 'permission' || state === 'listening';
  const supported = typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof AudioContext === 'function';
  useEffect(() => {
    const stop = () => { check.current?.stop(); setState('idle'); };
    window.addEventListener('pagehide', stop);
    return () => { check.current?.stop(); window.removeEventListener('pagehide', stop); };
  }, []);
  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);

  function start() {
    check.current?.stop(); setState('permission'); setError(''); setLevel(0);
    check.current = new MicrophoneCheck({
      onListening: name => { setDevice(name); setState('listening'); },
      onLevel: setLevel,
      onComplete: heardAudio => { setState(heardAudio ? 'passed' : 'silent'); setLevel(0); },
      onError: message => { setError(message); setState('error'); setLevel(0); },
    });
    void check.current.start();
  }
  const message = state === 'permission' ? 'Allow microphone access in your browser.'
    : state === 'listening' ? 'Say a few words. Watch the meter move.'
    : state === 'passed' ? 'Sound detected. Your microphone is ready.'
    : state === 'silent' ? 'No sound detected. Check your microphone’s mute switch and try again.'
    : state === 'error' ? error
    : supported ? 'A six-second sound check before your call.' : 'Microphone checks need a supported browser on a secure connection.';

  return <section className={`mic-check mic-check-${state}`} aria-labelledby="mic-check-title">
    <div className="mic-check-heading"><span className="mic-check-icon">{state === 'passed' ? <Check size={17} /> : <Mic size={17} />}</span><div><h3 id="mic-check-title">Check your microphone</h3><p>Optional · Audio stays on your device</p></div>
      {busy ? <button type="button" className="mic-check-button" onClick={() => { check.current?.stop(); setState('idle'); setLevel(0); }}><Square size={12} />Stop check</button>
        : <button type="button" className="mic-check-button" disabled={!supported} onClick={start}>{state === 'idle' ? <Mic size={13} /> : <RotateCcw size={13} />}{state === 'idle' ? 'Check microphone' : 'Check again'}</button>}
    </div>
    <div className="mic-check-message" role={state === 'error' ? 'alert' : 'status'}>{state === 'permission' && <LoaderCircle size={13} className="practice-spinner" />}{message}</div>
    {state === 'listening' && <><div className="mic-level" role="meter" aria-label="Microphone input level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={level}>{Array.from({ length: 24 }, (_, index) => <span key={index} className={level > index / 24 * 100 ? 'is-on' : ''} />)}</div><p className="mic-check-device">{device}</p></>}
  </section>;
}
