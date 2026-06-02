#!/usr/bin/env bash
#
# Bind a custom domain (apex + www) to the Static Web App. Run once after
# the first infra deploy. Idempotent: safe to re-run if you nuke + restart.
#
# Why a script instead of Bicep: SWA custom-domain bindings require the
# matching DNS records to already exist for validation, but the DNS records
# (specifically the apex TXT) need a token that only exists AFTER you've
# started the binding. The CLI's `az staticwebapp hostname set` synchronously
# blocks waiting on validation, so it would hang forever. This script uses
# the raw REST API to issue the binding async, then writes DNS, then polls
# for completion.
#
# Usage:
#   ./scripts/bind-domain.sh <resource-group> <swa-name> <apex-domain>

set -euo pipefail

if [ $# -ne 3 ]; then
  echo "Usage: $0 <resource-group> <swa-name> <apex-domain>" >&2
  exit 2
fi

RG="$1"
SWA="$2"
DOMAIN="$3"

SWA_ID=$(az staticwebapp show --name "$SWA" --resource-group "$RG" --query id -o tsv)
SWA_HOST=$(az staticwebapp show --name "$SWA" --resource-group "$RG" --query defaultHostname -o tsv)
echo "SWA: $SWA_HOST"

API_VERSION="2024-04-01"
ARM="https://management.azure.com${SWA_ID}/customDomains"

# Issue PUT for both bindings asynchronously. SWA returns 202; status starts
# as 'Validating'. The validation token only exists for dns-txt-token method.
echo "=== Starting apex binding (dns-txt-token) ==="
az rest --method put --uri "${ARM}/${DOMAIN}?api-version=${API_VERSION}" \
  --body '{"properties":{"validationMethod":"dns-txt-token"}}' \
  --headers "Content-Type=application/json" >/dev/null 2>&1 || true

echo "=== Starting www binding (cname-delegation) ==="
az rest --method put --uri "${ARM}/www.${DOMAIN}?api-version=${API_VERSION}" \
  --body '{"properties":{"validationMethod":"cname-delegation"}}' \
  --headers "Content-Type=application/json" >/dev/null 2>&1 || true

echo "=== Fetching apex validation token ==="
TOKEN=""
for i in $(seq 1 10); do
  sleep 3
  TOKEN=$(az rest --method get --uri "${ARM}/${DOMAIN}?api-version=${API_VERSION}" \
    --query "properties.validationToken" -o tsv 2>/dev/null || true)
  if [ -n "$TOKEN" ]; then
    echo "Token: $TOKEN"
    break
  fi
  echo "  (no token yet, retrying...)"
done
if [ -z "$TOKEN" ]; then
  echo "Failed to obtain validation token." >&2
  exit 1
fi

echo "=== Writing TXT record at apex ==="
az network dns record-set txt delete --resource-group "$RG" --zone-name "$DOMAIN" --name "@" --yes >/dev/null 2>&1 || true
az network dns record-set txt create --resource-group "$RG" --zone-name "$DOMAIN" --name "@" --ttl 300 >/dev/null
az network dns record-set txt add-record --resource-group "$RG" --zone-name "$DOMAIN" --record-set-name "@" --value "$TOKEN" >/dev/null

echo "=== Writing A apex (alias to SWA) ==="
az network dns record-set a delete --resource-group "$RG" --zone-name "$DOMAIN" --name "@" --yes >/dev/null 2>&1 || true
az network dns record-set a create --resource-group "$RG" --zone-name "$DOMAIN" --name "@" --ttl 3600 --target-resource "$SWA_ID" >/dev/null

echo "=== Ensuring CNAME www -> SWA (Bicep should have created it; idempotent) ==="
az network dns record-set cname delete --resource-group "$RG" --zone-name "$DOMAIN" --name www --yes >/dev/null 2>&1 || true
az network dns record-set cname create --resource-group "$RG" --zone-name "$DOMAIN" --name www --ttl 3600 >/dev/null
az network dns record-set cname set-record --resource-group "$RG" --zone-name "$DOMAIN" --record-set-name www --cname "$SWA_HOST" >/dev/null

echo "=== Polling bindings (up to 15 min) ==="
for i in $(seq 1 30); do
  sleep 30
  APEX=$(az rest --method get --uri "${ARM}/${DOMAIN}?api-version=${API_VERSION}" --query "properties.status" -o tsv 2>/dev/null)
  WWW=$(az rest --method get --uri "${ARM}/www.${DOMAIN}?api-version=${API_VERSION}" --query "properties.status" -o tsv 2>/dev/null)
  echo "[$((i*30))s] apex=$APEX  www=$WWW"
  if [ "$APEX" = "Ready" ] && [ "$WWW" = "Ready" ]; then
    echo "Both bindings Ready."
    break
  fi
done

echo
echo "Done. Live URLs:"
echo "  https://$DOMAIN"
echo "  https://www.$DOMAIN"
echo
echo "TLS cert issuance may take up to ~30 min after Ready before the cert is"
echo "live. Test with: curl -I https://$DOMAIN"
