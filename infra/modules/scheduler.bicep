// A timer that starts the posting and photo workflows on GitHub.
//
// GitHub's own scheduler is best effort: on this repository it fired an
// hourly cron about once every five hours, and a new half-hourly one not at
// all for its first hours. Instagram posting needs to happen at set times, so
// a Logic App (consumption, cents a month) starts the workflows instead, by
// calling GitHub's workflow_dispatch API:
//   - social-post.yml twice an hour through the posting day; the workflow
//     itself decides whether a post is due, so extra starts cost seconds
//   - photos.yml once a day, so Instagram posts keep being written ahead
//     even if GitHub skips that workflow's own schedule
// The schedules in the workflow files stay, as a fallback.
//
// Credential: the Static Web App's GITHUB_TOKEN setting, the fine-grained
// token the admin panel's Rebuild button already uses (Actions: read and
// write on this repository only). It's read here at deploy time and kept as a
// secure parameter: never in this file, the deployment's outputs, or the
// Logic App's run history. After replacing that token, run the Infra
// workflow again. Without it the Logic App is deployed switched off.

@description('Logic App name.')
param name string

@description('Region.')
param location string

@description('Static Web App whose GITHUB_TOKEN app setting is used to start the workflows.')
param swaName string

@description('GitHub org/user that owns the repo.')
param githubOwner string

@description('GitHub repository name.')
param githubRepo string

@description('Branch the workflows run on.')
param githubBranch string

@description('Windows time zone for the hours below. Keep it the same as SOCIAL_TIMEZONE (Pacific Standard Time is America/Los_Angeles, daylight saving included).')
param timeZone string = 'Pacific Standard Time'

@description('Local hours in which to start the posting workflow, at :02 and :32. They should cover every posting slot (08:30, 12:30 and 18:00 by default) up to SOCIAL_DAY_END.')
param postingHours int[] = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]

@description('Local hour, at :02, to start the photo pipeline each day.')
param pipelineHour int = 3

@description('Tags.')
param tags object

resource swa 'Microsoft.Web/staticSites@2024-04-01' existing = {
  name: swaName
}

var githubToken = swa.listAppSettings().properties.?GITHUB_TOKEN ?? ''
var pipelineTime = '${padLeft(string(pipelineHour), 2, '0')}:02'
var api = 'https://api.github.com/repos/${githubOwner}/${githubRepo}/actions/workflows'

resource scheduler 'Microsoft.Logic/workflows@2019-05-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    state: empty(githubToken) ? 'Disabled' : 'Enabled'
    parameters: {
      githubToken: {
        value: githubToken
      }
    }
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        githubToken: {
          type: 'SecureString'
        }
      }
      triggers: {
        Twice_an_hour: {
          type: 'Recurrence'
          recurrence: {
            frequency: 'Day'
            interval: 1
            timeZone: timeZone
            schedule: {
              hours: union([pipelineHour], postingHours)
              minutes: [2, 32]
            }
          }
        }
      }
      actions: {
        Start_workflow: {
          type: 'Http'
          inputs: {
            method: 'POST'
            uri: '${api}/@{if(equals(convertFromUtc(trigger().scheduledTime, \'${timeZone}\', \'HH:mm\'), \'${pipelineTime}\'), \'photos.yml\', \'social-post.yml\')}/dispatches'
            headers: {
              Accept: 'application/vnd.github+json'
              Authorization: 'Bearer @{parameters(\'githubToken\')}'
              'X-GitHub-Api-Version': '2022-11-28'
              'User-Agent': 'photography-website-scheduler'
            }
            body: {
              ref: githubBranch
            }
          }
          // Keeps the token out of the run history.
          runtimeConfiguration: {
            secureData: {
              properties: ['inputs']
            }
          }
        }
      }
    }
  }
}

output name string = scheduler.name
output enabled bool = !empty(githubToken)
