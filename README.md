# Holocron — Lab Device Management Portal

Holocron is an internal web portal for Zededa test teams to manage shared physical lab devices. It provides real-time visibility into device ownership, EVE OS status, and connectivity — and a structured reservation workflow so engineers don't step on each other's devices.

> Full design spec: [DESIGN.md](DESIGN.md) | Implementation reference: [DEVELOPMENT.md](DEVELOPMENT.md)

---

## Features

- **Device table** — ownership, EVE version, SSH IPs, condition, cluster assignment at a glance
- **Reserve / Release** — instant transfer if free; email approval flow if owned
- **Fetch Status** — pulls live EVE version, run state, and connectivity from ZedCloud on demand
- **Condition flags** — Out of Order, Needs Repair, Temporarily Leased, Dedicated, Missing
- **Admin controls** — force-assign, bulk CSV import/export, user management
- **Ownership history** — append-only audit log per device
- **Email notifications** — reservation requests, approvals, out-of-order alerts
- **Encrypted credentials** — iDRAC passwords and enterprise ZedCloud bearer tokens stored with Fernet encryption
- **Auto device sync** — hourly background poll per enterprise; untracked devices surfaced in their own page; admins notified of token expiry, name mismatches, and inactive enterprises

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12 · Django 6.0 · Django REST Framework |
| Frontend | React 19 · TypeScript · Vite · Tailwind v4 · shadcn/ui |
| Database | SQLite (dev / demo) · PostgreSQL (production) |
| Container | Docker · Docker Compose · nginx |
| HTTP client | httpx (backend → ZedCloud) · TanStack Query (frontend) |

---

## Local Development

### Prerequisites

- Python 3.12+
- Node.js 20+
- Git

### Backend setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Create .env (copy from example and fill in values)
cp ../.env.example .env

# Run migrations and seed data
python manage.py migrate
python manage.py loaddata fixtures/clusters_seed.json

# Start dev server
python manage.py runserver
```

Backend runs at `http://localhost:8000`.

### Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` and proxies API calls to `localhost:8000`.

### Environment variables (local)

Create a `.env` file in the repo root (for Docker) or `backend/.env` (for local dev):

| Variable | Required | Default | Description |
|---|---|---|---|
| `SECRET_KEY` | Yes | — | Django secret key |
| `ENCRYPTION_KEY` | Yes | — | Fernet key for encrypted fields |
| `ALLOWED_HOSTS` | No | `*` | Comma-separated hostnames |
| `DEBUG` | No | `false` | Enable Django debug mode |
| `SMTP_HOST` | No | _(blank)_ | SMTP server — email disabled if blank |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password / App Password |
| `SMTP_FROM` | No | `device-portal@zededa.com` | Sender address |
| `ADMIN_EMAILS` | No | — | Comma-separated admin emails for alerts |
| `PORTAL_BASE_URL` | No | `http://localhost:80` | Base URL used in email links |
| `CORS_ALLOWED_ORIGINS` | No | — | Allowed CORS origins (required if `DEBUG=false`) |
| `DATABASE_URL` | No | SQLite | PostgreSQL connection string |
| `LOAD_DEMO_DATA` | No | `false` | Load demo fixture on startup |

Generate the required keys:

```bash
# SECRET_KEY
python3 -c "import secrets, string; print(''.join(secrets.choice(string.ascii_letters + string.digits + '!@#$%^&*') for _ in range(50)))"

# ENCRYPTION_KEY
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

---

## Docker Deployment

### Prerequisites

- Docker Engine 24.0+
- Docker Compose v2.20+

### Standard deployment

```bash
# Clone the repo
git clone <repo-url>
cd device-managing-portal

# Create and fill in .env
cp .env.example .env
nano .env

# Build and start
docker compose build
docker compose up -d

# Verify
docker compose ps
```

The portal is available at `http://<host>/` within ~30 seconds.

### Demo deployment

Add `LOAD_DEMO_DATA=true` to `.env` before the first `docker compose up -d`. This pre-populates the database with devices, users, labs, and teams so the system is ready to demonstrate immediately.

```bash
# In .env:
LOAD_DEMO_DATA=true

docker compose build
docker compose up -d
```

> The demo fixture contains encrypted fields. Use the same `ENCRYPTION_KEY` that was used when the fixture was exported — see [DEMO_GUIDELINE.md](DEMO_GUIDELINE.md).

### Useful commands

```bash
# View logs
docker compose logs -f backend

# Restart services
docker compose restart

# Update to a new version
git pull && docker compose build && docker compose up -d

# Wipe database and reload demo data from scratch
docker compose down -v && docker compose up -d

# Backup the database
docker compose exec backend python manage.py dumpdata \
  --natural-foreign --natural-primary \
  --exclude contenttypes --exclude auth.permission --exclude admin.logentry \
  --indent 2 -o /app/data/backup_$(date +%Y%m%d).json
docker compose cp backend:/app/data/backup_$(date +%Y%m%d).json .
```

---

## Production Setup

For a company-wide deployment:

1. **Use PostgreSQL** — set `DATABASE_URL=postgres://user:pass@host:5432/dbname` in `.env`
2. **Generate a fresh `ENCRYPTION_KEY`** — never reuse the demo key in production
3. **Set `ALLOWED_HOSTS`** to the real hostname (e.g. `holocron.internal`)
4. **Configure SMTP** — set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` for email notifications
5. **TLS** — place an nginx or Caddy reverse proxy in front for HTTPS; the app listens on port 80
6. **Do not set `LOAD_DEMO_DATA`** — the database starts empty; admins add real data via the portal UI

See [SYSTEM_REQUIREMENTS.md](SYSTEM_REQUIREMENTS.md) for full VM sizing, firewall rules, and IT provisioning steps.

See [DEMO_GUIDELINE.md](DEMO_GUIDELINE.md) for demo-to-production transition instructions.

---

## Project Structure

```
device-managing-portal/
├── backend/
│   ├── apps/
│   │   ├── devices/          # Device model, serializers, views
│   │   ├── users/            # PortalUser, Team models
│   │   ├── reservations/     # ReservationRequest, ownership history
│   │   ├── clusters/         # ZedCloud cluster registry
│   │   ├── device_models/    # Hardware model catalog
│   │   ├── enterprises/      # Enterprise credentials + hourly sync engine
│   │   ├── notifications/    # Admin in-app alerts from sync engine
│   │   └── admin_tools/      # CSV import/export, latency tracking
│   ├── utils/
│   │   ├── permissions.py    # IsPortalUser, IsAdminPortalUser, get_user_email
│   │   ├── crypto.py         # Fernet encrypt/decrypt helpers
│   │   └── email.py          # Notification email wrappers
│   ├── services/
│   │   └── zedcloud.py       # ZedCloud API client (httpx)
│   ├── fixtures/
│   │   ├── clusters_seed.json
│   │   └── demo_fixture.json
│   ├── config/               # Django settings, URLs
│   └── entrypoint.sh
├── frontend/
│   └── src/
│       ├── api/              # Typed API client modules
│       ├── components/       # UI components (DeviceTable, Header, modals…)
│       ├── pages/            # DevicesPage, UsersPage, ConfirmReservationPage
│       └── context/          # UserContext (auth state)
├── DESIGN.md                 # Full product and API design spec
├── DEVELOPMENT.md            # Implementation patterns and checklists
├── DEMO_GUIDELINE.md         # Demo setup and production transition
├── SYSTEM_REQUIREMENTS.md    # IT provisioning guide
└── docker-compose.yml
```

---

## Documentation Index

| Document | Purpose |
|---|---|
| [DESIGN.md](DESIGN.md) | Full product spec, data model, API surface, UI wireframes |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Code patterns, conventions, and implementation checklists |
| [DEMO_GUIDELINE.md](DEMO_GUIDELINE.md) | Demo fixture setup, refreshing data, transitioning to production |
| [SYSTEM_REQUIREMENTS.md](SYSTEM_REQUIREMENTS.md) | VM sizing, firewall rules, secrets — for the IT team |
