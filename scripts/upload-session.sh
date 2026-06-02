#!/usr/bin/env bash
#
# Upload a single session folder from staging/ to the originals/ container in
# Azure Blob Storage. Optionally trigger a build afterward.
#
# Usage:
#   ./scripts/upload-session.sh <session-folder> [--build] [--yes]
#
# Examples:
#   ./scripts/upload-session.sh 2026-mexico
#   ./scripts/upload-session.sh 2026-mexico --build
#   ./scripts/upload-session.sh 2026-mexico --yes        # skip confirmation

set -euo pipefail

# --- config: edit if your storage account or repo changes
STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-stphotoprodnowiur}"
CONTAINER="originals"
GH_REPO="TrumanBrown/photography-website"
# ---

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STAGING_DIR="$ROOT/staging"

# Accepted extensions (lowercase). Anything else gets stripped from the upload.
ACCEPTED='*.jpg;*.jpeg;*.png;*.webp;*.avif;*.tif;*.tiff;*.heic;*.heif;*.arw;*.nef;*.cr2;*.cr3;*.dng;*.raf;_session.json'
EXCLUDE='.DS_Store;Thumbs.db;*.tmp;*.lrcat;*.xmp'

session=""
trigger_build=false
auto_yes=false
for arg in "$@"; do
  case "$arg" in
    --build) trigger_build=true ;;
    --yes|-y) auto_yes=true ;;
    --help|-h)
      head -n 12 "$0" | tail -n 11
      exit 0
      ;;
    -*)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
    *)
      if [ -z "$session" ]; then
        session="$arg"
      else
        echo "Multiple session names given: '$session' and '$arg'" >&2
        exit 2
      fi
      ;;
  esac
done

if [ -z "$session" ]; then
  echo "Usage: $0 <session-folder> [--build] [--yes]" >&2
  echo
  echo "Sessions available under staging/:" >&2
  if [ -d "$STAGING_DIR" ]; then
    find "$STAGING_DIR" -maxdepth 1 -mindepth 1 -type d -printf "  %f\n" 2>&1 | sort >&2 || true
  fi
  exit 2
fi

SRC="$STAGING_DIR/$session"
if [ ! -d "$SRC" ]; then
  echo "No such folder: $SRC" >&2
  exit 1
fi

# Sanity-check Azure auth before doing anything destructive.
if ! az account show >/dev/null 2>&1; then
  echo "az not logged in. Run: az login --use-device-code" >&2
  exit 1
fi

# Count files that would actually be uploaded (matches ACCEPTED extensions).
echo "Scanning $SRC..."
file_count=$(find "$SRC" -maxdepth 1 -type f \( \
  -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \
  -o -iname "*.avif" -o -iname "*.tif" -o -iname "*.tiff" \
  -o -iname "*.heic" -o -iname "*.heif" \
  -o -iname "*.arw" -o -iname "*.nef" -o -iname "*.cr2" -o -iname "*.cr3" \
  -o -iname "*.dng" -o -iname "*.raf" \
  -o -iname "_session.json" \
\) | wc -l)
total_bytes=$(du -sb "$SRC" 2>/dev/null | awk '{print $1}' || echo 0)
hr_size=$(numfmt --to=iec --suffix=B "$total_bytes" 2>/dev/null || echo "${total_bytes}B")

echo
echo "About to upload:"
echo "  Source:      $SRC"
echo "  Destination: https://${STORAGE_ACCOUNT}.blob.core.windows.net/${CONTAINER}/${session}/"
echo "  Files:       $file_count (filtered to accepted extensions)"
echo "  Total size:  $hr_size"
if [ "$trigger_build" = true ]; then
  echo "  After:       trigger Build and Deploy workflow"
fi
echo

if [ "$file_count" -eq 0 ]; then
  echo "Nothing to upload (no accepted file types in this folder)." >&2
  exit 1
fi

if [ "$auto_yes" != true ]; then
  read -r -p "Proceed? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

echo "Uploading..."
az storage blob upload-batch \
  --account-name "$STORAGE_ACCOUNT" \
  --auth-mode login \
  --destination "$CONTAINER" \
  --destination-path "$session" \
  --source "$SRC" \
  --pattern "{*.jpg,*.jpeg,*.png,*.webp,*.avif,*.tif,*.tiff,*.heic,*.heif,*.JPG,*.JPEG,*.PNG,*.WEBP,*.AVIF,*.TIF,*.TIFF,*.HEIC,*.HEIF,*.arw,*.nef,*.cr2,*.cr3,*.dng,*.raf,*.ARW,*.NEF,*.CR2,*.CR3,*.DNG,*.RAF,_session.json}" \
  --overwrite true \
  --output none

echo "Upload complete."

if [ "$trigger_build" = true ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "gh not installed; cannot trigger build automatically." >&2
    echo "Go to https://github.com/$GH_REPO/actions/workflows/build-and-deploy.yml and click 'Run workflow'."
    exit 0
  fi
  if ! gh auth status >/dev/null 2>&1; then
    echo "gh not logged in. Skipping auto-trigger." >&2
    exit 0
  fi
  echo "Triggering Build and Deploy workflow..."
  gh workflow run build-and-deploy.yml --repo "$GH_REPO"
  sleep 3
  RUN=$(gh run list --repo "$GH_REPO" --workflow=build-and-deploy.yml --limit=1 --json databaseId --jq '.[0].databaseId')
  echo
  echo "Watch progress:"
  echo "  https://github.com/$GH_REPO/actions/runs/$RUN"
  echo
  echo "Live site: https://trumanbrown.com"
else
  echo
  echo "The next build will pick this up. Either:"
  echo "  - wait up to ~1 hour for the cron"
  echo "  - run '$0 $session --build' next time"
  echo "  - or go to https://github.com/$GH_REPO/actions/workflows/build-and-deploy.yml and click 'Run workflow'"
fi
