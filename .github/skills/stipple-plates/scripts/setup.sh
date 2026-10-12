#!/usr/bin/env bash
# One-time setup for the stipple-plates skill: a private Python venv with the
# pinned imaging stack, outside the repo. Prints the interpreter to use.
set -euo pipefail

CACHE="${STIPPLE_CACHE:-$HOME/.cache/stipple-plates}"
VENV="$CACHE/venv"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$CACHE"

if [ ! -x "$VENV/bin/python" ] || ! "$VENV/bin/python" -m pip --version >/dev/null 2>&1; then
  rm -rf "$VENV"
  if ! python3 -m venv "$VENV" >/dev/null 2>&1; then
    # Ubuntu without python3-venv has no ensurepip, and installing it needs
    # sudo. Make a bare venv and bootstrap pip into it instead.
    rm -rf "$VENV"
    python3 -m venv --without-pip "$VENV"
    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o "$CACHE/get-pip.py"
    "$VENV/bin/python" "$CACHE/get-pip.py" --quiet
  fi
fi

"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet -r "$HERE/requirements.txt"
"$VENV/bin/python" -c "import cv2, numpy, scipy, rembg, onnxruntime" >/dev/null
echo "$VENV/bin/python"
