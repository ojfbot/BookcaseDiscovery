// `pnpm report:synthetic [dir]`: write the synthetic report (generated shelf, invented titles; no photo is
// involved) to <dir>/reports/synthetic-shelf-001/run-synthetic-001/index.html. Default dir: a fresh temp folder.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { writeReport } from "../src/report/index.ts";
import { syntheticReport } from "../test/helpers/report-fixture.ts";

const dataDir = process.argv[2] ? resolve(process.argv[2]) : mkdtempSync(join(tmpdir(), "bookcase-synthetic-report-"));
const fx = syntheticReport(dataDir);
const out = writeReport({ ledger: fx.ledger, session: fx.session, dataDir });
for (const w of out.warnings) console.error(`warning: ${w}`);
console.log(out.index);
