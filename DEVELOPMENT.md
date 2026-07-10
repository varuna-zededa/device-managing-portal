# Development Guide

Everything a developer needs to extend or debug the Device Managing Portal.  
For product decisions and data models, see [DESIGN.md](DESIGN.md).  
For the roadmap and v1 scope, see [PLAN.md](PLAN.md).

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node 20+
- (Optional) Docker + Docker Compose for the production-like setup

### Backend (Django)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env          # fill SECRET_KEY and ENCRYPTION_KEY (see below)
python manage.py migrate
python manage.py loaddata clusters_seed.json   # seeds the 6 pre-configured ZedCloud clusters
python manage.py runserver
```

Backend runs at `http://localhost:8000`. Admin UI at `/admin/` (create a superuser first with `python manage.py createsuperuser`).

### Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev
```

Vite dev server runs at `http://localhost:5173` and proxies `/api/*` to `localhost:8000` (see `vite.config.ts`).

### Environment variables (backend `.env`)
| Variable | Description |
|---|---|
| `SECRET_KEY` | Django secret key — generate with `python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"` |
| `ENCRYPTION_KEY` | Fernet key for IDRAC passwords and ZedCloud tokens — generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `DEBUG` | `True` for local dev; `False` in production |
| `ALLOWED_HOSTS` | Comma-separated allowed hostnames; `localhost,127.0.0.1` for dev |
| `SMTP_HOST` | SMTP server for emails; leave blank to disable email (in-app notifications still work) |
| `SMTP_PORT` | Default `587` |
| `SMTP_USER` | SMTP login |
| `SMTP_PASS` | SMTP password |
| `SMTP_FROM` | From address; default `device-portal@zededa.com` |
| `PORTAL_BASE_URL` | Used in email links; e.g. `http://localhost:5173` for dev, `http://myserver` for prod |

---

## Backend

### Project layout
```
backend/
├── config/
│   ├── settings.py      # django-environ reads .env; all config here
│   ├── urls.py          # /api/* routing; /admin/
│   └── wsgi.py
├── apps/
│   ├── clusters/        # Cluster model + CRUD API
│   ├── device_models/   # DeviceModel (model name + customer_partner_name)
│   ├── devices/         # Device + Lab models; main CRUD + reserve/release/status actions
│   ├── users/           # PortalUser + Team models; user management API
│   ├── vault/           # Vault (encrypted ZedCloud bearer tokens per user per cluster)
│   ├── reservations/    # ReservationRequest; approval/reject flow; confirmation page
│   └── admin_tools/     # Export + Import endpoints (admin-only)
├── services/
│   └── zedcloud.py      # ZedCloud API call + response parsing; serial verification
└── utils/
    ├── crypto.py         # Fernet encrypt() / decrypt()
    ├── email.py          # django.core.mail wrapper; no-op if SMTP_HOST unset
    └── permissions.py    # IsAdminPortalUser, IsOwnerOrAdmin DRF permission classes
```

### Key patterns

**Identifying the caller:** Every request (read or write) from the frontend includes an
`X-User-Email` header. The backend reads it to identify the caller and check `user_type`.
No session cookies. (SSO upgrade: a proxy layer injects a verified header from JWT and strips the client-supplied one.)

**Admin check:**
```python
user_email = request.headers.get('X-User-Email', '')
user = PortalUser.objects.get(email=user_email)
if user.user_type != 'admin':
    return Response({'error': 'Admin required'}, status=403)
```

**Encryption:** `utils/crypto.py` wraps Fernet. Use `encrypt(plaintext: str) -> bytes` and
`decrypt(ciphertext: bytes) -> str`. The key comes from `settings.ENCRYPTION_KEY`. Never
store the raw key in code — always read from environment.

**ZedCloud status fetch (`services/zedcloud.py`):**
1. Look up the device's cluster host.
2. Retrieve the bearer token from Vault (stored encrypted).
3. `GET https://{host}/api/v1/devices/name/{cluster_device_name}/status/info`
4. Parse `minfo.serialNumber` (primary) or `hardwareInfo.serialNum` (fallback); raise `SerialMismatchError` if it doesn't match the stored serial.
5. Parse `swInfo` for the active EVE version.
6. Parse `netStatusList` for up+uplink interfaces; field name is `ifName` (not `name`).
7. Map `runState` via `STATUS_MAP`.
8. Save the parsed values back to the `Device` row.

**Email:** `utils/email.py` exposes thin wrappers (`send_reservation_request`,
`send_reservation_approved`, etc.). All return silently if `settings.EMAIL_HOST` is blank. Use
`fail_silently=False` and catch + log exceptions — never swallow email failures silently.

### How to add a new API endpoint

1. Pick the right app (e.g. `apps/devices/`).
2. Add the view function or viewset method.
3. Wire it in `apps/{app}/urls.py`.
4. If it's a new URL prefix, register in `config/urls.py`.
5. Run the server and test with curl or the frontend.

No need to restart for Python changes in dev mode (`runserver` auto-reloads).

### How to add a new device condition

1. **`backend/apps/devices/models.py`** — add `('snake_case', 'Display Name')` to `CONDITION_CHOICES`.
2. **`backend/apps/devices/models.py`** — if the condition should block reservation (like `out_of_order`), add it to the `is_available` property exclusion list.
3. **`backend/apps/devices/views.py`** — add to `UNAVAILABLE_CONDITIONS` tuple if it should block reserve and clear owner.
4. **`backend/apps/reservations/views.py`** — add to `_UNAVAILABLE_CONDITIONS` tuple.
5. **`backend/apps/devices/views.py`** — add a branch in `_handle_condition_change()` if it has special side-effects (e.g. sends email like `out_of_order`, or requires a team like `dedicated`).
6. **`frontend/src/components/DeviceTable.tsx`** — add to `CONDITION_STYLES` (row highlight), `CONDITION_BADGE_STYLES` (name-column badge), and `isUnavailable` check if applicable.
7. **`frontend/src/components/SearchBar.tsx`** — add to `CONDITION_LABELS` map.
8. Run `makemigrations` if the DB enum needs to change (for SQLite this is usually a no-op but still do it for correctness).

### How to add a new Lab or Team

**No code changes needed.** Labs and Teams are DB-backed models.

- Log in to Django admin at `/admin/`.
- Navigate to **Devices → Labs** or **Users → Teams**.
- Click **Add** and enter the name.
- On next page load, the new lab/team appears in all dropdowns.

The `GET /api/choices/` endpoint queries `Lab.objects.values_list('name', flat=True)` and
`Team.objects.values_list('name', flat=True)` at request time.

### Running migrations

```bash
python manage.py makemigrations   # generates migration files after model changes
python manage.py migrate          # applies all pending migrations
```

Always commit migration files along with the model change that produced them.

### Django admin

The admin at `/admin/` is the primary tool for managing reference data. Key registered models:
- **Clusters** — ZedCloud cluster hostnames
- **Labs** — physical labs (add/remove here; no code change)
- **Teams** — user teams (add/remove here; no code change)
- **Devices** — filterable by lab, condition, team; searchable by name/serial/owner
- **Portal Users** — manage user roles and team assignments
- **Reservation Requests** — inspect pending/approved/rejected requests

---

## Frontend

### Project layout
```
frontend/src/
├── api/
│   ├── client.ts         # axios instance; injects X-User-Email header from localStorage
│   ├── devices.ts        # device CRUD, reserve/release/status/history API calls
│   ├── users.ts          # user CRUD
│   ├── choices.ts        # GET /api/choices/ — labs, teams, conditions
│   └── ...               # clusters, models, vault, reservations
├── context/
│   └── UserContext.tsx   # currentUser from localStorage; provides useUser()
├── components/
│   ├── DeviceTable.tsx   # main table: rows, expand panel, sorting, condition styles
│   ├── SearchBar.tsx     # search box + availability chips + condition/lab/team filters
│   ├── Header.tsx        # user chip, log out, notification bell
│   ├── NotificationPanel.tsx  # in-app reservation notifications
│   ├── DeviceFormModal.tsx    # add/edit device
│   ├── ReserveDialog.tsx
│   ├── OwnershipHistoryModal.tsx
│   └── ui/               # shadcn/ui base components (button, dialog, select, etc.)
└── pages/
    ├── DevicesPage.tsx          # / — device list + summary bar
    ├── UsersPage.tsx            # /users — admin only
    ├── LoginPage.tsx            # /login
    └── ConfirmReservationPage.tsx  # /confirm/:token — no auth needed
```

### Key patterns

**API client (`src/api/client.ts`):**
All requests go through an axios instance that automatically attaches
`X-User-Email: {email}` from `localStorage`. Import this client in all API modules —
never use `fetch` or a bare `axios` directly.

**User context (`src/context/UserContext.tsx`):**
`useUser()` returns `{ user, isAdmin, isLoading }`. The `UserContext` reads
`localStorage["currentUserEmail"]` on mount and redirects to `/login` if empty.
Admin-only pages call `useUser()` and redirect non-admins to `/devices`.

**Data fetching (TanStack Query):**
All server state is managed with `useQuery` and `useMutation`. Cache key conventions:
- `['devices']` — full device list
- `['users']` — portal user list
- `['choices']` — labs/teams/conditions (cached forever via `staleTime: Infinity`)
- `['reservations', 'pending']` — requests awaiting current user's action
- `['reservations', 'mine']` — requests made by current user

After any mutation, call `queryClient.invalidateQueries({ queryKey: ['devices'] })` (or the
relevant key) to refresh the table.

**Condition constants (`DeviceTable.tsx`):**

```typescript
const CONDITION_STYLES: Record<string, string> = {
  out_of_order:        'border-l-4 border-l-red-500 bg-red-950/10',
  needs_repair:        'border-l-4 border-l-yellow-400 bg-yellow-950/10',
  temporarily_leased:  'border-l-4 border-l-violet-400 bg-violet-950/10',
  dedicated:           'border-l-4 border-l-blue-400 bg-blue-950/10',
  missing:             'border-l-4 border-l-orange-400 bg-orange-50/10',
}

const CONDITION_BADGE_STYLES: Record<string, string> = {
  out_of_order:        'bg-red-500/20 text-red-400 border-red-500/30',
  needs_repair:        'bg-yellow-400/20 text-yellow-400 border-yellow-400/30',
  temporarily_leased:  'bg-violet-400/20 text-violet-400 border-violet-400/30',
  dedicated:           'bg-blue-400/20 text-blue-400 border-blue-400/30',
  missing:             'bg-orange-400/20 text-orange-400 border-orange-400/30',
}
```

When adding a new condition: add entries to both maps, add to `CONDITION_LABELS` in
`SearchBar.tsx`, and add to the `isUnavailable` check in `DeviceTable.tsx` if it should
show "UNAVAILABLE" in the Owner column.

**Condition display:** Condition values come from the backend as snake_case
(`needs_repair`). Display as title-case with:
```typescript
condition.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
// "needs_repair" → "Needs Repair"
```

**Dynamic labs/teams (`src/api/choices.ts`):**
The `getChoices()` function calls `GET /api/choices/` which queries the DB at runtime.
The result is cached with `staleTime: Infinity` — on a full page reload the cache is
cleared and fresh values are fetched, so any labs/teams added via Django admin are
automatically available after a refresh.

**Sorting pattern (`DeviceTable.tsx`):**
```typescript
const [sortKey, setSortKey] = useState<SortKey>(null)
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

const sorted = useMemo(() => {
  if (!sortKey) return devices
  return [...devices].sort((a, b) => {
    let av = '', bv = ''
    // ... switch (sortKey) to extract string value ...
    if (!av && bv) return 1   // empty values always last
    if (av && !bv) return -1
    return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
  })
}, [devices, sortKey, sortDir])
```

Column headers pass `onSort` and `sortDirection` props to show the sort icon.

### Adding a new filter

1. Add state in `DevicesPage.tsx`: `const [myFilter, setMyFilter] = useState('')`
2. Pass state + setter to `SearchBar` and to `DeviceTable` props.
3. In `SearchBar.tsx`: add the `<Select>` for the filter.
4. In `DevicesPage.tsx` or the query params: include the filter value in `GET /api/devices` call.
5. In `backend/apps/devices/views.py` `DeviceViewSet.get_queryset()`: add the filter clause.

### Adding a new table column

1. Add the field to the `Device` serializer in `backend/apps/devices/serializers.py`.
2. In `DeviceTable.tsx`:
   - Add a `<th>` in the header row with sort handling if needed.
   - Add a `<td>` in the row body.
   - Add to the `SortKey` type and `switch` block if sortable.
3. If the field is displayed in the expand panel, add a `<CopyableField>` in the relevant card.

### Running in development

```bash
# Terminal 1 — backend
cd backend && python manage.py runserver

# Terminal 2 — frontend
cd frontend && npm run dev
```

Navigate to `http://localhost:5173`. API calls proxy to `localhost:8000` via the Vite config.

### TypeScript types

All response shapes are typed in `src/api/devices.ts` (the `Device` interface). When adding
a new backend field, update the interface — TypeScript will flag every place the field needs
to be consumed.

---

## Data flow for ZedCloud status fetch

```
User clicks "Fetch Status" → FetchStatusDialog opens
  │
  └─ POST /api/devices/{id}/status
       body: { bearer_token, cluster_id, cluster_device_name }
       │
       ├─ Backend saves token to Vault (encrypted)
       ├─ Calls services/zedcloud.fetch_device_status()
       │   ├─ GET https://{cluster.host}/api/v1/devices/name/{name}/status/info
       │   ├─ Verifies serial: minfo.serialNumber → hardwareInfo.serialNum → skip if absent
       │   ├─ Parses EVE version from swInfo[activated].shortVersion
       │   ├─ Parses connectivity from netStatusList (up=true, uplink=true, field: ifName)
       │   └─ Maps runState via STATUS_MAP
       └─ Saves eve_version, device_connectivity, status, status_fetched_at to Device row
```

**Important ZedCloud field names (verified against live API):**
- Interface name: `ifName` (not `name`)
- Serial number: `minfo.serialNumber` (primary), `hardwareInfo.serialNum` (fallback)
- EVE version: `swInfo[i].shortVersion` where `swInfo[i].activated == true`
- Run state: `runState` (enum string like `RUN_STATE_ONLINE`)

---

## Common development tasks

### Add a new email notification

1. Add a function to `backend/utils/email.py` following the existing pattern.
2. Call it from the relevant view after the state change.
3. The function is a no-op if `settings.EMAIL_HOST` is blank — no special handling needed.

### Change a Tailwind color token

The frontend uses Tailwind v4 with CSS variable tokens. Base colors are in `src/index.css`.
Component-level overrides use inline Tailwind classes (`text-red-400`, `bg-orange-50/10`, etc.).
Do not add new CSS variables unless adding a new semantic token — prefer direct Tailwind classes.

### Inspect or reset the database

```bash
cd backend
python manage.py shell
>>> from apps.devices.models import Device
>>> Device.objects.all()
```

To reset completely (local dev only):
```bash
rm backend/data/db.sqlite3
python manage.py migrate
python manage.py loaddata clusters_seed.json
```

### Docker build

```bash
cp .env.example .env   # fill in variables
docker compose up -d   # builds both containers and starts them
docker compose logs -f # tail logs
docker compose down    # stop (data persists in volumes)
```

Admin at `http://localhost/admin/` (port 80, nginx proxy to gunicorn).
