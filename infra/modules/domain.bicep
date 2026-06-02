@description('Apex domain to register, e.g. yourname.com.')
param domainName string

@description('Contact information. Required for first-time domain registration. Consumed by the bootstrap `az appservice domain create` call, not by Bicep directly; declared here so callers can pass it through main.parameters.json.')
#disable-next-line no-unused-params
param contact object

@description('SWA default hostname to point DNS at.')
param swaHostname string

@description('Validation token from SWA custom-domain binding.')
param swaCustomDomainValidationToken string

@description('Tags. Applied to records that support them.')
#disable-next-line no-unused-params
param tags object

/*
 * App Service Domain registration.
 *
 * IMPORTANT: First-time domain purchase requires interactive acceptance of the
 * legal agreement. Run this once manually:
 *   az appservice domain create \
 *     --resource-group <rg> \
 *     --hostname <domain> \
 *     --contact-info @contact.json \
 *     --accept-terms
 *
 * After purchase, this Bicep manages the record set inside the auto-created
 * DNS zone (`Microsoft.Network/dnsZones`).
 */

// The DNS zone is auto-provisioned by App Service Domain. Reference it as existing.
resource dnsZone 'Microsoft.Network/dnsZones@2018-05-01' existing = {
  name: domainName
}

// Apex A record (alias) pointing to SWA via Azure DNS alias-to-cname.
// SWA's hostname is a CNAME target; for apex we use an ALIAS A record.
resource aRecord 'Microsoft.Network/dnsZones/A@2018-05-01' = {
  parent: dnsZone
  name: '@'
  properties: {
    TTL: 3600
    targetResource: {}
    ARecords: []
    // Azure DNS supports CNAME-at-apex via "alias", but SWA documents using
    // standard A records. The recommended path is to use ALIAS via
    // targetResource pointing at the SWA. As of 2024 SWA isn't a valid
    // alias target — so we'll create the A record manually post-deploy
    // by running scripts/bind-domain.sh, which uses `az staticwebapp hostname`.
    // This placeholder record will be overwritten by that script.
    metadata: {
      note: 'placeholder; overwritten by scripts/bind-domain.sh'
    }
  }
}

resource cnameWww 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: dnsZone
  name: 'www'
  properties: {
    TTL: 3600
    CNAMERecord: {
      cname: swaHostname
    }
  }
}

// TXT record for SWA's domain-ownership challenge on the apex binding.
resource txtValidation 'Microsoft.Network/dnsZones/TXT@2018-05-01' = if (!empty(swaCustomDomainValidationToken)) {
  parent: dnsZone
  name: '@'
  properties: {
    TTL: 3600
    TXTRecords: [
      {
        value: [ swaCustomDomainValidationToken ]
      }
    ]
  }
}

output dnsZoneName string = dnsZone.name
