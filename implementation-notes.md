# Implementation notes — BookcaseDiscovery

Card sessions and the conductor log deviations here (docs/plan/OPERATING-MODEL.md §6 rule 5, §8).
The count is a discovery rate, not a defect rate.

## Deviations
- **2026-11-02 (Z-0, conductor).** Z-0 said `engines.node >=22`. Territory: `bin/bookcase` runs `.ts` by Node's built-in type stripping, which is unflagged only from 22.18. Went with `>=22.18` and no build step; the build Mac has v24.22.1.
- **2026-11-02 (Z-0, conductor).** The plan folder was to be frozen at Z-0. Territory: another session wrote U-2/U-3 design files into it (`docs/live/chat-002-ux.md`, `docs/live/guided-sweep-ux.md`, `docs/recommend/taste-tree-ux.md`) a minute before the copy. They were included. The drafts folder got a frozen-pointer note; later plan edits go by PR to `docs/plan/` (OC3).
- **2026-11-02 (Z-0, conductor).** The plan's `docs/plan/**` text names private paths (`~/selfco`, `raw/inbox/`) as rules and references, about 50 times. Z-1's private-path rule would fail on them. Conductor ruling for the Z-1 brief: the private-path string rule exempts `docs/plan/**`, `docs/privacy.md` and the guard's own test fixtures; every other Z-1 rule still applies there.
- **2026-11-02 (conductor).** OPERATING-MODEL §4 caps writers at four. The owner asked for K-2 on `pilot-000` as soon as Z-0 landed, alongside wave 1's four. Ran five writers for a short time: K-2 is an owner-lane card (they jump the queue), it is XS, and it only writes `docs/ingest-verification.md`.
