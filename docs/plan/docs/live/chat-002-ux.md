# Chat layer 002: agent asks, you tap (card U-3, part 1)

> **Status: design delivered 2026-11-02; awaiting the owner's ruling on its open questions.** Every number is a starting value for O-7, not a target (INV-23).
> **Provenance:** card U-3, from a Claude Design session, filed via selfco-capture as `raw/inbox/40c54a8c-53d7-81c1-b6db-e8f183f0afdb.md`. Vault summary: `wiki/sources/bookcase-discovery-u2-u3-design-batch-2026-11-02.md`. Below is the spec verbatim, minus the capture envelope.
> **Visuals** sit behind private claude.ai links. The owner may share them; agents never post.

Handoff spec for card U-3 of [[BookcaseDiscovery]], experiment **002 · the agent asks, you tap**. It builds on the U-1 overlay (direction A "Slabs") and the U-2 guided sweep. Part 02 of this series covers experiment 006 (taste tree). Visuals are linked, never embedded.
## 1. Summary
**What 002 does.** When the app can't tell which book a spine is, or which spine you meant, it holds the labels, dims the glass, letters two or three options A / B / C, and asks one short question. You answer with a tap, by voice, or with "None of these" / "Not now". It serves OC32 (recognise every spine) without typing.
**Two kinds of question**
<table header-row="true">
<tr>
<td>Kind</td>
<td>What is unclear</td>
<td>Who starts it</td>
<td>Where the letters go</td>
</tr>
<tr>
<td>WHICH BOOK</td>
<td>One spine fits 2–3 catalog works (series trade dress, faded title, two editions of different works)</td>
<td>The app, under the gates in §3; or you, by tapping a spine marked "?"</td>
<td>The spine gets a "?" plate; the letters go on the answer rows</td>
</tr>
<tr>
<td>WHICH SPINE</td>
<td>Your tap, long-press or spoken request matches 2–3 spines</td>
<td>You (it is the reply to your action)</td>
<td>One plate per spine on the glass, and the same letters on the answer rows</td>
</tr>
</table>
**Rules that never bend**
1. One question at a time, at most three lettered options plus "None of these". More than three plausible options means no lettered question: the spine goes to *Needs a closer look*.
2. Red is used because a human decision is needed: the option outlines, the sheet's top rule and the "YOUR CALL" chip. Nothing else turns red.
3. An answer is **ASSERTED** evidence. It is the live equivalent of R-3's `bookcase correct --is <workId>` (band → `verified`); "None of these" is `--not` for each offered candidate (band → `unknown`, reason `user-none`).
4. An answer is **never shown as a revision against the user**. Only the app's own earlier guess can appear struck through as "was". If later DERIVED evidence disagrees with your answer, the answer stands; the conflict is logged and shown in dev mode only.
5. Any card the answer changes shows was / now / why with Undo (INV-21). Confirming the app's guess raises the band and is **not** a revision (U-1 check 4).
6. Identity answers stay in the visit's private ledger. They never touch the taste profile, so they are not part of the owner's pending review (that is for ratings and 006).
**Prototype.** The canvas page "U-3 · Chat layer" opens with an interactive 002 board: tap A or B, try the mic, or choose Not now and reopen the chip.
## 2. Visuals
All links are private until the owner shares them. The photo is the owner's shelf; there are no people or faces in the region used (only illustrated cover art on spines). Which book each spine is, the candidates, the scores, the voice and quiet mode are simulated.
<table header-row="true">
<tr>
<td>Screen</td>
<td>Link</td>
<td>Caption</td>
</tr>
<tr>
<td>Canvas page</td>
<td>[U-3 · Chat layer](https://claude.ai/artifact/6pgjNrnbiE8N4qmnbbP4Md)</td>
<td>Both prototypes, every state as a board, and the spec sheet</td>
</tr>
<tr>
<td>Gallery</td>
<td>[U-3 Chat Visuals](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV)</td>
<td>Every screen as an image with a stable anchor</td>
</tr>
<tr>
<td>1 · Which book</td>
<td>[#ident](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#ident)</td>
<td>Pick #2 has two close matches; labels held, one spine ringed red, answers A/B</td>
</tr>
<tr>
<td>2 · Answered</td>
<td>[#answered](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#answered)</td>
<td>B: card revised, app's guess struck through. A: guess confirmed, band up, no revision</td>
</tr>
<tr>
<td>3 · Which spine</td>
<td>[#which-spine](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#which-spine)</td>
<td>A long-press lands on three thin spines; plates staggered with elbow leaders</td>
</tr>
<tr>
<td>4 · Voice</td>
<td>[#voice](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#voice)</td>
<td>Heard "bee" → B; applies after 1.5 s unless a tap changes it</td>
</tr>
<tr>
<td>5 · Quiet mode</td>
<td>[#quiet](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#quiet)</td>
<td>Library: mic off, no chime, no spoken prompt, one haptic</td>
</tr>
<tr>
<td>6 · Not now</td>
<td>[#parked](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#parked)</td>
<td>The question folds into a chip in the card tray</td>
</tr>
<tr>
<td>7 · From the sweep</td>
<td>[#sweep-replay](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#sweep-replay)</td>
<td>A U-2 TWO MATCHES spine asked on a frozen keyframe after the sweep</td>
</tr>
<tr>
<td>8 · Dev mode</td>
<td>[#dev](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#dev)</td>
<td>Ask score and each gate, candidate scores and evidence, ledger events, sliders</td>
</tr>
<tr>
<td>9 · VoiceOver</td>
<td>[#voiceover](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#voiceover)</td>
<td>U-1 index-rail fallback with the options and their shelf positions</td>
</tr>
<tr>
<td>Spec sheet</td>
<td>[#states-spec](https://claude.ai/artifact/Mwxp4mykWKmr3FhonYttKV#states-spec)</td>
<td>Both state machines, lettering rules, parameters</td>
</tr>
</table>
Earlier work: [U-1 screens](https://claude.ai/artifact/Bed55SjQCGqZYRnRDY3wiQ), [U-2 sweep visuals](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj), and the Batch 020 sketch P.020.002 on the canvas's "Directions & experiments" page.
## 3. When it asks, and when it holds back
**App-started questions (WHICH BOOK)** open only when every gate passes:
<table header-row="true">
<tr>
<td>Gate</td>
<td>Test</td>
<td>Why</td>
</tr>
<tr>
<td>Ambiguity</td>
<td>top-two identity margin \< ASK_MARGIN, and the top candidate is at least `possible`</td>
<td>Ask only where the glass would hesitate anyway</td>
</tr>
<tr>
<td>Stakes</td>
<td>the spine is, or would become, highlighted in the active lens (a Recommended pick, a Read match, a Closer-look spine)</td>
<td>A question must change what you see. Unknowns that matter to no lens wait for the coverage report</td>
</tr>
<tr>
<td>Stillness</td>
<td>camera still ≥ ASK_STILL; no sweep recording; no finger on the card list; no card batch applying</td>
<td>Never mid-pan or mid-gesture</td>
</tr>
<tr>
<td>Spacing</td>
<td>≥ ASK_GAP since the last app-started question</td>
<td>Calm glass (OC30)</td>
</tr>
<tr>
<td>Budget</td>
<td>\< ASK_MAX_VISIT app-started questions this visit; not backed off (ASK_BACKOFF)</td>
<td>Fatigue</td>
</tr>
<tr>
<td>Score</td>
<td>ambiguity × stakes × (1 − fatigue) ≥ ASK_SCORE</td>
<td>One number for dev mode and tuning</td>
</tr>
<tr>
<td>Option count</td>
<td>2–3 distinct works; candidates that are editions of one work don't count as different</td>
<td>Edition doesn't change taste; four or more → Needs a closer look</td>
</tr>
</table>
A failed gate is logged as `clarification_held` with the failing gate, shown in dev mode, and never prompts.
**User-started questions** (WHICH SPINE, or tapping a "?" spine) skip Spacing, Budget and Score: you caused them, so they answer you at once. They still respect the option count.
**Never asks:** while a U-2 sweep is recording (questions are batched onto the result screen); in the All lens on its own (ambiguity shows as "?" on the chip; a tap asks); about a track you already answered this visit; while another question is open.
## 4. Lettering on thin and rotated spines
The spec sheet on the canvas draws the four cases. Rules:
1. At most three letters, in reading order: left to right, then top to bottom. Copies of one work share a letter.
2. Plates are 30 pt squares, paper with a 2 pt red edge and a 1 pt ink ring, letter in mono 17 pt. They **stay level** and sit off the spine body, joined to the spine's head point (the edge midpoint highest on screen, as in U-1) by a leader.
3. On a leaning spine (any angle) the outline follows the oriented box; the plate does not rotate.
4. Plates closer than 4 pt step sideways along one row above the shelf rail, with elbow leaders (up from the head point, across, up to the plate).
5. Stacked flat books: letters go top to bottom, plates to the left of the stack.
6. The hit target is the spine polygon grown to 44 pt or the plate, whichever is larger. The answer rows in the sheet are the primary target; the glass is a convenience.
7. While asking: slabs and highlights hide, the glass dims (scrim .58), only the option spines stay lit, and the "YOUR CALL · LABELS HELD" chip shows. Labels on glass do not change until the question closes (INV-24 applies to the hold).
## 5. Answering: tap, voice and quiet places
- **Tap** an answer row, a plate or an option spine. Selection inverts the row, then applies after a short beat.
- **Voice.** The mic opens when you tap it, or by itself only when the question answers something you said. Accepted: the letter ("A", "bee"), a title fragment, "left / middle / right", "neither", "not now". The heard answer shows in a bar and applies after VOICE_CONFIRM unless a tap changes it. Below VOICE_MIN_CONF the heard letter shows with "?" and waits for a tap. The mic closes after VOICE_WINDOW. No audio is stored; only the chosen letter and `via: voice` reach the ledger.
- **Quiet mode** (libraries, or whenever you choose it): no chime, no spoken prompt, mic off, one light haptic when a question opens. It is a mode you pick, or one offered once when call-number stickers appear (U-2 library pass). It never uses location.
- **Noisy places:** voice stays available, but VOICE_MIN_CONF rises by 0.05 when the ambient level is high; the tap path is unchanged.
- **Not now / camera moved / timeout:** the question parks as a chip in the card tray ("1 QUESTION WAITING"). It reopens by itself once if the spine returns and holds still; otherwise it waits there and in Needs a closer look. A pick whose identity is still open drops back to `possible` and leaves the Recommended glass (end users only see picks at `probable` or better).
## 6. How 002 fits each lens, the sweep and dev mode
<table header-row="true">
<tr>
<td>Context</td>
<td>Behaviour</td>
</tr>
<tr>
<td>Recommended (k 3)</td>
<td>App-started WHICH BOOK for picks and would-be picks under the gates</td>
</tr>
<tr>
<td>Read (k 5)</td>
<td>Asks only when the answer decides whether a spine is a book you've read (a seed author, for the MVP)</td>
</tr>
<tr>
<td>All (cap 20)</td>
<td>Never starts a question; ambiguous spines carry "?" on their chip; a tap asks</td>
</tr>
<tr>
<td>Needs a closer look (k 2)</td>
<td>The natural home for questions: each flagged spine offers "Ask me" (002) beside "Closer photo"; a question that settles it removes the flag</td>
</tr>
<tr>
<td>U-2 guided sweep</td>
<td>Never interrupts recording. TWO MATCHES spines become a "N questions" row on the result screen; each opens on its frozen keyframe (the video is already discarded)</td>
</tr>
<tr>
<td>Dev mode</td>
<td>Shows the ask score and every gate, candidate scores with their evidence kinds, the events written, conflicts, and live sliders for ASK_SCORE, ASK_MARGIN and ASK_GAP</td>
</tr>
<tr>
<td>VoiceOver / large text</td>
<td>U-1 direction B (index rail) is the automatic fallback: options become rail rows with their shelf position</td>
</tr>
</table>
## 7. Evidence, ledger and cards
<table header-row="true">
<tr>
<td>Event</td>
<td>Payload (proposed; T-4 owns the schema)</td>
</tr>
<tr>
<td>`clarification_held`</td>
<td>track ids, kind, failing gate, score</td>
</tr>
<tr>
<td>`clarification_asked`</td>
<td>question id, kind (`which-book` / `which-spine`), track ids, options \[\{letter, work id or track id\}\], score and gate values, trigger (`app` / `user`)</td>
</tr>
<tr>
<td>`clarification_answered`</td>
<td>question id, letter or `none`, via (`tap` / `voice`), voice confidence; evidence kind **ASSERTED**, scope `identity`</td>
</tr>
<tr>
<td>`clarification_parked`</td>
<td>question id, reason (`not-now` / `moved` / `timeout`)</td>
</tr>
<tr>
<td>`conflict_noted`</td>
<td>question id, the later DERIVED evidence; dev mode only</td>
</tr>
<tr>
<td>`card_revised` (existing)</td>
<td>`previous`, `reason_event_ids` → the `clarification_answered` id, `diff`</td>
</tr>
</table>
Card copy after an answer:
- **App's guess replaced:** REVISED · WAS *The Enchantment Emporium (app's guess)* struck through · NOW *The Wild Ways* · WHY "You chose B for this spine." · badges ASSERTED · YOU, IDENTITY ONLY · Undo.
- **App's guess confirmed:** no REVISED tag; BAND ◧ probable → ◼ verified · WHY "You chose A for this spine."
- **Undo** restores the previous state, retracts the ASSERTED record (an `undo` event, nothing deleted), and reopens the question.
- **Never:** "you said B but it's A", "corrected", or any struck-through user answer.
## 8. Components
<table header-row="true">
<tr>
<td>Component</td>
<td>Purpose</td>
<td>Inputs</td>
<td>States</td>
</tr>
<tr>
<td>`AskGate`</td>
<td>Decide whether a question may open</td>
<td>candidates per track, margin, lens, stakes, stillness, budget, backoff</td>
<td>pass · held (gate name)</td>
</tr>
<tr>
<td>`OptionPlate`</td>
<td>Lettered plate on glass</td>
<td>letter, head point, row slot, selected</td>
<td>idle (red edge) · selected (ink fill) · hidden (VoiceOver rail)</td>
</tr>
<tr>
<td>`OptionOutline`</td>
<td>Ring an option spine</td>
<td>obb, selected</td>
<td>dashed red · solid paper (selected)</td>
</tr>
<tr>
<td>`QuestionSheet`</td>
<td>Bottom sheet with the question and answers</td>
<td>kind, question text, options, mic state, quiet</td>
<td>asking · voice-listening · voice-heard · applying</td>
</tr>
<tr>
<td>`AnswerRow`</td>
<td>One lettered answer</td>
<td>letter, title, meta, selected</td>
<td>idle · selected · disabled</td>
</tr>
<tr>
<td>`MicButton`</td>
<td>Voice entry</td>
<td>mic permission, quiet, auto-open</td>
<td>off · listening · heard · disabled (quiet)</td>
</tr>
<tr>
<td>`HeardBar`</td>
<td>Shows what voice heard, with the confirm countdown</td>
<td>heard text, confidence, countdown</td>
<td>listening · heard · low-confidence ("?")</td>
</tr>
<tr>
<td>`ParkedChip`</td>
<td>Parked question in the card tray</td>
<td>question id, spine label</td>
<td>waiting · reopened</td>
</tr>
<tr>
<td>`YourCallChip`</td>
<td>"YOUR CALL · LABELS HELD" on glass</td>
<td>—</td>
<td>shown while asking</td>
</tr>
<tr>
<td>`AnswerCardDiff`</td>
<td>The card's was / now / why after an answer</td>
<td>previous, now, reason event, kind</td>
<td>revised · confirmed (band up) · undone</td>
</tr>
<tr>
<td>`DevAskPanel`</td>
<td>Why the app asked</td>
<td>gate values, candidates, events</td>
<td>dev mode only</td>
</tr>
</table>
## 9. Question state machine
<table header-row="true">
<tr>
<td>From</td>
<td>Event</td>
<td>To</td>
<td>Effect</td>
</tr>
<tr>
<td>LIVE</td>
<td>ambiguity on a tracked spine, or your action resolves to 2–3 targets</td>
<td>CANDIDATE</td>
<td>—</td>
</tr>
<tr>
<td>CANDIDATE</td>
<td>a gate fails</td>
<td>HELD BACK → LIVE</td>
<td>`clarification_held`</td>
</tr>
<tr>
<td>CANDIDATE</td>
<td>gates pass (or user-started)</td>
<td>ASKING</td>
<td>labels held, glass dimmed, `clarification_asked`, one haptic</td>
</tr>
<tr>
<td>ASKING</td>
<td>tap an option</td>
<td>ANSWERED</td>
<td>`clarification_answered` (via tap)</td>
</tr>
<tr>
<td>ASKING</td>
<td>voice hears an option ≥ VOICE_MIN_CONF</td>
<td>CONFIRMING</td>
<td>heard bar, countdown</td>
</tr>
<tr>
<td>CONFIRMING</td>
<td>countdown ends</td>
<td>ANSWERED</td>
<td>via voice</td>
</tr>
<tr>
<td>CONFIRMING</td>
<td>tap a different option</td>
<td>ANSWERED</td>
<td>via tap</td>
</tr>
<tr>
<td>ASKING</td>
<td>None of these</td>
<td>UNKNOWN → LIVE</td>
<td>band `unknown`, reason `user-none`, spine to Needs a closer look</td>
</tr>
<tr>
<td>ASKING</td>
<td>Not now · camera moves away · ASK_TIMEOUT</td>
<td>PARKED</td>
<td>`clarification_parked`, chip in tray</td>
</tr>
<tr>
<td>PARKED</td>
<td>spine back and still (first time only) · or tap the chip</td>
<td>ASKING</td>
<td>—</td>
</tr>
<tr>
<td>PARKED</td>
<td>visit ends</td>
<td>DEFERRED</td>
<td>stays in Needs a closer look and the session report</td>
</tr>
<tr>
<td>ANSWERED</td>
<td>—</td>
<td>APPLIED → LIVE</td>
<td>band `verified`, `card_revised` where a card changes, labels released, ASK_GAP timer starts</td>
</tr>
<tr>
<td>APPLIED</td>
<td>Undo</td>
<td>ASKING</td>
<td>ASSERTED retracted</td>
</tr>
</table>
## 10. Proposed parameters (starting values for O-7, all configuration)
<table header-row="true">
<tr>
<td>Name</td>
<td>Range</td>
<td>Start at</td>
<td>Reasoning</td>
</tr>
<tr>
<td>ASK_MARGIN</td>
<td>0.10–0.20</td>
<td>0.15</td>
<td>Wider than U-1's ID_MARGIN, so a question appears only where the glass would hold back anyway</td>
</tr>
<tr>
<td>ASK_SCORE</td>
<td>0.45–0.65</td>
<td>0.55</td>
<td>ambiguity × stakes × (1 − fatigue); tuned on clips so that roughly one question per two minutes of browsing remains</td>
</tr>
<tr>
<td>ASK_STILL</td>
<td>0.6–1.2 s</td>
<td>0.8 s</td>
<td>Longer than a pause between pans, shorter than a deliberate look</td>
</tr>
<tr>
<td>ASK_GAP</td>
<td>20–60 s</td>
<td>30 s</td>
<td>About one shelf section between questions</td>
</tr>
<tr>
<td>ASK_MAX_VISIT</td>
<td>4–8</td>
<td>6</td>
<td>A short visit tolerates a handful; the rest wait in Needs a closer look</td>
</tr>
<tr>
<td>ASK_BACKOFF</td>
<td>after 2 skips</td>
<td>gap × 2; off after 3</td>
<td>Respects "not now" as a signal</td>
</tr>
<tr>
<td>ASK_TIMEOUT</td>
<td>8–15 s</td>
<td>12 s</td>
<td>Unanswered while still → parked silently</td>
</tr>
<tr>
<td>PARK_REOPEN</td>
<td>0–1</td>
<td>1</td>
<td>Reopen once on return, never nag</td>
</tr>
<tr>
<td>MAX_OPTIONS</td>
<td>2–3</td>
<td>3</td>
<td>Fixed by the brief; more becomes Needs a closer look</td>
</tr>
<tr>
<td>VOICE_CONFIRM</td>
<td>1.0–2.0 s</td>
<td>1.5 s</td>
<td>Time to see and override a mishearing</td>
</tr>
<tr>
<td>VOICE_MIN_CONF</td>
<td>0.75–0.90</td>
<td>0.85 (+0.05 when loud)</td>
<td>Below it, the heard letter waits for a tap</td>
</tr>
<tr>
<td>VOICE_WINDOW</td>
<td>6–10 s</td>
<td>8 s</td>
<td>Mic closes on its own</td>
</tr>
<tr>
<td>PLATE_SIZE / HIT</td>
<td>24–32 pt / ≥ 44 pt</td>
<td>30 / 44</td>
<td>Readable plate; touch target per HIG</td>
</tr>
<tr>
<td>PLATE_GAP</td>
<td>2–6 pt</td>
<td>4 pt</td>
<td>Minimum gap before plates step sideways</td>
</tr>
<tr>
<td>GLASS_SCRIM</td>
<td>.45–.65</td>
<td>.58</td>
<td>Dim enough that the options pop on busy shelves</td>
</tr>
</table>
## 11. Acceptance checks
Each line can become a test. "Clip" means a replayed recorded or synthetic detection stream.
**Gating**
1. With a top-two margin ≥ ASK_MARGIN, no app-started question opens.
2. A spine that is not highlighted, and would not be, in the active lens never gets an app-started question.
3. No question opens while the camera moves, a sweep records, a finger is on the card list or a card batch applies.
4. Two app-started questions are never closer than ASK_GAP; a visit never has more than ASK_MAX_VISIT.
5. After two consecutive Not nows, the next app-started question waits at least 2 × ASK_GAP; after three, none open for the rest of the visit.
6. A user-started question opens within 300 ms of the action, regardless of gap and budget.
7. With four or more plausible works, no lettered question opens and the spine is flagged for Needs a closer look.
8. Candidates that are editions of the same work produce no question.
9. Only one question is open at a time.
10. The All lens never starts a question on its own.
**Lettering**
1. Letters follow reading order; copies of one work share one letter.
2. No plate overlaps another plate or an option spine's body; plates closer than PLATE_GAP move sideways.
3. Plates are axis-aligned for any spine angle.
4. Every option's hit area is ≥ 44 × 44 pt.
5. While asking, no slab, highlight or label text changes on glass.
**Answers and evidence**
1. An answer writes exactly one `clarification_answered` with evidence kind ASSERTED and scope `identity`.
2. **An answer to a 002 question never appears as a revision against the user:** no card, report or replay shows the user's answer as "was" or struck through.
3. When the answer replaces the app's guess, the card shows REVISED with was / now / why and Undo, and `card_revised.reason_event_ids` contains the answer's event id.
4. When the answer confirms the app's guess, the band rises and no REVISED tag or `card_revised` event appears.
5. Later DERIVED evidence that disagrees with an answer never changes the label or card; it writes `conflict_noted`, visible only in dev mode.
6. A track answered this visit is never asked about again in the same visit.
7. Undo restores the previous card and band exactly and reopens the question.
8. "None of these" sets the band to `unknown` with reason `user-none` and adds the spine to Needs a closer look.
9. Identity answers never write to the taste profile or the pending-review list.
**Voice and quiet**
1. A heard answer applies only after VOICE_CONFIRM; a tap during the countdown wins.
2. A heard answer below VOICE_MIN_CONF never applies on its own.
3. The mic never opens by itself unless the question answers a spoken request.
4. In quiet mode no sound plays, the mic cannot open, and exactly one haptic fires per question.
5. No audio is persisted; the ledger holds only the letter, `via` and the confidence.
**Parking, sweep and accessibility**
1. Not now, moving away or ASK_TIMEOUT parks the question as a chip; it reopens on its own at most once.
2. A pick with an open question is not shown on Recommended glass to an end user (it is below `probable`).
3. During a sweep recording no question opens; TWO MATCHES spines appear as questions on the result screen.
4. With VoiceOver on, the question is announced once, options are rail rows in letter order with their shelf positions, and double-tap answers.
5. With Reduce Motion on, plates and the sheet appear without pulse or slide.
6. Colour-blind check: options are identifiable by letter, dashed outline and the "YOUR CALL" text without colour.
## 12. Open questions for the owner
1. **Stakes:** should app-started questions also cover spines that matter to no lens, purely for OC32 coverage, in an opt-in "help identify" mode?
2. **Budget:** is about six app-started questions per visit right, or should the first visit be quieter?
3. **Quiet mode:** offer it automatically when call-number stickers appear, or only from settings?
4. **Voice:** should the mic ever open by itself? The proposal is only when you asked by voice.
5. **Conflicts:** if strong later evidence disagrees with an answer, should the app ever ask once more (neutrally, in dev mode first), or never?
6. **Answers as labels:** may ASSERTED identity answers be used as training labels for the detector and OCR flywheel (F-1), private, or kept out of it?
7. **Read lens:** should 002 ask "is this the one you read?" for seed authors, or is that a taste question for 006?
## Sources
No external sources: a synthesis of this conversation, the U-3 brief (`~/selfco/prompts/bookcase-discovery-chat-layer-ux-handoff.md`), the [[BookcaseDiscovery]] plan (`REQUIREMENTS.md` OC32, OC33, INV-21, INV-24; `DELIVERY-PLAN.md` U-3, R-0, R-3, T-4; `docs/live/overlay-ux.md` §1 and §10), the U-1 spec [[bookcase-discovery-u1-overlay-ux — Build handoff spec (visuals by link)]] and the U-2 spec [[bookcase-discovery-u2-guided-sweep-ux — Build handoff spec (visuals by link)]].
Series: bookcase-discovery-u3-chat-layer-ux · Part 01 of 2 · Previous: [[none]] · Next: [[bookcase-discovery-u3-chat-layer-ux — Part 02: 006 taste tree and export]]
— end of part 01 —

---
## 13. Owner rulings (2026-11-02, key questions)
4. **Voice:** the mic opens for an answer only if the user asked by voice first. It never opens on its own.
6. **Answers as labels:** yes. ASSERTED identity answers become **private** training labels (F-1), marked `user-asserted`. They are never public and never placed in an audit slice.

The remaining questions (1–3, 5, 7) take the spec's proposals as starting values until the owner rules.
