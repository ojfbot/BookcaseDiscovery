# KN-1: shared book knowledge (`work_features`): report

Runner: `src/catalog/kn1-eval.ts` (`gate --set <set>`, then `analyse`). Table and build: `src/catalog/work-features.ts`,
`src/catalog/build.ts`; the design is in `docs/catalog.md` § Shared book knowledge. Aggregates only, with no titles and
no ids. The confirmed work ids per set stay under the data root's `private/kn1/`.

**Nothing here changes a decision.** `identify` does not read the table yet; KN-2 and R-2 will. So there is no keep
rule and no pre-registration. The two sets are reported apart (OC35). `pilot-000` figures are machine agreement, never
accuracy (INV-17).

## Answer

- **The gate holds.** Each set's catalog was rebuilt with `work_features` as a new file, and every box re-decides to
  the same accept on both files (1.000):
  - `pilot-000`: 718 of 718 accepts, 6,894 boxes, `catalog.sqlite` against `catalog-kn1.sqlite`. These also equal
    C-6's unguarded decisions.
  - Yardstick: 269 of 269 accepts, 1,132 boxes, on its closed-set inventory catalog against
    `f0-inventory-catalog-kn1.sqlite`. These also equal the stored F-0 decisions.
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
- **The yardstick is thinly covered.** It has 260 confirmed works on its inventory catalog, and only Open Library can
  describe them (the inventory has no ISFDB tags):
  - genre or form: 14.2 % (10.5–19.0);
  - genre: 6.9 % (4.4–10.7);
  - any term: 26.5 %.

  Open Library links 12,690 of the inventory's books by ISBN. Only 3,161 of those carry any subject: they are mostly
  Spanish editions, which Open Library describes thinly.

## Why these sets, and what "confirmed" means

A confirmed work is one F-0's `readers-agree` rule accepts, re-decided on `catalog-kn1.sqlite`, on a box in RB-1's
box set (F-0i's partition less NB-3's `on-lip`). Each set counts distinct works. F-0g's copy, F-0h's context and
F-0g2's pooling bases are not counted.

- `pilot-000`: 643 confirmed boxes, 471 works, on the default catalog.
- Yardstick (`yardstick-library-b2`): 266 confirmed boxes, 260 works, on its own closed-set catalog. That catalog is the
  Library Dataset's inventory of 15,229 books, with ids `isfdb:<row>`; F-0 decides the yardstick against it. The
  yardstick is PROXY, and its accepts include wrong ones (C-5's judge is not applied here).

The inventory's books reach Open Library by ISBN, through one offline pass over the editions dump
(`pnpm catalog:ol isbn-stage`). The default catalog's breadth layer is English-only and links only 10.0 % of these works
to a genre or form. So the two sets' Open Library figures come from different reaches: breadth for `pilot-000`, ISBN
for the yardstick. See `implementation-notes.md`, KN-1.

## Coverage

Share of confirmed works with at least one term of each kind, by source (Wilson 95 % intervals):

| | `pilot-000` (471) | default catalog (340,829) | yardstick (260) | inventory (15,228) |
|---|---|---|---|---|
| genre or form, ISFDB tags | 65.6 % (61.2–69.8) | 27.1 % | — | — |
| genre or form, Open Library | 62.4 % (58.0–66.7) | 18.7 % | 14.2 % (10.5–19.0) | 12.8 % |
| genre or form, either | **80.0 %** (76.2–83.4) | 37.0 % | **14.2 %** (10.5–19.0) | 12.8 % |
| genre or form, both | 48.0 % (43.5–52.5) | 8.8 % | — | — |
| genre, either | 79.0 % | 34.2 % | 6.9 % (4.4–10.7) | 6.8 % |
| form, ISFDB tags | 0.4 % | 0.7 % | — | — |
| form, Open Library | 49.5 % | 14.2 % | 14.2 % | 12.2 % |
| subject, either | 65.0 % | 23.0 % | 26.2 % | — |
| any term, either | 83.4 % (79.8–86.5) | 40.5 % | 26.5 % (21.5–32.2) | 20.2 % |

A dash means the source does not exist for that catalog: the inventory has no ISFDB tags.

On the default catalog, the confirmed works are better covered than the catalog as a whole, probably because a book two readers confirm
tends to be a well-catalogued one, with more editions and more taggers (not measured here). The catalog-wide figures are what a prior over all
candidates would see.

## Terms per work

| | `pilot-000` ISFDB | `pilot-000` OL | catalog ISFDB | catalog OL | yardstick OL | inventory OL |
|---|---|---|---|---|---|---|
| mean, all works | 1.91 | 4.83 | 0.54 | 1.32 | 3.29 | 2.46 |
| median, all works | 1 | 3 | 0 | 0 | 0 | 0 |
| median, works with any | 1 | 6 | 1 | 5 | 6 | 6 |
| mean genre / form / subject | 0.86 / 0.00 / 1.04 | 1.54 / 0.67 / 2.62 | 0.33 / 0.01 / 0.20 | 0.31 / 0.24 / 0.77 | 0.24 / 0.27 / 2.78 | 0.24 / 0.26 / 1.95 |

ISFDB tags are few per work and mostly genre (`science fiction`, `fantasy`, `horror` are its three most used).
Open Library subjects are several per work and mostly topical (LCSH-style `X -- Fiction` and BISAC-style
headings).

## Agreement between the sources

These figures cover only works where both sources give a canonical genre or form.

| | `pilot-000` | whole default catalog |
|---|---|---|
| works with a genre from both | 216 | 24,788 |
| share with a genre in common | **79.2 %** (73.3–84.0) | 63.4 % (62.8–64.0) |
| share with a genre family in common | 90.3 % (85.6–93.6) | 80.0 % |
| mean Jaccard, genres / families | 0.52 / 0.67 | 0.44 / 0.60 |
| works with a form from both | 1 | 324 |
| share with a form in common | 0 of 1 | 29.3 % (24.6–34.5) |

The yardstick has one source only, so agreement cannot be measured there.

On `pilot-000`, 45 of the 216 works share no canonical genre. 24 of those 45 still share a family, so they differ
only on specificity: one source says `urban-fantasy` or `space-opera` and the other says `fantasy` or
`science-fiction`. The other 21 differ in kind. Form
agreement can hardly be measured, because ISFDB tags almost never name a form.

## Form outside speculative fiction (measured, as the card asked)

ISFDB is mostly speculative fiction. Only 1 of `pilot-000`'s 471 confirmed works carries ISFDB's non-genre flag, so
that set cannot measure this. The yardstick's inventory is mostly general fiction, but its catalog has no real genre
flag, and its form there is Open Library's 14.2 %. Across the whole default catalog:

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
  - `workKnowledge(db, workId)` returns genre rows, subject rows and one form (`pickForm`), each with its provenance.
  - `workFeatures(db, workId)` returns every row.
  - `workGenres(features)` returns the canonical genres per source.
  - `SECTION_GENRES` and `sectionFits(section, features)` map SC-1's section families to genre and form terms.
  - `hasWorkFeatures(db)` tells whether a file has the table.
  - `canon` is indexed for a prior keyed on genre.
- **Yardstick catalog:** `BOOKCASE_CATALOG` does not select it. Open
  `proxy/library-dataset/f0-inventory-catalog-kn1.sqlite` directly, as F-0's yardstick runs do with the inventory.
- **Sources:** prefer the genre family when the two sources disagree, and keep each source separate: they agree on
  family 90 % of the time on `pilot-000`.
- **Coverage gap:** on `pilot-000`, 20 % of confirmed works have no genre or form at all. Across the catalog, 63 % have
  none. A prior must treat "no term" as unknown, not as evidence against a genre.
- **Yardstick coverage:** at 6.9 % genre (18 of 260 confirmed works), a genre-prior check on the yardstick has
  little to work with. Form (14.2 %) and subjects (26.2 %) reach a little further.
- **Wrong accepts:** the yardstick's accepts include wrong ones. Any genre-prior test there should apply C-5's judge
  first.

## Counts, yardstick inventory (`f0-inventory-catalog-kn1.sqlite`)

- 37,387 rows on 3,082 of 15,228 works, all of them Open Library subjects: 3,721 genre, 3,936 form and 29,730
  subject.
- 12,690 Open Library works share an ISBN-13 with the inventory; 3,161 of them carry subjects.
- 1,789 values dropped as not book facts.

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
L=$BOOKCASE_DATA/proxy/library-dataset
pnpm catalog:ol isbn-stage --catalog $L/f0-inventory-catalog.sqlite --out $L/ol-staging-inventory-kn1.sqlite
pnpm catalog:ol subjects --staging $L/ol-staging-inventory-kn1.sqlite --out $L/ol-subjects-inventory-kn1.sqlite
bookcase catalog build --staging $L/f0-inventory-catalog.sqlite.staging.sqlite --out $L/f0-inventory-catalog-kn1.sqlite \
  --ol-subjects $L/ol-subjects-inventory-kn1.sqlite --ol-crosswalk $L/ol-staging-inventory-kn1.sqlite
node src/catalog/kn1-eval.ts gate --set yardstick
node src/catalog/kn1-eval.ts gate --set pilot-000
node src/catalog/kn1-eval.ts analyse
```

All of it runs on the CPU. The extract takes about 1 minute, the build about 90 s, the ISBN pass about 6 minutes, and the
gates about 4 (yardstick) and 30 (`pilot-000`) minutes. Today's `catalog.sqlite`, `catalog-v2.sqlite`, the inventory
catalog and C-9's files are not touched.
