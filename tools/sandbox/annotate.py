"""把 detectSelfMarker 的输出画回小地图上，供人工核对。

朝向这种量没有现成真值，靠肉眼看箭头是唯一诚实的验收方式：
先渲染标注图人工确认，确认无误后才把算出来的值冻结成回归基线。

用法：
    # 先跑 TS 探针导出 marker_probe.json，再：
    python tools/sandbox/annotate.py --probe <path>/marker_probe.json --out <path>/annotated.png
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.abspath(os.path.join(HERE, "..", "..", "src", "sandbox", "__fixtures__"))

SCALE = 3  # 480p 下小地图只有 178x100，不放大根本看不清 7px 的圆盘


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--probe", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--fixtures", default=FIX)
    args = ap.parse_args()

    manifest = json.load(open(os.path.join(args.fixtures, "frames.json"), encoding="utf-8"))
    blob = gzip.open(os.path.join(args.fixtures, "frames.bin.gz"), "rb").read()
    probe = {(r["stream"], r["t"]): r for r in json.load(open(args.probe, encoding="utf-8"))}

    tiles = []
    for rec in manifest["frames"]:
        roi = rec["rois"]["minimap"]
        w, h = roi["w"], roi["h"]
        rgba = np.frombuffer(blob, dtype=np.uint8, count=w * h * 4, offset=roi["offset"]).reshape(h, w, 4)
        img = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGR).copy()
        img = cv2.resize(img, (w * SCALE, h * SCALE), interpolation=cv2.INTER_NEAREST)

        r = probe.get((rec["stream"], rec["t"]))
        label = f"{rec['stream'][:3]}@{rec['t']}"
        if r and r["found"]:
            cx, cy = r["x"] * w * SCALE, r["y"] * h * SCALE
            rad = max(4.0, r["radius"] * SCALE)
            cv2.circle(img, (int(cx), int(cy)), int(rad), (0, 255, 255), 1)
            cv2.drawMarker(img, (int(cx), int(cy)), (0, 255, 255), cv2.MARKER_CROSS, 8, 1)
            if r["headingDeg"] is not None:
                a = math.radians(r["headingDeg"])
                # 屏幕坐标 y 向下，所以这里直接用 +sin，不取反
                ex, ey = cx + math.cos(a) * rad * 4, cy + math.sin(a) * rad * 4
                cv2.arrowedLine(img, (int(cx), int(cy)), (int(ex), int(ey)), (0, 0, 255), 2, tipLength=0.35)
                label += f" {r['headingDeg']:.0f}deg"
            else:
                label += " no-heading"
        else:
            label += " MISS"
        cv2.rectangle(img, (0, 0), (img.shape[1] - 1, 18), (0, 0, 0), -1)
        cv2.putText(img, label, (3, 13), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 255), 1)
        tiles.append(img)

    cols = 4
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    grid = np.vstack([np.hstack(tiles[i : i + cols]) for i in range(0, len(tiles), cols)])
    cv2.imwrite(args.out, grid)
    print(f"{len(manifest['frames'])} 帧 → {args.out}  {grid.shape}")


if __name__ == "__main__":
    main()
