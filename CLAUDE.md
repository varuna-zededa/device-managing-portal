# Device Managing Portal — Claude Code Context

Full spec: [DESIGN.md](DESIGN.md) | Implementation reference: [DEVELOPMENT.md](DEVELOPMENT.md)

**Before making any source code changes, read DEVELOPMENT.md.**
It contains exact file paths, code patterns, and checklists for every common implementation task.

---

## Stack

- **Backend:** Python / Django 5 + Django REST Framework; SQLite (dev) → PostgreSQL-compatible
- **Frontend:** React 19 + Vite + TypeScript + Tailwind v4 + shadcn/ui
- **HTTP client (backend→ZedCloud):** `httpx` (sync)
- **Data fetching (frontend):** TanStack Query (`useQuery` / `useMutation`)

---

## Critical conventions — read before touching any file

### Condition fields — two separate fields, not one

`admin_condition` — user-controlled, always set, never null:
- Values: `normal | out_of_order | temporarily_leased | dedicated`
- Stored as snake_case; displayed with `value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())`
- The only condition field editable via API or CSV import
- `out_of_order` → emails all admins; other values do not

`sync_condition` — sync-engine-controlled, nullable (null = no finding):
- Values: `missing | needs_recovery`
- **Never** writable via API or CSV import — always in `read_only_fields` on `DeviceSerializer`
- `missing`: device not seen in ZedCloud this sync cycle
- `needs_recovery`: device seen in ZedCloud but only in SUSPECT run-state across all enterprises
- Sync never writes `sync_condition` when `admin_condition='out_of_order'` (out_of_order supersedes sync)
- CSV importer: `_normalize_admin_condition()` normalizes `admin_condition` values only; `sync_condition` is never read from CSV

**Never** store title-case or spaced forms in the DB for either field.

### ZedCloud API field names (verified against live API)
- Interface name field: **`ifName`** — NOT `name` (a common mistake)
- Serial number: **`minfo.serialNumber`** first; fall back to `hardwareInfo.serialNum`
- EVE version: `swInfo[i].shortVersion` where `swInfo[i].activated == true`
- Run state: `runState` (e.g. `"RUN_STATE_ONLINE"`)
- Connectivity list: `netStatusList`; filter for `up=true` AND `uplink=true`

### Labs and Teams — DB-backed, never hardcoded
- `Lab` model in `apps/devices/models.py`; `Team` model in `apps/users/models.py`
- `GET /api/v1/choices/` queries these tables at runtime — do not hardcode lab or team lists anywhere
- Add new labs/teams via Django admin; no code change required
- Pre-seeded labs: Bangalore Lab, Bangalore Office Space, Berlin Lab, SanJose Lab, CoreSite Lab, Home Lab
- Pre-seeded teams: EVE, PLATFORM, ST

### Auth — header-based, no sessions
- Every API request includes `X-User-Email: {email}` (set by the axios client from localStorage)
- Backend reads the header with `get_user_email(request)` from `utils.permissions` — **never** read `HTTP_X_USER_EMAIL` directly in views
- Admin check: `is_admin(email)` from `utils.permissions` — NOT Django's built-in auth system
- Every view must declare `permission_classes` explicitly:
  - `IsPortalUser` — any registered email in the PortalUser table
  - `IsAdminPortalUser` — admin users only; replaces inline `_is_admin()` checks
  - `[]` (empty) — public endpoints (token-based reservation confirm/approve/reject)
- No session cookies; no Django auth middleware used for portal users

### Encryption
- Fernet key from `settings.ENCRYPTION_KEY` (env var)
- Use `utils/crypto.py` — `encrypt(str) -> bytes`, `decrypt(bytes) -> str`
- Encrypted fields: `Device.idrac_password_enc`, `Enterprise.bearer_token_enc`
- `Device.idrac_username` is plaintext
- Never return encrypted fields in API responses

### Availability rule
`is_available = owner_email IS NULL AND admin_condition == 'normal' AND sync_condition IS NULL`
- This property is on the `Device` model
- No `UNAVAILABLE_CONDITIONS` tuple — the two-field check is the single source of truth
- Reservation approve gate in `apps/reservations/views.py`: `if device.admin_condition != 'normal' or device.sync_condition is not None:`

### Email
- Wrapper: `utils/email.py`; no-op if `settings.EMAIL_HOST` is blank
- Always use `fail_silently=False` + catch and `logger.warning()` — never swallow silently
- `admin_condition='out_of_order'` → email all admins; all other conditions do not

### Logging
- Every module must declare `logger = logging.getLogger(__name__)` at the top — no bare `print()`, no inline `logging.warning()`
- Request ID is injected automatically by `RequestIDMiddleware` + `RequestIDFilter` — never pass it manually to log calls
- Every background/scheduled function must call `set_request_id(f'<prefix>-{uuid.uuid4().hex[:8]}')` as its first line — see `sync_all_enterprises()` for the pattern
- `utils/request_context.py` — `get_request_id()` / `set_request_id()`; `utils/log_filters.py` — `RequestIDFilter`
- Log level controlled by `LOG_LEVEL` env var (default `INFO`); set `DEBUG` for full tracing
- Log file: `backend/logs/portal.log` locally; `./logs/portal.log` in Docker (bind-mounted, daily rotation, 30-day retention)
- Never log bearer tokens, decrypted passwords, or any secret value

---

## Sort behavior
- Empty values **always sort last** regardless of `asc`/`desc` direction
- Sort key is the primary string value per column (owner → name/email, status → status string, cluster → cluster name)

## Summary bar
- Counts reflect the **currently filtered** device set — not global totals
- `total`, `available`, `online` always shown; problem-state counts hidden when zero

## Choices endpoint caching
- Frontend caches `GET /api/v1/choices/` with `staleTime: Infinity`
- Cache is cleared on full page reload — new labs/teams appear after refresh, not automatically

---

## Device Purpose
- Denormalized cache fields on Device: `last_purpose_text`, `last_purpose_by`, `last_purpose_at` — **not** `last_comment_*`
- API endpoint: `POST /api/v1/devices/{id}/purpose/` — **not** `/comments/`
- Model is `DevicePurpose` in `apps/reservations/models.py` — **not** `DeviceComment`
- Clearing (empty text POST) requires the device owner or an admin — enforced in `DevicePurposeView.post`

---

## Never do

- Do **not** hardcode lab names or team names as enums or string lists in frontend or backend
- Do **not** use `name` to get the interface name from ZedCloud `netStatusList` — use `ifName`
- Do **not** look only in `hardwareInfo.serialNum` for device serial — check `minfo.serialNumber` first
- Do **not** store condition values as title-case in the DB
- Do **not** return `idrac_password_enc` or `bearer_token_enc` (Enterprise) in any API response
- Do **not** use Django's built-in User model for portal users — use `apps.users.models.PortalUser`
- Do **not** catch email exceptions and pass silently — log them with `logger.warning()`
- Do **not** use `fetch` or bare `axios` in frontend — always use `src/api/client.ts`
- Do **not** read `request.META.get('HTTP_X_USER_EMAIL')` directly in views — use `get_user_email(request)` from `utils.permissions`
- Do **not** omit `permission_classes` on any view — `DEFAULT_PERMISSION_CLASSES = []`, so undecorated views are fully public
- Do **not** use `?format=` query param for export — use `?fmt=` to avoid DRF content-negotiation 404
- Do **not** reference `last_comment_text`, `DeviceComment`, or `/comments/` — the model, fields, and endpoint were renamed to `DevicePurpose`, `last_purpose_*`, and `/purpose/`
- Do **not** allow any portal user to clear device purpose — check `is_admin(email) or device.owner_email == email` first
- Do **not** reference `apps/vault` or `Vault.bearer_token_enc` — the Vault app was removed; enterprise bearer tokens are stored in `Enterprise.bearer_token_enc` in `apps/enterprises`
- Do **not** add a `/api/v1/vault/` route — it no longer exists; status fetch now uses an enterprise credential selected in the dialog
- Do **not** add `verify_enterprise_names` to APScheduler — it is called as a background daemon thread from the import view, not as a scheduled job; only `sync_all_enterprises` and `send_nightly_digest` are registered
- Do **not** ask the user for an enterprise name when creating via the UI — name is fetched from ZedCloud `/v1/enterprises/self`; the UI only accepts a bearer token
- Do **not** pass raw bearer tokens from the frontend for device status fetch — the endpoint `POST /api/v1/devices/{id}/status/` accepts `enterprise_id`; backend decrypts the token server-side
- Do **not** use boolean `is_online`/`is_suspect` flags for cross-enterprise conflict resolution — use `_run_state_tier()` (the `_RUN_STATE_TIER` dict lookup) so all run-state priorities are centralized and consistent
- Do **not** skip `RUN_STATE_SUSPECT` devices at intake — they are valid candidates and must enter the conflict resolver; only `RUN_STATE_UNPROVISIONED` and `RUN_STATE_PROVISIONED` are skipped at intake (via `_SKIPPED_STATES`)
- Do **not** mark `needs_recovery` inside the per-enterprise loop — the SUSPECT winner check happens in the apply phase after ALL enterprises have been processed and the winning candidate has been selected
- Do **not** make `cluster`, `cluster_device_name`, `eve_version`, `device_connectivity`, or `sync_condition` writable via `DeviceSerializer` — they are sync-owned; add them to `read_only_fields` instead
- Do **not** reassign `device.enterprise` or `device.cluster` in `DeviceStatusView` — status fetch is read-only for device ownership; device placement is managed exclusively by the sync engine
- Do **not** delete an enterprise that has linked inventory `Device` rows — check `Device.objects.filter(enterprise=enterprise).exists()` first and return 409
- Do **not** allow non-admin portal users to move untracked devices to inventory — `MoveToInventoryView` uses `IsAdminPortalUser`
- Do **not** overwrite an enterprise bearer token in `ClusterImportView` without calling `fetch_enterprise_self()` and comparing `zcloud_id` — tokens from a different enterprise must be rejected with an error entry
- Do **not** use bare `logger.warning(str(e))` — always include context (which entity, which operation, which user)
- Do **not** add a new module without declaring `logger = logging.getLogger(__name__)` if it will ever log anything
- Do **not** add a new background/scheduled function without calling `set_request_id(f'<prefix>-{uuid.uuid4().hex[:8]}')` as the first line
- Do **not** log bearer tokens, decrypted passwords (`idrac_password_enc`, `bearer_token_enc`), or any secret — even at DEBUG level
- Do **not** call `set_request_id()` inside a view — the request ID is set by `RequestIDMiddleware` before the view runs

### Enterprise sync
- `Enterprise` model: `apps/enterprises/models.py` — fields: `name`, `cluster` (FK), `bearer_token_enc`, `zcloud_id`, `is_active`, `name_verified`, `last_sync_at`, `last_sync_status`, `last_sync_error`; `unique_together = ('name', 'cluster')`
- Adding an enterprise: bearer token only — name is fetched from ZedCloud `/v1/enterprises/self` via `fetch_enterprise_self()` in `services/zedcloud.py`; creation blocked if ZedCloud returns state != `ENTERPRISE_STATE_ACTIVE` (constant in `services/zedcloud.py`)
- `name_verified` resets to `False` on token update or import overwrite; set to `True` on UI creation (name already verified) and after `verify_enterprise_names()` confirms state is active AND name matches ZedCloud; NOT set on inactive or name-mismatch branches (so the enterprise is re-checked after re-activation or the next import)
- Post-import verification: a background thread calls `verify_enterprise_names()` after any import that creates/updates enterprises — this is **not** a scheduled job
- APScheduler (in `apps/enterprises/apps.py`): runs `sync_all_enterprises` every 1 hour, `send_nightly_digest` at midnight UTC; there is **no** verify job in the scheduler — only these two jobs are registered
- `_emit_token_expired(enterprise)` in `sync.py` is the shared helper for creating the `token_expired` Notification and sending the alert email — call it from every token-failure path; never inline the `get_or_create` block
- Token-expired notification is **deleted on next successful sync** — `Notification.objects.filter(kind='token_expired', enterprise=enterprise).delete()` runs in the success branch of both `sync_all_enterprises()` and the post-token-rotation background thread
- `ClusterImportView` overwrite path verifies bearer token identity before saving — calls `fetch_enterprise_self()` and rejects the token if the returned `zcloud_id` differs from the stored one
- Missing-mark in `sync_all_enterprises()` covers **both** `enterprise__isnull=False` (tracked) AND `enterprise=None` devices whose `cluster` belongs to a successfully-synced enterprise — so manually-imported devices on a known cluster are marked missing if not seen in ZedCloud
- SUSPECT winner → sets `sync_condition='needs_recovery'`, clears enterprise/cluster/cluster_device_name, sets status='Suspect'; skip if `admin_condition='out_of_order'`
- Recovery (non-SUSPECT seen in ZedCloud) → clears `sync_condition` (sets to None)

### Notifications (admin)
- `Notification` model: `apps/notifications/models.py` — kinds: `token_expired`, `sync_error`, `name_mismatch`, `enterprise_inactive`; has `enterprise` FK; `unique_together = [('kind', 'enterprise')]`
- `name_mismatch` notifications have inline "Use ZedCloud name" / "Keep current name" action buttons in the UI
- `enterprise_inactive` notifications navigate to the Clusters page on click
- `token_expired` notifications are created by three paths (all via `_emit_token_expired()`): hourly `sync_all_enterprises()`, manual `EnterpriseSyncView.post()`, and the post-token-rotation background thread (on re-failure); cleared when any of those paths next succeeds for the same enterprise
