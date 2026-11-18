// Keeps the site's managed Functions warm. All of them share one process, and
// Static Web Apps stops it after about five minutes without a request. The
// next visitor then waits for a new one to start, and for the analytics
// network lookup (api/shared/geo.js) to load again, about five seconds. With
// a ping every five minutes, every other ping found a new process, so a
// resume opened in that gap sat blank. A ping every minute keeps the one
// process alive. It calls GET /api/track?warm=1, which loads the lookup if
// needed and records nothing. It holds no secrets, unlike the scheduler, so it
// keeps running when the GitHub token expires. About 44,000 runs a month cost
// about two dollars (docs/azure.md).

@description('Logic App name.')
param name string

@description('Region.')
param location string

@description('The site whose API is kept warm, like https://example.com.')
param siteUrl string

@description('Minutes between pings. Keep it well under the five-minute idle timeout.')
param everyMinutes int = 1

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
