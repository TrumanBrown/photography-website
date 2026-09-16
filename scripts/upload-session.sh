#!/usr/bin/env bash
#
# Upload session folders from staging/ to the originals/ container in Azure
# Blob Storage. Optionally trigger a build afterward.
#
# Usage:
#   ./scripts/upload-session.sh <session>... [--build] [--yes]
#   ./scripts/upload-session.sh --all [--build] [--yes]
#
# A <session> is either a folder or a .zip under staging/ (give the name with or
# without the .zip). Examples:
#   ./scripts/upload-session.sh 2026-mexico
#   ./scripts/upload-session.sh costa-rica-tapir-valley-august-2026.zip
#   ./scripts/upload-session.sh 2026-mexico tidepools-spring-2026
#   ./scripts/upload-session.sh --all --build
#   ./scripts/upload-session.sh --all --yes              # skip confirmation
#
# --all uploads every direct child folder and top-level .zip of staging/, except
# hobby-* entries, names listed in UPLOAD_SKIP_DIRS, and anything with no
# accepted image files.
#
# Photos nested in subfolders (iCloud bulk downloads wrap everything in an
# "iCloud Photos" folder) are flattened into the session prefix, so the session
# name still supplies the location + date. Zips are unpacked to a scratch folder
# first; extraction is lossless and the original bytes are what get uploaded.
# Videos and other unsupported files are counted, reported, and left alone.

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

# macOS zips carry a __MACOSX tree and ._NAME resource-fork twins that would
# otherwise sail through the extension filter as tiny corrupt "images".
NOISE_EXPR=( -name '__MACOSX' -prune -o -type f '!' -name '._*' '!' -name '.DS_Store' )

# Each list_* takes one or more scan roots: the session folder plus a scratch
# folder per zip we unpacked for it.
list_images() {
  find "$@" "${NOISE_EXPR[@]}" "${IMAGE_EXPR[@]}" -print
}

list_sidecars() {
  find "$@" "${NOISE_EXPR[@]}" -iname '_session.json' -print
}

list_zips() {
  find "$@" "${NOISE_EXPR[@]}" -iname '*.zip' -print
}

# Everything we found but will not upload: videos, .aae edit sidecars, etc.
# Zips are excluded because they get unpacked rather than skipped.
list_skipped() {
  find "$@" "${NOISE_EXPR[@]}" '!' -iname '_session.json' '!' -iname '*.zip' '!' "${IMAGE_EXPR[@]}" -print
}

# Unpack $1 into $2. Both backends verify every entry's CRC while inflating, so
# a clean exit means the extracted bytes are identical to what went into the
# archive -- nothing is re-encoded, resampled, or stripped at any point.
extract_zip() {
  local zip="$1" dest="$2" out
  mkdir -p "$dest"
  if command -v unzip >/dev/null 2>&1; then
    out=$(unzip -qq -o "$zip" -d "$dest" 2>&1) && return 0
  elif command -v python3 >/dev/null 2>&1; then
    out=$(python3 -m zipfile -e "$zip" "$dest" 2>&1) && return 0
  else
    echo "Need unzip or python3 to read $zip. Install one (sudo apt install unzip) and re-run." >&2
    exit 1
  fi
  echo "Failed to extract $zip -- refusing to upload a partial session." >&2
  # python3 -m zipfile reports CRC failures as a traceback; the verdict is last.
  printf '%s\n' "$out" | tail -n 3 >&2
  exit 1
}

# Write "<source path><TAB><blob name>" for every file to upload from the scan
# roots in array $ROOTS into manifest $1. Subfolders collapse into the session
# root; when two nested files share a name, the subfolder path becomes a
# filename prefix so neither one is lost.
build_manifest() {
  local out="$1" sidecar images roots_arg
  : > "$out"
  roots_arg=$(printf '%s\n' "${ROOTS[@]}")

  # Shallowest _session.json wins, and it always lands at the session root.
  sidecar=$(list_sidecars "${ROOTS[@]}" | awk -F '/' '{ print NF "\t" $0 }' \
    | LC_ALL=C sort -k1,1n -k2 | head -n 1 | cut -f2-)
  if [ -n "$sidecar" ]; then
    printf '%s\t_session.json\n' "$sidecar" >> "$out"
  fi

  images=$(mktemp)
  list_images "${ROOTS[@]}" | LC_ALL=C sort > "$images"
  awk -v roots="$roots_arg" '
    BEGIN { nroots = split(roots, R, "\n") }
    function relpath(p,   i, best, bl, rl) {
      best = p; bl = 0
      for (i = 1; i <= nroots; i++) {
        rl = length(R[i])
        if (rl > bl && substr(p, 1, rl + 1) == R[i] "/") { bl = rl; best = substr(p, rl + 2) }
      }
      return best
    }
    function basename(p,   n, a) { n = split(p, a, "/"); return a[n] }
    function dirpart(p,   n, a, i, d) {
      n = split(p, a, "/")
      for (i = 1; i < n; i++) d = d (i > 1 ? "-" : "") a[i]
      return d
    }
    function slugify(s) {
      gsub(/[^A-Za-z0-9._-]+/, "-", s)
      gsub(/-+/, "-", s)
      sub(/^-/, "", s); sub(/-$/, "", s)
      return s
    }
    function uniquify(name,   stem, ext, i, cand) {
      if (!(tolower(name) in used)) { used[tolower(name)] = 1; return name }
      stem = name; ext = ""
      if (match(name, /\.[^.]+$/)) { ext = substr(name, RSTART); stem = substr(name, 1, RSTART - 1) }
      i = 2
      do { cand = stem "-" i ext; i++ } while (tolower(cand) in used)
      used[tolower(cand)] = 1
      return cand
    }
    { rel = relpath($0); base = basename(rel); key = tolower(base) }
    NR == FNR { count[key]++; next }
    {
      prefix = slugify(dirpart(rel))
      name = (count[key] > 1 && prefix != "") ? prefix "-" base : base
      printf "%s\t%s\n", $0, uniquify(name)
    }
  ' "$images" "$images" >> "$out"
  rm -f "$images"
}

# Subfolders that contributed images, for the "flattened from" plan line.
manifest_subfolders() {
  awk -F '\t' -v roots="$(printf '%s\n' "${ROOTS[@]}")" '
    BEGIN { nroots = split(roots, R, "\n") }
    {
      rel = $1; bl = 0
      for (i = 1; i <= nroots; i++) {
        rl = length(R[i])
        if (rl > bl && substr($1, 1, rl + 1) == R[i] "/") { bl = rl; rel = substr($1, rl + 2) }
      }
      n = split(rel, a, "/")
      if (n < 2) next
      d = a[1]
      for (i = 2; i < n; i++) d = d "/" a[i]
      if (!(d in seen)) { seen[d] = 1; print d }
    }
  ' "$1" | LC_ALL=C sort | awk '{ out = out (NR > 1 ? ", " : "") $0 } END { print out }'
}

manifest_bytes() {
  cut -f1 "$1" | tr '\n' '\0' | xargs -0 -r stat -c '%s' -- 2>/dev/null \
    | awk '{ s += $1 } END { print s + 0 }'
}

# "3 non-image files (2 .mov, 1 .mp4)", or empty when nothing was skipped.
skipped_summary() {
  list_skipped "${ROOTS[@]}" \
    | awk '{ n = split($0, a, "/"); f = a[n]
             print (match(f, /\.[^.]+$/) ? tolower(substr(f, RSTART)) : "(no extension)") }' \
    | LC_ALL=C sort | uniq -c \
    | awk '{ total += $1; parts = parts (parts == "" ? "" : ", ") $1 " " $2 }
           END { if (total > 0) printf "%d non-image file%s (%s)\n", total, (total == 1 ? "" : "s"), parts }'
}

human_size() {
  numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "${1}B"
}

# Path of the top-level zip backing session $1, if there is one.
session_zip() {
  find "$STAGING_DIR" -maxdepth 1 -type f -iname "$1.zip" -print -quit 2>/dev/null
}

# Candidate session names: direct child folders plus top-level zips. A folder
# and a same-named zip collapse to one entry; the folder wins later.
list_staging_entries() {
  {
    find "$STAGING_DIR" -maxdepth 1 -mindepth 1 -type d -printf '%f\n'
    find "$STAGING_DIR" -maxdepth 1 -type f -iname '*.zip' -printf '%f\n' \
      | sed 's/\.[Zz][Ii][Pp]$//'
  } | LC_ALL=C sort -u
}

# True for staging entries that hold hobby media, converted source photos, or
# our own scratch folders rather than a photography session.
is_skipped() {
  case "$1" in
    hobby-*|.*) return 0 ;;
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
  echo "Usage: $0 <session>... [--build] [--yes]" >&2
  echo "       $0 --all [--build] [--yes]" >&2
  echo >&2
  echo "Sessions available under staging/:" >&2
  if [ -d "$STAGING_DIR" ]; then
    list_staging_entries 2>&1 | sed 's/^/  /' >&2 || true
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
  done < <(list_staging_entries)
  if [ "${#sessions[@]}" -eq 0 ]; then
    echo "No sessions to upload under $STAGING_DIR." >&2
    exit 1
  fi
fi

for i in "${!sessions[@]}"; do
  session="${sessions[$i]}"
  # "name.zip" is shorthand for the session that zip unpacks into.
  case "$session" in
    *.zip|*.ZIP|*.Zip) session="${session%.*}"; sessions[$i]="$session" ;;
  esac
  if [[ "$session" == "." || "$session" == ".." || "$session" == *"/"* || "$session" == *"\\"* ]]; then
    echo "Session must be the name of one direct child folder or zip under staging/: $session" >&2
    exit 2
  fi
  if [ ! -d "$STAGING_DIR/$session" ] && [ -z "$(session_zip "$session")" ]; then
    echo "No such folder or zip: $STAGING_DIR/$session" >&2
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
# Scratch space lives beside staging/ so unpacking a multi-gigabyte zip doesn't
# have to fit in /tmp. staging/* is gitignored, including dotfiles.
WORKDIR=$(mktemp -d "$STAGING_DIR/.upload-XXXXXX")
trap 'rm -rf "$WORKDIR"' EXIT

planned=()
planned_files=()
planned_size=()
planned_nested=()
planned_skipped=()
total_files=0
total_bytes=0
for session in "${sessions[@]}"; do
  idx=${#planned[@]}
  src="$STAGING_DIR/$session"
  unpacked="$WORKDIR/unzip.$idx"
  ROOTS=()

  if [ -d "$src" ]; then
    ROOTS+=("$src")
    # An already-extracted folder is authoritative; don't merge a stale archive.
    same_named_zip=$(session_zip "$session")
    if [ -n "$same_named_zip" ]; then
      echo "  Using $session/ and ignoring $(basename "$same_named_zip")"
    fi
    # A zip dropped inside the session folder (iCloud names them generically,
    # so the folder is what carries the location + date).
    while IFS= read -r zip; do
      [ -n "$zip" ] || continue
      echo "  Unpacking $session/${zip#"$src/"}..."
      extract_zip "$zip" "$unpacked/$(basename "${zip%.*}")"
    done < <(list_zips "$src")
  else
    zip=$(session_zip "$session")
    echo "  Unpacking $(basename "$zip")..."
    extract_zip "$zip" "$unpacked"
  fi
  if [ -d "$unpacked" ]; then
    ROOTS+=("$unpacked")
  fi

  image_count=$(list_images "${ROOTS[@]}" | wc -l)
  if [ "$image_count" -eq 0 ]; then
    if [ "$upload_all" = true ]; then
      echo "  Skipping $session (no accepted image files)"
      continue
    fi
    echo "Nothing to upload for $session (no accepted image files)." >&2
    exit 1
  fi
  manifest="$WORKDIR/manifest.$idx"
  build_manifest "$manifest"
  file_count=$(wc -l < "$manifest")
  bytes=$(manifest_bytes "$manifest")
  planned+=("$session")
  planned_files+=("$file_count")
  planned_size+=("$bytes")
  planned_nested+=("$(manifest_subfolders "$manifest")")
  planned_skipped+=("$(skipped_summary)")
  total_files=$((total_files + file_count))
  total_bytes=$((total_bytes + bytes))
done

if [ "${#planned[@]}" -eq 0 ]; then
  echo "Nothing to upload (no staging entry has accepted image files)." >&2
  exit 1
fi

echo
echo "About to upload ${#planned[@]} session(s):"
echo "  Destination: https://${STORAGE_ACCOUNT}.blob.core.windows.net/${CONTAINER}/"
for i in "${!planned[@]}"; do
  printf '    %-42s %5s files  %10s\n' "${planned[$i]}/" "${planned_files[$i]}" "$(human_size "${planned_size[$i]}")"
  if [ -n "${planned_nested[$i]}" ]; then
    echo "      flattened from: ${planned_nested[$i]}"
  fi
  if [ -n "${planned_skipped[$i]}" ]; then
    echo "      skipping ${planned_skipped[$i]}"
  fi
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

# az storage blob upload-batch's --pattern doesn't support brace expansion, so
# we upload from the per-session manifest built above. A single connection per
# file is plenty fast for personal session sizes and gives clear per-file output.
uploaded=0
failed=0
for i in "${!planned[@]}"; do
  session="${planned[$i]}"
  echo
  echo "Uploading $session..."
  while IFS=$'\t' read -r path blobname <&3; do
    echo "  → $blobname"
    if az storage blob upload \
      --account-name "$STORAGE_ACCOUNT" \
      --auth-mode login \
      --container-name "$CONTAINER" \
      --name "$session/$blobname" \
      --file "$path" \
      --overwrite true \
      --output none 2>/dev/null; then
      uploaded=$((uploaded + 1))
    else
      echo "    [FAILED] $blobname" >&2
      failed=$((failed + 1))
    fi
  done 3< "$WORKDIR/manifest.$i"
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
