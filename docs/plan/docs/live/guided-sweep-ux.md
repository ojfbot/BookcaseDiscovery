# Guided sweep UX (card U-2)

> **Status: design delivered 2026-11-02; awaiting the owner's ruling on its open questions.** Every number is a starting value for O-7, not a target (INV-23).
> **Provenance:** card U-2, from a Claude Design session, filed via selfco-capture as `raw/inbox/40c54a8c-53d7-81cf-bf1b-fbd482947a7d.md`. Vault summary: `wiki/sources/bookcase-discovery-u2-u3-design-batch-2026-11-02.md`. Below is the spec verbatim, minus the capture envelope.
> **Visuals** sit behind private claude.ai links. The owner may share them; agents never post.

BookcaseDiscovery U-2: guided sweep UX, the build handoff for coding agents (Claude Code, Codex). It builds on U-1, the live overlay in direction A "Slabs", in the cockpit / OJF Editorial system. Plan refs: REQUIREMENTS OC31, OC32, OC33 and INV-22, INV-24; DELIVERY-PLAN U-2 and T-9; `docs/live/overlay-ux.md` §10 (owner rulings). Every number here is a proposal for the owner to set at O-7, not a measurement (INV-23). Visuals are real files behind private links; nothing is redrawn in text.
## 1. Summary and recommendation
**Recommend direction B, "Ribbon".** A strip of kept frames grows across the top of the screen while you pan. During capture it is the coverage map: a rushed stretch shows as a hatched GAP tile. After processing the same strip becomes the scrubber for the replay, with cards synced below. It is the only direction that makes coverage visible during the pan (OC32), and its replay is honest about what is kept: it scrubs over sparse keyframes plus overlay, never video (INV-22 as amended).
The flow in one line: **Sweep tab → framing (rails, start edge, three checks) → hold and pan (no labels; pace cue, spine count, ribbon) → release (pause: hold again for the next shelf, or Done) → thinking overlay (the shelf rebuilt from real crops; counts from the run) → result (coverage per shelf, every unknown with a reason and a fix, top picks) → scrub-back replay.**
What B borrows:
- **From C:** the spine roll (crops of every spine in shelf order) becomes the replay under **VoiceOver**, mirroring U-1's ruling that B "Index rail" is the accessibility fallback for the live overlay. C's per-spine haptic tick is an opt-in setting.
- **From A:** nothing on glass. The vertical gauge stays the fallback if the ribbon proves too busy on small phones.
### The three directions
<table header-row="true">
<tr>
<td>Direction</td>
<td>Capture</td>
<td>Replay</td>
<td>Strength</td>
<td>Weakness</td>
</tr>
<tr>
<td>A · Shutter and gauge</td>
<td>Timer at the top; a vertical pace gauge by the thumb edge with the pace word beside the needle</td>
<td>Full-screen keyframe pager with dots and ‹ ›</td>
<td>Familiar camera language; the gauge is easy to read at a glance</td>
<td>Coverage is invisible while you pan; the pager hides where you are along the shelf</td>
</tr>
<tr>
<td>**B · Ribbon (recommended)**</td>
<td>Rails, a pace slab ("GOOD SPEED" / "SLOW DOWN") above the button, spine count, ribbon of kept frames with GAP tiles</td>
<td>Current frame with dimmed neighbours, filmstrip with pick numerals and closer-look marks, synced card list, slider</td>
<td>One object serves coverage during capture and navigation after; gaps are shown where they happen</td>
<td>The ribbon is small; it must stay legible on a 375-pt-wide phone</td>
</tr>
<tr>
<td>C · Tally</td>
<td>One tick per spine seen; hollow ticks for spines only seen blurred; the rhythm is the pace (optional haptic tick per spine)</td>
<td>Spine roll: crops of every spine in shelf order, picks numbered, unknowns hollow with their reason</td>
<td>Playful, and the spine roll is the most direct coverage picture</td>
<td>Rhythm is a weak signal for many people; ticks get dense on long shelves</td>
</tr>
</table>
## 2. Visuals: screens and states
All visuals are private. The gallery has one anchor per state: [U-2 Sweep Visuals](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj). The editable source is the design canvas, page "U-2 · Guided sweep": [BookcaseDiscovery design canvas](https://claude.ai/artifact/6pgjNrnbiE8N4qmnbbP4Md). The interactive prototype is the first board on that page, "Sweep prototype · hold the button".
<table header-row="true">
<tr>
<td>State</td>
<td>Link</td>
<td>Caption</td>
</tr>
<tr>
<td>Direction A, capture</td>
<td>[A capture](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#direction-a)</td>
<td>Timer, vertical gauge with the pace word beside the needle</td>
</tr>
<tr>
<td>Direction A, replay</td>
<td>[A replay](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#direction-a)</td>
<td>Keyframe pager with the pick slab and a card peek</td>
</tr>
<tr>
<td>Direction B, capture</td>
<td>[B capture](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#direction-b)</td>
<td>Ribbon, rails, pace slab, spine count (recommended)</td>
</tr>
<tr>
<td>Direction B, replay</td>
<td>[B replay](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#direction-b)</td>
<td>Ribbon becomes the scrubber; cards synced below</td>
</tr>
<tr>
<td>Direction C, capture</td>
<td>[C capture](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#direction-c)</td>
<td>Tally of ticks, one per spine</td>
</tr>
<tr>
<td>Direction C, replay</td>
<td>[C spine roll](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#direction-c)</td>
<td>Crops in shelf order, unknowns with their reason</td>
</tr>
<tr>
<td>Framing</td>
<td>[Framing](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#framing)</td>
<td>Rails around one shelf, START HERE edge, arrows, three checks</td>
</tr>
<tr>
<td>Tap, not a hold</td>
<td>[Tap hint](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#tap-hint)</td>
<td>A short press records nothing and explains the gesture</td>
</tr>
<tr>
<td>Recording, good speed</td>
<td>[Good speed](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#recording-good)</td>
<td>No labels; hairline boxes, pace slab GOOD SPEED</td>
</tr>
<tr>
<td>Recording, too fast</td>
<td>[Too fast](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#too-fast)</td>
<td>Slab inverts to SLOW DOWN, haptic tap, GAP tile forming</td>
</tr>
<tr>
<td>Paused between shelves</td>
<td>[Paused](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#paused)</td>
<td>"Next shelf down?" Hold again, or Done (auto after 6 s)</td>
</tr>
<tr>
<td>Thinking overlay</td>
<td>[Thinking](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#thinking)</td>
<td>Shelf rebuilt from real crops; stage counts; measured estimate</td>
</tr>
<tr>
<td>Result and coverage</td>
<td>[Result](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#result)</td>
<td>40 of 48 identified; 8 to fix, grouped by reason; top picks</td>
</tr>
<tr>
<td>Replay</td>
<td>[Replay](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#replay)</td>
<td>Kept frame, ≤ k slabs, filmstrip marks, synced cards</td>
</tr>
<tr>
<td>Card to spine</td>
<td>[Jump](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#card-to-spine)</td>
<td>A card tap jumps to the frame where that spine is most central</td>
</tr>
<tr>
<td>All lens in replay</td>
<td>[All](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#all-lens)</td>
<td>Vertical chip on every identified spine; no highlight</td>
</tr>
<tr>
<td>Closer-look lens in replay</td>
<td>[Closer](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#closer-lens)</td>
<td>Unknowns with reasons; the 2 worth a closer look in red</td>
</tr>
<tr>
<td>Gap in the replay</td>
<td>[Gap frame](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#gap-frame)</td>
<td>"No sharp frame here", with when and why</td>
</tr>
<tr>
<td>Re-sweep a gap</td>
<td>[Re-sweep](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#re-sweep)</td>
<td>Ghost edge to line up, then coverage 40 → 42</td>
</tr>
<tr>
<td>Cancelled</td>
<td>[Cancelled](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#cancelled)</td>
<td>Slide left while holding: clip deleted, nothing kept</td>
</tr>
<tr>
<td>Library</td>
<td>[Library](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#library)</td>
<td>Label zone inside the rails; call-number stickers (simulated)</td>
</tr>
<tr>
<td>VoiceOver and Reduce Motion</td>
<td>[Accessibility](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#accessibility)</td>
<td>Double-tap toggle, spoken and haptic pace, no needle travel</td>
</tr>
<tr>
<td>States and parameters sheet</td>
<td>[Spec sheet](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#states-spec)</td>
<td>State machine, blur-vs-speed model, parameter table</td>
</tr>
</table>
What is real and what is simulated in the mockups: the shelf photo, the spine boxes and the crops in the thinking overlay are real (the owner's photo, no people in frame). The pan and its speed, the identities (read by eye from the photo), the picks and reasons, and the library stickers are simulated. Reading profile used (public): all of [[William Gibson]] read, [[Kim Stanley Robinson]] liked, cooler on [[Neal Stephenson]].
## 3. Components
<table header-row="true">
<tr>
<td>Component</td>
<td>Purpose</td>
<td>Inputs</td>
<td>States</td>
</tr>
<tr>
<td>`ModeSwitch`</td>
<td>LIVE · SWEEP above the shutter; a horizontal swipe on the viewfinder also switches</td>
<td>current mode, sweep in progress</td>
<td>live · sweep · locked (disabled while recording)</td>
</tr>
<tr>
<td>`ShelfRails`</td>
<td>Two horizontal rails that hold one shelf, corner ticks, outside scrim</td>
<td>detected shelf band, library mode</td>
<td>framing · recording · off-band (rails flash once, word cue)</td>
</tr>
<tr>
<td>`StartEdge`</td>
<td>Thick start bar, START HERE, chevrons for the direction</td>
<td>detected case end, chosen direction</td>
<td>shown in framing only</td>
</tr>
<tr>
<td>`FramingChecks`</td>
<td>SHELF FOUND · DISTANCE OK · LEVEL chips</td>
<td>band found, median spine px, roll</td>
<td>each pass / fail with a word cue ("Step closer", "Level the phone")</td>
</tr>
<tr>
<td>`ShutterButton`</td>
<td>Hold to record, release to pause; slide left cancels, slide up locks</td>
<td>phase, pointer delta</td>
<td>idle (HOLD) · recording (ink square) · locked · paused (HOLD +1 SHELF) · toggle (VoiceOver: START / STOP)</td>
</tr>
<tr>
<td>`CancelHint` / `LockHint`</td>
<td>Text either side of the shutter</td>
<td>phase</td>
<td>shown while recording</td>
</tr>
<tr>
<td>`PaceSlab`</td>
<td>The pace word plus a mini gauge</td>
<td>predicted blur, sharpness ratio, cue state</td>
<td>good (paper, solid glyph) · slow-down (inverted ink, hatched glyph) · hidden</td>
</tr>
<tr>
<td>`SpineCounter`</td>
<td>Unique tracks seen this sweep</td>
<td>count</td>
<td>always on while capturing</td>
</tr>
<tr>
<td>`KeyframeRibbon`</td>
<td>Kept frames as tiles, GAP tiles, pass dividers, the live tile</td>
<td>keyframes\[\], gaps\[\], pass breaks</td>
<td>framing (empty, explains itself) · growing · gap-forming · full (scrolls)</td>
</tr>
<tr>
<td>`PauseCard`</td>
<td>"Next shelf down?" after a release</td>
<td>pass summary, auto-finish timer</td>
<td>shown · counting down</td>
</tr>
<tr>
<td>`DoneButton`</td>
<td>Ends the sweep</td>
<td>auto-finish seconds</td>
<td>idle · counting</td>
</tr>
<tr>
<td>`ThinkingOverlay`</td>
<td>Processing view</td>
<td>stage events from the pipeline, crops as found</td>
<td>stage 1–5 · estimate hidden · estimate shown · failed</td>
</tr>
<tr>
<td>`ShelfRebuild`</td>
<td>Real spine crops placed in shelf order as tracks are confirmed; glyph under each once read</td>
<td>crops\[\], read state</td>
<td>found · read · unknown</td>
</tr>
<tr>
<td>`StageList`</td>
<td>Five stages with counts</td>
<td>per-stage counters</td>
<td>wait · on · done</td>
</tr>
<tr>
<td>`CoverageSummary`</td>
<td>Headline "40 of 48 identified" and per-shelf tick rows</td>
<td>per-shelf totals, per-spine state</td>
<td>one tick per spine: solid identified · hollow unknown · hatched rushed</td>
</tr>
<tr>
<td>`FixList`</td>
<td>Unknowns grouped by reason, each with its fix</td>
<td>reason groups</td>
<td>rushed → RE-SWEEP (red: a person must act) · too dark → LOOK LIVE · two matches → CHOOSE (U-3 002) · no match → logged, no action</td>
</tr>
<tr>
<td>`ReplayFrame`</td>
<td>Current kept frame with neighbours dimmed</td>
<td>keyframe, neighbours</td>
<td>frame · gap frame · face-dropped frame (empty tile, "not kept: face check")</td>
</tr>
<tr>
<td>`ReplaySpineBox`</td>
<td>U-1 `SpineBox` on a still</td>
<td>track at this frame, band, lens</td>
<td>quiet · highlighted · selected (double ring) · unknown (dotted) · flagged (red)</td>
</tr>
<tr>
<td>`Slab` (U-1)</td>
<td>Level label with leader, ≤ k per frame</td>
<td>rank, title, author, band</td>
<td>shown · selected</td>
</tr>
<tr>
<td>`ReplayFilmstrip`</td>
<td>Tiles of kept frames; pick numeral and red closer-look mark on the frame where each spine is most central</td>
<td>keyframes\[\], marks</td>
<td>current · other · gap</td>
</tr>
<tr>
<td>`ReplayScrubber`</td>
<td>Slider over the filmstrip, snaps to frames</td>
<td>index</td>
<td>adjustable (VoiceOver swipe up / down)</td>
</tr>
<tr>
<td>`ReplayLensToggle`</td>
<td>REC · ALL · CLOSER (Read is in the same control on larger phones)</td>
<td>lens</td>
<td>per segment pressed / unpressed</td>
</tr>
<tr>
<td>`ReplayCardList`</td>
<td>The sweep's picks; cards whose spine is in the current frame are full ink, others dim (never removed)</td>
<td>picks\[\], in-frame set, selected</td>
<td>in frame · out of frame · selected</td>
</tr>
<tr>
<td>`GhostEdge`</td>
<td>Dashed outline of the last sharp frame's edge for a re-sweep</td>
<td>anchor keyframe</td>
<td>shown in re-sweep framing</td>
</tr>
<tr>
<td>`SpineRoll`</td>
<td>Direction C's roll, used as the VoiceOver replay</td>
<td>crops in shelf order</td>
<td>per spine: identified · unknown with reason</td>
</tr>
<tr>
<td>`PrivacyLine`</td>
<td>What was kept: "Video deleted · 14 still frames kept on this phone, face-checked"</td>
<td>counts</td>
<td>always on the result</td>
</tr>
<tr>
<td>`DevOverlay` (owner)</td>
<td>Live gyro speed, exposure, predicted blur, sharpness ratio, thresholds; per-spine coverage frames</td>
<td>sensors, parameters</td>
<td>dev mode only</td>
</tr>
</table>
## 4. Sweep-session state machine
States: **LIVE → FRAMING → RECORDING → PAUSED → PROCESSING → RESULT ⇄ REPLAY**, plus **FIX** and **CANCELLED**. RECORDING has sub-states **GOOD**, **SLOW_DOWN** and **LOCKED**, and it logs **GAP** events. The drawn version is on the [spec sheet](https://claude.ai/artifact/Me5R4KSbkrCTA6uYgrmxhj#states-spec).
<table header-row="true">
<tr>
<td>From → To</td>
<td>Trigger</td>
</tr>
<tr>
<td>LIVE → FRAMING</td>
<td>Sweep chosen in the mode switch, or a horizontal swipe on the viewfinder</td>
</tr>
<tr>
<td>FRAMING → RECORDING</td>
<td>Press on the shutter while the framing checks pass. If a check fails, the press still records, and the failing cue stays on screen</td>
</tr>
<tr>
<td>FRAMING → FRAMING</td>
<td>Press shorter than HOLD_MIN: nothing recorded; hint "Hold the button, then pan"</td>
</tr>
<tr>
<td>RECORDING · GOOD → SLOW_DOWN</td>
<td>Predicted blur \> BLUR_SLOW, or sharpness ratio \< SHARP_SLOW, for CUE_ENTER frames</td>
</tr>
<tr>
<td>SLOW_DOWN → GOOD</td>
<td>Both below their thresholds for CUE_EXIT</td>
</tr>
<tr>
<td>RECORDING → GAP logged</td>
<td>A run of ≥ 1 spine has no covering frame (COVER rule). It is an event, not a state: a GAP tile and one heavy haptic tap</td>
</tr>
<tr>
<td>RECORDING → LOCKED</td>
<td>Slide up ≥ LOCK_SLIDE while holding; recording continues hands-free, and a tap stops it</td>
</tr>
<tr>
<td>RECORDING → CANCELLED</td>
<td>Slide left ≥ CANCEL_SLIDE while holding. The clip is deleted; earlier passes are kept</td>
</tr>
<tr>
<td>RECORDING → PAUSED</td>
<td>Release (or a tap when locked) after ≥ HOLD_MIN; or MAX_PASS reached; or an interruption (call, lock, background, thermal warning)</td>
</tr>
<tr>
<td>PAUSED → RECORDING</td>
<td>Hold again: a new pass, appended to this sweep (≤ MAX_PASSES)</td>
</tr>
<tr>
<td>PAUSED → PROCESSING</td>
<td>Done, or no input for PAUSE_AUTOFINISH</td>
</tr>
<tr>
<td>PROCESSING → RESULT</td>
<td>All stages done</td>
</tr>
<tr>
<td>PROCESSING → CANCELLED</td>
<td>Cancel: the clip, crops and frames of this sweep are deleted</td>
</tr>
<tr>
<td>PROCESSING (app killed) → on next launch</td>
<td>The temporary clip is purged before any UI shows. Proposal: the sweep is not resumed (owner, §10)</td>
</tr>
<tr>
<td>RESULT → REPLAY</td>
<td>"Replay the sweep", a pick row, or a filmstrip tile</td>
</tr>
<tr>
<td>REPLAY → RESULT</td>
<td>‹ Result</td>
</tr>
<tr>
<td>RESULT → FIX → FRAMING (ghost)</td>
<td>RE-SWEEP on the rushed group: framing with the ghost edge of the last sharp frame; a short pass over the gap merges into this sweep and recomputes coverage</td>
</tr>
<tr>
<td>RESULT → FIX → LIVE</td>
<td>LOOK LIVE on the too-dark group: Live opens with the "Needs a closer look" lens on those spines (U-1, k 2)</td>
</tr>
<tr>
<td>RESULT → FIX → U-3 002</td>
<td>CHOOSE on the two-matches group: the clarify-by-tap flow (card U-3)</td>
</tr>
</table>
Rules that hold across states:
- **Nothing is labelled while RECORDING.** The glass shows the rails, the pace slab, hairline boxes, the spine count and the ribbon only. Labels, slabs and cards appear in RESULT and REPLAY, where nothing moves, so the INV-24 jitter rules are not needed during capture.
- **Every transition writes a ledger event** (`sweep_started`, `pass_started`, `pace_cue`, `gap_logged`, `pass_ended`, `sweep_cancelled`, `processing_stage`, `sweep_result`, `keyframe_dropped_face`, `video_deleted`).
## 5. Pace cues and capture parameters
**Model.** Predicted blur ≈ ω × exposure time × pixels per degree. ω is the gyro's angular speed about the pan axis. Exposure time comes from the capture device. On the main camera a 1080-px-wide portrait frame gives about 20 px/°. The gyro predicts blur before it shows. A per-frame sharpness score confirms it: the variance of the Laplacian inside the rails, divided by this pass's own running p75 of sharp frames, because shelves differ in texture and light. Either signal can raise "Slow down"; both must be calm to clear it. Spine text runs across the pan direction, so horizontal smear destroys glyph strokes first.
<table header-row="true">
<tr>
<td>Name</td>
<td>Proposed range</td>
<td>Start at</td>
<td>Reasoning</td>
</tr>
<tr>
<td>HOLD_MIN</td>
<td>300–600 ms</td>
<td>400 ms</td>
<td>Shorter is a tap: record nothing, explain the gesture</td>
</tr>
<tr>
<td>CANCEL_SLIDE / LOCK_SLIDE</td>
<td>60–100 pt left / 50–80 pt up</td>
<td>70 / 60 pt</td>
<td>Same feel as voice-message gestures; long enough not to fire by accident while panning</td>
</tr>
<tr>
<td>BLUR_GOOD</td>
<td>≤ 1.5–2.5 px predicted</td>
<td>2 px</td>
<td>≈ 12 °/s at 1/120 s (a lit store), ≈ 6 °/s at 1/60 s (a dim library). OCR on 10–15 px glyphs survives \~2 px of smear</td>
</tr>
<tr>
<td>BLUR_SLOW (cue)</td>
<td>\> 2–3 px</td>
<td>2 px</td>
<td>One threshold for entering slow-down, so the cue speaks before frames are lost</td>
</tr>
<tr>
<td>BLUR_GAP (risk)</td>
<td>\> 3.5–6 px</td>
<td>4 px</td>
<td>≈ 24 °/s at 1/120 s. Above this, expect no usable frames; coverage is checked by the COVER rule, not by speed alone</td>
</tr>
<tr>
<td>SHARP_RATIO good / slow</td>
<td>≥ 0.5–0.7 / \< 0.35–0.5</td>
<td>0.6 / 0.45</td>
<td>Relative to the pass's own sharp frames</td>
</tr>
<tr>
<td>CUE_ENTER / CUE_EXIT</td>
<td>2–4 frames / 300–600 ms</td>
<td>3 frames / 400 ms</td>
<td>Warn fast, clear slow; at most 2 cue changes per second</td>
</tr>
<tr>
<td>HAPTIC</td>
<td>light tap every 200–300 ms while slow-down; one heavy tap per GAP</td>
<td>250 ms</td>
<td>Silence means good. Sound off by default (libraries); optional per-spine tick (from C) is a setting</td>
</tr>
<tr>
<td>COVER_FRAMES / COVER_ZONE</td>
<td>2–4 sharp frames / central 50–70 % of frame width</td>
<td>2 / 60 %</td>
<td>A spine counts as seen only when sharp and near the middle, where perspective and vignetting are least</td>
</tr>
<tr>
<td>OFF_BAND</td>
<td>band centre drifts 20–35 % of band height for 500 ms</td>
<td>25 %</td>
<td>"Keep the shelf between the rails"; vertical drift loses tops or stickers</td>
</tr>
<tr>
<td>ROLL</td>
<td>4–8°</td>
<td>6°</td>
<td>Level cue; tilted frames make thin spines merge</td>
</tr>
<tr>
<td>SPINE_PX (distance)</td>
<td>median spine width 18–60 px on a 1080-px frame</td>
<td>—</td>
<td>Below 18: "Step closer". Fewer than 8 spines in frame: "Step back". At 1 m a 25 mm spine is ≈ 25 px</td>
</tr>
<tr>
<td>KEYFRAME_RATE</td>
<td>≤ 1 Hz (settled)</td>
<td>1 Hz</td>
<td>The sharpest frame in each 1-s window; a frame that fails the face check is dropped and shown as an empty tile</td>
</tr>
<tr>
<td>MAX_PASS / MAX_PASSES</td>
<td>20–45 s / 3–6</td>
<td>30 s / 4</td>
<td>Bounds the temporary clip, heat and processing time; at the limit the pass ends as if released</td>
</tr>
<tr>
<td>PAUSE_AUTOFINISH</td>
<td>4–8 s, or off</td>
<td>6 s</td>
<td>Long enough to step to the next shelf; short enough that a forgotten sweep still finishes</td>
</tr>
<tr>
<td>ESTIMATE_DELAY / UPDATE</td>
<td>1.5–3 s / ≤ 1 per s</td>
<td>1.5 s / 1 s</td>
<td>No estimate until per-frame time is measured on this phone; whole seconds; an estimate that grows says why ("taking longer: phone is warm")</td>
</tr>
<tr>
<td>TIME_TO_RESULT (target)</td>
<td>1–2 × pan duration</td>
<td>owner, O-7</td>
<td>A 15 s sweep answering in 15–30 s keeps the shopper at the shelf</td>
</tr>
</table>
Capture resolution is open (1080p vs 4K, §10). At 4K, pixels per degree roughly double and the same blur limits halve the allowed speed. The thresholds are in pixels, so they carry over, but the cue fires at lower speeds.
T-9's eval (`evals/live-B/sweep.json`) should report: time to result, recognition coverage per shelf, the share of frames under each cue state, gaps per minute of pan, and the recall of cue-compliant against non-compliant passes. The last one is the test of whether the thresholds are right.
## 6. Replay, coverage and keyframes
- **The replay scrubs kept frames, not video.** It snaps to frames; between frames nothing is interpolated. Neighbouring frames show dimmed at the sides so you can see where you are along the shelf.
- **Lenses and k are U-1's, per frame:** Recommended k 3, Read k 5, All cap 20, Needs a closer look k 2. The default lens in the replay is Recommended.
- **One mark per spine, on its best frame.** Pick numerals and red closer-look marks go on the filmstrip only at the frame where that spine is most central, so marks don't repeat across overlapping frames.
- **Cards and frames stay in sync both ways.**
	- A card tap jumps to the spine's best frame and rings the spine.
	- A spine or slab tap rings its card.
	- Cards whose spine is in the current frame are full ink; the others dim but stay in place. The list never reorders during scrubbing.
- **Results are final at RESULT.** Later evidence (a Live closer look, a re-sweep, a U-3 answer) changes a card only with U-1's was / now / why and undo (INV-21). A user's answer is ASSERTED evidence and is never shown as a revision against them.
- **Coverage** is `identified / detected` per shelf. Every unknown carries exactly one reason code:
	- `RUSHED`: no sharp frame;
	- `DARK_GLARE`;
	- `TWO_MATCHES`: ambiguity;
	- `NO_MATCH`: catalog gap, which feeds C-R;
	- `DETECTION_GAP`: a spine-sized gap between boxes, inferred.
The headline reads like "40 of 48 identified · 8 to fix", with the groups below it.
- **Keyframes.**
	- Keep the sharpest frame per second.
	- Run the face check before writing. A face-out book with a face on its cover will trip it; the default is to drop the frame anyway (§10).
	- Frames are stored privately, excluded from backup, and deletable per sweep ("Delete this sweep" removes frames, crops and boxes together).
## 7. Gesture, modes, library and accessibility
**Hold-to-record, one-handed.**
- The shutter is a 68 pt square at bottom centre, inside the thumb zone for either hand.
- Hold to record; release to pause.
- Slide left to cancel; slide up to lock for a hands-free pass (useful on a step stool or when holding a basket).
- One hold is one shelf. The pause card asks for the next shelf down.
**Mode switching.**
- Live and Sweep share one camera and one SCAN tab. LIVE · SWEEP sit above the shutter, and a horizontal swipe on the viewfinder switches.
- Proposal: **Live opens first.** Sweep is suggested once per section when Live sees spines running past both frame edges for more than \~3 s ("Long shelf? Try a sweep").
- The mode switch is locked while recording.
- If you switch to Live during PROCESSING, processing continues in the background and the result waits on the SCAN tab (owner, §10).
**Library use (McKinney and Frisco public libraries).**
- In library mode the bottom rail drops to include a **label zone**, so call-number stickers stay in frame.
- Stickers are read as DERIVED evidence. They also give a shelf-order check: library shelves run in call-number order, so an identity that breaks the order is suspect.
- Call numbers are **never redrawn on glass**, since the sticker is already there. They appear on the detail sheet as an evidence line, and in a card's "where" line ("SF JEMISIN · shelf 2") so you can find the book again.
- Sound is off and the haptics are the only non-visual cue. Library mode follows staff permission (#17) and logs it per shoot.
- The library sticker mockup is simulated; there is no library photo yet.
**Accessibility.**
- **VoiceOver.**
	- Hold gestures conflict with VoiceOver, so the shutter becomes a toggle: double-tap starts, double-tap stops.
	- Pace is spoken at most once every 2 s, and "Good speed" only after a slow-down. Haptics carry the same signal.
	- The replay switches to the spine roll (direction C), read in shelf order, for example: "God's War, Kameron Hurley, pick 2, frame at 0:06". The scrubber is an adjustable element (swipe up / down by frame).
	- Coverage is announced as text.
- **Reduce Motion.**
	- The pace needle jumps instead of sliding, and cue changes are instant swaps.
	- The blur preview filter is off. The ribbon appends tiles without sliding, the replay cuts between frames, and the thinking overlay places crops without animation.
	- Haptics stay on: they are not motion. They have their own toggle.
- **Colour-blind reading.** Pace is word + glyph + fill (solid for good, hatched for slow-down), never colour alone. Coverage ticks are solid, hollow or hatched. Red marks only "a human decision is needed" (RE-SWEEP, the closer-look marks), always with a word.
- **One-handed reach.**
	- The shutter, Done and the lens toggle sit in the bottom third, except the replay lens toggle, which mirrors U-1's top bar. Proposal: move it down on phones taller than 844 pt.
	- Touch targets are at least 44 pt.
## 8. Privacy and retention (build requirements)
These implement INV-22 as amended and OC28:
1. The sweep clip is written only to a temporary, backup-excluded location inside the app container. It never goes to the photo library and never carries audio.
2. The clip is deleted when processing finishes, when the sweep is cancelled, and, after a crash, at the next launch before any UI.
3. Only these persist, privately: sparse keyframes (≤ 1 Hz, face-checked), spine crops, boxes and ledger events.
4. Any frame or crop with a detected face is dropped before storage. A dropped keyframe is shown as an empty tile with "not kept: face check".
5. Processing runs on device, or over the local link to the owner's Mac core. Any upload of crops is declared.
6. "Delete this sweep" removes its keyframes, crops and boxes. The ledger keeps a tombstone event.
## 9. Acceptance checks
Each is phrased so a coding agent can turn it into a test (unit, UI or fixture-clip).
**Capture and gesture**
1. A press shorter than HOLD_MIN starts no capture session, writes no file and shows the "Hold the button, then pan" hint.
2. Holding ≥ HOLD_MIN starts recording within 150 ms of the threshold. Releasing ends the pass and shows the pause card.
3. Sliding left ≥ CANCEL_SLIDE while holding ends the pass, deletes its clip within 1 s, and keeps earlier passes of the same sweep.
4. Sliding up ≥ LOCK_SLIDE locks recording. Lifting the finger does not stop it; a tap on the shutter does.
5. A pass reaching MAX_PASS ends as if released.
6. An incoming call, app backgrounding or a thermal warning during recording ends the pass and lands in PAUSED with that pass kept.
7. With PAUSE_AUTOFINISH elapsed and no input, PAUSED moves to PROCESSING.
8. During RECORDING no title, slab, chip or card is drawn on glass; only rails, hairline boxes, pace slab, spine count and ribbon (snapshot test).
**Pace cues**
9. Fed gyro samples giving predicted blur at 2 × BLUR_SLOW, "SLOW DOWN" appears within CUE_ENTER frames (≤ 150 ms at 30 fps).
10. After motion falls below threshold, "GOOD SPEED" returns no sooner than CUE_EXIT. Under a speed signal oscillating at 3 Hz around the threshold, the cue changes at most 2 times per second.
11. With the gyro calm but sharpness ratio \< SHARP_SLOW, the cue still shows slow-down; it clears only when both are calm.
12. The pace state is readable without colour: a grayscale snapshot of GOOD and SLOW DOWN differs in word and glyph fill.
13. While slow-down holds, a light haptic fires every HAPTIC interval. A GAP fires exactly one heavy haptic. No haptic fires while the cue is GOOD.
14. A fixture clip with a rushed stretch produces a GAP tile in the ribbon at the matching position, and a `gap_logged` ledger event listing the uncovered track ids.
**Privacy**
15. After processing completes, no video file of any type (`.mov`, `.mp4`, `.hevc`, AVAsset temp) exists anywhere in the app container.
16. After cancel during PROCESSING, no clip, keyframe, crop or box of that sweep exists.
17. If the app is killed during PROCESSING, the next launch deletes the temp clip before the first screen renders.
18. Stored keyframes per pass ≤ ceil(pass duration in s). Each is the sharpest frame of its 1-s window.
19. A fixture frame containing a face is not stored. The replay shows its tile as "not kept: face check", and a `keyframe_dropped_face` event exists.
20. Kept keyframes have the do-not-back-up attribute set.
21. "Delete this sweep" removes its keyframes, crops and boxes, and leaves a tombstone event.
**Processing**
22. The thinking overlay's counts equal the pipeline's own counters at every update (no client-side timer drives them), and no count ever decreases.
23. No time estimate is shown before ESTIMATE_DELAY. When an estimate increases, a reason line is shown.
24. Cancel in the thinking overlay returns to FRAMING and shows "Sweep discarded".
**Result and coverage**
25. identified + unknown = detected, for each shelf and in total. The headline uses the same numbers.
26. Every unknown carries exactly one reason code from \{RUSHED, DARK_GLARE, TWO_MATCHES, NO_MATCH, DETECTION_GAP\}, and appears in exactly one fix group.
27. RE-SWEEP opens framing with the ghost edge. A pass covering the gap re-reads only those tracks, merges them into the same sweep and updates coverage. A spine that is now identified moves from hollow to solid.
28. A user's answer from a fix (CHOOSE via U-3 002) is recorded as ASSERTED evidence, and is never shown as a revision against the user. Any card it changes shows was / now / why with undo.
**Replay**
29. Scrubbing to frame i shows exactly the tracks whose boxes intersect frame i, and at most k highlights for the active lens.
30. Each pick numeral and each closer-look mark appears on exactly one filmstrip tile: the frame where that spine's centre is nearest the frame centre.
31. A card tap sets the replay to that spine's best frame and rings the spine. A spine tap rings its card. Scrubbing never reorders the card list.
32. The gap position in the filmstrip shows the "No sharp frame here" panel with its time span.
**Accessibility and modes**
33. With VoiceOver on, the shutter toggles on double-tap. Pace announcements are at least 2 s apart. The replay offers the spine roll, and the scrubber is adjustable by swipe.
34. With Reduce Motion on, no pace-needle transition, ribbon slide or crop animation runs (animation durations are 0). Haptics still fire.
35. The mode switch is disabled during RECORDING. Switching to Live during PROCESSING keeps the result, and the SCAN tab shows it when it is ready.
36. In library mode, call numbers read from stickers appear as DERIVED evidence lines and are never drawn as overlay text on glass.
37. Dev mode shows live gyro speed, exposure, predicted blur, sharpness ratio and the active thresholds. None of it shows outside dev mode.
## 10. Open questions for the owner
1. **Which mode opens first?** Proposal: Live, with a one-time "Long shelf? Try a sweep" suggestion per section. Alternative: remember the last-used mode.
2. **Pause auto-finish:** 6 s, longer, or off (always tap Done)?
3. **Capture resolution:** 1080p (cooler, faster) or 4K (sharper OCR on thin spines, more heat, about half the allowed pan speed)? Could be per-device.
4. **Faces on book covers:** a face-out cover with a face will trip the face check. Drop the frame (safe default), or blur the face region and keep the frame?
5. **Processing location:** on device only, or also over the local link to the Mac core when it is reachable? And can the shopper keep using Live while a sweep processes?
6. **A crash during processing:** purge and lose the sweep (proposed), or resume from the temp clip on next launch?
7. **Keyframe retention:** until "Delete this sweep", or expire after N days? They are private flywheel data (F-1) either way.
8. **Too slow:** is a "you can go a bit faster" cue wanted, or is slow always fine?
9. **Libraries:** does "Save" mean anything different there (a hold request, availability from the library catalog via C-R)? Should the call number replace "shelf 2" in the where-line?
10. **Multi-pass layout:** are passes always "the next shelf down", or can a pass continue the same shelf sideways (a long bay)? That changes how the ribbon and coverage group passes.
11. **Pacer as training:** should first-time users get direction C's tick rhythm (or an on-screen pacer) for their first one or two sweeps, then fade it out?
12. **Time-to-result target** for O-7: is 1–2 × pan duration the right frame?
## Sources
No external sources: a synthesis of this conversation, the U-2 brief (`~/selfco/prompts/bookcase-discovery-guided-sweep-ux-handoff.md`), the [[BookcaseDiscovery]] plan (`REQUIREMENTS.md` OC28, OC30–OC33, INV-20–INV-24; `DELIVERY-PLAN.md` U-2, T-9; `docs/live/overlay-ux.md` §10) and the U-1 spec, [[bookcase-discovery-u1-overlay-ux — Build handoff spec (visuals by link)]].
