#!/usr/bin/env python3
"""Pen-and-ink stipple plates from photographs. Usage is in ../SKILL.md.

Weighted Voronoi stippling (Secord 2002): dots are placed by Lloyd relaxation
over a darkness field, which gives the even, hand-placed spacing of real
stippling. Each subject is cut out and scaled into the same frame before it is
shaded, so pen size, tone and framing match across a set. Light theme is ink
on paper; dark theme is scratchboard (light dots where the photo is light), so
both read as positives.

    python stipple.py [--subjects FILE] [--out DIR] [--sizes card,mini]
                      [--themes light,dark] [--frames 3] [--list] [names ...]
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps
from scipy import ndimage
from scipy.spatial import cKDTree

SKILL = Path(__file__).resolve().parents[1]
CACHE = Path(os.environ.get("STIPPLE_CACHE", Path.home() / ".cache" / "stipple-plates"))
os.environ.setdefault("U2NET_HOME", str(CACHE / "u2net"))


def _repo_root() -> Path:
    for p in (SKILL, *SKILL.parents):
        if (p / ".git").exists():
            return p
    return Path.cwd()


REPO = _repo_root()
SESSIONS = REPO / "src" / "content" / "sessions"
DEFAULT_OUT = REPO / "mocks" / "things-to-try" / "assets" / "plates"
MAX_DOWNLOAD = 80 * 1024 * 1024

# name: (width, height, dot radius). Plates are shown at about half these
# sizes (2x for retina), so dots land near 1-1.5 CSS px: fine, still dots.
SIZES = {
    "card": (880, 660, 1.25),
    "mini": (360, 270, 1.15),
    # Small thumbnails (tabs, lists): subject only, framed tight, inked heavier
    # so the silhouette survives.
    "icon": (120, 90, 1.1),
}
ICON_OVERRIDES = dict(stones=False, bubbles=False, fill=(0.94, 0.88), cy=0.5)
INK = {"light": (22, 21, 15), "dark": (236, 233, 225)}  # --ink in each theme


# ----------------------------------------------------------------- sources
def resolve_src(src: str, photo: int = 0) -> Path:
    """Local path for a subject's source. Accepts an image URL, an iNaturalist
    observation URL, a session/file pair, or a path relative to the repo."""
    if re.match(r"https?://", src):
        # This site's blob originals are usually already on disk.
        m = re.match(r"https?://[^/]+/originals/([^/]+)/([^/?#]+)", src)
        if m and (SESSIONS / m[1] / "images" / m[2]).exists():
            return SESSIONS / m[1] / "images" / m[2]
        m = re.match(r"https?://(?:www\.)?inaturalist\.org/observations/(\d+)", src)
        if m:
            src = inat_photo_url(m[1], photo)
        return download(src)
    p = Path(src).expanduser()
    if p.is_absolute() and p.exists():
        return p
    if (REPO / p).exists():
        return REPO / p
    if len(p.parts) == 2 and (SESSIONS / p.parts[0] / "images" / p.parts[1]).exists():
        return SESSIONS / p.parts[0] / "images" / p.parts[1]
    if len(p.parts) == 2 and not p.is_absolute():
        # Session photos are gitignored (prebuild pulls them), so a fresh
        # clone fetches the public original from Blob Storage instead.
        host = blob_host()
        if host:
            return download(f"https://{host}/originals/{p.parts[0]}/{p.parts[1]}")
    raise SystemExit(f"Source not found: {src}")


def blob_host() -> str | None:
    cfg = REPO / "site.config.ts"
    m = re.search(r'blobHost:\s*"([^"]+)"', cfg.read_text()) if cfg.exists() else None
    return m[1] if m else None


def inat_photo_url(obs_id: str, photo: int = 0) -> str:
    url = f"https://api.inaturalist.org/v1/observations/{obs_id}"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "stipple-plates"}), timeout=30) as r:
            results = json.load(r).get("results") or []
    except urllib.error.URLError as exc:
        raise SystemExit(f"Could not reach iNaturalist for observation {obs_id} ({exc}).") from exc
    photos = results[0].get("photos") if results else None
    if not photos:
        raise SystemExit(f"iNaturalist observation {obs_id} has no photos.")
    return re.sub(r"/(square|small|medium|large)\.", "/original.", photos[min(photo, len(photos) - 1)]["url"])


def download(url: str) -> Path:
    folder = CACHE / "sources"
    folder.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(url.encode()).hexdigest()[:16]
    hits = [h for h in folder.glob(key + ".*") if h.suffix != ".part"]
    if hits:
        return hits[0]
    req = urllib.request.Request(url, headers={"User-Agent": "stipple-plates"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            if "text/html" in r.headers.get("Content-Type", ""):
                raise SystemExit(f"{url} is a web page, not an image. Open the photo and copy its image address.")
            data = r.read(MAX_DOWNLOAD + 1)
    except urllib.error.URLError as exc:
        raise SystemExit(f"Could not download {url} ({exc}).") from exc
    if len(data) > MAX_DOWNLOAD:
        raise SystemExit(f"{url} is larger than {MAX_DOWNLOAD // 2**20} MB.")
    try:
        fmt = (Image.open(io.BytesIO(data)).format or "jpeg").lower()
    except Exception as exc:
        raise SystemExit(f"{url} did not return an image ({exc}).") from exc
    final = folder / (key + {"jpeg": ".jpg"}.get(fmt, "." + fmt))
    part = folder / (key + ".part")
    part.write_bytes(data)
    part.replace(final)
    return final


def load_rgb(path, crop=None, flip=False, maxside=2400, rotate=0):
    im = Image.open(path)
    im.draft("RGB", (maxside, maxside))
    im = ImageOps.exif_transpose(im).convert("RGB")
    if crop:
        w, h = im.size
        im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
    if max(im.size) > maxside:
        im.thumbnail((maxside, maxside), Image.LANCZOS)
    if flip:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if rotate:
        im = im.rotate(rotate, resample=Image.BICUBIC, expand=True, fillcolor=(128, 128, 128))
    return np.asarray(im).astype(np.float32) / 255.0


def source_rgb(cfg):
    path = resolve_src(cfg["src"], cfg.get("photo", 0))
    rgb = load_rgb(path, cfg.get("crop"), cfg.get("flip", False), rotate=cfg.get("rotate", 0))
    st = path.stat()
    key = json.dumps([str(path), st.st_size, st.st_mtime_ns, cfg.get("crop"), cfg.get("flip", False), cfg.get("rotate", 0)])
    return rgb, hashlib.sha1(key.encode()).hexdigest()[:16]


_session = None


def cutout(rgb, key):
    """Subject mask in [0, 1] from rembg (isnet), cached by source and crop."""
    cache = CACHE / "masks" / f"{key}.png"
    if cache.exists():
        m = np.asarray(Image.open(cache).convert("L")).astype(np.float32) / 255.0
        if m.shape == rgb.shape[:2]:
            return m
    global _session
    from rembg import new_session, remove

    if _session is None:
        _session = new_session("isnet-general-use")
    m = remove(Image.fromarray((rgb * 255).astype(np.uint8)), session=_session, only_mask=True, post_process_mask=True)
    cache.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.asarray(m)).save(cache)
    return np.asarray(m).astype(np.float32) / 255.0


def clean_mask(m, cfg, rgb=None):
    """Tidy the cutout: drop excluded polygons, a holding hand, plant blades and
    stray specks, then fill holes."""
    H, W = m.shape
    b = m > 0.5
    for poly in cfg.get("include", []):
        img = Image.new("L", (W, H), 0)
        ImageDraw.Draw(img).polygon([(x * W, y * H) for x, y in poly], fill=255)
        b |= np.asarray(img) > 0
    for poly in cfg.get("exclude", []):
        img = Image.new("L", (W, H), 0)
        ImageDraw.Draw(img).polygon([(x * W, y * H) for x, y in poly], fill=255)
        b &= np.asarray(img) == 0
    if cfg.get("skin_out") and rgb is not None:
        # Skin and a dark watch strap inside the given [x0, y0, x1, y1] box.
        x0, y0, x1, y1 = cfg["skin_out"]
        ycc = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2YCrCb).astype(np.int16)
        hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.int16)
        skin = (ycc[..., 1] > 135) & (ycc[..., 1] < 165) & (ycc[..., 2] > 95) & (ycc[..., 2] < 130) & (hsv[..., 1] < 95)
        strap = (hsv[..., 2] < 70) & (hsv[..., 1] < 90) & (hsv[..., 0] > 95) & (hsv[..., 0] < 130)
        box = np.zeros_like(b)
        box[int(y0 * H) : int(y1 * H), int(x0 * W) : int(x1 * W)] = True
        cut = (skin | strap) & box
        cut = cv2.morphologyEx(cut.astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8)) > 0
        b &= ~cut
    if cfg.get("green_out") and rgb is not None:
        # Grass crossing the animal: cut it out, bridge the gaps, and inpaint
        # the photo underneath so the skin continues.
        hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
        green = (hsv[..., 0] >= 28) & (hsv[..., 0] <= 90) & (hsv[..., 1] >= 55)
        green = cv2.dilate(green.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
        b &= ~green
        k = max(3, int(0.03 * W)) | 1
        b = cv2.morphologyEx(b.astype(np.uint8), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0
        b = cv2.morphologyEx(b.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) > 0
        holes = (green & b).astype(np.uint8) * 255
        fixed = cv2.inpaint((rgb * 255).astype(np.uint8), holes, max(5, int(0.01 * W)), cv2.INPAINT_TELEA)
        rgb[...] = fixed.astype(np.float32) / 255.0
    lab, n = ndimage.label(b)
    if n > 1:
        sizes = ndimage.sum(b, lab, range(1, n + 1))
        b = np.isin(lab, 1 + np.where(sizes >= 0.15 * sizes.max())[0])
    b = ndimage.binary_fill_holes(b)
    return cv2.GaussianBlur(b.astype(np.float32), (0, 0), 1.0)


def sky_mask(rgb, fade=0.35, seed=4, clouds=False, base=None):
    """Mountains: land below a smoothed ridge line. Sky is the blue (optionally
    cloud) region touching the top edge; the bottom dissolves raggedly, either
    `fade` below the ridge (follows its shape) or at a level `base` (0-1 of the
    image height) so the foot of a tall peak isn't scooped out."""
    hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV)
    h, s, v = hsv[..., 0].astype(np.int16), hsv[..., 1].astype(np.int16), hsv[..., 2].astype(np.int16)
    sky = (h > 88) & (h < 135) & (s > 45) & (v > 70)
    if clouds:
        sky |= (s < 40) & (v > 190)
    lab, _ = ndimage.label(sky)
    top = np.unique(lab[0][lab[0] > 0])
    sky = np.isin(lab, top)
    H, W = sky.shape
    land0 = ~sky
    ridge = np.where(land0.any(axis=0), np.argmax(land0, axis=0), H - 1).astype(np.float32)
    ridge = ndimage.median_filter(ridge, size=max(3, int(0.012 * W)) | 1, mode="nearest")
    ridge = ndimage.uniform_filter1d(ridge, size=3, mode="nearest")
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    land = np.clip(yy - ridge[None, :] + 0.5, 0, 1)
    depth = (yy - ridge[None, :]) / H
    rng = np.random.default_rng(seed)
    n = cv2.GaussianBlur(rng.random((H, W)).astype(np.float32), (0, 0), 0.03 * W)
    n = (n - n.min()) / (n.max() - n.min() + 1e-6)
    if base is not None:
        keep = np.clip((base - yy / H + 0.2 * (n - 0.5)) / 0.07, 0, 1)
    else:
        keep = np.clip((fade - depth + 0.2 * (n - 0.5)) / 0.07, 0, 1)
    edge = np.clip(np.minimum(xx, W - 1 - xx) / (0.06 * W) + 0.5 * (n - 0.5), 0, 1)
    return land * keep * edge, land


def poly_mask(shape, polys):
    """Hand-drawn fallback when the cutout fails: polygons in 0-1 coords."""
    H, W = shape
    img = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(img)
    for poly in polys:
        d.polygon([(x * W, y * H) for x, y in poly], fill=255)
    return np.asarray(img).astype(np.float32) / 255.0


def subject_mask(cfg, rgb, key):
    """Returns (mask, land): land is set for mountains (sky mask, or a traced
    `skyline`), so the ridge gets a crisp outline while the base dissolves."""
    if cfg.get("mask") == "sky":
        return sky_mask(rgb, cfg.get("fade", 0.35), clouds=cfg.get("clouds", False), base=cfg.get("base"))
    if "skyline" in cfg:
        m, land = skyline_mask(
            rgb.shape[:2], cfg["skyline"], cfg.get("base", 0.85), curve=cfg.get("curve", 0.0), sides=cfg.get("sides", 0.06)
        )
        if cfg.get("ground_out"):
            m = m * (1 - ground_out_mask(rgb, cfg["ground_out"]))
        return m, land
    raw = poly_mask(rgb.shape[:2], cfg["polygon"]) if "polygon" in cfg else cutout(rgb, key)
    return clean_mask(raw, cfg, rgb), None


def ground_out_mask(rgb, opts):
    """Open ground in front of a mountain (a bright green meadow) to leave out,
    so the plate is the peak and its forest with the treeline as a toothed
    lower edge. opts: {"below": y0, "hue": [h0, h1], "s_min": s, "v_min": v}
    in OpenCV HSV, with y0 as a 0-1 fraction of the image height."""
    H, W = rgb.shape[:2]
    hsv = cv2.cvtColor((np.clip(rgb, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    h, s, v = (cv2.GaussianBlur(hsv[..., i], (0, 0), 3) for i in range(3))
    h0, h1 = opts.get("hue", [22, 45])
    g = (h >= h0) & (h <= h1) & (s >= opts.get("s_min", 60)) & (v >= opts.get("v_min", 70))
    g &= (np.arange(H)[:, None] > opts.get("below", 0.6) * H)
    lab, n = ndimage.label(g)
    if n:
        sizes = ndimage.sum(g, lab, range(1, n + 1))
        g = np.isin(lab, 1 + np.where(sizes >= 0.01 * H * W)[0])
    g = cv2.morphologyEx(g.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8)) > 0
    # Everything below the meadow's top edge goes, including small trees
    # standing in it, so the lower edge is the forest's own treeline.
    top = np.where(g.any(axis=0), np.argmax(g, axis=0), H).astype(np.float32)
    top = ndimage.minimum_filter1d(top, size=max(3, int(0.004 * W)) | 1, mode="nearest")
    if "teeth" in opts:
        # A lone tree out in the meadow hangs below the forest like a drip:
        # nothing may reach more than `teeth` (0-1 of the height) below the
        # treeline across a `bridge`-wide stretch (0-1 of the width).
        k = max(3, int(opts.get("bridge", 0.1) * W)) | 1
        top = np.minimum(top, ndimage.grey_opening(top, size=k, mode="nearest") + opts["teeth"] * H)
    # Tree bases are soft, not a ruled line: dissolve the forest's foot over a
    # short band with the same ragged noise as the other plate edges.
    rng = np.random.default_rng(opts.get("seed", 6))
    n = cv2.GaussianBlur(rng.random((H, W)).astype(np.float32), (0, 0), 0.01 * W)
    n = (n - n.min()) / (n.max() - n.min() + 1e-6)
    band = opts.get("soft", 0.06) * H
    depth = (np.arange(H)[:, None] - (top[None, :] - band)) / band
    out = np.clip(depth + 0.6 * (n - 0.5), 0, 1)
    return out


def skyline_mask(shape, skyline, base=0.85, seed=4, curve=0.0, sides=0.06):
    """Mountains whose sky can't be told from snow by colour (shaded snow and
    sky share a hue): land below a hand-traced `skyline` ([[x, y], ...] left to
    right), dissolving raggedly at the level `base`, with soft side edges
    `sides` wide (0-1 of the width). `curve` raises the fade line toward the
    sides (a dome centred under the summit), so the lower corners dissolve and
    the shape reads as a peak instead of a block with vertical walls."""
    H, W = shape
    xs = np.array([p[0] for p in skyline]) * (W - 1)
    ys = np.array([p[1] for p in skyline]) * H
    ridge = np.interp(np.arange(W), xs, ys).astype(np.float32)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    land = np.clip(yy - ridge[None, :] + 0.5, 0, 1)
    rng = np.random.default_rng(seed)
    n = cv2.GaussianBlur(rng.random((H, W)).astype(np.float32), (0, 0), 0.03 * W)
    n = (n - n.min()) / (n.max() - n.min() + 1e-6)
    cx = float(np.argmin(ridge)) / (W - 1)
    xn = (xx / (W - 1) - cx) / max(cx, 1 - cx)
    level = base - curve * xn**2
    keep = np.clip((level - yy / H + 0.2 * (n - 0.5)) / 0.07, 0, 1)
    edge = np.clip(np.minimum(xx, W - 1 - xx) / (sides * W) + 0.5 * (n - 0.5), 0, 1)
    return land * keep * edge, land


# ----------------------------------------------------------------- framing
def tilt(arrs, mask, deg, replicate=None):
    """Rotate the cut-out subject to pose it; positive turns it counter-clockwise
    on screen (raises its right side). Runs after masking, so exclude, include
    and inpaint polygons still match the photo."""
    h, w = mask.shape
    M = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
    c, s = abs(M[0, 0]), abs(M[0, 1])
    nw, nh = int(h * s + w * c), int(h * c + w * s)
    M[0, 2] += nw / 2 - w / 2
    M[1, 2] += nh / 2 - h / 2
    out = []
    for i, a in enumerate(arrs):
        rep = replicate[i] if replicate is not None else a.ndim == 3
        border = cv2.BORDER_REPLICATE if rep else cv2.BORDER_CONSTANT
        out.append(cv2.warpAffine(a, M, (nw, nh), flags=cv2.INTER_LINEAR, borderMode=border, borderValue=0))
    return out


def tilt_keep_level(rgb, m, deg, parts):
    """Tilt the subject, but turn the listed `parts` (feet) back to their
    photographed angle so toes stay flat on the ground instead of tipping
    with the body. Each part is {"poly": [...], "pivot": [x, y]} in photo
    coordinates; the pivot (the ankle) stays attached to the tilted leg."""
    h, w = m.shape
    rgb_t, m_t = tilt([rgb, m], m, deg)
    M = cv2.getRotationMatrix2D((w / 2, h / 2), deg, 1.0)
    c, s = abs(M[0, 0]), abs(M[0, 1])
    nw, nh = int(h * s + w * c), int(h * c + w * s)
    M[0, 2] += nw / 2 - w / 2
    M[1, 2] += nh / 2 - h / 2
    for part in parts:
        px, py = part["pivot"][0] * w, part["pivot"][1] * h
        qx, qy = M @ np.array([px, py, 1.0])
        # Translate only: the part keeps its photo orientation, pinned at the
        # pivot's tilted position.
        T = np.float32([[1, 0, qx - px], [0, 1, qy - py]])
        sel = poly_mask((h, w), [part["poly"]]) * (m > 0.5)
        moved = cv2.warpAffine(sel, T, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=0)
        moved_rgb = cv2.warpAffine(rgb, T, (nw, nh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        # Remove the tipped copy of the part (slightly grown, so no faint
        # ghost of it survives at the edges), then lay the level one in.
        tipped = cv2.warpAffine(sel, M, (nw, nh), flags=cv2.INTER_LINEAR, borderValue=0)
        tipped = cv2.dilate((tipped > 0.05).astype(np.uint8), np.ones((7, 7), np.uint8)).astype(np.float32)
        m_t = m_t * (1 - tipped)
        a = cv2.GaussianBlur(moved, (0, 0), 1.0)[..., None]
        rgb_t = rgb_t * (1 - a) + moved_rgb * a
        m_t = np.maximum(m_t, cv2.GaussianBlur((moved > 0.5).astype(np.float32), (0, 0), 1.0))
        # Smooth the ankle where the level foot meets the tilted leg: a small
        # closing around the pivot fills the notch between the two.
        r = max(3, int(0.012 * max(w, h)))
        zone = np.zeros((nh, nw), np.float32)
        cv2.circle(zone, (int(qx), int(qy)), 2 * r, 1.0, -1)
        closed = cv2.morphologyEx((m_t > 0.5).astype(np.uint8), cv2.MORPH_CLOSE,
                                  cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (r, r))).astype(np.float32)
        m_t = np.maximum(m_t, closed * zone)
    return rgb_t, m_t


def place(arrs, mask, W, H, fill=(0.8, 0.7), cy=0.45, replicate=None, fit=0.5):
    """Scale the subject's bounding box to the same share of every plate. The
    box is where `mask` > `fit`; lower it for wide dissolving edges, so the
    fade fits on the plate instead of being cut off by it."""
    ys, xs = np.where(mask > fit)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    k = min(fill[0] * W / (x1 - x0 + 1), fill[1] * H / (y1 - y0 + 1))
    out = []
    for i, a in enumerate(arrs):
        h, w = a.shape[:2]
        interp = cv2.INTER_AREA if k < 1 else cv2.INTER_CUBIC
        r = cv2.resize(a, (max(1, round(w * k)), max(1, round(h * k))), interpolation=interp)
        dx = round(W / 2 - k * (x0 + x1) / 2)
        dy = round(cy * H - k * (y0 + y1) / 2)
        M = np.float32([[1, 0, dx], [0, 1, dy]])
        rep = replicate[i] if replicate is not None else a.ndim == 3
        border = cv2.BORDER_REPLICATE if rep else cv2.BORDER_CONSTANT
        out.append(cv2.warpAffine(r, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=border, borderValue=0))
    return out


# ----------------------------------------------------------------- tone
def luminance(rgb):
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def lightness(rgb, overrides=None, mode="luma"):
    """Luminance, with hue windows pulled to a set tone. Bright colours (an
    orange bill, a green frog) otherwise turn into the wrong grey."""
    # "value" (brightest channel) reads blue-shadowed snow as snow, where
    # luminance would print it as dark as rock.
    L = rgb.max(axis=-1) if mode == "value" else luminance(rgb)
    if overrides:
        hsv = cv2.cvtColor((np.clip(rgb, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
        for h0, h1, smin, vmin, value in overrides:
            hard = (hsv[..., 0] >= h0) & (hsv[..., 0] <= h1) & (hsv[..., 1] >= smin) & (hsv[..., 2] >= vmin)
            if not hard.any():
                continue
            med = float(np.median(L[hard]))
            sel = cv2.GaussianBlur(hard.astype(np.float32), (0, 0), 1.0)
            L = L * (1 - sel) + np.clip(value + 1.1 * (L - med), 0, 1) * sel
    return L


def smooth(L, passes=3, d=9, sc=0.1, ss=4.0):
    """Edge-preserving flattening: photographic noise becomes drawable tone."""
    out = L.astype(np.float32)
    for _ in range(passes):
        out = cv2.bilateralFilter(out, d, sc, ss)
    return out


def darkness(L, region, invert, p=(2, 98), t0=0.12, t1=0.92, gamma=1.0, detail=0.18, edge=0.4, clahe=2.0, cap=0.8, lohi=None, passes=3):
    """Darkness -> dot density. Percentile normalisation inside the subject
    gives every plate the same full tonal range; a CLAHE mix brings out form
    inside very dark or very light animals; a DoG term firms up contours."""
    vals = L[region]
    if lohi is not None:
        lo, hi = lohi
    else:
        lo, hi = np.percentile(vals, p) if vals.size else (0.0, 1.0)
    Ln = np.clip((L - lo) / max(hi - lo, 1e-3), 0, 1)
    if invert:
        Ln = 1 - Ln
    base = smooth(Ln, passes=passes)
    if clahe:
        H, W = L.shape
        tiles = (max(2, W // 140), max(2, H // 140))
        base = cv2.createCLAHE(clipLimit=clahe, tileGridSize=tiles).apply((base * 255).astype(np.uint8)).astype(np.float32) / 255.0
        base = 0.55 * base + 0.45 * smooth(Ln, passes=passes)
    fine = Ln - cv2.GaussianBlur(Ln, (0, 0), 1.6)
    mix = np.clip(base + detail * fine, 0, 1)
    d = 1 - mix
    rho = np.clip((d - t0) / (t1 - t0), 0, 1) ** gamma
    dog = cv2.GaussianBlur(base, (0, 0), 2.4) - cv2.GaussianBlur(base, (0, 0), 0.9)
    rho = rho + edge * np.clip(dog * 5.0, 0, 1)
    return np.clip(rho, 0, cap)


def rim(mask, width=1.4):
    m = (mask > 0.5).astype(np.uint8)
    dist = cv2.distanceTransform(m, cv2.DIST_L2, 3)
    return np.exp(-dist / width) * m


# ----------------------------------------------------------------- liberties
def stones(mask, dark, seed=7, spread=1.25, count=11, ground_at=None, halo=False, ground=1.0):
    """Specimen-plate ground: a loose bed of stones with dotted outlines, lit
    from the upper left, gravel between them, and the animal's cast shadow.
    The bed fades out irregularly, like the edge of a pen drawing."""
    H, W = mask.shape
    rng = np.random.default_rng(seed)
    ys, xs = np.where(mask > 0.5)
    x0, x1 = xs.min(), xs.max()
    y1 = np.percentile(ys, 99.6)
    if ground_at:
        y1 = ys.min() + ground_at * (y1 - ys.min())
    cx, bw = (x0 + x1) / 2, x1 - x0
    rx, ry = 0.5 * spread * bw, 0.085 * H
    by = y1 + 0.012 * H
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)

    centers = []
    tries = 0
    while len(centers) < count and tries < 4000:
        tries += 1
        u, v = rng.uniform(-1, 1), rng.uniform(-1, 1)
        if u * u + v * v > 1:
            continue
        x, y = cx + u * rx, by + v * ry
        r = rng.uniform(0.018, 0.042) * W * (1 - 0.45 * abs(u))
        if all(np.hypot(x - a, (y - b) * 1.7) > 0.92 * (r + rr) for a, b, rr in centers):
            centers.append((x, y, r))

    rho = np.zeros((H, W), np.float32)
    stone_any = np.zeros((H, W), bool)
    lx, ly, lz = -0.55, -0.6, 0.58
    for x, y, r in sorted(centers, key=lambda c: c[1]):
        asp = rng.uniform(1.4, 2.0)
        ph = rng.uniform(0, 2 * np.pi, 3)
        dx, dy = xx - x, (yy - y) * asp
        th = np.arctan2(dy, dx)
        rr = np.hypot(dx, dy)
        edge_r = r * (1 + 0.1 * np.cos(th + ph[0]) + 0.07 * np.cos(2 * th + ph[1]) + 0.05 * np.cos(3 * th + ph[2]))
        q = rr / edge_r
        inside = q < 1
        nz = np.sqrt(np.clip(1 - q**2, 0, 1))
        nx, ny = dx / np.maximum(edge_r, 1e-3), dy / np.maximum(edge_r, 1e-3)
        lam = np.clip(nx * lx + ny * ly + nz * lz, 0, 1)
        tone = (0.05 + 0.32 * lam**1.2) if dark else (0.06 + 0.42 * (1 - lam) ** 1.4)
        speck = rng.random((H, W)) < 0.012
        tone = tone + 0.25 * speck
        outline = np.exp(-np.clip((1 - q) * edge_r, 0, None) / 1.3) * inside
        st = np.maximum(tone, 0.62 * outline)
        rho = np.where(inside, st, rho)
        stone_any |= inside

    env = 1 - (((xx - cx) / (rx * 1.15)) ** 2 + ((yy - by) / (ry * 1.5)) ** 2)
    big = cv2.GaussianBlur(rng.random((H, W)).astype(np.float32), (0, 0), 0.03 * W)
    big = (big - big.min()) / (big.max() - big.min() + 1e-6)
    env = np.clip((env + 0.55 * (big - 0.5)) * 2.2, 0, 1)

    fine = cv2.GaussianBlur(rng.random((H, W)).astype(np.float32), (0, 0), 1.5)
    fine = (fine - fine.min()) / (fine.max() - fine.min() + 1e-6)
    rho = rho + (0.05 + 0.13 * fine) * (~stone_any)

    sil = (mask > 0.5).astype(np.float32)
    shadow = cv2.GaussianBlur(sil, (0, 0), 0.012 * W)
    shadow = np.roll(np.roll(shadow, int(0.022 * H), axis=0), int(0.02 * W), axis=1)
    sh = np.clip(1 - (((xx - cx - 0.03 * W) / (0.42 * bw)) ** 2 + ((yy - by) / (0.035 * H)) ** 2), 0, 1) ** 0.8
    shadow = np.clip(np.maximum(shadow * (yy > y1 - 0.06 * H), sh), 0, 1)
    if dark:
        rho = rho * (1 - 0.9 * shadow)
    else:
        rho = rho + 0.45 * ground * shadow
    out = np.clip(rho * env * ground, 0, 0.82) * (1 - np.clip(mask * 1.6, 0, 1))
    if halo:
        # A clear gap of paper around the subject, so toes stay readable
        # against the gravel instead of merging into it.
        ring = cv2.dilate((mask > 0.5).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))).astype(np.float32)
        out = out * (1 - 0.85 * cv2.GaussianBlur(ring, (0, 0), 2.0))
    return out


def bubbles(mask, dark, seed=9):
    """A rising column of dotted bubbles in front of a fish's mouth."""
    H, W = mask.shape
    ys, xs = np.where(mask > 0.5)
    x1 = xs.max()
    head = xs > x1 - 0.12 * (xs.max() - xs.min())
    my = ys[head].mean()
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    rng = np.random.default_rng(seed)
    out = np.zeros((H, W), np.float32)
    x, y = x1 + 0.03 * W, my - 0.06 * H
    r = 0.022 * W
    for _ in range(6):
        d = np.hypot(xx - x, yy - y)
        ring = np.exp(-np.abs(d - r) / 1.1)
        glint = np.exp(-np.hypot(xx - (x - 0.35 * r), yy - (y - 0.35 * r)) / (0.18 * r))
        body = 0.07 * (d < r)
        b = np.maximum(ring * 0.75, body)
        b = b * (1 - np.clip(glint * 1.4, 0, 1)) if not dark else np.maximum(b, 0.6 * glint)
        out = np.maximum(out, b * (d < r + 3))
        y -= r * rng.uniform(2.3, 2.9)
        x += rng.uniform(-0.6, 0.9) * r
        r *= rng.uniform(0.72, 0.86)
        if y < 0.06 * H:
            break
    return out


# ----------------------------------------------------------------- fields
def similarity_from_pairs(src, dst):
    """2x3 similarity transform (rotate, scale, move) that maps two source
    points exactly onto two target points."""
    (x1, y1), (x2, y2) = src
    (u1, v1), (u2, v2) = dst
    z = complex(u2 - u1, v2 - v1) / complex(x2 - x1, y2 - y1)
    t = complex(u1, v1) - z * complex(x1, y1)
    return np.float32([[z.real, -z.imag, t.real], [z.imag, z.real, t.imag]])


def graft(rgb, m, cfg, src_mask=None):
    """Copy a clear part of the animal onto a spot the photo didn't show well,
    e.g. the sharp front leg onto the hip as the blurred hind leg. Each graft
    gives a `from` polygon and two point pairs (`src` -> `dst`, e.g. shoulder
    and toes -> hip and hind foot) that set the move, turn and scale. Parts
    are cut from `src_mask` (the raw cutout), so a limb can be excluded from
    its old place and still be grafted somewhere else."""
    H, W = m.shape
    base = m if src_mask is None else src_mask
    src_rgb = rgb.copy()
    for g in cfg.get("graft", []):
        part = poly_mask((H, W), [g["from"]]) * (base > 0.5)
        M = similarity_from_pairs([(x * W, y * H) for x, y in g["src"]], [(x * W, y * H) for x, y in g["dst"]])
        moved = cv2.warpAffine(part, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
        moved_rgb = cv2.warpAffine(src_rgb, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        alpha = cv2.GaussianBlur(moved, (0, 0), g.get("feather", 0.004) * W)[..., None]
        rgb = rgb * (1 - alpha) + moved_rgb * alpha
        m = np.maximum(m, cv2.GaussianBlur((moved > 0.5).astype(np.float32), (0, 0), 1.0))
    return rgb, m


def retouch(rgb, m, cfg, key=None):
    """Photo fixes after the cutout, in polygon (photo) coordinates: paint out
    clutter, graft parts, lift shadows."""
    src_mask = None
    if cfg.get("graft") and key and "polygon" not in cfg and "skyline" not in cfg and cfg.get("mask") != "sky":
        src_mask = cutout(rgb, key)  # cached; must see the photo before inpaint
    rgb = inpaint_regions(rgb, cfg)
    if cfg.get("graft"):
        rgb, m = graft(rgb, m, cfg, src_mask)
    if cfg.get("lift"):
        # Brighten shadowed areas (a face turned from the light) that would
        # otherwise print as a dark patch: [[polygon, amount], ...].
        hh, ww = rgb.shape[:2]
        for poly, amount in cfg["lift"]:
            w8 = cv2.GaussianBlur(poly_mask((hh, ww), [poly]), (0, 0), 0.03 * ww)[..., None]
            rgb = np.clip(rgb + amount * w8 * (1 - rgb), 0, 1)
    return rgb, m


def stretch(arrs, k):
    """Vertical exaggeration (k > 1 makes it taller), the illustrator's trick
    for making a broad peak read as a peak."""
    h, w = arrs[0].shape[:2]
    nh = max(1, int(round(h * k)))
    return [cv2.resize(a, (w, nh), interpolation=cv2.INTER_CUBIC if a.ndim == 3 else cv2.INTER_LINEAR) for a in arrs]


def inpaint_regions(rgb, cfg):
    """Paint out small things lying across the animal (a pine needle, a leaf)
    so its skin continues underneath. Runs after the cutout, on the photo."""
    if not cfg.get("inpaint"):
        return rgb
    hh, ww = rgb.shape[:2]
    holes = (poly_mask((hh, ww), cfg["inpaint"]) > 0.5).astype(np.uint8) * 255
    fixed = cv2.inpaint((rgb * 255).astype(np.uint8), holes, max(5, int(0.01 * ww)), cv2.INPAINT_TELEA)
    return fixed.astype(np.float32) / 255.0


def subject_field(cfg, W, H, dark):
    rgb, key = source_rgb(cfg)
    m, land = subject_mask(cfg, rgb, key)
    rgb, m = retouch(rgb, m, cfg, key)
    if cfg.get("stretch"):
        if land is not None:
            rgb, m, land = stretch([rgb, m, land], cfg["stretch"])
        else:
            rgb, m = stretch([rgb, m], cfg["stretch"])
    if cfg.get("tilt") and land is None:
        if cfg.get("keep_level"):
            rgb, m = tilt_keep_level(rgb, m, cfg["tilt"], cfg["keep_level"])
        else:
            rgb, m = tilt([rgb, m], m, cfg["tilt"])
    fit = cfg.get("fit", 0.5)
    if land is not None:
        rgb_p, m_p, land_p = place(
            [rgb, m, land], m, W, H, cfg.get("fill", (0.8, 0.7)), cfg.get("cy", 0.45), replicate=[True, False, True], fit=fit
        )
        outline_src = land_p
    else:
        rgb_p, m_p = place([rgb, m], m, W, H, cfg.get("fill", (0.8, 0.7)), cfg.get("cy", 0.45), fit=fit)
        outline_src = m_p
    m_p = np.clip(m_p, 0, 1)
    L = lightness(rgb_p, cfg.get("tone"), cfg.get("lum", "luma"))
    if cfg.get("simplify"):
        # Median filter at plate scale: merges small specks (rock outcrops in
        # snow) into larger masses so texture doesn't read as gravel.
        k = int(cfg["simplify"]) | 1
        L = cv2.medianBlur((np.clip(L, 0, 1) * 255).astype(np.uint8), k).astype(np.float32) / 255.0
    mountain = cfg.get("mask") == "sky" or "skyline" in cfg
    inside = m_p > (0.15 if mountain else 0.5)
    lohi = None
    if cfg.get("despecular"):
        # Flash glare on wet skin: low-saturation highlights pulled toward the
        # median skin tone, keeping a hint of sheen. Normalise against the
        # original range, or the fix gets stretched straight back to white.
        lohi = tuple(np.percentile(L[inside], (2, 98)))
        hsv = cv2.cvtColor((np.clip(rgb_p, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
        cap_v = np.percentile(L[inside], cfg["despecular"])
        med = float(np.median(L[inside]))
        glare = ((L > cap_v) | ((hsv[..., 1] < 70) & (L > med))) & inside
        glare = cv2.dilate(glare.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(np.float32)
        hot = cv2.GaussianBlur(glare, (0, 0), 2.0)
        L = L * (1 - hot) + (med + 0.35 * (np.minimum(L, cap_v) - med)) * hot
    rho = darkness(L, inside, dark, lohi=lohi, passes=cfg.get("passes", 3), detail=cfg.get("detail", 0.18),
                   clahe=cfg.get("clahe", 2.0), cap=cfg.get("cap", 0.8), edge=cfg.get("edge", 0.4))
    thin = None
    if cfg.get("trees") and not dark:
        # A dark forest prints as one solid mass on paper. Open light gaps
        # between the spruce crowns: a horizontal top-hat on the inverted
        # image finds narrow dark verticals (trunks and crowns), and ink is
        # kept there and thinned between them. Only below `trees["below"]`
        # (0-1 of the plate height).
        t = cfg["trees"]
        inv = (np.clip(1 - cv2.GaussianBlur(L, (0, 0), 0.8), 0, 1) * 255).astype(np.uint8)
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (max(5, int(t.get("width", 0.012) * W)) | 1, 1))
        crowns = cv2.morphologyEx(inv, cv2.MORPH_TOPHAT, k).astype(np.float32) / 255.0
        crowns = np.clip(crowns / max(float(np.percentile(crowns[inside], 97)), 1e-3), 0, 1)
        zone = (np.arange(H)[:, None] >= t.get("below", 0.0) * H).astype(np.float32)
        zone = cv2.GaussianBlur(zone * (rho > 0.25), (0, 0), 3.0)
        keep = t.get("gap", 0.35) + (1 - t.get("gap", 0.35)) * crowns
        rho = rho * (1 - zone) + rho * keep * zone
        if t.get("fade"):
            # The forest thins downhill, so the peak stays the darkest mass
            # and the foot dissolves like the stone beds under the animals.
            # Applied after the weight solve, which would darken the peak.
            y0, y1 = t.get("below", 0.0) * H, float(np.where(inside)[0].max())
            thin = 1 - t["fade"] * np.clip((np.arange(H)[:, None] - y0) / max(y1 - y0, 1.0), 0, 1)
    if cfg.get("levels"):
        # Flatten tone into a few broad bands, the way an illustrator stipples
        # planes (lit face, shaded face, rock) instead of every photo detail.
        n_lv = int(cfg["levels"])
        top = float(rho.max()) or 1.0
        q = np.round(rho / top * (n_lv - 1)) / (n_lv - 1) * top
        rho = cv2.GaussianBlur(q.astype(np.float32), (0, 0), cfg.get("level_soft", 1.5))
    # Same visual weight for every plate: solve a gamma so the mean density
    # inside the subject hits the target.
    target = cfg.get("weight", 0.46 if not dark else 0.34)
    vals = rho[inside]
    lo_g, hi_g = 0.25, 4.0
    for _ in range(30):
        g = (lo_g * hi_g) ** 0.5
        if np.mean(vals**g) > target:
            lo_g = g
        else:
            hi_g = g
    rho = (rho**g) * m_p
    if thin is not None:
        rho = rho * thin
    if cfg.get("features"):
        # Very dark, small features (eyes, nostrils, mouth line) stay solid.
        thr = np.percentile(L[inside], cfg["features"])
        feat = (L < thr) & inside
        feat = cv2.morphologyEx(feat.astype(np.uint8), cv2.MORPH_OPEN, np.ones((2, 2), np.uint8)).astype(np.float32)
        soft = cv2.GaussianBlur(feat, (0, 0), 0.8)
        rho = np.maximum(rho, 0.86 * soft) if not dark else rho * (1 - 0.9 * soft)
    if cfg.get("floor"):
        rho = np.maximum(rho, cfg["floor"] * m_p)
    if cfg.get("floor_light") and not dark:
        # Pale animals need more ink in light mode than in dark mode, where
        # the same pale skin already prints as dense light dots.
        rho = np.maximum(rho, cfg["floor_light"] * m_p)
    rim_k = cfg.get("rim", 0.58) * (0.83 if dark else 1.0)
    rho = np.maximum(rho, rim_k * rim(outline_src, cfg.get("rim_width", 1.2)) * np.clip(m_p * 1.5, 0, 1))
    if cfg.get("stones"):
        rho = rho + stones(m_p, dark, ground_at=cfg.get("ground_at"), halo=cfg.get("clear_feet", False),
                           ground=cfg.get("ground_light", 1.0) if not dark else 1.0)
    if cfg.get("bubbles"):
        rho = np.maximum(rho, bubbles(m_p, dark))
    return np.clip(rho, 0, 0.9).astype(np.float32)


def globe_field(cfg, W, H, dark):
    """A lit globe from the site's own coastline data (src/lib/geo-land.json)."""
    polys = json.loads((REPO / "src" / "lib" / "geo-land.json").read_text())
    RW, RH = 2880, 1440
    raster = Image.new("L", (RW, RH), 0)
    d = ImageDraw.Draw(raster)
    for poly in polys:
        pts = [((lon + 180) / 360 * RW, (90 - lat) / 180 * RH) for lon, lat in poly]
        if len(pts) > 2:
            d.polygon(pts, fill=255)
    land = cv2.GaussianBlur(np.asarray(raster).astype(np.float32) / 255.0, (0, 0), 1.0)
    R = 0.4 * H
    cx, cy = W / 2, 0.47 * H
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    x, y = (xx - cx) / R, -(yy - cy) / R
    r2 = x**2 + y**2
    inside = r2 <= 1
    z = np.sqrt(np.clip(1 - r2, 0, 1))
    lat0, lon0 = np.radians(cfg.get("lat0", 22.0)), np.radians(cfg.get("lon0", -100.0))
    lat = np.arcsin(np.clip(z * np.sin(lat0) + y * np.cos(lat0), -1, 1))
    lon = lon0 + np.arctan2(x, z * np.cos(lat0) - y * np.sin(lat0))
    u = ((np.degrees(lon) + 180) % 360) / 360 * (RW - 1)
    v = (90 - np.degrees(lat)) / 180 * (RH - 1)
    Lm = cv2.remap(land, u.astype(np.float32), v.astype(np.float32), cv2.INTER_LINEAR)
    lv = np.array([-0.5, 0.55, 0.67])
    lv /= np.linalg.norm(lv)
    shade = np.clip(x * lv[0] + y * lv[1] + z * lv[2], 0, 1)
    if dark:
        rho = (0.04 + 0.16 * shade**1.4) * (1 - Lm) + (0.25 + 0.6 * shade**0.9) * Lm
    else:
        rho = (0.05 + 0.4 * (1 - shade) ** 1.7) * (1 - Lm) + (0.5 + 0.42 * (1 - shade) ** 1.1) * Lm
    coast = np.clip(cv2.GaussianBlur(Lm, (0, 0), 0.8) - cv2.GaussianBlur(Lm, (0, 0), 2.5), 0, 1)
    rho = rho + 0.8 * coast
    rho = np.maximum(rho * inside, 0.85 * rim(inside.astype(np.float32), 1.6))
    if not dark:
        # Cast shadow on paper; none on scratchboard.
        sh = np.clip(1 - (((xx - cx) / (0.8 * R)) ** 2 + ((yy - (cy + 1.08 * R)) / (0.09 * R)) ** 2), 0, 1) ** 1.5
        rho = rho + 0.35 * sh * ~inside
    return np.clip(rho, 0, 0.96).astype(np.float32)


def field(cfg, W, H, dark):
    # Per-theme overrides: {"light": {...}} or {"dark": {...}} replace keys for
    # that theme only (e.g. a lower density cap for a dark forest on paper).
    theme = cfg.get("dark" if dark else "light")
    if isinstance(theme, dict):
        cfg = {**cfg, **theme}
    if cfg.get("kind") == "globe":
        return globe_field(cfg, W, H, dark)
    return subject_field(cfg, W, H, dark)


# ----------------------------------------------------------------- stippling
def lloyd(rho, n, iters, rng, init=None):
    """Weighted Lloyd relaxation with weights rho**2, so dot density follows rho
    (centroidal Voronoi point density goes as weight**0.5)."""
    H, W = rho.shape
    wf = rho.astype(np.float64) ** 2
    ys, xs = np.nonzero(wf > 1e-4)
    w = wf[ys, xs]
    P = np.column_stack([xs, ys]).astype(np.float64) + 0.5
    if init is None:
        p = rho.ravel().astype(np.float64)
        p /= p.sum()
        idx = rng.choice(p.size, size=n, replace=True, p=p)
        pts = np.column_stack([idx % W, idx // W]).astype(np.float64) + rng.random((n, 2))
    else:
        pts = init.copy()
    for _ in range(iters):
        _, near = cKDTree(pts).query(P, workers=-1)
        sw = np.bincount(near, weights=w, minlength=len(pts))
        sx = np.bincount(near, weights=w * P[:, 0], minlength=len(pts))
        sy = np.bincount(near, weights=w * P[:, 1], minlength=len(pts))
        ok = sw > 0
        pts[ok, 0] = sx[ok] / sw[ok]
        pts[ok, 1] = sy[ok] / sw[ok]
    return pts[sw > 0] if init is None else pts


def render(pts, rho, r0, rng, ss=4):
    """Draw at ss x and downsample for round, anti-aliased dots (1-2 px circles
    drawn directly come out as crosses). Each radius follows the local spacing
    (median distance to six neighbours) so dark areas tile instead of fusing."""
    H, W = rho.shape
    big = np.zeros((H * ss, W * ss), np.uint8)
    if len(pts) > 7:
        dist, _ = cKDTree(pts).query(pts, k=7, workers=-1)
        spacing = np.median(dist[:, 1:], axis=1)
    else:
        spacing = np.full(len(pts), 4 * r0)
    radii = np.clip(0.36 * spacing, 0.7 * r0, 1.15 * r0) * (1 + 0.05 * rng.standard_normal(len(pts)))
    for (x, y), r in zip(pts, radii):
        cv2.circle(big, (int(x * ss * 16), int(y * ss * 16)), max(int(r * ss * 16), 16), 255, -1, cv2.LINE_8, shift=4)
    return cv2.resize(big, (W, H), interpolation=cv2.INTER_AREA)


def dot_count(rho, r0):
    spacing = 2.15 * r0
    return int(rho.sum() / (0.866 * spacing * spacing))


def save(alpha, path, theme):
    """Ink colour baked in, transparent paper, lossless WebP."""
    rgba = np.zeros(alpha.shape + (4,), np.uint8)
    rgba[..., :3] = INK[theme]
    rgba[..., 3] = alpha
    Image.fromarray(rgba).save(path, "WEBP", lossless=True, quality=100, method=6)


def build(name, cfg, out, sizes=("card",), themes=("light", "dark"), frames=3):
    out.mkdir(parents=True, exist_ok=True)
    for theme in themes:
        dark = theme == "dark"
        suffix = "-dark" if dark else ""
        for size in sizes:
            W, H, r0 = SIZES[size]
            c = cfg
            if size == "icon":
                c = dict(cfg, **ICON_OVERRIDES, weight=cfg.get("weight", 0.46) + 0.14)
            rho = field(c, W, H, dark)
            rng = np.random.default_rng(11)
            pts = lloyd(rho, dot_count(rho, r0), 60, rng)
            save(render(pts, rho, r0, rng), out / f"{name}-{size}{suffix}.webp", theme)
            # The same drawing re-inked, for a hand-drawn "boil" on hover.
            for f in range(1, frames if size != "icon" else 1):
                r2 = np.random.default_rng(100 + f)
                p2 = lloyd(rho, len(pts), 4, r2, init=pts + r2.normal(0, 1.1 * r0, pts.shape))
                save(render(p2, rho, r0, r2), out / f"{name}-{size}-b{f}{suffix}.webp", theme)
            print(f"{name:18s} {theme:5s} {size:4s} {len(pts):6d} dots", flush=True)


def load_subjects(path):
    data = json.loads(Path(path).read_text())
    return {k: v for k, v in data.items() if not k.startswith("$")}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Render stipple plates from photographs.")
    ap.add_argument("names", nargs="*", help="subjects to render (default: all)")
    ap.add_argument("--subjects", default=str(SKILL / "subjects.json"))
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--sizes", default="card", help="comma list of: " + ", ".join(SIZES))
    ap.add_argument("--themes", default="light,dark")
    ap.add_argument("--frames", type=int, default=3, help="drawings per plate, for the hover boil")
    ap.add_argument("--list", action="store_true", help="list subjects and exit")
    a = ap.parse_intermixed_args(argv)
    subjects = load_subjects(a.subjects)
    if a.list:
        for k, v in subjects.items():
            print(f"{k:18s} {v.get('note', '')}")
        return
    names = a.names or list(subjects)
    unknown = [n for n in names if n not in subjects]
    if unknown:
        raise SystemExit(f"Unknown subject(s): {', '.join(unknown)}. Add them to {a.subjects}.")
    out = Path(a.out)
    if not out.is_absolute():
        out = REPO / out
    for n in names:
        build(n, subjects[n], out, tuple(a.sizes.split(",")), tuple(a.themes.split(",")), a.frames)
    print(f"wrote {out}", file=sys.stderr)


if __name__ == "__main__":
    main()
