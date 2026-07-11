# Holocron — System Requirements

**Document for:** IT / Infrastructure Team  
**Purpose:** Provisioning a VM to host the Holocron device management portal

---

## Overview

Holocron is a web-based internal portal for managing lab devices, tracking ownership,
and handling reservation workflows. It runs as two Docker containers (backend API +
frontend web server) behind an nginx reverse proxy.

---

## VM Requirements

### Minimum (demo / trial)

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 vCPUs | 4 vCPUs |
| RAM | 2 GB | 4 GB |
| Disk | 20 GB | 40 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

### Production (company-wide rollout)

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 4 vCPUs | 8 vCPUs |
| RAM | 8 GB | 16 GB |
| Disk | 40 GB (OS + Docker) + separate DB volume | 100 GB |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |
| Database | PostgreSQL 15+ (managed or self-hosted) | Managed RDS / Cloud SQL |

> **Note:** The demo deployment uses SQLite (no separate DB server needed).
> Production deployments should use PostgreSQL for reliability and concurrent access.

---

## Software Prerequisites

The following must be installed on the VM before deployment:

| Software | Version | Notes |
|---|---|---|
| Docker Engine | 24.0+ | [Install guide](https://docs.docker.com/engine/install/ubuntu/) |
| Docker Compose | v2.20+ | Included with Docker Engine on Ubuntu |
| Git | Any recent | To clone the repository |

No other runtimes (Python, Node.js, etc.) need to be installed on the host — everything
runs inside containers.

---

## Network Requirements

### Inbound (firewall / security group rules)

| Port | Protocol | Source | Purpose |
|---|---|---|---|
| 22 | TCP | Admin IPs | SSH access for deployment |
| 80 | TCP | Internal network | HTTP — portal web UI and API |
| 443 | TCP | Internal network | HTTPS (if TLS is configured — see below) |

> The portal listens on port 80. If the company network requires HTTPS, a TLS
> termination layer (nginx, Caddy, or a load balancer) should be placed in front.

### Outbound

| Destination | Port | Protocol | Purpose |
|---|---|---|---|
| smtp.gmail.com (or corporate SMTP) | 587 | TCP/TLS | Email notifications for reservation approvals |
| GitHub (github.com) | 443 | TCP | Cloning the repository during initial setup |
| Docker Hub (registry-1.docker.io) | 443 | TCP | Pulling base images during `docker compose build` |

---

## Credentials & Secrets Required

The IT team needs to provide or generate the following before deployment. These go into
a `.env` file on the VM (never committed to the repository).

| Variable | Description | Who provides |
|---|---|---|
| `SECRET_KEY` | Django secret key (random 50-char string) | IT / DevOps — generate once |
| `ENCRYPTION_KEY` | Fernet encryption key for sensitive device fields | IT / DevOps — generate once; **keep a backup** |
| `ALLOWED_HOSTS` | Hostname or IP of the VM (e.g. `holocron.internal`) | IT |
| `SMTP_HOST` | SMTP server hostname (e.g. `smtp.gmail.com`; email disabled if blank) | IT / App owner |
| `SMTP_PORT` | SMTP port (typically `587`) | IT |
| `SMTP_USER` | SMTP account username / email address | App owner |
| `SMTP_PASS` | SMTP password or App Password | App owner |
| `SMTP_FROM` | Sender address for system emails (default `device-portal@zededa.com`) | App owner |
| `ADMIN_EMAILS` | Comma-separated list of admin email addresses | App owner |
| `PORTAL_BASE_URL` | Base URL used in email links (default `http://localhost:80`) | IT |
| `DATABASE_URL` | PostgreSQL connection string (production only) | IT / DBA |

### Generating required keys

Run these once on any machine with Python 3 installed:

```bash
# Django SECRET_KEY
python3 -c "import secrets, string; print(''.join(secrets.choice(string.ascii_letters + string.digits + '!@#$%^&*') for _ in range(50)))"

# ENCRYPTION_KEY (Fernet)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Store both values in a password manager. The `ENCRYPTION_KEY` in particular must never
be lost — it is required to decrypt iDRAC passwords and ZedCloud API tokens stored in
the database.

---

## Deployment Steps (for IT)

Once the VM is provisioned and prerequisites are installed:

```bash
# 1. Clone the repository
git clone <repo-url>
cd device-managing-portal

# 2. Create the .env file (see variables above)
nano .env

# 3. Build and start containers
docker compose build
docker compose up -d

# 4. Verify services are running
docker compose ps

# 5. Create a Django superuser (required to access /admin/ for managing labs, teams, and site config)
docker compose exec backend python manage.py createsuperuser
```

The portal will be accessible at `http://<vm-ip>/` within ~30 seconds of startup.

### Demo deployment

Add `LOAD_DEMO_DATA=true` to `.env` before the first `docker compose up -d`. This
pre-populates the database with sample devices, users, and labs so the system is ready
to demonstrate immediately. See `DEMO_GUIDELINE.md` for full details.

---

## Data Persistence

Application data is stored in Docker named volumes:

| Volume | Contents |
|---|---|
| `sqlite_data` | SQLite database file (demo) |
| `static_files` | Django collected static assets |

These volumes survive container restarts and upgrades. To back up the database:

```bash
docker compose exec backend python manage.py dumpdata \
  --natural-foreign --natural-primary \
  --exclude contenttypes --exclude auth.permission --exclude admin.logentry \
  --indent 2 -o /app/data/backup_$(date +%Y%m%d).json
docker compose cp backend:/app/data/backup_$(date +%Y%m%d).json .
```

---

## Maintenance

| Task | Command |
|---|---|
| View logs | `docker compose logs -f backend` |
| Restart services | `docker compose restart` |
| Update to new version | `git pull && docker compose build && docker compose up -d` |
| Wipe and reload demo data | `docker compose down -v && docker compose up -d` |

---

## Contact

For questions about the application or `.env` values, contact the Holocron application
owner.
