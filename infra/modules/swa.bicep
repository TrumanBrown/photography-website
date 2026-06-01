@description('Static Web App name.')
param name string

@description('Region. SWA Free is only available in a few regions; westus2/eastus2/centralus/westeurope/eastasia.')
param location string

@description('Tags.')
param tags object

@description('Apex domain to bind as a custom domain. Empty to skip.')
param customDomainApex string

// SWA Free is restricted to a small set of regions. Map likely
// resource-group regions onto a supported SWA region.
var swaLocationMap = {
  westus3: 'westus2'
  westus2: 'westus2'
  westus: 'westus2'
  eastus: 'eastus2'
  eastus2: 'eastus2'
  centralus: 'centralus'
  northcentralus: 'centralus'
  southcentralus: 'centralus'
  westeurope: 'westeurope'
  northeurope: 'westeurope'
  eastasia: 'eastasia'
  southeastasia: 'eastasia'
}
var swaLocation = swaLocationMap[?location] ?? 'westus2'

resource swa 'Microsoft.Web/staticSites@2024-04-01' = {
  name: name
  location: swaLocation
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // Deployment is performed by GitHub Actions using a deployment token;
    // we deliberately omit repositoryUrl/branch so the SWA isn't wired to
    // a specific repo from the Azure side.
    provider: 'Other'
    enterpriseGradeCdnStatus: 'Disabled'
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

// Bind apex + www custom domains when a domain name is provided.
// The DNS records that prove ownership are created in the domain module.
resource customDomainApexBinding 'Microsoft.Web/staticSites/customDomains@2024-04-01' = if (!empty(customDomainApex)) {
  parent: swa
  name: customDomainApex
  properties: {
    validationMethod: 'dns-txt-token'
  }
}

resource customDomainWwwBinding 'Microsoft.Web/staticSites/customDomains@2024-04-01' = if (!empty(customDomainApex)) {
  parent: swa
  name: 'www.${customDomainApex}'
  properties: {
    validationMethod: 'cname-delegation'
  }
}

output name string = swa.name
output id string = swa.id
output defaultHostname string = swa.properties.defaultHostname

// The validation token shown to the user in the portal isn't directly
// exposed by ARM; in practice you fetch it via `az staticwebapp hostname show`
// after creating the binding. We expose a stable placeholder string here so
// the domain module can wire DNS once it's known.
output customDomainValidationToken string = empty(customDomainApex) ? '' : (customDomainApexBinding.?properties.validationToken ?? '')
