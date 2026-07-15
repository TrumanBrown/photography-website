function canonicalHost(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const input = value.includes('://') ? value : `https://${value}`;
    return new URL(input).hostname.toLowerCase().replace(/^www\./, '').slice(0, 100);
  } catch {
    return '';
  }
}

function externalReferrerHost(referrer, ownHost) {
  const ref = canonicalHost(referrer);
  if (!ref || ref === canonicalHost(ownHost)) return '';
  return ref;
}

module.exports = { canonicalHost, externalReferrerHost };