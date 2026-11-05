// Email for the contact form: when someone writes through the site, the
// contact function (api/contact/notify.js) sends me a copy through Azure
// Communication Services.
//
// It uses an Azure-managed sending domain (DoNotReply@<id>.azurecomm.net),
// so there's no DNS to set up. Messages are billed per email (a fraction of a
// cent each) and the function caps how many it sends an hour, so a flood of
// spam can't run up the bill.
//
// The Infra workflow reads the resource's connection string and its sender
// address after this deploys, and writes them to the Static Web App as
// CONTACT_EMAIL_CONNECTION_STRING and CONTACT_EMAIL_FROM. Where the copy goes
// is the CONTACT_NOTIFY_TO setting, which is set by hand (docs/azure.md) so
// the address never appears in the repo.

@description('Name of the Communication Services resource.')
param name string

@description('Name of the Email Communication Service that owns the sending domain.')
param emailServiceName string

@description('Tags.')
param tags object

@description('Where the services keep their data at rest.')
param dataLocation string = 'United States'

resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: emailServiceName
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
  }
}

resource domain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  tags: tags
  properties: {
    domainManagement: 'AzureManaged'
    userEngagementTracking: 'Disabled'
  }
}

resource communication 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: name
  location: 'global'
  tags: tags
  properties: {
    dataLocation: dataLocation
    linkedDomains: [
      domain.id
    ]
  }
}

output name string = communication.name
output id string = communication.id
output senderAddress string = 'DoNotReply@${domain.properties.mailFromSenderDomain}'
