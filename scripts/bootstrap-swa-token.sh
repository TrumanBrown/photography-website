#!/usr/bin/env bash
#
# Copy the deploy values the workflows need from Azure into the GitHub repo's
# secrets: the SWA deployment token (AZURE_STATIC_WEB_APPS_API_TOKEN), the
# storage account name (AZURE_STORAGE_ACCOUNT), and the client ID of the build
# identity Bicep creates (AZURE_DEPLOY_CLIENT_ID), which the build, photo and
# posting workflows sign in as instead of the subscription-wide bootstrap one.
#
# Run after the Infra workflow has succeeded once, OR after manually deploying
# the Bicep template from your laptop. The Infra workflow does the same itself
# when the GH_PAT_FOR_SECRETS secret exists.
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

# Windows az under WSL ends its output with \r.
echo "Fetching SWA deployment token from $SWA in $RG…"
TOKEN=$(az staticwebapp secrets list --name "$SWA" --resource-group "$RG" --query "properties.apiKey" -o tsv | tr -d '\r')
if [ -z "$TOKEN" ]; then
  echo "Failed to fetch SWA token." >&2
  exit 1
fi

echo "Locating storage account in $RG…"
STORAGE=$(az storage account list --resource-group "$RG" --query "[0].name" -o tsv | tr -d '\r')

echo "Locating the build identity in $RG…"
DEPLOY_CLIENT_ID=$(az identity list --resource-group "$RG" \
  --query "[?starts_with(name, 'id-photography-deploy-')].clientId | [0]" -o tsv | tr -d '\r')

echo "Writing GitHub secrets to $REPO…"
# Piped rather than passed as an argument, so the token never shows in `ps`.
printf '%s' "$TOKEN" | gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN --repo "$REPO"
gh secret set AZURE_STORAGE_ACCOUNT --repo "$REPO" --body "$STORAGE"
if [ -n "$DEPLOY_CLIENT_ID" ]; then
  gh secret set AZURE_DEPLOY_CLIENT_ID --repo "$REPO" --body "$DEPLOY_CLIENT_ID"
else
  echo "No id-photography-deploy-* identity in $RG; the workflows keep signing in as AZURE_CLIENT_ID." >&2
fi

echo "Done. The next push or scheduled run will deploy with the new token."
