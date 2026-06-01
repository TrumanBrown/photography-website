#!/usr/bin/env bash
#
# One-time bootstrap: create the user-assigned managed identity, wire up
# federated credentials for GitHub Actions OIDC, and grant baseline RBAC.
#
# This script is idempotent — safe to re-run.
#
# Prereqs: az CLI installed and `az login` done. GitHub repo already created.
#
# Usage:
#   ./scripts/setup-federated-credential.sh <subscription-id> <github-owner> <github-repo>
#
# After this runs successfully, push your repo and trigger the `Infra (Bicep)`
# workflow to deploy the rest of the stack. The Bicep template creates its own
# managed identity for the deploy pipeline; this bootstrap creates a
# *separate*, **subscription-scoped** identity used only by the infra workflow
# (which needs broader rights than the per-repo prebuild identity).

set -euo pipefail

if [ $# -ne 3 ]; then
  echo "Usage: $0 <subscription-id> <github-owner> <github-repo>" >&2
  exit 2
fi

SUBSCRIPTION_ID="$1"
GH_OWNER="$2"
GH_REPO="$3"

MI_NAME="id-photography-bootstrap"
MI_RG="rg-photography-bootstrap"
LOCATION="${LOCATION:-westus3}"

echo "Using subscription: $SUBSCRIPTION_ID"
az account set --subscription "$SUBSCRIPTION_ID"

TENANT_ID=$(az account show --query tenantId -o tsv)
echo "Tenant: $TENANT_ID"

echo "Ensuring resource group: $MI_RG (in $LOCATION)"
az group create --name "$MI_RG" --location "$LOCATION" --tags project=photography-website managedBy=bootstrap >/dev/null

echo "Ensuring managed identity: $MI_NAME"
az identity create --name "$MI_NAME" --resource-group "$MI_RG" --location "$LOCATION" >/dev/null
MI_CLIENT_ID=$(az identity show --name "$MI_NAME" --resource-group "$MI_RG" --query clientId -o tsv)
MI_PRINCIPAL_ID=$(az identity show --name "$MI_NAME" --resource-group "$MI_RG" --query principalId -o tsv)
echo "MI client id: $MI_CLIENT_ID"
echo "MI principal id: $MI_PRINCIPAL_ID"

create_fed() {
  local NAME="$1"
  local SUBJECT="$2"
  echo "Federated credential: $NAME ($SUBJECT)"
  if az identity federated-credential show --identity-name "$MI_NAME" --resource-group "$MI_RG" --name "$NAME" >/dev/null 2>&1; then
    az identity federated-credential update \
      --identity-name "$MI_NAME" --resource-group "$MI_RG" --name "$NAME" \
      --issuer 'https://token.actions.githubusercontent.com' \
      --subject "$SUBJECT" \
      --audiences 'api://AzureADTokenExchange' >/dev/null
  else
    az identity federated-credential create \
      --identity-name "$MI_NAME" --resource-group "$MI_RG" --name "$NAME" \
      --issuer 'https://token.actions.githubusercontent.com' \
      --subject "$SUBJECT" \
      --audiences 'api://AzureADTokenExchange' >/dev/null
  fi
}

create_fed "github-main" "repo:$GH_OWNER/$GH_REPO:ref:refs/heads/main"
create_fed "github-pull-request" "repo:$GH_OWNER/$GH_REPO:pull_request"

echo "Granting Contributor on subscription (needed for infra deploys)"
az role assignment create \
  --assignee-object-id "$MI_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role 'Contributor' \
  --scope "/subscriptions/$SUBSCRIPTION_ID" >/dev/null 2>&1 || true

echo "Granting User Access Administrator on subscription (needed to assign RBAC inside Bicep)"
az role assignment create \
  --assignee-object-id "$MI_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role 'User Access Administrator' \
  --scope "/subscriptions/$SUBSCRIPTION_ID" >/dev/null 2>&1 || true

cat <<EOF

==========================================================================
Done. Set these as repository secrets on github.com/$GH_OWNER/$GH_REPO:

  AZURE_CLIENT_ID        = $MI_CLIENT_ID
  AZURE_TENANT_ID        = $TENANT_ID
  AZURE_SUBSCRIPTION_ID  = $SUBSCRIPTION_ID

If you want the Infra workflow to auto-populate other secrets after deploy,
also create a fine-grained PAT with "Secrets: write" scope and add:

  GH_PAT_FOR_SECRETS     = <ghp_...>

Then run the "Infra (Bicep)" workflow from the Actions tab.
==========================================================================
EOF
