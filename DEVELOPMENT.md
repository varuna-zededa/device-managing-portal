# Development Reference

AI-targeted implementation guide. For product decisions and data models: [DESIGN.md](DESIGN.md).
For critical conventions and gotchas: [CLAUDE.md](CLAUDE.md).

---

## API versioning

All endpoints are prefixed `/api/v1/`. The frontend axios client (`src/api/client.ts`) sets `baseURL: '/api/v1'` so all API module calls automatically use the correct prefix.

---

## Running locally

```bash
# Backend
cd backend
cp .env.example .env          # set SECRET_KEY and ENCRYPTION_KEY
uv run python manage.py migrate
uv run python manage.py loaddata clusters_seed.json
uv run python manage.py create_admin --email=you@example.com --name="Your Name"
uv run python manage.py runserver    # http://localhost:8000

# Frontend (separate terminal)
cd frontend && npm install
npm run dev                   # http://localhost:5173 — proxies /api/* to :8000
```

Generate keys:
```bash
# SECRET_KEY
openssl rand -base64 50
# ENCRYPTION_KEY (Fernet requires URL-safe base64)
openssl rand -base64 32 | tr '\+/' '\-_'
```

Django admin (create superuser first): `python manage.py createsuperuser` → `/admin/`

---

## Backend

### Project layout
```text
backend/
├── config/settings.py           all settings; reads .env via django-environ
│                                DEVICE_LIST_REFRESH_MS / NOTIFICATION_REFRESH_MS — auto-refresh intervals
├── config/urls.py               /api/* routing; /admin/; VersionView; ConfigView (GET /api/v1/config/)
├── apps/clusters/               Cluster model + CRUD
├── apps/device_models/          DeviceModel (name + customer_partner_name)
├── apps/devices/
│   ├── models.py                Device, Lab, UntrackedDevice, ADMIN_CONDITION_CHOICES, SYNC_CONDITION_CHOICES
│   ├── views.py                 DeviceViewSet; _handle_admin_condition_change; ChoicesView; UntrackedDeviceListView; MoveToInventoryView
│   ├── serializers.py
│   ├── admin.py                 Device, Lab registered
│   ├── untracked_urls.py        /api/v1/untracked-devices/ routes
│   └── migrations/
├── apps/users/
│   ├── models.py                PortalUser, Team
│   ├── views.py
│   ├── admin.py                 PortalUser, Team registered
│   └── migrations/
├── apps/enterprises/            Enterprise model + CRUD + sync engine
│   ├── models.py                Enterprise (name, cluster FK, bearer_token_enc, zcloud_id, is_active, name_verified, last_sync_*)
│   ├── views.py                 EnterpriseDetailView, EnterpriseSyncView, ClusterExportView, ClusterImportView; ClusterEnterpriseListCreateView
│   ├── sync.py                  sync_all_enterprises(), verify_enterprise_names()
│   ├── apps.py                  APScheduler registration (1h sync + midnight nightly digest)
│   ├── serializers.py
│   └── urls.py                  /api/v1/enterprises/ routes
├── apps/notifications/          Admin notification model
│   ├── models.py                Notification (kind, enterprise FK, title, body, is_read)
│   └── urls.py                  /api/v1/notifications/ routes
├── apps/reservations/
│   ├── views.py                 reservation flow; approve gate: admin_condition=='normal' AND sync_condition is None
│   └── models.py                ReservationRequest
├── apps/admin_tools/views.py    ExportView, ImportView, ImportTemplateView, LatencyView, _normalize_admin_condition()
├── services/zedcloud.py         fetch_device_status(); fetch_enterprise_devices(); SerialMismatchError
└── utils/
    ├── crypto.py                encrypt(str)->bytes; decrypt(bytes)->str
    ├── email.py                 all outbound email functions (incl. token-expiry + nightly digest)
    ├── log_filters.py           RequestIDFilter — stamps request_id on every LogRecord
    ├── permissions.py           get_user_email(), is_admin(); IsPortalUser, IsAdminPortalUser, IsOwnerOrAdmin
    └── request_context.py       ContextVar holder; get_request_id() / set_request_id()
```

### Auth pattern — every protected view

Every view declares `permission_classes` explicitly. `DEFAULT_PERMISSION_CLASSES = []` so any view without it is public.

```python
from utils.permissions import get_user_email, is_admin, IsPortalUser, IsAdminPortalUser

class MyView(APIView):
    permission_classes = [IsPortalUser]       # any registered user
    # or: permission_classes = [IsAdminPortalUser]  # admin only; replaces inline is_admin() check
    # or: permission_classes = []             # public (token-based endpoints only)

    def post(self, request):
        user_email = get_user_email(request)  # reads X-User-Email header

        # inline admin check (only when class uses IsPortalUser but one method needs admin)
        if not is_admin(user_email):
            return Response({'error': 'Admin only'}, status=403)

        # owner check
        if device.owner_email != user_email:
            return Response({'error': 'Not the owner'}, status=403)
```

**Permission classes in `utils/permissions.py`:**
| Class | Allows |
|---|---|
| `IsPortalUser` | Any email registered in the PortalUser table |
| `IsAdminPortalUser` | Users with `user_type == 'admin'` |
| `IsOwnerOrAdmin` | Object owner or admin (for `check_object_permissions`) |

### Encryption pattern
```python
from utils.crypto import encrypt, decrypt

# store
device.idrac_password_enc = encrypt(raw_password)

# retrieve (never expose in API response)
raw = decrypt(device.idrac_password_enc)
```

#### Admin condition change side-effects (`apps/devices/views.py` → `_handle_admin_condition_change`)

Only `admin_condition` changes trigger side-effects. `sync_condition` is set by the sync engine and has no side-effect logic.

| New `admin_condition` | Clears owner | Expires requests | Emails admins |
|---|---|---|---|
| `out_of_order` | yes | yes | yes |
| `temporarily_leased` | yes | yes | no |
| `dedicated` | yes | yes | no (requires `device.team` set) |
| `normal` (clear) | no | no | no |

### Serializer field validation pattern

All write serializers validate inputs. Follow these patterns when adding new fields:

**FK fields (lab, team):** Use `SlugRelatedField` — accepts/returns the name string, enforces FK at DB level:
```python
lab = serializers.SlugRelatedField(queryset=Lab.objects.all(), slug_field='name')
```

**Nullable FK fields (device team):** Use `NullableSlugRelatedField` from `apps/devices/serializers.py` — converts `""` to `None`:
```python
team = NullableSlugRelatedField(
    queryset=Team.objects.all(), slug_field='name', allow_null=True, required=False,
)
```

**String validators in serializers:**
```python
def validate_name(self, value):
    if not (value or '').strip():
        raise serializers.ValidationError('Name must not be blank.')
    return value.strip()
```

**Always add `select_related` for FK fields** to avoid N+1 queries:
```python
Device.objects.select_related('model', 'cluster', 'lab', 'team')
```

**Filter queries after FK conversion** use double-underscore traversal:
```python
qs.filter(team__name=team)   # not qs.filter(team=team)
qs.filter(lab__name=lab)
```

### Email pattern
```python
from utils.email import send_reservation_request   # example

# always fail_silently=False; catch and log
try:
    send_reservation_request(device, requester, owner)
except Exception as e:
    logger.warning('Email failed: %s', e)
```

#### ZedCloud fetch (`services/zedcloud.py`)

A module-level `_client = httpx.Client(timeout=30)` is shared across all calls (connection reuse, no per-call overhead).

```python
_client = httpx.Client(timeout=30)

def fetch_device_status(
    cluster, cluster_device_name: str, bearer_token: str, device,
) -> tuple[str | None, list | None, str]:
    url = f'https://{cluster.host}/api/v1/devices/name/{cluster_device_name}/status/info'
    response = _client.get(url, headers={'Authorization': f'Bearer {bearer_token}'})
    response.raise_for_status()
    data = response.json()

    # serial: minfo first, hardwareInfo fallback
    actual_serial = data.get('minfo', {}).get('serialNumber', '') \
                    or data.get('hardwareInfo', {}).get('serialNum', '')

    # EVE version: active partition
    eve_version = next((sw['shortVersion'] for sw in data.get('swInfo', []) if sw.get('activated')), None)

    # connectivity: up + uplink interfaces; field is ifName (NOT name)
    connectivity = []
    for iface in data.get('netStatusList', []):
        if iface.get('up') and iface.get('uplink'):
            for ip in iface.get('ipAddrs', []):
                if ':' not in ip:   # IPv4 only
                    connectivity.append({'ip': ip, 'mac': iface.get('macAddr', ''), 'interface_name': iface.get('ifName', '')})

    run_state = data.get('runState', 'RUN_STATE_UNKNOWN')
    return eve_version, connectivity or None, STATUS_MAP.get(run_state, 'Unknown')
```

**`fetch_enterprise_self(host, bearer_token)`** — canonical function to call `/v1/enterprises/self` on ZedCloud:
- Lives in `services/zedcloud.py`
- Returns `{'name': str, 'zcloud_id': str, 'state': str, 'state_label': str}`
- Used by `ClusterEnterpriseListCreateView.post()` to validate and name enterprises created via the UI
- Constants also in `services/zedcloud.py`: `ENTERPRISE_STATE_ACTIVE = 'ENTERPRISE_STATE_ACTIVE'`; `_ENTERPRISE_STATE_LABELS` maps state strings to human-readable labels

**`fetch_user_self(host, bearer_token)`** — fetches the ZedCloud user associated with a bearer token:
- Lives in `services/zedcloud.py`
- Calls `GET /v1/users/self` and returns `{'username': str}`
- Called after every successful token verification (enterprise create, token rotation, import overwrite/create)
- Result stored in `Enterprise.zcloud_username`; displayed on the enterprise card in the UI
- Failure is non-blocking — logs a warning (401 = no/invalid token, 403 = insufficient permissions, 404 = user not found) and stores `''`

**Device status endpoint — `POST /api/v1/devices/{id}/status/`**
- Accepts `enterprise_id` (integer FK) — **not** a raw bearer token
- Backend looks up the `Enterprise` row by id, decrypts `bearer_token_enc` server-side, then calls ZedCloud
- Do not pass bearer tokens directly from the frontend

### Logging

Every module declares a module-level logger — no exceptions:

```python
import logging
logger = logging.getLogger(__name__)
```

#### Request ID

`RequestIDMiddleware` (first in the middleware stack) assigns a UUID4 to every HTTP request and stores it in a `ContextVar` (`utils/request_context.py`). `RequestIDFilter` stamps it automatically on every log record — no change to call sites needed.

Log lines look like:

```
2026-07-14 10:23:45,123 INFO     [a3f2b1c0-4e12] apps.devices.views: Device 42 status fetched for user@example.com
2026-07-14 10:23:45,190 WARNING  [a3f2b1c0-4e12] services.zedcloud: ZedCloud HTTP 503 for device my-device
2026-07-14 10:24:01,002 INFO     [sync-7f3a1b]   apps.enterprises.sync: Starting sync_all_enterprises
2026-07-14 10:24:01,401 INFO     [-]              apps.enterprises.apps: APScheduler started
```

The ID is echoed in the `X-Request-ID` response header so the browser can correlate an error to its server-side trace.

#### Background job IDs

Call `set_request_id()` at the very top of any new background or scheduled function:

```python
import uuid
from utils.request_context import set_request_id

def my_scheduled_job() -> None:
    set_request_id(f'job-{uuid.uuid4().hex[:8]}')
    logger.info('Starting my_scheduled_job')
    ...
```

Without this, all lines from concurrent jobs share the default `[-]` marker and are ungreppable.

#### Log levels — when to use each

| Level | When |
|---|---|
| `DEBUG` | Per-request detail, intermediate values — verbose, off by default in prod |
| `INFO` | Job start/end, significant state changes (enterprise synced, device marked missing) |
| `WARNING` | Recoverable errors — ZedCloud non-200, decrypt failure, email failure; **always include context** |
| `ERROR` | Unhandled thread exceptions (via `threading.excepthook`), unexpected unrecoverable states |
| `exception` | Inside `except` blocks where you want the full traceback attached automatically |

Always include enough context to identify the failing entity without opening the DB:

```python
# Bad — tells you nothing
logger.warning(str(e))

# Good
logger.warning('ZedCloud HTTP %s syncing enterprise %s', code, enterprise.name)
logger.warning('Email send failed for device %s to %s: %s', device.name, owner_email, e)
logger.exception('Sync failed for enterprise %s', enterprise.name)
```

Never log bearer tokens, `idrac_password_enc`, or any decrypted secret.

#### Env vars

| Var | Default | Notes |
|---|---|---|
| `LOG_LEVEL` | `INFO` | Set to `DEBUG` for full request tracing during debugging |
| `LOG_DIR` | `backend/logs/` locally; `/app/logs/` in Docker | Directory must exist before server starts |
| `ADMIN_EMAILS` | _(empty)_ | Comma-separated; receives Django 500-error email alerts |

#### Finding logs

- **Local dev:** `backend/logs/portal.log` — rotated daily, 30 days retained
- **Docker:** `./logs/portal.log` — bind-mounted from repo root `logs/`; also available via `docker logs <container>` (console handler stays active)

Grep workflows:

```bash
# Trace a single UI request end-to-end
grep 'a3f2b1c0-4e12' logs/portal.log

# Trace a single sync run
grep 'sync-7f3a1b' logs/portal.log

# All warnings and above from the last hour
grep -E 'WARNING|ERROR' logs/portal.log | tail -200

# Watch live (Docker)
docker logs --follow portal-backend
```

---

### Choices endpoint (`apps/devices/views.py` → `ChoicesView`)
```python
return Response({
    'labs':             list(Lab.objects.values_list('name', flat=True)),
    'teams':            list(Team.objects.values_list('name', flat=True)),
    'admin_conditions': [c[0] for c in ADMIN_CONDITION_CHOICES],
    'sync_conditions':  [c[0] for c in SYNC_CONDITION_CHOICES],
    'enterprises':      list(Enterprise.objects.filter(is_active=True).values('id', 'name', cluster_name=F('cluster__name'))),
})
```
Do not hardcode lab, team, or enterprise lists here. The `enterprises` list is used by the Fetch Status dialog dropdown.
`choices` is cached with `staleTime: Infinity` on the frontend — uses `admin_conditions` and `sync_conditions` keys (no `conditions` key).

### Migrations
```bash
python manage.py makemigrations   # after any model change
python manage.py migrate
```
Always commit migration files with the model change that produced them.

---

## Frontend

### Frontend project layout
```text
frontend/src/
├── api/
│   ├── client.ts          axios instance; auto-injects X-User-Email from localStorage
│   ├── devices.ts         device CRUD + reserve/release/status/history
│   ├── users.ts           user CRUD + exportUsers/importUsers (JSON)
│   ├── choices.ts         getChoices() → {labs, teams, admin_conditions, sync_conditions, enterprises}
│   ├── enterprises.ts     getClusters/createCluster/updateCluster/deleteCluster; createEnterprise/updateEnterprise/deleteEnterprise/syncEnterprise; ClusterExport/Import
│   ├── deviceModels.ts    getDeviceModels/createDeviceModel
│   ├── notifications.ts   getNotifications/markNotificationRead/markAllNotificationsRead
│   └── untracked.ts       getUntrackedDevices/moveToInventory
├── context/UserContext.tsx useUser() → {user, isAdmin}; redirects to /login if no session
├── components/
│   ├── DeviceTable.tsx    ADMIN_CONDITION_STYLES, SYNC_CONDITION_STYLES, ADMIN_CONDITION_BADGE_STYLES, SYNC_CONDITION_BADGE_STYLES, sort logic, expand panel
│   ├── SearchBar.tsx      ADMIN_CONDITION_LABELS, SYNC_CONDITION_LABELS; filter order: availability→condition→sync status→lab→team
│   ├── Header.tsx
│   ├── NotificationPanel.tsx  admin notifications (token_expired/sync_error/name_mismatch/enterprise_inactive); name_mismatch has inline action buttons
│   ├── DeviceFormModal.tsx
│   ├── ReserveDialog.tsx
│   ├── OwnershipHistoryModal.tsx
│   ├── MoveToInventoryDialog.tsx  searchable + creatable device model combobox; creates new model via POST /api/v1/models/ before move
│   ├── ImportClusterDialog.tsx
│   ├── UserImportDialog.tsx
│   └── ui/                shadcn/ui base components
└── pages/
    ├── DevicesPage.tsx           summary bar; passes filter state to SearchBar + DeviceTable
    ├── UsersPage.tsx             sortable table; admin only
    ├── ClusterEnterprisesPage.tsx  admin-only; manage clusters + enterprises; import/export
    ├── UntrackedDevicesPage.tsx  devices seen in ZedCloud but not in inventory; cluster+enterprise dropdown filter; move-to-inventory action
    ├── LoginPage.tsx
    └── ConfirmReservationPage.tsx  /confirm/:token; no auth needed
```

### API call pattern
```typescript
// query
const { data: devices = [], isLoading } = useQuery({
  queryKey: ['devices'],
  queryFn: getDevices,
})

// mutation — always invalidate after success
const mutation = useMutation({
  mutationFn: (id: number) => releaseDevice(id),
  onSuccess: () => {
    toast.success('Released')
    queryClient.invalidateQueries({ queryKey: ['devices'] })
  },
  onError: () => toast.error('Failed'),
})
```

Cache keys in use: `['devices']`, `['users']`, `['choices']`, `['reservations','pending']`, `['reservations','mine']`, `['notifications']`, `['clusters-enterprises']`, `['untracked-devices']`, `['device-models']`.  
`choices` uses `staleTime: Infinity` — cache cleared on full page reload.

### Condition constants (`DeviceTable.tsx`)

Two separate sets — admin (user-controlled) and sync (engine-controlled):

```typescript
// Row border: admin wins over sync; neither if both normal/null
const ADMIN_CONDITION_STYLES: Record<string, string> = {
  out_of_order:       'border-l-4 border-l-red-500 bg-red-950/10',
  temporarily_leased: 'border-l-4 border-l-violet-400 bg-violet-950/10',
  dedicated:          'border-l-4 border-l-blue-400 bg-blue-950/10',
}
const SYNC_CONDITION_STYLES: Record<string, string> = {
  missing:         'border-l-4 border-l-orange-400 bg-orange-50/10',
  needs_recovery:  'border-l-4 border-l-yellow-400 bg-yellow-950/10',
}

// Badges: admin badge shown first; sync badge suppressed when admin_condition='out_of_order'
const ADMIN_CONDITION_BADGE_STYLES: Record<string, string> = {
  out_of_order:       'bg-red-500/20 text-red-400 border-red-500/30',
  temporarily_leased: 'bg-violet-400/20 text-violet-400 border-violet-400/30',
  dedicated:          'bg-blue-400/20 text-blue-400 border-blue-400/30',
}
const SYNC_CONDITION_BADGE_STYLES: Record<string, string> = {
  missing:         'bg-orange-400/20 text-orange-400 border-orange-400/30',
  needs_recovery:  'bg-yellow-400/20 text-yellow-400 border-yellow-400/30',
}
```

`ADMIN_CONDITION_LABELS` and `SYNC_CONDITION_LABELS` (in `SearchBar.tsx`) map the same keys to display strings.

### Sort pattern (DeviceTable.tsx)
```typescript
const [sortKey, setSortKey] = useState<SortKey>(null)  // SortKey = union of column names | null
const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

function handleSort(key: SortKey) {
  if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
  else { setSortKey(key); setSortDir('asc') }
}

const sorted = sortKey ? [...devices].sort((a, b) => {
  let av = '', bv = ''
  switch (sortKey) { /* case per column */ }
  if (!av && bv) return 1    // empty always last
  if (av && !bv) return -1
  return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
}) : devices
```

### Admin-only page guard
```typescript
const { isAdmin } = useUser()
if (!isAdmin) return <Navigate to="/devices" replace />
```

---

## Feature checklists

### New admin condition (user-controlled)
- [ ] `apps/devices/models.py` — add `('snake_case', 'Display Name')` to `ADMIN_CONDITION_CHOICES`
- [ ] `apps/devices/models.py` — update `is_available` if the new condition blocks reservation
- [ ] `apps/devices/views.py` — add branch in `_handle_admin_condition_change()` for side-effects
- [ ] `apps/reservations/views.py` — update approve gate if the new condition should block reserve
- [ ] `frontend/src/components/DeviceTable.tsx` — add to `ADMIN_CONDITION_STYLES`, `ADMIN_CONDITION_BADGE_STYLES`
- [ ] `frontend/src/components/DeviceTable.tsx` — update `isUnavailable` if it blocks reserve UI
- [ ] `frontend/src/components/SearchBar.tsx` — add to `ADMIN_CONDITION_LABELS`
- [ ] `frontend/src/components/DeviceFormModal.tsx` — add to `ADMIN_CONDITION_LABELS`, `ADMIN_CONDITION_COLORS`
- [ ] `apps/admin_tools/views.py` — add to `_VALID_ADMIN_CONDITIONS`
- [ ] Run `makemigrations` + `migrate`

### New sync condition (sync-engine-controlled)
- [ ] `apps/devices/models.py` — add `('snake_case', 'Display Name')` to `SYNC_CONDITION_CHOICES`
- [ ] `apps/enterprises/sync.py` — add logic to set the new value in `sync_all_enterprises()` or `_apply_inventory_candidate()`
- [ ] `frontend/src/components/DeviceTable.tsx` — add to `SYNC_CONDITION_STYLES`, `SYNC_CONDITION_BADGE_STYLES`
- [ ] `frontend/src/components/SearchBar.tsx` — add to `SYNC_CONDITION_LABELS`
- [ ] `frontend/src/components/DeviceFormModal.tsx` — add to `SYNC_CONDITION_LABELS` (read-only hint)
- [ ] Run `makemigrations` + `migrate`
- [ ] **Never** add new sync conditions to `DeviceSerializer` writable fields or CSV import

### Device Purpose
- Model: `apps/reservations/models.py` → `DevicePurpose` (device FK, author_email, text, created_at)
- Serializer: `apps/reservations/serializers.py` → `DevicePurposeSerializer`
- View: `apps/devices/views.py` → `DevicePurposeView` at `GET/POST /api/v1/devices/{id}/purpose/`
- Denormalized cache on Device: `last_purpose_text`, `last_purpose_by`, `last_purpose_at` — updated on every write and cleared on ownership transfer
- **Clear rule:** POST with empty `text` clears the purpose; only the device owner or an admin may clear — others receive 403

### Frontend config endpoint
- `GET /api/v1/config/` (public) — returns `{device_list_refresh_ms, notification_refresh_ms}`
- Frontend fetches at startup in `DevicesPage.tsx` and `NotificationPanel.tsx` with `staleTime: Infinity`
- Override defaults (`300000` / `30000`) via `DEVICE_LIST_REFRESH_MS` / `NOTIFICATION_REFRESH_MS` in `.env`

### Enterprise sync
- Sync engine: `apps/enterprises/sync.py` — `sync_all_enterprises()` iterates active enterprises, calls ZedCloud bulk device fetch, resolves cross-enterprise conflicts, upserts `UntrackedDevice` rows, marks inventory devices missing/found
- `verify_enterprise_names()`: called from a background thread after import (not scheduled); processes enterprises with `is_active=True, name_verified=False`; logic order matters:
  1. State check first: if ZedCloud state != `ENTERPRISE_STATE_ACTIVE` → deactivate enterprise + create `enterprise_inactive` notification
  2. `elif` name check: if names differ → create `name_mismatch` notification
  3. Sets `name_verified=True` **only** in the active-and-matched `else` branch; NOT set on inactive (step 1) or name-mismatch (step 2) branches
  4. Skips the enterprise silently on decrypt error or network error
- APScheduler (in `apps/enterprises/apps.py`): only two registered jobs — `sync_all_enterprises` every 1 hour, `send_nightly_digest` at midnight UTC; `verify_enterprise_names` is **not** in the scheduler
- APScheduler guard: only starts under `runserver` child process (`RUN_MAIN=true`) or when `START_SCHEDULER=true` is set; prevents double-start on Django's reloader and prevents spurious scheduler starts in management commands (`migrate`, `collectstatic`, etc.). In Docker, `backend/entrypoint.sh` sets `START_SCHEDULER=true` via `export` immediately before the `exec gunicorn` line — **not** in `.env` — so management commands that run earlier in the script do not inherit it

**`sync_enterprise()` return type — `tuple[set[str], list[dict]]`:**
- Returns `(seen_serials, candidates)` — device writes are deferred to allow cross-enterprise conflict resolution in the caller
- `seen_serials`: set of serial numbers successfully processed (excluding skipped states)
- `candidates`: list of dicts, one per device, containing all fields needed to write inventory/UntrackedDevice

**Skipped states — `_SKIPPED_STATES`** (module-level set in `sync.py`):
- `{'RUN_STATE_UNPROVISIONED', 'RUN_STATE_PROVISIONED'}` — skipped at intake; not added to `seen_serials`, not added to candidates, not upserted into `UntrackedDevice`

**`_RUN_STATE_TIER` — cross-enterprise priority map** (module-level dict in `sync.py`):

| Tier | States |
|------|--------|
| 1 | `RUN_STATE_ONLINE`, `RUN_STATE_PREPARING_POWEROFF`, `RUN_STATE_PREPARED_POWEROFF` |
| 2 | `RUN_STATE_REBOOTING`, `RUN_STATE_BOOTING`, `RUN_STATE_BASEOS_UPDATING`, `RUN_STATE_MAINTENANCE_MODE` |
| 3 | `RUN_STATE_POWERING_OFF` |
| 4 | `RUN_STATE_OFFLINE` |
| 5 | `RUN_STATE_SUSPECT` |

States not in the map default to tier 99 (lowest priority). Tie-break: earlier `first_seen_at` on `UntrackedDevice` wins.

**New helper functions in `sync.py`:**
- `_apply_inventory_candidate(candidate, now)` — writes a single resolved candidate dict to a `Device` or `UntrackedDevice` row; handles SUSPECT special case (sets `sync_condition='needs_recovery'`, clears enterprise/cluster/cluster_device_name, sets status='Suspect'; for `out_of_order` devices, clears any stale `sync_condition` to `None` instead)
- `apply_candidates(candidates, now)` — applies a list of candidates directly without cross-enterprise conflict resolution; used by `EnterpriseSyncView.post()` and `EnterpriseDetailView.patch()` (single-enterprise paths)

**Token rotation improvements (`EnterpriseDetailView.patch()` in `views.py`):**
- Verifies `zcloud_id` match (not name) against ZedCloud after token update — rejects tokens belonging to a different enterprise
- Re-activates `is_active=True` if ZedCloud returns ACTIVE state during rotation
- Runs a background `sync_enterprise()` + `apply_candidates()` after rotation to clear `last_sync_status='token_expired'`; also deletes the `token_expired` Notification on success
- Enterprises with `last_sync_status='token_expired'` are skipped in `sync_all_enterprises()` loop; their IDs are added to `exclude_from_missing` to prevent false missing-marks

**Enterprise creation — two paths:**
- **UI path** (`apps/clusters/views.py` → `ClusterEnterpriseListCreateView.post()`): user provides bearer token only; backend calls `fetch_enterprise_self()` to get name + `zcloud_id`; blocks creation if state != `ENTERPRISE_STATE_ACTIVE`; creates enterprise with `name_verified=True`
- **Import path** (`apps/enterprises/views.py`): name comes from JSON payload; `name_verified=False` on create or overwrite; a background daemon thread calls `verify_enterprise_names()` after the import completes

**`name_verified` field reset conditions:**
- Reset to `False`: on bearer token PATCH (token update) and on import overwrite of an existing enterprise
- Set to `True`: on UI creation (name already verified via `fetch_enterprise_self()`) and after `verify_enterprise_names()` confirms state is active AND name matches ZedCloud; NOT set on inactive or name-mismatch branches

**Notification dedup pattern** — use `_emit_token_expired(enterprise)` from `sync.py` for `token_expired`; it handles `get_or_create` + conditional email in one call. For other kinds (`sync_error`, `name_mismatch`, `enterprise_inactive`) use `get_or_create` directly:
```python
# Always use get_or_create — unique_together = [('kind', 'enterprise')] prevents duplicates
Notification.objects.get_or_create(
    kind='name_mismatch',
    enterprise=enterprise,
    defaults={'title': '...', 'body': '...'},
)
```
Token-expired notifications are **deleted on successful sync** — `Notification.objects.filter(kind='token_expired', enterprise=enterprise).delete()` in every success path.

**`UntrackedDevice` upsert pattern** (`apps/devices/models.py`):
```python
# Use update_or_create with create_defaults (Django 4.1+) so first_seen_at is only set on creation
UntrackedDevice.objects.update_or_create(
    serial_number=serial,
    enterprise=enterprise,
    defaults={
        'last_seen_at': now,
        'zcloud_id': ...,
        'name': ...,
        # ...other always-updated fields...
    },
    create_defaults={
        'first_seen_at': now,   # set only on INSERT, not on UPDATE
    },
)
```
- `unique_together = ('serial_number', 'enterprise')` is the lookup key
- Notification kinds: `token_expired` | `sync_error` | `name_mismatch` | `enterprise_inactive`; `unique_together = [('kind', 'enterprise')]` so repeated failures do not create duplicate rows

### New background job or scheduled task
- [ ] Call `set_request_id(f'<prefix>-{uuid.uuid4().hex[:8]}')` as the very first line
- [ ] Add `logger.info('Starting <job_name>')` at the top and `logger.info('<job_name> complete')` at the bottom
- [ ] If scheduled via APScheduler: register in `apps/enterprises/apps.py` → `_start_scheduler()` — **do not add a new scheduler instance**
- [ ] If run in a background daemon thread (e.g. post-import): document the thread purpose in CLAUDE.md under "Never do"

### New Lab or Team
No code changes. Django admin → Labs (or Teams) → Add.

### New API endpoint
1. Add view/method in `apps/{app}/views.py`
2. Register URL in `apps/{app}/urls.py`
3. If new prefix: add to `config/urls.py`
4. Add corresponding function in `frontend/src/api/{module}.ts` using `client.ts`

### New device table column
1. `apps/devices/serializers.py` — add field to `DeviceSerializer`
2. `frontend/src/api/devices.ts` — add to `Device` interface
3. `frontend/src/components/DeviceTable.tsx`:
   - Add `<th>` with `onClick={() => handleSort('key')}` and `<SortIcon col="key" />`
   - Add to `SortKey` type
   - Add `case 'key':` in the sort switch
   - Add `<td>` in the row body
4. If shown in expand panel: add `<CopyableField>` in the relevant card

### New filter (device list)
1. `DevicesPage.tsx` — add `useState` for the filter value
2. `SearchBar.tsx` — add `<Select>` for the filter; pass value + setter as props
3. `frontend/src/api/devices.ts` — add param to `getDevices()` query string
4. `apps/devices/views.py` → `DeviceViewSet.get_queryset()` — add filter clause

### New email notification
1. Add function to `utils/email.py` following existing pattern
2. Call from view with `fail_silently=False` + catch + `logger.warning()`
3. No-op if `settings.EMAIL_HOST` is blank — no special handling needed
4. All email links use `settings.PORTAL_BASE_URL` (via `utils/email.py`) — set `PORTAL_BASE_URL=http://<hostname>` in `.env` for production deployments; defaults to `http://localhost:80`

### New write endpoint (validation checklist)
- [ ] Declare `permission_classes` explicitly on every view — omitting them makes the endpoint public
- [ ] Use `SlugRelatedField` for FK fields (lab, team); `NullableSlugRelatedField` for nullable FK
- [ ] Add `validate_<field>` methods for string fields that must be non-blank or format-constrained
- [ ] Add the FK fields to `select_related` on all querysets that touch those models
- [ ] Update filter clauses from `field=value` to `field__name=value` after FK conversion
