@description('Storage account name. Must be globally unique, 3-24 chars, lowercase letters/digits only.')
@maxLength(24)
param name string

@description('Region.')
param location string

@description('Tags.')
param tags object

@description('CORS allowed origins for blob service.')
param corsAllowedOrigins array

@description('Enable diagnostic settings to Log Analytics.')
param enableDiagnostics bool

@description('Log Analytics workspace resource ID. Required if enableDiagnostics=true.')
param logAnalyticsWorkspaceId string

resource sa 'Microsoft.Storage/storageAccounts@2024-01-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    accessTier: 'Hot'
    allowBlobPublicAccess: true
    allowSharedKeyAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
    defaultToOAuthAuthentication: true
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: 'Allow'
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2024-01-01' = {
  parent: sa
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: corsAllowedOrigins
          allowedMethods: [ 'GET', 'HEAD', 'OPTIONS' ]
          allowedHeaders: [ '*' ]
          exposedHeaders: [ '*' ]
          maxAgeInSeconds: 3600
        }
      ]
    }
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 7
    }
    isVersioningEnabled: false
    changeFeed: { enabled: false }
  }
}

resource originals 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'originals'
  properties: {
    // 'Blob' = anonymous GET on individual blobs; no listing.
    publicAccess: 'Blob'
  }
}

resource derivatives 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'derivatives'
  properties: {
    publicAccess: 'Blob'
  }
}

// Variants container: holds Astro's responsive AVIF/WebP/JPEG outputs from
// dist/_astro/. We sync these to Blob after each build and rewrite HTML
// references, keeping the SWA app artifact under the Free-tier 250 MB cap
// regardless of how many photos the site has.
resource variants 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'variants'
  properties: {
    publicAccess: 'Blob'
  }
}

resource metadata 'Microsoft.Storage/storageAccounts/blobServices/containers@2024-01-01' = {
  parent: blobService
  name: 'metadata'
  properties: {
    publicAccess: 'None'
  }
}

resource diag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = if (enableDiagnostics) {
  name: 'diag-${name}'
  scope: sa
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    metrics: [
      {
        category: 'Transaction'
        enabled: true
      }
    ]
  }
}

output name string = sa.name
output id string = sa.id
output blobEndpoint string = sa.properties.primaryEndpoints.blob
