/**
 * Inline dark-mode bootstrap. Inserted in <head> before any rendering so the
 * correct theme is set before paint — avoids the "flash of wrong theme."
 *
 * Honor order:
 *   1. localStorage['theme'] if set ('light' | 'dark')
 *   2. window.matchMedia('(prefers-color-scheme: dark)')
 */
export const themeBootstrap = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var useDark = stored ? stored === 'dark' : prefersDark;
    if (useDark) document.documentElement.classList.add('dark');
  } catch (_) {}
})();
`.trim();
