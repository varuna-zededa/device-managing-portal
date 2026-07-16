# Device Managing Portal — Implementation Plan

Full product spec: see [DESIGN.md](DESIGN.md)
Repo: https://github.com/varuna-zededa/device-managing-portal

---

## Current Status

> **Status: Actively developed. v1 (MVP) and v2 (enterprise sync / auto device sync) shipped.**

---

## Development Cycle

Each version follows the same 5-step cycle before shipping:

1. **Wireframes** — static HTML mockups covering all new UI surfaces for the version
2. **Backend implementation details** — finalize API design, data model changes, and any new
   infrastructure decisions; update DESIGN.md
3. **Frontend + Integration** — build frontend components and wire up backend integration
4. **Team feedback + Update based on feedback** — share with team; collect input; incorporate into wireframes and DESIGN.md
5. **Deploy and test** — backend + frontend + Docker + seed data; deploy and validate end-to-end

---

## Version 1 — MVP

**Scope:** Everything currently wireframed.

- Device table with search, filters, sort — member + admin views
- Add / Edit / Delete devices; Add Cluster; Add Model (with customer/partner name)
- Reserve → approval-email flow → Release; Force Assign (admin)
- ZedCloud status fetch: EVE version, connectivity (IP + MAC + interface), run state
- Serial number verification on status fetch; silent skip if ZedCloud returns no serial
- `device_connectivity` JSONField — one entry per IPv4 on any up+uplink interface
- Name in Cluster as dedicated table column; cluster + cluster_device_name optional
- Device conditions: `admin_condition` (`normal · out_of_order · temporarily_leased · dedicated`) and `sync_condition` (`missing · needs_recovery`); badge labels shown in title case; values stored as snake_case
- Summary bar below "Devices" heading: total · available · reserved · online · out of order · leased · missing · needs recovery; non-zero counts only for problem states; reflects active filters; hidden during load
- Lab and Team backed by DB models (Lab, Team); add via Django admin; all dropdowns refresh on next page load — no code changes needed to add new labs or teams
- All device table columns sortable (except Comment); empty values sort last; Users page columns also sortable
- `dedicated` condition: team name chip in Owner column; Reserve disabled; blue row
- Device comments / purpose; ownership history (admin)
- Notifications: in-app bell (always) + email via SMTP (if configured)
- Search by customer/partner name; condition filter includes `dedicated`
- Export / Import CSV & JSON (admin); upsert by serial number; drag-drop UI with preview
- User management page (admin): list, add, edit (name/team/role)
- All 5 table states: loading, empty, no-results, load-error, stale

**Cycle:**
- [x] Wireframes — see `wireframes/` (index, admin_index, modals, states, confirm, users)
- [x] Backend implementation details
- [ ] Frontend + Integration
- [ ] Team feedback + Update based on feedback
- [ ] Deploy and test

**Implementation tasks:**
- [ ] Backend — Django + DRF: models, migrations, API endpoints, ZedCloud status fetch,
  serial verification, Fernet encryption, `django.core.mail` email, reservation approval flow,
  ownership history, export/import endpoints
- [ ] Frontend — React 19 + Vite + Tailwind v4 (slate base, CSS variables): extract and adapt
  shadcn/ui components from `~/git/zededa-services/zedui-dev`:
  - Table layer: `data-table`, `resizable-table`, `truncated-cell`, `table-row-icon`
  - Modals / dialogs: `dialog`, `confirm-delete-dialog`, `confirm-action-dialog`, `sheet`
  - Forms: `form`, `input`, `select`, `searchable-select`, `async-select`, `checkbox`,
    `textarea`, `radio-group`
  - Actions: `FloatingAddButton`, `FloatingImportButton`, `BulkActionBar`
  - Search: `GlobalSearch`
  - Feedback: `interactive-empty-state` (covers all 5 table states), `toast`, `toaster`,
    `sonner`, `skeleton`, `progress`
  - Display: `badge` (condition + team chips), `copyable-field` (serial / IDRAC IP),
    `key-value-tag` (connectivity entries), `tags-display`
  - Build remaining pages as per wireframes; axios client with `X-User-Email` header;
    `UserContext` + Zustand for global state; localStorage session; auto-refresh
- [ ] Docker setup — `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`,
  `nginx.conf`, `entrypoint.sh` (migrate + seed + gunicorn)
- [ ] Seed data — `clusters_seed.json` for the 6 pre-seeded clusters

---

## Version 2 — Operational Depth + Partial NLP Search

> **Note:** The shipped v2 was the enterprise sync / auto device sync feature (enterprise credentials, hourly background sync, untracked devices page, admin notifications). The scope described below is the **next planned version**, not what shipped as v2.

**Scope:**

- **Backend test suite** — Django test client covering critical paths: device CRUD, reservation
  flow (reserve, approve, reject, expire, force-assign), auth/permission enforcement, and
  ZedCloud status fetch; run automatically in GitHub Actions before the version bump on every PR
- **Guest user type** — read-only access to the device index only; can see the full device table
  and expand panels but cannot reserve, release, edit, delete, fetch status, force-assign, or
  export; all action controls hidden in the UI; write endpoints reject guests with 403
- **OpenAPI + Swagger** — auto-generate OpenAPI 3.0 spec from DRF views using `drf-spectacular`;
  serve interactive Swagger UI at `/api/docs/`; serves as the authoritative API contract and
  prerequisite for a future MCP server
- **Bulk actions** (admin) — release or force-assign multiple devices at once from the table
- **Device tags** — free-form labels for ad-hoc grouping beyond the fixed Team/Lab enums
- **Device edit history** — field-level audit log for all device record changes; useful for
  tracing accidental edits to `cluster_device_name` or IDRAC IP (admin-only)
- **Partial NLP search** — natural-language query parsing over fields available in v1; fully
  local, no external API, no ML model loaded at startup
  - Stack: **pure Python tokenizer + rapidfuzz** (fuzzy match against known entity lists);
    no spaCy dependency in v2 — all entities come from closed known lists
  - Entities covered: lab, team, cluster, condition, availability, customer/partner name
  - Example: "available device in Berlin for ST" → `{ lab: Berlin Lab, team: ST, is_available: true }`
  - UI: search bar shows "interpreted as: …" chips below; each chip removable
  - Falls back to existing keyword search if no entities are matched
- **Untracked device filter feedback** *(lower priority)* — admin-driven Layer 3 on top of the
  existing serial/model filters (Layer 1: virtual manufacturer blocklist; Layer 2: serial
  structural heuristics + placeholder blocklist). Admin clicks "Flag" on any untracked device row
  to mark it as either **invalid serial** or **virtual device model**; flags persist in the DB and
  are applied automatically on every subsequent sync, keeping the filters self-improving without
  code changes.
  - New `UntrackedDeviceFlag` model: `(serial_number | model_keyword)`, `flag_type` (`invalid_serial` |
    `virtual_model`), `flagged_by`, `flagged_at`, `note` (optional free-text reason)
  - Sync reads active flags at startup and merges them into the in-memory filter sets used by
    `_is_junk_serial()` and `_is_virtual_device()`; no restart required
  - UI: flag icon on each Untracked Devices row (admin only); flag dialog lets admin choose type
    and optionally add a note; flagged rows are purged immediately on submit
  - Admin management view to review, edit, and remove flags

**Cycle:**
- [ ] Wireframes
- [ ] Backend implementation details
- [ ] Frontend + Integration
- [ ] Team feedback + Update based on feedback
- [ ] Deploy and test

**Implementation tasks:**
- Note: `BulkActionBar`, `GlobalSearch`, and `tags-display` are already extracted in v1 —
  wire up admin action handlers and NLP layer; no re-extraction needed

---

## Version 3 — Auth + Admin Config

**Scope:**

- **SSO / LDAP login** — replace user-picker dropdown with real authentication; drop-in via
  `django-allauth` (SAML/OIDC); no schema or API changes needed; codebase is already structured
  for this
- **SMTP setup wizard** — admin UI to configure and test outgoing email settings without touching
  `.env`; settings stored encrypted in the database; includes test-send from the UI

**Cycle:**
- [ ] Wireframes
- [ ] Backend implementation details
- [ ] Frontend + Integration
- [ ] Team feedback + Update based on feedback
- [ ] Deploy and test

> **Note:** Initiate SSO IdP setup with IT/infra during v2 development — client credentials and
> SAML/OIDC config from the identity provider are needed before v3 can ship. Starting late causes
> a wait gap between v2 and v3.

**Implementation tasks:**

---

## Version 4 — Hardware Intelligence + NLP Extended

**Scope:**

- **Device capabilities** — structured hardware specs (CPU, RAM, GPU, NIC count, port speeds);
  entered manually or auto-fetched from ZedCloud/IPMI; prerequisite for capability-based NLP
- **NLP search extended** — builds on the v2 rapidfuzz foundation; adds three new layers:
  - **Quantulum3** — quantity + unit extraction for numeric capability constraints
    ("more than 32GB RAM", "at least 4 NICs", "10G uplink"); purpose-built for physical specs
  - **spaCy** — sentence-level dependency parsing for complex constraint structure
    (introduced in v4; not needed in v2)
  - **sentence-transformers** (`all-MiniLM-L6-v2`, ~80MB) + **ChromaDB** (local vector DB) —
    semantic similarity search over device description field; ChromaDB chosen over FAISS for
    simpler operation at lab-inventory scale

**Cycle:**
- [ ] Wireframes
- [ ] Backend implementation details
- [ ] Frontend + Integration
- [ ] Team feedback + Update based on feedback
- [ ] Deploy and test

**Implementation tasks:**

---

## Version 5 — Platform Expansion

**Scope:**

- **Infra equipment management** — new section alongside Devices to track lab infrastructure:
  switches, routers, console servers, PDUs; same ownership/location/condition model; no ZedCloud
  integration
- **Mobile / responsive layout** — read-only mobile view for quick status checks on the go
- **Dark mode** — near-direct extract from zedui-dev: `theme-toggle.tsx` + `next-themes`
  `ThemeProvider` already exist and are wired; Tailwind v4 CSS variables already carry `dark:`
  support; work is an audit of `dark:` classes on extracted components + `ThemeProvider` wrapper,
  not a build from scratch
- **MCP server** *(on popular request only)* — expose portal operations (list devices, reserve,
  release, fetch status) as Claude Code MCP tools; built on the V2 OpenAPI spec and V3 SSO auth;
  only pursued if the team actively requests it after adopting the portal

**Cycle:**
- [ ] Wireframes
- [ ] Backend implementation details
- [ ] Frontend + Integration
- [ ] Team feedback + Update based on feedback
- [ ] Deploy and test

**Implementation tasks:**

---

## v1 Design Additions (incorporated into DESIGN.md and wireframes)

- **Serial number verification on status refresh** — `minfo.serialNumber` (primary) or
  `hardwareInfo.serialNum` (fallback) compared to `Device.serial_number`; mismatch → reject update,
  surface error with device name, cluster name, expected serial, actual serial; absent serial → skip silently
- **`device_connectivity` field** — replaces separate ssh_ips/ssh_macs; JSONField
  `[{ip, mac, interface_name}]` — one entry per IPv4; shown as `interface · mac · ip` in expand panel
- **Name in Cluster column** — `cluster_device_name` shown as a dedicated column in the primary
  table row; cluster and cluster_device_name both optional (only needed for ZedCloud status fetch)
- **Mandatory/optional field changes** — `lab` required on creation; `cluster_id` and
  `cluster_device_name` optional
- **`dedicated` condition** — Reserve disabled; Owner column shows team name chip; blue row
  highlight; requires `device.team` to be set
- **`customer_partner_name` on DeviceModel** — optional field; searchable from main device search
  bar via `model__customer_partner_name__icontains`; Add Model modal pre-seeds dropdown with
  known names: BOBST · SLB · OnLogic · Emmerson · Shell · Toyota
- **Export / Import (admin only)** — `GET /api/admin/export?format=csv|json` downloads full device
  snapshot; `POST /api/admin/import` upserts by serial_number with `create_only` or
  `update_or_create` mode; frontend drag-drop picker with 5-row preview and result summary modal;
  `GET /api/admin/import-template/` serves a ready-to-fill CSV template
- **Import forgiving parsing** — column headers normalised (strip/lowercase/underscore + alias map);
  `admin_condition` field value normalised to snake_case on import (e.g. "Out Of Order" → `out_of_order`); `sync_condition` is never read from CSV
