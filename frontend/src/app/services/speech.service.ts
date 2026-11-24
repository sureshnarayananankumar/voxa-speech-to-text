import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

/** Text-to-Speech: open-source Piper on the server, browser speechSynthesis as fallback. */
@Injectable({ providedIn: 'root' })
export class SpeechService {
  private api = inject(ApiService);
  readonly speakingId = signal<number | string | null>(null);
  private audio?: HTMLAudioElement;

  async speak(text: string, id: number | string = 'live', language = 'auto'): Promise<void> {
    this.stop();
    if (!text.trim()) return;
    this.speakingId.set(id);
    try {
      const blob = await this.api.tts(text, language);
      const url = URL.createObjectURL(blob);
      this.audio = new Audio(url);
      this.audio.onended = () => { URL.revokeObjectURL(url); this.speakingId.set(null); };
      await this.audio.play();
    } catch {
      this.browserSpeak(text);
    }
  }

  stop(): void {
    this.audio?.pause();
    this.audio = undefined;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.speakingId.set(null);
  }

  private browserSpeak(text: string): void {
    if (!('speechSynthesis' in window)) { this.speakingId.set(null); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = /[ऀ-ॿ]/.test(text) ? 'hi-IN' : 'en-IN';
    u.onend = u.onerror = () => this.speakingId.set(null);
    speechSynthesis.speak(u);
  }
}
