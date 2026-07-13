# Automatic Device Sync — Design Spec

**Date:** 2026-07-13  
**Status:** Approved for implementation planning

---

## Problem

Users currently must provide their own cluster credentials (bearer token, cluster name, device name) via the "Refresh Status" modal to update any device's cluster info. This is friction-heavy and frequently skipped, leaving devices in the inventory with stale or missing cluster data.

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
| `is_active` | BooleanField | Admin can pause sync per enterprise |
| `last_sync_at` | DateTimeField (null) | Timestamp of last completed sync attempt |
| `last_sync_status` | CharField | `ok` / `error` / `token_expired` |
| `last_sync_error` | TextField (null) | Error detail shown in admin tab |

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
| `first_seen_at` | DateTimeField | Set on first discovery |
| `last_seen_at` | DateTimeField | Updated every sync cycle |

### Device model changes (`apps/devices/models.py`)

- Add `enterprise` FK (nullable → Enterprise): set during sync when matched by serial number
- `cluster` FK and `cluster_device_name` retained; set from `enterprise.cluster` and `name` during sync

### Notification (`apps/notifications/models.py`)

| Field | Type | Notes |
|---|---|---|
| `id` | PK | |
| `kind` | CharField | `token_expired` / `sync_error` |
| `title` | CharField | e.g. "Token expired — Foundation on hummingbird" |
| `body` | TextField | Detail message |
| `created_at` | DateTimeField | |
| `is_read` | BooleanField | |
| `read_at` | DateTimeField (null) | |

Notifications are global (not per-user). Visible to admins only. Clicking a `token_expired` notification navigates to the "Clusters & Enterprises" tab — routing driven by `kind` on the frontend; no URL stored in the model.

### Removed

- `Vault` model and all associated endpoints removed entirely

---

## ZedCloud API

### Bulk device status endpoint

```
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

```
GET https://{cluster.host}/api/v1/devices/name/{cluster_device_name}/status/info
Authorization: Bearer {enterprise.bearer_token}
```

Used only when user triggers manual refresh without changing enterprise.

---

## Background Sync Service (`apps/enterprises/sync.py`)

### Hourly sync algorithm

```
sync_all_enterprises():
  seen_serials = set()

  for each Enterprise where is_active=True:
    try:
      paginate GET /v1/devices/status (page size 200):
        for each device in page.list:
          if minfo.serialNumber == "": skip

          seen_serials.add(minfo.serialNumber)
          inventory_device = Device.filter(serial_number=minfo.serialNumber).first()

          if inventory_device:
            update device: status, eve_version, cluster_device_name,
                           cluster (= enterprise.cluster), enterprise,
                           device_connectivity, status_fetched_at
            if inventory_device.condition == 'missing':
              reset condition to 'normal'  # device reappeared

          else:
            UntrackedDevice.update_or_create(
              defaults={name, model, run_state, eve_version,
                        device_connectivity, last_seen_at},
              serial_number=minfo.serialNumber, enterprise=enterprise
            )
            set first_seen_at only on create

      enterprise.last_sync_status = 'ok'
      enterprise.last_sync_error = None

    except HTTP 401 / 403:
      enterprise.last_sync_status = 'token_expired'
      send_immediate_token_expiry_email(enterprise)
      Notification.create(kind='token_expired', ...)

    except other error:
      enterprise.last_sync_status = 'error'
      enterprise.last_sync_error = str(exception)
      # no notification record — transient failures go to nightly email only

    finally:
      enterprise.last_sync_at = now()
      enterprise.save()

  # Mark MISSING — only devices that were previously tracked and not seen this cycle
  Device.filter(
    enterprise__isnull=False,
    condition='normal'
  ).exclude(
    serial_number__in=seen_serials
  ).update(condition='missing')
```

### Nightly digest email (midnight)

Sent to all admins. Contains three sections (each hidden if empty):

1. **Devices — Missing**: list of `Device` where `condition='missing'`
2. **Devices — Out of Order**: list of `Device` where `condition='out_of_order'`
3. **Enterprises with errors**: list of `Enterprise` where `last_sync_status IN ('error', 'token_expired')` — current snapshot, not history

### Token expiry — immediate email

Subject: `[Portal] Token expired — {enterprise.name} on {cluster.name}`  
Body: enterprise name, cluster host, time of failure, instruction to update token in Clusters & Enterprises tab.

### APScheduler registration (`apps/enterprises/apps.py → ready()`)

- Guarded with `os.environ.get('RUN_MAIN')` to prevent double-start in Django dev server
- Hourly sync: `IntervalTrigger(hours=1)`
- Midnight digest: `CronTrigger(hour=0, minute=0)`

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

**Filters supported on GET:** `enterprise`, `cluster`, `serial_number` (partial match).

**Move to inventory:** Creates a `Device` record pre-filled with `name`, `serial_number`, `model` (as text, not FK), `eve_version`, `device_connectivity`, `cluster`, `enterprise`, `run_state`. The Device `model` FK is left blank — user fills it afterwards. The `UntrackedDevice` record is deleted on success.

### Device status refresh (revised)

| Method | URL | Change |
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

### Removed

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
- Filter bar: enterprise dropdown, cluster dropdown, serial number text input
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
- Clicking a `token_expired` notification navigates to "Clusters & Enterprises" tab
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
