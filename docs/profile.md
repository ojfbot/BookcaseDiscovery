# Reading profile and seeds (R-1)

What we know of the reader, with provenance, kept apart from identity (INV-18). R-2 ranks against it. The taste model it implements is `docs/recommend/taste-model.md` (R-0, adopted 2026-11-02).

| | |
|---|---|
| Code | `src/recommend/profile.ts` (model, weights, merge, writer), `expand.ts`, `review.ts`, `vocabulary.ts`, `schemas.ts`, `cli.ts` |
| Public data | `profile/seeds.json` (the owner's stated profile, OC9), `src/recommend/vocabulary.json` |
| Contracts | `contracts/profile.schema.json`, `contracts/vocabulary.schema.json` (Zod validators agree with them, OC13) |
| Private output | `<data root>/private/{profile.json, profile-review.html}`; optional input `<data root>/private/profile-overlay.json` |
| Commands | `bookcase profile check`, `bookcase profile build`, `bookcase profile review` |
| Tests | `test/profile.test.ts`, `test/profile-expand.test.ts`, `test/vocabulary.test.ts`, fixtures `test/fixtures/profile/` |

## The model

An **entry** says what the owner said of a subject (an author, work, series or tag): a `relation` (`read`, `liked`, `cooler`, `not-for-me`, `inferred-interest`, `unknown`), a `scope` (`all-works` or `one-work`) and **provenance** `{source, ref, date}`. Read, liked and inferred stay separate: nothing is derived into `read` or `liked` (INV-18).

A **node** is taste in terms of the vocabulary: a term on a facet, `stance` pull or push, `status` hypothesis, asserted or rejected, `evidence` SYNTH or ASSERTED, `support`, `qualifiers`. An **open question** is the reader-side unknown ("What cools Neal Stephenson for you?"). A node's support is a seed id or an event the owner asserted, never a catalog tag or model output (the schema allows no other type).

**Weights in the centre of taste** (starting values, configuration; `DEFAULT_SEED_WEIGHTS`, `NODE_WEIGHTS`):

| | weight |
|---|---|
| `liked` | 1.0 |
| `read`, scope all-works (`w_read_all`) | 0.6 |
| `read`, one work | 0.3 |
| `cooler`, `not-for-me`, `inferred-interest`, `unknown` | 0 (cooler still costs the author a score penalty in R-2: `coolerAuthors`) |
| node: asserted pull / hypothesis pull / rejected / open question | 1.0 / 0.5 / -1.0 / 0 (a push is negated) |

`w_read_all` is a parameter of `centreSeeds`, not a field of `seeds.json`: the file holds statements, tuning stays in configuration. O-4 decides whether "read all of Gibson" also means liked (the review sheet asks).

## Public seeds, private overlay

`profile/seeds.json` is **exactly the owner's stated profile**: read all of William Gibson, Kim Stanley Robinson liked, cooler on Neal Stephenson, each cited as "owner statement, project brief 2026-10-31". Nothing else about the owner. Only what the owner **stated** (ASSERTED) may be public (taste tree ruling Q4); accepted SYNTH hypotheses stay in `<data root>/private/` and still shape the owner's own picks.

`writeSeeds` is the only writer and **refuses** (throws `SeedsRefusal`, writes nothing) any entry or node that is not an owner statement:

- provenance source other than `owner-statement`, `owner-correction`, `owner-preference` (so `chatgpt-export`, `selfco` and `taste-tree` never);
- relation `inferred-interest` or `unknown`; expanded entries; hypothesis nodes; SYNTH nodes; open questions;
- a `ref` that names a private path or source.

The privacy guard (Z-1, `banned-provenance`) is the second line: it blocks a hand-edited `seeds.json` carrying `chatgpt-export` or `selfco` provenance. Both are tested.

**The overlay** (`profile-overlay.json`, same shape, private) is merged at run time by `mergeOverlay`. Seeds always win, and the overlay can only add `inferred-interest` and `unknown`: an overlay entry claiming `read`, `liked`, `cooler` or `not-for-me` is **refused and listed** (`ResolvedProfile.refused`), never coerced into something else, so nothing in the overlay is promoted to `read` or `liked`. Also refused: an owner-statement source (those belong in the seeds), an expanded entry, a reused id, a node citing a seed that does not exist. Every merged record carries `origin: "seeds" | "overlay"`. A missing overlay file is an empty overlay; one that does not parse is an error. The ChatGPT-export importer that would fill the overlay is post-MVP (OC22, backlog #5); the MVP ships the merge and the refusal rule, not the importer.

## Expansion

"Read all of Gibson" is stored as one compact seed (`scope: all-works`) and **expanded at build time** against the catalog (`bookcase profile build`): a `read` entry per novel, `expanded: true`, `expandedFrom: <seed id>`, the seed's provenance. Expanded entries are never stored in `seeds.json` (the writer refuses them): the public file stays three entries long and reviewable, and the catalog decides what "all" means.

**What counts as a novel** (`expand.ts`): a catalog work with `ttype = NOVEL`, credited to the author (`work_authors.alias = 0`, so a co-written novel counts and a variant's alias credit does not), with at least one edition that is not audio-only. Collections, omnibuses, anthologies, chapbooks and non-fiction are not expanded. On the 2026-10-31 catalog, `William Gibson` (one author, id 172) has 12 novels counted; 11 other works are listed as not counted (3 collections, 4 omnibuses, 3 non-fiction, and *Alien III*, an Audible Original that ISFDB files as a NOVEL with only an audio edition). The review sheet shows both lists.

Only `read` seeds expand. A `liked` or `cooler` author stays at author level: expanding would state a verdict on every title the owner never rated (taste-model.md §6.3). R-2 gets those authors' works from `worksOfAuthor`.

## Vocabulary

`src/recommend/vocabulary.json`: the eight facets, 45 terms (taken from the examples in taste-model.md §2.1 and §6; a starting set, *hypothesis*, that R-2a grows from the `unmapped` list), the crosswalk from ISFDB tags, LCSH, LCGFT and BISAC values to terms, a generic list and a **drop list** for popularity and canon signals (ratings, votes, award and best-of-list tags; OC33). `checkVocabulary` rejects a rule that maps a dropped value. No LLM theme extraction is in this card (R-2a, needs the API key).

## The review sheet (O-4)

`bookcase profile review` writes `<data root>/private/profile-review.html`: what the seeds say, what expansion found (collapsed), and two yes/no questions from R-0 — *Does reading all of Gibson also mean you liked him?* and *Should a liked author's far-out book appear at the default setting?* — with a "copy my answers" button. About two minutes; skipping keeps the default (No on both). One self-contained file, no network.

## O-4 owner answers (2026-11-02)

- **Q1, "Does reading all of William Gibson also mean you liked him?": yes.** Recorded as the owner statement `seed-gibson-liked` in `profile/seeds.json` (`liked`, scope all-works), beside the `read` seed. Gibson now counts towards the centre at the `liked` weight.
- **Q2, "Should a book by an author you like show up at the default setting even when its ideas are far from your usual?": yes.** A ranking rule for R-2: at the default discovery temperature, a book by a `liked` author is eligible even when its facet distance puts it outside the default ring. Ideas still rank it; the author only makes it eligible. R-2 implements and tests it.
