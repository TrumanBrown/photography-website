@description('Apex domain (the DNS zone name), e.g. yourname.com.')
param domainName string

@description('SWA default hostname (e.g. <random>.azurestaticapps.net) for the www CNAME.')
param swaHostname string

@description('Tags. Reserved; DNS record sets do not currently support tags.')
#disable-next-line no-unused-params
param tags object

/*
 * The DNS zone is auto-provisioned by App Service Domain at the time of
 * domain purchase. We reference it as existing and add records that don't
 * depend on the SWA validation token.
 *
 * Records the Bicep manages here:
 *   - CNAME www  → SWA default hostname  (used by SWA's cname-delegation
 *                                          validation for the www binding)
 *
 * Records created later by scripts/bind-domain.sh (after SWA bindings exist):
 *   - A @   (alias, target = SWA resource id)
 *   - TXT @ (SWA's apex ownership-token)
 */

resource dnsZone 'Microsoft.Network/dnsZones@2018-05-01' existing = {
  name: domainName
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

output dnsZoneName string = dnsZone.name
