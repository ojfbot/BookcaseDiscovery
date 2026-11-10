// NS-K (video): clip ingest, frames through ingest's frame mode, the still path unchanged, the set roles and the
// backup class of `video/`. The fake-tool tests run everywhere; the end-to-end test needs swift, exiftool and the
// helpers/coverage environment (numpy, opencv-python) and is skipped without them.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  addSeconds,
  clipFrames,
  clipIngest,
  clipManifestPath,
  clipPath,
  frameManifestPath,
  ingest,
  privateManifestPath,
  publicManifest,
  quicktimeInstant,
  readClipManifest,
  sessionCounts,
} from "../src/capture/index.ts";
import type { ClipMeta, ClipProbe, FramesReport, PrivateManifest, StripReport, VideoTools } from "../src/capture/index.ts";
import { FRAMES_ENV } from "../src/capture/clip.ts";
import { classOfPath } from "../src/ledger/backup.ts";
import { ImageStore, MemoryLedger } from "../src/ledger/index.ts";
import { readLineage } from "../src/ledger/lineage.ts";
import { assertManifestable, isTrainable, roleOf } from "../src/eval/set-roles.ts";
import { swiftAvailable, toolsAvailable, Workbench } from "./helpers/synth.ts";

const wb = new Workbench();
afterAll(() => wb.cleanup());
let n = 0;
const fresh = () => {
  const id = n++;
  const folder = wb.path(`clips-${id}`);
  const dataDir = wb.path(`data-${id}`);
  mkdirSync(folder);
  mkdirSync(dataDir);
  return { folder, dataDir };
};

// --- fakes ------------------------------------------------------------------------------------------------------

const video = (samples: number, codec = "avc1") => ({ trackId: 3, mediaType: "vide", codecs: [codec], samples, durationSeconds: 2, width: 64, height: 48, nominalFrameRate: 30 });
const audio = { trackId: 1, mediaType: "soun", codecs: ["aac "], samples: 90, durationSeconds: 2 };
const meta = { trackId: 4, mediaType: "meta", codecs: ["mebx"], samples: 60, durationSeconds: 2 };

/** A fake toolchain: the "clip" is any file; its probe is chosen by its first byte. */
function fakeTools(probes: Record<string, ClipProbe>, metaOf: Partial<ClipMeta> = {}): VideoTools & { strips: number } {
  const t = {
    strips: 0,
    probe(path: string): ClipProbe {
      const body = readFileSync(path, "utf8");
      if (body.startsWith("STRIPPED:")) {
        const orig = probes[body.slice(9)]!;
        return { ...orig, tracks: orig.tracks.filter((x) => x.mediaType !== "soun") };
      }
      return probes[body]!;
    },
    strip(src: string, dst: string): StripReport {
      t.strips++;
      const key = readFileSync(src, "utf8");
      writeFileSync(dst, `STRIPPED:${key}`);
      const p = probes[key]!;
      return { dropped: p.tracks.filter((x) => x.mediaType === "soun").map((x) => x.trackId), copied: p.tracks.filter((x) => x.mediaType !== "soun").map((x) => ({ trackId: x.trackId, mediaType: x.mediaType, samples: x.samples })), associations: 0 };
    },
    meta: (): ClipMeta => ({ make: "Apple", model: "iPhone 17 Pro", capturedAt: "2026-01-02T03:04:05-07:00", hasLocation: false, ...metaOf }),
    frames(): FramesReport {
      throw new Error("not used");
    },
  };
  return t;
}

describe("time helpers", () => {
  it("reads QuickTime's CreationDate with its offset, and refuses one without", () => {
    expect(quicktimeInstant("2020:01:02 03:04:05-06:00")).toBe("2020-01-02T03:04:05-06:00");
    expect(quicktimeInstant("2020:01:02 03:04:05")).toBeNull();
    expect(quicktimeInstant(undefined)).toBeNull();
  });
  it("adds a frame's timestamp in the clip's own offset, to the millisecond", () => {
    expect(addSeconds("2026-01-02T03:04:05-07:00", 1.9666667)).toBe("2026-01-02T03:04:06.967-07:00");
    expect(addSeconds("2026-01-02T23:59:59+05:30", 2)).toBe("2026-01-03T00:00:01.000+05:30");
  });
});

describe("clip ingest (fake tools)", () => {
  it("stores the audio-free copy under video/ by its own hash, with both hashes and the facts in the private manifest", () => {
    const s = fresh();
    writeFileSync(join(s.folder, "IMG_0001.MOV"), "A");
    const tools = fakeTools({ A: { durationSeconds: 2, tracks: [audio, video(60), meta] } });
    const r = clipIngest({ ...s, session: "test-session", tools, permission: "permission received" });
    expect(r.outcomes.map((o) => o.verdict)).toEqual(["stored"]);
    const row = r.manifest.clips[0]!;
    expect(existsSync(clipPath(s.dataDir, row.hash))).toBe(true);
    expect(readFileSync(clipPath(s.dataDir, row.hash), "utf8")).toBe("STRIPPED:A");
    expect(statSync(clipPath(s.dataDir, row.hash)).mode & 0o222).toBe(0); // read-only
    expect(row).toMatchObject({
      fileName: "IMG_0001.MOV", codec: "h264", videoSamples: 60, deviceClass: "metric-depth", captureMode: "default-session", lens: "camera-picked",
      bookcaseId: "clip-1", caseIdSource: "assumed-per-clip", permission: "permission received", metadataTracksKept: true,
    });
    expect(row.originalHash).not.toBe(row.hash);
    expect(row.tracksBefore.map((t) => t.mediaType)).toEqual(["soun", "vide", "meta"]);
    expect(row.tracksAfter.map((t) => t.mediaType)).toEqual(["vide", "meta"]);
    expect(readClipManifest(s.dataDir, "test-session")!.clips).toHaveLength(1);
    expect(statSync(clipManifestPath(s.dataDir, "test-session")).mode & 0o077).toBe(0);
    expect(readFileSync(join(s.folder, "IMG_0001.MOV"), "utf8")).toBe("A"); // the source is never written
  });

  it("is idempotent: a clip whose original hash is in the manifest is skipped, and case ids stay stable", () => {
    const s = fresh();
    writeFileSync(join(s.folder, "IMG_0001.MOV"), "A");
    const probes = { A: { durationSeconds: 2, tracks: [audio, video(60)] }, B: { durationSeconds: 2, tracks: [audio, video(30)] } };
    const tools = fakeTools(probes);
    clipIngest({ ...s, session: "test-session", tools });
    writeFileSync(join(s.folder, "IMG_0002.MOV"), "B");
    const r = clipIngest({ ...s, session: "test-session", tools });
    expect(r.outcomes.map((o) => o.verdict)).toEqual(["skipped", "stored"]);
    expect(tools.strips).toBe(2);
    expect(r.manifest.clips.map((c) => c.bookcaseId)).toEqual(["clip-1", "clip-2"]);
  });

  it("refuses, and reports, a clip with no video track, a codec that is not H.264 or HEVC, or no capture instant", () => {
    const s = fresh();
    writeFileSync(join(s.folder, "a.mov"), "NOVIDEO");
    writeFileSync(join(s.folder, "b.mov"), "PRORES");
    writeFileSync(join(s.folder, "c.mov"), "HEVC");
    writeFileSync(join(s.folder, "notes.txt"), "ignored");
    const tools = fakeTools({ NOVIDEO: { durationSeconds: 2, tracks: [audio] }, PRORES: { durationSeconds: 2, tracks: [video(60, "apcn")] }, HEVC: { durationSeconds: 2, tracks: [video(60, "hvc1")] } });
    const r = clipIngest({ ...s, session: "test-session", tools });
    expect(r.outcomes.map((o) => [o.verdict, o.reasons])).toEqual([["refused", ["no-video-track"]], ["refused", ["unsupported-codec"]], ["stored", []]]);
    expect(r.manifest.clips[0]!.codec).toBe("hevc");
    expect(r.manifest.refused.map((x) => x.reasons[0])).toEqual(["no-video-track", "unsupported-codec"]);
    const again = clipIngest({ ...s, session: "test-session", tools });
    expect(again.outcomes.map((o) => o.verdict)).toEqual(["skipped", "skipped", "skipped"]);
    expect(again.manifest.refused).toHaveLength(2);

    const t = fresh();
    writeFileSync(join(t.folder, "a.mov"), "A");
    const r2 = clipIngest({ ...t, session: "test-session", tools: fakeTools({ A: { durationSeconds: 2, tracks: [video(60)] } }, { capturedAt: undefined }) });
    expect(r2.outcomes[0]!.reasons).toEqual(["no-capture-time"]);
  });

  it("throws, storing nothing, when the copy's video sample count differs from the original's", () => {
    const s = fresh();
    writeFileSync(join(s.folder, "a.mov"), "A");
    const tools = fakeTools({ A: { durationSeconds: 2, tracks: [audio, video(60)] } });
    const probe = tools.probe;
    tools.probe = (p) => {
      const r = probe(p);
      return readFileSync(p, "utf8").startsWith("STRIPPED:") ? { ...r, tracks: r.tracks.map((x) => ({ ...x, samples: x.samples - 1 })) } : r;
    };
    expect(() => clipIngest({ ...s, session: "test-session", tools })).toThrow(/59 video samples, the original 60/);
    expect(existsSync(join(s.dataDir, "video", "sha256"))).toBe(false);
  });
});

describe.skipIf(!toolsAvailable())("ingest's frame mode, and the still path unchanged", () => {
  const setup = () => {
    const s = fresh();
    // A 128x96 JPEG with no EXIF: below the 12 MP minimum and without a capture time.
    wb.photo(join(`clips-${n - 1}`, "f.jpg"), { width: 128, height: 96, exif: false });
    return s;
  };

  it("the still path still rejects a small JPEG with no EXIF, and stores nothing", () => {
    const s = setup();
    const ledger = new MemoryLedger();
    const r = ingest({ folder: s.folder, session: "test-session", ledger, dataDir: s.dataDir });
    expect(r.outcomes[0]).toMatchObject({ verdict: "rejected", reasons: ["below-min-resolution", "no-exif"] });
    expect(ledger.images()).toEqual([]);
    expect([...ledger.events()][0]!.payload).toMatchObject({ minPixels: 12_000_000 });
  });

  it("frame mode accepts it: its own original and working copy, real-use, the clip's instant, no minimum", () => {
    const s = setup();
    const ledger = new MemoryLedger();
    const r = ingest({
      folder: s.folder, session: "test-session", ledger, dataDir: s.dataDir,
      frames: { "f.jpg": { capturedAt: "2026-01-02T03:04:06.500-07:00", device: "Apple iPhone 17 Pro", nativeSize: true, provenance: { deviceClass: "metric-depth", captureMode: "natural-sweep", bookcaseId: "clip-1" } } },
    });
    expect(r.outcomes[0]).toMatchObject({ verdict: "accepted", setting: "real-use" });
    const [asset] = ledger.images();
    expect(asset).toMatchObject({ format: "jpeg", width: 128, height: 96, setting: "real-use", capturedAt: "2026-01-02T03:04:06.500-07:00" });
    expect(asset!.workingCopyHash).toBe(asset!.imageHash);
    expect(new ImageStore(s.dataDir).has(asset!.imageHash)).toBe(true);
    expect([...ledger.events()][0]!.payload).toMatchObject({ minPixels: 1 });
    expect(publicManifest(ledger, "test-session").photos[0]).toMatchObject({ width: 128, height: 96, setting: "real-use" });
  });

  it("frame mode refuses a file it has no clip facts for, and a file that is not a JPEG", () => {
    const s = setup();
    expect(() => ingest({ folder: s.folder, session: "test-session", ledger: new MemoryLedger(), dataDir: s.dataDir, frames: {} })).toThrow(/no clip facts/);
    writeFileSync(join(s.folder, "g.png"), Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"));
    const ledger = new MemoryLedger();
    const r = ingest({ folder: s.folder, session: "test-session", ledger, dataDir: s.dataDir, frames: { "f.jpg": { capturedAt: "2026-01-02T03:04:06-07:00", device: "Apple iPhone 17 Pro", nativeSize: true } } });
    expect(r.outcomes.map((o) => o.verdict)).toEqual(["accepted", "rejected"]);
    expect(r.outcomes[1]!.reasons).toEqual(["unsupported-format"]);
  });
});

const venvPython = join(FRAMES_ENV, ".venv", "bin", "python");
const pipelineTools = (): boolean => {
  if (!toolsAvailable() || !swiftAvailable() || !existsSync(venvPython)) return false;
  try {
    execFileSync("uv", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

describe.skipIf(!pipelineTools())("clip ingest and frames, end to end (swift, exiftool, opencv)", () => {
  it("strips the audio losslessly, keeps the sharpest frame per second, and enters the frames through ingest", () => {
    const s = fresh();
    const clip = join(s.folder, "IMG_0001.MOV");
    // 20 frames at 10 fps: windows 0 and 1; frames 3 and 14 are the sharp ones.
    execFileSync("swift", ["-suppress-warnings", join(import.meta.dirname, "helpers", "make-clip.swift"), clip, "20", "10", "3,14", "audio"], { stdio: "pipe" });
    execFileSync("exiftool", ["-q", "-overwrite_original", "-Keys:CreationDate=2026:01:02 03:04:05-07:00", "-Keys:Make=Apple", "-Keys:Model=iPhone 17 Pro", clip], { stdio: "pipe" });

    const r = clipIngest({ ...s, session: "test-session" });
    const row = r.manifest.clips[0]!;
    expect(row.tracksBefore.map((t) => t.mediaType)).toEqual(["vide", "soun"]);
    expect(row.tracksAfter.map((t) => t.mediaType)).toEqual(["vide"]);
    expect(row).toMatchObject({ videoSamples: 20, codec: "h264", width: 128, height: 96, capturedAt: "2026-01-02T03:04:05-07:00", device: "Apple iPhone 17 Pro" });
    expect(row.durationSeconds).toBeCloseTo(2, 3);

    const ledger = new MemoryLedger();
    const f = clipFrames({ session: "test-session", dataDir: s.dataDir, ledger });
    expect(f.framesKept).toBe(2);
    const frames = f.manifest.clips[0]!;
    expect(frames.frames.map((x) => x.frameIndex)).toEqual([3, 14]);
    expect(frames).toMatchObject({ decodedFrames: 20, decodedAllSamples: true, extractor: { name: "helpers/video/frames.py", backend: "FFMPEG" } });
    expect(ledger.images().map((i) => i.capturedAt)).toEqual(["2026-01-02T03:04:05.300-07:00", "2026-01-02T03:04:06.400-07:00"]);
    expect(ledger.images().every((i) => i.setting === "real-use" && i.imageHash === i.workingCopyHash)).toBe(true);
    expect(readLineage(frameManifestPath(s.dataDir, "test-session"))?.schema).toEqual({ name: "clip-frames", version: 1 });
    const priv = JSON.parse(readFileSync(privateManifestPath(s.dataDir, "test-session"), "utf8")) as PrivateManifest;
    expect(priv.photos.map((p) => [p.nativeSize, p.provenance])).toEqual([
      [true, { deviceClass: "metric-depth", captureMode: "natural-sweep", bookcaseId: "clip-1" }],
      [true, { deviceClass: "metric-depth", captureMode: "natural-sweep", bookcaseId: "clip-1" }],
    ]);

    // Re-running does nothing new.
    const again = clipFrames({ session: "test-session", dataDir: s.dataDir, ledger });
    expect([again.clipsDone, again.clipsSkipped, ledger.images().length]).toEqual([0, 1, 2]);
    const counts = sessionCounts(s.dataDir, "test-session", (h) => new ImageStore(s.dataDir).find(h));
    expect(counts).toMatchObject({ clips: 1, audioFree: 1, samplesEqual: 1, framesKept: 2, decodedAllSamples: 1 });
  }, 120_000);
});

describe("set roles and backup class (NS-K)", () => {
  it("declares the two NS-K sessions: the first a training source, the second held out", () => {
    expect(roleOf("sf-store-001")).toBe("training-source");
    expect(isTrainable("sf-store-001")).toBe(true);
    expect(roleOf("sf-store-002")).toBe("held-out");
    expect(isTrainable("sf-store-002")).toBe(false);
    expect(() => assertManifestable("sf-store-002")).not.toThrow();
  });

  it("classes the audio-free clips as facts and leaves the inbox unclassified", () => {
    expect(classOfPath(join("video", "sha256", "ab", `${"ab".repeat(32)}.mov`))).toBe("fact");
    expect(classOfPath(join("inbox", "some-export", "a.mov"))).toBe("unclassified");
    expect(classOfPath(join("private", "fixtures", "sf-store-001", "clips.json"))).toBe("fact");
  });
});
