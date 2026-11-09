// Sorts a network owner (the "autonomous system organization" DB-IP gives for
// an IP) into a kind, so the admin panel can tell a company network from home
// internet, a phone carrier, a VPN or a server. Only `org` and `mixed` can
// name an employer, and `mixed` only maybe.
//
// Kinds:
//   home     home broadband and mobile carriers
//   relay    privacy relays and VPNs (iCloud Private Relay, WARP, VPN hosts)
//   proxy    corporate web proxies that hide the company behind them
//   scanner  email security services that open every link in a message
//   cloud    hosting and cloud providers
//   mixed    companies whose offices and clouds share network numbers
//   org      anything else, usually the organization itself
//   ''       unknown (no lookup)

const HOME_FIRST = /^google fiber\b/i;

const MIXED =
  /^(microsoft|google|amazon|oracle|ibm|international business machines)\b/i;

const SCANNER =
  /\b(proofpoint|mimecast|barracuda|ironport|trend ?micro|sophos|messagelabs|agari|abnormal security|cloudmark|appriver|spamtitan|vade secure|libraesva|hornetsecurity|perception point|area 1 security)\b/i;

const PROXY =
  /\b(zscaler|netskope|palo alto networks|menlo security|iboss|cisco umbrella|opendns|skyhigh security|forcepoint|symantec|cato networks)\b/i;

const CLOUD =
  /\b(digitalocean|linode|akamai connected cloud|ovh|hetzner|vultr|choopa|the constant company|alibaba|tencent|softlayer|scaleway|online s\.a\.s|contabo|leaseweb|hostinger|hostwinds|godaddy|ionos|rackspace|equinix|cogent|hurricane electric|zayo|colocrossing|psychz|quadranet|g-core|gcore|cdn77|datapacket|netcup|upcloud|heroku|fly\.io|vercel|netlify)\b/i;

const RELAY =
  /\b(akamai|cloudflare|fastly|m247|datacamp|tefincom|nordvpn|nord security|mullvad|31173 services|proton ag|kape|surfshark|expressvpn|express technologies|ipvanish|private internet access|packethub|hostroyale|clouvider|windscribe|tunnelbear|cyberghost|torguard|vpn)\b/i;

const HOME =
  /\b(comcast|charter communications|spectrum|time warner|at&t|att-internet|verizon|cellco|t-mobile|sprint|us cellular|united states cellular|lumen|centurylink|qwest|level 3|cox communications|frontier communications|ziply|starlink|space exploration technologies|altice|optimum|cablevision|suddenlink|windstream|mediacom|rcn|astound|wavedivision|wave broadband|sonic telecom|earthlink|viasat|hughes network|consolidated communications|tds telecom|cincinnati bell|altafiber|bell canada|rogers|telus|shaw|videotron|cogeco|vodafone|british telecommunications|virgin media|talktalk|sky broadband|deutsche telekom|telekom|orange|telefonica|movistar|hutchison|reliance jio|bharti|airtel|telstra|optus|tpg|singtel|starhub|ntt docomo|kddi|softbank|china telecom|china unicom|china mobile|chunghwa|sk broadband|claro|bouygues|iliad|swisscom|kpn|ziggo|proximus|telenor|telia|elisa|cable|broadband|wireless|mobile|cellular|telecom|telecommunications|telcom|fiber|fibre|internet service)\b/i;

function orgKind(org) {
  const name = typeof org === "string" ? org.trim() : "";
  if (!name) return "";
  if (HOME_FIRST.test(name)) return "home";
  if (MIXED.test(name)) return "mixed";
  if (SCANNER.test(name)) return "scanner";
  if (PROXY.test(name)) return "proxy";
  if (CLOUD.test(name)) return "cloud";
  if (RELAY.test(name)) return "relay";
  if (HOME.test(name)) return "home";
  return "org";
}

module.exports = { orgKind };
