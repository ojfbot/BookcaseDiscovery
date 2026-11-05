# ADR-draft: Opt-in rich sessions retain full-rate capture privately (INV-22 amendment)
slug: rich-session-retention
serial: draft
rev:
Date: 2026-11-05
Status: Proposed (owner decided the direction 2026-11-05; this packet is for approval)
domain: capture
type: policy
Repos affected: BookcaseDiscovery (Z-1 guard, ingest, label ledger), asset-foundry (the lab reads rich sessions)
traces:
  amends: [inv-22-live-frames-not-retained]
  relates-to: [natural-sweep-live-track, real-use-is-degraded-tier-sweep]

---

## Context

INV-22 says live frames are not retained by default, and the guided sweep's video is discarded once processed, with
only sparse keyframes (at most 1 Hz, bystander-checked) kept. Two things the owner wants need more than that:

- **Multi-view label fusion.** Fusing F-0's single-view outputs across the frames of one sweep into cross-view
  consistent boxes, readings and identities needs the frames and their poses, after the sweep has been processed.
  The capture research of 2026-11-04 ranks this as the strongest use of rich data ("machine agreement across
  viewpoints", which fits OC36).
- **The synthetic lab.** Replaying a real camera path in Blender, and comparing LiDAR against MoGe-2 mono geometry,
  needs pose, intrinsics and depth with confidence per frame.

On 2026-11-05 the owner decided: INV-22 is amended **for opt-in rich sessions only**; default sessions are unchanged.
Rich sessions are recorded on the owner's LiDAR Pro iPhone (the metric-depth tier, development and teacher side), at
about 22 GB a visit (the owner's figure, unmeasured until NS-6 reports), and are private.

## Decision

An **opt-in rich session** retains, privately under the data root, everything the phone can log at full rate; a
**default session** retains exactly what INV-22 allowed before. Rich data is a **label generator and an evaluation
reference**, never a model input: a student that could not run on a phone without depth is not the product.

### What a rich session retains

| Stream | Content | Rate | Format (proposal; NS-6 fixes it) |
|---|---|---|---|
| Video | 4K30 HEVC, **no audio track** | full rate | `video/<n>.mov`, segmented every 60 s so a crash loses at most a minute |
| Depth and confidence | ARKit `sceneDepth` 256×192 with its confidence map (LiDAR Pro only) | 60 Hz as delivered | packed float16 depth plus uint8 confidence per frame, `depth/<n>.bin`, indexed from the frame log |
| Pose and intrinsics | camera transform, intrinsics, tracking state and reason, exposure, EXIF, thermal state, IMU sample | per frame | `frames.jsonl`, one line per frame, keyed by capture timestamp and frame index |
| Quality gates | sharpness ratio, IMU blur, glare share, smudge confidence | per frame | columns in `frames.jsonl` |
| Session | device class and model, lens, capture mode `rich-sweep`, case id, permission-log reference, start and end, sizes, SHA-256 per file | once | `manifest.json` |

A default session retains crops, boxes, ledger events and sparse keyframes only, as today. The rich toggle is off by
default and visible on screen while on.

### Where it lives

`<data root>/private/rich-sessions/<session-id>/` (the data root is `$BOOKCASE_DATA`), with two sub-states:

- `quarantine/` — the export exactly as the phone wrote it. Nothing reads it except the Mac-side **bystander pass**.
- the retained copy, beside `manifest.json` — written by `bookcase ingest --rich` after the bystander pass (faces
  outside every detected book box blurred region by region; a frame dropped only when a person dominates it or a
  face's placement against a book box is ambiguous: INV-22 as amended 2026-11-02). The quarantine is deleted when
  the retained copy is complete and hashed. Blurring every frame on the phone at full rate is not attempted.

Never under `images/`, `video/` or `datasets/` (those classes keep their rules), never inside a checkout, never on a
non-Pro phone (no rich sessions on the degraded tier).

### Z-1 guard file classes that must land before the first capture (card NS-Z1)

Depth and confidence maps (`.exr`, `.npy`, `.npz`, `.pfm`, 16-bit `.png`/`.tiff` over a size floor, packed `.bin` /
`.depth`); pose and intrinsics logs (JSON or JSONL carrying `cameraTransform` or `intrinsics` keys at any depth, in
the style of the `chatgpt-export-shape` rule); ARKit world maps (`.arworldmap`); meshes and point clouds (`.ply`,
`.obj`, `.usdz`, `.usda`, `.usdc`); camera RAW (`.dng`, already an image type); a `rich-sessions-dir` rule modelled on
`datasets-dir`. Each with a planted-leak test. The boundary tables in `docs/privacy.md` and `REQUIREMENTS.md` gain a
row.

### Capture-provenance fields for TS-0's label ledger (card NS-4)

Concept names as the research proposed them, with the code names this repo uses:

| Concept | Field | Values |
|---|---|---|
| device class | `deviceClass` (plus `deviceModel`) | `metric-depth` · `relative-stereo` · `none` |
| lens | `lens` | the private manifest's lens class, now required |
| capture mode | `captureMode` | `protocol-still` · `shopper-still` · `natural-sweep` · `rich-sweep` · `live` |
| case id | `caseId` **is the existing `bookcaseId`**, made required for sweep sessions | one physical bookcase |
| duplicate cluster id | `dupClusterId` | the near-duplicate cluster a frame or still belongs to; a fused scene's frames share one, so a split never cuts a scene |
| label source | `labelSource` (beside `basis`, which keeps its meaning) | `single-view` · `mono-geometry` · `multiview-fusion` · `lidar-privileged` · `lidar-scale` |
| RGB-recoverable | `rgbRecoverable` | `yes` · `no` · `unknown`; labels marked `no` (volume behind the spine, occluded extent) are down-weighted or dropped before any student trains |

Splits hold out by `caseId` and session (OC35, OC39); a `caseId` is never in train and evaluation at once.

## Consequences

### Gains
- Multi-view fusion and the lab get frames, poses and depth after processing, from sessions the owner chose.
- Every rich artefact is a known class the guard refuses; nothing new can reach the public repo by accident.
- Provenance fields make the degraded-tier evaluation honest: a student's lift is measured only on rows the
  deployment phones could have produced.

### Costs
- About 22 GB a visit (unmeasured) on the local SSD until the NAS arrives: about five sessions fit with headroom
  (228 GiB free on 2026-11-05). An erasure and retention policy is owed by D-1 and is now urgent.
- The bystander pass over full-rate video is a Mac job of minutes per session, and the quarantine doubles disk use
  until it finishes.
- A second ingest path (`--rich`) and a second guard surface to maintain.

### Neutral
- Rich sessions change no default-session behaviour, no overlay and no card semantics.
- Whether the Apple Developer Program License Agreement permits training on app-captured depth is **unread**; a
  research ticket on the wayfinder map holds it. The go rule (NS-5) can be written before that answer; training
  cannot start before it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Fuse on the phone or the Mac before the discard, keep INV-22 as written | Fusion and the lab need to be re-run as models change; a discarded sweep cannot be re-fused, and a replayed camera path needs its frames |
| Keep only ≤1 Hz keyframes, no video, no depth | Too sparse for tracking and point correspondences; LiDAR depth at 1 Hz cannot be paired with the frames the student sees |
| Retain every session richly (treat frames like photos) | The owner's privacy boundary (OC9, OC28) and the App Store's "collected" definition both argue for the narrowest retention; the degraded tier has nothing rich to retain anyway |
| Blur on the phone before writing | Full-rate face detection and blurring at 4K30 competes with capture; the quarantine-then-blur path keeps the phone's job to recording |

## Provenance

| Field | Value |
|---|---|
| Decided by | the owner, 2026-11-05 (direction); this packet for approval |
| Drafted by | the capture sub-conductor, 2026-11-05 |
| Inputs | the owner's selfco captures of 2026-11-04/05 (capture research §2, §3, §9 Q2, Q16; natural sweep synthesis "Data model and architecture"); `docs/privacy.md`; `docs/dataset.md`; `src/eval/ts0.ts`; plan folder `decisions/open-unknowns.md`, 2026-11-05 entry |
| Open owner items | retention and erasure policy; consent and bystander policy for video in stores and homes; the licence reading |
