# Privacy: the OC9 boundary, in operational form

This repo is public. Every file, diff, commit message, PR body and CI log is world-readable and may
be cloned, forked or cached. The boundary comes from the owner's decision OC9
([`docs/plan/REQUIREMENTS.md`](plan/REQUIREMENTS.md), table "Public/private boundary") and invariant
INV-19. This page says where each class of data lives and how to purge it from a working copy. The
rules are enforced by [`scripts/privacy-guard.mjs`](../scripts/privacy-guard.mjs), not by memory.

`$BOOKCASE_DATA` is the private data root. It defaults to `~/data/bookcase-discovery/` and is never
inside a checkout.

## Where each data class lives

| Data class | Lives in | Public? | Guard rule that protects it |
|---|---|---|---|
| Code, contracts, docs, plan, gate packets | the repo | yes | none needed |
| Owner-stated reading profile (`read`, `liked`, `cooler`, `not-for-me`) | `profile/seeds.json` in the repo | yes: owner statements only (provenance `owner-statement`, no expanded entries, ASSERTED nodes only) | `banned-provenance`, `public-seeds` |
| Profile entries derived from a ChatGPT export | `$BOOKCASE_DATA/private/profile-overlay.json` | never | `banned-provenance` |
| ChatGPT export, SelfCo context, adapter caches | `$BOOKCASE_DATA/private/` | never | `chatgpt-export-file`, `chatgpt-export-shape`, `banned-provenance`, `private-path` |
| Original photos, working copies, crops, display derivatives, HTML reports | `$BOOKCASE_DATA/images/`, `reports/` | no, until G-PUB | `image-type`, `exif-gps`, `large-binary` |
| Labels, per-spine OCR text, per-spine eval rows | `$BOOKCASE_DATA/labels/`, `$BOOKCASE_DATA/private/evals/` | no, until G-PUB | `evals-allowlist` |
| Fixture manifest (hashes, dimensions, setting, shelf index, derivative flag) | `fixtures/<session>/manifest.json` in the repo | yes, with no capture time, GPS, store or file-name fields | `fixture-manifest` |
| Private fixture manifest (file names, capture time, device, lens class, edit status; GPS is never read) | `$BOOKCASE_DATA/private/fixtures/<session>.json` | never | `fixture-manifest`, `private-path` |
| The ledger and the image store of a real fixture | `$BOOKCASE_DATA/ledger/<session>.sqlite`, `$BOOKCASE_DATA/images/` | no, until G-PUB | `image-type`, `large-binary` |
| Aggregate eval metrics (recall, CER, top-k, bands, tokens, spend) | `evals/<run-id>/{metrics.json,report.md}` in the repo | yes | `evals-allowlist` (this is the allowlist) |
| Catalog databases and dumps | `$BOOKCASE_DATA/catalog/` | no (size; attribution goes in `NOTICE`) | `large-binary` |
| Live camera frames | memory only (INV-22) | never stored | `image-type`, `video-type` |
| Sweep clips and their keyframe labels | `$BOOKCASE_DATA/video/`, `labels/video/` | no, until G-PUB | `video-type` |
| Detector weights | `$BOOKCASE_DATA/models/` | no, until G-W | `weight-type` |
| Weights registry records (hashes and metrics only) | `models/registry/*.json` in the repo | yes | none needed |
| Synthetic test images, drawn or generated, no real shelf | `test/fixtures/synthetic/` | yes | `exif-gps` still applies |

## What the guard checks

It fails on any of these (rule name in brackets). Output never echoes matched text, only the rule,
the path and a line number or commit.

1. `[image-type]` an image or camera RAW file outside `test/fixtures/synthetic/`. Detected by
   extension and by file signature, so a renamed photo fails too.
2. `[video-type]` a video file (`.mov`, `.mp4`, `.m4v`, `.avi`, `.mkv`, `.webm` and similar) outside
   `test/fixtures/synthetic/`.
3. `[weight-type]` a model weight file (`.pt`, `.pth`, `.onnx`, `.mlmodel`, `.mlpackage`,
   `.safetensors`, `.ckpt`, `.gguf` and similar, including anything inside a `.mlpackage` or
   `.mlmodelc` directory) outside `test/fixtures/synthetic/`.
4. `[exif-gps]` an image with EXIF GPS tags (JPEG, HEIC, PNG, WebP, TIFF/RAW) or XMP GPS properties,
   **anywhere**, including `test/fixtures/synthetic/`.
5. `[chatgpt-export-file]` a file named `conversations.json` or `chat.html`, in any directory.
6. `[chatgpt-export-shape]` JSON or JSONL with an object that has both `mapping` and `create_time`.
7. `[banned-provenance]` a JSON or JSONL entry whose `provenance` (string or object) is
   `chatgpt-export` or `selfco`.
8. `[private-path]` the strings for the vault home, the vault directory, the raw inbox, the private
   data directory and a user home directory. The rule list is in `PRIVATE_PATTERNS` in the script. In
   history mode, commit messages are scanned too.
9. `[evals-allowlist]` any file under an `evals` path that is not one of: `evals/<run-id>/metrics.json`,
   `evals/<run-id>/report.md`, `evals/README.md`, `evals/golden/fragments.jsonl` (the public catalog
   query set). The JSON files must parse and carry no per-spine or OCR keys at any depth (`spines`,
   `ocr_text`, `observations`, `bbox`, `crops` and similar; list in `EVAL_FORBIDDEN_KEYS`). Aggregate
   files are capped at 256 KiB. A card that needs another file adds it to the allowlist in its own PR.
10. `[fixture-manifest]` a `manifest*.json` under a `fixtures` directory with a capture-time, GPS or
    store field (`capture_time`, `gps`, `latitude`, `store`, `store_name` and similar; list in
    `MANIFEST_FORBIDDEN_KEYS`).
11. `[large-binary]` a binary file over 1 MiB outside `test/fixtures/synthetic/`.

`test/fixtures/synthetic/` is exempt from rules 1, 2, 3 and 11 only. It has no size cap, so keep what
goes there tiny and obviously synthetic.

### Exemption list (private-path rule only)

In these places the private-path strings name rules, not data. Every other rule still applies to them.
The list is `PRIVATE_PATH_EXEMPT` in the script and must stay short and explicit:

- `docs/plan/**`
- `docs/privacy.md` (this page)
- `implementation-notes.md` (the deviation log names the rules it deviates from)
- `test/privacy-guard.test.ts` and `test/fixtures/privacy-guard/**` (planted-leak tests)

## How it runs

| Where | Command | Scans |
|---|---|---|
| Pre-commit hook | `node scripts/privacy-guard.mjs` (installed by `pnpm install` through `simple-git-hooks`) | everything in the git index, i.e. what the commit would contain |
| Any time by hand | `pnpm guard` | the same |
| Full history | `pnpm guard --history` | every blob and commit message reachable from any ref, local or remote. `--rev <rev>` limits it to one revision, e.g. `pnpm guard --history --rev main` |
| CI | `.github/workflows/privacy-guard.yml`, on every pull request and push | the tree, then the full history (the job fetches all commits) |

Exit codes: 0 clean, 1 violations, 2 the guard could not run. `--json` prints a machine-readable report.

`--no-verify` is forbidden. The CI job is the backstop for a skipped hook or a web edit, and a PR
with a red `privacy-guard` check does not merge.

The hook is a shared file in the repository's git directory, so it applies to every worktree of a
checkout. It skips itself when `scripts/privacy-guard.mjs` does not exist, which only happens in a
tree cut before this guard landed.

## Purging data from a working copy

Do these inside the checkout. None of them touches `$BOOKCASE_DATA`.

| Case | Command |
|---|---|
| A staged file that must not be committed | `git restore --staged <path>`, then move it under `$BOOKCASE_DATA` (or delete it) |
| An untracked private file in the checkout | `mv <path> "$BOOKCASE_DATA/private/"` or `rm <path>` |
| Everything untracked and ignored (data folders, caches, `node_modules`) | `git clean -ndX` to preview, then `git clean -fdX` |
| Private-path string in a file | edit it out; the guard names the file and line |
| A GPS-tagged image you need as a test fixture | do not use it. Generate a synthetic image instead; strip with `exiftool -all= <file>` only for images that are yours to publish and under `test/fixtures/synthetic/` |
| Private data of one class on the machine (working copies, crops, reports, labels, clips, weights) | `rm -rf "$BOOKCASE_DATA/<dir>"` for the directory named in the table above. Catalog dumps under `$BOOKCASE_DATA/catalog/` are public data; keep them |

### If something private was already committed

1. Stop. Do not push. If it is pushed, tell the owner and the conductor at once.
2. Removing it in a new commit does **not** remove it from history, and `pnpm guard --history` keeps
   failing on it. That is intended.
3. Unpushed: `git reset --soft <last-good-commit>`, fix the files, commit again. Check with
   `pnpm guard --history`.
4. Pushed: history rewrite and force-push are **owner actions** (for example `git filter-repo`),
   followed by a request to GitHub support to drop cached views, and assume anything pushed has been
   copied. Rotate anything that works as a credential. Agents do not do this alone.
5. Record the incident in `implementation-notes.md` without repeating the private content.

## Changing the guard

A change that loosens a rule (a new exemption, a new allowlist entry, a removed pattern) is a
boundary change: say so in the PR description, add or update the planted-leak test in
`test/privacy-guard.test.ts`, and update this page in the same PR. Planted leaks are generated in a
temporary directory at test time; never commit a real photo, a real GPS tag or a real export, even as
a negative test.
