import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script
import { findProblems } from "../scripts/check-ci-tests.mjs";

const good = {
  name: "ci.yml",
  doc: {
    on: { pull_request: null, push: null },
    jobs: { t: { steps: [{ run: "pnpm install" }, { run: "pnpm test" }] } },
  },
};
const base = { testScript: "vitest run", named: ["test/a.test.ts"], collected: new Set(["test/a.test.ts"]), workflows: [good] };
const withStep = (step: object, extra: object = {}, on: object = good.doc.on) => ({
  ...base,
  workflows: [{ name: "ci.yml", doc: { on, jobs: { t: { ...extra, steps: [step] } } } }],
});

describe("check-ci-tests guard", () => {
  it("passes the good case", () => expect(findProblems(base)).toEqual([]));
  it("flags a narrowed test script", () => {
    for (const s of ["vitest run test/a.test.ts", "vitest run --exclude x", "vitest run --project a", "vitest"]) {
      expect(findProblems({ ...base, testScript: s }).join()).toContain('"test" is');
    }
  });
  it("flags a test file vitest does not collect", () =>
    expect(findProblems({ ...base, collected: new Set() }).join()).toContain("not collected"));
  it("flags a fixed list or arguments after pnpm test", () => {
    for (const run of ["pnpm test -- test/a.test.ts", "pnpm test test/a.test.ts", "pnpm exec vitest run test/a.test.ts"]) {
      expect(findProblems(withStep({ run })).join()).toContain("narrows or bypasses");
    }
  });
  it("flags a disabled or tolerated step", () => {
    expect(findProblems(withStep({ run: "pnpm test", if: "${{ false }}" })).join()).toContain("if: or continue-on-error");
    expect(findProblems(withStep({ run: "pnpm test", "continue-on-error": true })).join()).toContain("continue-on-error");
    expect(findProblems(withStep({ run: "pnpm test" }, { "continue-on-error": true })).join()).toContain("continue-on-error");
    expect(findProblems(withStep({ run: "pnpm test" }, { if: "false" })).join()).toContain("continue-on-error");
  });
  it("flags a workflow that is not run on pull requests and pushes", () => {
    expect(findProblems(withStep({ run: "pnpm test" }, {}, { workflow_dispatch: null })).join()).toContain("not triggered");
    expect(findProblems(withStep({ run: "pnpm test" }, {}, { pull_request: { paths: ["x/**"] }, push: null })).join()).toContain("not triggered");
  });
  it("flags a suite with no pnpm test step", () =>
    expect(findProblems(withStep({ run: "pnpm typecheck" })).join()).toContain("no enabled workflow step"));
});
