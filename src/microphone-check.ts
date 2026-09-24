import { practiceError } from './practice-client';

type CheckOptions = {
  onListening: (device: string) => void;
  onLevel: (level: number) => void;
  onComplete: (heardAudio: boolean) => void;
  onError: (message: string) => void;
};

// This check only measures local audio; it never records or sends it anywhere.
export class MicrophoneCheck {
  private stream?: MediaStream;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private sampleTimer?: ReturnType<typeof setInterval>;
  private timeout?: ReturnType<typeof setTimeout>;
  private closed = false;
  private audibleSamples = 0;
  constructor(private options: CheckOptions) {}

  async start() {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext !== 'function') throw new Error('Microphone checks need a browser with audio support on a secure connection.');
      this.timeout = setTimeout(() => this.fail('Microphone permission is still pending. Allow access in your browser, then try again.'), 20000);
      // Resume within the click gesture, before waiting for microphone permission.
      const context = this.context = new AudioContext();
      await context.resume();
      if (this.closed) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      clearTimeout(this.timeout);
      stream.getAudioTracks().forEach(track => track.addEventListener('ended', () => this.fail('The microphone disconnected. Reconnect it and check again.')));
      this.analyser = context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.source = context.createMediaStreamSource(stream);
      this.source.connect(this.analyser);
      const samples = new Float32Array(this.analyser.fftSize);
      this.options.onListening(stream.getAudioTracks()[0]?.label || 'Default microphone');
      this.sampleTimer = setInterval(() => {
        if (this.closed || !this.analyser) return;
        this.analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        if (rms > 0.012) this.audibleSamples++;
        this.options.onLevel(Math.min(100, Math.round(rms * 650)));
      }, 80);
      this.timeout = setTimeout(() => {
        const heardAudio = this.audibleSamples >= 5;
        this.stop();
        this.options.onComplete(heardAudio);
      }, 6000);
    } catch (error) { if (!this.closed) this.fail(practiceError(error)); }
  }

  private fail(message: string) {
    if (this.closed) return;
    this.stop(); this.options.onError(message);
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.sampleTimer); clearTimeout(this.timeout);
    this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect(); this.analyser?.disconnect();
    void this.context?.close().catch(() => {});
  }
}
