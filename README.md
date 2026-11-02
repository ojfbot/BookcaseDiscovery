# BookcaseDiscovery

Point a phone at a bookshelf: live spine recognition and taste-based book discovery. Built in public.

**Status:** bootstrapping (segment S0). Nothing runs yet beyond the scaffold.

- Plan (canonical): [`docs/plan/`](docs/plan/README.md), starting with
  [`DELIVERY-PLAN.md`](docs/plan/DELIVERY-PLAN.md).
- Environment probe: [`docs/probe.md`](docs/probe.md).
- Gate rulings: [`docs/gates/`](docs/gates/).

## Develop

Node ≥22.18 (runs TypeScript directly, no build step) and pnpm.

```sh
pnpm install
pnpm test
bin/bookcase --help
```

## Privacy

The repo is public. Photos, crops, labels, per-spine results and any personal data stay on the
owner's machine under `$BOOKCASE_DATA` and never enter git (`docs/plan/REQUIREMENTS.md`, OC9).

## Licence

AGPL-3.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
