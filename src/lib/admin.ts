import { escapeHtml as esc } from './html';

interface Session {
  slug: string;
  thumbSlug: string;
  title: string;
  date: string;
  location: string;
  description: string;
  cover: string;
  order: number | null;
  images: string[];
  captions: Record<string, string>;
}

const listEl = document.getElementById('admin-list')!;
const loadingEl = document.getElementById('admin-loading')!;
const errorEl = document.getElementById('admin-error')!;
const modal = document.getElementById('edit-modal')!;
const form = document.getElementById('edit-form') as HTMLFormElement;
const toastEl = document.getElementById('toast')!;

let sessions: Session[] = [];
let blobHost = '';
let editTrigger: HTMLElement | null = null;
let previousBodyOverflow = '';

const signinEl = document.getElementById('admin-signin')!;
const authedEl = document.getElementById('admin-authed')!;

// Check auth state first, then load sessions
fetch('/.auth/me')
  .then((r) => r.json())
  .then((d) => {
    const user = d.clientPrincipal;
    if (user) {
      document.getElementById('admin-user')!.textContent = user.userDetails;
      authedEl.classList.remove('hidden');
      loadSessions();
    } else {
      signinEl.classList.remove('hidden');
    }
  })
  .catch(() => {
    signinEl.classList.remove('hidden');
  });

// Rebuild button
document.getElementById('rebuild-btn')!.addEventListener('click', async () => {
  const btn = document.getElementById('rebuild-btn') as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = 'Triggering…';
  try {
    const res = await fetch('/api/sessionmgr', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      showToast(data.message || 'Build triggered! Site will update in ~5 minutes.');
    } else {
      showToast(data.error || 'Failed to trigger build.');
    }
  } catch {
    showToast('Failed to trigger build.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Rebuild Site';
  }
});

// Tab switching
const tabSessions = document.getElementById('tab-sessions')!;
const tabMessages = document.getElementById('tab-messages')!;
const tabAnalytics = document.getElementById('tab-analytics')!;
const panelSessions = document.getElementById('panel-sessions')!;
const panelMessages = document.getElementById('panel-messages')!;
const panelAnalytics = document.getElementById('panel-analytics')!;
const activeTabClass = 'border-neutral-900 dark:border-white';
const inactiveTabClass = 'border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200';
const tabs = [
  { name: 'sessions' as const, el: tabSessions, panel: panelSessions },
  { name: 'messages' as const, el: tabMessages, panel: panelMessages },
  { name: 'analytics' as const, el: tabAnalytics, panel: panelAnalytics },
];
let messagesLoaded = false;
let analyticsLoaded = false;

function selectTab(tab: 'sessions' | 'messages' | 'analytics') {
  for (const t of tabs) {
    const active = t.name === tab;
    t.panel.classList.toggle('hidden', !active);
    t.el.className = 'border-b-2 px-4 py-2 text-sm font-medium ' + (active ? activeTabClass : inactiveTabClass);
    t.el.setAttribute('aria-selected', String(active));
    t.el.setAttribute('tabindex', active ? '0' : '-1');
  }
  if (tab === 'messages' && !messagesLoaded) {
    messagesLoaded = true;
    loadMessages();
  }
  if (tab === 'analytics' && !analyticsLoaded) {
    analyticsLoaded = true;
    loadAnalytics();
  }
}

tabSessions.addEventListener('click', () => selectTab('sessions'));
tabMessages.addEventListener('click', () => selectTab('messages'));
tabAnalytics.addEventListener('click', () => selectTab('analytics'));
tabs.forEach((tab, index) => {
  tab.el.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    selectTab(tabs[nextIndex].name);
    tabs[nextIndex].el.focus();
  });
});

document.getElementById('analytics-range')!.addEventListener('change', () => loadAnalytics());

interface AnalyticsSummary {
  totalPageviews: number;
  uniqueVisitors: number;
  visits: number;
  avgTimeOnPageMs: number;
  durationCoveragePct: number;
  pagesPerVisit: number;
  singlePageVisitRatePct: number;
}

interface AnalyticsData extends AnalyticsSummary {
  days: number;
  durationSamples: number;
  period: {
    start: string;
    end: string;
    previousStart: string;
    previousEnd: string;
  };
  previous: AnalyticsSummary;
  series: {
    date: string;
    views: number;
    visitors: number;
    visits: number;
    avgTimeOnPageMs: number;
    durationCoveragePct: number;
  }[];
  pages: {
    path: string;
    views: number;
    visitors: number;
    visits: number;
    entries: number;
    avgTimeOnPageMs: number;
    durationCoveragePct: number;
    sharePct: number;
  }[];
  referrers: { source: string; views: number; sharePct: number }[];
}

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm ' + (s % 60) + 's';
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

function fmtDate(value: string, includeYear = false): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(dateValue(value));
}

function fmtLongDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dateValue(value));
}

function fmtRange(start: string, end: string): string {
  return `${fmtDate(start, true)} – ${fmtDate(end, true)}`;
}

function fmtPercent(value: number): string {
  return `${Math.round(value)}%`;
}

function comparison(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? 'No change' : 'New vs prior period';
  const change = Math.round(((current - previous) / previous) * 100);
  if (Math.abs(change) < 1) return 'About even with prior period';
  return `${change > 0 ? '↑' : '↓'} ${Math.abs(change)}% vs prior period`;
}

function summaryCard(
  label: string,
  value: string,
  current: number,
  previous: number,
  detail: string,
): string {
  return `<div class="rounded border border-neutral-200 p-4 dark:border-neutral-700">
    <p class="text-xs font-medium text-neutral-500 dark:text-neutral-400">${esc(label)}</p>
    <p class="mt-2 text-2xl font-semibold tabular-nums">${esc(value)}</p>
    <p class="mt-1 text-xs text-neutral-600 dark:text-neutral-300">${esc(comparison(current, previous))}</p>
    <p class="mt-2 text-xs text-neutral-500 dark:text-neutral-400">${esc(detail)}</p>
  </div>`;
}

function qualityMetric(label: string, value: string, comparisonText: string): string {
  return `<div class="px-1 py-4 sm:px-5">
    <p class="text-xs text-neutral-500 dark:text-neutral-400">${esc(label)}</p>
    <p class="mt-1 text-lg font-semibold tabular-nums">${esc(value)}</p>
    <p class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">${esc(comparisonText)}</p>
  </div>`;
}

function niceMaximum(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const ceiling = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return ceiling * magnitude;
}

function svgElement(name: string, attributes: Record<string, string | number> = {}): SVGElement {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function renderTrafficChart(a: AnalyticsData) {
  const host = document.getElementById('analytics-chart')!;
  const frame = document.getElementById('analytics-chart-frame')!;
  const tooltip = document.getElementById('analytics-tooltip')!;
  host.textContent = '';
  tooltip.classList.add('hidden');

  // Keep native day buttons from overlapping in long ranges. The chart scrolls
  // horizontally when needed, preserving a reliable hover/tap target per day.
  const width = Math.max(host.clientWidth, 720, (a.series.length - 1) * 28 + 80);
  const height = 280;
  const plot = { left: 48, right: 18, top: 18, bottom: 42 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const maximum = niceMaximum(
    Math.max(0, ...a.series.flatMap((point) => [point.views, point.visitors])),
  );
  const x = (index: number) =>
    plot.left + (a.series.length <= 1 ? plotWidth / 2 : (index / (a.series.length - 1)) * plotWidth);
  const y = (value: number) => plot.top + plotHeight - (value / maximum) * plotHeight;

  const svg = svgElement('svg', {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    'aria-hidden': 'true',
  });
  svg.setAttribute('class', 'absolute inset-0 text-neutral-700 dark:text-neutral-300');

  const title = svgElement('title');
  title.textContent = `Daily pageviews and visitors, ${fmtRange(a.period.start, a.period.end)}`;
  svg.appendChild(title);

  for (let index = 0; index <= 4; index++) {
    const value = (maximum / 4) * index;
    const tickY = y(value);
    svg.appendChild(svgElement('line', {
      x1: plot.left,
      x2: width - plot.right,
      y1: tickY,
      y2: tickY,
      stroke: 'currentColor',
      opacity: index === 0 ? 0.35 : 0.12,
      'vector-effect': 'non-scaling-stroke',
    }));
    const label = svgElement('text', {
      x: plot.left - 8,
      y: tickY + 4,
      'text-anchor': 'end',
      fill: 'currentColor',
      'font-size': 11,
      opacity: 0.7,
    });
    label.textContent = String(Math.round(value));
    svg.appendChild(label);
  }

  const labelStep = Math.max(1, Math.ceil((a.series.length - 1) / 6));
  a.series.forEach((point, index) => {
    if (index % labelStep !== 0 && index !== a.series.length - 1) return;
    const label = svgElement('text', {
      x: x(index),
      y: height - 14,
      'text-anchor': index === 0 ? 'start' : index === a.series.length - 1 ? 'end' : 'middle',
      fill: 'currentColor',
      'font-size': 11,
      opacity: 0.7,
    });
    label.textContent = fmtDate(point.date);
    svg.appendChild(label);
  });

  const viewPoints = a.series.map((point, index) => `${x(index)},${y(point.views)}`);
  const visitorPoints = a.series.map((point, index) => `${x(index)},${y(point.visitors)}`);
  if (viewPoints.length > 1) {
    const area = svgElement('path', {
      d: `M ${x(0)} ${y(0)} L ${viewPoints.join(' L ')} L ${x(a.series.length - 1)} ${y(0)} Z`,
      fill: '#a3a3a3',
      opacity: 0.12,
    });
    svg.appendChild(area);
  }

  const viewsLine = svgElement('polyline', {
    points: viewPoints.join(' '),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2.5,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke',
  });
  svg.appendChild(viewsLine);

  const visitorLine = svgElement('polyline', {
    points: visitorPoints.join(' '),
    fill: 'none',
    stroke: '#0d9488',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke',
  });
  svg.appendChild(visitorLine);

  const guide = svgElement('line', {
    y1: plot.top,
    y2: y(0),
    stroke: 'currentColor',
    opacity: 0,
    'stroke-dasharray': '3 3',
    'vector-effect': 'non-scaling-stroke',
  });
  svg.appendChild(guide);

  const showTooltip = (
    point: AnalyticsData['series'][number],
    target: HTMLElement,
    xCoordinate: number,
  ) => {
    tooltip.textContent = '';
    const heading = document.createElement('p');
    heading.className = 'font-medium';
    heading.textContent = fmtLongDate(point.date);
    const details = document.createElement('dl');
    details.className = 'mt-1 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 tabular-nums';
    const values = [
      ['Pageviews', point.views.toLocaleString()],
      ['Daily visitors', point.visitors.toLocaleString()],
      ['Visits', point.visits.toLocaleString()],
      ['Avg. measured time', fmtDuration(point.avgTimeOnPageMs)],
      ['Time coverage', fmtPercent(point.durationCoveragePct)],
    ];
    for (const [label, value] of values) {
      const term = document.createElement('dt');
      term.className = 'text-neutral-500 dark:text-neutral-400';
      term.textContent = label;
      const description = document.createElement('dd');
      description.className = 'text-right';
      description.textContent = value;
      details.append(term, description);
    }
    tooltip.append(heading, details);
    tooltip.classList.remove('hidden');

    guide.setAttribute('x1', String(xCoordinate));
    guide.setAttribute('x2', String(xCoordinate));
    guide.setAttribute('opacity', '0.25');

    requestAnimationFrame(() => {
      const frameRect = frame.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const desired = targetRect.left - frameRect.left + targetRect.width / 2;
      const tooltipWidth = tooltip.getBoundingClientRect().width;
      const left = Math.max(8, Math.min(desired - tooltipWidth / 2, frameRect.width - tooltipWidth - 8));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = '8px';
    });
  };
  const hideTooltip = () => {
    tooltip.classList.add('hidden');
    guide.setAttribute('opacity', '0');
  };

  const chartCanvas = document.createElement('div');
  chartCanvas.className = 'relative';
  chartCanvas.style.width = `${width}px`;
  chartCanvas.style.height = `${height}px`;
  chartCanvas.style.minWidth = `${width}px`;
  chartCanvas.appendChild(svg);

  a.series.forEach((point, index) => {
    const target = document.createElement('button');
    target.type = 'button';
    target.className = 'absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full';
    target.style.left = `${x(index)}px`;
    target.style.top = `${y(point.views)}px`;
    target.setAttribute(
      'aria-label',
      `${fmtLongDate(point.date)}: ${point.views} pageviews, ${point.visitors} daily visitors, ${point.visits} visits, ${fmtDuration(point.avgTimeOnPageMs)} average measured time`,
    );
    const dot = document.createElement('span');
    dot.className = 'h-2 w-2 rounded-full bg-neutral-800 transition-transform dark:bg-neutral-100';
    dot.setAttribute('aria-hidden', 'true');
    target.appendChild(dot);
    target.addEventListener('mouseenter', () => showTooltip(point, target, x(index)));
    target.addEventListener('mouseleave', hideTooltip);
    target.addEventListener('focus', () => {
      dot.classList.add('scale-150');
      showTooltip(point, target, x(index));
    });
    target.addEventListener('blur', () => {
      dot.classList.remove('scale-150');
      hideTooltip();
    });
    chartCanvas.appendChild(target);
  });
  host.appendChild(chartCanvas);

  const table = document.createElement('table');
  table.className = 'sr-only';
  table.innerHTML = `<caption>Daily traffic for ${esc(fmtRange(a.period.start, a.period.end))}</caption>
    <thead><tr><th>Date</th><th>Pageviews</th><th>Visitors</th><th>Visits</th><th>Average measured time</th><th>Coverage</th></tr></thead>
    <tbody>${a.series.map((point) => `<tr><th>${esc(fmtLongDate(point.date))}</th><td>${point.views}</td><td>${point.visitors}</td><td>${point.visits}</td><td>${esc(fmtDuration(point.avgTimeOnPageMs))}</td><td>${esc(fmtPercent(point.durationCoveragePct))}</td></tr>`).join('')}</tbody>`;
  host.appendChild(table);
}

let analyticsRequest: AbortController | undefined;

async function loadAnalytics() {
  const loading = document.getElementById('analytics-loading')!;
  const error = document.getElementById('analytics-error')!;
  const content = document.getElementById('analytics-content')!;
  const range = (document.getElementById('analytics-range') as HTMLSelectElement).value;
  analyticsRequest?.abort();
  const controller = new AbortController();
  analyticsRequest = controller;
  loading.classList.remove('hidden');
  error.classList.add('hidden');
  content.classList.add('hidden');
  panelAnalytics.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch('/api/sessionmgr?type=analytics&days=' + encodeURIComponent(range), {
      signal: controller.signal,
    });
    if (res.status === 403) {
      loading.classList.add('hidden');
      error.textContent = 'Access denied.';
      error.classList.remove('hidden');
      return;
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to load analytics.');
    renderAnalytics(data.analytics as AnalyticsData);
    loading.classList.add('hidden');
    content.classList.remove('hidden');
  } catch (err: any) {
    if (err.name === 'AbortError') return;
    loading.classList.add('hidden');
    error.textContent = err.message;
    error.classList.remove('hidden');
  } finally {
    if (analyticsRequest === controller) {
      analyticsRequest = undefined;
      panelAnalytics.removeAttribute('aria-busy');
    }
  }
}

function renderAnalytics(a: AnalyticsData) {
  document.getElementById('analytics-period')!.textContent =
    `${fmtRange(a.period.start, a.period.end)} · compared with ${fmtRange(a.period.previousStart, a.period.previousEnd)}`;

  const cards = document.getElementById('analytics-cards')!;
  cards.innerHTML =
    summaryCard(
      'Pageviews',
      a.totalPageviews.toLocaleString(),
      a.totalPageviews,
      a.previous.totalPageviews,
      `${a.pages.length} viewed route${a.pages.length === 1 ? '' : 's'}`,
    ) +
    summaryCard(
      'Daily unique visitors',
      a.uniqueVisitors.toLocaleString(),
      a.uniqueVisitors,
      a.previous.uniqueVisitors,
      'Privacy count resets each day',
    ) +
    summaryCard(
      'Visits',
      a.visits.toLocaleString(),
      a.visits,
      a.previous.visits,
      `${a.pagesPerVisit.toFixed(2)} pages per visit`,
    ) +
    summaryCard(
      'Avg. measured time',
      fmtDuration(a.avgTimeOnPageMs),
      a.avgTimeOnPageMs,
      a.previous.avgTimeOnPageMs,
      `${fmtPercent(a.durationCoveragePct)} of pageviews measured`,
    );

  renderTrafficChart(a);

  document.getElementById('analytics-quality')!.innerHTML =
    qualityMetric(
      'Pages per visit',
      a.pagesPerVisit.toFixed(2),
      comparison(a.pagesPerVisit, a.previous.pagesPerVisit),
    ) +
    qualityMetric(
      'Single-page visits',
      fmtPercent(a.singlePageVisitRatePct),
      comparison(a.singlePageVisitRatePct, a.previous.singlePageVisitRatePct),
    ) +
    qualityMetric(
      'Measured time coverage',
      fmtPercent(a.durationCoveragePct),
      `${a.durationSamples.toLocaleString()} of ${a.totalPageviews.toLocaleString()} pageviews`,
    );

  const pages = document.getElementById('analytics-pages')!;
  pages.innerHTML = a.pages.length
    ? a.pages
        .map(
          (p) =>
            `<tr>
              <th scope="row" class="max-w-xs px-3 py-2 font-normal"><a href="${esc(p.path)}" target="_blank" rel="noopener" class="block truncate text-neutral-700 dark:text-neutral-300">${esc(p.path)}</a></th>
              <td class="px-3 py-2 text-right tabular-nums"><span class="block">${p.views.toLocaleString()}</span><span class="block text-xs text-neutral-500">${fmtPercent(p.sharePct)}</span></td>
              <td class="px-3 py-2 text-right tabular-nums">${p.visitors.toLocaleString()}</td>
              <td class="px-3 py-2 text-right tabular-nums">${p.entries.toLocaleString()}</td>
              <td class="px-3 py-2 text-right tabular-nums">${esc(fmtDuration(p.avgTimeOnPageMs))}</td>
              <td class="px-3 py-2 text-right tabular-nums text-neutral-500 dark:text-neutral-400">${esc(fmtPercent(p.durationCoveragePct))}</td>
            </tr>`,
        )
        .join('')
    : '<tr><td colspan="6" class="px-3 py-8 text-center text-neutral-500 dark:text-neutral-400">No pageviews in this period.</td></tr>';

  const refs = document.getElementById('analytics-referrers')!;
  refs.innerHTML = a.referrers.length
    ? a.referrers
        .map(
          (r) =>
            `<tr>
              <th scope="row" class="px-3 py-2 font-normal text-neutral-700 dark:text-neutral-300">${esc(r.source)}</th>
              <td class="px-3 py-2 text-right tabular-nums">${r.views.toLocaleString()}</td>
              <td class="px-3 py-2 text-right tabular-nums text-neutral-500 dark:text-neutral-400">${esc(fmtPercent(r.sharePct))}</td>
            </tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="px-3 py-8 text-center text-neutral-500 dark:text-neutral-400">No acquisition data in this period.</td></tr>';
}

interface Message {
  id: string;
  name: string;
  email: string;
  message: string;
  submittedAt: string;
  read: boolean;
}

async function loadMessages() {
  const loading = document.getElementById('messages-loading')!;
  const error = document.getElementById('messages-error')!;
  const list = document.getElementById('messages-list')!;
  try {
    const res = await fetch('/api/sessionmgr?type=messages');
    if (res.status === 403) {
      loading.classList.add('hidden');
      error.textContent = 'Access denied.';
      error.classList.remove('hidden');
      return;
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to load messages.');

    loading.classList.add('hidden');
    list.classList.remove('hidden');
    list.innerHTML = '';

    if (!data.messages.length) {
      list.innerHTML = '<li class="py-10 text-center text-neutral-500 dark:text-neutral-400">No messages yet.</li>';
      return;
    }

    for (const m of data.messages as Message[]) {
      const li = document.createElement('li');
      li.className = 'rounded-lg border border-neutral-200 p-4 dark:border-neutral-700';
      const when = m.submittedAt ? new Date(m.submittedAt).toLocaleString() : '';
      li.innerHTML = `
        <div class="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <span class="font-medium">${esc(m.name)}</span>
          <span class="text-xs text-neutral-500 dark:text-neutral-400">${esc(when)}</span>
        </div>
        <a href="mailto:${esc(m.email)}" class="text-sm text-neutral-600 hover:underline dark:text-neutral-400">${esc(m.email)}</a>
        <p class="mt-2 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">${esc(m.message)}</p>
      `;
      list.appendChild(li);
    }
  } catch (err: any) {
    loading.classList.add('hidden');
    error.textContent = err.message;
    error.classList.remove('hidden');
  }
}

async function loadSessions() {
  try {
    const res = await fetch('/api/sessionmgr');
    if (res.redirected || res.status === 401 || res.status === 302) {
      window.location.href = '/.auth/login/github?post_login_redirect_uri=/admin';
      return;
    }
    if (res.status === 403) {
      loadingEl.classList.add('hidden');
      errorEl.textContent = 'Access denied. Your GitHub account is not authorized for admin.';
      errorEl.classList.remove('hidden');
      return;
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Unexpected response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!data.ok) throw new Error(data.error || 'Failed to load sessions.');
    sessions = (data.sessions as Session[]).map((session) => ({
      ...session,
      captions: session.captions || {},
    }));
    blobHost = data.blobHost || '';
    renderList();
  } catch (err: any) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

function renderList() {
  loadingEl.classList.add('hidden');
  listEl.classList.remove('hidden');
  listEl.innerHTML = '';

  if (sessions.length === 0) {
    listEl.innerHTML =
      '<li class="py-10 text-center text-neutral-500 dark:text-neutral-400">No sessions found in blob storage.</li>';
    return;
  }

  // Match the public site's "orderThenDateDesc" policy: explicit order first
  // (ascending), then by date descending (newest first).
  const ordered = [...sessions].sort((a, b) => {
    const ao = a.order;
    const bo = b.order;
    if (ao != null && bo != null) return ao - bo;
    if (ao != null) return -1;
    if (bo != null) return 1;
    return (b.date || '').localeCompare(a.date || '');
  });

  for (const s of ordered) {
    const captionCount = Object.keys(s.captions).length;
    const li = document.createElement('li');
    li.className =
      'flex items-center justify-between gap-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700';
    li.innerHTML = `
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium">${esc(s.title)}</p>
        <p class="mt-0.5 truncate text-sm text-neutral-500 dark:text-neutral-400">
          ${esc(s.slug)}${s.date ? ' · ' + esc(s.date) : ''}${s.location ? ' · ' + esc(s.location) : ''}
          · ${s.images.length} image${s.images.length !== 1 ? 's' : ''}
          · ${captionCount}/${s.images.length} captioned
          ${s.cover ? ' · cover: ' + esc(s.cover) : ''}
          ${s.order != null ? ' · order: ' + s.order : ''}
        </p>
      </div>
      <button
        data-slug="${esc(s.slug)}"
        class="admin-edit shrink-0 rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
      >Edit</button>
    `;
    listEl.appendChild(li);
  }

  listEl.querySelectorAll('.admin-edit').forEach((btn) => {
    btn.addEventListener('click', () => openEdit((btn as HTMLElement).dataset.slug!, btn as HTMLElement));
  });
}

function openEdit(slug: string, trigger?: HTMLElement) {
  const s = sessions.find((x) => x.slug === slug);
  if (!s) return;
  editTrigger = trigger ?? (document.activeElement as HTMLElement | null);
  previousBodyOverflow = document.body.style.overflow;

  (document.getElementById('edit-slug') as HTMLInputElement).value = s.slug;
  (document.getElementById('edit-title') as HTMLInputElement).value = s.title;
  (document.getElementById('edit-location') as HTMLInputElement).value = s.location;
  (document.getElementById('edit-description') as HTMLTextAreaElement).value = s.description;
  document.getElementById('edit-modal-title')!.textContent = `Edit: ${s.title}`;

  const orderEl = document.getElementById('edit-order') as HTMLInputElement;
  orderEl.value = s.order != null ? String(s.order) : '';

  // Populate cover thumbnail grid
  const coverInput = document.getElementById('edit-cover') as HTMLInputElement;
  const grid = document.getElementById('edit-cover-grid')!;
  grid.innerHTML = '';

  // "Auto" option
  const autoBtn = document.createElement('button');
  autoBtn.type = 'button';
  autoBtn.className = 'flex h-16 items-center justify-center rounded border-2 text-xs ' +
    (!s.cover ? 'border-neutral-900 dark:border-white' : 'border-transparent opacity-60 hover:opacity-100');
  autoBtn.textContent = 'Auto';
  autoBtn.addEventListener('click', () => {
    coverInput.value = '';
    grid.querySelectorAll('button').forEach((b) => {
      b.className = b.className.replace(/border-neutral-900|dark:border-white/g, 'border-transparent');
    });
    autoBtn.className = autoBtn.className.replace('border-transparent', 'border-neutral-900 dark:border-white').replace('opacity-60', '');
  });
  grid.appendChild(autoBtn);

  for (const img of s.images) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isSelected = img === s.cover;
    btn.className = 'relative overflow-hidden rounded border-2 ' +
      (isSelected ? 'border-neutral-900 dark:border-white' : 'border-transparent opacity-60 hover:opacity-100');
    btn.innerHTML = `<img src="${thumbUrl(blobHost, s.thumbSlug, img)}" alt="${esc(img)}" loading="lazy" class="h-16 w-full object-cover" />`;
    btn.title = img;
    btn.addEventListener('click', () => {
      coverInput.value = img;
      grid.querySelectorAll('button').forEach((b) => {
        b.className = b.className.replace(/border-neutral-900|dark:border-white/g, 'border-transparent');
        if (!b.textContent?.startsWith('Auto')) b.classList.add('opacity-60');
      });
      btn.className = btn.className.replace('border-transparent', 'border-neutral-900 dark:border-white').replace('opacity-60', '');
    });
    grid.appendChild(btn);
  }

  coverInput.value = s.cover;

  const captionDetails = document.getElementById('edit-captions') as HTMLDetailsElement;
  const captionList = document.getElementById('edit-caption-list')!;
  const captionCount = document.getElementById('edit-caption-count')!;
  captionList.textContent = '';

  const updateCaptionCount = () => {
    const completed = captionList.querySelectorAll<HTMLInputElement>('input[data-caption-file]');
    const count = [...completed].filter((input) => input.value.trim()).length;
    captionCount.textContent = `${count}/${s.images.length}`;
  };

  for (const img of s.images) {
    const label = document.createElement('label');
    label.className = 'grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-3';

    const thumbnail = document.createElement('img');
    thumbnail.src = thumbUrl(blobHost, s.thumbSlug, img);
    thumbnail.alt = '';
    thumbnail.loading = 'lazy';
    thumbnail.className = 'h-12 w-16 rounded object-cover';

    const field = document.createElement('span');
    field.className = 'min-w-0';
    const filename = document.createElement('span');
    filename.className = 'mb-1 block truncate text-xs text-neutral-500 dark:text-neutral-400';
    filename.textContent = img;
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 500;
    input.value = s.captions[img] || '';
    input.dataset.captionFile = img;
    input.placeholder = 'Optional caption';
    input.className = 'w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800';
    input.addEventListener('input', updateCaptionCount);

    field.append(filename, input);
    label.append(thumbnail, field);
    captionList.appendChild(label);
  }
  captionDetails.open = Object.keys(s.captions).length > 0;
  updateCaptionCount();

  document.getElementById('edit-error')!.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'false');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  document.body.style.overflow = 'hidden';
  (document.getElementById('edit-title') as HTMLInputElement).focus();
}

function closeEdit() {
  if (modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = previousBodyOverflow;
  const slug = (document.getElementById('edit-slug') as HTMLInputElement).value;
  const replacement = listEl.querySelector<HTMLElement>(`.admin-edit[data-slug="${CSS.escape(slug)}"]`);
  (editTrigger?.isConnected ? editTrigger : replacement)?.focus();
  editTrigger = null;
}

function modalFocusableElements(): HTMLElement[] {
  return Array.from(
    modal.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.getClientRects().length > 0);
}

document.getElementById('edit-cancel')!.addEventListener('click', closeEdit);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeEdit();
});
document.addEventListener('keydown', (e) => {
  if (modal.classList.contains('hidden')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeEdit();
    return;
  }
  if (e.key !== 'Tab') return;
  const focusable = modalFocusableElements();
  if (focusable.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) {
    e.preventDefault();
    first.focus();
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById('edit-save') as HTMLButtonElement;
  const errEl = document.getElementById('edit-error')!;
  errEl.classList.add('hidden');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  const slug = (document.getElementById('edit-slug') as HTMLInputElement).value;
  const orderRaw = (document.getElementById('edit-order') as HTMLInputElement).value.trim();
  const activeSession = sessions.find((session) => session.slug === slug);
  const captionValues = new Map(
    [...document.querySelectorAll<HTMLInputElement>('#edit-caption-list input[data-caption-file]')]
      .map((input) => [input.dataset.captionFile!, input.value.trim()]),
  );
  const images = activeSession?.images.map((file) => ({
    file,
    caption: captionValues.get(file) || '',
  }));

  const body = {
    slug,
    title: (document.getElementById('edit-title') as HTMLInputElement).value.trim(),
    location: (document.getElementById('edit-location') as HTMLInputElement).value.trim(),
    description: (document.getElementById('edit-description') as HTMLTextAreaElement).value.trim(),
    cover: (document.getElementById('edit-cover') as HTMLInputElement).value,
    order: orderRaw === '' ? null : parseInt(orderRaw, 10),
    images,
  };

  try {
    const res = await fetch('/api/sessionmgr', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error((data.errors || [data.error]).join(' '));

    // Update local state
    const s = sessions.find((x) => x.slug === slug);
    if (s) {
      if (body.title !== undefined) s.title = body.title;
      if (body.cover !== undefined) s.cover = body.cover;
      if (body.order !== undefined) s.order = body.order;
      if (body.location !== undefined) s.location = body.location;
      if (body.description !== undefined) s.description = body.description;
      if (body.images !== undefined) {
        s.captions = Object.fromEntries(
          body.images
            .filter((image) => image.caption)
            .map((image) => [image.file, image.caption]),
        );
      }
    }
    renderList();
    closeEdit();
    showToast('Saved! Click Rebuild Site to deploy (~5 min) or wait for the next cron.');
  } catch (err: any) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }
});

function showToast(msg: string) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  setTimeout(() => toastEl.classList.add('hidden'), 6000);
}

function thumbUrl(host: string, slug: string, file: string): string {
  // Use tiny pre-generated thumbnails from variants/thumbs/ (120px wide, ~5KB).
  const base = file.slice(0, file.lastIndexOf('.'));
  return `https://${host}/variants/thumbs/${encodeURIComponent(slug)}/${encodeURIComponent(`${base}.jpg`)}`;
}
