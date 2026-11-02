// A stand-in for the ocr-vision helper, run as `node fake-ocr-helper.mjs <mode>`, so the TypeScript wrapper
// is tested on every platform. Modes: echo (success per request, reversed order), error-one (error for the
// id "bad"), crash, garbage, wrong-id, duplicate, silent, hang.
import { createInterface } from "node:readline";

const mode = process.argv[2];
const version = { helper: "fake-ocr 0.0.0", os: "fake-os", requestRevision: 0 };
const requests = [];
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => line.trim() && requests.push(JSON.parse(line)));
rl.on("close", () => {
  const ok = (r) => ({
    id: r.id,
    variants: r.rotations.flatMap((rotation) =>
      [false, true].map((langCorrection) => ({ rotation, langCorrection, text: `t-${r.id}`, confidence: 0.5 })),
    ),
    version,
  });
  const out = (o) => process.stdout.write(`${typeof o === "string" ? o : JSON.stringify(o)}\n`);
  switch (mode) {
    case "echo":
      return [...requests].reverse().forEach((r) => out(ok(r)));
    case "error-one":
      return requests.forEach((r) => out(r.id === "bad" ? { id: r.id, error: { code: "image-unreadable", message: "nope" } } : ok(r)));
    case "crash":
      process.stderr.write("fake helper: boom\n");
      return process.exit(3);
    case "garbage":
      return out("this is not json");
    case "wrong-id":
      return out(ok({ ...requests[0], id: "someone-else" }));
    case "duplicate":
      out(ok(requests[0]));
      return out(ok(requests[0]));
    case "silent":
      return;
    case "hang":
      return setInterval(() => {}, 1000);
  }
});
