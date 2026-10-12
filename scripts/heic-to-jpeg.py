#!/usr/bin/env python3
"""
HEIC → JPEG (or lossless TIFF) converter for the prebuild pipeline.

Usage: heic-to-jpeg.py <input.heic> <output.jpg|output.tiff> [quality]

prebuild asks for a TIFF, which is lossless, and encodes the final JPEG itself,
so the photo is compressed exactly once on its way to the site.

Uses pillow-heif, which handles iPhone HDR HEIC (brands like tmap/MiHE/MiHB)
that older libheif versions in heif-convert / ImageMagick can't decode.

The image is auto-oriented (EXIF orientation tag applied) before saving so the
output JPEG has orientation=1 and renders correctly without browser-side
rotation.
"""
import sys
from pathlib import Path

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()


def main(argv: list[str]) -> int:
    if len(argv) not in (3, 4):
        print("usage: heic-to-jpeg.py <input> <output> [quality]", file=sys.stderr)
        return 2

    src = Path(argv[1])
    dst = Path(argv[2])
    quality = int(argv[3]) if len(argv) == 4 else 92

    if not src.exists():
        print(f"input not found: {src}", file=sys.stderr)
        return 1

    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode != "RGB":
            im = im.convert("RGB")
        if dst.suffix.lower() in (".tif", ".tiff"):
            im.save(dst, "TIFF")
        else:
            im.save(dst, "JPEG", quality=quality, optimize=True, progressive=True)

    print(f"converted {src} → {dst} ({im.size[0]}x{im.size[1]})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
