import { Component, effect, input, signal } from '@angular/core';

/** Animated number that eases from its previous value to the new one. */
@Component({
  selector: 'app-count-up',
  standalone: true,
  template: `{{ display() }}`,
})
export class CountUpComponent {
  value = input(0);
  decimals = input(0);
  display = signal('0');
  private current = 0;

  constructor() {
    effect(() => {
      const target = this.value() ?? 0;
      const from = this.current;
      const d = this.decimals();
      const start = performance.now();
      const dur = 900;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - p, 4);
        this.current = from + (target - from) * e;
        this.display.set(this.current.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
}
