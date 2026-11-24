import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Segment, StreamEvent, Transcription } from '../models';

export type RecorderStatus = 'idle' | 'connecting' | 'recording' | 'finishing' | 'error';

/**
 * Captures microphone audio, converts it to 16 kHz PCM16 in an AudioWorklet and
 * streams it over a WebSocket to the backend gateway, exposing the live transcript
 * as Angular signals.
 */
@Injectable({ providedIn: 'root' })
export class RecorderService {
  private zone = inject(NgZone);

  readonly status = signal<RecorderStatus>('idle');
  readonly provider = signal<string | null>(null);
  readonly finals = signal<Segment[]>([]);
  readonly partial = signal('');
  readonly level = signal(0);
  readonly elapsed = signal(0);
  readonly error = signal<string | null>(null);
  readonly lastSaved = signal<Transcription | null>(null);

  private ws?: WebSocket;
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  /** Exposed for the audio visualisers (frequency + waveform). */
  analyser?: AnalyserNode;
  private timer?: ReturnType<typeof setInterval>;
  private startedAt = 0;

  async start(opts: { language: string; title?: string; save?: boolean }): Promise<void> {
    if (this.status() === 'recording' || this.status() === 'connecting') return;
    this.reset();
    this.status.set('connecting');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.ctx = new AudioContext();
      await this.ctx.audioWorklet.addModule('pcm-worklet.js');
      await this.openSocket();
    } catch (e: any) {
      this.fail(e?.name === 'NotAllowedError' ? 'Microphone permission denied.' : e?.message || String(e));
      return;
    }

    this.ws!.send(JSON.stringify({ type: 'start', language: opts.language, title: opts.title, save: opts.save ?? true }));

    const source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'pcm-downsampler');
    this.node.port.onmessage = ({ data }) => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data.pcm);
      this.level.set(Math.min(1, data.level * 6));
    };
    source.connect(this.node);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.78;
    source.connect(this.analyser);
    // Worklets only run when connected to the graph; route through a muted gain.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.node.connect(mute).connect(this.ctx.destination);

    this.startedAt = Date.now();
    this.timer = setInterval(() => this.elapsed.set((Date.now() - this.startedAt) / 1000), 250);
    this.status.set('recording');
  }

  /** Stop capturing; the server flushes the last utterance and saves the session. */
  stop(): void {
    if (this.status() !== 'recording') return;
    this.status.set('finishing');
    this.releaseAudio();
    this.ws?.send(JSON.stringify({ type: 'stop' }));
    // Safety net in case the server never answers.
    setTimeout(() => this.status() === 'finishing' && this.closeSocket('idle'), 15000);
  }

  get transcriptText(): string {
    return this.finals().map((s) => s.text).join(' ');
  }

  // ---------------------------------------------------------------------------
  private openSocket(): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/stream`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onmessage = (m) => this.zone.run(() => this.onEvent(JSON.parse(m.data) as StreamEvent));
    ws.onclose = () => this.zone.run(() => {
      if (this.status() === 'recording') this.fail('Connection to server lost.');
    });
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Cannot connect to the transcription server.'));
    });
  }

  private onEvent(evt: StreamEvent): void {
    switch (evt.type) {
      case 'ready':
        this.provider.set(evt.provider);
        break;
      case 'partial':
        this.partial.set(evt.text);
        break;
      case 'final':
        this.finals.update((f) => [...f, { text: evt.text, language: evt.language, start: evt.start, end: evt.end }]);
        this.partial.set('');
        break;
      case 'saved':
        this.lastSaved.set(evt.transcription);
        this.closeSocket('idle');
        break;
      case 'error':
        this.fail(evt.message);
        break;
    }
  }

  private fail(message: string): void {
    this.error.set(message);
    this.releaseAudio();
    this.closeSocket('error');
  }

  private releaseAudio(): void {
    clearInterval(this.timer);
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => undefined);
    this.node = this.stream = this.ctx = this.analyser = undefined;
    this.level.set(0);
  }

  private closeSocket(next: RecorderStatus): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close();
    this.ws = undefined;
    this.partial.set('');
    this.status.set(next);
  }

  private reset(): void {
    this.finals.set([]);
    this.partial.set('');
    this.error.set(null);
    this.lastSaved.set(null);
    this.elapsed.set(0);
  }
}
