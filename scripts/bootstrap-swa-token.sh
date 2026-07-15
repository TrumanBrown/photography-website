#!/usr/bin/env bash
#
# Fetch the SWA deployment token from Azure and copy it into the GitHub
# repo's secrets as AZURE_STATIC_WEB_APPS_API_TOKEN. Also copies the storage
# account name.
#
# Run after the Infra workflow has succeeded once, OR after manually deploying
# the Bicep template from your laptop.
#
# Requires: az CLI logged in, gh CLI logged in (`gh auth login`).
#
# Usage:
#   ./scripts/bootstrap-swa-token.sh <resource-group> <swa-name> <github-owner/repo>

set -euo pipefail

if [ $# -ne 3 ]; then
  echo "Usage: $0 <resource-group> <swa-name> <github-owner/repo>" >&2
  exit 2
fi

RG="$1"
SWA="$2"
REPO="$3"

echo "Fetching SWA deployment token from $SWA in $RG…"
TOKEN=$(az staticwebapp secrets list --name "$SWA" --resource-group "$RG" --query "properties.apiKey" -o tsv)
if [ -z "$TOKEN" ]; then
  echo "Failed to fetch SWA token." >&2
  exit 1
fi

echo "Locating storage account in $RG…"
STORAGE=$(az storage account list --resource-group "$RG" --query "[0].name" -o tsv)

echo "Writing GitHub secrets to $REPO…"
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo "$REPO" --body "$TOKEN"
gh secret set AZURE_STORAGE_ACCOUNT --repo "$REPO" --body "$STORAGE"

echo "Done. The next push or scheduled run will deploy with the new token."
