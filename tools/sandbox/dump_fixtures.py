"""按 fixtures.spec.json 从赛事录屏抽取 ROI 像素，生成 TS 测试用的夹具。

只存 ROI 而非整帧：整帧 852x480 RGBA 是 1.6MB，一份夹具就能把仓库撑爆；
ROI 加起来约 100KB，gzip 后几十 KB。测试侧再把 ROI 贴回一张全尺寸空白帧，
这样被测函数拿到的仍是「一整帧」，公开 API 不必为测试让步。

用法：
    python tools/sandbox/dump_fixtures.py                    # 生成提交进仓库的小夹具
    python tools/sandbox/dump_fixtures.py --sweep 20         # 全场每 20s 抽一帧，输出到 testdata/（不提交）
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))

# 与 src/rmui/layout.ts 一一对应。改了那边记得改这边——夹具裁错位比算法错更难查。
ROIS = {
    "minimap": (1460 / 1920, 773 / 1080, 1860 / 1920, 998 / 1080),
    "hpBar": (170 / 1920, 918 / 1080, 516 / 1920, 956 / 1080),
    "hpText": (215 / 1920, 923 / 1080, 318 / 1920, 949 / 1080),
    "topScoreboard": (0.16, 0.045, 0.39, 0.085),
    "redOutpostHp": (194 / 1920, 65 / 1080, 266 / 1920, 83 / 1080),
    "redBaseHp": (334 / 1920, 58 / 1080, 399 / 1920, 81 / 1080),
    "blueBaseHp": (1521 / 1920, 61 / 1080, 1584 / 1920, 79 / 1080),
    "blueOutpostHp": (1645 / 1920, 65 / 1080, 1724 / 1920, 83 / 1080),
    "droneMinimap": (975 / 1920, 595 / 1080, 1243 / 1920, 735 / 1080),
}


def resolve(rect, w, h):
    """与 TS 的 resolveRect 同样的取整方式，避免两边差一个像素。"""
    x = max(0, round(rect[0] * w))
    y = max(0, round(rect[1] * h))
    x1 = min(w, round(rect[2] * w))
    y1 = min(h, round(rect[3] * h))
    return x, y, max(0, x1 - x), max(0, y1 - y)


def grab(cap, t):
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * fps)))
    ok, frame = cap.read()
    return frame if ok else None


def extract(frame, names):
    """返回 {roi 名: (meta, RGBA bytes)}。OpenCV 是 BGR，TS 侧要 RGBA。"""
    h, w = frame.shape[:2]
    out = {}
    for name in names:
        x, y, rw, rh = resolve(ROIS[name], w, h)
        bgr = frame[y : y + rh, x : x + rw]
        rgba = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGBA)
        out[name] = ({"x": x, "y": y, "w": rw, "h": rh}, rgba.tobytes())
    return out


def build(spec, entries, out_dir, sweep_label=None):
    os.makedirs(out_dir, exist_ok=True)
    blob = bytearray()
    manifest = []
    caps = {}
    for e in entries:
        stream = e["stream"]
        if stream not in caps:
            path = os.path.join(spec["source"], stream + ".mp4")
            if not os.path.exists(path):
                sys.exit(f"找不到录屏：{path}")
            caps[stream] = cv2.VideoCapture(path)
        frame = grab(caps[stream], e["t"])
        if frame is None:
            print(f"  跳过 {stream}@{e['t']}s：读帧失败")
            continue
        h, w = frame.shape[:2]
        rois = {}
        # 逐帧可覆盖 ROI 集合：只为读血量而加的样本没必要背上 71KB 的小地图
        wanted = e.get("rois", spec["rois"])
        for name, (meta, data) in extract(frame, wanted).items():
            meta["offset"] = len(blob)
            blob.extend(data)
            rois[name] = meta
        record = {k: v for k, v in e.items() if not k.startswith("_")}
        record.update({"width": w, "height": h, "rois": rois})
        manifest.append(record)
        print(f"  {stream}@{e['t']}s  {w}x{h}")
    for cap in caps.values():
        cap.release()

    bin_path = os.path.join(out_dir, "frames.bin.gz")
    with gzip.open(bin_path, "wb", compresslevel=9) as fh:
        fh.write(bytes(blob))
    meta = {"generatedFrom": os.path.basename(spec["source"]), "frames": manifest}
    if sweep_label:
        meta["sweep"] = sweep_label
    with open(os.path.join(out_dir, "frames.json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, ensure_ascii=False, indent=2)
    print(f"\n{len(manifest)} 帧 → {out_dir}")
    print(f"  raw {len(blob)/1024:.0f}KB  gz {os.path.getsize(bin_path)/1024:.0f}KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", default=os.path.join(HERE, "fixtures.spec.json"))
    ap.add_argument("--sweep", type=int, default=0, help="全场按该秒数步进抽帧，输出到 testdata/（不提交）")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    with open(args.spec, encoding="utf-8") as fh:
        spec = json.load(fh)

    if args.sweep:
        # 精度评估用的大样本。三个回合的时段由音频静音边界定出（见 matchstate/signals.ts）。
        rounds = [(425, 857), (1289, 1721), (2033, 2462)]
        streams = [
            ("B1Hero", "blue"), ("B2SuqqreProject", "blue"), ("B3Infantry", "blue"), ("B4Infantry", "blue"),
            ("R1Hero", "red"), ("R2SuqqreProject", "red"), ("R3Infantry", "red"), ("R4Infantry", "red"),
        ]
        entries = [
            {"stream": s, "side": side, "t": t}
            for s, side in streams
            for a, b in rounds
            for t in range(a, b, args.sweep)
        ]
        out = args.out or os.path.join(REPO, "testdata", "sandbox")
        build(spec, entries, out, sweep_label=f"every {args.sweep}s over rounds")
    else:
        out = args.out or os.path.join(REPO, "src", "sandbox", "__fixtures__")
        build(spec, entries=spec["frames"], out_dir=out)


if __name__ == "__main__":
    main()
