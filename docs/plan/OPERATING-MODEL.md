# Operating model — how the BookcaseDiscovery MVP is run

Planning output, 2026-10-31. These are the rules for the Opus conductor on Yojimbo and the card sessions it dispatches. The shape follows `selfco-inbox/docs/plan/OPERATING-MODEL.md`, with one difference: this delivery runs over several days and is bounded by the owner's time (the photo shoot and labelling), not by a single night.

## 1. Roles

| Role | Where | Model | Holds |
|---|---|---|---|
| **Owner** | Keyboard, phone, the bookstore | — | Photos unblock, fixture shoot, labelling, profile seeds, API key and spend ceiling, every G-* ruling except G-P, recommendation judgement |
| **Conductor** | One Claude Code session on Yojimbo, cwd `~/ojfbot/BookcaseDiscovery` | Opus 5.5 | The plan, dispatch, exit checks, merges, the deviation roll-up, gate packets, ≤1 helpdesk post per segment boundary and per owner-blocked state. It is also **the only vault writer** for this project (§9a) |
| **Card sessions** | Yojimbo, worktrees of `ojfbot/BookcaseDiscovery` | Sonnet 5.5 (S/M), Haiku 5.5 (XS), Opus 5.5 (cards marked *J*: judgement) | One card each. End in a PR. Report the PR URL plus the exit command and its output. Archived after merge |
| **T0** | — | none | Long jobs started by a card in the background (catalog import, detector training). They report through the card that started them |

Codex is not used in this delivery: no card touches Yuri-owned code.

## 2. Model tier ladder

| Tier | Model | Used for |
|---|---|---|
| T3 | Fable 5.1 | Planning only: the Opus 5.5 draft of 2026-10-31 was revised the same evening by the Fable planning pass (`~/selfco/prompts/bookcase-discovery-planning-handoff.md`) and extended late that night by the Fable gap cycle for the live experience (`~/selfco/prompts/bookcase-discovery-live-experience-gap-handoff.md`). Fable is not used during delivery |
| T2-J | Opus 5.5 | The conductor. Cards whose output is a judgement rather than code that tests can check: I-2 (assignment that allows copies), E-4 (residue analysis), and the gate packets for G-R, G-E4 and G-E5 |
| T2 | Sonnet 5.5 | Every M card and most S cards (implementation against a written spec) |
| T1 | Haiku 5.5 | XS cards: probes, file checks, licence reading, protocol sheets, manifest runs |

**Escalation rule.** A Sonnet card that hits a design question its card does not answer stops and reports it. It does not decide the question itself. The conductor answers within its own authority, or turns it into an owner question.

## 3. Task sizing

| Size | Shape | Exit | Tier | Turn budget |
|---|---|---|---|---|
| XS | One command, one file check, one short doc | Output matches | T1 | ≤15 |
| S | One component; spec and tests named; diff ≤300 lines | Named tests pass | T1–T2 | ≤40 |
| M | Two or three components, or an experiment run with a write-up | Tests pass plus a committed run record | T2 | ≤70 |
| L | Design judgement | Decision recorded with evidence | T2-J | ≤40 |

Nothing larger than M is dispatched. A card that reaches its turn budget stops, pushes its branch, and reports what is done and what is left. The conductor re-cards it.

## 4. Dispatch, review and merge

1. **Dispatch.** Call `start_session` with:
   - initiation `user_asked` (the owner's GO message in the conductor session authorises the plan's cards; see §7);
   - context `fresh`;
   - cwd `~/ojfbot/BookcaseDiscovery`, with `use_worktree: true`;
   - model set to the card's tier: `claude-sonnet-5-5`, `claude-haiku-5-5` or `claude-opus-5-5`;
   - name = card ID in kebab case (`l-1-contracts`).

   The brief is:
   - the card text verbatim;
   - the card's Newline unit line from `CURRICULUM-MAP.md` §1b (so the worker knows which lesson's method it is applying, and the PR can be read as course material);
   - the inherited rules (§6);
   - the paths of `docs/plan/REQUIREMENTS.md`, `CONTEXT.md` (once L-1 lands) and the card's input PRs;
   - "Report: PR URL; exact exit command and its output; deviations logged (y/n)".
2. **Concurrency.**
   - At most **four** card sessions write at once.
   - At most **one** heavy-compute card at a time: P-2 training, P-3 SAM (if triggered), F-2 fixture training, any full-fixture perceive run.
   - **Phone-at-keyboard cards** (T-1, T-6, T-8, T-7a, T-7b, V-5; marked ⌨ in S9): the owner's iPhone must be paired to Yojimbo (Continuity Camera) or plugged in for installs. Dispatch them only when the owner has said the phone is available; they otherwise idle at their first device step. Card sessions never hold an API key for the phone: adjudication requests go through the Mac core.
   - **S9/S10 cards inherit INV-20–INV-23** in their brief, and the line "no frame, clip or weight file is ever committed; the Z-1 guard covers video and weight types".
   - No two sessions touch the same module directory. The parallelism map in `DELIVERY-PLAN.md` §4 already respects this.
3. **Review.** When a card session reports:
   - Open the PR and read the diff. Cap: 400 lines. Above that, ask for a split unless it is generated data or a lockfile.
   - **Run the card's exit check yourself** from a clean checkout of the branch. The session's "done" is a claim until then.
   - Check the PR against the review checklist (§5).
4. **Merge.** Merge Low and Medium cards with a squash merge once the exit check and checklist pass. `main` must stay green (`pnpm test`) after each merge. Rebase dependents rather than merging stacks.
5. **Fail handling.** A card that fails its exit check is re-carded once, with the failure output attached. A second failure means drop or re-scope it, log the deviation, and tell the owner only if the card is on the critical path.
6. **Gate packets.** For every owner gate, the conductor writes `docs/gates/<gate>.md`:
   - the question;
   - the evidence (run-record links);
   - the options;
   - its recommendation.

   It then asks the owner in its own chat: one question, with buttons. The ruling is committed into the same file. A gate is never closed silently, and no agent's view counts as the ruling.

## 5. Conductor review checklist (every PR)

- [ ] The exit check was run by the conductor, and its output is pasted in a PR comment.
- [ ] Invariants the card cites (INV-n) have a test, or the PR explains why not.
- [ ] The **Z-1 privacy guard is green** in CI on the PR (after Z-1 lands). Before that, the conductor checks the OC9 table by hand.
- [ ] No photo, crop, label, per-spine eval row, ChatGPT-derived entry, SelfCo content, API key, private path or store name appears in the diff, the fixtures, the PR body, the commit messages or the CI logs. The repo is public (OC9). The owner-stated profile in `profile/seeds.json` is allowed.
- [ ] Any number in docs links to a run record under `evals/`, or is marked *hypothesis* or *proxy* (INV-17).
- [ ] Proxy-dataset results are labelled **PROXY (library shelves)** wherever they appear.
- [ ] `identify/` imports nothing from `recommend/` or the profile (INV-13). The structural test from I-4 enforces this once it exists.
- [ ] Glossary terms come from `CONTEXT.md`. Any new term is added there in the same PR.
- [ ] `implementation-notes.md` has the card's deviations, or the report says "none".
- [ ] PR text is written for a public reader: what changed, how it was checked, and links. No owner-private context.

## 6. Rules every card inherits

1. Work only in your worktree. Read-only everywhere else. **Never open `~/selfco`.**
2. pnpm for JS (no `npm`/`npx`); `uv` for Python, inside `helpers/detect/` only; SwiftPM for `helpers/ocr-vision/`.
3. Data goes under `$BOOKCASE_DATA` (default `~/data/bookcase-discovery/`), never in the repo. Downloads only from the list the owner approved in `DELIVERY-PLAN.md` §1.
4. No credentials in files, chat or logs. The API key is read from the keychain at call time.
5. **Log deviations as you hit them.** If an edge case forces you off the card's plan:
   - take the conservative option;
   - append one bullet under `## Deviations` in `implementation-notes.md` at the repo root, saying what the card assumed, what you found, and which way you went;
   - continue.

   Do not stop, and do not re-plan silently. More deviations logged is better; never suppress one.
6. Report with links and command output, not summaries.
7. No paid API calls outside cards that name them. Every paid call goes through the budget wrapper from I-4 (before I-4 lands, E-3's VLM arm uses a hard cap of N calls written in the card).

## 7. Owner touchpoints and authority

- The owner's **GO** message to the conductor authorises dispatching every card in `DELIVERY-PLAN.md` §3 whose entry conditions hold, at Low or Medium tier. It does **not** cover High-tier steps or gates.
- The conductor asks the owner only for:
  - the owner checklist items;
  - G-* rulings;
  - a critical-path card failing twice;
  - spend approaching 80 % of the ceiling;
  - anything High tier.

  Each ask is one question with buttons. Owner cards (O-*) are given to the owner as a short checklist with a clear "done" signal to send back.
- **Owner-at-keyboard cards** are marked ⌨ in the plan. The conductor schedules them as their own blocks and never leaves a card session waiting on the owner. If a card needs the owner, it stops and reports, and the conductor relays.

## 8. Deviation logging and roll-up

- Workers append to `implementation-notes.md` (§6 rule 5). The conductor appends its own deviations: re-cards, re-ordering, gate outcomes that changed the plan.
- At each **segment boundary**, the conductor reads the new deviations and writes a three-line roll-up at the top of the segment's gate packet: count, themes, and anything that changes downstream cards. It then edits the affected cards in `docs/plan/DELIVERY-PLAN.md` in one PR, labelled `plan-update`.
- **The same deviation appearing in three cards is a missing convention**, not three edge cases. The conductor drafts an ADR stub for it in `docs/plan/` and raises it at the next gate.
- The count is a **discovery rate, not a defect rate**. It is never a target, and nobody is asked to lower it.

## 9. Helpdesk check-ins

Read from the Yuri Helpdesk guide (`workstation-yuri/minifour-setup/site/llms.txt` and README) on 2026-10-31.

**What the helpdesk is today:**
- Check-ins are short (`task` ≤160 chars), advisory, and kept in an append-only journal readable from Yuri and the configured Mini.
- Relay v1 (`body`, `to`, HMAC) is **not built** (`pipeline-review/TONIGHT-HANDOFF.md`).
- The guide forbids credentials, private vault content, private paths and executable text in posts.

**How it applies here:**

| When | Who | Post (`task`, ≤160 chars) |
|---|---|---|
| Owner GO | Conductor | `BookcaseDiscovery: GO, S0 started; conductor=<session name>` |
| Segment boundary | Conductor | `BookcaseDiscovery: S<n> exit passed; next S<n+1>` |
| Waiting on the owner (gate or O-card) | Conductor | `BookcaseDiscovery: blocked on owner <gate/card>` with `state=blocked` |
| MVP accepted | Conductor | `BookcaseDiscovery: MVP accepted (G-MVP)` |

- Card sessions post nothing.
- No titles, tastes, store names, dollar figures or paths go in any post. The helpdesk is for coordination only, not for status detail.
- Detail lives in PRs and gate packets.
- Expect about 15 posts over the whole MVP.

## 9a. Vault write-back (recurring, the conductor only)

The owner approved this on 2026-10-31 (OC17). The vault is how agents on the owner's devices coordinate. Today, local Claude Code and Codex on the Macs can read `~/selfco`. **Cloud agents and the ChatGPT app cannot**, so the owner relays to them. A better integration is the owner's separate SelfCo tooling work.

**Page:** `~/selfco/wiki/synthesis/bookcase-discovery-delivery-plan.md`. It is a summary and a status board, never a second copy of the plan. It holds:
- links to the canonical repo files;
- the card-status table;
- the open gates with their rulings;
- the blocked-on-owner list;
- where to bring the GPT assessment.

**When:**

| Event | Page update | `wiki/log.md` entry |
|---|---|---|
| Card merged | Its row: state, PR link | — |
| Card blocked on the owner | The blocked-on-owner list | — |
| Gate packet written / ruled | Open-gates table: ruling in the owner's words, link to `docs/gates/<gate>.md` | Yes |
| Segment boundary | Status line, deviation roll-up count | Yes |
| GPT assessment arrives (checklist #15) | Link the new source page; open the reconciliation page (OC18) | Yes |

**Rules,** from `~/selfco/CLAUDE.md`:
- Write only in `wiki/`, and only this page, its `wiki/index.md` line under "Bookcase discovery engine — 2026-10-31", the source and reconciliation pages from OC18, and `wiki/log.md` (append-only).
- Never edit `raw/`; never run git in the vault.
- Frontmatter and an `Up: [[index]]` line on every page.
- Link the assessment, evidence and brief pages.
- Plain markdown that a Codex or GPT agent can read without Claude conventions (`AGENTS.md` is the parallel schema).
- No secrets.
- After each write, run `python3 ~/ojfbot/core/.claude/skills/vault/scripts/lint.py ~/selfco --schema`. It must report 0 broken links and 0 orphans. If it doesn't, fix the write before anything else.
- Card sessions never open `~/selfco`.

**GPT write-back path:**
- **Codex on a Mac** writes its assessment as a vault page per `AGENTS.md`.
- **The ChatGPT app** goes through the capture envelope into `raw/inbox/`, via the Notion inbox bridge when it is deployed, or by the owner pasting until then.

Either way, the conductor distills it into `wiki/sources/` and never edits the raw capture.

## 9b. Newline community touchpoints (owner actions)

- **Community only for now** (OC16). There are no named reviewers.
- `CURRICULUM-MAP.md` §3 holds the post drafts. The conductor refreshes their numbers at the M1 and MVP boundaries and tells the owner they're ready.
- **The owner posts. No agent posts, DMs or emails anyone.**
- Feedback the owner brings back becomes a repo issue, or an input to the next gate packet. Either way it's quoted as the owner relayed it.

## 10. Budgets

- **Conductor:** ≤40 of its own tool-using turns per segment. Above that, write a handoff note to `docs/plan/CONDUCTOR-LOG.md` and continue in a fresh conductor session that reads it.
- **Cards:** the turn budget named on each card.
- **API spend:** the OC10 ceiling. The budget wrapper records spend per run in `evals/`. At 80 %, the conductor tells the owner. At 100 %, adjudication pauses (INV-2) and the conductor asks.
