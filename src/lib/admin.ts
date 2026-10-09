import { escapeHtml as esc } from './html';
import {
  clampPanelSize,
  clampTileSize,
  defaultPanelSize,
  draftFromSession,
  draftSignature,
  filterSessions,
  fitsBanner,
  fitsLeadBox,
  fullPanelSize,
  imagesPayload,
  isEditorMode,
  previewUrl,
  ratioLabel,
  sessionFlags,
  thumbSrcSet,
  thumbUrl,
  type AdminSession,
  type Draft,
  type EditorMode,
  type SessionFilter,
} from './admin-ui';

const listEl = document.getElementById('admin-list')!;
const emptyEl = document.getElementById('admin-empty')!;
const toolbarEl = document.getElementById('admin-toolbar')!;
const countEl = document.getElementById('session-count')!;
const searchEl = document.getElementById('session-search') as HTMLInputElement;
const filterEl = document.getElementById('session-filter') as HTMLSelectElement;
const loadingEl = document.getElementById('admin-loading')!;
const errorEl = document.getElementById('admin-error')!;
const modal = document.getElementById('edit-modal')!;
const panel = document.getElementById('edit-panel')!;
const form = document.getElementById('edit-form') as HTMLFormElement;
const gridEl = document.getElementById('edit-grid')!;
const toastEl = document.getElementById('toast')!;

let sessions: AdminSession[] = [];
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
  btn.textContent = 'Triggering...';
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

// ---------------------------------------------------------------------------
// Sessions list
// ---------------------------------------------------------------------------

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
    sessions = (data.sessions as AdminSession[]).map((session) => ({
      ...session,
      captions: session.captions || {},
      banner: session.banner || '',
      showcase: session.showcase || [],
      ratios: session.ratios || {},
      urls: session.urls || {},
    }));
    blobHost = data.blobHost || '';
    renderList();
  } catch (err: any) {
    loadingEl.classList.add('hidden');
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
}

type BadgeTone = 'muted' | 'warn' | 'good';

function badge(text: string, tone: BadgeTone = 'muted'): string {
  const tones: Record<BadgeTone, string> = {
    muted: 'border-neutral-300 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400',
    warn: 'border-amber-400 text-amber-700 dark:border-amber-500 dark:text-amber-300',
    good: 'border-teal-500 text-teal-700 dark:border-teal-400 dark:text-teal-300',
  };
  return `<span class="rounded-full border px-2 py-0.5 text-[11px] ${tones[tone]}">${esc(text)}</span>`;
}

function renderList() {
  loadingEl.classList.add('hidden');
  toolbarEl.classList.remove('hidden');
  toolbarEl.classList.add('flex');
  listEl.textContent = '';

  if (sessions.length === 0) {
    listEl.classList.add('hidden');
    countEl.textContent = '';
    emptyEl.textContent = 'No sessions found in blob storage.';
    emptyEl.classList.remove('hidden');
    return;
  }

  const filter = (filterEl.value || 'all') as SessionFilter;
  const visible = filterSessions(sessions, { query: searchEl.value, filter });

  countEl.textContent =
    visible.length === sessions.length
      ? `${sessions.length} session${sessions.length !== 1 ? 's' : ''}`
      : `${visible.length} of ${sessions.length} sessions`;

  if (visible.length === 0) {
    listEl.classList.add('hidden');
    emptyEl.textContent = 'Nothing matches that.';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  listEl.classList.remove('hidden');

  for (const s of visible) {
    const flags = sessionFlags(s);
    const coverFile = s.cover || s.images[0] || '';
    const badges = [
      badge(`${flags.total} photograph${flags.total !== 1 ? 's' : ''}`),
      badge(
        `${flags.captioned}/${flags.total} captioned`,
        flags.captioned === flags.total && flags.total > 0 ? 'good' : 'warn',
      ),
      flags.hasDescription ? '' : badge('No description', 'warn'),
      flags.hasCover ? '' : badge('Cover not set', 'warn'),
      flags.hasBanner ? badge('Header pinned') : '',
      flags.inRotation
        ? badge(`${flags.inRotation} in rotation`, 'good')
        : badge(flags.leadCandidates ? 'Rotation automatic' : 'No 3:2 frame'),
      s.order != null ? badge(`Order ${s.order}`) : '',
    ]
      .filter(Boolean)
      .join('');

    const li = document.createElement('li');
    li.className =
      'flex items-center gap-4 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700';
    li.innerHTML = `
      <img
        src="${coverFile ? thumbUrl(blobHost, s.thumbSlug, coverFile) : ''}"
        alt=""
        loading="lazy"
        decoding="async"
        class="h-16 w-24 shrink-0 rounded bg-neutral-100 object-cover dark:bg-neutral-800"
      />
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium">${esc(s.title)}</p>
        <p class="mt-0.5 truncate text-sm text-neutral-500 dark:text-neutral-400">
          ${esc(s.slug)}${s.date ? ' · ' + esc(s.date) : ''}${s.location ? ' · ' + esc(s.location) : ''}
        </p>
        <div class="mt-1.5 flex flex-wrap gap-1.5">${badges}</div>
      </div>
      <button
        data-slug="${esc(s.slug)}"
        class="admin-edit shrink-0 rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
      >Edit</button>
    `;
    listEl.appendChild(li);
  }

  listEl.querySelectorAll('.admin-edit').forEach((btn) => {
    btn.addEventListener('click', () =>
      openEdit((btn as HTMLElement).dataset.slug!, btn as HTMLElement),
    );
  });
}

searchEl.addEventListener('input', () => renderList());
filterEl.addEventListener('change', () => renderList());

// ---------------------------------------------------------------------------
// Editor state
// ---------------------------------------------------------------------------

interface EditorState {
  session: AdminSession;
  original: Draft;
  draft: Draft;
  mode: EditorMode;
  /** Hides frames the chosen slot can't use, or already captioned frames. */
  onlyFitting: boolean;
  /** Roving tabindex anchor, so one Tab reaches the grid and arrows do the rest. */
  focused: string;
}

interface Prefs {
  tile: number;
  mode: EditorMode;
  panel: { width: number; height: number } | null;
}

const PREFS_KEY = 'admin.editor.prefs';

function loadPrefs(): Prefs {
  const fallback: Prefs = { tile: 200, mode: 'cover', panel: null };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const stored = parsed.panel;
    return {
      tile: clampTileSize(Number(parsed.tile ?? fallback.tile)),
      mode: typeof parsed.mode === 'string' && isEditorMode(parsed.mode) ? parsed.mode : 'cover',
      panel:
        stored && Number.isFinite(stored.width) && Number.isFinite(stored.height) ? stored : null,
    };
  } catch {
    return fallback;
  }
}

let prefs = loadPrefs();
let editor: EditorState | null = null;
let expanded = false;

function savePrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // A browser with storage switched off still gets a working editor.
  }
}

const modeButtons = [...document.querySelectorAll<HTMLButtonElement>('#edit-modes button')];
const modeHelp = document.getElementById('edit-mode-help')!;
const filterWrap = document.getElementById('edit-filter-wrap')!;
const filterLabel = document.getElementById('edit-filter-label')!;
const onlyFittingEl = document.getElementById('edit-only-fitting') as HTMLInputElement;
const tileSizeEl = document.getElementById('edit-tile-size') as HTMLInputElement;
const dirtyEl = document.getElementById('edit-dirty')!;
const summaryEl = document.getElementById('edit-summary')!;
const metaEl = document.getElementById('edit-modal-meta')!;
const viewLink = document.getElementById('edit-view') as HTMLAnchorElement;
const statusEl = document.getElementById('edit-status')!;
const descriptionCountEl = document.getElementById('edit-description-count')!;

const titleEl = document.getElementById('edit-title') as HTMLInputElement;
const locationEl = document.getElementById('edit-location') as HTMLInputElement;
const descriptionEl = document.getElementById('edit-description') as HTMLTextAreaElement;
const orderEl = document.getElementById('edit-order') as HTMLInputElement;

const MODE_HELP: Record<EditorMode, string> = {
  cover:
    "The frame that stands for the session on the home page and in the archive. Tap one, or tap Auto to let the first photograph do it.",
  header:
    "The photograph the session page opens on. It's cropped wide, so upright frames are dimmed, pick one anyway if you want it. Auto follows the cover.",
  rotation:
    'Photographs worth leading with on the home page. Only wide 3:2 frames fit the lead box, so the rest are greyed out. Leave it empty and one gets picked for you.',
  captions:
    'Captions become the alt text in the lightbox and the line under each photograph. Short and specific beats clever.',
};

const MODE_LABEL: Record<EditorMode, string> = {
  cover: 'cover',
  header: 'header',
  rotation: 'rotation',
  captions: 'captions',
};

/** The shape each slot actually shows on the public site. */
const MODE_ASPECT: Record<EditorMode, string> = {
  cover: '4 / 3',
  header: '5 / 2',
  rotation: '3 / 2',
  captions: '3 / 2',
};

// ---------------------------------------------------------------------------
// Opening and closing
// ---------------------------------------------------------------------------

function openEdit(slug: string, trigger?: HTMLElement) {
  const session = sessions.find((x) => x.slug === slug);
  if (!session) return;
  editTrigger = trigger ?? (document.activeElement as HTMLElement | null);
  previousBodyOverflow = document.body.style.overflow;

  const original = draftFromSession(session);
  editor = {
    session,
    original,
    draft: structuredClone(original),
    mode: prefs.mode,
    onlyFitting: false,
    focused: session.images[0] ?? '',
  };

  (document.getElementById('edit-slug') as HTMLInputElement).value = session.slug;
  titleEl.value = original.title;
  locationEl.value = original.location;
  descriptionEl.value = original.description;
  orderEl.value = original.order != null ? String(original.order) : '';
  document.getElementById('edit-modal-title')!.textContent = `Edit: ${session.title}`;
  viewLink.href = `/sessions/${session.thumbSlug}`;
  tileSizeEl.value = String(prefs.tile);
  onlyFittingEl.checked = false;
  statusEl.textContent = 'Arrow keys move, P previews, Ctrl+S saves.';
  document.getElementById('edit-error')!.classList.add('hidden');

  modal.setAttribute('aria-hidden', 'false');
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  setExpanded(false);
  applyPanelSize(prefs.panel ?? defaultPanelSize(viewport()), { center: true });

  paintModes();
  renderGrid();
  renderSummary();
  updateDirty();
  titleEl.focus();
}

function closeEdit() {
  if (modal.classList.contains('hidden')) return;
  closePreview();
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = previousBodyOverflow;
  const slug = (document.getElementById('edit-slug') as HTMLInputElement).value;
  const replacement = listEl.querySelector<HTMLElement>(
    `.admin-edit[data-slug="${CSS.escape(slug)}"]`,
  );
  (editTrigger?.isConnected ? editTrigger : replacement)?.focus();
  editTrigger = null;
  editor = null;
}

/** Closing with edits in flight is the one way to lose work here, so ask. */
function requestClose() {
  if (editor && draftSignature(editor.original) !== draftSignature(editor.draft)) {
    if (!window.confirm('Unsaved changes. Discard them?')) return;
  }
  closeEdit();
}

// ---------------------------------------------------------------------------
// Panel size and position
// ---------------------------------------------------------------------------

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight };
}

function applyPanelSize(size: { width: number; height: number }, options: { center?: boolean } = {}) {
  const view = viewport();
  const clamped = clampPanelSize(size, view);
  panel.style.width = `${clamped.width}px`;
  panel.style.height = `${clamped.height}px`;
  if (options.center) {
    panel.style.left = `${Math.max(0, Math.round((view.width - clamped.width) / 2))}px`;
    panel.style.top = `${Math.max(0, Math.round((view.height - clamped.height) / 2))}px`;
  } else {
    keepOnScreen(clamped);
  }
  return clamped;
}

function keepOnScreen(size: { width: number; height: number }) {
  const view = viewport();
  const left = parseFloat(panel.style.left || '0');
  const top = parseFloat(panel.style.top || '0');
  panel.style.left = `${Math.min(Math.max(0, left), Math.max(0, view.width - size.width))}px`;
  panel.style.top = `${Math.min(Math.max(0, top), Math.max(0, view.height - size.height))}px`;
}

document.getElementById('edit-expand')!.addEventListener('click', () => {
  setExpanded(!expanded);
  applyPanelSize(
    expanded ? fullPanelSize(viewport()) : (prefs.panel ?? defaultPanelSize(viewport())),
    { center: true },
  );
  measureTiles();
});

function setExpanded(value: boolean) {
  expanded = value;
  document.getElementById('edit-expand')!.textContent = value ? 'Shrink' : 'Fill screen';
}

/** Drag the header to move the panel, drag the corner to resize it. */
function startPointerDrag(
  event: PointerEvent,
  onMove: (dx: number, dy: number) => void,
  onEnd?: () => void,
) {
  const startX = event.clientX;
  const startY = event.clientY;
  const target = event.currentTarget as HTMLElement;
  target.setPointerCapture(event.pointerId);
  const move = (e: PointerEvent) => onMove(e.clientX - startX, e.clientY - startY);
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    onEnd?.();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
}

document.getElementById('edit-drag')!.addEventListener('pointerdown', (event) => {
  const pointerEvent = event as PointerEvent;
  if ((pointerEvent.target as HTMLElement).closest('button, a, input')) return;
  if (window.innerWidth < 640) return;
  const left = parseFloat(panel.style.left || '0');
  const top = parseFloat(panel.style.top || '0');
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const view = viewport();
  startPointerDrag(pointerEvent, (dx, dy) => {
    panel.style.left = `${Math.min(Math.max(0, left + dx), Math.max(0, view.width - width))}px`;
    panel.style.top = `${Math.min(Math.max(0, top + dy), Math.max(0, view.height - height))}px`;
  });
});

document.getElementById('edit-resize')!.addEventListener('pointerdown', (event) => {
  const pointerEvent = event as PointerEvent;
  pointerEvent.preventDefault();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  startPointerDrag(
    pointerEvent,
    (dx, dy) => {
      setExpanded(false);
      applyPanelSize({ width: width + dx, height: height + dy });
    },
    () => {
      measureTiles();
      savePrefs({ panel: { width: panel.offsetWidth, height: panel.offsetHeight } });
    },
  );
});

window.addEventListener('resize', () => {
  if (modal.classList.contains('hidden')) return;
  applyPanelSize({ width: panel.offsetWidth, height: panel.offsetHeight });
  measureTiles();
});

// ---------------------------------------------------------------------------
// Mode switching and the photograph grid
// ---------------------------------------------------------------------------

function paintModes() {
  if (!editor) return;
  const active = editor.mode;
  for (const button of modeButtons) {
    const mode = button.dataset.mode as EditorMode;
    const on = mode === active;
    button.setAttribute('aria-selected', String(on));
    button.className =
      (mode === 'cover' ? '' : 'border-l border-neutral-300 dark:border-neutral-600 ') +
      'px-3 py-1.5 text-sm ' +
      (on
        ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
        : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800');
  }
  modeHelp.textContent = MODE_HELP[active];
  filterWrap.classList.toggle('hidden', active === 'cover');
  filterLabel.textContent =
    active === 'captions' ? 'Only ones still missing a caption' : 'Only frames that fit';
}

for (const button of modeButtons) {
  button.addEventListener('click', () => {
    if (!editor) return;
    const mode = button.dataset.mode;
    if (!mode || !isEditorMode(mode)) return;
    editor.mode = mode;
    editor.onlyFitting = false;
    onlyFittingEl.checked = false;
    savePrefs({ mode });
    paintModes();
    renderGrid();
  });
}

onlyFittingEl.addEventListener('change', () => {
  if (!editor) return;
  editor.onlyFitting = onlyFittingEl.checked;
  renderGrid();
});

tileSizeEl.addEventListener('input', () => {
  savePrefs({ tile: clampTileSize(Number(tileSizeEl.value)) });
  renderGrid();
});

/** Which frames the grid shows, after the "only" filter. */
function visibleFiles(state: EditorState): string[] {
  const { session, mode, draft, onlyFitting } = state;
  if (!onlyFitting) return session.images;
  if (mode === 'captions') {
    return session.images.filter((file) => !(draft.captions[file] ?? '').trim());
  }
  if (mode === 'header') return session.images.filter((file) => fitsBanner(session, file));
  if (mode === 'rotation') return session.images.filter((file) => fitsLeadBox(session, file));
  return session.images;
}

function roleLabels(state: EditorState, file: string): string[] {
  const roles: string[] = [];
  if (state.draft.cover === file) roles.push('Cover');
  if (state.draft.banner === file) roles.push('Header');
  if (state.draft.showcase.includes(file)) roles.push('Rotation');
  if ((state.draft.captions[file] ?? '').trim()) roles.push('Caption');
  return roles;
}

function roleBadges(roles: string[]): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'pointer-events-none absolute left-1 top-1 flex flex-wrap gap-1';
  for (const text of roles) {
    const pill = document.createElement('span');
    pill.className = 'rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white';
    pill.textContent = text;
    wrap.appendChild(pill);
  }
  return wrap;
}

function applyPick(file: string) {
  if (!editor) return;
  const { mode, draft } = editor;
  if (mode === 'cover') {
    draft.cover = draft.cover === file ? '' : file;
  } else if (mode === 'header') {
    draft.banner = draft.banner === file ? '' : file;
  } else if (mode === 'rotation') {
    if (!fitsLeadBox(editor.session, file)) return;
    draft.showcase = draft.showcase.includes(file)
      ? draft.showcase.filter((f) => f !== file)
      : [...draft.showcase, file];
  }
  renderGrid();
  renderSummary();
  updateDirty();
}

function isPicked(state: EditorState, file: string): boolean {
  if (state.mode === 'cover') return state.draft.cover === file;
  if (state.mode === 'header') return state.draft.banner === file;
  if (state.mode === 'rotation') return state.draft.showcase.includes(file);
  return Boolean((state.draft.captions[file] ?? '').trim());
}

function usableIn(state: EditorState, file: string): boolean {
  if (state.mode === 'header') return fitsBanner(state.session, file);
  if (state.mode === 'rotation') return fitsLeadBox(state.session, file);
  return true;
}

function renderGrid() {
  if (!editor) return;
  const state = editor;
  // Picking re-renders the grid, so remember whether the keyboard was in it.
  const hadFocus = gridEl.contains(document.activeElement);
  gridEl.textContent = '';

  if (state.mode === 'captions') {
    renderCaptionList(state);
    return;
  }

  const files = visibleFiles(state);
  if (files.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'py-10 text-center text-sm text-neutral-500 dark:text-neutral-400';
    empty.textContent = state.onlyFitting
      ? 'Nothing fits this slot. Clear the filter to see the rest.'
      : 'This session has no photographs yet.';
    gridEl.appendChild(empty);
    return;
  }
  if (!files.includes(state.focused)) state.focused = files[0];

  const grid = document.createElement('div');
  grid.className = 'grid gap-3';
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${prefs.tile}px, 1fr))`;
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', `Choose the ${MODE_LABEL[state.mode]}`);

  if (state.mode === 'cover' || state.mode === 'header') {
    grid.appendChild(autoTile(state));
  }

  for (const file of files) {
    grid.appendChild(photoTile(state, file));
  }

  grid.addEventListener('keydown', onGridKeydown);
  gridEl.appendChild(grid);
  measureTiles();
  if (hadFocus) {
    gridEl.querySelector<HTMLElement>(`[data-file="${CSS.escape(state.focused)}"]`)?.focus();
  }
}

/**
 * Tell the browser how wide a tile actually ended up.
 *
 * `minmax(tile, 1fr)` stretches columns to fill the row, so the slider value is
 * only a floor. Without the real width the browser would fetch the small
 * thumbnail for a tile twice that size and upscale it.
 */
function measureTiles() {
  const grid = gridEl.firstElementChild as HTMLElement | null;
  const first = grid?.querySelector<HTMLElement>('[data-file]');
  if (!first) return;
  const width = Math.ceil(first.getBoundingClientRect().width);
  if (width <= 0) return;
  for (const img of gridEl.querySelectorAll('img')) {
    img.sizes = `${width}px`;
  }
}

function autoTile(state: EditorState): HTMLElement {
  const on = state.mode === 'cover' ? !state.draft.cover : !state.draft.banner;
  const wrap = document.createElement('div');
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.file = '';
  button.tabIndex = -1;
  button.setAttribute('aria-pressed', String(on));
  button.style.aspectRatio = MODE_ASPECT[state.mode];
  button.className =
    'flex w-full items-center justify-center rounded border-2 border-dashed text-xs ' +
    (on
      ? 'border-neutral-900 text-neutral-900 dark:border-white dark:text-white'
      : 'border-neutral-300 text-neutral-500 hover:border-neutral-500 dark:border-neutral-600 dark:text-neutral-400');
  button.textContent = on ? 'Auto (on)' : 'Auto';
  button.title =
    state.mode === 'cover' ? 'Let the first photograph stand in' : 'Follow the cover';
  button.addEventListener('click', () => {
    if (!editor) return;
    if (state.mode === 'cover') editor.draft.cover = '';
    else editor.draft.banner = '';
    renderGrid();
    renderSummary();
    updateDirty();
  });

  const caption = document.createElement('p');
  caption.className = 'mt-1 truncate text-[11px] text-neutral-500 dark:text-neutral-400';
  caption.textContent = 'Automatic';

  wrap.append(button, caption);
  return wrap;
}

function photoTile(state: EditorState, file: string): HTMLElement {
  const picked = isPicked(state, file);
  const usable = usableIn(state, file);
  const ratio = ratioLabel(state.session.ratios?.[file]);
  const roles = roleLabels(state, file);

  const wrap = document.createElement('div');
  wrap.className = 'group relative';

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.file = file;
  button.tabIndex = file === state.focused ? 0 : -1;
  button.setAttribute('aria-pressed', String(picked));
  // The thumbnail carries no alt text, so the filename and the roles already
  // on the frame have to be the button's name.
  button.setAttribute(
    'aria-label',
    [file, ratio, ...roles.map((role) => role.toLowerCase())].filter(Boolean).join(', '),
  );
  // Dimmed frames stay focusable so the keyboard can still reach a preview;
  // the click is what gets ignored.
  if (!usable && state.mode === 'rotation') button.setAttribute('aria-disabled', 'true');
  button.title = usable
    ? file
    : state.mode === 'rotation'
      ? `${file}, not a 3:2 horizontal`
      : `${file}, too tall for the header crop`;
  button.className =
    'relative block w-full overflow-hidden rounded border-2 ' +
    (picked
      ? 'border-neutral-900 dark:border-white'
      : usable
        ? 'border-transparent opacity-80 hover:opacity-100 focus:opacity-100'
        : state.mode === 'rotation'
          ? 'cursor-not-allowed border-transparent opacity-25'
          : 'border-transparent opacity-30 hover:opacity-70');
  button.style.aspectRatio = MODE_ASPECT[state.mode];

  const img = document.createElement('img');
  img.src = thumbUrl(blobHost, state.session.thumbSlug, file);
  img.srcset = thumbSrcSet(blobHost, state.session.thumbSlug, file);
  img.sizes = `${prefs.tile}px`;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  // A session published before the larger thumbnails existed still has the
  // small one, so fall back rather than showing a broken frame.
  img.addEventListener('error', () => {
    if (!img.srcset) return;
    img.srcset = '';
    img.src = thumbUrl(blobHost, state.session.thumbSlug, file);
  });
  img.className = 'h-full w-full bg-neutral-100 object-cover dark:bg-neutral-800';
  button.append(img, roleBadges(roles));
  button.addEventListener('click', () => applyPick(file));
  button.addEventListener('focus', () => {
    state.focused = file;
  });

  const zoom = document.createElement('button');
  zoom.type = 'button';
  zoom.tabIndex = -1;
  zoom.setAttribute('aria-label', `Preview ${file}`);
  zoom.className =
    'absolute right-1 top-1 hidden rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white group-hover:block group-focus-within:block';
  zoom.textContent = '⤢';
  zoom.addEventListener('click', (event) => {
    event.stopPropagation();
    openPreview(file);
  });

  const caption = document.createElement('p');
  caption.className = 'mt-1 flex items-baseline gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400';
  const name = document.createElement('span');
  name.className = 'min-w-0 flex-1 truncate';
  name.textContent = file;
  const shape = document.createElement('span');
  shape.className = 'shrink-0 tabular-nums';
  shape.textContent = ratio;
  caption.append(name, shape);

  wrap.append(button, zoom, caption);
  return wrap;
}

function onGridKeydown(event: KeyboardEvent) {
  if (!editor) return;
  const tiles = [...gridEl.querySelectorAll<HTMLElement>('[data-file]')];
  if (tiles.length === 0) return;
  const current = tiles.findIndex((tile) => tile === document.activeElement);
  if (current < 0) return;

  if (event.key === 'p' || event.key === 'P') {
    const file = tiles[current].dataset.file;
    if (file) {
      event.preventDefault();
      openPreview(file);
    }
    return;
  }

  const grid = gridEl.firstElementChild as HTMLElement | null;
  const columns = Math.max(
    1,
    grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1,
  );
  let next = current;
  if (event.key === 'ArrowRight') next = Math.min(tiles.length - 1, current + 1);
  else if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
  else if (event.key === 'ArrowDown') next = Math.min(tiles.length - 1, current + columns);
  else if (event.key === 'ArrowUp') next = Math.max(0, current - columns);
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = tiles.length - 1;
  else return;

  event.preventDefault();
  for (const tile of tiles) tile.tabIndex = -1;
  tiles[next].tabIndex = 0;
  tiles[next].focus();
  editor.focused = tiles[next].dataset.file ?? editor.focused;
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

function renderCaptionList(state: EditorState) {
  const files = visibleFiles(state);
  if (files.length === 0) {
    const done = document.createElement('p');
    done.className = 'py-10 text-center text-sm text-neutral-500 dark:text-neutral-400';
    done.textContent = state.onlyFitting
      ? 'Every photograph here has a caption.'
      : 'This session has no photographs yet.';
    gridEl.appendChild(done);
    return;
  }

  const list = document.createElement('div');
  list.className = 'space-y-3';
  const thumbWidth = Math.max(96, Math.round(prefs.tile * 0.8));

  for (const file of files) {
    const row = document.createElement('label');
    row.className = 'flex items-center gap-3';

    const img = document.createElement('img');
    img.src = thumbUrl(blobHost, state.session.thumbSlug, file);
    img.srcset = thumbSrcSet(blobHost, state.session.thumbSlug, file);
    img.sizes = `${thumbWidth}px`;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      if (!img.srcset) return;
      img.srcset = '';
      img.src = thumbUrl(blobHost, state.session.thumbSlug, file);
    });
    img.style.width = `${thumbWidth}px`;
    img.className = 'shrink-0 rounded bg-neutral-100 object-cover dark:bg-neutral-800';
    img.style.aspectRatio = '3 / 2';

    const field = document.createElement('span');
    field.className = 'min-w-0 flex-1';

    const name = document.createElement('span');
    name.className = 'mb-1 flex items-baseline gap-2 text-xs text-neutral-500 dark:text-neutral-400';
    const filename = document.createElement('span');
    filename.className = 'min-w-0 flex-1 truncate';
    filename.textContent = file;
    const zoom = document.createElement('button');
    zoom.type = 'button';
    zoom.tabIndex = -1;
    zoom.className = 'shrink-0 rounded px-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800';
    zoom.setAttribute('aria-label', `Preview ${file}`);
    zoom.textContent = '⤢';
    zoom.addEventListener('click', () => openPreview(file));
    name.append(filename, zoom);

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 500;
    input.value = state.draft.captions[file] ?? '';
    input.dataset.captionFile = file;
    input.placeholder = 'Optional caption';
    input.className =
      'w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm focus:border-neutral-500 focus:outline-none dark:border-neutral-600 dark:bg-neutral-800';
    input.addEventListener('input', () => {
      if (!editor) return;
      editor.draft.captions[file] = input.value;
      renderSummary();
      updateDirty();
    });

    field.append(name, input);
    row.append(img, field);
    list.appendChild(row);
  }

  gridEl.appendChild(list);
}

// ---------------------------------------------------------------------------
// Summary, dirty state, written fields
// ---------------------------------------------------------------------------

function summaryRow(label: string, value: string): string {
  return `<div class="flex items-baseline justify-between gap-3">
    <dt class="shrink-0 text-neutral-500 dark:text-neutral-400">${esc(label)}</dt>
    <dd class="min-w-0 truncate text-right">${esc(value)}</dd>
  </div>`;
}

function renderSummary() {
  if (!editor) return;
  const { session, draft } = editor;
  const captioned = session.images.filter((file) => (draft.captions[file] ?? '').trim()).length;
  const leadCandidates = session.images.filter((file) => fitsLeadBox(session, file)).length;

  metaEl.textContent = [
    session.slug,
    session.date,
    `${session.images.length} photograph${session.images.length !== 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(' · ');

  summaryEl.innerHTML = [
    summaryRow('Date', session.date || 'From the files'),
    summaryRow('Cover', draft.cover || 'Automatic'),
    summaryRow('Header', draft.banner || 'Follows the cover'),
    summaryRow(
      'Home rotation',
      draft.showcase.length ? `${draft.showcase.length} of ${leadCandidates} usable` : 'Automatic',
    ),
    summaryRow('Captions', `${captioned} / ${session.images.length}`),
  ].join('');

  descriptionCountEl.textContent = `${descriptionEl.value.length} / 1000`;
}

function updateDirty() {
  if (!editor) return;
  const dirty = draftSignature(editor.original) !== draftSignature(editor.draft);
  dirtyEl.classList.toggle('hidden', !dirty);
}

titleEl.addEventListener('input', () => {
  if (!editor) return;
  editor.draft.title = titleEl.value;
  updateDirty();
});
locationEl.addEventListener('input', () => {
  if (!editor) return;
  editor.draft.location = locationEl.value;
  updateDirty();
});
descriptionEl.addEventListener('input', () => {
  if (!editor) return;
  editor.draft.description = descriptionEl.value;
  descriptionCountEl.textContent = `${descriptionEl.value.length} / 1000`;
  updateDirty();
});
orderEl.addEventListener('input', () => {
  if (!editor) return;
  const raw = orderEl.value.trim();
  const parsed = raw === '' ? null : parseInt(raw, 10);
  editor.draft.order = parsed != null && Number.isFinite(parsed) ? parsed : null;
  updateDirty();
});

// ---------------------------------------------------------------------------
// Full-size preview
// ---------------------------------------------------------------------------

const previewOverlay = document.getElementById('preview-overlay')!;
const previewImage = document.getElementById('preview-image') as HTMLImageElement;
const previewName = document.getElementById('preview-name')!;
const previewNote = document.getElementById('preview-note')!;
const previewAssign = document.getElementById('preview-assign') as HTMLButtonElement;
let previewFile = '';

function openPreview(file: string) {
  if (!editor) return;
  previewFile = file;
  previewImage.src = previewUrl(editor.session, file, blobHost);
  previewImage.alt = editor.draft.captions[file] || file;
  previewName.textContent = file;
  const ratio = ratioLabel(editor.session.ratios?.[file]);
  previewNote.textContent = [
    ratio ? `${ratio} frame` : '',
    'Arrows step through the session, Esc closes.',
  ]
    .filter(Boolean)
    .join(' · ');
  paintPreviewAssign();
  previewOverlay.classList.remove('hidden');
  previewOverlay.classList.add('flex');
  const target = previewAssign.classList.contains('hidden')
    ? (document.getElementById('preview-close') as HTMLButtonElement)
    : previewAssign;
  target.focus();
}

function paintPreviewAssign() {
  if (!editor || !previewFile) return;
  const { mode } = editor;
  if (mode === 'captions') {
    previewAssign.classList.add('hidden');
    return;
  }
  previewAssign.classList.remove('hidden');
  const picked = isPicked(editor, previewFile);
  previewAssign.disabled = !usableIn(editor, previewFile) && mode === 'rotation';
  previewAssign.textContent =
    mode === 'rotation'
      ? picked
        ? 'Take out of the rotation'
        : 'Add to the rotation'
      : picked
        ? `Clear the ${MODE_LABEL[mode]}`
        : `Use as the ${MODE_LABEL[mode]}`;
}

function stepPreview(delta: number) {
  if (!editor || !previewFile) return;
  const files = visibleFiles(editor);
  const index = files.indexOf(previewFile);
  if (index < 0) return;
  const next = files[(index + delta + files.length) % files.length];
  openPreview(next);
}

function closePreview() {
  previewOverlay.classList.add('hidden');
  previewOverlay.classList.remove('flex');
  previewFile = '';
}

previewAssign.addEventListener('click', () => {
  if (!previewFile) return;
  applyPick(previewFile);
  paintPreviewAssign();
});
document.getElementById('preview-prev')!.addEventListener('click', () => stepPreview(-1));
document.getElementById('preview-next')!.addEventListener('click', () => stepPreview(1));
document.getElementById('preview-close')!.addEventListener('click', () => closePreview());
previewOverlay.addEventListener('click', (event) => {
  if (event.target === previewOverlay) closePreview();
});

// ---------------------------------------------------------------------------
// Dialog plumbing
// ---------------------------------------------------------------------------

function modalFocusableElements(): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex="0"]',
    ),
  ).filter((element) => element.getClientRects().length > 0);
}

document.getElementById('edit-cancel')!.addEventListener('click', requestClose);
document.getElementById('edit-close')!.addEventListener('click', requestClose);
modal.addEventListener('click', (e) => {
  if (e.target === modal) requestClose();
});

document.addEventListener('keydown', (e) => {
  if (modal.classList.contains('hidden')) return;

  if (!previewOverlay.classList.contains('hidden')) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePreview();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      stepPreview(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      stepPreview(-1);
    }
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    form.requestSubmit();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    requestClose();
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
  if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
    e.preventDefault();
    last.focus();
  } else if (
    !e.shiftKey &&
    (document.activeElement === last || !panel.contains(document.activeElement))
  ) {
    e.preventDefault();
    first.focus();
  }
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!editor) return;
  const state = editor;
  const saveBtn = document.getElementById('edit-save') as HTMLButtonElement;
  const errEl = document.getElementById('edit-error')!;
  errEl.classList.add('hidden');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  const draft = state.draft;
  const body = {
    slug: state.session.slug,
    title: draft.title.trim(),
    location: draft.location.trim(),
    description: draft.description.trim(),
    cover: draft.cover,
    banner: draft.banner,
    order: draft.order,
    images: imagesPayload(state.session, draft.captions),
    showcase: draft.showcase,
  };

  try {
    const res = await fetch('/api/sessionmgr', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error((data.errors || [data.error]).join(' '));

    const s = state.session;
    s.title = body.title;
    s.location = body.location;
    s.description = body.description;
    s.cover = body.cover;
    s.banner = body.banner;
    s.order = body.order;
    s.showcase = body.showcase;
    s.captions = Object.fromEntries(
      body.images.filter((image) => image.caption).map((image) => [image.file, image.caption]),
    );

    renderList();
    closeEdit();
    showToast('Saved. Click Rebuild Site to deploy (~5 min) or wait for the next cron.');
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
