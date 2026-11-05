// DL-5: never-train by declared set role, not by name (src/eval/set-roles.ts), and every exporter and trainer on the one
// guard: TS-0's rows and manifest, TS-2's training rows, MM-1's evaluation-only mark (MM-2's gallery reads it).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isEvaluationOnly } from "../src/eval/mm1.ts";
import { assertTrainable, isTrainable, NEVER_TRAIN_NAME, refusal, roleOf, SET_REGISTRY, SET_ROLES, setsByRole, type SetRegistry } from "../src/eval/set-roles.ts";
import { build } from "../src/eval/ts0-cli.ts";
import { assertTrainable as ts0Guard, type LabelRow } from "../src/eval/ts0.ts";
import { trainRows } from "../src/eval/ts2.ts";

describe("the registry", () => {
  it("declares a known role for every set", () => {
    for (const role of Object.values(SET_REGISTRY)) expect(SET_ROLES).toContain(role);
  });

  it("declares pilot-000 as the only training source today", () => {
    expect(Object.entries(SET_REGISTRY).filter(([, r]) => r === "training-source").map(([s]) => s)).toEqual(["pilot-000"]);
    expect(setsByRole()["training-source"]).toBe(1);
  });

  it("names no training source the way an evaluation set is named (the two checks agree)", () => {
    for (const [set, role] of Object.entries(SET_REGISTRY)) if (role === "training-source") expect(NEVER_TRAIN_NAME.test(set)).toBe(false);
  });

  it("holds F-1's reserved held-out set as held-out", () => {
    expect(roleOf("sf-store-002")).toBe("held-out");
  });

  it("is not fooled by an inherited key", () => {
    expect(roleOf("toString")).toBeNull();
    expect(roleOf("__proto__")).toBeNull();
  });
});

describe("the guard: by role, fail closed, then by name", () => {
  it("allows a declared training source", () => {
    expect(isTrainable("pilot-000")).toBe(true);
    expect(() => assertTrainable("pilot-000")).not.toThrow();
  });

  it.each(SET_ROLES.filter((r) => r !== "training-source"))("refuses a set declared %s", (role) => {
    const reg: SetRegistry = { "shelf-set-a": role };
    expect(refusal("shelf-set-a", reg)).toBe("role");
    expect(() => assertTrainable("shelf-set-a", "TS-0", reg)).toThrow(new RegExp(`is a ${role} set and is never exported`));
  });

  it("refuses a set with no declared role (fail closed)", () => {
    expect(refusal("sf-store-003")).toBe("undeclared");
    expect(() => assertTrainable("sf-store-003")).toThrow(/no declared set role/);
  });

  it("keeps the name test as a second check: a training source named like a yardstick is refused", () => {
    const reg: SetRegistry = { "pilot-yardstick-mix": "training-source" };
    expect(refusal("pilot-yardstick-mix", reg)).toBe("name");
    expect(() => assertTrainable("pilot-yardstick-mix", "TS-0", reg)).toThrow(/named like a yardstick/);
  });

  it("names the card that called it", () => {
    expect(() => assertTrainable("yardstick", "TS-2")).toThrow(/^TS-2:/);
  });

  it("is the guard TS-0 exports", () => {
    expect(ts0Guard).toBe(assertTrainable);
  });
});

describe("a renamed yardstick is still refused", () => {
  // The old guard was the name regex alone: each of these passed it.
  const renamed = ["library-b2", "eval-set-1", "sf-store-002", "lib40"];

  it.each(renamed)("the old name test alone would have let %s through", (set) => {
    expect(NEVER_TRAIN_NAME.test(set)).toBe(false);
  });

  it.each(renamed)("the role guard refuses %s", (set) => {
    expect(isTrainable(set)).toBe(false);
  });

  it("refuses the yardstick declared under a new, innocent name", () => {
    const reg: SetRegistry = { ...SET_REGISTRY, "library-b2": "yardstick" };
    expect(() => assertTrainable("library-b2", "TS-0", reg)).toThrow(/is a yardstick set/);
  });

  it("TS-0's build refuses it before it reads anything", () => {
    const empty = mkdtempSync(join(tmpdir(), "dl5-"));
    expect(() => build(["library-b2"], empty)).toThrow(/no declared set role/);
  });

  it("TS-2's training filter throws on its rows rather than filtering them", () => {
    const row = { set: "library-b2", basis: "readers-agree", split: "train", readers: ["vision", "ppocr"], strong: true } as unknown as LabelRow;
    expect(() => trainRows([row])).toThrow(/^TS-2: "library-b2" has no declared set role/);
  });

  it("MM-1 marks its records evaluation-only, so MM-2's gallery never takes them", () => {
    expect(isEvaluationOnly("library-b2")).toBe(true);
    expect(isEvaluationOnly("yardstick")).toBe(true);
    expect(isEvaluationOnly("pilot-000")).toBe(false);
  });
});
