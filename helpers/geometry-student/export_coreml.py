"""NS-11 Core ML export and Mac measurements of the frozen-split artifact (prereg §6).

Converts the registered student (`student.pt`, float32 state dict) with coremltools to an `mlprogram` with float16
weights: input one 128x128 RGB crop (the standardisation folded into the image input's scale and bias) and the
12-number geometry vector; outputs the three face shares (softmax baked in) and the unit normal. If the conversion
fails, the failure is written to the report and the architecture is NOT changed (the card reports why).

Measured on the Mac only (the phone benchmark is NS-9's): package size; the Core ML output against the float32 PyTorch
output on validation boxes; single-box latency (batch of one: median and 90th percentile over `--timed` predictions
after `--warmup`) for CPU_ONLY, CPU_AND_GPU, CPU_AND_NE and ALL; PyTorch MPS throughput at batch 64. The Python
call's own overhead is inside the timing. Nothing leaves the machine; no download.

    python -I export_coreml.py --weights student.pt --table T.jsonl --crops C.npz --out DIR/student.mlpackage --report R.json
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import numpy as np  # noqa: E402
import student as S  # noqa: E402  (also blocks the network and sets the offline environment)
import torch  # noqa: E402
import torch.nn as nn  # noqa: E402
import torch.nn.functional as Fn  # noqa: E402


class Exported(nn.Module):
    """The network with its outputs finished: softmax shares and a unit normal (the input is already standardised)."""

    def __init__(self, net: S.GeometryStudentNet) -> None:
        super().__init__()
        self.net = net

    def forward(self, crop: torch.Tensor, geometry: torch.Tensor):
        face, normal = self.net(crop, geometry)
        return Fn.softmax(face, dim=1), normal


def dir_bytes(p: Path) -> int:
    return sum(f.stat().st_size for f in p.rglob("*") if f.is_file())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--table", required=True)
    ap.add_argument("--crops", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--warmup", type=int, default=30)
    ap.add_argument("--timed", type=int, default=300)
    args = ap.parse_args()

    report: dict = {"coremltools": None, "torch": torch.__version__, "exported": False}
    net = S.GeometryStudentNet()
    net.load_state_dict(torch.load(args.weights, map_location="cpu", weights_only=True))
    net.eval()
    report["params"] = S.n_params(net)

    rows = [json.loads(l) for l in open(args.table)]
    z = np.load(args.crops)
    val = [i for i, r in enumerate(rows) if r["split"] == "val"][:: max(1, sum(r["split"] == "val" for r in rows) // 128)][:128]
    crops_u8, geom = z["crops"][val], z["geom"][val]
    x = S.standardise(torch.from_numpy(crops_u8).permute(0, 3, 1, 2).float() / 255)
    with torch.no_grad():
        ref_s, ref_n = Exported(net)(x, torch.from_numpy(geom))
    ref_s, ref_n = ref_s.numpy(), ref_n.numpy()

    try:
        import coremltools as ct
        from PIL import Image

        report["coremltools"] = ct.__version__
        traced = torch.jit.trace(Exported(net), (x[:1], torch.from_numpy(geom[:1])))
        mlmodel = ct.convert(
            traced,
            inputs=[
                ct.ImageType(name="crop", shape=(1, 3, S.CROP, S.CROP), scale=1 / (255 * S.STD), bias=[-S.MEAN / S.STD] * 3, color_layout=ct.colorlayout.RGB),
                ct.TensorType(name="geometry", shape=(1, S.GEOM_DIM), dtype=np.float32),
            ],
            outputs=[ct.TensorType(name="shares"), ct.TensorType(name="normal")],
            convert_to="mlprogram",
            compute_precision=ct.precision.FLOAT16,
            minimum_deployment_target=ct.target.iOS17,
        )
        out = Path(args.out)
        if out.exists():
            raise SystemExit(f"{out} exists; this card deletes nothing: move it aside first")
        mlmodel.save(str(out))
        report.update({"exported": True, "packageBytes": dir_bytes(out), "precision": "float16", "format": "mlprogram", "minimumDeployment": "iOS17"})

        images = [Image.fromarray(c) for c in crops_u8]
        units = {"CPU_ONLY": ct.ComputeUnit.CPU_ONLY, "CPU_AND_GPU": ct.ComputeUnit.CPU_AND_GPU, "CPU_AND_NE": ct.ComputeUnit.CPU_AND_NE, "ALL": ct.ComputeUnit.ALL}
        report["latencyMs"], report["agreement"] = {}, {}
        for name, cu in units.items():
            try:
                t0 = time.time()
                m = ct.models.MLModel(str(out), compute_units=cu)
                load_s = time.time() - t0
                feeds = [{"crop": im, "geometry": g[None].astype(np.float32)} for im, g in zip(images, geom)]
                for k in range(args.warmup):
                    m.predict(feeds[k % len(feeds)])
                times, preds = [], []
                for k in range(args.timed):
                    t = time.perf_counter()
                    r = m.predict(feeds[k % len(feeds)])
                    times.append((time.perf_counter() - t) * 1000)
                    if k < len(feeds):
                        preds.append(r)
                times.sort()
                report["latencyMs"][name] = {"median": round(statistics.median(times), 3), "p90": round(times[int(0.9 * len(times)) - 1], 3),
                                             "loadSeconds": round(load_s, 2), "timedCalls": len(times)}
                ps = np.stack([np.asarray(p["shares"]).reshape(3) for p in preds])
                pn = np.stack([np.asarray(p["normal"]).reshape(3) for p in preds])
                cos = np.clip((pn * ref_n[: len(pn)]).sum(1) / (np.linalg.norm(pn, axis=1) + 1e-9), -1, 1)
                report["agreement"][name] = {"boxCount": len(ps), "maxAbsShareDiff": round(float(np.abs(ps - ref_s[: len(ps)]).max()), 5),
                                             "maxNormalDiffDeg": round(float(np.degrees(np.arccos(cos)).max()), 4),
                                             "top1Same": round(float((ps.argmax(1) == ref_s[: len(ps)].argmax(1)).mean()), 4)}
                print(f"[ns11] {name}: median {report['latencyMs'][name]['median']} ms", file=sys.stderr, flush=True)
            except Exception as e:  # a compute-unit that cannot load is a finding, not a stop
                report["latencyMs"][name] = {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    except SystemExit:
        raise
    except Exception as e:
        report["error"] = f"{type(e).__name__}: {str(e)[:500]}"
        report["traceback"] = traceback.format_exc()[-1500:]

    if torch.backends.mps.is_available():
        dev = torch.device("mps")
        m = net.to(dev).eval()
        xb, gb = x[:64].to(dev), torch.from_numpy(geom[:64]).to(dev)
        xb = xb if len(xb) == 64 else xb.repeat(64 // len(xb) + 1, 1, 1, 1)[:64]
        gb = gb if len(gb) == 64 else gb.repeat(64 // len(gb) + 1, 1)[:64]
        with torch.no_grad():
            for _ in range(10):
                m(xb, gb)
            torch.mps.synchronize()
            t = time.perf_counter()
            for _ in range(50):
                m(xb, gb)
            torch.mps.synchronize()
        sec = (time.perf_counter() - t) / 50
        report["mpsBatch64"] = {"secondsPerBatch": round(sec, 5), "boxesPerSecond": round(64 / sec, 1)}
    Path(args.report).write_text(json.dumps(report, indent=1) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "traceback"}), file=sys.stderr)


if __name__ == "__main__":
    main()
