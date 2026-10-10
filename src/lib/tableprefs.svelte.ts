// On a phone, statistic tables show only the key columns; "Všechny statistiky" shows the rest.
// The choice is remembered on the device.

const KEY = 'pps.table.all';

class TablePrefs {
  /** narrow screen (phone) */
  narrow = $state(false);
  /** show every column even on a phone */
  all = $state(false);

  constructor() {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 699px)');
    this.narrow = mq.matches;
    mq.addEventListener('change', (e) => (this.narrow = e.matches));
    try {
      this.all = localStorage.getItem(KEY) === '1';
    } catch {
      /* private mode */
    }
  }

  toggle() {
    this.all = !this.all;
    try {
      localStorage.setItem(KEY, this.all ? '1' : '0');
    } catch {
      /* private mode */
    }
  }
}

export const tablePrefs = new TablePrefs();
