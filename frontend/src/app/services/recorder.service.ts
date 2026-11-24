import { HttpClient } from '@angular/common/http';
import { Injectable, NgZone, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
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
  private http = inject(HttpClient);

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

  // --- browser (Web Speech API) engine ---------------------------------------
  private recognition?: any;
  private browserOpts?: { language: string; title?: string; save?: boolean };
  private segStart = 0;
  private levelRaf = 0;

  /** True when the server is in "browser" mode and this browser has Web Speech. */
  private async useBrowserEngine(): Promise<boolean> {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return false;
    try {
      const h = await firstValueFrom(this.http.get<{ stt?: { provider?: string } }>('/api/health'));
      return h.stt?.provider === 'browser';
    } catch {
      return false;
    }
  }

  async start(opts: { language: string; title?: string; save?: boolean }): Promise<void> {
    if (this.status() === 'recording' || this.status() === 'connecting') return;
    this.reset();
    this.status.set('connecting');

    if (await this.useBrowserEngine()) return this.startBrowser(opts);

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
    if (this.recognition) return this.stopBrowser();
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
  // Browser engine: Chrome/Edge speech recognition, saved to PostgreSQL via REST.
  private async startBrowser(opts: { language: string; title?: string; save?: boolean }): Promise<void> {
    try {
      // Mic stream only drives the visualisers / level meter here.
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      this.ctx = new AudioContext();
      const source = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.78;
      source.connect(this.analyser);
      const buf = new Float32Array(this.analyser.fftSize);
      const tick = () => {
        if (!this.analyser) return;
        this.analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        this.level.set(Math.min(1, Math.sqrt(sum / buf.length) * 6));
        this.levelRaf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e: any) {
      this.fail(e?.name === 'NotAllowedError' ? 'Microphone permission denied.' : e?.message || String(e));
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    // hi-IN transcribes Hindi and the English words people mix into it (Hinglish).
    const langMap: Record<string, string> = {
      auto: 'hi-IN', hi: 'hi-IN', en: 'en-IN', ta: 'ta-IN', te: 'te-IN', mr: 'mr-IN', bn: 'bn-IN', ar: 'ar-SA',
    };
    rec.lang = langMap[opts.language] || opts.language || 'hi-IN';
    this.browserOpts = opts;
    this.segStart = 0;
    this.recognition = rec;
    this.provider.set('browser');

    rec.onresult = (e: any) => this.zone.run(() => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = (r[0]?.transcript || '').trim();
        if (!text) continue;
        if (r.isFinal) {
          const now = (Date.now() - this.startedAt) / 1000;
          this.finals.update((f) => [...f, { text, language: scriptLanguage(text), start: +this.segStart.toFixed(2), end: +now.toFixed(2) }]);
          this.segStart = now;
        } else {
          interim += text + ' ';
        }
      }
      this.partial.set(interim.trim());
    });
    rec.onerror = (e: any) => this.zone.run(() => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // harmless; onend restarts
      this.fail(e.error === 'not-allowed' ? 'Microphone permission denied.' : `Speech recognition error: ${e.error}`);
    });
    // Chrome ends the session after a pause; keep listening until the user stops.
    rec.onend = () => this.zone.run(() => {
      if (this.status() === 'recording' && this.recognition === rec) {
        try { rec.start(); } catch { /* already starting */ }
      } else if (this.status() === 'finishing') {
        this.saveBrowserSession();
      }
    });

    try {
      rec.start();
    } catch (e: any) {
      this.fail(e?.message || String(e));
      return;
    }
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.elapsed.set((Date.now() - this.startedAt) / 1000), 250);
    this.status.set('recording');
  }

  private stopBrowser(): void {
    this.status.set('finishing');
    this.releaseAudio();
    try { this.recognition.stop(); } catch { this.saveBrowserSession(); }
    // Safety net if the browser never fires "end".
    setTimeout(() => this.status() === 'finishing' && this.saveBrowserSession(), 4000);
  }

  private async saveBrowserSession(): Promise<void> {
    if (this.status() !== 'finishing') return;
    const pending = this.partial().trim();
    if (pending) {
      const now = (Date.now() - this.startedAt) / 1000;
      this.finals.update((f) => [...f, { text: pending, language: scriptLanguage(pending), start: this.segStart, end: now }]);
    }
    this.recognition = undefined;
    this.partial.set('');
    const segments = this.finals();
    const text = segments.map((s) => s.text).join(' ').trim();
    const opts = this.browserOpts;
    if (!text || opts?.save === false) {
      this.status.set('idle');
      return;
    }
    try {
      const row = await firstValueFrom(this.http.post<Transcription>('/api/transcriptions', {
        title: opts?.title?.trim() || text.split(/\s+/).slice(0, 8).join(' ').slice(0, 200),
        text,
        provider: 'browser',
        segments,
        duration_sec: +this.elapsed().toFixed(2),
      }));
      this.lastSaved.set(row);
      this.status.set('idle');
    } catch (e: any) {
      this.fail(`Could not save transcription: ${e?.error?.error || e?.message || e}`);
    }
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
    if (this.recognition) {
      const r = this.recognition;
      this.recognition = undefined;
      try { r.abort(); } catch { /* ignore */ }
    }
    this.releaseAudio();
    this.closeSocket('error');
  }

  private releaseAudio(): void {
    clearInterval(this.timer);
    cancelAnimationFrame(this.levelRaf);
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

/** Guess hi / en / mixed from the script of a recognised phrase. */
function scriptLanguage(text: string): string | null {
  const hi = (text.match(/[\u0900-\u097F]/g) || []).length;
  const en = (text.match(/[A-Za-z]/g) || []).length;
  if (!hi && !en) return null;
  if (hi && en && Math.min(hi, en) / (hi + en) > 0.15) return 'mixed';
  return hi > en ? 'hi' : 'en';
}
