# G-LIC · Detector licence

**Status: ruled 2026-10-31 by the owner.** Recorded by Z-0 on 2026-11-02.

## Question

Under which licence can a detector trained with Ultralytics YOLO (AGPL-3.0) be used and its weights
eventually published? Options at the time (REQUIREMENTS.md OC26): make the whole repo AGPL-3.0;
retrain on a permissively licensed detector; or buy an Ultralytics Enterprise licence.

## Evidence

Ultralytics licensing page (https://www.ultralytics.com/license), read in a browser during the
2026-10-31 gap cycle:

> "All Ultralytics YOLO trained models fall under the AGPL-3.0 License by default"

No permissively licensed oriented-box detector with a Core ML export path was found in that cycle
(docs/plan/README.md, gap-cycle changelog).

## Ruling

Owner, 2026-10-31: **"AGPL-3.0 repo"**. The whole repository is AGPL-3.0 (`LICENSE`, created with the
repo on 2026-11-02).

## Consequences

- `helpers/detect` needs no licence carve-out.
- F-2 may train without a licence hold.
- Owner-trained weights stay private until gate G-W rules, whatever the licence.
- A permissive retrain stays in the post-MVP backlog (#6b) if permissive weights are wanted later.
