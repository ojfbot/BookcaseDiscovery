# Environment probe (Z-0)

Run 2026-11-02 on the build Mac by the conductor. Planning-time probe for comparison (2026-10-31): node v24.22.1, SQLite 3.54.0 with trigram OK, swift present, uv and exiftool absent, 313 GB free.

| Probe | Result | Output |
|---|---|---|
| node --version | PASS | v24.22.1 |
| pnpm --version | PASS | 12.15.0 |
| swift --version | PASS | swift-driver version: 1.168.6 Apple Swift version 6.4 (swiftlang-6.4.0.34.1 clang-2100.3.34.1) |
| python3 --version | PASS | Python 3.15.1 |
| uv --version | PASS | uv 0.13.6 (Homebrew 2026-10-26 aarch64-apple-darwin) |
| sqlite3 CLI FTS5 trigram | PASS | 3.54.0; trigram match ROMAN→NEUROMANCER = 1 |
| node:sqlite FTS5 trigram | PASS | 3.53.4; trigram match = 1 |
| exiftool -ver | PASS | 13.55 |
| df -h ~ | PASS | 313Gi free of 460Gi |
