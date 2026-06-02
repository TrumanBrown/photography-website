@description('Azure region for all resources.')
param location string

@description('Short environment tag.')
param environment string

@description('Apex domain name; empty to skip the DNS-record-adding domain module.')
param domainName string

@description('App Service Domain contact info. Reserved; consumed by bootstrap script, not by Bicep directly.')
#disable-next-line no-unused-params
param domainContact object

@description('GitHub org/user.')
param githubOwner string

@description('GitHub repository name.')
param githubRepo string

@description('Git branch trusted by OIDC federation.')
param githubBranch string

@description('Enable Log Analytics diagnostics for the storage account.')
param enableDiagnostics bool

@description('Tags applied to every resource.')
param tags object

// Short suffix to ensure global uniqueness on storage account / SWA / etc.
var suffix = toLower(substring(uniqueString(resourceGroup().id), 0, 6))
var namePrefix = 'photography-${environment}'

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    location: location
    name: 'log-${namePrefix}'
    appInsightsName: 'appi-${namePrefix}'
    tags: tags
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    name: 'stphoto${environment}${suffix}'
    tags: tags
    enableDiagnostics: enableDiagnostics
    logAnalyticsWorkspaceId: monitoring.outputs.logAnalyticsWorkspaceId
    corsAllowedOrigins: union(
      [ 'https://${swa.outputs.defaultHostname}' ],
      empty(domainName) ? [] : [
        'https://${domainName}'
        'https://www.${domainName}'
      ]
    )
  }
}

module swa 'modules/swa.bicep' = {
  name: 'swa'
  params: {
    location: location
    name: 'swa-${namePrefix}'
    tags: tags
  }
}

module identity 'modules/identity.bicep' = {
  name: 'identity'
  params: {
    location: location
    name: 'id-photography-deploy-${environment}'
    storageAccountName: storage.outputs.name
    githubOwner: githubOwner
    githubRepo: githubRepo
    githubBranch: githubBranch
    tags: tags
  }
}

module domain 'modules/domain.bicep' = if (!empty(domainName)) {
  name: 'domain'
  params: {
    domainName: domainName
    swaHostname: swa.outputs.defaultHostname
    tags: tags
  }
}

output storageAccountName string = storage.outputs.name
output blobEndpoint string = storage.outputs.blobEndpoint
output swaDefaultHostname string = swa.outputs.defaultHostname
output swaName string = swa.outputs.name
output managedIdentityClientId string = identity.outputs.clientId
output managedIdentityPrincipalId string = identity.outputs.principalId
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
