# Chat layer 006: taste tree and export (card U-3, part 2)

> **Status: design delivered 2026-11-02; awaiting the owner's ruling on its open questions.** Every number is a starting value for O-7, not a target (INV-23).
> **Provenance:** card U-3, from a Claude Design session, filed via selfco-capture as `raw/inbox/40c54a8c-53d7-8169-9106-d2ddb193ce3d.md`. Vault summary: `wiki/sources/bookcase-discovery-u2-u3-design-batch-2026-11-02.md`. Below is the spec verbatim, minus the capture envelope.
> **Visuals** sit behind private claude.ai links. The owner may share them; agents never post.

Handoff spec for card U-3 of [[BookcaseDiscovery]], experiment **006 · taste tree**. Part 01 covers 002 (agent asks, you tap) and the shared visuals table. The tree is the user-facing side of the taste model that card R-0 is researching; until R-0 lands, its vocabulary here is provisional and R-0's wins. Visuals are linked, never embedded.
## 1. Summary
**What 006 does.** A short conversation builds a branching map of what animates your reading: themes → sub-themes → example books, plus topoi, styles, patterns and open questions (OC33). Each branch says what pulls you toward it and what pushes you away, in those terms only; never "people who like what you like also like…". You can edit the tree, read it as a map where distance from the trunk is **discovery temperature**, review what it learned at the end of a visit, and export it as a file other agents can read.
**Rules that never bend**
1. **Seeds only, no invented history.** The tree starts from the three public statements in `profile/seeds.json` (all of William Gibson read, Kim Stanley Robinson liked, cooler on Neal Stephenson). Nothing from a ChatGPT export or SelfCo, ever. Seen on a shelf is not read.
2. **Every branch carries its evidence kind.** A branch the app proposes is a SYNTH **hypothesis** (dashed) until you say yes (ASSERTED, solid). DERIVED evidence (catalog subjects, ISFDB tags) can support a branch but never asserts taste.
3. **Everything 006 learns is pending.** It shapes this visit at once, then joins the saved profile only after the owner reviews each item. The profile is public.
4. **Two settings stay separate.** Identity confidence (end users see picks only at `probable` or better) is not on the tree. Discovery temperature is: the default is the middle of the curve; Sideways and Farther are orthogonal toggles.
5. **Push reasons are questions until answered.** "Cooler on Stephenson" becomes an open question with hypotheses as options, and carries no ranking weight until you answer.
**Prototype.** The canvas page "U-3 · Chat layer" has an interactive 006 board: start from the seeds or a scan, open the first branch, try "More like this, but…", switch to Map and change the temperature, then Review and Export.
## 2. Visuals
Private links; the owner may share them. The only photo (the scan opening) is the owner's shelf with no people or faces. Review items marked SIMULATED are demo input, not the owner's views.
<table header-row="true">
<tr>
<td>Screen</td>
<td>Link</td>
<td>Caption</td>
</tr>
<tr>
<td>1 · Start from the seeds</td>
<td>[#start-seeds](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#start-seeds)</td>
<td>The three public statements, three ways in, the pending promise up front</td>
</tr>
<tr>
<td>2 · Start from a scan</td>
<td>[#start-scan](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#start-scan)</td>
<td>Three Jemisin spines become one question about an existing branch</td>
</tr>
<tr>
<td>3 · Outline</td>
<td>[#outline](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#outline)</td>
<td>The seeds-only worked tree as rows; dashed = hypothesis</td>
</tr>
<tr>
<td>4 · Branch</td>
<td>[#branch](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#branch)</td>
<td>Why (hedged), pulls and pushes, seed examples, edits, "More like this, but…"</td>
</tr>
<tr>
<td>5 · Map</td>
<td>[#map](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#map)</td>
<td>Middle (default), Sideways and Farther bands on the rings</td>
</tr>
<tr>
<td>6 · Owner review</td>
<td>[#review](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#review)</td>
<td>Accept, reject or edit each pending item; nothing in bulk</td>
</tr>
<tr>
<td>7 · Export</td>
<td>[#export](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#export)</td>
<td>`taste-tree.md` preview and the never-exported list</td>
</tr>
<tr>
<td>Spec sheet</td>
<td>[#states-spec](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#states-spec)</td>
<td>006 state machine and parameters</td>
</tr>
<tr>
<td>Canvas</td>
<td>[U-3 · Chat layer](https://claude.ai/artifact/6pgjNrnbiE8N4qmnbbP4Md)</td>
<td>Prototype and boards; the Batch 020 sketch P.020.006 is on "Directions & experiments"</td>
</tr>
</table>
## 3. How the conversation starts
<table header-row="true">
<tr>
<td>Opening</td>
<td>When</td>
<td>First message (shape)</td>
</tr>
<tr>
<td>**From the seeds** (default for a first visit)</td>
<td>You open the tree</td>
<td>States the three seeds and their scope (read all works / liked, author / cooler, author), offers the three openings, says anything added is pending</td>
</tr>
<tr>
<td>**From a scan**</td>
<td>During live or after a sweep, when spines in view touch an existing branch</td>
<td>Names the spines in view and the branch they touch; asks one yes / not this / later question. The spines become examples only if you say yes, and only as "seen", never "read"</td>
</tr>
<tr>
<td>**From a question**</td>
<td>You ask, or the tree has an open question</td>
<td>One open question first, e.g. the Stephenson one, with hypotheses as tap options and a free answer</td>
</tr>
</table>
One question at a time, at most Q006_MAX_VISIT per visit and one per scan section. Questions use tap chips first; voice and typing are optional.
## 4. Worked example tree (public seeds only)
Support counts only ASSERTED seeds. Examples are books by seed authors; Robinson's titles are marked "author liked, title not rated" because the seed is author-level.
<table header-row="true">
<tr>
<td>Node</td>
<td>Kind</td>
<td>Stance</td>
<td>Ring</td>
<td>Status</td>
<td>Support</td>
<td>Examples</td>
</tr>
<tr>
<td>Near futures built from real systems</td>
<td>theme</td>
<td>pull</td>
<td>centre</td>
<td>hypothesis</td>
<td>Gibson, Robinson</td>
<td>—</td>
</tr>
<tr>
<td>↳ Networks, media and attention</td>
<td>sub-theme</td>
<td>pull</td>
<td>centre</td>
<td>hypothesis</td>
<td>Gibson</td>
<td>Pattern Recognition, Idoru (read)</td>
</tr>
<tr>
<td>↳ Climate, economics and institutions</td>
<td>sub-theme</td>
<td>pull</td>
<td>middle</td>
<td>hypothesis</td>
<td>Robinson</td>
<td>The Ministry for the Future, New York 2140 (author liked)</td>
</tr>
<tr>
<td>The city as a system</td>
<td>topos</td>
<td>pull</td>
<td>middle</td>
<td>hypothesis</td>
<td>Gibson, Robinson</td>
<td>Neuromancer (read), New York 2140 (author liked)</td>
</tr>
<tr>
<td>Mars, the frontier as a political project</td>
<td>topos</td>
<td>pull</td>
<td>middle</td>
<td>hypothesis</td>
<td>Robinson</td>
<td>Red Mars (author liked)</td>
</tr>
<tr>
<td>Implication over exposition</td>
<td>style</td>
<td>pull</td>
<td>middle</td>
<td>hypothesis, weak</td>
<td>Gibson</td>
<td>—</td>
</tr>
<tr>
<td>Ensembles and institutions over lone heroes</td>
<td>pattern</td>
<td>pull</td>
<td>middle</td>
<td>hypothesis, weak</td>
<td>Robinson</td>
<td>—</td>
</tr>
<tr>
<td>What cools Neal Stephenson for you?</td>
<td>question</td>
<td>push</td>
<td>—</td>
<td>open</td>
<td>Stephenson</td>
<td>—</td>
</tr>
</table>
**Why the Stephenson node is a question, not a claim.** Stephenson also writes near futures out of real systems, so the main theme alone predicts a like that the seed contradicts. Hypotheses offered as options: length and digression; a comic, satirical tone; technology explained in full. The counterweight is shown with them: Robinson is liked and also writes long, expository books, so length alone doesn't explain it. Until you answer, the node has no weight.
**Why "near futures" is in the centre ring:** it is the only theme two seeds support. Single-author branches sit in the middle ring and are labelled weak if they are about style or pattern, which one author can't separate from that author.
## 5. Drawing and editing the tree
**Two views of one tree.** *Outline* (default, best for VoiceOver and editing): indented rows, the trunk card with the seeds at the top, the open question last with a red edge (a human decision is needed). *Map*: concentric rings around the trunk; distance = temperature (§7). Both views edit the same nodes.
**Row anatomy:** stance block (▲ pull, ▼ push, ? open), label, then a mono meta line: KIND · SUPPORT · RING · HYPOTHESIS or YOU SAID YES. Dashed border = SYNTH hypothesis; solid = asserted.
<table header-row="true">
<tr>
<td>Edit</td>
<td>What it does</td>
<td>Evidence written</td>
<td>Shown afterwards</td>
</tr>
<tr>
<td>Yes, this is me</td>
<td>Asserts a hypothesis</td>
<td>ASSERTED `taste_asserted`</td>
<td>Solid border; YOU SAID YES</td>
</tr>
<tr>
<td>More like this, but…</td>
<td>Adds a qualifier to the branch (chips: outside SF, shorter, more hopeful, older, less technical; or free text)</td>
<td>ASSERTED `taste_qualified`</td>
<td>Qualifier under the label; used by ranking as a filter or tilt</td>
</tr>
<tr>
<td>Not this</td>
<td>Pushes the branch away (not deleted)</td>
<td>ASSERTED `taste_rejected`</td>
<td>Struck through, ▼; picks avoid it</td>
</tr>
<tr>
<td>Prune</td>
<td>Removes a hypothesis you don't care about either way</td>
<td>ASSERTED `taste_pruned`</td>
<td>Hidden; undo in review</td>
</tr>
<tr>
<td>Merge with…</td>
<td>Folds two branches into one label you choose</td>
<td>ASSERTED `taste_merged`</td>
<td>One node with both supports</td>
</tr>
<tr>
<td>Answer a question</td>
<td>Resolves an open node</td>
<td>ASSERTED `taste_answered`</td>
<td>The question becomes a push or pull branch with your words</td>
</tr>
</table>
Every edit is reversible until review, appears once in the pending list, and changes this visit's picks at once (with was / now / why on any card it moves, INV-21).
## 6. Explaining a branch without overclaiming
Each branch page has four blocks, in this order:
1. **Why this branch**: a short passage with a SYNTH badge and its support count ("SYNTH · FROM 2 SEEDS"). It opens with "A guess, not a finding" while the node is a hypothesis, names the seeds, and says what the evidence can't tell ("Two seeds can't say which books inside the branch you'd like").
2. **Pulls toward / pushes away**: only ASSERTED items, each with its badge. "Nothing stated" is a valid answer and is shown, with any tension (here: Stephenson writes near futures too).
3. **Examples from the seeds**: titles with their relation (READ, AUTHOR LIKED · TITLE NOT RATED). Never a book you haven't stated, never a shelf book unless you said yes to it.
4. **Edits** (§5).
**Language rules for SYNTH text:** "may", "a guess", "pulls" with a count; never "you love", "you always", "readers like you". No passage is longer than 60 words. Every claim names its support. Weak (single-author) branches say so in the meta line and can't on their own put a pick in the centre ring.
## 7. Temperature on the tree
- **Rings:** centre (ring 0) = branches with ≥ CENTRE_SUPPORT ASSERTED supports; middle (ring 1) = single-seed branches and qualified edges; outer (ring 2) = probe slots, empty until a scan offers something.
- **Pick band** (shaded on the map): Centre = ring 0 only; **Middle (default)** = rings 0–1, the middle of the curve; **Sideways** = an outer sector that keeps a branch's theme but changes style or form; **Farther** = an outer sector that keeps only a topos, in other genres or non-fiction.
- Sideways and Farther are orthogonal toggles, not "more random". In them, at most TEMP_OUTER_SHARE of k picks may come from the outer ring, and every such pick says how far it is ("Farther: shares *the city as a system*, outside SF").
- The map shows a caption that identity confidence is separate: picks still need `probable` or better, whatever the temperature.
- R-0 defines the distance measure; the rings are its display, with thresholds TEMP_RING_EDGES.
## 8. Pending review (end of visit)
- **When:** on leaving the tree, at the end of a live visit if anything is pending, or from the "REVIEW · N PENDING" button any time.
- **What the owner sees:** one card per item, in the order made: kind (NEW BRANCH, YOUR EDIT, RATING, ANSWER), evidence badge, the label, a one-line diff of what changes in `profile/seeds.json` ("+ theme · hypothesis · from Gibson, Robinson"), and Accept / Reject / Edit.
- **Nothing in bulk.** SYNTH items are ticked one by one; weak SYNTH items default to unticked. An "Accept all ASSERTED" shortcut is an open question (§15).
- **Accepted** items are written to `profile/seeds.json` (public) as a change the owner commits; the app never pushes. **Rejected** items stay in the visit only and are deleted when it ends. **Undecided** items are carried privately for PENDING_TTL, then offered for discard.
- Ratings from U-1 (§10 ruling 7) use the same list.
- The header says plainly: "This visit already used these. None is in your saved profile yet."
## 9. Export format
**Proposal:** one file, `taste-tree.md`, Markdown with YAML frontmatter. The frontmatter is the machine contract (agents read it); the body is a human rendering generated from it, plus a short "For agents" section. A JSON export (`taste-tree.json`) carries exactly the frontmatter object for tools that prefer it.
<table header-row="true">
<tr>
<td>Field</td>
<td>Type</td>
<td>Meaning</td>
</tr>
<tr>
<td>`schema`</td>
<td>string</td>
<td>`bookcase.taste-tree/0.1`</td>
</tr>
<tr>
<td>`sample`</td>
<td>bool</td>
<td>true only for samples</td>
</tr>
<tr>
<td>`generated`</td>
<td>date</td>
<td>export date (no time)</td>
</tr>
<tr>
<td>`subject`</td>
<td>string</td>
<td>always `owner`; never a name, handle or account</td>
</tr>
<tr>
<td>`source_profile`</td>
<td>path</td>
<td>`profile/seeds.json`</td>
</tr>
<tr>
<td>`review`</td>
<td>enum</td>
<td>`accepted-only` (the only exportable state)</td>
</tr>
<tr>
<td>`taste_basis`</td>
<td>enum</td>
<td>`themes-topoi-styles` (OC33)</td>
</tr>
<tr>
<td>`temperature`</td>
<td>object</td>
<td>`scale`, `default`, `rings`</td>
</tr>
<tr>
<td>`evidence_kinds`</td>
<td>map</td>
<td>ASSERTED, DERIVED, SYNTH with one-line meanings</td>
</tr>
<tr>
<td>`seeds[]`</td>
<td>list</td>
<td>`id`, `author`, `stance` (read / liked / cooler / not-for-me), `scope` (all-works / author / title), `evidence`</td>
</tr>
<tr>
<td>`nodes[]`</td>
<td>list</td>
<td>`id`, `kind` (theme, subtheme, topos, style, pattern, idea, question; R-0's vocabulary when it lands), `label`, `parent`, `stance` (pull / push), `ring`, `status` (hypothesis / asserted / open), `strength` (weak, optional), `support` (seed ids), `evidence`, `why` (≤ 60 words), `examples[]` \{title, author, relation\}, `qualifiers[]`, `hypotheses[]` and `counterweight` (questions only)</td>
</tr>
</table>
**Never exported:** pending, rejected or undecided items; anything from a ChatGPT export or SelfCo (the private overlay); scans (photos, crops, store or library names, places, times); identity answers from 002 and any ledger content; dev-mode scores and parameters; names, handles, account ids. Saving is a file on the device; the app never sends or posts it.
**Sample file** (public seeds only; also saved as `taste-tree.sample.md` in the chat outputs):
```markdown
---
schema: bookcase.taste-tree/0.1
sample: true                      # U-3 proposal; built from the three public seeds only
generated: 2026-11-02
generator: bookcase-discovery 006 taste tree (proposal)
subject: owner                    # a role, never a name, handle or account
source_profile: profile/seeds.json
review: accepted-only             # pending and rejected items are never exported
taste_basis: themes-topoi-styles  # OC33; no collaborative filtering
temperature:
  scale: [centre, middle, sideways, farther]
  default: middle
  rings: {0: centre, 1: middle, 2: sideways-or-farther}
evidence_kinds:
  ASSERTED: the owner said it (profile statement, tap or answer)
  DERIVED: computed from OCR or a catalog record
  SYNTH: written by a model; a hypothesis until the owner asserts it
seeds:
  - id: s-gibson
    author: William Gibson
    stance: read
    scope: all-works
    evidence: ASSERTED
  - id: s-robinson
    author: Kim Stanley Robinson
    stance: liked
    scope: author
    evidence: ASSERTED
  - id: s-stephenson
    author: Neal Stephenson
    stance: cooler
    scope: author
    evidence: ASSERTED
nodes:
  - id: n-near-futures
    kind: theme
    label: Near futures built from real systems
    parent: null
    stance: pull
    ring: 0
    status: hypothesis
    support: [s-gibson, s-robinson]
    evidence: SYNTH
    why: >-
      Both seed authors build futures out of present-day systems: networks,
      markets and media for Gibson; climate, economics and institutions for
      Robinson. A guess from two seeds, not a finding.
  - id: n-networks-attention
    kind: subtheme
    label: Networks, media and attention
    parent: n-near-futures
    stance: pull
    ring: 0
    status: hypothesis
    support: [s-gibson]
    evidence: SYNTH
    examples:
      - {title: Pattern Recognition, author: William Gibson, relation: read}
      - {title: Idoru, author: William Gibson, relation: read}
  - id: n-climate-institutions
    kind: subtheme
    label: Climate, economics and institutions
    parent: n-near-futures
    stance: pull
    ring: 1
    status: hypothesis
    support: [s-robinson]
    evidence: SYNTH
    examples:
      - {title: The Ministry for the Future, author: Kim Stanley Robinson, relation: author-liked}
      - {title: New York 2140, author: Kim Stanley Robinson, relation: author-liked}
  - id: n-city-system
    kind: topos
    label: The city as a system
    parent: null
    stance: pull
    ring: 1
    status: hypothesis
    support: [s-gibson, s-robinson]
    evidence: SYNTH
    examples:
      - {title: Neuromancer, author: William Gibson, relation: read}
      - {title: New York 2140, author: Kim Stanley Robinson, relation: author-liked}
  - id: n-mars-frontier
    kind: topos
    label: Mars, the frontier as a political project
    parent: null
    stance: pull
    ring: 1
    status: hypothesis
    support: [s-robinson]
    evidence: SYNTH
    examples:
      - {title: Red Mars, author: Kim Stanley Robinson, relation: author-liked}
  - id: n-implication
    kind: style
    label: Implication over exposition
    parent: null
    stance: pull
    ring: 1
    status: hypothesis
    strength: weak                # one seed author
    support: [s-gibson]
    evidence: SYNTH
  - id: n-ensembles
    kind: pattern
    label: Ensembles and institutions over lone heroes
    parent: null
    stance: pull
    ring: 1
    status: hypothesis
    strength: weak
    support: [s-robinson]
    evidence: SYNTH
  - id: q-stephenson
    kind: question
    label: What cools Neal Stephenson for you?
    parent: null
    stance: push
    ring: null
    status: open                  # unanswered; carries no weight in ranking
    support: [s-stephenson]
    evidence: ASSERTED
    hypotheses:                   # SYNTH; shown as options, never as facts
      - length and digression
      - comic, satirical tone
      - technology explained in full
    counterweight: >-
      Robinson is liked and also writes long, expository books, so length
      alone does not explain the cooler seed.
---

# Taste tree (sample: public seeds only)

Built from three statements in `profile/seeds.json`: all of William Gibson read,
Kim Stanley Robinson liked, cooler on Neal Stephenson. Every branch below is a
**hypothesis** (SYNTH) drawn from those seeds until the owner asserts it.

- ▲ **Near futures built from real systems** · theme · centre · Gibson, Robinson
  - ▲ Networks, media and attention · centre · Gibson
  - ▲ Climate, economics and institutions · middle · Robinson
- ▲ **The city as a system** · topos · middle · Gibson, Robinson
- ▲ **Mars, the frontier as a political project** · topos · middle · Robinson
- ▲ Implication over exposition · style · middle · weak (one author)
- ▲ Ensembles and institutions over lone heroes · pattern · middle · weak
- ? **What cools Neal Stephenson for you?** · open question · no weight yet

## For agents reading this file

- Explain any pick in these node labels (themes, topoi, styles). Never use
  "readers who liked X also liked Y".
- `status: hypothesis` nodes are guesses. Do not state them to the owner as facts.
- `stance: push` with `status: open` carries no ranking weight.
- Pick from rings at or inside `temperature.default` unless the owner asks for
  sideways or farther.
- Identity confidence (which book a spine is) is a separate setting and is not in
  this file.
```
## 10. Components
<table header-row="true">
<tr>
<td>Component</td>
<td>Purpose</td>
<td>Inputs</td>
<td>States</td>
</tr>
<tr>
<td>`TasteOpening`</td>
<td>First message and the three ways in</td>
<td>seeds, open questions, scan context</td>
<td>seeds · scan · question</td>
</tr>
<tr>
<td>`TrunkCard`</td>
<td>The seeds, read-only</td>
<td>seeds with scope and evidence</td>
<td>—</td>
</tr>
<tr>
<td>`TreeRow`</td>
<td>One node in Outline</td>
<td>node, depth, status, stance, support, ring</td>
<td>hypothesis (dashed) · asserted (solid) · rejected (struck) · open question (red edge) · weak (muted)</td>
</tr>
<tr>
<td>`BranchPage`</td>
<td>Explain and edit one node</td>
<td>node, support, examples, pending edits</td>
<td>hypothesis · asserted · rejected</td>
</tr>
<tr>
<td>`WhyPassage`</td>
<td>Hedged SYNTH explanation</td>
<td>text ≤ 60 words, support count</td>
<td>hypothesis copy · asserted copy</td>
</tr>
<tr>
<td>`QualifierChips`</td>
<td>"More like this, but…"</td>
<td>suggested qualifiers, free text</td>
<td>closed · open · chosen</td>
</tr>
<tr>
<td>`TasteMap`</td>
<td>Rings, spokes, nodes, probe slots</td>
<td>nodes with ring and angle, temperature</td>
<td>centre · middle · sideways · farther</td>
</tr>
<tr>
<td>`TempControl`</td>
<td>Discovery temperature</td>
<td>current band</td>
<td>4 segments; middle marked default</td>
</tr>
<tr>
<td>`PendingButton`</td>
<td>Count of pending items</td>
<td>count</td>
<td>none · n pending</td>
</tr>
<tr>
<td>`ReviewCard`</td>
<td>One pending item</td>
<td>kind, evidence, diff, simulated flag</td>
<td>undecided · accepted · rejected · editing</td>
</tr>
<tr>
<td>`ExportSheet`</td>
<td>Format, preview, never-exported list</td>
<td>accepted tree</td>
<td>markdown · json</td>
</tr>
</table>
## 11. Taste tree state machine (per visit)
<table header-row="true">
<tr>
<td>From</td>
<td>Event</td>
<td>To</td>
<td>Effect</td>
</tr>
<tr>
<td>CLOSED</td>
<td>open the tree, or a scan touches a branch</td>
<td>OPENING</td>
<td>first message</td>
</tr>
<tr>
<td>OPENING</td>
<td>choose seeds / scan / question</td>
<td>TALKING or BROWSING</td>
<td>—</td>
</tr>
<tr>
<td>TALKING</td>
<td>answer</td>
<td>PENDING (+1) → TALKING or BROWSING</td>
<td>ASSERTED event, session profile updated</td>
</tr>
<tr>
<td>BROWSING</td>
<td>open a node and edit</td>
<td>EDITING → PENDING (+1) → BROWSING</td>
<td>ASSERTED event; picks recompute; cards show was / now / why</td>
</tr>
<tr>
<td>BROWSING</td>
<td>the app has a question and Q006 budget remains</td>
<td>TALKING</td>
<td>—</td>
</tr>
<tr>
<td>BROWSING</td>
<td>Export</td>
<td>EXPORT</td>
<td>accepted items only</td>
</tr>
<tr>
<td>any</td>
<td>visit ends with items pending</td>
<td>REVIEW</td>
<td>review list</td>
</tr>
<tr>
<td>REVIEW</td>
<td>accept</td>
<td>COMMITTED</td>
<td>written to `profile/seeds.json`, owner commits</td>
</tr>
<tr>
<td>REVIEW</td>
<td>reject</td>
<td>DISCARDED</td>
<td>gone at visit end</td>
</tr>
<tr>
<td>REVIEW</td>
<td>skip</td>
<td>CARRIED</td>
<td>private, PENDING_TTL</td>
</tr>
</table>
## 12. Proposed parameters (starting values for O-7, all configuration)
<table header-row="true">
<tr>
<td>Name</td>
<td>Range</td>
<td>Start at</td>
<td>Reasoning</td>
</tr>
<tr>
<td>Q006_MAX_VISIT</td>
<td>2–5</td>
<td>3</td>
<td>Taste questions are slower to answer than identity ones</td>
</tr>
<tr>
<td>Q006_PER_SECTION</td>
<td>0–1</td>
<td>1</td>
<td>One scan question per shelf section at most</td>
</tr>
<tr>
<td>CENTRE_SUPPORT</td>
<td>2–3 ASSERTED supports</td>
<td>2</td>
<td>With three seeds, two is the most any branch can have today</td>
</tr>
<tr>
<td>WHY_MAX_WORDS</td>
<td>40–80</td>
<td>60</td>
<td>Short enough to read standing in an aisle</td>
</tr>
<tr>
<td>BRANCH_MAX_CHILDREN</td>
<td>3–7</td>
<td>5</td>
<td>Keeps Outline scannable one-handed</td>
</tr>
<tr>
<td>TREE_DEPTH</td>
<td>2–4</td>
<td>3</td>
<td>theme → sub-theme → examples</td>
</tr>
<tr>
<td>TEMP_OUTER_SHARE</td>
<td>1–2 of k</td>
<td>1 of 3</td>
<td>Sideways and Farther add surprise without losing the middle</td>
</tr>
<tr>
<td>TEMP_RING_EDGES</td>
<td>R-0's distance</td>
<td>centre ≤ 0.25 · middle ≤ 0.55</td>
<td>Display thresholds over R-0's measure</td>
</tr>
<tr>
<td>HYPOTHESIS_REVIEW_AFTER</td>
<td>3–5 visits</td>
<td>3</td>
<td>Unasserted hypotheses are offered for pruning</td>
</tr>
<tr>
<td>PENDING_TTL</td>
<td>30–90 days</td>
<td>60</td>
<td>Undecided items stay private, then are offered for discard</td>
</tr>
</table>
## 13. Accessibility (002 and 006)
- **VoiceOver:** 002 falls back to U-1's index rail; options are announced once with shelf positions. 006 Outline is the VoiceOver view: each row reads kind, label, status and support; the Map is announced as a list grouped by ring ("Centre: 2 branches…"). Pending count is in the Review button label.
- **Reduce Motion:** no plate pulse, no sheet slide, no map zoom; ring changes cross-fade.
- **One-handed reach:** answers, edits, temperature and Review/Export sit in the bottom half; the only top-half controls are back and the Outline/Map switch, which have swipe equivalents.
- **Colour-blind reading:** stance by glyph (▲ ▼ ?), status by border style (dashed / solid / struck), evidence by the word in the badge, decisions by the words YOUR CALL and the red edge plus its text.
- **Type:** rows grow to two lines at accessibility sizes; Map switches to Outline above the largest standard size.
## 14. Acceptance checks
**Sources and privacy**
1. With an empty private overlay and no SelfCo adapter, the tree builds; with a ChatGPT-derived entry present, no node, support or example comes from it.
2. Every node's `support` contains only seed ids from `profile/seeds.json` or ASSERTED events from this owner.
3. A spine seen in a scan never becomes a `read` example; it becomes an example only after a yes, with relation `seen`.
4. The export sample contains only the three public seeds and nodes derived from them.
**Evidence and overclaiming**
1. A node created by the app has status `hypothesis` and evidence SYNTH until a `taste_asserted` event.
2. No WhyPassage exceeds WHY_MAX_WORDS, and each names its support.
3. No SYNTH text contains "you love", "you always", or any comparison with other readers.
4. A node with one supporting author is never in the centre ring.
5. An open question carries zero ranking weight.
**Edits, pending and review**
1. Every edit writes exactly one ASSERTED event and one pending item.
2. A pending item changes this visit's picks at once; a moved card shows was / now / why with Undo.
3. Nothing reaches `profile/seeds.json` without an Accept on that item; no bulk accept exists for SYNTH items.
4. Rejected items are absent after the visit ends; undecided items persist privately and expire after PENDING_TTL.
5. Pending items never appear in an export.
**Temperature**
1. At the default (middle) every pick comes from rings 0–1.
2. With Sideways or Farther on, at most TEMP_OUTER_SHARE of k picks come from the outer ring, and each says which branch it shares and how far it is.
3. Changing temperature never changes identity confidence; no pick below `probable` appears to an end user at any temperature.
4. No ranking feature, explanation or export field uses co-reader or co-purchase data.
**Export**
1. The export validates against `bookcase.taste-tree/0.1`; `subject` is `owner`; no names, handles, places, times or ids.
2. The body is generated from the frontmatter; a round trip (frontmatter → body) reproduces the file.
3. Saving never sends the file anywhere; sharing is the owner's own action outside the app.
**Accessibility**
1. Every Map node is reachable in Outline with the same label and status.
2. With VoiceOver on, the tree opens in Outline and the Review button announces the pending count.
## 15. Open questions for the owner
1. **R-0 vocabulary:** adopt these node kinds now (theme, subtheme, topos, style, pattern, idea, question), or wait for R-0?
2. **Accept all ASSERTED:** allow a one-tap accept for your own edits and answers, keeping SYNTH one by one?
3. **Where pending lives:** in `$BOOKCASE_DATA/private/` beside the overlay, and is 60 days right?
4. **Public tree:** should accepted hypotheses go into the public `profile/seeds.json`, or only asserted nodes, with hypotheses kept private?
5. **Export default:** Markdown with frontmatter, JSON, or both? Should the export ever include hypotheses, or only asserted nodes?
6. **Scan opening:** is "seen on a shelf → yes → example (seen)" welcome, or should scans only ever ask, never add examples?
7. **Stephenson question:** happy to have it asked on the first visit, or wait until a Stephenson spine is in view?
8. **Farther:** may Farther reach non-fiction and other media, or stay within fiction?
## Sources
No external sources: a synthesis of this conversation, the U-3 brief (`~/selfco/prompts/bookcase-discovery-chat-layer-ux-handoff.md`), the [[BookcaseDiscovery]] plan (`REQUIREMENTS.md` OC9, OC33, INV-21; `DELIVERY-PLAN.md` U-3, R-0, R-3, T-4; `docs/live/overlay-ux.md` §10), and the public reading profile (three owner statements). Book titles are works by the seed authors, used as examples of the seeds, not as reading history beyond what the seeds state.
Series: bookcase-discovery-u3-chat-layer-ux · Part 02 of 2 · Previous: [[bookcase-discovery-u3-chat-layer-ux — Part 01: 002 agent asks, you tap]] · Next: [[none]]
— end of part 02 —

---
## 16. Owner rulings (2026-11-02, key questions)
4. **Public tree:** only nodes the user **stated** (ASSERTED) go into the public `profile/seeds.json`. Accepted SYNTH hypotheses stay private in `$BOOKCASE_DATA/private/`, and still shape the user's own picks.

The remaining questions (1–3, 5–8) take the spec's proposals as starting values until the owner rules; question 1, the vocabulary, waits for R-0.
