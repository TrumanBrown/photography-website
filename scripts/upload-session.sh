#!/usr/bin/env bash
#
# Upload session folders from staging/ to the originals/ container in Azure
# Blob Storage. Optionally trigger a build afterward.
#
# Usage:
#   ./scripts/upload-session.sh <session-folder>... [--build] [--yes]
#   ./scripts/upload-session.sh --all [--build] [--yes]
#
# Examples:
#   ./scripts/upload-session.sh 2026-mexico
#   ./scripts/upload-session.sh 2026-mexico tidepools-spring-2026
#   ./scripts/upload-session.sh --all --build
#   ./scripts/upload-session.sh --all --yes              # skip confirmation
#
# --all uploads every direct child folder of staging/, except hobby-* folders,
# names listed in UPLOAD_SKIP_DIRS, and folders with no accepted image files.

set -euo pipefail

# Print the comment header above as usage text.
usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
}

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

# --- config: environment and .env can override these values
STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-stphotoprodnowiur}"
CONTAINER="originals"
GH_REPO="${GITHUB_REPOSITORY:-TrumanBrown/photography-website}"
# Space-separated staging folders that --all must never treat as a session.
SKIP_DIRS="${UPLOAD_SKIP_DIRS:-fishing}"
# ---

# Extension filter shared by every scan below (case-insensitive).
IMAGE_EXPR=( '(' -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.webp' \
  -o -iname '*.avif' -o -iname '*.tif' -o -iname '*.tiff' \
  -o -iname '*.heic' -o -iname '*.heif' \
  -o -iname '*.arw' -o -iname '*.nef' -o -iname '*.cr2' -o -iname '*.cr3' \
  -o -iname '*.dng' -o -iname '*.raf' ')' )

list_images() {
  find "$1" -maxdepth 1 -type f "${IMAGE_EXPR[@]}"
}

list_uploadable() {
  find "$1" -maxdepth 1 -type f '(' "${IMAGE_EXPR[@]}" -o -iname '_session.json' ')'
}

human_size() {
  numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "${1}B"
}

# True for staging folders that hold hobby media or converted source photos
# rather than a photography session.
is_skipped() {
  case "$1" in
    hobby-*) return 0 ;;
  esac
  for skip in $SKIP_DIRS; do
    if [ "$1" = "$skip" ]; then return 0; fi
  done
  return 1
}

sessions=()
trigger_build=false
auto_yes=false
upload_all=false
for arg in "$@"; do
  case "$arg" in
    --all) upload_all=true ;;
    --build) trigger_build=true ;;
    --yes|-y) auto_yes=true ;;
    --help|-h)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown flag: $arg" >&2
      exit 2
      ;;
    *)
      sessions+=("$arg")
      ;;
  esac
done

if [ "$upload_all" = true ] && [ "${#sessions[@]}" -gt 0 ]; then
  echo "--all cannot be combined with session names." >&2
  exit 2
fi

if [ "$upload_all" != true ] && [ "${#sessions[@]}" -eq 0 ]; then
  echo "Usage: $0 <session-folder>... [--build] [--yes]" >&2
  echo "       $0 --all [--build] [--yes]" >&2
  echo >&2
  echo "Sessions available under staging/:" >&2
  if [ -d "$STAGING_DIR" ]; then
    find "$STAGING_DIR" -maxdepth 1 -mindepth 1 -type d -printf "  %f\n" 2>&1 | sort >&2 || true
  fi
  exit 2
fi

if [ "$upload_all" = true ]; then
  if [ ! -d "$STAGING_DIR" ]; then
    echo "No such folder: $STAGING_DIR" >&2
    exit 1
  fi
  while IFS= read -r name; do
    if is_skipped "$name"; then
      echo "Skipping $name (not a photography session)"
      continue
    fi
    sessions+=("$name")
  done < <(find "$STAGING_DIR" -maxdepth 1 -mindepth 1 -type d -printf "%f\n" | sort)
  if [ "${#sessions[@]}" -eq 0 ]; then
    echo "No session folders to upload under $STAGING_DIR." >&2
    exit 1
  fi
fi

for session in "${sessions[@]}"; do
  if [[ "$session" == "." || "$session" == ".." || "$session" == *"/"* || "$session" == *"\\"* ]]; then
    echo "Session must be the name of one direct child folder under staging/: $session" >&2
    exit 2
  fi
  if [ ! -d "$STAGING_DIR/$session" ]; then
    echo "No such folder: $STAGING_DIR/$session" >&2
    exit 1
  fi
done

# Sanity-check Azure auth before doing anything destructive.
if ! az account show >/dev/null 2>&1; then
  echo "az not logged in. Run: az login --use-device-code" >&2
  exit 1
fi

# If a tenant is configured, ensure we're using it (handles multi-tenant machines).
if [ -n "${AZURE_TENANT_ID:-}" ]; then
  current_tenant=$(az account show --query tenantId -o tsv 2>/dev/null | tr -d '\r' || true)
  if [ "$current_tenant" != "$AZURE_TENANT_ID" ]; then
    echo "Switching to photography tenant ($AZURE_TENANT_ID)..."
    if ! az login --use-device-code --tenant "$AZURE_TENANT_ID" --output none; then
      echo "Failed to switch tenant." >&2
      exit 1
    fi
  fi
fi
if [ -n "${AZURE_SUBSCRIPTION_ID:-}" ]; then
  if ! az account set --subscription "$AZURE_SUBSCRIPTION_ID" 2>/dev/null; then
    echo "Could not select Azure subscription $AZURE_SUBSCRIPTION_ID." >&2
    exit 1
  fi
fi

# Count files that would actually be uploaded (matches ACCEPTED extensions).
echo "Scanning $STAGING_DIR..."
planned=()
planned_files=()
planned_size=()
total_files=0
total_bytes=0
for session in "${sessions[@]}"; do
  src="$STAGING_DIR/$session"
  image_count=$(list_images "$src" | wc -l)
  if [ "$image_count" -eq 0 ]; then
    if [ "$upload_all" = true ]; then
      echo "  Skipping $session (no accepted image files)"
      continue
    fi
    echo "Nothing to upload for $session (the session folder has no accepted image files)." >&2
    exit 1
  fi
  file_count=$(list_uploadable "$src" | wc -l)
  bytes=$(du -sb "$src" 2>/dev/null | awk '{print $1}' || echo 0)
  planned+=("$session")
  planned_files+=("$file_count")
  planned_size+=("$bytes")
  total_files=$((total_files + file_count))
  total_bytes=$((total_bytes + bytes))
done

if [ "${#planned[@]}" -eq 0 ]; then
  echo "Nothing to upload (no staging folder has accepted image files)." >&2
  exit 1
fi

echo
echo "About to upload ${#planned[@]} session(s):"
echo "  Destination: https://${STORAGE_ACCOUNT}.blob.core.windows.net/${CONTAINER}/"
for i in "${!planned[@]}"; do
  printf '    %-42s %5s files  %10s\n' "${planned[$i]}/" "${planned_files[$i]}" "$(human_size "${planned_size[$i]}")"
done
printf '    %-42s %5s files  %10s\n' "(total, filtered to accepted extensions)" "$total_files" "$(human_size "$total_bytes")"
if [ "$trigger_build" = true ]; then
  echo "  After:       trigger Build and Deploy workflow"
fi
echo

if [ "$auto_yes" != true ]; then
  read -r -p "Proceed? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 0 ;;
  esac
fi

# az storage blob upload-batch's --pattern doesn't support brace expansion,
# so we stage a file list with `find` (extension match is case-insensitive),
# then upload each. Single connection per file is plenty fast for personal
# session sizes and gives clear per-file output.
TMPLIST=$(mktemp)
trap 'rm -f "$TMPLIST"' EXIT

uploaded=0
failed=0
for session in "${planned[@]}"; do
  src="$STAGING_DIR/$session"
  echo
  echo "Uploading $session..."
  list_uploadable "$src" > "$TMPLIST"
  while IFS= read -r f <&3; do
    rel="${f#"$src/"}"
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
  done 3< "$TMPLIST"
done

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
  echo "  - re-run with --build next time"
  echo "  - or go to https://github.com/$GH_REPO/actions/workflows/build-and-deploy.yml and click 'Run workflow'"
fi
