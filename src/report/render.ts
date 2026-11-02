// Model → one static `index.html`. Pure: the same model gives the same bytes. Every string that came from
// a photo or the ledger (OCR text, titles, ids) goes through `esc`.
import type { Band, Status } from "../ledger/index.ts";
import { CSS, JS } from "./assets.ts";
import { REASON_TEXT } from "./model.ts";
import type { DisplayImage, ReportModel, SpineModel } from "./model.ts";

export const esc = (s: string | number): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

type StatusKey = Status | "none";
type BandKey = Band | "none";

/** Status → colour, hatch and word. Colour is one channel; the hatch and the word are the others. */
export const STATUS: Record<StatusKey, { colour: string; word: string; hatch: "solid" | "diagonal" | "cross" | "dots" | "none" }> = {
  resolved: { colour: "#2f7d5b", word: "resolved", hatch: "solid" },
  unresolved: { colour: "#a8730f", word: "unresolved", hatch: "diagonal" },
  "needs-pixels": { colour: "#e2231a", word: "needs closer photo", hatch: "cross" },
  paused: { colour: "#2f6b86", word: "paused (budget)", hatch: "dots" },
  none: { colour: "#7d7466", word: "detected", hatch: "none" },
};
const STATUS_ORDER: StatusKey[] = ["resolved", "unresolved", "needs-pixels", "paused", "none"];

/** Band → stroke pattern (CSS in assets.ts), glyph and word. */
export const BAND: Record<BandKey, { glyph: string; word: string; dash: string }> = {
  verified: { glyph: "◼", word: "verified", dash: "" },
  probable: { glyph: "◧", word: "probable", dash: "9 4" },
  candidate: { glyph: "◻", word: "candidate", dash: "2 3" },
  unknown: { glyph: "?", word: "unknown", dash: "12 3 2 3" },
  none: { glyph: "·", word: "not banded", dash: "" },
};
const BAND_ORDER: BandKey[] = ["verified", "probable", "candidate", "unknown", "none"];

const EVIDENCE_BADGE: Record<string, { cls: string; word: string }> = {
  "title-fragment": { cls: "ev-derived", word: "DERIVED" },
  "author-fragment": { cls: "ev-derived", word: "DERIVED" },
  isbn: { cls: "ev-derived", word: "DERIVED" },
  series: { cls: "ev-derived", word: "DERIVED" },
  neighbour: { cls: "ev-derived", word: "DERIVED" },
  threshold: { cls: "ev-derived", word: "DERIVED" },
  adjudication: { cls: "ev-synth", word: "SYNTH" },
  correction: { cls: "ev-asserted", word: "ASSERTED" },
};

const short = (hash: string) => hash.slice(0, 12);
const score = (n: number) => n.toFixed(2);
const label = (s: SpineModel) => `shelf ${s.shelf} · ordinal ${s.ordinal}`;
const link = (s: SpineModel, text = label(s)) => `<a href="#p-${esc(s.observationId)}" data-obs="${esc(s.observationId)}">${esc(text)}</a>`;

// ---- patterns ------------------------------------------------------------------------------

/** One hatch tile for `status`; `u` is its size in display pixels (scaled to the image so hatches look alike at any size). */
function tile(id: string, status: "unresolved" | "needs-pixels" | "paused", u: number): string {
  const c = STATUS[status].colour;
  const w = Math.max(0.6, u / 6).toFixed(2);
  const line = (x2: number, y2: number) => `<line x1="0" y1="0" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`;
  const body =
    status === "unresolved"
      ? line(0, u)
      : status === "needs-pixels"
        ? line(0, u) + line(u, 0)
        : `<circle cx="${u / 2}" cy="${u / 2}" r="${(u / 5).toFixed(2)}" fill="${c}"/>`;
  const rotate = status === "paused" ? "" : ` patternTransform="rotate(45)"`;
  return `<pattern id="${id}" width="${u}" height="${u}" patternUnits="userSpaceOnUse"${rotate}>${body}</pattern>`;
}

const patterns = (prefix: string, u: number): string => (["unresolved", "needs-pixels", "paused"] as const).map((k) => tile(`${prefix}-${k}`, k, u)).join("");

function fillFor(prefix: string, status: StatusKey): string {
  const h = STATUS[status];
  if (h.hatch === "solid") return `fill="${h.colour}" fill-opacity=".22"`;
  if (h.hatch === "none") return `fill="none"`;
  return `fill="url(#${prefix}-${status})"`;
}

// ---- overlay -------------------------------------------------------------------------------

function polygonPoints(s: SpineModel): string {
  return s.points.map(([x, y]) => `${x},${y}`).join(" ");
}

function spineSvg(s: SpineModel, prefix: string): string {
  const status = (s.status ?? "none") as StatusKey;
  const xs = s.points.map((p) => p[0]);
  const ys = s.points.map((p) => p[1]);
  const cx = Math.round(((Math.min(...xs) + Math.max(...xs)) / 2) * 10) / 10;
  const top = Math.min(...ys);
  const pts = polygonPoints(s);
  const b = BAND[s.band];
  const tip = `${label(s)} · ${STATUS[status].word} · ${b.word}${s.identity?.title ? ` · ${s.identity.title}` : ""}`;
  return (
    `<a id="s-${esc(s.observationId)}" class="spine st-${status} bd-${s.band}" href="#p-${esc(s.observationId)}" data-obs="${esc(s.observationId)}" data-status="${status}" tabindex="0">` +
    `<title>${esc(tip)}</title>` +
    `<polygon class="fill" ${fillFor(prefix, status)} points="${pts}"/>` +
    `<polygon class="edge" points="${pts}"/>` +
    `<polygon class="ring" points="${pts}"/>` +
    `<text class="lbl" x="${cx}" y="${Math.round((top + 0) * 10) / 10}" dy="-.4em">${esc(b.glyph)}${s.ordinal}</text>` +
    `</a>`
  );
}

function figure(img: DisplayImage, index: number, spines: SpineModel[]): string {
  const { width: w, height: h } = img.display;
  const prefix = `p${index}`;
  const edge = Math.max(w, h);
  const unit = Math.max(6, Math.round(edge / 150));
  const mine = spines.filter((s) => s.imageHash === img.imageHash);
  const what = `${img.setting}${img.shelfIndex !== undefined ? ` · shelf ${img.shelfIndex}` : ""}`;
  const base = img.src
    ? `<img src="${esc(img.src)}" width="${w}" height="${h}" alt="Working copy of the photo, ${esc(what)}">`
    : `<svg class="noimg" viewBox="0 0 ${w} ${h}" role="img" aria-label="Photo not in the image store"><text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="${Math.round(edge / 40)}" fill="#574f44">working copy not in the image store</text></svg>`;
  const scaled = img.width !== w || img.height !== h ? ` → ${w}×${h} for display` : "";
  return (
    `<figure class="shot" id="img-${index}" data-image="i${index}">` +
    `<div class="frame">${base}` +
    `<svg class="over" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="--lbl:${Math.round(edge / 80)}px;--lblr:${Math.round(edge / 300) + 2}px" aria-label="Spine overlay">` +
    `<defs>${patterns(prefix, unit)}</defs>${mine.map((s) => spineSvg(s, prefix)).join("")}</svg></div>` +
    `<figcaption>${esc(what)} · working copy ${img.width}×${img.height}${scaled} · ${mine.length} spine${mine.length === 1 ? "" : "s"} · ${esc(short(img.workingCopyHash))}${img.flags.length ? ` · ${esc(img.flags.join(", "))}` : ""}</figcaption>` +
    `</figure>`
  );
}

// ---- controls ------------------------------------------------------------------------------

function swatch(status: StatusKey): string {
  const s = STATUS[status];
  const id = `lg-${status}`;
  const pat = status === "unresolved" || status === "needs-pixels" || status === "paused" ? tile(id, status, 5) : "";
  const fill = s.hatch === "solid" ? `fill="${s.colour}" fill-opacity=".35"` : s.hatch === "none" ? `fill="none"` : `fill="url(#${id})"`;
  const stroke = status === "needs-pixels" ? 2.5 : 1.5;
  return `<svg viewBox="0 0 16 12" aria-hidden="true"><defs>${pat}</defs><rect x="0" y="0" width="16" height="12" ${fill}/><rect x=".75" y=".75" width="14.5" height="10.5" fill="none" stroke="${s.colour}" stroke-width="${stroke}"/></svg>`;
}

function controls(m: ReportModel): string {
  const chips = [
    `<button class="chip" type="button" data-lens="all" aria-pressed="true">All <span>${m.counts.total}</span></button>`,
    ...STATUS_ORDER.map((k) => {
      const n = m.counts.status[k];
      return `<button class="chip" type="button" data-lens="${k}" aria-pressed="false">${swatch(k)}${esc(STATUS[k].word)} <span>${n}</span></button>`;
    }),
  ].join("");
  const key = BAND_ORDER.map((k) => {
    const b = BAND[k];
    const sw = `<svg viewBox="0 0 34 10" aria-hidden="true"><line x1="1" y1="5" x2="33" y2="5" stroke="#17140f" stroke-width="${k === "verified" ? 3 : k === "none" ? 1 : 2}"${b.dash ? ` stroke-dasharray="${b.dash}"` : ""}/></svg>`;
    return `<span>${sw}${esc(b.glyph)} ${esc(b.word)} <span>${m.counts.band[k]}</span></span>`;
  }).join("");
  return (
    `<div class="controls"><div class="chips" role="group" aria-label="Show spines by status (others dim, none are removed)">${chips}</div>` +
    `<label class="mono"><input type="checkbox" id="labels"> labels</label></div>` +
    `<div class="key" aria-label="Band key: stroke style, glyph and word">${key}</div>`
  );
}

// ---- side panels ---------------------------------------------------------------------------

function evidenceList(ev: { kind: string; score: number; detail?: string | undefined }[]): string {
  if (ev.length === 0) return `<span class="meta">none</span>`;
  return `<ul class="ev">${ev
    .map((e) => {
      const b = EVIDENCE_BADGE[e.kind] ?? { cls: "", word: "" };
      return `<li><span class="${b.cls}">${esc(b.word)}</span> ${esc(e.kind)} ${score(e.score)}${e.detail ? ` — ${esc(e.detail)}` : ""}</li>`;
    })
    .join("")}</ul>`;
}

function whyOpen(s: SpineModel): string {
  if (s.reason) return REASON_TEXT[s.reason];
  if (s.status === "paused") return "Paused: the run's budget was spent. The queue persists; a new run resumes it (INV-2).";
  if (s.status === null) return "Detected; not assessed yet.";
  if (s.identity) return `Best guess is ${BAND[s.band].word}${s.identity.title ? `: ${s.identity.title}` : ""}. Not settled yet.`;
  return "Not settled yet.";
}

function panel(s: SpineModel, imageIndex: number, model: ReportModel): string {
  const status = (s.status ?? "none") as StatusKey;
  const o = s.obs;
  const id = esc(s.observationId);
  const image = model.images[imageIndex]!;
  const chosen = s.identity?.workId;

  const texts = o.texts.length
    ? `<table><tr><th>rot</th><th>text</th><th class="num">conf</th><th>lang</th></tr>${o.texts
        .map((t) => `<tr><td class="num">${t.rotation}°</td><td class="txt">${t.text === "" ? `<span class="meta">(empty)</span>` : esc(t.text)}</td><td class="num">${score(t.confidence)}</td><td>${t.langCorrection ? "corrected" : "raw"}</td></tr>`)
        .join("")}</table>`
    : `<p class="meta">No OCR yet.</p>`;

  const h = o.hypotheses;
  const candidates = h
    ? `<table><tr><th>#</th><th>candidate</th><th class="num">score</th></tr>${h.candidates
        .map(
          (c, i) =>
            `<tr><td class="num">${i + 1}</td><td>${c.workId === chosen ? `<b>${esc(BAND[s.band].glyph)} ` : "<b>"}${esc(c.title)}</b><br><span class="meta">${esc(c.author)}${c.year ? `, ${c.year}` : ""}${c.series ? ` · ${esc(c.series)}` : ""} · ${esc(c.workId)}</span>${evidenceList(c.evidence)}</td><td class="num">${score(c.score)}</td></tr>`,
        )
        .join("")}<tr><td class="num">–</td><td><b>unknown</b><br><span class="meta">none of the above</span>${evidenceList(h.unknown.evidence)}</td><td class="num">${score(h.unknown.score)}</td></tr></table>`
    : `<p class="meta">No candidates proposed yet. The unknown hypothesis stands.</p>`;

  const adj = o.adjudications.length
    ? `<h4>Adjudication</h4><table><tr><th>model</th><th>choice</th><th class="num">tokens</th></tr>${o.adjudications
        .map((a) => `<tr><td class="txt"><span class="ev-synth">SYNTH</span> ${esc(a.model)}</td><td class="txt">${a.choice === null ? "none of them" : esc(a.choice)}${a.readText ? `<br>read: ${esc(a.readText)}` : ""}</td><td class="num">${a.cached ? "cached" : `${a.inputTokens}+${a.outputTokens}`}</td></tr>`)
        .join("")}</table>`
    : "";

  const corr = o.corrections.length
    ? `<h4>Corrections</h4><ul class="ev">${o.corrections.map((c) => `<li><span class="ev-asserted">ASSERTED</span> ${c.kind === "unreadable" ? "unreadable" : `${esc(c.kind)} ${esc(c.workId)}`}</li>`).join("")}</ul>`
    : "";

  const ocrVersions = [...new Set(o.texts.map((t) => `${t.ocr.helper} · ${t.ocr.os} · request revision ${t.ocr.requestRevision}`))];
  const versions =
    `<dl><dt>detector</dt><dd>${esc(o.spine.detector.backend)} · weights ${esc(short(o.spine.detector.weightsSha256))}</dd>` +
    `<dt>ocr</dt><dd>${ocrVersions.length ? ocrVersions.map(esc).join("<br>") : "—"}</dd>` +
    `<dt>run</dt><dd>${esc(model.run.runId)} · ${esc(model.run.started.codeCommit)}</dd>` +
    `<dt>polygon</dt><dd>working-copy pixels ${o.spine.polygon.map(([x, y]) => `${x},${y}`).join(" ")}</dd>` +
    `<dt>image</dt><dd>${esc(short(s.imageHash))} → working copy ${esc(short(image.workingCopyHash))}</dd>` +
    `<dt>detector score</dt><dd>${score(o.spine.score)}</dd></dl>`;

  const hist = s.history.length
    ? `<ol class="hist">${s.history.map((r) => `<li><span class="ts">#${r.seq} ${esc(r.ts)}</span><br>${esc(r.text)}</li>`).join("")}</ol>`
    : `<p class="meta">No events beyond the observation yet.</p>`;

  const items = s.workItems.length
    ? `<h4>Closer photo</h4><ul class="ev">${s.workItems.map((w) => `<li>${esc(w.workItemId)} · ${esc(w.state)} · ${esc(REASON_TEXT[w.reason])}</li>`).join("")}</ul>`
    : "";

  return (
    `<article class="panel" id="p-${id}" data-obs="${id}" data-image="i${imageIndex}">` +
    `<h3>${esc(label(s))}</h3><p class="meta">${id}</p>` +
    `<div class="badges"><span class="badge b-${status}">${esc(STATUS[status].word)}</span><span class="badge">${esc(BAND[s.band].glyph)} ${esc(BAND[s.band].word)}</span></div>` +
    `<p>${s.identity ? `<b>${esc(s.identity.title ?? s.identity.workId)}</b>${s.identity.author ? ` — ${esc(s.identity.author)}` : ""}<br>` : ""}${status === "resolved" ? "" : esc(whyOpen(s))}</p>` +
    items +
    `<h4>OCR variants</h4>${texts}<h4>Candidates</h4>${candidates}${adj}${corr}` +
    `<h4>Versions</h4>${versions}<h4>Status history</h4>${hist}` +
    `</article>`
  );
}

// ---- lists ---------------------------------------------------------------------------------

function unresolvedList(m: ReportModel): string {
  const rows = m.spines.filter((s) => s.status !== "resolved");
  if (rows.length === 0) return `<p class="meta">Every spine is resolved.</p>`;
  return `<table><tr><th>spine</th><th>status</th><th>why</th></tr>${rows
    .map((s) => {
      const status = (s.status ?? "none") as StatusKey;
      return `<tr data-obs="${esc(s.observationId)}"><td>${link(s)}</td><td><span class="badge b-${status}">${esc(STATUS[status].word)}</span></td><td>${esc(whyOpen(s))}</td></tr>`;
    })
    .join("")}</table>`;
}

function closerPhotoList(m: ReportModel): string {
  const items = m.spines.flatMap((s) => s.workItems.map((w) => ({ s, w })));
  if (items.length === 0) return `<p class="meta">No closer photo is requested.</p>`;
  const order = { open: 0, fulfilled: 1, withdrawn: 2 };
  items.sort((a, b) => order[a.w.state] - order[b.w.state] || a.s.shelf - b.s.shelf || a.s.ordinal - b.s.ordinal);
  return `<table><tr><th>where</th><th>state</th><th>why</th></tr>${items
    .map(({ s, w }) => `<tr data-obs="${esc(s.observationId)}"><td>${link(s)}</td><td class="txt">${esc(w.state)}</td><td>${esc(REASON_TEXT[w.reason])}</td></tr>`)
    .join("")}</table>`;
}

function runSection(m: ReportModel): string {
  const r = m.run;
  const b = r.started.budget;
  const budget = [b.maxAdjudications !== undefined && `${b.maxAdjudications} adjudications`, b.maxTokens !== undefined && `${b.maxTokens} tokens`, b.maxSpendUsd !== undefined && `$${b.maxSpendUsd}`].filter(Boolean).join(", ") || "uncapped";
  const helpers = Object.entries(r.started.helperVersions).map(([k, v]) => `${k} ${v}`).join(", ") || "—";
  const detectors = [...new Set(m.spines.map((s) => `${s.obs.spine.detector.backend} · ${short(s.obs.spine.detector.weightsSha256)}`))];
  return (
    `<dl><dt>run</dt><dd>${esc(r.runId)}</dd><dt>code</dt><dd>${esc(r.started.codeCommit)}</dd>` +
    `<dt>helpers</dt><dd>${esc(helpers)}</dd><dt>models</dt><dd>${esc(r.started.modelIds.join(", ") || "—")}</dd>` +
    `<dt>detectors</dt><dd>${detectors.length ? detectors.map(esc).join("<br>") : "—"}</dd>` +
    `<dt>budget</dt><dd>${esc(budget)}</dd><dt>spent</dt><dd>${r.usage.adjudications} adjudications · ${r.usage.inputTokens}+${r.usage.outputTokens} tokens</dd>` +
    `<dt>outcome</dt><dd>${esc(r.finished?.outcome ?? "open")}</dd></dl>`
  );
}

function rejectedList(m: ReportModel): string {
  if (m.rejections.length === 0) return "";
  return `<h4>Not ingested</h4><ul class="ev">${m.rejections.map((r) => `<li>${esc(r.fileName)} — ${esc(r.reasons.join(", "))}</li>`).join("")}</ul>`;
}

// ---- page ----------------------------------------------------------------------------------

export function renderReport(m: ReportModel): string {
  const counts = `<b>${m.counts.total}</b> spines · <b>${m.counts.status.resolved}</b> resolved · <b>${m.counts.status.unresolved + m.counts.status["needs-pixels"] + m.counts.status.paused + m.counts.status.none}</b> open · <b>${m.counts.status["needs-pixels"]}</b> need a closer photo`;
  const tabs = m.images.map((img, i) => `<button class="tab" type="button" role="tab" data-image="i${i}" aria-selected="${i === 0}">${esc(img.setting)}${img.shelfIndex !== undefined ? ` · shelf ${img.shelfIndex}` : ""} <span class="mono">${m.spines.filter((s) => s.imageHash === img.imageHash).length}</span></button>`).join("");
  const imageIndex = (hash: string) => m.images.findIndex((i) => i.imageHash === hash);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Bookcase report · ${esc(m.session)} · ${esc(m.run.runId)}</title>
<script>document.documentElement.classList.add("js")</script>
<style>${CSS}</style>
</head>
<body>
<header class="top">
<h1>${esc(m.session)}</h1>
<div class="counts"><span>${counts}</span><span>run ${esc(m.run.runId)} · as of ${esc(m.asOf)}</span></div>
</header>
<main class="grid">
<section aria-label="Photo and overlay">
${controls(m)}
<nav class="tabs" role="tablist" aria-label="Photos">${tabs}</nav>
<div id="stage" data-lens="all">
${m.images.map((img, i) => figure(img, i, m.spines)).join("\n")}
</div>
</section>
<aside id="panels" aria-label="Spine detail">
<p class="hint">Select a spine, in the photo or in a list, to see what was read, what it might be, the evidence, the versions and the status history. Arrow keys step through spines.</p>
${m.spines.map((s) => panel(s, imageIndex(s.imageHash), m)).join("\n")}
</aside>
</main>
<div class="lists">
<section id="unresolved"><h2>Unresolved</h2>${unresolvedList(m)}</section>
<section id="closer-photos"><h2>Closer photos</h2>${closerPhotoList(m)}</section>
<section id="recommendations"><h2>Recommendations</h2><div class="placeholder">${m.recommendationCount} recommendation${m.recommendationCount === 1 ? "" : "s"} in the ledger. The ranked list, each with a rationale and a click-to-locate link, arrives with W-2.</div></section>
<section id="run"><h2>Run and versions</h2>${runSection(m)}${rejectedList(m)}</section>
</div>
<footer class="foot">This folder holds photos and is private: it stays in the data directory and is never committed or shared.</footer>
<script>${JS}</script>
</body>
</html>
`;
}
