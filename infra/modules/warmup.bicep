// Keeps the site's managed Functions warm. A cold instance takes about five
// seconds to load the analytics network lookup (api/shared/geo.js), and the
// resume PDF now goes through a function, so this pings GET /api/track?warm=1
// every five minutes. It holds no secrets, unlike the scheduler, so it keeps
// running when the GitHub token expires. A few hundred runs a day cost well
// under a dollar a month (docs/analytics.md).

@description('Logic App name.')
param name string

@description('Region.')
param location string

@description('The site whose API is kept warm, like https://example.com.')
param siteUrl string

@description('Minutes between pings.')
param everyMinutes int = 5

@description('Tags.')
param tags object

resource warmup 'Microsoft.Logic/workflows@2019-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    state: 'Enabled'
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      triggers: {
        Every_few_minutes: {
          type: 'Recurrence'
          recurrence: {
            frequency: 'Minute'
            interval: everyMinutes
          }
        }
      }
      actions: {
        Warm_the_API: {
          type: 'Http'
          runAfter: {}
          inputs: {
            method: 'GET'
            uri: '${siteUrl}/api/track?warm=1'
          }
        }
      }
    }
  }
}

output name string = warmup.name
