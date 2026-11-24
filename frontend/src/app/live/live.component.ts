import { Component, ElementRef, HostListener, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DecimalPipe } from '@angular/common';
import { RecorderService } from '../services/recorder.service';
import { SpeechService } from '../services/speech.service';
import { ToastService } from '../ui/toast.service';
import { IconComponent } from '../ui/icon.component';
import { OrbVisualizerComponent } from '../ui/orb-visualizer.component';
import { WaveVisualizerComponent } from '../ui/wave-visualizer.component';
import { LANGUAGES, LANGUAGE_NAMES } from '../models';

const LANG_COLORS: Record<string, string> = { hi: '#fb923c', en: '#22d3ee', mixed: '#c084fc' };

@Component({
  selector: 'app-live',
  standalone: true,
  imports: [FormsModule, DecimalPipe, IconComponent, OrbVisualizerComponent, WaveVisualizerComponent],
  templateUrl: './live.component.html',
  styleUrl: './live.component.css',
})
export class LiveComponent {
  rec = inject(RecorderService);
  speech = inject(SpeechService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private http = inject(HttpClient);
  /** Live PostgreSQL connectivity, from the backend's /api/health. */
  dbOnline = signal(false);
  private stream = viewChild<ElementRef<HTMLElement>>('stream');

  quickLangs = [
    { code: 'auto', label: 'AUTO', hint: 'Detect · Hinglish' },
    { code: 'hi', label: 'हिंदी', hint: 'Devanagari' },
    { code: 'en', label: 'EN', hint: 'Roman script' },
  ];
  moreLangs = LANGUAGES.filter((l) => !['auto', 'hi', 'en'].includes(l.code));
  language = signal('auto');
  title = '';
  save = signal(true);
  copied = signal(false);

  busy = computed(() => !['idle', 'error'].includes(this.rec.status()));
  recording = computed(() => this.rec.status() === 'recording');
  orbState = computed(() => {
    const s = this.rec.status();
    return s === 'recording' ? 'listening' : s === 'connecting' || s === 'finishing' ? 'thinking' : s === 'error' ? 'error' : 'idle';
  });

  /** finals split into words so each can animate in */
  lines = computed(() => this.rec.finals().map((s) => ({ ...s, words: s.text.split(/\s+/).filter(Boolean) })));
  /** finalised + in-flight words, so the counter ticks while you speak */
  wordCount = computed(() => this.lines().reduce((n, l) => n + l.words.length, 0)
    + (this.rec.partial() ? this.rec.partial().split(/\s+/).filter(Boolean).length : 0));
  wpm = computed(() => {
    const min = this.rec.elapsed() / 60;
    return min > 0.05 ? Math.round(this.wordCount() / min) : 0;
  });
  langMix = computed(() => {
    const counts: Record<string, number> = {};
    for (const l of this.lines()) counts[l.language || 'unknown'] = (counts[l.language || 'unknown'] || 0) + l.words.length;
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => ({ code, name: LANGUAGE_NAMES[code] ?? code, pct: (n / total) * 100, color: LANG_COLORS[code] ?? '#818cf8' }));
  });
  timer = computed(() => {
    const t = this.rec.elapsed();
    const m = Math.floor(t / 60), s = Math.floor(t % 60), d = Math.floor((t * 10) % 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
  });
  statusText = computed(() => ({
    idle: 'STANDBY', connecting: 'HANDSHAKE', recording: 'LISTENING', finishing: 'FINALIZING', error: 'FAULT',
  })[this.rec.status()]);

  constructor() {
    this.http.get<{ db?: { status: string } }>('/api/health').subscribe({
      next: (h) => this.dbOnline.set(h.db?.status === 'ok'),
      error: () => this.dbOnline.set(false),
    });
    // keep the newest words in view
    effect(() => {
      this.rec.finals(); this.rec.partial();
      const el = this.stream()?.nativeElement;
      if (el) queueMicrotask(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    });
    effect(() => {
      const saved = this.rec.lastSaved();
      if (saved) this.toast.ok('Transcription archived', `“${saved.title}” · ${saved.text.split(/\s+/).length} words saved to PostgreSQL`);
    });
    effect(() => {
      const err = this.rec.error();
      if (err) this.toast.error('Stream interrupted', err);
    });
  }

  langName = (c: string | null) => (c ? LANGUAGE_NAMES[c] ?? c : '');
  fmtTs = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  toggle(): void {
    if (this.recording()) this.rec.stop();
    else if (!this.busy()) this.rec.start({ language: this.language(), title: this.title, save: this.save() });
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
    if (e.code === 'Space') { e.preventDefault(); this.toggle(); }
    if (e.code === 'Escape' && this.recording()) this.rec.stop();
  }

  speak(): void {
    if (this.speech.speakingId() === 'live') this.speech.stop();
    else this.speech.speak(this.rec.transcriptText, 'live');
  }

  async copy(): Promise<void> {
    await navigator.clipboard.writeText(this.rec.transcriptText);
    this.copied.set(true);
    this.toast.info('Copied to clipboard');
    setTimeout(() => this.copied.set(false), 1500);
  }

  openArchive(): void { this.router.navigate(['/history']); }
}
