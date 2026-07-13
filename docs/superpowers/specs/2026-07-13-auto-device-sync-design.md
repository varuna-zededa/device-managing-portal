# Automatic Device Sync — Design Spec

**Date:** 2026-07-13  
**Status:** Approved for implementation planning

---

## Problem

Users previously had to provide their own cluster credentials (bearer token, cluster name, device name) via the "Refresh Status" modal to update any device's cluster info. This was friction-heavy and frequently skipped, leaving devices in the inventory with stale or missing cluster data.

---

## Goal

Replace per-user credential entry with admin-managed enterprise credentials. The backend polls all configured enterprises hourly, automatically updates matched inventory devices, surfaces untracked devices for promotion to inventory, and marks inventory devices not found anywhere as `missing`.

---

## Architecture Overview

| Component | Location | Purpose |
|---|---|---|
| `Enterprise` model | `apps/enterprises/` | Admin-managed credential per enterprise per cluster |
| `UntrackedDevice` model | `apps/devices/` | Devices found in API but not in inventory |
| `Notification` model | `apps/notifications/` | In-portal alerts for admins |
| Sync service | `apps/enterprises/sync.py` | Hourly poll + matching logic |
| APScheduler | `apps/enterprises/apps.py` | Runs sync and nightly digest |
| `apps/vault/` | **removed** | Replaced by Enterprise |

---

## Data Model

### Enterprise (`apps/enterprises/models.py`)

| Field | Type | Notes |
|---|---|---|
| `id` | PK | |
| `name` | CharField | e.g. "Foundation", "200x85", "Zededa SRE" |
| `cluster` | FK → Cluster | |
| `bearer_token_enc` | BinaryField | Fernet-encrypted via `utils/crypto.py` |
| `zcloud_id` | CharField | Enterprise UUID from ZedCloud (`/v1/enterprises/self`); updated on every successful verify call |
| `is_active` | BooleanField | Admin can pause sync per enterprise |
| `name_verified` | BooleanField | `True` when local name matches ZedCloud; set `True` on UI add; reset to `False` when token is updated via PATCH or import overwrite |
| `last_sync_at` | DateTimeField (null) | Timestamp of last completed sync attempt |
| `last_sync_status` | CharField | `ok` / `error` / `token_expired` |
| `last_sync_error` | TextField (null) | Error detail shown in admin tab |

`unique_together = ('name', 'cluster')`

### UntrackedDevice (`apps/devices/models.py`)

| Field | Type | Source field |
|---|---|---|
| `id` | PK | |
| `enterprise` | FK → Enterprise | |
| `zcloud_id` | CharField | `id` |
| `name` | CharField | `name` |
| `serial_number` | CharField | `minfo.serialNumber` |
| `model` | CharField | `"{minfo.manufacturer}-{minfo.productName}"` |
| `run_state` | CharField | `runState` |
| `eve_version` | CharField | `swInfo[activated=true].shortVersion` |
| `device_connectivity` | JSONField | `netStatusList` |
| `first_seen_at` | DateTimeField | Set only on creation (via `if created:` branch in `update_or_create`); never overwritten on subsequent syncs |
| `last_seen_at` | DateTimeField | Updated every sync cycle |

### Device model changes (`apps/devices/models.py`)

- Add `enterprise` FK (nullable → Enterprise): set during sync when matched by serial number
- `cluster` FK and `cluster_device_name` retained; set from `enterprise.cluster` and `name` during sync

### Notification (`apps/notifications/models.py`)

| Field | Type | Notes |
|---|---|---|
| `id` | PK | |
| `kind` | CharField | `token_expired` / `sync_error` / `name_mismatch` / `enterprise_inactive` |
| `enterprise` | FK → Enterprise (nullable, CASCADE) | The enterprise this notification relates to |
| `title` | CharField | e.g. "Token expired — Foundation on hummingbird" |
| `body` | TextField | Detail message; for `name_mismatch` this is a JSON string `{"local_name": "...", "zcloud_name": "..."}` |
| `created_at` | DateTimeField | |
| `is_read` | BooleanField | |
| `read_at` | DateTimeField (null) | |

`unique_together = [('kind', 'enterprise')]` — prevents duplicate alerts for the same enterprise.

Notifications are global (not per-user). Visible to admins only.

**Click / action behavior by kind:**
- `token_expired`, `sync_error`, `enterprise_inactive`: clicking navigates to the "Clusters & Enterprises" tab
- `name_mismatch`: **no** click navigation; instead renders two inline action buttons:
  - **"Use ZedCloud name"** — calls `PATCH /api/v1/enterprises/{id}/` to update the local name, then marks read
  - **"Keep current name"** — marks read only
  Routing is driven by `kind` on the frontend; no URL stored in the model.

### Removed

- `Vault` model and all associated endpoints removed entirely

---

## ZedCloud API

### Bulk device status endpoint

```text
GET https://{cluster.host}/v1/devices/status?next.pageSize=200&next.pageNum={n}
Authorization: Bearer {enterprise.bearer_token}
```

**Key response fields used:**

| Field | Maps to |
|---|---|
| `minfo.serialNumber` | Match key against `Device.serial_number` |
| `name` | `Device.cluster_device_name` / `UntrackedDevice.name` |
| `runState` | `Device.status` |
| `swInfo[activated=true].shortVersion` | `Device.eve_version` |
| `netStatusList` | `Device.device_connectivity` |
| `minfo.manufacturer` + `minfo.productName` | `UntrackedDevice.model` |
| `id` | `UntrackedDevice.zcloud_id` |

**Pagination:** `next.totalPages` drives the loop. Page size 200.

**Serial matching rule:** Devices with empty `minfo.serialNumber` are skipped — they cannot be matched to inventory and are not added to untracked devices.

### Single device endpoint (manual refresh, same enterprise)

```text
GET https://{cluster.host}/api/v1/devices/name/{cluster_device_name}/status/info
Authorization: Bearer {enterprise.bearer_token}
```

Used only when user triggers manual refresh without changing enterprise.

---

## Background Sync Service (`apps/enterprises/sync.py`)

### Hourly sync algorithm

`sync_enterprise(enterprise) -> tuple[set[str], list[dict]]` processes a single enterprise and returns `(seen_serials, candidates)`. Device writes are deferred to allow cross-enterprise conflict resolution in the caller.

`_SKIPPED_STATES = {'RUN_STATE_UNPROVISIONED', 'RUN_STATE_PROVISIONED'}` — devices in these states are skipped at intake: not added to `seen_serials`, not added to candidates, not upserted into `UntrackedDevice`.

```python
_RUN_STATE_TIER = {
    'RUN_STATE_ONLINE': 1,
    'RUN_STATE_PREPARING_POWEROFF': 1,
    'RUN_STATE_PREPARED_POWEROFF': 1,
    'RUN_STATE_REBOOTING': 2,
    'RUN_STATE_BOOTING': 2,
    'RUN_STATE_BASEOS_UPDATING': 2,
    'RUN_STATE_MAINTENANCE_MODE': 2,
    'RUN_STATE_POWERING_OFF': 3,
    'RUN_STATE_OFFLINE': 4,
    'RUN_STATE_SUSPECT': 5,
}
# States not in map → tier 99 (lowest priority)

sync_all_enterprises():
  all_seen_serials = set()
  all_candidates = {}   # serial -> winning candidate dict
  exclude_from_missing = set()

  for each Enterprise where is_active=True:
    if enterprise.last_sync_status == 'token_expired':
      exclude_from_missing.add(enterprise.id)
      continue  # skip — token is known-expired; do not falsely mark devices missing

    try:
      (seen, candidates) = sync_enterprise(enterprise)
      all_seen_serials |= seen

      # Conflict resolution: for each candidate, keep the one with the lower tier
      for candidate in candidates:
        serial = candidate['serial_number']
        run_state = candidate['run_state']
        tier = _RUN_STATE_TIER.get(run_state, 99)
        if serial not in all_candidates:
          all_candidates[serial] = candidate
        else:
          existing_tier = _RUN_STATE_TIER.get(all_candidates[serial]['run_state'], 99)
          if tier < existing_tier:
            all_candidates[serial] = candidate
          # tie-break: first_seen_at (earlier wins) — handled inside sync_enterprise

      enterprise.last_sync_status = 'ok'
      enterprise.last_sync_error = None

    except HTTP 401 / 403:
      enterprise.last_sync_status = 'token_expired'
      exclude_from_missing.add(enterprise.id)
      send_immediate_token_expiry_email(enterprise)
      Notification.objects.get_or_create(kind='token_expired', enterprise=enterprise, ...)

    except other error:
      enterprise.last_sync_status = 'error'
      enterprise.last_sync_error = str(exception)
      exclude_from_missing.add(enterprise.id)
      # no notification record — transient failures go to nightly email only

    finally:
      enterprise.last_sync_at = now()
      enterprise.save()

  # Apply phase: write winning candidates to inventory / UntrackedDevice.
  # SUSPECT winner: only mark condition='needs_repair' on condition='normal' devices;
  # do NOT update eve_version, enterprise, cluster, connectivity, or other fields.
  apply_candidates(all_candidates.values(), now)

  # Mark MISSING — only devices that were previously tracked and not seen this cycle.
  # Guard: enterprises that errored, had token_expired, or returned zero devices do NOT
  # contribute to seen_serials — their devices are excluded from this update.
  Device.filter(
    enterprise__isnull=False,
    condition='normal'
  ).exclude(
    serial_number__in=all_seen_serials
  ).exclude(
    enterprise_id__in=exclude_from_missing
  ).update(condition='missing')
```

**Token rotation** (`EnterpriseDetailView.patch()`):
- After updating bearer token: calls `fetch_enterprise_self()` and verifies `zcloud_id` match — rejects tokens belonging to a different enterprise
- Re-activates `is_active=True` if ZedCloud returns ACTIVE state
- Runs background `sync_enterprise()` + `apply_candidates()` to clear `last_sync_status='token_expired'` immediately after rotation

### Nightly digest email (midnight)

Sent to all admins. Contains three sections (each hidden if empty):

1. **Devices — Missing**: list of `Device` where `condition='missing'`
2. **Devices — Out of Order**: list of `Device` where `condition='out_of_order'`
3. **Enterprises with errors**: list of `Enterprise` where `last_sync_status IN ('error', 'token_expired')` — current snapshot, not history

### Post-import name verification (`verify_enterprise_names`)

**Not a scheduled job.** Triggered as a background daemon thread immediately after any import (`POST /api/v1/clusters/import/`) that creates or updates enterprises.

```python
verify_enterprise_names():
  for each Enterprise where is_active=True and name_verified=False:
    try:
      bearer_token = decrypt(enterprise.bearer_token_enc)
    except:
      continue  # leave name_verified=False; retry on next import

    try:
      info = fetch_enterprise_self(cluster.host, bearer_token)
    except (decrypt error, network error):
      continue  # leave name_verified=False; retry on next import

    # Always update zcloud_id if we learned it
    if info['zcloud_id'] != enterprise.zcloud_id:
      enterprise.zcloud_id = info['zcloud_id']

    if info['state'] != ENTERPRISE_STATE_ACTIVE:
      enterprise.is_active = False
      Notification.objects.get_or_create(kind='enterprise_inactive', enterprise=enterprise, ...)
      # name mismatch check skipped — enterprise deactivated

    elif info['name'] != enterprise.name:
      Notification.objects.get_or_create(kind='name_mismatch', enterprise=enterprise,
                                         body=json.dumps({local_name, zcloud_name}), ...)

    enterprise.name_verified = True
    enterprise.save()
```

This function runs in the same process as the Django app (background thread). It does **not** appear in the APScheduler job list.

### Token expiry — immediate email

Subject: `[Portal] Token expired — {enterprise.name} on {cluster.name}`  
Body: enterprise name, cluster host, time of failure, instruction to update token in Clusters & Enterprises tab.

### APScheduler registration (`apps/enterprises/apps.py → ready()`)

- Guarded with `os.environ.get('RUN_MAIN')` to prevent double-start in Django dev server
- **Exactly two scheduled jobs:**
  1. Hourly sync: `sync_all_enterprises` via `IntervalTrigger(hours=1)`
  2. Midnight digest: `send_nightly_digest` via `CronTrigger(hour=0, minute=0)`
- `verify_enterprise_names` is **not** a scheduled job — it runs as a post-import background daemon thread only

---

## API Endpoints

### Clusters & Enterprises

| Method | URL | Auth | Purpose |
|---|---|---|---|
| GET | `/api/v1/clusters/` | `IsPortalUser` | List clusters with nested enterprises; includes sync status |
| POST | `/api/v1/clusters/` | `IsAdminPortalUser` | Create cluster |
| PATCH | `/api/v1/clusters/{id}/` | `IsAdminPortalUser` | Update cluster name / host |
| DELETE | `/api/v1/clusters/{id}/` | `IsAdminPortalUser` | Delete cluster (blocked if enterprises exist) |
| POST | `/api/v1/clusters/{id}/enterprises/` | `IsAdminPortalUser` | Add enterprise to cluster |
| PATCH | `/api/v1/enterprises/{id}/` | `IsAdminPortalUser` | Update enterprise name / token |
| DELETE | `/api/v1/enterprises/{id}/` | `IsAdminPortalUser` | Remove enterprise |
| POST | `/api/v1/enterprises/{id}/sync/` | `IsAdminPortalUser` | Trigger immediate sync for one enterprise |
| GET | `/api/v1/clusters/export/` | `IsAdminPortalUser` | Download full cluster + enterprise config as JSON |
| POST | `/api/v1/clusters/import/` | `IsAdminPortalUser` | Import cluster + enterprise config from JSON |

**Enterprise add flow** (`POST /api/v1/clusters/{id}/enterprises/`):
- Request body: `{ "bearer_token": "eyJ..." }` — **no `name` field**
- Backend immediately calls `GET /v1/enterprises/self` on the target cluster using the provided token to fetch the enterprise name and `zcloud_id`
- Creation is **blocked** if `enterprise.state != ENTERPRISE_STATE_ACTIVE` — returns 400 with a descriptive error
- On success: enterprise created with `name` and `zcloud_id` from ZedCloud, `name_verified = True`
- `name_verified` resets to `False` when bearer token is updated via PATCH or overwritten by import — triggering re-verification on the next import

Bearer token is never returned in any response.

**Export format** — bearer tokens excluded (write-only, never exported):
```json
[
  {
    "cluster_name": "hummingbird",
    "cluster_host": "zedcontrol.hummingbird.zededa.net",
    "enterprises": [
      { "name": "Foundation" },
      { "name": "200x85" }
    ]
  }
]
```

**Import format** — bearer tokens required per enterprise:
```json
[
  {
    "cluster_name": "hummingbird",
    "cluster_host": "zedcontrol.hummingbird.zededa.net",
    "enterprises": [
      { "name": "Foundation", "bearer_token": "eyJhbGci..." },
      { "name": "200x85",    "bearer_token": "eyJhbGci..." }
    ]
  }
]
```

**Import behaviour:**
- Cluster matched by `cluster_host`; created if no match exists.
- Enterprise matched by `name` within the cluster.
- Conflict resolution for existing enterprises: determined by `on_conflict` in the request body — `"overwrite"` (update token) or `"skip"` (leave existing untouched). User selects this in the import modal before confirming.
- Validation: `bearer_token` must be non-empty for every enterprise entry; malformed JSON returns 400.

### Untracked Devices (`IsPortalUser`)

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/v1/untracked-devices/` | List untracked devices (paginated) |
| POST | `/api/v1/untracked-devices/{id}/move-to-inventory/` | Move to inventory |

**Filters supported on GET:** none — the API returns all untracked devices; filtering is client-side in the frontend.

**Move to inventory:** Creates a `Device` record pre-filled with `name`, `serial_number`, `model` (as text, not FK), `eve_version`, `device_connectivity`, `cluster`, `enterprise`, `run_state`. The Device `model` FK is left blank — user fills it afterwards. The `UntrackedDevice` record is deleted on success.

**UntrackedDevice cleanup — three paths:**
1. **Sync cycle** (`sync_all_enterprises`): serials found in the inventory (matched to a `Device`) are deleted from `UntrackedDevice` after the full cycle completes
2. **Manual add** (`DeviceListCreateView.post`): after successfully creating a `Device` via the add form, any `UntrackedDevice` with the same serial number is deleted
3. **CSV/JSON import** (`ImportView`): after processing all rows, any `UntrackedDevice` whose serial matches a created or updated device is deleted

### Device status refresh (revised)

| Method | URL | Notes |
|---|---|---|
| POST | `/api/v1/devices/{id}/status/` | Accepts `enterprise_id` instead of `bearer_token` + `cluster_id`. Token fetched server-side from Enterprise record. |

**Same enterprise:** Calls single-device `/status/info` endpoint.  
**Different enterprise:** Paginates new enterprise's `/v1/devices/status`, matches by serial number. On no match, returns error — device record unchanged.

### Notifications (`IsAdminPortalUser`)

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/v1/notifications/` | List notifications, newest first |
| POST | `/api/v1/notifications/{id}/read/` | Mark one read |
| POST | `/api/v1/notifications/read-all/` | Mark all read |

### Choices endpoint (extended)

`GET /api/v1/choices/` now returns `enterprises` list (id, name, cluster name) for the refresh modal dropdown.

### Endpoints removed

- All `Vault` endpoints removed

---

## Frontend

### New: "Clusters & Enterprises" tab

- Visible to **all portal users** (nav tab shown regardless of role)
- **Read-only for members:** cluster name, host, enterprise names, sync status badges, last sync time visible to everyone
- **Admin-only controls** (hidden for members): Add Cluster, Edit cluster, Delete cluster, Add Enterprise, Edit enterprise, Delete enterprise, Sync Now button, Export button, Import button
- Lists clusters; each cluster expandable to show its enterprises
- Per cluster: name, host URL, and (admin only) inline edit/delete buttons
- Per enterprise row: name, last sync time, sync status badge (`ok` / `error` / `token_expired`), error detail on hover, and (admin only) inline edit, delete, and "Sync Now" button
- **Export button** (admin only) — downloads current config as `cluster-config.json` (tokens excluded); available at top of tab
- **Import button** (admin only) — opens import modal containing:
  - A readonly code block showing the expected JSON format (sample with one cluster + two enterprises) for user reference
  - File picker to select a JSON file
  - Conflict resolution toggle: "If enterprise already exists — Overwrite token / Skip"
  - "Import" confirm button; errors shown inline per entry (e.g. "Missing bearer_token for Foundation")

### New: "Untracked Devices" page

- Separate route, linked from sidebar (visible to all portal users)
- Filter bar: **cluster dropdown first**, then enterprise dropdown (enterprise options narrow based on selected cluster); serial number text input; all filtering is **client-side** on a single API fetch (no filter params sent to backend)
- Table columns: Name | Serial No | Model | Enterprise | Cluster | Run State | EVE Version | First Seen | Last Seen | Action
- "Move to Inventory" button per row → confirmation modal (see below)

**Move to Inventory confirmation modal:**  
Shows a read-only table of all device fields before confirming:

| Field | Value |
|---|---|
| Name | {name} |
| Serial Number | {serial_number} |
| Model | {model} |
| Enterprise | {enterprise.name} |
| Cluster | {cluster.name} |
| Run State | {run_state} |
| EVE Version | {eve_version} |
| Interfaces | {device_connectivity summary} |

User must click "Confirm Move to Inventory" to proceed. On success the row is removed from the table.

### Revised: "Refresh Status" modal

**Removed:** cluster selector, name-in-cluster text field, bearer token field, vault status check.

**Added:** enterprise dropdown — all enterprises listed as `"{enterprise.name} — {cluster.name}"`. Current enterprise pre-selected if device has one assigned.

### Revised: Device table

- `missing` condition displayed and filterable alongside existing conditions
- `status_fetched_at` remains visible for staleness visibility

### New: Notification bell (admin only)

- Bell icon in nav bar showing unread notification count
- Dropdown lists recent notifications with title and timestamp
- **`token_expired`**, **`sync_error`**, **`enterprise_inactive`**: clicking navigates to "Clusters & Enterprises" tab and marks notification read
- **`name_mismatch`**: no click navigation; shows two inline action buttons:
  - **"Use ZedCloud name"** — PATCHes the enterprise name to match ZedCloud, then marks read
  - **"Keep current name"** — marks read only
- "Mark all read" action in dropdown

---

## What Is Removed

| Item | Replacement |
|---|---|
| `Vault` model | `Enterprise.bearer_token_enc` |
| Per-user bearer token entry in Refresh modal | Enterprise dropdown (admin-managed token) |
| `cluster_id` + `bearer_token` params on status endpoint | `enterprise_id` param |
| `GET/DELETE /api/v1/vault/` | — |
| `FetchStatusDialog` vault status check | — |

---

## Constraints and Edge Cases

- **Empty serial number:** Devices with `minfo.serialNumber == ""` are skipped entirely — not matched, not added to untracked devices.
- **MISSING scope:** Only devices with `enterprise IS NOT NULL` and `condition='normal'` are candidates for MISSING. Manually-set conditions (`out_of_order`, `dedicated`, `temporarily_leased`, `needs_repair`) are not overwritten.
- **Vault removal migration:** Existing `Vault` records are dropped. Existing devices retain their `cluster` and `cluster_device_name` values but `enterprise` FK starts null until the next sync cycle matches them.
- **APScheduler double-start guard:** Required for Django dev server; production (gunicorn) is unaffected.
- **Token never returned in API:** `bearer_token_enc` is write-only — never serialized in any response.
- **UNAVAILABLE_CONDITIONS:** `missing` is already in the enum; both `devices/views.py` and `reservations/views.py` must stay in sync (existing constraint).
- **Enterprise deletion cascade:** `UntrackedDevice.enterprise` uses `on_delete=CASCADE` — deleting an enterprise removes all its untracked device records. Inventory `Device.enterprise` uses `on_delete=SET_NULL` — deleting an enterprise nulls the FK on matched devices without removing them.
- **Missing → Normal recovery:** When a device previously marked `missing` is found in a sync cycle, `condition` is reset to `normal` alongside the other field updates.
