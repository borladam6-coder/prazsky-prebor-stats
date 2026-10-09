// Small motion helpers. All respect "reduce motion".

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const formatters = new Map<number, Intl.NumberFormat>();
export function czNumber(value: number, decimals = 0): string {
  let f = formatters.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(decimals, f);
  }
  return f.format(value);
}

interface CountParams {
  value: number;
  decimals?: number;
  duration?: number;
}

/** Counts a number up from 0 when the element appears (once per value). */
export function countUp(node: HTMLElement, params: CountParams) {
  let frame = 0;

  function run({ value, decimals = 0, duration = 900 }: CountParams) {
    cancelAnimationFrame(frame);
    if (reduced() || !Number.isFinite(value)) {
      node.textContent = czNumber(value, decimals);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      node.textContent = czNumber(value * eased, decimals);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }

  run(params);
  return {
    update: run,
    destroy: () => cancelAnimationFrame(frame)
  };
}
