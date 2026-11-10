# Restored-generation app adapter

## Exact source and commits

- App source was cloned from actual `main` HEAD `eeb8307b2826167d41fed0c1a90a17ad909c7dc9` into a separate checkout.
- Implementation branch: `codex/fleet-runner-generation-adapter`.
- Implementation commit: `59b86c013c89fe141743edafe000ee21ffb6b8da` (`feat(fleet): bind clients to restored generation`).
- Vendored Fleet Runner revision: `dad1d204bb2e01c691aa69de3ce3f0b218f7de21`. Its tree (`1f90ebfcfcef352954ea825738559c7c1aadb636`) matches the independently reviewed G7 remediation tree at `d0ed09e67c3d4ff707b3cb5958b2fc36450dd074`.

## Adapter behavior

- `FLEET_GENERATION` is optional. When present, the app accepts only the lowercase UUID v4 form emitted by Fleet Runner restore. Invalid or empty values fail before constructing a remote client or writing a worker LaunchAgent.
- The Fleet Runner client and generated declaration are pinned to core `dad1d20`; the app's only runtime source adaptation is `.js` import extensions changed to `.ts`, as required by the vendor checker.
- Every app-owned owner and worker client receives the validated generation. Core binds it into every JSON and binary request target before signing, covering status, status events, controls, presence, input upload/download, enqueue, claim, heartbeat, release, fail, completion, recovery-hold release, events, reports, and verification.
- When unset, the app retains the legacy three-argument client construction and signs the original request targets without a generation query.
- Worker service installation copies the optional value into the LaunchAgent child environment for both standard and NAS profiles. Service configuration tests cover no generation, valid generation, and malformed generation without invoking the host LaunchAgent.
- The NAS read-vision-only admission guard, capability set, pause and resource policy, TLS requirements, and input handling remain in place. Synthetic tests confirm a NAS admission request remains rejected when a generation is configured.

## Verification

Runtime was Node `v24.22.2` with pnpm `12.15.0`. The isolated frozen install succeeded with `--ignore-scripts` and reused the lockfile packages from the local store.

- `pnpm exec vitest run test/fleet-client-generation.test.ts test/fleet-service.test.ts test/fleet-runtime.test.ts` — 3 files, 16 tests passed.
- `pnpm typecheck` — passed.
- `node scripts/check-fleet-vendor.mjs <core dad1d20 checkout>` — passed: `fleet vendor matches pinned core revision`.
- `pnpm test` — 79 files passed, 3 skipped; 1,752 tests passed, 17 skipped. The suite prints an existing synthetic stale-Qwen-stamp notice and exits successfully.
- `pnpm guard` — passed for the staged index; `pnpm guard --history` — passed (1,646 files, 313 commits).
- `git diff --check` — passed.

No NAS or LaunchAgent state was changed, no remote branch was published, and no deployment was performed. This app adapter does not change the G7 operational status; NAS independence, freshness, restore-time, and migration qualification remain separate gates.
