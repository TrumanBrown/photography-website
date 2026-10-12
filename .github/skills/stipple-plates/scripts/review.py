#!/usr/bin/env python3
"""Review sheets for stipple plates. Usage is in ../SKILL.md.

    python review.py masks [names ...]   cutouts over each photo, with 0-1 grids
    python review.py plates [names ...]  plates at real display size, both themes
    python review.py zoom NAME --box x0,y0,x1,y1 [--raw]
                                         close-up with cutout outline and 0.05 grid

Sheets go to ~/.cache/stipple-plates/review/ and the path is printed.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stipple as S  # noqa: E402

OUT = S.CACHE / "review"
PAPER = {"light": (251, 250, 248), "dark": (18, 18, 17)}  # --paper per theme


def grid(im, color=(220, 0, 0)):
    """Label tenths along the edges so crops and polygons can be read off."""
    d = ImageDraw.Draw(im)
    W, H = im.size
    for k in range(1, 10):
        c = color if k == 5 else tuple(int(v * 0.55 + 255 * 0.45) for v in color)
        d.line([(W * k / 10, 0), (W * k / 10, H)], fill=c, width=1)
        d.line([(0, H * k / 10), (W, H * k / 10)], fill=c, width=1)
        d.text((W * k / 10 + 2, 2), f".{k}", fill=color)
        d.text((2, H * k / 10 + 2), f".{k}", fill=color)
    return im


def masks(names, subjects):
    """Left: the whole photo with the crop box. Right: the crop with the cutout;
    exclude polygons and skin_out boxes use the right-hand coordinates."""
    rows = []
    for n in names:
        cfg = subjects[n]
        if cfg.get("kind") == "globe":
            continue
        path = S.resolve_src(cfg["src"], cfg.get("photo", 0))
        full = Image.fromarray((S.load_rgb(path, None, cfg.get("flip", False), maxside=900) * 255).astype(np.uint8))
        c = cfg.get("crop")
        if c:
            W, H = full.size
            ImageDraw.Draw(full).rectangle([c[0] * W, c[1] * H, c[2] * W - 1, c[3] * H - 1], outline=(0, 90, 255), width=3)
        rgb, key = S.source_rgb(cfg)
        m, _ = S.subject_mask(cfg, rgb, key)
        rgb, m = S.retouch(rgb, m, cfg, key)
        vis = (rgb * 255).astype(np.uint8)
        out = m < 0.5
        vis[out] = (vis[out] * 0.25 + 255 * 0.75).astype(np.uint8)
        cut = Image.fromarray(vis)
        cut.thumbnail((900, 900))
        full.thumbnail((620, 620))
        h = max(full.height, cut.height) + 22
        row = Image.new("RGB", (full.width + cut.width + 12, h), "white")
        row.paste(grid(full, (0, 90, 255)), (0, 22))
        row.paste(grid(cut), (full.width + 12, 22))
        ImageDraw.Draw(row).text((4, 4), f"{n}  ·  {cfg.get('note', '')}  ·  coverage {float((m > 0.5).mean()):.2f}", fill=(0, 0, 0))
        rows.append(row)
    return stack(rows, "masks")


def zoom(name, cfg, box, raw=False):
    """A close-up of part of the cropped photo with the cutout outline and a
    0.05 grid in subject coordinates, for placing polygons and graft points.
    raw=True shows the photo before retouching (inpaint, graft, lift)."""
    import cv2

    rgb, key = S.source_rgb(cfg)
    m, _ = S.subject_mask(cfg, rgb, key)
    if not raw:
        rgb, m = S.retouch(rgb, m, cfg, key)
    H, W = m.shape
    x0, y0, x1, y1 = box
    sub = (rgb[int(y0 * H) : int(y1 * H), int(x0 * W) : int(x1 * W)] * 255).astype(np.uint8).copy()
    ms = m[int(y0 * H) : int(y1 * H), int(x0 * W) : int(x1 * W)]
    edge = cv2.dilate(cv2.Canny((ms > 0.5).astype(np.uint8) * 255, 50, 150), np.ones((2, 2), np.uint8)) > 0
    sub[edge] = (255, 0, 0)
    im = Image.fromarray(sub)
    im = im.resize((900, max(1, int(im.height * 900 / im.width))), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    w, h = im.size
    for k in np.arange(0, 1.0001, 0.05):
        major = abs(k * 10 - round(k * 10)) < 1e-6
        X, Y = (k - x0) / (x1 - x0) * w, (k - y0) / (y1 - y0) * h
        if 0 <= X <= w:
            d.line([(X, 0), (X, h)], fill=(0, 220, 220) if major else (0, 110, 110), width=1)
            d.text((X + 2, 2), f"{k:.2f}", fill=(255, 255, 0))
        if 0 <= Y <= h:
            d.line([(0, Y), (w, Y)], fill=(0, 220, 220) if major else (0, 110, 110), width=1)
            d.text((2, Y + 2), f"{k:.2f}", fill=(255, 255, 0))
    return stack([im], f"zoom-{name}")


def plates(names, src_dir, size, themes):
    """Plates downsampled to the size a visitor sees them (half the render)."""
    W, H, _ = S.SIZES[size]
    w, h = W // 2, H // 2
    rows = []
    for theme in themes:
        suffix = "" if theme == "light" else "-dark"
        tiles = []
        for n in names:
            f = src_dir / f"{n}-{size}{suffix}.webp"
            if not f.exists():
                print(f"missing {f}", file=sys.stderr)
                continue
            im = Image.open(f).convert("RGBA")
            bg = Image.new("RGBA", im.size, PAPER[theme] + (255,))
            bg.alpha_composite(im)
            tile = bg.convert("RGB").resize((w, h), Image.LANCZOS)
            ImageDraw.Draw(tile).text((6, h - 14), n, fill=(128, 128, 128))
            tiles.append(tile)
        if not tiles:
            continue
        cols = min(4, len(tiles))
        nr = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * w + (cols - 1) * 8, nr * h + (nr - 1) * 8), PAPER[theme])
        for k, t in enumerate(tiles):
            sheet.paste(t, ((k % cols) * (w + 8), (k // cols) * (h + 8)))
        rows.append(sheet)
    return stack(rows, f"plates-{size}")


def stack(rows, label):
    if not rows:
        raise SystemExit("Nothing to show.")
    W = max(r.width for r in rows)
    sheet = Image.new("RGB", (W, sum(r.height for r in rows) + 12 * (len(rows) - 1)), (190, 190, 190))
    y = 0
    for r in rows:
        sheet.paste(r, (0, y))
        y += r.height + 12
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{label}.png"
    sheet.save(path)
    return path


def main(argv=None):
    ap = argparse.ArgumentParser(description="Review stipple cutouts and plates.")
    ap.add_argument("mode", choices=["masks", "plates", "zoom"])
    ap.add_argument("names", nargs="*")
    ap.add_argument("--subjects", default=str(S.SKILL / "subjects.json"))
    ap.add_argument("--dir", default=str(S.DEFAULT_OUT), help="where the plates are (plates mode)")
    ap.add_argument("--size", default="card", choices=list(S.SIZES))
    ap.add_argument("--themes", default="light,dark")
    ap.add_argument("--box", default="0,0,1,1", help="zoom mode: x0,y0,x1,y1 in subject coordinates")
    ap.add_argument("--raw", action="store_true", help="zoom mode: before inpaint, graft and lift")
    a = ap.parse_intermixed_args(argv)
    subjects = S.load_subjects(a.subjects)
    names = a.names or list(subjects)
    if a.mode == "masks":
        print(masks(names, subjects))
    elif a.mode == "zoom":
        box = tuple(float(v) for v in a.box.split(","))
        for n in names:
            print(zoom(n, subjects[n], box, a.raw))
    else:
        print(plates(names, Path(a.dir), a.size, a.themes.split(",")))


if __name__ == "__main__":
    main()
