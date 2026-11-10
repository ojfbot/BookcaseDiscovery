# Capture protocol: one bookcase

Use this at every store visit for the fixture shoot. Do the sections in order.

**Revised 2026-11-05** (S9 re-plan, cards NS-1 to NS-3): three new arms (§3b low rows level, §4b overlap with margin, §6 Q-1 stills) and §6 now holds uncoached sweeps instead of paced pans. Each arm has a pre-registration in `evals/NS1/`, `evals/NS2/`, `evals/NS3/`. **No measurement has been taken yet**; these arms exist to collect the data.

## 1. Before you start

- Pick one science-fiction bookcase.
- **Ask the staff first.** Say what you're doing and that the photos and clips are for a personal project. If they say no, stop.
- Keep people out of frame. Keep the store's name out of file names and captions.
- Permission log: write the **date**, the **store** and **who said yes** in your private manifest. Not in the album, not in this repo.
- **Originals only.** Never crop, rotate, filter or edit a photo or a clip, and export unmodified originals. A cropped photo hides which books the *sensor* frame cut and which your crop cut (see `evals/NS1/prereg.md`).

## 2. Camera settings

- **Lens:** main 1× only, except where a section says otherwise (§6's half-distance stills move the *phone*, not the lens; the sweeps and §7 let the camera pick).
- **Flash:** off.
- **Format:** 48 MP HEIF on.
- The setting name changes with iPhone model and iOS version. Check the name on your phone.
- Known names, in Settings → Camera → Formats:
  - "Resolution Control"
  - "HEIF Max"
  - "48 MP"
- If you can't find a 48 MP option, stop. Tell the conductor your model and iOS version. Don't guess.

## 3. Per-shelf shots

- One photo per shelf.
- Go top to bottom.
- Stand square on to the shelf.
- The shelf fills the frame width.
- Note each shelf's place from the top: the top shelf is 0 (`shelfIndex`).

### 3b. Low rows level (arm NS-2)

After all the standing shots above, in the same visit, go back down the case. For the **fifth shelf from the top (`shelfIndex` 4) and every shelf below it**, take a second photo with the lens **level with that shelf**:

- Crouch or kneel so the phone is at the shelf's height, held upright, pointing straight at the spines (not tilted up or down).
- Same distance from the shelf as the standing shot, same framing, same lens. Only the height changes.
- Top to bottom, one photo per shelf.
- If the case has fewer than five shelves, level-shoot its **lowest two**.
- **One control, last:** one more *standing* shot of the first shelf you level-shot. It shows how much two ordinary shots of one shelf differ.

## 4. Whole-case shots

- One at **48 MP**. This is the single whole-case still NS-1 compares against.
- Then switch 48 MP **off** and take one at **12 MP** (it is also the fifth still of §6's Q-1 test).

### 4b. Overlap with margin (arm NS-1)

Then, **switching 48 MP back on**:

- Stand back until one photo holds a *section* of the case with a margin of about **one shelf height** on every side.
- Take **2 or 3 photos** whose sections together cover the whole case and overlap each other by at least one shelf height, so that **every book sits in the middle half of the frame in at least one photo**.
- Originals, not crops (§1). Same lens (main 1×).
- Shoot them in order, left to right or top to bottom, and tell the conductor which.

## 5. Conditions

- **Glare:** angle away from the lights. Move until the spines are readable.
- **People:** keep them out of frame.
- **Staff:** ask first (section 1).

## 6. Natural sweeps, then Q-1's stills

### Sweeps (NS-3)

Per case and per phone, **two sweeps**, one after the other. Move the phone the way you would if you were browsing: **nobody tells you how fast, how close, or where to pause.**

- **Video only. No audio.** If your phone can't stop recording sound, tell the conductor the model and iOS version before you shoot.
- 4K if your phone offers it. Let the camera pick the lens (that is a shopper's phone).
- People out of frame.
- Don't redo a sweep because it felt bad. A messy sweep is data.
- If a **non-Pro phone** is available (a borrowed one is fine), do the same two sweeps on it. Its clips are for evaluation only and are never used for training.

### Q-1's four stills (NS-3)

Pick **one stretch of about eight spines** on one shelf. With the main 1× lens, 48 MP, square on:

| | at the normal distance (as §3) | at half that distance |
|---|---|---|
| stretch in the **centre** of the frame | still 1 | still 3 |
| stretch at the **edge** of the frame (its outer end within a thumb width of the edge) | still 2 | still 4 |

The whole stretch must be in the frame in all four. The **fifth still** is the 12 MP whole-case photo of §4: no extra shot. Hold the phone level for all five (no tilt).

## 7. Shoot like a shopper

After the protocol shots, take **10–20 photos** the way you would while browsing.

- Hold the phone. Stand where you'd normally stand.
- Take whole cases at an angle.
- Let the camera pick the lens. Don't force 1×.
- Don't fix the framing.

These are the real-use set. They matter more than the clean shots.

**For one case, take them in this order** (NS-1's real-use pair): first **one** whole-case photo, then **2–3 overlapping photos with margin** as in §4b, all the shopper's way (handheld, camera's lens, unedited).

## 8. Afterwards

- Name the album **`sf-store-001`**.
- Put this visit's photos and clips in it.
- Note the **shelf count** in the first photo's caption, or send it to the conductor.
- **Send the conductor each step's first and last file name** (the camera numbers files in order), plus which case and which phone. The conductor writes the sidecar below. You never type JSON.

## 9. The capture sidecar (until card NS-4 moves these into the manifests)

One JSON file next to the export, **private** (it lives in the export folder and then under `$BOOKCASE_DATA`; never in the repo). It records, for every file, what only the shoot knows. Everything the file itself carries (capture time, megapixels, EXIF lens class, size) is read by ingest, not typed.

```json
{
  "schemaVersion": 1,
  "bookcaseId": "case-a",
  "runs": [
    { "from": "IMG_0001.HEIC", "to": "IMG_0005.HEIC", "arm": "per-shelf", "captureMode": "protocol-still", "deviceClass": "metric-depth", "lens": "main", "shelfIndex": 0 },
    { "from": "IMG_0006.HEIC", "to": "IMG_0006.HEIC", "arm": "level", "captureMode": "protocol-still", "deviceClass": "metric-depth", "lens": "main", "shelfIndex": 4 },
    { "from": "IMG_0030.MOV", "to": "IMG_0031.MOV", "arm": "sweep", "captureMode": "natural-sweep", "deviceClass": "relative-stereo", "lens": "unknown" }
  ]
}
```

| field | values | notes |
|---|---|---|
| `schemaVersion` | `1` | |
| `bookcaseId` | a short private label, one per physical case | the unit of hold-out (`CONTEXT.md`: *Case*) |
| `from`, `to` | file names | a run is the files from `from` to `to` in capture order; a single file has both equal |
| `arm` | `per-shelf`, `per-shelf-repeat` (§3b's control), `level`, `whole-case`, `overlap`, `q1-centre-normal`, `q1-edge-normal`, `q1-centre-half`, `q1-edge-half`, `sweep`, `shopper` | the `q1-*` names are position (centre or edge of frame) and distance (normal, or half of it); `per-shelf` runs count down: `shelfIndex` is the first file's, and each next file is the next shelf |
| `captureMode` | `protocol-still`, `shopper-still`, `natural-sweep` | the same words as NS-4's `captureMode` |
| `deviceClass` | `metric-depth`, `relative-stereo`, `none` | the **phone's** tier (`CONTEXT.md`: *Device tier*), not the file's |
| `lens` | `main`, `ultra-wide`, `telephoto`, `unknown` | `unknown` means "the camera chose"; ingest reads the EXIF lens class either way |
| `shelfIndex` | integer, 0 = top | on `per-shelf`, `per-shelf-repeat`, `level` and the `q1-*` runs only |
| `order` | `left-to-right`, `top-to-bottom` | on `overlap` runs only |

**Tilt (arm NS-2).** Ingest later records, per still, in the **private** fixture manifest (never the public one): `tilt: { pitchDegrees, rollDegrees, source }`. `pitchDegrees` is the angle of the lens's axis above (+) or below (−) the horizontal; `rollDegrees` is the sideways lean; `source` is `exif-gravity` (hypothesis: Apple's maker note carries a gravity vector, to be checked on the first real file with `exiftool`), `device-attitude` (a later logger) or `none`. No ingest code changes in this card; a still with `none` is scored on its arm and `shelfIndex` alone.

A run is invalid, and NS-4's ingest will refuse the sidecar, if: it has a `shelfIndex` where the table gives none, or lacks one where it does; its `from` comes after its `to`; or `captureMode` and the file kind disagree (`natural-sweep` on a still, a still mode on a clip).
