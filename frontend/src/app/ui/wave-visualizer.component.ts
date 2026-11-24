import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, inject, viewChild } from '@angular/core';
import { RecorderService } from '../services/recorder.service';

/** Neon oscilloscope of the raw microphone waveform with a fading phosphor trail. */
@Component({
  selector: 'app-wave-visualizer',
  standalone: true,
  template: `<canvas #cv></canvas>`,
  styles: [':host{display:block;width:100%;height:100%} canvas{width:100%;height:100%;display:block}'],
})
export class WaveVisualizerComponent implements AfterViewInit, OnDestroy {
  private rec = inject(RecorderService);
  private zone = inject(NgZone);
  private cv = viewChild.required<ElementRef<HTMLCanvasElement>>('cv');
  private raf = 0;
  private data = new Uint8Array(1024);
  private ro?: ResizeObserver;

  ngAfterViewInit(): void {
    const c = this.cv().nativeElement;
    const resize = () => { const d = Math.min(devicePixelRatio || 1, 2); c.width = c.clientWidth * d; c.height = c.clientHeight * d; };
    this.ro = new ResizeObserver(resize);
    this.ro.observe(c);
    resize();
    this.zone.runOutsideAngular(() => this.loop(0));
  }

  ngOnDestroy(): void { cancelAnimationFrame(this.raf); this.ro?.disconnect(); }

  private loop = (t: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const c = this.cv().nativeElement, ctx = c.getContext('2d');
    if (!ctx || !c.width) return;
    const W = c.width, H = c.height, mid = H / 2, k = W / c.clientWidth;

    // phosphor fade
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';

    // centre line + ticks
    ctx.strokeStyle = 'rgba(140,160,255,.12)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();

    const an = this.rec.analyser;
    const n = this.data.length;
    if (an) an.getByteTimeDomainData(this.data);

    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, 'rgba(34,211,238,0)');
    grad.addColorStop(0.15, '#22d3ee');
    grad.addColorStop(0.5, '#8b5cf6');
    grad.addColorStop(0.85, '#ec4899');
    grad.addColorStop(1, 'rgba(236,72,153,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2 * k;
    ctx.shadowColor = '#8b5cf6';
    ctx.shadowBlur = 12 * k;
    ctx.beginPath();
    const time = t / 1000;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * W;
      const v = an
        ? (this.data[i] - 128) / 128 * 2.2
        : Math.sin(i / 40 + time * 3) * 0.04 * Math.sin(i / n * Math.PI);
      const y = mid + Math.max(-1, Math.min(1, v)) * mid * 0.9;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  };
}
