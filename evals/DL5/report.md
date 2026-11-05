# DL-5 · eval hygiene

Run 2026-11-05, CPU only. Counts only: no ids, titles, paths or model output. `pilot-000` is real use: machine labels,
never accuracy (INV-17). The yardstick is **PROXY (library shelves)**, evaluation only (OC35). Reproduce the tables
below with `node src/eval/dl5-cli.ts analyse`.

**No pre-registration, on purpose.** No keep rule decides anything on this card. It replaces a code check (tested
in `test/set-roles.test.ts`), counts what is already there, and sets out options for a ruling that is the owner's.
No number here chose a default, a threshold or a split.

## Answer first

1. **Never-train now goes by declared role, not by name.** The old guard was the regex `/yardstick|proxy|audit/i` on
   the set name. Any other name passed it, including `sf-store-002`, the set F-1 reserves as held-out. Now every set
   has a **set role** in one code-level registry (`src/eval/set-roles.ts`). Only a `training-source` is trainable,
   and today that is `pilot-000` alone. A set with no declared role is refused (fail closed). The name regex stays as
   a second check. Every exporter and trainer calls the one guard:
   - TS-0's rows and manifest photos, and F-1's build, which reaches the guard through TS-0's re-export with no edit
     to `ts0-cli.ts`;
   - TS-2's training rows;
   - MM-2's gallery, and MM-1's evaluation-only mark, which MM-2 filters on;
   - the Q-1 and Q-2 model fits.

   A renamed yardstick is refused at each of these (tests). No contract changed: the registry is code, not a
   manifest field.
2. **Work-level leakage across TS-0's frozen split: 1 work of 556** has labels on both sides (1 train label, 2 val
   labels).
   - **TS-2:** of `pilot-000`'s 157 val labels, **2** (1 work) name a work TS-2 trains on.
   - **Physical copies:** no record says that a copy in one photo is the same object as one in another. F-0g's 154
     copy groups each sit inside one photo, so none straddles the split. Copies on both sides are at most 1, because
     a copy on both sides means its work is on both sides.
   - **Why the count is low, and what it doesn't guarantee:** the photos carry no store or bookcase ids, so F-1's
     bookcase join never fired. The split rests on capture groups alone (6). The low count comes from the shoot
     (different shelves in different capture groups); nothing in the split enforces it.
   - The frozen splits are unchanged.
3. **The yardstick is a dev set in practice.**
   - 36 of 42 eval folders read F-0's 40-image Library Dataset sample. **23 decided a keep condition on it.**
   - Every yardstick stage cache holds those same 40 images (6 of 7 caches hold exactly them; one early F-0 stage
     holds 3 more).
   - **302 annotated Library Dataset images have never been read by any card.** Only 11 of their 4,931 distinct
     books also stand in the sample.
   - TS-0's held-out split is empty: `pilot-000` has no held-out photos, and `sf-store-002` does not exist yet.

## Options for a quarantined final-gate slice (for the owner's ruling)

Nothing below is implemented; the registry only already declares `sf-store-002` as `held-out`. The options are not
exclusive: A and C seal PROXY slices that exist today, and B is the real-use gate when it exists.

| | A · sealed slice of the untouched Library Dataset images | B · wait for `sf-store-002` | C · the Zhong/Yang box set |
|---|---|---|---|
| what it gates | identification (wrong accepts, recall against annotated books), PROXY | real use, label-free only (coverage, machine agreement, third-reader dissent); accuracy only with V-6 taps | boxes only (recall, precision); not identity |
| size | 40, 100, 150 or all 302 of the 302 untouched images | unknown until shot | 661 images, by the folder name; not fetched (0 files at the data root) |
| chosen how | fixed before anyone looks: SHA-256 of a stated seed and each image name, sorted, first *N* of the 302 | the whole session, held out from the start (F-1) | the whole set |
| sealed how | the list stays private (a read-only file in the data root's private folders); only a SHA-256 of the sorted list and the rule are committed; declared `held-out` in `set-roles.ts`, so no export or trainer can take it; no stage cache is built until a final gate; each gate run is counted in its metrics, and a gate never sets a threshold | already `held-out` in `set-roles.ts`; no card reads it before the gate | as A; declared `held-out` before download |
| cost in power | none to the dev yardstick: its 40 images stay as they are. At today's rates, 100 images give ±3.3 points on the wrong-accept share (today ±5.3), and with no new wrong accept the 95 % bound is 0.12 % of boxes (table below) | cannot score wrong accepts without taps (OC36). Intervals cluster on capture groups: `pilot-000`'s 31 photos are 6 groups, so a similar shoot gives about 6 independent units | box metrics only, nothing on identity |
| other cost | one local F-0 run on *N* images at gate time. The slice is sealed on images and annotations, not on the catalog: the inventory catalog is one per library and was read by the retrieval cards. Still library shelves in Catalan and Spanish, not a bookstore | a store visit; until then there is no final gate | a 766 MB download (approved by H-0) and a converter |

**Not an option: carving the 40-image sample or `pilot-000`'s val split.** Every card that used them has already read
them, so a carve-out is not sealed. Halving the 40 images would also widen the dev interval from ±5.3 to about ±7.4
points.

## How the counts were made, and their limits

- **Set roles:** counted from the registry.
- **Leakage:** counted from TS-0's latest version (`labels.jsonl`, `manifest.json`) and F-0g's `copies.jsonl` under
  the data root.
- **Yardstick reuse:** reconstructed from each eval folder's `metrics.json`, `prereg.md` and `report.md`
  (`yardstickUse` in `src/eval/dl5.ts`).
  - *Read:* the metrics name the yardstick in a key, or in a scope string as PROXY or the Library Dataset.
  - *Gated:* read, plus one of three signs: a pass/fail metric keyed to the yardstick, a paragraph or list item that
    names both the yardstick and a keep condition, or F-0's arm choice, added by reading.
  - It is a text heuristic. It can miss a gate stated only in a table, or count a keep paragraph that only cites a
    yardstick figure.
- **The yardstick's parts:** recomputed from F-0's sampling rule (`yardstickParts`) and checked against the stage
  caches' image lists.
- **"Never read"** is by code inspection. Every per-image yardstick read found goes through F-0's stage caches.
  The annotation file is parsed whole into per-image maps (`yardstickTruth`, `yardstickBooks` and the like). Those
  maps are looked up only by the cached images' ids.
- **Power figures** scale TS-1's yardstick figures to *N* images: 40 photos, 1,040 boxes, 266 labels, 22 wrong
  (8.3 %, interval 3.7–14.2). The interval half-width scales as √(40/*N*). The zero-event bound is the rule of three
  on boxes. They assume the untouched images behave like the sample.

<!-- generated by `node src/eval/dl5-cli.ts analyse`: edit above this line -->

## Sets by role (`src/eval/set-roles.ts`)

| role | sets declared |
|---|---:|
| `training-source` | 1 |
| `yardstick` | 12 |
| `proxy` | 2 |
| `audit` | 0 |
| `held-out` | 1 |

## Work-level leakage across TS-0's frozen split (version `v-4e0ec70a69de`)

824 labels on 23 train and 6 val photos (6 capture groups; 0 photos carry a store id, 0 a bookcase id).

| works | count |
|---|---:|
| all | 556 |
| train only | 423 |
| val only | 132 |
| held-out only | 0 |
| **in both train and val** | **1** |

Labels on works in both: 1 train, 2 val. TS-2's training targets (strong class, train, two readers or more): 256 works; **2 of 157 val labels** (1 works) name one of them.

| physical copies | count |
|---|---:|
| F-0g copy groups | 154 |
| groups spanning more than one photo | 0 |
| groups straddling train and val | 0 |
| copies in both splits, at most (= works in both) | 1 |

## Yardstick reuse by card

42 eval folders with a `metrics.json`: **23 decided a keep condition on the yardstick**, 13 read it without one, 6 did not read it. Gated by: boolean metric 14, keep paragraph 8, by reading 1.

| card | yardstick |
|---|---|
| C3-catalog-retrieval | not read |
| C4 | not read |
| C5 | gated (keep paragraph) |
| C6 | gated (boolean metric) |
| C7 | gated (boolean metric) |
| C8 | gated (keep paragraph) |
| C9 | gated (boolean metric) |
| F0 | gated (by reading) |
| F0b | gated (boolean metric) |
| F0c | gated (boolean metric) |
| F0d | gated (boolean metric) |
| F0e | read |
| F0f | gated (boolean metric) |
| F0g | gated (boolean metric) |
| F0g2 | gated (keep paragraph) |
| F0h | gated (boolean metric) |
| F0i | gated (boolean metric) |
| F0j | gated (boolean metric) |
| F0k | gated (keep paragraph) |
| F0m | gated (boolean metric) |
| FR1 | read |
| FR2 | read |
| FR3 | not read |
| H1 | not read |
| H2 | gated (boolean metric) |
| KN1 | read |
| KN2 | gated (keep paragraph) |
| KN3 | not read |
| MM1 | read |
| MM2 | gated (keep paragraph) |
| NB3 | read |
| Q1 | read |
| Q2 | read |
| Q2b | read |
| Q3 | read |
| RB1 | read |
| S1 | gated (boolean metric) |
| S2 | read |
| SC1 | gated (keep paragraph) |
| TS0 | not read |
| TS1 | read |
| TS2 | gated (keep paragraph) |

## The yardstick's parts

| part | images | annotated books | cards that read it |
|---|---:|---:|---|
| F-0's sample (every 9th, middle of each stride) | 40 | 718 | 36 |
| smoke-test stride (stride starts) | 44 | – | F-0 only, while the pipeline was built (src/eval/f0-cli.ts) |
| cached outside the sample (an early F-0 stage) | 3 | – | F-0 (1 of them in the smoke stride) |
| **untouched annotated images** | **302** | 5632 | 0 |
| Zhong/Yang box set (boxes only) | 0 files at the data root | – | 0 |

6 of 7 yardstick stage caches hold exactly the sample's images; 388 annotated images with books are on disk. Books (ISBN, else title) in the sample: 654 distinct; in the untouched images: 4931, of which **11 also stand in the sample** (one library's shelves).

## A sealed slice of the untouched images, at the yardstick's current rates

| images | boxes | labels | wrong accepts | wrong-share interval, ± | 0 new wrong accepts: 95 % upper bound per box |
|---:|---:|---:|---:|---:|---:|
| 40 | 1040 | 266 | 22 | 5.25 % | 0.29 % |
| 100 | 2600 | 665 | 55 | 3.32 % | 0.12 % |
| 150 | 3900 | 998 | 83 | 2.71 % | 0.08 % |
| 302 | 7852 | 2008 | 166 | 1.91 % | 0.04 % |
