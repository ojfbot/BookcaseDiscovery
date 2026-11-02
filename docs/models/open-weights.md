# Open-weight models and the public yardstick (H-0)

Checked 2026-11-02 by card H-0 (`claude/h-0-open-weights-1edb47`). Question (OC36): which existing open-weight models should label spines with no owner time, and which public labelled spine dataset should score them, given that the yardstick must be something the stack didn't produce?

**Answer, in short.**

- **Boxes:** two independent box producers. **SAM 3**, prompted with "book spine" and run tiled per shelf band, is the main one. **Grounding DINO (base) → SAM 2.1 (base-plus)** is the permissive second opinion. Each mask becomes the contract's 4-point polygon.
- **Reading:** three independent readers on crops rotated to horizontal: **Apple Vision** (P-1, already built), **Qwen3-VL-4B-Instruct** (8-bit MLX), and **PP-OCRv5** (server det and rec). ISFDB confirms identity (OC36 yardstick 2).
- **Yardstick:** no public set has spine boxes and titles that are both human-checked. It is a pair: the **Library Dataset** (Llabrés et al. 2024, MIT) for titles, and the **Zhong/Yang book-spine set** (figshare, CC0) for boxes. Both are PROXY (library shelves), local only, never committed, never trained on.
- **Downloads:** 8 items, about 11.3 GB. One of them (SAM 3) is gated and needs the owner's Hugging Face account. See §5.

Nothing was downloaded or run. No account was created, no terms were accepted, and no login was attempted.

## 1. Method and evidence labels

- Model metadata came from the Hugging Face API: `https://huggingface.co/api/models/<repo>?blobs=true` gives `gated` (`false`, `"auto"` or `"manual"`), the `license:` tag and each file's size. Sizes below are the weight files only, in one format (safetensors where there is one), in decimal MB/GB.
- Pages were read by web fetch, by `curl` for JSON APIs and raw GitHub files, and in the in-app browser where a fetcher got 403 (Roboflow Universe, the Library Dataset's OneDrive share). Three research sub-agents did the first pass. This card re-checked every fact the recommendation rests on: gating, licence tags and weight sizes of every recommended model, the SAM 3 licence text, the Qwen2.5-VL-3B licence text, the figshare, Zenodo and GitHub dataset records, the Library Dataset paper, and the Roboflow pages.
- Labels: **verified** = read from a fetched page or JSON by this card. **verified by survey** = a survey agent read it from the fetched page (URL given) and this card did not re-read it. **snippet** = seen only in a search result. **hypothesis** = this card's inference, not measured (INV-17). **UNVERIFIED** = could not be read.
- At most one quote per source, under 15 words. Licence readings are this card's reading of the text, not legal advice.
- **No model has a published result on book spines in shelf photos**, except small spine-specific fine-tunes whose weights are unreleased or undocumented (§2.3). So every "fits real use" cell is a hypothesis until F-0 measures it.

**Real-use stress (from `docs/ingest-verification.md`).** `pilot-000` is 31 photos, 27 of them ultra-wide, mostly angled whole cases, 27–48 MP (up to 8064 × 6048). A spine about 2.5 cm wide in a 1.2 m case is about 2 % of the frame width: about 170 px at native size, about 20 px if a model shrinks the photo to 1008 px (*hypothesis*, arithmetic only). Angled shots turn spines into slanted quads, so axis-aligned boxes overlap their neighbours. Every model below shrinks its input to 640–1333 px, so **tiling is required for every option**, not just a tuning choice.

## 2. Spine boxes

### 2.1 Table

| model | repo | licence (label) | AGPL-3.0 OK? | gated | weights | Apple silicon (label) | input / density limit | spine or dense evidence |
|---|---|---|---|---|---|---|---|---|
| **SAM 3** (text-promptable segmenter) | [`facebook/sam3`](https://huggingface.co/facebook/sam3) | Custom "SAM License" (HF tag `license:other`, verified). [LICENSE](https://github.com/facebookresearch/sam3/blob/main/LICENSE): redistribution "may only do so under the terms of this Agreement" (verified). Also trade-control/ITAR and no-reverse-engineering clauses (verified) | **Flag.** Use from AGPL code is fine if the weights stay in `$BOOKCASE_DATA` and are never redistributed (*hypothesis*). Outputs are not "SAM Materials" in its definitions (verified, LICENSE §"SAM Materials") | **manual** (verified) | `model.safetensors` 3,440 MB (verified) | GitHub README targets CUDA 12.6 (verified by survey). Image inference on MPS through transformers was reported in [HF discussion #11](https://huggingface.co/facebook/sam3/discussions/11) (verified by survey). An MLX port exists, [`mlx-community/sam3-image`](https://huggingface.co/mlx-community/sam3-image), 3,403 MB; its card says Apache-2.0 but its tag says `other`, so treat it as SAM License (verified by survey) | Transformers docs: "meant to be used at 1008px resolution" ([docs](https://huggingface.co/docs/transformers/main/model_doc/sam3), verified by survey). Decoder default 200 queries, so at most 200 instances per pass (verified by survey, config) | No published numbers. MIT-licensed [erasmus-university-library/quickscan](https://github.com/erasmus-university-library/quickscan), "Book spine detection and OCR" (verified), uses SAM 3 with the prompt "book spine" (verified by survey) |
| **SAM 2.1** base-plus (and large, small) | [`facebook/sam2.1-hiera-base-plus`](https://huggingface.co/facebook/sam2.1-hiera-base-plus) | apache-2.0 (verified) | Yes | no (verified) | 323 MB (large 898, small 184) (verified) | Official notebook: "Support for MPS devices is preliminary" (verified by survey) | Resizes to 1024 × 1024 (verified by survey). Needs box or point prompts | None found |
| **Grounding DINO** base / tiny | [`IDEA-Research/grounding-dino-base`](https://huggingface.co/IDEA-Research/grounding-dino-base) | apache-2.0 (verified) | Yes | no (verified) | 933 MB (tiny 689) (verified) | Transformers model. No model-specific MPS evidence (*hypothesis*: runs on MPS) | Shortest edge 800, longest 1333; 900 queries (verified by survey). Axis-aligned boxes only | None found |
| MM-Grounding-DINO large | [`openmmlab-community/mm_grounding_dino_large_all`](https://huggingface.co/openmmlab-community/mm_grounding_dino_large_all) | apache-2.0 (verified by survey) | Yes | no | 1,376 MB (verified by survey) | As Grounding DINO (*hypothesis*) | As Grounding DINO | None found. A drop-in swap for Grounding DINO base |
| LLMDet large | [`iSEE-Laboratory/llmdet_large`](https://huggingface.co/iSEE-Laboratory/llmdet_large) | Apache 2.0 (verified by survey) | Yes | no | 1,376 MB (verified by survey) | In transformers since 4.55 (verified by survey) | 800/1333, 900 queries | LVIS only |
| OWLv2 base / large | [`google/owlv2-base-patch16-ensemble`](https://huggingface.co/google/owlv2-base-patch16-ensemble) | apache-2.0 (verified by survey) | Yes | no | 620 / 1,750 MB (verified by survey) | Transformers (*hypothesis*: MPS) | 960² / 1008², padded square (verified by survey) | None found |
| OmDet-Turbo | [`omlab/omdet-turbo-swin-tiny-hf`](https://huggingface.co/omlab/omdet-turbo-swin-tiny-hf) | apache-2.0 (verified by survey) | Yes | no | 462 MB | UNVERIFIED | 640 × 640 (verified by survey) | None found |
| Florence-2 large (`<OD>`, `<OPEN_VOCABULARY_DETECTION>`) | [`microsoft/Florence-2-large`](https://huggingface.co/microsoft/Florence-2-large) | mit (verified) | Yes | no (verified) | 1,554 MB (verified) | MLX port of the `-ft` variant (verified by survey) | 768 × 768 (verified by survey). Boxes come out as tokens, so a dense shelf risks truncation (*hypothesis*) | None found |
| YOLO11-OBB / YOLO26-OBB | [ultralytics/assets v8.3.0](https://github.com/ultralytics/assets/releases/tag/v8.3.0); [`Ultralytics/YOLO26`](https://huggingface.co/Ultralytics/YOLO26) | AGPL-3.0 (verified; G-LIC) | Yes | no | n 5.8 MB … x 118 MB (verified by survey) | Ultralytics: "can train on Apple silicon through the Metal Performance Shaders" (verified by survey); Core ML export | 1024 px (YOLO26-OBB) | Pretrained on DOTA aerial classes; **no book class**, so not usable zero-shot (*hypothesis*). It is P-2's model to fine-tune, not a labeller |
| YOLOE-11 / YOLOE-26 (text prompts) | [`jameslahm/yoloe`](https://huggingface.co/jameslahm/yoloe) | agpl-3.0 (verified by survey) | Yes | no | 11-l-seg 71 MB (verified by survey) | Ultralytics (*hypothesis*: MPS) | 640 px | None found |
| Rex-Omni | [`IDEA-Research/Rex-Omni`](https://huggingface.co/IDEA-Research/Rex-Omni) | IDEA License 1.0; commercial use needs a licence request; base Qwen2.5-VL-3B is research-only (verified by survey) | **No** | no | 8,132 MB | CUDA install only (verified by survey) | — | None |
| Moondream 3 preview | [`moondream/moondream3-preview`](https://huggingface.co/moondream/moondream3-preview) | BSL 1.1 with an additional use grant (verified by survey) | **Flag** | no | ~18.5 GB | CUDA in the card (verified by survey) | Multi-crop | None |
| Qwen3-VL-8B / Qwen2.5-VL-7B (grounding as JSON boxes) | [`Qwen/Qwen3-VL-8B-Instruct`](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct) | apache-2.0 (verified by survey) | Yes | no | 17.5 GB bf16; MLX 4-bit 5.8 GB | mlx-vlm `qwen3_vl` (verified by survey) | Dynamic resolution with a pixel budget | None. Listing 40 thin boxes as text is slow and error-prone (*hypothesis*) |
| *Spine-specific:* RF-DETR nano "bookshelf" | [`Geraldine/rf-detr-nano-bookshelf`](https://huggingface.co/Geraldine/rf-detr-nano-bookshelf) | apache-2.0 weights (verified by survey); training data a Roboflow set with UNVERIFIED licence | Weights yes; data provenance flagged | no | 121 MB | ONNX CPU path; MPS UNVERIFIED | 384 px; ships a shelf-tiling script (verified by survey) | mAP@50 0.974 on its own Roboflow split (verified by survey). Axis boxes, class `book` |
| *Spine-specific:* mmrotate-bookspine | [`izi0/mmrotate-bookspine`](https://huggingface.co/izi0/mmrotate-bookspine) | mit (verified by survey) | Yes | no | 366 MB | MMRotate on MPS UNVERIFIED | 640 px, Oriented R-CNN | No card, training data unknown, 0 downloads (verified by survey). Not usable as evidence |
| *Spine-specific:* ASC-YOLOv8 (OBB) | [becomingsoon/ASC-YOLOv8](https://github.com/becomingsoon/ASC-YOLOv8) | AGPL-3.0 (verified) | Yes | — | **No weights released** (verified by survey) | Ultralytics fork | 1024 px | mAP50-95 89.2 on its own spine set (verified by survey). Its data is the Zenodo set in §4 |

### 2.2 Recommendation for boxes

Two producers that don't share weights, so their agreement means something to F-0's per-spine score:

1. **B1 · SAM 3, text prompt "book spine", tiled.** Split each working copy into shelf bands, then into tiles of about 1008 px with overlap, so each pass holds well under 200 spines. Merge across tiles by mask IoU. Each mask → minimum-area rotated rectangle → the 4-point `Polygon` (L-1's contract already says a SAM backend does this). It is the only zero-shot option that segments instances of a concept, and a library already uses it for exactly this prompt. Costs: a gated download (owner action), the SAM License flag, and 3.4 GB.
2. **B2 · Grounding DINO base → SAM 2.1 base-plus, tiled.** Grounding DINO proposes "book spine" boxes (axis-aligned, up to 900 per pass). Each box prompts SAM 2.1 for a mask, which recovers the slanted shape on angled shots. Mask → 4-point polygon as above. All Apache-2.0, ungated, 1.26 GB together. If the owner declines SAM 3, B2 is the stack and B1's place stays empty.

How the two are used (for F-0, *hypothesis*): a spine both producers find (mask IoU ≥ a threshold F-0 sets) is box-confident; a spine only one finds is box-uncertain; shelf-band width that neither covers is a gap. Neither producer can find spines that both miss, which is why box recall is measured on the yardstick, never claimed on `pilot-000`.

Not recommended as labellers: YOLO-OBB (no book class until P-2 fine-tunes it), Florence-2 detection (768 px, token output), the VLMs (slow for 40+ thin boxes), Rex-Omni and Moondream 3 (licences), the spine-specific fine-tunes (undocumented data, or no weights).

### 2.3 Fit to real use (all *hypothesis*)

- **Thin spines:** tiling to about 1008 px tiles keeps a 2.5 cm spine at roughly 60–170 px wide, depending on tile count. Without tiling, a whole-case photo gives about 20 px per spine, which no model here is shown to handle.
- **Density:** a whole case can hold over 200 spines, SAM 3's per-pass cap. Shelf bands plus tiles fix that. Grounding DINO's 900 queries are not the limit; its box quality on touching spines is unknown.
- **Rotation and angle:** masks follow slanted spines; axis boxes do not. That is why B2 goes through SAM 2.1 rather than using Grounding DINO's boxes directly.
- **Two-tone spines and merged neighbours:** the Library Dataset paper reports exactly these SAM failures on library shelves: of 8,435 SAM objects with text, 256 were merged books and 1,267 were not books ([arXiv 2407.19812, Table 1](https://arxiv.org/html/2407.19812v1), verified). F-0 should expect the same error kinds from B1 and B2.

## 3. Spine reading

### 3.1 Table

Every repo here returned `gated: false` (verified).

| model | repo | licence (label) | AGPL-3.0 OK? | weights (MLX port) | Apple silicon (label) | text with boxes? | rotation | input limits | scene-text or spine evidence |
|---|---|---|---|---|---|---|---|---|---|
| **Qwen3-VL-4B-Instruct** (and 2B, 8B) | [`Qwen/Qwen3-VL-4B-Instruct`](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct) | apache-2.0 (verified) | Yes | 8.88 GB bf16; [`mlx-community/Qwen3-VL-4B-Instruct-8bit`](https://huggingface.co/mlx-community/Qwen3-VL-4B-Instruct-8bit) 5.10 GB, tagged apache-2.0 (verified) | mlx-vlm `qwen3_vl` (verified by survey; mlx-vlm is MIT) | Yes: the OCR cookbook returns `bbox_2d` plus `text_content` (verified by survey, [QwenLM/Qwen3-VL cookbooks](https://github.com/QwenLM/Qwen3-VL)) | Card: "robust in low light, blur, and tilt" (verified by survey). Nothing on 90°/270° | Multiples of 32 px; pixel budget configurable | General OCR benchmarks only; no spine results |
| Qwen3.5-4B (Feb 2026) | [`Qwen/Qwen3.5-4B`](https://huggingface.co/Qwen/Qwen3.5-4B) | apache-2.0 (verified) | Yes | 9.32 GB; `mlx-community/Qwen3.5-4B-8bit` 5.14 GB, **no licence tag on the port** (verified) | mlx-vlm `qwen3_5` (verified by survey) | *hypothesis* | Not stated | Thinking on by default; turn off (verified by survey) | Card: OCRBench 85.0 (verified by survey). A swap for Qwen3-VL-4B if F-0 finds it better |
| Qwen2.5-VL-7B-Instruct | [`Qwen/Qwen2.5-VL-7B-Instruct`](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct) | apache-2.0 (verified by survey) | Yes | 16.58 GB; MLX 4-bit 5.64 GB | mlx-vlm `qwen2_5_vl` | Yes | Best rotation result found: SROIE field accuracy 72.62 upright, 68.16 rotated without correction ([ORB, arXiv 2511.04161](https://arxiv.org/html/2511.04161), verified by survey) | Dynamic | Documents and receipts only |
| Qwen2.5-VL-3B-Instruct | [`Qwen/Qwen2.5-VL-3B-Instruct`](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct) | Qwen Research License: "FOR NON-COMMERCIAL PURPOSES ONLY" ([LICENSE](https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/blob/main/LICENSE), verified) | **No** | 7.51 GB | — | — | — | — | Excluded on licence. OC36 named Qwen2.5-VL; the 7B is the usable size |
| **PP-OCRv5** server det + rec | [`PaddlePaddle/PP-OCRv5_server_det`](https://huggingface.co/PaddlePaddle/PP-OCRv5_server_det), [`…_server_rec`](https://huggingface.co/PaddlePaddle/PP-OCRv5_server_rec) | apache-2.0 (verified) | Yes | det 87.9 MB + rec 84.4 MB (verified) | PaddlePaddle ships a `macosx_11_0_arm64` wheel ([PyPI](https://pypi.org/pypi/paddlepaddle/json), verified by survey); ONNX and transformers engines also exist. MPS UNVERIFIED; CPU is likely enough at this size (*hypothesis*) | Yes: detector polygons, recogniser per line | Rec card covers "vertical text" (verified by survey). Textline classifier is 0°/180° only (verified by survey), so rotate tall crops by 90° first | Detector max side 4000 | Rec card: line accuracy 0.7435 on its "Rotation" subset, 0.6397 "Artistic Text" (verified by survey; whole line exact) |
| PP-OCRv6 medium det + rec (Jun 2026) | [`PaddlePaddle/PP-OCRv6_medium_rec`](https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_rec) | apache-2.0 (verified) | Yes | det 62.0 MB + rec 76.5 MB (verified) | As v5 | Yes | As v5 | As v5 | Vendor benchmark only: weighted average 83.2 vs 78.1 for v5 server (verified by survey). A drop-in swap for v5 |
| Florence-2 large (`<OCR_WITH_REGION>`) | [`microsoft/Florence-2-large`](https://huggingface.co/microsoft/Florence-2-large) | mit (verified) | Yes | 1,554 MB (verified) | Native transformers class; MLX ports of the `-ft` variants only (verified by survey) | Yes, `quad_boxes` (verified by survey) | A port's docs: "heavily rotated text (90° or more) confuses it" ([Curiosity docs](https://docs.curiosity.ai/florence2-sharp/guides/ocr), verified by survey) | 768 × 768 squashes a tall thin crop (*hypothesis*) | None on spines |
| PaddleOCR-VL 1.5 / 1.6 | [`PaddlePaddle/PaddleOCR-VL-1.5`](https://huggingface.co/PaddlePaddle/PaddleOCR-VL-1.5) | apache-2.0 (verified by survey) | Yes | 1.92 GB; MLX 0.7–1.1 GB | mlx-vlm `paddleocr_vl`; native route says "use Docker" on macOS (verified by survey) | Yes (`Spotting:` task) | Skewed pages | Upscales under 1500 px | Document benchmarks only |
| GOT-OCR-2.0 | [`stepfun-ai/GOT-OCR-2.0-hf`](https://huggingface.co/stepfun-ai/GOT-OCR-2.0-hf) | apache-2.0 (verified by survey) | Yes | 1.12 GB | mlx-vlm `got` | No (takes a box as input) | Not stated | 1024² | Lists scene-text OCR as a task; no numbers |
| docTR (parseq multilingual) | [mindee/doctr](https://github.com/mindee/doctr) | Apache-2.0 (verified by survey) | Yes | 47.9 MB | PyTorch; MPS UNVERIFIED | Yes, rotated boxes | ORB: 64.54 upright, 15.63 rotated without correction (verified by survey) | — | Weak on rotation |
| TrOCR large-str | [`microsoft/trocr-large-str`](https://huggingface.co/microsoft/trocr-large-str) | No licence on the card; source repo MIT (verified by survey) | Flag | 2.23 GB | Transformers (*hypothesis*: MPS) | No (one line in) | Rotate first | Fixed | Fine-tuned on scene-text sets (IC13, IC15, IIIT5K, SVT) |
| DeepSeek-OCR, dots.ocr, olmOCR-2, GLM-OCR, LightOnOCR, SmolDocling | see survey | MIT / Apache-2.0 / CDLA-P (verified by survey) | Yes | 0.5–6.8 GB | mlx-vlm ports; upstream cards mostly CUDA | Layout boxes | — | — | **Document pages only**; not fits for short scene text |
| Surya 2.5 | [`datalab-to/surya-ocr-2.5`](https://huggingface.co/datalab-to/surya-ocr-2.5) | Modified OpenRAIL-M with a funding/revenue cap (verified by survey) | **Flag** | 1.38 GB | llama.cpp | Yes | — | — | Documents |
| HunyuanOCR | [`tencent/HunyuanOCR`](https://huggingface.co/tencent/HunyuanOCR) | Tencent Hunyuan Community License; excludes EU, UK, South Korea (verified by survey) | **No** | 2.24 GB | — | Spotting | — | — | — |
| Moondream 3, Nanonets-OCR2-3B | see survey | BSL / Moondream licence; Nanonets has no licence file and a research-licensed base (verified by survey) | **No / flag** | — | — | — | — | — | — |
| *Spine-specific:* book-spine-ocr Qwen2.5-VL LoRA | [`quist99/book-spine-ocr-qwen25vl-512Res-adapter`](https://huggingface.co/quist99/book-spine-ocr-qwen25vl-512Res-adapter) | mit tag (verified by survey) | Yes | 170 MB | Qwen2.5-VL-7B base | — | — | 512 px | Empty template card: no data, no evaluation (verified by survey). Not usable as evidence |

Published spine reading work found is pre-VLM and gives no spine character error rate: the Library Dataset paper used a commercial OCR and reports matching accuracy only (§4); the Trixi paper ([arXiv 2210.10110](https://arxiv.org/html/2210.10110)) dropped text matching (verified by survey).

### 3.2 Recommendation for reading

Three readers that share no weights, each on the crop rotated to horizontal at **both 90° and 270°** (no labels exist to tell which is right; the catalog decides):

1. **R1 · Apple Vision** (`helpers/ocr-vision`, P-1). Already built; local; free.
2. **R2 · Qwen3-VL-4B-Instruct, 8-bit MLX** (5.10 GB). Apache-2.0, ungated, in mlx-vlm, returns text with boxes. Prompt as E-3 does: transcribe exactly what is printed, `unreadable` allowed, no catalog or profile hints. It fits easily in 48 GB (*hypothesis*); speed is unmeasured. Swaps if F-0 finds them better: Qwen3.5-4B (whose MLX port has no licence tag, so prefer the upstream weights), or Qwen2.5-VL-7B (the only one with a published rotation result).
3. **R3 · PP-OCRv5 server det + rec, plus the 0°/180° textline classifier** (179 MB together). A cheap, deterministic reader with per-line confidence, trained on vertical and artistic text. PP-OCRv6 medium is a drop-in swap.

The OC10 paid VLM stays in F-0 for the hard crops only, under the ceiling. A local open VLM as R2 should shrink that set (*hypothesis*), because R2 now does much of what the paid model was there for.

Not recommended: Florence-2 OCR (768 px square resize; reported to fail on 90° text), Qwen2.5-VL-3B (non-commercial), the document-page OCR models, and every licence-flagged model above.

## 4. The yardstick (PROXY)

### 4.1 Table

| dataset | URL | licence (label) | local eval, no redistribution? | account? | labels | size | capture | metrics it supports |
|---|---|---|---|---|---|---|---|---|
| **Library Dataset** (Llabrés, Dey, Karatzas, Valveny; DAS 2024) | [github.com/llabres/library-dataset](https://github.com/llabres/library-dataset); [arXiv 2407.19812](https://arxiv.org/html/2407.19812v1) | Repo LICENSE "MIT License", © 2024 Llabrés (verified). Images are hosted on the authors' OneDrive, and whether MIT covers them is not stated (*hypothesis*: yes) | Yes (*hypothesis*: MIT allows it; no redistribution needed) | **No**: both image zips open in a browser without sign-in (verified 2026-11-02) | Per book: `title, author, tag, isbn, not_book, not_in_db, segmentation_merged_books, series, section, ocr`, keyed by `image_name, mask_id` (verified, CSV header). Titles were machine-proposed, then checked and corrected by hand (verified, paper §3.2). Geometry is "manually filtered SAM-produced segmentation maps" (verified, paper); the masks are **not** in the repo (verified, git tree) and not visibly in the image zip (UNVERIFIED) | 285 images, 7,536 books; inventory list of 15,229 (verified). Original-image zip: 285 JPEGs of about 0.3–5 MB each (verified, OneDrive listing); zip total UNVERIFIED (*hypothesis* about 0.5 GB). Annotation repo about 55 MB (verified, git tree) | Public library in Barcelona, 14 sections, one or two shelves per photo. Titles mostly Catalan, then Spanish, then English (verified, paper §3.1). Camera, angle and resolution not reported | **Title (and author, ISBN) recall and precision per image.** Not box metrics: no released geometry, and what exists is SAM-derived, so not independent of B1/B2 |
| **Zhong/Yang book-spine segmentation set** | [figshare 12688436](https://figshare.com/articles/dataset/12688436) (API verified; the 4TU mirror refused connection) | **CC0** (verified, figshare API) | Yes (CC0) | No (verified) | "polygon vertices labeled manually" per spine, JSON (verified). No titles | 661 images; `data.zip` 766.4 MB (verified). Ma et al. report 15,454 spines, about 23 per image, likely this set (verified by survey, [PMC11679322](https://pmc.ncbi.nlm.nih.gov/articles/PMC11679322/)) | Smartphone photos of Shenzhen University library shelves: 283 tilted, 378 near-vertical (verified by survey, Ma et al.). Titles mostly Chinese (*hypothesis*) | **Box recall and precision, merges and splits** against hand-drawn polygons. Published baseline: oriented R-CNN spine AP 90.20 at IoU 0.75 (Ma et al., their own split) |
| Book Spine Dataset on YOLO | [Zenodo 21755243](https://zenodo.org/records/21755243) | cc-by-4.0 (verified, Zenodo API) | Yes | No (open access, verified) | Rotated boxes; "960 train / 240 val" (verified, [ASC-YOLOv8 README](https://github.com/becomingsoon/ASC-YOLOv8)) | One 427.5 MB RAR (verified) | Not described (verified: empty description) | Box metrics. **Better kept as P-2 training data** (§4.3) |
| Open Shelves (capjamesg) | [Roboflow](https://universe.roboflow.com/capjamesg/open-shelves); [GitHub](https://github.com/capjamesg/open-shelves) | **Three conflicting licences**: Roboflow page "CC BY 4.0" (verified in browser); GitHub README CC BY-NC-SA 4.0 (C-0, verified); Zenodo copy cc-by-nc-4.0 (verified by survey) | Yes under the strictest reading (NC-SA, private, non-commercial) (*hypothesis*) | Roboflow: yes, a login modal on download (verified by survey). Zenodo copy: no | Instance polygons, one class `book`; no titles (verified) | 163 source images; v9 = 496 after augmentation, preprocessing "Stretch to 640x640" (verified in browser) | The author's home shelves, English (verified by survey) | Box metrics only, small and resized. A sanity check, not a yardstick |
| On-shelf book spine dataset (Zhong, IEEE DataPort) | [ieee-dataport.org](https://ieee-dataport.org/documents/shelf-book-spine-dataset-instance-segmentation) | None stated (C-0, verified) | Not established | **Subscription** (C-0, verified) | Polygons (Labelme) | 1,849 images, 4.31 GB (verified by survey) | Phones, about 3000 × 4000 (verified by survey) | Box metrics. Not recommended: subscription and no grant |
| Roboflow `book-spine-detection-p2` | [Roboflow](https://universe.roboflow.com/book-detection/book-spine-detection-p2) | "CC BY 4.0" (verified in browser) | Yes | Yes (*hypothesis*, same flow as Open Shelves) | Instance masks, class `book-spine` | 7,063 images (verified in browser) | Not described | Box metrics; provenance unknown, likely augmented copies (*hypothesis*) |
| Roboflow `libvision/book-spines-vh9b8` | [Roboflow](https://universe.roboflow.com/libvision/book-spines-vh9b8) | "CC BY 4.0" (verified in browser) | Yes | Yes (*hypothesis*) | Axis boxes, class `books` | 546 images (verified in browser) | Not described | Box metrics |
| Other Roboflow spine sets (seven, 312–11,666 images), Book Spine OCR - Korean (103 images, titles as class names), `quist99/book-spine-ocr` (2,730 single-spine crops, no licence), BookSpineDataset (non-commercial academic), Stanford MM'10/'11 (454 spines, licence UNVERIFIED) | Roboflow Universe, Hugging Face, GitHub (`wyn2282145606-crypto/BookSpineDataset`), Stanford papers | CC BY 4.0 / none / NC / UNVERIFIED (verified by survey) | — | mostly yes | — | — | — | Not fits: no titles, no provenance, no licence, or too small |

C-0's rows are corrected here: Open Shelves' Roboflow page, which C-0 could not reach, says CC BY 4.0, and its Zenodo copy says CC BY-NC 4.0. The Roboflow "other" datasets C-0 marked UNVERIFIED now show CC BY 4.0 on their pages.

### 4.2 Recommendation for the yardstick

**No public dataset has human-checked spine boxes and titles together.** The yardstick is therefore a pair, each used only for what it can honestly score:

- **Titles: the Library Dataset.** The only real-shelf set with per-spine title, author and ISBN labels that people checked. MIT, no account, published baselines. F-0 scores **image-level title recall and precision** (which books the stack says are in a photo, against the annotation) and, where an ISBN is present, identity. Limits: library, not bookstore; Catalan and Spanish ahead of English; ISFDB will hold few of these books, so the catalog step must run against the dataset's own inventory list (15,229 entries) for this score. Its geometry is SAM-derived and unreleased, so it is **not** used for box metrics.
- **Boxes: the Zhong/Yang set.** 661 phone photos, about 15,000 hand-drawn spine polygons, CC0, no account, 766 MB, about a third of shots tilted. F-0 scores **box recall, precision, merges and splits**. Limits: Chinese academic library, square-ish per-shelf framing, not ultra-wide whole cases.

Both are PROXY (library shelves) and are reported apart from `pilot-000`'s real-use machine agreement (OC35, OC36). Both stay under `$BOOKCASE_DATA/proxy/`, are never committed, and are **never trained on**: not by F-2, and not by P-2 (§4.3).

The licence question for the owner: both licences (MIT, CC0) allow private local evaluation without redistribution in this card's reading. Only aggregate metrics reach `evals/` (Z-1 guard).

### 4.3 What P-2 should train on instead (note for the conductor)

P-2 says "convert the public set(s) to the Ultralytics OBB format" and fine-tune on them. If P-2 picks the yardstick sets, the yardstick is no longer independent. Candidates that keep it clean: the Zenodo "Book Spine Dataset on YOLO" (CC BY 4.0, rotated boxes, open) and the CC BY 4.0 Roboflow sets (account needed). The IEEE DataPort set is out (no grant). This is P-2's decision, logged as a deviation, not decided here.

## 5. Download list (checklist #5 addendum)

Everything lands under `$BOOKCASE_DATA` (`~/data/bookcase-discovery/`, 311 GB free on 2026-11-02, verified `df -h`). No weight or dataset file enters the repo (Z-1 guard). Sizes verified from the APIs unless marked.

| # | item | source | files | size | licence | gated / account | who downloads | to |
|---|---|---|---|---|---|---|---|---|
| 1 | SAM 3 (B1) | [`facebook/sam3`](https://huggingface.co/facebook/sam3) | `model.safetensors` + configs | 3,440 MB | SAM License (flag) | **manual gate**: Hugging Face account and licence acceptance | **Owner** (agents create no accounts and hold no tokens) | `models/sam3/` |
| 2 | Grounding DINO base (B2) | [`IDEA-Research/grounding-dino-base`](https://huggingface.co/IDEA-Research/grounding-dino-base) | `model.safetensors` + configs | 933 MB | Apache-2.0 | no | Agent, after approval | `models/grounding-dino-base/` |
| 3 | SAM 2.1 base-plus (B2) | [`facebook/sam2.1-hiera-base-plus`](https://huggingface.co/facebook/sam2.1-hiera-base-plus) | `model.safetensors` + configs | 323 MB | Apache-2.0 | no | Agent | `models/sam2.1-hiera-base-plus/` |
| 4 | Qwen3-VL-4B-Instruct, 8-bit MLX (R2) | [`mlx-community/Qwen3-VL-4B-Instruct-8bit`](https://huggingface.co/mlx-community/Qwen3-VL-4B-Instruct-8bit) | `model.safetensors` + tokenizer | 5,121 MB | Apache-2.0 | no | Agent | `models/qwen3-vl-4b-8bit/` |
| 5 | PP-OCRv5 server det + rec, textline classifier (R3) | [`PaddlePaddle/PP-OCRv5_server_det`](https://huggingface.co/PaddlePaddle/PP-OCRv5_server_det), [`…_server_rec`](https://huggingface.co/PaddlePaddle/PP-OCRv5_server_rec), [`PaddlePaddle/PP-LCNet_x1_0_textline_ori`](https://huggingface.co/PaddlePaddle/PP-LCNet_x1_0_textline_ori) | `inference.pdiparams` + configs | 88 + 84 + 7 = 179 MB | Apache-2.0 | no | Agent | `models/pp-ocrv5/` |
| 6 | Zhong/Yang spine set (box yardstick) | [figshare 12688436](https://figshare.com/articles/dataset/12688436) | `data.zip` | 766 MB | CC0 | no | Agent | `proxy/zhong-yang-661/` |
| 7 | Library Dataset annotations (title yardstick) | [github.com/llabres/library-dataset](https://github.com/llabres/library-dataset) | the repo (CSV annotations, inventory list, OCR arrays) | about 55 MB | MIT | no | Agent | `proxy/library-dataset/` |
| 8 | Library Dataset images | the README's OneDrive link for split images | `split_images_library.zip` (the annotations name split images, e.g. `…_1.jpg`) | UNVERIFIED; *hypothesis* about 0.5 GB | MIT (*hypothesis* for the images) | no login (verified) | Agent | `proxy/library-dataset/images/` |

**Total: about 11.3 GB** (10.8 GB verified plus about 0.5 GB estimated for item 8). Item 1 alone is the owner's; the rest an agent can fetch once approved. The original (unsplit) Library Dataset images are a second zip of similar size; F-0 asks for it only if full-resolution runs matter.

**Installs this implies (checklist #6 addendum, for F-0 to scope):** `mlx-vlm` (MIT) for R2; `paddlepaddle` or `paddleocr` (Apache-2.0) for R3; `transformers` and `torch` are already approved for `helpers/detect/.venv`. OPERATING-MODEL §6 rule 2 keeps Python inside `helpers/detect/`; F-0 decides whether the readers live there.

**Withdrawn from the earlier checklist #5:** the Roboflow and IEEE DataPort spine sets are no longer needed for the yardstick. P-2 may still ask for a Roboflow CC BY 4.0 set or the Zenodo set as training data.

## 6. What this card does not settle

- No model was run, so every real-use fit above is a hypothesis. F-0 measures them on the yardstick (PROXY) and reports machine agreement on `pilot-000`.
- Whether F-0 accepts SAM 3's licence is the owner's call (§7). Nothing in the plan publishes SAM 3 weights; outputs (labels) are outside "SAM Materials", which matters for G-W later (*hypothesis*, not legal advice).
- The Library Dataset's image licence is inferred from the repo's MIT licence; the paper and README do not restate it for the images.
- Newline unit: none is mapped for H-0 in CURRICULUM-MAP §1b. The closest fit is **U14 M6 ("data collection is the hardest step")**, because H-0 replaces collection-by-hand with composed models and a borrowed yardstick. U6 (joint embedding spaces) does not fit: nothing here uses one.

## 7. Ruling

**Approve the labelling stack (SAM 3 plus Grounding DINO → SAM 2.1 for boxes; Apple Vision, Qwen3-VL-4B and PP-OCRv5 for reading), the yardstick pair (Library Dataset for titles, Zhong/Yang for boxes), and the 8 downloads (about 11.3 GB, SAM 3 downloaded by you)?**

**Owner ruling (2026-11-02):** "Approve, SAM 3 later." The stack, the yardstick pair and the 8 downloads are approved. Agents fetch items 2–8. The owner downloads SAM 3 (item 1) whenever convenient; until then F-0 runs B2 (Grounding DINO → SAM 2.1) alone and records that only one box producer was available.
