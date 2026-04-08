/* ─────────────────────────────────────────────────────────
   ToDos App — app.js
   Storage: localStorage (no backend / no database)
   Data model:
     todos[]       – { id, title, description, month, year,
                       isRecurring, isCompleted, createdAt }
     completions[] – { todoId, month, year }   (recurring only)
───────────────────────────────────────────────────────── */

const STORAGE_KEY = 'todos_app_v1';

// ── State ─────────────────────────────────────────────────
const today = new Date();
let currentMonth = today.getMonth() + 1; // 1-12
let currentYear  = today.getFullYear();
let todos        = [];
let completions  = [];   // tracks per-month done state for recurring todos

// ── Persistence ───────────────────────────────────────────
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data  = JSON.parse(raw);
      todos       = data.todos       || [];
      completions = data.completions || [];
    }
  } catch { /* first run or corrupted data — start fresh */ }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ todos, completions }));
}

// ── Helpers ───────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function escape(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

// ── Business logic ────────────────────────────────────────
/**
 * Returns todos visible in the current month view, each augmented
 * with an `isCompletedThisMonth` boolean for rendering.
 */
function getTodosForMonth(month, year) {
  // 1. One-off todos belonging exactly to this month/year
  const oneOff = todos.filter(
    t => !t.isRecurring && t.month === month && t.year === year
  );

  // 2. Recurring todos whose start month is on or before this month/year
  const recurring = todos.filter(
    t => t.isRecurring && (
      t.year < year || (t.year === year && t.month <= month)
    )
  );

  // Set of todoIds completed in this specific month (for recurring)
  const doneSet = new Set(
    completions
      .filter(c => c.month === month && c.year === year)
      .map(c => c.todoId)
  );

  const decorate = t => ({
    ...t,
    isCompletedThisMonth: t.isRecurring ? doneSet.has(t.id) : t.isCompleted
  });

  return [
    ...oneOff.map(decorate),
    ...recurring.map(decorate)
  ].sort((a, b) => a.createdAt - b.createdAt);
}

function addTodo(title, description, isRecurring) {
  todos.push({
    id:          uid(),
    title,
    description,
    isCompleted: false,
    month:       currentMonth,
    year:        currentYear,
    isRecurring,
    createdAt:   Date.now()
  });
  save();
  render();
}

function toggleCompletion(todoId, isRecurring) {
  if (isRecurring) {
    const idx = completions.findIndex(
      c => c.todoId === todoId && c.month === currentMonth && c.year === currentYear
    );
    if (idx >= 0) completions.splice(idx, 1);
    else           completions.push({ todoId, month: currentMonth, year: currentYear });
  } else {
    const todo = todos.find(t => t.id === todoId);
    if (todo) todo.isCompleted = !todo.isCompleted;
  }
  save();
  render();
}

function deleteTodo(todoId) {
  todos       = todos.filter(t => t.id !== todoId);
  completions = completions.filter(c => c.todoId !== todoId);
  save();
  render();
}

function navigateMonth(delta) {
  const d = new Date(currentYear, currentMonth - 1 + delta);
  currentMonth = d.getMonth() + 1;
  currentYear  = d.getFullYear();
  render();
}

// ── Render ────────────────────────────────────────────────
function render() {
  const items = getTodosForMonth(currentMonth, currentYear);

  // Month label
  document.getElementById('monthLabel').textContent =
    `${MONTHS[currentMonth - 1]} ${currentYear}`;

  // Progress bar
  const progressSection = document.getElementById('progressSection');
  if (items.length > 0) {
    const done  = items.filter(t => t.isCompletedThisMonth).length;
    const pct   = Math.round((done / items.length) * 100);
    document.getElementById('progressFill').style.width = pct + '%';
    document.getElementById('progressText').textContent =
      `${done} / ${items.length} completed`;
    progressSection.classList.add('visible');
  } else {
    progressSection.classList.remove('visible');
  }

  // Empty state
  const emptyState = document.getElementById('emptyState');
  if (items.length === 0) {
    document.getElementById('emptyTitle').textContent =
      `No todos for ${MONTHS[currentMonth - 1]}`;
    emptyState.classList.add('visible');
  } else {
    emptyState.classList.remove('visible');
  }

  // Todo cards
  document.getElementById('todoList').innerHTML = items.map(t => `
    <div class="todo-card${t.isCompletedThisMonth ? ' completed' : ''}">
      <div class="checkbox-wrap">
        <input
          type="checkbox"
          ${t.isCompletedThisMonth ? 'checked' : ''}
          data-id="${t.id}"
          data-recurring="${t.isRecurring}"
          aria-label="Mark complete"
        />
      </div>
      <div class="todo-content">
        <div class="todo-title-row">
          <span class="todo-title">${escape(t.title)}</span>
          ${t.isRecurring ? '<span class="badge-recurring">Recurring</span>' : ''}
        </div>
        ${t.description ? `<p class="todo-desc">${escape(t.description)}</p>` : ''}
      </div>
      <div class="todo-actions">
        <button
          class="delete-btn"
          data-delete="${t.id}"
          data-recurring="${t.isRecurring}"
          aria-label="Delete todo"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

// ── Confirm-delete dialog ─────────────────────────────────
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
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('cfmCancel').onclick = () => overlay.remove();
  document.getElementById('cfmDelete').onclick = () => {
    deleteTodo(todoId);
    overlay.remove();
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

// ── Modal ─────────────────────────────────────────────────
const modalOverlay = document.getElementById('modalOverlay');
const todoForm     = document.getElementById('todoForm');
const titleInput   = document.getElementById('titleInput');
const descInput    = document.getElementById('descInput');
const recurInput   = document.getElementById('recurringInput');
const submitBtn    = document.getElementById('submitBtn');
const titleError   = document.getElementById('titleError');

function openModal() {
  todoForm.reset();
  titleInput.classList.remove('invalid');
  titleError.classList.remove('visible');
  submitBtn.disabled = true;
  modalOverlay.classList.add('open');
  setTimeout(() => titleInput.focus(), 60);
}

function closeModal() {
  modalOverlay.classList.remove('open');
}

titleInput.addEventListener('input', () => {
  const filled = titleInput.value.trim().length > 0;
  submitBtn.disabled = !filled;
  if (filled) {
    titleInput.classList.remove('invalid');
    titleError.classList.remove('visible');
  }
});

todoForm.addEventListener('submit', e => {
  e.preventDefault();
  const title = titleInput.value.trim();
  if (!title) {
    titleInput.classList.add('invalid');
    titleError.classList.add('visible');
    titleInput.focus();
    return;
  }
  addTodo(title, descInput.value.trim(), recurInput.checked);
  closeModal();
});

document.getElementById('addBtn').addEventListener('click', openModal);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal();
});

// ── Navigation ────────────────────────────────────────────
document.getElementById('prevMonth').addEventListener('click', () => navigateMonth(-1));
document.getElementById('nextMonth').addEventListener('click', () => navigateMonth(1));

// ── Delegated events on todo list ─────────────────────────
document.getElementById('todoList').addEventListener('change', e => {
  if (e.target.matches('input[type="checkbox"][data-id]')) {
    toggleCompletion(e.target.dataset.id, e.target.dataset.recurring === 'true');
  }
});

document.getElementById('todoList').addEventListener('click', e => {
  const btn = e.target.closest('[data-delete]');
  if (btn) showDeleteConfirm(btn.dataset.delete, btn.dataset.recurring === 'true');
});

// ── Init ──────────────────────────────────────────────────
load();
render();
