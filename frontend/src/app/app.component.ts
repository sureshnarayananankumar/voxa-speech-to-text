import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ToastsComponent } from './ui/toast.service';
import { IconComponent } from './ui/icon.component';

interface Health { status: string; stt?: { status: string; provider?: string | null; tts?: Record<string, boolean> } }

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ToastsComponent, IconComponent],
  template: `
    <div class="backdrop-fx"><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="grid"></div><div class="noise"></div></div>

    <header class="glass">
      <a class="brand" routerLink="/live">
        <span class="logo"><i></i><i></i><i></i><i></i><i></i></span>
        <span class="name">VOXA</span>
        <span class="tag mono">SPEECH·AI</span>
      </a>

      <nav>
        <a routerLink="/live" routerLinkActive="active"><app-icon name="wave" /> Live Studio</a>
        <a routerLink="/history" routerLinkActive="active"><app-icon name="layers" /> Archive</a>
      </nav>

      <div class="sys" [attr.data-state]="engineState()" [title]="'Speech engine: ' + (engine() || 'unknown')">
        <span class="led"></span>
        <span class="mono">{{ engineState() === 'online' ? 'ENGINE ONLINE' : engineState() === 'loading' ? 'WARMING UP' : 'ENGINE OFFLINE' }}</span>
        @if (engine()) { <span class="eng mono"><app-icon name="cpu" [size]="13" /> {{ engine() }}</span> }
      </div>
    </header>

    <main><router-outlet /></main>

    <footer class="mono">
      <span>VOXA v1.0 · Angular · Node.js · FastAPI · PostgreSQL · Whisper / Gemini Live · Piper TTS</span>
    </footer>

    <app-toasts />
  `,
  styles: [`
    header { position: sticky; top: .9rem; z-index: 20; margin: .9rem auto 0; max-width: 1240px; width: calc(100% - 2rem);
             display: flex; align-items: center; gap: 1.5rem; padding: .6rem .8rem .6rem 1.1rem; border-radius: 18px; }
    .brand { display: flex; align-items: center; gap: .65rem; text-decoration: none; color: var(--text); }
    .logo { display: flex; align-items: center; gap: 2px; height: 22px; }
    .logo i { width: 3px; border-radius: 2px; background: var(--grad); animation: eq 1.2s ease-in-out infinite; box-shadow: 0 0 8px rgb(139 92 246 / .7); }
    .logo i:nth-child(1) { animation-delay: -.2s } .logo i:nth-child(2) { animation-delay: -.5s } .logo i:nth-child(3) { animation-delay: -.1s }
    .logo i:nth-child(4) { animation-delay: -.7s } .logo i:nth-child(5) { animation-delay: -.35s }
    @keyframes eq { 0%,100% { height: 6px } 50% { height: 22px } }
    .name { font-weight: 800; letter-spacing: .14em; font-size: 1.1rem; }
    .tag { font-size: .62rem; color: var(--cyan); border: 1px solid rgb(34 211 238 / .35); padding: .1rem .4rem; border-radius: 6px; letter-spacing: .12em; }
    nav { display: flex; gap: .3rem; margin-left: auto; padding: .25rem; border-radius: 14px; background: rgb(0 0 0 / .25); border: 1px solid var(--border); }
    nav a { display: flex; align-items: center; gap: .45rem; padding: .5rem .95rem; border-radius: 10px; color: var(--muted); text-decoration: none; font-weight: 600; font-size: .88rem; transition: all .25s; }
    nav a:hover { color: var(--text); }
    nav a.active { color: white; background: linear-gradient(135deg, rgb(34 211 238 / .22), rgb(139 92 246 / .3)); box-shadow: inset 0 0 0 1px rgb(139 92 246 / .45), 0 0 20px rgb(139 92 246 / .25); }
    .sys { display: flex; align-items: center; gap: .55rem; font-size: .68rem; letter-spacing: .1em; color: var(--muted); padding: .45rem .75rem; border-radius: 12px; border: 1px solid var(--border); }
    .led { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); box-shadow: 0 0 10px var(--danger); }
    .sys[data-state="online"] .led { background: var(--lime); box-shadow: 0 0 10px var(--lime); animation: blink 2s infinite; }
    .sys[data-state="loading"] .led { background: var(--amber); box-shadow: 0 0 10px var(--amber); animation: blink .8s infinite; }
    .eng { display: flex; align-items: center; gap: .3rem; color: var(--cyan); padding-left: .55rem; border-left: 1px solid var(--border); text-transform: uppercase; }
    @keyframes blink { 50% { opacity: .35 } }
    main { max-width: 1240px; margin: 1.5rem auto; padding: 0 1rem; }
    footer { text-align: center; font-size: .66rem; color: var(--dim); letter-spacing: .08em; padding: 1rem 1rem 2rem; }
    @media (max-width: 820px) { .sys { display: none } .tag { display: none } header { gap: .6rem } }
  `],
})
export class AppComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  engine = signal<string | null>(null);
  engineState = signal<'online' | 'loading' | 'offline'>('offline');
  private timer?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    const poll = () => this.http.get<Health>('/api/health').subscribe({
      next: (h) => {
        this.engine.set(h.stt?.provider ?? null);
        this.engineState.set(h.stt?.status === 'ok' ? 'online' : h.stt?.status === 'loading' ? 'loading' : 'offline');
      },
      error: () => this.engineState.set('offline'),
    });
    poll();
    this.timer = setInterval(poll, 15000);
  }

  ngOnDestroy(): void { clearInterval(this.timer); }
}
