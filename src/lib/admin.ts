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

// Show current user
fetch('/.auth/me')
  .then((r) => r.json())
  .then((d) => {
    const user = d.clientPrincipal;
    if (user) {
      document.getElementById('admin-user')!.textContent = user.userDetails;
    }
  })
  .catch(() => {});

// Load sessions
loadSessions();

async function loadSessions() {
  try {
    const res = await fetch('/api/admin/sessions');
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Failed to load sessions.');
    sessions = data.sessions;
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

  // Populate cover dropdown
  const coverEl = document.getElementById('edit-cover') as HTMLSelectElement;
  coverEl.innerHTML = '<option value="">(auto — first image)</option>';
  for (const img of s.images) {
    const opt = document.createElement('option');
    opt.value = img;
    opt.textContent = img;
    if (img === s.cover) opt.selected = true;
    coverEl.appendChild(opt);
  }

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
    cover: (document.getElementById('edit-cover') as HTMLSelectElement).value,
    order: orderRaw === '' ? null : parseInt(orderRaw, 10),
  };

  try {
    const res = await fetch('/api/admin/sessions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error((data.errors || [data.error]).join(' '));

    // Update local state
    const s = sessions.find((x) => x.slug === slug);
    if (s) {
      if (body.title) s.title = body.title;
      if (body.cover !== undefined) s.cover = body.cover;
      if (body.order !== undefined) s.order = body.order;
      if (body.location !== undefined) s.location = body.location;
      if (body.description !== undefined) s.description = body.description;
    }
    renderList();
    closeEdit();
    showToast('Saved! Changes will appear after the next build (~2 min if triggered, or ~1 hr cron).');
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
