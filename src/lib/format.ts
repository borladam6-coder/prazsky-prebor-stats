// Formatting helpers. All dates are shown in Prague time regardless of the viewer's zone.

const TZ = 'Europe/Prague';

/** Batting rates in the usual baseball form: .333, 1.000, "—" when undefined. */
export function rate(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  const s = n.toFixed(3);
  return n < 1 ? s.replace(/^0/, '') : s;
}

export function num(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  return String(Number(value));
}

const dayFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' });
const dateFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric' });
const longFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, month: 'long', year: 'numeric' });
const stampFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });

export const day = (iso: string | null) => (iso ? dayFmt.format(new Date(iso)) : 'termín neurčen');
export const date = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : '—');
export const longDate = (iso: string | null) => (iso ? longFmt.format(new Date(iso)) : 'termín neurčen');
export const time = (iso: string | null) => (iso ? timeFmt.format(new Date(iso)) : '');
export const stamp = (iso: string | null) => (iso ? stampFmt.format(new Date(iso)) : '');

export function month(iso: string | null): string {
  if (!iso) return 'Bez termínu';
  const s = monthFmt.format(new Date(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Calendar date in Prague as YYYY-MM-DD (for date inputs and filters). */
export function isoDay(iso: string | null): string | null {
  if (!iso) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return parts;
}

/** Relative time for the history ("před 5 min"). */
export function ago(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'právě teď';
  if (diff < 3600) return `před ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `před ${Math.floor(diff / 3600)} h`;
  if (diff < 7 * 86400) {
    const d = Math.floor(diff / 86400);
    return d === 1 ? 'včera' : `před ${d} dny`;
  }
  return stamp(iso);
}

/** Czech plural: plural(5, ['zápas', 'zápasy', 'zápasů']) → "zápasů". */
export function plural(n: number, forms: [string, string, string]): string {
  if (n === 1) return forms[0];
  if (n >= 2 && n <= 4) return forms[1];
  return forms[2];
}
