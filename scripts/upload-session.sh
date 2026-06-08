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

# Load local env (tenant, subscription, overrides). File is .gitignored.
if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ROOT/.env"
  set +a
fi

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

# If a tenant is configured, ensure we're using it (handles multi-tenant machines).
if [ -n "${AZURE_TENANT_ID:-}" ]; then
  current_tenant=$(az account show --query tenantId -o tsv 2>/dev/null || true)
  if [ "$current_tenant" != "$AZURE_TENANT_ID" ]; then
    echo "Switching to photography tenant ($AZURE_TENANT_ID)..."
    if ! az login --use-device-code --tenant "$AZURE_TENANT_ID" --output none; then
      echo "Failed to switch tenant." >&2
      exit 1
    fi
  fi
fi
if [ -n "${AZURE_SUBSCRIPTION_ID:-}" ]; then
  az account set --subscription "$AZURE_SUBSCRIPTION_ID" 2>/dev/null || true
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
# az storage blob upload-batch's --pattern doesn't support brace expansion,
# so we stage a file list with `find` (extension match is case-insensitive),
# then upload each. Single connection per file is plenty fast for personal
# session sizes and gives clear per-file output.
TMPLIST=$(mktemp)
trap 'rm -f "$TMPLIST"' EXIT
find "$SRC" -maxdepth 1 -type f \( \
  -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \
  -o -iname "*.avif" -o -iname "*.tif" -o -iname "*.tiff" \
  -o -iname "*.heic" -o -iname "*.heif" \
  -o -iname "*.arw" -o -iname "*.nef" -o -iname "*.cr2" -o -iname "*.cr3" \
  -o -iname "*.dng" -o -iname "*.raf" \
  -o -iname "_session.json" \
\) > "$TMPLIST"

uploaded=0
failed=0
while IFS= read -r f; do
  rel="${f#$SRC/}"
  echo "  → $rel"
  if az storage blob upload \
    --account-name "$STORAGE_ACCOUNT" \
    --auth-mode login \
    --container-name "$CONTAINER" \
    --name "$session/$rel" \
    --file "$f" \
    --overwrite true \
    --output none 2>/dev/null; then
    uploaded=$((uploaded + 1))
  else
    echo "    [FAILED] $rel" >&2
    failed=$((failed + 1))
  fi
done < "$TMPLIST"

echo
echo "Upload summary: $uploaded succeeded, $failed failed"
if [ "$failed" -gt 0 ]; then
  echo "Some files did not upload. Fix the errors above and re-run." >&2
  exit 1
fi
if [ "$uploaded" -eq 0 ]; then
  echo "Nothing was uploaded. Aborting." >&2
  exit 1
fi

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
