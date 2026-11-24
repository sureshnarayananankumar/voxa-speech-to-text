import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, inject, input, viewChild } from '@angular/core';
import { RecorderService } from '../services/recorder.service';

/**
 * Audio-reactive "neural orb": 128 radial frequency bars around a glowing core, two
 * counter-rotating HUD rings and orbiting particles. Runs outside Angular's zone at 60fps.
 * When idle it "breathes" with a procedural signal so the UI always feels alive.
 */
@Component({
  selector: 'app-orb-visualizer',
  standalone: true,
  template: `<canvas #cv></canvas>`,
  styles: [':host{display:block;width:100%;height:100%} canvas{width:100%;height:100%;display:block}'],
})
export class OrbVisualizerComponent implements AfterViewInit, OnDestroy {
  private rec = inject(RecorderService);
  private zone = inject(NgZone);
  private cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');

  active = input(false);
  state = input<'idle' | 'listening' | 'thinking' | 'error'>('idle');

  private raf = 0;
  private bins = new Uint8Array(512);
  private smooth = new Float32Array(128);
  private particles = Array.from({ length: 46 }, () => ({
    a: Math.random() * Math.PI * 2, r: 0.62 + Math.random() * 0.4, s: (Math.random() * 0.4 + 0.1) * (Math.random() < .5 ? -1 : 1) / 100,
    z: Math.random() * 1.6 + 0.4,
  }));
  private ro?: ResizeObserver;

  ngAfterViewInit(): void {
    const canvas = this.cv().nativeElement;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    this.ro = new ResizeObserver(resize);
    this.ro.observe(canvas);
    resize();
    this.zone.runOutsideAngular(() => this.loop(0));
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.raf);
    this.ro?.disconnect();
  }

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const canvas = this.cv().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || !canvas.width) return;
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
    const R = Math.min(W, H) * 0.26;
    const time = t / 1000;
    const st = this.state();

    // --- gather spectrum ---------------------------------------------------
    const an = this.rec.analyser;
    let energy = 0;
    if (an) {
      an.getByteFrequencyData(this.bins);
      for (let i = 0; i < 128; i++) {
        // log-ish mapping so the voice band (100Hz–4kHz) spreads across most bars
        const idx = Math.floor(Math.pow(i / 128, 1.7) * 180) + 2;
        const v = this.bins[idx] / 255;
        this.smooth[i] += (v - this.smooth[i]) * 0.35;
        energy += this.smooth[i];
      }
      energy /= 128;
    } else {
      for (let i = 0; i < 128; i++) {
        const target = st === 'thinking'
          ? 0.25 + 0.25 * Math.sin(time * 6 + i * 0.35)
          : 0.06 + 0.05 * Math.sin(time * 1.6 + i * 0.24) + 0.03 * Math.sin(time * 3.1 - i * 0.5);
        this.smooth[i] += (target - this.smooth[i]) * 0.08;
        energy += this.smooth[i];
      }
      energy /= 128;
    }

    ctx.clearRect(0, 0, W, H);
    const hueShift = st === 'error' ? 330 : 0;

    // --- outer glow --------------------------------------------------------
    const glowR = R * (1.9 + energy * 1.2);
    const g = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, glowR);
    g.addColorStop(0, `hsla(${(250 + hueShift) % 360}, 90%, 60%, ${0.22 + energy * 0.5})`);
    g.addColorStop(0.5, `hsla(${(195 + hueShift) % 360}, 90%, 55%, ${0.08 + energy * 0.2})`);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // --- HUD rings ---------------------------------------------------------
    const ring = (r: number, dash: number[], speed: number, alpha: number, width = 1) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(time * speed);
      ctx.setLineDash(dash);
      ctx.strokeStyle = `rgba(140, 200, 255, ${alpha})`;
      ctx.lineWidth = width * (W / canvas.clientWidth);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    };
    const k = W / canvas.clientWidth;
    ring(R * 1.92, [2 * k, 10 * k], 0.15, 0.25);
    ring(R * 2.08, [40 * k, 18 * k, 4 * k, 18 * k], -0.08, 0.18, 1.5);
    ring(R * 0.78, [1 * k, 6 * k], -0.4, 0.35);

    // --- radial spectrum bars (mirrored for symmetry) -----------------------
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2 + time * 0.05);
    const N = 128, step = (Math.PI * 2) / (N * 2);
    for (let j = 0; j < N * 2; j++) {
      const i = j < N ? j : 2 * N - 1 - j;
      const v = this.smooth[i];
      const len = R * (0.08 + v * 0.95);
      const a = j * step;
      const hue = (190 + (j / (N * 2)) * 140 + hueShift) % 360;
      ctx.strokeStyle = `hsla(${hue}, 95%, ${60 + v * 20}%, ${0.55 + v * 0.45})`;
      ctx.lineWidth = Math.max(1.5 * k, (Math.PI * 2 * R) / (N * 2) * 0.55);
      ctx.lineCap = 'round';
      ctx.shadowColor = `hsla(${hue}, 100%, 60%, .9)`;
      ctx.shadowBlur = 10 * k * v;
      const x0 = Math.cos(a) * (R * 1.08), y0 = Math.sin(a) * (R * 1.08);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(Math.cos(a) * (R * 1.08 + len), Math.sin(a) * (R * 1.08 + len));
      ctx.stroke();
    }
    ctx.restore();
    ctx.shadowBlur = 0;

    // --- core orb ----------------------------------------------------------
    const pulse = 1 + energy * 0.35 + Math.sin(time * 2) * 0.015;
    const core = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.05, cx, cy, R * pulse);
    core.addColorStop(0, `hsla(${(190 + hueShift) % 360}, 100%, 80%, .95)`);
    core.addColorStop(0.45, `hsla(${(255 + hueShift) % 360}, 85%, 55%, .9)`);
    core.addColorStop(1, `hsla(${(290 + hueShift) % 360}, 80%, 25%, .85)`);
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.98 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // inner liquid wave lines
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.98 * pulse, 0, Math.PI * 2);
    ctx.clip();
    for (let w = 0; w < 3; w++) {
      ctx.beginPath();
      const amp = R * (0.05 + energy * 0.5) * (1 - w * 0.25);
      for (let x = -R; x <= R; x += 4 * k) {
        const y = Math.sin(x / R * (3 + w) + time * (2 + w)) * amp * Math.cos(x / R * 1.5);
        if (x === -R) ctx.moveTo(cx + x, cy + y + (w - 1) * R * 0.18);
        else ctx.lineTo(cx + x, cy + y + (w - 1) * R * 0.18);
      }
      ctx.strokeStyle = `rgba(255,255,255,${0.18 - w * 0.04})`;
      ctx.lineWidth = 2 * k;
      ctx.stroke();
    }
    ctx.restore();

    // rim light
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 1.2 * k;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.98 * pulse, 0, Math.PI * 2);
    ctx.stroke();

    // --- particles ---------------------------------------------------------
    for (const p of this.particles) {
      p.a += p.s * (1 + energy * 6);
      const rr = R * (1.25 + p.r + energy * 0.4);
      const x = cx + Math.cos(p.a) * rr, y = cy + Math.sin(p.a) * rr * 0.92;
      ctx.fillStyle = `rgba(160, 220, 255, ${0.25 + 0.5 * Math.abs(Math.sin(time + p.a))})`;
      ctx.beginPath();
      ctx.arc(x, y, p.z * k, 0, Math.PI * 2);
      ctx.fill();
    }
  };
}
