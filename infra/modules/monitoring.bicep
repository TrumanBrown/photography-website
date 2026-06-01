@description('Log Analytics workspace name.')
param name string

@description('Application Insights resource name.')
param appInsightsName string

@description('Region.')
param location string

@description('Tags.')
param tags object

resource log 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
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

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: log.id
    IngestionMode: 'LogAnalytics'
    DisableIpMasking: false
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

output logAnalyticsWorkspaceId string = log.id
output appInsightsId string = appi.id
output appInsightsConnectionString string = appi.properties.ConnectionString
