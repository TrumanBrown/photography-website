#!/usr/bin/env python3
"""Build the six beaches of the tide pooling toy (src/lib/hobbies/tidepool.ts).

Each beach is a patch of shore seen straight down, about a metre and a half
across, made from CC0 scans of rock, gravel and sand from Poly Haven, lit from
the upper left with cast shadows and wet highlights. Nothing alive is in it
unless this script put it there on purpose and wrote it into the label map
(barnacles, mussels, crusts, washed-up kelp), so whatever a tap lands on is
named right. The animals themselves are drawn by the toy, at the spots listed
here (`slots`), and the loose rocks are separate sprites the toy turns over.

    PY=~/.cache/stipple-plates/venv/bin/python   # numpy, opencv, pillow
    $PY scripts/tidepool/build-beaches.py [beach ...]

Beaches: channel, potholes, boulder, cobble, sand, bench (all by default).
Textures download once from Poly Haven into ~/.cache/tidepool/tex (or
$TIDEPOOL_TEX). Colonies stamped from animal cutouts (mussels, goosenecks,
aggregating anemones) use public/tidepool/<v>/animals/ when it exists.

Output: public/tidepool/<v>/<beach>/ with base.webp (the lit ground), water.png
(water depth at half size, 0 where dry), labels.png (what's where, at half size,
indices into `labels` in beach.json), one top and one underside sprite per
loose rock, and beach.json. Bump VERSION when the art changes, since the files
are served with a one-year cache (staticwebapp.config.json).
"""
from __future__ import annotations

import json
import math
import os
import sys
import urllib.request
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

VERSION = "v1"
REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "public" / "tidepool" / VERSION
TEX = Path(os.environ.get("TIDEPOOL_TEX", Path.home() / ".cache" / "tidepool" / "tex"))
W, H = 2400, 1500

# Light from the upper left, about 35 degrees up: shadows fall down and right.
LIGHT = np.array([-0.5, -0.6, 0.55], np.float32)
LIGHT /= np.linalg.norm(LIGHT)
SUN = np.array([1.0, 0.96, 0.9], np.float32)
SKY = np.array([0.6, 0.68, 0.78], np.float32)

# What a tap can land on, besides animals the toy draws. The toy maps each to
# a line or an Other life card (tidepool-beaches.ts).
LABELS = [
    "rock", "gravel", "sand", "water", "coralline", "sponge", "film",
    "acorn-barnacle", "california-mussel", "gooseneck-barnacle", "aggregating-anemone",
    "bull-kelp", "eelgrass", "shells", "tracks", "sandstone", "cobble", "tube-worms",
]
LID = {k: i for i, k in enumerate(LABELS)}


# ------------------------------------------------------------------ textures
_TEX: dict = {}


def _download(name: str, kind: str, path: Path) -> None:
    url = f"https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/{name}/{name}_{kind}_2k.jpg"
    path.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "trumanbrown.com tidepool build"})
    with urllib.request.urlopen(req, timeout=120) as r:
        path.write_bytes(r.read())


def tex(name: str, kind: str = "diff", scale: float = 1.0) -> np.ndarray:
    """A Poly Haven texture as float32, colour for diff and nor_gl, else grey."""
    key = (name, kind, round(scale, 3))
    if key in _TEX:
        return _TEX[key]
    path = TEX / f"{name}_{kind}.jpg"
    if not path.exists():
        _download(name, kind, path)
    colour = kind in ("diff", "nor_gl")
    im = cv2.imread(str(path), cv2.IMREAD_COLOR if colour else cv2.IMREAD_GRAYSCALE)
    if scale != 1.0:
        im = cv2.resize(im, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
    if colour:
        im = cv2.cvtColor(im, cv2.COLOR_BGR2RGB)
    out = im.astype(np.float32) / 255.0
    _TEX[key] = out
    return out


def tile(t: np.ndarray, w: int, h: int, ox: int = 0, oy: int = 0) -> np.ndarray:
    th, tw = t.shape[:2]
    return t[(np.arange(h) + oy) % th][:, (np.arange(w) + ox) % tw]


def material(name: str, w: int, h: int, scale: float, ox: int = 0, oy: int = 0):
    """Albedo, normal (0..1 GL) and displacement of one scan, tiled at `scale`.
    Only the window needed is resized, so no scaled copies pile up in memory."""
    sw, sh = max(2, int(math.ceil(w / scale))), max(2, int(math.ceil(h / scale)))
    out = []
    for kind in ("diff", "nor_gl", "disp"):
        win = tile(tex(name, kind), sw, sh, ox, oy)
        if (sw, sh) != (w, h):
            win = cv2.resize(win, (w, h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC)
        out.append(win.astype(np.float32))
    return tuple(out)


# ------------------------------------------------------------------ noise etc
def fbm(w, h, seed, scale=300.0, octaves=5, gain=0.5):
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot, s = 1.0, 0.0, scale
    for _ in range(octaves):
        gw, gh = max(2, int(w / s) + 3), max(2, int(h / s) + 3)
        g = rng.random((gh, gw)).astype(np.float32)
        out += amp * cv2.resize(g, (int(gw * s), int(gh * s)), interpolation=cv2.INTER_CUBIC)[:h, :w]
        tot += amp
        amp *= gain
        s /= 2
    return out / tot


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def blob(cx, cy, rx, ry, seed, n=96, wob=0.1, rot=0.0):
    rng = np.random.default_rng(seed)
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    r = (1 + wob * np.sin(a * 2 + rng.random() * 6) + wob * 0.6 * np.sin(a * 3 + rng.random() * 6)
         + wob * 0.3 * np.sin(a * 5 + rng.random() * 6) + 0.012 * rng.standard_normal(n))
    r = cv2.GaussianBlur(r.reshape(-1, 1).astype(np.float32), (1, 7), 1.5).ravel()
    x, y = np.cos(a) * rx * r, np.sin(a) * ry * r
    c, s = math.cos(rot), math.sin(rot)
    return np.stack([cx + x * c - y * s, cy + x * s + y * c], 1).astype(np.float32)


def fill(pts, shape=(H, W)) -> np.ndarray:
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.round(pts).astype(np.int32)], 255)
    return m > 0


def dome(mask: np.ndarray, flat: float = 0.6) -> np.ndarray:
    """0..1 height of a rounded stone from its outline: steep sides, flatter top."""
    dt = cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)
    m = dt.max() or 1
    k = np.clip(dt / m, 0, 1)
    return cv2.GaussianBlur((1 - (1 - k) ** (1 + 2 * flat)).astype(np.float32), (0, 0), 2)


def normals(h: np.ndarray, tn: np.ndarray | None = None, k: float = 1.0, nk: float = 0.8) -> np.ndarray:
    gy, gx = np.gradient(h.astype(np.float32))
    n = np.dstack([-gx * k, -gy * k, np.ones_like(h)])
    if tn is not None:
        t = tn * 2 - 1
        n[..., 0] += t[..., 0] * nk
        n[..., 1] -= t[..., 1] * nk
    return n / np.linalg.norm(n, axis=2, keepdims=True)


def cast_shadow(h: np.ndarray, reach: int = 140, step: int = 3, soft: float = 6.0) -> np.ndarray:
    """0 lit to 1 in shadow, by marching toward the light over the height field."""
    lx, ly, lz = LIGHT
    hor = math.hypot(lx, ly)
    dx, dy, tan_e = lx / hor, ly / hor, lz / hor
    occ = np.zeros_like(h)
    hh, ww = h.shape
    for d in range(step, reach + 1, step):
        M = np.float32([[1, 0, -dx * d], [0, 1, -dy * d]])
        q = cv2.warpAffine(h, M, (ww, hh), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        occ = np.maximum(occ, np.clip((q - h - d * tan_e) / soft, 0, 1))
    return cv2.GaussianBlur(occ, (0, 0), 1.6)


def occlusion(h: np.ndarray, r: float = 24, k: float = 0.012) -> np.ndarray:
    a = np.clip(1 - np.maximum(cv2.GaussianBlur(h, (0, 0), r) - h, 0) * k, 0.4, 1)
    b = np.clip(1 - np.maximum(cv2.GaussianBlur(h, (0, 0), r / 4) - h, 0) * k * 2, 0.5, 1)
    return a * b


def light(albedo, h, tn=None, *, k=1.0, nk=0.8, wet=None, spec=0.35, shadow=True, reach=140, ao=True):
    """Sun plus sky on a height field, with cast shadows and wet highlights."""
    n = normals(h, tn, k, nk)
    lam = np.clip(n @ LIGHT, 0, 1)
    sh = cast_shadow(h, reach) if shadow else np.zeros_like(h)
    occ = occlusion(h) if ao else np.ones_like(h)
    sky = 0.5 + 0.5 * n[..., 2]
    out = albedo * (SKY[None, None] * (0.5 * sky * occ)[..., None] + SUN[None, None] * (0.95 * lam * (1 - sh))[..., None])
    if spec:
        hv = LIGHT + np.array([0, 0, 1], np.float32)
        hv /= np.linalg.norm(hv)
        s = np.clip(n @ hv, 0, 1)
        w = np.ones_like(h) if wet is None else wet
        out += ((s ** 60 * 0.9 + s ** 14 * 0.12) * spec * w * (1 - sh))[..., None] * SUN[None, None]
    return out


def grade(rgb: np.ndarray) -> np.ndarray:
    """The same overcast-coast grade on every beach: a touch cool, soft blacks."""
    rgb = np.clip(rgb, 0, None)
    rgb = rgb / (1 + rgb * 0.18)  # soft shoulder for highlights
    rgb = rgb * np.array([0.97, 1.0, 1.03], np.float32)
    lum = rgb.mean(axis=2, keepdims=True)
    rgb = lum + (rgb - lum) * 0.92
    return np.clip(rgb * 1.08 + 0.012, 0, 1)


def grain(h, w, seed, amt=0.018):
    rng = np.random.default_rng(seed)
    g = rng.standard_normal((h, w)).astype(np.float32)
    return cv2.GaussianBlur(g, (0, 0), 0.6)[..., None] * amt


# ------------------------------------------------------------------ barnacles
def barnacle_cone(r: int, seed: int):
    """One acorn barnacle seen from above: a ring of six plates rising to a
    small diamond opening."""
    s_ = 2 * r + 3
    y_, x_ = np.mgrid[0:s_, 0:s_].astype(np.float32) - r - 1
    ang = np.arctan2(y_, x_)
    d = np.hypot(x_, y_) / (r * (1 + 0.1 * np.sin(ang * 6 + seed) + 0.05 * np.sin(ang * 11 + seed)))
    a = np.clip((1 - d) * r * 0.8, 0, 1)
    hh = np.clip(1 - d, 0, 1) ** 0.6 * r * 1.1
    rot = seed * 0.7
    u = x_ * math.cos(rot) + y_ * math.sin(rot)
    v = -x_ * math.sin(rot) + y_ * math.cos(rot)
    ap = (np.abs(u) / (r * 0.3) + np.abs(v) / (r * 0.16)) < 1
    hh[ap] *= 0.35
    plates = 0.86 + 0.14 * np.abs(np.cos(ang * 3 + seed))  # the seams between plates
    ribs = 1 + 0.07 * np.sin(d * r * 1.6)
    return a, hh, ap, plates * ribs


class Patch:
    """Something barnacles can be stamped onto: an albedo, a height and labels."""

    def __init__(self, alb, h, lab=None):
        self.alb, self.h = alb, h
        self.h_, self.w_ = h.shape
        self.lab = lab


def stamp_barnacles(F, density: np.ndarray, rng, count=14000, rmean=5.5, rsd=1.7):
    """Acorn barnacles packed where `density` is high, into F.alb and F.h.
    `rmean` is in the old units; they're drawn at 1.8 times it, about a
    centimetre and a half across, which is their real size here."""
    ys, xs = np.nonzero(density > 0.04)
    cover = np.zeros((F.h_, F.w_), np.float32)
    if not len(xs):
        return cover
    cell = 9
    occ = np.zeros((F.h_ // cell + 2, F.w_ // cell + 2), np.uint8)
    for i in rng.permutation(len(xs))[:count]:
        cx, cy = int(xs[i]), int(ys[i])
        if rng.random() > density[cy, cx]:
            continue
        r = int(np.clip(rng.normal(rmean * 1.8, rsd * 1.6), 5, 18))
        gx, gy = cx // cell, cy // cell
        if occ[max(0, gy - 1):gy + 2, max(0, gx - 1):gx + 2].sum() > (2 if r < 10 else 1):
            continue
        a, hh, ap, plates = barnacle_cone(r, int(rng.integers(0, 1000)))
        s_ = a.shape[0]
        y0, x0 = cy - r - 1, cx - r - 1
        if y0 < 0 or x0 < 0 or y0 + s_ > F.h_ or x0 + s_ > F.w_:
            continue
        occ[gy, gx] += 1
        tone = 0.5 + 0.26 * rng.random()
        c = np.empty(a.shape + (3,), np.float32)
        c[:] = (tone, tone * 0.97, tone * 0.9)
        c *= plates[..., None]
        c[ap] = (0.12, 0.11, 0.1)
        reg = (slice(y0, y0 + s_), slice(x0, x0 + s_))
        F.alb[reg] = F.alb[reg] * (1 - a[..., None]) + c * a[..., None]
        F.h[reg] = np.maximum(F.h[reg], F.h[reg] * (1 - a) + (F.h[reg] + hh) * a)
        cover[reg] = np.maximum(cover[reg], a)
    if F.lab is not None:
        F.lab[cover > 0.5] = LID["acorn-barnacle"]
    return cover


# ------------------------------------------------------------------ the field
class Field:
    def __init__(self, name: str, title: str, pxcm: float, seed: int):
        self.name, self.title, self.pxcm, self.seed = name, title, pxcm, seed
        self.w_, self.h_ = W, H
        self.rng = np.random.default_rng(seed)
        self.alb = np.zeros((H, W, 3), np.float32)
        self.h = np.zeros((H, W), np.float32)
        self.tn = np.full((H, W, 3), 0.5, np.float32)
        self.tn[..., 2] = 1
        self.wet = np.ones((H, W), np.float32) * 0.5
        self.water = np.zeros((H, W), np.float32)  # depth 0..1
        self.lab = np.zeros((H, W), np.uint8)
        self.rocks: list[dict] = []
        self.slots: dict[str, list] = {}
        self.weeds: list[dict] = []
        self.extra: dict = {}
        self._rock_pts: list = []
        self._blocked = None
        self.out = OUT / name
        self.out.mkdir(parents=True, exist_ok=True)
        self.yy, self.xx = np.mgrid[0:H, 0:W].astype(np.float32)

    def slot(self, kind: str, *vals):
        self.slots.setdefault(kind, []).append([round(float(v), 1) for v in vals])

    def lay(self, mask, name, scale, ox=0, oy=0, tint=(1, 1, 1), gain=1.0, hk=1.0, soft=1.5):
        """Paint a scan into `mask` (bool or 0..1) as albedo, normals and height."""
        a, n, d = material(name, W, H, scale, ox, oy)
        m = mask.astype(np.float32)
        if soft:
            m = cv2.GaussianBlur(m, (0, 0), soft)
        m3 = m[..., None]
        self.alb = self.alb * (1 - m3) + a * np.array(tint, np.float32) * gain * m3
        self.tn = self.tn * (1 - m3) + n * m3
        self.h = self.h * (1 - m) + (self.h + d * 24 * hk) * m
        return m


# ------------------------------------------------------------------ loose rocks
ROCK_SKINS = [
    ("dark_rock_02", 1.9, (1, 1, 1)), ("rock_surface", 1.25, (1, 1, 1)), ("dark_rock", 2.0, (1, 0.98, 0.95)),
    ("seaside_rock", 1.35, (1, 1, 1)), ("rock_08", 1.0, (0.92, 0.92, 0.94)),
]


def _save_rgba(path: Path, rgb: np.ndarray, a: np.ndarray):
    im = np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)])
    Image.fromarray((im * 255).astype(np.uint8), "RGBA").save(path, "WEBP", quality=88, method=6)


def rock_sprite(F: Field, pts, i: int, skin: int, *, barn=0.0, film=0.0, heavy=1, thick=None):
    """Top and underside sprites for one loose rock, and its bed baked into F."""
    rng = np.random.default_rng(F.seed * 1000 + i)
    full = fill(pts)
    x0, y0 = int(pts[:, 0].min()) - 10, int(pts[:, 1].min()) - 10
    x1, y1 = int(pts[:, 0].max()) + 11, int(pts[:, 1].max()) + 11
    x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
    w, h = x1 - x0, y1 - y0
    m = full[y0:y1, x0:x1]
    size = math.sqrt(m.sum() / math.pi)
    hgt_k = thick or size * 0.55
    dm = dome(m, 0.7)
    name, gain, tint = ROCK_SKINS[skin % len(ROCK_SKINS)]
    sc = 0.7 + 0.25 * rng.random()
    alb, tn, disp = material(name, w, h, sc, int(rng.integers(0, 2000)), int(rng.integers(0, 2000)))
    alb = alb * gain * np.array(tint, np.float32)
    hh = dm * hgt_k + disp * 14 + fbm(w, h, int(rng.integers(0, 1e6)), scale=max(30, size * 0.6), octaves=3) * size * 0.08
    if barn > 0:
        P = Patch(alb, hh)
        dens = barn * smoothstep(0.35, 0.8, dm) * smoothstep(0.42, 0.62, fbm(w, h, int(rng.integers(0, 1e6)), scale=40, octaves=3))
        stamp_barnacles(P, dens, rng, count=int(w * h / 60), rmean=4.6, rsd=1.2)
        alb, hh = P.alb, P.h
    if film > 0:
        g = film * smoothstep(0.55, 0.72, fbm(w, h, int(rng.integers(0, 1e6)), scale=30, octaves=3)) * smoothstep(0.2, 0.7, dm)
        alb = alb * (1 - 0.6 * g[..., None]) + np.array([0.3, 0.42, 0.16], np.float32) * 0.6 * g[..., None]
    # Tops dry paler, the lower sides stay wet and dark.
    dry = smoothstep(0.45, 0.95, dm)
    alb = alb * (0.78 + 0.3 * dry[..., None])
    top = light(alb, hh, tn, k=1.0, nk=0.6, wet=1 - dry * 0.7, spec=0.55, reach=60)
    a = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 0.9)
    _save_rgba(F.out / f"rock{i}.webp", grade(top), a)

    # Underside: the same stone, wet and dark, filmed with silt, with patches
    # of pink coralline crust, now and then a thin red sponge, and tube worms.
    ua = alb * 0.5
    silt = smoothstep(0.4, 0.75, fbm(w, h, int(rng.integers(0, 1e6)), scale=40, octaves=4))
    ua = ua * (1 - 0.45 * silt[..., None]) + np.array([0.24, 0.21, 0.16], np.float32) * 0.45 * silt[..., None]
    cor = smoothstep(0.6, 0.7, fbm(w, h, int(rng.integers(0, 1e6)), scale=22, octaves=4)) * smoothstep(0.2, 0.55, dm)
    cor *= 0.4 + 0.6 * fbm(w, h, int(rng.integers(0, 1e6)), scale=4, octaves=2)
    ua = ua * (1 - 0.6 * cor[..., None]) + np.array([0.58, 0.44, 0.48], np.float32) * 0.6 * cor[..., None]
    if rng.random() < 0.35:
        sp = smoothstep(0.7, 0.76, fbm(w, h, int(rng.integers(0, 1e6)), scale=30, octaves=3)) * smoothstep(0.35, 0.6, dm)
        ua = ua * (1 - 0.5 * sp[..., None]) + np.array([0.52, 0.27, 0.2], np.float32) * 0.5 * sp[..., None]
    # Grains of sand stuck to it.
    gr = (np.random.default_rng(i + 7).random((h, w)) > 0.985) * smoothstep(0.1, 0.4, dm)
    ua = ua * (1 - 0.6 * gr[..., None]) + np.array([0.62, 0.58, 0.5], np.float32) * 0.6 * gr[..., None]
    uh = dm * hgt_k * 0.5 + disp * 8
    under = light(ua, uh, None, k=0.9, wet=np.ones_like(uh), spec=0.22, reach=30)
    under = np.ascontiguousarray(np.clip(grade(under), 0, 1))
    dt = cv2.distanceTransform(m.astype(np.uint8), cv2.DIST_L2, 5)
    for _ in range(int(w * h / 1800)):
        px, py = int(rng.integers(6, w - 6)), int(rng.integers(6, h - 6))
        if m[py, px] and dt[py, px] > 8:
            cv2.circle(under, (px, py), 2, (0.62, 0.6, 0.56), -1, cv2.LINE_AA)
            cv2.circle(under, (px, py), 1, (0.4, 0.38, 0.35), -1, cv2.LINE_AA)
    _save_rgba(F.out / f"rock{i}-under.webp", under, a)

    # The bed: damp, darker, a pale line where its edge sat, and wet shine.
    bed = cv2.dilate(full.astype(np.uint8), np.ones((9, 9), np.uint8)) > 0
    bd = cv2.GaussianBlur(bed.astype(np.float32), (0, 0), 4)
    F.alb *= (1 - 0.32 * bd)[..., None]
    rim = cv2.morphologyEx(full.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((9, 9), np.uint8)).astype(np.float32)
    rim = cv2.GaussianBlur(rim, (0, 0), 2.5)
    F.alb = F.alb * (1 - 0.3 * rim[..., None]) + np.array([0.6, 0.57, 0.5], np.float32) * 0.3 * rim[..., None]
    F.h -= bd * 6
    F.wet = np.maximum(F.wet, bd)
    return dict(file=f"rock{i}.webp", under=f"rock{i}-under.webp", x=x0, y=y0, w=w, h=h, heavy=heavy,
                size=round(size, 1), thick=round(float(hgt_k), 1),
                pts=[[round(float(px), 1), round(float(py), 1)] for px, py in pts[::2]])


def choose_fall(pts, others, blocked: np.ndarray) -> float:
    """Which way a rock tips: onto the most open dry ground beside it."""
    cx, cy = pts[:, 0].mean(), pts[:, 1].mean()
    best, score = 0.0, -1e9
    for k in range(16):
        a = k * math.pi / 8
        ux, uy = math.cos(a), math.sin(a)
        proj = (pts[:, 0] - cx) * ux + (pts[:, 1] - cy) * uy
        e = proj.max()
        # Mirror the outline across the hinge: where it'll lie when it's over.
        mx = pts[:, 0] + ux * 2 * (e - proj)
        my = pts[:, 1] + uy * 2 * (e - proj)
        if mx.min() < 30 or my.min() < 30 or mx.max() > W - 30 or my.max() > H - 30:
            continue
        land = fill(np.stack([mx, my], 1))
        bad = (land & blocked).sum() / max(1, land.sum())
        lx, ly = cx + ux * 2 * e, cy + uy * 2 * e
        near = min([math.hypot(o[0] - lx, o[1] - ly) for o in others] or [600])
        s = -bad * 10 + min(near, 600) / 600 + 0.05 * math.cos(a - 0.9)
        if s > score:
            best, score = a, s
    return best


def add_rock(F: Field, cx, cy, rx, ry, rot, skin, blocked, *, barn=0.0, film=0.0, heavy=1, wob=0.1, thick=None):
    i = len(F.rocks)
    pts = blob(cx, cy, rx, ry, F.seed * 100 + i, wob=wob, rot=rot)
    r = rock_sprite(F, pts, i, skin, barn=barn, film=film, heavy=heavy, thick=thick)
    r.update(cx=round(float(cx), 1), cy=round(float(cy), 1), rx=round(float(rx), 1), ry=round(float(ry), 1),
             rot=round(float(rot), 3), fall=0.0)
    F.rocks.append(r)
    F._rock_pts.append(pts)
    F._blocked = blocked.copy() if F._blocked is None else (F._blocked | blocked)
    return pts


def settle_falls(F: Field):
    """Pick which way each rock tips, now that all of them are placed: onto
    open ground, clear of fixed stones, pools, the other rocks and wherever
    the ones already decided will land."""
    if not F.rocks:
        return
    base = F._blocked if F._blocked is not None else np.zeros((H, W), bool)
    rests = [fill(p) for p in F._rock_pts]
    landed = np.zeros((H, W), bool)
    order = sorted(range(len(F.rocks)), key=lambda i: -F.rocks[i]["size"])
    for i in order:
        others = np.zeros((H, W), bool)
        for j, m in enumerate(rests):
            if j != i:
                others |= cv2.dilate(m.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
        pts = F._rock_pts[i]
        fall = choose_fall(pts, [], base | others | landed)
        F.rocks[i]["fall"] = round(fall, 3)
        cx, cy = pts[:, 0].mean(), pts[:, 1].mean()
        ux, uy = math.cos(fall), math.sin(fall)
        proj = (pts[:, 0] - cx) * ux + (pts[:, 1] - cy) * uy
        e = proj.max()
        land = fill(np.stack([pts[:, 0] + ux * 2 * (e - proj), pts[:, 1] + uy * 2 * (e - proj)], 1))
        landed |= cv2.dilate(land.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0


# ------------------------------------------------------------------ pools
def pool_floor(F: Field, mask: np.ndarray, depth: np.ndarray, seed: int, *, pebbles=0.5, coralline=0.5, film=0.3,
               rock="seaside_rock", rock_gain=1.35, carve=160, peb_scale=0.75):
    """Carve a pool: its floor and walls in F, and its water depth."""
    a_r, n_r, d_r = material(rock, W, H, 0.8, seed * 7 % 2000, seed * 13 % 2000)
    a_p, n_p, d_p = material("ganges_river_pebbles", W, H, peb_scale, seed * 3 % 2000, seed * 5 % 2000)
    peb = smoothstep(0.6 - 0.25 * pebbles, 0.75 - 0.25 * pebbles, fbm(W, H, seed + 1, scale=120, octaves=4)) * smoothstep(0.25, 0.7, depth)
    alb = a_r * rock_gain * (1 - peb[..., None]) + a_p * 1.15 * peb[..., None]
    tn = n_r * (1 - peb[..., None]) + n_p * peb[..., None]
    cn = fbm(W, H, seed + 2, scale=90, octaves=6)
    cov = smoothstep(0.62 - 0.2 * coralline, 0.74 - 0.2 * coralline, cn) * smoothstep(0.05, 0.3, depth) * (1 - peb)
    cov *= 0.6 + 0.4 * smoothstep(0.3, 0.6, fbm(W, H, seed + 3, scale=12, octaves=3))
    lum = alb.mean(axis=2, keepdims=True)
    pink = np.array([0.74, 0.58, 0.62], np.float32) * (0.6 + 0.55 * lum / (lum.mean() + 1e-6) * 0.5)
    alb = alb * (1 - 0.8 * cov[..., None]) + pink * 0.8 * cov[..., None]
    gf = film * smoothstep(0.0, 0.15, depth) * smoothstep(0.45, 0.15, depth) * smoothstep(0.4, 0.6, fbm(W, H, seed + 4, scale=40, octaves=3))
    alb = alb * (1 - 0.5 * gf[..., None]) + np.array([0.36, 0.46, 0.2], np.float32) * 0.5 * gf[..., None]
    m = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 1.2)
    m3 = m[..., None]
    ef = smoothstep(0, 14, clearance(mask))
    F.alb = F.alb * (1 - m3) + alb * m3
    F.tn = F.tn * (1 - m3 * ef[..., None]) + tn * (m3 * ef[..., None])
    F.h = F.h - depth * carve * m + ((d_r - 0.5) * 16 * (1 - peb) + (d_p - 0.5) * 20 * peb) * ef * m
    F.water = np.maximum(F.water, depth * mask)
    F.wet = np.maximum(F.wet, m)
    F.lab[mask] = LID["water"]
    F.lab[mask & (cov > 0.45)] = LID["coralline"]
    return cov


def wet_rim(F: Field, mask: np.ndarray, width=26, k=0.35):
    out = ~mask
    d = cv2.distanceTransform(out.astype(np.uint8), cv2.DIST_L2, 5)
    rim = smoothstep(width, 0, d) * out
    F.alb *= (1 - k * rim)[..., None]
    F.wet = np.maximum(F.wet, rim)


# ------------------------------------------------------------------ finishing
def finish(F: Field):
    """Light the field, write every file, and print a summary."""
    settle_falls(F)
    dry = 1 - smoothstep(0.0, 0.02, F.water)
    lit = light(F.alb, F.h, F.tn, k=1.0, nk=0.7, wet=F.wet * dry, spec=0.45, reach=150)
    rgb = np.clip(grade(lit) + grain(H, W, F.seed), 0, 1)
    Image.fromarray((rgb * 255).astype(np.uint8)).save(F.out / "base.webp", "WEBP", quality=86, method=6)
    half = (W // 2, H // 2)
    wat = cv2.resize(F.water, half, interpolation=cv2.INTER_AREA)
    wat = np.where(wat > 0.004, np.clip(wat, 1 / 255, 1), 0)
    Image.fromarray((wat * 255).astype(np.uint8)).save(F.out / "water.png", optimize=True)
    Image.fromarray(cv2.resize(F.lab, half, interpolation=cv2.INTER_NEAREST)).save(F.out / "labels.png", optimize=True)
    for k in F.slots:
        F.rng.shuffle(F.slots[k])
    meta = dict(name=F.name, title=F.title, W=W, H=H, pxcm=F.pxcm, labels=LABELS, rocks=F.rocks,
                slots=F.slots, weeds=F.weeds, **F.extra)
    (F.out / "beach.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(F.name, "rocks", len(F.rocks), "slots", {k: len(v) for k, v in F.slots.items()}, "weeds", len(F.weeds), flush=True)


def free_slots(F: Field, kind: str, ok: np.ndarray, n: int, *, margin=60, spacing=40, extra=None):
    """Sample up to n points where `ok`, spread out a little."""
    ys, xs = np.nonzero(ok[margin:H - margin, margin:W - margin])
    if not len(xs):
        return
    picks = []
    for i in F.rng.permutation(len(xs))[: n * 40]:
        x, y = int(xs[i]) + margin, int(ys[i]) + margin
        if any((x - px) ** 2 + (y - py) ** 2 < spacing ** 2 for px, py in picks):
            continue
        picks.append((x, y))
        F.slot(kind, x, y, *(extra(x, y) if extra else ()))
        if len(picks) >= n:
            break


def clearance(mask: np.ndarray) -> np.ndarray:
    return cv2.distanceTransform(mask.astype(np.uint8), cv2.DIST_L2, 5)


def stone(F: Field, x, y, r, sq, rot, seed, *, skin=None, flat=0.5, hk=0.62, barn=0.0, film=0.0, gain_k=1.0):
    """A fixed rounded stone baked into the field, worked in its own box.
    Returns its full-field mask."""
    rng = np.random.default_rng(seed)
    pts = blob(x, y, r, r * sq, seed, wob=0.07, rot=rot)
    x0, y0 = max(0, int(pts[:, 0].min()) - 8), max(0, int(pts[:, 1].min()) - 8)
    x1, y1 = min(W, int(pts[:, 0].max()) + 9), min(H, int(pts[:, 1].max()) + 9)
    w, h = x1 - x0, y1 - y0
    reg = (slice(y0, y1), slice(x0, x1))
    m = fill(pts - np.array([x0, y0], np.float32), (h, w))
    dm = dome(m, flat)
    name, gain, tint = ROCK_SKINS[skin if skin is not None else int(rng.integers(0, len(ROCK_SKINS)))]
    a, n, d = material(name, w, h, 0.6 + 0.3 * rng.random(), int(rng.integers(0, 2000)), int(rng.integers(0, 2000)))
    a = a * gain * gain_k * np.array(tint, np.float32) * (0.85 + 0.3 * rng.random())
    mm = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.0)[..., None]
    dry = smoothstep(0.4, 0.95, dm)
    a = a * (0.75 + 0.35 * dry[..., None])
    hh = dm * r * hk + d * 10
    P = Patch(a, hh, np.zeros((h, w), np.uint8))
    if barn:
        dens = barn * smoothstep(0.4, 0.8, dm) * smoothstep(0.5, 0.65, fbm(w, h, int(rng.integers(0, 1e6)), scale=40, octaves=3)) * m
        stamp_barnacles(P, dens, rng, count=int(r * r * 0.5), rmean=4.6, rsd=1.3)
    if film:
        g = film * smoothstep(0.55, 0.7, fbm(w, h, int(rng.integers(0, 1e6)), scale=24, octaves=3)) * smoothstep(0.3, 0.8, dm) * m
        P.alb = P.alb * (1 - 0.55 * g[..., None]) + np.array([0.3, 0.44, 0.16], np.float32) * 0.55 * g[..., None]
        P.lab[g > 0.4] = LID["film"]
    F.alb[reg] = F.alb[reg] * (1 - mm) + P.alb * mm
    F.tn[reg] = F.tn[reg] * (1 - mm) + n * mm
    ground = float(np.median(F.h[reg][m])) if m.any() else 0.0
    F.h[reg] = np.where(m, np.maximum(F.h[reg], ground + P.h), F.h[reg])
    F.wet[reg] = np.where(m, 1 - dry * 0.75, F.wet[reg])
    lab = F.lab[reg]
    lab[m] = LID["cobble"]
    lab[P.lab > 0] = P.lab[P.lab > 0]
    full = np.zeros((H, W), bool)
    full[reg] = m
    return full



# ------------------------------------------------------------------ drawn life
def centreline_field(path: np.ndarray, radii: np.ndarray, box):
    """Distance to a polyline and the radius of its nearest point, in `box`."""
    x0, y0, w, h = box
    canvas = np.full((h, w), 255, np.uint8)
    lab = np.zeros((h, w), np.int32)
    pts = np.round(path - np.array([x0, y0], np.float32)).astype(np.int32)
    for k in range(len(pts) - 1):
        cv2.line(canvas, tuple(pts[k]), tuple(pts[k + 1]), 0, 1, cv2.LINE_8)
    d, labels = cv2.distanceTransformWithLabels(canvas, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    # Map each zero pixel's label to the radius of the nearest path point.
    zy, zx = np.nonzero(canvas == 0)
    zl = labels[zy, zx]
    tree_pts = pts.astype(np.float32)
    idx = np.argmin((tree_pts[None, :, 0] - zx[:, None]) ** 2 + (tree_pts[None, :, 1] - zy[:, None]) ** 2, axis=1) if len(zx) < 60000 else np.zeros(len(zx), int)
    rad_of_label = np.zeros(labels.max() + 1, np.float32)
    rad_of_label[zl] = radii[idx]
    pos_of_label = np.zeros(labels.max() + 1, np.float32)
    pos_of_label[zl] = idx / max(1, len(pts) - 1)
    return d, rad_of_label[labels], pos_of_label[labels]


def wavy_path(x, y, ang, length, rng, *, step=8, curl=0.03, drift=0.0):
    pts = [(x, y)]
    a = ang
    n = int(length / step)
    for _ in range(n):
        a += rng.normal(drift, curl)
        x += math.cos(a) * step
        y += math.sin(a) * step
        pts.append((x, y))
    return np.array(pts, np.float32)


def paint_patch(F, box, mask, alb, hgt, label=None, *, wet=1.0, tn_flat=True, soft=0.8):
    x0, y0, w, h = box
    reg = (slice(y0, y0 + h), slice(x0, x0 + w))
    m = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), soft) if soft else mask.astype(np.float32)
    m3 = m[..., None]
    F.alb[reg] = F.alb[reg] * (1 - m3) + alb * m3
    F.h[reg] = np.maximum(F.h[reg], F.h[reg] * (1 - m) + hgt * m)
    if tn_flat:
        F.tn[reg] = F.tn[reg] * (1 - m3) + np.array([0.5, 0.5, 1.0], np.float32) * m3
    F.wet[reg] = np.maximum(F.wet[reg], m * wet)
    if label:
        F.lab[reg][mask] = LID[label]


def clip_box(path, pad):
    x0, y0 = int(max(0, path[:, 0].min() - pad)), int(max(0, path[:, 1].min() - pad))
    x1, y1 = int(min(W, path[:, 0].max() + pad)), int(min(H, path[:, 1].max() + pad))
    return x0, y0, max(2, x1 - x0), max(2, y1 - y0)


def tube(F, path, radii, colour, label, rng, *, base_h=None, gloss=1.0):
    """A round stalk lying on the ground, like a bull kelp stipe."""
    box = clip_box(path, radii.max() + 6)
    d, r, pos = centreline_field(path, radii, box)
    m = d < r
    hh = np.sqrt(np.clip(r * r - d * d, 0, None))
    x0, y0, w, h = box
    base = F.h[y0:y0 + h, x0:x0 + w] if base_h is None else base_h
    tone = (0.85 + 0.25 * fbm(w, h, int(rng.integers(0, 1e6)), scale=60, octaves=3))[..., None]
    alb = np.array(colour, np.float32) * tone
    paint_patch(F, box, m, alb, base + hh, label, wet=gloss)


def ribbon(F, path, width, colour, label, rng, *, ruffle=0.18, thick=3.0, streak=0.15, edge_dark=0.25, wet=1.0):
    """A flat blade lying on the ground: kelp blades, eelgrass."""
    n = len(path)
    t = np.linspace(0, 1, n)
    wv = width * (0.55 + 0.45 * np.sin(np.pi * np.clip(t * 1.1, 0, 1)) ** 0.5)
    wv *= 1 + ruffle * np.sin(t * n * 0.9 + rng.random() * 6) * (0.4 + 0.6 * t)
    box = clip_box(path, wv.max() + 6)
    d, r, pos = centreline_field(path, (wv / 2).astype(np.float32), box)
    m = d < r
    x0, y0, w, h = box
    k = np.clip(d / np.maximum(r, 1), 0, 1)
    hh = F.h[y0:y0 + h, x0:x0 + w] + thick * (1 - k ** 2) + 2 * np.sin(pos * 40 + rng.random() * 6)
    st = 1 + streak * (fbm(w, h, int(rng.integers(0, 1e6)), scale=3, octaves=2) - 0.5)
    alb = np.array(colour, np.float32) * st[..., None] * (1 - edge_dark * k ** 4)[..., None]
    paint_patch(F, box, m, alb, hh, label, wet=wet)


def bull_kelp(F, x, y, ang, rng, *, length=1300, label="bull-kelp"):
    """A whole washed-up bull kelp: holdfast, a long tapering stipe, the bulb
    and a tangle of long flat blades from it."""
    stipe = wavy_path(x, y, ang, length, rng, step=8, curl=0.025)
    n = len(stipe)
    radii = np.linspace(8, 18, n).astype(np.float32)
    radii[-14:] = np.linspace(18, 30, 14)
    olive = (0.36, 0.28, 0.12)
    # Blades first so the stipe and bulb lie on top of them.
    bx, by = stipe[-1]
    end_ang = math.atan2(stipe[-1, 1] - stipe[-8, 1], stipe[-1, 0] - stipe[-8, 0])
    for _ in range(int(rng.integers(7, 11))):
        a = end_ang + rng.normal(0, 0.45)
        L = rng.uniform(500, 1000)
        path = wavy_path(bx + math.cos(a) * 30, by + math.sin(a) * 30, a, L, rng, step=8, curl=0.035)
        tone = rng.uniform(0.85, 1.15)
        ribbon(F, path, rng.uniform(70, 120), tuple(c * tone for c in (0.3, 0.23, 0.1)), label, rng, ruffle=0.28, thick=4, edge_dark=0.45, streak=0.25)
    tube(F, stipe, radii, olive, label, rng)
    # The bulb: a round float, glossy.
    yy, xx = np.mgrid[-50:51, -50:51].astype(np.float32)
    R = 46
    dd = np.hypot(xx, yy)
    m = dd < R
    box = (int(bx) - 50, int(by) - 50, 101, 101)
    if box[0] >= 0 and box[1] >= 0 and box[0] + 101 <= W and box[1] + 101 <= H:
        base = F.h[box[1]:box[1] + 101, box[0]:box[0] + 101]
        hh = base + np.sqrt(np.clip(R * R - dd * dd, 0, None)) * 0.9
        alb = np.array((0.4, 0.31, 0.13), np.float32) * np.ones((101, 101, 1), np.float32)
        paint_patch(F, box, m, alb, hh, label, wet=1.0)
    # Holdfast: a knot of short fingers at the far end.
    hx, hy = stipe[0]
    for _ in range(9):
        a = rng.uniform(0, 2 * math.pi)
        p = wavy_path(hx, hy, a, rng.uniform(25, 55), rng, step=4, curl=0.2)
        tube(F, p, np.linspace(6, 3, len(p)).astype(np.float32), (0.3, 0.24, 0.12), label, rng)
    return stipe


def eelgrass(F, x, y, rng, n=14, spread=120):
    for _ in range(n):
        a = rng.uniform(-0.5, 0.5) + rng.choice([0, math.pi])
        p = wavy_path(x + rng.normal(0, spread), y + rng.normal(0, spread * 0.3), a, rng.uniform(250, 700), rng, step=6, curl=0.06)
        tone = rng.uniform(0.75, 1.2)
        col = (0.3 * tone, 0.34 * tone, 0.13 * tone) if rng.random() < 0.6 else (0.22 * tone, 0.32 * tone, 0.12 * tone)
        ribbon(F, p, rng.uniform(7, 10), col, "eelgrass", rng, ruffle=0.05, thick=1.5, edge_dark=0.1)


def shells(F, mask_ok, rng, n=40):
    """Broken clam and cockle shells, pale, a few upside down."""
    ys, xs = np.nonzero(mask_ok)
    if not len(xs):
        return
    for i in rng.permutation(len(xs))[:n]:
        cx, cy = int(xs[i]), int(ys[i])
        L = rng.uniform(14, 34)
        box = (cx - 50, cy - 50, 100, 100)
        if box[0] < 0 or box[1] < 0 or box[0] + 100 > W or box[1] + 100 > H:
            continue
        yy, xx = np.mgrid[-50:50, -50:50].astype(np.float32)
        a = rng.uniform(0, math.pi * 2)
        u = xx * math.cos(a) + yy * math.sin(a)
        v = -xx * math.sin(a) + yy * math.cos(a)
        e = (u / L) ** 2 + (v / (L * 0.78)) ** 2
        m = e < 1
        cut = rng.random()
        if cut < 0.75:  # broken: keep one side of a jagged line
            m &= (v + 6 * np.sin(u * 0.4 + rng.random() * 6)) < rng.uniform(-0.2, 0.5) * L
        if m.sum() < 30:
            continue
        ridges = 0.96 + 0.04 * np.sin(np.hypot(u + L, v) * 0.9) + 0.03 * np.cos(np.arctan2(v, u + L) * 40)
        cream = np.array(rng.choice([(0.74, 0.7, 0.62), (0.68, 0.66, 0.64), (0.62, 0.56, 0.6), (0.76, 0.72, 0.66)]), np.float32)
        alb = cream * ridges[..., None]
        base = F.h[box[1]:box[1] + 100, box[0]:box[0] + 100]
        hh = base + np.sqrt(np.clip(1 - e, 0, 1)) * L * 0.12
        paint_patch(F, box, m, alb, hh, "shells", wet=0.6)


def mussel_bed(F, density, rng, count=2600, lmin=60, lmax=150):
    """California mussels packed into a bed, each a ridged blue-black shell,
    worn pale at the hinge, lying every which way."""
    ys, xs = np.nonzero(density > 0.05)
    cover = np.zeros((H, W), np.float32)
    if not len(xs):
        return cover
    g0 = F.h.copy()  # the rock under the bed; mussels pile at most a shell or two deep
    order = rng.permutation(len(xs))[: count * 4]
    placed = 0
    for i in order:
        if placed >= count:
            break
        cx, cy = int(xs[i]), int(ys[i])
        if rng.random() > density[cy, cx]:
            continue
        L = rng.uniform(lmin, lmax)
        Wd = L * rng.uniform(0.42, 0.5)
        S = int(L * 0.6) + 4
        x0, y0 = cx - S, cy - S
        if x0 < 0 or y0 < 0 or x0 + 2 * S > W or y0 + 2 * S > H:
            continue
        yy, xx = np.mgrid[-S:S, -S:S].astype(np.float32)
        a = rng.uniform(0, 2 * math.pi)
        u = (xx * math.cos(a) + yy * math.sin(a)) / L + 0.5  # 0 at the hinge, 1 at the back
        v = (-xx * math.sin(a) + yy * math.cos(a)) / Wd
        half = 0.5 * np.clip(np.sin(np.pi * np.clip(u, 0, 1) ** 0.62), 0, None) ** 0.85
        half += 0.04 * np.sin(np.pi * np.clip(u, 0, 1)) * np.sign(v)  # a little lopsided
        m = (u > 0) & (u < 1) & (np.abs(v) < half)
        if m.sum() < 40:
            continue
        k = np.clip(np.abs(v) / np.maximum(half, 1e-3), 0, 1)
        dom = np.sqrt(np.clip(1 - k ** 2, 0, 1)) * (0.35 + 0.65 * np.sin(np.pi * np.clip(u, 0, 1) ** 0.7))
        cur = F.h[y0:y0 + 2 * S, x0:x0 + 2 * S]
        base0 = g0[y0:y0 + 2 * S, x0:x0 + 2 * S]
        hh = base0 + np.clip(cur - base0, 0, 18) + dom * Wd * 0.32
        ridge = 1 + 0.06 * np.sin(u * 46 + rng.random() * 6)
        hh += (ridge - 1) * 6
        base = np.array([0.075, 0.08, 0.11], np.float32) * rng.uniform(0.8, 1.25)
        alb = base * ridge[..., None] * np.ones_like(u)[..., None]
        # Worn pale blue-grey at the hinge, brownish periostracum in places.
        worn = smoothstep(0.32, 0.05, u) * (0.5 + 0.5 * fbm(2 * S, 2 * S, int(rng.integers(0, 1e6)), scale=8, octaves=2))
        alb = alb * (1 - worn[..., None]) + np.array([0.42, 0.46, 0.55], np.float32) * worn[..., None]
        brown = 0.35 * smoothstep(0.55, 0.75, fbm(2 * S, 2 * S, int(rng.integers(0, 1e6)), scale=14, octaves=2))
        alb = alb * (1 - brown[..., None]) + np.array([0.2, 0.15, 0.07], np.float32) * brown[..., None]
        # Shell edge at the back, violet.
        rim = smoothstep(0.85, 1.0, k) * smoothstep(0.5, 0.9, u)
        alb = alb * (1 - 0.5 * rim[..., None]) + np.array([0.22, 0.18, 0.3], np.float32) * 0.5 * rim[..., None]
        box = (x0, y0, 2 * S, 2 * S)
        paint_patch(F, box, m, alb, hh, "california-mussel", wet=1.0, soft=0.6)
        cover[y0:y0 + 2 * S, x0:x0 + 2 * S] = np.maximum(cover[y0:y0 + 2 * S, x0:x0 + 2 * S], m)
        placed += 1
    return cover


def anemone_carpet(F, density, rng, count=900):
    """Aggregating anemones closed at low tide: soft green-grey domes packed
    together, coated in bits of shell and gravel."""
    ys, xs = np.nonzero(density > 0.05)
    if not len(xs):
        return
    grav = tex("ganges_river_pebbles")
    placed = 0
    for i in rng.permutation(len(xs))[: count * 5]:
        if placed >= count:
            break
        cx, cy = int(xs[i]), int(ys[i])
        if rng.random() > density[cy, cx]:
            continue
        r = rng.uniform(11, 22)
        S = int(r) + 3
        x0, y0 = cx - S, cy - S
        if x0 < 0 or y0 < 0 or x0 + 2 * S > W or y0 + 2 * S > H:
            continue
        yy, xx = np.mgrid[-S:S, -S:S].astype(np.float32)
        ang = np.arctan2(yy, xx)
        d = np.hypot(xx, yy) / (r * (1 + 0.08 * np.sin(ang * 5 + rng.random() * 6)))
        m = d < 1
        dom = np.sqrt(np.clip(1 - d ** 2, 0, 1))
        gx, gy = int(rng.integers(0, grav.shape[1] - 2 * S)), int(rng.integers(0, grav.shape[0] - 2 * S))
        bits = cv2.resize(grav[gy:gy + S, gx:gx + S], (2 * S, 2 * S))
        body = np.array([0.36, 0.44, 0.3], np.float32) * rng.uniform(0.8, 1.15)
        coat = smoothstep(0.35, 0.9, d)[..., None] * 0.75
        alb = body * (1 - coat) + bits * 1.1 * coat
        alb = alb * (1 - 0.6 * (d < 0.18)[..., None])  # the closed mouth
        hh = F.h[y0:y0 + 2 * S, x0:x0 + 2 * S] + dom * r * 0.7
        paint_patch(F, (x0, y0, 2 * S, 2 * S), m, alb, hh, "aggregating-anemone", wet=1.0, soft=0.7)
        placed += 1


def crack(F, x, y, ang, length, rng, width=14, depth=40):
    path = wavy_path(x, y, ang, length, rng, step=6, curl=0.12)
    wv = (width * (0.4 + 0.6 * np.sin(np.linspace(0, np.pi, len(path))) ** 0.5)).astype(np.float32)
    box = clip_box(path, width + 4)
    d, r, pos = centreline_field(path, wv / 2, box)
    m = d < r
    x0, y0, w, h = box
    reg = (slice(y0, y0 + h), slice(x0, x0 + w))
    k = np.clip(d / np.maximum(r, 1), 0, 1)
    F.h[reg] = np.where(m, F.h[reg] - depth * (1 - k ** 2), F.h[reg])
    F.alb[reg] = np.where(m[..., None], F.alb[reg] * (0.5 + 0.45 * k[..., None]), F.alb[reg])
    F.wet[reg] = np.maximum(F.wet[reg], m)
    return path


# =================================================================== beaches
def build_cobble():
    """Cobble beach: rounded stones of every size, packed on pebbles and sand."""
    F = Field("cobble", "Cobble beach", pxcm=20, seed=31)
    rng = F.rng
    F.lay(np.ones((H, W), bool), "ganges_river_pebbles", 0.48, gain=1.1, soft=0)
    coarse = smoothstep(0.48, 0.62, fbm(W, H, 2, scale=380))
    F.lay(coarse, "ganges_river_pebbles", 0.8, 700, 300, gain=1.12, soft=6)
    F.lab[:] = LID["gravel"]
    F.wet[:] = 0.7
    pud = fill(blob(560, 1180, 330, 170, 77, wob=0.16, rot=-0.15))
    # Fixed cobbles sit low, sunk in the pebbles; the big loose ones sit on
    # top, so you can tell which will turn.
    stones = []
    tries = 0
    while len(stones) < 130 and tries < 8000:
        tries += 1
        loose = len(stones) < 22
        r = float(rng.uniform(100, 175)) if loose else float(np.clip(rng.lognormal(math.log(58), 0.35), 30, 92))
        x, y = rng.uniform(r * 0.6, W - r * 0.6), rng.uniform(r * 0.6, H - r * 0.6)
        if loose and (x < r + 20 or y < r + 20 or x > W - r - 20 or y > H - r - 20):
            continue
        if pud[int(np.clip(y, 0, H - 1)), int(np.clip(x, 0, W - 1))]:
            continue
        if any(math.hypot(x - sx, y - sy) < (r + sr) * (1.3 if loose or l else 0.98) for sx, sy, sr, _, _, l in stones):
            continue
        stones.append((x, y, r, rng.uniform(0.62, 0.95), rng.uniform(0, math.pi), loose))
    blocked = pud.copy()
    sunk = np.zeros((H, W), bool)
    for i, (x, y, r, sq, rot, loose) in enumerate(stones):
        if loose:
            continue
        roll = rng.random()
        m = stone(F, x, y, r, sq, rot, F.seed * 300 + i, hk=0.38, barn=0.9 if roll < 0.25 else 0, film=0.9 if 0.25 <= roll < 0.5 else 0)
        blocked |= m
        sunk |= m
        if r > 55:
            F.slot("stone", x + rng.uniform(-0.25, 0.25) * r, y + rng.uniform(-0.25, 0.25) * r * sq, r * 0.6)
    # Pebbles lapping over the edges of the sunk cobbles.
    edge = sunk & (clearance(sunk) < 9 + 8 * fbm(W, H, 41, scale=20, octaves=2))
    F.lay(edge.astype(np.float32) * smoothstep(0.35, 0.6, fbm(W, H, 42, scale=14, octaves=2)), "ganges_river_pebbles", 0.48, gain=1.05, soft=1.5)
    F.lab[edge] = LID["gravel"]
    pool_floor(F, pud, np.clip(clearance(pud) / 70, 0, 1) * 0.55, 91, pebbles=0.9, coralline=0.15, film=0.6, rock="rock_surface", rock_gain=1.0)
    wet_rim(F, pud, 30)
    for k, (x, y, r, sq, rot, _) in enumerate(s for s in stones if s[5]):
        add_rock(F, x, y, r, r * sq, rot, k, blocked, barn=0.6 if k % 3 == 0 else 0, film=0.6 if k % 3 == 1 else 0)
    gaps = (F.lab == LID["gravel"]) & ~pud
    free_slots(F, "gap", clearance(gaps) > 28, 40, spacing=90)
    free_slots(F, "puddle", clearance(pud) > 40, 12, spacing=90)
    finish(F)


def build_potholes():
    """Potholes: a sandstone bench pitted with small round pools."""
    F = Field("potholes", "Potholes", pxcm=20, seed=47)
    rng = F.rng
    F.lay(np.ones((H, W), bool), "sandstone_cracks", 0.9, gain=1.05, soft=0)
    F.h += fbm(W, H, 6, scale=500, octaves=4) * 60
    F.lab[:] = LID["sandstone"]
    F.wet[:] = 0.35
    pools = []
    tries = 0
    while len(pools) < 30 and tries < 4000:
        tries += 1
        r = float(np.clip(rng.lognormal(math.log(85), 0.45), 40, 230))
        x, y = rng.uniform(r + 30, W - r - 30), rng.uniform(r + 30, H - r - 30)
        if any(math.hypot(x - px, y - py) < (r + pr) + 34 for px, py, pr, *_ in pools):
            continue
        pools.append((x, y, r, rng.uniform(0.78, 1.0), rng.uniform(0, math.pi)))
    allp = np.zeros((H, W), bool)
    depth = np.zeros((H, W), np.float32)
    info = []
    for j, (x, y, r, sq, rot) in enumerate(pools):
        m = fill(blob(x, y, r, r * sq, F.seed * 50 + j, wob=0.06, rot=rot))
        dpt = np.clip(clearance(m) / (r * 0.55), 0, 1) ** 0.7 * np.clip(r / 200, 0.35, 1)
        depth = np.maximum(depth, dpt * m)
        allp |= m
        info.append([round(x, 1), round(y, 1), round(r, 1)])
    pool_floor(F, allp, depth, 61, pebbles=0.95, coralline=0.12, film=0.8, rock="sandstone_cracks", rock_gain=0.95, carve=55, peb_scale=0.55)
    wet_rim(F, allp, 34, 0.4)
    F.h += smoothstep(40, 0, clearance(~allp)) * (~allp) * 10
    bench = ~allp & (clearance(~allp) > 40)
    near_pool = smoothstep(160, 50, clearance(~allp))
    dens = smoothstep(0.64, 0.7, fbm(W, H, 8, scale=90, octaves=4)) * bench * near_pool
    stamp_barnacles(F, dens, rng, count=9000, rmean=5.2, rsd=1.2)
    g = smoothstep(0.6, 0.74, fbm(W, H, 9, scale=110, octaves=4)) * (~allp)
    F.alb = F.alb * (1 - 0.5 * g[..., None]) + np.array([0.32, 0.46, 0.17], np.float32) * 0.5 * g[..., None]
    F.lab[(g > 0.4) & ~allp] = LID["film"]
    blocked = allp.copy()
    bench_clear = clearance(~(cv2.dilate(allp.astype(np.uint8), np.ones((31, 31), np.uint8)) > 0))
    placed = 0
    for _ in range(800):
        if placed >= 11:
            break
        rr = float(rng.uniform(52, 108))
        x, y = rng.uniform(80, W - 80), rng.uniform(80, H - 80)
        if bench_clear[int(y), int(x)] < rr * 1.15:
            continue
        if any(math.hypot(x - o["cx"], y - o["cy"]) < (rr + o["rx"]) * 1.6 for o in F.rocks):
            continue
        add_rock(F, x, y, rr, rr * rng.uniform(0.65, 0.9), rng.uniform(0, math.pi), [0, 2, 3][placed % 3], blocked,
                 barn=0.4 if placed % 4 == 0 else 0, wob=0.13)
        blocked |= fill(blob(x, y, rr * 1.1, rr * 1.1, 1))
        placed += 1
    for x, y, r in info:
        for _ in range(3 if r > 110 else 1):
            a, d = rng.uniform(0, 2 * math.pi), rng.uniform(0, 0.45) * r
            F.slot("pothole", x + math.cos(a) * d, y + math.sin(a) * d, r * 0.55)
    free_slots(F, "bench", (~blocked) & (bench_clear > 40), 30, spacing=110)
    F.extra["pools"] = info
    finish(F)



def build_boulder():
    """The big boulder: one huge rock on gravel beside a pool, with the big
    animals under it, and a few smaller rocks around."""
    F = Field("boulder", "The big boulder", pxcm=20, seed=59)
    rng = F.rng
    F.lay(np.ones((H, W), bool), "low_tide_rocks", 0.8, gain=1.2, soft=0)
    F.lay(smoothstep(0.5, 0.62, fbm(W, H, 3, scale=300)), "ganges_river_pebbles", 0.55, 300, 200, gain=1.1, soft=4)
    F.lab[:] = LID["gravel"]
    F.wet[:] = 0.6
    pool = fill(blob(560, 900, 470, 420, 7, wob=0.12, rot=0.4))
    pool &= ~fill(blob(980, 760, 300, 260, 8))  # the boulder's foot sits at its edge
    depth = np.clip(clearance(pool) / 160, 0, 1) ** 0.8
    pool_floor(F, pool, depth, 71, pebbles=0.6, coralline=0.7, film=0.4, rock="seaside_rock")
    wet_rim(F, pool, 34)
    blocked = pool.copy()
    for j in range(26):
        r = rng.uniform(40, 110)
        x, y = rng.uniform(80, W - 80), rng.uniform(80, H - 80)
        if pool[int(y), int(x)] or math.hypot(x - 1000, y - 740) < 520 or math.hypot(x - 1750, y - 760) < 520:
            continue
        m = stone(F, x, y, r, rng.uniform(0.65, 0.95), rng.uniform(0, 3), F.seed * 40 + j, barn=0.8 if j % 3 == 0 else 0, film=0.8 if j % 4 == 1 else 0)
        blocked |= m
    # The boulder, heavy enough to take three heaves. It tips to the right.
    add_rock(F, 1000, 740, 360, 290, 0.15, 2, blocked | fill(blob(300, 750, 320, 600, 1)), barn=0.8, film=0.5, heavy=3, wob=0.08, thick=260)
    for k, (x, y, r) in enumerate([(1980, 260, 120), (1880, 1270, 110), (300, 1330, 95)]):
        if pool[int(y), int(x)]:
            continue
        add_rock(F, x, y, r, r * rng.uniform(0.7, 0.9), rng.uniform(0, 3), k + 1, blocked, barn=0.5 if k == 0 else 0)
    free_slots(F, "pool", clearance(pool) > 50, 30, spacing=110)
    free_slots(F, "gravel", (~blocked) & (clearance(~blocked) > 40), 30, spacing=120)
    finish(F)


def build_sand():
    """Sandy beach: rippled wet sand, half-buried rocks, a runnel of water and
    a wrack line of washed-up bull kelp and eelgrass."""
    F = Field("sand", "Sandy beach", pxcm=20, seed=73)
    rng = F.rng
    F.lay(np.ones((H, W), bool), "damp_beach_sand", 0.9, gain=1.2, tint=(1.04, 1.0, 0.92), soft=0)
    _, rip_n, rip_d = material("aerial_beach_01", W, H, 2.6, 300, 900)
    F.h += (rip_d - 0.5) * 34
    F.alb *= (0.94 + 0.12 * rip_d)[..., None]
    dry = smoothstep(0.3, 0.0, F.yy / H)  # drier at the top, where the tide left first
    F.alb *= (0.86 + 0.2 * dry)[..., None]
    F.lab[:] = LID["sand"]
    F.wet[:] = 0.75 - 0.5 * dry
    # A runnel draining across the lower beach.
    run = wavy_path(-40, 1180, -0.08, 2600, rng, step=10, curl=0.02)
    rw = (np.full(len(run), 110) + 40 * np.sin(np.linspace(0, 6, len(run)))).astype(np.float32)
    d, r, _ = centreline_field(run, rw / 2, (0, 0, W, H))
    runnel = d < r
    depth = np.clip((r - d) / np.maximum(r, 1), 0, 1) ** 0.6 * 0.35 * runnel
    F.h -= depth * 40
    F.water = np.maximum(F.water, depth)
    F.lab[runnel] = LID["water"]
    wet_rim(F, runnel, 50, 0.25)
    # The wrack line along the top: bull kelp, eelgrass and shells.
    bull_kelp(F, -60, 300, 0.1, rng, length=1250)
    for x in (700, 1300, 1900):
        eelgrass(F, x, 380 + rng.uniform(-60, 60), rng, n=10)
    shells(F, (F.lab == LID["sand"]) & (F.yy < 900), rng, n=22)
    # Half-buried rocks.
    blocked = runnel | (F.lab != LID["sand"])
    blocked = cv2.dilate(blocked.astype(np.uint8), np.ones((25, 25), np.uint8)) > 0
    placed = 0
    for _ in range(900):
        if placed >= 9:
            break
        r = rng.uniform(70, 150)
        x, y = rng.uniform(150, W - 150), rng.uniform(550, H - 120)
        if blocked[int(y), int(x)] or any(math.hypot(x - o["cx"], y - o["cy"]) < (r + o["rx"]) * 1.8 for o in F.rocks):
            continue
        add_rock(F, x, y, r, r * rng.uniform(0.62, 0.9), rng.uniform(0, 3), placed, blocked, barn=0.4 if placed % 3 == 0 else 0, film=0.5 if placed % 3 == 1 else 0, thick=r * 0.35)
        blocked |= fill(blob(x, y, r * 1.3, r * 1.3, 2))
        placed += 1
    free_slots(F, "sand", (F.lab == LID["sand"]) & (clearance(~blocked) > 40) & (F.yy > 520), 30, spacing=140)
    free_slots(F, "runnel", clearance(runnel) > 22, 14, spacing=150)
    free_slots(F, "wrack", (F.lab == LID["bull-kelp"]) | (F.lab == LID["eelgrass"]), 12, spacing=160)
    finish(F)


def build_bench():
    """Mussel bench: open basalt with a mussel bed, a barnacle band, cracks
    full of gooseneck barnacles, a carpet of aggregating anemones and a pool."""
    F = Field("bench", "Mussel bench", pxcm=20, seed=83)
    rng = F.rng
    F.lay(np.ones((H, W), bool), "dark_rock", 0.7, gain=1.9, soft=0)
    F.lay(smoothstep(0.45, 0.65, fbm(W, H, 4, scale=500)), "dark_rock_02", 0.7, 600, 300, gain=1.8, soft=8)
    F.h += fbm(W, H, 5, scale=600, octaves=4) * 90
    F.lab[:] = LID["rock"]
    F.wet[:] = 0.55
    cracks = [crack(F, 1500, 0, 1.75, 1200, rng, width=34, depth=70), crack(F, 0, 620, 0.1, 900, rng, width=26),
              crack(F, 2400, 1100, 3.4, 800, rng, width=28)]
    for c in cracks:
        for k in range(8, len(c) - 8, 26):
            F.slot("crack", c[k, 0], c[k, 1])
    pool = fill(blob(1880, 420, 330, 230, 11, wob=0.14, rot=-0.3))
    depth = np.clip(clearance(pool) / 120, 0, 1)
    pool_floor(F, pool, depth, 93, pebbles=0.3, coralline=0.8, film=0.5, rock="dark_rock_02", rock_gain=1.7)
    wet_rim(F, pool, 26)
    # Mussel bed down the left, the barnacle band above it, anemones in the hollow.
    bed = smoothstep(0.42, 0.5, fbm(W, H, 12, scale=360, octaves=4)) * smoothstep(1300, 900, F.xx) * (~pool)
    bed = cv2.GaussianBlur(bed.astype(np.float32), (0, 0), 6)
    mussel_bed(F, np.clip(bed * 1.6, 0, 1), rng, count=1300, lmin=100, lmax=220)
    band = smoothstep(0.1, 0.4, cv2.GaussianBlur((bed > 0.3).astype(np.float32), (0, 0), 70)) * (bed < 0.25) * (~pool)
    stamp_barnacles(F, band * 0.95, rng, count=16000, rmean=5.6, rsd=1.5)
    hollow = fill(blob(1700, 1150, 360, 210, 13, wob=0.15, rot=0.2)) & ~pool
    F.h -= cv2.GaussianBlur(hollow.astype(np.float32), (0, 0), 30) * 40
    anemone_carpet(F, hollow.astype(np.float32) * 0.95, rng, count=1100)
    # Slots.
    edge = (bed > 0.08) & (bed < 0.3)
    free_slots(F, "bed-edge", edge, 24, spacing=130)
    free_slots(F, "pool", clearance(pool) > 45, 14, spacing=100)
    open_rock = (F.lab == LID["rock"]) & (clearance(F.lab == LID["rock"]) > 30)
    free_slots(F, "rock", open_rock, 30, spacing=140)
    finish(F)


def build_channel():
    """Surge channel: a gut of water between two benches, its floor crowded
    with seaweed the toy draws and sways. Brush it aside to look under."""
    F = Field("channel", "Surge channel", pxcm=20, seed=97)
    rng = F.rng
    F.lay(np.ones((H, W), bool), "dark_rock_02", 0.75, gain=1.8, soft=0)
    F.h += fbm(W, H, 2, scale=500, octaves=4) * 70
    F.lab[:] = LID["rock"]
    F.wet[:] = 0.8
    # The channel runs top to bottom, wider at the bottom where the sea is.
    left = wavy_path(560, -40, math.pi / 2 + 0.06, 1600, rng, step=10, curl=0.03)
    right = wavy_path(1720, -40, math.pi / 2 - 0.1, 1600, rng, step=10, curl=0.03)
    poly = np.concatenate([left, right[::-1]])
    jit = cv2.GaussianBlur(rng.standard_normal((len(poly), 2)).astype(np.float32), (1, 9), 3) * 26
    poly = poly + jit
    chan = fill(poly)
    depth = np.clip(clearance(chan) / 260, 0, 1) ** 0.7 * (0.6 + 0.4 * smoothstep(0, H, F.yy))
    pool_floor(F, chan, depth, 101, pebbles=0.5, coralline=0.9, film=0.3, rock="seaside_rock", carve=220)
    wet_rim(F, chan, 40, 0.3)
    # Boulders on the floor.
    for j in range(9):
        x, y = rng.uniform(700, 1600), rng.uniform(100, 1400)
        if clearance(chan)[int(y), int(x)] < 120:
            continue
        m = stone(F, x, y, rng.uniform(60, 120), rng.uniform(0.7, 0.95), rng.uniform(0, 3), F.seed * 70 + j, skin=3, hk=0.5)
        F.lab[m] = LID["water"]
        F.slot("boulder", x, y)
    # Barnacles and a fringe of pink coralline turf on the benches at the edge.
    out = clearance(~chan)
    stamp_barnacles(F, smoothstep(220, 90, out) * (~chan) * smoothstep(0.45, 0.6, fbm(W, H, 7, scale=90)), rng, count=12000)
    # Seaweed anchors for the toy, by kind.
    cl = clearance(chan)
    for kind, n, lo, hi in (("surfgrass", 4, 10, 110), ("kelp", 3, 140, 900), ("sea-lettuce", 4, 80, 900), ("rockweed", 5, -1, -1)):
        k = 0
        for _ in range(4000):
            if k >= n:
                break
            x, y = rng.uniform(80, W - 80), rng.uniform(80, H - 80)
            c = cl[int(y), int(x)]
            if kind == "rockweed":
                if chan[int(y), int(x)] or out[int(y), int(x)] > 90:
                    continue
            elif not (lo < c < hi):
                continue
            if any(math.hypot(x - w["x"], y - w["y"]) < 300 for w in F.weeds):
                continue
            # Rockweed on the bench edge hangs toward the water.
            cx_ = float(np.mean(np.nonzero(chan[int(y)])[0])) if chan[int(y)].any() else W / 2
            F.weeds.append(dict(kind=kind, x=round(x, 1), y=round(y, 1), seed=int(rng.integers(0, 1e6)), toward=round(math.atan2(0, cx_ - x), 3)))
            k += 1
    free_slots(F, "floor", cl > 60, 40, spacing=110)
    free_slots(F, "ledge", (~chan) & (out < 90) & (out > 20), 16, spacing=140)
    F.extra["flow"] = [0.0, 1.0]  # the surge runs up and down the channel
    finish(F)


def build_weed_textures():
    """Blade textures the toy bends along a path, one strip per kind."""
    out = OUT / "weeds"
    out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(5)
    specs = {
        "surfgrass": (24, 512, (0.16, 0.46, 0.14), 0.08, 0.02),
        "kelp": (96, 768, (0.42, 0.32, 0.12), 0.2, 0.06),
        "rockweed": (40, 384, (0.42, 0.36, 0.16), 0.1, 0.02),
    }
    for name, (w, h, col, ruffle, streak) in specs.items():
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        t = yy / h
        half = (w / 2 - 2) * (0.6 + 0.4 * np.clip(np.sin(np.pi * np.clip(t * 1.05, 0, 1)), 0, None) ** 0.4)
        half *= 1 + ruffle * np.sin(t * 70 + 2 * np.sin(t * 9)) * (0.3 + 0.7 * t)
        if name == "rockweed":
            half *= 1 + 0.6 * smoothstep(0.82, 0.9, t) * smoothstep(1.0, 0.92, t)  # swollen tips
        k = np.abs(xx - w / 2) / np.maximum(half, 1)
        a = np.clip((1 - k) * half * 0.6, 0, 1) * smoothstep(1.0, 0.97, t)
        midrib = np.exp(-((xx - w / 2) / (w * 0.04)) ** 2) * (0.25 if name != "surfgrass" else 0.12)
        tone = 1 + streak * (fbm(w, h, int(rng.integers(0, 1e6)), scale=6, octaves=2) - 0.5) * 4
        shade = 0.82 + 0.3 * np.sqrt(np.clip(1 - k ** 2, 0, 1))
        rgb = np.array(col, np.float32) * (tone * shade)[..., None] * (1 - 0.25 * t)[..., None]
        rgb += midrib[..., None] * np.array(col, np.float32)
        if name == "kelp":  # bullate puckers
            pk = fbm(w, h, int(rng.integers(0, 1e6)), scale=10, octaves=2)
            rgb *= (0.85 + 0.3 * pk)[..., None]
        Image.fromarray((np.dstack([np.clip(rgb, 0, 1), a]) * 255).astype(np.uint8), "RGBA").save(out / f"{name}.webp", "WEBP", quality=90, method=6)
    # Sea lettuce: whole ruffled sheets, translucent.
    for j in range(3):
        S = 320
        yy, xx = np.mgrid[0:S, 0:S].astype(np.float32) - S / 2
        ang = np.arctan2(yy, xx)
        r = (0.38 + 0.08 * np.sin(ang * 3 + j) + 0.04 * np.sin(ang * 9 + 2 * j) + 0.02 * np.sin(ang * 23 + j)) * S
        d = np.hypot(xx, yy) / r
        fold = fbm(S, S, 30 + j, scale=40, octaves=4)
        a = np.clip((1 - d) * 40, 0, 1) * (0.55 + 0.25 * fold)
        rgb = np.array([0.34, 0.56, 0.2], np.float32) * (0.75 + 0.45 * fold)[..., None]
        edge = smoothstep(0.82, 1.0, d)
        rgb = rgb * (1 - 0.3 * edge[..., None]) + np.array([0.62, 0.86, 0.42], np.float32) * 0.3 * edge[..., None]
        Image.fromarray((np.dstack([np.clip(rgb, 0, 1), a]) * 255).astype(np.uint8), "RGBA").save(out / f"sea-lettuce-{j}.webp", "WEBP", quality=90, method=6)
    print("weeds", sorted(p.name for p in out.iterdir()))


BUILD = {"cobble": build_cobble, "potholes": build_potholes, "boulder": build_boulder, "sand": build_sand,
         "bench": build_bench, "channel": build_channel, "weeds": build_weed_textures}

if __name__ == "__main__":
    for n in sys.argv[1:] or list(BUILD):
        BUILD[n]()
