import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { main } from "../src/run/index.ts";

const modules = ["capture", "perceive", "identify", "recommend", "ledger", "report", "eval", "run"];

describe("scaffold", () => {
  it.each(modules)("module %s loads", async (name) => {
    const mod = await import(`../src/${name}/index.ts`);
    expect(mod.moduleName).toBe(name);
  });

  it("CLI prints usage and rejects unknown commands", () => {
    expect(main(["--help"])).toBe(0);
    expect(main(["nope"])).toBe(1);
  });

  it("bin/bookcase runs under plain node", () => {
    const out = execFileSync("node", ["bin/bookcase", "--help"], { encoding: "utf8" });
    expect(out).toContain("usage: bookcase");
  });
});
