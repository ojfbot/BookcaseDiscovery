// `bookcase models <manifest|list>`: the model-weights manifest (DL-3, src/ledger/models.ts). The weights and the
// manifest stay under the data root; this prints names, revisions, hashes and counts only.
import { parseArgs } from "node:util";
import { buildModelsManifest, manifestPath, readModelsManifest } from "../ledger/models.ts";

export const modelsUsage = `usage: bookcase models <command>

commands:
  manifest   build or refresh $BOOKCASE_DATA/models/manifest.json: every folder under models/, its name, download
             revision and a content hash of its files. A file whose size and mtime have not moved keeps its hash,
             so a refresh never re-hashes unchanged weights.
  list       print the manifest: name, revision, hash, files, size

Lineage stamps (docs/lineage.md) name models by these hashes, and readers refuse a derived file whose stamp names
other weights than the manifest does now. Run \`manifest\` once after any model folder changes.`;

const gb = (b: number): string => `${(b / 1e9).toFixed(2)} GB`;

export async function modelsCommand(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, options: { help: { type: "boolean", short: "h" } } });
  } catch (e) {
    console.error(`bookcase models: ${e instanceof Error ? e.message : e}\n\n${modelsUsage}`);
    return 1;
  }
  const [cmd] = parsed.positionals;
  if (parsed.values.help || !cmd) {
    console.log(modelsUsage);
    return parsed.values.help ? 0 : 1;
  }
  try {
    if (cmd === "manifest") {
      const r = await buildModelsManifest(undefined, { log: (s) => console.error(s) });
      console.log(`${Object.keys(r.manifest.models).length} models: hashed ${r.hashed} files (${gb(r.bytesHashed)}), reused ${r.reused}, in ${r.seconds.toFixed(1)} s`);
      return 0;
    }
    if (cmd === "list") {
      const m = readModelsManifest();
      if (!m) {
        console.error(`no manifest at ${manifestPath()}: run \`bookcase models manifest\``);
        return 1;
      }
      console.log(`${Object.keys(m.models).length} models (written ${m.writtenAt})`);
      for (const e of Object.values(m.models)) console.log(`${e.name.padEnd(32)} ${(e.revision ?? "-").slice(0, 12).padEnd(13)} ${e.hash.slice(0, 19)} ${String(e.files).padStart(4)} files ${gb(e.bytes).padStart(9)}`);
      return 0;
    }
  } catch (e) {
    console.error(`bookcase models ${cmd}: ${e instanceof Error ? e.message : e}`);
    return 1;
  }
  console.error(`bookcase models: unknown command "${cmd}"\n\n${modelsUsage}`);
  return 1;
}
