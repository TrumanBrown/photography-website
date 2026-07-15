// Privacy-friendly pageview beacon. Sends a pageview on load and a
// time-on-page measurement when the visitor leaves. No cookies; sessionId is
// ephemeral (sessionStorage, cleared when the tab closes). The /admin pages
// are never tracked.

function rand(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function track() {
  // Astro dev does not host the SWA Functions; avoid noisy local 404s.
  if (import.meta.env.DEV) return;

  // Don't track the admin tool or automated browser contexts.
  if (location.pathname.startsWith('/admin')) return;
  if (navigator.webdriver) return;

  let sid = sessionStorage.getItem('tb_sid');
  if (!sid) {
    sid = rand();
    sessionStorage.setItem('tb_sid', sid);
  }
  const pvid = rand();
  const start = Date.now();

  // Pageview on load — use keepalive so it survives a fast navigation.
  try {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'pv', path: location.pathname, ref: document.referrer, sid, pvid }),
      keepalive: true,
    }).catch(() => {});
  } catch {}

  // Time-on-page when the tab is hidden/closed. sendBeacon is reliable here.
  let sent = false;
  function sendDuration() {
    if (sent) return;
    sent = true;
    const dur = Date.now() - start;
    try {
      const blob = new Blob([JSON.stringify({ type: 'dur', sid, pvid, dur })], {
        type: 'application/json',
      });
      navigator.sendBeacon('/api/track', blob);
    } catch {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendDuration();
  });
  window.addEventListener('pagehide', sendDuration);
}

track();
