# The report (W-1)

`bookcase report <session> [--run <id>] [--ledger <db>]` writes a static site to
`$BOOKCASE_DATA/reports/<session>/<run>/` (default data root `~/data/bookcase-discovery/`):

```
reports/<session>/<run>/
  index.html          one page: CSS and JS inline, nothing fetched from the network
  images/<hash16>.jpg display derivatives
```

It holds photos, so it lives in the data dir with the image store and never in the repo (OC9, INV-12).
Vocabulary: [`CONTEXT.md`](../CONTEXT.md). Code: `src/report/`. Tests: `test/report.test.ts`.

## Where it reads from

- The **ledger** (`Ledger` interface). The CLI opens `$BOOKCASE_DATA/ledger.sqlite` read-only, or `--ledger <db>`.
  Tests and `pnpm report:synthetic` use the in-memory ledger. The report consumes the views (`observations`,
  `images`, `workItems`, `recommendations`, `runs`); it re-derives no status or band. It reads the event log
  only for a spine's **status history**, which the views do not keep.
- The **working copy** of each image, from the image store (`images/sha256/…`), never the original (INV-12).
  Every polygon is in working-copy pixels; `ImageAssetIngested.width/height` is that frame.
- `--run <id>` picks the run the report is filed and headed under; the default is the most recently started.
  The views are cumulative (they carry no run), so the spines shown are the session's current state either way.

## Display derivatives and coordinates

Each working copy becomes `images/<hash16>.jpg` by `sips -s format jpeg`, with `-Z 3000` when its long edge is
larger (a smaller image is not enlarged; HEIC is converted because browsers do not show it). Polygons are scaled
by `derivative ÷ working copy` in each axis, so the overlay's `viewBox` is the derivative's pixel size. If the
file on disk has a different shape from the ledger's width and height, the report still writes and warns.
A working copy missing from the store gets a blank frame and a warning: the boxes still draw.

## Reading the overlay

Colour is never the only channel.

| Status | Colour | Fill | Word |
|---|---|---|---|
| resolved | green | solid tint | resolved |
| unresolved | amber | diagonal hatch | unresolved |
| needs-pixels | red, heavier edge | cross-hatch | needs closer photo |
| paused | blue | dots | paused (budget) |
| none yet | grey | none | detected |

| Band | Stroke | Glyph |
|---|---|---|
| verified | solid, heavy | ◼ |
| probable | dashed | ◧ |
| candidate | dotted | ◻ |
| unknown | dash-dot | ? |
| none yet | hairline | · |

Red has one job: a closer photo is needed (`overlay-ux.md` §7). The status chips filter by dimming, never by
removing. Labels (glyph and ordinal) are off until toggled or a spine is selected. Selection is an ink ring.
The page works without JavaScript: panels open by `:target`, and the lists link to them.

## Panels and lists

Per spine: status, band and reason; the identity if banded; OCR variants (rotation, language correction,
confidence); candidates in order with their evidence, then the `unknown` hypothesis; adjudications (labelled
SYNTH); corrections; closer-photo work items; versions (detector and weights, OCR helper and OS, run commit,
polygon); and the status history with each cause. Below: the **unresolved** list with reasons, the **closer
photos** list (open items first), a **recommendations** placeholder (a count; the ranked list and click-to-locate
arrive with W-2), and the run's versions, budget and spend, with any files that were not ingested.

## Re-running

A run's folder is rebuilt whole each time (the old folder is removed first, so no derivative of an earlier
ledger state stays behind), and the same ledger gives the same bytes: the page carries the newest event's
timestamp, not the clock.

## Try it on synthetic data

```bash
pnpm report:synthetic /tmp/synthetic-report
```

draws a generated shelf of coloured rectangles with invented titles and writes the report for it.
