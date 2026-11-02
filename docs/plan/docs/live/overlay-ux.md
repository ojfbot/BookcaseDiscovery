# Live overlay UX (card U-1)

> **Status: design delivered 2026-11-02; awaiting the owner's ruling on §9.** Until the owner rules, the build cards (T-5, T-7a) treat every number here as a starting value, not a target (INV-23). O-7 sets the targets.
> **Provenance:** a Claude Design session, filed via selfco-capture as `raw/inbox/40c54a8c-53d7-81a4-9e54-ea4d1855e4d7.md` (it supersedes Parts 01 and 02). Vault summary: `wiki/sources/bookcase-discovery-u1-overlay-ux-2026-11-02.md`. Below is the spec verbatim, minus the capture envelope.
> **Visuals** stay behind private claude.ai links (§2). Per the spec they use the owner's shelf photos. Do not copy them into this public repo (OC9, G-PUB).

BookcaseDiscovery U-1 — live overlay UX, build handoff for coding agents (Claude Code, Codex GPT). Two parts: the visuals stay as real files behind the private links in §2; this text carries everything a coder needs. Every number is a proposal for the owner to set at O-7, not a measurement (INV-23). Plan refs: REQUIREMENTS OC30, INV-20, INV-21, INV-24; DELIVERY-PLAN U-1, T-2, T-4, T-5, T-7a, V-5, O-7.
## 1. Summary
**Recommended direction: A, "Slabs".**
1. Every tracked spine is drawn as an oriented box (centre, length, thickness, angle), the shape the YOLO-OBB detector emits; most get only a faint hairline.
2. At most k spines per view are *highlighted*: a level paper "slab" label floats beside the spine's head point with a rank numeral, title, author surname and evidence band, joined by a short leader line.
3. A lens toggle (Recommended · Read · All) decides what the highlight means; Recommended is the default with k = 3.
4. Nothing on screen changes unless the new answer beats the shown one by a margin, held for a dwell time; card order changes in batches; every card revision shows was / now / why with Undo.
5. Alternatives, evidence and actions (save, closer look, "it's this") sit behind a tap; the glass stays calm.
**Alternatives set aside (kept as a menu, not deleted):**
<table header-row="true">
<tr>
<td>Direction</td>
<td>Idea</td>
<td>Why not the default</td>
</tr>
<tr>
<td>B · Index rail</td>
<td>Glass shows only numeral pins; names live in a ranked list at the bottom</td>
<td>Calmest glass and best for VoiceOver, but the eye travels between glass and rail, and numerals alone don't say *what* the book is. **Kept as the VoiceOver / large-text fallback.**</td>
</tr>
<tr>
<td>C · Reticle</td>
<td>A vertical line in the centre; only spines under it get labels; other picks get diamond ticks</td>
<td>Fewest labels ever, but surveying a shelf is slow and it fights one-handed use (aim and tap at once).</td>
</tr>
<tr>
<td>Batch 020 chat experiments</td>
<td>Ask the shelf by text/voice; the agent asks back by lettering spines A/B/C; shelf-anchored scrollback; hold-to-confirm scaled to reversibility; visible "thinking rail"; conversational taste tree that exports a skill file</td>
<td>Promising layers *on top of* A, not replacements. 002 (clarify-by-tap) and 006 (taste tree) are the strongest candidates for a later batch.</td>
</tr>
</table>
Why A: it is the only direction that answers "which book, and what is it" on the glass in one glance, and a small k keeps it calm.
---
## 2. Visuals: screens and states
The real mockups stay as files. Two private, durable links hold them; neither is embedded here.
- **Exported screens (stable anchors):** [U-1 Overlay Visuals](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ) — PNG exports of every state below, one anchored section each.
- **Source canvas (live, interactive):** [BookcaseDiscovery — Live overlay (U-1)](https://claude.ai/artifact/6pgjNrnbiE8N4qmnbbP4Md) — pages "Product — what a shopper sees" (clickable shopper prototype), "Directions & experiments", "Spec & studio".
Both are private to the owner's account. They contain the owner's own shelf photos, used for mockups only (not a G-PUB release). Book picks, reasons and evidence bands in them are simulated.
<table header-row="true">
<tr>
<td>State</td>
<td>Link</td>
<td>Caption</td>
</tr>
<tr>
<td>Idle</td>
<td>[#idle](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#idle)</td>
<td>Camera open; status chip "LOOKING FOR SPINES"; framing guide; nothing drawn on spines.</td>
</tr>
<tr>
<td>First labels</td>
<td>[#first-labels](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#first-labels)</td>
<td>Tracks stable; hairline boxes fade in spine by spine; no text until the first-label dwell.</td>
</tr>
<tr>
<td>Top-k · Recommended (default, k = 3)</td>
<td>[#topk-recommended](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#topk-recommended)</td>
<td>Three numbered slabs with leaders; numerals match the cards; one red closer-look tag.</td>
</tr>
<tr>
<td>Top-k · Read (k = 5)</td>
<td>[#topk-read](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#topk-read)</td>
<td>No read books in view, so the empty-state chip and zero slabs: k is a ceiling, not a quota.</td>
</tr>
<tr>
<td>All (k = 0, cap 20)</td>
<td>[#topk-all](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#topk-all)</td>
<td>Vertical chips on every named spine; box stroke = band. Mock shows 40 to expose density; build caps at 20.</td>
</tr>
<tr>
<td>Tap to see alternatives</td>
<td>[#tap-alternatives](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#tap-alternatives)</td>
<td>Detail sheet: best match, band, why, "Or is it…?" alternative, Save, Closer look; spec board adds evidence badges.</td>
</tr>
<tr>
<td>Closer look</td>
<td>[#closer-look](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#closer-look)</td>
<td>Hold-still border and progress bar, then the sheet returns "CONFIRMED BY CLOSER LOOK".</td>
</tr>
<tr>
<td>Card revised (was / now / why + undo)</td>
<td>[#card-revised](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#card-revised)</td>
<td>Slab meta briefly reads REVISED; card shows struck-through WAS, WHY, Undo; spec board adds MOVED 1 → 2 and the updates-waiting strip.</td>
</tr>
<tr>
<td>Spine lost, then recovered</td>
<td>[#lost-recovered](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#lost-recovered)</td>
<td>Highlighted → grace (slab held at 45 %, dashed) → re-acquired within the window, restored at once.</td>
</tr>
<tr>
<td>New section: best guesses</td>
<td>[#new-section](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#new-section)</td>
<td>Film Reference: dashed STRETCH slabs on oriented boxes that follow leaning and face-out books.</td>
</tr>
<tr>
<td>States and parameters sheet</td>
<td>[#states-spec](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#states-spec)</td>
<td>Label states, bands, lenses and k, anti-jitter table as drawn.</td>
</tr>
<tr>
<td>Books that are not square</td>
<td>[#geometry-spec](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ#geometry-spec)</td>
<td>Oriented boxes, head points, level text, cover class, stack grouping, keystone.</td>
</tr>
</table>
Known gaps in the visuals (fix in build, not in the spec):
- In the shopper prototype the camera layer stops short of the bottom panel, leaving a dark band above the tab bar.
- The film-aisle slabs in the prototype open the old tap board instead of the prototype's own sheet.
- The lost/recovered board is a three-frame still; the motion itself is specified in §4 and §6.
---
## 3. Components
<table header-row="true">
<tr>
<td>Component</td>
<td>Purpose</td>
<td>Inputs</td>
<td>States</td>
</tr>
<tr>
<td>`CameraLayer`</td>
<td>Live frame plus one transform shared by every overlay, so overlays ride the frame</td>
<td>frame, viewport transform, reduceMotion</td>
<td>live · held (frozen for tap / closer look) · paused (closer look still)</td>
</tr>
<tr>
<td>`StatusChip`</td>
<td>One-line state of the scan, top-left</td>
<td>phase, spine count, picks count, section</td>
<td>looking (amber) · reading (amber) · ready (green) · new-section (amber) · held</td>
</tr>
<tr>
<td>`SpineBox`</td>
<td>Draw one tracked spine as an oriented box</td>
<td>trackId, obb \{cx, cy, length, thickness, angle\}, band, isHighlighted, isCover, opacity</td>
<td>hidden · box (hairline) · labelled (band stroke) · highlighted (stroke + ink ring) · grace (dashed, 45 %) · flagged (red) · grouped (stack bracket)</td>
</tr>
<tr>
<td>`HeadPoint`</td>
<td>Small paper square at the edge midpoint highest on screen</td>
<td>obb</td>
<td>shown only with a slab or flag</td>
</tr>
<tr>
<td>`Slab`</td>
<td>Level label for a highlighted spine</td>
<td>rank or "R" or "\~n", title, surname, band, taste (fit/stretch), revisedFlash</td>
<td>entering · shown · revised (meta = "REVISED · …" \~3 s) · grace · leaving</td>
</tr>
<tr>
<td>`Leader`</td>
<td>2 pt line from slab to head point</td>
<td>slab rect, head point</td>
<td>shown · grace</td>
</tr>
<tr>
<td>`SpineChip`</td>
<td>Vertical mono label along a spine (All lens)</td>
<td>title, obb, band</td>
<td>shown · capped (not drawn)</td>
</tr>
<tr>
<td>`CloserLookTag`</td>
<td>Red tag at a spine foot asking for a still</td>
<td>trackId, obb</td>
<td>shown · dismissed · in-progress</td>
</tr>
<tr>
<td>`StackBracket`</td>
<td>One dashed bracket for ≥3 thin same-angle spines</td>
<td>member trackIds, union obb</td>
<td>grouped · split (on tap or approach)</td>
</tr>
<tr>
<td>`LensToggle`</td>
<td>Segmented control: Recommended · Read · All</td>
<td>active lens, counts</td>
<td>per-segment pressed / unpressed</td>
</tr>
<tr>
<td>`CloserLookButton`</td>
<td>Bottom-right action with red count</td>
<td>flagged count (0–2)</td>
<td>idle · counting · disabled (budget paused)</td>
</tr>
<tr>
<td>`CardPeek`</td>
<td>One-row preview of pick #1 above the toolbar</td>
<td>top card, pendingUpdates, revised</td>
<td>hidden · shown · revised badge</td>
</tr>
<tr>
<td>`CardList` ("For you")</td>
<td>Full ranked list with revisions</td>
<td>cards\[\], pending batch</td>
<td>settled · updates-waiting (dashed strip)</td>
</tr>
<tr>
<td>`Card`</td>
<td>One recommendation</td>
<td>rank, title, author, band, taste fit, reason, revision?, saved</td>
<td>normal · revised (was/now/why/undo) · moved (n → m, undo) · stretch (dashed, outlined numeral, rate buttons) · saved</td>
</tr>
<tr>
<td>`UpdatesStrip`</td>
<td>Pending batched changes + Apply now</td>
<td>count, description, secondsLeft</td>
<td>hidden · waiting</td>
</tr>
<tr>
<td>`DetailSheet`</td>
<td>Tap result: best match, why, alternatives, actions</td>
<td>trackId, identity, band, evidence lines, alternatives\[\], saved</td>
<td>open · confirmed-by-closer-look</td>
</tr>
<tr>
<td>`NeighbourPicker`</td>
<td>Disambiguate a tap among 2–3 close spines</td>
<td>candidate tracks</td>
<td>open</td>
</tr>
<tr>
<td>`EvidenceBadge`</td>
<td>Provenance of a reason line</td>
<td>kind: DERIVED · SYNTH · ASSERTED</td>
<td>—</td>
</tr>
<tr>
<td>`BandBadge`</td>
<td>Identity confidence in text + glyph + stroke</td>
<td>band</td>
<td>verified · probable · candidate · unknown</td>
</tr>
<tr>
<td>`CloserLookOverlay`</td>
<td>Flash, border, hold-still progress</td>
<td>progress 0–1, label</td>
<td>capturing · done · failed</td>
</tr>
<tr>
<td>`SectionBanner`</td>
<td>Entering a section with no taste signal</td>
<td>section name</td>
<td>shown \~3 s · hidden</td>
</tr>
<tr>
<td>`MyList`</td>
<td>Saved books with the shelf they were on</td>
<td>saved\[\] \{title, where\}</td>
<td>empty · populated</td>
</tr>
<tr>
<td>`TabBar`</td>
<td>Scan · For you · My list</td>
<td>counts, current</td>
<td>per tab current / not</td>
</tr>
</table>
---
## 4. Per-spine overlay state machine
States: **HIDDEN → BOX → LABEL → HIGHLIGHTED**, plus **GRACE** and **GONE**. LABEL is "identity committed"; whether the label is *drawn* depends on the lens (All draws chips; Recommended/Read draw only highlighted slabs).
Inside LABEL and HIGHLIGHTED, the **identity** itself changes only when: challenger score ≥ shown score + ID_MARGIN, challenger band ≥ shown band, held for ID_DWELL, **and** at least one supporting reading comes from a new condition (viewpoint or exposure bucket, INV-20). Band upgrades for the same identity apply on the next new-condition reading; band downgrades wait BAND_DOWN_DWELL.
Side states:
- **FLAGGED** (closer look): orthogonal flag on at most CLOSER_K spines in any lens; set when a still has the highest expected value for changing the top k; cleared when a still resolves it.
- **HELD**: while a detail sheet or closer look is open, every state machine freezes (no transitions drawn; ledger keeps recording).
- **GROUPED**: ≥3 boxes at the same angle (±4°), each under 8 pt thick, render as one StackBracket until tapped or until thickness on screen exceeds 8 pt.
Transitions and their triggers:
<table header-row="true">
<tr>
<td>From → To</td>
<td>Trigger</td>
</tr>
<tr>
<td>HIDDEN → BOX</td>
<td>track stable (≥3 consecutive frames)</td>
</tr>
<tr>
<td>BOX → LABEL</td>
<td>identity ≥ candidate held FIRST_LABEL_DWELL</td>
</tr>
<tr>
<td>LABEL → HIGHLIGHTED</td>
<td>in top k for the active lens by TOPK_MARGIN for TOPK_DWELL, swap limiter permits</td>
</tr>
<tr>
<td>HIGHLIGHTED → LABEL</td>
<td>out of top k by TOPK_MARGIN for TOPK_DWELL, or lens switched, or limiter hands the slot to a stronger track</td>
</tr>
<tr>
<td>any → GRACE</td>
<td>detection lost</td>
</tr>
<tr>
<td>GRACE → previous</td>
<td>re-detected within GRACE_MS</td>
</tr>
<tr>
<td>GRACE → GONE</td>
<td>GRACE_MS elapsed</td>
</tr>
<tr>
<td>GONE → previous</td>
<td>same identity re-acquired within REACQUIRE_WINDOW</td>
</tr>
<tr>
<td>LABEL → BOX</td>
<td>identity demoted to unknown for BAND_DOWN_DWELL</td>
</tr>
</table>
---
## 5. Filter modes (lenses) and k
Settled by the owner: **top-k means k highlighted spines per view.** Alternatives always sit behind a tap, never on glass. k is a ceiling, never a quota.
<table header-row="true">
<tr>
<td>Lens</td>
<td>The highlight means</td>
<td>k (start)</td>
<td>Range for O-7</td>
<td>Notes</td>
</tr>
<tr>
<td>**Recommended** (default)</td>
<td>Ranked against the reading profile; numerals 1…k match card order</td>
<td>**3**</td>
<td>3–5</td>
<td>Highlights require band ≥ probable; candidate-band picks are off by default</td>
</tr>
<tr>
<td>**Read**</td>
<td>Books already known, so you can skip them</td>
<td>**5**</td>
<td>3–8</td>
<td>"R" block replaces the numeral; empty state chip when none in view</td>
</tr>
<tr>
<td>**All**</td>
<td>No highlight; every named spine gets a vertical chip</td>
<td>**0** (label cap **20**)</td>
<td>cap 12–30</td>
<td>Chips nearest frame centre first</td>
</tr>
<tr>
<td>*Closer look* (prompt, **not a lens**)</td>
<td>A still here would most change your list</td>
<td>**1**</td>
<td>0–2</td>
<td>Red tag in any lens + count on the button. Departure from OC30's starting set; owner to rule (§9)</td>
</tr>
<tr>
<td>*Stretch* (Recommended in a new section)</td>
<td>Best guesses where the profile has no signal</td>
<td>**3**</td>
<td>2–3</td>
<td>Verified identities only; outlined numeral "\~n", dashed slab; any real fit outranks every stretch</td>
</tr>
</table>
Reading profile used in examples (public): all of William Gibson read; Kim Stanley Robinson liked; cooler on Neal Stephenson.
---
## 6. Anti-jitter parameters (proposed ranges)
Scores are the fused identity score (0–1) and the ranking score, both defined in T-4. "Condition" = INV-20 viewpoint or exposure bucket. Make every value configuration, not a constant.
<table header-row="true">
<tr>
<td>Name</td>
<td>Proposed range</td>
<td>Start at</td>
<td>Reasoning</td>
</tr>
<tr>
<td>FIRST_LABEL_DWELL</td>
<td>300–600 ms</td>
<td>400 ms</td>
<td>Long enough that a spine glimpsed while sweeping never gets text; short enough to sit inside the plan's 300 ms–1 s first-label proposal.</td>
</tr>
<tr>
<td>ID_MARGIN</td>
<td>+0.15 to +0.30</td>
<td>+0.20</td>
<td>Same-author neighbours (book 1 / book 2 of a series) produce near-tie scores; below \~0.15 they would trade labels on every frame. Above 0.30, genuine corrections arrive too late to feel live.</td>
</tr>
<tr>
<td>ID_DWELL</td>
<td>0.8–1.5 s **and** ≥1 new-condition read</td>
<td>1.0 s + 1</td>
<td>Consecutive frames are correlated evidence (INV-20); time alone would let one bad angle win by persistence. Requiring a new angle or exposure makes the commit mean something. \~1 s is under the threshold where a correction feels "late".</td>
</tr>
<tr>
<td>BAND_UP / BAND_DOWN_DWELL</td>
<td>up: next new-condition read · down: 1–2 s</td>
<td>up 0 · down 1.5 s</td>
<td>Asymmetric: an upgrade changes only the stroke and glyph and can't mislead; a downgrade may be noise, so it waits.</td>
</tr>
<tr>
<td>TOPK_MARGIN (enter and exit)</td>
<td>0.08–0.20 of rank score</td>
<td>0.10</td>
<td>Schmitt trigger around the k-th slot so two near-equal picks don't swap highlights back and forth.</td>
</tr>
<tr>
<td>TOPK_DWELL</td>
<td>1.0–2.5 s</td>
<td>1.5 s</td>
<td>A highlight moving is the most visible change on glass; it should lag behind the evidence on purpose.</td>
</tr>
<tr>
<td>SWAP_LIMIT</td>
<td>1 per 2–5 s per view</td>
<td>1 per 3 s</td>
<td>Even when several qualify, the eye can track one change at a time.</td>
</tr>
<tr>
<td>GRACE_MS</td>
<td>500–1000 ms, then 200 ms fade</td>
<td>700 ms</td>
<td>Covers a hand or another shopper passing; longer and stale labels linger after the phone has moved on. Check against Apple HIG guidance in T-5.</td>
</tr>
<tr>
<td>REACQUIRE_WINDOW</td>
<td>3–6 s</td>
<td>4 s</td>
<td>Panning away and back to the same shelf should restore labels instantly.</td>
</tr>
<tr>
<td>CARD_BATCH_INTERVAL</td>
<td>4–8 s</td>
<td>6 s</td>
<td>Cards are read, not glanced at; reordering under a reading eye is the worst kind of jitter. 6 s ≈ the time to read two cards. Never reorder while a finger is on the panel.</td>
</tr>
<tr>
<td>EARLY_APPLY_ON_PAUSE</td>
<td>camera still 0.8–1.5 s</td>
<td>1.0 s</td>
<td>When the user stops moving they are ready to read; flush waiting changes then.</td>
</tr>
<tr>
<td>ANGLE_DEADBAND</td>
<td>2–5°</td>
<td>3°</td>
<td>Resting books must not wobble; angle has its own One Euro filter plus this deadband.</td>
</tr>
<tr>
<td>ANCHOR_SMOOTHING</td>
<td>One Euro filter, tuned on V-5 clips</td>
<td>target jitter ≤ 2 pt p95, phone held still (hypothesis)</td>
<td>Labels follow the spine head in screen space; this is tracking, not decoration, so it stays on under Reduce Motion.</td>
</tr>
<tr>
<td>REVISION_BADGE_TTL</td>
<td>15–60 s, or until panel next closes</td>
<td>30 s</td>
<td>Long enough to notice, short enough not to become wallpaper.</td>
</tr>
</table>
V-5 should report against these: label change rate per spine-minute, anchor jitter (p50/p95), highlight swaps per minute, card revisions per session, share of revisions undone (a high undo share means margins are too loose), time to first useful card.
---
## 7. Visual tokens
Design language: the owner's "cockpit" system (OJF Editorial). Paper and ink, Helvetica Neue 800 display, JetBrains Mono labels, zero corner radius, 3 px ink rules under section heads. **Red has one job: a human decision is needed.** Selection is an ink stroke, never red. Filtering dims, never removes.
### 7.1 Colour roles (light theme; dark theme mirrors cockpit tokens)
<table header-row="true">
<tr>
<td>Token</td>
<td>Hex</td>
<td>Role in the overlay</td>
</tr>
<tr>
<td>`--paper`</td>
<td>#f2efe7</td>
<td>Sheet and panel ground</td>
</tr>
<tr>
<td>`--card`</td>
<td>#fcfbf6</td>
<td>Slab and card fill; highlight stroke on glass</td>
</tr>
<tr>
<td>`--ink`</td>
<td>#17140f</td>
<td>Text, numeral blocks, ink ring around paper strokes</td>
</tr>
<tr>
<td>`--ink-2`</td>
<td>#574f44</td>
<td>Secondary text, mono meta lines</td>
</tr>
<tr>
<td>`--ink-3`</td>
<td>#7d7466</td>
<td>Tertiary labels (passes 4.5:1 on paper)</td>
</tr>
<tr>
<td>`--rule`</td>
<td>rgba(23,20,15,.16)</td>
<td>Row dividers</td>
</tr>
<tr>
<td>`--decision`</td>
<td>#e2231a</td>
<td>Closer-look tag edge; nothing else</td>
</tr>
<tr>
<td>`--decision-ink`</td>
<td>#b81a12</td>
<td>Ground behind white text in the closer-look tag/count</td>
</tr>
<tr>
<td>`--live`</td>
<td>#2f7d5b (dark #52b083)</td>
<td>Status dot when ready; "confirmed by closer look" badge</td>
</tr>
<tr>
<td>`--warn`</td>
<td>#a8730f (dark #e0a53a)</td>
<td>Status dot while reading; "no signal in this section"</td>
</tr>
<tr>
<td>`--ev-derived`</td>
<td>#2f6b86</td>
<td>DERIVED badge (OCR, catalog)</td>
</tr>
<tr>
<td>`--ev-asserted`</td>
<td>#8a5a0b</td>
<td>ASSERTED badge (profile, user feedback)</td>
</tr>
<tr>
<td>`--ev-synth`</td>
<td>#6b5a8e</td>
<td>SYNTH badge (LLM adjudicator, bridge text)</td>
</tr>
<tr>
<td>hairline</td>
<td>rgba(252,251,246,.24–.38)</td>
<td>Box-only spines on glass</td>
</tr>
<tr>
<td>scrim</td>
<td>rgba(16,14,8,.45–.72)</td>
<td>Behind sheets / tap focus</td>
</tr>
</table>
On glass, every paper element carries a 1 px ink ring or 2 px ink drop shadow so it reads on light and dark spines alike.
### 7.2 Non-colour channels (colour-blind reading)
- **Band:** stroke style (solid · dashed · dotted · hairline) + glyph (◼ filled · ◧ half · ◻ empty · ?) + the word in the slab meta line.
- **Lens:** labelled segmented control + numeral block shape (filled numeral · "R" · none).
- **Taste fit:** fit = solid slab, filled numeral; stretch = dashed slab, outlined numeral, word STRETCH.
- **Closer look:** red **plus** heavier 2 pt edge **plus** the text CLOSER LOOK.
- **Revision:** the word REVISED / MOVED n → m, and struck-through WAS text.
### 7.3 Type
<table header-row="true">
<tr>
<td>Use</td>
<td>Face</td>
<td>Size / weight</td>
</tr>
<tr>
<td>Sheet/screen titles</td>
<td>Helvetica Neue</td>
<td>26–34 pt, 800, −0.03 to −0.045 em, uppercase for screen titles</td>
</tr>
<tr>
<td>Card title</td>
<td>Helvetica Neue</td>
<td>15–17 pt, 800</td>
</tr>
<tr>
<td>Slab title</td>
<td>Helvetica Neue</td>
<td>11.5–12.5 pt, 700, single line, ellipsis</td>
</tr>
<tr>
<td>Body / reasons</td>
<td>Helvetica Neue</td>
<td>12.5–14 pt, 500, line-height 1.4</td>
</tr>
<tr>
<td>Mono labels, meta, buttons</td>
<td>JetBrains Mono</td>
<td>7.5–10 pt, 600–700, uppercase, letter-spacing .06–.14 em</td>
</tr>
<tr>
<td>Spine chip (All lens)</td>
<td>JetBrains Mono</td>
<td>8 pt, 600</td>
</tr>
</table>
Minimum on-glass text: 7.5 pt mono meta, 11.5 pt titles. Dynamic Type at accessibility sizes switches the glass to Direction B (numeral pins + rail).
### 7.4 Motion
<table header-row="true">
<tr>
<td>Event</td>
<td>Default</td>
<td>Reduce Motion</td>
</tr>
<tr>
<td>Hairline appears</td>
<td>200 ms fade, staggered \~70 ms</td>
<td>instant</td>
</tr>
<tr>
<td>Slab enters</td>
<td>220 ms scale .9→1 + fade, cubic-bezier(0,0,.3,1), staggered 250 ms</td>
<td>instant</td>
</tr>
<tr>
<td>Slab leaves / grace end</td>
<td>200 ms fade</td>
<td>instant at end of grace</td>
</tr>
<tr>
<td>Revision on glass</td>
<td>meta line text swap, no movement</td>
<td>same</td>
</tr>
<tr>
<td>Card reorder</td>
<td>none (MOVED badge carries it)</td>
<td>none</td>
</tr>
<tr>
<td>Sheet open</td>
<td>240 ms rise 16 pt</td>
<td>instant</td>
</tr>
<tr>
<td>Closer-look flash</td>
<td>500 ms white fade</td>
<td>no flash; border only</td>
</tr>
<tr>
<td>Anchor following</td>
<td>One Euro smoothing (always on)</td>
<td>one step heavier smoothing</td>
</tr>
<tr>
<td>Highlight swap limit</td>
<td>1 per 3 s</td>
<td>1 per 5 s</td>
</tr>
</table>
### 7.5 One-handed reach zones (iPhone portrait)
<table header-row="true">
<tr>
<td>Zone</td>
<td>Height</td>
<td>What lives there</td>
<td>Rule</td>
</tr>
<tr>
<td>Top</td>
<td>0–60 pt</td>
<td>Status chip, optional replay</td>
<td>Nothing the user must press</td>
</tr>
<tr>
<td>Middle (glass)</td>
<td>camera area</td>
<td>Boxes, slabs, chips, closer-look tag</td>
<td>Taps are optional; every glass action also exists below</td>
</tr>
<tr>
<td>Bottom</td>
<td>last \~200 pt</td>
<td>Card peek, lens toggle (left), CLOSER LOOK (right-thumb corner), tab bar</td>
<td>Everything essential; mirror left/right for a left-handed setting</td>
</tr>
</table>
All targets ≥ 44 pt. Thin spines (8–16 pt) use a 22 pt nearest-centre hit radius, computed in each box's rotated frame.
---
## 8. Acceptance checks
Each line is phrased to become a test. "Frame stream" = replayed recorded or synthetic detections.
**Anti-jitter**
1. A match that flips back and forth below ID_MARGIN never changes the label on screen.
2. A challenger that beats the shown identity by ≥ ID_MARGIN but only from same-condition frames never commits, however long it holds.
3. A challenger with ≥ ID_MARGIN, ID_DWELL and one new-condition reading commits exactly once.
4. A band upgrade for the same identity changes only stroke/glyph/word; the title text does not re-render.
5. Two picks whose rank scores alternate within TOPK_MARGIN never swap highlights.
6. No more than one highlight changes within any SWAP_LIMIT window.
7. No text appears on a spine before FIRST_LABEL_DWELL after it becomes stable.
**Lens and k**
8. The number of highlighted spines never exceeds k for the active lens.
9. With fewer qualifying spines than k, only those are highlighted (no padding).
10. Read lens with zero read books in view shows the empty-state chip and zero slabs.
11. All lens draws at most LABEL_CAP chips, choosing those nearest frame centre.
12. Switching lens re-evaluates highlights immediately and does not touch card order.
13. In a section with no profile signal, Recommended shows ≤ 3 stretch slabs, all verified-band; if any fit pick appears, stretches leave the glass.
**Lost and recovered**
14. A slab persists for GRACE_MS after its detection drops, at reduced opacity with a dashed edge.
15. A track re-acquired within GRACE_MS restores its state with no new dwell.
16. A track re-identified within REACQUIRE_WINDOW after GONE restores its previous state; after the window it starts from HIDDEN.
**Cards and revisions**
17. Card order never changes while a pointer/finger is down on the card panel.
18. Pending card changes apply at CARD_BATCH_INTERVAL or after EARLY_APPLY_ON_PAUSE of camera stillness, whichever comes first.
19. Every identity or rank change to a card shows WAS, NOW and WHY, and emits a `card_revised` event with previous, reason_event_ids and diff.
20. Undo restores the previous card state, pins its order for the session, and emits `card_revision_undone`; the original revision stays in the ledger.
21. A user correction (IT'S THIS / MARK UNKNOWN) is never displayed as a revision against the user.
**Geometry**
22. Every spine renders as an oriented box at its smoothed angle; no axis-aligned fallback.
23. A slab's text is never rotated, whatever the spine angle.
24. A spine chip is never upside down (rotation normalised to read bottom-to-top).
25. A box whose angle changes less than ANGLE_DEADBAND does not redraw its angle.
26. A tap on a 30° leaning spine selects that spine, not its neighbour (hit-test in the rotated frame).
27. Three or more thin same-angle boxes render as one stack bracket until tapped.
28. A cover-class box (short/long \> 0.45 or \|angle\| \> 60°) draws its chip level across the cover.
**Closer look, held states**
29. At most CLOSER_K spines carry a closer-look flag at once, in any lens.
30. While a detail sheet or closer look is open, no overlay transition is drawn; the ledger keeps recording.
31. Closer look that changes the identity produces a card revision, never a silent rewrite.
**Accessibility**
32. With Reduce Motion on, no element animates position, scale or opacity except anchor following.
33. Every on-glass state is distinguishable in greyscale (snapshot test with colour removed).
34. All interactive targets measure ≥ 44 × 44 pt.
35. VoiceOver reads the card list and announces batched updates politely; it never announces per-frame changes.
**Privacy**
36. No camera frame is written to disk or logs by the overlay layer (INV-22).
---
## 9. Open questions for the owner
1. **Direction:** confirm A (Slabs) as the build target, with B as the VoiceOver/large-text fallback?
2. **Closer look:** an always-on prompt on ≤1 spine (recommended) or a fourth lens with k = 2?
3. **k values:** Recommended 3, Read 5, All cap 20, Stretch 3 — set at O-7, or keep as starting values?
4. **Margins and dwells:** take the "start at" column for the first live run, or the upper ends of the ranges at p95?
5. **Card batching:** is 6 s right, or should batches apply only on pause?
6. **Candidate band:** may a candidate-band identity ever be highlighted in Recommended (an opt-in setting)?
7. **Stretch picks:** are bridge, section staple and one exploration pick the right ingredients; should "rate to learn" write ASSERTED profile events to the vault side immediately?
8. **Chat layer:** which Batch 020 experiment goes into the next batch — 002 (agent asks, you tap) or 006 (taste tree exporting a skill file)?
9. **Keystone:** switch a track to a four-corner quad when \>15 % of the trapezoid falls outside the oriented-box fit — accept 15 % as the T-2 threshold?
10. **Mockups and photos:** the private canvas uses owner shelf photos (allowed by the owner for mockups only, not a G-PUB release). Keep all mockups private until G-PUB?

---
## 10. Owner rulings (2026-11-02, in progress)
1. **Direction:** A "Slabs" is the build target. B "Index rail" is the automatic fallback for VoiceOver and accessibility text sizes.
2. **Closer look:** **a fourth filter mode**, "Needs a closer look", highlighting up to 2 spines when selected. This overrides the spec's always-on red-tag proposal. Red still means "a human decision is needed".
3. **k values:** starting values only (Recommended 3, Read 5, All cap 20, Closer look 2, Stretch 3). The owner sets the targets at O-7 after watching clips.
4. **Margins and dwells:** the first live run uses the §6 "start at" column, then they are tuned from the V-5 clips.
5. **Card batching:** as proposed: apply every ~6 s, or when the camera has been still for 1 s; never while a finger is on the list; "Apply now" is always available.
6. **Low confidence:** split into two settings (OC33). **Dev mode** shows every confidence level, its explanation and the tunable parameters. **The end-user default** highlights only at `probable` or better, and picks from the middle of the taste curve. Users can toggle into orthogonal, higher-temperature discovery modes. Taste is themes, topoi and styles, never collaborative filtering (R-0).
7. **Ratings:** a rating changes this session's picks at once, but it is saved as private *pending* and joins the profile only after the owner reviews it. The profile is public, so nothing reaches it unreviewed.
8. **Chat layer:** design **both** 002 ("agent asks, you tap") and 006 ("taste tree", exportable) in the next design batch (card U-3). 006 feeds R-0.
9. **Keystone:** accept 15 % as T-2's starting threshold; T-2 measures it on clips and tunes it.
10. **Mockups:** the owner confirms the mockups may use their shelf photos, and **the mockups may be shared publicly now**, before G-PUB. Only the owner shares them; agents never post. The raw photos, crops, labels, clips and weights stay private until G-PUB or G-W. Before sharing, check the mockups for people, faces and store staff.

**All of §9 is ruled (2026-11-02).** U-1 is closed; U-2 (guided sweep) and U-3 (chat layer) are the next design batch.

**Also ruled 2026-11-02 (outside §9):** guided sweep mode (OC31, video discarded after processing, option b) and recognition of every spine (OC32).
