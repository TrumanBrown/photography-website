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

interface AnalyticsData {
  days: number;
  totalPageviews: number;
  uniqueVisitors: number;
  avgTimeOnPageMs: number;
  series: { date: string; views: number }[];
  topPages: { path: string; count: number }[];
  topReferrers: { ref: string; count: number }[];
}

function fmtDuration(ms: number): string {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm ' + (s % 60) + 's';
}

async function loadAnalytics() {
  const loading = document.getElementById('analytics-loading')!;
  const error = document.getElementById('analytics-error')!;
  const content = document.getElementById('analytics-content')!;
  const range = (document.getElementById('analytics-range') as HTMLSelectElement).value;
  loading.classList.remove('hidden');
  error.classList.add('hidden');
  try {
    const res = await fetch('/api/sessionmgr?type=analytics&days=' + encodeURIComponent(range));
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
    loading.classList.add('hidden');
    error.textContent = err.message;
    error.classList.remove('hidden');
  }
}

function renderAnalytics(a: AnalyticsData) {
  const cards = document.getElementById('analytics-cards')!;
  const card = (label: string, value: string) =>
    `<div class="rounded-lg border border-neutral-200 p-4 dark:border-neutral-700">
      <p class="text-2xl font-semibold">${esc(value)}</p>
      <p class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">${esc(label)}</p>
    </div>`;
  cards.innerHTML =
    card('Pageviews', a.totalPageviews.toLocaleString()) +
    card('Unique visitors', a.uniqueVisitors.toLocaleString()) +
    card('Avg. time on page', fmtDuration(a.avgTimeOnPageMs));

  // Bar chart
  const chart = document.getElementById('analytics-chart')!;
  const max = Math.max(1, ...a.series.map((d) => d.views));
  chart.innerHTML = a.series
    .map((d) => {
      const h = Math.round((d.views / max) * 100);
      return `<div class="flex-1 bg-neutral-300 dark:bg-neutral-600" style="height:${Math.max(2, h)}%" title="${esc(d.date)}: ${d.views} views"></div>`;
    })
    .join('');

  const pages = document.getElementById('analytics-pages')!;
  pages.innerHTML = a.topPages.length
    ? a.topPages
        .map(
          (p) =>
            `<li class="flex justify-between gap-2"><span class="truncate text-neutral-700 dark:text-neutral-300">${esc(p.path)}</span><span class="shrink-0 text-neutral-500">${p.count}</span></li>`,
        )
        .join('')
    : '<li class="text-neutral-500 dark:text-neutral-400">No data yet.</li>';

  const refs = document.getElementById('analytics-referrers')!;
  refs.innerHTML = a.topReferrers.length
    ? a.topReferrers
        .map(
          (r) =>
            `<li class="flex justify-between gap-2"><span class="truncate text-neutral-700 dark:text-neutral-300">${esc(r.ref)}</span><span class="shrink-0 text-neutral-500">${r.count}</span></li>`,
        )
        .join('')
    : '<li class="text-neutral-500 dark:text-neutral-400">No referrers (direct visits).</li>';
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
