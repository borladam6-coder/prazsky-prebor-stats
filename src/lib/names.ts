// Player names typed by different people: "Novák Jan", "Novak Jan", "Jan Novák", "Novák  Jan".
// Used to warn before a duplicate player is created. Pure functions, unit-tested.

/** lower case, no diacritics, single spaces */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Same person most likely: same letters ignoring accents and word order, or one typo. */
export function similarName(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const sx = x.split(' ').sort().join(' ');
  const sy = y.split(' ').sort().join(' ');
  if (sx === sy) return true;
  return x.length >= 5 && distance(x, y) <= 1;
}
