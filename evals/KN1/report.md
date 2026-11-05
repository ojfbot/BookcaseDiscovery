# KN-1: shared book knowledge (`work_features`): report

Runner: `src/catalog/kn1-eval.ts` (`gate --set <set>`, then `analyse`). Table and build: `src/catalog/work-features.ts`,
`src/catalog/build.ts`; the design is in `docs/catalog.md` § Shared book knowledge. Aggregates only, with no titles and
no ids. The confirmed work ids per set stay under the data root's `private/kn1/`.

**Nothing here changes a decision.** `identify` does not read the table yet; KN-2 and R-2 will. So there is no keep
rule and no pre-registration. The two sets are reported apart (OC35). `pilot-000` figures are machine agreement, never
accuracy (INV-17).

## Answer

- **The gate holds.** `catalog-kn1.sqlite` is today's catalog plus `work_features`. Every box re-decides to the same
  accept on both files: 718 of 718 accepts on `pilot-000` and 13 of 13 on the yardstick, 1.000 on all boxes (6,894
  and 1,132). Both also equal C-6's unguarded decisions on today's catalog (1.000).
- **Coverage on `pilot-000`'s 471 confirmed works.**
  - Genre or form from either source: 80.0 % (76.2–83.4).
  - From ISFDB tags: 65.6 % (61.2–69.8).
  - From Open Library subjects: 62.4 % (58.0–66.7).
  - From both: 48.0 %.
- **The sources agree on genre.** 216 works have a genre from both sources. 79.2 % of them (73.3–84.0) share a
  canonical genre, and 90.3 % (85.6–93.6) share a genre family. The mean Jaccard is 0.52 on genres and 0.67 on
  families.
- **Form comes from Open Library, not ISFDB.**
  - On `pilot-000`, ISFDB tags give a form to 0.4 % of works (2 of 471), and Open Library to 49.5 %.
  - Across the catalog, ISFDB tags give a form to 0.7 % of works and Open Library to 14.2 %.
  - Outside speculative fiction (ISFDB's own non-genre flag, 4,223 works), ISFDB tags give a genre or form to 4.9 % of
    works and a form to 0.5 %. Open Library gives 25.8 % and 21.4 %.
- **The yardstick is too small to read.** On the default catalog it has 12 confirmed works. Genre or form from either
  source covers 7 of them (58.3 %, 32.0–80.7).

## Why these sets, and what "confirmed" means

A confirmed work is one F-0's `readers-agree` rule accepts, re-decided on `catalog-kn1.sqlite`, on a box in RB-1's
box set (F-0i's partition less NB-3's `on-lip`). Each set counts distinct works. F-0g's copy, F-0h's context and
F-0g2's pooling bases are not counted.

- `pilot-000`: 643 confirmed boxes, 471 works.
- Yardstick (`yardstick-library-b2`): 12 boxes, 12 works. The default catalog is ISFDB-only, and these are library
  shelves of mostly general fiction, so few books are accepted. The yardstick is PROXY, and its accepts include wrong
  ones (C-5's judge is not applied here).

The yardstick's stored `decisions.jsonl` predates later retrieval changes (269 stored accepts against 13 today). The
gate therefore compares re-decisions on today's catalog with re-decisions on the new one. The stored files are not
the reference. See `implementation-notes.md`, KN-1.

## Coverage

Share of confirmed works with at least one term of each kind, by source (Wilson 95 % intervals):

| | `pilot-000` (471) | yardstick (12) | whole catalog (340,829) |
|---|---|---|---|
| genre or form, ISFDB tags | 65.6 % (61.2–69.8) | 41.7 % (19.3–68.0) | 27.1 % |
| genre or form, Open Library | 62.4 % (58.0–66.7) | 50.0 % (25.4–74.6) | 18.7 % |
| genre or form, either | **80.0 %** (76.2–83.4) | 58.3 % (32.0–80.7) | 37.0 % |
| genre or form, both | 48.0 % (43.5–52.5) | 33.3 % (13.8–60.9) | 8.8 % |
| genre, either | 79.0 % | 58.3 % | 34.2 % |
| form, ISFDB tags | 0.4 % | 8.3 % | 0.7 % |
| form, Open Library | 49.5 % | 41.7 % | 14.2 % |
| subject, either | 65.0 % | 58.3 % | 23.0 % |
| any term, either | 83.4 % (79.8–86.5) | 66.7 % | 40.5 % |

The confirmed works are better covered than the catalog as a whole, probably because a book two readers confirm
tends to be a well-catalogued one, with more editions and more taggers (not measured here). The catalog-wide figures are what a prior over all
candidates would see.

## Terms per work

| | `pilot-000` ISFDB | `pilot-000` OL | yardstick ISFDB | yardstick OL | catalog ISFDB | catalog OL |
|---|---|---|---|---|---|---|
| mean, all works | 1.91 | 4.83 | 3.17 | 13.67 | 0.54 | 1.32 |
| median, all works | 1 | 3 | 0.5 | 11.5 | 0 | 0 |
| median, works with any | 1 | 6 | 3.5 | 17 | 1 | 5 |
| mean genre / form / subject | 0.86 / 0.00 / 1.04 | 1.54 / 0.67 / 2.62 | 0.58 / 0.08 / 2.50 | 1.25 / 1.33 / 11.08 | 0.33 / 0.01 / 0.20 | 0.31 / 0.24 / 0.77 |

ISFDB tags are few per work and mostly genre (`science fiction`, `fantasy`, `horror` are its three most used).
Open Library subjects are several per work and mostly topical (LCSH-style `X -- Fiction` and BISAC-style
headings).

## Agreement between the sources

These figures cover only works where both sources give a canonical genre or form.

| | `pilot-000` | yardstick | whole catalog |
|---|---|---|---|
| works with a genre from both | 216 | 2 | 24,788 |
| share with a genre in common | **79.2 %** (73.3–84.0) | 2 of 2 | 63.4 % (62.8–64.0) |
| share with a genre family in common | 90.3 % (85.6–93.6) | 2 of 2 | 80.0 % |
| mean Jaccard, genres / families | 0.52 / 0.67 | 0.21 / 0.25 | 0.44 / 0.60 |
| works with a form from both | 1 | 1 | 324 |
| share with a form in common | 0 of 1 | 0 of 1 | 29.3 % (24.6–34.5) |

On `pilot-000`, 45 of the 216 works share no canonical genre. 24 of those 45 still share a family, so they differ
only on specificity: one source says `urban-fantasy` or `space-opera` and the other says `fantasy` or
`science-fiction`. The other 21 differ in kind. Form
agreement can hardly be measured, because ISFDB tags almost never name a form.

## Form outside speculative fiction (measured, as the card asked)

ISFDB is mostly speculative fiction. On today's catalog, only 1 of `pilot-000`'s 471 confirmed works and none of the
yardstick's 12 carry ISFDB's non-genre flag, so the confirmed sets cannot measure this. Across the whole catalog:

| ISFDB non-genre flag | works | genre or form, ISFDB | genre or form, OL | form, ISFDB | form, OL |
|---|---|---|---|---|---|
| genre (speculative) | 336,606 | 27.4 % | 18.6 % | 0.8 % | 14.1 % |
| non-genre | 4,223 | **4.9 %** (4.3–5.6) | 25.8 % (24.5–27.2) | **0.5 %** | 21.4 % (20.2–22.7) |

Outside speculative fiction, ISFDB's tags say almost nothing about genre or form, so Open Library is the only source
there. Two further notes:

- ISFDB's own work type (`works.ttype`: NOVEL, COLLECTION, ANTHOLOGY, …) is a structured form fact on every ISFDB
  work. It is not in `work_features` because the card scoped the sources to tags and subjects. It is a cheap
  follow-up if KN-2 wants a form prior.
- LC genre/form terms, the controlled form vocabulary R-0 wanted, are not sourced. No bulk LC record file is on disk
  (see `implementation-notes.md`).

## For KN-2 and R-2

- **Readers:**
  - `workFeatures(db, workId)` returns the rows with provenance.
  - `workGenres(features)` returns the canonical genres per source.
  - `hasWorkFeatures(db)` tells whether a file has the table.
  - `canon` is indexed for a prior keyed on genre.
- **Sources:** prefer the genre family when the two sources disagree, and keep each source separate: they agree on
  family 90 % of the time on `pilot-000`.
- **Coverage gap:** on `pilot-000`, 20 % of confirmed works have no genre or form at all. Across the catalog, 63 % have
  none. A prior must treat "no term" as unknown, not as evidence against a genre.
- **Wrong accepts:** the yardstick's accepts include wrong ones. Any genre-prior test there should apply C-5's judge
  first.

## Counts (catalog-kn1.sqlite, dumps 2026-10-31)

- 631,048 rows on 138,200 of 340,829 works: 216,348 genre, 84,795 form and 329,905 subject.
- 182,471 rows from ISFDB public tags, with 24,584 private-tag links skipped.
- 448,577 rows from Open Library subjects. 116,704 Open Library works are linked by C-5's crosswalk (run without
  merging), and 69,233 ISFDB works carry at least one subject.
- 16,184 values dropped as not book facts: awards, lists, adaptations and bookkeeping.
- Genre families, works per source:
  - ISFDB: fantasy 45,024, sf 29,098, horror 10,790, romance 10,668, crime 1,905.
  - Open Library: fantasy 18,837, sf 16,526, horror 8,622, adventure 6,979, romance 5,057.

## Reproduce

```
pnpm catalog:ol subjects --staging $BOOKCASE_DATA/catalog/ol-staging-c9.sqlite
bookcase catalog build --out $BOOKCASE_DATA/catalog/catalog-kn1.sqlite \
  --ol-subjects $BOOKCASE_DATA/catalog/ol-subjects-2026-10-31.sqlite --ol-crosswalk $BOOKCASE_DATA/catalog/ol-staging-c9.sqlite
node src/catalog/kn1-eval.ts gate --set yardstick
node src/catalog/kn1-eval.ts gate --set pilot-000
node src/catalog/kn1-eval.ts analyse
```

All of it runs on the CPU. The extract takes about 1 minute, the build about 90 s, and the gates about 10 and 30 minutes.
Today's `catalog.sqlite`, `catalog-v2.sqlite` and C-9's files are not touched.
