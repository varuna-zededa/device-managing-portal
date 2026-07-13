# Device Managing Portal — Design Document

## Planned Changes

| Feature | Spec |
|---|---|
| Automatic device sync — admin-managed enterprise credentials, hourly background poll, untracked devices, MISSING status | [docs/superpowers/specs/2026-07-13-auto-device-sync-design.md](docs/superpowers/specs/2026-07-13-auto-device-sync-design.md) |

---

## Purpose
A shared-device management web app for Zededa test teams. Engineers share physical EVE OS nodes and
need visibility into ownership, live device status (EVE version, SSH IPs, run state), and quick
IDRAC console access. No login required today; designed so SSO can be plugged in later with minimal
code change.

### Pain Points This Solves

| Pain point | Today | With this tool |
|---|---|---|
| Who has this device? | Ask on Slack; wait for a reply | Ownership visible on the device list instantly |
| Is it available? | Try SSHing; ask around | "Available" badge + one-click Reserve |
| Taking a device without asking | No process; causes silent conflicts | Reserve → owner gets notified; must approve |
| What EVE version is running? | SSH in or open ZedCloud manually | Fetch Status pulls it into the table in one click |
| Where are the SSH IPs? | SSH into another node to check; open ZedCloud | Fetch Status populates SSH IPs directly in the portal |
| IDRAC access | Credentials in a shared doc or someone's head | Stored (encrypted) per device; IDRAC Console link in the table |
| Device is broken / in repair | Engineers waste time trying to use it | Condition flag (Out of Order / Needs Repair) blocks reservation |
| Managers unaware of hardware issues | No alert when a device breaks; issues go unnoticed | Email sent to all admins the moment any device is marked Out of Order |
| Who had this device last month? | No record | Ownership history log; append-only |
| Device capabilities unknown | Ask the owner; dig through specs | Description field + future structured capability data |

---

## How It Works

The portal is a single-page web app backed by a Django REST API. Engineers pick their identity from a
dropdown on login (no password today). The main screen is a device table — one row per physical node
— showing ownership, live EVE status, and a quick-action column. Clicking a row's chevron expands an
inline panel with hardware info, connectivity details, and a free-text description.

To claim a device an engineer clicks Reserve. If the device is free it transfers immediately; if
someone else owns it, an approval request is emailed to the current owner, who approves or rejects
via a link (no login needed). Admins can force-assign and set device condition flags. Live status
(EVE version, SSH IPs, run state) is fetched on demand from the ZedCloud API using the engineer's
personal bearer token, which is stored encrypted so they don't have to re-enter it each session.

```text
┌─────────────┐
│   /login    │  pick identity → stored in localStorage
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────────────────┐
│                  Device Table                     │
│  Name · Serial · Cluster · Owner · Status · ...  │  ← auto-refreshes every 15 min
└──────┬───────────────────────────┬───────────────┘
       │ click chevron             │ click action button
       ▼                           ▼
┌──────────────────┐   ┌───────────────────────────────────┐
│   Expand Panel   │   │  Reserve      →  reservation flow  │
│  ──────────────  │   │  Fetch Status →  ZedCloud API      │
│  Identity        │   │                 → EVE ver · conn.  │
│  Placement       │   │  Edit / Delete / Force-Assign      │
│  ZedCloud Status │   └───────────────────────────────────┘
│  Connectivity    │
│  IDRAC           │
│  Notes           │
└──────────────────┘
```

**Reservation flow:**

```text
Reserve clicked
      │
      ├─ device free ───────────────────▶  transfer immediately; done
      │
      └─ device owned
               │
               ├─ request already pending ──▶  show blocked notice; no action
               │
               └─ no pending request
                         │
                         ▼
                   create ReservationRequest (expires in 3h)
                   email owner with /confirm/{token} link
                         │
                         ▼  owner opens link
                    ┌─────────┐
                    │ Approve │──▶  transfer to requester; notify both
                    │ Reject  │──▶  close request; notify requester
                    └─────────┘

   Special cases:
   · owner releases while request is pending  →  auto-approve to requester
   · admin force-assign                       →  bypass flow; owner notified
```

---

## Future Ideas

Features not in scope for v1 but worth considering later, roughly ordered by usefulness:

- **SSO / LDAP login** — replace the user-picker dropdown with real authentication; the codebase is
  structured to support this with minimal changes
- **Device capabilities** — structured hardware spec data (CPU, RAM, GPU, NIC count, port speeds)
  added either via manual entry or auto-fetched from ZedCloud/IPMI; prerequisite for meaningful NLP
  search
- **Infra equipment management** — a new section (alongside Devices) to track lab infrastructure:
  switches, routers, console servers, PDUs; same ownership/location/condition model, no ZedCloud
  integration needed
- **NLP search** — natural-language queries like "get me a device with a GPU", "devices with 4 eth
  ports", "nodes with 10G uplink"; only useful once device capabilities are structured (see above)
- **Bulk actions** — release or force-assign multiple devices at once (admin)
- **Device tags** — free-form labels beyond the fixed Team/Lab enums for ad-hoc grouping
- **Device edit history** — field-level audit log for all changes to device records (admin-only);
  useful for tracing accidental changes to `cluster_device_name` or IDRAC IP
- **SMTP setup wizard** — admin UI to configure and test email settings without touching `.env`
- **Mobile / responsive layout** — current design is desktop-only; a read-only mobile view could be
  useful for quick status checks
- **Dark mode** — system-preference-aware theme toggle; Tailwind's `dark:` variant makes this
  straightforward once the color tokens are mapped


---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | React 19 (Vite) + Tailwind v4 (slate, CSS variables) + shadcn/ui | Components extracted from `zedui-dev`; SSO SDK support |
| Backend | Python Django + Django REST Framework | ORM + migrations, email, admin, CSRF, built-in SSO libs |
| HTTP client | `httpx` (sync) | ZedCloud API calls; sync is fine for one-at-a-time requests |
| Database | SQLite (Django ORM) | Zero ops; upgrade to PostgreSQL later with zero code change |
| Encryption | Python `cryptography` (Fernet) | AES-128-CBC + HMAC for IDRAC passwords and bearer tokens |
| Email | `django.core.mail` | Built-in; 2-line setup; graceful no-op if SMTP not configured |
| Deploy | gunicorn + nginx on any Linux server | Single Python process; no uvicorn needed |

**What Django gives us for free vs FastAPI:**
- `makemigrations` / `migrate` — no Alembic setup
- `django.core.mail` — no aiosmtplib wiring
- `/admin` — free CRUD UI for Cluster/User/Device management
- `django-allauth` or `python-social-auth` — drop-in SSO when ready
- Built-in CSRF protection on all POST endpoints
- First-class settings / environment variable management (`django-environ`)

---

## Data Models

### Cluster
```text
id      int   PK auto
name    str   unique short name, e.g. "hummingbird", "prod"
host    str   ZedCloud hostname, format: zcloud.<name>.zededa.[net|dev], e.g. "zcloud.hummingbird.zededa.net"
```
**Pre-seeded entries:**
| name | host |
|---|---|
| hummingbird | zcloud.hummingbird.zededa.net |
| alpha | zcloud.alpha.zededa.net |
| canary | zcloud.canary.zededa.net |
| gmwtus | zcloud.gmwtus.zededa.net |
| thor | zcloud.thor.zededa.net |
| prod | zcloud.prod.zededa.net |

Only admin users can add or delete clusters. The dropdown in all forms is populated from this table.

### DeviceModel
```text
id                    int   PK auto
name                  str   unique model name, e.g. "OptiPlex 7040", "PowerEdge R740"
customer_partner_name str   nullable; Zededa customer/partner using the model,
                            e.g. "BOBST", "SLB", "OnLogic"; entered by user when adding model;
                            Add Model modal pre-seeds dropdown with known names:
                            BOBST · SLB · OnLogic · Emmerson · Shell · Toyota
```
Any user can add a new model. The Model dropdown in the device form is populated from this table. No
pre-seeded entries — team populates as they go.

### Device
```text
id                   int    PK auto
name                 str    display name in portal
serial_number        str    unique NOT NULL; hardware serial (primary identifier for physical device); duplicate → 400
description          str    nullable; free text — device capabilities, hardware notes, intended use
cluster_device_name  str    nullable; name used in ZedCloud API path (optional — only needed for ZedCloud status fetch)
model                FK     → DeviceModel.id
cluster_id           int    FK → Cluster.id; nullable (optional — only needed for ZedCloud status fetch)
team                 FK     → Team.id; nullable (SET_NULL); required before setting condition = dedicated
owner_email          str    nullable; FK → User.email; set on reserve
lab                  FK     → Lab.id (PROTECT, NOT NULL); must reference an existing Lab row
location_detail      str    nullable; free text — exact spot inside lab (e.g. "Rack-B3, slot 4", "Near the printer")
condition            enum   default 'normal' (NOT NULL); normal | out_of_order | needs_repair | temporarily_leased | dedicated | missing
                            DB constraint: CheckConstraint ensures condition is always one of the six valid enum values
idrac_ip             str    nullable
idrac_username       str    nullable
idrac_password_enc   bytes  nullable; AES-encrypted
eve_version          str    nullable; "Unknown" after 404
device_connectivity  json   nullable; JSONField — one entry per IPv4 address on any up+uplink interface;
                            e.g. [{"ip": "192.168.0.121", "mac": "aa:bb:cc:dd:ee:ff", "interface_name": "eth0"}];
                            "Unknown" after 404; populated on status fetch
status               str      nullable; "Unknown" after 404
status_fetched_at    datetime nullable; timestamp of last successful ZedCloud status fetch; displayed as relative time in Status tooltip
reserved_at          datetime nullable; timestamp when the current owner acquired the device (set on reserve / force-assign / approval; cleared on release); backfilled from OwnershipHistory on migration
last_purpose_text    str      nullable; denormalized cache of newest DevicePurpose entry (for list view — avoids N+1)
last_purpose_by      str      nullable; author email of newest purpose entry
last_purpose_at      datetime nullable
created_at           datetime
updated_at           datetime
```

**Derived (not stored):** `is_available = (owner_email IS NULL) AND condition NOT IN (out_of_order, temporarily_leased, dedicated, missing)`. Used by both the Available/Reserved filter and the status badge — a device with a blocking condition is **never** "Available" even though it has no owner.

**Required on creation:** name, serial_number, model, lab
**Optional on creation:** description, cluster_id, cluster_device_name, team, owner_email,
location_detail, idrac_ip, idrac_username, idrac_password

### Lab
```text
id    int   PK auto
name  str   unique (max 100 chars); e.g. "Bangalore Lab", "CoreSite Lab", "Home Lab"
```
Pre-seeded entries: Bangalore Lab · Bangalore Office Space · Berlin Lab · SanJose Lab · CoreSite Lab · Home Lab.
New labs can be added via Django admin (`/admin/`) without any code change — all Lab dropdowns in the UI
refresh on the next full page load because `GET /api/v1/choices/` queries this table at runtime.

### Team
```text
id    int   PK auto
name  str   unique (max 50 chars); e.g. "ST", "EVE", "PLATFORM"
```
Pre-seeded entries: EVE · PLATFORM · ST.
New teams can be added via Django admin — all Team dropdowns refresh on next page load (same pattern as Lab).

### User
```text
id          int   PK auto
name        str
email       str   unique — identity anchor
team        FK    → Team.id (PROTECT, NOT NULL)
user_type   enum  admin | member | guest
```
- `guest` — read-only; can log in and view the device table and expand panels; cannot perform any
  write operation (reserve, release, edit, delete, fetch status, force-assign, export/import);
  all action controls hidden in the UI; `/users` page inaccessible (redirects to `/devices`)

### Enterprise  *(admin-managed ZedCloud enterprise credentials)*
```text
id                int      PK auto
name              str      enterprise name (from ZedCloud)
cluster_id        int      FK → Cluster.id (CASCADE)
bearer_token_enc  bytes    Fernet-encrypted ZedCloud API bearer token (write-only; never returned in API)
zcloud_id         str      enterprise UUID from ZedCloud /v1/enterprises/self
is_active         bool     False when ZedCloud reports the enterprise is not ENTERPRISE_STATE_ACTIVE
name_verified     bool     True after verify_enterprise_names() confirms name matches ZedCloud; resets on token update or import overwrite
last_sync_at      datetime nullable — when the last sync completed
last_sync_status  enum     ok | error | token_expired
last_sync_error   str      nullable — error detail from last failed sync
```
**Constraint:** `unique_together = ('name', 'cluster')`.

### UntrackedDevice  *(devices seen in ZedCloud but not in inventory)*
```text
id                  int      PK auto
enterprise_id       int      FK → Enterprise.id (CASCADE)
zcloud_id           str      device UUID in ZedCloud
name                str      device name in ZedCloud
serial_number       str
model               str      (denormalized from ZedCloud response)
run_state           str
eve_version         str      nullable
device_connectivity JSON     nullable
first_seen_at       datetime
last_seen_at        datetime
```
**Constraint:** `unique_together = ('serial_number', 'enterprise')`.

### Notification  *(admin-facing in-app alerts from sync engine)*
```text
id          int      PK auto
kind        enum     token_expired | sync_error | name_mismatch | enterprise_inactive
enterprise  FK       → Enterprise.id (CASCADE, nullable)
title       str
body        str
created_at  datetime auto
is_read     bool     default False
read_at     datetime nullable
```
**Constraint:** `unique_together = [('kind', 'enterprise')]` — repeated failures update the existing notification rather than creating duplicates.

### ReservationRequest
```text
id               int      PK auto
device_id        int      FK → Device.id
requester_email  str      FK → User.email
requested_at     datetime
expires_at       datetime requested_at + 3 hours
status           enum     pending | approved | rejected | expired
token            str      unique random 32-byte hex token (for email approve/reject links)
```
**Constraint:** at most one `status=pending` request per device at a time.

### DevicePurpose
```text
id            int      PK auto
device_id     int      FK → Device.id
author_email  str      FK → User.email — who set the purpose
text          str      the purpose text
created_at    datetime
```
- Stores the last **10** purpose entries per device (oldest pruned automatically on write)
- Cleared entirely when ownership changes (reserve, release, force-assign, auto-approve)
- Any logged-in user can set the purpose; **clearing** (posting empty text) requires the device owner or an admin
- On write/clear, also update the denormalized `Device.last_purpose_*` cache fields so the device
  list (which shows the newest purpose per row) needs no per-row join

### OwnershipHistory
```text
id             int      PK auto
device_id      int      FK → Device.id
owner_email    str      nullable — null means device became available
changed_by     str      FK → User.email — who triggered the change
changed_at     datetime
reason         enum     device_added | reserved | released | force_assigned | request_approved | request_expired | condition_change
```
- Append-only; never deleted
- Visible to admin only via API and UI

---

## API Surface

### Clusters
```text
GET  /api/v1/clusters          list all (for dropdown)
POST /api/v1/clusters          admin only; body: {name, host}
                               host auto-suggested as zcloud.{name}.zededa.net if omitted; host validated against pattern zcloud.<name>.zededa.[net|dev]
```

### Models
```text
GET  /api/v1/models            list all (for dropdown)
POST /api/v1/models            any user; body: {name, customer_partner_name?}
                               duplicate name rejected with clear error
                               customer_partner_name optional — identifies the customer or Zededa partner
                               Zededa customer/partner using the model; searchable from the main device search bar
```

### Devices
```text
GET    /api/v1/devices          ?q=<search>&available=<true|false|all>
                                &team=<ST|EVE|PLATFORM>&lab=<lab name>
                                &condition=<normal|out_of_order|needs_repair|temporarily_leased|dedicated>
                                q matches: name, model, cluster, owner name, eve_version, purpose text,
                                customer_partner_name (via device model)
                                team / lab / condition are exact-match filter selects (combinable)
POST   /api/v1/devices          add; body: DeviceCreate; duplicate serial_number → 400 "Serial number already exists"
PUT    /api/v1/devices/{id}     update name, description, cluster_id, cluster_device_name, idrac fields, team
                                serial_number is immutable after creation
DELETE /api/v1/devices/{id}     admin only (X-User-Email header)
POST   /api/v1/devices/{id}/reserve          no body — requester identified via X-User-Email header
POST   /api/v1/devices/{id}/force-assign     admin only; body: {assignee_email}
POST   /api/v1/devices/{id}/release          owner only (X-User-Email header); 403 if requester ≠ owner
POST   /api/v1/devices/{id}/status           body: {enterprise_id}
                                             uses Device.cluster_id + cluster_device_name
                                             decrypts Enterprise.bearer_token_enc server-side, calls ZedCloud, updates device
```

### Device Purpose API
```text
GET  /api/v1/devices/{id}/purpose/           list last 10 purpose entries, newest first; any logged-in user
POST /api/v1/devices/{id}/purpose/           body: {text}; author from X-User-Email
                                             empty text = clear (owner or admin only); auto-prunes to 10 entries after insert
```

### Device Ownership History
```text
GET  /api/v1/devices/{id}/ownership-history   admin only; returns {results: [...], has_more: bool}; newest 50 records, newest first
```

### Frontend Config
```text
GET  /api/v1/config/   public; returns {device_list_refresh_ms: int, notification_refresh_ms: int}
                        values read from DEVICE_LIST_REFRESH_MS / NOTIFICATION_REFRESH_MS env vars
                        defaults: 300000 (5 min) and 30000 (30 sec); frontend caches with staleTime: Infinity
```

### Choices
```text
GET  /api/v1/choices/      any registered user; returns {labs: [...], teams: [...], conditions: [...]}
                           single source of truth for all dropdown lists; labs and teams queried from
                           DB at runtime — adding a new Lab or Team via Django admin is reflected on
                           next page load; conditions list is derived from CONDITION_CHOICES in code
```

### Users
```text
GET   /api/v1/users        list all (for dropdowns, search)
POST  /api/v1/users        admin only; body: {name, email_prefix, team, user_type}
                           email stored as {email_prefix}@zededa.com — frontend sends prefix only
                           user_type accepts: admin | member
PATCH /api/v1/users/{id}   admin only; body: any subset of {name, team, user_type}
                           email is identity — not editable via this endpoint
```

### Clusters & Enterprises
```text
GET    /api/v1/clusters/                       IsPortalUser  — list clusters with nested enterprises + sync status
POST   /api/v1/clusters/                       IsAdminPortalUser — create cluster
PATCH  /api/v1/clusters/{id}/                  IsAdminPortalUser — update name / host
DELETE /api/v1/clusters/{id}/                  IsAdminPortalUser — blocked if enterprises exist
POST   /api/v1/clusters/{id}/enterprises/      IsAdminPortalUser — add enterprise (bearer token only; name fetched from ZedCloud)
PATCH  /api/v1/enterprises/{id}/               IsAdminPortalUser — update name / bearer token
DELETE /api/v1/enterprises/{id}/               IsAdminPortalUser — remove enterprise
POST   /api/v1/enterprises/{id}/sync/          IsAdminPortalUser — trigger immediate sync
GET    /api/v1/clusters/export/                IsAdminPortalUser — download full cluster + enterprise config as JSON (bearer tokens excluded)
POST   /api/v1/clusters/import/                IsAdminPortalUser — import cluster + enterprise config from JSON; triggers background verify
```

### Untracked Devices
```text
GET  /api/v1/untracked-devices/                IsPortalUser  — list devices seen in ZedCloud but absent from inventory; filterable by enterprise
POST /api/v1/untracked-devices/{id}/move-to-inventory/  IsPortalUser — move untracked device into inventory as a new Device row
```

### Notifications
```text
GET  /api/v1/notifications/                    IsAdminPortalUser — list unread admin notifications
POST /api/v1/notifications/{id}/read/          IsAdminPortalUser — mark single notification read
POST /api/v1/notifications/read-all/           IsAdminPortalUser — mark all notifications read
```

### Reservation Requests
```text
GET  /api/v1/reservations/pending              Header X-User-Email → requests where owner = current user
GET  /api/v1/reservations/mine                 Header X-User-Email → requests made by current user
GET  /api/v1/reservations/{token}              no auth — returns {device_name, requester_name, expires_at, status}
                                               used by the confirmation page to display context
POST /api/v1/reservations/{token}/approve      no auth — token IS the auth; executes approval
POST /api/v1/reservations/{token}/reject       no auth — token IS the auth; executes rejection
```

**Email link flow:**
- Email contains a **single link**: `http://<server>/confirm/{token}`
- That's a React frontend route — the page calls `GET /api/v1/reservations/{token}` to fetch context,
  then renders device name, requester name, expiry time, and two buttons: **[Approve]** /
  **[Reject]**
- Each button fires the corresponding `POST` endpoint
- A prefetch scanner follows the link → sees a confirmation page → **cannot trigger any action**
  (no autosubmit, no GET side-effects)
- Already-used or expired tokens show a clear "This request has already been resolved or expired"
  message

---

## ZedCloud Status Fetch

### Auth
Bearer token — admin-managed, per enterprise, stored encrypted in `Enterprise.bearer_token_enc`.

```http
GET https://{cluster.host}/api/v1/devices/name/{cluster_device_name}/status/info
Authorization: Bearer {token}
```

### Fetch Status Dialog (fields)
| Field | Pre-fill |
|---|---|
| Cluster | Device.cluster dropdown; editable — switching cluster updates the device record |
| Name in Cluster | Device.cluster_device_name (editable — user can correct before fetching) |
| Enterprise | Dropdown of active enterprises for the selected cluster; the backend decrypts the token server-side |

### Response Parsing
```python
# Serial number verification — reject entire update if mismatch
# minfo.serialNumber is the primary source; hardwareInfo.serialNum is a fallback
# (ZedCloud does not always populate hardwareInfo)
actual_serial = (
    data.get("minfo", {}).get("serialNumber", "")
    or data.get("hardwareInfo", {}).get("serialNum", "")
)
if actual_serial and actual_serial != device.serial_number:
    raise SerialMismatchError(
        device_name=device.name,
        cluster_name=device.cluster.name if device.cluster else cluster_device_name,
        expected=device.serial_number,
        actual=actual_serial,
    )
# if ZedCloud returns no serial (empty / absent field), skip verification silently

# EVE version: active partition
eve_version = next(
    (sw["shortVersion"] for sw in data.get("swInfo", []) if sw.get("activated")),
    None
)

# Connectivity: one entry per IPv4 on any up+uplink interface
# Interface name field in the ZedCloud API response is `ifName` (not `name`)
device_connectivity = []
for iface in data.get("netStatusList", []):
    if iface.get("up") and iface.get("uplink"):
        mac  = iface.get("macAddr", "")
        name = iface.get("ifName", "")
        for ip in iface.get("ipAddrs", []):
            if ":" not in ip:    # IPv4 only
                device_connectivity.append({
                    "ip":             ip,
                    "mac":            mac,
                    "interface_name": name,
                })

# Status — device-applicable values only (verified against libs/zmsg/zcommon/zcommon.proto)
STATUS_MAP = {
    "RUN_STATE_ONLINE":            "Online",
    "RUN_STATE_HALTED":            "Halted",
    "RUN_STATE_REBOOTING":         "Rebooting",
    "RUN_STATE_OFFLINE":           "Offline",
    "RUN_STATE_UNKNOWN":           "Unknown",
    "RUN_STATE_UNPROVISIONED":     "Unprovisioned",
    "RUN_STATE_PROVISIONED":       "Provisioned",
    "RUN_STATE_SUSPECT":           "Suspect",
    "RUN_STATE_DOWNLOADING":       "Downloading",
    "RUN_STATE_RESTARTING":        "Restarting",
    "RUN_STATE_BOOTING":           "Booting",
    "RUN_STATE_MAINTENANCE_MODE":  "Maintenance",
    "RUN_STATE_BASEOS_UPDATING":   "BaseOS Updating",
    "RUN_STATE_PREPARING_POWEROFF":"Preparing Poweroff",
    "RUN_STATE_POWERING_OFF":      "Powering Off",
    "RUN_STATE_PREPARED_POWEROFF": "Prepared Poweroff",
}
# Unmapped values fall through to "Unknown"
# App-instance-only states (RUN_STATE_PURGING, _HALTING, _ERROR, _VERIFYING, _LOADING,
# _CREATING_VOLUME, _START_DELAYED, _INIT) are intentionally excluded
```

### Error Handling
| HTTP | Backend | Frontend |
|---|---|---|
| **200 (serial match or no serial in response)** | Update device row (eve_version, device_connectivity, status, status_fetched_at) | Dialog closes; table row refreshes |
| **200 (serial mismatch)** | Do NOT update device | Dialog stays open; error: *"Serial mismatch — Expected: {expected} · Got: {actual}"* |
| **401 / 403** | Do NOT update device | Dialog stays open; error: *"Bearer token invalid or expired"* |
| **404** | Set all live fields → `"Unknown"`; clear device_connectivity; stamp status_fetched_at | Dialog closes; toast: *"{device} not found on {cluster}."* |
| **Other** | No device update | Dialog stays open; show HTTP status + body excerpt |

---

## Enterprise Sync Engine

### sync_all_enterprises() — hourly
Registered in APScheduler (`apps/enterprises/apps.py`); runs every **1 hour**.

For each active enterprise:
1. Fetches all devices from ZedCloud via `GET /v1/edgedevices/` using the decrypted bearer token
2. Matches each device by `serial_number` against the inventory (`Device` table)
   - **Match found:** updates `eve_version`, `device_connectivity`, `status`, `cluster`, `enterprise`, `cluster_device_name`; clears `condition = missing` back to `normal`
   - **No match:** upserts into `UntrackedDevice` (sets `first_seen_at` only on first insert)
3. Removes `UntrackedDevice` rows for serials that have since been added to inventory
4. On `401/403`: sets `last_sync_status = token_expired`; creates a `token_expired` Notification (deduped by `unique_together`)
5. On other errors: sets `last_sync_status = error`; logs the failure
6. After all enterprises: marks inventory devices with `enterprise` set, `condition = normal`, and serial not seen this cycle as `condition = missing`
   - Enterprises that failed or returned zero devices are **excluded** from the missing-mark to prevent false positives from transient network errors

### send_nightly_digest — midnight UTC
Registered in APScheduler; runs once per day at **midnight UTC**. Sends a summary email to all admins listing device condition changes from the past 24 hours. No-ops silently if SMTP is not configured.

### verify_enterprise_names() — post-import trigger only
**Not a scheduled job.** Called as a background daemon thread immediately after any import that creates or updates enterprises.

For each `is_active=True, name_verified=False` enterprise:
1. Decrypts the bearer token; skips on decrypt error (retried on next import)
2. Calls `GET /v1/enterprises/self` on the cluster host; skips on network error
3. Updates `zcloud_id` if the returned value differs from the stored one
4. **State check (priority):** if `state != ENTERPRISE_STATE_ACTIVE` → sets `is_active = False`; creates an `enterprise_inactive` Notification (deduped)
5. **Name check (only for active enterprises — `elif`):** if ZedCloud name differs from stored name → creates a `name_mismatch` Notification (deduped); does **not** auto-update the name
6. Sets `name_verified = True` in all cases (prevents re-processing on the next import)

`name_verified` resets to `False` whenever the bearer token is updated (via PATCH) or the enterprise row is overwritten by import.

---

## Identity & Auth

### Login Flow

**Login page (`/login`):**
- Fetches user list from `GET /api/v1/users` (no auth required — public endpoint)
- Searchable dropdown — filter by name or email; select to log in
- On select: store `currentUserEmail` in `localStorage`; redirect to `/devices`
- If `localStorage` has no entry (first visit or after logout) → redirect to `/login`

**Header (all pages):**
- Shows current user chip (avatar, name, Admin badge if applicable)
- Clicking the chip opens a small dropdown with: name, email, team, role — and a **Log out** button
- Log out clears `localStorage["currentUserEmail"]` → redirects to `/login`

**API authentication:**
- Every request (read or write) from a logged-in session includes `X-User-Email: {currentUserEmail}`
  header, read from `localStorage`
- Backend uses this header to identify the caller, look up their `user_type`, and enforce role-based
  access
- Endpoints that require no identity: `GET /api/v1/users` (login page), `GET
  /api/v1/reservations/{token}`, `POST /api/v1/reservations/{token}/approve`, `POST
  /api/v1/reservations/{token}/reject` (token IS the auth)
- Reserve specifically: `POST /api/v1/devices/{id}/reserve` sends no body — requester is derived
  entirely from `X-User-Email`; no user picker in the UI

**Route protection (frontend):**
- `UserContext` checks `localStorage` on mount; if empty → redirect to `/login`
- Admin-only nav links (e.g. Users page) hidden for non-admin users; direct URL access returns a
  403-style message
- Guest users: `/devices` is the only accessible route; `/users` and any other route redirects to
  `/devices`; all action buttons (Reserve, Release, Edit, Delete, Fetch Status, Force Assign,
  Export/Import) are hidden; the Actions column (3-dot menu) is not rendered

**SSO upgrade path:**
- Gateway/proxy injects a verified `X-User-Email` header from JWT claim and strips the client-
  supplied one
- Django middleware intercepts the request, reads the verified header, calls `get_current_user()`
- Login page replaced by SSO redirect — no schema or API changes needed
- `django-allauth` or `python-social-auth` handles SAML/OIDC — both are well-documented for Django

---

## Reservation Approval Flow

```text
User B clicks "Reserve" on a device owned by User A
  → Requester is the logged-in user (X-User-Email header) — no user picker in the dialog
  → Dialog shows a read-only "Reserving as: {current user}" chip before confirming

  ├─ Device has no owner → reserve immediately, done
  └─ Device is owned:
       ├─ A pending request already exists → dialog shows blocked state:
       │     "{Requester} has already requested this device · expires in {time}"
       │     No submit button — user can only cancel
       └─ No pending request:
            → Create ReservationRequest (pending, 3-hour expiry, unique token)
            → Notify User A via Email (if SMTP configured) + in-app badge
            → Show User B: "Request sent to Alice. Contact them directly to expedite approval."

User A sees the notification:
  ├─ Approves → device.owner_email = User B email; device.team = User B team
  │             User B notified (email + in-app)
  └─ Rejects  → ReservationRequest.status = rejected
                 User B notified (email + in-app)

Request expires after 3h with no action:
  → ReservationRequest.status = expired (background cleanup task)
  → Device ownership unchanged

If User A releases the device while a request is pending:
  → Auto-approve: device.owner_email = User B email
  → User B notified: "Your request for {device} was approved — you are now the owner"

Admin force-assign (bypasses approval):
  → Immediate ownership transfer
  → Previous owner always notified: "Admin reassigned your device '{device}' to {User B}"
  → If a pending request exists AND assignee ≠ requester:
       requester also notified: "Your request for '{device}' was overridden by an admin"
  → If a pending request exists AND assignee = requester:
       pending request auto-approved; requester notified via normal approval email

All ownership changes (reserve, release, force-assign, auto-approve, expiry with no change):
  → Append row to OwnershipHistory
  → Clear all DevicePurpose rows for that device on any transfer of ownership
```

### Reservation Notifications

**Email (when SMTP_HOST is set in .env):**
- Approval request to owner: includes Approve/Reject URLs with token (token IS the auth, no login
  needed)
- Result notification to requester: approved or rejected
- Force-assign notice to displaced owner (always)
- Force-assign override notice to pending requester (only if assignee ≠ requester)

**In-app badge (always active):**
- Bell icon in header with count of pending requests needing the current user's action
- Dropdown lists: requests awaiting the user's approval + status of the user's own requests

**SMTP config (graceful degradation):**
```bash
SMTP_HOST=         # if blank, email disabled silently; in-app only
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=device-portal@zededa.com
```
Admin UI shows a yellow warning banner if SMTP is not configured.

### Admin Notifications

System alerts generated by the sync engine and the verification job. Visible only to admins. The bell icon count badge combines pending reservation requests and unread admin notifications.

**Notification kinds and click behavior:**

| Kind | Trigger | Click action |
|---|---|---|
| `token_expired` | `sync_all_enterprises()` receives 401/403 from ZedCloud | Navigate to `/cluster-enterprises` |
| `sync_error` | `sync_all_enterprises()` fails with a non-auth error | Navigate to `/cluster-enterprises` |
| `enterprise_inactive` | `verify_enterprise_names()` finds state ≠ `ENTERPRISE_STATE_ACTIVE` | Navigate to `/cluster-enterprises` |
| `name_mismatch` | `verify_enterprise_names()` finds ZedCloud name ≠ local name | Inline buttons only — does not navigate |

**`name_mismatch` inline resolution buttons** (rendered inside the notification item, unread only):
- **"Use '{zcloud_name}'"** — calls `PATCH /api/v1/enterprises/{id}/` with `{name: zcloud_name}`; on success marks the notification read
- **"Keep '{local_name}'"** — marks the notification read without changing the name
- Either action resolves the notification; the enterprise is not re-verified unless its token changes or it is re-imported

Notifications are deduplicated via `unique_together = [('kind', 'enterprise')]` — repeated failures update the existing notification rather than creating duplicates.

---

## Device Table UI

> **Viewport scope:** Desktop-first, intentionally. This is an internal lab tool used from
> workstations; the table horizontal-scrolls below ~`md`. Responsive/mobile layout is
> explicitly out of scope.

### Summary Bar

A stats line appears directly below the "Devices" heading, giving an at-a-glance view of the
current filtered set:

```text
37 total  ·  12 available  ·  5 reserved  ·  19 online  ·  3 needs repair  ·  1 out of order  ·  2 leased  ·  1 missing
```

- Hidden while the initial data load is in progress
- Counts always reflect the currently applied search and filter — not global totals
- **`total`**, **`available`**, **`online`** are always shown
- **`reserved`**, **`needs repair`**, **`out of order`**, **`leased`**, **`missing`** are omitted when their count is 0
- Color coding: `total` → foreground, `available` → emerald green, `needs repair` → yellow-400,
  `out of order` → red-400, `leased` → violet-400, `missing` → orange-400; rest inherit muted foreground

### Search & Filter
- **Single search box** — debounced 300ms — placeholder lists all searchable fields; matches
  against: Name, Model, Customer/Partner name, Cluster name, Owner (name), EVE version,
  **last purpose text** (case-insensitive partial match)
- **Available / Reserved / All** — chip toggle (uses the derived `is_available` rule, so blocking-
  condition devices never count as Available)
- **Condition / Lab / Team** — three exact-match filter selects (in this order) beside the chip toggle;
  combinable with the search box and each other; all values populated from DB via `GET /api/v1/choices/`
- **Team "Unassigned"** — special value in the Team filter that returns devices where `team IS NULL`;
  useful to audit unassigned devices across labs

### Layout — collapsible rows
The table shows a compact primary row per device; a **chevron** in the first column expands an
inline detail panel below it. This keeps the common case scannable while still surfacing the full
record on demand.

**Primary row columns (left → right, default order — user-reorderable via drag-and-drop):**
| Column | Notes |
|---|---|
| (chevron) | Expand / collapse toggle; fixed first; not reorderable |
| Name | Sortable; condition badge below name when condition ≠ normal; copy button on hover |
| Serial No | Hardware serial number (monospace); unique; immutable; copy button on hover |
| Cluster | Short name badge; sortable |
| Name in Cluster | `cluster_device_name` in monospace; "—" if not set; copy button on hover |
| Team | Team assignment; "—" if not set |
| Lab | Lab location; always set |
| Owner | Green "Available" text for available devices; avatar + name for owned devices; blue outline Reserve button for all non-owner users; red outline Release button for owner; "UNAVAILABLE" badge for blocking conditions; hover tooltip shows "Reserved X days ago" |
| Status | Color-coded badge (see Status Badge Colors below) + **"Refresh"** link below; hover tooltip shows "Last refresh: X mins ago" |
| Purpose | Newest purpose entry (2-line truncated) from denormalized cache; "—" if none; click to edit inline |
| Actions | 3-dot dropdown only — fixed last; not reorderable |

**Column reordering:** All columns between chevron and Actions can be dragged by their header grip
icon (⠿) to reorder. Order is persisted per browser in `localStorage`.

**Column resizing:** Drag the resize handle on any column header border to adjust width; widths
persisted per browser in `localStorage`.

**Status Badge Colors (ZedUI-aligned):**
| Status | Color |
|---|---|
| Online | Green |
| Suspect · Maintenance · Preparing/Powering/Prepared Poweroff | Amber / warning |
| Rebooting · Downloading · Restarting · Booting · BaseOS Updating | Blue / info |
| Provisioned | Purple |
| Offline · Halted · Unprovisioned · Unknown | Gray / neutral |

**Expanded detail panel — 3 card columns:**

*Card 1 — Identity + Placement (left):*
| Section | Fields |
|---|---|
| Identity | Model · Customer / Partner |
| Placement | Lab · Location detail |

All fields in the expand panel are always rendered. Fields with no data show `—` (em dash) rather than
being hidden. This makes the panel predictable — the same layout every time regardless of data completeness.

*Card 2 — ZedCloud Status + Connectivity (middle):*
| Section | Fields |
|---|---|
| ZedCloud Status | EVE Version (mono) · Last Refreshed (exact datetime of last status fetch) |
| Connectivity | One row per interface: `{interface_name}` left / `{mac} · {ip}` right (mono); "—" if none; "Unknown" after 404 |

*Card 3 — IDRAC + Notes (right):*
| Section | Fields |
|---|---|
| IDRAC | Console ↗ link · Credentials; "—" if not configured |
| Notes | Free-text device capabilities / hardware notes; "—" if empty |

Fields **not** in the expand panel (they have their own primary-row columns): Serial No, Team, Lab.
Condition is communicated by the row's left-border color and the Name-column badge; change it via
Edit Device modal. The Purpose column in the primary row already surfaces the newest purpose entry.

**Sortable columns:** All columns except Purpose. Sort key is the primary value (e.g. Owner sorts by owner name/email, Status sorts by status string). Empty values always sort last regardless of direction.

### List states (wireframed in `states.html`)
| State | Behavior |
|---|---|
| Loading | Shimmer skeleton rows + "Loading devices…" footer; replaces table body only |
| Empty | Centered "No devices yet" + primary **Add Device** CTA |
| No results | "No devices match your filters" + **Clear search & filters**; filter bar stays visible |
| Load error | Centered error card; reassures data is safe; **Retry** button |
| Stale | Keep last-known rows (dimmed); "Couldn't refresh — data from {n} min ago" + **Retry now** |

### Owner Column — Reserve / Release Rules
Release is **owner-only** — admins cannot release a device they do not own (same restriction as members).
The Release button uses red outline styling (`border-destructive/50 text-destructive`) to visually distinguish it from the blue outline Reserve button. Available devices show a plain green "Available" label above the Reserve button in place of the owner avatar.

| Scenario | Guest sees | Member sees | Admin sees |
|---|---|---|---|
| Device owned by logged-in user | Owner name only — no button | Red outline "Release" button | Red outline "Release" button |
| Device owned by someone else | Owner name only — no button | Green "Available" text + blue outline "Reserve" | Green "Available" text + blue outline "Reserve" |
| Device available (no owner) | Green "Available" text — no button | Green "Available" text + blue outline "Reserve" | Green "Available" text + blue outline "Reserve" |
| Device condition = `dedicated` | Team name chip — no button | Team name chip (e.g. "ST") — no Reserve button | Team name chip — no Reserve button |

### Actions Column (3-dot menu)
| Scenario | Guest sees | Member sees | Admin sees |
|---|---|---|---|
| Own device | — (column hidden) | Edit | Edit, Delete |
| Someone else's device | — (column hidden) | Edit | Edit, Force Assign, Delete |
| Available device | — (column hidden) | Edit | Edit, Delete |
| Someone else's device with pending request | — (column hidden) | Edit | Edit, Force Assign, Delete |

### Force Assign Dialog
- Pre-selects the pending requester (if one exists) with a visible "has a pending request" label
- Admin can override the selection to assign to anyone else
- Emails sent on submit:
  - Owner always notified: "Admin reassigned your device to {assignee}"
  - If assignee ≠ requester: requester notified "Your request was overridden by an admin"
  - If assignee = requester: treated as approval; requester gets normal approval email

---

## Device Condition Flags

Any logged-in user can set or clear the condition via the **Edit Device modal**.

Condition values are stored in the DB as snake_case (`needs_repair`, `out_of_order`, etc.) and
displayed in the UI as title-case labels ("Needs Repair", "Out Of Order", etc.).

| Condition | Row highlight | Owner field | Reserve | Release | Email alert |
|---|---|---|---|---|---|
| `out_of_order` | Red row + red left border | **UNAVAILABLE** | Disabled | Hidden | Yes — all admins |
| `needs_repair` | Yellow row + yellow left border | Unchanged | Normal | Normal | No |
| `temporarily_leased` | Violet row + violet left border | **UNAVAILABLE** | Disabled | Hidden | No |
| `dedicated` | Blue row + blue left border | Device team name (e.g. "ST") — requires `device.team` to be set | Disabled | Hidden | No |
| `missing` | Orange row + orange left border | **UNAVAILABLE** | Disabled | Hidden | No |
| *(cleared / normal)* | No highlight | Stays null — new reservation needed | Normal | Normal | No |

**`missing` condition** — used when a physical device cannot be located. Behaves like `out_of_order`
for reservation purposes (clears owner, expires pending requests) but does **not** send an admin email.
Useful to flag devices that disappeared from a lab without triggering an incident notification.

**UI color tokens (Tailwind):**

| Condition | Row bg | Left border | Badge |
|---|---|---|---|
| out_of_order | `bg-red-50` | `border-l-red-500` | `bg-red-100 text-red-700` |
| needs_repair | `bg-yellow-50` | `border-l-yellow-400` | `bg-yellow-100 text-yellow-800` |
| temporarily_leased | `bg-violet-50` | `border-l-violet-400` | `bg-violet-100 text-violet-700` |
| dedicated | `bg-blue-50` | `border-l-blue-400` | `bg-blue-100 text-blue-700` |
| missing | `bg-orange-50` | `border-l-orange-400` | `bg-orange-100 text-orange-700` |

Condition values are stored in the DB as snake_case (`needs_repair`, `out_of_order`, etc.) and rendered
in the UI as title-case labels ("Needs Repair", "Out Of Order", etc.) via a `.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())` transform in the frontend.

**Out of Order — admin email content:**

Sent immediately when any user sets a device to `out_of_order`. Admins (typically managers and
lab leads) receive this so they are aware of the issue without having to discover it themselves,
and can take action — arrange repair, communicate to the team, or update the condition once
resolved.

- To: all users with `user_type = admin`
- Subject: `[Device Portal] Device out of order: {device.name}`
- Body includes: name, lab + location detail, model, IDRAC IP, cluster, EVE version (if known)
- Does **not** include: owner history, comments

**Condition rules:**
- Setting `out_of_order`, `temporarily_leased`, or `missing` → set `owner_email = null`; append OwnershipHistory
  (`reason = condition_change`); expire any pending ReservationRequest
- Setting `dedicated` → set `owner_email = null`; expire any pending ReservationRequest; append
  OwnershipHistory (`reason = condition_change`); validation: `device.team` must be non-null (if not
  set, frontend prompts user to set a team in Edit Device first); Owner column shows team name chip
- Clearing any condition → device becomes available (owner stays null; reserve normally)
- `needs_repair` → no change to owner or reservations
- Any user can set or clear the condition field
- `out_of_order` additionally emails all admins; `missing`, `temporarily_leased`, and `dedicated` do not

---

## Device Purpose

- Any logged-in user can set the purpose on any device at any time
- Editable **inline** in the device table — click the Purpose cell to open a textarea; Enter saves,
  blur saves; Escape cancels; an × button clears the field
- Clearing (posting empty text) is restricted to the **current device owner or an admin**
- On save: new `DevicePurpose` row inserted; oldest row pruned if count exceeds 10 per device
- **On any ownership change** (reserve, release, force-assign, auto-approve): all `DevicePurpose`
  rows for the device are deleted — the slate is cleared for the new owner
- Manual clear via the UI nulls only the `last_purpose_*` cache fields on Device; history rows are
  only bulk-deleted on ownership transfers

---

## Ownership History (Admin)

- Every ownership change appends a row to `OwnershipHistory` — never edited or deleted
- Fields recorded: new owner (null = released), who triggered it, timestamp, reason
- Accessible via **"Ownership History"** option in the 3-dot Actions menu (admin view only)
- Displayed in a modal: timeline list with owner avatar + name (or "Available"), triggered-by,
  reason badge, and timestamp

---

## Export / Import (Admin Only)

Admin users can export all device data and import it back for migration, backup, or bulk editing.
An **Export / Import** button is visible in the device table header for admin users only.

### Export
```text
GET /api/v1/admin/export?fmt=<csv|json>
```
- Auth: admin only (X-User-Email header)
- Downloads a snapshot of the full device list; filename: `holocron_device_inventory_{YYYYMMDD_HHMMSS}.{csv|json}`
- CSV: one row per device; column headers match field names
- JSON: list of device objects — same shape as `GET /api/v1/devices` response
- After download completes, a toast notification informs the user that the full inventory was exported — not just the current filtered view

**Exported fields:** id, name, serial_number, description, cluster (name), cluster_device_name,
model (name), customer_partner_name (from model), team, owner_email, lab, location_detail,
condition, idrac_ip, idrac_username, eve_version, device_connectivity, status,
last_purpose_text, created_at, updated_at

**Not exported:** idrac_password_enc, enterprise bearer tokens, ownership history, device purpose history

### Import template
```text
GET /api/v1/admin/import-template/
```
- No auth required — returns a static CSV file with correct column headers and one example row
- Filename: `device_import_template.csv`
- Frontend: "Download CSV template" link at the top of the Import dialog

**Template columns:** name, serial_number, model, cluster, cluster_device_name, team, lab,
location_detail, condition, description, idrac_ip, idrac_username, owner_email

### Import
```text
POST /api/v1/admin/import
Content-Type: multipart/form-data
Body: file=<csv or json>, mode=<create_only|update_or_create>
```
- Auth: admin only
- `create_only` — inserts new rows only; silently skips rows where serial_number already exists
- `update_or_create` — upserts by serial_number; updates matching rows, inserts new ones
- Returns a summary: `{created: N, updated: N, skipped: N, errors: [{row, reason}]}`
- Import does **not** touch ownership history or device purpose history — device fields only
- Encrypted fields (idrac_password, bearer tokens) cannot be imported; must be set manually after import
- **Required import columns:** name, serial_number, model (name), lab
- Unknown model names → auto-create a new DeviceModel; unknown cluster names → auto-create a new Cluster with zcloud. host prefix; lab and team must already exist — unknown values are rejected with a per-row validation error

**Forgiving header parsing:** column names are normalised before processing — leading/trailing
whitespace stripped, lowercased, spaces and hyphens replaced with underscores. Common aliases
are mapped to canonical names automatically:

| Accepted variant | Canonical field |
|---|---|
| Serial, serial_no, Serial Number | serial_number |
| Device Name, device_name | name |
| Model Name, model_name | model |
| Cluster Name, cluster_name | cluster |
| Name In Cluster, name_in_cluster | cluster_device_name |
| Location | location_detail |
| Lab Location, lab_location | lab |

**Value normalisation:** The `condition` field value is also normalised — any casing or spacing
variant is accepted and converted to the DB snake_case format on import
(e.g. "Needs Repair", "needs repair", "NEEDS_REPAIR" → `needs_repair`).

**Per-row field validation:** Each row is validated before any DB write. Rejected rows are reported in the error list (with row number and reason) and skipped; valid rows continue to be processed. Validated fields: `owner_email` (valid email format), `idrac_ip` (valid IPv4 or IPv6), `condition` (must be a known value after normalisation), `lab` (must reference an existing Lab row), `team` (must reference an existing Team row if provided).

**Frontend:** drag-and-drop file picker + mode selector; result modal showing created / updated / skipped / error counts.

### Latency dashboard
```text
GET /api/v1/admin/latency/
```
- Auth: admin only
- Returns request latency statistics from the `RequestLog` table: p50/p95/p99 per endpoint (last 24 h and 7 d), slowest recent requests, and a list of endpoints that frequently exceed 1 000 ms
- Used internally for performance monitoring; data is retained for 30 days and then pruned

---

## Add Cluster Flow
- Only admin users can add or delete clusters; regular members can view the cluster list but cannot create or delete clusters
- Fields: **Name** + **Hostname** (auto-suggested as `zcloud.{name}.zededa.net` when name is typed; host is validated against the pattern `zcloud.<name>.zededa.[net|dev]`)
- On submit → `POST /api/v1/clusters` → dropdown in all forms immediately includes new cluster
- Duplicate name rejected with a clear error

---

## Untracked Devices Page

Route: `/untracked-devices`. Accessible to all portal users. Lists devices the sync engine has observed in ZedCloud that are not present in the portal inventory.

**Filters — cascade dropdowns, client-side:**
- All untracked devices are fetched in a single `GET /api/v1/untracked-devices/` call; all filtering is client-side
- **Cluster** dropdown (first): lists every cluster that has at least one untracked device; selecting a cluster restricts the Enterprise dropdown to enterprises under that cluster
- **Enterprise** dropdown (second): lists enterprises within the selected cluster; defaults to "All Enterprises" when no cluster filter is active; resets to "All" whenever the cluster selection changes

**Table columns:**

| Column | Source field |
|---|---|
| Serial | `serial_number` |
| Name in ZedCloud | `name` |
| Model | `model` |
| Run State | `run_state` (mapped via `STATUS_MAP`) |
| EVE Version | `eve_version` |
| Enterprise | enterprise name |
| First Seen | `first_seen_at` |
| Last Seen | `last_seen_at` |

**Move to Inventory:** each row has a "Move to Inventory" action that opens a dialog pre-filled with the device's serial, name, model, cluster, and enterprise. The admin fills in any missing required fields (lab, team, etc.) and submits — calls `POST /api/v1/untracked-devices/{id}/move-to-inventory/`, which creates a new `Device` row and deletes the `UntrackedDevice` row.

---

## Encryption
- **Key:** `ENCRYPTION_KEY` env var — base64 Fernet key generated once at deploy
- **Encrypted fields:** `Device.idrac_password_enc`, `Enterprise.bearer_token_enc`
- `Device.idrac_username` is stored plaintext (not a credential by itself)
- Encrypted blobs never exposed in API responses

---

## Auto-Refresh
- Device table polls `GET /api/v1/devices` every **5 minutes** (default) while the browser tab is active
- Notification panel polls every **30 seconds** (default)
- Both intervals are configurable via `DEVICE_LIST_REFRESH_MS` and `NOTIFICATION_REFRESH_MS` env vars;
  served to the frontend at startup via `GET /api/v1/config/`
- Polling pauses when the tab is hidden (`refetchIntervalInBackground: false`)

---

## Deployment

### Docker (recommended)

Two containers managed by Docker Compose — one command to start everything:

```bash
cp .env.example .env   # fill in SECRET_KEY, ENCRYPTION_KEY, SMTP settings
docker compose up -d
```

```text
docker-compose.yml
  backend   → Django + gunicorn (port 8000, internal only)
  frontend  → multi-stage: Node builds React → nginx serves dist/ + proxies /api/
               exposed on host :80
```

**docker-compose.yml sketch:**
```yaml
services:
  backend:
    build: ./backend
    env_file: .env
    volumes:
      - sqlite_data:/app/data     # persists db.sqlite across restarts
      - static_files:/app/static  # Django collectstatic output
    expose:
      - "8000"

  frontend:
    build: ./frontend
    ports:
      - "80:80"
    volumes:
      - static_files:/static      # serves Django admin CSS/JS
    depends_on:
      - backend

volumes:
  sqlite_data:
  static_files:
```

**backend/entrypoint.sh:**
```bash
#!/bin/sh
python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py loaddata clusters_seed.json   # idempotent — safe to repeat
if [ "$LOAD_DEMO_DATA" = "true" ]; then
  python manage.py loaddata demo_fixture.json
fi
exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers 2
```

**frontend/nginx.conf sketch:**
```nginx
location /api/    { proxy_pass http://backend:8000; proxy_set_header Host $host; }
location /admin/  { proxy_pass http://backend:8000; proxy_set_header Host $host; }
location /static/ { alias /static/; }
location /        { root /usr/share/nginx/html; try_files $uri /index.html; }
```

**frontend/Dockerfile (multi-stage):**
```dockerfile
# Stage 1: build React
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: serve with nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
```

**Critical notes:**
- `ENCRYPTION_KEY` must be backed up — losing it means stored IDRAC passwords and bearer tokens
  cannot be decrypted
- `docker compose down` is safe (data persists in volumes); `docker compose down -v` deletes all
  data
- For HTTPS: terminate TLS at the host with nginx/Caddy/Traefik in front; no changes needed inside
  containers

### Bare-metal alternative
```bash
# backend
gunicorn config.wsgi:application --bind 127.0.0.1:8000

# frontend — build once, serve with nginx
npm run build   # → dist/
# nginx config same as above but proxy to 127.0.0.1:8000 instead of backend:8000
```

---

## Project File Structure

```text
device-managing-portal/
├── DESIGN.md
├── backend/
│   ├── manage.py
│   ├── config/
│   │   ├── settings.py          django-environ reads .env; INSTALLED_APPS, DB, EMAIL, CORS
│   │   ├── urls.py              /api/* → DRF routers; /admin/ → Django admin
│   │   └── wsgi.py
│   ├── apps/
│   │   ├── clusters/
│   │   │   ├── models.py        Cluster model
│   │   │   ├── serializers.py
│   │   │   ├── views.py         ClusterViewSet (DRF)
│   │   │   ├── urls.py
│   │   │   └── admin.py         Cluster registered in Django admin
│   │   ├── device_models/
│   │   │   ├── models.py        DeviceModel model
│   │   │   ├── serializers.py
│   │   │   ├── views.py         DeviceModelViewSet (DRF)
│   │   │   ├── urls.py
│   │   │   └── admin.py
│   │   ├── devices/
│   │   │   ├── models.py        Device model
│   │   │   ├── serializers.py
│   │   │   ├── views.py         DeviceViewSet + status fetch action
│   │   │   ├── urls.py
│   │   │   └── admin.py
│   │   ├── users/
│   │   │   ├── models.py        PortalUser (separate from Django auth user)
│   │   │   ├── serializers.py
│   │   │   ├── views.py
│   │   │   ├── urls.py
│   │   │   └── admin.py
│   │   ├── enterprises/
│   │   │   ├── models.py        Enterprise model
│   │   │   ├── serializers.py
│   │   │   ├── views.py         CRUD + ClusterExportView + ClusterImportView + EnterpriseSyncView
│   │   │   ├── sync.py          sync_all_enterprises(); verify_enterprise_names()
│   │   │   ├── apps.py          APScheduler registration
│   │   │   └── urls.py
│   │   ├── notifications/
│   │   │   ├── models.py        Notification model
│   │   │   ├── views.py
│   │   │   └── urls.py
│   │   └── reservations/
│   │       ├── models.py        ReservationRequest model
│   │       ├── serializers.py
│   │       ├── views.py         + confirm page endpoint
│   │       └── urls.py
│   ├── services/
│   │   └── zedcloud.py          sync httpx call + response parsing + serial verification
│   ├── apps/admin_tools/
│   │   ├── views.py         ExportView, ImportView, ImportTemplateView, LatencyView
│   │   └── urls.py
│   ├── utils/
│   │   ├── crypto.py            Fernet encrypt() / decrypt()
│   │   ├── email.py             django.core.mail wrapper; no-op if SMTP_HOST unset
│   │   └── permissions.py       IsPortalUser, IsAdminPortalUser, IsOwnerOrAdmin DRF permission classes
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── main.tsx
    │   ├── App.tsx
    │   ├── api/
    │   │   ├── client.ts        axios instance; auto-sends X-User-Email header
    │   │   ├── choices.ts       getChoices() → {labs, teams, conditions, enterprises}
    │   │   ├── devices.ts
    │   │   ├── users.ts
    │   │   ├── enterprises.ts   clusters + enterprises CRUD + export/import
    │   │   ├── notifications.ts getNotifications/markRead/markAllRead
    │   │   ├── untracked.ts     getUntrackedDevices/moveToInventory
    │   │   ├── models.ts
    │   │   ├── reservations.ts
    │   │   └── admin.ts
    │   ├── context/
    │   │   └── UserContext.tsx  current user in localStorage; provides useUser()
    │   ├── components/
    │   │   ├── Header.tsx           user dropdown + notification bell
    │   │   ├── NotificationPanel.tsx  pending reservations for current user
    │   │   ├── DeviceTable.tsx      sortable table, auto-refresh, pending indicator
    │   │   ├── SearchBar.tsx        single debounced input + Available/Reserved chip
    │   │   ├── DeviceFormModal.tsx  add / edit device
    │   │   ├── FetchStatusDialog.tsx
    │   │   ├── ReserveDialog.tsx
    │   │   ├── ForceAssignDialog.tsx
    │   │   ├── AddClusterModal.tsx
    │   │   ├── AddModelModal.tsx
    │   │   ├── ExportImportPanel.tsx  admin-only; drag-drop file picker, format/mode selectors, preview, result modal
    │   │   └── OwnershipHistoryModal.tsx
    │   └── pages/
    │       ├── LoginPage.tsx                  /login — user selection; redirects if already logged in
    │       ├── DevicesPage.tsx                /devices — redirects to /login if no session
    │       ├── UsersPage.tsx                  /users — admin-only; redirects non-admin to /devices
    │       ├── ClusterEnterprisesPage.tsx     /cluster-enterprises — admin-only; manage clusters + enterprises
    │       ├── UntrackedDevicesPage.tsx       /untracked-devices — devices in ZedCloud not in inventory
    │       └── ConfirmReservationPage.tsx     /confirm/:token — approve/reject reservation; no auth needed
    ├── package.json
    ├── vite.config.ts       proxy /api → :8000 in dev
    └── .env.example         VITE_API_BASE_URL
```

---

## Decisions Log (all resolved)

| # | Decision | Answer |
|---|---|---|
| 1 | IDRAC creds format | 2 fields: idrac_username (plain) + idrac_password_enc (encrypted) |
| 2 | ZedCloud auth | Bearer token, admin-managed per enterprise per cluster, stored encrypted in Enterprise model |
| 3 | SSH IPs | All IPv4s from uplink interfaces; stored as JSON array; displayed comma-separated |
| 4 | Owner stored as | Email; display name looked up from User table |
| 5 | Reservation notification | Email (if SMTP set) + in-app badge (always) |
| 6 | Reservation expiry | 3 hours |
| 7 | Concurrent reservation requests | One pending per device; others see who has requested |
| 8 | Release + pending | Auto-approve pending requester |
| 9 | Admin force-assign | Bypasses approval; owner notified; pending requester notified if not the assignee |
| 10 | Update permissions | Any user (for device fields); any user with token (for status) |
| 11 | 404 from ZedCloud | Clear eve_version, device_connectivity, status → "Unknown" |
| 12 | 403 from ZedCloud | Re-prompt in dialog; do not update device |
| 13 | Auto-refresh | Device list every 5 min, notifications every 30 sec (defaults); configurable via DEVICE_LIST_REFRESH_MS / NOTIFICATION_REFRESH_MS env vars via GET /api/v1/config/ |
| 14 | Search UX | Single debounced (300ms) text box; Team/Lab/Condition are separate filter selects |
| 15 | Availability filter | Available / Reserved / All chip toggle |
| 16 | Sortable columns | All columns except Purpose; empty values always sort last |
| 17 | Required fields | Name, Serial Number, Model, Lab — Cluster and Name-in-Cluster are optional (only needed for ZedCloud status fetch) |
| 18 | Cluster field | Dropdown (short name); backed by Cluster table in DB |
| 19 | Cluster list management | Only admin users can add or delete clusters via UI; stored in DB |
| 20 | Cluster hostname pattern | `zcloud.<name>.zededa.[net|dev]`; enforced by both backend regex validator and frontend Zod schema; auto-generated on name entry |
| 21 | Release permissions | Owner only — admins cannot release a device they do not own; backend returns 403 if requester ≠ owner |
| 22 | SMTP | Configurable in .env; graceful degradation to in-app only if not set |
| 23 | Email approve/reject links | `/confirm/{token}` React page; buttons fire POST; scanner-safe |
| 24 | Backend framework | Django + DRF; built-in migrations, email, admin, CSRF, SSO readiness |
| 25 | Device model field | Select dropdown + "+" button; "+" opens a standalone Add Model modal (same pattern as Add Cluster); modal fields: model name (required) + customer_partner_name (optional, searchable dropdown of existing names with free-text fallback for new entries) |
| 26 | User email input | Prefix only; "@zededa.com" fixed suffix in UI; stored as full email |
| 28 | Team values | DB-backed Team model; pre-seeded ST/EVE/PLATFORM; add new teams via Django admin; all dropdowns refresh on next page load |
| 27 | Admin-only pages | Users page (`/users`) visible in nav only to Admin users |
| 29 | Device purpose | Any user can write; clearing requires owner or admin; last 10 entries kept; bulk-deleted on ownership transfer |
| 30 | Ownership history | Append-only; never deleted; admin-only via API and UI |
| 31 | Device condition | Enum: normal / out_of_order / needs_repair / temporarily_leased / dedicated / missing; changed via Edit Device modal; values stored as snake_case; displayed as title-case in UI |
| 34 | Table layout | Compact primary row + chevron-expand panel; secondary fields in expand panel |
| 35 | Device list filters | Available/Reserved/All chip + Team/Lab/Condition selects, server-side |
| 36 | Latest purpose in list | Denormalized on Device (last_purpose_text/by/at) to avoid N+1 join |
| 37 | "Available" semantics | owner is null AND condition not in (out_of_order, temporarily_leased, dedicated, missing) |
| 38 | Viewport scope | Desktop-first; internal workstation tool; responsive/mobile layout out of scope |
| 39 | List states | Loading, empty, no-results, load-error, stale — wireframed in states.html |
| 32 | Lab field | DB-backed Lab model; pre-seeded 6 labs; add new labs via Django admin; all dropdowns refresh on next page load; free-text `location_detail` for exact spot inside lab |
| 33 | Condition colors | out_of_order=red, needs_repair=yellow, temporarily_leased=violet, dedicated=blue, missing=orange |
| 40 | Serial verification on status fetch | `minfo.serialNumber` checked first (primary), `hardwareInfo.serialNum` as fallback; mismatch → reject update entirely, show error with device/cluster/expected/actual |
| 41 | Serial absent in response | If ZedCloud returns no serialNum, skip verification silently and proceed with update |
| 42 | device_connectivity | Single JSONField replaces ssh_ips + ssh_macs; one entry per IPv4: [{ip, mac, interface_name}]; shown per entry in expand panel Connectivity group |
| 43 | cluster / cluster_device_name optional | Both fields optional on creation; only required for ZedCloud status fetch; devices without ZedCloud can be tracked without them |
| 44 | lab mandatory | All physical lab devices must have a lab; required on creation; removed from optional fields |
| 45 | dedicated condition | Devices dedicated to a fixed purpose/team; Reserve disabled; Owner column shows team name chip; requires `device.team` to be set; clears owner on set |
| 46 | customer_partner_name on DeviceModel | Optional field on model object; identifies customer or Zededa partner; always visible in the Add/Edit Device form alongside the Model field; searchable from main device search bar via `model__customer_partner_name__icontains` |
| 47 | Export/Import | Admin-only; CSV and JSON format; upsert key is serial_number; excludes encrypted fields and audit history; unknown model/cluster names auto-created on import |
| 48 | Show both device names | Portal name (Name column) and cluster name (dedicated Name in Cluster column) both visible in primary row; not in expand panel |
| 49 | Expand panel layout | 3 card columns: Identity+Placement (left) · ZedCloud Status+Connectivity (middle) · IDRAC+Notes (right); CopyableField label-left/value-right rows with section-header strips; Placement field order: Lab → Location detail; all fields always rendered with "—" fallback |
| 50 | Frontend component source | shadcn/ui components extracted from `zedui-dev` (React 19, Tailwind v4, slate base, CSS variables); no pagination — list kept to single scrollable view (expected max ~200 rows) |
| 51 | DB-level FK integrity | Device.lab → FK(Lab, PROTECT); Device.team → FK(Team, SET_NULL); PortalUser.team → FK(Team, PROTECT); Device.condition → CheckConstraint; owner_email kept as CharField for audit trail (deleted users must still appear in ownership history) |
| 52 | Backend field validation | All write endpoints use DRF serializer validators: SlugRelatedField for lab/team (accept/return name strings, reject unknowns at DB level); NullableSlugRelatedField for nullable team (converts "" to None); field validators for name, idrac_ip, email_prefix, user_type, cluster host regex |
| 53 | Frontend Zod validation | Two-layer validation: backend (security boundary, fires on submit) + frontend Zod (UX, real-time); idrac_ip validated as IPv4/IPv6; cluster host validated against zcloud pattern; user_type restricted to admin\|member |
| 54 | Export format param | Query param renamed from `?format=` to `?fmt=` to avoid DRF content-negotiation intercepting the request and returning 404 |
| 55 | Export filename | `holocron_device_inventory_{YYYYMMDD_HHMMSS}.{ext}`; post-download toast informs user that full inventory was exported regardless of current filters |
| 56 | Available label in Owner column | Available devices show a plain green "Available" text in the Owner column (no pill/badge) above the Reserve button; replaces the empty owner slot |
| 57 | Reserve button unified | Single Reserve button definition for both direct-reserve and request-reserve flows (blue outline style); backend decides whether to transfer immediately or create a pending request based on device state |
| 58 | Guest user type | Third user_type value (`guest`) added alongside admin and member; guests can view the device table and expand panels only; all write operations hidden in UI and rejected 403 by backend; Users page inaccessible; Actions column not rendered for guests |