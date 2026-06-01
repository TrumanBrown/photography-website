targetScope = 'subscription'

@description('Azure region for all resources. westus3 recommended for cheap modern US-central latency.')
param location string = 'westus3'

@description('Short environment tag, used in resource names and tags. e.g. prod, dev.')
param environment string = 'prod'

@description('Apex domain name to register, e.g. trumandoe.com. Leave empty to skip domain registration on first deploy; add it back later.')
param domainName string = ''

@description('Contact info for the App Service Domain registration. Required if domainName is set on first deploy.')
param domainContact object = {}

@description('GitHub org/user that owns the repo (e.g. "trumandoe").')
param githubOwner string

@description('GitHub repository name (e.g. "photography-website").')
param githubRepo string

@description('Git branch to trust via OIDC federation. Defaults to main.')
param githubBranch string = 'main'

@description('Enable diagnostic settings on the storage account → Log Analytics. Off by default to stay free.')
param enableDiagnostics bool = false

var resourceGroupName = 'rg-photography-${environment}'
var tags = {
  project: 'photography-website'
  environment: environment
  managedBy: 'bicep'
}

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module stack 'main.bicep' = {
  name: 'photography-stack-${environment}'
  scope: rg
  params: {
    location: location
    environment: environment
    domainName: domainName
    domainContact: domainContact
    githubOwner: githubOwner
    githubRepo: githubRepo
    githubBranch: githubBranch
    enableDiagnostics: enableDiagnostics
    tags: tags
  }
}

output resourceGroupName string = rg.name
output storageAccountName string = stack.outputs.storageAccountName
output blobEndpoint string = stack.outputs.blobEndpoint
output swaDefaultHostname string = stack.outputs.swaDefaultHostname
output swaName string = stack.outputs.swaName
output managedIdentityClientId string = stack.outputs.managedIdentityClientId
output managedIdentityPrincipalId string = stack.outputs.managedIdentityPrincipalId
output appInsightsConnectionString string = stack.outputs.appInsightsConnectionString
