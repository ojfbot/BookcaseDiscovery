# KN3: shelf signals for recommend — pre-registration

Fixed 2026-11-05, after KN-2 merged (#72) and before any real-data run of this card. Nothing below changes after
seeing a result. Any change is logged as a deviation in `implementation-notes.md`, and the report
(`evals/KN3/report.md`) says which figures it touches. The constants live in `src/recommend/shelf-signals.ts`
(`SHELF`) and `src/eval/kn3.ts` (`EVAL`, `verdicts`) at this commit.

Before this was written, only input counts were looked at, never a measure below: TS-0's ledger has 824 labels on 29
photos (726 `readers-agree`, 9 `confirmed-by-copy`, 89 `confirmed-by-context`) of 556 distinct works; 94 works are
confirmed in two or more photos, 93 of them within one F-1 capture group; the manifest flags no near-duplicate photo;
SC-1 left 83 row records, 67 with a section family.

**Question.** A shop's shelving is itself shared book knowledge: which books it puts side by side, which section a row
is, and which book stands out from its row. Can those three signals be read from **confirmed** books alone, as
features that `recommend` may use, and do they carry information beyond a shuffle of the same store's books?

**This card adds the features and runs them in `shadow` only.** The switch (`SHELF_SIGNAL_MODES`:
`off | shadow | on`) defaults to `off`. Nothing in identify, perceive or catalog reads the signals, and no ranker
consumes them yet (R-2's `rank.ts` does not exist). Promotion to `on` is the owner's ruling; the verdicts below are
what that ruling reads.

## The wall and the direction (INV-13)

- **One way.** `src/recommend/shelf-signals.ts` may import catalog and identify outputs. No file under `src/identify/`,
  `src/perceive/` or `src/catalog/` may reach it or `src/eval/kn3*.ts`, transitively; `test/shelf-signals.test.ts`
  extends I-4's structural test to prove it.
- **Shared knowledge, never taste.** The signals read work features (KN-1), F-0h's rows, SC-1's signs and TS-0's
  confirmed labels. They never read the profile, seeds, overlay, vocabulary or a lens; the same test proves their
  import closure reaches none of those. The reader's profile and lenses may only *consume* them, inside recommend.
- **No popularity.** No edition count, rating, vote count, award or year is read, and a work's neighbours are
  combined by their **maximum** weight over its sightings, never summed, so a work shelved in many photos or many
  copies is not raised over one seen once. The rows' `count` in `work_features` is never read.
- **Discovery, not penalty.** The out-of-place flag adds a discovery feature; no signal lowers any work's value.

## Set (OC35)

**`pilot-000` only** (31 real-use photos; 29 carry a label). Every figure is **machine agreement, never accuracy**
(INV-17). There are no recommendation ground truths; every measure below is label-free.

**The yardstick is not used.** It is PROXY (library shelves), KN-1 finds features on 14.2 % of its confirmed works,
KN-2 found 12 rows with a mix and nothing to separate, and recommend has no use for a library sample. Nothing is
fitted on any set; no constant below is tuned. No hand labels (OC36). Nothing is trained. CPU only.

## Inputs

- **Confirmed books:** TS-0's label ledger (`datasets/label-ledger/<latest>/labels.jsonl` under the data root): one
  row per kept box of RB-1's box set with a confirmed work, on a shipped basis (`readers-agree`, `confirmed-by-copy`,
  `confirmed-by-context`). Only the box id, work id, basis, authors (for one secondary measure, in memory only) and
  photo's capture group are read.
- **Rows:** F-0h's (`buildRows` on RB-1's book boxes through F-0g's `loadBooks`; keys `<photo>|<k>`, bands top to
  bottom, members left to right). A row member's **position** is its index among the row's book boxes, confirmed or
  not, so distance is physical. Confirmed boxes in no row (lying, face-out) carry no shelf signal and are counted.
- **Case:** `pilot-000` has no bookcase ids (TS-0), so a **case** is one photo.
- **Work features:** KN-1's `workKnowledge` on `catalog-kn1.sqlite`, through KN-2's adapter `termsOf`
  (`src/identify/section-prior-cli.ts`): **genre** = genre families, **form** = KN-1's one form (`pickForm`),
  **subject** = subject terms. A work is **known** for a facet when it carries a term there; a missing term is
  unknown, never evidence.
- **SC-1's sign:** `private/sc1/pilot-000/rows.jsonl`: the row's `family` and `confidence`. SC-1's K2 failed, so the
  sign is weak by construction.

## The three signals (`src/recommend/shelf-signals.ts`)

1. **Co-shelving.** For each pair of confirmed sightings of two **different** works in one photo:
   - same row, positions *d* apart: weight **1 / d**;
   - same photo, other row, bands *Δ* apart: weight **0.25 / max(1, Δ)** (scope `case`).

   A work's co-shelving neighbours are the other works with their weight, the **maximum** over all sightings, with
   scope `row` if any row sighting gave it. Two sightings of one work (copies, or one copy in two photos) are never
   a pair.
2. **Section terms.** Per row:
   - **sign terms:** SC-1's family, when its record's confidence is at least 0.3, mapped through KN-1's
     `SECTION_GENRES`: its families as genre terms (KN-2's `signTerms`), its canons as form terms;
   - **mix terms:** KN-2's `buildMix` on the row's confirmed members (all bases), with the sign as KN-2 weighs it
     (half a neighbour, genre only, never alone; at least 2 known members), giving each genre, form and subject
     term's share.

   A work's section terms are those of every row it is confirmed in.
3. **Out-of-place flag.** KN-2's stress-test rule, unchanged, on each confirmed member with the member left out:
   - **form:** its form differs from `majorityForm` of the row's other confirmed members (both known);
   - **genre:** the row's mix without it (`buildMix`, sign included) knows the genre facet, the member knows its
     genres, and none of them appears in the mix.

   A row member is **determinable** for a facet when both sides are known. A flagged work carries the facet(s) and
   the row; it is a discovery feature.

## Measures

### C · coverage

Over the 320 rows and over distinct confirmed works (all bases): rows with at least two confirmed members; works with
a `row` neighbour; works with any neighbour; rows with sign terms; rows with a mix; works on a row with any section
term; works and rows determinable for the out-of-place flag; works flagged (genre, form, either).
**C1:** at least **50 %** of confirmed works have a `row` neighbour.

### H · co-shelving neighbours share a KN-1 term more often than a shuffle

- **Pairs:** unordered same-row pairs of confirmed sightings of different works, both known on the facet, weighted by
  their co-shelving weight (1 / d).
- **Share** *s*: `either` = they share a genre family or have the same form; `genre` = their genre families
  intersect; `form` = their forms are equal.
- **Shuffle control** *e*: replace one side with a confirmed sighting from **another photo**, drawn uniformly from
  those known on the facet whose work is not the other side's; *e* is the exact expectation of *s* under that draw,
  averaged over replacing either side. (F-0h's neighbour shuffle, store-wide.)
- **Statistic:** *H* = Σ*w·s* / Σ*w*, *E* = Σ*w·e* / Σ*w*, **D = H − E**, lift = *H* / *E*. A **95 % photo-cluster
  bootstrap** of *D* (2,000 resamples of photos, seed 20261105). Also 200 seeded random shuffles (each pair's one
  side, chosen at random, replaced by a random draw from that pool): their *H*'s mean and 95th percentile.
- **Primary (H1):** `readers-agree` pairs only (a context label was confirmed *because* its neighbours fit an author
  bracket, which would make the test circular), facet `either`. **H1 holds** when *D*'s lower bound is above 0.
- **Secondary (reported, no verdict):** facets `genre` and `form`; all bases; same-author pairs removed (shops shelve
  by author, so neighbours often share one); each unordered work pair counted once across photos (overlapping shots
  repeat pairs); distance bands *d* = 1, 2, 3+; `case` pairs (weight 0.25 / Δ) against the same control.

### O · the out-of-place flag is not noise

If rows are coherent, fewer books are out of place in the real rows than when the same confirmed books are dealt
into the same row slots at random. **200 seeded shuffles** of work ids over all confirmed row slots of the set (row
sizes, signs and bases fixed), the flag recomputed each time. **O1 holds** when the real flagged share of
determinable members (`either`) is below the shuffles' **5th percentile**. Genre and form are reported apart.

### S · stability

- **Primary, as the card asks:** agreement of each signal across F-1's near-duplicate photo pairs. **Expected
  vacuous:** the manifest flags none (TS-0: closest pair 18 bits, threshold 8). Reported as the pair count.
- **Substitute:** works confirmed in two or more photos of **one F-1 capture group** (one burst of shots, at most
  120 s apart, mostly overlapping views of one case). Per (work, photo pair), each sighting's row:
  - out-of-place agreement: the same flag (`either`) where determinable in both;
  - section agreement: the same top genre family of the row's mix (largest share, ties by name) where both rows
    have a genre mix; and the same sign family where both rows have a sign;
  - co-shelving overlap: Jaccard of the two rows' confirmed neighbour works (each sighting's row, itself left out),
    where either is non-empty.

  Reported as shares and means with the pair counts; no threshold (a capture group can show different shelves).

### L · what limits the result (stated plainly)

Share of known works whose genres include `sf` or `fantasy`; distinct genre families among confirmed works; share
of form-known works whose form is `novel`; rows with SC-1 sign terms (of 320); the sign families seen; confirmed
sightings in no row.

## Verdicts (for the owner's ruling)

- **Co-shelving** (and the mix half of section terms, which aggregates the same neighbours): recommend `shadow → on`
  only if **H1** and **C1** hold.
- **Out-of-place flag:** recommend surfacing it only if **O1** holds and at least one work is flagged.
- **Sign terms:** stay off whatever this card finds, until SC-1's own K2 holds; reported as coverage only.

Whatever holds, the switch's default stays `off`.

## Reproduce

```
node src/eval/kn3-cli.ts analyse   # seconds on CPU; evals/KN3/metrics.json, private signals under private/kn3/
```

Only aggregates leave the data root: `metrics.json`, `report.md`, `prereg.md`.
