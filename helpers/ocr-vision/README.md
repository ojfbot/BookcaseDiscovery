# helpers/ocr-vision

Swift (SwiftPM) helper that runs Apple Vision text recognition on spine crops, behind the JSON Lines contract in
[`contracts/helpers/ocr-request.schema.json`](../../contracts/helpers/ocr-request.schema.json) and
[`ocr-response.schema.json`](../../contracts/helpers/ocr-response.schema.json) (card L-1). Built in card P-1.
macOS 14 or later; Vision and CoreImage do not exist elsewhere. The TypeScript wrapper is
[`src/perceive/ocr.ts`](../../src/perceive/ocr.ts).

```
swift build -c release                 # products: .build/release/ocr-vision, ocr-vision-fixture
./test.sh                              # swift test (see below)
.build/release/ocr-vision --version
.build/release/ocr-vision < requests.jsonl > responses.jsonl
```

## What it does

For each request line `{id, image, polygon, rotations}` it:

1. decodes `image` (the GPS-stripped working copy) and keeps its **stored pixels**;
2. perspective-corrects `polygon` to an upright rectangle (`CIPerspectiveCorrection`);
3. turns that crop clockwise by each of `rotations` (0, 90, 180 or 270);
4. runs `VNRecognizeTextRequest` at `.accurate`, **twice per rotation**: `usesLanguageCorrection` off, then on;
5. writes one line `{id, variants:[{rotation, langCorrection, text, confidence}], version:{helper, os, requestRevision}}`.

Variants come in request order, correction off before on. A request that fails answers
`{id, error:{code, message}}` and the helper reads the next line. Error codes: `bad-request`,
`image-unreadable`, `polygon-out-of-bounds`, `polygon-degenerate`, `crop-failed`, `recognition-failed`.
A line that is not a JSON object has no readable `id`; it is answered under the id `line:<n>`.
stderr carries diagnostics and never recognised text.

## Choices the contract leaves open

- **Pixel frame.** The polygon is in the stored pixels of the working copy, origin top-left. The helper never
  applies an EXIF orientation: the working copy is orientation-normalised upstream (conductor ruling). Measured
  defaults on macOS 27, pinned by `OrientationTests`: `CGImageSourceCreateImageAtIndex` returns stored pixels
  (used here); `CIImage(contentsOf:)` also ignores the tag unless `applyOrientationProperty` is set;
  `VNImageRequestHandler(cgImage:)` takes an explicit orientation, passed as `.up`. If a working copy still
  carries a tag other than 1 the helper warns on stderr and keeps the stored pixels.
- **Corner order.** The contract says "in order around the box", with no start or winding. The helper fixes the
  winding to clockwise and starts at the corner nearest the image's top-left, so the crop is upright for a quad
  turned less than about 45 degrees. Beyond that the start is a convention; cover it with `rotations`.
- **Bounds.** A corner up to 2 px outside the image is clamped; further out is `polygon-out-of-bounds`. A side
  under 4 px is `polygon-degenerate`.
- **Text and confidence.** `text` is the top candidate of each recognised line, top to bottom, joined with a
  newline; empty when Vision finds nothing. `confidence` is the mean of those candidates' confidences, 0 when empty.
- **Language.** Fixed to `en-US` so a run is reproducible. The contract has no language field.
- **Version.** `helper` is `ocr-vision/<semver>`, `os` is `macOS <major.minor.patch>`, `requestRevision` is the
  `VNRecognizeTextRequest` revision Vision used (3 on macOS 27.0.1).
- **Cache.** Consecutive requests naming the same image decode it once.

## Tests

`./test.sh` runs `swift test`. On a Mac with only the Command Line Tools (no Xcode.app) SwiftPM does not give the
compiler the Swift Testing macro plugin, so plain `swift test` fails to build; the script passes the plugin path
explicitly, and is harmless under Xcode.

All test images are drawn in-test with CoreGraphics (`Sources/OcrVisionSynthetic`); none is committed.

- `CropTests`: coloured corner markers prove each rotation turns clockwise, a tilted quad comes out upright, corner
  order and winding do not matter, and bad polygons get the right code. These tests, not Vision, are what prove
  the rotation geometry.
- `OrientationTests`: the EXIF behaviour above.
- `OcrTests`: text drawn at 0, 90 and 270 degrees is read at the rotation that makes it upright, with both
  correction settings, plus tilt, an EXIF-tagged JPEG, a blank crop, and the version fields.
- `ProtocolTests`: error lines and the response keys against the contract.

The TypeScript side (`pnpm test`) has a wrapper suite against a stand-in helper, which runs everywhere, and a
contract suite that spawns the real binary and `ocr-vision-fixture`. The latter is skipped, with its title saying
so, where the binaries are not built (Linux).

## Observations (macOS 27.0.1, one machine, synthetic text; not evidence about real spines)

- On clean synthetic text, Vision revision 3 read the text at **all four** rotations, upside down included, with
  confidence 1.0 (`recordsWhetherVisionReadsWrongRotations` prints this). If that holds on real spines, E-3's
  rotation variants may be redundant on this OS; the helper still emits them because the contract asks for them.
- First recognition in a fresh process on a fresh build took about 25 s once (model load); the processes after it
  took 0.28 s for one request. Twenty requests (120 variants) on one 1200 x 1200 image took 3.5 s, about 29 ms a
  variant. P-4 should treat the first call as a warm-up.

PROXY results (public library-shelf crops) are pending: see `implementation-notes.md`.
