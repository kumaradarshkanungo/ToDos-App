/* ─────────────────────────────────────────────────────────
   ToDos App — app.js
   Auth:    GitHub Personal Access Token → stored in localStorage
   Storage: GitHub Gist (JSON file) for cross-device sync
            Falls back to localStorage-only in offline mode
   Data model:
     todos[]       – { id, title, description, dueDate, month, year,
                       isRecurring, isCompleted, createdAt }
     completions[] – { todoId, month, year }  (recurring only)
───────────────────────────────────────────────────────── */

// ── Keys ──────────────────────────────────────────────────
const DATA_KEY = 'todos_app_v1';   // stores items locally
const AUTH_KEY = 'todos_auth_v1';  // auth session

// ── GitHub API constants ──────────────────────────────────
const GH_API       = 'https://api.github.com';
const GIST_FILE    = 'todos-app-data.json';
const GIST_DESC    = 'ToDos App — synced data';

// ── Auth state ────────────────────────────────────────────
let authToken = null;   // GitHub PAT
let gistId    = null;   // Gist ID used for storage
let ghUser    = null;   // shape: login and avatar_url
let authMode  = null;   // 'github' | 'offline'

// ── App state ─────────────────────────────────────────────
const today = new Date();
let currentMonth = today.getMonth() + 1;
let currentYear  = today.getFullYear();
let todos        = [];
let completions  = [];
let lastModified = 0;  // unix-ms; used to decide local vs. remote on refresh

// ── Sync timer ────────────────────────────────────────────
let syncTimer  = null;
const SYNC_DELAY = 1500; // ms debounce before pushing to Gist

// ═══════════════════════════════════════════════════════════
// LOCAL STORAGE
// ═══════════════════════════════════════════════════════════

function loadLocal() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) { const d = JSON.parse(raw); todos = d.todos || []; completions = d.completions || []; lastModified = d.lastModified || 0; }
  } catch { /* start fresh */ }
}

function saveLocal() {
  lastModified = Date.now();
  localStorage.setItem(DATA_KEY, JSON.stringify({ todos, completions, lastModified }));
}

function loadAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw) { const d = JSON.parse(raw); authToken = d.token; gistId = d.gistId; ghUser = d.user; authMode = d.mode; }
  } catch { /* ignore */ }
}

function saveAuth() {
  localStorage.setItem(AUTH_KEY, JSON.stringify({ token: authToken, gistId, user: ghUser, mode: authMode }));
}

function clearAuth() {
  authToken = null; gistId = null; ghUser = null; authMode = null;
  localStorage.removeItem(AUTH_KEY);
}

// ═══════════════════════════════════════════════════════════
// GITHUB GIST API
// ═══════════════════════════════════════════════════════════

function ghHeaders(token) {
  return { Authorization: `token ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
}

/** Validate token and return user profile, throws on failure. */
async function ghValidateToken(token) {
  const res = await fetch(`${GH_API}/user`, { headers: ghHeaders(token) });
  if (res.status === 401) throw new Error('Invalid token — make sure you copied it correctly.');
  if (!res.ok) throw new Error(`GitHub error: ${res.status}`);
  return res.json(); // returns user profile
}

/**
 * Find the app's Gist (by filename) or create a new private one.
 * Returns the Gist ID.
 */
async function ghFindOrCreateGist(token) {
  // Search user's gists page by page
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`${GH_API}/gists?per_page=100&page=${page}`, { headers: ghHeaders(token) });
    if (!res.ok) throw new Error(`Could not fetch gists: ${res.status}`);
    const list = await res.json();
    const found = list.find(g => g.files?.[GIST_FILE]);
    if (found) return found.id;
    if (list.length < 100) break; // last page
  }

  // Not found — create a new private gist
  const res = await fetch(`${GH_API}/gists`, {
    method: 'POST',
    headers: ghHeaders(token),
    body: JSON.stringify({
      description: GIST_DESC,
      public: false,
      files: { [GIST_FILE]: { content: JSON.stringify({ todos: [], completions: [] }, null, 2) } }
    })
  });
  if (!res.ok) throw new Error(`Could not create gist: ${res.status}`);
  const gist = await res.json();
  return gist.id;
}

/** Fetch gist data and update local state. */
async function ghLoadFromGist(token, id) {
  const res = await fetch(`${GH_API}/gists/${id}`, { headers: ghHeaders(token) });
  if (res.status === 404) throw new Error('Gist not found — it may have been deleted.');
  if (!res.ok) throw new Error(`Could not read gist: ${res.status}`);
  const gist = await res.json();
  const file = gist.files[GIST_FILE];
  if (!file) throw new Error('Gist file missing.');

  // GitHub truncates large files — fetch raw URL if needed
  const content = file.truncated
    ? await (await fetch(file.raw_url)).text()
    : file.content;

  const data = JSON.parse(content);
  const remoteLastModified = data.lastModified || 0;

  if (remoteLastModified >= lastModified) {
    // Remote is newer (or equal on first connect) — pull from Gist
    todos        = data.todos       || [];
    completions  = data.completions || [];
    lastModified = remoteLastModified;
    saveLocal();
  } else {
    // Local is newer (e.g. user edited then refreshed before sync fired) — push to Gist
    await ghSaveToGist();
  }
}

/** Push current state to Gist (debounced by callers). */
async function ghSaveToGist() {
  if (!authToken || !gistId) return;
  setSyncStatus('syncing');
  try {
    const res = await fetch(`${GH_API}/gists/${gistId}`, {
      method: 'PATCH',
      headers: ghHeaders(authToken),
      body: JSON.stringify({
        files: { [GIST_FILE]: { content: JSON.stringify({ todos, completions, lastModified }, null, 2) } }
      })
    });
    if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
    setSyncStatus('synced');
  } catch (err) {
    console.error(err);
    setSyncStatus('error');
  }
}

// ═══════════════════════════════════════════════════════════
// SYNC
// ═══════════════════════════════════════════════════════════

/** Save locally then schedule a debounced Gist push. */
function save() {
  saveLocal();
  if (authMode !== 'github') return;
  clearTimeout(syncTimer);
  setSyncStatus('syncing');
  syncTimer = setTimeout(ghSaveToGist, SYNC_DELAY);
}

function setSyncStatus(state) {
  const dot = document.getElementById('syncDot');
  if (!dot) return;
  dot.className = 'sync-dot ' + state;
  const labels = { syncing: 'Syncing…', synced: 'Synced', error: 'Sync failed — check connection' };
  dot.title = labels[state] || '';
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function escape(str) { const d = document.createElement('div'); d.textContent = str; return d.innerHTML; }

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── Due date helpers ──────────────────────────────────────

/**
 * Returns 'overdue' | 'due-today' | 'due-soon' | 'on-track' | null.
 * null means no due date or already completed.
 */
function getDueStatus(dueDate, isCompleted) {
  if (!dueDate || isCompleted) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due  = new Date(dueDate + 'T00:00:00');
  const diff = Math.ceil((due - now) / 86400000);
  if (diff <  0) return 'overdue';
  if (diff === 0) return 'due-today';
  if (diff <= 3) return 'due-soon';
  return 'on-track';
}

/** Human-readable label for the due date chip. */
function formatDueChip(dueDate, status) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const due  = new Date(dueDate + 'T00:00:00');
  const diff = Math.ceil((due - now) / 86400000);
  const label = due.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
    ...(due.getFullYear() !== now.getFullYear() && { year: 'numeric' })
  });
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (status === 'overdue') return `Overdue · ${label}`;
  return `Due ${label}`;
}

/** Sort priority so urgent items float to the top. */
function urgencyOrder(item) {
  if (item.isCompletedThisMonth) return 5;
  const rank = { overdue: 0, 'due-today': 1, 'due-soon': 2, 'on-track': 3 };
  return rank[getDueStatus(item.dueDate, false)] ?? 4;
}

// ═══════════════════════════════════════════════════════════
// BUSINESS LOGIC
// ═══════════════════════════════════════════════════════════

function getTodosForMonth(month, year) {
  const oneOff    = todos.filter(t => !t.isRecurring && t.month === month && t.year === year);
  const recurring = todos.filter(t => t.isRecurring && (t.year < year || (t.year === year && t.month <= month)));
  const doneSet   = new Set(completions.filter(c => c.month === month && c.year === year).map(c => c.todoId));
  const decorate  = t => ({ ...t, isCompletedThisMonth: t.isRecurring ? doneSet.has(t.id) : t.isCompleted });
  return [...oneOff.map(decorate), ...recurring.map(decorate)]
    .sort((a, b) => urgencyOrder(a) - urgencyOrder(b) || a.createdAt - b.createdAt);
}

function addTodo(title, description, dueDate, isRecurring) {
  todos.push({ id: uid(), title, description, dueDate: dueDate || null, isCompleted: false, month: currentMonth, year: currentYear, isRecurring, createdAt: Date.now() });
  save(); render();
}

function toggleCompletion(todoId, isRecurring) {
  if (isRecurring) {
    const idx = completions.findIndex(c => c.todoId === todoId && c.month === currentMonth && c.year === currentYear);
    if (idx >= 0) completions.splice(idx, 1); else completions.push({ todoId, month: currentMonth, year: currentYear });
  } else {
    const todo = todos.find(t => t.id === todoId);
    if (todo) todo.isCompleted = !todo.isCompleted;
  }
  save(); render();
}

function deleteTodo(todoId) {
  todos       = todos.filter(t => t.id !== todoId);
  completions = completions.filter(c => c.todoId !== todoId);
  save(); render();
}

function navigateMonth(delta) {
  const d = new Date(currentYear, currentMonth - 1 + delta);
  currentMonth = d.getMonth() + 1;
  currentYear  = d.getFullYear();
  render();
}

// ═══════════════════════════════════════════════════════════
// RENDER
// ═══════════════════════════════════════════════════════════

function render() {
  const items = getTodosForMonth(currentMonth, currentYear);

  document.getElementById('monthLabel').textContent = `${MONTHS[currentMonth - 1]} ${currentYear}`;

  const progressSection = document.getElementById('progressSection');
  if (items.length > 0) {
    const done = items.filter(t => t.isCompletedThisMonth).length;
    document.getElementById('progressFill').style.width = Math.round((done / items.length) * 100) + '%';
    document.getElementById('progressText').textContent = `${done} / ${items.length} completed`;
    progressSection.classList.add('visible');
  } else {
    progressSection.classList.remove('visible');
  }

  const emptyState = document.getElementById('emptyState');
  if (items.length === 0) {
    document.getElementById('emptyTitle').textContent = `No todos for ${MONTHS[currentMonth - 1]}`;
    emptyState.classList.add('visible');
  } else {
    emptyState.classList.remove('visible');
  }

  document.getElementById('todoList').innerHTML = items.map(t => {
    const status   = getDueStatus(t.dueDate, t.isCompletedThisMonth);
    const cardCls  = ['todo-card', t.isCompletedThisMonth ? 'completed' : '', status ?? ''].filter(Boolean).join(' ');
    const dueChip  = t.dueDate && !t.isCompletedThisMonth
      ? `<span class="badge-due ${status}">${formatDueChip(t.dueDate, status)}</span>`
      : '';
    return `
    <div class="${cardCls}">
      <div class="checkbox-wrap">
        <input type="checkbox" ${t.isCompletedThisMonth ? 'checked' : ''} data-id="${t.id}" data-recurring="${t.isRecurring}" aria-label="Mark complete" />
      </div>
      <div class="todo-content">
        <div class="todo-title-row">
          <span class="todo-title">${escape(t.title)}</span>
          ${t.isRecurring ? '<span class="badge-recurring">Recurring</span>' : ''}
        </div>
        ${t.description ? `<p class="todo-desc">${escape(t.description)}</p>` : ''}
        ${dueChip}
      </div>
      <div class="todo-actions">
        <button class="delete-btn" data-delete="${t.id}" data-recurring="${t.isRecurring}" aria-label="Delete todo">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
          </svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════
// SCREENS
// ═══════════════════════════════════════════════════════════

function showLoginScreen() {
  document.getElementById('loginScreen').hidden = false;
  document.getElementById('appScreen').hidden   = true;
}

function showAppScreen() {
  document.getElementById('loginScreen').hidden = true;
  document.getElementById('appScreen').hidden   = false;

  // User pill vs offline badge
  if (authMode === 'github' && ghUser) {
    const pill   = document.getElementById('userPill');
    const badge  = document.getElementById('offlineBadge');
    pill.hidden  = false;
    badge.hidden = true;
    document.getElementById('userAvatar').src = ghUser.avatar_url;
    document.getElementById('userAvatar').alt = ghUser.login;
    document.getElementById('userName').textContent = '@' + ghUser.login;
    setSyncStatus('synced');
  } else {
    document.getElementById('userPill').hidden   = true;
    document.getElementById('offlineBadge').hidden = false;
  }

  render();
}

// ═══════════════════════════════════════════════════════════
// LOGIN FLOW
// ═══════════════════════════════════════════════════════════

const tokenInput  = document.getElementById('tokenInput');
const tokenError  = document.getElementById('tokenError');
const connectBtn  = document.getElementById('connectBtn');
const connectLabel   = document.getElementById('connectLabel');
const connectSpinner = document.getElementById('connectSpinner');

function setLoginError(msg) {
  tokenError.textContent = msg;
  tokenInput.classList.add('invalid');
}
function clearLoginError() {
  tokenError.textContent = '';
  tokenInput.classList.remove('invalid');
}

function setConnecting(loading) {
  connectBtn.disabled      = loading || tokenInput.value.trim().length === 0;
  connectLabel.hidden      = loading;
  connectSpinner.hidden    = !loading;
}

tokenInput.addEventListener('input', () => {
  clearLoginError();
  connectBtn.disabled = tokenInput.value.trim().length === 0;
});

// Show / hide token
document.getElementById('tokenReveal').addEventListener('click', () => {
  const isPassword = tokenInput.type === 'password';
  tokenInput.type = isPassword ? 'text' : 'password';
  document.getElementById('eyeIcon').setAttribute('opacity', isPassword ? '0.4' : '1');
});

connectBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  if (!token) return;
  clearLoginError();
  setConnecting(true);

  try {
    // 1. Validate token + get user profile
    const user = await ghValidateToken(token);

    // 2. Find or create the Gist
    const id = await ghFindOrCreateGist(token);

    // 3. Load remote data (remote wins on first connect)
    authToken = token;
    gistId    = id;
    ghUser    = { login: user.login, avatar_url: user.avatar_url };
    authMode  = 'github';
    await ghLoadFromGist(token, id);

    // 4. Persist session
    saveAuth();

    showAppScreen();
  } catch (err) {
    setLoginError(err.message || 'Connection failed. Please try again.');
  } finally {
    setConnecting(false);
  }
});

document.getElementById('offlineBtn').addEventListener('click', () => {
  authMode = 'offline';
  saveAuth();
  loadLocal();
  showAppScreen();
});

// ═══════════════════════════════════════════════════════════
// SIGN OUT
// ═══════════════════════════════════════════════════════════

document.getElementById('signoutBtn').addEventListener('click', () => {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <h3>Sign out</h3>
      <p>Your todos are saved in your GitHub Gist and will be available when you sign back in.</p>
      <div class="confirm-actions">
        <button class="btn btn-confirm-cancel" id="soCancel">Cancel</button>
        <button class="btn btn-primary" id="soConfirm" style="background:#6650A4">Sign out</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('soCancel').onclick  = () => overlay.remove();
  document.getElementById('soConfirm').onclick = () => {
    clearTimeout(syncTimer);
    clearAuth();
    todos = []; completions = [];
    saveLocal();
    overlay.remove();
    showLoginScreen();
    // Reset login form
    tokenInput.value = '';
    connectBtn.disabled = true;
    clearLoginError();
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
});

// ═══════════════════════════════════════════════════════════
// CONFIRM DELETE DIALOG
// ═══════════════════════════════════════════════════════════

function showDeleteConfirm(todoId, isRecurring) {
  const existing = document.getElementById('confirmOverlay');
  if (existing) existing.remove();

  const todo = todos.find(t => t.id === todoId);
  if (!todo) return;

  const message = isRecurring
    ? `"${escape(todo.title)}" is recurring — deleting it removes it from every month.`
    : `Delete "${escape(todo.title)}"?`;

  const overlay = document.createElement('div');
  overlay.id        = 'confirmOverlay';
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <h3>Delete Todo</h3>
      <p>${message}</p>
      <div class="confirm-actions">
        <button class="btn btn-confirm-cancel" id="cfmCancel">Cancel</button>
        <button class="btn btn-confirm-delete" id="cfmDelete">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('cfmCancel').onclick = () => overlay.remove();
  document.getElementById('cfmDelete').onclick = () => { deleteTodo(todoId); overlay.remove(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ═══════════════════════════════════════════════════════════
// ADD ITEM MODAL
// ═══════════════════════════════════════════════════════════

const modalOverlay = document.getElementById('modalOverlay');
const todoForm     = document.getElementById('todoForm');
const titleInput   = document.getElementById('titleInput');
const descInput    = document.getElementById('descInput');
const dueDateInput = document.getElementById('dueDateInput');
const recurInput   = document.getElementById('recurringInput');
const submitBtn    = document.getElementById('submitBtn');
const titleError   = document.getElementById('titleError');

function openModal()  {
  todoForm.reset();
  titleInput.classList.remove('invalid');
  titleError.classList.remove('visible');
  submitBtn.disabled = true;
  modalOverlay.classList.add('open');
  setTimeout(() => titleInput.focus(), 60);
}
function closeModal() { modalOverlay.classList.remove('open'); }

titleInput.addEventListener('input', () => {
  const ok = titleInput.value.trim().length > 0;
  submitBtn.disabled = !ok;
  if (ok) { titleInput.classList.remove('invalid'); titleError.classList.remove('visible'); }
});

todoForm.addEventListener('submit', e => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) { titleInput.classList.add('invalid'); titleError.classList.add('visible'); titleInput.focus(); return; }
  addTodo(title, descInput.value.trim(), dueDateInput.value || null, recurInput.checked);
  closeModal();
});

document.getElementById('addBtn').addEventListener('click', openModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal(); });

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════

document.getElementById('prevMonth').addEventListener('click', () => navigateMonth(-1));
document.getElementById('nextMonth').addEventListener('click', () => navigateMonth(1));

document.getElementById('todoList').addEventListener('change', e => {
  if (e.target.matches('input[type="checkbox"][data-id]'))
    toggleCompletion(e.target.dataset.id, e.target.dataset.recurring === 'true');
});

document.getElementById('todoList').addEventListener('click', e => {
  const btn = e.target.closest('[data-delete]');
  if (btn) showDeleteConfirm(btn.dataset.delete, btn.dataset.recurring === 'true');
});

// ═══════════════════════════════════════════════════════════
// INIT  (top-level await — requires type="module" on script tag)
// ═══════════════════════════════════════════════════════════

loadAuth();

if (!authMode) {
  showLoginScreen();
} else if (authMode === 'offline') {
  loadLocal();
  showAppScreen();
} else if (authMode === 'github' && authToken && gistId) {
  loadLocal();        // render local data instantly
  showAppScreen();
  try {
    await ghLoadFromGist(authToken, gistId);
    render();
    setSyncStatus('synced');
  } catch (err) {
    console.warn('Background sync failed:', err.message);
    setSyncStatus('error');
  }
} else {
  showLoginScreen();
}
