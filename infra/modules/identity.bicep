@description('Managed identity name.')
param name string

@description('Region.')
param location string

@description('Storage account name to grant RBAC on.')
param storageAccountName string

@description('GitHub org/user.')
param githubOwner string

@description('GitHub repository name.')
param githubRepo string

@description('Branch trusted by federation.')
param githubBranch string

@description('Tags.')
param tags object

resource mi 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: name
  location: location
  tags: tags
}

// OIDC federation for GitHub Actions on the trusted branch.
resource fedBranch 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: mi
  name: 'github-${githubBranch}'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    audiences: [ 'api://AzureADTokenExchange' ]
    subject: 'repo:${githubOwner}/${githubRepo}:ref:refs/heads/${githubBranch}'
  }
}

// Allow PR builds from the same repo to also use OIDC (needed for SWA preview deploys).
resource fedPullRequest 'Microsoft.ManagedIdentity/userAssignedIdentities/federatedIdentityCredentials@2023-01-31' = {
  parent: mi
  name: 'github-pull-request'
  properties: {
    issuer: 'https://token.actions.githubusercontent.com'
    audiences: [ 'api://AzureADTokenExchange' ]
    subject: 'repo:${githubOwner}/${githubRepo}:pull_request'
  }
}

resource sa 'Microsoft.Storage/storageAccounts@2024-01-01' existing = {
  name: storageAccountName
}

// Storage Blob Data Contributor — read originals, write derivatives.
var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource roleAssignmentBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(sa.id, mi.id, blobDataContributorRoleId)
  scope: sa
  properties: {
    principalId: mi.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
  }
}

// Reader on the resource group — lets the deploy step look up resource props.
var readerRoleId = 'acdd72a7-3385-48ef-bd42-f606fba81ae7'

resource roleAssignmentReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, mi.id, readerRoleId)
  scope: resourceGroup()
  properties: {
    principalId: mi.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', readerRoleId)
  }
}

output principalId string = mi.properties.principalId
output clientId string = mi.properties.clientId
output id string = mi.id
output tenantId string = mi.properties.tenantId
