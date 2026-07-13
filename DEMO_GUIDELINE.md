# Demo Setup & Transition Guide

This document covers how to set up Holocron with demo data for a presentation or trial
deployment, and how to cleanly transition to a production setup when the system gets
approved for company-wide use.

---

## Demo Setup

### What is the demo fixture?

`backend/fixtures/demo_fixture.json` is a snapshot of the database exported from the
initial working deployment. It contains:

- Portal users (admins and members)
- Labs and teams
- Device models and clusters
- Devices with ownership, condition, and connectivity data
- Admin-managed enterprise bearer tokens (encrypted — see note below)

### Deploying on a new VM

**Prerequisites:** Docker and Docker Compose installed on the VM.

**Step 1 — Clone the repo and create `.env`**

```bash
git clone <repo-url>
cd device-managing-portal
cp .env.example .env
# Edit .env — fill in all required values (see below)
```

**Step 2 — Set demo flag in `.env`**

```bash
LOAD_DEMO_DATA=true
```

This tells the backend container to load `demo_fixture.json` on first boot.

**Step 3 — Build and start**

```bash
docker compose build
docker compose up -d
```

The backend entrypoint will:
1. Run database migrations
2. Load `clusters_seed.json` (always)
3. Load `demo_fixture.json` (only when `LOAD_DEMO_DATA=true`)
4. Start the application server

The portal will be available at `http://<vm-ip>/`.

### Encryption key requirement

Admin-managed enterprise bearer tokens and iDRAC passwords in the fixture are encrypted using the
`ENCRYPTION_KEY` from `.env`. **Use the same key that was used when the fixture was
exported**, otherwise those fields will be unreadable.

Keep the demo `ENCRYPTION_KEY` value in a secure place (e.g. shared password manager
accessible to the demo team).

### Refreshing demo data

To wipe the database and reload the fixture from scratch:

```bash
docker compose down -v          # removes the sqlite_data volume
docker compose up -d            # migrations + fixture load run again automatically
```

### Updating the fixture

If you add new devices, users, or other data that should be part of the demo baseline,
re-export and commit:

```bash
docker compose exec backend python manage.py dumpdata \
  --natural-foreign --natural-primary \
  --exclude contenttypes \
  --exclude auth.permission \
  --exclude admin.logentry \
  --indent 2 \
  -o /app/fixtures/demo_fixture.json

# Copy out of container (if needed) and commit:
git add backend/fixtures/demo_fixture.json
git commit -m "Update demo fixture"
```

---

## Demo Walkthrough

This section guides a presenter through a live demo once the system is running with demo data loaded.

### 1. Enterprise credential management

1. Log in as an admin user (e.g. `admin@zededa.com`).
2. Navigate to **Settings → Clusters** and open the **Enterprises** tab.
3. Click **Add Enterprise**, select a cluster, and paste a ZedCloud bearer token.
4. Submit — the portal fetches the enterprise name from ZedCloud automatically; no manual name entry is required.
5. The new enterprise appears in the list with its name, cluster, and last-sync status.

### 2. Hourly background sync

1. With at least one active enterprise configured, show the device table on the **Devices** page.
2. Point out the **EVE Version**, **Run State**, and **Connectivity** columns — these are populated by the hourly sync, not manually entered.
3. To demonstrate a sync result, trigger a manual refresh: open the **Enterprises** tab, click the three-dot menu next to an enterprise, and select **Sync Now**.
4. Return to the Devices page — updated EVE versions and run states appear within a few seconds.

### 3. Untracked devices

1. Navigate to **Untracked Devices** (`/untracked-devices`) from the sidebar.
2. The page lists devices seen in ZedCloud during the last sync but not present in the portal inventory.
3. Use the **Cluster** filter to narrow the list; the **Enterprise** filter cascades automatically to show only enterprises belonging to the selected cluster.
4. Select a device and click **Add to Inventory** — the device is created in the portal with its cluster and enterprise pre-filled.

### 4. MISSING condition (automatic flag)

1. On the **Devices** page, filter by **Condition → Missing**.
2. Explain that any inventory device that stops appearing in ZedCloud sync results is automatically flagged `Missing` — no manual action is required.
3. The `Missing` condition blocks reservations and is visible in the condition column and summary bar.

### 5. Admin notifications

1. Click the **bell icon** in the top-right header — the notification panel opens.
2. Show the four notification kinds:
   - **Token expired** — the bearer token for an enterprise is rejected by ZedCloud.
   - **Sync error** — the sync request itself failed (network, API error).
   - **Name mismatch** — the enterprise name stored in the portal differs from what ZedCloud returns.
   - **Enterprise inactive** — ZedCloud reports the enterprise as no longer active.
3. For a **Name mismatch** notification, show the inline action buttons: **Use ZedCloud name** updates the portal record immediately; **Keep current name** dismisses the alert without changing the name.
4. Clicking an **Enterprise inactive** notification navigates directly to the Clusters page.

### 6. Enterprise verification

1. After adding a new enterprise (step 1 above), the portal immediately kicks off a background verification job.
2. Return to the notification bell after a few seconds — if the enterprise name or state does not match ZedCloud, a `name_mismatch` or `enterprise_inactive` notification appears automatically.
3. This runs once after each import or enterprise addition; it is not a scheduled job.

---

## Transitioning to Production

When the system is approved for company-wide use:

**Step 1 — Deploy without the demo flag**

In the production `.env`, simply do not set `LOAD_DEMO_DATA` (or set it to `false`).
The backend will run migrations and start with an empty database.

```bash
# LOAD_DEMO_DATA is absent or false — no demo data loaded
```

**Step 2 — Use a production-grade database (recommended)**

Switch from SQLite to PostgreSQL by setting `DATABASE_URL` in `.env`:

```bash
DATABASE_URL=postgres://user:password@host:5432/holocron
```

**Step 3 — Generate a new encryption key**

Do not reuse the demo `ENCRYPTION_KEY` in production. Generate a new one:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

**Step 4 — Seed production data**

Admins can add labs, teams, users, and devices through the portal UI or Django admin.
No code changes are required.

**Step 5 — The fixture file stays in the repo**

`demo_fixture.json` can remain in the repo — it is only loaded when
`LOAD_DEMO_DATA=true` is explicitly set, so it has no effect on production deployments.

---

## Environment Variable Reference

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes | Django secret key |
| `ENCRYPTION_KEY` | Yes | Fernet key for encrypted fields |
| `ALLOWED_HOSTS` | Yes | Comma-separated list of hostnames |
| `SMTP_HOST` | No | SMTP server hostname (email disabled if blank) |
| `SMTP_PORT` | No | SMTP port (default 587) |
| `SMTP_USER` | No | SMTP account username / email address |
| `SMTP_PASS` | No | SMTP password / app password |
| `SMTP_FROM` | No | Sender address for notification emails (default `device-portal@zededa.com`) |
| `ADMIN_EMAILS` | No | Comma-separated admin emails for alerts |
| `PORTAL_BASE_URL` | No | Base URL used in email links (default `http://localhost:80`) |
| `DATABASE_URL` | No | PostgreSQL URL (uses SQLite if blank) |
| `CORS_ALLOWED_ORIGINS` | No | Comma-separated allowed CORS origins (required in non-DEBUG mode) |
| `DEBUG` | No | Set to `true` to enable Django debug mode and allow all CORS origins |
| `LOAD_DEMO_DATA` | No | Set to `true` to load demo fixture on startup |
