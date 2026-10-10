@description('Azure OpenAI account name. Also its custom subdomain, which keyless (Entra ID) auth requires, so it must be globally unique.')
param name string

@description('Region.')
param location string

@description('Principal ID of the Bicep deploy identity (id-photography-deploy-<env>). It gets inference-only access.')
param principalId string

@description('The identity GitHub Actions actually signs in as, through the AZURE_CLIENT_ID secret. scripts/setup-federated-credential.sh creates it under these names. It gets inference-only access too.')
param ciIdentityName string = 'id-photography-bootstrap'

@description('Resource group of the GitHub Actions identity.')
param ciIdentityResourceGroup string = 'rg-photography-bootstrap'

@description('Model that drafts session descriptions. It must accept image input.')
param modelName string = 'gpt-6.1-sol'

@description('Model version. Azure moves the deployment to each new default version on its own.')
param modelVersion string = '2026-09-29'

@description('DataZoneStandard keeps processing inside the US data zone. GlobalStandard has the widest availability.')
param skuName string = 'DataZoneStandard'

@description('Rate ceiling in thousands of tokens per minute. Billing is per token, so this costs nothing by itself.')
param capacity int = 50

@description('Tags.')
param tags object

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' = {
  name: name
  location: location
  tags: tags
  kind: 'OpenAI'
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: name
    // Entra ID only, so there's no API key to leak or rotate. The build reaches
    // it through the same OIDC login it already uses for Blob Storage.
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource deployment 'Microsoft.CognitiveServices/accounts/deployments@2025-06-01' = {
  parent: account
  name: modelName
  sku: {
    name: skuName
    capacity: capacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: modelName
      version: modelVersion
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

// Cognitive Services OpenAI User: call the deployed model and nothing else. It
// can't change deployments, list keys, or reach any other resource.
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource roleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, principalId, openAiUserRoleId)
  scope: account
  properties: {
    principalId: principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
  }
}

resource ciIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: ciIdentityName
  scope: resourceGroup(ciIdentityResourceGroup)
}

// The build's prebuild step runs as this identity, so this is the grant that
// lets new sessions get a drafted description.
resource ciRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(account.id, ciIdentity.id, openAiUserRoleId)
  scope: account
  properties: {
    principalId: ciIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
  }
}

output name string = account.name
output endpoint string = account.properties.endpoint
output deploymentName string = deployment.name
