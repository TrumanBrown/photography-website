interface Session {
  slug: string;
  title: string;
  date: string;
  location: string;
  description: string;
  cover: string;
  order: number | null;
  images: string[];
}

const listEl = document.getElementById('admin-list')!;
const loadingEl = document.getElementById('admin-loading')!;
const errorEl = document.getElementById('admin-error')!;
const modal = document.getElementById('edit-modal')!;
const form = document.getElementById('edit-form') as HTMLFormElement;
const toastEl = document.getElementById('toast')!;

let sessions: Session[] = [];
let blobHost = '';

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
const panelSessions = document.getElementById('panel-sessions')!;
const panelMessages = document.getElementById('panel-messages')!;
const activeTabClass = 'border-neutral-900 dark:border-white';
const inactiveTabClass = 'border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200';
let messagesLoaded = false;

function selectTab(tab: 'sessions' | 'messages') {
  if (tab === 'sessions') {
    panelSessions.classList.remove('hidden');
    panelMessages.classList.add('hidden');
    tabSessions.className = 'border-b-2 px-4 py-2 text-sm font-medium ' + activeTabClass;
    tabMessages.className = 'border-b-2 px-4 py-2 text-sm font-medium ' + inactiveTabClass;
  } else {
    panelMessages.classList.remove('hidden');
    panelSessions.classList.add('hidden');
    tabMessages.className = 'border-b-2 px-4 py-2 text-sm font-medium ' + activeTabClass;
    tabSessions.className = 'border-b-2 px-4 py-2 text-sm font-medium ' + inactiveTabClass;
    if (!messagesLoaded) {
      messagesLoaded = true;
      loadMessages();
    }
  }
}

tabSessions.addEventListener('click', () => selectTab('sessions'));
tabMessages.addEventListener('click', () => selectTab('messages'));

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
    sessions = data.sessions;
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

  for (const s of sessions) {
    const li = document.createElement('li');
    li.className =
      'flex items-center justify-between gap-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-700';
    li.innerHTML = `
      <div class="min-w-0 flex-1">
        <p class="truncate font-medium">${esc(s.title)}</p>
        <p class="mt-0.5 truncate text-sm text-neutral-500 dark:text-neutral-400">
          ${esc(s.slug)}${s.date ? ' · ' + esc(s.date) : ''}${s.location ? ' · ' + esc(s.location) : ''}
          · ${s.images.length} image${s.images.length !== 1 ? 's' : ''}
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
    btn.addEventListener('click', () => openEdit((btn as HTMLElement).dataset.slug!));
  });
}

function openEdit(slug: string) {
  const s = sessions.find((x) => x.slug === slug);
  if (!s) return;

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
    btn.innerHTML = `<img src="${thumbUrl(blobHost, s.slug, img)}" alt="${esc(img)}" loading="lazy" class="h-16 w-full object-cover" />`;
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

  document.getElementById('edit-error')!.classList.add('hidden');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  (document.getElementById('edit-title') as HTMLInputElement).focus();
}

function closeEdit() {
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

document.getElementById('edit-cancel')!.addEventListener('click', closeEdit);
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeEdit();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeEdit();
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

  const body = {
    slug,
    title: (document.getElementById('edit-title') as HTMLInputElement).value.trim(),
    location: (document.getElementById('edit-location') as HTMLInputElement).value.trim(),
    description: (document.getElementById('edit-description') as HTMLTextAreaElement).value.trim(),
    cover: (document.getElementById('edit-cover') as HTMLInputElement).value,
    order: orderRaw === '' ? null : parseInt(orderRaw, 10),
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

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function thumbUrl(host: string, slug: string, file: string): string {
  // Use tiny pre-generated thumbnails from variants/thumbs/ (120px wide, ~5KB).
  const base = file.slice(0, file.lastIndexOf('.'));
  return `https://${host}/variants/thumbs/${slug}/${base}.jpg`;
}
