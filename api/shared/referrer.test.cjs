const { canonicalHost, externalReferrerHost } = require('./referrer');

describe('referrer host normalization', () => {
  it('normalizes scheme, case, www, ports, and paths', () => {
    expect(canonicalHost('https://www.TrumanBrown.com:443/sessions/example')).toBe(
      'trumanbrown.com',
    );
  });

  it('drops apex and www self-referrals', () => {
    expect(externalReferrerHost('https://www.trumanbrown.com/page', 'trumanbrown.com')).toBe('');
    expect(externalReferrerHost('https://trumanbrown.com/page', 'www.trumanbrown.com')).toBe('');
  });

  it('retains only the hostname for external referrals', () => {
    expect(externalReferrerHost('https://search.brave.com/search?q=photos', 'trumanbrown.com')).toBe(
      'search.brave.com',
    );
  });

  it('returns empty for invalid or absent referrers', () => {
    expect(externalReferrerHost('', 'trumanbrown.com')).toBe('');
    expect(externalReferrerHost('not a url', 'trumanbrown.com')).toBe('');
  });
});