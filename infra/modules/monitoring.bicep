@description('Log Analytics workspace name.')
param name string

@description('Region.')
param location string

@description('Tags.')
param tags object

@description('Create the workspace used by storage diagnostic settings.')
param enabled bool

resource log 'Microsoft.OperationalInsights/workspaces@2023-09-01' = if (enabled) {
  name: name
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: {
      dailyQuotaGb: 1
    }
  }
}

output logAnalyticsWorkspaceId string = enabled ? log.id : ''
