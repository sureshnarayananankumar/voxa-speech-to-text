import { Component, Injectable, inject, signal } from '@angular/core';

export interface Toast { id: number; kind: 'ok' | 'error' | 'info'; title: string; body?: string; }

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  show(kind: Toast['kind'], title: string, body?: string, ms = 4200): void {
    const t = { id: ++this.seq, kind, title, body };
    this.toasts.update((l) => [...l, t]);
    setTimeout(() => this.dismiss(t.id), ms);
  }
  ok(title: string, body?: string) { this.show('ok', title, body); }
  error(title: string, body?: string) { this.show('error', title, body, 6500); }
  info(title: string, body?: string) { this.show('info', title, body); }
  dismiss(id: number) { this.toasts.update((l) => l.filter((t) => t.id !== id)); }
}

@Component({
  selector: 'app-toasts',
  standalone: true,
  template: `
    <div class="stack">
      @for (t of svc.toasts(); track t.id) {
        <div class="toast" [attr.data-kind]="t.kind" (click)="svc.dismiss(t.id)">
          <span class="bar"></span>
          <div><b>{{ t.title }}</b>@if (t.body) {<p>{{ t.body }}</p>}</div>
        </div>
      }
    </div>`,
  styles: [`
    .stack { position: fixed; right: 1.25rem; bottom: 1.25rem; display: flex; flex-direction: column; gap: .6rem; z-index: 100; }
    .toast { position: relative; overflow: hidden; display: flex; gap: .75rem; min-width: 280px; max-width: 380px; padding: .85rem 1rem .85rem 1.1rem;
             background: rgb(14 17 40 / .92); border: 1px solid var(--border); border-radius: 14px; backdrop-filter: blur(14px);
             box-shadow: 0 12px 40px rgb(0 0 0 / .5); cursor: pointer; animation: slide .45s cubic-bezier(.2,.9,.2,1.2); font-size: .88rem; }
    .toast p { margin: .2rem 0 0; color: var(--muted); font-size: .8rem; }
    .bar { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--cyan); box-shadow: 0 0 12px var(--cyan); }
    .toast[data-kind="ok"] .bar { background: var(--lime); box-shadow: 0 0 12px var(--lime); }
    .toast[data-kind="error"] .bar { background: var(--danger); box-shadow: 0 0 12px var(--danger); }
    .toast::after { content: ""; position: absolute; left: 0; bottom: 0; height: 2px; background: rgb(255 255 255 / .2); animation: life 4.2s linear forwards; }
    @keyframes slide { from { opacity: 0; transform: translateX(40px) scale(.96); } }
    @keyframes life { from { width: 100%; } to { width: 0; } }
  `],
})
export class ToastsComponent { svc = inject(ToastService); }
