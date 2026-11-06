"""NS-11 mono-geometry student: per detected box, an RGB crop in, three face shares and a camera-frame normal out.

Distilled from MoGe-2 (the teacher, `helpers/depth/`): the targets are MoGe-2's face shares (`faces.py`) and the mean of
its normals over the box's pixels. The student sees RGB only (OC38): the box's crop and a 12-number vector of the
detection's own geometry. Pre-registered in `evals/NS11/prereg.md`; every constant below is that file's.

Subcommands (all private: they read and write under the data root's `private/` and `models/`; stderr is progress only):

    normals  --inputs I.jsonl --out O.jsonl     the teacher's mean normal per box, from H-2's geometry cache (CPU)
    crops    --table T.jsonl --out C.npz        each box's 128x128 letterboxed crop and its geometry vector (CPU)
    runall   --pilot-table T --pilot-crops C --yardstick-table T --yardstick-crops C --out DIR --weights DIR
                                                the nine pre-registered training runs on MPS, one 2 h wall-time cap

No download: HF_HUB_OFFLINE, TRANSFORMERS_OFFLINE and a private empty TORCH_HOME are set, and any socket connection
raises (a library's silent fetch is a failure to report, not a thing to allow).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import resource
import socket
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEPTH = HERE.parent / "depth"

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")


def block_network() -> None:
    """Any connection attempt raises: NS-11 downloads nothing (NS-10's torch.hub fetch is the precedent to avoid)."""

    def refuse(self, *a, **k):  # noqa: ANN001
        raise RuntimeError("NS-11: a network connection was attempted; this card downloads nothing")

    socket.socket.connect = refuse  # type: ignore[assignment]
    socket.socket.connect_ex = refuse  # type: ignore[assignment]


block_network()

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

Image.MAX_IMAGE_PIXELS = None

CROP = 128
GROW = 0.20
GEOM_DIM = 12
PAD = 0.5  # the letterbox's grey, in [0, 1]; standardisation maps it to zero
MEAN, STD = 0.5, 0.25

# --- recipe (prereg §4), fixed before any run ---------------------------------------------------------------------
EPOCHS, BATCH, LR, WEIGHT_DECAY, WARMUP_EPOCHS = 40, 64, 0.002, 0.0001, 2
SEED = 20261105
EXTRA_SEEDS = (20261106, 20261107)
CAP_SECONDS = 2 * 3600


def log(msg: str) -> None:
    print(f"[ns11 {time.strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


# --- the teacher's mean normal per box ---------------------------------------------------------------------------


def cmd_normals(args: argparse.Namespace) -> None:
    """Mean unit normal (camera frame) over each box's valid pixels: exactly the pixels faces.py classes."""
    sys.path.insert(0, str(DEPTH))
    import faces as F  # read-only: box_mask and unit are faces.py's own

    with open(args.out, "w") as out:
        for line in open(args.inputs):
            rec = json.loads(line)
            z = dict(np.load(rec["geometry"]))
            N = F.unit(z["normal"].astype(np.float32))
            P = z["points"].astype(np.float32)
            valid = z["mask"] & np.isfinite(P).all(-1) & np.isfinite(N).all(-1)
            scale = float(z["scale"])
            H, W = N.shape[:2]
            w0, h0 = Image.open(rec["image"]).size
            out.write(json.dumps({"photo": rec["photo"], "width": w0, "height": h0, "map": [W, H], "scale": scale}) + "\n")
            for b in rec["boxes"]:
                bm = F.box_mask(np.float64(b["polygon"]) * scale, H, W)
                row = {"photo": rec["photo"], "box": b["box"], "normal": None, "pixels": 0}
                if bm is not None:
                    m, (x0, y0, x1, y1) = bm
                    sel = m & valid[y0:y1, x0:x1]
                    n = N[y0:y1, x0:x1][sel]
                    row["pixels"] = int(len(n))
                    if len(n) >= 20:
                        mean = n.astype(np.float64).mean(axis=0)
                        mean /= np.linalg.norm(mean) + 1e-12
                        row["normal"] = [round(float(v), 6) for v in mean]
                out.write(json.dumps(row) + "\n")
            log(f"{rec['photo'][:8]} {len(rec['boxes'])} boxes")


# --- the student's input: crop and geometry vector ---------------------------------------------------------------


def geometry_vector(polygon: np.ndarray, W: int, H: int, cut: bool) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """The 12-number vector (prereg §3) and the grown crop rectangle (x0, y0, x1, y1) in working-copy pixels."""
    L = float(max(W, H))
    x0, y0 = polygon.min(axis=0)
    x1, y1 = polygon.max(axis=0)
    bw, bh = float(x1 - x0), float(y1 - y0)
    (_, _), (rw, rh), ang = cv2.minAreaRect(polygon.astype(np.float32))
    long_s, short_s = max(rw, rh), max(min(rw, rh), 1e-3)
    theta = math.radians(ang if rw >= rh else ang + 90.0)
    gx0, gy0 = max(0, int(math.floor(x0 - GROW * bw))), max(0, int(math.floor(y0 - GROW * bh)))
    gx1, gy1 = min(W, int(math.ceil(x1 + GROW * bw))), min(H, int(math.ceil(y1 + GROW * bh)))
    gx1, gy1 = max(gx1, gx0 + 2), max(gy1, gy0 + 2)
    g = np.array([
        (x0 + x1) / 2 / W, (y0 + y1) / 2 / H, bw / L, bh / L, long_s / L, short_s / L,
        math.sin(2 * theta), math.cos(2 * theta), min(math.log(long_s / short_s), 6.0), float(cut), W / H,
        (gx1 - gx0) / (gy1 - gy0),
    ], np.float32)
    return g, (gx0, gy0, gx1, gy1)


def letterbox(rgb: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    s = CROP / max(h, w)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    small = cv2.resize(rgb, (nw, nh), interpolation=cv2.INTER_AREA)
    canvas = np.full((CROP, CROP, 3), round(PAD * 255), np.uint8)
    ox, oy = (CROP - nw) // 2, (CROP - nh) // 2
    canvas[oy:oy + nh, ox:ox + nw] = small
    return canvas


def cmd_crops(args: argparse.Namespace) -> None:
    rows = [json.loads(l) for l in open(args.table)]
    order: dict[str, list[int]] = {}
    for i, r in enumerate(rows):
        order.setdefault(r["image"], []).append(i)
    crops = np.zeros((len(rows), CROP, CROP, 3), np.uint8)
    geom = np.zeros((len(rows), GEOM_DIM), np.float32)
    for k, (path, idx) in enumerate(order.items()):
        im = np.asarray(Image.open(path).convert("RGB"))
        H, W = im.shape[:2]
        for i in idx:
            r = rows[i]
            if (r["width"], r["height"]) != (W, H):
                raise SystemExit(f"photo {k}: size {W}x{H} differs from the table's {r['width']}x{r['height']}")
            g, (a, b, c, d) = geometry_vector(np.float64(r["polygon"]), W, H, bool(r["cut"]))
            geom[i] = g
            crops[i] = letterbox(im[b:d, a:c])
        log(f"crops {k + 1}/{len(order)}")
    np.savez(args.out, crops=crops, geom=geom)


# --- the student -------------------------------------------------------------------------------------------------

import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
import torch.nn.functional as Fn  # noqa: E402


class Block(nn.Module):
    def __init__(self, cin: int, cout: int, stride: int) -> None:
        super().__init__()
        self.c1 = nn.Conv2d(cin, cout, 3, stride, 1, bias=False)
        self.b1 = nn.BatchNorm2d(cout)
        self.c2 = nn.Conv2d(cout, cout, 3, 1, 1, bias=False)
        self.b2 = nn.BatchNorm2d(cout)
        self.short = None
        if stride != 1 or cin != cout:
            self.short = nn.Sequential(nn.Conv2d(cin, cout, 1, stride, bias=False), nn.BatchNorm2d(cout))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = Fn.relu(self.b1(self.c1(x)))
        y = self.b2(self.c2(y))
        return Fn.relu(y + (x if self.short is None else self.short(x)))


class GeometryStudentNet(nn.Module):
    """Prereg §3: from scratch, ResNet-style, 24/48/96/192 channels, a 12-number geometry branch, two heads."""

    def __init__(self) -> None:
        super().__init__()
        self.stem = nn.Sequential(nn.Conv2d(3, 24, 3, 2, 1, bias=False), nn.BatchNorm2d(24), nn.ReLU())
        chans, layers, cin = (24, 48, 96, 192), [], 24
        for s, c in enumerate(chans):
            layers += [Block(cin, c, 1 if s == 0 else 2), Block(c, c, 1)]
            cin = c
        self.stages = nn.Sequential(*layers)
        self.geom = nn.Sequential(nn.Linear(GEOM_DIM, 32), nn.ReLU(), nn.Linear(32, 32), nn.ReLU())
        self.trunk = nn.Sequential(nn.Linear(192 + 32, 128), nn.ReLU())
        self.face = nn.Linear(128, 3)
        self.normal = nn.Linear(128, 3)

    def forward(self, x: torch.Tensor, g: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        f = self.stages(self.stem(x)).mean(dim=(2, 3))
        h = self.trunk(torch.cat([f, self.geom(g)], dim=1))
        return self.face(h), Fn.normalize(self.normal(h), dim=1, eps=1e-6)


class GeometryOnlyNet(nn.Module):
    """Exploratory ablation (not pre-registered): the student's geometry branch, trunk and heads with no image at all."""

    def __init__(self) -> None:
        super().__init__()
        self.geom = nn.Sequential(nn.Linear(GEOM_DIM, 32), nn.ReLU(), nn.Linear(32, 32), nn.ReLU())
        self.trunk = nn.Sequential(nn.Linear(32, 128), nn.ReLU())
        self.face = nn.Linear(128, 3)
        self.normal = nn.Linear(128, 3)

    def forward(self, x: torch.Tensor, g: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.trunk(self.geom(g))
        return self.face(h), Fn.normalize(self.normal(h), dim=1, eps=1e-6)


def n_params(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


def standardise(x01: torch.Tensor) -> torch.Tensor:
    return (x01 - MEAN) / STD


def augment(x: torch.Tensor, gen: torch.Generator) -> torch.Tensor:
    """Brightness and contrast within +-20 %; a random resized crop of 90-100 % (prereg §4). x: (B, 3, H, W) in [0, 1]."""
    B, dev = x.shape[0], x.device

    def u(lo: float, hi: float) -> torch.Tensor:
        return (torch.rand(B, generator=gen, device="cpu") * (hi - lo) + lo).to(dev)

    mean = x.mean(dim=(1, 2, 3), keepdim=True)
    x = ((x - mean) * u(0.8, 1.2).view(B, 1, 1, 1) + mean) * u(0.8, 1.2).view(B, 1, 1, 1)
    x = x.clamp(0, 1)
    s = u(0.9, 1.0)
    room = 1 - s
    tx, ty = (u(-1, 1) * room), (u(-1, 1) * room)
    theta = torch.zeros(B, 2, 3, device=dev)
    theta[:, 0, 0], theta[:, 1, 1], theta[:, 0, 2], theta[:, 1, 2] = s, s, tx, ty
    grid = Fn.affine_grid(theta, list(x.shape), align_corners=False)
    return Fn.grid_sample(x, grid, mode="bilinear", padding_mode="border", align_corners=False)


def load_table(path: str, crops_path: str) -> dict:
    rows = [json.loads(l) for l in open(path)]
    z = np.load(crops_path)
    if len(rows) != len(z["crops"]):
        raise SystemExit(f"{path}: {len(rows)} rows but {len(z['crops'])} crops")
    return {
        "rows": rows,
        "x": torch.from_numpy(z["crops"]).permute(0, 3, 1, 2).contiguous(),  # uint8 (N, 3, H, W)
        "g": torch.from_numpy(z["geom"]),
        "shares": torch.tensor([r["shares3"] for r in rows], dtype=torch.float32),
        "normal": torch.tensor([r["meanNormal"] for r in rows], dtype=torch.float32),
    }


@torch.no_grad()
def predict(model: nn.Module, x: torch.Tensor, g: torch.Tensor, device: torch.device, variant: str = "full") -> tuple[np.ndarray, np.ndarray]:
    model.eval()
    shares, normals = [], []
    for i in range(0, len(x), 256):
        xb = torch.zeros(len(x[i:i + 256]), 1, 1, 1, device=device) if variant == "geomonly" else standardise(x[i:i + 256].to(device).float() / 255)
        gb = g[i:i + 256].to(device)
        f, n = model(xb, torch.zeros_like(gb) if variant == "croponly" else gb)
        shares.append(Fn.softmax(f, dim=1).cpu())
        normals.append(n.cpu())
    return torch.cat(shares).numpy(), torch.cat(normals).numpy()


def train_one(name: str, seed: int, D: dict, train_idx: np.ndarray, device: torch.device, variant: str = "full") -> tuple[nn.Module, dict]:
    torch.manual_seed(seed)
    np.random.seed(seed)
    gen = torch.Generator().manual_seed(seed)
    model = (GeometryOnlyNet() if variant == "geomonly" else GeometryStudentNet()).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    n = len(train_idx)
    steps_per_epoch = math.ceil(n / BATCH)
    total, warm = EPOCHS * steps_per_epoch, WARMUP_EPOCHS * steps_per_epoch
    x_all, g_all = D["x"][train_idx].to(device), D["g"][train_idx].to(device)
    if variant == "croponly":
        g_all = torch.zeros_like(g_all)
    y_all, n_all = D["shares"][train_idx].to(device), D["normal"][train_idx].to(device)
    losses, step, t0 = [], 0, time.time()
    for epoch in range(EPOCHS):
        model.train()
        perm = torch.randperm(n, generator=gen).to(device)
        tot, cnt = 0.0, 0
        for i in range(0, n, BATCH):
            idx = perm[i:i + BATCH]
            if len(idx) < 2:
                continue
            lr = LR * (step + 1) / warm if step < warm else LR * 0.5 * (1 + math.cos(math.pi * (step - warm) / max(1, total - warm)))
            for grp in opt.param_groups:
                grp["lr"] = lr
            xb = torch.zeros(len(idx), 1, 1, 1, device=device) if variant == "geomonly" else standardise(augment(x_all[idx].float() / 255, gen))
            face, nrm = model(xb, g_all[idx])
            y = y_all[idx]
            kl = (y * (torch.log(y.clamp_min(1e-8)) - Fn.log_softmax(face, dim=1))).sum(dim=1).mean()
            cos = 1 - (nrm * n_all[idx]).sum(dim=1).mean()
            loss = kl + cos
            opt.zero_grad(set_to_none=True)
            loss.backward()
            opt.step()
            tot, cnt, step = tot + float(loss.detach()) * len(idx), cnt + len(idx), step + 1
        losses.append(round(tot / cnt, 5))
        if epoch % 10 == 0 or epoch == EPOCHS - 1:
            log(f"{name} epoch {epoch + 1}/{EPOCHS} loss {losses[-1]:.4f} {time.time() - t0:.0f}s")
    if device.type == "mps":
        torch.mps.synchronize()
    return model, {"epochLoss": losses, "trainSeconds": round(time.time() - t0, 1)}


def runs_for(pilot_rows: list[dict], variant: str = "full") -> list[dict]:
    groups = sorted({r["splitGroup"] for r in pilot_rows})
    pre = "" if variant == "full" else f"{variant}-"
    out = [{"name": f"{pre}frozen-{SEED}", "kind": "frozen", "seed": SEED}]
    out += [{"name": f"{pre}logo-{k + 1}", "kind": "logo", "seed": SEED, "heldOut": g} for k, g in enumerate(groups)]
    if variant == "full":
        out += [{"name": f"frozen-{s}", "kind": "frozen", "seed": s} for s in EXTRA_SEEDS]
    return out


def cmd_runall(args: argparse.Namespace) -> None:
    device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    P = load_table(args.pilot_table, args.pilot_crops)
    Y = load_table(args.yardstick_table, args.yardstick_crops)
    if any(r["set"] != "pilot-000" for r in P["rows"]) or any(r["set"] == "pilot-000" for r in Y["rows"]):
        raise SystemExit("NS-11: the training table must be pilot-000 and the yardstick table must not be")
    out, wdir = Path(args.out), Path(args.weights)
    out.mkdir(parents=True, exist_ok=True)
    wdir.mkdir(parents=True, exist_ok=True)
    split = np.array([r["split"] for r in P["rows"]])
    group = np.array([r["splitGroup"] for r in P["rows"]])
    t_all = time.time()
    # The cap is on the card's total training wall time, so earlier invocations' runs count against it.
    prior = sum(json.loads((d / "run.json").read_text())["wallSeconds"] for d in (out / "runs").glob("*") if (d / "run.json").exists())
    summary = []
    for run in runs_for(P["rows"], args.variant):
        rdir = out / "runs" / run["name"]
        if (rdir / "run.json").exists() and not args.again:
            log(f"{run['name']}: already done (kept)")
            continue
        if prior + time.time() - t_all > CAP_SECONDS - 60:
            log(f"{run['name']}: SKIPPED, the two-hour cap would be exceeded")
            summary.append({"name": run["name"], "skipped": "wall-time cap"})
            continue
        rdir.mkdir(parents=True, exist_ok=True)
        if run["kind"] == "frozen":
            train_idx, eval_idx = np.where(split == "train")[0], np.where(split == "val")[0]
        else:
            train_idx, eval_idx = np.where(group != run["heldOut"])[0], np.where(group == run["heldOut"])[0]
        if set(group[train_idx]) & set(group[eval_idx]):
            raise SystemExit("NS-11: a split group is on both sides")
        t0 = time.time()
        model, info = train_one(run["name"], run["seed"], P, train_idx, device, args.variant)
        rows = []
        sh, nm = predict(model, P["x"][eval_idx], P["g"][eval_idx], device, args.variant)
        rows += [{"set": "pilot-000", "i": int(i), "shares": [round(float(v), 5) for v in s], "normal": [round(float(v), 5) for v in n]}
                 for i, s, n in zip(eval_idx, sh, nm)]
        if run["kind"] == "frozen":
            sh, nm = predict(model, Y["x"], Y["g"], device, args.variant)
            rows += [{"set": "yardstick", "i": int(i), "shares": [round(float(v), 5) for v in s], "normal": [round(float(v), 5) for v in n]}
                     for i, (s, n) in enumerate(zip(sh, nm))]
        with open(rdir / "preds.jsonl", "w") as f:
            f.writelines(json.dumps(r) + "\n" for r in rows)
        peak_mps = int(torch.mps.driver_allocated_memory()) if device.type == "mps" else 0
        meta = {**{k: v for k, v in run.items()}, **info, "device": device.type, "params": n_params(model),
                "trainRows": int(len(train_idx)), "evalRows": int(len(eval_idx)),
                "trainGroups": sorted(set(group[train_idx].tolist())), "evalGroups": sorted(set(group[eval_idx].tolist())),
                "wallSeconds": round(time.time() - t0, 1), "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                "mpsAllocatedBytes": peak_mps, "variant": args.variant, "epochs": EPOCHS, "batch": BATCH, "lr": LR}
        if run["name"] == f"frozen-{SEED}" and args.variant == "full":
            torch.save({k: v.cpu() for k, v in model.state_dict().items()}, wdir / "student.pt")
            meta["weights"] = str(wdir / "student.pt")
        (rdir / "run.json").write_text(json.dumps(meta) + "\n")
        summary.append({"name": run["name"], "wallSeconds": meta["wallSeconds"]})
        log(f"{run['name']}: done in {meta['wallSeconds']}s, cumulative {prior + time.time() - t_all:.0f}s")
    (out / "runall.json").write_text(json.dumps({"seconds": round(time.time() - t_all, 1), "runs": summary,
                                                 "peakRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("normals")
    a.add_argument("--inputs", required=True)
    a.add_argument("--out", required=True)
    b = sub.add_parser("crops")
    b.add_argument("--table", required=True)
    b.add_argument("--out", required=True)
    c = sub.add_parser("runall")
    for k in ("pilot-table", "pilot-crops", "yardstick-table", "yardstick-crops", "out", "weights"):
        c.add_argument(f"--{k}", required=True)
    c.add_argument("--again", action="store_true", help="re-run a run whose run.json exists (default: keep it)")
    c.add_argument("--variant", default="full", choices=["full", "geomonly", "croponly"], help="geomonly and croponly are exploratory ablations (not pre-registered)")
    args = ap.parse_args()
    {"normals": cmd_normals, "crops": cmd_crops, "runall": cmd_runall}[args.cmd](args)


if __name__ == "__main__":
    main()
