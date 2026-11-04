"""F-0g private review page: copy groups on pilot-000 photos.

Usage: render_f0g.py --spec render.jsonl --out <dir> [--examples <dir>]
Each spec line is one photo: its boxes (group, confirmed, confirmed-by-copy, blocked), its groups and the visually
same neighbours the series guard rejected. Groups are outlined together with a count badge; propagated copies are
drawn in magenta; guard rejections are joined by a red line. The owner's example images, when given, come first.
The page holds photos, crops and titles: it is written under the data root and never committed.
"""

from __future__ import annotations

import argparse
import html
import json
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

OVERVIEW_SIDE = 2400
COLOURS = {  # BGR
    "spine": (0, 215, 255),
    "confirmed": (60, 180, 60),
    "copy": (230, 60, 230),
    "group": (255, 140, 0),
    "rejected": (40, 40, 230),
}


def centre(p: np.ndarray) -> tuple[int, int]:
    return int(p[:, 0].mean()), int(p[:, 1].mean())


def label(img: np.ndarray, text: str, at: tuple[int, int], colour: tuple, scale: float = 0.8) -> None:
    cv2.putText(img, text, at, cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 5, cv2.LINE_AA)
    cv2.putText(img, text, at, cv2.FONT_HERSHEY_SIMPLEX, scale, colour, 2, cv2.LINE_AA)


def overview(img: np.ndarray, photo: dict) -> np.ndarray:
    s = OVERVIEW_SIDE / max(img.shape[:2])
    out = cv2.resize(img, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    pts = [(np.array(b["polygon"], dtype=np.float64) * s).astype(np.int32) for b in photo["spines"]]
    for p, b in zip(pts, photo["spines"]):
        key = "copy" if b["byCopy"] else "confirmed" if b["confirmed"] else "spine"
        cv2.polylines(out, [p], True, COLOURS[key], 4 if b["byCopy"] else 2 if b["confirmed"] else 1, cv2.LINE_AA)
    for k, g in enumerate(photo["groups"]):
        allp = np.concatenate([pts[i] for i in g["members"]])
        x0, y0 = allp.min(axis=0) - 6
        x1, y1 = allp.max(axis=0) + 6
        cv2.rectangle(out, (int(x0), int(y0)), (int(x1), int(y1)), COLOURS["group"], 3, cv2.LINE_AA)
        cx = int((x0 + x1) / 2)
        cv2.circle(out, (cx, int(y0) - 16), 17, COLOURS["group"], -1, cv2.LINE_AA)
        cv2.putText(out, f"x{g['size']}", (cx - 15, int(y0) - 9), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
        label(out, f"G{k + 1}", (int(x0), int(y1) + 24), COLOURS["group"], 0.7)
    for r in photo["rejected"]:
        a, b = centre(pts[r["a"]]), centre(pts[r["b"]])
        cv2.line(out, a, b, COLOURS["rejected"], 4, cv2.LINE_AA)
        cv2.circle(out, ((a[0] + b[0]) // 2, (a[1] + b[1]) // 2), 7, COLOURS["rejected"], -1, cv2.LINE_AA)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--examples")
    args = ap.parse_args()
    out = Path(args.out)
    (out / "img").mkdir(parents=True, exist_ok=True)
    e = html.escape
    head: list[str] = []
    if args.examples:
        for f in sorted(Path(args.examples).glob("*.webp")):
            shutil.copy(f, out / "img" / f.name)
            head.append(f"<figure><img class=ov src='img/{e(f.name)}'><figcaption>owner example: {e(f.stem)}</figcaption></figure>")
    sections: list[str] = []
    totals = {"groups": 0, "copies": 0, "byCopy": 0, "rejected": 0}
    for line in open(args.spec):
        if not line.strip():
            continue
        photo = json.loads(line)
        img = cv2.imread(photo["image"], cv2.IMREAD_COLOR | cv2.IMREAD_IGNORE_ORIENTATION)
        if img is None:
            continue
        n = photo["n"]
        cv2.imwrite(str(out / f"img/p{n:02d}.jpg"), overview(img, photo), [cv2.IMWRITE_JPEG_QUALITY, 82])
        spines = photo["spines"]
        totals["groups"] += len(photo["groups"])
        totals["copies"] += sum(g["size"] for g in photo["groups"])
        totals["byCopy"] += sum(1 for b in spines if b["byCopy"])
        totals["rejected"] += len(photo["rejected"])
        rows = []
        for k, g in enumerate(photo["groups"]):
            cells = []
            for i in g["members"]:
                b = spines[i]
                state = ("<b class=copy>confirmed-by-copy</b> (readers " + e("+".join(b["consistent"])) + ")") if b["byCopy"] else (
                    "<b class=ok>confirmed</b>" if b["confirmed"] else f"unknown{(': ' + e(b['blocked'])) if b['blocked'] else ''}")
                cells.append(f"<li>box {i}: {state}{(' — ' + e(b['work'])) if b['work'] else ''}</li>")
            rows.append(f"<tr><td><b>G{k + 1}</b> ×{g['size']}</td><td><ul>{''.join(cells)}</ul></td></tr>")
        rej = "".join(f"<li>boxes {r['a']}–{r['b']}: {e(r['reason'])} (visual score {r['score']})</li>" for r in photo["rejected"])
        tag = " · <b>owner example photo</b>" if photo.get("example") else ""
        sections.append(
            f"<h2 id=p{n}>Photo {n}{tag}</h2><p>{len(photo['groups'])} copy group(s), "
            f"{sum(1 for b in spines if b['byCopy'])} confirmed-by-copy, {len(photo['rejected'])} guard rejection(s).</p>"
            f"<img class=ov src=img/p{n:02d}.jpg>"
            + (f"<table><tr><th>group</th><th>copies (shelf order)</th></tr>{''.join(rows)}</table>" if rows else "")
            + (f"<p>Series guard rejected (visually the same, reads contradict):</p><ul>{rej}</ul>" if rej else "")
        )
    page = (
        "<!doctype html><meta charset=utf-8><title>F-0g copy groups · pilot-000</title>"
        "<style>body{font:13px system-ui;margin:16px;max-width:2400px}td{vertical-align:top;border-top:1px solid #ccc;padding:6px}"
        "img.ov{max-width:100%}ul{margin:4px 0;padding-left:16px}.ok{color:#1a7f37}.copy{color:#c03cc0}"
        ".key span{display:inline-block;padding:0 6px;margin-right:6px;border:3px solid}figure{margin:0 0 16px}</style>"
        "<h1>F-0g copy groups · pilot-000 (private)</h1>"
        f"<p>{totals['groups']} copy groups holding {totals['copies']} copies; {totals['byCopy']} boxes confirmed-by-copy; "
        f"{totals['rejected']} visually same neighbours rejected by the series guard. Machine agreement, never accuracy.</p>"
        "<p class=key><span style='border-color:#00a0ff'>copy group (badge: copies)</span>"
        "<span style='border-color:#e63ce6'>confirmed-by-copy</span><span style='border-color:#3cb43c'>confirmed (two readers)</span>"
        "<span style='border-color:#ffd700'>spine</span><span style='border-color:#e62828'>guard rejection (line)</span></p>"
        + "".join(head)
        + "".join(sections)
    )
    (out / "index.html").write_text(page)
    print(f"render: {len(sections)} photos -> {out / 'index.html'}", file=sys.stderr)


if __name__ == "__main__":
    main()
