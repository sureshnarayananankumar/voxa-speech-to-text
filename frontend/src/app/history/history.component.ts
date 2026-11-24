import { Component, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, debounceTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApiService } from '../services/api.service';
import { SpeechService } from '../services/speech.service';
import { ToastService } from '../ui/toast.service';
import { IconComponent } from '../ui/icon.component';
import { CountUpComponent } from '../ui/count-up.component';
import { LANGUAGE_NAMES, Segment, Stats, Transcription } from '../models';

type DrawerMode = 'view' | 'edit' | 'create';
const LANG_COLORS: Record<string, string> = { hi: '#fb923c', en: '#22d3ee', mixed: '#c084fc', unknown: '#64748b' };

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [FormsModule, DatePipe, DecimalPipe, IconComponent, CountUpComponent],
  templateUrl: './history.component.html',
  styleUrl: './history.component.css',
})
export class HistoryComponent implements OnInit {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  speech = inject(SpeechService);
  private searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  readonly limit = 12;
  items = signal<Transcription[]>([]);
  total = signal(0);
  offset = signal(0);
  q = signal('');
  language = signal('');
  sort = signal('created_at:desc');
  view = signal<'grid' | 'table'>('grid');
  loading = signal(true);
  error = signal<string | null>(null);
  stats = signal<Stats | null>(null);

  drawer = signal<DrawerMode | null>(null);
  selected = signal<Transcription | null>(null);
  confirmDelete = signal<Transcription | null>(null);
  form: { title: string; text: string; language: string | null } = { title: '', text: '', language: null };
  saving = signal(false);
  formError = signal<string | null>(null);

  search$ = new Subject<string>();
  langFilters = ['', 'hi', 'en', 'mixed'];
  languageOptions = ['hi', 'en', 'mixed', 'ta', 'te', 'mr', 'bn', 'ar', 'ur'];
  skeletons = Array.from({ length: 6 });
  langName = (c: string | null) => (c ? LANGUAGE_NAMES[c] ?? c : 'Unknown');
  langColor = (c: string | null) => LANG_COLORS[c || 'unknown'] ?? '#818cf8';
  page = computed(() => Math.floor(this.offset() / this.limit) + 1);
  pages = computed(() => Math.max(1, Math.ceil(this.total() / this.limit)));

  /** conic-gradient for the language donut */
  donut = computed(() => {
    const s = this.stats();
    if (!s || !s.total) return 'conic-gradient(rgb(255 255 255 / .08) 0 100%)';
    let acc = 0;
    const parts = s.by_language.map((l) => {
      const from = acc; acc += (l.count / s.total) * 100;
      return `${this.langColor(l.language)} ${from}% ${acc}%`;
    });
    return `conic-gradient(${parts.join(', ')})`;
  });

  constructor() {
    this.search$.pipe(debounceTime(280), takeUntilDestroyed()).subscribe((v) => { this.q.set(v); this.goto(0); });
  }

  ngOnInit(): void { this.load(); }

  // ---- keyboard shortcuts ---------------------------------------------------
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const tag = (e.target as HTMLElement)?.tagName;
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
    if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
      e.preventDefault();
      this.searchBox()?.nativeElement.focus();
    } else if (e.key === 'Escape') {
      if (this.confirmDelete()) this.confirmDelete.set(null);
      else if (this.drawer()) this.closeDrawer();
    } else if (e.key === 'n' && !typing && !this.drawer()) {
      this.openCreate();
    }
  }

  // ---- data -----------------------------------------------------------------
  goto(offset: number): void { this.offset.set(Math.max(0, offset)); this.load(); }

  load(): void {
    this.loading.set(true);
    const [sort, order] = this.sort().split(':') as [string, 'asc' | 'desc'];
    this.api.list({ q: this.q(), language: this.language(), limit: this.limit, offset: this.offset(), sort, order })
      .subscribe({
        next: (p) => { this.items.set(p.items); this.total.set(p.total); this.error.set(null); this.loading.set(false); },
        error: (e) => { this.error.set(this.msg(e)); this.loading.set(false); },
      });
    this.api.stats().subscribe({ next: (s) => this.stats.set(s), error: () => undefined });
  }

  // ---- drawer ---------------------------------------------------------------
  open(t: Transcription, mode: DrawerMode = 'view'): void {
    this.selected.set(t);
    this.form = { title: t.title, text: t.text, language: t.language };
    this.formError.set(null);
    this.drawer.set(mode);
  }

  openCreate(): void {
    this.selected.set(null);
    this.form = { title: '', text: '', language: null };
    this.formError.set(null);
    this.drawer.set('create');
  }

  closeDrawer(): void { this.drawer.set(null); this.speech.stop(); }

  submit(): void {
    this.saving.set(true);
    const creating = this.drawer() === 'create';
    const req = creating ? this.api.create(this.form) : this.api.update(this.selected()!.id, this.form);
    req.subscribe({
      next: (row) => {
        this.saving.set(false);
        this.selected.set(row);
        this.drawer.set('view');
        this.toast.ok(creating ? 'Transcription created' : 'Changes saved', row.title);
        this.load();
      },
      error: (e) => { this.saving.set(false); this.formError.set(this.msg(e)); },
    });
  }

  askDelete(t: Transcription, ev?: Event): void { ev?.stopPropagation(); this.confirmDelete.set(t); }

  doDelete(): void {
    const t = this.confirmDelete();
    if (!t) return;
    this.api.delete(t.id).subscribe({
      next: () => {
        this.confirmDelete.set(null);
        if (this.selected()?.id === t.id) this.closeDrawer();
        if (this.items().length === 1 && this.offset() > 0) this.offset.update((o) => o - this.limit);
        this.toast.info('Transcription deleted', t.title);
        this.load();
      },
      error: (e) => this.toast.error('Delete failed', this.msg(e)),
    });
  }

  toggleSpeak(t: Transcription, ev?: Event): void {
    ev?.stopPropagation();
    if (this.speech.speakingId() === t.id) this.speech.stop();
    else this.speech.speak(t.text, t.id, t.language === 'hi' ? 'hi' : 'auto');
  }

  speakSegment(s: Segment, i: number): void {
    const id = `seg-${i}`;
    if (this.speech.speakingId() === id) this.speech.stop();
    else this.speech.speak(s.text, id, s.language === 'hi' ? 'hi' : 'auto');
  }

  async copy(t: Transcription): Promise<void> {
    await navigator.clipboard.writeText(t.text);
    this.toast.info('Copied to clipboard');
  }

  // ---- visuals --------------------------------------------------------------
  /** Deterministic pseudo-waveform per record (decorative signature). */
  bars(t: Transcription): number[] {
    let seed = t.id * 9301 + t.text.length * 49297;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    return Array.from({ length: 36 }, (_, i) => 18 + rnd() * 70 * Math.sin((i / 36) * Math.PI) + 10);
  }

  timeline(t: Transcription) {
    const dur = Math.max(t.duration_sec || 0, ...t.segments.map((s) => s.end || 0), 0.001);
    return t.segments.map((s) => ({
      left: (s.start / dur) * 100,
      width: Math.max(1.5, ((s.end - s.start) / dur) * 100),
      color: this.langColor(s.language),
      text: s.text,
    }));
  }

  words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  fmtTs = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  private msg(e: any): string { return e?.error?.error || e?.message || 'Request failed'; }
}
