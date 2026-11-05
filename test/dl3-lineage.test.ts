// DL-3: lineage stamps on derived files, the model-weights manifest, readers that refuse stale or unstamped files,
// and the one-time re-stamp pass. Everything runs on a synthetic data root with tiny "weights".
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = mkdtempSync(join(tmpdir(), "dl3-"));
process.env.BOOKCASE_DATA = root;
delete process.env.BOOKCASE_ALLOW_STALE;

const { checkLineage, codeCommit, lineageDiff, lineagePath, LineageError, makeStamp, readLineage, restampedStamp, staleAllowed, writeLineage } = await import("../src/ledger/lineage.ts");
const { buildModelsManifest, manifestPath, modelFiles, modelHashes, readModelsManifest, recordedRevisions, resetModelsManifestCache } = await import("../src/ledger/models.ts");
const { loadReadings, stageExpect, stageStamp, STAGE_SCHEMAS } = await import("../src/eval/f0.ts");
const { classOf, DATASET_SCHEMA, PARTITION_SCHEMA } = await import("../src/eval/lineage-classes.ts");
const { commitVersion, datasetDir } = await import("../src/eval/ts0-cli.ts");
const { restamp } = await import("../src/run/lineage-cli.ts");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const REV = "0123456789abcdef0123456789abcdef01234567";
const MODELS = ["alpha", "beta", "grounding-dino-base", "owlv2-base-patch16-ensemble", "sam2.1-hiera-base-plus", "pp-ocrv5", "qwen3-vl-4b-8bit", "moge-2-vitl-normal"];

function write(path: string, text: string | Buffer): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** A synthetic models folder: a few small files per model, one with a Hugging Face download cache beside the weights. */
function syntheticModels(): void {
  for (const m of MODELS) {
    write(join(root, "models", m, "config.json"), `{"model":"${m}"}\n`);
    write(join(root, "models", m, "model.safetensors"), Buffer.from(`weights-of-${m}`.repeat(50)));
  }
  write(join(root, "models", "alpha", ".cache", "huggingface", "download", "model.safetensors.metadata"), `${REV}\n"etag"\n1700000000\n`);
  write(join(root, "models", "pp-ocrv5", "server_det", "inference.pdiparams"), Buffer.from("det".repeat(100)));
}

beforeAll(async () => {
  syntheticModels();
  await buildModelsManifest(root);
});

describe("the models manifest", () => {
  it("names every model folder with its revision, file count and a content hash; the download cache is left out", async () => {
    const m = readModelsManifest(root, { fresh: true })!;
    expect(Object.keys(m.models).sort()).toEqual([...MODELS].sort());
    expect(m.models.alpha).toMatchObject({ name: "alpha", revision: REV, files: 2 });
    expect(m.models.alpha!.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(m.models.beta!.revision).toBeNull();
    expect(m.models["pp-ocrv5"]!.files).toBe(3);
    expect(modelFiles(join(root, "models", "alpha"))).toEqual(["config.json", "model.safetensors"]);
    expect(recordedRevisions(join(root, "models", "alpha"))).toEqual([REV]);
    expect(existsSync(manifestPath(root))).toBe(true);
  });

  it("hashes by content: two folders with the same files hash the same, and the hash does not move with the folder name", async () => {
    write(join(root, "models", "alpha-copy", "config.json"), `{"model":"alpha"}\n`);
    write(join(root, "models", "alpha-copy", "model.safetensors"), Buffer.from(`weights-of-alpha`.repeat(50)));
    const r = await buildModelsManifest(root);
    expect(r.manifest.models["alpha-copy"]!.hash).toBe(r.manifest.models.alpha!.hash);
    rmSync(join(root, "models", "alpha-copy"), { recursive: true });
    // A folder that is gone is dropped on the next refresh.
    expect((await buildModelsManifest(root)).manifest.models["alpha-copy"]).toBeUndefined();
  });

  it("does not re-hash a file whose size and mtime have not moved, and re-hashes one that has", async () => {
    const before = readModelsManifest(root, { fresh: true })!;
    const again = await buildModelsManifest(root);
    expect(again.hashed).toBe(0);
    expect(again.reused).toBe(Object.keys(again.manifest.files).length);
    expect(again.manifest.models).toEqual(before.models);

    const w = join(root, "models", "beta", "model.safetensors");
    writeFileSync(w, Buffer.from("other-weights".repeat(60)));
    utimesSync(w, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const changed = await buildModelsManifest(root);
    expect(changed.hashed).toBe(1);
    expect(changed.manifest.models.beta!.hash).not.toBe(before.models.beta!.hash);
    expect(changed.manifest.models.alpha!.hash).toBe(before.models.alpha!.hash);
  });

  it("`modelHashes` names the command when a model is missing", () => {
    expect(() => modelHashes(["nothing-here"], root)).toThrow(/bookcase models manifest/);
    expect(modelHashes([], root)).toEqual({});
    expect(() => modelHashes(["alpha"], join(root, "no-such-root"))).toThrow(/no models manifest/);
  });
});

describe("a lineage stamp", () => {
  it("round-trips through its sidecar and passes its own check", () => {
    const file = join(root, "round", "x.jsonl");
    write(file, '{"a":1}\n');
    const stamp = makeStamp({ schema: { name: "test/x", version: 3 }, boxSet: "b".repeat(64), models: { zeta: "sha256:z", alpha: "sha256:a" }, catalog: "sha256:c" });
    writeLineage(file, stamp);
    expect(lineagePath(file)).toBe(`${file}.lineage.json`);
    expect(readLineage(file)).toEqual(stamp);
    expect(Object.keys(stamp.models)).toEqual(["alpha", "zeta"]);
    expect(checkLineage(file, { schema: stamp.schema, boxSet: stamp.boxSet!, models: stamp.models, catalog: stamp.catalog! })).toEqual(stamp);
    expect(stamp.writtenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records the code commit once per process, or null outside a repository", () => {
    const c = codeCommit();
    expect(c.commit === null || /^[0-9a-f]{40}$/.test(c.commit)).toBe(true);
    expect(typeof c.dirty).toBe("boolean");
    expect(codeCommit(root)).toEqual({ commit: null, dirty: false });
  });

  it("names the field that differs, in a fixed order", () => {
    const stamp = makeStamp({ schema: { name: "test/x", version: 1 }, boxSet: "b1", models: { alpha: "sha256:a", beta: "sha256:b" }, catalog: "sha256:c" });
    expect(lineageDiff(stamp, { schema: { name: "test/x", version: 1 }, models: { alpha: "sha256:a" } })).toEqual([]);
    expect(lineageDiff(stamp, { models: { beta: "sha256:B" } }).map((d) => d.field)).toEqual(["models.beta"]);
    expect(lineageDiff(stamp, { models: { gamma: "sha256:g" } })).toEqual([{ field: "models.gamma", stamped: null, current: "sha256:g" }]);
    expect(lineageDiff(stamp, { schema: { name: "test/x", version: 2 }, boxSet: "b2", models: { alpha: "sha256:A" }, catalog: "sha256:C" }).map((d) => d.field)).toEqual([
      "schema.version",
      "boxSet",
      "models.alpha",
      "catalog",
    ]);
  });
});

describe("readers refuse stale and unstamped files", () => {
  const file = join(root, "refuse", "qwen.jsonl");
  beforeAll(() => {
    write(file, '{"id":"p:0","reader":"qwen","variants":[]}\n');
  });

  it("an unstamped file is refused, naming the re-stamp pass; --allow-stale reads it", () => {
    expect(() => checkLineage(file, { schema: STAGE_SCHEMAS.qwen })).toThrow(/no lineage stamp.*bookcase lineage restamp/);
    try {
      checkLineage(file, { schema: STAGE_SCHEMAS.qwen });
    } catch (e) {
      expect(e).toBeInstanceOf(LineageError);
      expect((e as InstanceType<typeof LineageError>).field).toBe("stamp");
    }
    const logged: string[] = [];
    expect(checkLineage(file, { schema: STAGE_SCHEMAS.qwen }, { allowStale: true, log: (s) => logged.push(s) })).toBeNull();
    expect(logged).toHaveLength(1);
  });

  it("a changed model hash is refused with the model named; a missing file is nothing to refuse", () => {
    writeLineage(file, makeStamp({ schema: STAGE_SCHEMAS.qwen, models: { "qwen3-vl-4b-8bit": "sha256:old" } }));
    const expect_ = { schema: STAGE_SCHEMAS.qwen, models: { "qwen3-vl-4b-8bit": "sha256:new" } };
    expect(() => checkLineage(file, expect_)).toThrow(/stale: models\.qwen3-vl-4b-8bit is sha256:old in the stamp, sha256:new now/);
    try {
      checkLineage(file, expect_);
    } catch (e) {
      expect((e as InstanceType<typeof LineageError>).field).toBe("models.qwen3-vl-4b-8bit");
    }
    expect(checkLineage(file, expect_, { allowStale: true, log: () => {} })!.models["qwen3-vl-4b-8bit"]).toBe("sha256:old");
    expect(checkLineage(join(root, "refuse", "absent.jsonl"), expect_)).toBeNull();
  });

  it("a changed catalog, box set or schema version is refused with that field named", () => {
    writeLineage(file, makeStamp({ schema: { name: "f0/reading", version: 1 }, boxSet: "b1", catalog: "sha256:c1" }));
    expect(() => checkLineage(file, { catalog: "sha256:c2" })).toThrow(/stale: catalog is/);
    expect(() => checkLineage(file, { boxSet: "b2" })).toThrow(/stale: boxSet is/);
    expect(() => checkLineage(file, { schema: { name: "f0/reading", version: 2 } })).toThrow(/stale: schema\.version is 1 in the stamp, 2 now/);
    expect(() => checkLineage(file, (s) => ({ catalog: `${s.catalog}-moved` }))).toThrow(/catalog/);
  });

  it("`--allow-stale` on the command line or BOOKCASE_ALLOW_STALE=1 lets a stale file through", () => {
    expect(staleAllowed([], {})).toBe(false);
    expect(staleAllowed(["node", "x", "--allow-stale"], {})).toBe(true);
    expect(staleAllowed([], { BOOKCASE_ALLOW_STALE: "1" })).toBe(true);
  });

  it("`loadReadings` refuses a reader's cache whose weights the manifest no longer names", () => {
    const dir = join(root, "readings");
    for (const r of ["vision", "ppocr", "qwen"] as const) {
      write(join(dir, `${r}.jsonl`), `{"id":"p:0","reader":"${r}","variants":[{"rotation":90,"text":"x","confidence":1}],"seconds":1}\n`);
      writeLineage(join(dir, `${r}.jsonl`), stageStamp(r, [], root));
    }
    expect(loadReadings(dir).get("p:0")!.qwen!.reader).toBe("qwen");
    // The weights change: the manifest's hash for qwen moves, and the cache is stale.
    const m = readModelsManifest(root, { fresh: true })!;
    const old = m.models["qwen3-vl-4b-8bit"]!.hash;
    m.models["qwen3-vl-4b-8bit"]!.hash = "sha256:" + "f".repeat(64);
    writeFileSync(manifestPath(root), JSON.stringify(m));
    resetModelsManifestCache();
    expect(() => loadReadings(dir)).toThrow(/qwen\.jsonl: stale: models\.qwen3-vl-4b-8bit/);
    process.env.BOOKCASE_ALLOW_STALE = "1";
    try {
      expect(loadReadings(dir).size).toBe(1);
    } finally {
      delete process.env.BOOKCASE_ALLOW_STALE;
    }
    m.models["qwen3-vl-4b-8bit"]!.hash = old;
    writeFileSync(manifestPath(root), JSON.stringify(m));
    resetModelsManifestCache();
    expect(loadReadings(dir).size).toBe(1);
  });

  it("a stage's expectation names its arms' and its reader's models from the manifest", () => {
    expect(Object.keys(stageExpect("detect", ["b2"], root).models!)).toEqual(["grounding-dino-base", "sam2.1-hiera-base-plus"]);
    expect(Object.keys(stageExpect("ppocr", [], root).models!)).toEqual(["pp-ocrv5"]);
    expect(stageExpect("vision", [], root).models).toEqual({});
    expect(stageExpect("probe", [], root).schema).toEqual({ name: "f0/probe", version: 2 });
  });
});

describe("TS-0's version files carry the stamp", () => {
  it("`commitVersion` writes one sidecar per file, after the file", () => {
    const r = join(root, "ts0");
    const dir = join(datasetDir(r), "v-abc");
    const stamp = makeStamp({ schema: DATASET_SCHEMA, boxSet: "b".repeat(64), models: { alpha: "sha256:a" }, catalog: "sha256:c" });
    commitVersion(r, dir, { "manifest.json": "{}\n", "labels.jsonl": "", "build.json": "{}\n" }, { photos: {} } as never, "v-abc", stamp);
    for (const f of ["manifest.json", "labels.jsonl", "build.json"]) expect(readLineage(join(dir, f))).toEqual(stamp);
    expect(readLineage(join(datasetDir(r), "latest.json"))).toBeNull();
  });
});

describe("file classes", () => {
  it("are known by name and folder", () => {
    expect(classOf("f0/pilot-000/detect.jsonl")).toEqual({ kind: "stage", stage: "detect" });
    expect(classOf("f0e/pilot-000/bands+strips/qwen.jsonl")).toEqual({ kind: "stage", stage: "qwen" });
    expect(classOf("private/h2/pilot-000/stage-latest.jsonl")).toEqual({ kind: "depth-stage" });
    expect(classOf("private/h2/pilot-000/faces.jsonl")).toEqual({ kind: "faces" });
    expect(classOf("private/f0i/pilot-000/partition.jsonl")).toEqual({ kind: "partition" });
    expect(classOf("datasets/label-ledger/v-1/labels.jsonl")).toEqual({ kind: "dataset" });
    expect(classOf("datasets/label-ledger/splits.json")).toBeNull();
    expect(classOf("f0/pilot-000/decisions.jsonl")).toBeNull();
    expect(classOf("private/h2/pilot-000/images.jsonl")).toBeNull();
  });
});

describe("the re-stamp pass", () => {
  const r = join(root, "restamp-root");
  const files = {
    detect: join(r, "f0", "s1", "detect.jsonl"),
    probe: join(r, "f0", "s1", "probe.jsonl"),
    vision: join(r, "f0", "s1", "vision.jsonl"),
    ppocr: join(r, "f0e", "s1", "bands", "ppocr.jsonl"),
    qwen: join(r, "f0e", "s1", "bands", "qwen.jsonl"),
    stage: join(r, "private", "h2", "s1", "stage-latest.jsonl"),
    faces: join(r, "private", "h2", "s1", "faces.jsonl"),
    partition: join(r, "private", "f0i", "s1", "partition.jsonl"),
    manifest: join(r, "datasets", "label-ledger", "v-1", "manifest.json"),
    labels: join(r, "datasets", "label-ledger", "v-1", "labels.jsonl"),
    build: join(r, "datasets", "label-ledger", "v-1", "build.json"),
  };

  beforeAll(async () => {
    write(files.detect, '{"id":"p","arm":"b3","spines":[]}\n{"id":"q","spines":[]}\n');
    write(files.probe, '{"id":"p:0","version":2,"white":0,"edges":0}\n');
    write(files.vision, '{"id":"p:0","reader":"vision","variants":[]}\n');
    write(files.ppocr, '{"id":"p:0","reader":"ppocr","variants":[]}\n');
    write(files.qwen, '{"id":"p:0","reader":"qwen","variants":[]}\n');
    write(files.stage, '{"id":"p","box":0}\n');
    write(files.faces, '{"id":"p:0"}\n');
    write(files.partition, '{"id":"p:0","state":"kept"}\n');
    write(files.manifest, "{}\n");
    write(files.labels, "");
    write(files.build, `{"version":"v-1","boxSet":"${"b".repeat(64)}","sets":["pilot-000"]}\n`);
    // Things the pass must leave alone: inputs, a decisions file, a torn tail, the frozen splits.
    write(join(r, "f0", "s1", "decisions.jsonl"), "{}\n");
    write(join(r, "f0", "s1", "detect.jsonl.torn"), "{");
    write(join(r, "datasets", "label-ledger", "splits.json"), "{}\n");
    write(join(r, "images", "sha256", "ab", "x.jpg"), "");
    write(join(r, "private", "h2", "cache", "geometry", "k.json"), "{}\n");
    // The manifest with the models the classes name.
    mkdirSync(join(r, "models"), { recursive: true });
    for (const m of MODELS) write(join(r, "models", m, "w.bin"), m);
    await buildModelsManifest(r);
  });

  it("refuses to run without a models manifest", async () => {
    await expect(restamp(join(root, "empty-root"))).rejects.toThrow(/bookcase models manifest/);
  });

  it("stamps every file of a known class once, records what it assumed, and is idempotent", async () => {
    const dry = await restamp(r, { dryRun: true });
    expect(dry.found).toBe(11);
    expect(dry.stamped).toBe(11);
    expect(existsSync(lineagePath(files.detect))).toBe(false);

    const first = await restamp(r, { now: new Date("2026-11-05T12:00:00Z") });
    expect(first).toMatchObject({ found: 11, stamped: 11, already: 0 });
    expect(first.byClass).toEqual({
      "f0/detect": { found: 1, stamped: 1, already: 0 },
      "f0/probe": { found: 1, stamped: 1, already: 0 },
      "f0/vision": { found: 1, stamped: 1, already: 0 },
      "f0/ppocr": { found: 1, stamped: 1, already: 0 },
      "f0/qwen": { found: 1, stamped: 1, already: 0 },
      "depth-stage": { found: 1, stamped: 1, already: 0 },
      faces: { found: 1, stamped: 1, already: 0 },
      partition: { found: 1, stamped: 1, already: 0 },
      dataset: { found: 3, stamped: 3, already: 0 },
    });
    const detect = readLineage(files.detect)!;
    // Arms from the rows: b3 and (no arm) b2.
    expect(Object.keys(detect.models)).toEqual(["grounding-dino-base", "owlv2-base-patch16-ensemble", "sam2.1-hiera-base-plus"]);
    expect(detect.restamped).toEqual({ at: "2026-11-05T12:00:00.000Z", assumed: ["models"] });
    expect(detect.codeCommit).toEqual({ commit: null, dirty: false });
    expect(readLineage(files.vision)!.restamped!.assumed).toEqual([]);
    expect(readLineage(files.partition)!.schema).toEqual(PARTITION_SCHEMA);
    expect(Object.keys(readLineage(files.partition)!.models)).toEqual(["moge-2-vitl-normal", "sam2.1-hiera-base-plus"]);
    const build = readLineage(files.build)!;
    expect(build.boxSet).toBe("b".repeat(64));
    expect(build.catalog).toBeNull();
    expect(build.restamped!.assumed).toEqual(["catalog", "models"]);
    expect(Object.keys(build.models)).toEqual(["pp-ocrv5", "qwen3-vl-4b-8bit"]);
    expect(readLineage(files.labels)).toEqual(build);
    for (const p of [join(r, "f0", "s1", "decisions.jsonl"), join(r, "datasets", "label-ledger", "splits.json"), join(r, "private", "h2", "cache", "geometry", "k.json")]) expect(existsSync(lineagePath(p))).toBe(false);
    expect(existsSync(`${files.detect}.torn.lineage.json`)).toBe(false);

    const sidecars = Object.values(files).map((f) => readFileSync(lineagePath(f), "utf8"));
    const second = await restamp(r);
    expect(second).toMatchObject({ found: 11, stamped: 0, already: 11 });
    expect(Object.values(files).map((f) => readFileSync(lineagePath(f), "utf8"))).toEqual(sidecars);
  });

  it("a re-stamped file passes its reader's check, and the stamp is a stamp", () => {
    expect(checkLineage(files.detect, stageExpect("detect", ["b2", "b3"], r))).not.toBeNull();
    expect(checkLineage(files.qwen, stageExpect("qwen", [], r))).not.toBeNull();
    expect(restampedStamp({ schema: STAGE_SCHEMAS.detect }, ["models"]).lineageVersion).toBe(1);
  });
});
