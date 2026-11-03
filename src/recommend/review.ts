// The O-4 review sheet (card R-1): a short, private page the owner reads once. Written to
// `<data root>/private/profile-review.html`, never into the repo. It shows what the public seeds
// say, what expansion found, and the two yes/no questions R-0 left open (taste-model.md §10).
//
// Kept calm and small on purpose: two questions, big buttons, no scrolling past them, skipping is fine.
// One file, no network, no remote assets; a script only builds the "copy my answers" text.
import type { ExpansionReport } from "./expand.ts";
import type { ResolvedProfile } from "./profile.ts";

export const REVIEW_QUESTIONS = [
  {
    id: "q1",
    text: "Does reading all of William Gibson also mean you liked him?",
    yes: "Yes: his books count as strongly as Kim Stanley Robinson's.",
    no: "No: they count a little less. Reading is not the same as liking.",
    note: "Skip it and I keep the No.",
  },
  {
    id: "q2",
    text: "Should a book by an author you like show up at the default setting even when its ideas are far from your usual?",
    yes: "Yes: books by authors you like can appear even when the book itself wanders.",
    no: "No: they appear only when you choose Sideways or Farther. Ideas decide, not the name on the spine.",
    note: "Skip it and I keep the No.",
  },
] as const;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function statement(e: ResolvedProfile["entries"][number], report: ExpansionReport | undefined): string {
  const who = esc(e.subject.name);
  if (e.relation === "read" && e.scope === "all-works") {
    const n = report?.novels.length;
    return `<b>Read all of ${who}.</b>${n === undefined ? "" : ` I count ${n} novels in the catalog.`}`;
  }
  if (e.relation === "liked") return `<b>Liked ${who}.</b>`;
  if (e.relation === "cooler") return `<b>Cooler on ${who}.</b> Why is an open question; nothing to answer now.`;
  if (e.relation === "not-for-me") return `<b>Not for me: ${who}.</b>`;
  return `<b>${esc(e.relation)} ${who}.</b>`;
}

export function renderReviewSheet(profile: ResolvedProfile, reports: ExpansionReport[], now: Date = new Date()): string {
  const seeds = profile.entries.filter((e) => !e.expanded && e.origin === "seeds");
  const reportOf = (id: string) => reports.find((r) => r.seedId === id);
  const lines = seeds.map((e) => `<li>${statement(e, reportOf(e.id))}</li>`).join("\n      ");
  const lists = reports
    .filter((r) => r.found)
    .map((r) => {
      const left = r.excluded.map((x) => `${esc(x.title)} (${x.reason === "audio-only" ? "audio only" : x.ttype.toLowerCase()})`).join("; ");
      return `<details><summary>The ${r.novels.length} ${esc(r.author)} novels I counted as read</summary>
      <p>${r.novels.map((w) => `${esc(w.title)}${w.year ? ` (${w.year})` : ""}`).join("; ")}.</p>
      ${left ? `<p class="quiet">Not counted: ${left}. Tell me if one should be.</p>` : ""}
    </details>`;
    })
    .join("\n    ");
  const questions = REVIEW_QUESTIONS.map(
    (q, i) => `<fieldset>
      <legend><span class="n">${i + 1}</span> ${esc(q.text)}</legend>
      <div class="choices">
        <label><input type="radio" name="${q.id}" value="yes"><span>Yes</span></label>
        <label><input type="radio" name="${q.id}" value="no"><span>No</span></label>
      </div>
      <p class="quiet">${esc(q.yes)}<br>${esc(q.no)}<br>${esc(q.note)}</p>
    </fieldset>`,
  ).join("\n    ");
  const labels = JSON.stringify(Object.fromEntries(REVIEW_QUESTIONS.map((q) => [q.id, q.text])));

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reading profile review</title>
<style>
  :root { --bg: #fbfaf7; --fg: #23211d; --quiet: #6b665d; --line: #d9d4c8; --accent: #2f5d50; --accent-fg: #fff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1d1c1a; --fg: #ece8df; --quiet: #a49f94; --line: #3a3833; --accent: #7fb5a3; --accent-fg: #14211d; } }
  body { background: var(--bg); color: var(--fg); font: 18px/1.5 system-ui, sans-serif; margin: 0; }
  main { max-width: 38rem; margin: 0 auto; padding: 1.5rem 16px 4rem; }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
  ul { padding-left: 1.2rem; }
  fieldset { border: 1px solid var(--line); border-radius: 10px; margin: 1rem 0; padding: 1rem; }
  legend { font-weight: 600; padding: 0 .4rem; }
  .n { color: var(--quiet); margin-right: .3rem; }
  .choices { display: flex; gap: .75rem; margin: .5rem 0; }
  .choices label { flex: 1; }
  .choices input { position: absolute; opacity: 0; }
  .choices span { display: block; text-align: center; padding: .8rem; border: 2px solid var(--line); border-radius: 10px; cursor: pointer; }
  .choices input:checked + span { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }
  .choices input:focus-visible + span { outline: 3px solid var(--accent); outline-offset: 2px; }
  .quiet { color: var(--quiet); font-size: .9rem; margin: .4rem 0 0; }
  details { margin: .5rem 0; }
  summary { cursor: pointer; }
  button { font: inherit; padding: .7rem 1.2rem; border-radius: 10px; border: 0; background: var(--accent); color: var(--accent-fg); cursor: pointer; }
  textarea { width: 100%; box-sizing: border-box; font: .9rem/1.4 ui-monospace, monospace; background: transparent; color: inherit; border: 1px solid var(--line); border-radius: 8px; padding: .6rem; margin-top: .75rem; }
</style>
</head>
<body>
<main>
  <h1>Two quick questions</h1>
  <p>About two minutes. Nothing leaves this page. Answer what you like and skip the rest.</p>

  <h2>What I have</h2>
  <p class="quiet">These come from what you told me in the project brief, 2026-10-31. Nothing else.</p>
  <ul>
      ${lines}
  </ul>
    ${lists}

  <h2>Your call</h2>
  <form id="f" onsubmit="return false">
    ${questions}
  </form>

  <h2>When you are done</h2>
  <p>Copy this and paste it to me.</p>
  <button type="button" id="copy">Copy my answers</button>
  <textarea id="out" rows="4" readonly aria-label="Your answers"></textarea>
  <p class="quiet">Made ${esc(now.toISOString().slice(0, 10))} from profile/seeds.json. This page is private: it lives in your data folder, not the repo.</p>
</main>
<script>
  const Q = ${labels};
  const out = document.getElementById("out");
  function compose() {
    const lines = Object.keys(Q).map((id) => {
      const picked = document.querySelector('input[name="' + id + '"]:checked');
      return "O-4 " + id + " (" + Q[id] + "): " + (picked ? picked.value : "skipped");
    });
    out.value = lines.join("\\n");
  }
  document.getElementById("f").addEventListener("change", compose);
  document.getElementById("copy").addEventListener("click", async () => {
    compose();
    try { await navigator.clipboard.writeText(out.value); } catch { out.select(); }
  });
  compose();
</script>
</body>
</html>
`;
}
