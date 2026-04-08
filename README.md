# ToDos App

A clean, minimal web app to manage your todos on a **monthly basis** — no backend, no database, just your browser.

## Features

- **Monthly view** — navigate between any month with `‹ ›` arrows
- **Add todos** — title, optional description, and a recurring toggle
- **Check off** — checkbox per item with strike-through styling and a live progress bar
- **Recurring todos** — toggle to make a todo repeat every month going forward; each month tracks its own checked state independently
- **Persistent storage** — all data saved in `localStorage`, survives page refreshes and browser restarts
- **Delete with confirmation** — trash button warns if the todo is recurring (deletes from all months)

## Tech Stack

- Vanilla HTML / CSS / JavaScript — zero dependencies, zero build step
- `localStorage` for client-side persistence

## Project Structure

```
ToDos-App/
├── index.html   # App shell and modal markup
├── style.css    # Material-inspired design system
└── app.js       # State, storage, business logic, rendering
```

## Getting Started

Just open `index.html` in any modern browser — no install or server required.

```bash
open index.html   # macOS
# or drag index.html into your browser
```

## Data Model

Two arrays are stored in `localStorage` under the key `todos_app_v1`:

| Array | Fields | Purpose |
|---|---|---|
| `todos` | `id, title, description, month, year, isRecurring, isCompleted, createdAt` | All todos |
| `completions` | `todoId, month, year` | Per-month completion state for recurring todos |

Recurring todos store a single record and appear in every month from their start month onward. Completion is tracked separately per month so checking off "April" doesn't affect "May".
