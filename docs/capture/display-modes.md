# Display modes and object-shaped highlights (U-4)

> **Status: first thin slice, 2026-11-03 (card U-4).** A mode registry and a private still-photo study. This is not the live phone build. Nothing here is ruled. Every style number is a starting value for the owner, and every feel target is a **hypothesis** until Q-6 measures it (INV-17, INV-23).
> **Reads:** [`coverage.md`](coverage.md) (Q-0) §1–§3, §7, §8 and §10; U-1 [`overlay-ux.md`](../plan/docs/live/overlay-ux.md) (lenses, overlay states, §6 anti-jitter, §7 tokens); U-2 [`guided-sweep-ux.md`](../plan/docs/live/guided-sweep-ux.md) §4; [`evals/F0e/report.md`](../../evals/F0e/report.md); [`evals/Q2/report.md`](../../evals/Q2/report.md).
> **Code:** `src/report/display-modes.ts` (the registry), `src/report/display-draw.ts` (the renderer) and `src/eval/u4-cli.ts` (the study). **Tests:** `test/display-modes.test.ts`.

## In short

- **Owner direction (2026-11-03).** The shopper should see "magically highlighted, aesthetically delightful pattern recognition of physical objects", not developer tooling. The developer view stays too, behind a toggle. So there are three **display modes**, `dev`, `labelling` and `user`, plus named **display variants** of each, so variants can be compared blue/green.
- **A mode is a whitelist of overlay layers, and a variant is data.** The renderer draws the layers a variant lists, with the numbers it carries. It never branches on a mode's or variant's name, and the registry check forbids every box, number and label layer in the `user` mode.
- **Lenses are orthogonal.** U-1's overlay lens (All, Recommended, Read, Needs a closer look) chooses *which* spines a highlight means. The display mode chooses *how* the glass draws them. Any lens works inside any mode.
- **The still study** draws all 31 `pilot-000` photos in six variants, on one private page under the data root (`private/u4/renders/pilot-000/index.html`). The page has a mode switcher and an A/B view per photo. User-mode shapes follow the spine's real outline: SAM mask outlines for 69 % of boxes, and the oriented box for the rest.
- **Coverage is per spine, not per segment.** Q-0's coverage segments are not built yet (Q-3). Each spine takes Q-2's teacher rung: filled from `text-read` up (48.2 % of spines), patchy below that.
- **Feel metrics are defined now and measured later.** Q-6 reports flicker rate, edge wobble, time to fill and uncaused downgrades (target 0) per display variant. Three still proxies are computed today. Sessions log the variant's id and a parameter hash, so A/B results compare by variant (§4, a proposal; `contracts/` is not edited).

## 1. Modes, layers and variants

| Mode | For | Layers it may draw |
|---|---|---|
| `dev` | the owner and agents debugging perception | scrim, tile edges, band lines, oriented boxes, cut flags, partial flags, raw box ids, box scores |
| `labelling` | machine-first labelling review | scrim, hairline boxes, the machine's guess (along the spine), its coverage rung |
| `user` | the shopper | scrim, coverage fill, highlight. **No boxes, no numbers, no labels.** |

**Layers.** A variant lists its layers bottom to top, and every one carries its own style data:

- `scrim` dims the photo. In `user-glow` the filled spines are lifted out of it, so read books look lit. This follows U-1 §7: "filtering dims, never removes".
- `coverage-fill` paints each spine by its glass state. Q-0 §3 gives three states: `not-seen` (blank), patchy (`seen` to `text-present`) and filled (`text-read` and up). The layer's data names a **shape** (mask outline or box; convex hull or not; Chaikin smoothing passes) and two **paints**, one for filled and one for patchy.
- `highlight` paints spines at or above a rung (`confirmed` in every user variant, U-1 ruling 6's "probable or better").

**Paints** are a small closed set of primitives, and every number in them is a parameter:

- `glow`: light along the outline, plus a faint fill;
- `veil`: a translucent fill with a feathered edge;
- `ridge`: lines across the spine;
- `stipple` and `hatch`: patterns;
- `rim`: a crisp stroke.

Any paint can add an ink **halo** under it, so a light paint still reads on a bright spine. That is U-1 §7.1's ink ring, in a soft form.

| Variant | Mode | Intent |
|---|---|---|
| `dev-boxes` | dev | F-0e's render language: yellow boxes, red cuts, orange dashed partials, cyan bands, magenta tiles, ids and scores |
| `dev-quiet` | dev | the same layers on a darker scrim, with paper-white boxes, for dense shelves |
| `labelling-hairline` | labelling | U-1 hairlines; each guess runs along its spine. The rung word is green from `text-read` up and amber below it. An unconfirmed top candidate ends in "?" |
| `user-glow` | user | soft paper-white light hugging each read spine's outline. Read spines are lifted out of a light scrim, and patchy ones get a faint stipple |
| `user-veil` | user | a translucent warm-paper fill with a feathered edge over each read spine; patchy spines get a fine hatch |
| `user-ridge` | user | Touch ID: fine ridges across each spine, sparse while patchy and dense once read. It uses the raw mask outline, with no hull |

Colours are U-1's tokens: paper `#fcfbf6`, ink `#100e08`, and live and warn for rung words. Red stays reserved for "a human decision is needed" (U-1 §7). The only red in this slice is `dev`'s cut flag, which is a debugging layer.

## 2. The still study (private)

`node src/eval/u4-cli.ts render` writes the following under the data root's `private/u4/renders/pilot-000/`:

- a 2000 px derivative of each working copy (`sips`, as the report does);
- one self-contained SVG overlay per photo and variant;
- `summary.json` (aggregates);
- `index.html`.

The page is static: no fetches, and nothing leaves the machine. Use the two mode switchers and variant menus to choose A and B. Click a photo to see the pair large, and hold the space bar to see the bare photo. A light-or-dark tag (mean luma, split at the median) lets the owner check both kinds of scene. It runs in about 10 s on the CPU, with no model calls.

**Inputs, all cached:**

- F-0e's shipped `bands+strips` boxes, one oriented box per spine, plus their shelf bands;
- F-0b's SAM mask outlines;
- Q-2's teacher rungs;
- F-0's decisions, plus catalog titles for the labelling guess.

**Getting object shapes onto whole-spine boxes.** F-0b's outlines and Q-2's rungs were measured on F-0's boxes, many of which are pieces of a spine (31.5 % cut, per F-0e). They are attached to F-0e's boxes by overlap (`attachPieces`):

1. A piece belongs to the box that holds the largest share of it, if that share is at least 50 %.
2. The piece is clipped to that box, grown 3 % along the spine and 8 % across it.
3. If the clipped pieces cover at least 60 % of the box, the spine is drawn from them. Otherwise it is drawn as its box.
4. The spine's rung is the highest rung among its pieces: one well-read piece reads the spine, as F-0e found. A box with no piece stays `spine-found`, which shows as patchy.

On `pilot-000`, 6,145 boxes in 31 photos:

| Measure | Value |
|---|---|
| Drawn from mask outlines | 69 % (median mask share of a box 0.76) |
| Filled (rung ≥ `text-read`) | 48.2 % |
| Rungs | `spine-found` 30.1 % · `text-present` 21.8 % · `text-read` 22.1 % · `matched` 15.0 % · `confirmed` 11.1 % |

These are machine agreement, not accuracy (INV-17). `spine-found` is higher than Q-2's 25 % because boxes no piece reaches stay at that rung.

**What the study taught the design:**

- **Hull the mask.** Raw SAM outlines have notched ends and the odd blob, and pieces of one spine leave seams. The convex hull of a spine's pieces keeps its real perspective shape (a trapezoid, a tapered top) without them. Glow and veil use the hull. Ridges keep the raw outline, so the two can be compared.
- **No SVG blur filters.** Chromium drew nothing for blurred groups in overlays with hundreds of complex paths, although the same filter works on a small test image. Soft edges are now stacks of 3–5 strokes of falling width and opacity. A test pins the rule. A stroke stack is also what a phone overlay can afford every frame (Q-6).
- **Restraint reads as magic.** The calmest look so far is `user-glow`: unread spines sit under a light scrim, and read spines are lifted out of it with a soft edge, so the shelf seems to light up book by book. Veil washes the colours of the book it marks. Ridges are the most Touch-ID-like, but they cover the spine's own lettering. The owner judges (§5).

## 3. Feel metrics

Q-6 (the live slice) must report these **per display variant**. They are defined as data in `FEEL_METRICS`. Targets are starting values (INV-23), and O-7 sets the real ones.

| Metric | Unit | Definition | Start target |
|---|---|---|---|
| `flicker-rate` | events/s | glass state changes on one spine or segment that revert within 500 ms (on, off, on, or the reverse), per second of session | ≤ 0.05 |
| `edge-wobble` | px RMS | RMS distance between a drawn outline and the same outline one frame later, both resampled to 64 points, in screen points, over tracks held still | ≤ 1.5 px at p95 (cf. U-1's 2 pt anchor jitter) |
| `time-to-fill` | s | from a segment's first frame in view to its fill committing; p50 and p90 over segments that fill | report only |
| `uncaused-downgrade` | count | fills or highlights that go down without a `cause` (Q-0 §7, monotone rule) | **0**: any one is a bug |
| `highlight-churn` | changes/min | highlights entering or leaving per minute of panning, against U-1's SWAP_LIMIT | report only |

**Still proxies, computable today** on the shape each variant draws, with 8 noisy copies per spine. Each outline vertex moves by Gaussian noise with σ = 2 % of the spine's width, standing in for the frame-to-frame mask noise Q-6 will see:

| Variant | Outline drawn | Jaggedness p90 | Perturbation wobble (median) | Area CV (median) |
|---|---|---|---|---|
| dev, labelling | box, no smoothing | 0 | 1.00 | 0.018 |
| `user-glow` | mask hull, 2 passes | 0 | 0.75 | 0.018 |
| `user-veil` | mask hull, 3 passes | 0 | 0.74 | 0.018 |
| `user-ridge` | raw mask, 1 pass | 0.051 | 0.79 | 0.019 |

- **Jaggedness** is the drawn perimeter divided by its convex hull's perimeter, minus 1.
- **Perturbation wobble** is the RMS movement of the drawn outline divided by the RMS noise put in. Below 1, the variant damps mask noise.
- **Area CV** is the coefficient of variation of the drawn area.

Smoothing damps about a quarter of vertex noise, and the hull removes the jagged tail. Area stability barely depends on the variant, which is expected: noise of this size moves the edge, not the area. These are geometric proxies only. They do not see the glow's soft edge, which hides wobble further, or tracker ID switches. Q-6 measures the real thing.

## 4. Logging a session's variant (proposal)

A/B comparison needs every live session and still to say which variant it showed. **Proposal for a contract card. `contracts/` is not edited here.**

```jsonc
{
  "type": "DisplayShown",                 // one at session start, and one at every switch
  "payload": {
    "sessionId": "…",                     // live session, guided sweep or scan session
    "mode": "user",                       // dev | labelling | user
    "variant": "user-glow",               // id in the display registry
    "variantHash": "5871906382f02fc9",    // variantHash(): SHA-256 of the variant's canonical JSON, first 16 hex
    "lens": "all",                        // U-1's overlay lens at the time (orthogonal)
    "assignment": "alternate",            // fixed | alternate (blue/green by session) | owner-pick
    "fromFrame": 0                        // live: the frame index the variant took effect at
  }
}
```

- **An arm is `(variant, variantHash)`.** A retuned variant gets a new hash, so it is a new arm, and two sessions pool only when both match.
- Q-6's feel metrics are computed per span between `DisplayShown` events and reported grouped by arm. The `dev` and `labelling` modes are logged too, so dev and user versions can be compared blue/green.
- The registry's hash is the replay pin (INV-14), in the way `CoverageObserved.versions.thresholds` pins coverage parameters.
- The event carries numbers and ids only (OC9).

## 5. Open questions for the owner

1. **Which user direction goes into Q-6 live?** Glow, veil, ridges, or a blend: for example glow for filled and sparse ridges for patchy. The recommended starting point is `user-glow`.
2. **One layer at a time?** Q-0 §8 proposes coverage while moving and identity while still. This study draws both (fill plus a `confirmed` rim) in one image. Should the user mode switch layers by motion, or keep both on, quieter?
3. **Patchy marks or silence?** Should patchy spines be marked at all in the user mode (stipple, hatch, sparse ridges), or should only read spines light up, so that absence means "not yet"? Touch ID draws the whole template from the start.
4. **What earns a highlight?** `confirmed` only (U-1 ruling 6: `probable` or better), or also `matched`?
5. **How much dimming?** Scrims of 0.18 to 0.34 make highlights readable on bright shelves. Is dimming the shopper's view acceptable, or should contrast come only from halos?
6. **How are A/B arms assigned?** Alternate by session, or always the owner's pick?
7. **Real outlines for every spine?** 31 % of boxes fall back to box shape because F-0b's outlines were measured on F-0's boxes. Re-running F-0b's outline helper on F-0e's boxes (GPU, about the size of F-0b's run) would give every spine its own mask. It waits until F-0c frees the GPU.

## 6. For the conductor

- **Contract card:** `DisplayShown` (§4), with a schema, Zod validation and examples, before Q-6 writes events.
- **Q-6:** report `FEEL_METRICS` per arm, and import the registry rather than copying styles.
- **Q-3:** coverage segments replace per-spine fill when built; the `coverage-fill` layer's unit becomes a parameter then.
- **Glossary:** *display mode*, *display variant*, *overlay layer* and *feel metric* are added to `CONTEXT.md`.
