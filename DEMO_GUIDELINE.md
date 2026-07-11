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
- Vault tokens (encrypted — see note below)

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

```
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

Vault bearer tokens and iDRAC passwords in the fixture are encrypted using the
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

## Transitioning to Production

When the system is approved for company-wide use:

**Step 1 — Deploy without the demo flag**

In the production `.env`, simply do not set `LOAD_DEMO_DATA` (or set it to `false`).
The backend will run migrations and start with an empty database.

```
# LOAD_DEMO_DATA is absent or false — no demo data loaded
```

**Step 2 — Use a production-grade database (recommended)**

Switch from SQLite to PostgreSQL by setting `DATABASE_URL` in `.env`:

```
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
