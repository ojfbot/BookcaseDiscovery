# Ingest verification: the `pilot-000` set (K-2)

**Question:** are the received files originals, so that nothing downstream relies on re-rendered bytes?

**Answer:** no for 26 of 31 files. Five are originals: landscape frames at the camera's native 48 MP size, whose stored pixels agree with the size the camera recorded. Twenty-six are derivatives: 23 portrait frames whose stored pixels no longer agree with the recorded size, and 3 landscape frames resampled to 0.929× native. No file is suspect.

Scope: the 31 photos the owner calls `pilot-000`, delivered as JPEG. Read-only: no file was moved, copied, renamed, re-encoded or modified. This document has no images, no GPS coordinates, no capture dates or times, and no private paths.

## Delivery path

Path not recorded (JPEG files received). The set cannot say whether the AirDrop "All Photos Data" path delivers true originals, because the path that delivered it is unknown. Only one path delivered these files, so there is no cross-path comparison. The set does show that the bytes delivered here were rewritten for 26 of 31 files.

## Checks and results

| Check | Result |
|---|---|
| File count vs album count | 31 files; the owner's count is 31. They match. |
| Sequence gaps | `IMG_2416` and `IMG_2419`–`IMG_2423` are absent from the `IMG_2401`–`IMG_2437` run (6 numbers). This check does not explain them. |
| Format | 31 of 31 JPEG (JFIF with Exif). No HEIC or HEIF. |
| EXIF `Make`, `Model`, `DateTimeOriginal` | Present on 31 of 31. Make is Apple and Model is one iPhone model on all 31. Apple MakerNote present on all 31. |
| Stored pixels vs EXIF size | Match on 8 landscape files. On all 23 portrait files the EXIF size is the transpose of the stored pixel size, and Orientation is 1 (normal) on all 31. |
| Native 48 MP size | 17 files are at a native size (8064 × 6048 or 6048 × 8064). 14 are at other sizes, each a uniform scale of the native 4:3 grid (0.74× to 0.98×). |
| GPS present | No on 31 of 31. Whether location was off at capture or stripped on delivery is not visible in the files. |
| `.AAE` siblings | None in the delivered folder. |
| `IMG_E` names | None. All 31 names are camera-style `IMG_####`. |
| XMP edit history | None. XMP holds only tool, date, lens and toolkit fields, the same on all 31. |
| JPEG encoder tables and segments | Identical on all 31 (quantisation and Huffman tables, APP segment layout). Re-rendering is not visible in the encoder; only pixel size and the EXIF mismatch show it. |
| Duplicate bytes | 31 distinct SHA-256 values. No two files share bytes. |

## Verdict rule

- **original:** pixel size is a native 48 MP size, the stored pixels agree with the EXIF size, and camera EXIF is present with no XMP edit history. A tone or colour edit that keeps the size and the EXIF would not show here, so "original" means "no sign of re-rendering", not "unedited".
- **derivative:** any of these:
  - the pixel size is not a native size (a resample, scale 0.74× to 0.98×);
  - the stored pixels are the transpose of the EXIF size with Orientation reset to 1. A camera file's EXIF size matches its own pixels, so these files were rotated and re-encoded after capture. Camera metadata survives, which is why it looks intact.
- **suspect:** conflicting signals that the rules above do not settle. None found.

The portrait verdict rests on a general fact about iPhone JPEGs (the camera stores the landscape frame and sets an orientation tag). This set has no portrait frame with an orientation tag, so that fact is not checked here. The O-2 shoot, from the same device, settles it: a camera portrait should show the same landscape pixels with an orientation tag set.

## Per-file record

| File | Format | Pixels (w × h) | Orientation | EXIF present | GPS | Lens | Verdict | Basis |
|---|---|---|---|---|---|---|---|---|
| IMG_2401.jpeg | JPEG | 5912 × 7882 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.978× native |
| IMG_2402.jpeg | JPEG | 5522 × 7362 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.913× native |
| IMG_2403.jpeg | JPEG | 5522 × 7362 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.913× native |
| IMG_2404.jpeg | JPEG | 5522 × 7362 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.913× native |
| IMG_2405.jpeg | JPEG | 5522 × 7362 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.913× native |
| IMG_2406.jpeg | JPEG | 5522 × 7362 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.913× native |
| IMG_2407.jpeg | JPEG | 5522 × 7362 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.913× native |
| IMG_2408.jpeg | JPEG | 5522 × 7362 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.913× native |
| IMG_2409.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | main 1× (6.77 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2410.jpeg | JPEG | 4488 × 5984 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.742× native |
| IMG_2411.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2412.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2413.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2414.jpeg | JPEG | 5400 × 7198 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.893× native |
| IMG_2415.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2417.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2418.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2424.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2425.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2426.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2427.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | main 1× (6.77 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2428.jpeg | JPEG | 6048 × 8064 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1 |
| IMG_2429.jpeg | JPEG | 8064 × 6048 | landscape | yes | no | ultra-wide (2.22 mm) | original | native 48 MP; EXIF size matches pixels |
| IMG_2430.jpeg | JPEG | 8064 × 6048 | landscape | yes | no | ultra-wide (2.22 mm) | original | native 48 MP; EXIF size matches pixels |
| IMG_2431.jpeg | JPEG | 8064 × 6048 | landscape | yes | no | ultra-wide (2.22 mm) | original | native 48 MP; EXIF size matches pixels |
| IMG_2432.jpeg | JPEG | 5616 × 7488 | portrait | yes | no | ultra-wide (2.22 mm) | derivative | portrait; EXIF size transposed vs pixels, Orientation reset to 1; resampled to 0.929× native |
| IMG_2433.jpeg | JPEG | 7488 × 5616 | landscape | yes | no | ultra-wide (2.22 mm) | derivative | resampled to 0.929× native; EXIF rewritten to match |
| IMG_2434.jpeg | JPEG | 7488 × 5616 | landscape | yes | no | ultra-wide (2.22 mm) | derivative | resampled to 0.929× native; EXIF rewritten to match |
| IMG_2435.jpeg | JPEG | 7488 × 5616 | landscape | yes | no | ultra-wide (2.22 mm) | derivative | resampled to 0.929× native; EXIF rewritten to match |
| IMG_2436.jpeg | JPEG | 8064 × 6048 | landscape | yes | no | main 1× (6.77 mm) | original | native 48 MP; EXIF size matches pixels |
| IMG_2437.jpeg | JPEG | 8064 × 6048 | landscape | yes | no | main 1× (6.77 mm) | original | native 48 MP; EXIF size matches pixels |

Pixel sizes come from `sips -g pixelWidth -g pixelHeight`. EXIF sizes come from `exiftool`.

## Counts

| Verdict | Files |
|---|---|
| original | 5 |
| derivative | 26 |
| suspect | 0 |

By lens: 27 ultra-wide (3 original, 24 derivative) and 4 main 1× (2 original, 2 derivative).
By orientation: 8 landscape (5 original, 3 derivative) and 23 portrait (0 original, 23 derivative).

## E1 settings (OC7)

**No.** The set does not hold all three E1 settings of one case:

- No 12 MP frames. The smallest file is 26.9 MP, so there are no whole-case 12 MP shots.
- No HEIF. E1 needs HEIF Max; this set is JPEG.
- No case series. The frames are not grouped as one case shot at three settings.

So the `pilot-000` set is not the controlled `sf-store-001` fixture (OC7 keeps `sf-store-001` as the fixture).

## Use as fixture

**Fit for the real-use set (OC35).** It is handheld, angled, mostly whole cases at a distance, with a mix of 27 ultra-wide and 4 main-lens frames, in both orientations. That is the primary distribution. A derivative verdict does not disqualify a file (owner ruling, OC35). Record each file's verdict in its manifest entry. For any measurement that depends on original pixels (resolution-sensitive reading, size-based checks, or the orientation of the stored pixels), use only the 5 original files or exclude the derivatives.

**Not fit for the controlled reference (`sf-store-001`, E1 settings).** No 12 MP frames, no HEIF, no E1 triples, and not a protocol shoot. Those come from O-2.

## Verdict for the conductor

O-2 is still needed. The controlled `sf-store-001` shoot supplies the 12 MP and HEIF E1 settings this set lacks. It also settles the portrait verdict: a portrait from the same device should show landscape pixels with an orientation tag, which these files do not.

## Method

- Metadata: `exiftool` 13.55, read-only, on the files in place. Fields read: file type, image size, EXIF image size, `Make`, `Model`, `DateTimeOriginal` (presence only), `Orientation`, lens model and focal length, GPS presence (never values), XMP packet fields, and MakerNote presence.
- Pixel size: `sips -g pixelWidth -g pixelHeight`.
- Encoder check: a read-only walk of JPEG markers (quantisation table, Huffman table, APP segment layout), and SHA-256 per file for the duplicate check. Hash values are not recorded here.
