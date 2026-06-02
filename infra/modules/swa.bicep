@description('Static Web App name.')
param name string

@description('Region. SWA Free is only available in a few regions; the module maps your RG region onto a supported one.')
param location string

@description('Tags.')
param tags object

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

// NOTE: custom-domain bindings (apex + www) are NOT created in Bicep because
// they require DNS records to already exist for validation, but the DNS
// records (CNAME + TXT) need the SWA validation token, which only exists
// after binding creation begins. Chicken-and-egg.
//
// Bindings are created post-deploy by scripts/bind-domain.sh, which:
//   1. starts the apex binding with dns-txt-token validation
//   2. fetches the resulting validation token
//   3. writes the TXT record
//   4. writes the A apex record (alias to SWA)
//   5. completes validation
//   6. binds www via cname-delegation (CNAME already in DNS from Bicep)

output name string = swa.name
output id string = swa.id
output defaultHostname string = swa.properties.defaultHostname
