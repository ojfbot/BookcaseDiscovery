// ISBN helpers for the staging step (C-1). ISFDB stores `pubs.pub_isbn` as the editor typed it:
// ISBN-10 or ISBN-13, with or without hyphens. `isbn13` gives the one form C-3 can index and join on.

function digitsOf(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

function isbn13Check(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

function isbn10Valid(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

/**
 * The 13-digit ISBN (digits only) for a raw ISBN-10 or ISBN-13, or `null` when the check digit
 * fails, the length is wrong, or the value is not an ISBN at all. An ISBN-10 becomes `978` + its
 * first nine digits + a new check digit.
 */
export function toIsbn13(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = digitsOf(raw);
  if (/^\d{13}$/.test(s)) return isbn13Check(s.slice(0, 12)) === Number(s[12]) ? s : null;
  if (isbn10Valid(s)) {
    const first12 = `978${s.slice(0, 9)}`;
    return `${first12}${isbn13Check(first12)}`;
  }
  return null;
}
