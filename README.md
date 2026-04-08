# ToDos App

A clean, minimal web app to manage your todos on a **monthly basis** — no backend, no database required. Optionally sync across devices using a free GitHub account.

## Features

- **Monthly view** — navigate between any month with `‹ ›` arrows
- **Add todos** — title, optional description, and a recurring toggle
- **Check off** — checkbox per item with strike-through styling and a live progress bar
- **Recurring todos** — toggle to make a todo repeat every month going forward; each month tracks its own checked state independently
- **Delete with confirmation** — trash button warns if the todo is recurring (deletes from all months)
- **GitHub sync** — sign in with a GitHub Personal Access Token to store todos in a private Gist and access them from any device
- **Offline mode** — skip sign-in and use `localStorage` only; data persists across refreshes in the same browser

## Tech Stack

- Vanilla HTML / CSS / JavaScript — zero dependencies, zero build step
- `localStorage` for local persistence
- GitHub Gist API for optional cross-device sync (`type="module"` script for top-level `await`)

## Project Structure

```
ToDos-App/
├── index.html   # Login screen, app shell, and modal markup
├── style.css    # Material-inspired design system
└── app.js       # Auth, GitHub Gist API, sync logic, business logic, rendering
```

## Getting Started

Open `index.html` in any modern browser — no install or server required.

```bash
open index.html   # macOS
# or drag index.html into your browser
```

### Syncing across devices (optional)

1. Go to [github.com/settings/tokens/new?scopes=gist&description=ToDos+App](https://github.com/settings/tokens/new?scopes=gist&description=ToDos+App)
2. Set expiration to **No expiration**, check only the **gist** scope, and generate the token
3. Paste it into the app's login screen and click **Connect to GitHub**
4. Your todos are stored in a private Gist — paste the same token on any other device to sync

To use without a GitHub account, click **Continue without syncing** on the login screen.

## Sync Behaviour

Changes are saved to `localStorage` immediately and pushed to the Gist after a **1.5 s debounce**. On page load the app compares a `lastModified` timestamp between local storage and the Gist and lets the newer side win:

| Situation | Result |
|---|---|
| Gist is newer (e.g. edited on another device) | Pull from Gist |
| Local is newer (e.g. refreshed before sync fired) | Push local data to Gist |
| Both equal (first connect or no changes) | No action |

A colour-coded dot in the header shows sync state: **yellow** = syncing, **green** = synced, **red** = error.

## Data Model

### `localStorage` key `todos_app_v1`

| Array | Fields | Purpose |
|---|---|---|
| `todos` | `id, title, description, month, year, isRecurring, isCompleted, createdAt` | All todos |
| `completions` | `todoId, month, year` | Per-month completion state for recurring todos |
| `lastModified` | unix timestamp (ms) | Used to resolve local vs. remote conflicts on refresh |

### `localStorage` key `todos_auth_v1`

| Field | Purpose |
|---|---|
| `token` | GitHub Personal Access Token |
| `gistId` | ID of the private Gist used for storage |
| `user` | Cached GitHub username and avatar URL |
| `mode` | `"github"` or `"offline"` |

Recurring todos are stored as a single record and appear in every month from their start month onward. Completion is tracked per month in the `completions` array, so checking off April does not affect May.
