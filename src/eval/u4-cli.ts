// U-4 still study: every pilot-000 photo drawn in every display variant (src/report/display-modes.ts), on one
// private page with a mode switcher and a side-by-side A/B view.
//
//   node src/eval/u4-cli.ts render     # photos, one SVG overlay per photo and variant, index.html (private)
//
//   node src/eval/u4-cli.ts render --source f0b   # U-4 as first shipped, for before/after comparisons
//
// Inputs, all cached, no model runs: F-0e's `bands+strips` boxes (one oriented box per spine, plus bands) and
// the catalog for the labelling mode's guess. Shapes, rungs and guesses come from one of two sources:
// - `q2b` (default): Q-2b's SAM 2.1 mask outline of each box itself (helpers/label/outline.py on these boxes),
//   Q-2b's teacher rungs and F-0's decision on these boxes; F-0c's not-a-book boxes are left out, as the
//   default pipeline does;
// - `f0b`: F-0b's outlines and Q-2's rungs and decisions, all on F-0's boxes, attached to F-0e's boxes by
//   overlap (display-draw.ts attachPieces).
// Everything goes under the data root's `private/u4/`; the study prints aggregates only.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dataRoot } from "../ledger/images.ts";
import { catalogPaths, openCatalog } from "../catalog/cli.ts";
import { makeDerivative } from "../report/index.ts";
import { MODES, VARIANTS, checkRegistry, coverageState, variantHash } from "../report/display-modes.ts";
import type { DisplayVariant, ShapeSpec } from "../report/display-modes.ts";
import { attachPieces, baseOutline, overlaySvg, partialFlags, quadAxis, stillProxies } from "../report/display-draw.ts";
import type { Piece, Pt, Scene, SceneSpine } from "../report/display-draw.ts";
import { decide, loadReadings, readJsonl, type SpineDecision } from "./f0.ts";
import { kinds } from "./f0c.ts";
import type { Candidate } from "../catalog/retrieve.ts";
import { quantile, rng } from "./q1.ts";
import type { Rung } from "./q2.ts";

const ROOT = dataRoot();
const SET = "pilot-000";
const ARM = "bands+strips";
const OUT = join(ROOT, "private", "u4", "renders", SET);
/** Long edge of the study's photos: enough to judge a highlight, light enough for 31 photos on one page. */
const STUDY_EDGE = 2000;
/** Detector tile size and step for the bands layout (helpers/label/detect.py band_tiles, F-0e). */
const TILE = 1600;
const OVERLAP = 700;
const BAND_MARGIN = 0.12;

/** Where shapes, rungs and guesses come from (see the header). */
type Source = "q2b" | "f0b";
const SOURCE: Source = process.argv.includes("--source") ? (process.argv[process.argv.indexOf("--source") + 1] as Source) : "q2b";
if (SOURCE !== "q2b" && SOURCE !== "f0b") throw new Error("--source is q2b or f0b");

const log = (s: string): void => console.error(`[u4] ${s}`);
const median = (xs: number[]): number => quantile([...xs].sort((a, b) => a - b), 0.5);

interface Det {
  id: string;
  width: number;
  height: number;
  spines: { polygon: Pt[]; boxScore: number; cut: boolean }[];
  bands: { polygon: Pt[] }[];
  gaps: { medianWidth: number };
  error?: string;
}

// --- inputs --------------------------------------------------------------------------------------------------

const starts = (n: number): number[] => {
  if (n <= TILE) return [0];
  const out: number[] = [];
  for (let x = 0; x < n - TILE; x += TILE - OVERLAP) out.push(x);
  out.push(n - TILE);
  return out;
};

/**
 * The bands layout's fine tiles, rebuilt from the bands the run *returned*. detect.py placed them along the coarse
 * pass's bands, which are not cached, so these edges are approximate and the dev layer says so.
 */
function approxTiles(d: Det): [number, number, number, number][] {
  return d.bands.flatMap((b) => {
    const xs = b.polygon.map((p) => p[0]);
    const ys = b.polygon.map((p) => p[1]);
    const m = BAND_MARGIN * (Math.max(...ys) - Math.min(...ys));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) - m));
    const y1 = Math.min(d.height, Math.floor(Math.max(...ys) + m));
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - m));
    const x1 = Math.min(d.width, Math.floor(Math.max(...xs) + m));
    return starts(x1 - x0).map((x): [number, number, number, number] => [x0 + x, y0, Math.min(x0 + x + TILE, x1), y1]);
  });
}

function guessOf(d: SpineDecision | undefined, title: (workId: string) => string | null): string | null {
  if (!d) return null;
  if (d.accepted) return title(d.accepted.workId);
  const conf = Object.values(d.confirmed).find(Boolean);
  if (conf) return title(conf);
  const top = Object.values(d.top).find(Boolean);
  return top ? `${title(top) ?? "?"} ?` : null;
}

/** Per F-0e box: its own shape (or none), rung and guess, and whether the default pipeline keeps it. */
interface Attached { pieces: Pt[][]; rung: Rung; guess: string | null; maskShare: number; keep: boolean }

/** Q-2b: each box's own mask outline, clipped and accepted by attachPieces' rules, one box at a time. */
function ownPieces(d: Det, outlines: Map<string, Pt[]>, rungs: Map<string, Rung>, decisions: Map<string, SpineDecision>, title: (workId: string) => string | null): Attached[] {
  const k = kinds({ ...(d as unknown as Parameters<typeof kinds>[0]), covers: [] });
  return d.spines.map((s, i) => {
    const id = `${d.id}:${i}`;
    const outline = outlines.get(id);
    const rung = rungs.get(id) ?? "spine-found";
    const guess = guessOf(decisions.get(id), title);
    const a = attachPieces([s.polygon], outline && outline.length >= 3 ? [{ outline, rung, guess }] : [])[0]!;
    return { pieces: a.pieces, rung, guess, maskShare: a.maskShare, keep: k.spines[i]!.kind === "spine" };
  });
}

function loadScenes(): { scenes: { name: string; imageId: string; source: string; scene: Scene }[]; maskShares: number[] } {
  const images = readJsonl<{ id: string; image: string }>(join(ROOT, "private", "f0e", `images-${SET}.jsonl`));
  const f0e = new Map(readJsonl<Det>(join(ROOT, "f0e", SET, ARM, "detect.jsonl")).filter((d) => !d.error).map((d) => [d.id, d]));
  const f0 = new Map(readJsonl<Det>(join(ROOT, "f0", SET, "detect.jsonl")).filter((d) => !d.error).map((d) => [d.id, d]));
  const outlines = new Map(
    readJsonl<{ id: string; outline?: Pt[] }>(SOURCE === "q2b" ? join(ROOT, "private", "q2b", "outlines", `${SET}.jsonl`) : join(ROOT, "private", "f0b", SET, "outline.jsonl"))
      .filter((r) => r.outline)
      .map((r) => [r.id, r.outline!]),
  );
  const rungs = new Map(readJsonl<{ id: string; rung: Rung }>(join(ROOT, "private", SOURCE === "q2b" ? "q2b" : "q2", "table", `${SET}.jsonl`)).map((r) => [r.id, r.rung]));
  const db: DatabaseSync = openCatalog(catalogPaths().catalog);
  // F-0's decision per box: cached for F-0's boxes; on F-0e's, computed once from the readings F-0e cached (as F-0c
  // does; about 15 minutes of catalog retrieval) and kept under private/u4/. Delete that file after a re-read.
  let decisions: Map<string, SpineDecision>;
  if (SOURCE === "q2b") {
    const cached = join(ROOT, "private", "u4", `decisions-${SET}.jsonl`);
    if (!existsSync(cached)) {
      log("deciding every box from F-0e's readings (once)");
      const readings = loadReadings(join(ROOT, "f0e", SET, ARM));
      const cache = new Map<string, Candidate | undefined>();
      const all = [...f0e.values()].flatMap((d) => d.spines.map((s, i) => decide(db, `${d.id}:${i}`, d.id, s.boxScore, readings.get(`${d.id}:${i}`) ?? {}, cache)));
      writeFileSync(cached, all.map((x) => JSON.stringify(x)).join("\n") + "\n");
    }
    decisions = new Map(readJsonl<SpineDecision>(cached).map((d) => [d.id, d]));
  } else decisions = new Map(readJsonl<SpineDecision>(join(ROOT, "f0", SET, "decisions.jsonl")).map((d) => [d.id, d]));
  const titleStmt = db.prepare("SELECT title FROM works WHERE id = ?");
  const title = (id: string): string | null => (titleStmt.get(id) as { title: string } | undefined)?.title ?? null;
  const maskShares: number[] = [];
  const scenes = images.map((img, n) => {
    const d = f0e.get(img.id);
    if (!d) throw new Error(`photo ${n + 1} has no ${ARM} detections`);
    const quads = d.spines.map((s) => s.polygon);
    const bands = d.bands.map((b) => b.polygon);
    let attached: Attached[];
    if (SOURCE === "q2b") attached = ownPieces(d, outlines, rungs, decisions, title);
    else {
      const pieces: Piece[] = (f0.get(img.id)?.spines ?? []).flatMap((_, i): Piece[] => {
        const id = `${img.id}:${i}`;
        const outline = outlines.get(id);
        const rung = rungs.get(id);
        return outline && outline.length >= 3 && rung ? [{ outline, rung, guess: guessOf(decisions.get(id), title) }] : [];
      });
      attached = attachPieces(quads, pieces).map((a) => ({ ...a, keep: true }));
    }
    const partial = partialFlags(quads, bands);
    const spines: SceneSpine[] = d.spines.flatMap((s, i): SceneSpine[] => {
      const a = attached[i]!;
      if (!a.keep) return [];
      maskShares.push(a.maskShare);
      return [{ index: i, quad: s.polygon, pieces: a.pieces, boxScore: s.boxScore, cut: s.cut, partial: partial[i]!, rung: a.rung, guess: a.guess }];
    });
    return { name: `${SET}-${String(n + 1).padStart(2, "0")}`, imageId: img.id, source: img.image, scene: { width: d.width, height: d.height, spines, bands, tiles: approxTiles(d) } };
  });
  db.close();
  return { scenes, maskShares };
}

/** Mean luma (0–1) of a JPEG, from a 16×16 BMP that sips writes: a cheap light-or-dark scene tag. */
function meanLuma(jpg: string, tmp: string): number {
  execFileSync("sips", ["-s", "format", "bmp", "-z", "16", "16", jpg, "--out", tmp], { stdio: "pipe" });
  const b = readFileSync(tmp);
  const off = b.readUInt32LE(10);
  const w = b.readInt32LE(18);
  const h = Math.abs(b.readInt32LE(22));
  const bpp = b.readUInt16LE(28) / 8;
  const row = Math.ceil((w * bpp) / 4) * 4;
  let s = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = off + y * row + x * bpp;
      s += (0.0722 * b[p]! + 0.7152 * b[p + 1]! + 0.2126 * b[p + 2]!) / 255;
    }
  return s / (w * h);
}

// --- proxies -------------------------------------------------------------------------------------------------

interface ProxySummary {
  variant: string;
  source: string;
  jaggedness: number;
  wobble: number;
  areaCv: number;
}

/** Still proxies per variant over every spine, on the shape that variant draws: jaggedness p90, the rest medians. */
function proxies(scenes: Scene[]): ProxySummary[] {
  return VARIANTS.map((v) => {
    const fill = v.layers.find((l) => l.kind === "coverage-fill");
    const spec: ShapeSpec = fill && fill.kind === "coverage-fill" ? fill.shape : { source: "quad", hull: false, smoothing: 0 };
    const rand = rng(4);
    const j: number[] = [];
    const w: number[] = [];
    const a: number[] = [];
    for (const sc of scenes)
      for (const s of sc.spines) {
        const p = stillProxies(baseOutline(s, spec), quadAxis(s.quad).short, spec, rand);
        j.push(p.jaggedness);
        w.push(p.wobble);
        a.push(p.areaCv);
      }
    const med = (xs: number[]) => Math.round(median(xs) * 1000) / 1000;
    return { variant: v.id, source: `${spec.source}${spec.hull ? " hull" : ""}, ${spec.smoothing} smoothing pass${spec.smoothing === 1 ? "" : "es"}`, jaggedness: Math.round(quantile([...j].sort((x, y) => x - y), 0.9) * 1000) / 1000, wobble: med(w), areaCv: med(a) };
  });
}

// --- page ----------------------------------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface PhotoRow {
  name: string;
  w: number;
  h: number;
  luma: number;
  scene: "bright" | "dim";
  spines: number;
  filled: number;
  shaped: number;
}

function page(rows: PhotoRow[], px: ProxySummary[], counts: Record<string, number>): string {
  const variants = VARIANTS.map((v) => ({ id: v.id, mode: v.mode, name: v.name, intent: v.intent, hash: variantHash(v) }));
  const pxRows = px.map((p) => `<tr><td>${esc(p.variant)}</td><td>${esc(p.source)}</td><td>${p.jaggedness}</td><td>${p.wobble}</td><td>${p.areaCv}</td></tr>`).join("");
  const photos = rows
    .map(
      (r) => `<section class="photo" data-scene="${r.scene}" data-name="${r.name}">
<h2>${r.name} <span>${r.scene} scene · ${r.spines} spines · ${r.filled} filled · ${r.shaped} mask-shaped</span></h2>
<div class="pair">${["a", "b"].map((s) => `<figure class="panel" data-side="${s}" style="aspect-ratio:${r.w}/${r.h}"><img class="ph" loading="lazy" src="photos/${r.name}.jpg" alt=""><img class="ov" loading="lazy" alt=""><figcaption></figcaption></figure>`).join("")}</div>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>U-4 display modes · ${SET} (private)</title>
<style>
:root{--paper:#f2efe7;--card:#fcfbf6;--ink:#17140f;--ink2:#574f44;--ground:#1d1b17;--line:rgba(252,251,246,.14)}
*{box-sizing:border-box}body{margin:0;background:var(--ground);color:var(--card);font:14px/1.45 "Helvetica Neue",Helvetica,Arial,sans-serif}
header{position:sticky;top:0;z-index:5;background:rgba(29,27,23,.94);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;flex-wrap:wrap;gap:12px 28px;align-items:center}
h1{font-size:15px;font-weight:800;margin:0;letter-spacing:.01em}h1 small{font-weight:400;color:#b9b2a6;margin-left:6px}
.side{display:flex;gap:8px;align-items:center}.side b{font:600 11px/1 "JetBrains Mono",Menlo,monospace;color:#b9b2a6}
.seg{display:inline-flex;border:1px solid var(--line)}.seg button{all:unset;cursor:pointer;padding:5px 10px;font-size:12px;color:#d9d3c7}.seg button[aria-pressed=true]{background:var(--card);color:var(--ink)}
select{background:#2a2722;color:var(--card);border:1px solid var(--line);padding:4px 6px;font-size:12px}
label{font-size:12px;color:#d9d3c7;display:inline-flex;gap:6px;align-items:center}
main{padding:8px 16px 48px;max-width:1800px;margin:0 auto}
.notes{color:#cfc8bb;max-width:1100px;font-size:13px}.notes code{font-family:"JetBrains Mono",Menlo,monospace;font-size:12px}
table{border-collapse:collapse;font-size:12px;margin:8px 0 4px}td,th{border-bottom:1px solid var(--line);padding:4px 10px;text-align:left}th{color:#b9b2a6;font-weight:600}
.photo{margin:28px 0}.photo h2{font:600 12px/1 "JetBrains Mono",Menlo,monospace;margin:0 0 8px;color:#e9e4d9}.photo h2 span{color:#9d968a;font-weight:400;margin-left:8px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}body.single .pair{grid-template-columns:1fr;max-width:900px}body.single .panel[data-side=b]{display:none}
.panel{position:relative;margin:0;background:#000;cursor:zoom-in;overflow:hidden}.panel img{position:absolute;inset:0;width:100%;height:100%;display:block}
body.peek .ov{opacity:0}.ov{transition:opacity .25s}
figcaption{position:absolute;left:8px;top:8px;font:600 11px/1 "JetBrains Mono",Menlo,monospace;background:rgba(16,14,8,.7);padding:4px 6px;color:var(--card)}
.hide{display:none}
#lb{position:fixed;inset:0;z-index:10;background:rgba(10,9,7,.96);display:none;padding:12px;gap:10px;grid-template-columns:1fr 1fr}#lb.on{display:grid}
#lb .panel{cursor:zoom-out;height:calc(100vh - 24px);aspect-ratio:auto;background:transparent}#lb img{object-fit:contain}
body.single #lb{grid-template-columns:1fr}
</style></head><body>
<header>
<h1>U-4 display modes <small>${SET} · private · ${rows.length} photos</small></h1>
${["a", "b"]
  .map(
    (s) => `<div class="side" data-side="${s}"><b>${s.toUpperCase()}</b><span class="seg" role="group">${Object.keys(MODES)
      .map((m) => `<button data-mode="${m}">${m}</button>`)
      .join("")}</span><select aria-label="variant ${s}"></select></div>`,
  )
  .join("")}
<label><input type="checkbox" id="ab" checked> A/B side by side</label>
<label>scenes <select id="scene"><option value="">all</option><option value="bright">bright</option><option value="dim">dim</option></select></label>
<label title="hold the space bar">space: peek at the bare photo</label>
</header>
<main>
<div class="notes">
<p><b>What this is.</b> Every photo drawn in each display variant (registry: <code>src/report/display-modes.ts</code>). Choose a mode and variant for A and B; click a photo to see it large. Lenses are not shown: this is the All lens, and any lens works inside any mode.</p>
<p><b>Boxes</b> are F-0e's <code>${ARM}</code> run (one box per spine)${SOURCE === "q2b" ? ", without F-0c's not-a-book boxes" : ""}. <b>Object shapes</b> are ${SOURCE === "q2b" ? "SAM 2.1 mask outlines of each box itself (Q-2b), clipped to the box" : "F-0b's SAM mask outlines, which were measured on F-0's boxes; each is attached to the F-0e box holding most of it and clipped to that box"}. A box that ${SOURCE === "q2b" ? "its outline covers" : "the outlines cover"} less than 60 % of is drawn as its box (${counts.shapedPct}% of boxes are mask-shaped). <b>Coverage is per spine, not per segment.</b> Q-0's coverage segments are not built yet (Q-3). ${SOURCE === "q2b" ? "Each spine takes its own Q-2b teacher rung." : "Each spine takes the highest Q-2 rung of the F-0 boxes attached to it; a spine with none stays <code>spine-found</code> (patchy)."} Filled means <code>text-read</code> or above: ${counts.filledPct}% of spines. Tile edges in dev mode are rebuilt from the returned bands, so they are approximate. Rungs are machine agreement, not accuracy.</p>
<table><thead><tr><th>variant</th><th>outline drawn</th><th>jaggedness p90</th><th>perturbation wobble</th><th>area CV</th></tr></thead><tbody>${pxRows}</tbody></table>
<p style="font-size:12px;color:#9d968a">Still proxies over every spine: jaggedness at the 90th percentile, the others medians (definitions in <code>docs/capture/display-modes.md</code>). Jaggedness 0 = convex. Wobble below 1 means the drawn edge moves less than the mask noise put in (σ = 2 % of the spine's width).</p>
</div>
${photos}
</main>
<div id="lb"></div>
<script>
const V=${JSON.stringify(variants)};
const state={a:"user-glow",b:"user-veil"};
try{const s=JSON.parse(localStorage.getItem("u4")||"{}");if(V.some(v=>v.id===s.a))state.a=s.a;if(V.some(v=>v.id===s.b))state.b=s.b}catch(e){}
const modeOf=id=>V.find(v=>v.id===id).mode;
function sync(){
  for(const s of ["a","b"]){
    const box=document.querySelector('.side[data-side="'+s+'"]');const m=modeOf(state[s]);
    box.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.mode===m));
    const sel=box.querySelector("select");sel.innerHTML=V.filter(v=>v.mode===m).map(v=>'<option value="'+v.id+'"'+(v.id===state[s]?" selected":"")+">"+v.name+"</option>").join("");
    const v=V.find(x=>x.id===state[s]);sel.title=v.intent+" · "+v.hash;
    document.querySelectorAll('.panel[data-side="'+s+'"]').forEach(p=>{const n=p.closest(".photo").dataset.name;p.querySelector(".ov").src="overlays/"+n+"-"+state[s]+".svg";p.querySelector("figcaption").textContent=s.toUpperCase()+" · "+v.name});
  }
  try{localStorage.setItem("u4",JSON.stringify(state))}catch(e){}
}
document.querySelectorAll(".side").forEach(box=>{const s=box.dataset.side;
  box.querySelectorAll("button").forEach(b=>b.onclick=()=>{state[s]=V.find(v=>v.mode===b.dataset.mode).id;sync()});
  box.querySelector("select").onchange=e=>{state[s]=e.target.value;sync()}});
document.getElementById("ab").onchange=e=>document.body.classList.toggle("single",!e.target.checked);
document.getElementById("scene").onchange=e=>document.querySelectorAll(".photo").forEach(p=>p.classList.toggle("hide",!!e.target.value&&p.dataset.scene!==e.target.value));
const lb=document.getElementById("lb");
document.querySelectorAll(".photo .panel").forEach(p=>p.onclick=()=>{lb.innerHTML=p.closest(".pair").innerHTML;lb.querySelectorAll("img").forEach(i=>i.loading="eager");lb.classList.add("on")});
lb.onclick=()=>{lb.classList.remove("on");lb.innerHTML=""};
addEventListener("keydown",e=>{if(e.code==="Space"&&e.target===document.body){e.preventDefault();document.body.classList.add("peek")}if(e.key==="Escape")lb.onclick()});
addEventListener("keyup",e=>{if(e.code==="Space")document.body.classList.remove("peek")});
sync();
</script>
</body></html>
`;
}

// --- render --------------------------------------------------------------------------------------------------

function render(): void {
  const problems = checkRegistry();
  if (problems.length) throw new Error(`display registry: ${problems.join("; ")}`);
  const { scenes, maskShares } = loadScenes();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, "photos"), { recursive: true });
  mkdirSync(join(OUT, "overlays"), { recursive: true });
  const tmp = join(OUT, "luma.bmp");
  const rows: PhotoRow[] = [];
  for (const s of scenes) {
    const size = makeDerivative(s.source, join(OUT, "photos", `${s.name}.jpg`), s.scene, STUDY_EDGE);
    for (const v of VARIANTS) writeFileSync(join(OUT, "overlays", `${s.name}-${v.id}.svg`), overlaySvg(s.scene, v as DisplayVariant, size));
    rows.push({
      name: s.name,
      w: size.width,
      h: size.height,
      luma: meanLuma(join(OUT, "photos", `${s.name}.jpg`), tmp),
      scene: "dim",
      spines: s.scene.spines.length,
      filled: s.scene.spines.filter((x) => coverageState(x.rung) === "filled").length,
      shaped: s.scene.spines.filter((x) => x.pieces.length).length,
    });
    log(`${s.name}: ${VARIANTS.length} overlays`);
  }
  rmSync(tmp, { force: true });
  const mid = median(rows.map((r) => r.luma));
  for (const r of rows) r.scene = r.luma >= mid ? "bright" : "dim";
  const all = scenes.flatMap((s) => s.scene.spines);
  const pct = (n: number) => Math.round((1000 * n) / all.length) / 10;
  const counts = { shapedPct: pct(all.filter((x) => x.pieces.length).length), filledPct: pct(all.filter((x) => coverageState(x.rung) === "filled").length) };
  const px = proxies(scenes.map((s) => s.scene));
  writeFileSync(join(OUT, "index.html"), page(rows, px, counts));
  const rungShare: Record<string, number> = {};
  for (const x of all) rungShare[x.rung] = (rungShare[x.rung] ?? 0) + 1;
  const summary = {
    source: SOURCE,
    photos: scenes.length,
    spines: all.length,
    maskShaped: counts.shapedPct,
    maskShareP50: Math.round(median(maskShares) * 100) / 100,
    filled: counts.filledPct,
    rungs: Object.fromEntries(Object.entries(rungShare).map(([k, n]) => [k, pct(n)])),
    variants: VARIANTS.map((v) => ({ id: v.id, hash: variantHash(v) })),
    proxies: px,
  };
  writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  log(`wrote the study page under the data root (private/u4/renders/${SET}/index.html)`);
}

const cmd = process.argv[2];
if (cmd === "render") render();
else {
  console.error("usage: node src/eval/u4-cli.ts render [--source q2b|f0b]");
  process.exit(2);
}
