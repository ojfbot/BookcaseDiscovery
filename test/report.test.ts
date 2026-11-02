// W-1: the report scaffold. Built from the in-memory synthetic ledger (test/helpers/report-fixture.ts):
// a generated shelf of coloured rectangles with invented titles. No photo is read or committed.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pixelSize } from "../src/capture/working-copy.ts";
import { ImageStore, MemoryLedger, SqliteLedger } from "../src/ledger/index.ts";
import type { NewEvent } from "../src/ledger/index.ts";
import { displaySize, pickRun, reportCommand, ReportError, scalePolygon, writeReport } from "../src/report/index.ts";
import { BAND, STATUS } from "../src/report/render.ts";
import { toolsAvailable } from "./helpers/synth.ts";
import { RUN, SESSION, syntheticReport } from "./helpers/report-fixture.ts";
import type { SyntheticReport } from "./helpers/report-fixture.ts";

/** Tags with their structural attributes, one per line, indented; text only where it names a section. Style and script bodies are dropped. */
function skeleton(html: string, hashes: string[]): string {
  let src = html.replace(/<style>[\s\S]*?<\/style>/g, "<style></style>").replace(/<script>[\s\S]*?<\/script>/g, "<script></script>");
  hashes.forEach((h, i) => {
    src = src.split(h.slice(0, 16)).join(`@WC${i}x16@`).split(h.slice(0, 12)).join(`@WC${i}x12@`);
  });
  const keep = /^(id|class|href|role|data-[a-z-]+|aria-[a-z]+|points|viewBox|src|width|height|lang)$/;
  const textual = /^(h1|h2|h3|h4|button|figcaption|title|label)$/;
  // Detail inside a table or a list is covered by the content tests; the snapshot keeps the page's frame.
  const plain = new Set(["tr", "td", "th", "li", "b", "span", "dd", "dt", "p", "br", "ul", "ol", "dl", "table", "line", "circle", "rect", "defs", "pattern", "meta"]);
  const void_ = new Set(["meta", "img", "input", "line", "polygon", "rect", "circle", "br", "text-skip"]);
  const out: string[] = [];
  let depth = 0;
  const stack: string[] = [];
  const hiddenDepth = new Set<number>(); // stack levels whose tag printed nothing
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*?)?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[5] !== undefined) {
      const text = m[5].replace(/\s+/g, " ").trim();
      if (text && textual.test(stack[stack.length - 1] ?? "")) out.push(`${"  ".repeat(depth)}"${text.slice(0, 90)}"`);
      continue;
    }
    const [, close, name, attrs] = m;
    const tag = name!.toLowerCase();
    if (close) {
      if (hiddenDepth.delete(stack.length)) stack.pop();
      else {
        stack.pop();
        depth = Math.max(0, depth - 1);
      }
      continue;
    }
    const shown = [...attrs!.matchAll(/([a-zA-Z:-]+)(?:="([^"]*)")?/g)].filter((a) => keep.test(a[1]!)).map((a) => (a[2] === undefined ? a[1] : `${a[1]}="${a[2]}"`));
    const hidden = plain.has(tag) && shown.length === 0;
    if (!hidden) out.push(`${"  ".repeat(depth)}<${tag}${shown.length ? " " + shown.join(" ") : ""}>`);
    if (!void_.has(tag) && !m[4]) {
      stack.push(tag);
      if (!hidden) depth += 1;
      else hiddenDepth.add(stack.length);
    }
  }
  return out.join("\n") + "\n";
}

const polygonPoints = (html: string, id: string, which = "edge"): [number, number][] => {
  const a = new RegExp(`<a id="s-${id}"[\\s\\S]*?<polygon class="${which}" points="([^"]+)"`).exec(html);
  expect(a, `spine ${id} in the overlay`).toBeTruthy();
  return a![1]!.split(" ").map((p) => p.split(",").map(Number) as [number, number]);
};
const section = (html: string, id: string): string => new RegExp(`<(section|article|aside)[^>]* id="${id}"[\\s\\S]*?</\\1>`).exec(html)![0];

describe("pure parts", () => {
  it("display size: long edge at most 3000, never enlarged", () => {
    expect(displaySize(4000, 3000)).toEqual({ width: 3000, height: 2250 });
    expect(displaySize(3000, 4000)).toEqual({ width: 2250, height: 3000 });
    expect(displaySize(1600, 1200)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a polygon from working-copy pixels to display pixels", () => {
    const poly = scalePolygon([[100, 50], [140, 50], [140, 900], [100, 900]], { width: 4000, height: 3000 }, { width: 3000, height: 2250 });
    expect(poly).toEqual([[75, 37.5], [105, 37.5], [105, 675], [75, 675]]);
  });

  it("each status has its own hatch and colour; each band its own stroke and glyph (greyscale and colour-blind reading)", () => {
    expect(new Set(Object.values(STATUS).map((s) => s.hatch)).size).toBe(Object.keys(STATUS).length);
    expect(new Set(Object.values(STATUS).map((s) => s.colour)).size).toBe(Object.keys(STATUS).length);
    expect(new Set(Object.values(BAND).map((b) => b.glyph)).size).toBe(Object.keys(BAND).length);
    // verified and "not banded" are both solid strokes: they differ by glyph and width, so the glyph must differ
    expect(new Set(Object.values(BAND).map((b) => b.dash)).size).toBeGreaterThanOrEqual(4);
  });

  it("picks the latest run unless --run names one", () => {
    const l = new MemoryLedger();
    expect(() => pickRun(l)).toThrow(ReportError);
    const run = (id: string): NewEvent => ({ type: "RunStarted", ts: "2026-11-02T10:00:00Z", runId: id, payload: { codeCommit: "5108a5c", helperVersions: {}, modelIds: [], budget: {} } });
    l.append(run("run-a"));
    l.append(run("run-b"));
    expect(pickRun(l).runId).toBe("run-b");
    expect(pickRun(l, "run-a").runId).toBe("run-a");
    expect(() => pickRun(l, "run-z")).toThrow(/no run "run-z"/);
  });
});

describe.skipIf(!toolsAvailable())("report from the synthetic ledger", () => {
  let dataDir: string;
  let fx: SyntheticReport;
  let out: ReturnType<typeof writeReport>;
  let html: string;

  beforeAll(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bookcase-report-"));
    fx = syntheticReport(dataDir);
    out = writeReport({ ledger: fx.ledger, session: fx.session, dataDir });
    html = readFileSync(out.index, "utf8");
  });
  afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

  it("writes reports/<session>/<run>/ under the data dir, never anywhere else", () => {
    expect(out.dir).toBe(join(dataDir, "reports", SESSION, RUN));
    expect(readdirSync(out.dir).sort()).toEqual(["images", "index.html"]);
    expect(out.warnings).toEqual([]);
  });

  it("makes display derivatives of the working copies: long edge ≤ 3000, a smaller photo is not enlarged", () => {
    const sizes = readdirSync(join(out.dir, "images")).map((f) => pixelSize(join(out.dir, "images", f)));
    expect(sizes).toHaveLength(2);
    expect(sizes).toContainEqual({ width: 3000, height: 2250 });
    expect(sizes).toContainEqual({ width: 1600, height: 1200 });
  });

  it("reads the working copy and leaves the store as it was; the original is never opened (it is not even stored)", () => {
    const store = new ImageStore(dataDir);
    expect(store.has(fx.originalHash)).toBe(false);
    for (const h of fx.workingCopyHashes) {
      expect(store.verify(h)).toBe(true);
      expect(statSync(store.find(h)!).mode & 0o222).toBe(0); // still read-only
    }
  });

  it("scales every polygon from working-copy to display pixels (3200×2400 → 3000×2250)", () => {
    const k = 3000 / 3200;
    const original = fx.ledger.observation("obs-s0-0")!.spine.polygon;
    const drawn = polygonPoints(html, "obs-s0-0");
    drawn.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(original[i]![0] * k, 1);
      expect(y).toBeCloseTo(original[i]![1] * (2250 / 2400), 1);
    });
    // the closer photo is 1600×1200: not scaled
    expect(polygonPoints(html, "obs-c-0")).toEqual(fx.ledger.observation("obs-c-0")!.spine.polygon);
  });

  it("has a box and a panel for every spine, coloured by status and banded by stroke", () => {
    const spines = fx.ledger.observations({ sessionId: SESSION });
    expect(spines).toHaveLength(14);
    for (const s of spines) {
      expect(html).toContain(`id="s-${s.observationId}"`);
      expect(html).toContain(`id="p-${s.observationId}"`);
    }
    expect(html).toMatch(/id="s-obs-s0-4" class="spine st-needs-pixels bd-unknown"/);
    expect(html).toMatch(/id="s-obs-s0-0" class="spine st-resolved bd-verified"/);
    expect(html).toMatch(/id="s-obs-s0-6" class="spine st-none bd-none"/);
    expect(html).toMatch(/id="s-obs-s1-0" class="spine st-paused bd-none"/);
    // the pattern channel: hatches are defined per image and used as fills
    expect(html).toContain('fill="url(#p0-unresolved)"');
    expect(html).toContain('fill="url(#p0-needs-pixels)"');
    expect(html).toContain('fill="url(#p0-paused)"');
  });

  it("side panel: OCR variants, candidates including unknown, evidence, versions and status history", () => {
    const p = section(html, "p-obs-s0-0");
    expect(p).toContain("THE LANTERN YEARS");
    expect(p).toContain("corrected"); // the second variant had language correction on
    expect(p).toContain("The Lantern Years");
    expect(p).toContain("<b>unknown</b>");
    expect(p).toContain("title-fragment");
    expect(p).toContain("trigram overlap");
    expect(p).toContain("synthetic-detector 0.0.0");
    expect(p).toContain("synthetic-ocr 0.0.0");
    expect(p).toContain("5108a5c0000000000000000000000000000000ff");
    expect(p).toContain("(new) → unresolved");
    expect(p).toContain("unresolved → resolved");
    expect(p).toContain("band verified: work-lantern");
    expect(p).toContain("SYNTH"); // the adjudicator is labelled as such
    // a reopened spine shows its trigger
    const reopened = section(html, "p-obs-s0-5");
    expect(reopened).toMatch(/resolved → unresolved \(correction, event \d+\)/);
    expect(reopened).toContain("corrected: not work-meridian");
    // a paused spine says why
    expect(section(html, "p-obs-s1-0")).toContain("unresolved → paused (budget spent)");
    // a spine with no candidates still shows the unknown hypothesis
    expect(section(html, "p-obs-s0-4")).toContain("<b>unknown</b>");
    // a detected-only spine says so
    expect(section(html, "p-obs-s0-6")).toContain("No OCR yet");
  });

  it("lists every unresolved spine with its reason", () => {
    const u = section(html, "unresolved");
    const open = fx.ledger.observations({ sessionId: SESSION }).filter((o) => o.status !== "resolved");
    expect(open).toHaveLength(8);
    for (const o of open) expect(u).toContain(`data-obs="${o.observationId}"`);
    for (const resolved of ["obs-s0-0", "obs-s0-1", "obs-s1-2", "obs-s1-3", "obs-c-0", "obs-c-1"]) expect(u).not.toContain(`data-obs="${resolved}"`);
    expect(u).toContain("The evidence points at more than one book");
    expect(u).toContain("Too few pixels on the spine to read it");
    expect(u).toContain("no book in the catalog matches it");
    expect(u).toContain("the run&#39;s budget was spent");
    expect(u).toContain("Detected; not assessed yet.");
  });

  it("lists closer-photo work items, open first", () => {
    const c = section(html, "closer-photos");
    expect(c.indexOf('data-obs="obs-s0-4"')).toBeLessThan(c.indexOf('data-obs="obs-s1-4"')); // open before fulfilled
    expect(c).toContain("open");
    expect(c).toContain("fulfilled");
    expect(c.match(/<tr data-obs=/g)).toHaveLength(3);
  });

  it("has a placeholder recommendations panel, the run's versions and the rejected files", () => {
    expect(section(html, "recommendations")).toContain("1 recommendation in the ledger");
    expect(section(html, "run")).toContain("synthetic-model");
    expect(section(html, "run")).toContain("IMG_0003.HEIC");
  });

  it("is a self-contained page: no network reference", () => {
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/url\(\s*["']?https?:/);
  });

  it("is reproducible: the same ledger gives the same page", () => {
    const again = writeReport({ ledger: fx.ledger, session: fx.session, dataDir });
    expect(readFileSync(again.index, "utf8")).toBe(html);
  });

  it("structure snapshot", () => {
    expect(skeleton(html, fx.workingCopyHashes)).toMatchSnapshot();
  });

  it("escapes everything that came from a photo or the ledger", () => {
    const evil = new MemoryLedger();
    for (const e of fx.ledger.events()) {
      const { seq: _seq, ...rest } = e;
      evil.append(rest as NewEvent);
    }
    evil.append({ type: "TextObserved", ts: "2026-11-02T11:00:00Z", runId: RUN, payload: { observationId: "obs-s0-6", rotation: 0, langCorrection: false, text: `<img src=x onerror="alert(1)">`, confidence: 0.5, ocr: { helper: "synthetic-ocr 0.0.0", os: "synthetic-os 1.0", requestRevision: 3 } } });
    const dir = mkdtempSync(join(tmpdir(), "bookcase-report-evil-"));
    try {
      mkdirSync(join(dir, "images"), { recursive: true });
      const r = writeReport({ ledger: evil, session: SESSION, dataDir: dir }); // images not in this store: a blank frame
      const page = readFileSync(r.index, "utf8");
      expect(page).not.toContain("<img src=x");
      expect(page).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("without the working copy in the store: warns and draws the boxes on a blank frame", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcase-report-noimg-"));
    try {
      const r = writeReport({ ledger: fx.ledger, session: SESSION, dataDir: dir });
      expect(r.warnings).toHaveLength(2);
      expect(readFileSync(r.index, "utf8")).toContain("working copy not in the image store");
      expect(readdirSync(join(r.dir, "images"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a session or run that cannot be a folder name, a session with no images, and an unknown run", () => {
    expect(() => writeReport({ ledger: fx.ledger, session: "nobody", dataDir })).toThrow(/no images for session "nobody"/);
    expect(() => writeReport({ ledger: fx.ledger, session: SESSION, runId: "run-nope", dataDir })).toThrow(/no run "run-nope"/);
    expect(() => writeReport({ ledger: fx.ledger, session: "../evil", dataDir })).toThrow(ReportError); // no images, so it fails first; the name check is next
    expect(existsSync(join(dataDir, "evil"))).toBe(false);
  });

  describe("bookcase report (CLI, SQLite ledger)", () => {
    it("writes the report from $BOOKCASE_DATA/ledger.sqlite and prints its path", () => {
      const cliDir = mkdtempSync(join(tmpdir(), "bookcase-report-cli-"));
      try {
        // the same events in a SQLite ledger, the same working copies in the same store layout
        const db = new SqliteLedger(join(cliDir, "ledger.sqlite"));
        for (const e of fx.ledger.events()) {
          const { seq: _seq, ...rest } = e;
          db.append(rest as NewEvent);
        }
        db.close();
        const store = new ImageStore(cliDir);
        const own = new ImageStore(dataDir);
        for (const h of fx.workingCopyHashes) store.putFile(own.find(h)!, "jpg");

        const logs: string[] = [];
        const real = console.log;
        console.log = (...a: unknown[]) => void logs.push(a.join(" "));
        let code: number;
        try {
          code = reportCommand([SESSION], { BOOKCASE_DATA: cliDir });
        } finally {
          console.log = real;
        }
        expect(code).toBe(0);
        expect(logs.join("\n")).toContain(join(cliDir, "reports", SESSION, RUN, "index.html"));
        expect(readFileSync(join(cliDir, "reports", SESSION, RUN, "index.html"), "utf8")).toContain("THE LANTERN YEARS");
      } finally {
        rmSync(cliDir, { recursive: true, force: true });
      }
    });

    it("exits 1 with a usage or a clear error", () => {
      const empty = mkdtempSync(join(tmpdir(), "bookcase-report-cli-"));
      try {
        const quiet = (fn: () => number) => {
          const real = console.error;
          console.error = () => {};
          try {
            return fn();
          } finally {
            console.error = real;
          }
        };
        expect(quiet(() => reportCommand([], { BOOKCASE_DATA: empty }))).toBe(1);
        expect(quiet(() => reportCommand([SESSION], { BOOKCASE_DATA: empty }))).toBe(1); // no ledger there
        expect(quiet(() => reportCommand(["--bogus"], { BOOKCASE_DATA: empty }))).toBe(1);
      } finally {
        rmSync(empty, { recursive: true, force: true });
      }
    });
  });
});
