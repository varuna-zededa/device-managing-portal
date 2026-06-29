# Device Managing Portal — Design Document

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
| Frontend | React (Vite) + Tailwind CSS | Rich interactive UI; SSO SDK support |
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
```
id      int   PK auto
name    str   unique short name, e.g. "hummingbird", "prod"
host    str   ZedCloud hostname, e.g. "zedcontrol.hummingbird.zededa.net"
```
**Pre-seeded entries:**
| name | host |
|---|---|
| hummingbird | zedcontrol.hummingbird.zededa.net |
| alpha | zedcontrol.alpha.zededa.net |
| canary | zedcontrol.canary.zededa.net |
| gmwtus | zedcontrol.gmwtus.zededa.net |
| thor | zedcontrol.thor.zededa.net |
| prod | zedcontrol.zededa.net |

Any user can add a new cluster. The dropdown in all forms is populated from this table.

### DeviceModel
```
id      int   PK auto
name    str   unique model name, e.g. "OptiPlex 7040", "PowerEdge R740"
```
Any user can add a new model. The Model dropdown in the device form is populated from this table. No
pre-seeded entries — team populates as they go.

### Device
```
id                   int    PK auto
name                 str    display name in portal
serial_number        str    unique NOT NULL; hardware serial (primary identifier for physical device); duplicate → 400
description          str    nullable; free text — device capabilities, hardware notes, intended use
cluster_device_name  str    name used in ZedCloud API path
model                FK     → DeviceModel.id
cluster_id           int    FK → Cluster.id
team                 str    nullable; set on reserve
owner_email          str    nullable; FK → User.email; set on reserve
lab                  enum   nullable; Bangalore Lab | Bangalore Office Space | Berlin Lab | SanJose Lab | CoreSite Lab | Home Lab
location_detail      str    nullable; free text — exact spot inside lab (e.g. "Rack-B3, slot 4", "Near the printer")
condition            enum   default 'normal' (NOT NULL); normal | out_of_order | needs_repair | temporarily_leased
idrac_ip             str    nullable
idrac_username       str    nullable
idrac_password_enc   bytes  nullable; AES-encrypted
eve_version          str    nullable; "Unknown" after 404
ssh_ips              json   nullable; JSONField — list ["192.168.0.121", "10.244.244.1"]; "Unknown" after 404
status               str    nullable; "Unknown" after 404
last_comment_text    str    nullable; denormalized cache of newest DeviceComment (for list view — avoids N+1)
last_comment_by      str    nullable; author name of newest comment
last_comment_at      datetime nullable
created_at           datetime
updated_at           datetime
```

**Derived (not stored):** `is_available = (owner_email IS NULL) AND condition NOT IN (out_of_order,
temporarily_leased)`. Used by both the Available/Reserved filter and the status badge — a device
with a blocking condition is **never** "Available" even though it has no owner.

**Required on creation:** name, serial_number, model, cluster_id, cluster_device_name
**Optional on creation:** description, team, owner_email, lab, location_detail, idrac_ip,
idrac_username, idrac_password

### User
```
id          int   PK auto
name        str
email       str   unique — identity anchor
team        enum  ST | EVE | PLATFORM
user_type   enum  admin | team_member
```

### Vault  *(per-user ZedCloud bearer tokens)*
```
id               int   PK auto
user_email       str   FK → User.email
cluster_id       int   FK → Cluster.id
bearer_token_enc bytes AES-encrypted ZedCloud API bearer token
```
**Constraint:** `unique_together = (user_email, cluster_id)`. (Django <5.2 has no native composite
PK, so use a surrogate `id` + uniqueness constraint rather than a true composite key.)

### ReservationRequest
```
id               int      PK auto
device_id        int      FK → Device.id
requester_email  str      FK → User.email
requested_at     datetime
expires_at       datetime requested_at + 3 hours
status           enum     pending | approved | rejected | expired
token            str      unique random 32-byte hex token (for email approve/reject links)
```
**Constraint:** at most one `status=pending` request per device at a time.

### DeviceComment
```
id            int      PK auto
device_id     int      FK → Device.id
author_email  str      FK → User.email — who set the comment
text          str      the purpose/comment text
created_at    datetime
```
- Stores the last **10** comments per device (oldest pruned automatically on write)
- Cleared entirely when ownership changes (reserve, release, force-assign, auto-approve)
- Any logged-in user can add a comment, not just the owner
- On write/clear, also update the denormalized `Device.last_comment_*` cache fields so the device
  list (which shows the newest comment per row) needs no per-row join

### OwnershipHistory
```
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
```
GET  /api/clusters          list all (for dropdown)
POST /api/clusters          any user; body: {name, host}
                            host auto-suggested as zedcontrol.{name}.zededa.net if omitted
```

### Models
```
GET  /api/models            list all (for dropdown)
POST /api/models            any user; body: {name}
                            duplicate name rejected with clear error
```

### Devices
```
GET    /api/devices          ?q=<search>&available=<true|false|all>
                            &team=<ST|EVE|PLATFORM>&lab=<lab name>
                            &condition=<normal|out_of_order|needs_repair|temporarily_leased>
                            q matches: name, model, cluster, owner name, eve_version, comment text
                            team / lab / condition are exact-match filter selects (combinable)
POST   /api/devices          add; body: DeviceCreate; duplicate serial_number → 400 "Serial number already exists"
PUT    /api/devices/{id}     update name, description, cluster_id, cluster_device_name, idrac fields, team
                              serial_number is immutable after creation
DELETE /api/devices/{id}     admin only (X-User-Email header)
POST   /api/devices/{id}/reserve          no body — requester identified via X-User-Email header
POST   /api/devices/{id}/force-assign     admin only; body: {assignee_email}
POST   /api/devices/{id}/release          owner or admin only (X-User-Email header)
POST   /api/devices/{id}/status           body: {bearer_token}
                                          uses Device.cluster_id + cluster_device_name
                                          saves bearer_token to Vault, calls ZedCloud, updates device
```

### Device Comments
```
GET  /api/devices/{id}/comments          list last 10 comments, newest first; any logged-in user
POST /api/devices/{id}/comments          body: {text}; author from X-User-Email
                                          auto-prunes to 10 entries after insert
```

### Device Ownership History
```
GET  /api/devices/{id}/ownership-history   admin only (X-User-Email header); full history, newest first
```

### Users
```
GET  /api/users        list all (for dropdowns, search)
POST /api/users        admin only; body: {name, email_prefix, team, user_type}
                       email stored as {email_prefix}@zededa.com — frontend sends prefix only
```

### Vault
```
GET  /api/vault/{cluster_id}    Header X-User-Email → {has_token: bool}
```
(Vault write happens via `POST /api/devices/{id}/status` — no separate upsert endpoint needed)

### Reservation Requests
```
GET  /api/reservations/pending              Header X-User-Email → requests where owner = current user
GET  /api/reservations/mine                 Header X-User-Email → requests made by current user
GET  /api/reservations/{token}              no auth — returns {device_name, requester_name, expires_at, status}
                                            used by the confirmation page to display context
POST /api/reservations/{token}/approve      no auth — token IS the auth; executes approval
POST /api/reservations/{token}/reject       no auth — token IS the auth; executes rejection
```

**Email link flow:**
- Email contains a **single link**: `http://<server>/confirm/{token}`
- That's a React frontend route — the page calls `GET /api/reservations/{token}` to fetch context,
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
Bearer token — personal, per user per cluster, stored in Vault.

```http
GET https://{cluster.host}/api/v1/devices/name/{cluster_device_name}/status/info
Authorization: Bearer {token}
```

### Fetch Status Dialog (fields)
| Field | Pre-fill |
|---|---|
| Cluster | Device.cluster dropdown; editable — switching cluster updates the device record |
| Name in Cluster | Device.cluster_device_name (editable — user can correct before fetching) |
| Bearer Token | Masked (●●●●) if Vault has one; blank otherwise |

### Response Parsing
```python
# EVE version: active partition
eve_version = next(
    (sw["shortVersion"] for sw in data.get("swInfo", []) if sw.get("activated")),
    None
)

# SSH IPs: all IPv4s from up+uplink interfaces
ssh_ips = []
for net in data.get("netStatusList", []):
    if net.get("up") and net.get("uplink"):
        for ip in net.get("ipAddrs", []):
            if ":" not in ip:    # IPv4 only; include all, let user decide which to SSH to
                ssh_ips.append(ip)

# Status
STATUS_MAP = {
    "RUN_STATE_ONLINE":    "Online",
    "RUN_STATE_OFFLINE":   "Offline",
    "RUN_STATE_HALTING":   "Halting",
    "RUN_STATE_SUSPENDED": "Suspended",
    "RUN_STATE_UNKNOWN":   "Unknown",
}
status = STATUS_MAP.get(data.get("runState", ""), data.get("runState"))
```

### Error Handling
| HTTP | Backend | Frontend |
|---|---|---|
| **200** | Update device row (eve_version, ssh_ips, status) | Dialog closes; table row refreshes |
| **403** | Do NOT update Vault | Dialog stays open; error: *"Bearer token invalid or expired"* |
| **404** | Set all live fields → `"Unknown"` | Dialog closes; toast: *"{device} not found on {cluster}."* |
| **Other** | No device update | Dialog stays open; show HTTP status + body excerpt |

---

## Identity & Auth

### Login Flow

**Login page (`/login`):**
- Fetches user list from `GET /api/users` (no auth required — public endpoint)
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
- Endpoints that require no identity: `GET /api/users` (login page), `GET
  /api/reservations/{token}`, `POST /api/reservations/{token}/approve`, `POST
  /api/reservations/{token}/reject` (token IS the auth)
- Reserve specifically: `POST /api/devices/{id}/reserve` sends no body — requester is derived
  entirely from `X-User-Email`; no user picker in the UI

**Route protection (frontend):**
- `UserContext` checks `localStorage` on mount; if empty → redirect to `/login`
- Admin-only nav links (e.g. Users page) hidden for non-admin users; direct URL access returns a
  403-style message

**SSO upgrade path:**
- Gateway/proxy injects a verified `X-User-Email` header from JWT claim and strips the client-
  supplied one
- Django middleware intercepts the request, reads the verified header, calls `get_current_user()`
- Login page replaced by SSO redirect — no schema or API changes needed
- `django-allauth` or `python-social-auth` handles SAML/OIDC — both are well-documented for Django

---

## Reservation Approval Flow

```
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
  → Clear all DeviceComment rows for that device on any transfer of ownership
```

### Notifications

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
```
SMTP_HOST=         # if blank, email disabled silently; in-app only
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=device-portal@zededa.com
```
Admin UI shows a yellow warning banner if SMTP is not configured.

---

## Device Table UI

> **Viewport scope:** Desktop-first, intentionally. This is an internal lab tool used from
> workstations; the table horizontal-scrolls below ~`md`. Responsive/mobile layout is
> explicitly out of scope.

### Search & Filter
- **Single search box** — debounced 300ms — matches against: Name, Model, Cluster name, Owner
  (name), EVE-version, **last comment text** (case-insensitive partial match)
- **Available / Reserved / All** — chip toggle (uses the derived `is_available` rule, so blocking-
  condition devices never count as Available)
- **Team / Lab / Condition** — three exact-match filter selects beside the chip toggle; combinable
  with the search box and each other
- When the search text matches a field that lives in the collapsed detail (Model, EVE Version, SSH
  IP), the matching row **auto-expands** so the hit is visible

### Layout — collapsible rows
The table shows a compact primary row per device; a **chevron** in the first column expands an
inline detail panel below it. This keeps the common case scannable while still surfacing the full
record on demand.

**Primary row columns (left → right):**
| Column | Notes |
|---|---|
| (chevron) | Expand / collapse toggle |
| Name | Sortable; condition badge shown when condition ≠ normal |
| Serial No | Hardware serial number (monospace); unique; immutable after creation |
| Cluster | Short name badge; sortable |
| Owner | Avatar + name; Reserve / Release per role; ⏱ pending notice; "UNAVAILABLE" for blocking conditions |
| Status | Color badge (Online=green, Offline=red, Unknown/blank=gray) + **"Refresh"** link below |
| Comment / Purpose | Newest comment (2-line truncated) from denormalized cache; "—" if none |
| Actions | 3-dot dropdown only — contents vary by role (see below) |

**Expanded detail panel (3 columns):**
| Group | Fields |
|---|---|
| Info | Model · Team · Lab · Location Detail · EVE Version |
| Connectivity | SSH IPs · IDRAC (Console ↗ link + Show credentials) |
| Description | Free-text device capabilities / hardware notes; "—" if empty |

Condition is **not** shown in the expand panel — it is communicated by the row's left-border color
and the inline badge in the Name column. To change condition: open Edit Device modal.

The Comment / Purpose column in the main row already surfaces the newest comment — no separate
comment bar in the expand panel.

**Sortable columns:** Name, Cluster, Owner. (Serial No, Model, Team, EVE Version are not sortable
column headers — Serial No is display-only in the row; Model/Team/EVE are in the expand panel.)

### List states (wireframed in `states.html`)
| State | Behavior |
|---|---|
| Loading | Shimmer skeleton rows + "Loading devices…" footer; replaces table body only |
| Empty | Centered "No devices yet" + primary **Add Device** CTA |
| No results | "No devices match your filters" + **Clear search & filters**; filter bar stays visible |
| Load error | Centered error card; reassures data is safe; **Retry** button |
| Stale | Keep last-known rows (dimmed); "Couldn't refresh — data from {n} min ago" + **Retry now** |

### Owner Column — Reserve / Release Rules
| Scenario | Member sees | Admin sees |
|---|---|---|
| Device owned by logged-in user | Release | Release + Reserve |
| Device owned by someone else | Reserve | Release + Reserve |
| Device available (no owner) | Blue "Reserve" button | Blue "Reserve" button |

### Actions Column (3-dot menu)
| Scenario | Member sees | Admin sees |
|---|---|---|
| Own device | Edit | Edit, Delete |
| Someone else's device | Edit | Edit, Force Assign, Delete |
| Available device | Edit | Edit, Delete |
| Someone else's device with pending request | Edit | Edit, Force Assign, Delete |

### Force Assign Dialog
- Pre-selects the pending requester (if one exists) with a visible "has a pending request" label
- Admin can override the selection to assign to anyone else
- Emails sent on submit:
  - Owner always notified: "Admin reassigned your device to {assignee}"
  - If assignee ≠ requester: requester notified "Your request was overridden by an admin"
  - If assignee = requester: treated as approval; requester gets normal approval email

---

## Device Condition Flags

Any logged-in user can set or clear the condition via the **inline pill selector** in the table's
expanded detail row (Condition group). It is no longer part of the Edit Device dialog.

| Condition | Row highlight | Owner field | Reserve | Release | Email alert |
|---|---|---|---|---|---|
| `out_of_order` | Red row + red left border | **UNAVAILABLE** | Disabled | Hidden | Yes — all admins |
| `needs_repair` | Yellow row + yellow left border | Unchanged | Normal | Normal | No |
| `temporarily_leased` | Violet row + violet left border | **UNAVAILABLE** | Disabled | Hidden | No |
| *(cleared / normal)* | No highlight | Stays null — new reservation needed | Normal | Normal | No |

**UI color tokens (Tailwind):**

| Condition | Row bg | Left border | Badge |
|---|---|---|---|
| out_of_order | `bg-red-50` | `border-l-red-500` | `bg-red-100 text-red-700` |
| needs_repair | `bg-yellow-50` | `border-l-yellow-400` | `bg-yellow-100 text-yellow-800` |
| temporarily_leased | `bg-violet-50` | `border-l-violet-400` | `bg-violet-100 text-violet-700` |

**Out of Order — admin email content:**
- To: all users with `user_type = admin`
- Subject: `[Device Portal] Device out of order: {device.name}`
- Body includes: name, lab + location detail, model, IDRAC IP, cluster, EVE version (if known)
- Does **not** include: owner history, comments

**Condition rules:**
- Setting `out_of_order` or `temporarily_leased` → set `owner_email = null`; append OwnershipHistory
  (`reason = condition_change`); expire any pending ReservationRequest
- Clearing any condition → device becomes available (owner stays null; reserve normally)
- `needs_repair` → no change to owner or reservations
- Any user can set or clear the condition field

---

## Device Comments (Purpose / Usage)

- Any logged-in user can set the purpose/comment on any device at any time
- Editable via the **Edit Device** dialog — a textarea with a "Save" button and a collapsible
  history panel below it
- On save: new `DeviceComment` row inserted; oldest row pruned if count exceeds 10
- History shows: comment text + author name + timestamp, newest first
- **On any ownership change** (reserve, release, force-assign, auto-approve): all comments for the
  device are deleted — the slate is cleared for the new owner

---

## Ownership History (Admin)

- Every ownership change appends a row to `OwnershipHistory` — never edited or deleted
- Fields recorded: new owner (null = released), who triggered it, timestamp, reason
- Accessible via **"Ownership History"** option in the 3-dot Actions menu (admin view only)
- Displayed in a modal: timeline list with owner avatar + name (or "Available"), triggered-by,
  reason badge, and timestamp

---

## Add Cluster Flow
- Any user can open "Add Cluster" (button in the cluster dropdown or a Clusters page)
- Fields: **Name** + **Hostname** (auto-suggested as `zedcontrol.{name}.zededa.net` when name is
  typed; prod → `zedcontrol.zededa.net`)
- On submit → `POST /api/clusters` → dropdown in all forms immediately includes new cluster
- Duplicate name rejected with a clear error

---

## Encryption
- **Key:** `ENCRYPTION_KEY` env var — base64 Fernet key generated once at deploy
- **Encrypted fields:** `Device.idrac_password_enc`, `Vault.bearer_token_enc`
- `Device.idrac_username` is stored plaintext (not a credential by itself)
- Encrypted blobs never exposed in API responses

---

## Auto-Refresh
- Device table polls `GET /api/devices` every **15 minutes** while the browser tab is active
- Uses `setInterval` with a visibility check (`document.visibilityState === 'visible'`) — pauses
  when tab is hidden

---

## Deployment

### Docker (recommended)

Two containers managed by Docker Compose — one command to start everything:

```bash
cp .env.example .env   # fill in SECRET_KEY, ENCRYPTION_KEY, SMTP settings
docker compose up -d
```

```
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

```
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
│   │   ├── vault/
│   │   │   ├── models.py        Vault model
│   │   │   ├── serializers.py
│   │   │   ├── views.py
│   │   │   └── urls.py
│   │   └── reservations/
│   │       ├── models.py        ReservationRequest model
│   │       ├── serializers.py
│   │       ├── views.py         + confirm page endpoint
│   │       └── urls.py
│   ├── services/
│   │   └── zedcloud.py          sync httpx call + response parsing
│   ├── utils/
│   │   ├── crypto.py            Fernet encrypt() / decrypt()
│   │   ├── email.py             django.core.mail wrapper; no-op if EMAIL_HOST unset
│   │   └── permissions.py       IsAdminPortalUser, IsOwnerOrAdmin DRF permission classes
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── main.jsx
    │   ├── App.jsx
    │   ├── api/
    │   │   └── client.js        axios instance; auto-sends X-User-Email header
    │   ├── context/
    │   │   └── UserContext.jsx  current user in localStorage; provides useUser()
    │   ├── components/
    │   │   ├── Header.jsx           user dropdown + notification bell
    │   │   ├── NotificationPanel.jsx  pending reservations for current user
    │   │   ├── DeviceTable.jsx      sortable table, auto-refresh, pending indicator
    │   │   ├── SearchBar.jsx        single debounced input + Available/Reserved chip
    │   │   ├── DeviceFormModal.jsx  add / edit device
    │   │   ├── FetchStatusDialog.jsx
    │   │   ├── ReserveDialog.jsx
    │   │   ├── ForceAssignDialog.jsx
    │   │   ├── AddClusterForm.jsx
    │   │   └── UserManager.jsx      admin-only
    │   └── pages/
    │       ├── LoginPage.jsx              /login — user selection; redirects if already logged in
    │       ├── DevicesPage.jsx            / — redirects to /login if no session
    │       ├── UsersPage.jsx              /users — admin-only; redirects non-admin to /devices
    │       └── ConfirmReservationPage.jsx  /confirm/:token — approve/reject reservation; no auth needed
    ├── package.json
    ├── vite.config.js       proxy /api → :8000 in dev
    └── .env.example         VITE_API_BASE_URL
```

---

## Decisions Log (all resolved)

| # | Decision | Answer |
|---|---|---|
| 1 | IDRAC creds format | 2 fields: idrac_username (plain) + idrac_password_enc (encrypted) |
| 2 | ZedCloud auth | Bearer token, personal per user per cluster, stored in Vault |
| 3 | SSH IPs | All IPv4s from uplink interfaces; stored as JSON array; displayed comma-separated |
| 4 | Owner stored as | Email; display name looked up from User table |
| 5 | Reservation notification | Email (if SMTP set) + in-app badge (always) |
| 6 | Reservation expiry | 3 hours |
| 7 | Concurrent reservation requests | One pending per device; others see who has requested |
| 8 | Release + pending | Auto-approve pending requester |
| 9 | Admin force-assign | Bypasses approval; owner notified; pending requester notified if not the assignee |
| 10 | Update permissions | Any user (for device fields); any user with token (for status) |
| 11 | 404 from ZedCloud | Clear eve_version, ssh_ips, status, cluster_device_name → "Unknown" |
| 12 | 403 from ZedCloud | Re-prompt in dialog; do not update Vault |
| 13 | Auto-refresh | Every 15 minutes; pauses when tab is hidden |
| 14 | Search UX | Single debounced (300ms) text box; Team/Lab/Condition are separate filter selects |
| 15 | Availability filter | Available / Reserved / All chip toggle |
| 16 | Sortable columns | Name, Cluster, Owner (Model/Team/EVE moved into the expand panel) |
| 17 | Required fields | Name, Model, Cluster, Name-in-Cluster |
| 18 | Cluster field | Dropdown (short name); backed by Cluster table in DB |
| 19 | Cluster list management | Any user can add new cluster via UI; stored in DB |
| 20 | Cluster hostname pattern | `zedcontrol.{name}.zededa.net`; prod is `zedcontrol.zededa.net` |
| 21 | Release permissions | Owner or admin only |
| 22 | SMTP | Configurable in .env; graceful degradation to in-app only if not set |
| 23 | Email approve/reject links | `/confirm/{token}` React page; buttons fire POST; scanner-safe |
| 24 | Backend framework | Django + DRF; built-in migrations, email, admin, CSRF, SSO readiness |
| 25 | Device model field | Filterable combobox; inline "Create" if no match — no separate dialog |
| 26 | User email input | Prefix only; "@zededa.com" fixed suffix in UI; stored as full email |
| 28 | Team values | Fixed enum: ST, EVE, PLATFORM — rendered as a select dropdown, not free text |
| 27 | Admin-only pages | Users page (`/users`) visible in nav only to Admin users |
| 29 | Device comments | Any user can write; last 10 kept; cleared on ownership transfer |
| 30 | Ownership history | Append-only; never deleted; admin-only via API and UI |
| 31 | Device condition | Enum: normal / out_of_order / needs_repair / temporarily_leased; Edit modal |
| 34 | Table layout | Compact primary row + chevron-expand panel; secondary fields in expand panel |
| 35 | Device list filters | Available/Reserved/All chip + Team/Lab/Condition selects, server-side |
| 36 | Latest comment in list | Denormalized on Device (last_comment_text/by/at) to avoid N+1 join |
| 37 | "Available" semantics | owner is null AND condition not in (out_of_order, temporarily_leased) |
| 38 | Viewport scope | Desktop-first; internal workstation tool; responsive/mobile layout out of scope |
| 39 | List states | Loading, empty, no-results, load-error, stale — wireframed in states.html |
| 32 | Lab field | Fixed enum of 6 labs; free-text `location_detail` for exact spot inside lab |
| 33 | Condition colors | out_of_order=red, needs_repair=yellow, temporarily_leased=violet |