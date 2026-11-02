# Catalog backend options (C-R, OC32)

Research card C-R, 2026-11-02. Read-only: no accounts, no API keys, no bulk downloads, no contact with
anyone. Every source was read on 2026-11-02.

## Answer first

- **Recommended backend:** keep **ISFDB as the MVP's local index (OC20 stands)**. Pre-approve the **Open
  Library works and editions dumps** as the second local index. Use the **Library of Congress SRU
  endpoint** (keyless) and the **Open Library search API** as live verifiers. Adopt no commercial source.
- **The plan's rule stands: a local index searches, live APIs verify.** No live API found here does
  fuzzy matching. The free ones allow 10 requests a minute (LoC) to 3 a second (Open Library), and every
  commercial one forbids building a database from its responses.
- **Proposed change to OC20:** widen its reopening trigger. Reopen breadth either when the coverage run
  shows ISFDB < 85 % of readable labels, or when the first non-SF shelf is in scope (a library fixture
  or a mixed store shelf), whichever comes first. ISFDB covers speculative fiction only, so it cannot
  reach a non-SF spine whatever the measurement says.
- **Library venues.**
  - **Frisco:** the catalog can't be harvested (BiblioCommons terms). Its spine labels are a strong
    signal: `F SFI GIBSON` gives fiction, the SF genre code and the author's full surname. Shooting needs
    the Library Director's prior written permission if the photos are published.
  - **McKinney:** its sites refuse AI agents, so almost nothing could be verified. The owner reads its
    pages in a normal browser.
- **Coverage per source was not measured.** The fixture has no labels yet. The method is below, for a
  later card to run.

Labels: **verified** means read on the primary page (or observed in a live, keyless GET). **snippet**
means seen only in a search-result summary or a secondary source. **hypothesis** means inferred. Quotes
are under 15 words.

## 1. Sources

### 1a. Open and public catalogs: candidates for the local index or for verification

| Source | Licence and terms (caching, public repo) | Coverage: in-print, SF trade | Bulk or per-query | Rate limit | Cost | Fragment search | Quote, URL | Label |
|---|---|---|---|---|---|---|---|---|
| **ISFDB dump** (MVP index, OC20) | CC BY 4.0: local index OK; attribution in `NOTICE` (C-0) | Speculative fiction only. 628,617 novel publications and 967,479 publications in all; the stats report runs weekly. A 2025 trade title (*Sunrise on the Reaping*, ISBN 9781546171461) was found by ISBN | Bulk: MySQL dump, about 315 MB compressed (snippet) | n/a | free | Yes, through our own FTS5 trigram index (C-3) | "This work is licensed under a Creative Commons Attribution 4.0 International License." [isfdb.org home](https://www.isfdb.org/cgi-bin/index.cgi); counts from [stats](https://www.isfdb.org/cgi-bin/stats.cgi?4) | verified (licence, counts); snippet (dump size; the wiki download page needs a login) |
| **ISFDB REST API** | as above | as above | Per-query, by ISBN or ID only (`getpub.cgi?<ISBN>`); XML | None published | free | **No.** It has no title or author search | Live GET `getpub.cgi?0441569595` returned 17 *Neuromancer* publication records | verified (live GET) |
| **Open Library dumps** | The Internet Archive asserts no new rights. No named licence and no attribution rule. "Existing rights issues" may apply to some records | "Over 20 million records". 87,032 works have the subject "science fiction", 2,346 of them first published 2025–2026. Subject tags are noisy | Bulk, **monthly**: editions about 9.2 GB, works 2.9 GB, authors 0.5 GB, all types 12.4 GB | n/a | free | Yes, through our own index | "Open Library provides dumps of all its data, generated every month." [dumps](https://openlibrary.org/developers/dumps); "does not assert any new copyright or other proprietary rights" [licensing](https://openlibrary.org/developers/licensing) | verified |
| **Open Library search API** | Caching responses is encouraged. No HTML scraping. "Not a data backend" for third-party services | as above | Per-query (Solr); the dumps are for bulk | 1 req/s unidentified; 3 req/s with an app User-Agent and contact email | free | **Prefix only.** `title:neurom* author:gibs*` → *Neuromancer* first of 13 hits. Fuzzy `neuromancr~` → 0 hits | "Violations may result in aggressive rate limiting or blocking." [API](https://openlibrary.org/developers/api); [search docs](https://openlibrary.org/dev/docs/api/search) | verified (page and live GETs) |
| **Open Library covers** | No licence stated. The cover art is the publishers'. Do not commit covers to the repo | — | Per-query | 100 requests per IP per 5 minutes for ISBN lookups | free | n/a | "Please, do not crawl our cover API." [covers](https://openlibrary.org/dev/docs/api/covers) | verified |
| **LoC loc.gov JSON API** | Free, no key | **No catalog records**: digitised items only | Per-query | 20 req/min, then a 1-hour block | free | n/a | "the API does not include records from the library catalog" [json-and-yaml](https://www.loc.gov/apis/json-and-yaml/) | verified |
| **LoC catalog, SRU / Z39.50** (`lx2.loc.gov:210/LCDB`) | No terms on the Z39.50 pages. The site-wide rule is 10 req/min. Caching for verification is fine | The live LoC catalog. Trade titles that received CIP; small-press and mass-market are likely thin (hypothesis) | Per-query; title, author, keyword and ISBN only; at most 50 records per fetch | 10 req/min (site-wide) | free | **Right truncation only.** `neurom*` → 242 records; `neurom?` → "Masking character not supported"; no fuzzy | "the attributes supported are significantly reduced." [lcserver](https://www.loc.gov/z3950/lcserver.html); "submit a total of no more than 10 requests per minute" [legal](https://www.loc.gov/legal/) | verified (pages and two live SRU queries) |
| **LoC MARCXML by LCCN** (`lccn.loc.gov/{id}/marcxml`) | as above | as above | Per-query, exact LCCN | 30 req/min; going over blocks for 72 hours | free | No | "The countdown will reset any time a request is made during the block period." [limits](https://www.loc.gov/apis/json-and-yaml/working-within-limits/) | verified |
| **LoC MDSConnect "Books All"** (bulk MARC) | Free "primarily for research and development". LoC claims copyright **outside the US**, and redistribution means contacting LoC first. **Unclear for a public repo** | **Frozen**: 2016 retrospective set (1968–2014 per press, plus about 200k records added in 2021, snippet). No new trade titles. Current records come only through the **paid** MDS subscription | Bulk, about 3 GB gzipped in 43 parts | n/a | free (paid for current data) | Through our own index | "nearly 25 million MARC records, as distributed in the unabridged 2016 Retrospective file sets" [marcDist](https://www.loc.gov/cds/products/marcDist.php); "copyrighted by the Library of Congress for use outside the United States" [mdsftp](https://loc.gov/cds/mdsftp.html) | verified (pages, file-listing sizes); snippet (date range) |
| **LoC id.loc.gov** (LCSH, LC Name Authority File) and **BIBFRAME bulk** | No licence found | Authority data: author-name normalisation, not titles. BIBFRAME is a 2019 snapshot of 19M works | Bulk | not read | free | n/a | "the first attempt to share the Library of Congress BIBFRAME file" [BIBFRAME bulk PDF](https://www.loc.gov/bibframe/implementation/pdf/bibframe-bulk-download.pdf) | verified (BIBFRAME PDF); snippet (id.loc.gov downloads, behind a bot challenge) |
| **Wikidata** | CC0: no restriction on caching or publishing | 527,548 literary works and 856,147 editions (direct class only); 94,148 items carry an ISFDB title ID. Thin on new trade editions (hypothesis) | Bulk weekly (about 130 GiB JSON); SPARQL per-query | SPARQL: 60 s query deadline, 5 parallel queries per IP | free | Label prefix (`wbsearchentities`), not limited to books | "is released into the public domain under Creative Commons Zero." [licensing](https://www.wikidata.org/wiki/Wikidata:Licensing) | verified (page and live SPARQL counts) |
| **BookBrainz** | Core data CC0 | Too small: 26,948 editions | Bulk weekly (PostgreSQL); the API is alpha | not stated | free | Through our own index | "The BookBrainz core data is licensed under the Creative Commons CC0 license." [licensing](https://bookbrainz.org/licensing); [statistics](https://bookbrainz.org/statistics) | verified |
| **British National Bibliography** | Bulk MARC needs registration (out of scope). Linked-open BNB was CC0; its current status after 2023 is unclear | UK and Irish publishing | Bulk with registration | — | free | — | "publishing activity of the United Kingdom and the Republic of Ireland since 1950" [BL metadata services](https://www.bl.uk/more/collection-metadata-services/) | verified (page); snippet (open-data status) |

### 1b. Commercial, bookseller and distributor sources

None of these allows a local index that could be published or kept long-term. They can serve as
verifiers only, and each needs a key or an account, which this card did not create.

| Source | Terms (caching, public repo) | Coverage | Bulk or per-query | Rate limit | Cost | Fragment search | Quote, URL | Label |
|---|---|---|---|---|---|---|---|---|
| **Google Books API** | Google APIs Terms forbid building databases or permanent copies; caches only as long as the cache header allows | Very broad (hypothesis) | Per-query, up to 40 results | About 1,000/day by default (snippet). **A keyless GET returned HTTP 429** (anonymous daily quota used up) | free with a key | Not documented; `intitle:`/`inauthor:` look like whole-word matches (hypothesis; untested because of the 429) | "Scrape, build databases, or otherwise create permanent copies of such content" [Google APIs Terms](https://developers.google.com/terms) | verified (terms, 429); hypothesis (matching) |
| **ISBNdb** | Terms page blocked; assume no redistribution | Broad (hypothesis) | Per-query; bulk dumps reportedly sold | 1/s and 1,000/day (Basic) up to 10/s and 50,000/day (Enterprise) | $14.99–$299.99 a month | Unverified | "1,000 daily API calls for Basic plan subscribers" (third-party listing) | snippet |
| **Penguin Random House API** | Free key, activated by hand; no data licence or caching rule published | PRH group titles only (includes major SF imprints, hypothesis) | Per-query; at most 1,000 titles per request | not published | free | **Yes, predictive prefix search** | "the home of the Penguin Random House public API for title and author metadata" [PRH developer](https://developer.penguinrandomhouse.com/) | verified |
| **Ingram data services** | Retailer agreement; no public terms | All actively stocked titles | Bulk FTP feeds or a web service | — | not published | Through our own index | "entire database of actively stocked titles" [Ingram](https://www.ingramcontent.com/retailers/data-services) | verified (page); hypothesis (no public redistribution) |
| **Bowker Books In Print** | Subscription; raw-data site licences | US ISBN registry | Bulk feeds and an API | — | not published | — | "raw data site license for Books In Print" (search summary) | snippet |
| **NielsenIQ BookData** | Internal use only; no resale; no LLM training | Over 50M titles | Bulk feeds and a web service | — | not published | — | "Resale in whole or part is prohibited." (BookData Online terms PDF, linked from the [BookData page](https://nielseniq.com/global/en/landing-page/nielseniq-bookdata-metadata)) | verified |
| **Amazon Creators API** (replaced PA-API 5) | Only to advertise Amazon; caching up to 24 hours; repurposing needs written approval | Very broad | Per-query | 1 TPS, 8,640/day; needs 10 qualifying sales | free to affiliates | — | "does not have the principal purpose of advertising and marketing an Amazon Site" [policies](https://affiliate-program.amazon.com/help/operating/policies) | verified |
| **Goodreads API** | Closed to new keys since 2020 | — | — | — | — | — | "Goodreads is no longer issuing new developer keys for our public developer API" [forum notice](https://www.goodreads.com/topic/show/21788520-api-deprecation) | verified |
| **Hardcover** (GraphQL) | Claims no rights over book data. User-owned data and LLM training are excluded; aggregates need credit. Token needed; beta | Strong for popular and SF titles; crowd-sourced (hypothesis) | Per-query | 60/min, 5,000/day (free tier) | free | **Yes:** Typesense search with typo tolerance | "we make no copyright or proprietary rights over this data" [docs source](https://github.com/hardcoverapp/hardcover-docs) | verified (docs source on GitHub; the docs site returned 403) |
| **LibraryThing thingISBN** | Non-commercial use only (2006 terms; current status unconfirmed) | ISBN → other editions of the same work | Per-query, or a downloadable feed | under 1/s | free | No (ISBN only) | "thingISBN is available for non-commercial use only." [LT blog, 2006](https://blog.librarything.com/2006/06/introducing-thingisbn/) | verified (old page) |
| **OCLC WorldCat Search API v2** | Subscribing libraries only | Union catalog | Per-query | not read | subscription | — | "a FirstSearch/WorldCat Discovery subscription. Both are required." [OCLC](https://www.oclc.org/developer/api/oclc-apis/worldcat-search-api.en.html) | verified |
| **worldcat.org** (public site) | Prohibits bots and scraping, and long-term storage | Union catalog | — | — | — | — | "using bots, spiders, automated tools, or scraping/mining routines to access or extract data" [terms](https://www.oclc.org/content/dam/ext-ref/worldcat-org/terms.html) | verified |
| **Bookshop.org, Barnes & Noble** | Affiliate links only; no public API found | — | — | — | — | — | (terms pages returned 403 / 404) | snippet |

## 2. The plan's rule: kept

The evidence supports "a local index searches; live APIs verify" (REQUIREMENTS catalog row, C-3).

- **No live service matches OCR noise.** Open Library and LoC SRU match prefixes only, and Open Library's
  fuzzy operator returned nothing. ISFDB's API looks up ISBNs and IDs only. A fragment like `GIBS…
  NEUROM…` with a misread letter in the left part of a word fails on every one of them. C-3's trigram
  index over a local dump is the only path that tolerates it.
- **The rate limits rule out search at shelf scale.** A 60-spine shelf with about 5 query variants per
  spine is 300 queries. That takes 30 minutes at LoC's 10/min and about 100 s at Open Library's 3/s.
  Verification of one or two candidates per spine fits.
- **The commercial terms forbid building databases** (Google, Amazon, NielsenIQ, worldcat.org).
  Only the open sources (ISFDB, Open Library, Wikidata, BookBrainz) can be indexed locally without a
  contract.

## 3. Recommended backend

| Role | Source | When |
|---|---|---|
| Local index, SF | **ISFDB dump** (C-1, C-3) | MVP, unchanged |
| Local index, breadth | **Open Library works and editions dumps** (the preserved C-2 card, `docs/plan/README.md` § Changelog), filtered to what the shelves hold, crosswalked to ISFDB by ISBN | When the OC20 trigger below fires |
| Live verifier, keyless | **LoC SRU** (title/author/ISBN, ≤10 req/min) and **Open Library search** (≤3 req/s, identified User-Agent) | For `no-catalog-candidate` spines and to confirm a top candidate. Responses cached under `$BOOKCASE_DATA/catalog/`, never in git |
| Crosswalk (optional) | **Wikidata** (CC0), 94k items with ISFDB IDs | When ISFDB ↔ Open Library ISBN joins leave gaps |
| Closed-world candidate set at a library | **That library's own holdings**, but only through an export the library agrees to give (§4) | Library fixtures, if the owner asks and the library agrees |
| Not adopted | LoC bulk MARC (frozen at 2016, licence unclear outside the US), Google Books (no database; key needed), all commercial feeds, WorldCat | — |

Why Open Library and not LoC bulk for breadth: Open Library's dumps are current (monthly), unrestricted
(no new rights asserted), include 2025–2026 titles, and the plan has a card ready for them. LoC's free
bulk set stops at 2016, and LoC claims copyright outside the US.

Hardcover is the one source whose terms appear to allow caching book data and whose search tolerates
typos. It needs an account token (an owner decision, like any key), and its API is beta.
It is a candidate verifier for later, not part of this recommendation.

### Proposed change to OC20

OC20 as written: ISFDB only for the MVP; revisit when `no-catalog-candidate` is a large share on the
fixture (more than 15 % of resolvable labels marked `not-in-catalog`, DELIVERY-PLAN risk table).

Proposed: **ISFDB only for the MVP stands.** Backlog #4 (the Open Library import) reopens on the
**first** of:

1. the coverage run (§5) shows ISFDB covers < 85 % of readable labels on any fixture (the existing
   trigger, restated per source); or
2. **a non-SF shelf comes into scope**: a library fixture, or a store shelf outside the SF section.
   ISFDB indexes speculative fiction only, so OC32's "every spine" cannot be reached on such a shelf.

Also add **LoC SRU as the keyless live verifier** for `no-catalog-candidate` spines (backlog #4 already
names live-API verification; this names the source).

## 4. Library venues: McKinney and Frisco

| | **Frisco Public Library** | **McKinney Public Library System** |
|---|---|---|
| Catalog (OPAC) | BiblioCommons (BiblioCore) over SirsiDynix Symphony, at [friscolibrary.bibliocommons.com](https://friscolibrary.bibliocommons.com/). Verified (vendor via [librarytechnology.org](https://librarytechnology.org/library/10161); URL from the library's homepage) | Aspen Discovery over Koha (ByWater), at `ipac.mckinneytexas.org`. Verified via [librarytechnology.org](https://librarytechnology.org/library/7237) (secondary); the catalog itself was not read |
| API, export, terms | No public API, MARC download or Z39.50 found (hypothesis). The terms **forbid automated harvesting** except through RSS/XML feeds: "use any automated system to harvest or capture any BiblioCommons Content" ([terms](https://friscolibrary.bibliocommons.com/info/terms), verified). robots.txt sets `Crawl-delay: 120` ([robots](https://friscolibrary.bibliocommons.com/robots.txt), verified) | **The sites refuse AI agents.** The catalog's robots.txt disallows `Claude-User`, `ChatGPT-User`, `GPTBot` and others, and signals "Content-Signal: search=yes,ai-train=no,use=reference" ([robots](https://ipac.mckinneytexas.org/robots.txt), verified). City pages returned 403. Aspen and Koha usually offer APIs, RSS and Z39.50 (hypothesis, not probed) |
| WorldCat holdings | Not found. WorldCat's library search is JavaScript-rendered and returned nothing | Not found. Interlibrary loan runs through the Texas State Library's SHAREit, not OCLC ("partnership with the Texas State Library using the group catalog SHAREit", [ILL page](https://www.mckinneytexas.org/547/Interlibrary-Loans), snippet) |
| Classification | The service policy (§9.3) allows BISAC or Dewey Decimal classification ([policy PDF](https://friscolibrary.com/wp-content/uploads/sites/78/2026/05/Frisco-Public-Library-Service-Policy.pdf), verified). One nonfiction record shows a BISAC-style label (`SOC_SCI - - SPICE`, verified); that all nonfiction is BISAC is a hypothesis | Unknown |
| SF call number | **`F SFI <SURNAME>`.** *Neuromancer* (Ace trade paperback, 2000): "Call number: F SFI GIBSON" ([search](https://friscolibrary.bibliocommons.com/v2/search?query=neuromancer%20gibson&searchType=smart), verified in a browser). *Snow Crash* → `F SFI STEPHENSON`, *Dune* → `F SFI HERBERT` (verified through a summarising fetch; spacing not guaranteed). *Red Mars*: eBook only | Unknown |
| Label as photographed | Not seen. Whether the label stacks `F / SFI / GIBSON` on lines, and whether there is a genre sticker, are unverified | Unknown |
| Filming permission | Casual, non-disruptive personal photography in public areas is allowed (§7.9.2). Filming people requires their consent (A12.5(2)). "Outside organizations, journalists, or filmmakers must obtain prior written permission" (A12.5(6)). Commercial work needs the Director's prior written permission (§7.9.4). No tripods or gear in the aisles (A12.8). All verified, same policy PDF | Unknown. A Code of Conduct exists, enforced at the Director's discretion ([PDF](https://www.mckinneytexas.org/DocumentCenter/View/2105/2-Library-Code-of-Conduct), snippet); no photography clause was seen |
| Branches | Main library, 8000 Dallas Pkwy, plus the small "Connection" site ([locations](https://friscolibrary.bibliocommons.com/locations/), verified). Adult fiction presumably at the main library (hypothesis) | John & Judy Gay Library. The Roy & Helen Hall Library closed in June 2025 for renovation, with reopening projected for late 2026 (snippet; status on 2026-11-02 unknown) |

**Call-number labels as a recognition signal.** On Frisco's evidence, yes, and a strong one:

- the label carries the author's **full surname** in machine-printed type. That is likely easier to read
  than stylised spine lettering (hypothesis; E-3-style measurement needed);
- `F SFI` confirms the SF section, so a library SF shelf can be matched against ISFDB alone;
- libraries shelve by surname then title, so neighbouring labels bound each other's surnames. This is a
  shelf-order prior that bookstore shelves only partly have.

How the pipeline reads a label (a separate OCR region per spine, a new observation kind, or a
candidate filter in retrieval) is a **design question this card does not answer**. It goes to the
conductor for the first library-fixture card. The first library shoot should photograph a few labels
close up so the format question is answered from pixels, not from the catalog.

**Library holdings as the catalog.** A library's holdings are the exact candidate set for its shelves,
but neither catalog can be harvested: Frisco's terms forbid it and McKinney's robots.txt bars AI agents.
The only route is an export the library agrees to give. Asking is the owner's call and the owner's
action (agents contact no one).

**Permission to film.** Frisco's public policy allows casual personal photography. Photos shot for a
public open-source project and published as a dataset are closer to "outside organization" use, so the
conservative reading is **written permission from the Library Director before shooting**. Keep people
out of frame and shoot handheld. McKinney's policy could not be read; ask before shooting. Either way,
log each permission as OC32 requires (#17).

## 5. Coverage measurement (deferred: no fixture labels yet)

The card asks what share of the fixture's labelled spines each source covers. No fixture has labels yet
(`sf-store-001` is not shot; `pilot-000` is unlabelled until F-0 / O-3), so nothing was measured. This
is the method for a later card. It needs no new accounts and no API keys.

**Input.** Every readable label in a fixture (it has a title, an author or an ISBN), from
`sf-store-001`, `pilot-000` and any library fixture. Unreadable spines are excluded: they are a
perception gap, not a catalog gap.

**Per source, per label: covered or not.**

1. Normalise the label exactly as C-3 does: casefold, strip punctuation and diacritics, handle initials
   and "Surname, Given".
2. Query the source with the **clean label**, not the OCR text, so the number measures the catalog, not
   the reader:
   - **local sources** (ISFDB staging, any later Open Library subset): run `retrieve()` against that
     source's index alone;
   - **live sources** (Open Library search, LoC SRU): one query per label, title plus author, at or
     below the published rate limit. Results are cached under `$BOOKCASE_DATA/catalog/coverage/`, never
     in git.
3. **Covered** means a returned record whose normalised title matches the label's title **and** whose
   author surname matches. An exact match counts, and so does the label's title being a prefix of the
   record's title (subtitle variants). An ISBN on the label that matches a record's ISBN counts on its
   own.
4. For each label, record the source, the query, the top record ID, and the match rule that fired or
   `miss`.

**Report** (`evals/<run-id>/catalog-coverage.json` plus markdown; counts only, no titles, per OC9):

- covered / total per source;
- the union for each candidate backend: ISFDB alone; ISFDB ∪ Open Library; ISFDB ∪ Open Library ∪ LoC;
- strata:
  - store vs library fixture;
  - SF shelves vs other shelves;
  - published in the last two years vs older;
- for each miss in the best union, the reason: in no source, or in a source but the match rule failed.

**Decision rule (pre-registered).** If ISFDB alone covers < 85 % of readable labels on any fixture,
OC20's trigger fires (§3). If the best union still covers < 95 %, the remainder is reported as the
catalog-gap share of `unknown` (OC32), never forced.

## 6. Not verified

- ISFDB's dump size, update cadence and API rate limits: the wiki pages need a login.
- id.loc.gov bulk downloads, LoC CIP eligibility rules and LoC press releases: behind 403s or a bot
  challenge, which this card did not try to pass.
- Google Books partial-word matching: the keyless GET hit the quota (HTTP 429), and a key was out of
  scope.
- ISBNdb, Bowker, Bookshop.org and LibraryThing terms: pages blocked.
- McKinney: catalog, call numbers, label format, photography rules, APIs. The owner can read these in a
  normal browser: the Code of Conduct and one SF record (for example *Neuromancer*).
- Frisco: physical label layout, genre stickers, OCLC symbol.

## Ruling

*For the conductor to put to the owner; the owner's answer is recorded here.*

**Question:** Keep ISFDB-only for the MVP, and reopen the Open Library import (backlog #4, about 12 GB)
when ISFDB covers < 85 % of a fixture's readable labels or when the first non-SF or library shelf is
shot, whichever comes first, with LoC SRU as the keyless verifier: yes or no?

**Owner ruling (2026-11-02):** "Yes, ISFDB-only." OC20 stands for the MVP, with LoC SRU as the keyless verifier and the Open Library import (backlog #4) reopened on either trigger above.
