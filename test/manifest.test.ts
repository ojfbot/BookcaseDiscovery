// K-3: the public and private fixture manifests, and the real-use setting.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ingest, isNativeSize, lensClass, manifestCommand, privateManifest, publicManifest, ingestCommand, sessionLedgerPath } from "../src/capture/index.ts";
import { MemoryLedger, SqliteLedger } from "../src/ledger/index.ts";
import { fixtureManifestSchemaErrors } from "../src/ledger/schemas.ts";
import { toolsAvailable, Workbench } from "./helpers/synth.ts";

const H = (c: string) => c.repeat(64);

describe("public manifest schema", () => {
  const ok = { schemaVersion: 1, session: "pilot-000", photos: [{ hash: H("a"), workingCopyHash: H("b"), format: "jpeg", width: 4, height: 3, setting: "real-use" }], rejected: [] };

  it("accepts a real-use photo with no shelf index, and a flagged one", () => {
    expect(fixtureManifestSchemaErrors(ok)).toEqual([]);
    expect(fixtureManifestSchemaErrors({ ...ok, photos: [{ ...ok.photos[0], flags: ["edited-derivative"] }] })).toEqual([]);
  });

  it("refuses capture time, GPS, store, file names and anything else not listed", () => {
    for (const extra of [{ capturedAt: "2026-01-02T03:04:05Z" }, { gps: { lat: 1 } }, { store: "x" }, { fileName: "IMG_1.jpeg" }, { location: "x" }]) {
      expect(fixtureManifestSchemaErrors({ ...ok, photos: [{ ...ok.photos[0], ...extra }] }), JSON.stringify(extra)).not.toEqual([]);
    }
    expect(fixtureManifestSchemaErrors({ ...ok, store: "x" })).not.toEqual([]);
    expect(fixtureManifestSchemaErrors({ ...ok, rejected: [{ reasons: ["no-exif"], fileName: "x" }] })).not.toEqual([]);
  });

  it("refuses a bad hash, setting, session or an unexplained reject", () => {
    expect(fixtureManifestSchemaErrors({ ...ok, photos: [{ ...ok.photos[0], hash: "xyz" }] })).not.toEqual([]);
    expect(fixtureManifestSchemaErrors({ ...ok, photos: [{ ...ok.photos[0], setting: "handheld" }] })).not.toEqual([]);
    expect(fixtureManifestSchemaErrors({ ...ok, session: "Pilot 000" })).not.toEqual([]);
    expect(fixtureManifestSchemaErrors({ ...ok, rejected: [{ reasons: [] }] })).not.toEqual([]);
  });
});

describe("isNativeSize", () => {
  it("knows the camera's 48 MP and 12 MP grids in both orientations, and not a resample", () => {
    expect([[8064, 6048], [6048, 8064], [4032, 3024], [3024, 4032]].map(([w, h]) => isNativeSize(w!, h!))).toEqual([true, true, true, true]);
    expect([[7488, 5616], [5522, 7362], [200, 100]].map(([w, h]) => isNativeSize(w!, h!))).toEqual([false, false, false]);
  });
});

describe("lensClass (OC35)", () => {
  it("uses the 35 mm equivalent when recorded, else the real focal length", () => {
    expect(lensClass(2.22, 13)).toBe("ultra-wide");
    expect(lensClass(6.77, 24)).toBe("main");
    expect(lensClass(15.66, 120)).toBe("telephoto");
    expect(lensClass(2.22)).toBe("ultra-wide");
    expect(lensClass(6.77)).toBe("main");
    expect(lensClass(9)).toBe("telephoto");
    expect(lensClass()).toBe("unknown");
  });
});

describe.skipIf(!toolsAvailable())("manifests from an ingest (synthetic photos)", () => {
  const wb = new Workbench();
  afterAll(() => wb.cleanup());

  let n = 0;
  function ingested() {
    const id = n++;
    const folder = `in-${id}`;
    mkdirSync(wb.path(folder));
    wb.photo(`${folder}/IMG_0001.jpg`, { width: 200, height: 100, gps: true, lens: { focalLength: 2.22, focalLength35: 13 } });
    wb.photo(`${folder}/IMG_0002.jpg`, { width: 100, height: 200, orientation: 6, exif: { software: "Photoshop 25" }, lens: { focalLength: 6.77, focalLength35: 24 } });
    wb.photo(`${folder}/IMG_0003.jpg`, { width: 10, height: 10, exif: false });
    const ledger = new MemoryLedger();
    const result = ingest({
      folder: wb.path(folder),
      session: "synthetic-000",
      ledger,
      dataDir: wb.path(`data-${id}`),
      minPixels: 10_000,
      settings: { "IMG_0001.jpg": "real-use", "IMG_0002.jpg": "real-use", "IMG_0003.jpg": "real-use" },
    });
    return { ledger, result };
  }

  it("the public manifest has hashes, dimensions, setting and the flag, sorted by hash, and validates", () => {
    const { ledger } = ingested();
    const m = publicManifest(ledger, "synthetic-000");
    expect(fixtureManifestSchemaErrors(m)).toEqual([]);
    expect(m.photos.map((p) => p.hash)).toEqual([...m.photos.map((p) => p.hash)].sort());
    // the portrait-by-tag photo is stored 100x200 and its working copy is 200x100: the manifest has the working copy's size
    expect(m.photos.map((p) => [p.width, p.height, p.setting, "shelfIndex" in p, p.flags ?? null]).sort()).toEqual(
      [[200, 100, "real-use", false, null], [200, 100, "real-use", false, ["edited-derivative"]]].sort(),
    );
    expect(m.rejected).toHaveLength(1);
    expect(m.rejected[0]!.reasons).toEqual(["below-min-resolution", "no-exif"]);
  });

  it("the public manifest carries nothing private: no capture time, file name, device or lens", () => {
    const text = JSON.stringify(publicManifest(ingested().ledger, "synthetic-000"));
    for (const secret of ["2026", "IMG_000", "Apple", "iPhone", "ultra-wide", "main", "gps", "GPS", "captured"]) expect(text, secret).not.toContain(secret);
  });

  it("the private manifest has file names, capture instants, device, lens class and edit status, and no GPS", () => {
    const { result } = ingested();
    const m = privateManifest(result);
    expect(m.photos.map((p) => [p.fileName, p.setting, p.lens.class, p.edited, p.capturedAt])).toEqual([
      ["IMG_0001.jpg", "real-use", "ultra-wide", false, "2026-01-02T03:04:05-07:00"],
      ["IMG_0002.jpg", "real-use", "main", true, "2026-01-02T03:04:05-07:00"],
    ]);
    expect(m.photos[1]).toMatchObject({ storedWidth: 100, storedHeight: 200, width: 200, height: 100, orientation: 6, derivativeSignals: ["Software tag"], device: "Apple iPhone Test" });
    expect(m.rejected).toMatchObject([{ fileName: "IMG_0003.jpg", reasons: ["below-min-resolution", "no-exif"] }]);
    expect(JSON.stringify(m)).not.toMatch(/gps|latitude|longitude/i);
  });

  it("an empty session makes no manifest", () => {
    expect(() => publicManifest(new MemoryLedger(), "nothing-here")).toThrow(/no photos/);
  });

  it("bookcase manifest rebuilds the public manifest from the SQLite ledger", () => {
    const dir = mkdtempSync(join(tmpdir(), "bookcase-manifest-"));
    try {
      mkdirSync(wb.path("cli"));
      wb.photo("cli/IMG_0001.jpg", { width: 200, height: 100 });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const env = { BOOKCASE_DATA: join(dir, "data") };
        const settings = join(dir, "map.json");
        writeFileSync(settings, JSON.stringify({ "IMG_0001.jpg": "real-use" }));
        expect(ingestCommand([wb.path("cli"), "--session", "synthetic-001", "--settings", settings, "--min-pixels", "10000"], env)).toBe(0);
        const out = join(dir, "repo", "fixtures", "synthetic-001", "manifest.json");
        expect(manifestCommand(["synthetic-001", "--out", out], env)).toBe(0);
        const written = JSON.parse(readFileSync(out, "utf8"));
        expect(fixtureManifestSchemaErrors(written)).toEqual([]);
        expect(written.photos).toHaveLength(1);
        expect(readFileSync(out, "utf8").endsWith("}\n")).toBe(true);
        // missing ledger and bad usage exit 1 and write nothing
        expect(manifestCommand(["nope", "--out", join(dir, "x.json")], env)).toBe(1);
        expect(manifestCommand([], env)).toBe(1);
        expect(existsSync(join(dir, "x.json"))).toBe(false);
        // the ledger is the only input: the manifest is rebuilt byte for byte
        const again = join(dir, "again.json");
        expect(manifestCommand(["synthetic-001", "--out", again], env)).toBe(0);
        expect(readFileSync(again, "utf8")).toBe(readFileSync(out, "utf8"));
        expect(readdirSync(join(dir, "data", "ledger"))).toContain("synthetic-001.sqlite");
        const db = new SqliteLedger(sessionLedgerPath(env.BOOKCASE_DATA, "synthetic-001"), { readOnly: true });
        db.close();
      } finally {
        log.mockRestore();
        err.mockRestore();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("committed fixture manifests (fixtures/<session>/manifest.json)", () => {
  const root = new URL("../fixtures/", import.meta.url);
  const sessions = existsSync(root) ? readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];

  it("there is one for pilot-000", () => {
    expect(sessions).toContain("pilot-000");
  });

  for (const session of sessions) {
    it(`${session}: validates, names its own folder, and is internally consistent`, () => {
      const m = JSON.parse(readFileSync(new URL(`${session}/manifest.json`, root), "utf8"));
      expect(fixtureManifestSchemaErrors(m)).toEqual([]);
      expect(m.session).toBe(session);
      const hashes = m.photos.map((p: { hash: string }) => p.hash);
      expect(hashes).toEqual([...hashes].sort());
      expect(new Set(hashes).size).toBe(hashes.length);
      expect(new Set(m.photos.map((p: { workingCopyHash: string }) => p.workingCopyHash)).size).toBe(hashes.length);
      expect(readdirSync(new URL(`${session}/`, root))).toEqual(["manifest.json"]); // a manifest and nothing else: no images
    });
  }

  it("pilot-000: 31 accepted, none rejected, every photo real-use and without a shelf index", () => {
    const m = JSON.parse(readFileSync(new URL("pilot-000/manifest.json", root), "utf8"));
    expect(m.photos).toHaveLength(31);
    expect(m.rejected).toEqual([]);
    expect(m.photos.every((p: { setting: string; shelfIndex?: number }) => p.setting === "real-use" && p.shelfIndex === undefined)).toBe(true);
    expect(m.photos.filter((p: { flags?: string[] }) => p.flags?.includes("edited-derivative"))).toHaveLength(23);
  });
});
