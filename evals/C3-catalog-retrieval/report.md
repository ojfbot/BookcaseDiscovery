# C3-catalog-retrieval: catalog retrieval on the golden fragments (C-3)

Golden file `evals/golden/fragments.jsonl`, 161 queries; run on 2026-11-02, code 5471a0505249.
Catalog gaps: none (every expected work exists in the catalog).

| subset | queries | top-1 | top-5 | top-10 | MRR |
|---|---:|---:|---:|---:|---:|
| clean | 87 | 98.9 % | 100.0 % | 100.0 % | 0.992 |
| noisy | 68 | 95.6 % | 100.0 % | 100.0 % | 0.967 |
| clean.dev | 44 | 100.0 % | 100.0 % | 100.0 % | 1.000 |
| clean.test | 43 | 97.7 % | 100.0 % | 100.0 % | 0.984 |
| noisy.dev | 34 | 97.1 % | 100.0 % | 100.0 % | 0.978 |
| noisy.test | 34 | 94.1 % | 100.0 % | 100.0 % | 0.957 |
| noise.initials | 2 | 100.0 % | 100.0 % | 100.0 % | 1.000 |
| noise.multi-variant | 3 | 100.0 % | 100.0 % | 100.0 % | 1.000 |
| noise.ocr-0O | 15 | 100.0 % | 100.0 % | 100.0 % | 1.000 |
| noise.ocr-1l | 5 | 80.0 % | 100.0 % | 100.0 % | 0.840 |
| noise.ocr-rn-m | 2 | 100.0 % | 100.0 % | 100.0 % | 1.000 |
| noise.series-larger | 8 | 100.0 % | 100.0 % | 100.0 % | 1.000 |
| noise.split-words | 16 | 93.8 % | 100.0 % | 100.0 % | 0.958 |
| noise.surname-first | 6 | 100.0 % | 100.0 % | 100.0 % | 1.000 |
| noise.truncated-author | 14 | 92.9 % | 100.0 % | 100.0 % | 0.952 |
| noise.truncated-title | 6 | 83.3 % | 100.0 % | 100.0 % | 0.875 |

Latency per `retrieve` call: p50 31.5 ms, **p95 78.7 ms**, max 110.2 ms, mean 36 ms over 161 calls (warm cache).

No-match queries (6, nothing in the catalog should be the book): top candidate score max 0.721, median 0.578.
Top score when the top-1 candidate is right (151 queries): min 0.71, 10th percentile 0.855, median 0.933.

Every scored query has its expected work in the top 5.
