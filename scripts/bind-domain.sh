#!/usr/bin/env bash
#
# After the Bicep deploy has created the SWA + DNS zone, bind the apex domain
# manually because SWA's apex binding flow doesn't have a clean idempotent
# ARM/Bicep path. Run once per environment.
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

SWA_HOSTNAME=$(az staticwebapp show --name "$SWA" --resource-group "$RG" --query defaultHostname -o tsv)
echo "SWA hostname: $SWA_HOSTNAME"

echo "Creating apex custom domain binding (dns-txt-token validation)…"
az staticwebapp hostname set \
  --name "$SWA" \
  --resource-group "$RG" \
  --hostname "$DOMAIN" \
  --validation-method dns-txt-token || true

VALIDATION_TOKEN=$(az staticwebapp hostname show \
  --name "$SWA" \
  --resource-group "$RG" \
  --hostname "$DOMAIN" \
  --query validationToken -o tsv)
echo "Validation token: $VALIDATION_TOKEN"

echo "Writing TXT record for validation…"
az network dns record-set txt delete --resource-group "$RG" --zone-name "$DOMAIN" --name "@" --yes >/dev/null 2>&1 || true
az network dns record-set txt create --resource-group "$RG" --zone-name "$DOMAIN" --name "@" --ttl 3600 >/dev/null
az network dns record-set txt add-record --resource-group "$RG" --zone-name "$DOMAIN" --name "@" --value "$VALIDATION_TOKEN" >/dev/null

echo "Writing ALIAS A record for apex pointing at SWA…"
az network dns record-set a delete --resource-group "$RG" --zone-name "$DOMAIN" --name "@" --yes >/dev/null 2>&1 || true
az network dns record-set a create --resource-group "$RG" --zone-name "$DOMAIN" --name "@" --target-resource "$(az staticwebapp show --name "$SWA" --resource-group "$RG" --query id -o tsv)" --ttl 3600 >/dev/null 2>&1 || \
  echo "  (alias-to-SWA not supported in this region — fall back to creating CNAME at apex via flattening, or use a registrar that supports ANAME/ALIAS.)"

echo "Writing CNAME for www…"
az network dns record-set cname delete --resource-group "$RG" --zone-name "$DOMAIN" --name www --yes >/dev/null 2>&1 || true
az network dns record-set cname create --resource-group "$RG" --zone-name "$DOMAIN" --name www --ttl 3600 >/dev/null
az network dns record-set cname set-record --resource-group "$RG" --zone-name "$DOMAIN" --record-set-name www --cname "$SWA_HOSTNAME" >/dev/null

echo "Binding www to SWA…"
az staticwebapp hostname set \
  --name "$SWA" \
  --resource-group "$RG" \
  --hostname "www.$DOMAIN" \
  --validation-method cname-delegation || true

echo
echo "Done. Validation may take up to an hour while certs are issued."
echo "Test once it's live:"
echo "  curl -I https://$DOMAIN"
echo "  curl -I https://www.$DOMAIN"
