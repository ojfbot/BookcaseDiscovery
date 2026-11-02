// Text normalisation for catalog matching (C-3). One function set is used on both sides: the index
// is built from `normalize(title)` and a spine's OCR is turned into fragments with the same call, so a
// difference in treatment can never make a true match impossible.
//
// "Normalised" means: Unicode-decomposed, diacritics and combining marks dropped, a few letters that do
// not decompose spelled out (ß ø æ œ ł đ þ), lower-cased, `&` read as "and", apostrophes deleted
// (Ender's -> enders), periods deleted (J.R.R. -> jrr, J. R. R. -> j r r), every other run of
// non-letter, non-digit characters turned into one space.

const SPECIAL: Record<string, string> = {
  "ß": "ss", "ø": "o", "æ": "ae", "œ": "oe", "ł": "l", "đ": "d", "ð": "d", "þ": "th", "ı": "i", "ħ": "h",
};
const SPECIAL_RE = /[ßøæœłđðþıħ]/g;

/** Words whose absence or presence says little about identity: they carry a quarter of a word's weight. */
export const STOPWORDS: ReadonlySet<string> = new Set(["the", "a", "an", "of", "and", "or", "in", "on", "to", "for", "de", "la", "le", "el", "der", "die", "das", "von", "et"]);

/** ISFDB stores non-Latin text as numeric entities (`&#1030;`). Decodes those and the few named ones it uses. */
export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s
    .replace(/&#(\d+);/g, (m, d: string) => safeCodePoint(Number(d), m))
    .replace(/&#x([0-9a-f]+);/gi, (m, h: string) => safeCodePoint(parseInt(h, 16), m))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_m, n: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[n]!);
}

function safeCodePoint(cp: number, fallback: string): string {
  return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : fallback;
}

export function normalize(input: string): string {
  return decodeEntities(input)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(SPECIAL_RE, (c) => SPECIAL[c] ?? c)
    .replace(/&/g, " and ")
    .replace(/['’`´‘]/g, "")
    .replace(/\./g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function tokenize(normalized: string): string[] {
  return normalized === "" ? [] : normalized.split(" ");
}

/**
 * Tokens of a normalised string plus the joined form of every run of two or more single-letter tokens
 * ("j r r tolkien" -> also "jrr"), so "J. R. R. Tolkien" and "JRR TOLKIEN" meet.
 */
export function tokensWithInitials(normalized: string): string[] {
  const tokens = tokenize(normalized);
  const out = [...tokens];
  let run = "";
  for (let i = 0; i <= tokens.length; i++) {
    const t = tokens[i];
    if (t !== undefined && t.length === 1 && /\p{L}/u.test(t)) {
      run += t;
    } else {
      if (run.length >= 2) out.push(run);
      run = "";
    }
  }
  return out;
}

/** Digits an OCR engine reads for letters, and the letters it reads for digits. */
const DIGIT_TO_LETTERS: Record<string, string[]> = { "0": ["o"], "1": ["l", "i"], "5": ["s"], "8": ["b"], "2": ["z"], "4": ["a"], "6": ["g"] };
const LETTER_TO_DIGIT: Record<string, string> = { o: "0", i: "1", l: "1", s: "5", b: "8", z: "2" };

/**
 * Other readings of one token under the 0/O, 1/l/I, 5/S, 8/B confusions. A token that is mostly
 * letters with a digit inside ("neur0mancer") gets the digit read as a letter; a token that is mostly
 * digits with a letter inside ("i984") gets the letter read as a digit. At most `limit` alternatives.
 */
export function confusableReadings(token: string, limit = 4): string[] {
  const digits = (token.match(/\d/g) ?? []).length;
  const letters = token.length - digits;
  // A pure-letter token is never rewritten into digits; a pure-digit token has nothing to rewrite.
  if (digits === 0 || letters === 0) return [];
  const out = new Set<string>();
  if (letters >= digits) {
    let acc = [""];
    for (const ch of token) {
      const alts = DIGIT_TO_LETTERS[ch];
      const next: string[] = [];
      for (const a of acc) {
        if (alts) for (const l of alts) next.push(a + l);
        else next.push(a + ch);
      }
      acc = next.slice(0, 16);
    }
    for (const a of acc) if (a !== token) out.add(a);
  } else {
    let r = "";
    for (const ch of token) r += LETTER_TO_DIGIT[ch] ?? ch;
    if (r !== token) out.add(r);
  }
  return [...out].slice(0, limit);
}

/** Collapses the confusions an OCR engine makes between letter pairs and single letters (rn/m, vv/w, cl/d). */
export function skeleton(token: string): string {
  return token.replace(/rn/g, "m").replace(/vv/g, "w").replace(/cl/g, "d");
}

/** Damerau-Levenshtein (optimal string alignment) distance, giving up above `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2: number[] = new Array(m + 1).fill(0);
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur: number[] = new Array(m + 1);
    cur[0] = i;
    let rowMin = cur[0]!;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m]! <= max ? prev[m]! : max + 1;
}

/** The part of an ISFDB title before the first ": " (the main title), or the whole title. */
export function splitSubtitle(title: string): { main: string; subtitle: string | null } {
  const i = title.indexOf(": ");
  if (i > 0 && i < title.length - 2) return { main: title.slice(0, i), subtitle: title.slice(i + 2) };
  return { main: title, subtitle: null };
}

/** "Dick, Philip Kindred" -> "Philip Kindred Dick". Names without a single comma are returned as they are. */
export function surnameFirstToGivenFirst(name: string): string {
  const parts = name.split(",");
  if (parts.length === 2 && parts[0]!.trim() && parts[1]!.trim()) return `${parts[1]!.trim()} ${parts[0]!.trim()}`;
  return name;
}
