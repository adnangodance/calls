import { CALL_CONNECTION_SECONDS } from '../shared/practice.mjs';

export type TranscriptLine = { id: string; role: 'user' | 'assistant'; text: string; pending?: boolean };
export type Feedback = { summary: string; nextAttempt: string; criteria: { name: string; score: number; evidence: string }[] };
export type PracticeConfig = { available: boolean; accessCodeRequired: boolean; maxCallSeconds: number };

const apiBase = (import.meta.env.VITE_PRACTICE_API_URL || '').replace(/\/$/, '');
export async function practiceRequest<T>(action: string, body?: unknown, options: { code?: string; signal?: AbortSignal; keepalive?: boolean } = {}): Promise<T> {
  const response = await fetch(`${apiBase}/api/practice/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(options.code ? { Authorization: `Bearer ${options.code}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
    keepalive: options.keepalive,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || 'Practice is unavailable. Please try again or contact your training manager.');
  return data as T;
}

export function practiceError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Microphone access was blocked. Allow it in your browser and try again.';
    if (error.name === 'NotFoundError') return 'No microphone was found. Connect one and try again.';
    if (error.name === 'NotReadableError') return 'Your microphone is busy. Close other apps using it and try again.';
    if (error.name === 'TimeoutError') return 'The connection took too long. Please try again.';
    if (error instanceof TypeError) return 'Practice could not connect. Check your connection and try again.';
    return error.message;
  }
  return 'Something interrupted practice. Please try again.';
}

// Keep conversation order based on item creation, not transcription completion.
export function updateTranscript(lines: TranscriptLine[], event: Record<string, any>): TranscriptLine[] {
  if (event.type === 'input_audio_buffer.speech_started' && typeof event.item_id === 'string' && !lines.some(line => line.id === event.item_id)) {
    return [...lines, { id: event.item_id, role: 'user', text: '', pending: true }];
  }
  const item = event.item;
  if (event.type === 'conversation.item.added' && item?.type === 'message' && ['user', 'assistant'].includes(item.role) && !lines.some(line => line.id === item.id)) {
    return [...lines, { id: item.id, role: item.role, text: '', pending: true }];
  }
  const role = event.type === 'conversation.item.input_audio_transcription.completed' ? 'user'
    : ['response.output_audio_transcript.delta', 'response.output_audio_transcript.done'].includes(event.type) ? 'assistant' : null;
  if (!role || typeof event.item_id !== 'string') return lines;
  const previous = lines.find(line => line.id === event.item_id);
  const text = event.type.endsWith('.delta') ? (previous?.text || '') + (event.delta || '') : event.transcript;
  if (typeof text !== 'string') return lines;
  const next = { id: event.item_id, role, text, pending: event.type.endsWith('.delta') } as TranscriptLine;
  return previous ? lines.map(line => line.id === next.id ? next : line) : [...lines, next];
}

type VoiceOptions = {
  scenario: string; contactId?: string; code: string; audio: HTMLAudioElement;
  onConnected: () => void; onEvent: (event: Record<string, any>) => void;
  onError: (message: string) => void; onAudioBlocked: () => void;
  onPhase?: (phase: 'microphone' | 'partner' | 'connecting') => void;
  onNetworkState?: (state: 'connected' | 'reconnecting') => void;
};

export class PracticeVoice {
  private peer?: RTCPeerConnection;
  private stream?: MediaStream;
  private channel?: RTCDataChannel;
  private sessionId?: string;
  private closed = false;
  private finishing = false;
  private uncommittedInput = false;
  private pendingTranscripts = new Set<string>();
  private finishTimer?: ReturnType<typeof setTimeout>;
  private finishPromise?: Promise<void>;
  private finishResolve?: () => void;
  private connectionTimer?: ReturnType<typeof setTimeout>;
  private disconnectTimer?: ReturnType<typeof setTimeout>;
  constructor(private options: VoiceOptions) {}

  async start() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) throw new Error('Voice calls need a supported browser over HTTPS or localhost. Open the secure site in a browser with microphone support.');
      this.connectionTimer = setTimeout(() => this.fail('The call could not connect. Check microphone permissions and try again.'), CALL_CONNECTION_SECONDS * 1000);
      this.options.onPhase?.('microphone');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.options.onPhase?.('partner');
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => this.fail('The microphone disconnected. Reconnect it and start a new call.')));
      const peer = this.peer = new RTCPeerConnection();
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      peer.ontrack = event => {
        if (this.closed || this.finishing) return;
        this.options.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        void this.options.audio.play().catch(() => { if (!this.closed) this.options.onAudioBlocked(); });
      };
      peer.onconnectionstatechange = () => {
        if (this.closed) return;
        clearTimeout(this.disconnectTimer);
        if (peer.connectionState === 'connected') this.options.onNetworkState?.('connected');
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') this.fail('The call disconnected. You can review this attempt or try again.');
        if (peer.connectionState === 'disconnected') {
          this.options.onNetworkState?.('reconnecting');
          this.disconnectTimer = setTimeout(() => this.fail('The call lost its connection. Please try again.'), 5000);
        }
      };
      const channel = this.channel = peer.createDataChannel('oai-events');
      channel.onopen = () => {
        if (this.closed) return;
        clearTimeout(this.connectionTimer);
        if (this.sessionId) void practiceRequest('connected', { sessionId: this.sessionId }, { code: this.options.code }).catch(() => {});
        this.options.onConnected();
        channel.send(JSON.stringify({ type: 'response.create' }));
      };
      channel.onmessage = event => {
        if (this.closed) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (!message || typeof message !== 'object') return;
        if (message.type === 'input_audio_buffer.speech_started') {
          this.uncommittedInput = true;
          if (typeof message.item_id === 'string') this.pendingTranscripts.add(message.item_id);
        }
        if (message.type === 'input_audio_buffer.committed') {
          this.uncommittedInput = false;
          if (typeof message.item_id === 'string') this.pendingTranscripts.add(message.item_id);
        }
        if (['conversation.item.input_audio_transcription.completed', 'conversation.item.input_audio_transcription.failed'].includes(message.type)) {
          this.pendingTranscripts.delete(message.item_id);
        }
        if (message.type === 'error' || (message.type === 'response.done' && message.response?.status === 'failed')) {
          // An empty commit can race with automatic turn detection while ending.
          // Allow the final transcript a bounded window; do not revive the call.
          if (this.finishing) return;
          this.fail('The AI call was interrupted. Please try again.');
          return;
        }
        this.options.onEvent(message);
        if (this.finishing && !this.uncommittedInput && this.pendingTranscripts.size === 0) this.stop();
      };
      channel.onerror = () => this.fail('The call connection failed. Please try again.');
      channel.onclose = () => { if (!this.closed) this.fail('The call ended. You can review this attempt or try again.'); };
      const offer = await peer.createOffer();
      if (this.closed) return;
      await peer.setLocalDescription(offer);
      if (this.closed) return;
      // Keep the session response alive on cancel so an allocated call can be hung up.
      const session = await practiceRequest<{ sdp: string; sessionId: string }>('session', { scenario: this.options.scenario, contactId: this.options.contactId, sdp: offer.sdp }, { code: this.options.code });
      this.sessionId = session.sessionId;
      if (this.closed) { this.endRemote(); return; }
      this.options.onPhase?.('connecting');
      await peer.setRemoteDescription({ type: 'answer', sdp: session.sdp });
    } catch (error) { if (!this.closed) this.fail(practiceError(error)); }
  }

  setMuted(muted: boolean) { this.stream?.getAudioTracks().forEach(track => { track.enabled = !muted; }); }

  finish(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.finishPromise) return this.finishPromise;
    this.finishing = true;
    this.stream?.getTracks().forEach(track => track.stop());
    this.options.audio.pause(); this.options.audio.srcObject = null;
    if (!this.uncommittedInput && this.pendingTranscripts.size === 0) { this.stop(); return Promise.resolve(); }
    this.finishPromise = new Promise(resolve => {
      this.finishResolve = resolve;
      this.finishTimer = setTimeout(() => {
        this.options.onEvent({ type: 'practice.transcript.incomplete' });
        this.stop();
      }, 2000);
      if (this.uncommittedInput && this.channel?.readyState === 'open') {
        try { this.channel.send(JSON.stringify({ type: 'input_audio_buffer.commit' })); } catch { this.stop(); }
      }
    });
    return this.finishPromise;
  }

  private fail(message: string) {
    if (this.closed) return;
    if (this.finishing) { this.stop(); return; }
    this.stop();
    this.options.onError(message);
  }

  private endRemote() {
    if (!this.sessionId) return;
    void practiceRequest('end', { sessionId: this.sessionId }, { code: this.options.code, keepalive: true }).catch(() => {});
    this.sessionId = undefined;
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.connectionTimer);
    clearTimeout(this.disconnectTimer);
    clearTimeout(this.finishTimer);
    this.stream?.getTracks().forEach(track => track.stop());
    this.channel?.close();
    this.peer?.close();
    this.options.audio.pause();
    this.options.audio.srcObject = null;
    this.endRemote();
    this.finishResolve?.(); this.finishResolve = undefined;
  }
}
