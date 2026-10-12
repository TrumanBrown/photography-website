#!/usr/bin/env bash
#
# One-time bootstrap: create the managed identity the Infra workflow deploys
# with, trust GitHub Actions OIDC for it, and grant the rights a deployment
# needs.
#
# This script is idempotent — safe to re-run.
#
# Prereqs: az CLI installed and `az login` done. GitHub repo already created.
#
# Usage:
#   ./scripts/setup-federated-credential.sh <subscription-id> <github-owner> <github-repo>
#
# Two identities, two jobs:
#   - id-photography-bootstrap (this script): subscription-scoped, used only by
#     the Infra workflow. It trusts tokens from the GitHub Environment the
#     workflow deploys to (`prod` by default; set GH_ENVIRONMENTS="prod dev"
#     for more), never a plain branch or pull request. Protect that
#     environment in GitHub (Settings → Environments) so only `main` can use it.
#   - id-photography-deploy-<env> (infra/modules/identity.bicep): Blob access
#     on the site's storage account, and nothing else. The build, photo and
#     posting workflows sign in as it through the AZURE_DEPLOY_CLIENT_ID
#     secret, which the first Infra run (or bootstrap-swa-token.sh) sets.
#
# The deploy needs Contributor on the subscription (it creates the resource
# group) and the right to make the role assignments in the Bicep. That second
# right is "Role Based Access Control Administrator" limited, by a condition,
# to the three roles the Bicep assigns, and only to service principals, rather
# than User Access Administrator, which could grant anyone anything.

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
GH_ENVIRONMENTS="${GH_ENVIRONMENTS:-prod}"
SCOPE="/subscriptions/$SUBSCRIPTION_ID"

# The roles infra/ assigns: Storage Blob Data Contributor, Reader, Cognitive
# Services OpenAI User. Add a role's ID here before assigning a new one in
# Bicep.
ASSIGNABLE_ROLES="ba92f5b4-2d11-453d-a403-e96b0029c9fe, acdd72a7-3385-48ef-bd42-f606fba81ae7, 5e0bd9bd-7b93-4f28-af87-19fc36ad61bd"
RBAC_ADMIN_ROLE="f58310d9-a9f6-439a-9e8d-f62e7b41a168"
CONDITION="((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ASSIGNABLE_ROLES} AND @Request[Microsoft.Authorization/roleAssignments:PrincipalType] ForAnyOfAnyValues:StringEqualsIgnoreCase {'ServicePrincipal'})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$ASSIGNABLE_ROLES} AND @Resource[Microsoft.Authorization/roleAssignments:PrincipalType] ForAnyOfAnyValues:StringEqualsIgnoreCase {'ServicePrincipal'}))"

echo "Using subscription: $SUBSCRIPTION_ID"
az account set --subscription "$SUBSCRIPTION_ID"

TENANT_ID=$(az account show --query tenantId -o tsv | tr -d '\r')
echo "Tenant: $TENANT_ID"

echo "Ensuring resource group: $MI_RG (in $LOCATION)"
az group create --name "$MI_RG" --location "$LOCATION" --tags project=photography-website managedBy=bootstrap >/dev/null

echo "Ensuring managed identity: $MI_NAME"
az identity create --name "$MI_NAME" --resource-group "$MI_RG" --location "$LOCATION" >/dev/null
MI_CLIENT_ID=$(az identity show --name "$MI_NAME" --resource-group "$MI_RG" --query clientId -o tsv | tr -d '\r')
MI_PRINCIPAL_ID=$(az identity show --name "$MI_NAME" --resource-group "$MI_RG" --query principalId -o tsv | tr -d '\r')
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

# A job that names an environment presents this subject, not its branch.
for ENVIRONMENT in $GH_ENVIRONMENTS; do
  create_fed "github-environment-$ENVIRONMENT" "repo:$GH_OWNER/$GH_REPO:environment:$ENVIRONMENT"
done

# Re-running is fine: an assignment that already exists isn't an error.
assign_role() {
  local err
  if ! err=$(az role assignment create "$@" 2>&1 >/dev/null); then
    case "$err" in
      *RoleAssignmentExists*|*"already exists"*) ;;
      *) echo "$err" >&2; return 1 ;;
    esac
  fi
}

echo "Granting Contributor on subscription (creates the resource group and deploys into it)"
assign_role \
  --assignee-object-id "$MI_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role 'Contributor' \
  --scope "$SCOPE"

echo "Granting Role Based Access Control Administrator, limited to the roles the Bicep assigns"
assign_role \
  --assignee-object-id "$MI_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "$RBAC_ADMIN_ROLE" \
  --scope "$SCOPE" \
  --condition "$CONDITION" \
  --condition-version "2.0"

# Earlier versions of this script trusted every main-branch and pull-request
# run, and granted User Access Administrator. Report rather than remove them:
# the workflows may still depend on them until AZURE_DEPLOY_CLIENT_ID is set.
LEGACY=()
for NAME in github-main github-pull-request; do
  if az identity federated-credential show --identity-name "$MI_NAME" --resource-group "$MI_RG" --name "$NAME" >/dev/null 2>&1; then
    LEGACY+=("az identity federated-credential delete --identity-name $MI_NAME --resource-group $MI_RG --name $NAME --yes")
  fi
done
UAA=$(az role assignment list --assignee "$MI_PRINCIPAL_ID" --role 'User Access Administrator' --scope "$SCOPE" --query "length(@)" -o tsv 2>/dev/null | tr -d '\r' || echo 0)
if [ "${UAA:-0}" != "0" ]; then
  LEGACY+=("az role assignment delete --assignee $MI_PRINCIPAL_ID --role 'User Access Administrator' --scope $SCOPE")
fi

cat <<EOF

==========================================================================
Done. Set these as repository secrets on github.com/$GH_OWNER/$GH_REPO:

  AZURE_CLIENT_ID        = $MI_CLIENT_ID
  AZURE_TENANT_ID        = $TENANT_ID
  AZURE_SUBSCRIPTION_ID  = $SUBSCRIPTION_ID

In Settings → Environments, create "$GH_ENVIRONMENTS" and limit its deployment
branches to main (required reviewers are a good idea too).

If you want the Infra workflow to fill in the other secrets after deploying
(the SWA deploy token, the storage account and AZURE_DEPLOY_CLIENT_ID), also
create a fine-grained PAT with "Secrets: Read and write" on this repository
and add it as GH_PAT_FOR_SECRETS. Otherwise run ./scripts/bootstrap-swa-token.sh
after the first deploy.

Then run the "Infra (Bicep)" workflow from the Actions tab.
==========================================================================
EOF

if [ "${#LEGACY[@]}" -gt 0 ]; then
  cat <<EOF

This identity still has rights from an earlier version of this script. Once
AZURE_DEPLOY_CLIENT_ID is set and a build has passed with it, remove them:

EOF
  printf '  %s\n' "${LEGACY[@]}"
fi
