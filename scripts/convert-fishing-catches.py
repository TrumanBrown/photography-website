#!/usr/bin/env python3
"""Convert staging/fishing photos to upright, metadata-stripped web JPEGs.

Run: python3 scripts/convert-fishing-catches.py
Outputs src/assets/hobbies/fishing/<basename>.jpg (max 1600px, EXIF/GPS stripped).
"""
import os
from PIL import Image, ImageOps
import pillow_heif

pillow_heif.register_heif_opener()

SRC = "staging/fishing"
DST = "src/assets/hobbies/fishing"
MAX_SIDE = 1600
QUALITY = 82

os.makedirs(DST, exist_ok=True)

count = 0
for name in sorted(os.listdir(SRC)):
    path = os.path.join(SRC, name)
    if not os.path.isfile(path):
        continue
    base, ext = os.path.splitext(name)
    if ext.lower() not in (".heic", ".heif", ".jpg", ".jpeg", ".png", ".tif", ".tiff"):
        continue
    out = os.path.join(DST, base.lower() + ".jpg")
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)  # bake rotation
        im = im.convert("RGB")
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
        # save with no exif (drops GPS/camera metadata) and progressive encoding
        im.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    count += 1
    print(f"  {name} -> {os.path.basename(out)} ({im.width}x{im.height})")

print(f"converted {count} photos into {DST}")
