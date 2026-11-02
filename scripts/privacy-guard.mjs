#!/usr/bin/env node
// Privacy guard (card Z-1, INV-19): the OC9 public/private boundary, enforced by a machine.
//
//   node scripts/privacy-guard.mjs              scan every file in the git index (what would be committed)
//   node scripts/privacy-guard.mjs --history    scan every blob and commit message reachable from any ref
//   options: --rev <rev> (with --history: only what <rev> reaches), --json (machine-readable report),
//            --root <dir> (repo to scan; default: cwd)
//
// Exit 0 = clean, 1 = violations, 2 = the guard itself could not run.
//
// The report never prints matched content: this output lands in public CI logs. It names the rule,
// the path, a line number or commit, and nothing the file said. Rules are documented in docs/privacy.md.
//
// This file must stay clean under its own private-path rule, so the patterns below are regexes whose
// source text differs from the strings they match (escaped slashes), and there is no self-exemption.

import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------------------------
// Configuration. Everything a reviewer may want to tighten or loosen is in this block.
// ---------------------------------------------------------------------------------------------

const MiB = 1024 * 1024;
const SYNTHETIC_DIR = 'test/fixtures/synthetic/';
const MAX_BINARY_BYTES = 1 * MiB;
const MAX_EVAL_FILE_BYTES = 256 * 1024;
const MAX_JSON_PARSE_BYTES = 64 * MiB;

// Conductor ruling (implementation-notes.md, Z-0): in these places the private-path strings name rules,
// not data. Only the private-path rule is exempt; every other rule still applies to them.
// Documented in docs/privacy.md. Keep this list short and explicit.
export const PRIVATE_PATH_EXEMPT = [
  'docs/plan/**',
  'docs/privacy.md',
  // Not in the ruling's text. The deviation log names the rules it deviates from, and the Z-0 entry
  // already on main does (logged in implementation-notes.md under Z-1).
  'implementation-notes.md',
  'test/privacy-guard.test.ts',
  'test/fixtures/privacy-guard/**',
];

const IMAGE_EXT = new Set([
  'jpg', 'jpeg', 'jpe', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'avif', 'jxl',
  'psd',
  // camera RAW
  'dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'orf', 'raf', 'rw2', 'pef', 'srw',
  'x3f', '3fr', 'erf', 'mef', 'mrw', 'raw', 'rwl', 'iiq',
]);
const VIDEO_EXT = new Set(['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm', 'mts', 'm2ts', '3gp']);
const WEIGHT_EXT = new Set([
  'pt', 'pth', 'onnx', 'mlmodel', 'mlpackage', 'mlmodelc', 'safetensors', 'ckpt', 'gguf', 'tflite',
  'engine', 'h5', 'npz',
]);
// Core ML packages are directories; any path inside one is a weight file.
const WEIGHT_DIR_SUFFIXES = ['.mlpackage', '.mlmodelc'];

const CHATGPT_FILE_NAMES = new Set(['conversations.json', 'chat.html']);
const BANNED_PROVENANCE = new Set(['chatgpt-export', 'selfco']);

// Private paths and vault locations. Regex source is deliberately not the literal text it matches.
const PRIVATE_PATTERNS = [
  { id: 'vault-home', re: /~[/]selfco/g },
  { id: 'vault-dir', re: /[/]selfco[/]/g },
  { id: 'raw-inbox', re: /raw\/inbox\//g },
  { id: 'private-data-dir', re: /\$BOOKCASE_DATA\/private/g },
  { id: 'user-home', re: /\/Users\//g },
];

// evals/ allowlist (aggregate metrics only). Anything under an `evals` path segment that does not match
// one of these, anchored at the repo root, fails.
const EVAL_RUN_ID = '[A-Za-z0-9][A-Za-z0-9._-]*';
const EVAL_ALLOW = [
  { re: new RegExp(`^evals/${EVAL_RUN_ID}/metrics\\.json$`), kind: 'metrics' },
  { re: new RegExp(`^evals/${EVAL_RUN_ID}/report\\.md$`), kind: 'report' },
  { re: /^evals\/README\.md$/, kind: 'report' },
  // Public golden catalog queries (plan card C-3): fragments of known titles, no photo-derived data.
  { re: /^evals\/golden\/fragments\.jsonl$/, kind: 'golden' },
];
// Keys that mark per-spine / per-photo rows or OCR text. Compared after lower-casing and dropping
// every non-alphanumeric character, at any depth.
const EVAL_FORBIDDEN_KEYS = new Set([
  'ocr', 'ocrtext', 'ocrlines', 'ocrresult', 'ocrresults', 'transcription', 'spine', 'spines', 'spineid',
  'spineids', 'perspine', 'polygon', 'polygons', 'bbox', 'bboxes', 'boxes', 'crop', 'crops',
  'observation', 'observations', 'prediction', 'predictions', 'imagepath', 'photopath',
]);

// Fixture manifest: no capture time, GPS or store fields (same normalisation as above).
const MANIFEST_FORBIDDEN_KEYS = new Set([
  'capturetime', 'capturedat', 'capturedate', 'capturetimestamp', 'datetimeoriginal', 'datetimedigitized',
  'gps', 'gpslatitude', 'gpslongitude', 'gpsinfo', 'latitude', 'longitude', 'lat', 'lon', 'lng',
  'coordinates', 'geolocation', 'location',
  'store', 'storename', 'storeid', 'storeaddress', 'storelocation', 'storecity',
]);

// ---------------------------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------------------------

const extOf = (p) => {
  const base = p.slice(p.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
};
const baseOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const inSynthetic = (p) => p.startsWith(SYNTHETIC_DIR);

function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*');
  return new RegExp(`^${esc.replace(/\u0000/g, '.*')}$`);
}
const EXEMPT_RES = PRIVATE_PATH_EXEMPT.map(globToRegExp);
const isPrivatePathExempt = (p) => EXEMPT_RES.some((re) => re.test(p));

const normKey = (k) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------------------------------------
// Content sniffing
// ---------------------------------------------------------------------------------------------

const isBinary = (buf) => buf.subarray(0, 8000).includes(0);

// Image / video container magic, so a renamed file does not slip past the extension rule.
function sniffMedia(buf) {
  if (buf.length < 12) return null;
  const b = buf;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image';
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'image';
  if (b.toString('latin1', 0, 4) === 'GIF8') return 'image';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image';
  if ((b.toString('latin1', 0, 4) === 'II*\0' || b.toString('latin1', 0, 4) === 'MM\0*')) return 'image';
  if (b.toString('latin1', 4, 8) === 'ftyp') {
    const brand = b.toString('latin1', 8, 12);
    return /^(heic|heix|hevc|heim|heis|mif1|msf1|avif)/.test(brand) ? 'image' : 'video';
  }
  return null;
}

// Minimal TIFF/Exif walk: is the GPSInfo pointer (tag 0x8825) present in IFD0?
function tiffHasGps(buf, start) {
  if (start + 8 > buf.length) return false;
  const sig = buf.toString('latin1', start, start + 4);
  const le = sig === 'II*\0';
  if (!le && sig !== 'MM\0*') return false;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const ifd = start + u32(start + 4);
  if (ifd + 2 > buf.length) return false;
  const n = u16(ifd);
  for (let i = 0; i < n && i < 512; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > buf.length) return false;
    if (u16(e) === 0x8825) return true;
  }
  return false;
}

// True when the image carries GPS metadata: Exif GPSInfo (JPEG APP1, HEIC/other "Exif" payloads,
// PNG eXIf, WebP EXIF, bare TIFF/RAW) or XMP GPS properties. Never returns the coordinates.
function imageHasGps(buf) {
  if (tiffHasGps(buf, 0)) return true;
  const head = buf.toString('latin1', 0, Math.min(buf.length, 4 * MiB));
  if (/GPS(Latitude|Longitude|Altitude|Position)/.test(head)) return true;
  // "Exif\0\0" followed by a TIFF header: JPEG APP1, HEIC Exif item, WebP.
  let from = 0;
  for (let hit = 0; hit < 16; hit++) {
    const at = buf.indexOf('Exif\0\0', from, 'latin1');
    if (at < 0 || at > 8 * MiB) break;
    if (tiffHasGps(buf, at + 6)) return true;
    from = at + 6;
  }
  // PNG eXIf chunk and WebP EXIF chunk carry the TIFF header directly.
  for (const tag of ['eXIf', 'EXIF']) {
    let f = 0;
    for (let hit = 0; hit < 8; hit++) {
      const at = buf.indexOf(tag, f, 'latin1');
      if (at < 0) break;
      if (tiffHasGps(buf, at + 4)) return true;
      f = at + 4;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// JSON analysis (one walk per blob)
// ---------------------------------------------------------------------------------------------

function analyseJsonValue(root, out) {
  const stack = [root];
  let nodes = 0;
  while (stack.length && nodes++ < 5_000_000) {
    const v = stack.pop();
    if (Array.isArray(v)) {
      for (const x of v) if (x && typeof x === 'object') stack.push(x);
      continue;
    }
    const keys = Object.keys(v);
    const norm = new Set(keys.map(normKey));
    for (const k of norm) out.keys.add(k);
    if (norm.has('mapping') && norm.has('createtime')) out.chatgptShape = true;
    for (const k of keys) {
      const val = v[k];
      const nk = normKey(k);
      if (nk === 'provenance' || nk === 'provenancesource') collectProvenance(val, out);
      if (val && typeof val === 'object') stack.push(val);
    }
  }
}

function collectProvenance(val, out) {
  if (typeof val === 'string') {
    if (BANNED_PROVENANCE.has(val.trim().toLowerCase())) out.bannedProvenance = true;
  } else if (Array.isArray(val)) {
    for (const x of val) collectProvenance(x, out);
  } else if (val && typeof val === 'object') {
    for (const x of Object.values(val)) collectProvenance(x, out);
  }
}

// Returns { keys, chatgptShape, bannedProvenance, parseError }.
function analyseJson(path, buf) {
  const out = { keys: new Set(), chatgptShape: false, bannedProvenance: false, parseError: false };
  const text = buf.toString('utf8');
  const jsonl = /\.(jsonl|ndjson)$/i.test(path);
  if (buf.length > MAX_JSON_PARSE_BYTES) {
    // Too big to parse: fall back to a textual check of the two ChatGPT-export keys.
    out.parseError = true;
    out.chatgptShape = /"mapping"/.test(text) && /"create_time"/.test(text);
    out.bannedProvenance = /"provenance"\s*:\s*(\{[^}]*)?"(chatgpt-export|selfco)"/i.test(text);
    return out;
  }
  try {
    if (jsonl) {
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const v = JSON.parse(line);
        if (v && typeof v === 'object') analyseJsonValue(v, out);
      }
    } else {
      const v = JSON.parse(text);
      if (v && typeof v === 'object') analyseJsonValue(v, out);
    }
  } catch {
    out.parseError = true;
    // A file that claims to be a ChatGPT export but does not parse is still treated as one.
    out.chatgptShape = out.chatgptShape || (/"mapping"/.test(text) && /"create_time"/.test(text));
    out.bannedProvenance = out.bannedProvenance || /"provenance"\s*:\s*(\{[^}]*)?"(chatgpt-export|selfco)"/i.test(text);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Rule evaluation
// ---------------------------------------------------------------------------------------------

function privatePathHits(buf) {
  const text = buf.toString('latin1');
  const hits = [];
  for (const { id, re } of PRIVATE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    let count = 0;
    while ((m = re.exec(text)) && count < 3) {
      let line = 1;
      for (let i = text.indexOf('\n'); i >= 0 && i < m.index; i = text.indexOf('\n', i + 1)) line++;
      hits.push({ id, line });
      count++;
    }
  }
  return hits;
}

/**
 * Evaluate one (path, content) pair. `cache` memoises content-only analysis per blob id.
 * Returns violations: { rule, path, detail, line? }.
 */
function checkFile(path, buf, cache, oid) {
  const v = [];
  const add = (rule, detail, line) => v.push({ rule, path, detail, ...(line ? { line } : {}) });
  const ext = extOf(path);
  const base = baseOf(path).toLowerCase();
  const segments = path.split('/');
  const synthetic = inSynthetic(path);

  const memo = (key, fn) => {
    const k = `${oid}:${key}`;
    if (!cache.has(k)) cache.set(k, fn());
    return cache.get(k);
  };

  // --- media and weight types -------------------------------------------------------------
  const sniffed = memo('sniff', () => sniffMedia(buf));
  const isImageByExt = IMAGE_EXT.has(ext);
  const isImage = isImageByExt || sniffed === 'image';
  const isVideo = VIDEO_EXT.has(ext) || (sniffed === 'video' && !isImageByExt);
  const isWeight =
    WEIGHT_EXT.has(ext) || segments.slice(0, -1).some((s) => WEIGHT_DIR_SUFFIXES.some((x) => s.endsWith(x)));
  if (!synthetic) {
    if (isImage) add('image-type', 'image or RAW file outside test/fixtures/synthetic/');
    if (isVideo) add('video-type', 'video file outside test/fixtures/synthetic/');
    if (isWeight) add('weight-type', 'model weight file outside test/fixtures/synthetic/');
  }

  // --- GPS in image metadata (everywhere, including the synthetic dir) ---------------------------
  if (isImage && memo('gps', () => imageHasGps(buf))) {
    add('exif-gps', 'image carries GPS metadata');
  }

  // --- large binaries -------------------------------------------------------------------------
  if (!synthetic && buf.length > MAX_BINARY_BYTES && memo('bin', () => isBinary(buf))) {
    add('large-binary', `binary file over ${MAX_BINARY_BYTES / MiB} MiB outside test/fixtures/synthetic/`);
  }

  // --- ChatGPT export ---------------------------------------------------------------------------
  if (CHATGPT_FILE_NAMES.has(base)) add('chatgpt-export-file', `file name ${base} is a ChatGPT export name`);

  const isJson = /\.(json|jsonl|ndjson)$/i.test(path);
  const json = isJson && memo('json', () => analyseJson(path, buf));
  if (json) {
    if (json.chatgptShape) add('chatgpt-export-shape', 'JSON has the ChatGPT export shape (mapping + create_time)');
    if (json.bannedProvenance) add('banned-provenance', 'JSON entry with provenance chatgpt-export or selfco');
  }

  // --- private paths ----------------------------------------------------------------------------
  if (!isPrivatePathExempt(path)) {
    for (const h of memo('paths', () => privatePathHits(buf))) {
      add('private-path', `private path pattern "${h.id}"`, h.line);
    }
  }

  // --- evals/ allowlist -------------------------------------------------------------------------
  if (segments.includes('evals')) {
    const allowed = EVAL_ALLOW.find((a) => a.re.test(path));
    if (!allowed) {
      add('evals-allowlist', 'not on the aggregate-only evals/ allowlist (evals/<run-id>/metrics.json or report.md)');
    } else {
      if (allowed.kind !== 'golden' && buf.length > MAX_EVAL_FILE_BYTES) {
        add('evals-allowlist', `aggregate file over ${MAX_EVAL_FILE_BYTES / 1024} KiB (looks like row data)`);
      }
      if (allowed.kind === 'metrics' || allowed.kind === 'golden') {
        const j = json || analyseJson(path, buf);
        if (j.parseError) add('evals-allowlist', 'not valid JSON');
        for (const k of j.keys) {
          if (EVAL_FORBIDDEN_KEYS.has(k)) {
            add('evals-allowlist', `per-spine or OCR field "${k}" is not allowed in evals/`);
            break;
          }
        }
      }
    }
  }

  // --- fixture manifest ---------------------------------------------------------------------------
  if (segments.includes('fixtures') && /^manifest.*\.json$/.test(base)) {
    const j = json || analyseJson(path, buf);
    const bad = [...j.keys].filter((k) => MANIFEST_FORBIDDEN_KEYS.has(k));
    if (bad.length) add('fixture-manifest', `public fixture manifest carries forbidden field(s): ${bad.join(', ')}`);
  }

  return v;
}

function checkMessage(commit, message) {
  const v = [];
  for (const h of privatePathHits(Buffer.from(message, 'utf8'))) {
    v.push({ rule: 'private-path', path: '(commit message)', commit, detail: `private path pattern "${h.id}"`, line: h.line });
  }
  return v;
}

// ---------------------------------------------------------------------------------------------
// Git plumbing
// ---------------------------------------------------------------------------------------------

function git(root, args, opts = {}) {
  return execFileSync('git', ['-C', root, ...args], { maxBuffer: 1024 * MiB, ...opts });
}

/** Entries in the index: [{ path, oid }]. */
function indexEntries(root) {
  const out = git(root, ['ls-files', '-s', '-z']).toString('latin1');
  const entries = [];
  for (const rec of out.split('\0')) {
    if (!rec) continue;
    const tab = rec.indexOf('\t');
    const [mode, oid] = rec.slice(0, tab).split(' ');
    if (mode === '160000') continue; // submodule pointer
    entries.push({ path: Buffer.from(rec.slice(tab + 1), 'latin1').toString('utf8'), oid });
  }
  return entries;
}

/**
 * Every (path, blob) ever added or changed in the scanned history, plus every commit message.
 * `rev` limits the scan to what is reachable from one revision; the default is every ref.
 */
function historyEntries(root, rev) {
  const revs = rev ? [rev] : ['--all'];
  // Messages come from their own call: --diff-filter drops commits whose diff is empty or delete-only.
  const messages = [];
  const log = git(root, ['log', ...revs, '--format=%H%x02%B%x03']).toString('latin1');
  for (const rec of log.split('\x03')) {
    const m = rec.match(/^\s*([0-9a-f]{40})\x02([\s\S]*)$/);
    if (m) messages.push({ commit: m[1], message: Buffer.from(m[2], 'latin1').toString('utf8') });
  }

  const raw = git(root, [
    'log', ...revs, '--root', '-m', '--no-renames', '--raw', '--no-abbrev', '-z',
    '--diff-filter=AMTC', '--format=%x01%H%x02',
  ]).toString('latin1');
  const seen = new Map();
  let commit = '';
  let pending = null; // the raw record whose path is the next NUL-separated token
  for (const token of raw.split('\0')) {
    if (pending) {
      const path = Buffer.from(token, 'latin1').toString('utf8');
      if (pending.mode !== '160000') {
        const key = `${path}\0${pending.oid}`;
        if (!seen.has(key)) seen.set(key, { path, oid: pending.oid, commit });
      }
      pending = null;
      continue;
    }
    const t = token.replace(/^\n/, '');
    const h = t.match(/^\x01([0-9a-f]{40})\x02/);
    if (h) commit = h[1];
    else if (t.startsWith(':')) {
      // ":<old mode> <new mode> <old oid> <new oid> <status>"
      const f = t.slice(1).split(' ');
      pending = { mode: f[1], oid: f[3] };
    }
  }
  return { entries: [...seen.values()], messages };
}

/** Read blobs by id, in size-bounded batches. Yields [oid, Buffer]. */
function* readBlobs(root, oids) {
  const unique = [...new Set(oids)];
  if (!unique.length) return;
  const check = git(root, ['cat-file', '--batch-check'], { input: unique.join('\n') + '\n' }).toString();
  const sizes = new Map();
  for (const line of check.split('\n')) {
    const [oid, , size] = line.split(' ');
    if (oid && size) sizes.set(oid, Number(size));
  }
  let batch = [];
  let batchBytes = 0;
  const flush = function* () {
    if (!batch.length) return;
    const res = spawnSync('git', ['-C', root, 'cat-file', '--batch'], {
      input: batch.join('\n') + '\n',
      maxBuffer: batchBytes + batch.length * 256 + MiB,
    });
    if (res.status !== 0) throw new Error(`git cat-file failed: ${res.stderr}`);
    const out = res.stdout;
    let pos = 0;
    for (const oid of batch) {
      const nl = out.indexOf(10, pos);
      const header = out.toString('latin1', pos, nl).split(' ');
      const size = Number(header[2]);
      yield [oid, out.subarray(nl + 1, nl + 1 + size)];
      pos = nl + 1 + size + 1;
    }
    batch = [];
    batchBytes = 0;
  };
  for (const oid of unique) {
    const size = sizes.get(oid) ?? 0;
    if (batchBytes + size > 128 * MiB) yield* flush();
    batch.push(oid);
    batchBytes += size;
  }
  yield* flush();
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/** Scan a repository. Returns { violations, scannedFiles }. */
export function scan(root, { history = false, rev = '' } = {}) {
  let entries;
  let messages = [];
  if (history) ({ entries, messages } = historyEntries(root, rev));
  else entries = indexEntries(root);

  const violations = [];
  const cache = new Map();
  const byOid = new Map();
  for (const e of entries) {
    if (!byOid.has(e.oid)) byOid.set(e.oid, []);
    byOid.get(e.oid).push(e);
  }
  for (const [oid, buf] of readBlobs(root, [...byOid.keys()])) {
    for (const e of byOid.get(oid)) {
      for (const viol of checkFile(e.path, buf, cache, oid)) {
        violations.push(e.commit ? { ...viol, commit: e.commit } : viol);
      }
    }
  }
  for (const m of messages) violations.push(...checkMessage(m.commit, m.message));
  return { violations, scannedFiles: entries.length, scannedCommits: messages.length };
}

function main(argv) {
  const args = argv.slice(2);
  const flag = (n) => args.includes(n);
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 ? args[rootIdx + 1] : process.cwd();
  const revIdx = args.indexOf('--rev');
  const rev = revIdx >= 0 ? args[revIdx + 1] : '';
  const known = new Set(['--history', '--json', '--root', root, '--rev', rev]);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length) {
    process.stderr.write(`privacy-guard: unknown argument(s): ${unknown.join(' ')}\nusage: privacy-guard.mjs [--history [--rev <rev>]] [--json] [--root <dir>]\n`);
    return 2;
  }
  let result;
  try {
    result = scan(root, { history: flag('--history'), rev });
  } catch (err) {
    process.stderr.write(`privacy-guard: could not scan (${err instanceof Error ? err.message : err})\n`);
    return 2;
  }
  const mode = flag('--history') ? 'history' : 'index';
  if (flag('--json')) {
    process.stdout.write(JSON.stringify({ mode, ...result }, null, 2) + '\n');
  } else if (result.violations.length) {
    for (const x of result.violations) {
      const where = `${x.path}${x.line ? `:${x.line}` : ''}${x.commit ? ` (commit ${x.commit.slice(0, 10)})` : ''}`;
      process.stderr.write(`privacy-guard: [${x.rule}] ${where}: ${x.detail}\n`);
    }
    process.stderr.write(`privacy-guard: FAIL, ${result.violations.length} violation(s) in ${result.scannedFiles} file(s) (${mode} scan). See docs/privacy.md.\n`);
  } else {
    const extra = mode === 'history' ? `, ${result.scannedCommits} commit(s)` : '';
    process.stdout.write(`privacy-guard: ok, ${result.scannedFiles} file(s)${extra} (${mode} scan)\n`);
  }
  return result.violations.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv);
}
