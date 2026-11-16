#!/usr/bin/env python3
"""Bills and plumage for the selfie bird, cut from Truman's own photos.

Each entry in ../birds.json names a photo, a crop around the bird's head, the
box the bill sits in and the line where it meets the head, and boxes of plain
plumage for the crown and neck feathers. The plate pipeline's cutout (rembg)
finds the bird; the bill is the cutout beyond that line, inside the box,
optionally narrowed to a hue window so a coloured bill keeps its real edge
against the feathers. Usage is in ../SKILL.md ("Bird parts for the selfie
bird").

Writes, for every bird and part:
  src/assets/birding/<bird>-<part>.webp   the part in colour, alpha = its outline
                                          (crown and neck: plain plumage crops)
  src/lib/hobbies/bird-parts.json          size, base line and tip in patch pixels

    python bird_parts.py [names ...]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stipple as S  # noqa: E402

BIRDS = S.SKILL / "birds.json"
OUT_IMG = S.REPO / "src" / "assets" / "birding"
OUT_JSON = S.REPO / "src" / "lib" / "hobbies" / "bird-parts.json"
# Longest side of a stored part. The selfie bird draws a bill up to about 600 px
# long on its 1024 px download, so this keeps the photo's detail.
MAX_SIDE = 640
# Plumage is a texture tiled across many small feathers, so it can be small.
PLUMAGE_SIDE = 256
MARGIN = 6


def side(points, a, b):
    """Signed side of each point relative to the line a -> b."""
    return (b[0] - a[0]) * (points[..., 1] - a[1]) - (b[1] - a[1]) * (points[..., 0] - a[0])


def cut_part(rgb, m, part):
    H, W = m.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    pts = np.stack([xx / W, yy / H], axis=-1)
    x0, y0, x1, y1 = part["box"]
    inbox = (pts[..., 0] >= x0) & (pts[..., 0] <= x1) & (pts[..., 1] >= y0) & (pts[..., 1] <= y1)
    a, b = part["base"]
    s = side(pts, a, b)
    solid = (m > 0.5) & inbox
    # The part is on whichever side of the base line holds more of the box.
    far = s > 0 if (solid & (s > 0)).sum() > (solid & (s < 0)).sum() else s < 0
    keep = solid & far
    if part.get("exclude"):
        keep &= S.poly_mask((H, W), part["exclude"]) < 0.5
    if part.get("include"):
        keep |= (S.poly_mask((H, W), part["include"]) > 0.5) & inbox
    if part.get("hue"):
        h0, h1, smin = part["hue"]
        hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
        hue = (hsv[..., 0] >= h0) & (hsv[..., 0] <= h1) & (hsv[..., 1] >= smin)
        hue = cv2.morphologyEx(hue.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0
        keep &= ndimage.binary_fill_holes(hue)
    lab, n = ndimage.label(keep)
    if n == 0:
        raise SystemExit(f"Nothing left of the part inside {part['box']}. Check box and base.")
    sizes = ndimage.sum(keep, lab, range(1, n + 1))
    keep = lab == 1 + int(np.argmax(sizes))
    keep = ndimage.binary_fill_holes(keep)
    # Soft edge from the cutout where it's the outline, hard where the base cut it.
    alpha = np.where(keep, np.clip(np.maximum(m, S.poly_mask((H, W), part.get("include", [])) if part.get("include") else m), 0, 1), 0.0).astype(np.float32)
    alpha = np.maximum(alpha, cv2.erode(keep.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32))
    alpha = cv2.GaussianBlur(alpha, (0, 0), 0.6) * keep
    return alpha


def export(rgb, alpha, base, name, part):
    H, W = alpha.shape
    ys, xs = np.nonzero(alpha > 0.02)
    bx0, by0 = max(0, xs.min() - MARGIN), max(0, ys.min() - MARGIN)
    bx1, by1 = min(W, xs.max() + 1 + MARGIN), min(H, ys.max() + 1 + MARGIN)
    scale = min(1.0, MAX_SIDE / max(bx1 - bx0, by1 - by0))
    rgba = np.dstack([rgb[by0:by1, bx0:bx1], alpha[by0:by1, bx0:bx1]])
    im = Image.fromarray((np.clip(rgba, 0, 1) * 255).astype(np.uint8), "RGBA")
    w, h = max(1, round(im.size[0] * scale)), max(1, round(im.size[1] * scale))
    im = im.resize((w, h), Image.LANCZOS)
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    path = OUT_IMG / f"{name}-{part}.webp"
    im.save(path, "WEBP", quality=88, alpha_quality=100, method=6)

    def to_patch(p):
        return [round((p[0] * W - bx0) * scale, 1), round((p[1] * H - by0) * scale, 1)]

    a, b = to_patch(base[0]), to_patch(base[1])
    mid = np.array([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
    sa = np.asarray(im.split()[-1]) > 40
    py, px = np.nonzero(sa)
    d = np.hypot(px - mid[0], py - mid[1])
    k = int(np.argmax(d))
    tip = [float(px[k]), float(py[k])]
    print(f"{name:20s} {part:5s} {w}x{h}  {path.stat().st_size // 1024} KB", flush=True)
    return {"w": w, "h": h, "base": [a, b], "tip": tip}


def plumage(name, cfg):
    """Feather texture: plain crops of the bird's own plumage, for the crown
    and neck feathers. Boxes are in the plumage entry's own crop."""
    pl = cfg["plumage"]
    path = S.resolve_src(cfg["src"])
    rgb = S.load_rgb(path, pl.get("crop"), cfg.get("flip", False), maxside=4000)
    H, W = rgb.shape[:2]
    out = {}
    for part in ("crown", "neck"):
        if part not in pl:
            continue
        x0, y0, x1, y1 = pl[part]
        crop = rgb[int(y0 * H) : int(y1 * H), int(x0 * W) : int(x1 * W)]
        im = Image.fromarray((np.clip(crop, 0, 1) * 255).astype(np.uint8), "RGB")
        im.thumbnail((PLUMAGE_SIDE, PLUMAGE_SIDE), Image.LANCZOS)
        OUT_IMG.mkdir(parents=True, exist_ok=True)
        dest = OUT_IMG / f"{name}-{part}.webp"
        im.save(dest, "WEBP", quality=86, method=6)
        print(f"{name:20s} {part:5s} {im.size[0]}x{im.size[1]}  {dest.stat().st_size // 1024} KB", flush=True)
        out[part] = {"w": im.size[0], "h": im.size[1]}
    return out


def build(name, cfg):
    path = S.resolve_src(cfg["src"])
    rgb = S.load_rgb(path, cfg.get("crop"), cfg.get("flip", False), maxside=4000)
    key = S.hashlib.sha1(json.dumps([str(path), cfg.get("crop"), cfg.get("flip", False), "parts"]).encode()).hexdigest()[:16]
    m = S.cutout(rgb, key)
    out = {}
    for part in ("bill",):
        if part in cfg:
            alpha = cut_part(rgb, m, cfg[part])
            out[part] = export(rgb, alpha, cfg[part]["base"], name, part)
    if "plumage" in cfg:
        out.update(plumage(name, cfg))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Cut bills and plumage for the selfie bird.")
    ap.add_argument("names", nargs="*", help="birds to cut (default: all)")
    a = ap.parse_args(argv)
    birds = {k: v for k, v in json.loads(BIRDS.read_text()).items() if not k.startswith("$")}
    names = a.names or list(birds)
    data = json.loads(OUT_JSON.read_text()) if OUT_JSON.exists() else {}
    for n in names:
        if n not in birds:
            raise SystemExit(f"Unknown bird {n}. Add it to {BIRDS}.")
        data[n] = build(n, birds[n])
    data = {k: data[k] for k in birds if k in data}
    # Number pairs on one line, the way Prettier lays the file out.
    text = re.sub(
        r"\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]",
        lambda m: "[" + ", ".join(v.strip() for v in m[1].split(",")) + "]",
        json.dumps(data, indent=2),
    )
    OUT_JSON.write_text(text + "\n")
    print(f"wrote {OUT_JSON.relative_to(S.REPO)}", file=sys.stderr)


if __name__ == "__main__":
    main()
