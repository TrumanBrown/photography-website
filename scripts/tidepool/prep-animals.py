#!/usr/bin/env python3
"""Turn the tide pool animal cutouts into the sprites the toy draws.

The cutouts are CC0 and public-domain photos of each animal seen from above,
cut out by hand from staging/tide-pooling/top/ (cut/<id>.png and
animals.json, which records each photo's page, author and licence). This
evens out their exposure so they sit together on one beach, darkens each
one a little where it meets the rock, and writes a height map from its
outline and surface detail, which the toy uses to light every animal from
the scene's own sun at whatever angle it's turned.

    PY=~/.cache/stipple-plates/venv/bin/python
    $PY scripts/tidepool/prep-animals.py

Writes public/tidepool/<v>/animals/<id>.webp (colour) and <id>-h.webp (height,
grey), and src/lib/hobbies/tidepool-animals.json (size in cm, view, credit).
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

# Keep in step with VERSION in build-beaches.py.
VERSION = "v1"
REPO = Path(__file__).resolve().parents[2]
SRC = Path(os.environ.get("TIDEPOOL_STAGING", REPO / "staging" / "tide-pooling" / "top"))
OUT = REPO / "public" / "tidepool" / VERSION / "animals"
META = REPO / "src" / "lib" / "hobbies" / "tidepool-animals.json"
MAX = 600


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def prep(aid: str, rec: dict) -> dict | None:
    path = SRC / rec["file"]
    if not path.exists():
        print("missing", aid)
        return None
    im = np.asarray(Image.open(path).convert("RGBA")).astype(np.float32) / 255
    h, w = im.shape[:2]
    k = min(1.0, MAX / max(h, w))
    if k < 1:
        im = cv2.resize(im, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
        h, w = im.shape[:2]
    rgb, a = im[..., :3], im[..., 3]
    solid = a > 0.5
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    med = float(np.median(lum[solid])) if solid.any() else 0.4
    # Even out exposure across photos, gently, so a dark chiton stays dark.
    gain = float(np.clip((0.4 / max(med, 0.05)) ** 0.45, 0.82, 1.3))
    rgb = rgb * gain
    # One overcast coast: a touch cooler, a touch less saturated.
    l3 = (rgb @ np.array([0.299, 0.587, 0.114], np.float32))[..., None]
    rgb = l3 + (rgb - l3) * 0.93
    rgb *= np.array([0.985, 1.0, 1.015], np.float32)
    # Darker where it meets the rock.
    dist = cv2.distanceTransform((a > 0.5).astype(np.uint8), cv2.DIST_L2, 5)
    rim = smoothstep(0, max(3.0, 0.03 * max(h, w)), dist)
    rgb *= (0.8 + 0.2 * rim)[..., None]
    rgb = np.clip(rgb, 0, 1)
    # Height: a dome from the outline plus the surface's own detail.
    dmax = dist.max() or 1
    dome = np.sqrt(np.clip(dist / dmax, 0, 1))
    detail = lum - cv2.GaussianBlur(lum, (0, 0), max(2.0, 0.012 * max(h, w)))
    hgt = np.clip(0.78 * dome + 0.22 * (0.5 + detail * 2.4), 0, 1) * (a > 0.02)
    hgt = cv2.GaussianBlur(hgt.astype(np.float32), (0, 0), 0.8)
    Image.fromarray((np.dstack([rgb, a]) * 255).astype(np.uint8), "RGBA").save(OUT / f"{aid}.webp", "WEBP", quality=90, method=6)
    Image.fromarray((hgt * 255).astype(np.uint8), "L").save(OUT / f"{aid}-h.webp", "WEBP", lossless=True, method=6)
    ys, xs = np.nonzero(solid)
    return dict(
        cm=rec.get("cm"),
        view=rec.get("view", "top"),
        w=w,
        h=h,
        # The opaque part's box, as shares of the sprite.
        box=[round(xs.min() / w, 3), round(ys.min() / h, 3), round((xs.max() + 1) / w, 3), round((ys.max() + 1) / h, 3)] if len(xs) else [0, 0, 1, 1],
        credit=dict(author=rec.get("author"), page=rec.get("page"), license=rec.get("license")),
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    recs = json.loads(Path(os.environ.get("TIDEPOOL_ANIMALS", SRC / "animals.json")).read_text())
    out = {}
    for aid, rec in sorted(recs.items()):
        r = prep(aid, rec)
        if r:
            out[aid] = r
    META.write_text(json.dumps(out, indent=1) + "\n")
    print(len(out), "animals ->", OUT.relative_to(REPO), "and", META.relative_to(REPO))


if __name__ == "__main__":
    main()
